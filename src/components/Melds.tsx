import { Tile, TileBack } from './Tile';
import { isGoldTile } from '../../engine';
import type { MeldView, TileType } from '../../engine';

/** One player's melds, rendered as small tile groups. Concealed kongs from
 *  other seats arrive as { tiles: [], hidden: true } (view.ts redaction) and
 *  render as four face-down backs. */
export function Melds({ melds, goldTileType, size = 'sm' }: { melds: MeldView[]; goldTileType: TileType; size?: 'sm' | 'md' }) {
  if (melds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {melds.map((meld, i) => (
        <div key={i} className="flex gap-0.5 rounded bg-black/5 p-0.5">
          {meld.hidden
            ? Array.from({ length: 4 }).map((_, j) => <TileBack key={j} size={size} />)
            : meld.tiles.map((t) => (
                <Tile key={t} tile={t} size={size} isGold={isGoldTile(t, goldTileType)} />
              ))}
        </div>
      ))}
    </div>
  );
}

/** Bonus tiles (winds/dragons drawn during play) — small glyph row. */
export function BonusTiles({ tiles, size = 'sm' }: { tiles: string[]; size?: 'sm' | 'md' }) {
  if (tiles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tiles.map((t, i) => (
        <Tile key={`${t}-${i}`} tile={t} size={size} />
      ))}
    </div>
  );
}
