# v1 Mobile UI Observations (live app, not code)

Source: playing https://mahjong-vibes.vercel.app on a 375x812 viewport, 2026-07-22. Purpose: reference for the v2 client (M2 usability fix now, M4 polish later). Per posture, this records what v1 DID; v2 copies what's good and improves the rest.

## Tile rendering (M2-critical)

v1 tiles are TEXT LABELS on white rounded rects, color-coded by suit: red `1●` dots, blue `2‖` bamboo, green `6萬` characters, winds/dragon as hanzi (`北`, `中`). No unicode mahjong glyphs anywhere.

This matters beyond taste: iOS font coverage for the mahjong unicode block is poor (U+1F004 renders as the emoji; most of U+1F000-1F02B render tiny or as tofu). v2's first client used unicode glyphs; that plus the desktop-sized layout is what "rendering really off across the board" was on a real iPhone. macOS browsers mask the problem.

Gold tile: gold border + tinted background on the label tile, everywhere it appears (hand, header chip).

## Layout at 375px (top to bottom)

1. **Header bar, one line**: settings, help, room code, GOLD TILE chip inline, wall count, action-state chip (green `▶ Discard` on your turn / brown `Calling...`), timer chip (`26s`). Everything glanceable without scrolling.
2. **Own hand card at the TOP** (not bottom): `You [D] Bonus: +1 [北] ... 17 tiles` header row, then the hand as large tap targets (~55px), 6 per row, 3 rows for 17 tiles. Selected tile = darker/held state; gold tiles pre-highlighted.
3. **Compass + last-action row** (3 cards): seat compass (N/W/E/S, current player boxed, `(you)` marker); a "last call" card (`Chi [1萬][2萬][3萬] by Bot-M2`); a "last discard" card (`Discarded [8‖] by Bot-M2`). The two action cards replace watching animations: state, not motion.
4. **Discard pile card** with running count (`1 tiles`), tiles as small labels.
5. **Opponent chips, one row of 4**: `You D` plus per bot `🤖 Bot-M2 / 13 · M · +4` = tile count, difficulty letter, bonus points; the bot's melds render INSIDE its chip as small tile labels when called. NO tile-backs anywhere in the UI.
6. **Game log card**, scrollable, narrating (`You discarded 1萬`, `Bot-M2 called Chi on 1萬`, `Gold tile revealed: 6萬`). Private draws only for you.
7. **Sticky bottom bar: ONE contextual action** (`Select tile` → `PASS` during calling). Secondary calls presumably appear as multiple buttons only when actually available.

Page scrolls (log below the fold) but everything play-critical fits the first viewport.

## What v2 should copy vs improve

Copy (M2 usability fix): text-label tiles with suit colors; opponents as stat chips with inline melds, zero tile-backs; header with gold+wall+timer; large 6-per-row hand; single contextual bottom action where possible.

Copy at M4: compass + last-call/last-discard cards; game log card; settings/help affordances.

Improve on v1: v2 keeps hand at bottom or top per taste (v1's hand-on-top works well with the browser chrome at the bottom of iOS Safari; either is fine if one viewport holds everything); v2's countdown is server-deadline driven (v1's 100ms client tick is the bug we rebuilt to kill); v2 tile counts in chips come from redacted handCounts.

## Gameplay session notes (v1 live, 2026-07-22)

Played a live Quick Play game vs 3 bots in room JRCF4U, seat South, dealer. Completed 3 full hands (2 wins, 1 deal-in loss) over about 30 minutes.

### Hand-end screens

- Regular win overlay: trophy emoji, "WINNER!" in gold, `You`, `Won on Bot-M3's discard`, a `🔥 Dealer wins!` badge (only shown when the dealer is the winner), a pill button `+3 points`.
- Instant-win overlay (three golds in hand): different header entirely, three `中` tiles + `THREE GOLDS!` text, `Instant win with 3 Gold tiles!`, `🔥 2-round streak!` badge (dealer win-streak counter, distinct from the win badge above), `+52 points`.
- Loss/deal-in overlay ("So Close..."): sad-face emoji plus a rain of crying-cat emojis, `😔 So Close...`, `Bot-M4`, `Won on You's discard`, `+6 points`. Shows BOTH hands stacked: `Winning Hand` (with a `Called:` sub-row for its exposed melds) then `Your Hand` (also with its own `Called:` row). This is the only screen that shows an opponent's concealed tiles: it confirms full hands are dealt to the client (server-authoritative redaction is NOT happening in v1; v2 must not repeat this).
- Winning/losing tile in the tile row gets a gold-outline highlight (the exact tile that completed the hand), separate from the gold-tile-type highlight (tinted background). Two visually distinct kinds of "special" tile outline can appear on the same tile at once, which reads as slightly cluttered.
- `Score Breakdown` card below the hand, line items appear/disappear per hand (only nonzero lines render): `Base`, `Bonus tiles`, `Gold tiles`, `Dealer streak`, `Subtotal`, `Self-draw` (shown as a `×2` multiplier line, not additive), `Three Golds bonus`, `Total`. Order is fixed; not all lines always present.
- A celebratory particle/firework animation (rows of ✨⭐🌟💫🎇🎆 emoji plus floating star/spark SVGs) overlays the whole win screen, including the Score Breakdown card. On a small viewport the decorative bursts visually sit on top of the score numbers (e.g. a burst icon sat right over the "Gold tiles: +1" line): legible but cluttered. No such overlay on the loss screen (crying cats instead, contained to top/sides).

### Between-hands flow

- Below the score card: `Session Scores (Round N)` table, columns `Player / Won / Net`, plus a small `Edit` button (top-right of that card, purpose not explored, likely a host-only score correction tool).
- Net scoring pays every non-winner symmetrically: e.g. dealer win of 3 points → winner net +9 (3× from 3 opponents), each opponent net −3. Same pattern at all point values observed (52 → +165/−55 each; 6 → net not fully captured but proportional).
- Game Log card gets a two-tab toggle once a hand ends: `Session Summary` / `Current Game`, with `◀`/`▶` arrows to page between them (arrows disable at the ends). Not explored further, but this is a nice pattern for reviewing history without leaving the hand-end screen.
- Ready flow: `Settle` (blue, ends session presumably), `Ready Up!` (gold, toggles to `✓ Ready` once clicked, shows "`n`/4 players ready" above the buttons), and `Another Round (Dealer Stays)` (gray, disabled until all 4 are ready, then becomes enabled). As the room's apparent host, clicking `Another Round` once enabled instantly started the next hand, with no further confirmation or countdown. Bots appear to auto-ready near-instantly (never observed a long wait).
- New hand starts immediately in place (same scroll position resets to top): header gold-tile chip changes to the new hand's gold, discard pile resets to "No discards yet", wall count resets to full, dealer badge (`D`) stays on the same seat when "Another Round (Dealer Stays)" is used (matches spec 1.6: dealer stays on winner).

### During play

- Own Peng/Chi rendering: once you call, a `Melds:` label row appears above your hand (left-aligned, small caps), with the exposed triplet/run as tiles in a slightly recessed box. Hand tile count in the header drops accordingly (17 → 14 after a peng that used 2 hand tiles + the discard). This is a clean, glanceable pattern worth copying.
- Calling action bar is genuinely dynamic multi-button, confirmed three variants live: `PASS` alone; `PASS` + `PENG`; `PASS` + `CHI`; and `PASS` + `PENG` + `HU!` (all four calls can theoretically stack; only saw 3 at once). Buttons are color-coded: PASS white, PENG purple, CHI teal/cyan, HU! amber/gold. This reads well even at 375px.
- Chi eligibility is strictly "immediate left" (the player whose turn precedes yours in rotation), confirmed repeatedly: identical discards from other bots never produced a CHI button, only PASS (or PENG, which has no seat restriction). Peng and Hu can be called on anyone's discard.
- **Chi has a second, much shorter sub-timer.** Tapping `CHI` doesn't call it immediately. It switches the header chip to `Select Chi` and gives ~7s (independent of the main turn timer) to confirm which run to use, with tiles pre-highlighted (gold + blue outline) and a `Confirm (0/2)` / `Cancel` bar at the bottom. The `(0/2)` counter looked wrong at a glance (both tiles were already visually selected). This sub-timer expired on me once mid-session: the whole call was silently abandoned (reverted to a normal turn, no meld, no discard used) instead of auto-confirming the pre-highlighted default. This two-stage, short-fuse confirmation is exactly the class of UI our posture wants to kill. v2 should either skip the sub-selection when only one legal run exists, or give it the same timer as the parent decision, not a separate shorter one.
- Auto-play-on-timeout does NOT pick randomly: on every discard timeout observed (3 times), the tile that got discarded was whatever I had last tapped/selected (even a selection made seconds earlier, before I got distracted). If nothing was tapped, could not confirm from this session what it falls back to. This is a much more sensible auto-play behavior than "throw a random tile" and worth copying if v2 ever needs a forced-timeout fallback.
- A `Your Turn!` green toast banner slides in over the header briefly at the start of your turn (draw or discard decision): a nice glanceable cue, though it visually overlaps/obscures the header's gold-chip and wall-count for about a second while it's up.
- Bonus tiles expose incrementally as drawn (not all at once at deal time): game log shows e.g. `Bot-M3 exposed bonus: 東, 西, 中, 北` at deal, then later `Bot-M3 exposed bonus: 南, 西` after drawing more into replacement draws. The header `Bonus: +N` count and the row of tiles next to it update live.
- Discard pile renders oldest-to-newest left-to-right, small labels, with a small red count badge on a tile once the same tile value has been discarded more than once (e.g. a `2` badge on `1║` meaning two copies of 1║ are in the pile) rather than showing duplicate tiles: a reasonable density optimization at 375px.
- Never observed a bot kong or a wall-exhaustion draw in this session (3 hands all ended in a win/deal-in before the wall ran out or any bot drew a 4th matching tile). No data captured on kong replacement-draw display or the draw-game UI in this pass.
- No stalls or freezes of the v1-killer class (unresponsive bot loop, stuck timer) occurred in this session; the only real friction was the Chi sub-timer timeout described above, which is a design/UX issue, not a hang.
