// Display-only tile rendering helpers. Pure presentation math: parses a
// TileId's grammar (engine/tiles.ts owns the authoritative parser; reused
// here for display, not for any rule decision) and returns a text label +
// color class. No unicode mahjong glyphs: iOS font coverage for that block
// (U+1F000-1F02B) is poor and renders as tofu/emoji. Text labels on a white
// rounded-rect (v1's proven pattern) render correctly everywhere.

import { parseTile } from '../../engine';
import type { TileId } from '../../engine';

const WIND_LABEL: Record<string, string> = {
  east: '東',
  south: '南',
  west: '西',
  north: '北',
};

export interface TileDisplay {
  label: string;
  colorClass: string; // tailwind text color for the label
}

/** Suit colors: dots red, bamboo blue, characters green, winds/dragon slate/red. */
export function tileDisplay(tile: TileId): TileDisplay {
  const p = parseTile(tile);
  if (p.category === 'suit') {
    const value = p.value as number;
    if (p.suit === 'dots') {
      return { label: `${value}●`, colorClass: 'text-red-600' };
    }
    if (p.suit === 'bamboo') {
      return { label: `${value}‖`, colorClass: 'text-blue-600' };
    }
    return { label: `${value}萬`, colorClass: 'text-green-700' };
  }
  if (p.category === 'wind') {
    const dir = p.value as string;
    return { label: WIND_LABEL[dir] ?? dir, colorClass: 'text-slate-700' };
  }
  // dragon (red only, per engine/tiles.ts)
  return { label: '中', colorClass: 'text-red-600' };
}
