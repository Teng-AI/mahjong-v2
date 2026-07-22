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

// ---------------------------------------------------------------------------
// Stubs below: signatures per design-engine-api.md + v1 lib/settle.ts (spec
// 4.3). Not yet implemented; land per M1 implementation plan.
// ---------------------------------------------------------------------------

/** Minimum set of transfers (greedy creditor/debtor match) that settles net positions. */
export function calculateSettlement(
  _rounds: GameRound[],
  _playerNames: Record<string, string>,
): {
  settlements: Settlement[];
  balances: { seat: Seat; name: string; balance: number }[];
} {
  throw new Error('not implemented');
}

/** Human-readable "From → To: N pts" line for a settlement transfer. */
export function formatSettlement(
  _settlement: Settlement,
  _playerNames: Record<string, string>,
): string {
  throw new Error('not implemented');
}
