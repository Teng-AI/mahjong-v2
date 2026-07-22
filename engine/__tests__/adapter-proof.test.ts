// Adapter proof (design-engine-api.md): 6 tests ported verbatim from v1's
// suites, spanning tiles/game/settle, to verify the API shape before the mass
// port. Bodies are copied from v1; only imports changed. These duplicate tests
// that will arrive in the full ported files; this file gets DELETED when
// tiles.test.ts / game.test.ts / settle.test.ts land.

import { generateAllTiles, getTileType, canPung } from '../tiles';
import { needsToDraw } from '../game';
import { calculateNetPositions } from '../settle';
import type { GameRound, TileId, TileType } from '../types';

describe('generateAllTiles (proof)', () => {
  it('should generate exactly 128 tiles', () => {
    const tiles = generateAllTiles();
    expect(tiles.length).toBe(128);
  });
});

describe('getTileType (proof)', () => {
  it('should extract type from suit tile', () => {
    expect(getTileType('dots_5_2')).toBe('dots_5');
    expect(getTileType('bamboo_1_0')).toBe('bamboo_1');
    expect(getTileType('characters_9_3')).toBe('characters_9');
  });
});

describe('canPung (proof)', () => {
  const goldType: TileType = 'dots_5';

  it('should return true when player has 2 matching tiles', () => {
    const hand: TileId[] = ['dots_1_0', 'dots_1_1', 'dots_2_0'];
    const discard: TileId = 'dots_1_2';
    expect(canPung(hand, discard, goldType)).toBe(true);
  });

  it('should not count gold tiles in hand for pung', () => {
    // Hand has 1 regular dots_1 and 1 gold (dots_5)
    // Gold cannot be used in calls
    const hand: TileId[] = ['dots_1_0', 'dots_5_0', 'dots_2_0'];
    const discard: TileId = 'dots_1_1';
    expect(canPung(hand, discard, goldType)).toBe(false);
  });
});

describe('needsToDraw (proof)', () => {
  it('should return true after opponent discards', () => {
    const gameState = {
      phase: 'playing',
      currentPlayerSeat: 1,
      dealerSeat: 0,
      wall: [],
      discardPile: [],
      goldTileType: 'dots_5',
      exposedGold: 'dots_5_0',
      pendingCalls: null,
      winner: null,
      lastAction: { type: 'discard', playerSeat: 0, tileType: 'dots_1' },
      previousAction: null,
    } as const;
    expect(needsToDraw(gameState)).toBe(true);
  });
});

describe('calculateNetPositions (proof)', () => {
  it('should calculate winner gains (score x 3) and loser losses (score each)', () => {
    const rounds: GameRound[] = [
      { winnerSeat: 0, score: 10, dealerSeat: 0, dealerStreak: 0 },
    ];
    const result = calculateNetPositions(rounds);

    // Winner gets score x 3 = 30
    expect(result.seat0).toBe(30);
    // Each loser pays score = -10
    expect(result.seat1).toBe(-10);
    expect(result.seat2).toBe(-10);
    expect(result.seat3).toBe(-10);
  });
});
