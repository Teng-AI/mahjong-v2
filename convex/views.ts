// Public queries. Contract: design-server-loop.md §7.
// gameView is the one coarse reactive query clients subscribe to. Seat is
// derived from token only; redaction (viewFor) runs server-side so no client
// ever receives another seat's concealed tiles (the v1 transport leak class).

import { v } from 'convex/values';
import { query } from './_generated/server';
import { viewFor } from '../engine';
import type { EngineState, GameRound, Seat } from '../engine';
import { roomByCode, playersByRoom, roundsByRoom } from './lib';

export const gameView = query({
  args: { roomCode: v.string(), token: v.string() },
  handler: async (ctx, { roomCode, token }) => {
    const room = await roomByCode(ctx, roomCode);
    if (!room) return null;

    const players = await playersByRoom(ctx, room._id);
    const me = players.find((p) => p.token === token);
    // Token matches no player -> spectator (M3); return null for now.
    if (!me) return null;
    const seat = me.seat as Seat;

    if (!room.activeGameId) return null;
    const game = await ctx.db.get(room.activeGameId);
    if (!game) return null;
    const state = game.engine as EngineState;

    const view = viewFor(state, seat);

    const roundRows = await roundsByRoom(ctx, room._id);
    const rounds: GameRound[] = roundRows.map((r) => ({
      winnerSeat: r.winnerSeat as Seat | null,
      score: r.score,
      dealerSeat: r.dealerSeat as Seat,
      dealerStreak: r.dealerStreak,
      roundNumber: r.roundNumber,
      timestamp: r.timestamp,
      ...(r.winnerName !== undefined ? { winnerName: r.winnerName } : {}),
    }));

    return {
      room: {
        code: room.code,
        status: room.status,
        callingTimerSeconds: room.callingTimerSeconds,
        turnTimerSeconds: room.turnTimerSeconds,
        roundNumber: room.roundNumber,
      },
      players: players.map((p) => ({ seat: p.seat, name: p.name, isBot: p.isBot })),
      seat,
      view,
      deadlineAt: game.deadlineAt,
      rounds,
    };
  },
});
