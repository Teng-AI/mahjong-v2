import { Tile } from './Tile';
import { Scoreboard } from './Scoreboard';
import type { GameRound, ScoreBreakdown, SeatView, WinnerInfo } from '../../engine';

interface WinnerOverlayProps {
  view: SeatView;
  players: { seat: number; name: string }[];
  rounds: GameRound[];
  onNextRound: () => void;
}

// Base line items: always in this order, only rendered when nonzero.
const BASE_ROWS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'base', label: 'Base' },
  { key: 'bonusTiles', label: 'Bonus tiles' },
  { key: 'golds', label: 'Golds' },
  { key: 'concealedKongBonus', label: 'Concealed kong' },
  { key: 'exposedKongBonus', label: 'Exposed kong' },
  { key: 'dealerStreakBonus', label: 'Dealer streak' },
];

// Special bonuses render after the multiplier line, only when nonzero.
const SPECIAL_ROWS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'threeGoldsBonus', label: 'Three golds' },
  { key: 'robbingGoldBonus', label: 'Robbing gold' },
  { key: 'goldenPairBonus', label: 'Golden pair' },
  { key: 'noBonusBonus', label: 'No bonus' },
  { key: 'allOneSuitBonus', label: 'All one suit' },
];

function winPathLabel(w: WinnerInfo): string {
  if (w.isThreeGolds) return 'Three golds';
  if (w.isRobbingGold) return 'Robbing gold';
  return w.isSelfDraw ? 'Self-draw' : 'Discard';
}

export function WinnerOverlay({ view, players, rounds, onNextRound }: WinnerOverlayProps) {
  if (view.phase !== 'ended') return null;

  if (view.endReason === 'wall_exhausted' || !view.winner) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-5 text-center text-slate-900 shadow-xl">
          <h2 className="text-lg font-semibold">Draw — wall exhausted</h2>
          <div className="mt-4">
            <Scoreboard rounds={rounds} players={players} />
          </div>
          <button
            type="button"
            className="mt-4 w-full min-h-12 rounded-full bg-emerald-600 px-4 font-medium text-white"
            onClick={onNextRound}
          >
            Next Round
          </button>
        </div>
      </div>
    );
  }

  const w = view.winner;
  const winnerName = players.find((p) => p.seat === w.seat)?.name ?? `Seat ${w.seat}`;
  const score = w.score;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 text-slate-900 shadow-xl">
        <h2 className="text-center text-lg font-semibold">{winnerName} wins!</h2>
        <p className="text-center text-xs opacity-70">{winPathLabel(w)}</p>

        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {w.hand.map((t, i) => (
            <Tile key={`${t}-${i}`} tile={t} size="sm" />
          ))}
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {BASE_ROWS.filter((r) => Number(score[r.key] ?? 0) !== 0).map((r) => (
              <tr key={r.key} className="border-b border-slate-100">
                <td className="py-1 opacity-70">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{score[r.key]}</td>
              </tr>
            ))}
            <tr className="border-b border-slate-100">
              <td className="py-1 opacity-70">Subtotal</td>
              <td className="py-1 text-right tabular-nums">{score.subtotal}</td>
            </tr>
            {score.multiplier !== 1 && (
              <tr className="border-b border-slate-100">
                <td className="py-1 opacity-70">Multiplier</td>
                <td className="py-1 text-right tabular-nums">×{score.multiplier}</td>
              </tr>
            )}
            {SPECIAL_ROWS.filter((r) => Number(score[r.key] ?? 0) !== 0).map((r) => (
              <tr key={r.key} className="border-b border-slate-100">
                <td className="py-1 opacity-70">{r.label}</td>
                <td className="py-1 text-right tabular-nums">{score[r.key]}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 font-semibold">Total</td>
              <td className="py-1 text-right font-semibold tabular-nums">{score.total}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4">
          <Scoreboard rounds={rounds} players={players} />
        </div>

        <button
          type="button"
          className="mt-4 w-full min-h-12 rounded-full bg-emerald-600 px-4 font-medium text-white"
          onClick={onNextRound}
        >
          Next Round
        </button>
      </div>
    </div>
  );
}
