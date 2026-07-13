# Mahjong v2

Real-time multiplayer Fuzhou Mahjong (福州麻将), rebuilt from scratch.

This is a from-scratch rebuild of a 2026 app that shipped, got played, and died of architectural debt: game timers ran in players' browser tabs, so one locked phone could stall a whole game. v2 exists to answer a question: how much better does the same solo builder do a year later, driving AI coding agents against a written spec?

Ground rules for the rebuild:

- The old codebase is a benchmark and a spec, never a code donor. Nothing gets ported.
- Server-authoritative from the first line: clients send intents, the server validates against the rules engine and broadcasts state. A locked phone changes nothing about game progression.
- Exact rule parity with v1's shipped behavior, verified by the old app's 131-test suite adapted as an acceptance suite.

## Stack

- `engine/`: pure TypeScript rules package (tiles, calls, win detection, scoring, settlement). No platform imports.
- `convex/`: Convex backend. Mutations validate intents via the engine; turn and calling timers are scheduled mutations; bots run server-side.
- `src/`: Vite + React + TypeScript PWA, mobile-first.

## Status

Planning complete, build starts with a spike that gates the stack choice. See `plans/active/v1-parity/` for the strategy, research, and progress files, and `BUILD-LOG.md` for the session log.
