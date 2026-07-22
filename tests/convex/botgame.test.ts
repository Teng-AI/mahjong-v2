// M2 server-loop item 5: a 4-bot game (no human clients) pumped through the
// scheduler to completion. Contract: design-server-loop.md section 9.
// Proves the bot loop terminates through the real Convex scheduling path
// (not just the pure-engine property test in engine/__tests__/bots.test.ts)
// and that tiles are conserved at the end.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../../convex/_generated/server';
import type { EngineState, Seat } from '../../engine';
import { startHand } from '../../convex/loop';
import { getGame, mkT } from './helpers';

const SEATS: Seat[] = [0, 1, 2, 3];
const DEAD_WALL = 16;
const MAX_ITERATIONS = 500;

function assertTileConservation(state: EngineState): void {
  let total = 1 /* exposedGold */ + DEAD_WALL + state.wall.length + state.discardPile.length;
  for (const seat of SEATS) {
    total += state.hands[seat].length;
    total += state.bonusTiles[seat].length;
    for (const meld of state.melds[seat]) total += meld.tiles.length;
  }
  expect(total).toBe(128);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('5. bot game to completion', () => {
  it('4 bots play a full hand to the end via the real scheduler', async () => {
    const t = mkT();

    const { roomId, gameId } = await t.run(async (ctx: MutationCtx) => {
      const now = Date.now();
      const roomId = await ctx.db.insert('rooms', {
        code: 'BOTS01',
        status: 'playing',
        hostToken: 'nobody',
        callingTimerSeconds: 30,
        turnTimerSeconds: 30,
        dealerSeat: 0,
        dealerStreak: 0,
        roundNumber: 1,
        activeGameId: null,
        createdAt: now,
      });
      for (let seat = 0; seat <= 3; seat++) {
        await ctx.db.insert('players', {
          roomId,
          seat,
          name: `Bot-M${seat}`,
          token: null,
          isBot: true,
          botDifficulty: 'medium',
          lastSeenAt: now,
        });
      }
      const gameId = await startHand(ctx, roomId);
      return { roomId, gameId };
    });

    let iterations = 0;
    let finalState: EngineState;
    for (;;) {
      const game = await getGame(t, gameId);
      finalState = game.engine as EngineState;
      if (finalState.phase === 'ended') break;
      if (iterations >= MAX_ITERATIONS) {
        throw new Error(
          `bot game did not finish within ${MAX_ITERATIONS} pumps; last phase ${finalState.phase}, seq ${finalState.seq}`,
        );
      }
      await vi.advanceTimersByTimeAsync(1000);
      await t.finishInProgressScheduledFunctions();
      iterations++;
    }

    expect(iterations).toBeLessThan(MAX_ITERATIONS);
    expect(finalState!.phase).toBe('ended');
    assertTileConservation(finalState!);

    const rounds = await t.run(async (ctx: MutationCtx) =>
      ctx.db
        .query('rounds')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .collect(),
    );
    expect(rounds.length).toBeGreaterThanOrEqual(1);
  });
});
