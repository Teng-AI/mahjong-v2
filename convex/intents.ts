// Public player-intent mutations. Contract: design-server-loop.md §5.
//
// Each: resolve seat by token, load the active game, run one engine transition
// for that seat, then applyAndSchedule. Engine EngineError codes are returned
// as { ok: false, code } (client toast) — never thrown, so a user error never
// triggers an OCC retry storm. Throwing is reserved for auth/plumbing failures
// (loadActiveGame throws ConvexError). Every intent runs the self-healing
// backstop (§6.2) before its own transition.

import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import {
  draw,
  discard,
  respondToCall,
  declareSelfDrawWin,
  declareConcealedKong,
  upgradePungToKong,
  legalActions,
} from '../engine';
import type { CallAction, ChowSelection, EngineState, Result, Seat } from '../engine';
import { loadActiveGame, roomByCode } from './lib';
import { applyAndSchedule, runDeadline, startHand } from './loop';

type IntentResult = { ok: true } | { ok: false; code: string };

/** Self-healing backstop (§6.2): if the deadline is well past and its scheduled
 *  function never fired, run the deadline logic inline first. A lost schedule
 *  then costs at most one player action of delay, never a stall. Returns the
 *  (possibly refreshed) game doc + engine state to run the intent against. */
async function withBackstop(
  ctx: MutationCtx,
  game: Doc<'games'>,
): Promise<{ game: Doc<'games'>; state: EngineState }> {
  const now = Date.now();
  if (game.deadlineAt != null && now > game.deadlineAt + 2000) {
    await runDeadline(ctx, game, now);
    const refreshed = (await ctx.db.get(game._id))!;
    return { game: refreshed, state: refreshed.engine as EngineState };
  }
  return { game, state: game.engine as EngineState };
}

/** Shared body: resolve, backstop, run `transition`, apply. */
async function runIntent(
  ctx: MutationCtx,
  roomCode: string,
  token: string,
  transition: (state: EngineState, seat: Seat) => Result,
): Promise<IntentResult> {
  const { player, game } = await loadActiveGame(ctx, roomCode, token);
  const { game: g, state } = await withBackstop(ctx, game);
  const res = transition(state, player.seat as Seat);
  if (!res.ok) return { ok: false, code: res.error.code };
  await applyAndSchedule(ctx, g, res.state, Date.now());
  return { ok: true };
}

export const intentDraw = mutation({
  args: { roomCode: v.string(), token: v.string() },
  handler: (ctx, { roomCode, token }) =>
    runIntent(ctx, roomCode, token, (state, seat) => draw(state, seat)),
});

export const intentDiscard = mutation({
  args: { roomCode: v.string(), token: v.string(), tile: v.string() },
  handler: (ctx, { roomCode, token, tile }) =>
    runIntent(ctx, roomCode, token, (state, seat) => discard(state, seat, tile)),
});

export const intentRespond = mutation({
  args: {
    roomCode: v.string(),
    token: v.string(),
    action: v.union(
      v.literal('win'),
      v.literal('kong'),
      v.literal('pung'),
      v.literal('chow'),
      v.literal('pass'),
    ),
    chowSelection: v.optional(v.object({ tilesFromHand: v.array(v.string()) })),
  },
  handler: (ctx, { roomCode, token, action, chowSelection }) =>
    runIntent(ctx, roomCode, token, (state, seat) =>
      respondToCall(state, seat, action as CallAction, chowSelection as ChowSelection | undefined),
    ),
});

export const intentSelfDrawWin = mutation({
  args: { roomCode: v.string(), token: v.string() },
  handler: (ctx, { roomCode, token }) =>
    runIntent(ctx, roomCode, token, (state, seat) => {
      // Engine deliberately does not re-validate the winning shape here (M1
      // decision); gate on legalActions first, then declare.
      if (!legalActions(state, seat).canSelfDrawWin) {
        return { ok: false, error: { code: 'not_a_winning_hand' } };
      }
      return declareSelfDrawWin(state, seat);
    }),
});

export const intentConcealedKong = mutation({
  args: { roomCode: v.string(), token: v.string(), tileType: v.string() },
  handler: (ctx, { roomCode, token, tileType }) =>
    runIntent(ctx, roomCode, token, (state, seat) =>
      declareConcealedKong(state, seat, tileType),
    ),
});

export const intentUpgradeKong = mutation({
  args: { roomCode: v.string(), token: v.string(), meldIndex: v.number() },
  handler: (ctx, { roomCode, token, meldIndex }) =>
    runIntent(ctx, roomCode, token, (state, seat) => {
      // upgradePungToKong needs the concrete tile; recover it from legalActions.
      const up = legalActions(state, seat).pungUpgrades.find((u) => u.meldIndex === meldIndex);
      if (!up) return { ok: false, error: { code: 'invalid_kong' } };
      return upgradePungToKong(state, seat, meldIndex, up.tile);
    }),
});

/** Ends-state only: start the next hand. Room bookkeeping (dealer rotation,
 *  streak, roundNumber) was already advanced by the settle path. */
export const nextRound = mutation({
  args: { roomCode: v.string(), token: v.string() },
  handler: async (ctx, { roomCode, token }): Promise<IntentResult> => {
    const { room, game } = await loadActiveGame(ctx, roomCode, token);
    const state = game.engine as EngineState;
    if (state.phase !== 'ended') return { ok: false, code: 'hand_in_progress' };
    await startHand(ctx, room._id);
    return { ok: true };
  },
});

/** Presence heartbeat. Stamps lastSeenAt; the presence badge is M3-cosmetic. */
export const heartbeat = mutation({
  args: { roomCode: v.string(), token: v.string() },
  handler: async (ctx, { roomCode, token }): Promise<IntentResult> => {
    const room = await roomByCode(ctx, roomCode);
    if (!room) return { ok: false, code: 'room_not_found' };
    const player = await ctx.db
      .query('players')
      .withIndex('by_room_token', (q) => q.eq('roomId', room._id).eq('token', token))
      .unique();
    if (!player) return { ok: false, code: 'bad_token' };
    await ctx.db.patch(player._id, { lastSeenAt: Date.now() });
    return { ok: true };
  },
});
