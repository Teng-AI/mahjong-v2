// Redaction layer. Contract: design-engine-api.md "Redaction".
// STUB: signatures only. See types.ts SeatView doc comment for the concrete
// shape chosen for this implementation.

import type { EngineState, Seat, SeatView } from './types';

export function viewFor(state: EngineState, seat: Seat): SeatView {
  void state;
  void seat;
  throw new Error('not implemented');
}

export function spectatorView(state: EngineState): SeatView {
  void state;
  throw new Error('not implemented');
}
