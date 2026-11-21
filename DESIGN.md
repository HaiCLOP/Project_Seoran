# Seoran design

**Riso pop.** Seoran keeps the Chromium layout people already know (tabs on top, a rounded address bar, a menu at the right). It prints that layout in flat, saturated inks on near-black night or warm paper, with ink-black text on every colour block. The energy comes from the owner's site, haiclop.xyz; the layout and parts are Seoran's own. Source of truth: `app/ui/seoran.css` (tokens) and the pages in `app/ui/`.

## Principles

- **Familiar layout, loud print.** Controls stay where Chromium users expect them; colour and type carry the personality.
- **Flat ink only.** Colour comes in solid blocks. No gradients, glows, glass, blur or tinted-transparent "AI" washes. Text on a colour block is always ink black (`--on-pop`).
- **Colour means something.** The accent marks what's live or chosen: the shield, the active tab, the selected row. The other inks mark places: site tiles and settings sections.
- **Privacy you can see.** The shield shows real numbers and real blocked hosts. No estimates, no invented stats.
- **Inspired, not copied.** Never use haiclop.xyz's mascots, illustrations or hand-lettered notes, or Brave's lion, name, wording, Rewards/BAT or Wallet.

## Inks

Same in both themes, always carrying `--on-pop` (`#121013`) text:

| Ink | Hex | Default role |
| --- | --- | --- |
| Volt | `#c8f53b` | Default accent; Shield section |
| Hot | `#ff5c93` | Look section; logo |
| Sky | `#62c4ff` | General section |
| Tang | `#ff8a3d` | About section |
| Lilac | `#b6a4ff` | Privacy section |
| Mint | `#4fe0b0` | Accent option |

The accent (`--signal`) is one ink, picked in Settings > Look. On paper, accent-coloured *text* uses a deep version (`--signal-text`, for example volt text is `#4b6900`). On night it uses the ink itself.

## Surfaces

| Token | Paper (light) | Night (dark) | Use |
| --- | --- | --- | --- |
| `--frame` | `#e6dfd0` | `#0e0d0f` | Tab strip |
| `--toolbar` | `#faf6ee` | `#1c1a1e` | Toolbar and active tab |
| `--field` | `#ece5d7` | `#2a272c` | Address bar |
| `--panel` / `--panel-2` | `#fffcf6` / `#f2ebdd` | `#1f1d22` / `#2a272d` | Popups and cards |
| `--page` | `#f4efe6` | `#121013` | Internal pages |
| `--ink` / `--ink-2` / `--ink-3` | `#121013` / `#48433d` / `#6a645b` | `#f4efe6` / `#c9c2b6` / `#a29b8f` | Text (all AA) |
| `--edge` | `#121013` | `#3b373f` | 2px outlines on popups |

Focus is a 2px ring: ink on paper, the accent at night. Text selection fills with the accent.

Shape: pills for buttons, selects, chips and the address bar; 12px for popups (it matches the window region); 14–16px for cards and tiles.

## Type

- **Segoe UI Variable** for all browser UI, so the frame feels native (13px; the address bar is 14px).
- **Bricolage Grotesque** (bundled in `app/ui/fonts`, SIL OFL, variable width and weight) for display type on Seoran's own pages, set heavy (750–800) and slightly condensed (82–92%). Used for the new-tab wordmark, settings headings, big counts, tile names, the shield count and the new-tab band.

## Components

- **Tabs:** Chromium shape. The active tab has the toolbar colour, a 3px accent cap along its top edge and semibold title. Tabs that are asleep still show their real favicon (remembered in history); a tab with no icon gets a letter on an ink chip.
- **Shield chip:** in the address bar. When the page has blocked something it prints solid in the accent with the count in ink.
- **Shield panel:** the site and its switch; the page count on a solid accent block (a grey block when the shield is off for the site); the top blocked hosts with count pills; then the global switch, the lifetime total, "Update lists" and "Shield settings".
- **Menus, suggestions, palette:** 2px outlined cards. The hovered or selected row fills with the accent, text in ink.
- **Links** are ink with a 2px accent underline.
- **Toasts** are inverted (ink background) with an accent action pill.
- **New tab:**
  - A huge "Seoran" wordmark in ink, printed over a hard accent offset, like a misregistered riso print.
  - The search bar is the page's one inverted surface (chalk at night, ink on paper) with an accent offset.
  - Top sites are solid ink tiles in rotation (volt, hot, sky, tang, lilac, mint) with the favicon on a chalk disc. They lift on hover and press on click.
  - A full-width accent band at the bottom shows the lifetime blocked count, then scrolls the hosts most recently blocked (pauses on hover).
- **Settings:**
  - Each section has its own ink chip, both in the nav and beside the section heading.
  - The nav highlight is an ink pill that slides to the section in view.
  - The shield's lifetime count is printed on a volt block.
  - The appearance control and accent picker are pills and ink swatches.
- **DevTools:** neutral surfaces; a 3px accent underline on the open tool; the element picker fills with the accent when on.

## Motion

Motion explains a change; it never decorates. Easing is `cubic-bezier(0.2, 0, 0, 1)` throughout.

- **Tabs:** they grow in when opened (0.22s), collapse when closed (0.18s) and glide to their new slots on reorder (FLIP). While you drag a tab, the others slide aside.
- **Small transitions:** hovers fade over 0.15s, and toolbar buttons press in slightly.
- **Counts:** they roll digit by digit when they change.
- **New tab:**
  - One entrance: the wordmark rises out of its line, then search, tiles and the band follow.
  - Tiles lift and press.
  - The band's count bumps each time the shield blocks something.
- **Popups** open instantly; they're clipped by a window region, so fades would flash.
- **Reduced motion:** `prefers-reduced-motion` turns all of it off.

## Mark

A circle split by an S-curve, hot pink `#ff5c93` and volt `#c8f53b`, turned 45° with a thin ink outline (`app/ui/logo.svg`; the window icon is drawn in `main.rs`). It's a placeholder until the team has a designed logo.
