import { Tile } from './Tile';
import type { TileId, TileType } from '../../engine';

interface CenterBoardProps {
  discardPile: TileId[];
  goldTileType: TileType;
  exposedGold: TileId;
  wallCount: number;
  roundNumber: number;
}

export function CenterBoard({ discardPile, exposedGold, wallCount, roundNumber }: CenterBoardProps) {
  const lastIndex = discardPile.length - 1;
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg bg-emerald-800/90 p-2 text-emerald-50 min-h-0">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span className="opacity-80">Gold</span>
          <Tile tile={exposedGold} size="sm" isGold />
        </div>
        <span className="opacity-80">Round {roundNumber}</span>
        <span className="opacity-80">Wall {wallCount}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {discardPile.length === 0 ? (
          <p className="text-center text-xs opacity-60 pt-4">No discards yet</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {discardPile.map((t, i) => (
              <Tile key={`${t}-${i}`} tile={t} size="sm" selected={i === lastIndex} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
