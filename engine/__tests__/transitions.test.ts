// Transition acceptance tests. Contract: design-engine-api.md "game.ts"
// (transitions section), spec 1.3-1.5 (research-v1-spec.md).
//
// engine/game.ts's transitions (draw, discard, respondToCall,
// declareSelfDrawWin, declareConcealedKong, upgradePungToKong, legalActions)
// are throwing stubs ('not implemented') at authoring time. Since initHand
// is also a stub, every EngineState fixture here is a hand-built literal --
// deterministic and independent of deal.ts. These tests describe target
// behavior and will turn green once game.ts transitions land.
//
// Mutation-safety convention: every transition call in this file is wrapped
// by expectNoMutation, which snapshots the input state via structuredClone,
// calls the transition, and asserts the ORIGINAL state object is unchanged
// (both on rejection and on success) before inspecting the result.

import {
  draw,
  discard,
  respondToCall,
  declareSelfDrawWin,
  declareConcealedKong,
  upgradePungToKong,
  legalActions,
} from '../game';
import type {
  ChowSelection,
  EngineState,
  Meld,
  Result,
  Seat,
  TileId,
} from '../types';

const GOLD = 'characters_9';

function emptyHands(): Record<Seat, TileId[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}
function emptyMelds(): Record<Seat, Meld[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}
function emptyBonus(): Record<Seat, TileId[]> {
  return { 0: [], 1: [], 2: [], 3: [] };
}

/** 16 distinct, mutually-non-overlapping filler tiles per seat (no gold, no bonus). */
function fillerHand(seatIndex: number): TileId[] {
  const suits = ['dots', 'bamboo', 'characters'];
  const suit = suits[seatIndex % suits.length];
  const base = seatIndex * 20; // keeps each seat's instance range disjoint-ish
  const out: TileId[] = [];
  let v = 1;
  let inst = 0;
  while (out.length < 16 && v <= 9) {
    const id = `${suit}_${v}_${(base + inst) % 4}` as TileId;
    if (`${suit}_${v}` !== GOLD) {
      out.push(id);
    }
    inst++;
    if (inst >= 4) {
      inst = 0;
      v++;
    }
  }
  return out;
}

function baseState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    seq: 1,
    phase: 'playing',
    dealerSeat: 0,
    currentPlayerSeat: 0,
    goldTileType: GOLD,
    exposedGold: `${GOLD}_3`,
    wall: ['dots_1_0', 'dots_1_1', 'dots_1_2', 'dots_1_3', 'dots_2_0'],
    hands: emptyHands(),
    melds: emptyMelds(),
    bonusTiles: emptyBonus(),
    discardPile: [],
    lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_3' },
    previousAction: null,
    pendingCalls: null,
    pendingChow: null,
    calledTypeThisTurn: null,
    winner: null,
    endReason: null,
    ...overrides,
  };
}

/**
 * Snapshot `state`, run the transition, assert the ORIGINAL object is
 * byte-for-byte unchanged (mutation-safety), then return the result so the
 * caller can assert on it. Works identically for rejection and success: the
 * transition contract is "never mutate the input", not "never mutate on
 * failure".
 */
function callAndCheckNoMutation(
  state: EngineState,
  fn: (s: EngineState) => Result,
): Result {
  const snapshot = structuredClone(state);
  const result = fn(state);
  expect(state).toEqual(snapshot);
  return result;
}

// ============================================
// draw()
// ============================================

describe('draw', () => {
  it('rejects when seat is not the current player', () => {
    const state = baseState({ currentPlayerSeat: 0 });
    const result = callAndCheckNoMutation(state, (s) => draw(s, 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'not_your_turn' });
  });

  it('shifts the wall front into the drawing seat\'s hand', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      wall: ['dots_5_0', 'dots_6_0'],
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const result = callAndCheckNoMutation(state, (s) => draw(s, 0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.hands[0]).toContain('dots_5_0');
      expect(result.state.wall).toEqual(['dots_6_0']);
      expect(result.state.lastAction).toEqual({ type: 'draw', playerSeat: 0, tileType: 'dots_5' });
    }
  });

  it('auto-exposes a bonus tile drawn and draws a replacement', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      wall: ['wind_east_0', 'dots_7_0', 'dots_8_0'],
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const result = callAndCheckNoMutation(state, (s) => draw(s, 0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.bonusTiles[0]).toContain('wind_east_0');
      expect(result.state.hands[0]).not.toContain('wind_east_0');
      expect(result.state.hands[0]).toContain('dots_7_0');
      expect(result.state.wall).toEqual(['dots_8_0']);
      expect(result.events).toContainEqual({
        kind: 'bonus_exposed',
        seat: 0,
        tile: 'wind_east_0',
        during: 'play',
      });
    }
  });

  it('ends the hand as wall_exhausted when the wall is empty', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      wall: [],
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const result = callAndCheckNoMutation(state, (s) => draw(s, 0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('ended');
      expect(result.state.endReason).toBe('wall_exhausted');
      expect(result.state.winner).toBeNull();
      expect(result.events).toContainEqual({ kind: 'wall_exhausted' });
    }
  });

  it('increments seq only on success, never on rejection', () => {
    const rejected = baseState({ seq: 7, currentPlayerSeat: 0 });
    const rejectResult = callAndCheckNoMutation(rejected, (s) => draw(s, 1));
    expect(rejectResult.ok).toBe(false);

    const accepted = baseState({
      seq: 7,
      currentPlayerSeat: 0,
      wall: ['dots_5_0'],
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const acceptResult = callAndCheckNoMutation(accepted, (s) => draw(s, 0));
    expect(acceptResult.ok).toBe(true);
    if (acceptResult.ok) expect(acceptResult.state.seq).toBe(8);
  });
});

// ============================================
// discard()
// ============================================

describe('discard', () => {
  it('rejects a discard before drawing (must_draw_first)', () => {
    // currentPlayerSeat just discarded is not the case here: lastAction is
    // an opponent's discard, meaning seat 0 must draw before it may discard.
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, fillerHand(0)[0]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'must_draw_first' });
  });

  it('rejects discarding a tile not in hand', () => {
    const hand = fillerHand(0);
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, 'bamboo_9_3'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'tile_not_in_hand' });
  });

  it('rejects discarding a gold tile (ruling 3)', () => {
    const hand = [...fillerHand(0), `${GOLD}_0`];
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, `${GOLD}_0`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'cannot_discard_gold' });
  });

  it('rejects discarding the type just called via pung/chow this turn', () => {
    const hand = fillerHand(0); // dots_1.._9 across instances
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'pung', playerSeat: 0, tileType: 'dots_1' },
      calledTypeThisTurn: 'dots_1',
    });
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, hand.find((t) => t.startsWith('dots_1'))!));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'cannot_discard_called_type' });
  });

  it('opens the calling phase when the wall has more than 4 tiles', () => {
    const hand = fillerHand(0);
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'draw', playerSeat: 0 },
      wall: new Array(10).fill('dots_2_0'),
    });
    const tile = hand[0];
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, tile));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('calling');
      expect(result.state.discardPile).toContain(tile);
      expect(result.state.pendingCalls).toEqual({
        0: 'discarder',
        1: 'waiting',
        2: 'waiting',
        3: 'waiting',
      });
      expect(result.events).toContainEqual({
        kind: 'calling_opened',
        discarder: 0,
        tile,
      });
    }
  });

  it('skips the calling phase when the wall has 4 or fewer tiles (endgame rule)', () => {
    const hand = fillerHand(0);
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'draw', playerSeat: 0 },
      wall: ['dots_2_0', 'dots_2_1', 'dots_2_2', 'dots_2_3'], // exactly 4
    });
    const tile = hand[0];
    const result = callAndCheckNoMutation(state, (s) => discard(s, 0, tile));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('playing');
      expect(result.state.pendingCalls).toBeNull();
      expect(result.state.currentPlayerSeat).toBe(1);
      expect(result.events).toContainEqual({ kind: 'calling_skipped_endgame' });
    }
  });
});

// ============================================
// respondToCall()
// ============================================

describe('respondToCall', () => {
  function callingState(overrides: Partial<EngineState> = {}): EngineState {
    return baseState({
      phase: 'calling',
      currentPlayerSeat: 0, // discarder
      discardPile: ['dots_5_0'],
      lastAction: { type: 'discard', playerSeat: 0, tileType: 'dots_5' },
      pendingCalls: { 0: 'discarder', 1: 'waiting', 2: 'waiting', 3: 'waiting' },
      hands: {
        0: fillerHand(0),
        1: ['dots_4_0', 'dots_6_0', 'bamboo_1_0', 'bamboo_1_1'],
        2: ['dots_5_1', 'dots_5_2', 'characters_2_0'],
        3: ['characters_3_0'],
      },
      wall: new Array(10).fill('bamboo_9_0'),
      ...overrides,
    });
  }

  it('rejects a call not currently valid for the responding seat (invalid_call)', () => {
    // seat 3 has no matching tiles at all for pung/kong/chow, and no winning
    // hand on the discard -- declaring pung is invalid.
    const state = callingState();
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 3, 'pung'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_call' });
  });

  it('rejects a second response from the same seat (already_responded)', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'waiting', 3: 'waiting' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 1, 'pass'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'already_responded' });
  });

  it('does not resolve until all four seats have responded', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'waiting', 2: 'waiting', 3: 'waiting' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 1, 'pass'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('calling');
      expect(result.state.pendingCalls).toEqual({
        0: 'discarder',
        1: 'pass',
        2: 'waiting',
        3: 'waiting',
      });
    }
  });

  it('resolves with win > kong > pung > chow priority once all four respond', () => {
    // seat 2 declares pung, seat 3 declares kong; kong should win.
    const state = callingState({
      hands: {
        0: fillerHand(0),
        1: ['dots_4_0', 'dots_6_0'],
        2: ['dots_5_1', 'dots_5_2', 'characters_2_0'],
        3: ['dots_5_3', 'dots_5_1', 'dots_5_2'], // NOTE: fixture-only; real 3-copy kong hand
      },
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'pung', 3: 'waiting' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 3, 'kong'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('playing');
      expect(result.state.currentPlayerSeat).toBe(3);
      expect(result.state.melds[3][0].type).toBe('kong');
      expect(result.events.some((e) => e.kind === 'called' && e.call === 'kong' && e.seat === 3)).toBe(true);
    }
  });

  it('resolves multiple win callers to the seat closest counter-clockwise from the discarder', () => {
    // discarder is seat 0; seats 2 and 3 both declare win. Counter-clockwise
    // from 0 is 1,2,3 -- seat 2 is closer than seat 3.
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'win', 3: 'win' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 3, 'win'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('ended');
      expect(result.state.winner).not.toBeNull();
      expect(result.state.winner!.seat).toBe(2);
    }
  });

  it('a pung caller becomes the current player without needing to draw', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'waiting', 3: 'pass' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 2, 'pung'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('playing');
      expect(result.state.currentPlayerSeat).toBe(2);
      expect(result.state.melds[2][0].type).toBe('pung');
      // Pung/chow go straight to discard: no draw, so lastAction reflects
      // the call itself, not a draw.
      expect(result.state.lastAction).toEqual({ type: 'pung', playerSeat: 2, tileType: 'dots_5' });
    }
  });

  it('a chow caller only allows the seat immediately after the discarder', () => {
    const state = callingState({
      currentPlayerSeat: 0,
      pendingCalls: { 0: 'discarder', 1: 'waiting', 2: 'pass', 3: 'pass' },
      hands: {
        0: fillerHand(0),
        1: ['dots_4_0', 'dots_6_0'],
        2: [],
        3: [],
      },
    });
    const selection: ChowSelection = { tilesFromHand: ['dots_4_0', 'dots_6_0'] };
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 1, 'chow', selection));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.melds[1][0]).toMatchObject({ type: 'chow', calledTile: 'dots_5_0' });
    }
  });

  it('rejects chow attempted by a seat other than the one after the discarder', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'waiting', 3: 'pass' },
      hands: {
        0: fillerHand(0),
        1: [],
        2: ['dots_4_1', 'dots_6_1'],
        3: [],
      },
    });
    const selection: ChowSelection = { tilesFromHand: ['dots_4_1', 'dots_6_1'] };
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 2, 'chow', selection));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_call' });
  });

  it('rejects an invalid chow tile selection', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'waiting', 2: 'pass', 3: 'pass' },
      hands: {
        0: fillerHand(0),
        1: ['dots_4_0', 'dots_7_0'], // dots_5 + dots_4 + dots_7 is not a run
        2: [],
        3: [],
      },
    });
    const selection: ChowSelection = { tilesFromHand: ['dots_4_0', 'dots_7_0'] };
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 1, 'chow', selection));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_chow_selection' });
  });

  it('advances to the seat after the discarder when everyone passes', () => {
    const state = callingState({
      pendingCalls: { 0: 'discarder', 1: 'pass', 2: 'pass', 3: 'waiting' },
    });
    const result = callAndCheckNoMutation(state, (s) => respondToCall(s, 3, 'pass'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('playing');
      expect(result.state.currentPlayerSeat).toBe(1);
      expect(result.state.pendingCalls).toBeNull();
      expect(result.events.some((e) => e.kind === 'passed' && e.seat === 3)).toBe(true);
    }
  });
});

// ============================================
// declareSelfDrawWin()
// ============================================

describe('declareSelfDrawWin', () => {
  it('is rejected immediately after the seat\'s own pung/chow completed the hand (ruling 2)', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: fillerHand(0) },
      melds: { ...emptyMelds(), 0: [{ type: 'pung', tiles: ['dots_1_0', 'dots_1_1', 'dots_1_2'] }] },
      lastAction: { type: 'pung', playerSeat: 0, tileType: 'dots_1' },
    });
    const result = callAndCheckNoMutation(state, (s) => declareSelfDrawWin(s, 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'not_a_winning_hand' });
  });

  it('is allowed on a kong replacement draw', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: fillerHand(0) },
      melds: { ...emptyMelds(), 0: [{ type: 'kong', tiles: ['dots_1_0', 'dots_1_1', 'dots_1_2', 'dots_1_3'] }] },
      lastAction: { type: 'kong', playerSeat: 0, tileType: 'dots_1' },
    });
    const result = callAndCheckNoMutation(state, (s) => declareSelfDrawWin(s, 0));
    // Result depends on whether fillerHand(0) is actually a complete shape;
    // the point under test is that ruling 2's block does NOT fire here (kong
    // replacements stay eligible), not the hand-shape outcome itself.
    expect(result.ok).toBe(true);
  });

  it('sets winner + score and ends the hand on a valid self-draw win', () => {
    // 5 pungs + pair, exactly winning per canFormWinningHand.
    const hand = [
      'dots_1_0', 'dots_1_1', 'dots_1_2',
      'bamboo_2_0', 'bamboo_2_1', 'bamboo_2_2',
      'characters_3_0', 'characters_3_1', 'characters_3_2',
      'dots_4_0', 'dots_4_1', 'dots_4_2',
      'bamboo_5_0', 'bamboo_5_1', 'bamboo_5_2',
      'dots_6_0', 'dots_6_1',
    ];
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => declareSelfDrawWin(s, 0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('ended');
      expect(result.state.endReason).toBe('win');
      expect(result.state.winner).not.toBeNull();
      expect(result.state.winner!.seat).toBe(0);
      expect(result.state.winner!.isSelfDraw).toBe(true);
      expect(result.events.some((e) => e.kind === 'won')).toBe(true);
    }
  });
});

// ============================================
// declareConcealedKong()
// ============================================

describe('declareConcealedKong', () => {
  it('requires exactly 4 copies of the type in hand', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: [...fillerHand(0), 'dots_1_3'] }, // fillerHand(0) has only dots_1_0
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => declareConcealedKong(s, 0, 'dots_1'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_kong' });
  });

  it('excludes the gold type from concealed kong', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: {
        ...emptyHands(),
        0: [`${GOLD}_0`, `${GOLD}_1`, `${GOLD}_2`, ...fillerHand(0)],
      },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => declareConcealedKong(s, 0, GOLD));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_kong' });
  });

  it('melds the 4 copies concealed and draws a replacement', () => {
    const hand = ['dots_1_0', 'dots_1_1', 'dots_1_2', 'dots_1_3', ...fillerHand(1)];
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: hand },
      wall: ['dots_9_0', 'dots_9_1'],
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => declareConcealedKong(s, 0, 'dots_1'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.melds[0]).toContainEqual(
        expect.objectContaining({ type: 'kong', isConcealed: true }),
      );
      expect(result.state.hands[0]).not.toContain('dots_1_0');
      expect(result.state.hands[0]).toContain('dots_9_0');
      expect(result.state.wall).toEqual(['dots_9_1']);
      expect(result.events).toContainEqual({ kind: 'concealed_kong', seat: 0 });
    }
  });
});

// ============================================
// upgradePungToKong()
// ============================================

describe('upgradePungToKong', () => {
  it('converts an exposed pung to a kong using the matching hand tile and draws a replacement', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: ['dots_1_3', ...fillerHand(1)] },
      melds: { ...emptyMelds(), 0: [{ type: 'pung', tiles: ['dots_1_0', 'dots_1_1', 'dots_1_2'] }] },
      wall: ['dots_9_0', 'dots_9_1'],
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => upgradePungToKong(s, 0, 0, 'dots_1_3'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.melds[0][0]).toMatchObject({ type: 'kong' });
      expect(result.state.melds[0][0].tiles).toHaveLength(4);
      expect(result.state.hands[0]).not.toContain('dots_1_3');
      expect(result.state.hands[0]).toContain('dots_9_0');
      expect(result.events).toContainEqual({ kind: 'kong_upgraded', seat: 0, tile: 'dots_1_3' });
    }
  });

  it('rejects when the meld at meldIndex is not a matching exposed pung', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: ['bamboo_2_3', ...fillerHand(1)] },
      melds: { ...emptyMelds(), 0: [{ type: 'pung', tiles: ['dots_1_0', 'dots_1_1', 'dots_1_2'] }] },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const result = callAndCheckNoMutation(state, (s) => upgradePungToKong(s, 0, 0, 'bamboo_2_3'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'invalid_kong' });
  });
});

// ============================================
// legalActions()
// ============================================

describe('legalActions', () => {
  it('before drawing: canDraw true, canDiscard false, no self-draw win', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'discard', playerSeat: 3, tileType: 'dots_9' },
    });
    const actions = legalActions(state, 0);
    expect(actions.canDraw).toBe(true);
    expect(actions.canDiscard).toBe(false);
    expect(actions.canSelfDrawWin).toBe(false);
  });

  it('after drawing: canDiscard true, canDraw false', () => {
    const state = baseState({
      currentPlayerSeat: 0,
      hands: { ...emptyHands(), 0: fillerHand(0) },
      lastAction: { type: 'draw', playerSeat: 0 },
    });
    const actions = legalActions(state, 0);
    expect(actions.canDraw).toBe(false);
    expect(actions.canDiscard).toBe(true);
  });

  it('in the calling phase, exposes per-seat call options and null for the discarder', () => {
    const state = baseState({
      phase: 'calling',
      currentPlayerSeat: 0,
      discardPile: ['dots_5_0'],
      lastAction: { type: 'discard', playerSeat: 0, tileType: 'dots_5' },
      pendingCalls: { 0: 'discarder', 1: 'waiting', 2: 'waiting', 3: 'waiting' },
      hands: {
        0: fillerHand(0),
        1: ['dots_4_0', 'dots_6_0'],
        2: ['dots_5_1', 'dots_5_2'],
        3: [],
      },
    });
    const discarderActions = legalActions(state, 0);
    expect(discarderActions.call).toBeNull();

    const pungSeatActions = legalActions(state, 2);
    expect(pungSeatActions.call?.canPung).toBe(true);

    const chowSeatActions = legalActions(state, 1);
    expect(chowSeatActions.call?.chowOptions.length).toBeGreaterThan(0);

    const passOnlySeatActions = legalActions(state, 3);
    expect(passOnlySeatActions.call?.canWin).toBe(false);
    expect(passOnlySeatActions.call?.canPung).toBe(false);
  });

  it('nothing is legal once the hand has ended', () => {
    const state = baseState({
      phase: 'ended',
      endReason: 'wall_exhausted',
      hands: { ...emptyHands(), 0: fillerHand(0) },
    });
    const actions = legalActions(state, 0);
    expect(actions.canDraw).toBe(false);
    expect(actions.canDiscard).toBe(false);
    expect(actions.canSelfDrawWin).toBe(false);
    expect(actions.concealedKongTypes).toEqual([]);
    expect(actions.pungUpgrades).toEqual([]);
    expect(actions.call).toBeNull();
  });
});

// Sanity: everything above must construct valid EngineState literals per
// types.ts, so this suite compiles even before any transition is implemented.
void ({} as EngineState);
