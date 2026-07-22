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
- Gates 5-8: pending. Note for M2: `npx convex run` from CLI is a clean way to drive server functions in tests/scripts
