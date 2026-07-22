// Tile utilities. Surface mirrors v1 lib/tiles.ts (spec section 4.1) so the
// 66 ported tiles tests run with import-path changes only.
// This file is PARTIAL: only the adapter-proof functions are implemented.
// Remaining functions land per design-engine-api.md before mass test porting.

import type { TileId, TileType } from './types';

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
