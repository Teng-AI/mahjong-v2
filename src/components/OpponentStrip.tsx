import { Melds } from './Melds';
import type { MeldView, Seat, TileType } from '../../engine';

interface OpponentStripProps {
  seat: Seat;
  name: string;
  isDealer: boolean;
  isCurrent: boolean;
  handCount: number;
  bonusCount: number;
  melds: MeldView[];
  goldTileType: TileType;
}

/** One opponent's compact chip: name, dealer/turn state, tile count (a plain
 *  number — no tile-backs, they don't fit at 375px), bonus count, and its
 *  melds inline as small tiles when called. Stays under ~72px tall. */
export function OpponentStrip({ name, isDealer, isCurrent, handCount, bonusCount, melds, goldTileType }: OpponentStripProps) {
  return (
    <div
      className={[
        'flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border px-1.5 py-1 text-emerald-50',
        isCurrent ? 'border-amber-400 bg-amber-500/10' : 'border-white/10 bg-black/15',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 text-[11px] font-medium">
        <span className="truncate">{name}</span>
        {isDealer && <span className="shrink-0 rounded bg-red-600 px-1 text-[9px] text-white">庄</span>}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] opacity-70">
        <span>{handCount} tiles</span>
        {bonusCount > 0 && <span>+{bonusCount} bonus</span>}
      </div>
      {melds.length > 0 && (
        <div className="overflow-x-auto">
          <Melds melds={melds} goldTileType={goldTileType} size="sm" />
        </div>
      )}
    </div>
  );
}
