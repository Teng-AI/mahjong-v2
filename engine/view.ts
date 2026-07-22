// Redaction layer. Contract: design-engine-api.md "Redaction", and the
// SeatView / MeldView doc comment in types.ts (the authoritative shape).
// Redaction runs here in engine code, never in the Convex layer.

import type { EngineState, Meld, MeldView, Seat, SeatView } from './types';

const SEATS: Seat[] = [0, 1, 2, 3];

/** A concealed kong is hidden from every viewer except its own seat (v1
 * parity: the tile type is never revealed, even at hand end). Exposed melds
 * are public the moment they are called. */
function redactMeld(meld: Meld, ownerSeat: Seat, viewerSeat: Seat | null): MeldView {
  const isOwnersConcealedKong =
    meld.type === 'kong' && meld.isConcealed === true;
  if (isOwnersConcealedKong && ownerSeat !== viewerSeat) {
    const view: MeldView = { type: meld.type, tiles: [], hidden: true };
    if (meld.calledTile !== undefined) view.calledTile = meld.calledTile;
    if (meld.isConcealed !== undefined) view.isConcealed = meld.isConcealed;
    return view;
  }
  const view: MeldView = { type: meld.type, tiles: [...meld.tiles] };
  if (meld.calledTile !== undefined) view.calledTile = meld.calledTile;
  if (meld.isConcealed !== undefined) view.isConcealed = meld.isConcealed;
  return view;
}

function project(state: EngineState, viewerSeat: Seat | null): SeatView {
  const melds = {} as Record<Seat, MeldView[]>;
  const handCounts = {} as Record<Seat, number>;
  const bonusTiles = {} as Record<Seat, string[]>;
  for (const seat of SEATS) {
    melds[seat] = state.melds[seat].map((m) => redactMeld(m, seat, viewerSeat));
    handCounts[seat] = state.hands[seat].length;
    bonusTiles[seat] = [...state.bonusTiles[seat]];
  }

  return {
    seq: state.seq,
    phase: state.phase,
    dealerSeat: state.dealerSeat,
    currentPlayerSeat: state.currentPlayerSeat,
    goldTileType: state.goldTileType,
    exposedGold: state.exposedGold,
    wallCount: state.wall.length,
    viewerSeat,
    ownHand: viewerSeat === null ? null : [...state.hands[viewerSeat]],
    handCounts,
    melds,
    bonusTiles: bonusTiles as Record<Seat, string[]>,
    discardPile: [...state.discardPile],
    lastAction: state.lastAction,
    previousAction: state.previousAction,
    pendingCalls: state.pendingCalls ? { ...state.pendingCalls } : null,
    calledTypeThisTurn: state.calledTypeThisTurn,
    // winner.hand is intentionally revealed to everyone once the hand ends
    // (spec: winner reveal); it holds only the winner's own tiles.
    winner: state.winner,
    endReason: state.endReason,
  };
}

export function viewFor(state: EngineState, seat: Seat): SeatView {
  return project(state, seat);
}

export function spectatorView(state: EngineState): SeatView {
  return project(state, null);
}
