# Learnings

Corrections, patterns, decisions, and domain insights from building mahjong-v2. Format per ~/.claude/references/learnings-format.md.

## [2026-07-21] npx convex dev defaults to anonymous LOCAL deployment

**Type:** correction
**Wrong assumption:** `npx convex dev` walks you into cloud signup on first run
**Reality:** Without a login it silently starts a local backend on port 3210 (`anonymous:anonymous-mahjong-v2`), no account, unreachable from other devices. Cloud requires `npx convex login` first, then `npx convex dev --once --configure=new --project <name>`
**Impact:** Any Convex project setup: login BEFORE first dev run, and check .env.local for a .convex.cloud URL (not 127.0.0.1) before trusting realtime/timer behavior
**Scope:** global — bridged to home memory (learning_convex-dev-anonymous-local)

## [2026-07-21] Convex scheduler is effectively exact for turn-timer purposes

**Type:** domain
**Insight:** `scheduler.runAfter` skew measured at p50 5-6ms, p95 6-25ms, max 25ms across 31 timers at 10s-120s delays; fires with zero clients connected; cancel-and-replace plus a turn-counter guard gives clean idempotence under 4-way concurrent mutations (no lost writes)
**Source:** M0 spike gates 2-4, 6 (BUILD-LOG 2026-07-21)
**Applies to:** M2 server game loop design; no self-healing deadline paranoia needed beyond the planned turn-counter guard

## [2026-07-22] v1 is reference, not authority

**Type:** correction
**Wrong assumption:** Parity means defaulting new v1-vs-rules-doc conflicts to v1 code behavior (extending the 2026-07-13 blanket ruling).
**Reality:** Teng wants v1 referenced, then the better behavior chosen and ruled on. First case: gold wildcard chow placement (ruling 5), where v1's upward-only scan was an implementation artifact, not a design choice.
**Impact:** Every future conflict: present v1 behavior + alternative + recommendation, get a ruling, log it dated in strategy.md, pin with a test.

## [2026-07-22] Red-authored test fixtures need adversarial review before trusting failures

**Type:** pattern
**Context:** M1 red tests were written against stubs, so fixture bugs could not surface until implementation. Opus finished 250/253 and claimed the 3 failures were malformed fixtures, which the audit confirmed (a perfect-runs deal is a legitimate setup win; a "three golds" fixture that plants one gold).
**What works:** When an implementer claims "the test is wrong", verify the claim independently before editing either side; in mahjong specifically, any hand fixture must be checked against ALL win paths (instant wins fire at deal), not just the scenario it was written for.
**Reuse:** Any tests-first flow with generated/red tests; any fixture in a domain with global invariants that can trigger on innocent-looking data.

## [2026-07-21] vercel deploy <folder> names the project after the folder

**Type:** correction
**Wrong assumption:** `vercel deploy dist --prod` deploys the dist folder into the linked/current project
**Reality:** It created a NEW project literally named "dist" with a junk URL. Correct flow: `vercel link --yes --project <name>` from repo root, set env vars, then `vercel deploy --prod --yes`
**Impact:** Never pass a folder path to vercel deploy for a real project; link first
**Scope:** global — bridged to home memory (learning_vercel-deploy-folder-names-project)
## [2026-07-22] Convex CLI bundles every non-test file under convex/

**Type:** correction
**Wrong assumption:** Test files and their helpers can live in convex/__tests__/ since the CLI excludes tests from deployment
**Reality:** Only `*.test.ts` names are excluded. Everything else under convex/ (helpers.ts included) gets bundled/analyzed at push time, and vitest-only constructs like import.meta.glob fail the deploy
**Impact:** Server-layer test suites live OUTSIDE convex/ (here: tests/convex/); a comment in vitest.config.ts pins the reason
**Scope:** global — bridged to home memory (learning_convex-cli-bundles-nontest-files)

## [2026-07-22] Subagent "not a defect, just a design fact" notes are audit triggers

**Type:** pattern
**Context:** The convex-test agent flagged that engine draw() accepts a second draw as a documentation-only note. It was an exploit: a modified client could stack tiles through intentDraw, in the server-authoritative game whose whole point is that clients cannot cheat
**What works:** Treat any implementer aside softening a validation gap ("just a design fact", "not a bug, but...") as a finding to run to ground: check who enforces the invariant at every boundary that exposes it. Here the engine's documented pattern (legalActions is the gate) was enforced for selfDrawWin but not draw
**Reuse:** Any audit of subagent output; any engine/adapter split where validation is deliberately layered
