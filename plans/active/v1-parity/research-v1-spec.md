# Mahjong Vibes v1: Rebuild Reference

Read-only archaeology of `~/Documents/claude/_archive/mahjong/` (discontinued 2026-06-17), written 2026-07-13 as input to a server-authoritative v2. Sources: `mahjong-rules.md`, `ROADMAP.md`, `app/README.md`, `app/CHANGELOG.md`, `app/src/types/index.ts`, `app/src/lib/{tiles,game,settle,rooms}.ts`, `app/src/hooks/*`, `app/src/app/game/[code]/page.tsx` (2,096 lines), `app/src/__tests__/*`.

Where `mahjong-rules.md` and the code disagree, this doc records the code behavior and flags the difference. Stack: Next.js 16, React 19, TypeScript, Tailwind 4, Firebase RTDB + anonymous auth. All game logic ran in browsers; there was no server code (the `functions/` dir was unused scaffolding).

---

## 1. Rules spec digest

Fuzhou Mahjong (福州麻将), 4 players, as implemented.

### 1.1 Tile set (128 tiles)

| Category | Types | Copies | Count | Role |
|---|---|---|---|---|
| Dots (筒) | `dots_1`..`dots_9` | 4 | 36 | playable suit |
| Bamboo (条) | `bamboo_1`..`bamboo_9` | 4 | 36 | playable suit |
| Characters (万) | `characters_1`..`characters_9` | 4 | 36 | playable suit |
| Winds | `wind_east/south/west/north` | 4 | 16 | bonus tile |
| Red dragon (中) | `dragon_red` | 4 | 4 | bonus tile |

No flowers or seasons. Tile instance IDs append an index 0-3: `dots_5_2` = third physical copy of 5 dots. "Tile type" strips the instance (`dots_5`). Winds and dragons are "bonus tiles": they can never sit in a hand, form melds, or be called; they are exposed face up for points whenever drawn.

Gold (金): at setup one suit tile instance is flipped face up from the wall. That instance is out of play (displayed only). The other 3 copies of that tile TYPE are wildcards:
- Substitute for any tile in a set or the pair when checking a win.
- Each gold physically in the winning hand scores +1.
- Cannot be used in calls (Chi/Peng/Gang), neither as the discard nor from hand.
- Cannot be discarded at all in v1 (`discardTile` rejects gold; bots and auto-play never pick gold). The rules doc instead implies a penalty for discarding gold; code has a TODO for that and simply bans the discard. v2 must pick one.
- Cannot be used in a Gang.

### 1.2 Setup and dealing

1. Dealer seat comes from room settings (`settings.dealerSeat`, default 0). No dice roll exists in code (the rules doc mentions dice; the host picks or Quick Play uses seat 0).
2. Fisher-Yates shuffle of all 128 tiles.
3. Deal 16 tiles to each seat (round-robin seat 0..3, 16 passes), then 1 extra to the dealer (17). 63 tiles remain.
4. Dead wall: the LAST 16 tiles of the shuffled wall are removed and never drawn (`wall.slice(0, -16)`). 47 drawable tiles remain before replacements.
5. Bonus exposure, dealer first then counter-clockwise: move every wind/dragon from hand to the player's exposed bonus row, draw a replacement from the wall front for each, repeat until the hand has no bonus tiles. In v1 this loop runs synchronously inside `initializeGame`; the `bonus_exposure` phase enum and the step-by-step functions (`exposeBonusTiles`, `advanceBonusExposure`, `revealGoldTile`) exist but the live path skips them and lands directly in `playing`.
6. Gold flip: shift tiles off the wall until a non-bonus tile appears. Bonus tiles flipped on the way go to the DEALER's bonus row. The first suit tile becomes `exposedGold` (instance) / `goldTileType` (type).
7. All hands are sorted for display (golds first, then dots/bamboo/characters by value).
8. Instant win checks, in this order:
   - Three Golds (三金): any player holding all 3 gold copies wins instantly. Scan order is seat 0..3 (not from dealer). +30 special, counts as self-draw.
   - Robbing the Gold (抢金), priority chain:
     a. Dealer's 17 tiles already form a win with no swap: dealer wins.
     b. Non-dealers in turn order from dealer: if their 16-tile hand is tenpai and the gold TYPE is one of their winning tiles, they take the exposed gold instance into their hand and win.
     c. Dealer swap: if replacing any one non-gold tile in the dealer's hand with the exposed gold completes a win, dealer wins (swapped tile shown in the log).
     Robbing the Gold scores +30 special and counts as self-draw; the exposed gold joins the winner's hand.

Wall exhaustion during a bonus replacement mid-game ends the hand as a draw. At setup the same edge throws an error (never observed with 128 tiles).

### 1.3 Turn loop

Turn order is counter-clockwise, seat N to seat (N+1) % 4. Seat labels: 0 East, 1 South, 2 West, 3 North.

Draw decision (`needsToDraw`): the current player skips the draw when the last action was their own draw, their own Peng/Chi/Gang, or when the game just started (dealer already holds 17). After any discard the next player draws.

A turn:
1. Draw from the wall front if required. If the drawn tile is a bonus tile: expose it, draw again, repeat until a non-bonus tile arrives (wall empty mid-replacement = draw game). After the draw, check Three Golds (instant win, self-draw).
2. Optional actions, any time before discarding, on your turn:
   - Concealed Gang: 4 copies of one type in hand (gold and bonus types excluded). Meld stays face down; the log and shared state hide the tile type. Draw a replacement (bonus tiles auto-exposed on the way), then Three Golds check, then you may win on the replacement or discard.
   - Peng upgrade Gang: hold the 4th copy of a type you have as an exposed Peng. Converts the meld, draws a replacement, same follow-ups. You cannot Gang a discard onto an existing exposed Peng.
   - Declare self-draw win (Hu) if the hand completes. Winning is optional; you may discard instead.
3. Discard exactly one tile. Restrictions: never a gold; never the same tile TYPE you just called Peng/Chi on this turn.

Win shape: 5 sets + 1 pair. Set = Chi (3-tile run, one suit), Peng (3 identical), or Gang (4 identical, counts as one set). Concealed tile counts: 17 - 3 x melds when winning by self-draw, 16 - 3 x melds while waiting. Gang melds hold 4 tiles but count as one set.

### 1.4 Calling a discard

When a tile is discarded and the wall holds MORE than 4 tiles, the game enters the calling phase: every other player must respond with one of `win` (Hu), `kong` (Gang), `pung` (Peng), `chow` (Chi), or `pass`.

- Hu: hand + discard completes a win.
- Gang: 3 matching copies in hand (exposed Gang, replacement draw follows).
- Peng: 2 matching copies in hand.
- Chi: only the seat immediately after the discarder; player picks the exact 2 hand tiles; discard may sit low, middle, or high in the run.
- Gold copies in hand never count toward any call.

Resolution happens only after ALL four seats have responded (the discarder is auto-marked). Priority: Hu > Gang > Peng > Chi. Several Hu callers: the one closest to the discarder counter-clockwise wins; the rest get nothing. Gang and Peng cannot both be valid on one discard (only 4 copies exist). The caller takes the discard out of the pile, exposes the meld, and becomes the current player: Peng/Chi go straight to discard (no draw); Gang draws a replacement first. Skipped players lose their turn. If everyone passes, the seat after the discarder plays.

Code vs rules doc conflict: the rules doc allows winning immediately after your own Chi/Peng completes the hand. The v1 UI blocks it (`canWinNow` returns false when the last action is your own Chi/Peng, on the theory that you already declined the win). Gang replacements CAN win. Decide for v2.

Endgame rule (code only, not in the rules doc): when the wall has 4 or fewer tiles at discard time, the calling phase is skipped entirely; the discard passes the turn directly and only self-draw wins remain possible for the last draws.

### 1.5 Draw game (流局)

Wall empty when a player must draw, or a bonus replacement cannot be drawn: hand ends with no winner. No points move. Dealer stays and the dealer streak still increments. Exception per the endgame rule above: the final drawable tiles can still win by self-draw.

### 1.6 Dealer rotation and streak

- Dealer wins or the hand is a draw: dealer stays.
- Anyone else wins: dealer moves to (dealerSeat + 1) % 4.
- Rotation is applied by the round-end screens when the host starts the next hand, not by the engine.

Dealer streak (连庄): stored per session. After each hand: streak = streak + 1 when the dealer won or it was a draw, else 0. The streak BONUS applied to a dealer's winning hand is the streak value banked BEFORE that hand. So the dealer's first win pays +0, a second consecutive dealer hand won pays +1, the third +2, and draws bank +1 each without paying. The rules doc example pays +3 on the 3rd consecutive round; shipped code pays +2. v2 must pick one convention.

### 1.7 Scoring (implemented values)

The constants below are what the code awards and they match the tables in `mahjong-rules.md`. Ignore the smaller numbers in `types/index.ts` comments (+20/+20/+30/+10/+60) and in the `hasGoldenPair` docstring (+30): those comments are stale.

```
subtotal = 1 (base)
         + (exposed bonus tiles) x 1
         + (gold copies physically in the winning hand) x 1
         + (concealed Gangs) x 2
         + (exposed Gangs) x 1
         + dealerStreakBonus (dealer only, streak banked before this hand)

multiplier = 2 if self-draw, Three Golds, Robbing the Gold,
             or ANY special bonus applies (even on a discard win); else 1

total = subtotal x multiplier + special bonuses
```

Special bonuses (added after the multiplier):

| Special | Points | Condition |
|---|---|---|
| No Bonus/Gang (平胡) | +15 | zero exposed bonus tiles AND zero Gangs (golds allowed) |
| Three Golds (三金) | +30 | instant win holding all 3 golds (also get +3 as golds in hand) |
| Robbing the Gold (抢金) | +30 | win at setup by claiming the flipped gold |
| Golden Pair (金对) | +50 | exactly 2 golds and the rest forms all needed sets with no wildcards (golds are the pair) |
| All One Suit (清一色) | +100 | every hand + meld tile one suit; golds ignored |

Specials stack. Which specials each win path actually checks in v1 (parity quirks):

| Win path | multiplier | specials checked |
|---|---|---|
| Self-draw | always 2 | Golden Pair, No Bonus/Gang, All One Suit |
| Discard win | 2 only if a special applies, else 1 | Golden Pair, No Bonus/Gang, All One Suit |
| Three Golds | always 2 | Three Golds only (no Golden Pair / No Bonus / All One Suit checks) |
| Robbing the Gold | always 2 | Robbing +30, Golden Pair, No Bonus (All One Suit NOT checked; Gang bonuses not counted, impossible at setup anyway) |

Payment: all 3 losers pay the winner the full total, regardless of who discarded. Session bookkeeping stores the winner's `score` once per round; net positions later expand it (winner +3 x score, each loser -score).

---

## 2. Feature parity checklist

From ROADMAP Completed, README, CHANGELOG, and code. "yes" = required for v2 parity, "polish" = ship later.

| Feature | What it does | v2 parity |
|---|---|---|
| Full game loop | deal, bonus exposure, gold flip, draw/discard, calls, wins, draw games | yes |
| Gold wildcard system | random suit type as wildcard, all rules in section 1 | yes |
| Three Golds + Robbing the Gold | instant wins at setup and during play | yes |
| Gang support | concealed, from discard, Peng upgrade, replacement draws, +2/+1 scoring | yes |
| Scoring engine | section 1.7 table incl. specials and multiplier | yes |
| Dealer streak tracking | wins and draws bank streak; bonus on dealer wins | yes |
| Room create/join by code | 6-char code, host controls, seat picking | yes |
| Quick Play vs 3 bots | one click: room + 3 bots (picked difficulty) + 30s timers + player as dealer seat 0, name "You" | yes |
| Bot players / 3 difficulties | easy/medium/hard shanten heuristics, defense on hard, fill-seats from lobby | yes |
| Calling timer | per-room 5-120s (UI) or off; auto-pass on expiry | yes |
| Turn timer | per-room 5-120s (UI) or off; auto-draw + safe auto-discard + auto-win detection | yes |
| Offline player watchdog | any connected client acts for a disconnected player after timer + 2s grace | yes (v2: server timers replace it) |
| Cumulative session scores | per-round history, running totals across hands | yes |
| Settlement calculator | min-transfer settle-up between 4 players at session end | yes |
| Score edit | host applies +/- adjustments, stored separately, logged | yes |
| Game log | append-only action log, private draw markers, per-round archive | yes |
| Ready-for-next-round | all seats ready up, host restarts with rotated dealer | yes |
| Abort game | host force-ends a hand with no round recorded | yes |
| Presence + connection banner | onDisconnect flags, offline badges, reconnecting/failed banner | yes |
| Spectator mode | signed-in non-player gets read-only board, timers, log | polish |
| Keyboard shortcuts | customizable H/G/P/C, Space default action, arrows + number keys, Enter/Esc | polish |
| Sound system | 17 effect types incl. 5 win variants, volume + mute persisted | polish |
| Rules modal | in-game reference covering the variant | polish |
| Winner reveal animation | suspense screen, tile flip cascade, fly-in golds, drumroll | polish |
| Turn indicator | N/E/S/W round-table view with current-player highlight | polish |
| Mobile layout | fixed bottom action bar, calling status bar, touch targets | polish |
| Error boundaries | friendly error page with recovery actions | polish |
| OG image / SEO | meta tags, Open Graph preview, favicon | polish |
| Dev scripts | setup-test-game, bot-game, bot-player, force-win, restart-game (`app/scripts/`) | polish |
| Test-user mode | `?testUser=N` fakes identities for multi-tab local testing | polish |

Never built (open in ROADMAP, listed so v2 does not assume they existed): reconnection re-sync, PWA, auto-pilot/AFK mode, tutorial, profiles, matchmaking, chat, replays.

---

## 3. v1 state map

This section explains where every piece of state lived, who wrote it, how others heard about it, and where it broke. It is the case for a server-authoritative v2.

### 3.1 Architecture in one paragraph

There was no server authority. Every mutation (dealing, drawing, discarding, calls, scoring) ran inside some player's browser tab as a read-modify-write against Firebase RTDB: `get()` a snapshot, validate, compute the next state, then several sequential `update()`/`set()` calls. Exactly one path used a transaction (`pendingCalls`). Everything else relied on validation checks plus luck. Timers, auto-pass, bots, and the offline watchdog were all `setInterval` loops in browser tabs. Clients learned about changes through `onValue` listeners on whole subtrees. Last write wins.

### 3.2 RTDB layout (all under `rooms/{ROOMCODE}/`)

| Path | Shape | Written by | Read by |
|---|---|---|---|
| (root) | `Room` | `createRoom` (full set) | `subscribeToRoom` in `useRoom`: every client on room + game pages listens to the WHOLE room object, including the embedded game |
| `players/seat{0-3}` | `RoomPlayer` | `joinRoom`/`addBotPlayer` (set), leave/kick (set null), presence updates | room listener |
| `players/seat{N}/connected`, `lastSeen` | booleans/ts | the seat's own client (visibility handler) and Firebase server (registered `onDisconnect`) | watchdog + offline badges on every client |
| `settings` | `dealerSeat`, `callingTimerSeconds`, `turnTimerSeconds` | host client (lobby) | game init copies timer values into the game node per phase |
| `status` | waiting/playing/ended | whichever client runs init or a win/draw handler | lobby routing |
| `game` | `GameState` (full public state incl. `wall` order) | ANY acting client: the player acting, every bot-hosting client, any watchdog client | `useGame` subscribes to the whole node on every client |
| `game/pendingCalls` | `PendingCalls` | `runTransaction` in `submitCallResponse` (the only transactional write in the app) | part of game listener |
| `game/actionLog` | string[] | `addToLog`: reads the whole array, appends, writes the whole array back | part of game listener |
| `privateHands/seat{N}` | `{ concealedTiles: TileId[] }` | dealing + every action that touches that hand (full set each time) | each client subscribes only to its OWN seat |
| `session` | `SessionScores` | `recordRoundResult` (whichever client executed the win/draw), `adjustCumulativeScores` (host) | session listener on every client |
| `session/gameLogs/{round}` | string[] | `archiveGameLog` at round end; host adjustments append | round-end screens |
| `readyForNextRound` | 4 booleans | host initializes at hand end; each seat toggles its own; bot flags come from whichever client hosts the bots; cleared by `initializeGame` | room listener |

Global: `.info/connected` (SDK connection flag per client, feeds `useFirebaseConnection`).

Security: RTDB rules were "any authenticated user can read/write everything" (per `firebase-setup-guide.md`; the stricter production rules were never applied). `privateHands` separation and the face-ordered `wall` in public state were cosmetic: any signed-in client could read every hand and the entire future wall. Anti-cheat was explicitly deprioritized ("casual friends game"). v2: hands and wall must never leave the server.

### 3.3 Client-local state

- localStorage: `mahjong-keyboard-shortcuts` (JSON), `mahjong-sound-enabled`, `mahjong-sound-volume`. Nothing else.
- Identity: Firebase anonymous auth `uid`, persisted by the SDK across refreshes. Seat recovery on refresh = match `players/seatN.id` against `uid`. `?testUser=N` substitutes a fake uid for local multi-tab testing.
- React state per client: mirrors of `game`/`privateHands/mySeat`/`session`, selection + modal state, animation state, and a family of one-shot guard refs (`expireCalledForPhaseRef`, `expireCalledForTurnRef`, `autoPlayTriggeredForTurnRef`, `offlineAutoPlayTriggeredRef`, `warningSoundPlayedRef`). The guards live per tab and reset on refresh: they stop duplicate triggers from one tab but not across tabs.

### 3.4 Core data shapes (`types/index.ts`, 347 lines)

- `GameState`: `phase` (waiting/setup/bonus_exposure/playing/calling/ended), `goldTileType` (wildcard TYPE), `exposedGold` (flipped instance), `wall` (ordered, public), `discardPile`, `currentPlayerSeat`, `dealerSeat`, `lastAction` + `previousAction` (type/seat/tile/replacementTile/isConcealed/timestamp), `exposedMelds.seat{N}` (Meld[]), `bonusTiles.seat{N}` (TileId[]), `pendingCalls`, `pendingChowOption` (validated Chi selection parked during resolution), `callingPhaseId` (increment, stale-response fence), `callingPhaseStartTime` (server ts), `callingTimerSeconds` (copied per phase), `turnStartTime` (server ts), `turnTimerSeconds`, `winner` (`WinnerInfo` or null), `actionLog`.
- `Meld`: `type` (chow/pung/kong), `tiles`, `calledTile?`, `isConcealed?` (kong only).
- `PendingCalls`: per seat, `'discarder' | 'waiting' | win|kong|pung|chow|pass`. `'waiting'` is a real string because RTDB drops nulls (stale-data lesson baked into v1).
- `WinnerInfo`: seat, isSelfDraw, isThreeGolds, isRobbingGold, winningTile?, discarderSeat?, full `hand`, `score: ScoreBreakdown`.
- `ScoreBreakdown`: base, bonusTiles, golds, concealedKongBonus, exposedKongBonus, dealerStreakBonus, subtotal, multiplier, optional threeGoldsBonus/robbingGoldBonus/goldenPairBonus/noBonusBonus/allOneSuitBonus, total. (Comment values stale; see 1.7.)
- `Room`: roomCode, hostId, createdAt, status, players.seat{N} (`RoomPlayer` or null), settings, `game?`, `session?`, `readyForNextRound?`.
- `RoomPlayer`: id, name, connected, lastSeen, isBot?, botDifficulty?.
- `SessionScores`: rounds (`GameRound[]`: roundNumber, winnerSeat|null, winnerName, score, dealerSeat, timestamp), cumulative.seat{N}, adjustments?.seat{N} (host edits kept additive and separate), dealerStreak, gameLogs?.
- `Settlement`: from-seat, to-seat, amount. `ChowOption`: tilesFromHand pair + full sequence. `ValidCalls`: canWin/canKong/canPung/canChow. `PlayerState` exists in types but is unused; live state splits hands into `privateHands` and melds/bonus into `GameState`.

### 3.5 How timers were driven

State: `turnStartTime`, `turnTimerSeconds`, `callingPhaseStartTime`, `callingTimerSeconds`, `callingPhaseId` in the game node. Start times are RTDB `serverTimestamp()` values written when the phase/turn begins; timer lengths are copied from room settings at that moment (mid-phase host changes do not retro-apply).

Countdown: every client runs a 100ms `setInterval` (`useCallingTimer` / `useTurnTimer`) computing `remaining = total - (Date.now() - startTime)`. Client clock skew against the server timestamp shifts everyone's countdown independently; there is no shared tick.

Who fires expiry:
- Calling timer: each client auto-passes only for ITSELF (`onExpire` calls `autoPassExpiredTimer(roomCode, mySeat, phaseId)`).
- Turn timer: only the current player's own client (`isMyTurn` gate) calls `autoPlayExpiredTurn` (draw if needed, auto-win if the hand completes, else `selectSafeDiscard`).
- Offline watchdog (game page, every client, 500ms poll): acts for OTHER seats only when `players/seatN.connected === false`, the seat is not a bot, and the timer expired plus a 2-second grace. Then any client may call `autoPassExpiredTimer` / `autoPlayExpiredTurn` for that seat.

Duplicate suppression: per-tab guard refs, plus server-side validation that makes repeats mostly harmless: `callingPhaseId` equality, "Already responded" checks inside the `pendingCalls` transaction, and `turnStartTime` match within 1000ms for auto-play.

Failure mode 1, the mobile freeze (ROADMAP's open HIGH PRIORITY bug): lock the phone during a calling phase. The tab's JS suspends, so (a) the 100ms countdown stops, (b) the 5-second delayed visibility disconnect never runs (its own timeout is suspended too), and (c) the RTDB socket can linger, so the server `onDisconnect` does not flip `connected` to false for a long time, sometimes not at all for a backgrounded tab. Result: the seat still looks connected, so every other client's watchdog skips it, no auto-pass arrives from anywhere, bots keep waiting for humans, and the game stalls for everyone, indefinitely.

Failure mode 2, permanent one-shot auto-pass: when the phone screen wakes, the timer hook recomputes, sees expiry, and fires `onExpire` exactly once. `expireCalledForPhaseRef` is set BEFORE the async Firebase write and there is no retry. If that write fails (radio still reconnecting is the common case right after the screen wakes), that tab will never auto-pass that phase again. Unless another player acts, the stall becomes permanent. The turn timer has the same one-shot pattern.

### 3.6 Where bots executed

`useBotRunner` was mounted by the game page with `enabled: true` unconditionally, so EVERY client rendering the game page ran bot logic, spectators included. On each game-state change, each client waits `botDelay` (800ms as mounted; hook default 1000ms), re-checks, then acts for bot seats: full turn play in `playing` phase; in `calling` phase, bots respond one per effect pass (200ms between), and only after every HUMAN seat has responded.

Consequences:
- Duplicated execution: with 2+ human clients open, all of them race to act for the same bot. The `pendingCalls` transaction and "Already responded" checks absorb calling-phase races. Playing-phase actions have no atomic guard: `drawTile` validates `currentPlayerSeat` but two clients acting on the same snapshot can both shift the wall and write hands (double draw, duplicated tiles, hand-size desync). The 800ms delay plus listener latency made this rare, not impossible.
- Liveness inversion: bots exist only in browsers. Solo Quick Play with the tab hidden = the entire game stops, because the only bot host is suspended.
- The "wait for humans first" gate combined with failure mode 1: one suspended human blocks every bot response too.

v2: bots are server-side actors; clients never execute another seat's moves.

### 3.7 Disconnect / reconnect behavior

- Presence: on seat join, the client registers `onDisconnect` handlers (server flips `connected` false + stamps `lastSeen` when the socket dies) and sets `connected` true. A `visibilitychange` handler marks the seat disconnected after 5s hidden and reconnects immediately on visible. `connected` drives offline badges and watchdog eligibility. Gap: socket death detection is slow and visibility timers suspend, per 3.5.
- Connection UX: `useFirebaseConnection` watches `.info/connected`; banner shows "reconnecting" after a 2s grace and "failed" at 30s, with a manual retry that only resets local state. It exposes `reconnectCount` for forced re-syncs; nothing ever consumed it (the ROADMAP reconnection item was never built).
- Reconnect data flow: the RTDB SDK re-attaches listeners and replays current values by itself, so the UI usually self-heals to the new state. What does not heal: missed one-shot triggers (3.5) and per-tab guard refs pointing at stale phases.
- Refresh mid-game: anonymous uid persists, the room listener re-derives `mySeat`, and the private-hand listener repopulates. Works. A NEW user opening the game URL mid-hand cannot take a seat (`joinRoom` only works while `status === 'waiting'`) and falls into spectator view.
- Leaving: `leaveRoom` nulls the seat. Mid-game this orphans the seat; only the watchdog (timer-based) keeps the game moving.

### 3.8 Other multi-writer races worth designing away

- `actionLog` append = read whole array, write whole array: concurrent writers drop each other's lines.
- Multi-step writes are not atomic: a discard is set(pendingCalls), update(game), set(privateHand) in sequence; a crash between steps leaves contradictory state (e.g. tile in the pile AND in the hand).
- `resolveCallingPhase` guards double resolution only with a read-then-check on `pendingCalls`; two clients finishing the transaction near-simultaneously can both attempt resolution (the transaction picks one `shouldResolve`, but the watchdog path can also converge here).
- `recordRoundResult` reads then rewrites session totals; two concurrent end-of-hand writers (possible via watchdog + player) can double-record.

---

## 4. Engine surface

### 4.1 `lib/tiles.ts` (1,516 LOC, pure, no Firebase)

| Export | Purpose |
|---|---|
| `generateAllTiles()` | the 128 tile instance IDs |
| `shuffle(arr)` | Fisher-Yates copy |
| `getTileType(id)` | strip instance: `dots_5_2` to `dots_5` |
| `parseTile(id)` / `parseTileType(type)` | split into category/suit/value/instance |
| `isSuitTile` / `isBonusTile` / `isHonorTile` | category predicates (bonus == honor here) |
| `isGoldTile(id, goldType)` | wildcard test by type |
| `isTerminalTile(id)` | suit 1 or 9 |
| `countGoldTiles(tiles, goldType)` | gold count in a list |
| `removeTiles` / `removeTilesByType` | subtract tiles, null when missing |
| `sortTilesForDisplay(tiles, goldType)` | golds first, then suits by value, winds, dragons |
| `canFormWinningHand(tiles, goldType, exposedMeldCount)` | THE win checker: recursive backtracking over type counts, golds branch as pair/Peng/Chi fillers; needs (5 - melds) sets + 1 pair |
| `hasGoldenPair(tiles, goldType, meldCount)` | exactly 2 golds and the rest forms all sets with zero wildcards |
| `getWinningTiles(16 tiles, goldType)` | tenpai scan over the 27 suit types (honors never sit in hands) |
| `canPung` / `canKong(hand, discard, goldType)` | 2 / 3 matching non-gold copies; gold or bonus discard never callable |
| `canDeclareConcealedKong(hand, goldType)` | types with 4 copies (gold/bonus excluded) |
| `canUpgradePungToKong(hand, melds, goldType)` | all (meldIndex, 4th tile) options |
| `canChow(hand, discard, goldType)` | all low/mid/high run options with concrete hand tiles |
| `hasChowOption` | boolean wrapper |
| `canWinOnDiscard(hand, discard, goldType, meldCount)` | win test on hand + discard |
| `getValidCalls(hand, discard, goldType, isNextInTurn, meldCount)` | the 4 call booleans |
| `getValidChowTiles` | tile-to-partner map for Chi selection UI |
| `validateChowSelection` | confirm a picked pair is a legal Chi |
| `getTileDisplayText(type)` | glyphs: `5●`, `3║`, `7萬`, 東南西北, 中 |
| `selectSafeDiscard(hand, goldType, discardPile?)` | auto-play discard: score-based (protect sets/pairs/partials, shed isolated/honors/terminals/dead tiles), never gold |
| `isAllOneSuit(hand, melds, goldType)` | flush check across hand + melds, golds ignored |

Internal helpers: `tryFormSetsAndPair` (the backtracker), `canFormPair`, `tryFormSetsOnly` (Golden Pair path), `analyzeHand`, `countMaxSets(+Recursive)` (set-preservation for safe discard).

### 4.2 `lib/game.ts` (2,872 LOC, Firebase-coupled action layer)

All state transitions, each performing get-validate-write against RTDB. Exports:

| Export | Purpose |
|---|---|
| `initializeGame(room, dealerSeat)` | shuffle, deal 16/17, cut 16-tile dead wall, auto-expose bonuses, flip gold, sort hands, write game + private hands, Three Golds scan, Robbing the Gold chain, set status playing |
| `getNextSeat(seat)` | (seat + 1) % 4 |
| `hasBonusTiles` / `getBonusTilesFromHand` / `getNonBonusTiles` | bonus filters (pure) |
| `exposeBonusTiles` / `advanceBonusExposure` / `revealGoldTile` | legacy step-wise setup flow, not used by the live init path |
| `needsToDraw(gameState)` | draw-vs-discard decision (pure) |
| `drawTile(room, seat)` | wall shift, bonus auto-expose loop, Three Golds check, lastAction draw, private-log marker |
| `discardTile(room, seat, tile)` | turn + gold + called-type validation; wall <= 4 skips calling; else open calling phase (pendingCalls reset via set, phaseId++, server ts) |
| `handleDrawGame(room)` | wall-exhaustion end, null winner, streak-preserving round record |
| `abortGame(room)` | host force-end, NO round recorded |
| `submitCallResponse(room, seat, action, chowTiles?)` | validate call, stash `pendingChowOption`, transaction on pendingCalls, resolve when all responded |
| `canWin` / `canWinOnDiscard` | thin wrappers over tiles.ts (pure) |
| `declareSelfDrawWin(room, seat)` | hand-size + structure validation, full scoring (1.7), winner write, round record |
| `declareDiscardWin(room, winner, tile, discarder)` | same for discard wins, multiplier only with specials |
| `declareConcealedKong(room, seat, type)` | face-down Gang + replacement + Three Golds check; tile type hidden from shared state |
| `upgradePungToKong(room, seat, meldIndex, tile)` | Peng to Gang + replacement + checks |
| `autoPlayExpiredTurn(room, seat, expectedTurnStartTime)` | timer path: validate turn/phase/ts (1s tolerance), draw if needed, auto-win, else safe discard |
| `autoPassExpiredTimer(room, seat, expectedPhaseId)` | timer path: validate phaseId/phase/unresponded, submit pass |
| `recordRoundResult` / `adjustCumulativeScores` / `getDealerStreak` | session scoring + host edits + streak read |
| `getPrivateHand` / `getGameState` | one-shot reads |
| `setReadyForNextRound` / `initializeReadyState` / `clearReadyState` | next-round readiness |

Internal: `addToLog`, `archiveGameLog`, `getPlayerName`, `sortAllHands`, `checkAllPlayersForThreeGolds`, `handleThreeGoldsWin`, `checkRobbingGold`, `handleRobbingGoldWin`, `resolveCallingPhase` (priority Hu > Gang > Peng > Chi, closest-seat tiebreak), `getTurnOrderFromDiscarder`, `advanceToNextPlayer`, `executeWinCall` / `executePungCall` / `executeKongCall` / `executeChowCall`, `countKongBonuses`. Compile-time test flags: `TEST_WINNING_HAND`, `TEST_KONG_MODE`, `TEST_TIMER_WIN_MODE`, `DEBUG_AUTO_PLAY`.

### 4.3 `lib/settle.ts` (117 LOC, pure)

| Export | Purpose |
|---|---|
| `calculateNetPositions(rounds)` | winner +score x 3, each other seat -score, summed over rounds |
| `calculateSettlement(rounds, names)` | greedy largest-debtor to largest-creditor matching, max 3 transfers, 2-decimal rounding; returns transfers + balances |
| `formatSettlement(s, names)` | "A to B: N pts" display string |

Also relevant: `lib/rooms.ts` (453 LOC): `generateRoomCode`, `createRoom`, `joinRoom`, `addBotPlayer`, `fillWithBots`, `getBotSeats`, `updatePlayerConnection`, `updatePlayerName`, `setDealer`, `setCallingTimer`, `setTurnTimer`, `updateRoomStatus`, `leaveRoom`, `removePlayer`, `getRoom`, `roomExists`, `getPlayerCount`, `isRoomFull`, `isHost`, `findUserSeat`, `subscribeToRoom`.

### 4.4 Test inventory (131 tests, all pure engine, zero hook/UI tests)

`__tests__/tiles.test.ts` (752 LOC, 66 tests), 18 describe blocks, all pure and portable as a v2 acceptance suite: `generateAllTiles` (5), `getTileType` (3), `parseTile` (3), `isSuitTile` (2), `isBonusTile` (2), `isGoldTile` (1), `countGoldTiles` (2), `canFormWinningHand` (5, incl. wildcard and exposed-meld cases), `hasGoldenPair` (4), `canPung` (4), `canChow` (4), `canWinOnDiscard` (2), `removeTiles` (3), `sortTilesForDisplay` (3), `canKong` (5), `canDeclareConcealedKong` (5), `canUpgradePungToKong` (7), `selectSafeDiscard` (6).

`__tests__/game.test.ts` (490 LOC, 43 tests), describe blocks, all exercising the PURE exports of game.ts (no Firebase mocks), portable: `getNextSeat` (2), `hasBonusTiles` (5), `getBonusTilesFromHand` (5), `getNonBonusTiles` (5), `needsToDraw` (11: draw/call/kong/game-start/bonus/no-action/discard/turn-change/calling-transition), `canWin` (6, incl. gold substitution and three-golds shape), `canWinOnDiscard` (5), Edge Cases (4 across bonus boundaries, instance variations, mixed hands).

`__tests__/settle.test.ts` (301 LOC, 22 tests), pure, portable: `calculateNetPositions` (8), `calculateSettlement` (9), `formatSettlement` (5).

Untested in v1 (deliberately, per ROADMAP): `useGame`, `useBotRunner`, timers, all Firebase-coupled functions in game.ts (initializeGame, drawTile, discardTile, calling resolution, scoring writes). The scoring FORMULA therefore has no direct unit tests; only win-shape detection does. v2 should add scoring-table tests.

---

## 5. Rebuild-relevant constants

Tiles and dealing:
- 128 tiles: 108 suit + 16 wind + 4 dragon; 4 copies each type; instance suffix 0-3.
- ID grammar: `{dots|bamboo|characters}_{1-9}_{0-3}`, `wind_{east|south|west|north}_{0-3}`, `dragon_red_{0-3}`. Type = ID minus final segment.
- Deal 16 per seat + 1 dealer extra (17). Dead wall 16 tiles cut from the tail. Wall after deal 63, drawable 47 before replacements.
- Win = 5 sets + 1 pair. Concealed count 17 - 3N winning / 16 - 3N waiting (N = exposed melds).
- Calling phase skipped when wall <= 4 at discard time.
- Gold: 1 exposed instance out of play, 3 wildcard copies live.

Rooms and players:
- Exactly 4 seats. Seat 0 East, 1 South, 2 West, 3 North; play advances (seat + 1) % 4.
- Room code: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31-char set, no 0/O/1/I/L); 10 uniqueness retries.
- Host = room creator (seat 0); host-only: dealer select, timers, kick, add/fill bots, start, abort, score edits.
- New joins only while `status === 'waiting'`; anyone else becomes a spectator.

Timers (code values; ROADMAP/CHANGELOG say "10-120s", the code says 5):
- Lobby UI: min 5s, max 120s, default 30s, or off (null), for both timers.
- Lib clamps: calling 5-120s, turn 5-300s.
- Quick Play sets both timers to 30s.
- Countdown tick 100ms. Warning threshold: calling 5s, turn 10s.
- Watchdog poll 500ms; offline grace +2s beyond timer.
- `autoPlayExpiredTurn` accepts turnStartTime within 1000ms of expected.
- Visibility disconnect delay 5000ms; connection banner grace 2000ms; "failed" at 30000ms.

Bots:
- Difficulties: easy / medium / hard; default medium.
- Names by difficulty and seat: `Bot-E1..E4`, `Bot-M1..M4`, `Bot-H1..H4`. Bot id: `bot_{roomCode}_seat{N}_{timestamp}`.
- Action delay: 800ms as mounted (hook default 1000ms); 200ms between bot call responses; bots act only after all humans responded in calling phase.
- Behavior constants: always Hu; always Gang on discard (fallback pass); always concealed Gang / Peng upgrade when available; Peng/Chi via shanten thresholds (easy calls when shanten does not worsen by more than allowed, medium needs same-or-better, hard needs strict improvement and tightens when wall < 20); hard adds danger scoring (defensive fold when own shanten >= 3 and an opponent has 3+ melds, or wall < 15 and shanten >= 2); never discards gold; auto-ready 1000ms + random 1000ms + 300ms per bot after hand end.

Scoring table (authoritative code values):
- Base 1; per bonus tile +1; per gold in hand +1; concealed Gang +2; exposed Gang +1; dealer streak +N (N = streak banked BEFORE the hand, dealer only).
- Multiplier x2 on: self-draw, Three Golds, Robbing the Gold, or any special (discard wins included); otherwise x1.
- Specials after multiplier: No Bonus/Gang +15, Three Golds +30, Robbing the Gold +30, Golden Pair +50, All One Suit +100. Coverage per win path in section 1.7.
- Payment: each of 3 losers pays the full total.

Quick Play: creates room as "You", dealer seat 0, timers 30s/30s, fills 3 bots at the chosen difficulty, starts immediately.

Keyboard defaults (customizable, stored in `mahjong-keyboard-shortcuts`): Hu `H`, Gang `G`, Peng `P`, Chi `C`. Hardcoded: Space = default action (draw or pass), arrow keys + number keys 1-9/0 = tile selection, Enter confirm, Escape cancel.

Sounds (`SoundType`, 17 values): tileClick, tileSelect, discard, draw, pung, chow, win, winA..winE (5 variants), yourTurn, callAlert, gameStart, pass, timerWarning, drumroll. Persisted: `mahjong-sound-enabled`, `mahjong-sound-volume`.

localStorage keys (complete list): `mahjong-keyboard-shortcuts`, `mahjong-sound-enabled`, `mahjong-sound-volume`.

Log conventions: private draw entries embed `[PRIVATE:{seat}:{tileText}]`, rendered only for that seat; concealed Gang entries omit the tile type; per-round logs archived to `session/gameLogs/{roundNumber}`.
