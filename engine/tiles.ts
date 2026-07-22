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

// ---------------------------------------------------------------------------
// Stubs below: signatures per design-engine-api.md + v1 lib/tiles.ts (spec
// 4.1). Not yet implemented; land per M1 implementation plan.
// ---------------------------------------------------------------------------

/** Split a tile id into its structural parts (category/suit/value/instance). */
export function parseTile(_tileId: TileId): ParsedTile {
  throw new Error('not implemented');
}

/**
 * Whether tiles can form a winning hand (5 sets + 1 pair total; gold tiles
 * act as wildcards). exposedMeldCount reduces the sets required from the
 * concealed tiles passed in.
 */
export function canFormWinningHand(
  _tiles: TileId[],
  _goldTileType: TileType,
  _exposedMeldCount: number = 0,
): boolean {
  throw new Error('not implemented');
}

/** Whether the 2 Gold tiles in hand are serving as the pair (not a wildcard set). */
export function hasGoldenPair(
  _tiles: TileId[],
  _goldTileType: TileType,
  _exposedMeldCount: number = 0,
): boolean {
  throw new Error('not implemented');
}

/** All valid Chow sequences formable with `discardTile` plus 2 tiles from hand. */
export function canChow(
  _hand: TileId[],
  _discardTile: TileId,
  _goldTileType: TileType,
): ChowOption[] {
  throw new Error('not implemented');
}

/** Whether hand + discardTile forms a winning hand (Ron). */
export function canWinOnDiscard(
  _hand: TileId[],
  _discardTile: TileId,
  _goldTileType: TileType,
  _exposedMeldCount: number = 0,
): boolean {
  throw new Error('not implemented');
}

/** Remove each tile id in `toRemove` from `tiles`; null if any id is missing. */
export function removeTiles(
  _tiles: TileId[],
  _toRemove: TileId[],
): TileId[] | null {
  throw new Error('not implemented');
}

/** Sort a hand for display: Golds first, then suit/wind/dragon, then value. */
export function sortTilesForDisplay(
  _tiles: TileId[],
  _goldTileType: TileType | null,
): TileId[] {
  throw new Error('not implemented');
}

/** Whether hand has >= 3 matching non-gold copies of discardTile's type (Kong on discard). */
export function canKong(
  _hand: TileId[],
  _discardTile: TileId,
  _goldTileType: TileType,
): boolean {
  throw new Error('not implemented');
}

/** Tile types with 4 copies in hand (excluding Gold/bonus), eligible for concealed Kong. */
export function canDeclareConcealedKong(
  _hand: TileId[],
  _goldTileType: TileType,
): TileType[] {
  throw new Error('not implemented');
}

/** Exposed Pungs upgradeable to Kong using a matching tile from hand. */
export function canUpgradePungToKong(
  _hand: TileId[],
  _exposedMelds: Meld[],
  _goldTileType: TileType,
): { meldIndex: number; tileFromHand: TileId }[] {
  throw new Error('not implemented');
}

/** Choose a discard that preserves the most sets (turn-timer auto-play / bots). */
export function selectSafeDiscard(
  _hand: TileId[],
  _goldTileType: TileType,
  _discardPile?: TileId[],
): TileId | null {
  throw new Error('not implemented');
}
