---
version: 1
slug: "app-ui-chrome-html"
primary_target: "app/ui/chrome.html"
related_targets: ["app/ui/newtab.html","app/ui/settings.html","app/ui/devtools/devtools.html"]
---

# Seoran browser UI (chrome, new tab, settings, DevTools)

Mode: Operate. Users keep it open all day; the page is the star. The owner rejected two expressive worlds (Candy Plastic, Instrument) and took the category standard: make it feel like Brave.

## Direction contract

THESIS: Seoran looks and behaves like a first-class Chromium browser in the Brave mould, so it feels instantly familiar; its identity lives in its own mark, its accent colour and an honest shield. It refuses both the decorated AI template and a costume of Brave's brand.

OWN-WORLD: Neutral frame (light grey, or near-black in dark), white or charcoal toolbar, Chromium tabs whose active tab merges into the toolbar with curved feet, a fully rounded address bar, round-hover toolbar buttons, 12px-radius popups with a hairline border. Segoe UI Variable throughout. One accent colour the user picks (Grape default; Tangerine, Lime, Bondi, Strawberry, Graphite) for toggles, focus, selection and links.

STORY: Anyone who has used Brave or Chrome knows where everything is. The shield button inside the address bar shows how many ads and trackers it blocked on this page; one click opens a panel to turn it down for a site.

FIRST VIEWPORT: Row 1 (40px): Seoran mark, tabs, new tab, window controls. Row 2 (44px): back, forward, reload, the pill address bar (site icon, URL, bookmark star, shield button with count badge at its right end), the app menu. New tab: a dark wallpaper with blocked-count stats top left, a clock top right, a centred search box, a row of top-site tiles and a Customize button bottom right.

FORM: Category standard (canon), user-chosen on 2026-11-21, measured against Brave and Chrome on Windows. Seed fc5f8c07 rounds are closed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
