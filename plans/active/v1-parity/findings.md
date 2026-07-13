# Findings: Mahjong v2 (v1-parity rebuild)

Two research passes ran 2026-07-13. Full detail lives in the sibling files; this is the index plus the load-bearing conclusions.

- `research-v1-spec.md` (399 lines): rules digest, feature parity checklist, v1 state map, engine surface, constants. THE spec for the rebuild; avoid re-reading v1 code except to settle ambiguities this file misses.
- `research-stack.md` (126 lines): Convex vs Cloudflare DO vs Firebase-reshaped, with citations checked 2026-07-13, comparison table, spike checklist.

## Research Notes

### Why v1 actually died (state map, spec section 3)
1. Presence-gated liveness: timers, auto-pass, bots, and the offline watchdog all ran as setInterval in browser tabs. A locked phone suspends JS but the RTDB socket lingers, so the seat still reads connected; the watchdog only acts for seats marked disconnected. Result: whole game stalls, nobody can fix it.
2. One-shot expiry: the expire flag was set before the async auto-pass write; if that write failed (typical right after screen wake), that tab could never auto-pass the phase again. Stalls became permanent.
3. No authority: every mutation was client-side get-validate-write; only pendingCalls used a transaction. useBotRunner mounted on EVERY client including spectators, so tabs raced to act for the same bot. drawTile had no atomic guard. Hands and the ordered wall were readable by any signed-in client.

Design consequence for v2: server authority deletes whole subsystems. The offline watchdog, visibility-change handling, and client bot-runner arbitration have no v2 equivalent. Presence becomes a cosmetic badge.

### Stack conclusion (research-stack.md sections 6-7)
Convex recommended, Cloudflare DO + partyserver runner-up, Firebase-reshaped ruled workable-not-recommended. The decisive requirement is server timers: Convex `ctx.scheduler.runAfter` is scheduled transactionally with the turn-change mutation (state and timer cannot desync), exactly-once, cancelable. DO alarms are at-least-once with open stale-alarm bug reports. Firebase needs Cloud Tasks with IAM glue and its emulator ignores task delays entirely (firebase-tools issue #8254), so the most failure-prone path would be untestable locally.

Ruled out with one-line reasons: Colyseus (needs always-on process, $15/mo cloud), Supabase (free projects pause after 1 week idle: fatal for idle-for-days usage), Playroom (host-device authority = v1's failure mode reproduced), boardgame.io/Rivet/Hathora (hosting burden or overkill).

## Gotchas

Convex (chosen stack):
- Mutations must stay deterministic (OCC re-runs them on conflict): no fetch, no randomness outside ctx. Engine RNG must be seeded and stored in game state, or tile shuffles happen inside a single mutation and persist.
- No documented scheduler precision SLA. Spike gate 3 measures skew (p95 target under ~2s).
- Free plan enforces HARD CAPS (1M function calls/mo, 1 GB db bandwidth/mo): overrun halts the app rather than billing. Burn measured at spike gate 7; reactive queries re-run per subscribed client per relevant change, so keep one coarse game-state query per client.
- Scheduled ACTIONS are at-most-once; scheduled MUTATIONS are exactly-once. Timers must be mutations.
- 1 MiB document limit and 1s mutation compute limit: fine for mahjong state, worth knowing.

v1 spec traps (for the engine build):
- 128-tile set with gold/wildcard system, dead wall, bonus expose/replace/gold-flip sequence, Three Golds instant win, Robbing the Gold. Spec section 1 has the details; these are the parts most likely to be wrong on re-derivation, and the ported tests cover them unevenly (scoring formula had zero direct tests in v1).
- Five code-vs-doc conflicts exist; strategy.md "Parity Rulings" fixes v2 to code behavior (pending Teng's confirmation).
- Timer bounds are 5-120s in the v1 UI (doc says 10-120s); lib clamps turn timer to 5-300s.

Process:
- The humanizer hook scans every file written in this workspace: no em dashes, no banned vocabulary. Subagent prompts for this project must carry the style warning or their Writes get blocked mid-task.
- v1 benchmark numbers for the comparison memo: engine 1,516 + 2,872 + 117 LOC, game page peaked at 3,665 LOC, 131 tests, ~3 months of sessions (2026-02 to 2026-04-30 per CHANGELOG).

## Relevant Code

- v1 archive (READ-ONLY): `~/Documents/claude/_archive/mahjong/` (app/src/lib/ for engine reference, mahjong-rules.md for prose rules)
- Brainstorm decisions: `~/Documents/claude/home/brainstorms/2026-07-13-mahjong-rebuild.md`
- Convex docs anchors: docs.convex.dev/scheduling/scheduled-functions, /database/advanced/occ, /production/state/limits, /cli
