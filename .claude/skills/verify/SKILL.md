---
name: verify
description: How to build, launch, and drive AutomationSolver to verify a change end-to-end.
---

# Verifying AutomationSolver changes

Surface is the web GUI (Vite React SPA + Express API). Drive it with Playwright.

## Launch + drive in one step

Drop a temporary spec in `packages/client/tests/*.spec.ts` and run:

```bash
cd packages/client
SHOT_DIR=<scratchpad> npx playwright test <specname>
```

`playwright.config.ts` auto-starts both servers (server via tsx with
`DB_PATH=:memory:`, client via vite on :5173) and reuses running ones.
Delete the temp spec afterwards.

## Recipes that work

- **Fresh account**: register via `/login` → "Need an account" flow (see
  `tests/smoke.spec.ts`); DB is in-memory so any email works.
- **Reach late puzzles**: `/settings` → check "Developer mode: unlock all
  puzzles" → Save (dev-only toggle; requires vite dev server).
- **3D machine scenes**: canvas is `.machine3d canvas`; wait ~1.5s after it
  appears for the glb to load before screenshotting. Interaction hint text is
  `.machine3d-hint`.
- **Theme**: default follows `browser.newContext({ colorScheme })`; explicit
  choice is `localStorage['as-theme']`; resolved theme is
  `html[data-theme]`.

## Gotchas

- Mouse-drag tests on the 3D canvas: keep drag start/end well inside
  `canvas.boundingBox()` — the canvas is only ~300px wide, and offsets like
  ±150px from center land outside it, silently doing nothing.
- Assertions alone don't verify visuals — screenshot to SHOT_DIR and actually
  look at the images.
