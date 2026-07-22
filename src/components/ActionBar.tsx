import type { ReactNode } from 'react';
import { getTileType } from '../../engine';
import type { Seat, SeatView, TileId } from '../../engine';

interface ActionBarProps {
  view: SeatView;
  seat: Seat;
  selectedTiles: TileId[];
  onDraw: () => void;
  onDiscard: (tile: TileId) => void;
  onSelfWin: () => void;
  onConcealedKong: (tileType: string) => void;
  onUpgradeKong: (meldIndex: number) => void;
  onRespond: (action: 'win' | 'kong' | 'pung' | 'chow' | 'pass') => void;
}

const BTN =
  'min-h-12 flex-1 rounded-xl px-1 text-xs font-semibold shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100';

/** Sticky bottom bar, contextual buttons only (v1 pattern, color-coded).
 *  Renders context buttons for the viewer only. Button VISIBILITY is derived
 *  cheaply here for UX; LEGALITY is never decided client-side — every tap
 *  sends an intent and the server accepts or rejects it (design-server-loop
 *  §8: the client computes nothing authoritative). */
export function ActionBar({
  view,
  seat,
  selectedTiles,
  onDraw,
  onDiscard,
  onSelfWin,
  onConcealedKong,
  onUpgradeKong,
  onRespond,
}: ActionBarProps) {
  const isMyTurn = view.phase === 'playing' && view.currentPlayerSeat === seat;
  const isCalling = view.phase === 'calling' && view.pendingCalls?.[seat] === 'waiting';

  let content: ReactNode;

  if (isMyTurn && view.ownHand) {
    const meldCount = view.melds[seat]?.length ?? 0;
    const readyToDiscard = view.ownHand.length === 17 - 3 * meldCount;
    const needsToDraw = view.ownHand.length === 16 - 3 * meldCount;
    const selected = selectedTiles[0];

    content = (
      <div className="flex gap-2">
        {needsToDraw && (
          <button type="button" className={`${BTN} bg-emerald-600 text-white`} onClick={onDraw}>
            Draw
          </button>
        )}
        {readyToDiscard && (
          <>
            <button
              type="button"
              className={`${BTN} bg-slate-700 text-white`}
              disabled={!selected}
              onClick={() => selected && onDiscard(selected)}
            >
              Discard
            </button>
            <button type="button" className={`${BTN} bg-amber-500 text-white`} onClick={onSelfWin}>
              Win
            </button>
            <button
              type="button"
              className={`${BTN} bg-purple-600 text-white`}
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                const type = getTileType(selected);
                const upgradeIndex = (view.melds[seat] ?? []).findIndex(
                  (m) => m.type === 'pung' && !m.hidden && m.tiles.length > 0 && getTileType(m.tiles[0]) === type,
                );
                if (upgradeIndex >= 0) onUpgradeKong(upgradeIndex);
                else onConcealedKong(type);
              }}
            >
              Kong
            </button>
          </>
        )}
      </div>
    );
  } else if (isCalling) {
    const canChow = selectedTiles.length === 2;
    content = (
      <div className="flex gap-1.5">
        <button type="button" className={`${BTN} bg-amber-500 text-white`} onClick={() => onRespond('win')}>
          Win
        </button>
        <button type="button" className={`${BTN} bg-purple-600 text-white`} onClick={() => onRespond('kong')}>
          Kong
        </button>
        <button type="button" className={`${BTN} bg-sky-600 text-white`} onClick={() => onRespond('pung')}>
          Pung
        </button>
        <button
          type="button"
          className={`${BTN} bg-teal-600 text-white`}
          disabled={!canChow}
          onClick={() => onRespond('chow')}
        >
          Chow
        </button>
        <button type="button" className={`${BTN} bg-slate-500 text-white`} onClick={() => onRespond('pass')}>
          Pass
        </button>
      </div>
    );
  } else {
    content = <p className="py-3 text-center text-xs text-emerald-50/60">Waiting…</p>;
  }

  return (
    <div className="sticky bottom-0 shrink-0 border-t border-white/10 bg-emerald-950/95 px-2 pt-2 backdrop-blur [padding-bottom:calc(env(safe-area-inset-bottom)+0.5rem)]">
      {content}
    </div>
  );
}
