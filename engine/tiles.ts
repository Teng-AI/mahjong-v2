// Tile utilities. Surface mirrors v1 lib/tiles.ts (spec section 4.1) so the
// 66 ported tiles tests run with import-path changes only.
// This file is PARTIAL: only the adapter-proof functions are implemented.
// Remaining functions land per design-engine-api.md before mass test porting.

import type { ChowOption, Meld, ParsedTile, TileId, TileType } from './types';

const SUITS = ['dots', 'bamboo', 'characters'] as const;
const WINDS = ['east', 'south', 'west', 'north'] as const;

/** All 128 tile instance ids: 108 suit + 16 wind + 4 dragon, 4 copies each type. */
export function generateAllTiles(): TileId[] {
  const tiles: TileId[] = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push(`${suit}_${value}_${copy}`);
      }
    }
  }
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push(`wind_${wind}_${copy}`);
    }
  }
  for (let copy = 0; copy < 4; copy++) {
    tiles.push(`dragon_red_${copy}`);
  }
  return tiles;
}

/** Fisher-Yates copy. rng in [0,1); injected so games and tests stay deterministic. */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Strip the instance suffix: "dots_5_2" -> "dots_5". */
export function getTileType(tile: TileId): TileType {
  return tile.slice(0, tile.lastIndexOf('_'));
}

export function isSuitTile(tile: TileId): boolean {
  return (
    tile.startsWith('dots_') ||
    tile.startsWith('bamboo_') ||
    tile.startsWith('characters_')
  );
}

/** Winds and dragons; never held in hands, exposed for points when drawn. */
export function isBonusTile(tile: TileId): boolean {
  return tile.startsWith('wind_') || tile.startsWith('dragon_');
}

export function isGoldTile(tile: TileId, goldType: TileType): boolean {
  return getTileType(tile) === goldType;
}

export function countGoldTiles(tiles: TileId[], goldType: TileType): number {
  return tiles.filter((t) => isGoldTile(t, goldType)).length;
}

/**
 * Pung on a discard: 2 matching non-gold copies in hand.
 * Gold or bonus discards are never callable; golds in hand never count.
 */
export function canPung(
  hand: TileId[],
  discard: TileId,
  goldType: TileType,
): boolean {
  if (isBonusTile(discard) || isGoldTile(discard, goldType)) return false;
  const type = getTileType(discard);
  const matches = hand.filter(
    (t) => getTileType(t) === type && !isGoldTile(t, goldType),
  ).length;
  return matches >= 2;
}

const SUIT_ORDER: readonly string[] = ['dots', 'bamboo', 'characters'];
const WIND_ORDER: readonly string[] = ['east', 'south', 'west', 'north'];

/** Split a tile id into its structural parts (category/suit/value/instance). */
export function parseTile(tileId: TileId): ParsedTile {
  const parts = tileId.split('_');
  const instance = Number(parts[parts.length - 1]);
  if (parts[0] === 'dots' || parts[0] === 'bamboo' || parts[0] === 'characters') {
    return {
      category: 'suit',
      suit: parts[0] as ParsedTile['suit'],
      value: Number(parts[1]),
      instance,
    };
  }
  if (parts[0] === 'wind') {
    return { category: 'wind', value: parts[1], instance };
  }
  return { category: 'dragon', value: parts[1], instance };
}

// --- Winning-hand backtracker -------------------------------------------------
// Works on TYPE counts: three suit arrays (index 1..9) plus an honors map. Golds
// are a plain count of wildcards that can fill any slot in a set or the pair.
// Every real tile must be consumed; leftover golds fill complete gold-only groups.

interface WinCounts {
  suits: number[][]; // [suitIndex][value 1..9]
  honors: Map<string, number>;
}

function buildWinCounts(nonGoldTiles: TileId[]): WinCounts {
  const suits = [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)];
  const honors = new Map<string, number>();
  for (const tile of nonGoldTiles) {
    const p = parseTile(tile);
    if (p.category === 'suit') {
      suits[SUIT_ORDER.indexOf(p.suit as string)][p.value as number]++;
    } else {
      const type = getTileType(tile);
      honors.set(type, (honors.get(type) ?? 0) + 1);
    }
  }
  return { suits, honors };
}

function solveWin(
  c: WinCounts,
  golds: number,
  sets: number,
  needPair: boolean,
): boolean {
  // Smallest present real suit tile must be resolved here.
  for (let s = 0; s < 3; s++) {
    const arr = c.suits[s];
    for (let v = 1; v <= 9; v++) {
      if (arr[v] > 0) {
        // Pung (v, v, v)
        if (sets > 0) {
          for (let a = 1; a <= Math.min(3, arr[v]); a++) {
            const g = 3 - a;
            if (golds >= g) {
              arr[v] -= a;
              const ok = solveWin(c, golds - g, sets - 1, needPair);
              arr[v] += a;
              if (ok) return true;
            }
          }
        }
        // Chow: v may sit in the low, middle, or high slot (ruling 5 re-ruled
        // 2026-07-22: golds substitute anywhere, including below the lowest
        // real tile). Slots below v hold no real tiles (v is the smallest
        // present), so the real-tile branch skips them and golds fill in.
        if (sets > 0) {
          for (const start of [v - 2, v - 1, v]) {
            if (start < 1 || start + 2 > 9) continue;
            const slots = [start, start + 1, start + 2].filter((x) => x !== v);
            for (const r1 of [true, false]) {
              for (const r2 of [true, false]) {
                if (r1 && arr[slots[0]] < 1) continue;
                if (r2 && arr[slots[1]] < 1) continue;
                const need = (r1 ? 0 : 1) + (r2 ? 0 : 1);
                if (golds < need) continue;
                arr[v]--;
                if (r1) arr[slots[0]]--;
                if (r2) arr[slots[1]]--;
                const ok = solveWin(c, golds - need, sets - 1, needPair);
                arr[v]++;
                if (r1) arr[slots[0]]++;
                if (r2) arr[slots[1]]++;
                if (ok) return true;
              }
            }
          }
        }
        // Pair (v, v)
        if (needPair) {
          for (let a = 1; a <= Math.min(2, arr[v]); a++) {
            const g = 2 - a;
            if (golds >= g) {
              arr[v] -= a;
              const ok = solveWin(c, golds - g, sets, false);
              arr[v] += a;
              if (ok) return true;
            }
          }
        }
        return false;
      }
    }
  }
  // Smallest present honor tile (pung/pair only; honors never chow).
  for (const [key, count] of c.honors) {
    if (count > 0) {
      if (sets > 0) {
        for (let a = 1; a <= Math.min(3, count); a++) {
          const g = 3 - a;
          if (golds >= g) {
            c.honors.set(key, count - a);
            const ok = solveWin(c, golds - g, sets - 1, needPair);
            c.honors.set(key, count);
            if (ok) return true;
          }
        }
      }
      if (needPair) {
        for (let a = 1; a <= Math.min(2, count); a++) {
          const g = 2 - a;
          if (golds >= g) {
            c.honors.set(key, count - a);
            const ok = solveWin(c, golds - g, sets, false);
            c.honors.set(key, count);
            if (ok) return true;
          }
        }
      }
      return false;
    }
  }
  // No real tiles left: remaining golds must exactly fill the outstanding slots.
  return golds === sets * 3 + (needPair ? 2 : 0);
}

/**
 * Whether tiles can form a winning hand (5 sets + 1 pair total; gold tiles
 * act as wildcards). exposedMeldCount reduces the sets required from the
 * concealed tiles passed in.
 */
export function canFormWinningHand(
  tiles: TileId[],
  goldTileType: TileType,
  exposedMeldCount: number = 0,
): boolean {
  const golds = countGoldTiles(tiles, goldTileType);
  const nonGold = tiles.filter((t) => !isGoldTile(t, goldTileType));
  const setsNeeded = 5 - exposedMeldCount;
  if (setsNeeded < 0) return false;
  const counts = buildWinCounts(nonGold);
  return solveWin(counts, golds, setsNeeded, true);
}

/** Whether the 2 Gold tiles in hand are serving as the pair (not a wildcard set). */
export function hasGoldenPair(
  tiles: TileId[],
  goldTileType: TileType,
  exposedMeldCount: number = 0,
): boolean {
  if (countGoldTiles(tiles, goldTileType) !== 2) return false;
  const nonGold = tiles.filter((t) => !isGoldTile(t, goldTileType));
  const setsNeeded = 5 - exposedMeldCount;
  if (setsNeeded < 0) return false;
  // Golds are the pair: the rest must form all sets with zero wildcard use.
  const counts = buildWinCounts(nonGold);
  return solveWin(counts, 0, setsNeeded, false);
}

/** All valid Chow sequences formable with `discardTile` plus 2 tiles from hand. */
export function canChow(
  hand: TileId[],
  discardTile: TileId,
  goldTileType: TileType,
): ChowOption[] {
  if (isBonusTile(discardTile) || isGoldTile(discardTile, goldTileType)) return [];
  if (!isSuitTile(discardTile)) return [];
  const p = parseTile(discardTile);
  const suit = p.suit as string;
  const v = p.value as number;

  // Non-gold hand tiles of the discard's suit, indexed by value.
  const byValue = new Map<number, TileId[]>();
  for (const tile of hand) {
    if (isGoldTile(tile, goldTileType)) continue;
    if (!isSuitTile(tile)) continue;
    const tp = parseTile(tile);
    if ((tp.suit as string) !== suit) continue;
    const val = tp.value as number;
    const list = byValue.get(val) ?? [];
    list.push(tile);
    byValue.set(val, list);
  }

  const options: ChowOption[] = [];
  // Three windows where the discard can sit: low, middle, high.
  for (const start of [v - 2, v - 1, v]) {
    if (start < 1 || start + 2 > 9) continue;
    const need = [start, start + 1, start + 2].filter((x) => x !== v);
    const t1 = byValue.get(need[0])?.[0];
    const t2 = byValue.get(need[1])?.[0];
    if (t1 && t2) {
      options.push({
        tilesFromHand: [t1, t2],
        sequence: [
          `${suit}_${start}`,
          `${suit}_${start + 1}`,
          `${suit}_${start + 2}`,
        ],
      });
    }
  }
  return options;
}

/** Whether hand + discardTile forms a winning hand (Ron). */
export function canWinOnDiscard(
  hand: TileId[],
  discardTile: TileId,
  goldTileType: TileType,
  exposedMeldCount: number = 0,
): boolean {
  return canFormWinningHand([...hand, discardTile], goldTileType, exposedMeldCount);
}

/** Remove each tile id in `toRemove` from `tiles`; null if any id is missing. */
export function removeTiles(
  tiles: TileId[],
  toRemove: TileId[],
): TileId[] | null {
  const out = [...tiles];
  for (const tile of toRemove) {
    const idx = out.indexOf(tile);
    if (idx === -1) return null;
    out.splice(idx, 1);
  }
  return out;
}

function displayKey(tile: TileId, goldTileType: TileType | null): [number, number, number] {
  if (goldTileType && isGoldTile(tile, goldTileType)) return [0, 0, 0];
  const p = parseTile(tile);
  if (p.category === 'suit') {
    return [1, SUIT_ORDER.indexOf(p.suit as string), p.value as number];
  }
  if (p.category === 'wind') {
    return [2, WIND_ORDER.indexOf(p.value as string), 0];
  }
  return [3, 0, 0];
}

/** Sort a hand for display: Golds first, then suit/wind/dragon, then value. */
export function sortTilesForDisplay(
  tiles: TileId[],
  goldTileType: TileType | null,
): TileId[] {
  return [...tiles].sort((a, b) => {
    const ka = displayKey(a, goldTileType);
    const kb = displayKey(b, goldTileType);
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Whether hand has >= 3 matching non-gold copies of discardTile's type (Kong on discard). */
export function canKong(
  hand: TileId[],
  discardTile: TileId,
  goldTileType: TileType,
): boolean {
  if (isBonusTile(discardTile) || isGoldTile(discardTile, goldTileType)) return false;
  const type = getTileType(discardTile);
  const matches = hand.filter(
    (t) => getTileType(t) === type && !isGoldTile(t, goldTileType),
  ).length;
  return matches >= 3;
}

/** Tile types with 4 copies in hand (excluding Gold/bonus), eligible for concealed Kong. */
export function canDeclareConcealedKong(
  hand: TileId[],
  goldTileType: TileType,
): TileType[] {
  const counts = new Map<TileType, number>();
  for (const tile of hand) {
    if (isBonusTile(tile) || isGoldTile(tile, goldTileType)) continue;
    const type = getTileType(tile);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const result: TileType[] = [];
  for (const [type, count] of counts) {
    if (count === 4) result.push(type);
  }
  return result;
}

/** Exposed Pungs upgradeable to Kong using a matching tile from hand. */
export function canUpgradePungToKong(
  hand: TileId[],
  exposedMelds: Meld[],
  goldTileType: TileType,
): { meldIndex: number; tileFromHand: TileId }[] {
  const result: { meldIndex: number; tileFromHand: TileId }[] = [];
  exposedMelds.forEach((meld, meldIndex) => {
    if (meld.type !== 'pung') return;
    const type = getTileType(meld.tiles[0]);
    if (type === goldTileType) return; // gold can never be melded/upgraded
    const tileFromHand = hand.find(
      (t) => getTileType(t) === type && !isGoldTile(t, goldTileType),
    );
    if (tileFromHand) result.push({ meldIndex, tileFromHand });
  });
  return result;
}

// --- Safe-discard scorer ------------------------------------------------------
// Ranks a candidate by evaluating the hand left AFTER discarding it: keep whatever
// leaves the most structure (complete sets > pairs/partial runs > isolated).

const SET_SCORE = 100;
const PAIR_SCORE = 10;
const PARTIAL_SCORE = 10;

function bestSuitValue(counts: number[], from: number): number {
  let i = from;
  while (i <= 9 && counts[i] === 0) i++;
  if (i > 9) return 0;
  let best = 0;
  // Pung
  if (counts[i] >= 3) {
    counts[i] -= 3;
    best = Math.max(best, SET_SCORE + bestSuitValue(counts, i));
    counts[i] += 3;
  }
  // Chow
  if (i <= 7 && counts[i] >= 1 && counts[i + 1] >= 1 && counts[i + 2] >= 1) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    best = Math.max(best, SET_SCORE + bestSuitValue(counts, i));
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  // Pair
  if (counts[i] >= 2) {
    counts[i] -= 2;
    best = Math.max(best, PAIR_SCORE + bestSuitValue(counts, i));
    counts[i] += 2;
  }
  // Partial run (i, i+1)
  if (i <= 8 && counts[i] >= 1 && counts[i + 1] >= 1) {
    counts[i]--; counts[i + 1]--;
    best = Math.max(best, PARTIAL_SCORE + bestSuitValue(counts, i));
    counts[i]++; counts[i + 1]++;
  }
  // Partial gap (i, i+2)
  if (i <= 7 && counts[i] >= 1 && counts[i + 2] >= 1) {
    counts[i]--; counts[i + 2]--;
    best = Math.max(best, PARTIAL_SCORE + bestSuitValue(counts, i));
    counts[i]++; counts[i + 2]++;
  }
  // Isolated: drop one copy of i
  counts[i]--;
  best = Math.max(best, bestSuitValue(counts, i));
  counts[i]++;
  return best;
}

function handStructureValue(tiles: TileId[]): number {
  const suits = [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)];
  const honors = new Map<string, number>();
  for (const tile of tiles) {
    if (isSuitTile(tile)) {
      const p = parseTile(tile);
      suits[SUIT_ORDER.indexOf(p.suit as string)][p.value as number]++;
    } else {
      const type = getTileType(tile);
      honors.set(type, (honors.get(type) ?? 0) + 1);
    }
  }
  let total = 0;
  for (const arr of suits) total += bestSuitValue(arr, 1);
  for (const count of honors.values()) {
    if (count >= 3) total += SET_SCORE;
    else if (count === 2) total += PAIR_SCORE;
  }
  return total;
}

/** Choose a discard that preserves the most sets (turn-timer auto-play / bots). */
export function selectSafeDiscard(
  hand: TileId[],
  goldTileType: TileType,
  _discardPile?: TileId[],
): TileId | null {
  let bestTile: TileId | null = null;
  let bestScore = -Infinity;
  const seen = new Set<TileId>();
  for (let idx = 0; idx < hand.length; idx++) {
    const tile = hand[idx];
    if (isGoldTile(tile, goldTileType)) continue; // never discard gold
    if (seen.has(tile)) continue;
    seen.add(tile);
    const remaining = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
    const score = handStructureValue(remaining);
    if (score > bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }
  return bestTile;
}
