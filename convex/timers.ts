import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// M0 spike gates 2-3: server timer fires with all clients dead; measure skew.
export const startTurn = mutation({
  args: { delayMs: v.number() },
  handler: async (ctx, { delayMs }) => {
    const now = Date.now();
    const turnId = await ctx.db.insert("turns", {
      startedAt: now,
      delayMs,
      deadlineAt: now + delayMs,
      status: "pending",
    });
    await ctx.scheduler.runAfter(delayMs, internal.timers.advanceTurn, {
      turnId,
    });
    return turnId;
  },
});

export const advanceTurn = internalMutation({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.status !== "pending") return;
    const firedAt = Date.now();
    await ctx.db.patch(turnId, {
      status: "fired",
      firedAt,
      skewMs: firedAt - (turn.deadlineAt as number),
    });
  },
});

// Gate 4: cancel-and-replace plus turn-counter guard against stale timers.
export const startGuardedGame = mutation({
  args: { delayMs: v.number() },
  handler: async (ctx, { delayMs }) => {
    const gameId = await ctx.db.insert("spikeGames", {
      turnCounter: 1,
      advances: 0,
      staleNoops: 0,
    });
    const schedId = await ctx.scheduler.runAfter(
      delayMs,
      internal.timers.guardedAdvance,
      { gameId, expectedCounter: 1 },
    );
    await ctx.db.patch(gameId, { schedId });
    return gameId;
  },
});

export const act = mutation({
  args: { gameId: v.id("spikeGames"), nextDelayMs: v.number() },
  handler: async (ctx, { gameId, nextDelayMs }) => {
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("no game");
    await ctx.scheduler.cancel(game.schedId);
    const nextCounter = (game.turnCounter as number) + 1;
    const schedId = await ctx.scheduler.runAfter(
      nextDelayMs,
      internal.timers.guardedAdvance,
      { gameId, expectedCounter: nextCounter },
    );
    await ctx.db.patch(gameId, { turnCounter: nextCounter, schedId });
  },
});

// Deliberately fire a stale advance (old counter) to prove the guard no-ops.
export const fireStale = mutation({
  args: { gameId: v.id("spikeGames"), staleCounter: v.number() },
  handler: async (ctx, { gameId, staleCounter }) => {
    await ctx.scheduler.runAfter(0, internal.timers.guardedAdvance, {
      gameId,
      expectedCounter: staleCounter,
    });
  },
});

export const guardedAdvance = internalMutation({
  args: { gameId: v.id("spikeGames"), expectedCounter: v.number() },
  handler: async (ctx, { gameId, expectedCounter }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    if (game.turnCounter !== expectedCounter) {
      await ctx.db.patch(gameId, {
        staleNoops: (game.staleNoops as number) + 1,
      });
      return;
    }
    await ctx.db.patch(gameId, {
      advances: (game.advances as number) + 1,
      turnCounter: (game.turnCounter as number) + 1,
    });
  },
});

export const getGuardedGame = query({
  args: { gameId: v.id("spikeGames") },
  handler: async (ctx, { gameId }) => ctx.db.get(gameId),
});

export const skewStats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("turns").collect();
    const fired = rows.filter((t) => t.status === "fired");
    const byDelay: Record<string, number[]> = {};
    for (const t of fired) {
      const key = String(t.delayMs);
      (byDelay[key] ??= []).push(t.skewMs as number);
    }
    const stats = Object.entries(byDelay).map(([delayMs, skews]) => {
      const sorted = [...skews].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      return { delayMs: Number(delayMs), n: sorted.length, min: sorted[0], p50: p(0.5), p95: p(0.95), max: sorted[sorted.length - 1] };
    });
    return { pending: rows.length - fired.length, stats };
  },
});

export const recentTurns = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("turns").order("desc").take(10);
    return rows.map((t) => ({
      id: t._id,
      delayMs: t.delayMs as number,
      deadlineAt: t.deadlineAt as number,
      status: t.status as string,
      firedAt: (t.firedAt as number | undefined) ?? null,
      skewMs: (t.skewMs as number | undefined) ?? null,
    }));
  },
});
