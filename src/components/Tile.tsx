import { tileDisplay } from '../lib/tileDisplay';
import type { TileId } from '../../engine';

export type TileSize = 'sm' | 'lg';

// sm ~28x32 (melds/bonus/discards), lg ~44x56 (own hand — touch target >=44px)
const SIZE_CLASSES: Record<TileSize, string> = {
  sm: 'w-7 h-8 text-[11px] font-semibold',
  lg: 'w-11 h-14 text-base font-semibold',
};

interface TileProps {
  tile: TileId;
  size?: TileSize;
  isGold?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

/** One face-up tile: white rounded-rect with a colored text label, plus an
 *  optional gold tint/border. No glyphs — see lib/tileDisplay.ts. */
export function Tile({ tile, size = 'sm', isGold = false, selected = false, onClick }: TileProps) {
  const d = tileDisplay(tile);
  const interactive = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={d.label}
      className={[
        SIZE_CLASSES[size],
        'flex shrink-0 items-center justify-center rounded-md border leading-none select-none',
        isGold ? 'border-amber-500 bg-amber-100' : 'border-slate-300 bg-white',
        d.colorClass,
        selected ? '-translate-y-1.5 ring-2 ring-amber-500' : '',
        interactive ? 'active:scale-95 transition-transform' : 'cursor-default',
      ].join(' ')}
    >
      {d.label}
    </button>
  );
}

/** Face-down tile back, used only for hidden concealed-kong melds. */
export function TileBack({ size = 'sm' }: { size?: TileSize }) {
  return <div className={[SIZE_CLASSES[size], 'rounded-md border border-slate-400 bg-slate-600'].join(' ')} />;
}
