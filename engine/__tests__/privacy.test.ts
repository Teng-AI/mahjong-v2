// Privacy/redaction acceptance tests. Contract: design-engine-api.md
// "Redaction", strategy.md Test Plan item 5 ("seat A's query result contains
// no seat B hand tiles in any phase").
//
// Drives one seeded game through several states (fresh deal, mid-play,
// calling, ended) using the real transition functions, and at each captured
// state asserts JSON.stringify(viewFor(state, seat)) never contains a tile
// id belonging to another seat's hand or to the wall, and that
// spectatorView never contains any hand tile id. Once a hand ends with a
// winner, the winner's full hand is an intentional exception (spec: winner
// reveal). A final hand-crafted-state test pins the concealed-kong-hiding
// rule from the MeldView doc comment in types.ts directly (independent of
// initHand, since that scenario needs a very specific meld shape).
//
// initHand/draw/discard/respondToCall/declareSelfDrawWin/legalActions/
// viewFor/spectatorView are all throwing stubs at authoring time, so the
// driven-game test fails at the first initHand call with 'not implemented'.
// The hand-crafted-state test fails at the first viewFor call the same way.
// These tests describe target behavior and run for real once M1 lands.

import { initHand } from '../deal';
import { draw, discard, respondToCall, declareSelfDrawWin, legalActions } from '../game';
import { viewFor, spectatorView } from '../view';
import { generateAllTiles, shuffle, isGoldTile, getTileType } from '../tiles';
import type { CallAction, EngineState, Meld, Result, Seat, TileId } from '../types';

const SEATS: Seat[] = [0, 1, 2, 3];
const STEP_CAP = 500;

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
      (t) => !isGoldTile(t, state.goldTileType) && getTileType(t) !== state.calledTypeThisTurn,
    ) ?? hand[0];
  return discard(state, seat, tile);
}

/** Assert no view for any seat leaks another seat's hand tiles or the wall. */
function checkNoLeak(state: EngineState, label: string): void {
  for (const seat of SEATS) {
    const json = JSON.stringify(viewFor(state, seat));
    // Own hand is fine, own concealed kong is fine -- only check OTHER seats.
    for (const otherSeat of SEATS) {
      if (otherSeat === seat) continue;
      const revealed = state.phase === 'ended' && state.winner?.seat === otherSeat;
      if (revealed) continue; // winner reveal is intentional
      for (const tile of state.hands[otherSeat]) {
        expect(json, `${label}: seat ${seat} view leaked seat ${otherSeat} hand tile ${tile}`).not.toContain(
          `"${tile}"`,
        );
      }
    }
    for (const tile of state.wall) {
      expect(json, `${label}: seat ${seat} view leaked a wall tile ${tile}`).not.toContain(`"${tile}"`);
    }
    // wallCount, not wall contents, is how wall size is exposed.
    expect(json).toContain('wallCount');
  }

  const specJson = JSON.stringify(spectatorView(state));
  for (const seat of SEATS) {
    const revealed = state.phase === 'ended' && state.winner?.seat === seat;
    if (revealed) continue;
    for (const tile of state.hands[seat]) {
      expect(specJson, `${label}: spectator view leaked seat ${seat} hand tile ${tile}`).not.toContain(
        `"${tile}"`,
      );
    }
  }
  for (const tile of state.wall) {
    expect(specJson, `${label}: spectator view leaked a wall tile ${tile}`).not.toContain(`"${tile}"`);
  }
}

describe('privacy: no hand-tile or wall leakage across a driven game', () => {
  it('fresh deal, mid-play, calling, and ended states never leak', () => {
    const rng = mulberry32(42);
    const shuffled = shuffle(generateAllTiles(), rng);
    const initResult = initHand({ dealerSeat: 0, dealerStreak: 0 }, shuffled);
    expect(initResult.ok).toBe(true);
    if (!initResult.ok) return;

    let state = initResult.state;
    checkNoLeak(state, 'fresh deal');

    let sawMidPlay = false;
    let sawCalling = false;

    for (let step = 0; step < STEP_CAP && state.phase !== 'ended'; step++) {
      const result = policyStep(state);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;
      checkNoLeak(state, `step ${step} (phase ${state.phase})`);
      if (state.phase === 'playing' && step > 2) sawMidPlay = true;
      if (state.phase === 'calling') sawCalling = true;
    }

    checkNoLeak(state, 'ended');
    expect(state.phase).toBe('ended');
    expect(sawMidPlay).toBe(true);
    expect(sawCalling).toBe(true);

    if (state.winner) {
      // Winner reveal: the winner's own seat's view must show the full hand.
      const winnerView = viewFor(state, state.winner.seat);
      expect(winnerView.winner?.hand).toEqual(state.winner.hand);
    }
  });
});

describe('privacy: concealed kong meld tiles are hidden from other seats', () => {
  // Hand-crafted independent of initHand: seat 0 holds a concealed kong,
  // seat 1 is a bystander. Per types.ts's MeldView doc comment, the meld's
  // tiles are hidden ([] + hidden: true) from every seat except its own,
  // including after the hand ends -- v1 parity, a concealed Gang's type is
  // never revealed even at hand end.
  function stateWithConcealedKong(phase: EngineState['phase']): EngineState {
    const concealedKongMeld: Meld = {
      type: 'kong',
      tiles: ['dots_1_0', 'dots_1_1', 'dots_1_2', 'dots_1_3'],
      isConcealed: true,
    };
    const hands: Record<Seat, TileId[]> = { 0: [], 1: [], 2: [], 3: [] };
    const melds: Record<Seat, Meld[]> = { 0: [concealedKongMeld], 1: [], 2: [], 3: [] };
    return {
      seq: 5,
      phase,
      dealerSeat: 0,
      currentPlayerSeat: 0,
      goldTileType: 'characters_9',
      exposedGold: 'characters_9_3',
      wall: ['bamboo_1_0'],
      hands,
      melds,
      bonusTiles: { 0: [], 1: [], 2: [], 3: [] },
      discardPile: [],
      lastAction: { type: 'kong', playerSeat: 0, tileType: 'dots_1' },
      previousAction: null,
      pendingCalls: null,
      pendingChow: null,
      calledTypeThisTurn: null,
      winner: null,
      endReason: null,
    };
  }

  it('hides the meld tiles from other seats in "playing"', () => {
    const state = stateWithConcealedKong('playing');
    const otherView = viewFor(state, 1);
    expect(otherView.melds[0][0]).toMatchObject({ tiles: [], hidden: true });
  });

  it('reveals the meld tiles to the owning seat', () => {
    const state = stateWithConcealedKong('playing');
    const ownView = viewFor(state, 0);
    expect(ownView.melds[0][0].tiles).toEqual([
      'dots_1_0',
      'dots_1_1',
      'dots_1_2',
      'dots_1_3',
    ]);
  });

  it('stays hidden from other seats even after the hand ends', () => {
    const state = stateWithConcealedKong('ended');
    const otherView = viewFor(state, 1);
    expect(otherView.melds[0][0]).toMatchObject({ tiles: [], hidden: true });
  });

  it('spectatorView also hides it', () => {
    const state = stateWithConcealedKong('playing');
    const spec = spectatorView(state);
    expect(spec.melds[0][0]).toMatchObject({ tiles: [], hidden: true });
  });
});
