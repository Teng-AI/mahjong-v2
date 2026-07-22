// Game-flow helpers and transitions. Contract: design-engine-api.md.
// PARTIAL: adapter-proof helpers only; transitions land per the design doc.

import type { LastAction, Seat, TileId, TileType } from './types';

/** Turn order is counter-clockwise: 0 -> 1 -> 2 -> 3 -> 0. */
export function getNextSeat(seat: Seat): Seat {
  return (((seat + 1) % 4) as Seat);
}

// Structural subset so v1 test fixtures (full v1 GameState literals) pass as-is.
export interface NeedsToDrawState {
  currentPlayerSeat: Seat;
  lastAction: LastAction | null;
}

/**
 * Whether the current player must draw before acting (spec 1.3): skip the draw
 * when the last action was their own draw/pung/chow/kong, at game start
 * (dealer holds 17), or during setup. After any discard the next player draws.
 */
export function needsToDraw(state: NeedsToDrawState): boolean {
  const last = state.lastAction;
  if (!last) return false;
  if (last.type === 'game_start' || last.type === 'bonus_expose') return false;
  if (
    last.playerSeat === state.currentPlayerSeat &&
    (last.type === 'draw' ||
      last.type === 'pung' ||
      last.type === 'chow' ||
      last.type === 'kong')
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stubs below: signatures per design-engine-api.md + v1 lib/game.ts (spec
// 4.2). Not yet implemented; land per M1 implementation plan.
// ---------------------------------------------------------------------------

/** Whether hand contains any wind/dragon (bonus) tile. */
export function hasBonusTiles(_tiles: TileId[]): boolean {
  throw new Error('not implemented');
}

/** Extract only bonus (wind/dragon) tiles from a hand, preserving order. */
export function getBonusTilesFromHand(_tiles: TileId[]): TileId[] {
  throw new Error('not implemented');
}

/** Extract only non-bonus (suit) tiles from a hand. */
export function getNonBonusTiles(_tiles: TileId[]): TileId[] {
  throw new Error('not implemented');
}

/** Wrapper over tiles.canFormWinningHand (v1 parity: game.ts re-export). */
export function canWin(
  _hand: TileId[],
  _goldTileType: TileType,
  _exposedMeldCount: number = 0,
): boolean {
  throw new Error('not implemented');
}

/** Wrapper over tiles.canWinOnDiscard (v1 parity: game.ts re-export). */
export function canWinOnDiscard(
  _hand: TileId[],
  _discardedTile: TileId,
  _goldTileType: TileType,
  _exposedMeldCount: number = 0,
): boolean {
  throw new Error('not implemented');
}
