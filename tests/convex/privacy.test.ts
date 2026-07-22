// M2 server-loop item 6: privacy at the query boundary. Contract:
// design-server-loop.md section 9 / section 7. viewFor() is already unit
// tested in the engine; this re-asserts at the transport layer because v1's
// leak class was there, not in the redaction function itself.

import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import type { MutationCtx } from '../../convex/_generated/server';
import { roomByCode } from '../../convex/lib';
import type { EngineState } from '../../engine';
import { createQuickPlayHuman, mkT } from './helpers';

describe('6. privacy at the query boundary', () => {
  it("gameView for the human seat contains no other seat's concealed tile ids", async () => {
    const t = mkT();
    const { roomCode, token } = await createQuickPlayHuman(t);

    const view = await t.query(api.views.gameView, { roomCode, token });
    expect(view).not.toBeNull();
    expect(view!.seat).toBe(0);

    const rawState = await t.run(async (ctx: MutationCtx) => {
      const room = (await roomByCode(ctx, roomCode))!;
      const game = (await ctx.db.get(room.activeGameId!))!;
      return game.engine as EngineState;
    });

    const serializedView = JSON.stringify(view);

    // Every concealed tile id in a NON-human hand must be absent from the
    // serialized view (the human's own hand is legitimately present). The one
    // deliberate exception (types.ts): once phase is 'ended', the winner's
    // full hand is intentionally revealed to everyone (winner-reveal screen).
    const winnerSeat = rawState.winner?.seat;
    for (const seat of [1, 2, 3] as const) {
      if (rawState.phase === 'ended' && seat === winnerSeat) continue;
      for (const tileId of rawState.hands[seat]) {
        expect(serializedView.includes(`"${tileId}"`)).toBe(false);
      }
    }

    // Coarse boundary checks from design section 7: wallCount is a number,
    // no raw wall array leaks through.
    expect(typeof view!.view.wallCount).toBe('number');
    expect((view!.view as unknown as Record<string, unknown>).wall).toBeUndefined();
    expect(serializedView).not.toContain('"wall":[');
  });
});
