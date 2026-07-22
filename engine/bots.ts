// Bot decision module. Contract: design-server-loop.md section 4 (BotIntent +
// chooseBotAction signature) and research-v1-spec.md section 5 (behavior
// constants). Pure TS, deterministic given (view, legal, difficulty): no
// Date.now / Math.random, never mutates its inputs.
//
// The bot sees ONLY a redacted SeatView plus the engine-computed LegalActions.
// Every intent it returns is one the LegalActions object already permits, so a
// bot can never propose an illegal move (property test drives full games and
// asserts every intent is accepted by the engine).

import {
  getTileType,
  isBonusTile,
  isGoldTile,
  isSuitTile,
  parseTile,
} from './tiles';
import type {
  CallAction,
  ChowSelection,
  LegalActions,
  Seat,
  SeatView,
  TileId,
  TileType,
} from './types';

export type Difficulty = 'easy' | 'medium' | 'hard';

export type BotIntent =
  | { kind: 'draw' }
  | { kind: 'discard'; tile: TileId }
  | { kind: 'selfDrawWin' }
  | { kind: 'concealedKong'; tileType: TileType }
  | { kind: 'upgradeKong'; meldIndex: number }
  | { kind: 'respond'; action: CallAction; chowSelection?: ChowSelection };

const SEATS: Seat[] = [0, 1, 2, 3];
const SUIT_INDEX: Record<string, number> = { dots: 0, bamboo: 1, characters: 2 };

// Pung/chow call thresholds (max allowed shanten delta = after - before).
// Resolved ambiguity (see report): the task defines easy as "shanten doesn't
// worsen by more than 0" and medium as "same-or-better" -- both are delta <= 0,
// so easy and medium share a threshold. hard requires strict improvement
// (delta < 0). This is not just a literal reading: because claiming a meld
// hands the bot a free set (setsNeeded drops by 1), no legal pung/chow offer
// can ever *worsen* shanten by more than 0, so easy and medium would coincide
// in practice regardless. The difficulties still differ because hard is strict,
// tightens near the wall's end, and adds the defensive fold below.
const EASY_MAX_DELTA = 0;
const MEDIUM_MAX_DELTA = 0;
const HARD_MAX_DELTA = -1; // strict improvement

// Hard tightens near wall end: only call if the resulting hand is close (<= this).
const HARD_LATE_WALL = 20;
const HARD_LATE_MAX_SHANTEN = 2;

// Defensive fold thresholds (hard only).
const FOLD_OPP_MELDS = 3;
const FOLD_SHANTEN_VS_MELDS = 3;
const FOLD_WALL = 15;
const FOLD_SHANTEN_LATE = 2;

// --- Shanten estimator --------------------------------------------------------
// Minimum shanten of a concealed hand toward `setsNeeded` sets + 1 pair, with
// gold tiles treated as jokers. Approach (3 sentences):
// (1) Split the hand into gold jokers and real suit tiles counted per suit/value,
//     then recursively decompose the REAL tiles into complete sets, partial
//     blocks (pairs and protoruns) and floaters, always resolving the lowest
//     present tile so the search is finite and deduplicated by a visited set.
// (2) Each decomposition is scored with the standard block formula
//     (2*setsNeeded - 2*melds - partials, capped at setsNeeded+1 blocks, +1 when
//     no block can serve as the pair) and the best (lowest) score is kept.
// (3) Jokers are then subtracted one-for-one (each fills one missing tile),
//     floored at -1 (a completed hand); this is approximate but monotonic, which
//     is all the bot needs since the engine, not the estimator, validates wins.

function shanten(tiles: TileId[], goldType: TileType, setsNeeded: number): number {
  const need = setsNeeded < 0 ? 0 : setsNeeded;
  let jokers = 0;
  const suits = [
    new Array<number>(10).fill(0),
    new Array<number>(10).fill(0),
    new Array<number>(10).fill(0),
  ];
  const honors = new Map<string, number>();
  for (const t of tiles) {
    if (isGoldTile(t, goldType)) {
      jokers++;
      continue;
    }
    if (isBonusTile(t)) continue; // never in a real hand; ignore defensively
    if (isSuitTile(t)) {
      const p = parseTile(t);
      suits[SUIT_INDEX[p.suit as string]][p.value as number]++;
    } else {
      const ty = getTileType(t);
      honors.set(ty, (honors.get(ty) ?? 0) + 1);
    }
  }

  const cap = need + 1; // at most `need` sets + 1 pair worth of blocks
  const honorKeys = [...honors.keys()];
  let best = Infinity;
  const visited = new Set<string>();

  function score(melds: number, partials: number, pair: boolean): number {
    let p = partials;
    if (melds + p > cap) p = cap - melds;
    if (p < 0) p = 0;
    let sh = 2 * need - 2 * melds - p;
    if (melds + p === cap && !pair) sh += 1;
    return sh;
  }

  function key(melds: number, partials: number, pair: boolean, hi: number): string {
    let k = `${melds},${partials},${pair ? 1 : 0},${hi}|`;
    for (let s = 0; s < 3; s++) k += suits[s].join('') + '.';
    for (const hk of honorKeys) k += (honors.get(hk) ?? 0) + '.';
    return k;
  }

  function recHonors(melds: number, partials: number, pair: boolean, hi: number): void {
    if (hi >= honorKeys.length) {
      const sh = score(melds, partials, pair);
      if (sh < best) best = sh;
      return;
    }
    const hk = honorKeys[hi];
    const c = honors.get(hk) ?? 0;
    const blocksFull = melds + partials >= cap;
    if (c >= 3 && !blocksFull) {
      honors.set(hk, c - 3);
      recHonors(melds + 1, partials, pair, hi);
      honors.set(hk, c);
    }
    if (c >= 2 && !blocksFull) {
      honors.set(hk, c - 2);
      recHonors(melds, partials + 1, true, hi);
      honors.set(hk, c);
    }
    // Move past this honor type (leftover copies are floaters).
    recHonors(melds, partials, pair, hi + 1);
  }

  function rec(melds: number, partials: number, pair: boolean): void {
    const k = key(melds, partials, pair, -1);
    if (visited.has(k)) return;
    visited.add(k);

    // Optimistic bound: even filling every block, we can't beat this.
    if (score(melds, partials, pair) - jokers >= best) return;

    let s = -1;
    let v = -1;
    outer: for (let si = 0; si < 3; si++) {
      for (let vi = 1; vi <= 9; vi++) {
        if (suits[si][vi] > 0) {
          s = si;
          v = vi;
          break outer;
        }
      }
    }
    if (s === -1) {
      recHonors(melds, partials, pair, 0);
      return;
    }

    const arr = suits[s];
    const blocksFull = melds + partials >= cap;

    if (!blocksFull) {
      // Triplet
      if (arr[v] >= 3) {
        arr[v] -= 3;
        rec(melds + 1, partials, pair);
        arr[v] += 3;
      }
      // Run v,v+1,v+2
      if (v <= 7 && arr[v + 1] >= 1 && arr[v + 2] >= 1) {
        arr[v]--; arr[v + 1]--; arr[v + 2]--;
        rec(melds + 1, partials, pair);
        arr[v]++; arr[v + 1]++; arr[v + 2]++;
      }
      // Pair
      if (arr[v] >= 2) {
        arr[v] -= 2;
        rec(melds, partials + 1, true);
        arr[v] += 2;
      }
      // Partial protorun v,v+1
      if (v <= 8 && arr[v + 1] >= 1) {
        arr[v]--; arr[v + 1]--;
        rec(melds, partials + 1, pair);
        arr[v]++; arr[v + 1]++;
      }
      // Partial gap v,v+2
      if (v <= 7 && arr[v + 2] >= 1) {
        arr[v]--; arr[v + 2]--;
        rec(melds, partials + 1, pair);
        arr[v]++; arr[v + 2]++;
      }
    }
    // Floater: drop one copy of v.
    arr[v]--;
    rec(melds, partials, pair);
    arr[v]++;
  }

  rec(0, 0, false);
  const result = best - jokers;
  return result < -1 ? -1 : result;
}

// --- Helpers ------------------------------------------------------------------

/** Remove the given tile ids (by exact id) from a hand copy. */
function without(hand: TileId[], ids: TileId[]): TileId[] {
  const out = [...hand];
  for (const id of ids) {
    const i = out.indexOf(id);
    if (i !== -1) out.splice(i, 1);
  }
  return out;
}

/** Count, per tile TYPE, how many copies are publicly visible (discard pile +
 * every exposed meld tile). Higher = safer to discard (fewer live copies). */
function seenByType(view: SeatView): Map<TileType, number> {
  const seen = new Map<TileType, number>();
  const bump = (id: TileId) => {
    const ty = getTileType(id);
    seen.set(ty, (seen.get(ty) ?? 0) + 1);
  };
  for (const id of view.discardPile) bump(id);
  for (const seat of SEATS) {
    for (const meld of view.melds[seat]) {
      for (const id of meld.tiles) bump(id); // hidden concealed kongs expose []
    }
  }
  return seen;
}

function opponentShowsManyMelds(view: SeatView, viewer: Seat): boolean {
  return SEATS.some(
    (s) => s !== viewer && view.melds[s].length >= FOLD_OPP_MELDS,
  );
}

function maxDeltaFor(difficulty: Difficulty): number {
  if (difficulty === 'easy') return EASY_MAX_DELTA;
  if (difficulty === 'medium') return MEDIUM_MAX_DELTA;
  return HARD_MAX_DELTA;
}

// --- Discard choice -----------------------------------------------------------

interface DiscardChoice {
  tile: TileId;
  shanten: number;
  safety: number;
}

/** Rank legal discard candidates (own hand minus gold minus the just-called
 * type) by resulting shanten, then safety. Returns the ranked list plus the
 * best reachable shanten (used by the defensive fold check). */
function rankDiscards(
  view: SeatView,
  viewer: Seat,
): { choices: DiscardChoice[]; bestShanten: number } {
  const hand = view.ownHand ?? [];
  const gold = view.goldTileType;
  const called = view.calledTypeThisTurn;
  const meldCount = view.melds[viewer].length;
  const setsNeeded = 5 - meldCount;
  const seen = seenByType(view);

  // Group by type: removing any instance of a type yields the same shanten and
  // the same safety, so evaluate one representative (smallest id) per type.
  const repByType = new Map<TileType, TileId>();
  for (const id of hand) {
    if (isGoldTile(id, gold)) continue;
    const ty = getTileType(id);
    if (called !== null && ty === called) continue;
    const cur = repByType.get(ty);
    if (cur === undefined || id < cur) repByType.set(ty, id);
  }

  const choices: DiscardChoice[] = [];
  for (const [ty, rep] of repByType) {
    const remaining = without(hand, [rep]);
    choices.push({
      tile: rep,
      shanten: shanten(remaining, gold, setsNeeded),
      safety: seen.get(ty) ?? 0,
    });
  }
  // Deterministic fallback: if every tile was gold/called-type (never happens
  // with a real hand), discard the lowest-id non-gold tile.
  if (choices.length === 0) {
    const fallback = [...hand]
      .filter((id) => !isGoldTile(id, gold))
      .sort()[0] ?? hand[0];
    choices.push({ tile: fallback, shanten: 0, safety: 0 });
  }

  let bestShanten = Infinity;
  for (const c of choices) if (c.shanten < bestShanten) bestShanten = c.shanten;
  return { choices, bestShanten };
}

function pickDiscard(view: SeatView, viewer: Seat, defensive: boolean): TileId {
  const { choices } = rankDiscards(view, viewer);
  const sorted = [...choices].sort((a, b) => {
    if (defensive) {
      if (a.safety !== b.safety) return b.safety - a.safety; // safer first
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
    } else {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten; // lowest shanten
      if (a.safety !== b.safety) return b.safety - a.safety;
    }
    return a.tile < b.tile ? -1 : a.tile > b.tile ? 1 : 0;
  });
  return sorted[0].tile;
}

// --- Calling-phase pung/chow evaluation --------------------------------------

interface CallCandidate {
  shantenAfter: number;
  intent: BotIntent;
  isPung: boolean;
}

function evaluateCall(
  view: SeatView,
  legal: LegalActions,
  viewer: Seat,
  difficulty: Difficulty,
): BotIntent {
  const call = legal.call!;
  const hand = view.ownHand ?? [];
  const gold = view.goldTileType;
  const meldCount = view.melds[viewer].length;
  const setsNeeded = 5 - meldCount;
  const before = shanten(hand, gold, setsNeeded);
  const discardTile = view.discardPile[view.discardPile.length - 1];

  const PASS: BotIntent = { kind: 'respond', action: 'pass' };

  // Defensive fold (hard only): decline pung/chow when far from a win and under
  // pressure, or deep into the wall. Win/kong were already handled by the caller.
  if (difficulty === 'hard') {
    const fold =
      (before >= FOLD_SHANTEN_VS_MELDS && opponentShowsManyMelds(view, viewer)) ||
      (view.wallCount < FOLD_WALL && before >= FOLD_SHANTEN_LATE);
    if (fold) return PASS;
  }

  const candidates: CallCandidate[] = [];

  if (call.canPung) {
    const type = getTileType(discardTile);
    const two: TileId[] = [];
    for (const id of hand) {
      if (two.length >= 2) break;
      if (getTileType(id) === type && !isGoldTile(id, gold)) two.push(id);
    }
    if (two.length === 2) {
      candidates.push({
        shantenAfter: shanten(without(hand, two), gold, setsNeeded - 1),
        intent: { kind: 'respond', action: 'pung' },
        isPung: true,
      });
    }
  }

  for (const opt of call.chowOptions) {
    const after = without(hand, [...opt.tilesFromHand]);
    candidates.push({
      shantenAfter: shanten(after, gold, setsNeeded - 1),
      intent: {
        kind: 'respond',
        action: 'chow',
        chowSelection: { tilesFromHand: opt.tilesFromHand },
      },
      isPung: false,
    });
  }

  if (candidates.length === 0) return PASS;

  // Best = lowest resulting shanten; tie-break prefers pung, then declaration order.
  let best = candidates[0];
  for (const c of candidates) {
    if (
      c.shantenAfter < best.shantenAfter ||
      (c.shantenAfter === best.shantenAfter && c.isPung && !best.isPung)
    ) {
      best = c;
    }
  }

  const delta = best.shantenAfter - before;
  let callable = delta <= maxDeltaFor(difficulty);
  if (difficulty === 'hard' && view.wallCount < HARD_LATE_WALL) {
    callable = callable && best.shantenAfter <= HARD_LATE_MAX_SHANTEN;
  }
  return callable ? best.intent : PASS;
}

// --- Entry point --------------------------------------------------------------

/**
 * Decide a legal intent for a bot seat from its redacted view + legal actions.
 * Deterministic: same (view, legal, difficulty) always yields the same intent.
 * Behavior per spec §5: always win, always kong on a discard, always concealed
 * kong / pung upgrade, pung/chow via shanten thresholds, hard defensive fold.
 */
export function chooseBotAction(
  view: SeatView,
  legal: LegalActions,
  difficulty: Difficulty,
): BotIntent {
  const viewer = (view.viewerSeat ?? view.currentPlayerSeat) as Seat;

  // Calling phase: respond to an open discard.
  if (legal.call) {
    if (legal.call.canWin) return { kind: 'respond', action: 'win' };
    if (legal.call.canKong) return { kind: 'respond', action: 'kong' };
    return evaluateCall(view, legal, viewer, difficulty);
  }

  // Playing phase.
  if (legal.canDraw) return { kind: 'draw' };
  if (legal.canSelfDrawWin) return { kind: 'selfDrawWin' };
  if (legal.concealedKongTypes.length > 0) {
    return { kind: 'concealedKong', tileType: legal.concealedKongTypes[0] };
  }
  if (legal.pungUpgrades.length > 0) {
    return { kind: 'upgradeKong', meldIndex: legal.pungUpgrades[0].meldIndex };
  }

  // Discard: hard folds to safe tiles when far from a win and under pressure.
  let defensive = false;
  if (difficulty === 'hard') {
    const { bestShanten } = rankDiscards(view, viewer);
    defensive =
      (bestShanten >= FOLD_SHANTEN_VS_MELDS && opponentShowsManyMelds(view, viewer)) ||
      (view.wallCount < FOLD_WALL && bestShanten >= FOLD_SHANTEN_LATE);
  }
  return { kind: 'discard', tile: pickDiscard(view, viewer, defensive) };
}
