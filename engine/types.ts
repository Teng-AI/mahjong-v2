// Shared engine types. Contract: plans/active/v1-parity/design-engine-api.md.
// Pure TS only: nothing in engine/ may import from convex/ or src/.

export type TileId = string; // "dots_5_2" = type + instance 0-3
export type TileType = string; // "dots_5"
export type Seat = 0 | 1 | 2 | 3;

export type Phase = 'playing' | 'calling' | 'ended';

export type MeldType = 'chow' | 'pung' | 'kong';
export interface Meld {
  type: MeldType;
  tiles: TileId[]; // 3, or 4 for kong
  calledTile?: TileId; // present when formed from a discard
  isConcealed?: boolean; // kong only
}

export type CallAction = 'win' | 'kong' | 'pung' | 'chow' | 'pass';
export type CallStatus = 'discarder' | 'waiting' | CallAction;

export interface ChowSelection {
  tilesFromHand: [TileId, TileId];
}

export interface ChowOption {
  tilesFromHand: [TileId, TileId];
  sequence: [TileType, TileType, TileType];
}

// Tile parsing shapes (v1 parity: tiles.ts parseTile/parseTileType).
export type Suit = 'dots' | 'bamboo' | 'characters';
export type WindDirection = 'east' | 'south' | 'west' | 'north';
export type TileCategory = 'suit' | 'wind' | 'dragon';

export interface ParsedTile {
  category: TileCategory;
  suit?: Suit;
  value: number | WindDirection | string;
  instance: number;
}

// Field names playerSeat/tileType and nullability match v1 exactly so the
// ported tests construct these literals unchanged.
export interface LastAction {
  type:
    | 'draw'
    | 'discard'
    | 'pung'
    | 'chow'
    | 'kong'
    | 'game_start'
    | 'bonus_expose';
  playerSeat: Seat;
  tileType?: TileType;
}

export interface ScoreBreakdown {
  base: number;
  bonusTiles: number;
  golds: number;
  concealedKongBonus: number;
  exposedKongBonus: number;
  dealerStreakBonus: number;
  subtotal: number;
  multiplier: 1 | 2;
  threeGoldsBonus?: number;
  robbingGoldBonus?: number;
  goldenPairBonus?: number;
  noBonusBonus?: number;
  allOneSuitBonus?: number;
  total: number;
}

export interface WinnerInfo {
  seat: Seat;
  isSelfDraw: boolean;
  isThreeGolds: boolean;
  isRobbingGold: boolean;
  winningTile?: TileId;
  discarderSeat?: Seat;
  hand: TileId[];
  score: ScoreBreakdown;
}

export interface EngineState {
  seq: number; // increments on every successful transition; M2 timer guard
  phase: Phase;
  dealerSeat: Seat;
  currentPlayerSeat: Seat;
  goldTileType: TileType;
  exposedGold: TileId; // out of play, display only
  wall: TileId[]; // draw from index 0; dead wall already removed at deal
  hands: Record<Seat, TileId[]>; // concealed tiles, sorted for display
  melds: Record<Seat, Meld[]>;
  bonusTiles: Record<Seat, TileId[]>;
  discardPile: TileId[];
  lastAction: LastAction | null;
  previousAction: LastAction | null;
  pendingCalls: Record<Seat, CallStatus> | null; // non-null only in 'calling'
  pendingChow: { seat: Seat; selection: ChowSelection } | null;
  calledTypeThisTurn: TileType | null; // discard restriction after own pung/chow
  winner: WinnerInfo | null;
  endReason: 'win' | 'wall_exhausted' | null;
}

export type EngineError =
  | { code: 'not_your_turn' }
  | { code: 'wrong_phase' }
  | { code: 'tile_not_in_hand' }
  | { code: 'cannot_discard_gold' }
  | { code: 'cannot_discard_called_type' }
  | { code: 'must_draw_first' }
  | { code: 'invalid_call' }
  | { code: 'already_responded' }
  | { code: 'invalid_chow_selection' }
  | { code: 'invalid_kong' }
  | { code: 'not_a_winning_hand' };

export type GameEvent =
  | { kind: 'hand_started'; dealerSeat: Seat; goldTileType: TileType; exposedGold: TileId }
  | { kind: 'bonus_exposed'; seat: Seat; tile: TileId; during: 'deal' | 'play' }
  | { kind: 'drew'; seat: Seat; tile: TileId } // PRIVATE to seat
  | { kind: 'discarded'; seat: Seat; tile: TileId }
  | { kind: 'called'; seat: Seat; call: 'pung' | 'chow' | 'kong'; tile: TileId }
  | { kind: 'concealed_kong'; seat: Seat } // tile type hidden (v1 parity)
  | { kind: 'kong_upgraded'; seat: Seat; tile: TileId }
  | { kind: 'passed'; seat: Seat }
  | { kind: 'calling_opened'; discarder: Seat; tile: TileId }
  | { kind: 'calling_skipped_endgame' }
  | { kind: 'won'; winner: WinnerInfo }
  | { kind: 'gold_swapped'; seat: Seat; tileOut: TileId }
  | { kind: 'wall_exhausted' };

export type Result =
  | { ok: true; state: EngineState; events: GameEvent[] }
  | { ok: false; error: EngineError };

// Session round record (settle.ts input). Required fields are what the ported
// tests construct; bookkeeping fields are optional v1 extras.
export interface GameRound {
  winnerSeat: Seat | null; // null = draw game
  score: number;
  dealerSeat: Seat;
  dealerStreak: number;
  roundNumber?: number;
  winnerName?: string;
  timestamp?: number;
}

export interface NetPositions {
  seat0: number;
  seat1: number;
  seat2: number;
  seat3: number;
}

// settle.ts parity surface (spec 4.3).
export interface Settlement {
  from: Seat;
  to: Seat;
  amount: number;
}

// deal.ts input (design-engine-api.md).
export interface HandConfig {
  dealerSeat: Seat;
  dealerStreak: number; // streak banked BEFORE this hand (parity ruling 1)
}

// score.ts input (design-engine-api.md, spec 1.7).
export interface ScoreInput {
  hand: TileId[];
  melds: Meld[];
  bonusTiles: TileId[];
  goldTileType: TileType;
  isDealer: boolean;
  dealerStreak: number;
  winPath: 'self_draw' | 'discard' | 'three_golds' | 'robbing_gold';
}

// game.ts legalActions() output (design-engine-api.md).
export interface LegalActions {
  canDraw: boolean;
  canDiscard: boolean;
  canSelfDrawWin: boolean;
  concealedKongTypes: TileType[];
  pungUpgrades: { meldIndex: number; tile: TileId }[];
  call: null | {
    canWin: boolean;
    canKong: boolean;
    canPung: boolean;
    chowOptions: ChowOption[];
  };
}

// --- Redaction (view.ts) ------------------------------------------------------
// Concrete SeatView shape (design doc describes it structurally; this is the
// implementation choice, documented in the M1 test-authoring report):
// - wall contents replaced by wallCount.
// - other seats' hands replaced by counts (handCounts); only the viewer's own
//   concealed tiles appear under ownHand (null for spectatorView).
// - concealed-kong meld tiles are hidden (tiles: [], hidden: true) from every
//   viewer except the meld's own seat, for all phases including 'ended' -- v1
//   parity: the action log never reveals a concealed Gang's tile type, even
//   at hand end. Exposed melds (chow/pung/open kong) are always shown in full
//   since they are public information the moment they're called.
// - winner.hand is left untouched by redaction: once phase is 'ended' and a
//   winner exists, the full winning hand is intentionally revealed to
//   everyone (spec: winner reveal), matching v1's winner-reveal screen.

export interface MeldView {
  type: MeldType;
  tiles: TileId[]; // [] when hidden
  calledTile?: TileId;
  isConcealed?: boolean;
  hidden?: boolean; // true only for another seat's concealed kong
}

export interface SeatView {
  seq: number;
  phase: Phase;
  dealerSeat: Seat;
  currentPlayerSeat: Seat;
  goldTileType: TileType;
  exposedGold: TileId;
  wallCount: number;
  viewerSeat: Seat | null; // null only for spectatorView
  ownHand: TileId[] | null; // null for spectatorView
  handCounts: Record<Seat, number>;
  melds: Record<Seat, MeldView[]>;
  bonusTiles: Record<Seat, TileId[]>;
  discardPile: TileId[];
  lastAction: LastAction | null;
  previousAction: LastAction | null;
  pendingCalls: Record<Seat, CallStatus> | null;
  calledTypeThisTurn: TileType | null;
  winner: WinnerInfo | null;
  endReason: 'win' | 'wall_exhausted' | null;
}
