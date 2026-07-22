// Quick Play. Contract: design-server-loop.md §5 (createQuickPlay).
// One click: room (status 'playing', timers 30/30, dealer seat 0), "You" at
// seat 0 + three bots at seats 1-3, then start the first hand inline.

import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { generateUniqueRoomCode, botName, type Difficulty } from './lib';
import { startHand } from './loop';

export const createQuickPlay = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    difficulty: v.union(v.literal('easy'), v.literal('medium'), v.literal('hard')),
  },
  handler: async (ctx, { token, name, difficulty }): Promise<{ roomCode: string }> => {
    const now = Date.now();
    const code = await generateUniqueRoomCode(ctx);

    const roomId = await ctx.db.insert('rooms', {
      code,
      status: 'playing',
      hostToken: token,
      callingTimerSeconds: 30, // ruling 4: Quick Play 30/30.
      turnTimerSeconds: 30,
      dealerSeat: 0,
      dealerStreak: 0,
      roundNumber: 1,
      activeGameId: null,
      createdAt: now,
    });

    // Human host at seat 0.
    await ctx.db.insert('players', {
      roomId,
      seat: 0,
      name,
      token,
      isBot: false,
      lastSeenAt: now,
    });

    // Bots at seats 1-3, named per spec §5 (Bot-M1..M3 for medium, etc.).
    for (let seat = 1; seat <= 3; seat++) {
      await ctx.db.insert('players', {
        roomId,
        seat,
        name: botName(difficulty as Difficulty, seat),
        token: null,
        isBot: true,
        botDifficulty: difficulty,
        lastSeenAt: now,
      });
    }

    await startHand(ctx, roomId);
    return { roomCode: code };
  },
});
