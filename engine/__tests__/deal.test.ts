// initHand() acceptance tests. Spec 1.2 (research-v1-spec.md) is ground truth.
//
// All scenarios use hand-crafted (not shuffled) 128-tile arrays so outcomes
// are deterministic: `craft(front)` places explicit tiles at the front of the
// array (controlling exactly what gets dealt / drawn) and fills the remainder
// with whatever's left of generateAllTiles(), in a fixed order.
//
// Dealing index math (derived from spec 1.2, dealerSeat = 0 in every scenario
// here so "round-robin from seat 0" and "dealer-first" coincide -- this
// sidesteps an unresolved spec ambiguity about whether round-robin dealing
// starts at seat 0 or at the dealer; see report):
//   indices 0..63   -- round robin deal, 16 passes x [seat0,seat1,seat2,seat3]
//                       (seat s gets indices s, s+4, s+8, ..., s+60)
//   index 64        -- dealer's 17th tile
//   index 65..      -- bonus-exposure replacement draws (if any), then the
//                       gold-flip draw(s), consumed front-to-back
//   last 16 indices of the 128-tile array -- dead wall, never drawn
//
// RED at authoring time: engine/deal.ts's initHand is a throwing stub
// ('not implemented'). These tests describe the target behavior.

import { generateAllTiles, isBonusTile, getTileType } from '../tiles';
import { initHand } from '../deal';
import type { Seat, TileId } from '../types';

/** Place `front` tiles first, fill the rest with whatever's left, in order. */
function craft(front: TileId[]): TileId[] {
  const all = generateAllTiles();
  const used = new Set(front);
  const rest = all.filter((t) => !used.has(t));
  const result = [...front, ...rest];
  expect(result).toHaveLength(128); // sanity: no duplicate/invalid ids in front
  return result;
}

const DEAD_WALL = 16;
const SEATS: Seat[] = [0, 1, 2, 3];

function assertOk(result: ReturnType<typeof initHand>): asserts result is {
  ok: true;
  state: any;
  events: any[];
} {
  if (!result.ok) throw new Error(`expected ok, got error: ${JSON.stringify((result as any).error)}`);
}

// ============================================
// STANDARD DEAL (no bonus tiles anywhere)
// ============================================

describe('initHand: standard deal', () => {
  // First 66 tiles of generateAllTiles() are all dots/bamboo suit tiles (winds
  // start at index 108), so this scenario naturally has zero bonus tiles in
  // any dealt hand or at the gold-flip position -- no crafting needed.
  const shuffled = generateAllTiles();

  it('deals 17 to the dealer, 16 to everyone else', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.hands[0]).toHaveLength(17);
    expect(result.state.hands[1]).toHaveLength(16);
    expect(result.state.hands[2]).toHaveLength(16);
    expect(result.state.hands[3]).toHaveLength(16);
  });

  it('starts in phase playing, current player the dealer, lastAction game_start', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.phase).toBe('playing');
    expect(result.state.currentPlayerSeat).toBe(0);
    expect(result.state.lastAction).toEqual({ type: 'game_start', playerSeat: 0 });
  });

  it('returns a fresh seq as a number', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(typeof result.state.seq).toBe('number');
  });

  it('flips the gold from the first non-bonus tile after the deal (index 65)', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    const expectedGold = shuffled[65];
    expect(result.state.exposedGold).toBe(expectedGold);
    expect(result.state.goldTileType).toBe(getTileType(expectedGold));
  });

  it('no hand contains a wind or dragon tile after setup', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    for (const seat of SEATS) {
      for (const tile of result.state.hands[seat]) {
        expect(isBonusTile(tile)).toBe(false);
      }
    }
  });

  it('conserves all 128 tiles: hands + melds + bonus rows + wall + exposedGold + 16 dead', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    const s = result.state;
    let total = 1 /* exposedGold */ + DEAD_WALL + s.wall.length;
    for (const seat of SEATS) {
      total += s.hands[seat].length;
      total += s.bonusTiles[seat].length;
      for (const meld of s.melds[seat]) total += meld.tiles.length;
    }
    expect(total).toBe(128);
  });

  it('wall length: 128 - 65 dealt - 16 dead - 1 exposedGold - 0 bonus = 46', () => {
    // NOTE: the M1 test-authoring brief said "47 after deal when no bonus
    // replacements"; that figure is the wall AFTER cutting the dead wall but
    // BEFORE the gold flip consumes its own tile (spec 1.2 step 4 vs step 6).
    // EngineState.wall is documented as post-setup and exposedGold is a
    // separate field "out of play", so the final wall must be one shorter.
    // Flagged in the report as a correction, not asserted as an open question.
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.wall.length).toBe(128 - 65 - DEAD_WALL - 1);
  });
});

// ============================================
// BONUS TILES DEALT TO A HAND (auto-exposed, dealer-first, with replacement)
// ============================================

describe('initHand: bonus tiles dealt into a hand', () => {
  // seat2 (index2 of the round-robin) is dealt a wind tile; it must be
  // auto-exposed to seat2's bonus row and replaced from the wall front
  // (index 65, consumed before the gold flip, which lands at index 66).
  const explicitFront: TileId[] = [
    'dots_1_0', 'dots_1_1', 'wind_east_0', 'dots_1_2', // pass 0: seat0,1,2,3
    'dots_2_0', 'dots_2_1', 'dots_2_2', 'dots_2_3', // pass 1
  ];
  // fill remaining round-robin passes (2..15) with plain, distinct suit tiles.
  // A single suit (36 tiles) isn't enough for the 56 filler slots needed, so
  // pool across all three suits, excluding tiles already spoken for above and
  // below (the three characters_*_0 tiles reserved for indices 64-66).
  const reserved = new Set([
    ...explicitFront,
    'characters_1_0',
    'characters_2_0',
    'characters_3_0',
  ]);
  const fillerPool = generateAllTiles().filter(
    (t) => (t.startsWith('dots_') || t.startsWith('bamboo_') || t.startsWith('characters_')) && !reserved.has(t),
  );
  const front: TileId[] = [...explicitFront];
  for (let i = 0; i < 14 * 4; i++) front.push(fillerPool[i]);
  front.push('characters_1_0'); // index64: dealer's 17th tile
  front.push('characters_2_0'); // index65: replacement for seat2's wind_east_0
  front.push('characters_3_0'); // index66: gold flip tile

  const shuffled = craft(front);

  it('exposes the bonus tile to the dealt seat\'s bonus row', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.bonusTiles[2]).toEqual(['wind_east_0']);
    expect(result.state.bonusTiles[0]).toEqual([]);
    expect(result.state.bonusTiles[1]).toEqual([]);
    expect(result.state.bonusTiles[3]).toEqual([]);
  });

  it('the replacement tile lands in the hand instead, wind_east_0 does not', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.hands[2]).not.toContain('wind_east_0');
    expect(result.state.hands[2]).toContain('characters_2_0');
    expect(result.state.hands[2]).toHaveLength(16);
  });

  it('the gold flip lands one position later than the no-bonus case', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.exposedGold).toBe('characters_3_0');
    expect(result.state.goldTileType).toBe('characters_3');
  });

  it('emits a bonus_exposed event for seat 2 during deal', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.events).toContainEqual({
      kind: 'bonus_exposed',
      seat: 2,
      tile: 'wind_east_0',
      during: 'deal',
    });
  });
});

// ============================================
// BONUS TILES HIT DURING GOLD FLIP -> DEALER'S bonus row
// ============================================

describe('initHand: bonus tile hit during the gold flip', () => {
  // Indices 0..64 (the clean no-bonus prefix of generateAllTiles()) deal
  // exactly as in the standard-deal scenario. index 65 is a wind tile (hit
  // during the flip, goes to the DEALER's row, not whoever's "current");
  // index 66 is the real gold candidate.
  const front = [...generateAllTiles().slice(0, 65), 'wind_south_0', 'characters_1_0'];
  const shuffled = craft(front);

  it('routes the flip-hit bonus tile to the dealer\'s row regardless of who dealt it', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.bonusTiles[0]).toEqual(['wind_south_0']);
    expect(result.state.bonusTiles[1]).toEqual([]);
    expect(result.state.bonusTiles[2]).toEqual([]);
    expect(result.state.bonusTiles[3]).toEqual([]);
  });

  it('the gold is the next non-bonus tile after the hit', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.exposedGold).toBe('characters_1_0');
    expect(result.state.goldTileType).toBe('characters_1');
  });

  it('emits a bonus_exposed event with during: "play" is NOT used here -- deal-phase flip stays "deal"', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.events).toContainEqual({
      kind: 'bonus_exposed',
      seat: 0,
      tile: 'wind_south_0',
      during: 'deal',
    });
  });
});

// ============================================
// THREE GOLDS INSTANT WIN AT DEAL
// ============================================

describe('initHand: Three Golds instant win', () => {
  // Non-dealer types (avoid dots_1/2, bamboo_1/2, characters_1/9, which are
  // reserved below for the three-golds holder).
  const junkTypes = [
    'dots_3', 'dots_4', 'dots_5', 'dots_6', 'dots_7', 'dots_8', 'dots_9',
    'bamboo_3', 'bamboo_4', 'bamboo_5', 'bamboo_6', 'bamboo_7', 'bamboo_8', 'bamboo_9',
    'characters_2', 'characters_3',
  ]; // 16 isolated types, no internal pairs/runs -> never a win, never tenpai

  const dealerHand = junkTypes.map((t) => `${t}_0`); // 16 for round robin
  const dealerExtra = `${junkTypes[0]}_3`; // dealer's 17th tile, distinct instance (0/1/2 taken by dealer/seat2/seat3)
  const seat2Hand = junkTypes.map((t) => `${t}_1`);
  const seat3Hand = junkTypes.slice(0, 16).map((t) => `${t}_2`);

  // seat1 holds all 3 wildcard copies of the type that will flip gold: 5
  // real pungs (15) + one lone tile of the target type (1) = 16.
  const seat1Hand = [
    'dots_1_0', 'dots_1_1', 'dots_1_2',
    'dots_2_0', 'dots_2_1', 'dots_2_2',
    'bamboo_1_0', 'bamboo_1_1', 'bamboo_1_2',
    'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
    'characters_1_0', 'characters_1_1', 'characters_1_2',
    'characters_9_0',
  ];

  const front: TileId[] = [];
  for (let pass = 0; pass < 16; pass++) {
    front[pass * 4 + 0] = dealerHand[pass];
    front[pass * 4 + 1] = seat1Hand[pass];
    front[pass * 4 + 2] = seat2Hand[pass];
    front[pass * 4 + 3] = seat3Hand[pass];
  }
  front[64] = dealerExtra;
  // index 65: the flip candidate must be a NON-bonus tile of the same type
  // seat1 is stacking -- characters_9's 3 remaining copies are 1,2,3; seat1
  // already holds copy 0, so flip copy 1.
  front[65] = 'characters_9_1';

  const shuffled = craft(front);

  it('seat 1 wins instantly holding all 3 gold copies', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.phase).toBe('ended');
    expect(result.state.endReason).toBe('win');
    expect(result.state.winner).not.toBeNull();
    expect(result.state.winner!.seat).toBe(1);
    expect(result.state.winner!.isThreeGolds).toBe(true);
    expect(result.state.winner!.isRobbingGold).toBe(false);
  });

  it('counts as a self-draw win with multiplier x2 and the +30 special', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.winner!.isSelfDraw).toBe(true);
    expect(result.state.winner!.score.multiplier).toBe(2);
    expect(result.state.winner!.score.threeGoldsBonus).toBe(30);
  });

  it('emits a won event', () => {
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.events.some((e) => e.kind === 'won')).toBe(true);
  });
});

// ============================================
// ROBBING THE GOLD: priority chain a > b > c, and turn-order among non-dealers
// ============================================

describe('initHand: Robbing the Gold', () => {
  it('(a) dealer\'s 17 already form a win with no swap -> dealer wins', () => {
    // Dealer: 5 pungs (15) + pair (2) = 17, complete regardless of gold type.
    const dealerHand = [
      'dots_1_0', 'dots_1_1', 'dots_1_2',
      'dots_2_0', 'dots_2_1', 'dots_2_2',
      'bamboo_1_0', 'bamboo_1_1', 'bamboo_1_2',
      'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
      'characters_1_0', 'characters_1_1', 'characters_1_2',
      'dots_3_0', 'dots_3_1', // pair
    ];
    // Junk (isolated, non-winning, non-tenpai-on-gold) hands for seats 1-3.
    const junkTypes = [
      'dots_4', 'dots_5', 'dots_6', 'dots_7', 'dots_8', 'dots_9',
      'bamboo_3', 'bamboo_4', 'bamboo_5', 'bamboo_6', 'bamboo_7', 'bamboo_8',
      'characters_2', 'characters_3', 'characters_4', 'characters_5',
    ]; // 16 types
    const seat1 = junkTypes.map((t) => `${t}_0`);
    const seat2 = junkTypes.map((t) => `${t}_1`);
    const seat3 = junkTypes.map((t) => `${t}_2`);

    const front: TileId[] = [];
    for (let pass = 0; pass < 16; pass++) {
      front[pass * 4 + 0] = dealerHand[pass];
      front[pass * 4 + 1] = seat1[pass];
      front[pass * 4 + 2] = seat2[pass];
      front[pass * 4 + 3] = seat3[pass];
    }
    front[64] = dealerHand[16]; // dealer's 17th (the pair's 2nd tile)
    front[65] = 'bamboo_9_0'; // gold flip target, unrelated to dealer's hand

    const shuffled = craft(front);
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.winner!.seat).toBe(0);
    expect(result.state.winner!.isRobbingGold).toBe(true);
    expect(result.state.winner!.isSelfDraw).toBe(true);
  });

  it('(b) non-dealer tenpai on the gold type takes the exposed gold and wins; closer seat wins on a tie', () => {
    // Dealer: junk (not a win). seat1 AND seat2 are both tenpai waiting on
    // the gold type (5 real pungs + a lone tile of the target type); seat1
    // is closer counter-clockwise from the dealer and must win, not seat2.
    const dealerJunk = [
      'dots_4_0', 'dots_5_0', 'dots_6_0', 'dots_7_0', 'dots_8_0', 'dots_9_0',
      'bamboo_3_0', 'bamboo_4_0', 'bamboo_5_0', 'bamboo_6_0', 'bamboo_7_0',
      'bamboo_8_0', 'characters_2_0', 'characters_3_0', 'characters_4_0',
      'characters_5_0', 'characters_6_0',
    ]; // 17 isolated types

    const tenpaiOnGold = (instanceOffset: number) => [
      `dots_1_${instanceOffset}`, `dots_1_${(instanceOffset + 1) % 4}`, `dots_1_${(instanceOffset + 2) % 4}`,
      `dots_2_${instanceOffset}`, `dots_2_${(instanceOffset + 1) % 4}`, `dots_2_${(instanceOffset + 2) % 4}`,
      `bamboo_1_${instanceOffset}`, `bamboo_1_${(instanceOffset + 1) % 4}`, `bamboo_1_${(instanceOffset + 2) % 4}`,
      `bamboo_2_${instanceOffset}`, `bamboo_2_${(instanceOffset + 1) % 4}`, `bamboo_2_${(instanceOffset + 2) % 4}`,
      `characters_1_${instanceOffset}`, `characters_1_${(instanceOffset + 1) % 4}`, `characters_1_${(instanceOffset + 2) % 4}`,
      'characters_9_0', // lone tile of the eventual gold type
    ];
    // seat1 and seat2 cannot BOTH hold "characters_9_0" -- only one physical
    // copy 0 exists. seat2 waits on the same type via a different lone copy,
    // and must use entirely different pung types/instances than seat1 (only
    // 4 physical copies of any tile exist) -- dots_5/6, bamboo_5/6,
    // characters_4 at instances 1-3 are untouched elsewhere in this fixture
    // (dealerJunk only claims instance _0 of those types).
    const seat1 = tenpaiOnGold(0);
    const seat2 = [
      'dots_5_1', 'dots_5_2', 'dots_5_3',
      'dots_6_1', 'dots_6_2', 'dots_6_3',
      'bamboo_5_1', 'bamboo_5_2', 'bamboo_5_3',
      'bamboo_6_1', 'bamboo_6_2', 'bamboo_6_3',
      'characters_4_1', 'characters_4_2', 'characters_4_3',
      'characters_9_1',
    ];
    const seat3 = [
      'dots_3_1', 'dots_3_2', 'dots_3_3', 'dots_4_1', 'dots_4_2', 'dots_4_3',
      'bamboo_3_1', 'bamboo_3_2', 'bamboo_3_3', 'bamboo_4_1', 'bamboo_4_2',
      'bamboo_4_3', 'characters_2_1', 'characters_2_2', 'characters_2_3',
      'characters_3_1',
    ]; // 16 isolated, unrelated -- not tenpai on characters_9

    const front: TileId[] = [];
    for (let pass = 0; pass < 16; pass++) {
      front[pass * 4 + 0] = dealerJunk[pass];
      front[pass * 4 + 1] = seat1[pass];
      front[pass * 4 + 2] = seat2[pass];
      front[pass * 4 + 3] = seat3[pass];
    }
    front[64] = dealerJunk[16];
    front[65] = 'characters_9_2'; // gold flip: the exposed instance itself

    const shuffled = craft(front);
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.winner!.seat).toBe(1);
    expect(result.state.winner!.isRobbingGold).toBe(true);
    expect(result.state.winner!.isSelfDraw).toBe(true);
    // the exposed gold instance joins the winner's revealed hand
    expect(result.state.winner!.hand).toContain('characters_9_2');
  });

  it('(c) dealer swap: replacing one non-gold tile in the dealer\'s hand with the exposed gold completes a win', () => {
    // A gold tile is a universal wildcard once flipped, so "swap Z for the
    // exposed gold completes a win" reduces to: removing Z leaves a tenpai
    // 16-tile hand (any wait shape -- gold fills it). Dealer holds 4 real
    // pungs + pair + a pung-WAIT (2 matching tiles short one) + 1 unrelated
    // odd tile Z. The wait is deliberately NOT on the gold's own type, so
    // there is no pre-flip wildcard leakage that would make this already a
    // win under case (a).
    const dealerHand = [
      'dots_1_0', 'dots_1_1', 'dots_1_2', // pung
      'dots_2_0', 'dots_2_1', 'dots_2_2', // pung
      'bamboo_1_0', 'bamboo_1_1', 'bamboo_1_2', // pung
      'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2', // pung
      'characters_1_0', 'characters_1_1', // pair
      'characters_2_0', 'characters_2_1', // pung-wait (needs a 3rd characters_2, or a gold)
      'characters_3_0', // odd tile Z -- not a gold type, removed on swap
    ];
    // Gold flips to dots_9: unrelated to every tile above, so it is purely a
    // wildcard here, not a type the dealer happens to hold copies of.
    const junkTypes = [
      'dots_3', 'dots_4', 'dots_5', 'dots_6', 'dots_7', 'dots_8',
      'bamboo_3', 'bamboo_4', 'bamboo_5', 'bamboo_6', 'bamboo_7', 'bamboo_8',
      'characters_4', 'characters_5', 'characters_6', 'characters_7',
    ]; // 16 isolated types, none of which is dots_9 or a dealer type
    const seat1 = junkTypes.map((t) => `${t}_0`);
    const seat2 = junkTypes.map((t) => `${t}_1`);
    const seat3 = junkTypes.map((t) => `${t}_2`);

    const front: TileId[] = [];
    for (let pass = 0; pass < 16; pass++) {
      front[pass * 4 + 0] = dealerHand[pass];
      front[pass * 4 + 1] = seat1[pass];
      front[pass * 4 + 2] = seat2[pass];
      front[pass * 4 + 3] = seat3[pass];
    }
    front[64] = dealerHand[16]; // dealer's 17th tile
    front[65] = 'dots_9_0'; // gold flip target

    const shuffled = craft(front);
    const result = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    assertOk(result);
    expect(result.state.winner!.seat).toBe(0);
    expect(result.state.winner!.isRobbingGold).toBe(true);
    // the swap is logged
    expect(result.events.some((e) => e.kind === 'gold_swapped' && e.seat === 0)).toBe(true);
  });

  // NOTE (report): a combined test proving (b) beats (c) when BOTH conditions
  // are simultaneously satisfiable was not constructed -- hand-crafting a
  // deal where a non-dealer is gold-type-tenpai AND the dealer independently
  // has a swap-completable hand, without either accidentally satisfying (a)
  // or Three Golds first, was not worth the determinism risk at this budget.
  // (a) vs (b) is covered above (dealer's already-complete hand pre-empts a
  // tenpai non-dealer); (b) vs (c) priority is asserted by the design doc's
  // stated order and by the b) test's isolation (seat3/dealer are junk, so
  // (c) never has a chance to fire there) but not exercised head-to-head.
});
