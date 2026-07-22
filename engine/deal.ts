// Deal / setup. Contract: design-engine-api.md "deal.ts", spec 1.2.
// Takes tiles ALREADY shuffled by the caller; initHand never randomizes.

import { scoreWin } from './score';
import {
  canFormWinningHand,
  countGoldTiles,
  getTileType,
  getWinningTiles,
  isBonusTile,
  isGoldTile,
  removeTiles,
  sortTilesForDisplay,
} from './tiles';
import type {
  EngineState,
  GameEvent,
  HandConfig,
  Result,
  Seat,
  ScoreInput,
  TileId,
  WinnerInfo,
} from './types';

const NUM_SEATS = 4;
const HAND_SIZE = 16;
const DEAD_WALL = 16;

function emptyBySeat<T>(make: () => T): Record<Seat, T> {
  return { 0: make(), 1: make(), 2: make(), 3: make() };
}

/** Turn order from a seat, dealer-first: [seat, seat+1, seat+2, seat+3]. */
function seatOrderFrom(seat: Seat): Seat[] {
  const order: Seat[] = [];
  for (let i = 0; i < NUM_SEATS; i++) order.push(((seat + i) % NUM_SEATS) as Seat);
  return order;
}

export function initHand(config: HandConfig, shuffledTiles: TileId[]): Result {
  const { dealerSeat, dealerStreak } = config;
  const tiles = [...shuffledTiles];

  // 1-3. Round-robin deal from seat 0, 16 each, then 1 extra to the dealer.
  const hands = emptyBySeat<TileId[]>(() => []);
  let idx = 0;
  for (let pass = 0; pass < HAND_SIZE; pass++) {
    for (let s = 0; s < NUM_SEATS; s++) {
      hands[s as Seat].push(tiles[idx++]);
    }
  }
  hands[dealerSeat].push(tiles[idx++]); // dealer's 17th

  // 4. Dead wall: the LAST 16 tiles are excluded from play.
  const wall = tiles.slice(idx, tiles.length - DEAD_WALL);

  const bonusTiles = emptyBySeat<TileId[]>(() => []);
  const events: GameEvent[] = [];

  // 5. Bonus exposure, dealer-first counter-clockwise, with wall-front
  // replacements, repeated until each hand holds no bonus tile.
  for (const s of seatOrderFrom(dealerSeat)) {
    for (let i = 0; i < hands[s].length; i++) {
      if (isBonusTile(hands[s][i])) {
        const bonus = hands[s][i];
        bonusTiles[s].push(bonus);
        events.push({ kind: 'bonus_exposed', seat: s, tile: bonus, during: 'deal' });
        if (wall.length === 0) return endDrawGameSetup(config, hands, bonusTiles, wall, events, tiles);
        hands[s][i] = wall.shift() as TileId;
        i--; // re-check the slot: the replacement may itself be a bonus tile
      }
    }
  }

  // 6. Gold flip: shift wall until a non-bonus tile appears; bonuses hit en
  // route go to the DEALER's bonus row.
  let exposedGold: TileId | undefined;
  while (wall.length > 0) {
    const t = wall.shift() as TileId;
    if (isBonusTile(t)) {
      bonusTiles[dealerSeat].push(t);
      events.push({ kind: 'bonus_exposed', seat: dealerSeat, tile: t, during: 'deal' });
    } else {
      exposedGold = t;
      break;
    }
  }
  if (exposedGold === undefined) {
    return endDrawGameSetup(config, hands, bonusTiles, wall, events, tiles);
  }
  const goldTileType = getTileType(exposedGold);

  // 7. Sort all hands for display.
  for (let s = 0; s < NUM_SEATS; s++) {
    hands[s as Seat] = sortTilesForDisplay(hands[s as Seat], goldTileType);
  }

  const base: EngineState = {
    seq: 1,
    phase: 'playing',
    dealerSeat,
    currentPlayerSeat: dealerSeat,
    goldTileType,
    exposedGold,
    wall,
    hands,
    melds: emptyBySeat(() => []),
    bonusTiles,
    discardPile: [],
    lastAction: { type: 'game_start', playerSeat: dealerSeat },
    previousAction: null,
    pendingCalls: null,
    pendingChow: null,
    calledTypeThisTurn: null,
    winner: null,
    endReason: null,
  };

  events.push({
    kind: 'hand_started',
    dealerSeat,
    goldTileType,
    exposedGold,
  });

  // 8. Instant-win checks, in spec order.

  // Three Golds: scan seats 0..3, a seat holding all 3 gold copies wins.
  for (let s = 0; s < NUM_SEATS; s++) {
    if (countGoldTiles(hands[s as Seat], goldTileType) === 3) {
      return finishInstantWin(base, s as Seat, 'three_golds', dealerStreak, events, {
        hand: [...hands[s as Seat]],
      });
    }
  }

  // Robbing the Gold chain.
  // (a) Dealer's 17 already form a win with no swap.
  if (canFormWinningHand(hands[dealerSeat], goldTileType)) {
    return finishInstantWin(base, dealerSeat, 'robbing_gold', dealerStreak, events, {
      hand: [...hands[dealerSeat]],
    });
  }

  // (b) Non-dealers in turn order from the dealer: their 16-tile hand is tenpai
  // AND the gold TYPE is one of their winning tiles (adding a concrete gold-type
  // tile completes the hand). They take the exposed gold instance and win.
  for (let i = 1; i < NUM_SEATS; i++) {
    const s = ((dealerSeat + i) % NUM_SEATS) as Seat;
    if (getWinningTiles(hands[s], goldTileType).includes(goldTileType)) {
      return finishInstantWin(base, s, 'robbing_gold', dealerStreak, events, {
        hand: [...hands[s], exposedGold],
      });
    }
  }

  // (c) Dealer swap: replacing one non-gold tile in the dealer's hand with the
  // exposed gold completes a win.
  const dealerHand = hands[dealerSeat];
  const triedSwaps = new Set<TileId>();
  for (const z of dealerHand) {
    if (isGoldTile(z, goldTileType)) continue;
    if (triedSwaps.has(z)) continue;
    triedSwaps.add(z);
    const swapped = removeTiles(dealerHand, [z]);
    if (!swapped) continue;
    swapped.push(exposedGold);
    if (canFormWinningHand(swapped, goldTileType)) {
      events.push({ kind: 'gold_swapped', seat: dealerSeat, tileOut: z });
      return finishInstantWin(
        base,
        dealerSeat,
        'robbing_gold',
        dealerStreak,
        events,
        { hand: sortTilesForDisplay(swapped, goldTileType) },
      );
    }
  }

  return { ok: true, state: base, events };
}

/** Build the ended-with-win state for an instant win. winner.hand is the
 * revealed hand; state.hands are left untouched so tile conservation holds
 * (the exposed gold, when claimed, stays counted only as the exposedGold
 * field). */
function finishInstantWin(
  base: EngineState,
  seat: Seat,
  winPath: 'three_golds' | 'robbing_gold',
  dealerStreak: number,
  events: GameEvent[],
  extra: { hand: TileId[] },
): Result {
  const scoreInput: ScoreInput = {
    hand: extra.hand,
    melds: base.melds[seat],
    bonusTiles: base.bonusTiles[seat],
    goldTileType: base.goldTileType,
    isDealer: seat === base.dealerSeat,
    dealerStreak,
    winPath,
  };
  const winner: WinnerInfo = {
    seat,
    isSelfDraw: true,
    isThreeGolds: winPath === 'three_golds',
    isRobbingGold: winPath === 'robbing_gold',
    hand: extra.hand,
    score: scoreWin(scoreInput),
  };
  const state: EngineState = {
    ...base,
    phase: 'ended',
    endReason: 'win',
    winner,
  };
  events.push({ kind: 'won', winner });
  return { ok: true, state, events };
}

/** Defensive: wall exhausted mid-setup (impossible with 128 tiles). Ends the
 * hand as a draw game rather than throwing. */
function endDrawGameSetup(
  config: HandConfig,
  hands: Record<Seat, TileId[]>,
  bonusTiles: Record<Seat, TileId[]>,
  wall: TileId[],
  events: GameEvent[],
  tiles: TileId[],
): Result {
  events.push({ kind: 'wall_exhausted' });
  const state: EngineState = {
    seq: 1,
    phase: 'ended',
    dealerSeat: config.dealerSeat,
    currentPlayerSeat: config.dealerSeat,
    goldTileType: '',
    exposedGold: tiles[tiles.length - 1],
    wall,
    hands,
    melds: emptyBySeat(() => []),
    bonusTiles,
    discardPile: [],
    lastAction: { type: 'game_start', playerSeat: config.dealerSeat },
    previousAction: null,
    pendingCalls: null,
    pendingChow: null,
    calledTypeThisTurn: null,
    winner: null,
    endReason: 'wall_exhausted',
  };
  return { ok: true, state, events };
}
