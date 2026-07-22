# mahjong-v2

Server-authoritative rebuild of Fuzhou Mahjong. Convex backend + Vite React TS PWA client. The archived v1 (`~/Documents/claude/_archive/mahjong/`) is read-only spec and benchmark; do not re-read v1 code during the build except to settle a spec ambiguity.

## Source of truth

- Plan: `plans/active/v1-parity/strategy.md` (milestones M0-M5, parity rulings, dated edits)
- Rules spec: `plans/active/v1-parity/research-v1-spec.md` (sections 1-5). This file IS the spec.
- Stack rationale + M0 spike gates: `plans/active/v1-parity/research-stack.md` section 8
- v1 post-mortem: `plans/active/v1-parity/findings.md`
- Per-session log: `BUILD-LOG.md` (date, hours, shipped, broke)

## Hard rules

- Nothing authoritative runs on the client: no timers, no bots, no validation that matters. Clients render server state and send intents. `deadlineAt` drives a display countdown only.
- `engine/` stays pure TS with zero Convex imports.
- Parity = v1 CODE behavior (4 rulings in strategy.md), verified by the ported 131-test suite.
- Repo is PUBLIC: HANDOVER.md and .env* stay untracked; secrets live in the Convex dashboard.
- Client stays wrap-ready for a future App Store build: portability constraints in strategy.md (no load-bearing PWA-only APIs, platform features behind one wrapper module, plain DOM/CSS, no third-party social login).

## Model routing

Rule: Fable decides and audits, Opus builds the hard parts, Sonnet/Haiku build the easy parts.

| Work | Model |
|---|---|
| Design decisions (engine API, M2 scheduling/idempotence scheme), M0 go/no-go, M2 pre-gate review | Fable |
| Any timer/OCC/resync bug | Fable directly, skip the ladder (the v1 killer bug class; wrong fixes look right) |
| Hard-but-bounded implementation: M1 engine internals, M2 mutations per written design; routine pre-commit review of Sonnet output | Opus (/fast is fine) |
| Spec-tight + test-verified work: porting the 131 tests, making tests green, M4 UI polish | Sonnet; Haiku for pure translation chunks |
| Mechanical fan-out (test porting, boilerplate) | Subagents with model: sonnet or haiku, dispatched from the driving session |

Escalation: stuck after 3 attempts at one tier moves the problem up one tier (matches the global 3-failure debugging rule).

## Session ritual

- Start: /session-start (reads HANDOVER.md, memory, learnings)
- End: BUILD-LOG.md entry + /checkpoint or /wrap-up
- Monthly-ish: glance at Convex usage vs free-tier cap (pre-mortem risk 2)
