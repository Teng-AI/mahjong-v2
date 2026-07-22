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
