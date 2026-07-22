# Pre-Implementation Plan: Mahjong v2 (v1-parity rebuild)

Inputs: `~/Documents/claude/home/brainstorms/2026-07-13-mahjong-rebuild.md` (10 decisions), `research-v1-spec.md` (rules + state map of v1), `research-stack.md` (stack comparison, 2026-07-13).

## Problem Statement

Rebuild Fuzhou Mahjong from scratch as a server-authoritative realtime web game, using the archived v1 only as spec and benchmark, so that the bug class that killed v1 (game progress depending on client liveness) cannot exist.

## Acceptance Criteria ("usable", from brainstorm Q3)

1. Quick Play: full game vs 3 server-run bots, started in one tap on a phone.
2. Multiplayer: create room, share 6-char code, 4 humans play a full session with cumulative scores and settle-up.
3. The v1 killer scenario passes: any or all phones locked for minutes mid-game, timers still fire, game advances, waking clients resync without refresh.
4. Exact rule parity with v1 code behavior; the ported 131-test suite passes against the new engine.

## Existing Code Review (what already exists)

- v1 archive at `~/Documents/claude/_archive/mahjong/`: read-only spec + benchmark. Engine was `lib/tiles.ts` (1,516 LOC, pure), `lib/game.ts` (2,872 LOC, Firebase-coupled), `lib/settle.ts` (117 LOC, pure).
- 131 tests (66 tiles, 43 game, 22 settle), all pure engine, portable as v2 acceptance suite. Gap: the scoring formula itself has zero direct tests; v2 adds them.
- Full rules digest, feature parity checklist, v1 state map, and constants live in `research-v1-parity/research-v1-spec.md` sections 1-5. That file is the spec; do not re-read v1 code during the build except to settle a spec ambiguity.
- Nothing gets ported. v1 LOC and session counts serve as the benchmark baseline for the comparison memo.

## Dependencies

- Convex (backend platform, free plan): mutations, reactive queries, `ctx.scheduler`. Docs read; gotchas logged in findings.md.
- Vite + React + TypeScript + vite-plugin-pwa (client). Tailwind for styling.
- Vercel or Cloudflare Pages for static hosting (decide at M2; both free).
- No other external services. No Firebase, no GCP.

## Proposed Approach

**Stack: Convex + Vite React TS PWA.** Runner-up documented in research-stack.md section 7 (Cloudflare Durable Objects + partyserver); switch is forced only if spike gates fail. Reasoning summary: mutations make server authority the platform default, `scheduler.runAfter` is transactional with the turn change and fires with every phone locked, reactive queries give reconnection resync for free, expected cost $0.

**Architecture:**

```
engine/    pure TS rules package: tiles, deal, calls, win detection, scoring, settle
           zero Convex imports; the only part that must be correct to the tile
convex/    thin adapter: schema, intent mutations (validate via engine, write state,
           schedule/cancel timers), bot turns as scheduled mutations, redacted queries
src/       Vite React PWA: renders server state, sends intents, client-side countdown
           display driven by server deadlineAt (display only, never authoritative)
```

### Trade-off table (condensed from research-stack.md)

| Approach | Pros | Cons | What you give up |
|---|---|---|---|
| Convex (chosen) | Authority + transactional timers + auto resync built in; $0 hard-capped; best agent DX (generated types) | No scheduler precision SLA (spike measures); hard cap halts app if quota burned | Platform independence (softened: FSL self-hostable, engine stays pure TS) |
| Cloudflare DO + partyserver | Closest to a generic room server; $0; portable actor shape | Hand-rolled resync; at-least-once alarms with stale-alarm bug reports; thinner docs | Delivered reconnection and typegen; more concepts to hold |
| Firebase reshaped | Familiarity | Authority simulated over client-writable DB; timers = Cloud Tasks + IAM, untestable in emulator; cold starts after idle | Local testability of the most failure-prone path |

### v2 State Map (required: where every piece lives)

| State | Lives | Written by | Clients learn | Out-of-sync handling |
|---|---|---|---|---|
| Game state (wall, hands, melds, discards, turn, phase, log) | `games` table | Mutations only, each validated by engine | Reactive query per seat | Single serializable writer; no divergent copies possible |
| Per-seat hand privacy | Same doc, redacted in query layer | Mutations | Each seat's query returns own hand + public info only | Test asserts subscription payload never contains another seat's hand (v1 leaked this) |
| Turn/calling deadline | `deadlineAt` field + stored scheduled-function id | Turn-advance mutations (schedule + cancel by id) | `deadlineAt` renders countdown | Authoritative timeout is the scheduled mutation with turn-counter guard; stale timers no-op |
| Bots | No client execution | Turn mutation schedules `botTakeTurn` (runAfter ~1.5s) | Same reactive query | Turn-counter idempotence guard vs OCC retries |
| Presence badges | `lastSeenAt` heartbeat field | Client heartbeat mutation (~20s) | Query | Cosmetic only: server timers drive progress, so presence gates nothing (v1's watchdog is deleted, not rebuilt) |
| Identity/seat claim | Token in localStorage, seat binding in `players` | `joinRoom` mutation | Query | Rejoin with same token reclaims seat; new token on new device takes over seat (last claim wins) |
| Prefs (sound, shortcuts) | localStorage | Client | n/a | Device-local by design |
| Session scores, rounds, settle-up | `rounds` table + game doc totals | Round-end mutations | Query | Same single-writer guarantee |

### Milestones (each independently shippable, side-slot pacing)

- **M0 Spike (first session, ~1-2h).** Execute research-stack.md section 8 checklist (8 gates). Gates 2, 3, 5 failing forces the runner-up stack. Log skew numbers and per-game call burn in BUILD-LOG.md.
- **M1 Engine.** `engine/` implements spec section 1; port the 131 v1 tests + add scoring-formula tests. Gate: suite green with no Convex imports anywhere.
- **M2 Server game loop.** Schema + intent mutations + timers + server-side bots. Gate: full Quick Play game vs 3 bots on a real iPhone, with the screen locked through at least one calling phase and one full bot turn.
- **M3 Multiplayer.** Rooms, join by code, seat claim/rejoin, 4-human session, cumulative scores, settle-up, score edit, game log, ready/next-round, abort. Gate: the acceptance criteria 2 and 3 scenario passes with 2+ real devices.
- **M4 Parity polish.** Mobile-first UI pass, PWA install, sounds, shortcuts, rules modal, winner reveal, spectator, error boundaries, OG/SEO (the "polish" rows of the parity checklist). Then write the v1-vs-v2 comparison memo (brainstorm Q7).
- **M5 App Store decision point (optional, post-M4, added 2026-07-21).** Only if people are actually playing: one-day Capacitor spike. Wrap the built web client in a native iOS shell, run on device via Xcode, verify Convex reconnect inside the webview. Ship decision weighs $99/yr Apple account + App Review (guideline 4.2 "minimum functionality" wants a few native touches: haptics, share sheet, offline states) against the PWA already covering home-screen install. Not a rewrite: same Vite React client, same Convex backend.

### Platform Portability Constraints (added 2026-07-21, for the M5 option)

Build rules from M1 onward so the App Store path stays a wrap, not a rewrite:

1. **No load-bearing PWA-only APIs.** Web push, badging, and service-worker tricks stay cosmetic; game-critical flows never depend on them.
2. **Platform-flavored features (sounds, haptics, storage) go behind one small wrapper module** so Capacitor plugins can slot in later without touching call sites.
3. **Rendering stays plain DOM/CSS (Tailwind)** with no PWA-specific layout assumptions; it must port into a webview untouched.
4. **No third-party social login, ever.** Anonymous token + room-code play (already the identity design) dodges Apple's Sign in with Apple requirement. No real-money anything, which keeps App Review out of gambling territory.

### Scale Posture (added 2026-07-21)

Ruled with Teng: no milestone changes for the "thousands playing at once" scenario. The architecture is already per-room and horizontally scalable: each game is one document, mutations/timers/bots are per-game, no global state, no singleton. Convex runs functions on demand, so 10 rooms and 10,000 rooms are the same code. What changes at scale is billing and product surface, not plumbing:

1. The $0 free-plan assumption breaks first. Gate 7's per-game call burn doubles as the unit-cost input for a paid-plan decision (calls per game x games per day x price).
2. Lobby/matchmaking beyond shared room codes, room-creation rate limiting, and abuse handling become features to add. 6-char codes themselves hold (~2B combinations).
3. Ops maturity (monitoring, skew alerting at volume, staging deploy) is additive, not a redesign.

Deliberate consequence: nothing in the current design forecloses scale, so no pre-building for it. The pre-mortem's top risk stays project parking, not traffic.

### Files to Create (kickoff, before M0)

| File | Description |
|---|---|
| `README.md` | What this is, stack, benchmark framing |
| `BUILD-LOG.md` | Per-session log: date, hours, shipped, broke (brainstorm Q7) |
| `learnings.md` | Standard corrections log |
| `.gitignore` | `HANDOVER.md`, `.env*`, `node_modules`, `dist`, `.claude/settings.local.json` (repo is PUBLIC) |
| `engine/`, `convex/`, `src/` | Per architecture above, scaffolded in M0/M1 |

## Parity Rulings (v1 code vs rules doc conflicts)

RULED BY TENG 2026-07-13: v2 matches v1 CODE behavior on all four real conflicts. The code is what people actually played and what the tests encode.

1. Dealer streak bonus = streak banked BEFORE the hand (1st dealer win +0, 2nd +1, 3rd +2). The doc's +3-on-3rd example is rejected.
2. Winning immediately after your own Chi/Peng completes the hand: blocked. Gang replacement-draw wins stay allowed.
3. Discarding a gold tile: banned outright. No penalty subsystem.
4. Timer bounds in UI: 5-120s, default 30s, or off. Quick Play 30s/30s.
5. (Added 2026-07-22 during M1, default-ruled by Claude per Teng's blanket "match v1 code" principle; flag for Teng to re-rule if desired.) Gold wildcard chow placement: v1's win checker never lets a gold stand in for a tile BELOW the lowest real tile of a run (holding 8+9, a gold cannot complete 7-8-9; holding 6+7 it CAN complete 6-7-8). The rules doc's "substitutes for any tile" disagrees. v2 matches the code; pinned by engine/__tests__/parity-edges.test.ts.
6. (Self-resolving, no ruling needed) Scoring values: code and `mahjong-rules.md` agree (+15/+30/+30/+50/+100 table); the stale comments in v1 `types/index.ts` are ignored.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Scheduler skew or missed timer stalls a game | Spike gates 2-3 before commitment; turn-counter guard; every state-advancing mutation re-checks `deadlineAt` vs now as a self-healing backstop; timer mutations log skew |
| Free-plan hard cap halts app mid-session | Spike gate 7 extrapolates burn; one coarse game-state query per client; usage check added to BUILD-LOG ritual |
| Engine re-derivation stalls on Fuzhou edge cases | Spec section 1 + 131 ported tests as ground truth; logged fallback: port v1 `lib/` (brainstorm Q2 fallback) |
| iOS Safari PWA suspend breaks resync | Spike gate 5 on a real iPhone, PWA-installed, airplane-mode variant included |
| Hand privacy leak repeats | Redacted query layer + explicit test on subscription payloads |
| OCC retry races from bot chains | Spike gate 6; single chained mutation per bot turn; idempotence guards |
| Project parks at the 2026-08-01 re-triage | Milestones independently valuable (M1 alone = clean tested engine, publishable); BUILD-LOG + progress.md make cold resumption cheap |
| Public-repo leak | `.gitignore` at kickoff (HANDOVER, .env); Convex secrets live in dashboard/env, client bundle has only the public deployment URL |

## Test Plan (written before implementation)

1. Ported v1 suite (131 tests) green against `engine/`: tiles, melds, calls, win detection, game flow, settle.
2. New scoring-formula tests (v1 gap): every bonus row in spec 1.7, dealer streak progression, multiplier stacking.
3. Engine property tests: full-game simulation with random seeds never reaches an illegal state (wall count + hands + melds + discards always sum to 128).
4. Timer tests (Convex layer): expiry auto-passes calling phase; expiry auto-draws/discards on turn; stale timer (old turn counter) no-ops; player action cancels and reschedules.
5. Privacy test: seat A's query result contains no seat B hand tiles in any phase.
6. Reconnect test (manual, scripted steps): airplane mode 2 min mid-calling-phase, return, converged without refresh.
7. Bot game test: 4-bot game runs to completion server-side with no client connected at all.

## Pre-Mortem (required)

Imagined incident, 3 months out: "Family sat down Saturday night, game froze on the third hand, everyone went back to the physical table. Repo untouched since."

Failure modes and corrections:
1. **Timer never fired (external dep).** Scheduled mutation lost or skewed. Correction now: spike measures skew before commitment; self-healing deadline re-check in every mutation; skew logged so drift is visible in dashboard logs.
2. **Quota halt mid-session (ops).** Hard cap reached silently. Correction: spike gate 7 burn math; monthly usage glance in BUILD-LOG ritual; query design keeps calls coarse.
3. **Engine wrong on a rare rule (data integrity).** Robbing-the-gold or bonus-phase edge mis-implemented, discovered mid-family-game. Correction: port v1 tests first (M1), add formula + property tests, treat spec section 1 as contract; ambiguities resolved against v1 code behavior (rulings above).
4. **Resync fails on iOS PWA (edge case).** Wake-from-lock shows stale board. Correction: spike gate 5 is a hard gate; if it fails, runner-up stack before any feature work.
5. **Silent death by side-slot (operations).** Not a code failure: momentum failure. Correction: milestone gates are demo-able states; BUILD-LOG entry per session; 8/1 re-triage decision pre-scheduled in brainstorm Q8.

Assumptions to verify empirically (all in M0 spike, before feature code): scheduler precision, timer-fires-while-dead, iOS resync, per-game call burn, OCC behavior under bot chains. One assumption verified during M1 day one: the 131 tests adapt to the new engine API with a thin adapter (port 5 as proof before porting all).

**Verdict: PROCEED WITH REQUIRED MITIGATIONS.** The M0 spike is the commitment gate; gates 2, 3, or 5 failing switches to the documented runner-up with the engine unaffected.

## Confirmation (closed 2026-07-13)

1. Stack: Convex + Vite React TS PWA, spike-gated. APPROVED.
2. Parity rulings: match v1 code behavior, ruled individually on all four conflicts (section above). APPROVED.
3. Milestones M0-M4 with "usable" = through M3. APPROVED.

Plan is final. Approach changes from here get logged as strategy.md edits with a dated note.
