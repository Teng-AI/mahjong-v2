// The M2 server game loop. Contract: design-server-loop.md §6 ("the part that
// must be right"). Internal scheduled mutations (onDeadline, botAct) plus the
// shared choke point applyAndSchedule and the startHand / settle helpers.
//
// Correctness rests on the seq guard: every scheduled function no-ops if
// game.engine.seq !== expectedSeq. Cancel-and-replace is only an optimization.

import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {
  generateAllTiles,
  shuffle,
  initHand,
  needsToDraw,
  draw,
  discard,
  declareSelfDrawWin,
  respondToCall,
  legalActions,
  selectSafeDiscard,
  getTileType,
  isGoldTile,
} from '../engine';
import type { EngineState, Result, Seat } from '../engine';
import { playersByRoom, type Difficulty } from './lib';
import { botStep } from './bots';

const BOT_DELAY_MS = 900; // spec ballpark 800-1000; one constant, easy to tune.

// --- Scheduling primitives ---------------------------------------------------

/** Best-effort cancel of a stored schedule. Canceling an already-run function
 *  must never throw the calling mutation (design §5 last bullet). */
async function cancelSched(
  ctx: MutationCtx,
  schedId: Id<'_scheduled_functions'> | null,
): Promise<void> {
  if (!schedId) return;
  try {
    const sys = await ctx.db.system.get(schedId);
    if (sys && sys.state.kind === 'pending') {
      await ctx.scheduler.cancel(schedId);
    }
  } catch {
    // already completed / canceled — nothing to do.
  }
}

// --- The choke point (§6.1) --------------------------------------------------

/** Single exit called after every successful transition batch. Cancels the old
 *  schedule, decides what happens next from `state`, patches the game doc. */
export async function applyAndSchedule(
  ctx: MutationCtx,
  gameDoc: Doc<'games'>,
  state: EngineState,
  now: number,
): Promise<void> {
  await cancelSched(ctx, gameDoc.schedId);

  if (state.phase === 'ended') {
    await settleHand(ctx, gameDoc, state);
    return;
  }

  const room = (await ctx.db.get(gameDoc.roomId))!;
  const players = await playersByRoom(ctx, gameDoc.roomId);
  const botSeats = new Set(players.filter((p) => p.isBot).map((p) => p.seat));

  let deadlineAt: number | null = null;
  let schedId: Id<'_scheduled_functions'> | null = null;

  if (state.phase === 'playing') {
    const seat = state.currentPlayerSeat;
    if (botSeats.has(seat)) {
      // Bot actor: delayed botAct, no countdown renders.
      schedId = await ctx.scheduler.runAfter(BOT_DELAY_MS, internal.loop.botAct, {
        gameId: gameDoc._id,
        expectedSeq: state.seq,
      });
      deadlineAt = null;
    } else if (room.turnTimerSeconds != null) {
      // Human actor with a turn timer: countdown + deadline schedule.
      deadlineAt = now + room.turnTimerSeconds * 1000;
      schedId = await ctx.scheduler.runAfter(room.turnTimerSeconds * 1000, internal.loop.onDeadline, {
        gameId: gameDoc._id,
        expectedSeq: state.seq,
      });
    }
    // Human, timer off: both null.
  } else if (state.phase === 'calling') {
    // Dual-schedule conceptually; only the deadline schedule is stored. Stale
    // botAct schedules die on the seq guard, which is what correctness rests on.
    const waiting = ([0, 1, 2, 3] as Seat[]).filter(
      (k) => state.pendingCalls != null && state.pendingCalls[k] === 'waiting',
    );
    const anyBotWaiting = waiting.some((k) => botSeats.has(k));
    const anyHumanWaiting = waiting.some((k) => !botSeats.has(k));
    const humanTimer = anyHumanWaiting && room.callingTimerSeconds != null;

    if (anyBotWaiting) {
      const botSched = await ctx.scheduler.runAfter(BOT_DELAY_MS, internal.loop.botAct, {
        gameId: gameDoc._id,
        expectedSeq: state.seq,
      });
      // Store botAct only when there is no deadline schedule to store instead.
      if (!humanTimer) schedId = botSched;
    }
    if (humanTimer) {
      deadlineAt = now + room.callingTimerSeconds! * 1000;
      schedId = await ctx.scheduler.runAfter(room.callingTimerSeconds! * 1000, internal.loop.onDeadline, {
        gameId: gameDoc._id,
        expectedSeq: state.seq,
      });
    }
  }

  await ctx.db.patch(gameDoc._id, { engine: state, deadlineAt, schedId });
}

// --- Hand end (§6.3) ---------------------------------------------------------

/** Settle a finished hand: rounds row, room dealer-rotation + streak (spec 1.6,
 *  banked-before convention: dealer's 3rd consecutive win pays +2), roundNumber
 *  bump. activeGameId stays pointing at the ended game; nextRound advances it. */
export async function settleHand(
  ctx: MutationCtx,
  gameDoc: Doc<'games'>,
  state: EngineState,
): Promise<void> {
  const room = (await ctx.db.get(gameDoc.roomId))!;
  const winner = state.winner;
  const winnerSeat: number | null = winner ? winner.seat : null;
  const score = winner ? winner.score.total : 0;

  let winnerName: string | undefined;
  if (winnerSeat != null) {
    const players = await playersByRoom(ctx, gameDoc.roomId);
    winnerName = players.find((p) => p.seat === winnerSeat)?.name;
  }

  // Never write explicit `undefined` into a doc (storage caveat §2.1).
  const roundRow = {
    roomId: gameDoc.roomId,
    roundNumber: gameDoc.roundNumber,
    winnerSeat,
    score,
    dealerSeat: room.dealerSeat,
    dealerStreak: gameDoc.dealerStreak,
    timestamp: Date.now(),
    ...(winnerName !== undefined ? { winnerName } : {}),
  };
  await ctx.db.insert('rounds', roundRow);

  // Dealer rotation + streak (spec §1.6): dealer stays and banks +1 on a dealer
  // win or a draw; otherwise rotate and reset to 0.
  const dealerKeeps = winnerSeat === null || winnerSeat === room.dealerSeat;
  const nextDealerSeat = dealerKeeps ? room.dealerSeat : (room.dealerSeat + 1) % 4;
  const nextStreak = dealerKeeps ? gameDoc.dealerStreak + 1 : 0;

  await ctx.db.patch(gameDoc.roomId, {
    dealerSeat: nextDealerSeat,
    dealerStreak: nextStreak,
    roundNumber: room.roundNumber + 1,
    // activeGameId intentionally unchanged (clients render the winner reveal).
  });

  await ctx.db.patch(gameDoc._id, { engine: state, deadlineAt: null, schedId: null });
}

// --- Start a hand (§5 startHand) ---------------------------------------------

/** Shuffle -> deal -> insert game doc -> settle instantly on a deal-time end
 *  (Three Golds / Robbing the Gold) or schedule the first turn. Returns the new
 *  game id. Math.random is safe in a Convex mutation (seeded per execution). */
export async function startHand(ctx: MutationCtx, roomId: Id<'rooms'>): Promise<Id<'games'>> {
  const room = (await ctx.db.get(roomId))!;
  const tiles = shuffle(generateAllTiles(), Math.random);
  const res = initHand(
    { dealerSeat: room.dealerSeat as Seat, dealerStreak: room.dealerStreak },
    tiles,
  );
  if (!res.ok) throw new Error(`initHand failed: ${res.error.code}`);
  const state = res.state;

  const gameId = await ctx.db.insert('games', {
    roomId,
    roundNumber: room.roundNumber,
    dealerStreak: room.dealerStreak,
    engine: state,
    deadlineAt: null,
    schedId: null,
    createdAt: Date.now(),
  });
  await ctx.db.patch(roomId, { activeGameId: gameId });

  const gameDoc = (await ctx.db.get(gameId))!;
  if (state.phase === 'ended') {
    await settleHand(ctx, gameDoc, state);
  } else {
    await applyAndSchedule(ctx, gameDoc, state, Date.now());
  }
  return gameId;
}

// --- Deadline auto-play (§6.2 onDeadline) ------------------------------------

/** Auto-play the current seat on a playing-phase timeout, exactly like v1's
 *  autoPlayExpiredTurn: draw if needed, take a self-draw win if legal, else
 *  discard a safe tile. */
function autoPlayPlaying(state: EngineState): Result {
  const seat = state.currentPlayerSeat;
  let s = state;
  if (needsToDraw(s)) {
    const r = draw(s, seat);
    if (!r.ok) return r;
    s = r.state;
  }
  if (legalActions(s, seat).canSelfDrawWin) {
    return declareSelfDrawWin(s, seat);
  }
  // The discard restriction after the seat's own pung/chow (calledTypeThisTurn)
  // is invisible to selectSafeDiscard, so filter those tiles out first; an
  // auto-discard the engine rejects would leave the game unscheduled.
  const candidates =
    s.calledTypeThisTurn == null
      ? s.hands[seat]
      : s.hands[seat].filter((t) => getTileType(t) !== s.calledTypeThisTurn);
  const tile =
    selectSafeDiscard(candidates, s.goldTileType) ??
    candidates.find((t) => !isGoldTile(t, s.goldTileType));
  if (tile == null) {
    // No legal discard exists (all golds / called type): nothing to auto-play.
    return { ok: false, error: { code: 'cannot_discard_gold' } };
  }
  return discard(s, seat, tile);
}

/** Pass for every seat still waiting, in seat order. The engine resolves the
 *  recorded responses on the final response. */
function autoPassCalling(state: EngineState): Result {
  let s = state;
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (s.pendingCalls != null && s.pendingCalls[seat] === 'waiting') {
      const r = respondToCall(s, seat, 'pass');
      if (r.ok) s = r.state;
    }
  }
  return { ok: true, state: s, events: [] };
}

/** Shared deadline logic, reused by the onDeadline scheduled fn (after its seq
 *  guard) and by the self-healing backstop in intents. Operates on the loaded
 *  doc, so it is naturally seq-consistent. */
export async function runDeadline(
  ctx: MutationCtx,
  gameDoc: Doc<'games'>,
  now: number,
): Promise<void> {
  const state = gameDoc.engine as EngineState;
  let result: Result;
  if (state.phase === 'playing') {
    result = autoPlayPlaying(state);
  } else if (state.phase === 'calling') {
    result = autoPassCalling(state);
  } else {
    return; // ended: nothing to time out.
  }
  if (!result.ok) return; // defensive: engine rejected an auto-move; leave as-is.
  // M3: persist events (result.events discarded in M2 — game log is M3).
  await applyAndSchedule(ctx, gameDoc, result.state, now);
}

// --- Scheduled mutations (§6.2) ----------------------------------------------

export const onDeadline = internalMutation({
  args: { gameId: v.id('games'), expectedSeq: v.number() },
  handler: async (ctx, { gameId, expectedSeq }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    const state = game.engine as EngineState;
    if (state.seq !== expectedSeq) {
      // Stale schedule superseded by a player action: no-op (seq guard).
      return;
    }
    await runDeadline(ctx, game, Date.now());
  },
});

export const botAct = internalMutation({
  args: { gameId: v.id('games'), expectedSeq: v.number() },
  handler: async (ctx, { gameId, expectedSeq }) => {
    const game = await ctx.db.get(gameId);
    if (!game) return;
    let state = game.engine as EngineState;
    if (state.seq !== expectedSeq) return; // stale

    const players = await playersByRoom(ctx, game.roomId);
    const bySeat = new Map<number, Doc<'players'>>(players.map((p) => [p.seat, p]));
    const botSeats = new Set(players.filter((p) => p.isBot).map((p) => p.seat));
    const difficultyOf = (seat: number): Difficulty =>
      (bySeat.get(seat)?.botDifficulty as Difficulty | undefined) ?? 'medium';

    if (state.phase === 'playing') {
      // A bot turn is usually draw + act; loop while the SAME bot holds the turn
      // (draw -> act, kong-replacement chains), capped at 4 iterations. Locking
      // to the initial seat means an endgame turn-pass to another bot falls
      // through to applyAndSchedule, which schedules that bot's own delayed
      // botAct (keeps each bot move visibly spaced by BOT_DELAY_MS).
      const botSeat = state.currentPlayerSeat as Seat;
      let iter = 0;
      while (
        state.phase === 'playing' &&
        state.currentPlayerSeat === botSeat &&
        botSeats.has(botSeat) &&
        iter < 4
      ) {
        const r = botStep(state, botSeat, difficultyOf(botSeat));
        if (!r.ok) break; // defensive; should not happen for a legal bot
        state = r.state;
        iter++;
      }
    } else if (state.phase === 'calling') {
      // Respond for each waiting bot seat in order. The engine may resolve
      // mid-loop (final response); re-check phase and never continue inline into
      // a bot's playing turn — fall through to applyAndSchedule instead.
      for (const seat of [0, 1, 2, 3] as Seat[]) {
        if (state.phase !== 'calling') break;
        if (state.pendingCalls == null || state.pendingCalls[seat] !== 'waiting') continue;
        if (!botSeats.has(seat)) continue;
        const r = botStep(state, seat, difficultyOf(seat));
        if (r.ok) state = r.state;
      }
    } else {
      return; // ended
    }

    if (state.seq === expectedSeq) {
      // No transition applied (broken bot / rejected intent). Do NOT reschedule:
      // applyAndSchedule would re-arm botAct with the same seq and spin every
      // BOT_DELAY_MS forever. A visible stall (recoverable via the intent
      // backstop or a human action) beats a runaway scheduler on a capped plan.
      console.error('botAct made no progress; leaving game unscheduled', {
        gameId,
        expectedSeq,
        phase: state.phase,
      });
      return;
    }

    await applyAndSchedule(ctx, game, state, Date.now());
  },
});
