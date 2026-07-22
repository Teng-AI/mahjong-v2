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
import { Scoreboard } from '../components/Scoreboard';
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
      <main className="flex min-h-dvh items-center justify-center bg-emerald-900 text-emerald-50">
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
  const isBot = (s: Seat) => players.find((p) => p.seat === s)?.isBot ?? false;

  const turnTotalSeconds = (view.phase === 'calling' ? room.callingTimerSeconds : room.turnTimerSeconds) ?? 30;

  return (
    <main className="flex min-h-dvh flex-col gap-2 bg-emerald-950 p-2 text-emerald-50">
      <Toasts toasts={toasts} />

      <Scoreboard rounds={rounds} players={players} />

      <section className="flex flex-col gap-1">
        {otherSeats.map((s) => (
          <OpponentStrip
            key={s}
            seat={s}
            name={nameFor(s)}
            isBot={isBot(s)}
            isDealer={view.dealerSeat === s}
            isCurrent={view.phase === 'playing' ? view.currentPlayerSeat === s : view.pendingCalls?.[s] === 'waiting'}
            handCount={view.handCounts[s]}
            melds={view.melds[s] ?? []}
            bonusTiles={view.bonusTiles[s] ?? []}
            goldTileType={view.goldTileType}
          />
        ))}
      </section>

      <CenterBoard
        discardPile={view.discardPile}
        goldTileType={view.goldTileType}
        exposedGold={view.exposedGold}
        wallCount={view.wallCount}
        roundNumber={room.roundNumber}
      />

      <CountdownBar deadlineAt={deadlineAt} totalSeconds={turnTotalSeconds} />

      <section className="flex flex-col gap-1.5 rounded-lg bg-black/20 p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-70">{nameFor(viewerSeat)} (you)</span>
          {view.dealerSeat === viewerSeat && (
            <span className="rounded bg-red-600 px-1 text-[10px] text-white">庄 Dealer</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Melds melds={view.melds[viewerSeat] ?? []} goldTileType={view.goldTileType} size="md" />
          <BonusTiles tiles={view.bonusTiles[viewerSeat] ?? []} size="md" />
        </div>
        <div className="flex flex-wrap gap-1">
          {(view.ownHand ?? []).map((t, i) => (
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

      <WinnerOverlay view={view} players={players} onNextRound={() => nextRound({ roomCode, token }).then(handleResult)} />
    </main>
  );
}
