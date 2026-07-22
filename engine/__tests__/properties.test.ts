// Property-based full-game simulation. Contract: design-engine-api.md,
// strategy.md Test Plan item 3 ("full-game simulation with random seeds
// never reaches an illegal state").
//
// Drives 25 seeded games end-to-end through the real transition functions
// (draw/discard/respondToCall/declareSelfDrawWin/legalActions), starting
// from a real initHand deal, and re-checks global invariants after EVERY
// successful transition. Since initHand and the transitions are throwing
// stubs at authoring time, every game here fails at the first initHand call
// with 'not implemented' -- these tests describe the target behavior and
// exercise it fully once M1 lands.

import { initHand } from '../deal';
import {
  draw,
  discard,
  respondToCall,
  declareSelfDrawWin,
  legalActions,
} from '../game';
import { generateAllTiles, shuffle, isBonusTile, isGoldTile, getTileType } from '../tiles';
import type { CallAction, EngineState, Result, Seat } from '../types';

const SEATS: Seat[] = [0, 1, 2, 3];
const DEAD_WALL = 16;
const STEP_CAP = 500;

/** Deterministic PRNG, seed -> [0,1) stream. Standard mulberry32. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function meldCount(state: EngineState, seat: Seat): number {
  return state.melds[seat].length;
}

/** Global invariants that must hold after every transition, in every phase. */
function assertInvariants(state: EngineState): void {
  // Tile conservation: hands + melds + bonus rows + discard pile + wall +
  // 1 exposedGold + 16 dead wall == 128, always.
  let total = 1 /* exposedGold */ + DEAD_WALL + state.wall.length + state.discardPile.length;
  for (const seat of SEATS) {
    total += state.hands[seat].length;
    total += state.bonusTiles[seat].length;
    for (const meld of state.melds[seat]) total += meld.tiles.length;
  }
  expect(total).toBe(128);

  // No wind/dragon ever sits in a concealed hand.
  for (const seat of SEATS) {
    for (const tile of state.hands[seat]) {
      expect(isBonusTile(tile)).toBe(false);
    }
  }

  // Hand-size consistency: 17 - 3m (holding the extra drawn tile, about to
  // act) or 16 - 3m (waiting on a draw), per seat's own meld count. Kong
  // melds hold 4 tiles but still only count as one meld toward this formula.
  for (const seat of SEATS) {
    const m = meldCount(state, seat);
    const len = state.hands[seat].length;
    expect([16 - 3 * m, 17 - 3 * m]).toContain(len);
  }
}

/**
 * One simulation step: draw when needed, self-draw win when legal, else
 * discard the first legal tile; in the calling phase, every unresponded
 * seat passes unless it can win.
 */
function policyStep(state: EngineState): Result {
  if (state.phase === 'calling') {
    const seat = SEATS.find((s) => state.pendingCalls?.[s] === 'waiting');
    if (seat === undefined) throw new Error('calling phase with no waiting seat');
    const actions = legalActions(state, seat);
    const action: CallAction = actions.call?.canWin ? 'win' : 'pass';
    return respondToCall(state, seat, action);
  }

  const seat = state.currentPlayerSeat;
  const actions = legalActions(state, seat);
  if (actions.canDraw) return draw(state, seat);
  if (actions.canSelfDrawWin) return declareSelfDrawWin(state, seat);

  const hand = state.hands[seat];
  const tile =
    hand.find(
      (t) =>
        !isGoldTile(t, state.goldTileType) &&
        getTileType(t) !== state.calledTypeThisTurn,
    ) ?? hand[0];
  return discard(state, seat, tile);
}

function runGame(seed: number): void {
  const rng = mulberry32(seed);
  const shuffled = shuffle(generateAllTiles(), rng);
  const initResult = initHand({ dealerSeat: (seed % 4) as Seat, dealerStreak: 0 }, shuffled);
  expect(initResult.ok).toBe(true);
  if (!initResult.ok) return;

  let state = initResult.state;
  assertInvariants(state);
  let lastSeq = state.seq;
  let step = 0;

  for (; step < STEP_CAP; step++) {
    if (state.phase === 'ended') break;
    const result = policyStep(state);
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    expect(result.state.seq).toBeGreaterThan(lastSeq);
    lastSeq = result.state.seq;
    state = result.state;
    assertInvariants(state);
  }

  expect(step).toBeLessThan(STEP_CAP);
  expect(state.phase).toBe('ended');
}

describe('property: 25 seeded full games never reach an illegal state', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  it.each(seeds)('seed %i', (seed) => {
    runGame(seed);
  });
});
