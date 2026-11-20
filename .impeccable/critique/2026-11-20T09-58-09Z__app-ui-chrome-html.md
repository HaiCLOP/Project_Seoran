---
target: Seoran browser UI
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:E:\\browser\\app\\ui\\chrome.html"
target_fingerprint: "sha256:44d8872a6a89918b1cba34b8e00bbf68a19e13ce27332073bfaf41d9cd9c62f8"
target_path: "E:\\browser\\app\\ui\\chrome.html"
timestamp: 2026-11-20T09-58-09Z
slug: app-ui-chrome-html
---
Method: dual-agent (A: design review, B: detector)

## Design Health Score: 23/40 (Acceptable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Shield totals disagree (new tab 12, popover/settings 15); "Seoran page" switch looks off with no reason; settings scroll-spy highlights the wrong section |
| 2 | Match to real world | 2 | "Hey, Seoran" greets the browser; "N" monogram labelled ycombinator; stale kite.* titles |
| 3 | User control and freedom | 3 | Undo close, reopen, per-site toggle, forget site |
| 4 | Consistency and standards | 2 | Three chip styles, two focus-ring systems, mixed kbd notation, internal favicon ignores plastic |
| 5 | Error prevention | 3 | Shield-everywhere off is one unconfirmed click |
| 6 | Recognition over recall | 3 | Unnamed swatches; unlabeled cartridge count |
| 7 | Flexibility and efficiency | 3 | Palette and shortcuts good; tall rows, no density option |
| 8 | Aesthetic and minimalist design | 1 | Greeting hero, duplicate search box, giant "0", empty stat cards, chips repeated 3x |
| 9 | Error recovery | 2 | No designed offline/error/blocked states |
| 10 | Help and documentation | 2 | Plastic and per-site toggle unexplained |

## Design specificity verdict
Category-interchangeable. Remove the hue and it is the stock 2024-25 AI kit: rounded inserts on a coloured bar, shadcn settings, Raycast palette, "Hey {name}" hero over a pill search with Go, letter-circle shortcut grid, KPI stat cards. The Candy Plastic contract (molded plastic, clear windows, die-cut stickers) was not rendered: the plastic is a flat fill with an invisible gradient, the windows are plain rounded rects, the stickers are grey pills. Only the odometer is authored, and it is too small to notice. Detector: 12 warnings; 1 real (4px top rim on rounded panels, counted 5x), 6 false positives (devtools density, checkerboard, form controls read as nested cards), 1 borderline.

## Priority issues
- [P0] Shield numbers disagree and the main proof moment is a hero "0". Fix: one source of truth with live updates; lead the popover with site + decision; count secondary ("0 here, 15 since install"); explain internal pages in words.
- [P0] Direction never rendered: flat drench + pills = default AI theming. Fix: render real material or replace the direction.
- [P1] AI-default motifs: tilted brand pill, duplicate new-tab search + Go, hash-hue monograms, 4px panel top rims, sparkle icon. Fix: delete them; real favicons on one neutral tile; omnibox focus on new tab.
- [P1] Focus/consistency: double focus ring on the address bar; one focus system; unify chips and kbd; theme the internal-page badge.
- [P2] 88px of saturated candy all day fights the page. Fix: colour on controls (cartridge, active-tab notch, focus, selection), not the whole frame.

## Persona red flags
Alex: 220px tabs collapse to "Ne..." at 11 tabs; new tab wastes the viewport; 38px suggestion rows; menu mixes swatches with commands; palette shows stale titles.
Sam: button nested inside link on top sites; double/inconsistent focus rings; inactive tab text ~3:1 on grape; colour-only swatches; count not announced in the cartridge label; two different menus from two buttons.

## Minor
Panel rim pinches at corners; odometer cells too wide at display size; palette overlaps settings nav; mixed kbd glyphs; lime dot in mark is a fourth accent; new-tab alignment.

## Questions
1. Switched to Graphite, could anyone tell Seoran from a Chromium fork? 2. Why is the biggest number usually zero? 3. Who speaks "Hey, Seoran", and to whom?
