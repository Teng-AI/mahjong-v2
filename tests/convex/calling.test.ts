// M2 server-loop timer matrix, item 2: calling-timer expiry auto-passes a
// waiting human. Contract: design-server-loop.md section 9.
//
// Deterministic construction (preferred per the design doc over hoping a
// random game produces a human-waiting calling phase): deal the junk fixture,
// drive it through real engine transitions until seat 0 (the human) is a
// 'waiting' responder in a fresh calling phase, then arm the schedule via
// applyAndSchedule exactly like the production startHand path would.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../../convex/_generated/server';
import { discard, draw, getTileType, initHand, respondToCall } from '../../engine';
import type { EngineState } from '../../engine';
import { applyAndSchedule } from '../../convex/loop';
import { getGame, junkDeck, mkT, setupRoom } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('2. calling-timer expiry auto-passes the waiting human', () => {
  it('passes seat 0 on timeout and the hand proceeds past the calling phase', async () => {
    const t = mkT();
    const { roomId } = await setupRoom(t, { turnTimerSeconds: 30, callingTimerSeconds: 30 });

    const gameId = await t.run(async (ctx: MutationCtx) => {
      const dealt = initHand({ dealerSeat: 0, dealerStreak: 0 }, junkDeck());
      if (!dealt.ok) throw new Error('deal failed');

      // Dealer (seat 0) discards; opens a calling phase among bots only.
      const dealerTile = dealt.state.hands[0][0];
      const d0 = discard(dealt.state, 0, dealerTile);
      if (!d0.ok) throw new Error(`dealer discard failed: ${JSON.stringify(d0.error)}`);

      // All three bots pass (junk hands: none can legally do anything else).
      let s = d0.state;
      for (const seat of [1, 2, 3] as const) {
        const r = respondToCall(s, seat, 'pass');
        if (!r.ok) throw new Error(`bot ${seat} pass failed: ${JSON.stringify(r.error)}`);
        s = r.state;
      }
      expect(s.phase).toBe('playing');
      expect(s.currentPlayerSeat).toBe(1);

      // Bot 1 draws, then discards a non-gold tile: this opens a NEW calling
      // phase where seat 0 (human) is a 'waiting' responder.
      const drawn = draw(s, 1);
      if (!drawn.ok) throw new Error(`bot 1 draw failed: ${JSON.stringify(drawn.error)}`);
      s = drawn.state;
      const nonGold = s.hands[1].find((tl) => getTileType(tl) !== s.goldTileType)!;
      const d1 = discard(s, 1, nonGold);
      if (!d1.ok) throw new Error(`bot 1 discard failed: ${JSON.stringify(d1.error)}`);
      s = d1.state;

      expect(s.phase).toBe('calling');
      expect(s.pendingCalls![0]).toBe('waiting');

      const gid = await ctx.db.insert('games', {
        roomId,
        roundNumber: 1,
        dealerStreak: 0,
        engine: s,
        deadlineAt: null,
        schedId: null,
        createdAt: Date.now(),
      });
      await ctx.db.patch(roomId, { activeGameId: gid });
      const gameDoc = (await ctx.db.get(gid))!;
      await applyAndSchedule(ctx, gameDoc, s, Date.now());
      return gid;
    });

    const armed = await getGame(t, gameId);
    expect(armed.deadlineAt).not.toBeNull(); // human waiting -> calling-timer countdown armed
    const armedState = armed.engine as EngineState;
    expect(armedState.phase).toBe('calling');

    await vi.advanceTimersByTimeAsync(31_000);
    await t.finishInProgressScheduledFunctions();

    const after = await getGame(t, gameId);
    const afterState = after.engine as EngineState;
    // Seat 0 was auto-passed; with every bot also junk (no legal call), the
    // hand resolves out of the calling phase entirely.
    expect(afterState.phase).not.toBe('calling');
    expect(afterState.seq).toBeGreaterThan(armedState.seq);
  });
});
