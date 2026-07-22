# Engine API Design (M1)

Designed 2026-07-22 (Fable session). Implements spec = research-v1-spec.md section 1, parity rulings in strategy.md. This doc is the contract for implementation: Opus builds internals from it, Sonnet ports tests against it. Changes to signatures come back here first with a dated note.

## Principles

1. Pure TS, zero Convex imports, zero I/O, zero ambient randomness or clock. Every function is (inputs) -> value.
2. Two layers: **utilities** (near name-parity with v1 `tiles.ts`/pure `game.ts` exports, so the 131 tests port mechanically) and **transitions** (discrete state-in/state-out functions the Convex layer calls; v1 had no equivalent, its action layer was Firebase-coupled).
3. Transitions never throw. They return `Result<T>`: `{ ok: true, state, events } | { ok: false, error: EngineError }`. The Convex layer maps errors to rejected intents.
4. One `EngineState` document holds the full truth including hidden info (wall order, all hands). Redaction to per-seat views is engine code, not Convex code.
5. The engine knows nothing about time. No deadlines, no timers, no bot delays. It exposes what a scheduler needs (`seq`, `phase`, legal-action queries); the Convex layer owns when.

## File layout

```
engine/
  types.ts     shared types, no logic
  tiles.ts     tile utilities (v1 tiles.ts parity surface)
  deal.ts      wall build, deal, bonus exposure, gold flip, instant-win checks
  game.ts      transitions + pure helpers (v1 game.ts pure-export parity)
  score.ts     scoring formula (spec 1.7)
  settle.ts    settlement (v1 settle.ts parity)
  index.ts     re-exports (public API)
engine/__tests__/
  tiles.test.ts, game.test.ts, settle.test.ts   ported 131
  score.test.ts, deal.test.ts, properties.test.ts  new
```

Vitest as runner (`npm test` = `vitest run`). No path aliases; engine is imported relatively. Nothing in `engine/` may import from `convex/` or `src/` (enforced by a lint test that greps imports).

## Core types (types.ts)

```ts
export type TileId = string;    // "dots_5_2"  type + instance 0-3
export type TileType = string;  // "dots_5"
export type Seat = 0 | 1 | 2 | 3;

export type Phase = 'playing' | 'calling' | 'ended';
// No 'waiting'/'setup'/'bonus_exposure': dealing is synchronous inside initHand
// (matches v1 live path), so a hand is born in 'playing' or, on an instant win, 'ended'.

export type MeldType = 'chow' | 'pung' | 'kong';
export interface Meld {
  type: MeldType;
  tiles: TileId[];          // 3, or 4 for kong
  calledTile?: TileId;      // present when formed from a discard
  isConcealed?: boolean;    // kong only
}

export type CallAction = 'win' | 'kong' | 'pung' | 'chow' | 'pass';
export type CallStatus = 'discarder' | 'waiting' | CallAction;

export interface ChowSelection { tilesFromHand: [TileId, TileId]; }

// Field names playerSeat/tileType and nullability match v1 exactly: the 11 needsToDraw
// tests construct these literals, and matching them keeps the port mechanical.
export interface LastAction {
  type: 'draw' | 'discard' | 'pung' | 'chow' | 'kong' | 'game_start' | 'bonus_expose';
  playerSeat: Seat;
  tileType?: TileType;      // discard/call context. Hidden info never here.
}
// needsToDraw takes the structural subset { currentPlayerSeat; lastAction: LastAction | null }
// so v1 test fixtures (which carry extra v1-shaped fields) pass without rewrites.

export interface WinnerInfo {
  seat: Seat;
  isSelfDraw: boolean;
  isThreeGolds: boolean;
  isRobbingGold: boolean;
  winningTile?: TileId;
  discarderSeat?: Seat;
  hand: TileId[];           // full winning hand for reveal
  score: ScoreBreakdown;
}

export interface ScoreBreakdown {
  base: number; bonusTiles: number; golds: number;
  concealedKongBonus: number; exposedKongBonus: number; dealerStreakBonus: number;
  subtotal: number; multiplier: 1 | 2;
  threeGoldsBonus?: number; robbingGoldBonus?: number;
  goldenPairBonus?: number; noBonusBonus?: number; allOneSuitBonus?: number;
  total: number;
}

export interface EngineState {
  seq: number;              // increments on every successful transition; M2 timer guard
  phase: Phase;
  dealerSeat: Seat;
  currentPlayerSeat: Seat;
  goldTileType: TileType;
  exposedGold: TileId;      // out of play, display only
  wall: TileId[];           // draw from index 0; dead wall already removed at deal
  hands: Record<Seat, TileId[]>;         // concealed tiles, sorted for display
  melds: Record<Seat, Meld[]>;
  bonusTiles: Record<Seat, TileId[]>;
  discardPile: TileId[];
  lastAction: LastAction | null;
  previousAction: LastAction | null;
  pendingCalls: Record<Seat, CallStatus> | null;   // non-null only in 'calling'
  pendingChow: { seat: Seat; selection: ChowSelection } | null;
  calledTypeThisTurn: TileType | null;   // discard restriction after own pung/chow
  winner: WinnerInfo | null;             // set when phase === 'ended'; null = draw game or aborted
  endReason: 'win' | 'wall_exhausted' | null;      // set when phase === 'ended'
}

export type EngineError =
  | { code: 'not_your_turn' } | { code: 'wrong_phase' }
  | { code: 'tile_not_in_hand' } | { code: 'cannot_discard_gold' }
  | { code: 'cannot_discard_called_type' } | { code: 'must_draw_first' }
  | { code: 'invalid_call' } | { code: 'already_responded' }
  | { code: 'invalid_chow_selection' } | { code: 'invalid_kong' }
  | { code: 'not_a_winning_hand' };

export type Result =
  | { ok: true; state: EngineState; events: GameEvent[] }
  | { ok: false; error: EngineError };
```

### Events

Structured, replacing v1's string log. The Convex layer appends them to a log table; the UI renders text (including the private-draw convention: `drew` events are visible only to `seat`).

```ts
export type GameEvent =
  | { kind: 'hand_started'; dealerSeat: Seat; goldTileType: TileType; exposedGold: TileId }
  | { kind: 'bonus_exposed'; seat: Seat; tile: TileId; during: 'deal' | 'play' }
  | { kind: 'drew'; seat: Seat; tile: TileId }                    // PRIVATE to seat
  | { kind: 'discarded'; seat: Seat; tile: TileId }
  | { kind: 'called'; seat: Seat; call: 'pung' | 'chow' | 'kong'; tile: TileId }
  | { kind: 'concealed_kong'; seat: Seat }                        // type hidden (v1 parity)
  | { kind: 'kong_upgraded'; seat: Seat; tile: TileId }
  | { kind: 'passed'; seat: Seat }
  | { kind: 'calling_opened'; discarder: Seat; tile: TileId }
  | { kind: 'calling_skipped_endgame' }                           // wall <= 4 rule
  | { kind: 'won'; winner: WinnerInfo }
  | { kind: 'gold_swapped'; seat: Seat; tileOut: TileId }         // robbing-the-gold dealer swap
  | { kind: 'wall_exhausted' };
```

## deal.ts

```ts
export interface HandConfig { dealerSeat: Seat; dealerStreak: number; }
// dealerStreak = streak banked BEFORE this hand (scoring input, parity ruling 1)

export function initHand(config: HandConfig, shuffledTiles: TileId[]): Result;
```

Takes all 128 tiles ALREADY shuffled (caller shuffles; `tiles.shuffle` is exported for convenience but initHand never randomizes). Performs spec 1.2 exactly: deal 16x4 +1 dealer, cut dead wall (last 16), synchronous bonus-exposure loop dealer-first, gold flip (flipped bonuses go to dealer), sort hands, then instant-win checks in spec order (Three Golds scan seats 0..3, then Robbing the Gold chain a/b/c). Returns state in 'playing', or 'ended' with winner on an instant win. Wall exhaustion during setup replacement: returns `{ ok: false }` never; per spec it cannot happen with 128 tiles, but code defends by ending as wall_exhausted rather than throwing.

## tiles.ts (v1 parity surface)

Same names and shapes as v1 so tests port with import-path changes only:

`generateAllTiles`, `shuffle(arr, rng: () => number)` (NOTE: rng param added vs v1; tests pass Math.random or a seeded PRNG), `getTileType`, `parseTile`, `parseTileType`, `isSuitTile`, `isBonusTile`, `isHonorTile`, `isGoldTile`, `isTerminalTile`, `countGoldTiles`, `removeTiles`, `removeTilesByType`, `sortTilesForDisplay`, `canFormWinningHand`, `hasGoldenPair`, `getWinningTiles`, `canPung`, `canKong`, `canDeclareConcealedKong`, `canUpgradePungToKong`, `canChow`, `hasChowOption`, `canWinOnDiscard`, `getValidCalls`, `getValidChowTiles`, `validateChowSelection`, `getTileDisplayText`, `selectSafeDiscard`, `isAllOneSuit`.

Signatures match v1's (documented in spec 4.1). `selectSafeDiscard` stays in the engine (M2 turn-timer auto-play and bots both need it server-side).

## game.ts

Pure helpers (v1 parity, direct test targets): `getNextSeat`, `hasBonusTiles`, `getBonusTilesFromHand`, `getNonBonusTiles`, `needsToDraw(state)`, `canWin`, `canWinOnDiscard`.

Transitions (all `(state, ...) => Result`; every success increments `seq`):

```ts
export function draw(state: EngineState, seat: Seat): Result;
// wall shift, bonus auto-expose loop, Three Golds check, wall-exhaustion -> ended draw game

export function discard(state: EngineState, seat: Seat, tile: TileId): Result;
// validates turn/gold/called-type; wall <= 4 skips calling and advances turn;
// else opens calling phase (pendingCalls reset, discarder auto-marked)

export function respondToCall(
  state: EngineState, seat: Seat, action: CallAction, chow?: ChowSelection
): Result;
// validates against getValidCalls; stashes chow selection; when the 4th response
// lands, resolution runs INSIDE this same transition (priority win > kong > pung > chow,
// closest-counter-clockwise tiebreak) and the returned state is post-resolution.
// There is no separate resolve() the caller can race.

export function declareSelfDrawWin(state: EngineState, seat: Seat): Result;
// blocked when lastAction is own pung/chow (parity ruling 2); kong replacement wins allowed

export function declareConcealedKong(state: EngineState, seat: Seat, type: TileType): Result;
export function upgradePungToKong(state: EngineState, seat: Seat, meldIndex: number, tile: TileId): Result;
// both draw a replacement (bonus loop, Three Golds check), stay on same seat's turn

export function legalActions(state: EngineState, seat: Seat): LegalActions;
// what may this seat do right now: the UI enables buttons from the per-seat view of this,
// bots (M2) and timer auto-play consume it server-side.
export interface LegalActions {
  canDraw: boolean; canDiscard: boolean; canSelfDrawWin: boolean;
  concealedKongTypes: TileType[]; pungUpgrades: { meldIndex: number; tile: TileId }[];
  call: null | { canWin: boolean; canKong: boolean; canPung: boolean; chowOptions: ChowOption[] };
}
```

Timer expiry is NOT an engine transition. The Convex timeout mutation composes engine calls: calling phase -> `respondToCall(seat, 'pass')` per unresponded seat; turn -> `draw` if `needsToDraw`, then auto-win via `legalActions().canSelfDrawWin`, else `discard(selectSafeDiscard(...))`. Keeps one authority for "what is legal" without the engine knowing about clocks.

## score.ts

```ts
export interface ScoreInput {
  hand: TileId[]; melds: Meld[]; bonusTiles: TileId[];
  goldTileType: TileType; isDealer: boolean; dealerStreak: number;
  winPath: 'self_draw' | 'discard' | 'three_golds' | 'robbing_gold';
}
export function scoreWin(input: ScoreInput): ScoreBreakdown;
```

Implements spec 1.7 EXACTLY, including the per-path special-check quirk table (Three Golds checks no other specials; Robbing the Gold skips All One Suit and kong bonuses). New direct tests cover every row plus streak progression and multiplier stacking; this was v1's test gap.

## settle.ts (v1 parity surface)

`calculateNetPositions(rounds)`, `calculateSettlement(rounds, names)`, `formatSettlement(s, names)`. Same shapes as v1 (spec 4.3); `GameRound` type moves into types.ts with the fields the tests construct required (`winnerSeat: Seat | null`, `score`, `dealerSeat`, `dealerStreak`) and v1's bookkeeping fields (`roundNumber`, `winnerName`, `timestamp`) optional. Net positions are keyed `seat0`..`seat3` (v1 shape asserted by tests).

## Redaction

```ts
export interface SeatView { /* EngineState minus: wall contents (only wallCount), other seats' hands (only counts), concealed kong tile types */ }
export function viewFor(state: EngineState, seat: Seat): SeatView;
export function spectatorView(state: EngineState): SeatView; // no hand at all
```

The privacy test asserts, for every phase produced by a simulated game, that `JSON.stringify(viewFor(s, seat))` contains no tile id from another seat's hand or the wall.

## What the engine does NOT do (M2 boundary)

- No deadlines, schedule ids, or time of any kind.
- No bot decision logic in M1 (bots land in `engine/bots.ts` in M2: pure `chooseBotAction(view: SeatView, difficulty) => intent`, consuming `legalActions`; constants in spec section 5).
- No session bookkeeping beyond settle.ts inputs (rounds table is Convex; dealer rotation applied by the next `initHand` caller per spec 1.6).
- No abort (deleting a hand is a Convex-layer act; nothing to compute).

## Adapter-proof plan (before mass porting)

Port 5 tests spanning all three v1 files against stub-plus-minimal implementations:
1. `generateAllTiles` returns 128 unique ids (tiles)
2. `getTileType` strips instance (tiles)
3. `canPung` positive + gold-exclusion case (tiles)
4. `needsToDraw` after another seat's discard (game)
5. `calculateNetPositions` single-round math (settle)

Pass condition: import-path edits only, no test-body rewrites (except `shuffle` rng param, which these 5 avoid). If bodies need rewriting, the API is wrong; fix the API, not the tests.
