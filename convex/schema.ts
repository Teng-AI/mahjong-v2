// M2 schema. Contract: plans/active/v1-parity/design-server-loop.md section 2.
// games.engine holds EngineState verbatim as v.any(); the engine type is the
// single source of truth and its only writer is engine transitions (design 2.1).

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    status: v.union(v.literal('waiting'), v.literal('playing'), v.literal('ended')),
    hostToken: v.string(),
    callingTimerSeconds: v.union(v.number(), v.null()),
    turnTimerSeconds: v.union(v.number(), v.null()),
    dealerSeat: v.number(),
    dealerStreak: v.number(),
    roundNumber: v.number(),
    activeGameId: v.union(v.id('games'), v.null()),
    createdAt: v.number(),
  }).index('by_code', ['code']),

  players: defineTable({
    roomId: v.id('rooms'),
    seat: v.number(),
    name: v.string(),
    token: v.union(v.string(), v.null()),
    isBot: v.boolean(),
    botDifficulty: v.optional(
      v.union(v.literal('easy'), v.literal('medium'), v.literal('hard')),
    ),
    lastSeenAt: v.number(),
  })
    .index('by_room', ['roomId'])
    .index('by_room_token', ['roomId', 'token']),

  games: defineTable({
    roomId: v.id('rooms'),
    roundNumber: v.number(),
    dealerStreak: v.number(),
    engine: v.any(),
    deadlineAt: v.union(v.number(), v.null()),
    schedId: v.union(v.id('_scheduled_functions'), v.null()),
    createdAt: v.number(),
  }).index('by_room', ['roomId']),

  rounds: defineTable({
    roomId: v.id('rooms'),
    roundNumber: v.number(),
    winnerSeat: v.union(v.number(), v.null()),
    score: v.number(),
    dealerSeat: v.number(),
    dealerStreak: v.number(),
    winnerName: v.optional(v.string()),
    timestamp: v.number(),
  }).index('by_room', ['roomId']),
});
