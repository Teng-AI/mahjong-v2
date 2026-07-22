// Game-flow helpers and transitions. Contract: design-engine-api.md.
// PARTIAL: adapter-proof helpers only; transitions land per the design doc.

import { scoreWin } from './score';
import {
  canChow,
  canDeclareConcealedKong,
  canFormWinningHand,
  canKong,
  canPung,
  canUpgradePungToKong,
  canWinOnDiscard as canWinOnDiscardTile,
  countGoldTiles,
  getTileType,
  isBonusTile,
  isGoldTile,
  removeTiles,
  sortTilesForDisplay,
} from './tiles';
import type {
  CallAction,
  ChowOption,
  ChowSelection,
  EngineError,
  EngineState,
  GameEvent,
  LastAction,
  LegalActions,
  Meld,
  Result,
  Seat,
  ScoreInput,
  TileId,
  TileType,
  WinnerInfo,
} from './types';

/** Turn order is counter-clockwise: 0 -> 1 -> 2 -> 3 -> 0. */
export function getNextSeat(seat: Seat): Seat {
  return (((seat + 1) % 4) as Seat);
}

// Structural subset so v1 test fixtures (full v1 GameState literals) pass as-is.
export interface NeedsToDrawState {
  currentPlayerSeat: Seat;
  lastAction: LastAction | null;
}

/**
 * Whether the current player must draw before acting (spec 1.3): skip the draw
 * when the last action was their own draw/pung/chow/kong, at game start
 * (dealer holds 17), or during setup. After any discard the next player draws.
 */
export function needsToDraw(state: NeedsToDrawState): boolean {
  const last = state.lastAction;
  if (!last) return false;
  if (last.type === 'game_start' || last.type === 'bonus_expose') return false;
  if (
    last.playerSeat === state.currentPlayerSeat &&
    (last.type === 'draw' ||
      last.type === 'pung' ||
      last.type === 'chow' ||
      last.type === 'kong')
  ) {
    return false;
  }
  return true;
}

/** Whether hand contains any wind/dragon (bonus) tile. */
export function hasBonusTiles(tiles: TileId[]): boolean {
  return tiles.some((t) => isBonusTile(t));
}

/** Extract only bonus (wind/dragon) tiles from a hand, preserving order. */
export function getBonusTilesFromHand(tiles: TileId[]): TileId[] {
  return tiles.filter((t) => isBonusTile(t));
}

/** Extract only non-bonus (suit) tiles from a hand. */
export function getNonBonusTiles(tiles: TileId[]): TileId[] {
  return tiles.filter((t) => !isBonusTile(t));
}

/** Wrapper over tiles.canFormWinningHand (v1 parity: game.ts re-export). */
export function canWin(
  hand: TileId[],
  goldTileType: TileType,
  exposedMeldCount: number = 0,
): boolean {
  return canFormWinningHand(hand, goldTileType, exposedMeldCount);
}

/** Wrapper over tiles.canWinOnDiscard (v1 parity: game.ts re-export). */
export function canWinOnDiscard(
  hand: TileId[],
  discardedTile: TileId,
  goldTileType: TileType,
  exposedMeldCount: number = 0,
): boolean {
  return canWinOnDiscardTile(hand, discardedTile, goldTileType, exposedMeldCount);
}

// --- Transitions (design-engine-api.md "game.ts") -----------------------------
// Every transition is (state, ...) => Result, never throws, never mutates its
// input, and increments seq on every success. The success path deep-clones the
// input first and mutates only the clone.

const ENDGAME_WALL_THRESHOLD = 4; // calling phase skipped when wall <= this

function reject(error: EngineError): Result {
  return { ok: false, error };
}

function clone(state: EngineState): EngineState {
  const next = structuredClone(state);
  next.seq = state.seq + 1;
  return next;
}

function findDiscarder(state: EngineState): Seat {
  for (const k of [0, 1, 2, 3] as Seat[]) {
    if (state.pendingCalls && state.pendingCalls[k] === 'discarder') return k;
  }
  return state.currentPlayerSeat;
}

function ruling2Blocked(state: EngineState, seat: Seat): boolean {
  const last = state.lastAction;
  return (
    !!last &&
    last.playerSeat === seat &&
    (last.type === 'pung' || last.type === 'chow')
  );
}

/**
 * Draw from the wall front into `seat`'s hand, auto-exposing any bonus tiles
 * hit along the way (with replacements). Returns the final non-bonus tile, or
 * null if the wall exhausted mid-draw (caller ends the hand as a draw game).
 * Mutates `s` (a clone) and appends bonus_exposed events.
 */
function drawWithBonus(
  s: EngineState,
  seat: Seat,
  events: GameEvent[],
  during: 'deal' | 'play',
): TileId | null {
  for (;;) {
    if (s.wall.length === 0) return null;
    const tile = s.wall.shift() as TileId;
    if (isBonusTile(tile)) {
      s.bonusTiles[seat].push(tile);
      events.push({ kind: 'bonus_exposed', seat, tile, during });
      continue;
    }
    s.hands[seat].push(tile);
    return tile;
  }
}

function endWallExhausted(s: EngineState, events: GameEvent[]): Result {
  s.phase = 'ended';
  s.endReason = 'wall_exhausted';
  s.winner = null;
  events.push({ kind: 'wall_exhausted' });
  return { ok: true, state: s, events };
}

function buildWinner(
  s: EngineState,
  seat: Seat,
  hand: TileId[],
  dealerStreak: number,
  winPath: ScoreInput['winPath'],
  flags: {
    isSelfDraw: boolean;
    isThreeGolds?: boolean;
    isRobbingGold?: boolean;
    winningTile?: TileId;
    discarderSeat?: Seat;
  },
): WinnerInfo {
  const scoreInput: ScoreInput = {
    hand,
    melds: s.melds[seat],
    bonusTiles: s.bonusTiles[seat],
    goldTileType: s.goldTileType,
    isDealer: seat === s.dealerSeat,
    dealerStreak,
    winPath,
  };
  return {
    seat,
    isSelfDraw: flags.isSelfDraw,
    isThreeGolds: flags.isThreeGolds ?? false,
    isRobbingGold: flags.isRobbingGold ?? false,
    winningTile: flags.winningTile,
    discarderSeat: flags.discarderSeat,
    hand,
    score: scoreWin(scoreInput),
  };
}

/** If `seat` now holds all 3 gold copies, end the hand with a Three Golds
 * self-draw win. Returns the finished Result, or null if not a Three Golds. */
function maybeThreeGolds(
  s: EngineState,
  seat: Seat,
  events: GameEvent[],
): Result | null {
  if (countGoldTiles(s.hands[seat], s.goldTileType) !== 3) return null;
  const winner = buildWinner(s, seat, [...s.hands[seat]], 0, 'three_golds', {
    isSelfDraw: true,
    isThreeGolds: true,
  });
  s.phase = 'ended';
  s.endReason = 'win';
  s.winner = winner;
  events.push({ kind: 'won', winner });
  return { ok: true, state: s, events };
}

export function draw(state: EngineState, seat: Seat): Result {
  if (state.phase !== 'playing') return reject({ code: 'wrong_phase' });
  if (seat !== state.currentPlayerSeat) return reject({ code: 'not_your_turn' });

  const s = clone(state);
  const events: GameEvent[] = [];
  if (s.wall.length === 0) return endWallExhausted(s, events);

  const drawn = drawWithBonus(s, seat, events, 'play');
  if (drawn === null) return endWallExhausted(s, events);

  events.push({ kind: 'drew', seat, tile: drawn });
  s.hands[seat] = sortTilesForDisplay(s.hands[seat], s.goldTileType);
  s.previousAction = s.lastAction;
  s.lastAction = { type: 'draw', playerSeat: seat, tileType: getTileType(drawn) };

  const tg = maybeThreeGolds(s, seat, events);
  if (tg) return tg;

  return { ok: true, state: s, events };
}

export function discard(state: EngineState, seat: Seat, tile: TileId): Result {
  if (state.phase !== 'playing') return reject({ code: 'wrong_phase' });
  if (seat !== state.currentPlayerSeat) return reject({ code: 'not_your_turn' });
  if (needsToDraw(state)) return reject({ code: 'must_draw_first' });
  if (!state.hands[seat].includes(tile)) return reject({ code: 'tile_not_in_hand' });
  if (isGoldTile(tile, state.goldTileType)) return reject({ code: 'cannot_discard_gold' });
  if (
    state.calledTypeThisTurn !== null &&
    getTileType(tile) === state.calledTypeThisTurn
  ) {
    return reject({ code: 'cannot_discard_called_type' });
  }

  const s = clone(state);
  const events: GameEvent[] = [];
  s.hands[seat] = removeTiles(s.hands[seat], [tile]) as TileId[];
  s.discardPile.push(tile);
  s.previousAction = s.lastAction;
  s.lastAction = { type: 'discard', playerSeat: seat, tileType: getTileType(tile) };
  s.calledTypeThisTurn = null;
  events.push({ kind: 'discarded', seat, tile });

  // Endgame rule: wall <= 4 skips the calling phase entirely.
  if (s.wall.length <= ENDGAME_WALL_THRESHOLD) {
    s.currentPlayerSeat = getNextSeat(seat);
    s.pendingCalls = null;
    events.push({ kind: 'calling_skipped_endgame' });
    return { ok: true, state: s, events };
  }

  s.phase = 'calling';
  s.pendingCalls = {
    0: seat === 0 ? 'discarder' : 'waiting',
    1: seat === 1 ? 'discarder' : 'waiting',
    2: seat === 2 ? 'discarder' : 'waiting',
    3: seat === 3 ? 'discarder' : 'waiting',
  };
  s.pendingChow = null;
  events.push({ kind: 'calling_opened', discarder: seat, tile });
  return { ok: true, state: s, events };
}

/** Validate a chow selection against a discard: the two hand tiles + discard
 * must form a run of one suit. */
function validateChow(
  hand: TileId[],
  discardTile: TileId,
  selection: ChowSelection,
  goldTileType: TileType,
): boolean {
  const options = canChow(hand, discardTile, goldTileType);
  const [a, b] = selection.tilesFromHand;
  return options.some((opt) => {
    const [x, y] = opt.tilesFromHand;
    return (a === x && b === y) || (a === y && b === x);
  });
}

export function respondToCall(
  state: EngineState,
  seat: Seat,
  action: CallAction,
  chow?: ChowSelection,
): Result {
  if (state.phase !== 'calling' || !state.pendingCalls) {
    return reject({ code: 'wrong_phase' });
  }

  const discardTile = state.discardPile[state.discardPile.length - 1];
  const discarder = findDiscarder(state);

  // Every seat has already responded: this call triggers resolution of the
  // recorded responses (no re-validation).
  const anyWaiting = ([0, 1, 2, 3] as Seat[]).some(
    (k) => state.pendingCalls![k] === 'waiting',
  );
  if (!anyWaiting) {
    return resolveCalls(clone(state), discarder, discardTile, []);
  }

  if (state.pendingCalls[seat] !== 'waiting') {
    return reject({ code: 'already_responded' });
  }

  const meldCount = state.melds[seat].length;
  const hand = state.hands[seat];

  // Validate the action against what this seat may legally call.
  if (action === 'win') {
    if (!canWinOnDiscardTile(hand, discardTile, state.goldTileType, meldCount)) {
      return reject({ code: 'invalid_call' });
    }
  } else if (action === 'kong') {
    if (!canKong(hand, discardTile, state.goldTileType)) {
      return reject({ code: 'invalid_call' });
    }
  } else if (action === 'pung') {
    if (!canPung(hand, discardTile, state.goldTileType)) {
      return reject({ code: 'invalid_call' });
    }
  } else if (action === 'chow') {
    if (seat !== getNextSeat(discarder)) return reject({ code: 'invalid_call' });
    if (!chow) return reject({ code: 'invalid_chow_selection' });
    if (!validateChow(hand, discardTile, chow, state.goldTileType)) {
      return reject({ code: 'invalid_chow_selection' });
    }
  }

  const s = clone(state);
  const events: GameEvent[] = [];
  s.pendingCalls![seat] = action;
  if (action === 'chow' && chow) s.pendingChow = { seat, selection: chow };
  if (action === 'pass') events.push({ kind: 'passed', seat });

  // Not everyone has responded yet: stay in the calling phase.
  const stillWaiting = (Object.values(s.pendingCalls!) as string[]).some(
    (v) => v === 'waiting',
  );
  if (stillWaiting) {
    return { ok: true, state: s, events };
  }

  return resolveCalls(s, discarder, discardTile, events);
}

/** All four seats responded: resolve win > kong > pung > chow (ties among win
 * callers go to the seat closest counter-clockwise from the discarder), then
 * execute the winning call. Mutates `s`. */
function resolveCalls(
  s: EngineState,
  discarder: Seat,
  discardTile: TileId,
  events: GameEvent[],
): Result {
  const responders: Seat[] = [];
  for (let i = 1; i <= 3; i++) responders.push(((discarder + i) % 4) as Seat);

  const winner = responders.find((seat) => s.pendingCalls![seat] === 'win');
  if (winner !== undefined) {
    return executeWinCall(s, winner, discarder, discardTile, events);
  }
  const konger = responders.find((seat) => s.pendingCalls![seat] === 'kong');
  if (konger !== undefined) {
    return executeCallMeld(s, konger, 'kong', discardTile, events);
  }
  const punger = responders.find((seat) => s.pendingCalls![seat] === 'pung');
  if (punger !== undefined) {
    return executeCallMeld(s, punger, 'pung', discardTile, events);
  }
  const chower = responders.find((seat) => s.pendingCalls![seat] === 'chow');
  if (chower !== undefined) {
    return executeChowCall(s, chower, discardTile, events);
  }

  // Everyone passed: the seat after the discarder plays.
  s.phase = 'playing';
  s.pendingCalls = null;
  s.pendingChow = null;
  s.currentPlayerSeat = getNextSeat(discarder);
  return { ok: true, state: s, events };
}

function executeWinCall(
  s: EngineState,
  seat: Seat,
  discarder: Seat,
  discardTile: TileId,
  events: GameEvent[],
): Result {
  s.discardPile.pop(); // the discard is claimed
  s.hands[seat].push(discardTile);
  s.hands[seat] = sortTilesForDisplay(s.hands[seat], s.goldTileType);
  const winner = buildWinner(s, seat, [...s.hands[seat]], 0, 'discard', {
    isSelfDraw: false,
    winningTile: discardTile,
    discarderSeat: discarder,
  });
  s.phase = 'ended';
  s.endReason = 'win';
  s.winner = winner;
  s.pendingCalls = null;
  s.pendingChow = null;
  events.push({ kind: 'won', winner });
  return { ok: true, state: s, events };
}

/** Execute a pung or kong claimed from the discard. */
function executeCallMeld(
  s: EngineState,
  seat: Seat,
  type: 'pung' | 'kong',
  discardTile: TileId,
  events: GameEvent[],
): Result {
  const need = type === 'pung' ? 2 : 3;
  const tileType = getTileType(discardTile);
  const fromHand: TileId[] = [];
  for (const t of s.hands[seat]) {
    if (fromHand.length >= need) break;
    if (getTileType(t) === tileType && !isGoldTile(t, s.goldTileType)) {
      fromHand.push(t);
    }
  }
  s.hands[seat] = removeTiles(s.hands[seat], fromHand) as TileId[];
  s.discardPile.pop();
  const meld: Meld = {
    type,
    tiles: [...fromHand, discardTile],
    calledTile: discardTile,
  };
  s.melds[seat].push(meld);
  s.phase = 'playing';
  s.pendingCalls = null;
  s.pendingChow = null;
  s.currentPlayerSeat = seat;
  s.previousAction = s.lastAction;
  s.lastAction = { type, playerSeat: seat, tileType };
  events.push({ kind: 'called', seat, call: type, tile: discardTile });

  if (type === 'kong') {
    // Kong from a discard draws a replacement (bonus loop), then may win.
    s.calledTypeThisTurn = null;
    const drawn = drawWithBonus(s, seat, events, 'play');
    if (drawn === null) return endWallExhausted(s, events);
    s.hands[seat] = sortTilesForDisplay(s.hands[seat], s.goldTileType);
    const tg = maybeThreeGolds(s, seat, events);
    if (tg) return tg;
  } else {
    // Pung goes straight to a discard; the called type can't be discarded.
    s.calledTypeThisTurn = tileType;
  }
  return { ok: true, state: s, events };
}

function executeChowCall(
  s: EngineState,
  seat: Seat,
  discardTile: TileId,
  events: GameEvent[],
): Result {
  const selection = s.pendingChow?.selection;
  const fromHand = selection ? [...selection.tilesFromHand] : [];
  s.hands[seat] = removeTiles(s.hands[seat], fromHand) as TileId[];
  s.discardPile.pop();
  const tileType = getTileType(discardTile);
  const meld: Meld = {
    type: 'chow',
    tiles: sortTilesForDisplay([...fromHand, discardTile], s.goldTileType),
    calledTile: discardTile,
  };
  s.melds[seat].push(meld);
  s.phase = 'playing';
  s.pendingCalls = null;
  s.pendingChow = null;
  s.currentPlayerSeat = seat;
  s.previousAction = s.lastAction;
  s.lastAction = { type: 'chow', playerSeat: seat, tileType };
  s.calledTypeThisTurn = tileType;
  events.push({ kind: 'called', seat, call: 'chow', tile: discardTile });
  return { ok: true, state: s, events };
}

export function declareSelfDrawWin(state: EngineState, seat: Seat): Result {
  if (state.phase !== 'playing') return reject({ code: 'wrong_phase' });
  if (seat !== state.currentPlayerSeat) return reject({ code: 'not_your_turn' });
  // Ruling 2: cannot win immediately after your own pung/chow. Kong
  // replacement wins stay eligible.
  if (ruling2Blocked(state, seat)) return reject({ code: 'not_a_winning_hand' });

  const s = clone(state);
  const events: GameEvent[] = [];
  const winner = buildWinner(s, seat, [...s.hands[seat]], 0, 'self_draw', {
    isSelfDraw: true,
  });
  s.phase = 'ended';
  s.endReason = 'win';
  s.winner = winner;
  events.push({ kind: 'won', winner });
  return { ok: true, state: s, events };
}

export function declareConcealedKong(
  state: EngineState,
  seat: Seat,
  type: TileType,
): Result {
  if (state.phase !== 'playing') return reject({ code: 'wrong_phase' });
  if (seat !== state.currentPlayerSeat) return reject({ code: 'not_your_turn' });
  if (!canDeclareConcealedKong(state.hands[seat], state.goldTileType).includes(type)) {
    return reject({ code: 'invalid_kong' });
  }

  const s = clone(state);
  const events: GameEvent[] = [];
  const four = s.hands[seat].filter((t) => getTileType(t) === type).slice(0, 4);
  s.hands[seat] = removeTiles(s.hands[seat], four) as TileId[];
  s.melds[seat].push({ type: 'kong', tiles: four, isConcealed: true });
  s.previousAction = s.lastAction;
  s.lastAction = { type: 'kong', playerSeat: seat, tileType: type };
  events.push({ kind: 'concealed_kong', seat });

  const drawn = drawWithBonus(s, seat, events, 'play');
  if (drawn === null) return endWallExhausted(s, events);
  s.hands[seat] = sortTilesForDisplay(s.hands[seat], s.goldTileType);
  const tg = maybeThreeGolds(s, seat, events);
  if (tg) return tg;
  return { ok: true, state: s, events };
}

export function upgradePungToKong(
  state: EngineState,
  seat: Seat,
  meldIndex: number,
  tile: TileId,
): Result {
  if (state.phase !== 'playing') return reject({ code: 'wrong_phase' });
  if (seat !== state.currentPlayerSeat) return reject({ code: 'not_your_turn' });

  const meld = state.melds[seat][meldIndex];
  if (
    !meld ||
    meld.type !== 'pung' ||
    !state.hands[seat].includes(tile) ||
    isGoldTile(tile, state.goldTileType) ||
    getTileType(tile) !== getTileType(meld.tiles[0])
  ) {
    return reject({ code: 'invalid_kong' });
  }

  const s = clone(state);
  const events: GameEvent[] = [];
  s.hands[seat] = removeTiles(s.hands[seat], [tile]) as TileId[];
  const target = s.melds[seat][meldIndex];
  target.type = 'kong';
  target.tiles = [...target.tiles, tile];
  s.previousAction = s.lastAction;
  s.lastAction = { type: 'kong', playerSeat: seat, tileType: getTileType(tile) };
  events.push({ kind: 'kong_upgraded', seat, tile });

  const drawn = drawWithBonus(s, seat, events, 'play');
  if (drawn === null) return endWallExhausted(s, events);
  s.hands[seat] = sortTilesForDisplay(s.hands[seat], s.goldTileType);
  const tg = maybeThreeGolds(s, seat, events);
  if (tg) return tg;
  return { ok: true, state: s, events };
}

const NO_CALL: LegalActions = {
  canDraw: false,
  canDiscard: false,
  canSelfDrawWin: false,
  concealedKongTypes: [],
  pungUpgrades: [],
  call: null,
};

export function legalActions(state: EngineState, seat: Seat): LegalActions {
  if (state.phase === 'ended') return { ...NO_CALL };

  if (state.phase === 'calling') {
    if (!state.pendingCalls || state.pendingCalls[seat] !== 'waiting') {
      return { ...NO_CALL };
    }
    const discardTile = state.discardPile[state.discardPile.length - 1];
    const discarder = findDiscarder(state);
    const hand = state.hands[seat];
    const meldCount = state.melds[seat].length;
    const chowOptions: ChowOption[] =
      seat === getNextSeat(discarder)
        ? canChow(hand, discardTile, state.goldTileType)
        : [];
    return {
      ...NO_CALL,
      call: {
        canWin: canWinOnDiscardTile(hand, discardTile, state.goldTileType, meldCount),
        canKong: canKong(hand, discardTile, state.goldTileType),
        canPung: canPung(hand, discardTile, state.goldTileType),
        chowOptions,
      },
    };
  }

  // Playing phase.
  if (seat !== state.currentPlayerSeat) return { ...NO_CALL };
  const nd = needsToDraw(state);
  const hand = state.hands[seat];
  if (nd) {
    return { ...NO_CALL, canDraw: true };
  }
  const meldCount = state.melds[seat].length;
  const canSelfDrawWin =
    !ruling2Blocked(state, seat) &&
    canFormWinningHand(hand, state.goldTileType, meldCount);
  const pungUpgrades = canUpgradePungToKong(
    hand,
    state.melds[seat],
    state.goldTileType,
  ).map((u) => ({ meldIndex: u.meldIndex, tile: u.tileFromHand }));
  return {
    canDraw: false,
    canDiscard: true,
    canSelfDrawWin,
    concealedKongTypes: canDeclareConcealedKong(hand, state.goldTileType),
    pungUpgrades,
    call: null,
  };
}
