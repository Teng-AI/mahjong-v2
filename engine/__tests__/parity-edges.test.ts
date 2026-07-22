// Pins v1-code-parity behavior on edges the ported suite does not cover.
// These are DELIBERATE parity choices, not oversights. See the Parity Rulings
// section of plans/active/v1-parity/strategy.md.

import { canFormWinningHand } from '../tiles';

describe('parity: gold wildcard chow placement (ruling 5)', () => {
  // v1's backtracker only forms chows with the smallest unresolved tile in the
  // LOW slot (value <= 7), so a gold can never stand in for a tile BELOW the
  // lowest real tile of a run: (gold-as-7, 8, 9) is not a win in v1 and stays
  // not-a-win here. The rules doc ("gold substitutes for any tile") disagrees;
  // parity = code behavior. Flip these expectations only on a new ruling.
  it('does not allow gold below the lowest real tile of a run (8,9 + gold as 7)', () => {
    // 4 exposed melds, hand of 5: pair of dots_2 + [bamboo_8, bamboo_9, gold]
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_8_0', 'bamboo_9_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(false);
  });

  it('allows the equivalent shape with gold ABOVE the run (6,7 + gold as 8)', () => {
    const hand = ['dots_2_0', 'dots_2_1', 'bamboo_6_0', 'bamboo_7_0', 'characters_5_0'];
    expect(canFormWinningHand(hand, 'characters_5', 4)).toBe(true);
  });
});
