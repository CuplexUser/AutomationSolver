# ⚡ AutomationSolver

**A puzzle game where the "puzzle piece" is ladder logic.** Program a Mitsubishi-style PLC to solve real motor-control problems — start/stop seal-ins, emergency stops, on-delay timers, counters, a conveyor index — on a grid editor, hit Run, watch power flow light up the machine, and get graded against scripted test scenarios.

[![TypeScript](https://badgen.net/badge/TypeScript/React%20%2B%20Express/3178c6)]()
[![No native deps](https://badgen.net/badge/npm%20install/no%20C%2B%2B%20toolchain/2ea44f)]()

![AutomationSolver bench](docs/preview.png)

> **Note:** the current GitHub Pages homepage link serves the static frontend only — this app needs the Express/SQLite backend to actually grade puzzles, so it likely won't fully run there. Worth pointing the demo link at a real hosted instance (or removing it) so visitors land somewhere that works.

## Why this exists

Ladder logic is normally taught with a $2,000 PLC trainer kit and a manual. This is the same skill — series/parallel rung logic, timers, counters, seal-in circuits — as a browser puzzle game with instant feedback, built out of a real automation coursework background.

## Stack

- **Frontend** — React + TypeScript (Vite), TanStack Query, Zustand, React Router
- **Backend** — Express + Passport (local + Google/GitHub OAuth), sessions
- **Database** — SQLite via Node's built-in `node:sqlite` (no native build step)
- **Shared** — a pure-TypeScript ladder-logic simulation engine used by both the client (live play) and server (authoritative grading), so they always agree

> No native modules. Password hashing uses `node:crypto` scrypt; the database uses the built-in `node:sqlite` — `npm install` never needs a C++ toolchain.

## Getting started

```bash
npm install
npm run dev        # server on :4000, client on :5173 (Vite proxies /api → :4000)
```

Open http://localhost:5173, create an account, start solving.

<details>
<summary><b>OAuth setup (optional)</b></summary>

Copy `packages/server/.env.example` and set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`. Providers left blank are simply hidden on the sign-in page.

- Google callback: `http://localhost:4000/api/auth/google/callback`
- GitHub callback: `http://localhost:4000/api/auth/github/callback`

</details>

<details>
<summary><b>Layout & tests</b></summary>

```
packages/
  shared/   ladder model, scan-cycle engine, puzzle schema, processes, grader (+ tests)
  server/   Express API, auth, node:sqlite data layer, grading endpoint (+ supertest)
  client/   Vite React SPA: grid ladder editor, live sim + HMI panel (+ Playwright e2e)
```

```bash
npm test                       # shared engine (vitest) + server API (supertest)
npm run test:shared            # just the simulation-engine unit tests
npm run test:e2e -w @automationsolver/client   # Playwright: build + solve a puzzle end-to-end
npm run typecheck              # tsc across all packages
```

The engine tests cover rung power-flow (series/parallel/NC/edge), timers, counters, and prove a canonical solution exists for every shipped puzzle.

</details>

<details>
<summary><b>How the simulation works</b></summary>

A program is a list of rungs; each rung is a grid of cells. Contacts and wires are horizontal conducting edges; vertical links join rows into parallel branches. Each scan, [`rungSolver`](packages/shared/src/sim/rungSolver.ts) treats the grid as a graph and floods power from the left rail — series = AND, parallel = OR. [`SimEngine`](packages/shared/src/sim/scanCycle.ts) advances only by an explicit `dt`, so the client animation and the server grader produce identical traces.

</details>

<details>
<summary><b>Adding a puzzle</b></summary>

Add a `PuzzleSpec` under [`packages/shared/src/puzzle/content/`](packages/shared/src/puzzle/content) and register it in `content/index.ts`. A puzzle declares its I/O devices, allowed instructions, a process model (`passthrough` or a stateful one like `conveyor`), and graded scenarios (scripted input timelines with expected outputs). Add a canonical solution to `grade.test.ts` to prove it's solvable.

</details>

## Roadmap

The `shared/puzzle` process-model abstraction is designed to host a second puzzle family — **control-cabinet wiring** (contactors, overloads, AC motor control) — without reworking the engine or API.
