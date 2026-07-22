import { TileBack } from './Tile';
import { Melds, BonusTiles } from './Melds';
import type { MeldView, Seat, TileType } from '../../engine';

interface OpponentStripProps {
  seat: Seat;
  name: string;
  isBot: boolean;
  isDealer: boolean;
  isCurrent: boolean;
  handCount: number;
  melds: MeldView[];
  bonusTiles: string[];
  goldTileType: TileType;
}

/** One opponent's row: name/tag, face-down tile-back count, melds, bonus tiles. */
export function OpponentStrip({
  name,
  isBot,
  isDealer,
  isCurrent,
  handCount,
  melds,
  bonusTiles,
  goldTileType,
}: OpponentStripProps) {
  return (
    <div
      className={[
        'flex items-center gap-2 rounded-lg border px-2 py-1.5',
        isCurrent ? 'border-amber-400 bg-amber-50' : 'border-transparent bg-black/5',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1 text-xs font-medium">
          <span className="truncate max-w-20">{name}</span>
          {isDealer && <span className="rounded bg-red-600 px-1 text-[10px] text-white">庄</span>}
          {isBot && <span className="rounded bg-slate-400 px-1 text-[10px] text-white">BOT</span>}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {Array.from({ length: handCount }).map((_, i) => (
            <TileBack key={i} size="sm" />
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <Melds melds={melds} goldTileType={goldTileType} size="sm" />
        <BonusTiles tiles={bonusTiles} size="sm" />
      </div>
    </div>
  );
}
