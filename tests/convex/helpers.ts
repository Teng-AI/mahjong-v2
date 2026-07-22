// Shared fixtures for the M2 convex-layer test suite. Contract:
// design-server-loop.md section 9. Not itself a test file (no *.test.ts
// suffix); imported by the suites below.
//
// Two ways rooms/games get built here:
//  - `createQuickPlayHuman` drives the real public mutation end to end
//    (random shuffle: use for tests that don't need a specific deal).
//  - `setupRoom` + `dealJunkHand` build a room/game directly via t.run with a
//    hand-crafted, guaranteed-non-winning 128-tile deck (ported from
//    engine/__tests__/deal.test.ts's "standard deal" JUNK fixture) so the
//    timer/backstop tests get a fully deterministic, always-junk deal.

import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';
import schema from '../../convex/schema';
import type { MutationCtx } from '../../convex/_generated/server';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { generateAllTiles, initHand } from '../../engine';
import type { EngineState, Seat, TileId } from '../../engine';
import { applyAndSchedule } from '../../convex/loop';

// convex/tsconfig.json has no `vite/client` types (deliberately untouched by
// this suite), so import.meta.glob is typed via a local cast rather than by
// editing that tsconfig.
export const modules = (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob(
  '../../convex/**/*.ts',
);

export function mkT(): TestConvex<any> {
  return convexTest(schema, modules);
}

/** Ported verbatim (structure) from deal.test.ts's "standard deal" fixture:
 *  four isolated types per seat, value gaps >= 3, no pairs/runs across the
 *  pool -- every seat is guaranteed junk, never tenpai, never a win. */
export function junkDeck(): TileId[] {
  const JUNK = [
    ['dots_1', 'dots_4', 'dots_7', 'bamboo_1'], // dealer (seat 0)
    ['dots_2', 'dots_5', 'dots_8', 'bamboo_4'],
    ['dots_3', 'dots_6', 'dots_9', 'bamboo_7'],
    ['characters_1', 'characters_4', 'characters_7', 'characters_9'],
  ];
  const front: TileId[] = [];
  for (let pass = 0; pass < 16; pass++) {
    for (let seat = 0; seat < 4; seat++) {
      const type = JUNK[seat][Math.floor(pass / 4)];
      front[pass * 4 + seat] = `${type}_${pass % 4}`;
    }
  }
  front[64] = 'characters_2_0'; // dealer's 17th: isolated from every dealer type
  front[65] = 'bamboo_5_0'; // gold flip: a type no hand holds
  const all = generateAllTiles();
  const used = new Set(front);
  const rest = all.filter((t) => !used.has(t));
  return [...front, ...rest];
}

export const HUMAN_TOKEN = 'human-token';

/** Insert a room (status playing, dealerSeat 0, given timers) + human at seat
 *  0 + three medium bots at seats 1-3, WITHOUT starting a hand. Mirrors
 *  createQuickPlay's shape so applyAndSchedule's room lookups behave the same. */
export async function setupRoom(
  t: TestConvex<any>,
  opts: { turnTimerSeconds: number | null; callingTimerSeconds: number | null } = {
    turnTimerSeconds: 30,
    callingTimerSeconds: 30,
  },
): Promise<{ roomId: Id<'rooms'>; roomCode: string }> {
  return t.run(async (ctx: MutationCtx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert('rooms', {
      code: 'TEST01',
      status: 'playing',
      hostToken: HUMAN_TOKEN,
      callingTimerSeconds: opts.callingTimerSeconds,
      turnTimerSeconds: opts.turnTimerSeconds,
      dealerSeat: 0,
      dealerStreak: 0,
      roundNumber: 1,
      activeGameId: null,
      createdAt: now,
    });
    await ctx.db.insert('players', {
      roomId,
      seat: 0,
      name: 'You',
      token: HUMAN_TOKEN,
      isBot: false,
      lastSeenAt: now,
    });
    for (let seat = 1; seat <= 3; seat++) {
      await ctx.db.insert('players', {
        roomId,
        seat,
        name: `Bot-M${seat}`,
        token: null,
        isBot: true,
        botDifficulty: 'medium',
        lastSeenAt: now,
      });
    }
    const room = (await ctx.db.get(roomId))!;
    return { roomId, roomCode: room.code };
  });
}

/** Deal the junk deck into a fresh game doc for `roomId` and arm the first
 *  schedule via the real applyAndSchedule choke point. Never ends the hand
 *  (junkDeck() never produces an instant win). Returns the game id. */
export async function dealJunkHand(
  t: TestConvex<any>,
  roomId: Id<'rooms'>,
): Promise<Id<'games'>> {
  return t.run(async (ctx: MutationCtx) => {
    const room = (await ctx.db.get(roomId))!;
    const res = initHand({ dealerSeat: room.dealerSeat as Seat, dealerStreak: room.dealerStreak }, junkDeck());
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
    await applyAndSchedule(ctx, gameDoc, state, Date.now());
    return gameId;
  });
}

export async function getGame(t: TestConvex<any>, gameId: Id<'games'>): Promise<Doc<'games'>> {
  return t.run(async (ctx: MutationCtx) => (await ctx.db.get(gameId))!);
}

export async function getEngine(t: TestConvex<any>, gameId: Id<'games'>): Promise<EngineState> {
  const game = await getGame(t, gameId);
  return game.engine as EngineState;
}

/** Create a Quick Play room end to end (real random shuffle) via the public
 *  mutation, for tests that don't need a specific deal. */
export async function createQuickPlayHuman(
  t: TestConvex<any>,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium',
): Promise<{ roomCode: string; token: string }> {
  const token = HUMAN_TOKEN;
  const { roomCode } = await t.mutation(api.quickplay.createQuickPlay, {
    token,
    name: 'You',
    difficulty,
  });
  return { roomCode, token };
}
