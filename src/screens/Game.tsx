import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { getToken } from '../lib/identity';
import { errorMessage } from '../lib/errors';
import { useToasts } from '../lib/useToasts';
import { Tile } from '../components/Tile';
import { Melds, BonusTiles } from '../components/Melds';
import { OpponentStrip } from '../components/OpponentStrip';
import { CenterBoard } from '../components/CenterBoard';
import { CountdownBar } from '../components/CountdownBar';
import { ActionBar } from '../components/ActionBar';
import { WinnerOverlay } from '../components/WinnerOverlay';
import { Toasts } from '../components/Toasts';
import { isGoldTile } from '../../engine';
import type { Seat, TileId } from '../../engine';

const HEARTBEAT_MS = 20_000;

type IntentResult = { ok: true } | { ok: false; code: string };

export function Game({ roomCode, onLeave }: { roomCode: string; onLeave: () => void }) {
  const token = useMemo(() => getToken(), []);
  const gameView = useQuery(api.views.gameView, { roomCode, token });
  const { toasts, push } = useToasts();

  const intentDraw = useMutation(api.intents.intentDraw);
  const intentDiscard = useMutation(api.intents.intentDiscard);
  const intentRespond = useMutation(api.intents.intentRespond);
  const intentSelfDrawWin = useMutation(api.intents.intentSelfDrawWin);
  const intentConcealedKong = useMutation(api.intents.intentConcealedKong);
  const intentUpgradeKong = useMutation(api.intents.intentUpgradeKong);
  const nextRound = useMutation(api.intents.nextRound);
  const heartbeat = useMutation(api.intents.heartbeat);

  const [selectedTiles, setSelectedTiles] = useState<TileId[]>([]);

  // Presence heartbeat while this screen is mounted.
  useEffect(() => {
    const id = setInterval(() => {
      heartbeat({ roomCode, token }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [roomCode, token, heartbeat]);

  // Room vanished (bad code / expired) -> bounce home.
  useEffect(() => {
    if (gameView === null) {
      onLeave();
    }
  }, [gameView, onLeave]);

  // Clear tile selection whenever the view moves on (new turn/phase).
  const seq = gameView?.view.seq;
  useEffect(() => {
    setSelectedTiles([]);
  }, [seq]);

  if (gameView === undefined) {
    return (
      <main className="flex h-dvh items-center justify-center bg-emerald-950 text-emerald-50">
        <p>Loading…</p>
      </main>
    );
  }
  if (gameView === null) {
    return null; // bouncing to Home via effect above
  }

  const { room, players, seat, view, deadlineAt, rounds } = gameView;
  const viewerSeat = seat as Seat;

  const handleResult = (result: IntentResult) => {
    if (!result.ok) push(errorMessage(result.code));
  };

  const toggleSelect = (tile: TileId) => {
    const isCalling = view.phase === 'calling' && view.pendingCalls?.[viewerSeat] === 'waiting';
    setSelectedTiles((prev) => {
      if (prev.includes(tile)) return prev.filter((t) => t !== tile);
      if (isCalling) {
        if (prev.length >= 2) return prev;
        return [...prev, tile];
      }
      return [tile];
    });
  };

  const otherSeats = ([1, 2, 3] as const).map((offset) => ((viewerSeat + offset) % 4) as Seat);
  const nameFor = (s: Seat) => players.find((p) => p.seat === s)?.name ?? `Seat ${s}`;

  const turnLabel =
    view.phase === 'calling'
      ? 'Calling…'
      : view.phase === 'playing'
        ? view.currentPlayerSeat === viewerSeat
          ? 'Your turn'
          : nameFor(view.currentPlayerSeat)
        : 'Round over';

  const ownHand = view.ownHand ?? [];
  const ownMelds = view.melds[viewerSeat] ?? [];
  const ownBonus = view.bonusTiles[viewerSeat] ?? [];

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-emerald-950 text-emerald-50">
      <Toasts toasts={toasts} />

      {/* Header: one line, glanceable without scrolling. */}
      <header className="flex shrink-0 items-center gap-2 overflow-x-auto bg-black/30 px-2 py-1.5 text-xs">
        <span className="shrink-0 font-mono opacity-70">{room.code}</span>
        <Tile tile={view.exposedGold} size="sm" isGold />
        <span className="shrink-0 opacity-70">Wall {view.wallCount}</span>
        <span className="ml-auto shrink-0 truncate rounded-full bg-amber-500/90 px-2 py-0.5 font-medium text-emerald-950">
          {turnLabel}
        </span>
        <CountdownBar deadlineAt={deadlineAt} />
      </header>

      {/* Own hand card, directly under the header (v1 pattern: hand on top). */}
      <section className="flex shrink-0 flex-col gap-1.5 p-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium opacity-90">You</span>
          {view.dealerSeat === viewerSeat && (
            <span className="rounded bg-red-600 px-1 text-[10px] text-white">庄 Dealer</span>
          )}
          {ownBonus.length > 0 && <BonusTiles tiles={ownBonus} goldTileType={view.goldTileType} size="sm" />}
          <span className="ml-auto opacity-60">{ownHand.length} tiles</span>
        </div>

        {ownMelds.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">Melds:</span>
            <Melds melds={ownMelds} goldTileType={view.goldTileType} size="sm" />
          </div>
        )}

        {/* grid-cols-6 (not flex-wrap) so 17 tiles always wraps 6/6/5, regardless of viewport width. */}
        <div className="grid grid-cols-6 gap-1">
          {ownHand.map((t, i) => (
            <Tile
              key={`${t}-${i}`}
              tile={t}
              size="lg"
              isGold={isGoldTile(t, view.goldTileType)}
              selected={selectedTiles.includes(t)}
              onClick={() => toggleSelect(t)}
            />
          ))}
        </div>
      </section>

      {/* Opponent chips: one row of 3. */}
      <section className="flex shrink-0 gap-1.5 px-2">
        {otherSeats.map((s) => (
          <OpponentStrip
            key={s}
            seat={s}
            name={nameFor(s)}
            isDealer={view.dealerSeat === s}
            isCurrent={view.phase === 'playing' ? view.currentPlayerSeat === s : view.pendingCalls?.[s] === 'waiting'}
            handCount={view.handCounts[s]}
            bonusCount={(view.bonusTiles[s] ?? []).length}
            melds={view.melds[s] ?? []}
            goldTileType={view.goldTileType}
          />
        ))}
      </section>

      {/* Center strip: discard pile. flex-1 min-h-0 (in CenterBoard) absorbs
          whatever space is left in the h-dvh column and scrolls internally —
          this is what keeps the whole screen to one viewport. */}
      <CenterBoard discardPile={view.discardPile} />

      <ActionBar
        view={view}
        seat={viewerSeat}
        selectedTiles={selectedTiles}
        onDraw={() => intentDraw({ roomCode, token }).then(handleResult)}
        onDiscard={(tile) => intentDiscard({ roomCode, token, tile }).then(handleResult)}
        onSelfWin={() => intentSelfDrawWin({ roomCode, token }).then(handleResult)}
        onConcealedKong={(tileType) => intentConcealedKong({ roomCode, token, tileType }).then(handleResult)}
        onUpgradeKong={(meldIndex) => intentUpgradeKong({ roomCode, token, meldIndex }).then(handleResult)}
        onRespond={(action) =>
          intentRespond({
            roomCode,
            token,
            action,
            chowSelection:
              action === 'chow' && selectedTiles.length === 2
                ? { tilesFromHand: [selectedTiles[0], selectedTiles[1]] }
                : undefined,
          }).then(handleResult)
        }
      />

      <WinnerOverlay
        view={view}
        players={players}
        rounds={rounds}
        onNextRound={() => nextRound({ roomCode, token }).then(handleResult)}
      />
    </main>
  );
}
