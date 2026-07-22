// M2 server-loop timer matrix. Contract: design-server-loop.md section 9,
// items 1 (turn-timer expiry), 3 (stale timer no-op), 4 (cancel-and-replace),
// 7 (storage round-trip of optional-absent engine fields), 8 (self-healing
// backstop).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import type { MutationCtx } from '../../convex/_generated/server';
import { declareConcealedKong, initHand } from '../../engine';
import type { EngineState } from '../../engine';
import { dealJunkHand, getEngine, getGame, junkDeck, mkT, setupRoom } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('1. turn-timer expiry (playing)', () => {
  it('auto-discards for the human dealer on timeout and arms the next schedule', async () => {
    const t = mkT();
    const { roomId } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });
    const gameId = await dealJunkHand(t, roomId);

    const before = await getGame(t, gameId);
    expect(before.deadlineAt).not.toBeNull(); // seat 0 is human, dealer, needs no draw
    expect(before.schedId).not.toBeNull();
    const beforeState = before.engine as EngineState;
    expect(beforeState.discardPile).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(31_000);
    await t.finishInProgressScheduledFunctions();

    const after = await getGame(t, gameId);
    const afterState = after.engine as EngineState;
    expect(afterState.seq).toBeGreaterThan(beforeState.seq);
    expect(afterState.discardPile.length).toBeGreaterThan(beforeState.discardPile.length);
    // Something new got armed for whatever comes next (calling phase among bots).
    expect(after.schedId).not.toBeNull();
  });
});

describe('3. stale timer no-op', () => {
  it('ignores an onDeadline call whose expectedSeq no longer matches', async () => {
    const t = mkT();
    const { roomId, roomCode } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });
    const gameId = await dealJunkHand(t, roomId);

    const armed = await getGame(t, gameId);
    const armedState = armed.engine as EngineState;
    const staleSeq = armedState.seq;

    // Human acts before expiry: discard a real (non-gold) tile from the junk
    // deck's dealer hand.
    const tile = armedState.hands[0][0];
    const res = await t.mutation(api.intents.intentDiscard, {
      roomCode,
      token: 'human-token',
      tile,
    });
    expect(res).toEqual({ ok: true });

    const postAction = await getGame(t, gameId);
    const postActionSeq = (postAction.engine as EngineState).seq;
    expect(postActionSeq).toBeGreaterThan(staleSeq);

    // Force the ORIGINAL (now-superseded) scheduled fn to run directly.
    await t.mutation(internal.loop.onDeadline, { gameId, expectedSeq: staleSeq });

    const after = await getGame(t, gameId);
    expect((after.engine as EngineState).seq).toBe(postActionSeq);
  });
});

describe('4. cancel-and-replace', () => {
  it('rearms schedId when the player acts mid-countdown; the old schedule is canceled', async () => {
    const t = mkT();
    const { roomId, roomCode } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });
    const gameId = await dealJunkHand(t, roomId);

    const armed = await getGame(t, gameId);
    const oldSchedId = armed.schedId!;
    const armedState = armed.engine as EngineState;

    const tile = armedState.hands[0][0];
    await t.mutation(api.intents.intentDiscard, {
      roomCode,
      token: 'human-token',
      tile,
    });

    const after = await getGame(t, gameId);
    expect(after.schedId).not.toBeNull();
    expect(after.schedId).not.toBe(oldSchedId);

    const oldSchedState = await t.run(async (ctx: MutationCtx) => ctx.db.system.get(oldSchedId));
    expect(oldSchedState?.state.kind).not.toBe('pending');
  });
});

describe('over-draw gate (intentDraw)', () => {
  it('rejects a draw when the seat already holds a full hand', async () => {
    const t = mkT();
    const { roomId, roomCode } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });
    const gameId = await dealJunkHand(t, roomId);

    // The junk-deck dealer starts with 17 tiles: needs no draw. The engine's
    // draw() alone would accept this (legalActions is the gate, M1 decision);
    // the mutation must refuse it or a modified client could stack tiles.
    const before = await getEngine(t, gameId);
    expect(before.hands[0]).toHaveLength(17);

    const res = await t.mutation(api.intents.intentDraw, {
      roomCode,
      token: 'human-token',
    });
    expect(res).toEqual({ ok: false, code: 'already_drawn' });

    const after = await getEngine(t, gameId);
    expect(after.hands[0]).toHaveLength(17);
    expect(after.seq).toBe(before.seq);
  });
});

describe('7. storage round-trip of optional-absent fields', () => {
  it('preserves a Meld with an absent calledTile and a WinnerInfo with an absent winningTile', async () => {
    const t = mkT();
    const roundTripped = await t.run(async (ctx: MutationCtx) => {
      const dealt = initHand({ dealerSeat: 0, dealerStreak: 0 }, junkDeck());
      if (!dealt.ok) throw new Error('deal failed');
      // Dealer holds all 4 copies of dots_1 in the junk deck: a concealed kong
      // produces a Meld literal with no `calledTile` key at all (game.ts:542).
      const kong = declareConcealedKong(dealt.state, 0, 'dots_1');
      if (!kong.ok) throw new Error(`concealed kong failed: ${JSON.stringify(kong.error)}`);

      const gameId = await ctx.db.insert('games', {
        roomId: (await ctx.db.insert('rooms', {
          code: 'RT0001',
          status: 'playing',
          hostToken: 'x',
          callingTimerSeconds: null,
          turnTimerSeconds: null,
          dealerSeat: 0,
          dealerStreak: 0,
          roundNumber: 1,
          activeGameId: null,
          createdAt: Date.now(),
        })) as any,
        roundNumber: 1,
        dealerStreak: 0,
        engine: kong.state,
        deadlineAt: null,
        schedId: null,
        createdAt: Date.now(),
      });
      const readBack = (await ctx.db.get(gameId))!;
      return { written: kong.state, readBack: readBack.engine as EngineState };
    });

    expect(roundTripped.readBack).toEqual(roundTripped.written);
    const meld = roundTripped.readBack.melds[0].find((m) => m.type === 'kong')!;
    expect(meld.isConcealed).toBe(true);
    expect('calledTile' in meld).toBe(false);
  });
});

describe('8. self-healing backstop', () => {
  it('runs the deadline logic inline when the scheduled fn was lost, before the failing intent', async () => {
    const t = mkT();
    const { roomId, roomCode } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });
    const gameId = await dealJunkHand(t, roomId);

    const armed = await getGame(t, gameId);
    const armedState = armed.engine as EngineState;
    expect(armedState.discardPile).toHaveLength(0);

    // Simulate a lost schedule: cancel it instead of letting it fire.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.scheduler.cancel(armed.schedId!);
    });

    await vi.advanceTimersByTimeAsync(33_000); // strictly past deadline + 2s grace

    // Send an intent that will itself fail (dealer already has no need to
    // draw). The backstop must run the deadline logic first regardless.
    const res = await t.mutation(api.intents.intentDraw, {
      roomCode,
      token: 'human-token',
    });
    // The backstop's auto-discard moves the hand into a calling phase before
    // intentDraw's own transition runs, so the intent itself now fails
    // wrong_phase (not the not_your_turn it would have failed with pre-backstop).
    expect(res).toEqual({ ok: false, code: 'wrong_phase' });

    const after = await getEngine(t, gameId);
    expect(after.seq).toBeGreaterThan(armedState.seq);
    expect(after.discardPile.length).toBeGreaterThan(0);
  });
});
