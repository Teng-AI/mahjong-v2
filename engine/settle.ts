// Session settlement. Surface mirrors v1 lib/settle.ts (spec section 4.3).
// PARTIAL: calculateNetPositions only; calculateSettlement/formatSettlement
// land per design-engine-api.md before the settle tests port.

import type { GameRound, NetPositions } from './types';

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
