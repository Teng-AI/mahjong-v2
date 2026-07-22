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

## [2026-07-21] vercel deploy <folder> names the project after the folder

**Type:** correction
**Wrong assumption:** `vercel deploy dist --prod` deploys the dist folder into the linked/current project
**Reality:** It created a NEW project literally named "dist" with a junk URL. Correct flow: `vercel link --yes --project <name>` from repo root, set env vars, then `vercel deploy --prod --yes`
**Impact:** Never pass a folder path to vercel deploy for a real project; link first
**Scope:** global — bridged to home memory (learning_vercel-deploy-folder-names-project)
