// scoreWin() acceptance tests. Spec 1.7 (research-v1-spec.md) is ground truth,
// including the per-win-path "quirk table" of which specials each path checks.
// scoreWin is a pure formula over its inputs: it trusts the caller already
// validated the win shape, so hands here are hand-crafted for deterministic
// component counts rather than run through canFormWinningHand.
//
// RED at authoring time: engine/score.ts's scoreWin is a throwing stub
// ('not implemented'). These tests describe the target behavior and will
// turn green once score.ts is implemented.

import { scoreWin } from '../score';
import type { Meld, ScoreInput, TileId } from '../types';

const GOLD = 'characters_9'; // gold type unused by default hands below

// 5 pungs across mixed suits + a pair: 17 concealed tiles, 0 melds, 0 golds,
// 0 bonus tiles. Deliberately mixed-suit so All One Suit never accidentally
// triggers, and 0 bonus/0 kong means No Bonus/Gang (+15) always applies.
function baseHand(): TileId[] {
  return [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
    'characters_3_0', 'characters_3_1', 'characters_3_2',
    'dots_4_0', 'dots_4_1', 'dots_4_2',
    'bamboo_5_0', 'bamboo_5_1', 'bamboo_5_2',
    'dots_6_0', 'dots_6_1', // pair
  ];
}

// Same shape but one suit throughout (dots): triggers All One Suit.
function allOneSuitHand(): TileId[] {
  return [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'dots_2_0', 'dots_2_1', 'dots_2_2',
    'dots_3_0', 'dots_3_1', 'dots_3_2',
    'dots_4_0', 'dots_4_1', 'dots_4_2',
    'dots_5_0', 'dots_5_1', 'dots_5_2',
    'dots_6_0', 'dots_6_1', // pair
  ];
}

// 5 non-gold pungs (15 tiles, mixed suit) + a pair of gold (2 tiles) = 17.
// Golden Pair: exactly 2 golds, rest all real sets, no wildcard use.
function goldenPairHand(goldType: string): TileId[] {
  return [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
    'characters_3_0', 'characters_3_1', 'characters_3_2',
    'dots_4_0', 'dots_4_1', 'dots_4_2',
    'bamboo_5_0', 'bamboo_5_1', 'bamboo_5_2',
    `${goldType}_0`, `${goldType}_1`, // gold pair
  ];
}

// 4 mixed-suit pungs + pair (14 tiles), meant to pair with one extra meld
// (kong) passed separately: 17 - 3*1 = 14 concealed tiles.
function handWithOneMeld(): TileId[] {
  return [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
    'characters_3_0', 'characters_3_1', 'characters_3_2',
    'dots_4_0', 'dots_4_1', 'dots_4_2',
    'bamboo_6_0', 'bamboo_6_1', // pair
  ];
}

function concealedKong(type: string): Meld {
  return {
    type: 'kong',
    tiles: [`${type}_0`, `${type}_1`, `${type}_2`, `${type}_3`],
    isConcealed: true,
  };
}

function exposedKong(type: string): Meld {
  return {
    type: 'kong',
    tiles: [`${type}_0`, `${type}_1`, `${type}_2`, `${type}_3`],
    isConcealed: false,
  };
}

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    hand: baseHand(),
    melds: [],
    bonusTiles: [],
    goldTileType: GOLD,
    isDealer: false,
    dealerStreak: 0,
    winPath: 'self_draw',
    ...overrides,
  };
}

// ============================================
// SUBTOTAL COMPONENTS (individually)
// ============================================

describe('scoreWin subtotal components', () => {
  it('base is always 1', () => {
    const result = scoreWin(baseInput());
    expect(result.base).toBe(1);
  });

  it('scores +1 per exposed bonus tile', () => {
    const result = scoreWin(
      baseInput({ bonusTiles: ['wind_east_0', 'dragon_red_0', 'wind_south_0'] }),
    );
    expect(result.bonusTiles).toBe(3);
  });

  it('zero bonus tiles scores 0', () => {
    const result = scoreWin(baseInput({ bonusTiles: [] }));
    expect(result.bonusTiles).toBe(0);
  });

  it('scores +1 per gold copy physically in the winning hand', () => {
    const hand = [...baseHand()];
    hand[0] = 'dots_9_3'; // swap one concealed tile for a gold-typed tile
    const result = scoreWin(baseInput({ hand, goldTileType: 'dots_9' }));
    expect(result.golds).toBe(1);
  });

  it('two gold copies in hand score +2', () => {
    const hand = goldenPairHand('dots_9');
    const result = scoreWin(baseInput({ hand, goldTileType: 'dots_9' }));
    expect(result.golds).toBe(2);
  });

  it('concealed kong scores +2', () => {
    const result = scoreWin(
      baseInput({ hand: handWithOneMeld(), melds: [concealedKong('dots_7')] }),
    );
    expect(result.concealedKongBonus).toBe(2);
  });

  it('exposed kong scores +1', () => {
    const result = scoreWin(
      baseInput({ hand: handWithOneMeld(), melds: [exposedKong('dots_7')] }),
    );
    expect(result.exposedKongBonus).toBe(1);
  });

  it('multiple kongs stack: 1 concealed + 1 exposed = +3', () => {
    const hand = [
      'dots_1_0', 'dots_1_1', 'dots_1_2',
      'bamboo_2_0', 'bamboo_2_1', // pair
    ];
    const result = scoreWin(
      baseInput({ hand, melds: [concealedKong('dots_7'), exposedKong('dots_8')] }),
    );
    expect(result.concealedKongBonus).toBe(2);
    expect(result.exposedKongBonus).toBe(1);
  });

  it('dealer streak bonus applies to a dealer, banked value passed straight through', () => {
    const result = scoreWin(baseInput({ isDealer: true, dealerStreak: 2 }));
    expect(result.dealerStreakBonus).toBe(2);
  });

  it('non-dealer never gets a streak bonus, regardless of dealerStreak value', () => {
    const result = scoreWin(baseInput({ isDealer: false, dealerStreak: 5 }));
    expect(result.dealerStreakBonus).toBe(0);
  });
});

// ============================================
// DEALER STREAK PROGRESSION (ruling 1)
// ============================================

describe('scoreWin dealer streak progression (ruling 1)', () => {
  it('first consecutive dealer win pays +0 (streak banked before this hand is 0)', () => {
    const result = scoreWin(baseInput({ isDealer: true, dealerStreak: 0 }));
    expect(result.dealerStreakBonus).toBe(0);
  });

  it('second consecutive dealer win pays +1', () => {
    const result = scoreWin(baseInput({ isDealer: true, dealerStreak: 1 }));
    expect(result.dealerStreakBonus).toBe(1);
  });

  it('third consecutive dealer win pays +2 (not +3 -- the doc example is rejected)', () => {
    const result = scoreWin(baseInput({ isDealer: true, dealerStreak: 2 }));
    expect(result.dealerStreakBonus).toBe(2);
  });
});

// ============================================
// MULTIPLIER
// ============================================

describe('scoreWin multiplier', () => {
  it('self-draw is always x2, even with zero specials applying', () => {
    // Disable No Bonus/Gang by adding a bonus tile; mixed-suit hand keeps
    // Golden Pair and All One Suit off.
    const result = scoreWin(
      baseInput({ winPath: 'self_draw', bonusTiles: ['wind_east_0'] }),
    );
    expect(result.multiplier).toBe(2);
  });

  it('discard win is x1 when no special applies', () => {
    const result = scoreWin(
      baseInput({ winPath: 'discard', bonusTiles: ['wind_east_0'] }),
    );
    expect(result.multiplier).toBe(1);
  });

  it('discard win is x2 when ANY special applies (here, No Bonus/Gang)', () => {
    const result = scoreWin(baseInput({ winPath: 'discard', bonusTiles: [] }));
    expect(result.multiplier).toBe(2);
    expect(result.noBonusBonus).toBe(15);
  });

  it('three golds is always x2', () => {
    const result = scoreWin(baseInput({ winPath: 'three_golds' }));
    expect(result.multiplier).toBe(2);
  });

  it('robbing the gold is always x2', () => {
    const result = scoreWin(baseInput({ winPath: 'robbing_gold' }));
    expect(result.multiplier).toBe(2);
  });
});

// ============================================
// SPECIALS
// ============================================

describe('scoreWin specials', () => {
  it('No Bonus/Gang +15: zero bonus tiles AND zero kongs, golds allowed', () => {
    const hand = [...baseHand()];
    hand[0] = 'dots_9_3';
    const result = scoreWin(
      baseInput({ hand, goldTileType: 'dots_9', bonusTiles: [], melds: [] }),
    );
    expect(result.noBonusBonus).toBe(15);
  });

  it('No Bonus/Gang does not apply with a bonus tile present', () => {
    const result = scoreWin(baseInput({ bonusTiles: ['wind_east_0'] }));
    expect(result.noBonusBonus).toBeUndefined();
  });

  it('No Bonus/Gang does not apply with a kong present', () => {
    const result = scoreWin(
      baseInput({ hand: handWithOneMeld(), melds: [exposedKong('dots_7')] }),
    );
    expect(result.noBonusBonus).toBeUndefined();
  });

  it('Three Golds +30 on the three_golds path', () => {
    const result = scoreWin(baseInput({ winPath: 'three_golds' }));
    expect(result.threeGoldsBonus).toBe(30);
  });

  it('Robbing the Gold +30 on the robbing_gold path', () => {
    const result = scoreWin(baseInput({ winPath: 'robbing_gold' }));
    expect(result.robbingGoldBonus).toBe(30);
  });

  it('Golden Pair +50: exactly 2 golds forming the pair, rest all real sets', () => {
    const hand = goldenPairHand('dots_9');
    const result = scoreWin(
      baseInput({ hand, goldTileType: 'dots_9', winPath: 'self_draw' }),
    );
    expect(result.goldenPairBonus).toBe(50);
  });

  it('All One Suit +100: every hand + meld tile one suit, golds ignored', () => {
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), winPath: 'self_draw' }),
    );
    expect(result.allOneSuitBonus).toBe(100);
  });

  it('specials stack: All One Suit + No Bonus/Gang together', () => {
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), winPath: 'self_draw', bonusTiles: [] }),
    );
    expect(result.allOneSuitBonus).toBe(100);
    expect(result.noBonusBonus).toBe(15);
    // subtotal(1) x multiplier(2) + 100 + 15
    expect(result.total).toBe(1 * 2 + 100 + 15);
  });
});

// ============================================
// QUIRK TABLE: which specials each win path checks
// ============================================

describe('scoreWin per-win-path quirk table', () => {
  it('three_golds checks NO other specials, even on a qualifying hand', () => {
    // all-one-suit, zero bonus, zero kong hand would trigger All One Suit and
    // No Bonus/Gang on self_draw/discard -- three_golds must not check them.
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), bonusTiles: [], winPath: 'three_golds' }),
    );
    expect(result.threeGoldsBonus).toBe(30);
    expect(result.allOneSuitBonus).toBeUndefined();
    expect(result.noBonusBonus).toBeUndefined();
    expect(result.goldenPairBonus).toBeUndefined();
  });

  it('robbing_gold checks Golden Pair and No Bonus/Gang', () => {
    const hand = goldenPairHand('dots_9');
    const result = scoreWin(
      baseInput({ hand, goldTileType: 'dots_9', bonusTiles: [], winPath: 'robbing_gold' }),
    );
    expect(result.goldenPairBonus).toBe(50);
    expect(result.noBonusBonus).toBe(15);
  });

  it('robbing_gold does NOT check All One Suit even on an all-one-suit hand', () => {
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), winPath: 'robbing_gold' }),
    );
    expect(result.allOneSuitBonus).toBeUndefined();
  });

  it('robbing_gold counts NO kong bonuses even if melds somehow contain a kong', () => {
    const result = scoreWin(
      baseInput({
        hand: handWithOneMeld(),
        melds: [exposedKong('dots_7')],
        winPath: 'robbing_gold',
      }),
    );
    expect(result.exposedKongBonus).toBe(0);
    expect(result.concealedKongBonus).toBe(0);
  });

  it('self_draw checks Golden Pair, No Bonus/Gang, All One Suit', () => {
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), bonusTiles: [], winPath: 'self_draw' }),
    );
    expect(result.allOneSuitBonus).toBe(100);
    expect(result.noBonusBonus).toBe(15);
  });

  it('discard checks Golden Pair, No Bonus/Gang, All One Suit', () => {
    const result = scoreWin(
      baseInput({ hand: allOneSuitHand(), bonusTiles: [], winPath: 'discard' }),
    );
    expect(result.allOneSuitBonus).toBe(100);
    expect(result.noBonusBonus).toBe(15);
  });
});

// ============================================
// TOTAL = subtotal x multiplier + specials
// ============================================

describe('scoreWin total composition', () => {
  it('composes subtotal x multiplier + specials for a plain self-draw hand', () => {
    const result = scoreWin(baseInput({ winPath: 'self_draw' }));
    // subtotal = base(1) + bonus(0) + golds(0) + kongs(0) + streak(0) = 1
    expect(result.subtotal).toBe(1);
    expect(result.multiplier).toBe(2);
    expect(result.noBonusBonus).toBe(15); // 0 bonus, 0 kong
    expect(result.total).toBe(1 * 2 + 15);
  });

  it('composes a richer hand: bonus tiles + gold + exposed kong + dealer streak', () => {
    const hand = [...handWithOneMeld()];
    hand[0] = 'dots_9_3';
    const result = scoreWin(
      baseInput({
        hand,
        goldTileType: 'dots_9',
        bonusTiles: ['wind_east_0', 'wind_south_0'],
        melds: [exposedKong('dots_7')],
        isDealer: true,
        dealerStreak: 1,
        winPath: 'discard',
      }),
    );
    // subtotal = base(1) + bonus(2) + golds(1) + exposedKong(1) + streak(1) = 6
    expect(result.subtotal).toBe(6);
    // bonus tiles present -> No Bonus/Gang does not apply; mixed suit, no
    // golden pair -> no specials apply on this discard win -> multiplier x1
    expect(result.multiplier).toBe(1);
    expect(result.total).toBe(6);
  });
});
