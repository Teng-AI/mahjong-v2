// Deal / setup. Contract: design-engine-api.md "deal.ts".
// STUB: signature only, lands per M1 scope after score.ts + game.ts transitions.

import type { HandConfig, Result, TileId } from './types';

/**
 * Deal, cut dead wall, bonus-exposure loop, gold flip, instant-win checks
 * (spec 1.2). Takes tiles ALREADY shuffled by the caller; initHand never
 * randomizes.
 */
export function initHand(config: HandConfig, shuffledTiles: TileId[]): Result {
  void config;
  void shuffledTiles;
  throw new Error('not implemented');
}
