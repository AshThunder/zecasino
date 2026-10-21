# Zecasino asset register

| Asset | Path | Source | Licence |
|---|---|---|---|
| Playing card faces (52 + 2 jokers), PNG 360px rendered from SVG | apps/web/public/assets/cards/*.png | Vector Playing Cards — https://github.com/notpeter/Vector-Playing-Cards (based on Byron Knoll, https://code.google.com/archive/p/vector-playing-cards/) | Public domain (WTFPL fallback) — copy in assets/cards/LICENSE-vector-playing-cards.md |
| Card/chip/dice sound effects (13 files, mp3 converted from ogg) | apps/web/public/assets/sfx/*.mp3 | Kenney "Casino Audio" 1.1 — https://kenney.nl/assets/casino-audio | CC0 1.0 — copy in assets/sfx/LICENSE-kenney-casino-audio.txt |
| Card back (Zcash ⓩ guilloché) | apps/web/src/components/CardBack.tsx | Original, made for Zecasino | MIT (this repo) |
| Casino chips with denominations | apps/web/src/components/Chip.tsx | Original SVG | MIT |
| European roulette wheel (single zero, standard order 0-32-15-19-4-21-2-25-17-34-6-27-13-36-11-30-8-23-10-5-24-16-33-1-20-14-31-9-22-18-29-7-28-12-35-3-26) and betting layout | apps/web/src/components/RouletteWheel.tsx, RouletteLayout.tsx | Original SVG, generated from the standard sequence and red set {1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36} | MIT |
| Carrot and wooden box | apps/web/src/components/Carrot.tsx, Box.tsx | Original SVG | MIT |
| Dice faces, dice cup | apps/web/src/components/Die.tsx, DiceCup.tsx | Original SVG | MIT |
| Felt texture | CSS/SVG feTurbulence noise | Original | MIT |
| Roulette ball roll sound | synthesised at runtime with Web Audio (no file) | Original | MIT |
| Fonts: Cormorant Garamond, Manrope | via @fontsource packages (self-hosted, no third-party requests) | Google Fonts / Fontsource | SIL OFL 1.1 |
| Zcash ⓩ mark usage | brand reference | https://z.cash/brand | Zcash trademark guidelines; descriptive use, "not affiliated" note |

Evaluated and not used: Kenney Playing Cards / Boardgame packs (CC0) — 64px sprites, too low-res for a premium table.
