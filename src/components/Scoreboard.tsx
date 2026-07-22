import { calculateNetPositions } from '../../engine';
import type { GameRound } from '../../engine';

/** Cumulative per-seat net position across the session, computed client-side
 *  from rounds[] for display only (engine/settle.ts calculateNetPositions —
 *  pure math, not an authoritative decision). */
export function Scoreboard({ rounds, players }: { rounds: GameRound[]; players: { seat: number; name: string }[] }) {
  const net = calculateNetPositions(rounds);
  const values = [net.seat0, net.seat1, net.seat2, net.seat3];

  return (
    <div className="flex justify-between gap-1 rounded-lg bg-black/5 px-2 py-1 text-xs">
      {values.map((v, seat) => {
        const name = players.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
        return (
          <div key={seat} className="flex flex-1 flex-col items-center">
            <span className="truncate max-w-16 opacity-70">{name}</span>
            <span className={v > 0 ? 'text-emerald-700 font-medium' : v < 0 ? 'text-red-700 font-medium' : ''}>
              {v > 0 ? `+${v}` : v}
            </span>
          </div>
        );
      })}
    </div>
  );
}
