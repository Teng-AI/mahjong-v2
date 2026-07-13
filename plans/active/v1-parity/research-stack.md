# Stack research: mahjong v2 rebuild

Researched 2026-07-13. Every limit, price, and status below was checked against the linked page on that date unless a different date is noted. Prices and free tiers drift: re-verify before any paid commitment.

## 1. Requirements recap

1. Server-authoritative state. Clients send intents, server validates against rules, server broadcasts state. Clients never compute game state.
2. Server-enforced timers, configurable 10-120 seconds, that fire while every player's phone is locked. This is the exact v1 failure: timers lived in client setInterval.
3. Realtime push with a clean reconnection story. Phone screen locks mid-game, wakes 2 minutes later, client resyncs to current state.
4. Under 20 concurrent users, extremely spiky (idle for days, then 2-hour sessions). Target $0-10/month.
5. Solo non-engineer driving AI coding agents. CLI deploys, TypeScript throughout, good docs, minimal babysitting. Existing familiarity: Firebase, GCP, Vercel, GitHub Actions.
6. Mobile-first web + PWA, iOS Safari add-to-home-screen included.

## 2. Candidate A: Convex

Hosted reactive database plus serverless TypeScript functions. Clients talk to it over one websocket: they call mutations by name and subscribe to queries.

**Authority model.** Mutations are the only write path. A `discardTile` mutation runs on the server, reads the game document, validates against the rules engine, writes the new state. Clients cannot write tables directly, so requirement 1 falls out of the architecture with zero extra plumbing. Mutations are serializable transactions under optimistic concurrency control: on conflict Convex re-runs the mutation automatically, which requires mutations to stay deterministic (no fetch, no random side effects outside `ctx`). Source: [OCC and atomicity](https://docs.convex.dev/database/advanced/occ).

**Timers (requirement 2).** `ctx.scheduler.runAfter(ms, fn, args)` and `runAt`. The load-bearing properties, per the [scheduling docs](https://docs.convex.dev/scheduling/scheduled-functions):

- Scheduling from a mutation is transactional: the timer is scheduled if and only if the mutation commits. Turn state and turn timer cannot desync.
- Scheduled mutations execute exactly once, with automatic retries on internal errors. Scheduled actions are at-most-once (do not put the timer in an action).
- Cancelable via `ctx.scheduler.cancel(id)`, so "player acted before deadline" is: cancel stored timer id, schedule the next one.
- Runs entirely server-side. Client phones can all be locked or dead.
- Caveat: no numeric precision SLA is documented anywhere. `runAfter` takes milliseconds and delay 0 runs immediately after commit, but nothing contractual bounds skew under load. Measure it in the spike.
- Capacity is a non-issue at this scale: up to 1,000 scheduled functions per mutation, on the order of 1M outstanding scheduled functions per deployment ([limits](https://docs.convex.dev/production/state/limits)).

**Realtime and reconnection.** Queries are reactive subscriptions over the websocket; when a mutation changes data a query depends on, the new result is pushed. The client library reconnects and re-establishes the session automatically after network drops ([how Convex works](https://stack.convex.dev/how-convex-works), [overview](https://docs.convex.dev/understanding/)). Because subscriptions are state-based, not event-based, reconnection resync is free: the resubscribed query simply returns the current game state. No event replay code, no "missed messages" class of bug. This is the strongest reconnection story of the three candidates.

**Free tier and pricing** ([pricing page](https://www.convex.dev/pricing), checked 2026-07-13):

- Free plan: 1M function calls/month, 0.5 GB database storage, 1 GB database bandwidth/month, 20 GB-hours action compute, 1 GB file storage.
- Free plan enforces hard caps rather than billing overages ([limits](https://docs.convex.dev/production/state/limits)): a runaway bug stops the app instead of producing a bill. Good for cost, worth knowing for availability.
- Paid overage pricing (Starter/Pro): $2.20 per additional 1M calls, $0.22/GB storage. Pro is $25/developer/month; nothing in this project needs it.
- Rough burn: a 2-hour 4-player session is on the order of a few thousand function calls (one mutation per action plus query re-executions). Dozens of family sessions fit inside 1M/month. Expected cost: $0.

**Limits that matter** ([limits](https://docs.convex.dev/production/state/limits)): 1 second of user code per mutation/query (rule validation for a mahjong discard is microseconds, fine), 10 minutes per action, 1 MiB per document (a serialized game state fits easily).

**Bots.** Server-run bots fit the model as scheduled mutations: when a turn passes to a bot seat, the turn-advance mutation schedules `botTakeTurn` via `runAfter(1500, ...)` for a human-feeling delay, and the chain continues. No long-running loop process needed. Convex's own AI Town sample runs a whole agent simulation this way.

**Dev loop and deploy** ([CLI docs](https://docs.convex.dev/cli)): `npx convex dev` watches files, pushes to a dev deployment, and regenerates TypeScript types; `npx convex deploy` typechecks and ships to prod. Env vars via `npx convex env`, logs via `npx convex logs`. TypeScript is first-class with end-to-end generated types, which is exactly the property that keeps AI coding agents honest.

**Lock-in and portability.** The rules engine should be a pure TS module (tile logic, call resolution, scoring) with a thin Convex adapter for db reads/writes and scheduling; that module ports anywhere. Platform risk is softened by the backend being source-available and self-hostable: FSL Apache 2.0 license, converting to plain Apache 2.0 after two years, with the same code the cloud runs ([self-hosting](https://docs.convex.dev/self-hosting)).

**Gotchas found.** (a) No documented scheduler precision guarantee. (b) Free plan hard caps halt the app if exceeded. (c) OCC means concurrent mutations on the same game document retry; at 4 players this is negligible but bot chains should carry a turn-counter idempotence guard anyway. (d) No offline mutation queue: the client needs a connection to act, which is correct for this game anyway.

## 3. Candidate B: Cloudflare Durable Objects, partyserver lineage

One Durable Object instance per game room: a single-threaded actor that owns room state, terminates websockets, and schedules its own alarm.

**PartyKit status (asked explicitly).** Cloudflare acquired PartyKit on 2024-04-05 ([announcement](https://blog.cloudflare.com/cloudflare-acquires-partykit/)). As of 2026-07-13 the recommended path is not the old partykit.io platform but **partyserver**, "PartyKit for Workers": libraries you deploy to your own Cloudflare account with wrangler. The [cloudflare/partykit monorepo](https://github.com/cloudflare/partykit) (which now houses partyserver, partysocket, y-partyserver, partywhen) had its last push 2026-07-09; npm `partyserver` 0.5.8 was last modified 2026-06-14 and `partysocket` 1.3.0 on 2026-06-23 (npm registry, checked 2026-07-13). The original partykit/partykit platform repo still exists (last push 2026-01-29) and its docs carry no deprecation banner, but the development center of gravity has moved to partyserver on plain Workers. The partyserver README self-describes as a work in progress; docs are thinner than Convex's or Cloudflare's core docs.

**Free plan availability and limits** ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), checked 2026-07-13). Durable Objects are available on the Workers Free plan, SQLite storage backend only. Daily free limits: 100,000 requests, 13,000 GB-s compute duration, 5M SQLite row reads, 100,000 row writes, 5 GB total storage. Incoming websocket messages bill at a 20:1 ratio (100 messages = 5 request units); outgoing messages are free; `setAlarm()` counts as one row write. The fronting Worker gets 100,000 requests/day and 10 ms CPU per invocation on free ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)), which is enough to proxy websocket upgrades. Workers Paid is $5/month if the project ever outgrows free. Expected cost at family scale: $0.

**Alarms as the timer primitive** ([Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)). One alarm per object at a time; `setAlarm()` overwrites, `deleteAlarm()` clears. That maps cleanly to "one next deadline per room". Execution is guaranteed at-least-once with automatic retries (exponential backoff from 2 s, up to 6 retries), and an alarm wakes a hibernated or evicted object (constructor runs first, then `alarm()`). Two caveats: no numeric precision SLA is documented (the [2022 launch post](https://blog.cloudflare.com/durable-objects-alarms/), 2022-05-11, commits only to failure recovery in under 30 s), and there are open community reports of alarms stuck in the past without firing ([cloudflare-docs issue #18324](https://github.com/cloudflare/cloudflare-docs/issues/18324)). At-least-once also means the handler must be idempotent (turn-counter check before acting).

**Websockets and hibernation** ([hibernation docs](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)). The Hibernation API lets the DO sleep between messages while clients stay connected at the edge, which is what makes the spiky usage pattern cheap. Gotchas that will bite an AI-agent-driven build if not spelled out: in-memory state is wiped on hibernation (rehydrate from SQLite storage in the constructor); `setTimeout`/`setInterval` prevent hibernation entirely (alarms are the only sanctioned timer); per-connection `serializeAttachment` is capped at 16,384 bytes; incoming pings get automatic pongs without waking the object; every deploy severs all websockets, so clients must auto-reconnect.

**Reconnection story.** DIY. `partysocket` handles auto-reconnect with buffering, but the resync contract is yours: on `onConnect`/open, the DO sends a full serialized game state snapshot. Simple to write, but it is code you own, and it is the part that silently rots.

**DX and ops.** `wrangler dev` runs Workers, DOs, and alarms locally (workerd/miniflare); `wrangler deploy` ships. Solid, mature tooling. More concepts than Convex: DO class bindings and migrations in wrangler config, actor lifecycle, hibernation handler methods, storage API. No built-in data dashboard for inspecting room state; you build debug endpoints.

**Lock-in and portability.** The pure-TS rules engine ports untouched. The actor-plus-alarm shape is Cloudflare-specific, but it is also the closest of the three to a generic "game server room" abstraction, so a future port to a Node process (Colyseus-style) is mostly mechanical. partyserver and partysocket are open source.

## 4. Candidate C: Firebase, reshaped for server authority

The shape: clients write intent documents to a queue collection (Firestore) or path (RTDB); an `onDocumentCreated` 2nd-gen function validates the intent against the rules engine and writes canonical state; security rules make state read-only and intents append-only for clients; clients hold snapshot listeners on the state doc.

**Timers: the real pattern.** Cron-style scheduled functions have 1-minute granularity, too coarse for 10-120 s turn timers. The workable pattern is **task queue functions backed by Cloud Tasks**: when a turn starts, the state-writing function enqueues a task with `scheduleDelaySeconds` (second-level scheduling) targeting a `onTaskDispatched` function that fires the timeout ([task functions docs](https://firebase.google.com/docs/functions/task-functions)). Delivery is at-least-once with queue-level `retryConfig`; cancellation is best handled by version-checking (task carries game id + turn counter; on fire, compare against current state and no-op if stale), which you need anyway for idempotence. Setup requires Blaze plan plus IAM wiring (`cloudtasks.tasks.create` on the enqueuing identity, invoker permission on the task function). It works, but the timer primitive is an external queue service stapled on, not a first-class feature. Emulator gotcha, confirmed as an open issue: the Cloud Tasks emulator ignores `scheduleDelaySeconds`/`scheduleTime` and runs tasks immediately ([firebase-tools #8254](https://github.com/firebase/firebase-tools/issues/8254)), so the single most failure-prone part of the system cannot be tested locally with real delays.

**Latency per game action.** Each action pays: intent write, Eventarc trigger dispatch, function execution, state write, listener push. Warm, that stacks several network hops beyond what Convex or a DO does in one. Cold, it adds seconds: third-party measurements report cold starts adding 5-30 s in bad cases ([site24x7 analysis](https://www.site24x7.com/blog/solving-slow-startup-times-in-gcf)); 2nd-gen concurrency (default 80) reduces how often instances start ([Firebase blog, 2022-12](https://firebase.blog/posts/2022/12/cloud-functions-firebase-v2/)) but does nothing for the zero-to-one start after days of idle, which is precisely this project's usage pattern. Every family session opens with a sluggish first hand unless min-instances are paid for, which defeats scale-to-zero economics.

**Cost** ([Firebase pricing](https://firebase.google.com/pricing), checked 2026-07-13). Blaze no-cost quotas: Functions 2M invocations/month, 400K GB-s, 200K CPU-s, 5 GB egress; Firestore 1 GiB stored, 50K reads/20K writes/20K deletes per day; RTDB 1 GB stored, 360 MB/day download. Cloud Tasks has its own Google Cloud free tier (1M operations/month). Realistic cost at this scale: $0, but Blaze means a card on file and no hard cap; budget alerts are advisory only.

**Honest complexity verdict.** This is the most moving parts of the three candidates by a wide margin: two function types plus a queue service plus security rules plus IAM roles plus an emulator that cannot exercise the timer path. Server authority is simulated on top of a client-writable database rather than being the native model, and the security rules that enforce it are exactly the kind of easy-to-get-subtly-wrong artifact a solo non-engineer should not own. Familiarity is real but buys the wrong thing here: v1 familiarity was with Firebase as a client-driven store, and that model is what failed. Verdict: workable, not recommended.

## 5. Brief scans

**Colyseus** (npm `colyseus` 0.17.10, modified 2026-05-22). Authoritative room framework for Node with TypeScript, state sync, and room timers; conceptually a perfect fit for requirement 1 and 2. The disqualifier is operational: it needs a long-lived stateful process holding websockets and in-memory rooms. Cloud Run scale-to-zero kills rooms and timers mid-game, so you must pin an always-on instance; Fly.io has no free tier and a small always-on app realistically lands $5-25/month; [Colyseus Cloud starts at $15/month](https://colyseus.io/pricing/) (checked 2026-07-13), over budget. You also own process health, deploy draining, and crash recovery. Highest ops burden of anything evaluated, for capability this game does not need.

**Supabase.** Realtime (broadcast/presence/postgres changes) is transport only; authority would be Postgres RPC or Edge Functions plus RLS, and timers would be Supabase Cron, which does now support 1-59 second schedules ([Supabase Cron](https://supabase.com/blog/supabase-cron)) polling a deadlines table. Assemblable, but two findings disqualify it: the architecture is stitched from four subsystems (RLS, RPC, cron, realtime channels) with the authority boundary living in SQL policies, and the free plan pauses projects after 1 week of inactivity with a 2-project cap ([pricing](https://supabase.com/pricing), checked 2026-07-13). Idle-for-days is this project's core usage pattern; a paused project when the family sits down to play is unacceptable, and the fix is $25/month Pro.

**Purpose-built platforms.** No purpose-built platform has become a strong 2026 default for tiny server-authoritative turn-based games; the field is the same names as 2024. Playroom is explicitly host-client: one player's device runs the logic (`isHost()`), per its [multiplayer docs](https://docs.joinplayroom.com/multiplayer), which reproduces the v1 failure mode on a player's phone and fails requirement 1 outright. boardgame.io (npm 0.50.2, modified 2026-07-02) is a nice turn-based state machine but its server still needs always-on hosting, inheriting Colyseus's ops problem. Rivet and Hathora target session-based realtime games with dedicated server processes; both are heavier than a 4-player family mahjong room warrants. None displaces candidates A or B.

## 6. Comparison table

| | Convex | Cloudflare DO + partyserver | Firebase (intent queue + functions) |
|---|---|---|---|
| Authority model | Mutations are the only write path; server TS functions, serializable transactions | One actor per room owns state; single-threaded, storage-backed | Functions validate intents; security rules must fence a client-writable DB |
| Timer primitive | `scheduler.runAfter`: transactional with state change, exactly-once, cancelable, no precision SLA | Alarms: one per object, at-least-once, retries, fires from hibernation, no precision SLA, stale-alarm bug reports | Cloud Tasks `scheduleDelaySeconds`: second-level, at-least-once, IAM setup, emulator ignores delays |
| Reconnection story | Automatic: reactive query resends current state on reconnect, no replay code | partysocket auto-reconnects; full-state resync push is hand-written | SDK listeners resync snapshots automatically; good |
| Free tier fit ($/mo expected) | 1M calls/mo, hard caps, $0, no card | 100K req/day, 13K GB-s/day, ws messages 20:1, $0, no card | Blaze quotas cover it, $0 typical, card on file, no hard cap |
| Ops burden | Lowest: hosted, no infra objects | Low: wrangler only, but actor lifecycle + migrations are yours | Medium-high: rules, IAM, queues, two function types |
| Docs / agent DX | Excellent docs, generated end-to-end types, one CLI | Core CF docs strong; partyserver docs thin (WIP); local dev covers DO + alarms | Mature docs; timer path untestable in emulator |
| Lock-in / pure-TS engine portability | Engine ports; ctx.db + scheduler calls are Convex APIs; backend source-available (FSL, self-hostable) | Engine ports; actor + alarm shape is CF-specific but closest to a generic room server; libs OSS | Engine ports; triggers + tasks + rules are GCP-specific glue |

## 7. Recommendation

**Recommended: Convex, with a Vite + React + TypeScript PWA front end.** Runner-up: Cloudflare Durable Objects with partyserver.

Reasoning against the requirements:

1. **Authority (req 1).** Convex makes server authority the default physics of the platform: clients can only call mutations. There is no security-rules layer to get wrong and no client-writable surface to fence off. DO is equally sound but you assemble the message handling; Firebase simulates authority on top of a client-writable database.
2. **Server timers (req 2, the v1 killer).** `ctx.scheduler.runAfter` is the best timer primitive of the three for this exact failure mode: it is scheduled in the same transaction as the turn change (state and timer cannot desync), executes exactly once with retries, is cancelable by id, and runs server-side whether or not any phone is awake. DO alarms are close but at-least-once, capped at one per object, and carry open stale-alarm bug reports; Firebase timers are an external queue service with IAM setup and no local testability. The only Convex weakness is the missing precision SLA, which the spike measures before commitment.
3. **Reconnection (req 3).** State-based reactive queries mean the wake-after-2-minutes case is handled by the platform: resubscribe, receive current state. On DO this is hand-rolled resync code; hand-rolled resync is where turn-based games rot.
4. **Cost (req 4).** $0/month expected, and the free plan's hard caps make surprise bills impossible, at the price of a halt if a runaway bug burns the quota. CF is also $0; Firebase is $0 with a card on file and no ceiling.
5. **Solo + AI-agent operation (req 5).** One mental model (TS functions), one CLI (`npx convex dev`/`deploy`), generated types that catch agent mistakes at compile time, no IAM, no infra objects, first-rate docs. DO requires holding actor lifecycle, hibernation rules, and migration config in your head; Firebase requires the most glue.
6. **PWA client (req 6).** Neutral across candidates; Vite + React PWA on Vercel or Cloudflare Pages works with any of them. The Convex client's auto-reconnect covers the iOS Safari background-suspend cycle, verified in the spike.

**When the runner-up wins instead:** if the spike shows scheduler skew beyond ~2 s at p95, if Convex's proprietary-platform risk weighs heavier than expected (FSL self-hosting is the mitigation, not painless), or if per-message pricing granularity and a portable actor shape matter more than delivered reconnection and typegen. The DO stack is the better long-term "I own the machine" answer; Convex is the better "I want the machine handled" answer. For a solo non-engineer, handled wins.

**Explicit v1 postmortem tie-off:** in the recommended design, the client never runs a timer for game logic. Clients render `deadlineAt` from server state for the countdown UI; the authoritative timeout is the scheduled mutation. A locked phone changes nothing about game progression.

## 8. Spike checklist (1 hour, must pass before committing)

Empirical gates, in order. Failure of 2, 3, or 5 forces the runner-up.

1. **Hello room deployed.** Scaffold Convex + Vite React TS, `npx convex dev`, then `npx convex deploy`. A `rooms` table, a `joinRoom` mutation, a reactive `getRoom` query. Open on two phones (one iOS Safari); mutation on one appears on the other in under ~1 s.
2. **Timer fires with all clients dead.** `startTurn` mutation writes `deadlineAt` and schedules `runAfter(30_000, advanceTurn)`. Lock both phones, kill the browser on one. Confirm in the Convex dashboard that state advanced at deadline. Wake both phones: both clients show the advanced state without a manual refresh.
3. **Scheduler skew measured.** Schedule timeouts at 10 s, 60 s, 120 s, roughly 10 runs each; log scheduled-vs-actual execution timestamps inside the mutation. Gate: p95 skew under ~2 s.
4. **Cancel and replace.** Player acts before the deadline: `scheduler.cancel(storedId)` plus schedule of the next turn's timer. Include a turn-counter guard in `advanceTurn` and prove a stale timer no-ops (fire one deliberately).
5. **Reconnect resync, iOS PWA.** Add to home screen on iOS, start a game, airplane mode for 2 minutes while another client acts, return. Gate: client converges to current state on foreground without refresh. Repeat with the PWA backgrounded rather than airplane-moded.
6. **Bot turn chain.** A bot seat plays via chained `runAfter` mutations; fire 4 near-simultaneous mutations at one game document to smoke-test OCC retry behavior (no lost writes, no user-visible errors).
7. **Quota burn extrapolated.** After a 30-minute 4-player test, read function calls and database bandwidth from the dashboard; extrapolate a heavy month (say 12 sessions) against the 1M-call and 1 GB-bandwidth free caps.
8. **CI deploy path.** `npx convex deploy` with `CONVEX_DEPLOY_KEY` from a GitHub Action, static front end to Vercel or CF Pages; verify the prod URL from a phone on cellular.
