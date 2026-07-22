import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// M0 spike gate 1: hello room. Throwaway code, not the game schema.
export const joinRoom = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    await ctx.db.insert("rooms", { name, joinedAt: Date.now() });
  },
});

export const latestJoins = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("rooms").order("desc").take(10);
    return rows.map((r) => ({
      id: r._id,
      name: r.name as string,
      joinedAt: r.joinedAt as number,
    }));
  },
});
