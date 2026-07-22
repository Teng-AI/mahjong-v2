// Shared helpers for the M2 server loop. Contract: design-server-loop.md §3, §5.
// Token->seat resolution, room-code generation, and small per-room queries.

import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export type Difficulty = 'easy' | 'medium' | 'hard';

// Room-code charset per spec §5: 31 chars, no 0/O/1/I/L. 10 uniqueness retries.
const ROOM_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function generateUniqueRoomCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CODE_CHARSET[Math.floor(Math.random() * ROOM_CODE_CHARSET.length)];
    }
    const existing = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique();
    if (!existing) return code;
  }
  throw new ConvexError('room_code_exhausted');
}

// Bot display names per spec §5: Bot-E/M/H + seat number (1-3 in Quick Play).
export function botName(difficulty: Difficulty, seat: number): string {
  const prefix = difficulty === 'easy' ? 'Bot-E' : difficulty === 'hard' ? 'Bot-H' : 'Bot-M';
  return `${prefix}${seat}`;
}

export function playersByRoom(
  ctx: MutationCtx | QueryCtx,
  roomId: Id<'rooms'>,
): Promise<Doc<'players'>[]> {
  return ctx.db
    .query('players')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
}

export function roundsByRoom(
  ctx: MutationCtx | QueryCtx,
  roomId: Id<'rooms'>,
): Promise<Doc<'rounds'>[]> {
  return ctx.db
    .query('rounds')
    .withIndex('by_room', (q) => q.eq('roomId', roomId))
    .collect();
}

export async function roomByCode(
  ctx: MutationCtx | QueryCtx,
  roomCode: string,
): Promise<Doc<'rooms'> | null> {
  return ctx.db
    .query('rooms')
    .withIndex('by_code', (q) => q.eq('code', roomCode))
    .unique();
}

// Resolve token -> the player's row for a room. Seat is NEVER trusted from an
// arg (design §3); it is derived here. Throws for plumbing failures only.
export async function loadActiveGame(
  ctx: MutationCtx,
  roomCode: string,
  token: string,
): Promise<{ room: Doc<'rooms'>; player: Doc<'players'>; game: Doc<'games'> }> {
  const room = await roomByCode(ctx, roomCode);
  if (!room) throw new ConvexError('room_not_found');
  const player = await ctx.db
    .query('players')
    .withIndex('by_room_token', (q) => q.eq('roomId', room._id).eq('token', token))
    .unique();
  if (!player) throw new ConvexError('bad_token');
  if (!room.activeGameId) throw new ConvexError('no_active_game');
  const game = await ctx.db.get(room.activeGameId);
  if (!game) throw new ConvexError('no_active_game');
  return { room, player, game };
}
