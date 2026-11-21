# Seoran design

Seoran's UI follows Chromium and Brave conventions so it feels familiar, and keeps its own identity in its mark, its accent colour, its voice, and a shield that shows what it blocked. Source of truth: `app/ui/seoran.css` (tokens) and the pages in `app/ui/`.

## Principles

- **Familiar first.** Tabs, toolbar, menu and settings work the way Chromium users expect. Don't invent new controls for standard jobs.
- **Inspired, not copied.** Never use Brave's lion, name, orange brand mark, wording ("Shields are UP"), Rewards/BAT or Wallet, or its new-tab layout (corner stats, clock).
- **Privacy you can see.** The shield always shows real numbers: this page, since install, and which hosts were blocked. No estimates, no invented stats.
- **Quiet by default.** Neutral surfaces. Colour is used for the accent and state only. No gradients, glows, tilted stickers or decorative motion (see Motion).

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

Type: Segoe UI Variable for all browser UI, so the frame feels native (13px; address bar 14px). Bricolage Grotesque (bundled in `app/ui/fonts`, SIL OFL, variable width and weight) is the display face, used only for large type on Seoran's own pages: the new-tab wordmark (650 weight, 92% width, -0.03em), settings headings and big counts.

## Components

- **Tabs:** Chromium shape. The active tab has the toolbar colour, 8px top corners and curved feet into the toolbar. Inactive tabs are separated by 1px lines; on hover they get a rounded fill.
- **Address bar:** site icon, URL, bookmark star, a divider, then the **shield chip**: the shield icon plus this page's blocked count on an accent-tinted pill. Focus draws a 2px accent ring around the bar only.
- **Shield panel:** the site with its on/off switch in the header, the page count, the top blocked hosts with counts, one line of advice, then the global switch, the lifetime total, "Update lists" and "Shield settings".
- **Menu:** a Chromium-style list with shortcuts right-aligned (`Ctrl+T` notation).
- **Popups** are clipped by a native window region, so they have a hairline border and no outside shadow.
- **New tab:** a large "Seoran." wordmark (accent full stop), a search box, up to 8 top sites (real favicons, letter fallback) on magnetic tiles, and a footer rail: the lifetime blocked count, a live ticker of recently blocked hosts, Shield settings and Customize. Behind it sits the field, a faint dot grid that leans toward the cursor and ripples once for each blocked request.
- **Settings:** a left nav whose highlight pill slides to the section in view; sections are white cards of rows (label and description left, control right) under display-face headings.

## Motion

Motion explains a change; it never decorates. The new tab is the one page allowed a show, and even there the motion is driven by real shield data. Easing is `cubic-bezier(0.2, 0, 0, 1)` throughout.

- Tabs grow in when opened (0.22s), collapse when closed (0.18s) and glide to their new slots on reorder (FLIP). While you drag a tab, the others slide aside to show where it will land.
- Hovers and focus fade over 0.15s; toolbar buttons press in slightly.
- Counts roll digit by digit when they change.
- New tab: one orchestrated entrance (the wordmark rises out of its line, then search, sites and footer follow), magnetic tiles, the cursor-reactive field with shield ripples, and the ticker, which pauses on hover.
- Popups open instantly like native menus; they're clipped by a window region, so fades would flash.
- `prefers-reduced-motion` turns all of it off: no entrance, no field motion, no ticker scroll.

## Mark

A circle split by an S-curve, blue `#1a5fd6` and amber `#f5a623`, turned 45° (`app/ui/logo.svg`, window icon drawn in `main.rs`). It's a placeholder until the team has a designed logo.
