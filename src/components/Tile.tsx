import { tileDisplay } from '../lib/tileDisplay';
import type { TileId } from '../../engine';

export type TileSize = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<TileSize, string> = {
  sm: 'w-6 h-8 text-base',
  md: 'w-9 h-12 text-xl',
  lg: 'w-11 h-15 text-2xl',
};

interface TileProps {
  tile: TileId;
  size?: TileSize;
  isGold?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

/** One face-up tile: glyph + suit color + optional gold ring. */
export function Tile({ tile, size = 'md', isGold = false, selected = false, onClick }: TileProps) {
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
        'flex flex-col items-center justify-center rounded-md border shrink-0 leading-none select-none',
        d.colorClass,
        selected ? '-translate-y-2 ring-2 ring-amber-500' : '',
        isGold ? 'ring-2 ring-yellow-400 shadow-[0_0_6px_2px_rgba(250,204,21,0.6)]' : '',
        interactive ? 'active:scale-95 transition-transform' : 'cursor-default',
      ].join(' ')}
    >
      <span>{d.glyph}</span>
    </button>
  );
}

/** Face-down tile back, used for opponents' concealed tiles. */
export function TileBack({ size = 'sm' }: { size?: TileSize }) {
  return (
    <div
      className={[
        SIZE_CLASSES[size],
        'rounded-md border border-slate-400 bg-slate-600 shrink-0',
      ].join(' ')}
    />
  );
}
