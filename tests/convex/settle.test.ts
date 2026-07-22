// M2 server-loop item 9: instant-win deal settle. Contract:
// design-server-loop.md section 9 / section 6.3, spec 1.6 (dealer rotation +
// streak). Covers the settle path that startHand's own instant-end branch
// also uses (both call initHand then settleHand).
//
// The Three Golds fixture is ported verbatim from
// engine/__tests__/deal.test.ts ("initHand: Three Golds instant win") rather
// than re-derived, per the task brief.

import { describe, expect, it } from 'vitest';
import type { MutationCtx } from '../../convex/_generated/server';
import { initHand } from '../../engine';
import type { Seat, TileId } from '../../engine';
import { settleHand } from '../../convex/loop';
import { mkT } from './helpers';

function craft(front: TileId[], allTiles: TileId[]): TileId[] {
  const used = new Set(front);
  const rest = allTiles.filter((t) => !used.has(t));
  return [...front, ...rest];
}

/** Ported from deal.test.ts: seat 1 holds all 3 live copies of the type that
 *  flips gold -> instant Three Golds win, self-draw, x2, +30. */
function threeGoldsDeck(generateAllTiles: () => TileId[]): TileId[] {
  const junkTypes = [
    'dots_3', 'dots_4', 'dots_5', 'dots_6', 'dots_7', 'dots_8', 'dots_9',
    'bamboo_3', 'bamboo_4', 'bamboo_5', 'bamboo_6', 'bamboo_7', 'bamboo_8', 'bamboo_9',
    'characters_2', 'characters_3',
  ];
  const dealerHand = junkTypes.map((t) => `${t}_0`);
  const dealerExtra = `${junkTypes[0]}_3`;
  const seat2Hand = junkTypes.map((t) => `${t}_1`);
  const seat3Hand = junkTypes.slice(0, 16).map((t) => `${t}_2`);
  const seat1Hand = [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'dots_2_0', 'dots_2_1', 'dots_2_2',
    'bamboo_1_0', 'bamboo_1_1', 'bamboo_1_2',
    'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
    'characters_1_0',
    'characters_9_0', 'characters_9_2', 'characters_9_3',
  ];

  const front: TileId[] = [];
  for (let pass = 0; pass < 16; pass++) {
    front[pass * 4 + 0] = dealerHand[pass];
    front[pass * 4 + 1] = seat1Hand[pass];
    front[pass * 4 + 2] = seat2Hand[pass];
    front[pass * 4 + 3] = seat3Hand[pass];
  }
  front[64] = dealerExtra;
  front[65] = 'characters_9_1';

  return craft(front, generateAllTiles());
}

describe('9. instant-win deal settle', () => {
  it('Three Golds at deal settles immediately: rounds row + dealer rotation + streak reset', async () => {
    const t = mkT();

    const { generateAllTiles } = await import('../../engine');

    const outcome = await t.run(async (ctx: MutationCtx) => {
      const now = Date.now();
      const roomId = await ctx.db.insert('rooms', {
        code: 'GOLD001',
        status: 'playing',
        hostToken: 'x',
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
          name: seat === 1 ? 'Winner' : `Bot-M${seat}`,
          token: null,
          isBot: true,
          botDifficulty: 'medium',
          lastSeenAt: now,
        });
      }

      const dealt = initHand({ dealerSeat: 0, dealerStreak: 0 }, threeGoldsDeck(generateAllTiles));
      if (!dealt.ok) throw new Error(`deal failed: ${JSON.stringify(dealt.error)}`);
      expect(dealt.state.phase).toBe('ended');
      expect(dealt.state.winner?.seat).toBe(1 as Seat);

      const gameId = await ctx.db.insert('games', {
        roomId,
        roundNumber: 1,
        dealerStreak: 0,
        engine: dealt.state,
        deadlineAt: null,
        schedId: null,
        createdAt: now,
      });
      await ctx.db.patch(roomId, { activeGameId: gameId });
      const gameDoc = (await ctx.db.get(gameId))!;

      await settleHand(ctx, gameDoc, dealt.state);

      const rounds = await ctx.db
        .query('rounds')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .collect();
      const room = (await ctx.db.get(roomId))!;
      return { rounds, room, winnerScore: dealt.state.winner!.score.total };
    });

    expect(outcome.rounds).toHaveLength(1);
    expect(outcome.rounds[0].winnerSeat).toBe(1);
    expect(outcome.rounds[0].score).toBe(outcome.winnerScore);
    expect(outcome.rounds[0].dealerSeat).toBe(0); // dealer at the time of the hand
    expect(outcome.rounds[0].dealerStreak).toBe(0);

    // spec 1.6: non-dealer win -> dealer moves to (dealerSeat + 1) % 4, streak resets.
    expect(outcome.room.dealerSeat).toBe(1);
    expect(outcome.room.dealerStreak).toBe(0);
    expect(outcome.room.roundNumber).toBe(2);
  });
});
