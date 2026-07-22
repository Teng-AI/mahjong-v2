// Session settlement. Surface mirrors v1 lib/settle.ts (spec section 4.3).
// PARTIAL: calculateNetPositions only; calculateSettlement/formatSettlement
// land per design-engine-api.md before the settle tests port.

import type { GameRound, NetPositions, Seat, Settlement } from './types';

/** Winner gains score x3, each other seat pays score; summed over rounds. */
export function calculateNetPositions(rounds: GameRound[]): NetPositions {
  const net: NetPositions = { seat0: 0, seat1: 0, seat2: 0, seat3: 0 };
  for (const round of rounds) {
    if (round.winnerSeat === null) continue;
    for (let seat = 0; seat < 4; seat++) {
      const key = `seat${seat}` as keyof NetPositions;
      net[key] += seat === round.winnerSeat ? round.score * 3 : -round.score;
    }
  }
  return net;
}

function seatName(seat: Seat, playerNames: Record<string, string>): string {
  return playerNames[`seat${seat}`] ?? `Player ${seat + 1}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Minimum set of transfers (greedy creditor/debtor match) that settles net positions. */
export function calculateSettlement(
  rounds: GameRound[],
  playerNames: Record<string, string>,
): {
  settlements: Settlement[];
  balances: { seat: Seat; name: string; balance: number }[];
} {
  const net = calculateNetPositions(rounds);
  const balances = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
    seat,
    name: seatName(seat, playerNames),
    balance: net[`seat${seat}` as keyof NetPositions],
  }));

  // Greedy: largest debtor pays largest creditor until everyone nets to zero.
  const debtors = balances
    .filter((b) => b.balance < 0)
    .map((b) => ({ seat: b.seat, amount: -b.balance }));
  const creditors = balances
    .filter((b) => b.balance > 0)
    .map((b) => ({ seat: b.seat, amount: b.balance }));

  const settlements: Settlement[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di];
    const creditor = creditors[ci];
    const transfer = round2(Math.min(debtor.amount, creditor.amount));
    if (transfer > 0) {
      settlements.push({ from: debtor.seat, to: creditor.seat, amount: transfer });
    }
    debtor.amount = round2(debtor.amount - transfer);
    creditor.amount = round2(creditor.amount - transfer);
    if (debtor.amount <= 0) di++;
    if (creditor.amount <= 0) ci++;
  }

  return { settlements, balances };
}

/** Human-readable "From → To: N pts" line for a settlement transfer. */
export function formatSettlement(
  settlement: Settlement,
  playerNames: Record<string, string>,
): string {
  const from = seatName(settlement.from, playerNames);
  const to = seatName(settlement.to, playerNames);
  return `${from} → ${to}: ${settlement.amount} pts`;
}
