# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A puzzle game where players program a Mitsubishi-style PLC in ladder logic to solve motor-control problems. The defining architectural idea: a **single pure-TypeScript simulation engine in `packages/shared` runs on both the client (live play) and the server (authoritative grading)**, so the two always agree bit-for-bit.

`docs/FEATURE-MAP.md` describes what exists and where it lives; `docs/ROADMAP.md` is the phased plan for what comes next.

## Commands

Run from the repo root (npm workspaces):

```bash
npm install
npm run dev          # server on :4000 + client on :5173 (Vite proxies /api → :4000)
npm test             # shared engine (vitest) + server API (supertest)
npm run test:shared  # just the simulation-engine unit tests
npm run typecheck    # tsc --noEmit across all packages
npm run lint         # ESLint 10 (flat config, eslint.config.js) across all packages
npm run build        # production client build
npm run seed         # seed the SQLite database
```

Package-scoped and single-test:

```bash
npm run test:e2e -w @automationsolver/client              # Playwright end-to-end
npm run test -w @automationsolver/server                  # server tests only
npx vitest run src/sim/rungSolver.test.ts -w @automationsolver/shared   # one file
npx vitest run -t "rising edge" -w @automationsolver/shared             # one test by name
```

## Hard constraint: zero native dependencies

`npm install` must work with **no C++ toolchain**. Never add a package that compiles native code (better-sqlite3, argon2, bcrypt, sqlite3, connect-sqlite3). Use Node builtins or pure JS instead. The established substitutions:

- **Database** — Node's builtin `node:sqlite` (`DatabaseSync`), loaded via `createRequire(import.meta.url)('node:sqlite')` in `packages/server/src/db/index.ts`. Do **not** convert this to a static `import` — Vite/vitest don't recognize the builtin and fail to bundle it.
- **Password hashing** — `node:crypto` scrypt (`packages/server/src/auth/password.ts`), format `scrypt$salt$hash`.
- **Sessions** — a custom `SqliteStore` on `node:sqlite`, not connect-sqlite3.

## Lint

ESLint 10 flat config at the repo root (`eslint.config.js`), covering all three workspaces. Two things it enforces beyond the usual:

- **`packages/shared` must stay deterministic** — `no-restricted-globals`/`no-restricted-properties` ban `Date`, `performance`, `Math.random`, `window` and `document` there. The engine advances only by an explicit `dt`; if it could read the clock, client and server would stop agreeing.
- **`react-hooks` rules are on `recommended-latest`**, which includes the newer `set-state-in-effect` and `refs` rules. Where an effect genuinely syncs React with an external system (the sim engine, the session bootstrap), suppress the single reporting line with a reason rather than turning the rule off.

## Architecture

Three workspaces under `packages/`:

- **`shared/`** — the domain core, no runtime deps. Ladder model + address parsing (`ladder/`), the simulation engine (`sim/`), and the puzzle system (`puzzle/`: schema, process models, grader, validator, and puzzle content).
- **`server/`** — Express + Passport (local + Google/GitHub OAuth) + `node:sqlite`. Imports the shared grader; the server is the source of truth for scoring.
- **`client/`** — Vite React SPA. Grid ladder editor + live sim/HMI panel. Imports the shared engine to run the same simulation locally for instant feedback.

### Simulation engine (the critical, highest-risk code)

A `LadderProgram` is a list of **rungs**; each rung is a grid of cells. Contacts/wires are horizontal conducting edges (series = AND); vertical links join rows into parallel branches (OR).

- `sim/rungSolver.ts` — `evaluateRung()` treats one rung as a graph and floods power from the left rail using disjoint-set union over column-boundary nodes. Returns which coils energize plus the live nodes/cells for UI highlighting.
- `sim/scanCycle.ts` — `SimEngine` runs the scan loop (evaluate rungs top→bottom, apply coils/timers/counters). **It advances only by an explicit `dt`, never wall-clock**, which is what makes client animation and server grading produce identical traces. Timer presets are K-units of 100 ms (`TIMER_BASE_MS`). Edge contacts compare against `prevBits`, an image snapshotted at the **end** of each scan — changing that timing breaks edge detection.

### Puzzle system

A `PuzzleSpec` (`puzzle/types.ts`) declares I/O `devices`, optional internal `registers` (M/T/C working addresses surfaced as an IO list in the UI), `allowedInstructions`, a `processId`, and graded `scenarios` (scripted input timelines with `expect` assertions).

- **Process models** (`puzzle/processes/`) are small state machines that react to `Y` outputs and drive `X` inputs (e.g. `conveyor` moves a part and derives a sensor bit). Use `passthrough` when no machine dynamics are needed. Register new ones via `registerProcess`.
- **Submit flow** (`server/src/routes/puzzles.ts`) is two-phase: `validateProgram()` (structural — instruction allow-list, device-kind/role match, presets, every rung has an output) then `gradeProgram()` (runs every scenario through `SimEngine` + the process). Both live in `shared`.

### Adding a puzzle

Add a `PuzzleSpec` under `packages/shared/src/puzzle/content/`, register it in `content/index.ts`, and add a canonical solution to `grade.test.ts` — that test proves every shipped puzzle is solvable and is the guardrail against authoring an impossible puzzle.

## Data flow notes

- The DB stores puzzle references by `slug` only; puzzle content is never duplicated into the database. `progress`, `solutions`, and `user_settings` key off `(user_id, puzzle_slug)`.
- Auth uses httpOnly session cookies; OAuth providers with blank credentials are hidden on the sign-in page (see `packages/server/.env.example`).
- Server tests set `DB_PATH=:memory:`.
