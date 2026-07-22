// Display-only tile rendering helpers. Pure presentation math: parses a
// TileId's grammar (engine/tiles.ts owns the authoritative parser; reused
// here for display, not for any rule decision) and returns glyph/label/color.

import { parseTile } from '../../engine';
import type { TileId } from '../../engine';

const DOTS = ['', '🀙', '🀚', '🀛', '🀜', '🀝', '🀞', '🀟', '🀠', '🀡'];
const BAMBOO = ['', '🀐', '🀑', '🀒', '🀓', '🀔', '🀕', '🀖', '🀗', '🀘'];
const CHARACTERS = ['', '🀇', '🀈', '🀉', '🀊', '🀋', '🀌', '🀍', '🀎', '🀏'];
const WIND_GLYPH: Record<string, string> = {
  east: '🀀',
  south: '🀁',
  west: '🀂',
  north: '🀃',
};
const WIND_LABEL: Record<string, string> = {
  east: '东',
  south: '南',
  west: '西',
  north: '北',
};

export interface TileDisplay {
  glyph: string;
  label: string;
  colorClass: string; // tailwind classes for the tile face
}

/** Suit colors: dots blue, bamboo green, characters red, winds/dragon slate. */
export function tileDisplay(tile: TileId): TileDisplay {
  const p = parseTile(tile);
  if (p.category === 'suit') {
    const value = p.value as number;
    if (p.suit === 'dots') {
      return { glyph: DOTS[value], label: `${value}筒`, colorClass: 'text-blue-700 border-blue-300 bg-blue-50' };
    }
    if (p.suit === 'bamboo') {
      return { glyph: BAMBOO[value], label: `${value}条`, colorClass: 'text-green-700 border-green-300 bg-green-50' };
    }
    return { glyph: CHARACTERS[value], label: `${value}万`, colorClass: 'text-red-700 border-red-300 bg-red-50' };
  }
  if (p.category === 'wind') {
    const dir = p.value as string;
    return { glyph: WIND_GLYPH[dir], label: WIND_LABEL[dir] ?? dir, colorClass: 'text-slate-700 border-slate-300 bg-slate-50' };
  }
  // dragon (red only, per engine/tiles.ts)
  return { glyph: '🀄', label: '中', colorClass: 'text-slate-700 border-slate-300 bg-slate-50' };
}
