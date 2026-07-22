# M2 Design: Convex Server Game Loop

Status: designed 2026-07-22 (Fable). Implements strategy.md M2. Consumes the frozen engine API (design-engine-api.md); the engine does not change in M2 except the addition of `engine/bots.ts` (planned there as an M2 item).

M2 scope: Quick Play vs 3 server bots, playable on a phone, with every timer/bot/authoritative decision on the server. Rooms/multiplayer beyond what Quick Play needs is M3, but the schema is written so M3 adds mutations, not migrations.

Gate: full Quick Play game vs 3 bots on a real iPhone with the screen locked through at least one calling phase and one full bot turn.

## 1. Principles (carried from M0/strategy)

- One game doc per hand; every mutation is read-doc → engine transition(s) → write-doc. Convex serializes writers per doc; no divergent copies possible.
- **Idempotence guard = `engine.seq`.** Every scheduled function receives `(gameId, expectedSeq)` and no-ops if `game.engine.seq !== expectedSeq`. Cancel-and-replace is an optimization; the seq guard is the correctness mechanism (M0 gate 4 proved this pattern).
- `deadlineAt` is display-only for clients; the authoritative timeout is the scheduled mutation.
- Clients get exactly one coarse reactive query (`gameView`): quota discipline (pre-mortem risk 2).
- Engine redaction (`viewFor`) runs server-side in the query; no client ever receives another seat's hand (v1 leak class).
- Bots are server-side scheduled mutations acting through the same engine transitions as humans. Bots receive only `SeatView` + `LegalActions`: they cannot cheat by construction.
- Convex mutations may use `Math.random()` (Convex seeds it deterministically per execution, safe under OCC retries): used for the shuffle and room codes.

## 2. Schema (`convex/schema.ts`)

Spike tables (`rooms` join-spike, `timers`) are deleted, not migrated.

```ts
rooms: defineTable({
  code: v.string(),                 // 6 chars, charset per spec §5, unique
  status: v.union(v.literal('waiting'), v.literal('playing'), v.literal('ended')),
  hostToken: v.string(),            // creator's identity token
  callingTimerSeconds: v.union(v.number(), v.null()),  // null = off
  turnTimerSeconds: v.union(v.number(), v.null()),
  dealerSeat: v.number(),           // session-level: rotation applied at each startHand
  dealerStreak: v.number(),         // streak banked BEFORE the next hand (ruling 1)
  roundNumber: v.number(),          // next hand's number, starts 1
  activeGameId: v.union(v.id('games'), v.null()),
  createdAt: v.number(),
}).index('by_code', ['code']),

players: defineTable({
  roomId: v.id('rooms'),
  seat: v.number(),                 // 0-3
  name: v.string(),
  token: v.union(v.string(), v.null()),   // null for bots; localStorage token for humans
  isBot: v.boolean(),
  botDifficulty: v.optional(v.union(v.literal('easy'), v.literal('medium'), v.literal('hard'))),
  lastSeenAt: v.number(),
}).index('by_room', ['roomId'])
  .index('by_room_token', ['roomId', 'token']),

games: defineTable({
  roomId: v.id('rooms'),
  roundNumber: v.number(),
  dealerStreak: v.number(),         // copied at startHand; scoreWin input
  engine: v.any(),                  // EngineState verbatim (see §2.1)
  deadlineAt: v.union(v.number(), v.null()),   // display countdown only
  schedId: v.union(v.id('_scheduled_functions'), v.null()), // pending deadline fn
  createdAt: v.number(),
}).index('by_room', ['roomId']),

rounds: defineTable({               // settle.ts input, one row per finished hand
  roomId: v.id('rooms'),
  roundNumber: v.number(),
  winnerSeat: v.union(v.number(), v.null()),   // null = wall exhausted
  score: v.number(),
  dealerSeat: v.number(),
  dealerStreak: v.number(),
  winnerName: v.optional(v.string()),
  timestamp: v.number(),
}).index('by_room', ['roomId']),
```

### 2.1 EngineState storage decision

`games.engine` is `v.any()` holding the `EngineState` verbatim, cast to/from the engine type at the convex boundary (`game.engine as EngineState`). Rationale: the engine type is the single source of truth and is fenced by 253 tests; duplicating it as a Convex validator means two hand-maintained copies that drift. The trade (no runtime validation on this field) is acceptable because the only writer is the engine itself via transitions. Documented here so it's a decision, not an accident.

Convex requires documents be JSON-ish: `EngineState` already is (string ids, plain records, no Dates/Maps/undefined at top level). One caveat: Convex rejects `undefined` inside objects: engine optional fields (`Meld.calledTile?`, `WinnerInfo.winningTile?`) are *absent*, never explicitly `undefined`, after `structuredClone`; the transition helper must never spread `undefined` in. A convex-layer test pins this (write+read round-trip of a state containing every optional-absent shape).

## 3. Identity

- Human identity = random 128-bit token generated client-side, kept in `localStorage`, sent with every mutation/query arg (`token: v.string()`). No auth provider (portability constraint 4: no social login).
- `players.by_room_token` resolves token → seat. Rejoin with same token reclaims the seat. (Seat takeover / new-device flow is M3.)
- Queries never trust a seat argument; seat is always derived from token.

## 4. Files and function map (`convex/`)

| File | Contents |
|---|---|
| `schema.ts` | §2 |
| `quickplay.ts` | `createQuickPlay` (public mutation) |
| `intents.ts` | public player-intent mutations (§5) |
| `loop.ts` | internal scheduled mutations: `onDeadline`, `botAct`; shared helpers `applyAndSchedule`, `runEngine` (§6) |
| `views.ts` | public queries: `gameView` (§7) |
| `bots.ts` | thin adapter only: loads state, calls `engine/bots.ts` `chooseBotAction`, maps intent → engine transition. Decision logic lives in the engine package |

`engine/bots.ts` (pure, tested like the rest of the engine):

```ts
export type BotIntent =
  | { kind: 'draw' } | { kind: 'discard'; tile: TileId }
  | { kind: 'selfDrawWin' }
  | { kind: 'concealedKong'; tileType: TileType }
  | { kind: 'upgradeKong'; meldIndex: number }
  | { kind: 'respond'; action: CallAction; chowSelection?: ChowSelection };

export function chooseBotAction(
  view: SeatView, legal: LegalActions, difficulty: 'easy'|'medium'|'hard',
): BotIntent
```

Server computes `legal = legalActions(state, seat)` and `view = viewFor(state, seat)` and passes both; the bot function itself never sees unredacted state. Behavior per spec §5 constants: always win (self-draw and call); always kong on discard when legal, always concealed kong / pung upgrade; pung/chow via shanten thresholds (easy: allowed if shanten doesn't worsen; medium: same-or-better; hard: strict improvement, tightens when wall < 20); hard adds the defensive fold (own shanten >= 3 and an opponent shows 3+ melds, or wall < 15 and shanten >= 2 → fold to safe discards); never discards gold (engine bans it anyway); discard choice = `selectSafeDiscard`-style heuristic ordered by shanten then safety. Requires a shanten estimator over `ownHand` treating golds as jokers: approximate is fine (bots must be *legal and terminating*, not optimal); property test drives full games to completion, not move quality.

## 5. Public mutations (intents)

All take `{ roomCode, token, ... }`, resolve seat by token, load `rooms.activeGameId`, run the engine transition for that seat, then `applyAndSchedule`. Engine `EngineError` codes return as `{ ok: false, code }` (client shows a toast); they never throw, so no OCC retry storms on user error.

| Mutation | Engine call |
|---|---|
| `intentDraw` | `draw(state, seat)` |
| `intentDiscard { tile }` | `discard(state, seat, tile)` |
| `intentRespond { action, chowSelection? }` | `respondToCall(...)` |
| `intentSelfDrawWin` | gate on `legalActions(state, seat).canSelfDrawWin` first (the engine deliberately does not re-validate shape: M1 decision), then `declareSelfDrawWin` |
| `intentConcealedKong { tileType }` | `declareConcealedKong` |
| `intentUpgradeKong { meldIndex }` | `upgradePungToKong` |
| `nextRound` | ends-state only: `startHand` for the next hand (dealer rotation per spec §1.6: winner-dealer keeps seat & streak+1, else rotate & streak 0; wall-exhaustion = dealer keeps, streak+1?: no: per spec 1.6 exactly; implementer reads that section, tests pin it) |
| `heartbeat` | none; stamps `players.lastSeenAt` (presence badge is M3-cosmetic; mutation exists so the client loop is wired early) |

`createQuickPlay { token, name, difficulty }`: creates room (`status playing`, timers 30/30 per ruling 4, dealerSeat 0), seats "You" at 0 + `Bot-M1..3` (names per spec §5) at 1-3, then inline `startHand`.

`startHand` (internal helper, not public): `shuffle(generateAllTiles(), rng)` with `Math.random` rng → `initHand({dealerSeat, dealerStreak}, tiles)` → insert game doc → if the deal itself ended the hand (Three Golds / Robbing the Gold at setup), settle immediately (§6.3); else `applyAndSchedule`.

## 6. The loop (`convex/loop.ts`): the part that must be right

### 6.1 `applyAndSchedule(ctx, gameDoc, state, now)`

Single choke point called after every successful transition batch. Steps:

1. Best-effort cancel the stored `schedId` (if any, and status pending).
2. Compute what happens next from `state`:
   - `phase === 'ended'` → §6.3 settle path; `deadlineAt/schedId = null`.
   - `phase === 'playing'`: actor = `currentPlayerSeat`.
     - Bot seat → `schedId = scheduler.runAfter(BOT_DELAY_MS, internal.loop.botAct, { gameId, expectedSeq: state.seq })`; `deadlineAt = null` (no countdown renders for bots).
     - Human seat and `turnTimerSeconds != null` → `deadlineAt = now + turnTimerSeconds*1000`; `schedId = runAfter(..., internal.loop.onDeadline, { gameId, expectedSeq: state.seq })`.
     - Human, timer off → both null.
   - `phase === 'calling'`: two schedules conceptually, one stored id:
     - If any *bot* seat is `'waiting'` → schedule `botAct` at `BOT_DELAY_MS`.
     - If any *human* seat is `'waiting'` and `callingTimerSeconds != null` → `deadlineAt = now + callingTimerSeconds*1000` and schedule `onDeadline` there.
     - Store the **deadline** schedule in `schedId` when both exist; the botAct schedule is fire-and-forget (stale ones die on the seq guard; that guard, not cancellation, is what correctness rests on).
3. Patch the game doc: `engine`, `deadlineAt`, `schedId`.

`BOT_DELAY_MS = 900` (spec ballpark 800-1000; one constant, easy to tune).

Divergence note (no ruling needed: server internals, not game rules): v1 bots waited for all humans before responding in a calling phase. v2 bots respond after `BOT_DELAY_MS` regardless; the engine holds resolution until all four responses are in, so humans keep their full timer either way.

### 6.2 Scheduled mutations

`onDeadline({ gameId, expectedSeq })`:
1. Load game. `state.seq !== expectedSeq` → return (stale; log skew silently only when live: `console.log` skew vs deadlineAt).
2. `phase 'playing'` → auto-play the current seat exactly like v1's `autoPlayExpiredTurn`: if `needsToDraw` → `draw`; then `legalActions.canSelfDrawWin` → `declareSelfDrawWin`; else `discard(selectSafeDiscard(...))`. (Auto-win on timeout is v1 behavior: the player shouldn't lose a won hand to a lock screen; keep it.)
3. `phase 'calling'` → `respondToCall(seat, 'pass')` for every seat still `'waiting'`: humans and (backstop) bots alike, in seat order. In-call resolution happens inside the engine on the 4th response.
4. `applyAndSchedule` once at the end.

`botAct({ gameId, expectedSeq })`:
1. Seq guard, same as above.
2. `phase 'playing'` and current seat is a bot → build `view` + `legal`, `chooseBotAction`, map intent → transition. A bot turn is usually two transitions (draw, then act on the post-draw state): loop `while` current seat is the same bot and phase is 'playing', max 4 iterations (draw → kong replacement chains), calling `chooseBotAction` fresh each step.
3. `phase 'calling'` → for each bot seat `'waiting'` in seat order: `chooseBotAction` on the calling decision, `respondToCall`. Engine may resolve mid-loop (4th response): re-check phase each iteration; if resolution hands the turn to a bot, do NOT continue inline; fall through to `applyAndSchedule`, which schedules the next `botAct`. Keeps each mutation small and each bot move visibly delayed.
4. `applyAndSchedule`.

Self-healing backstop (pre-mortem risk 1): every *intent* mutation, before running its transition, checks `deadlineAt != null && now > deadlineAt + 2000` and, if so, first re-runs the `onDeadline` logic inline (guarded by seq as usual). A lost scheduled function then costs at most one player-action of delay, never a stall.

### 6.3 Hand end (settle path)

When a transition returns `phase 'ended'`:
1. Insert `rounds` row: from `state.winner` (or null winner on `wall_exhausted`), score = `winner.score.total`, dealer fields from the game doc.
2. Update room: dealer rotation + streak per spec §1.6, `roundNumber + 1`, `activeGameId` stays pointing at the ended game (clients render the winner reveal from it): cleared by `nextRound`.
3. No auto-next-round in M2: bots are "always ready"; the human taps Next Round (`nextRound` mutation → `startHand`). Session totals/settle-up display is M3.

## 7. Query (`convex/views.ts`)

`gameView({ roomCode, token })` → one object or null:

```ts
{
  room: { code, status, callingTimerSeconds, turnTimerSeconds, roundNumber },
  players: [{ seat, name, isBot, connected? /* M3 */ }],
  seat,                       // viewer's seat (null → spectator, M3/M4)
  view: SeatView,             // viewFor(engine, seat): engine-side redaction
  deadlineAt,                 // client renders countdown; display only
  rounds: GameRound[],        // for the session scoreboard later; cheap now
}
```

Privacy tests port to the convex layer: the convex-test result of `gameView` for seat A must contain no seat-B concealed tile ids in any phase (re-assert at this boundary even though `viewFor` is already tested: the leak class in v1 was at the transport layer).

## 8. Client (M2-minimal)

Replace spike `src/App.tsx` with the smallest playable UI; polish is M4. Screens: Home (name + difficulty + Quick Play button), Game (opponent strips with tile-back counts + melds + bonus, discard pile, gold indicator, own sorted hand as tap-to-select tiles, action bar: Draw/Discard/Win/Kong/Pung/Chow/Pass with visibility derived cheaply from the SeatView (hand size vs meld count, pendingCalls status); the server does NOT send LegalActions to clients; buttons are hints, and the server rejects illegal intents with an error code (as built 2026-07-22), countdown bar from `deadlineAt`, winner overlay with score breakdown + Next Round). Unicode mahjong glyphs / plain colored tiles are fine. One `useQuery(gameView)` + `useMutation` per intent; token helper in `src/lib/identity.ts` (localStorage, `crypto.randomUUID()`); countdown = `requestAnimationFrame` against `deadlineAt` (display only). Plain DOM/CSS/Tailwind per portability constraints.

## 9. Tests (convex layer, `convex-test` + vitest)

`convex-test` runs mutations/queries against an in-memory backend with fake timers (`vi.useFakeTimers` + `t.finishInProgressScheduledFunctions()`), which is exactly what the timer matrix needs. New dev-dep: `convex-test`.

1. **Timer expiry, playing**: start Quick Play-like game with human current; advance clock past deadline; run scheduled; assert auto-draw+discard happened, seq advanced, new schedule stored.
2. **Timer expiry, calling**: human `'waiting'`; expiry auto-passes; resolution proceeds.
3. **Stale timer no-ops**: act before expiry, then force-run the superseded scheduled fn; assert state unchanged (seq guard).
4. **Cancel-and-replace**: player action mid-countdown reschedules; old fn either canceled or no-ops.
5. **Bot game to completion**: 4 bots, no clients; pump scheduler until `phase 'ended'` or `rounds` row exists; assert tile conservation via the engine invariant at each pump. (Test-plan item 7; also the bots' termination proof.)
6. **Privacy at the query boundary**: §7.
7. **Round-trip storage**: §2.1 optional-fields caveat.
8. **Self-healing backstop**: kill the scheduled fn (never run it), advance clock, send an intent; assert the deadline logic ran first.
9. **Instant-win deal**: `startHand` seeded/mocked to a Three Golds deal settles immediately, `rounds` row written (mock `Math.random` or inject via an internal test-only mutation arg).

Engine-side: `engine/__tests__/bots.test.ts`: legality (every intent chosen is accepted by the engine across seeded views), never-discard-gold, difficulty threshold behaviors, and the seeded full-game property test (4 bots via pure engine loop, no Convex) terminating within wall bounds.

## 10. Model routing for M2 implementation

Per project CLAUDE.md:
- Fable (this doc + audits + any timer/OCC/resync bug directly).
- Opus: `convex/loop.ts` + `intents.ts` + settle path (the hard bounded part), and `engine/bots.ts` shanten heuristics.
- Sonnet: schema/quickplay/views boilerplate, convex-test suite from §9, minimal client from §8.

Order: (1) delete spike files + schema (mechanical, now); (2) `engine/bots.ts` + `convex/` layer in parallel (interface pinned above); (3) convex-test suite; (4) Fable audit; (5) client; (6) iPhone gate.

## 11. Pre-gate review checklist (run before the iPhone gate)

- [ ] Every scheduled function starts with the seq guard; grep proves no exceptions.
- [ ] Every successful transition path ends in exactly one `applyAndSchedule`.
- [ ] No engine import outside `engine/` re-implements a rule (search `convex/` for hand/tile manipulation outside transitions).
- [ ] `gameView` is the only public query touching `games`; no query returns raw `engine`.
- [ ] Intent errors return codes, never throw.
- [ ] Backstop (§6.2) present in every intent mutation.
- [ ] Convex dashboard: no failing scheduled functions during a full local bot game.
