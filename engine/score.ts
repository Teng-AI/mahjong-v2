// Scoring formula. Contract: design-engine-api.md "score.ts", spec 1.7.
// Pure formula over its inputs: trusts the caller already validated the win
// shape. Implements the per-win-path "quirk table" (spec 1.7) exactly.

import {
  countGoldTiles,
  hasGoldenPair,
  isGoldTile,
  isSuitTile,
  parseTile,
} from './tiles';
import type { Meld, ScoreBreakdown, ScoreInput, TileId, TileType } from './types';

/** Every hand + meld tile is one suit (golds ignored). */
function isAllOneSuit(
  hand: TileId[],
  melds: Meld[],
  goldTileType: TileType,
): boolean {
  const suits = new Set<string>();
  let sawSuit = false;
  const consider = (tile: TileId): void => {
    if (isGoldTile(tile, goldTileType)) return;
    if (!isSuitTile(tile)) {
      suits.add('__nonsuit__');
      return;
    }
    sawSuit = true;
    suits.add(parseTile(tile).suit as string);
  };
  for (const t of hand) consider(t);
  for (const m of melds) for (const t of m.tiles) consider(t);
  return sawSuit && suits.size === 1 && !suits.has('__nonsuit__');
}

export function scoreWin(input: ScoreInput): ScoreBreakdown {
  const {
    hand,
    melds,
    bonusTiles,
    goldTileType,
    isDealer,
    dealerStreak,
    winPath,
  } = input;

  const base = 1;
  const bonus = bonusTiles.length;
  const golds = countGoldTiles(hand, goldTileType);

  let concealedKongBonus = 0;
  let exposedKongBonus = 0;
  let kongCount = 0;
  for (const meld of melds) {
    if (meld.type === 'kong') {
      kongCount++;
      if (meld.isConcealed) concealedKongBonus += 2;
      else exposedKongBonus += 1;
    }
  }
  // Robbing the Gold counts no kong bonuses (spec 1.7 quirk; impossible at
  // setup anyway).
  if (winPath === 'robbing_gold') {
    concealedKongBonus = 0;
    exposedKongBonus = 0;
  }

  const dealerStreakBonus = isDealer ? dealerStreak : 0;
  const subtotal =
    base +
    bonus +
    golds +
    concealedKongBonus +
    exposedKongBonus +
    dealerStreakBonus;

  const breakdown: ScoreBreakdown = {
    base,
    bonusTiles: bonus,
    golds,
    concealedKongBonus,
    exposedKongBonus,
    dealerStreakBonus,
    subtotal,
    multiplier: 1,
    total: 0,
  };

  // Which specials each win path checks (spec 1.7 quirk table).
  const checksGoldenPair =
    winPath === 'self_draw' ||
    winPath === 'discard' ||
    winPath === 'robbing_gold';
  const checksNoBonus =
    winPath === 'self_draw' ||
    winPath === 'discard' ||
    winPath === 'robbing_gold';
  const checksAllOneSuit = winPath === 'self_draw' || winPath === 'discard';

  let specials = 0;
  let anySpecial = false;

  if (winPath === 'three_golds') {
    breakdown.threeGoldsBonus = 30;
    specials += 30;
    anySpecial = true;
  }
  if (winPath === 'robbing_gold') {
    breakdown.robbingGoldBonus = 30;
    specials += 30;
    anySpecial = true;
  }
  if (checksGoldenPair && hasGoldenPair(hand, goldTileType, melds.length)) {
    breakdown.goldenPairBonus = 50;
    specials += 50;
    anySpecial = true;
  }
  if (checksNoBonus && bonus === 0 && kongCount === 0) {
    breakdown.noBonusBonus = 15;
    specials += 15;
    anySpecial = true;
  }
  if (checksAllOneSuit && isAllOneSuit(hand, melds, goldTileType)) {
    breakdown.allOneSuitBonus = 100;
    specials += 100;
    anySpecial = true;
  }

  const alwaysDouble =
    winPath === 'self_draw' ||
    winPath === 'three_golds' ||
    winPath === 'robbing_gold';
  breakdown.multiplier = alwaysDouble || anySpecial ? 2 : 1;
  breakdown.total = subtotal * breakdown.multiplier + specials;

  return breakdown;
}
