import { Tile } from './Tile';
import type { TileId } from '../../engine';

/** Center strip: discard pile as a wrap area of small tiles, most recent
 *  highlighted. Sits in the flex column between the opponent chips and the
 *  action bar, so it naturally gets whatever space is left (min-h-0 lets it
 *  shrink) and scrolls internally instead of growing the page. */
export function CenterBoard({ discardPile }: { discardPile: TileId[] }) {
  const lastIndex = discardPile.length - 1;
  return (
    <div className="mx-2 flex min-h-0 flex-1 flex-col rounded-lg bg-black/15 p-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {discardPile.length === 0 ? (
          <p className="pt-4 text-center text-xs text-emerald-50/60">No discards yet</p>
        ) : (
          <div className="flex flex-wrap content-start gap-1">
            {discardPile.map((t, i) => (
              <Tile key={`${t}-${i}`} tile={t} size="sm" selected={i === lastIndex} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
