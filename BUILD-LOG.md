# Build Log

One entry per session: date, hours, what shipped, what broke. Raw material for the v1-vs-v2 comparison memo at the end (see plans/active/v1-parity/strategy.md, milestone M4).

Benchmark baseline from v1 for the memo: engine 4,505 LOC (tiles 1,516 + game 2,872 + settle 117), game page peaked at 3,665 LOC, 131 tests, roughly 3 months of build sessions (2026-02 to 2026-04-30).

Monthly ritual: glance at Convex dashboard usage vs free-plan caps, note it here.

---

## 2026-07-13 (session 0: planning)

- Hours: ~1.5 (grill + research + plan, in the home workspace)
- Shipped: 10-decision brainstorm, v1 spec extraction (399 lines), stack research with citations, strategy/findings/progress plan set, pre-mortem (verdict: proceed with mitigations), parity rulings (4 conflicts, all match v1 code), repo scaffold
- Broke: nothing (no code yet)
- Next: M0 spike, 8 gates from research-stack.md section 8. Needs: Convex signup (Teng), two phones on hand (one iOS)

## 2026-07-21 (session 1: M0 spike, in progress)

- Pre-spike: 3 dated plan edits committed (M5 app-store option, portability constraints, scale posture); project CLAUDE.md with model routing added
- Kickoff: GitHub repo created (Teng-AI/mahjong-v2, public) and pushed. Vite React TS + Tailwind v4 + vite-plugin-pwa scaffolded, build green
- Convex setup detour: `npx convex dev` defaulted to a LOCAL anonymous deployment (port 3210, no account), useless for the spike gates. Fix: `npx convex login`, then `npx convex dev --once --configure=new --project mahjong-v2`. Cloud dev deployment: small-salamander-2.convex.cloud
- **Gate 1 PASS (hello room).** rooms table + joinRoom mutation + reactive latestJoins query. iPhone Safari + Mac browser on LAN dev server (192.168.1.88:5173). Both directions propagate without refresh, subjectively instant (~<1s). Note: one Mac->iPhone push needed a retry click before Teng confirmed; watch for WebSocket drop on idle phones in later gates
- **Gate 2 PASS (timer fires with all clients dead).** startTurn writes deadlineAt + runAfter(30s, advanceTurn). iPhone locked with Safari killed, Mac tab blanked. Verified server-side via `npx convex run`: status fired, skew 5ms
- **Gate 3 PASS (scheduler skew).** 30 timers (10 each at 10s/60s/120s), all fired. p50 5-6ms, p95 6-25ms, max 25ms. Gate was p95 < ~2s; result is 80x inside it
- **Gate 4 PASS (cancel and replace).** 20s timer canceled by act(), replaced with 8s timer at counter 2; deliberate stale fire with counter 1. Result: advances 1, staleNoops 1, canceled timer never fired. Turn-counter guard works
- Deployed to prod for gate 5: https://mahjong-v2.vercel.app (Vercel project mahjong-v2, VITE_CONVEX_URL env set; stray auto-named "dist" project created then deleted). Points at the dev Convex deployment for now
- **Gate 5 PASS (iOS PWA resync, both variants).** Home-screen install on iPhone. Airplane mode 2 min while Mac joined + a server timer fired mid-blackout: both converged on foreground without refresh. Backgrounded variant: same result
- **Gate 6 PASS (OCC smoke).** 4 near-simultaneous act() mutations at one game doc: turnCounter +4 exactly (no lost writes, no errors), 3 canceled timers stayed silent, final timer advanced once
- Stack decision: hard gates 2/3/5 all passed with wide margin. **Convex confirmed; runner-up not needed**
- Gate 7 (quota burn): deferred to post-M2 when real games exist to measure; spike ops were trivially small
- **Gate 8 PASS (CI deploy path).** Prod Convex deployment created (jovial-sparrow-812, US East) with a deploy-scoped key in GitHub secret CONVEX_DEPLOY_KEY; Action deploys functions on push to main (first run green). Vercel prod env flipped from dev to prod Convex URL. Verified from iPhone on cellular: page loads, Join writes to prod DB
- **M0 COMPLETE: 7/8 gates pass, gate 7 deferred with reason. Convex committed.**
- Hours: ~2 (including Convex account setup detours)
- Broke: nothing lasting. Detours: anonymous local Convex default; Vercel auto-named a project "dist" when deploying the dist/ folder (deleted, re-linked properly as mahjong-v2); a second convex.cloud URL in the prod bundle turned out to be example text inside the Convex client's error message, not a misconfiguration
- Note for M2: `npx convex run` from CLI is a clean way to drive server functions in tests/scripts; `--prod` flag targets production
- Next: M1 engine. Port 5 of the 131 v1 tests first as adapter proof, then the rest. Pure TS, zero Convex imports. Per CLAUDE.md model routing: Fable designs the engine API, Opus/Sonnet grind the implementation against tests

## 2026-07-22 (session 2: M1 engine, complete)

- Hours: ~2 (late night, continued from session 1 wrap)
- **M1 COMPLETE. Engine gate passed: 253/253 tests green, zero Convex imports (enforced by a purity test), strict TS + lint clean.**
- Fable designed the engine API first (plans/active/v1-parity/design-engine-api.md): v1-parity utility surface + Result-returning immutable transitions, injected randomness, seq counter (becomes the M2 timer guard), engine-side redaction (viewFor). Adapter proof: 6 v1 tests ported with import-path edits only before committing to the shape
- Model routing worked as designed: Sonnet subagents ported the 131 v1 tests verbatim and authored 117 new red tests from the spec; Opus subagents implemented internals to green (two runs); Fable audited between every stage
- Audit catch 1: the win-checker chow branch only placed golds at/above the lowest real tile. Checked v1: same behavior (upward-scan artifact). Surfaced as parity ruling 5; Teng re-ruled AGAINST v1 (golds substitute anywhere in a run). First deliberate divergence, pinned in parity-edges.test.ts
- Posture change (Teng): v1 is reference, not authority. On new conflicts: show v1 + alternative, recommend, get a ruling. Logged in CLAUDE.md, strategy.md, memory
- Audit catch 2: Opus finished 250/253 claiming 3 deal-test fixtures were malformed. Verified independently: correct both times (a perfect-runs deal legitimately wins Robbing the Gold at setup; the Three Golds fixture planted 1 gold, not 3). Fixed fixtures, not engine
- New coverage v1 never had: 34 scoring-formula tests (full 1.7 table incl. per-path quirks), 20 deterministic deal/instant-win tests, 33 transition tests (immutability + error guards), 25 seeded full-game property tests (tile conservation after every transition), 5 privacy tests on redacted views
- Broke: one Sonnet subagent died mid-run on an expired OAuth token; relaunched fresh with a repair brief, no lost work beyond the partial file it was writing
- Engine size: 1,990 LOC across 8 files vs v1's 4,505 (memo material)
- Next: M2 server game loop. Fable session first: schema + scheduling/idempotence design + pre-gate review (CLAUDE.md routing), then mutations. Delete spike UI/convex functions when M2 starts. Gate 7 (quota burn) measurement still deferred to post-M2

## 2026-07-22 (session 3: M2 server loop, built; iPhone gate pending)

- Hours: ~2 (same day as session 2)
- **M2 code complete: schema, intent mutations, seq-guarded timer loop, server bots, convex-test suite, minimal Quick Play client. 306/306 tests green. Deployed to dev; browser smoke passed. iPhone gate NOT yet run (needs Teng + phone).**
- Fable designed first (design-server-loop.md): 4 tables, engine state stored verbatim as v.any() (decision 2.1), token identity, applyAndSchedule choke point, seq guard as the correctness mechanism, self-healing backstop in every intent, bots as pure chooseBotAction(view, legal, difficulty) that only sees redacted state
- Routing: Opus built the convex layer and engine/bots.ts (parallel), Sonnet built the convex-test suite and the client, Fable audited everything and fixed the timer-class bugs directly
- Audit catch 3: timeout auto-discard ignored calledTypeThisTurn; a turn-timer expiry right after your own pung/chow would propose an illegal discard and leave the game unscheduled (v1-style stall). Fixed in loop.ts
- Audit catch 4: a bot step failing without advancing seq re-armed botAct every 900ms forever (quota burn on the hard-capped free plan). botAct now refuses to reschedule on zero progress
- Audit catch 5: the test agent reported "draw() doesn't validate needing a draw" as a documentation note; it was an exploit (modified client stacks tiles via intentDraw). Gated on legalActions.canDraw in the mutation, pinned with a test
- Broke: convex dev push failed twice. (1) Convex CLI bundles/analyzes every non-*.test.ts file under convex/, so the test helpers (import.meta.glob) broke deploys; server tests moved to tests/convex/. (2) Leftover M0 spike rows failed the new schema validation; cleared via convex import --replace with an empty table
- Browser smoke on dev (small-salamander-2): Quick Play deal correct (wall 35 = 46 - 11 bonus replacements), turn timer expired live and auto-played, calling phases opened/resolved, bot melds formed, no gold ever discarded (verified against raw doc, not pixels), tile conservation checked by hand at seq 22
- Next: M2 gate on a real iPhone (Quick Play vs 3 bots, screen locked through a calling phase and a bot turn), then vercel prod deploy + prod smoke. Gate 7 usage glance while a game is live
