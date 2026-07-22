// Thin bot adapter. Contract: design-server-loop.md §4 (bots.ts row).
// Loads a redacted view, asks the engine's chooseBotAction for an intent, and
// maps that intent onto an engine transition. All decision logic lives in
// engine/bots.ts; this file is pure plumbing so bots cannot cheat by
// construction (they only ever see SeatView + LegalActions).

import {
  chooseBotAction,
  viewFor,
  legalActions,
  draw,
  discard,
  declareSelfDrawWin,
  declareConcealedKong,
  upgradePungToKong,
  respondToCall,
} from '../engine';
import type { BotIntent, EngineState, LegalActions, Result, Seat } from '../engine';
import type { Difficulty } from './lib';

/** Map a chosen BotIntent onto the matching engine transition. */
export function applyBotIntent(
  state: EngineState,
  seat: Seat,
  intent: BotIntent,
  legal: LegalActions,
): Result {
  switch (intent.kind) {
    case 'draw':
      return draw(state, seat);
    case 'discard':
      return discard(state, seat, intent.tile);
    case 'selfDrawWin':
      return declareSelfDrawWin(state, seat);
    case 'concealedKong':
      return declareConcealedKong(state, seat, intent.tileType);
    case 'upgradeKong': {
      // upgradePungToKong needs the concrete tile; BotIntent carries only the
      // meld index, so recover the tile from legalActions.pungUpgrades.
      const up = legal.pungUpgrades.find((u) => u.meldIndex === intent.meldIndex);
      if (!up) return { ok: false, error: { code: 'invalid_kong' } };
      return upgradePungToKong(state, seat, intent.meldIndex, up.tile);
    }
    case 'respond':
      return respondToCall(state, seat, intent.action, intent.chowSelection);
  }
}

/** One bot decision + transition for a seat, on unredacted server state. */
export function botStep(state: EngineState, seat: Seat, difficulty: Difficulty): Result {
  const view = viewFor(state, seat);
  const legal = legalActions(state, seat);
  const intent = chooseBotAction(view, legal, difficulty);
  return applyBotIntent(state, seat, intent, legal);
}
