// Public engine API. Contract: design-engine-api.md "File layout".
// Convex (and any other consumer) imports from here, not from individual
// engine/*.ts files, so the public surface stays a single reviewed list.

export * from './types';
export * from './tiles';
// game.ts's canWinOnDiscard is a thin wrapper over tiles.ts's (v1 parity: both
// files carried the same-named export). Re-export it explicitly under a
// distinct name to resolve the ambiguity; tiles.ts's canWinOnDiscard is the
// canonical export from this index.
export {
  getNextSeat,
  needsToDraw,
  hasBonusTiles,
  getBonusTilesFromHand,
  getNonBonusTiles,
  canWin,
  canWinOnDiscard as gameCanWinOnDiscard,
  draw,
  discard,
  respondToCall,
  declareSelfDrawWin,
  declareConcealedKong,
  upgradePungToKong,
  legalActions,
} from './game';
export type { NeedsToDrawState } from './game';
export * from './deal';
export * from './score';
export * from './settle';
export * from './view';
