// Bot decision tests. Contract: design-server-loop.md section 9 (engine-side
// bot tests) and research-v1-spec.md section 5 (behavior constants).
//
// Two flavors:
//  - Seeded full-game property tests: drive 4 bots through the REAL pure engine
//    and assert every intent is accepted, no gold is ever discarded, and the
//    game terminates. This is the bots' legality + termination proof.
//  - Crafted-view unit tests: hand-built SeatView / LegalActions literals to pin
//    always-win, always-kong, difficulty thresholds, gold exclusion, determinism.

import { initHand } from '../deal';
import {
  draw,
  discard,
  respondToCall,
  declareSelfDrawWin,
  declareConcealedKong,
  upgradePungToKong,
  legalActions,
} from '../game';
import { viewFor } from '../view';
import {
  generateAllTiles,
  shuffle,
  isBonusTile,
  isGoldTile,
  getTileType,
} from '../tiles';
import { chooseBotAction, type BotIntent, type Difficulty } from '../bots';
import type {
  EngineState,
  LegalActions,
  Result,
  Seat,
  SeatView,
} from '../types';

const SEATS: Seat[] = [0, 1, 2, 3];
const DEAD_WALL = 16;
const STEP_CAP = 2000;

/** Deterministic PRNG (standard mulberry32), matching properties.test.ts. */
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

function assertTileConservation(state: EngineState): void {
  let total = 1 /* exposedGold */ + DEAD_WALL + state.wall.length + state.discardPile.length;
  for (const seat of SEATS) {
    total += state.hands[seat].length;
    total += state.bonusTiles[seat].length;
    for (const meld of state.melds[seat]) total += meld.tiles.length;
  }
  expect(total).toBe(128);
}

/** Map a BotIntent to the engine transition that executes it, for `seat`. */
function applyIntent(
  state: EngineState,
  seat: Seat,
  intent: BotIntent,
  legal: LegalActions,
): Result {
  switch (intent.kind) {
    case 'draw':
      return draw(state, seat);
    case 'discard':
      return discard(state, seat, intent.tile);
    case 'selfDrawWin':
      return declareSelfDrawWin(state, seat);
    case 'concealedKong':
      return declareConcealedKong(state, seat, intent.tileType);
    case 'upgradeKong': {
      // The convex adapter resolves the tile from legal.pungUpgrades; do the same.
      const upgrade = legal.pungUpgrades.find((u) => u.meldIndex === intent.meldIndex);
      if (!upgrade) throw new Error('upgradeKong meldIndex not in legal.pungUpgrades');
      return upgradePungToKong(state, seat, intent.meldIndex, upgrade.tile);
    }
    case 'respond':
      return respondToCall(state, seat, intent.action, intent.chowSelection);
  }
}

interface GameOutcome {
  state: EngineState;
  steps: number;
  goldDiscarded: boolean;
}

/** Drive one full 4-bot game through the pure engine at a fixed difficulty. */
function runBotGame(seed: number, difficulty: Difficulty): GameOutcome {
  const rng = mulberry32(seed);
  const shuffled = shuffle(generateAllTiles(), rng);
  const init = initHand({ dealerSeat: (seed % 4) as Seat, dealerStreak: 0 }, shuffled);
  expect(init.ok).toBe(true);
  if (!init.ok) throw new Error('init failed');

  let state = init.state;
  assertTileConservation(state);
  let goldDiscarded = false;
  let steps = 0;

  for (; steps < STEP_CAP; steps++) {
    if (state.phase === 'ended') break;

    let seat: Seat;
    if (state.phase === 'calling') {
      const waiting = SEATS.find((s) => state.pendingCalls?.[s] === 'waiting');
      if (waiting === undefined) throw new Error('calling phase with no waiting seat');
      seat = waiting;
    } else {
      seat = state.currentPlayerSeat;
    }

    const view = viewFor(state, seat);
    const legal = legalActions(state, seat);
    const intent = chooseBotAction(view, legal, difficulty);

    if (intent.kind === 'discard') {
      expect(isGoldTile(intent.tile, state.goldTileType)).toBe(false);
      if (isGoldTile(intent.tile, state.goldTileType)) goldDiscarded = true;
    }

    const result = applyIntent(state, seat, intent, legal);
    // EVERY bot intent must be accepted by the engine.
    if (!result.ok) {
      throw new Error(
        `illegal intent ${JSON.stringify(intent)} in phase ${state.phase}: ${JSON.stringify(result.error)}`,
      );
    }
    expect(result.state.seq).toBeGreaterThan(state.seq);
    state = result.state;
    assertTileConservation(state);
  }

  return { state, steps, goldDiscarded };
}

describe('bot legality property: full 4-bot games terminate legally', () => {
  const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
  const difficulties: Difficulty[] = ['easy', 'medium', 'hard'];

  for (const difficulty of difficulties) {
    it.each(seeds)(`${difficulty} seed %i`, (seed) => {
      const { state, steps, goldDiscarded } = runBotGame(seed, difficulty);
      expect(steps).toBeLessThan(STEP_CAP);
      expect(state.phase).toBe('ended');
      expect(goldDiscarded).toBe(false);
      // No wind/dragon ever ended up in a concealed hand.
      for (const seat of SEATS) {
        for (const tile of state.hands[seat]) {
          expect(isBonusTile(tile)).toBe(false);
        }
      }
    });
  }
});

// --- Crafted-view fixtures ----------------------------------------------------

const GOLD = 'dots_9'; // suit type; kept out of every crafted hand so jokers = 0

/** Four throwaway pung melds, to set a viewer's meld count to 4 (setsNeeded=1). */
function fourMelds(): SeatView['melds'][Seat] {
  return [
    { type: 'pung', tiles: ['characters_1_0', 'characters_1_1', 'characters_1_2'] },
    { type: 'pung', tiles: ['characters_2_0', 'characters_2_1', 'characters_2_2'] },
    { type: 'pung', tiles: ['characters_3_0', 'characters_3_1', 'characters_3_2'] },
    { type: 'pung', tiles: ['characters_4_0', 'characters_4_1', 'characters_4_2'] },
  ];
}

function baseCallingView(overrides: Partial<SeatView>): SeatView {
  return {
    seq: 10,
    phase: 'calling',
    dealerSeat: 0,
    currentPlayerSeat: 1,
    goldTileType: GOLD,
    exposedGold: 'dots_9_3',
    wallCount: 40,
    viewerSeat: 2,
    ownHand: [],
    handCounts: { 0: 4, 1: 4, 2: 4, 3: 4 },
    melds: { 0: [], 1: [], 2: fourMelds(), 3: [] },
    bonusTiles: { 0: [], 1: [], 2: [], 3: [] },
    discardPile: ['bamboo_1_1'],
    lastAction: { type: 'discard', playerSeat: 1, tileType: 'bamboo_1' },
    previousAction: null,
    pendingCalls: { 0: 'waiting', 1: 'discarder', 2: 'waiting', 3: 'waiting' },
    calledTypeThisTurn: null,
    winner: null,
    endReason: null,
    ...overrides,
  };
}

function basePlayingView(overrides: Partial<SeatView>): SeatView {
  return {
    seq: 10,
    phase: 'playing',
    dealerSeat: 0,
    currentPlayerSeat: 2,
    goldTileType: GOLD,
    exposedGold: 'dots_9_3',
    wallCount: 40,
    viewerSeat: 2,
    ownHand: [],
    handCounts: { 0: 4, 1: 4, 2: 5, 3: 4 },
    melds: { 0: [], 1: [], 2: fourMelds(), 3: [] },
    bonusTiles: { 0: [], 1: [], 2: [], 3: [] },
    discardPile: [],
    lastAction: { type: 'draw', playerSeat: 2, tileType: 'bamboo_1' },
    previousAction: null,
    pendingCalls: null,
    calledTypeThisTurn: null,
    winner: null,
    endReason: null,
    ...overrides,
  };
}

const NO_LEGAL: LegalActions = {
  canDraw: false,
  canDiscard: false,
  canSelfDrawWin: false,
  concealedKongTypes: [],
  pungUpgrades: [],
  call: null,
};

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];

describe('bot always wins', () => {
  it('responds win whenever a call win is legal, every difficulty', () => {
    const view = baseCallingView({ ownHand: ['bamboo_2_0', 'bamboo_3_0', 'characters_5_0', 'characters_5_1'] });
    const legal: LegalActions = {
      ...NO_LEGAL,
      call: { canWin: true, canKong: true, canPung: true, chowOptions: [] },
    };
    for (const d of DIFFS) {
      expect(chooseBotAction(view, legal, d)).toEqual({ kind: 'respond', action: 'win' });
    }
  });

  it('self-draw wins whenever legal, every difficulty', () => {
    const view = basePlayingView({ ownHand: ['bamboo_1_0', 'bamboo_2_0', 'bamboo_3_0', 'characters_5_0', 'characters_5_1'] });
    const legal: LegalActions = {
      ...NO_LEGAL,
      canDiscard: true,
      canSelfDrawWin: true,
      concealedKongTypes: ['bamboo_1'],
    };
    for (const d of DIFFS) {
      expect(chooseBotAction(view, legal, d)).toEqual({ kind: 'selfDrawWin' });
    }
  });
});

describe('bot always kongs a discard when legal', () => {
  it('responds kong (win not available), even if it hurts, every difficulty', () => {
    const view = baseCallingView({ ownHand: ['bamboo_1_0', 'bamboo_1_2', 'bamboo_1_3', 'characters_5_0'] });
    const legal: LegalActions = {
      ...NO_LEGAL,
      call: { canWin: false, canKong: true, canPung: true, chowOptions: [] },
    };
    for (const d of DIFFS) {
      expect(chooseBotAction(view, legal, d)).toEqual({ kind: 'respond', action: 'kong' });
    }
  });
});

describe('bot always takes a concealed kong / pung upgrade in play', () => {
  it('declares a concealed kong when offered (no win available)', () => {
    const view = basePlayingView({
      ownHand: ['bamboo_1_0', 'bamboo_1_1', 'bamboo_1_2', 'bamboo_1_3', 'characters_5_0'],
    });
    const legal: LegalActions = {
      ...NO_LEGAL,
      canDiscard: true,
      concealedKongTypes: ['bamboo_1'],
    };
    for (const d of DIFFS) {
      expect(chooseBotAction(view, legal, d)).toEqual({ kind: 'concealedKong', tileType: 'bamboo_1' });
    }
  });

  it('upgrades a pung to kong when offered', () => {
    const view = basePlayingView({ ownHand: ['bamboo_1_0', 'characters_5_0', 'characters_5_1', 'characters_6_0', 'characters_7_0'] });
    const legal: LegalActions = {
      ...NO_LEGAL,
      canDiscard: true,
      pungUpgrades: [{ meldIndex: 2, tile: 'bamboo_1_0' }],
    };
    for (const d of DIFFS) {
      expect(chooseBotAction(view, legal, d)).toEqual({ kind: 'upgradeKong', meldIndex: 2 });
    }
  });
});

describe('difficulty thresholds on a chow offer', () => {
  // meldCount = 4 (setsNeeded = 1). Hand [b1 b2 b3 c5]: b1b2b3 is a concealed
  // run, so before-shanten = 0 (tenpai on a c5 pair). A chow that claims b2,b3
  // (discard b1) breaks that run and re-forms it as an exposed meld, leaving
  // [b1 c5] -> after-shanten = 0. delta = 0: the call does NOT improve shanten.
  const CHOW_NEUTRAL = baseCallingView({
    ownHand: ['bamboo_1_0', 'bamboo_2_0', 'bamboo_3_0', 'characters_5_0'],
    discardPile: ['bamboo_1_1'],
    wallCount: 40,
  });
  const legalChowNeutral: LegalActions = {
    ...NO_LEGAL,
    call: {
      canWin: false,
      canKong: false,
      canPung: false,
      chowOptions: [
        {
          tilesFromHand: ['bamboo_2_0', 'bamboo_3_0'],
          sequence: ['bamboo_1', 'bamboo_2', 'bamboo_3'],
        },
      ],
    },
  };

  it('easy and medium call a shanten-neutral chow; hard passes', () => {
    expect(chooseBotAction(CHOW_NEUTRAL, legalChowNeutral, 'easy')).toEqual({
      kind: 'respond',
      action: 'chow',
      chowSelection: { tilesFromHand: ['bamboo_2_0', 'bamboo_3_0'] },
    });
    expect(chooseBotAction(CHOW_NEUTRAL, legalChowNeutral, 'medium')).toEqual({
      kind: 'respond',
      action: 'chow',
      chowSelection: { tilesFromHand: ['bamboo_2_0', 'bamboo_3_0'] },
    });
    expect(chooseBotAction(CHOW_NEUTRAL, legalChowNeutral, 'hard')).toEqual({
      kind: 'respond',
      action: 'pass',
    });
  });

  // Hand [b1 b2 c5 c5]: c5c5 pair + b1b2 protorun, before = 0. A chow claiming
  // b1,b2 (discard b3) leaves [c5 c5] -> after-shanten = -1 (winning). delta =
  // -1 (strict improvement): every difficulty calls.
  const CHOW_IMPROVES = baseCallingView({
    ownHand: ['bamboo_1_0', 'bamboo_2_0', 'characters_5_0', 'characters_5_1'],
    discardPile: ['bamboo_3_1'],
  });
  const legalChowImproves: LegalActions = {
    ...NO_LEGAL,
    call: {
      canWin: false,
      canKong: false,
      canPung: false,
      chowOptions: [
        {
          tilesFromHand: ['bamboo_1_0', 'bamboo_2_0'],
          sequence: ['bamboo_1', 'bamboo_2', 'bamboo_3'],
        },
      ],
    },
  };

  it('every difficulty calls a strictly-improving chow', () => {
    for (const d of DIFFS) {
      expect(chooseBotAction(CHOW_IMPROVES, legalChowImproves, d)).toEqual({
        kind: 'respond',
        action: 'chow',
        chowSelection: { tilesFromHand: ['bamboo_1_0', 'bamboo_2_0'] },
      });
    }
  });

  it('hard tightens near the wall end: passes an improving chow when result stays far', () => {
    // Deep-in-hand chow that improves but leaves the hand well short. Reuse a
    // larger, messier hand so the resulting shanten stays > HARD_LATE_MAX (2).
    const view = baseCallingView({
      ownHand: ['bamboo_1_0', 'bamboo_2_0', 'dots_1_0', 'dots_4_0'],
      melds: { 0: [], 1: [], 2: [], 3: [] }, // meldCount 0 -> setsNeeded 5
      handCounts: { 0: 16, 1: 16, 2: 4, 3: 16 },
      discardPile: ['bamboo_3_1'],
      wallCount: 10, // < HARD_LATE_WALL (20)
    });
    const legal: LegalActions = {
      ...NO_LEGAL,
      call: {
        canWin: false,
        canKong: false,
        canPung: false,
        chowOptions: [
          {
            tilesFromHand: ['bamboo_1_0', 'bamboo_2_0'],
            sequence: ['bamboo_1', 'bamboo_2', 'bamboo_3'],
          },
        ],
      },
    };
    // easy/medium have no wall tightening -> still call the improving chow.
    expect(chooseBotAction(view, legal, 'medium')).toMatchObject({ action: 'chow' });
    // hard: improvement exists but resulting shanten > 2 with wall < 20 -> pass.
    expect(chooseBotAction(view, legal, 'hard')).toEqual({ kind: 'respond', action: 'pass' });
  });
});

describe('hard defensive fold', () => {
  it('passes a shanten-improving pung when an opponent shows 3+ melds and own hand is far', () => {
    // setsNeeded 5, junk hand far from tenpai (shanten >= 3), opponent seat 0
    // shows 3 melds -> hard folds; easy/medium still take the improving pung.
    const oppMelds = fourMelds().slice(0, 3);
    const view = baseCallingView({
      ownHand: ['bamboo_1_0', 'bamboo_1_1', 'dots_3_0', 'dots_6_0', 'bamboo_9_0'],
      melds: { 0: oppMelds, 1: [], 2: [], 3: [] },
      handCounts: { 0: 7, 1: 16, 2: 5, 3: 16 },
      discardPile: ['bamboo_1_2'],
      wallCount: 40,
    });
    const legal: LegalActions = {
      ...NO_LEGAL,
      call: { canWin: false, canKong: false, canPung: true, chowOptions: [] },
    };
    expect(chooseBotAction(view, legal, 'medium')).toMatchObject({ action: 'pung' });
    expect(chooseBotAction(view, legal, 'hard')).toEqual({ kind: 'respond', action: 'pass' });
  });
});

describe('never proposes a gold discard', () => {
  it('picks a non-gold tile even when the gold looks like the isolated discard', () => {
    // Gold type dots_9. Hand is a bamboo run plus a lone gold: a naive
    // "ditch the isolated tile" heuristic would discard the gold. The bot must
    // exclude it and discard a real tile.
    const view = basePlayingView({
      goldTileType: 'dots_9',
      ownHand: ['dots_9_0', 'bamboo_1_0', 'bamboo_2_0', 'bamboo_3_0', 'bamboo_4_0'],
    });
    const legal: LegalActions = { ...NO_LEGAL, canDiscard: true };
    for (const d of DIFFS) {
      const intent = chooseBotAction(view, legal, d);
      expect(intent.kind).toBe('discard');
      if (intent.kind === 'discard') {
        expect(isGoldTile(intent.tile, 'dots_9')).toBe(false);
        expect(getTileType(intent.tile)).not.toBe('dots_9');
      }
    }
  });

  it('never discards the type the bot just called this turn', () => {
    const view = basePlayingView({
      calledTypeThisTurn: 'bamboo_1',
      ownHand: ['bamboo_1_0', 'bamboo_5_0', 'bamboo_9_0', 'dots_3_0', 'characters_7_0'],
    });
    const legal: LegalActions = { ...NO_LEGAL, canDiscard: true };
    const intent = chooseBotAction(view, legal, 'medium');
    expect(intent.kind).toBe('discard');
    if (intent.kind === 'discard') {
      expect(getTileType(intent.tile)).not.toBe('bamboo_1');
    }
  });
});

describe('determinism', () => {
  it('returns an identical intent for the same (view, legal, difficulty)', () => {
    const view = basePlayingView({
      ownHand: ['bamboo_1_0', 'bamboo_3_0', 'dots_1_0', 'dots_5_0', 'characters_8_0'],
    });
    const legal: LegalActions = { ...NO_LEGAL, canDiscard: true };
    for (const d of DIFFS) {
      const a = chooseBotAction(view, legal, d);
      const b = chooseBotAction(view, legal, d);
      expect(a).toEqual(b);
    }
  });

  it('does not mutate its inputs', () => {
    const view = basePlayingView({
      ownHand: ['bamboo_1_0', 'bamboo_3_0', 'dots_1_0', 'dots_5_0', 'characters_8_0'],
    });
    const legal: LegalActions = { ...NO_LEGAL, canDiscard: true };
    const viewSnapshot = JSON.stringify(view);
    const legalSnapshot = JSON.stringify(legal);
    chooseBotAction(view, legal, 'hard');
    expect(JSON.stringify(view)).toBe(viewSnapshot);
    expect(JSON.stringify(legal)).toBe(legalSnapshot);
  });
});
