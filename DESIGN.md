# Seoran design

Seoran's UI follows Chromium and Brave conventions so it feels familiar, and keeps its own identity in its mark, its accent colour, its voice, and a shield that shows what it blocked. Source of truth: `app/ui/seoran.css` (tokens) and the pages in `app/ui/`.

## Principles

- **Familiar first.** Tabs, toolbar, menu and settings work the way Chromium users expect. Don't invent new controls for standard jobs.
- **Inspired, not copied.** Never use Brave's lion, name, orange brand mark, wording ("Shields are UP"), Rewards/BAT or Wallet, or its new-tab layout (corner stats, clock).
- **Privacy you can see.** The shield always shows real numbers: this page, since install, and which hosts were blocked. No estimates, no invented stats.
- **Quiet by default.** Neutral surfaces. Colour is used for the accent and state only. No gradients, glows, tilted stickers or decorative motion.

## Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--frame` | `#e6e7eb` | `#141519` | Tab strip |
| `--toolbar` | `#ffffff` | `#24262c` | Toolbar and active tab |
| `--field` | `#eff0f3` | `#17181c` | Address bar |
| `--panel` | `#ffffff` | `#292b31` | Popups and cards |
| `--page` | `#f3f4f6` | `#1c1d21` | Internal page background |
| `--ink` / `--ink-2` / `--ink-3` | `#1c1e24` / `#50545e` / `#686c77` | `#eceef2` / `#b6b9c2` / `#999ca6` | Text (all AA on their surfaces) |
| `--line` / `--line-2` | 10% / 17% ink | 9% / 16% white | Hairlines |

Accent (`--signal`), picked in Settings > Look:

| Name | Light | Dark text |
| --- | --- | --- |
| Blue (default) | `#1a5fd6` | `#9cc0ff` |
| Orange | `#e8590c` | `#ffa066` |
| Green | `#1e8e3e` | `#6dd58c` |
| Teal | `#0e8a99` | `#52cfdc` |
| Pink | `#d6336c` | `#ff8ab0` |
| Graphite | `#50545e` | `#c4c7cf` |

The accent appears on switches, focus rings, selection, links, the loading spinner and the shield chip. Never on large surfaces.

Shape: `--r-sm` 4px (selects), `--r` 8px (buttons, cards), `--r-lg` 12px (popups). The address bar and new-tab search box are fully rounded. Toolbar and tab buttons are circles.

Type: Segoe UI Variable (Text for UI, Display for large numbers and the new-tab name). UI text is 13px; the address bar is 14px.

## Components

- **Tabs:** Chromium shape. The active tab has the toolbar colour, 8px top corners and curved feet into the toolbar. Inactive tabs are separated by 1px lines; on hover they get a rounded fill.
- **Address bar:** site icon, URL, bookmark star, a divider, then the **shield chip**: the shield icon plus this page's blocked count on an accent-tinted pill. Focus draws a 2px accent ring around the bar only.
- **Shield panel:** the site with its on/off switch in the header, the page count, the top blocked hosts with counts, one line of advice, then the global switch, the lifetime total, "Update lists" and "Shield settings".
- **Menu:** a Chromium-style list with shortcuts right-aligned (`Ctrl+T` notation).
- **Popups** are clipped by a native window region, so they have a hairline border and no outside shadow.
- **New tab:** the Seoran mark and name, a search box, up to 8 top sites (real favicons, letter fallback) and one line at the bottom with the lifetime blocked count. Plain background that follows the theme.
- **Settings:** a left nav with pill highlights; sections are white cards of rows (label and description left, control right).

## Motion

Only functional motion: a 0.15s ease on switches and hovers, a rolling count when a number changes, and the tab loading spinner. `prefers-reduced-motion` turns all of it off.

## Mark

A circle split by an S-curve, blue `#1a5fd6` and amber `#f5a623`, turned 45° (`app/ui/logo.svg`, window icon drawn in `main.rs`). It's a placeholder until the team has a designed logo.
