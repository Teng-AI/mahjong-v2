// Pins deliberate rulings on edges the ported v1 suite does not cover.
// See the Parity Rulings section of plans/active/v1-parity/strategy.md.

import { canFormWinningHand } from '../tiles';

describe('ruling 5 (re-ruled by Teng 2026-07-22): golds substitute anywhere in a run', () => {
  // v1's checker could not place a gold BELOW the lowest real tile of a run
  // (8,9 + gold never completed 7-8-9). Teng re-ruled: follow the rules doc,
  // golds substitute for any tile. This is a deliberate DIVERGENCE from v1
  // code behavior.
  it('allows gold below the lowest real tile of a run (8,9 + gold as 7)', () => {
    // 4 exposed melds, hand of 5: pair of dots_2 + [bamboo_8, bamboo_9, gold]
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_8_0', 'bamboo_9_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(true);
  });

  it('allows gold in the middle of a run (7,9 + gold as 8)', () => {
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_7_0', 'bamboo_9_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(true);
  });

  it('allows gold above the run (6,7 + gold as 8)', () => {
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_6_0', 'bamboo_7_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(true);
  });

  it('still rejects impossible runs (8,9 + gold cannot be 9-10-11)', () => {
    // 1,3 in different suits + gold: no run exists across suits
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_1_0', 'dots_9_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(false);
  });
});
