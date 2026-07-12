# Feature Map

Where every capability lives today, and how the pieces fit. This is the "what exists"
document; [ROADMAP.md](./ROADMAP.md) is the "what's next" document.

## The one architectural idea

A single pure-TypeScript simulation engine in `packages/shared` runs **on both the client
and the server**. The client runs it for live play; the server runs the same code to grade
submissions. They agree bit-for-bit because the engine advances only by an explicit `dt` —
never wall-clock time. Everything else in the system is arranged around keeping that true.

```
             packages/shared  (no runtime deps)
             ├── ladder/      program model + address parsing
             ├── sim/         rungSolver + SimEngine scan cycle
             └── puzzle/      spec schema, process models, validator, grader
                    │                              │
        imported by │                              │ imported by
                    ▼                              ▼
        packages/client (Vite React)     packages/server (Express + node:sqlite)
        live sim, ladder editor, HMI     authoritative grading, auth, persistence
```

## Feature areas

### 1. Ladder program model — `shared/src/ladder/`
- Mitsubishi FX addressing: `X` inputs, `Y` outputs, `M` relays, `T` timers, `C` counters.
- A program is an ordered list of **rungs**; a rung is a grid of cells plus vertical links.
- Elements: NO / NC / rising-edge / falling-edge contacts, OUT / SET / RST coils, timer,
  counter, horizontal wire.

### 2. Simulation engine — `shared/src/sim/`
- `rungSolver.ts` — treats a rung as a graph and floods power from the left rail using
  disjoint-set union over column-boundary nodes. Series = AND, vertical links = OR.
  Returns energized coils plus the live nodes/cells the UI highlights.
- `scanCycle.ts` — `SimEngine`: evaluate rungs top→bottom, apply coils immediately (a later
  rung sees an earlier rung's coil in the *same* scan), tick timers/counters by `dt`.
  `prevBits` is snapshotted at the **end** of each scan, which is what makes edge contacts work.
- Timer presets are K-units of 100 ms (`TIMER_BASE_MS`).

### 3. Puzzle system — `shared/src/puzzle/`
- **`PuzzleSpec`** (`types.ts`) — briefing, hints, `devices` (the physical I/O), optional
  `registers` (internal M/T/C the puzzle expects, surfaced as an IO list), `allowedInstructions`,
  `maxRungs`, a `processId`, and graded `scenarios`.
- **Process models** (`processes/`) — small state machines that react to `Y` outputs and drive
  `X` inputs. Registered via `registerProcess`.
  - `passthrough` — no machine dynamics; the HMI *is* the process.
  - `conveyor` — moves a part and derives a position sensor.
  - `drill` — clamp travel, drill feed depth, spindle/beacon/done state; derives `X2` (clamped)
    and `X3` (at bottom).
  - `elevator` — continuous car position across 3 floors; derives the floor sensors `X3`/`X4`/`X5`.
- **Validator** (`validate.ts`) — structural checks: instruction allow-list, device kind/role
  match, presets present, every rung drives an output.
- **Grader** (`grade.ts`) — runs each scenario's scripted input timeline through `SimEngine` +
  the process model and checks the `expect` assertions. `grade.test.ts` holds a canonical
  solution for **every shipped puzzle** — that test is the guardrail against authoring an
  impossible puzzle.

### 4. Puzzle content — `shared/src/puzzle/content/`

| # | Slug | Difficulty | Teaches | Process |
|---|------|-----------|---------|---------|
| 1 | `direct-control` | tutorial | contact → coil | passthrough |
| 2 | `seal-in` | easy | latching / seal-in branch | passthrough |
| 3 | `estop` | easy | normally-closed safety wiring | passthrough |
| 4 | `delayed-start` | medium | on-delay timer + run latch | passthrough |
| 5 | `batch-counter` | medium | counter with reset | passthrough |
| 6 | `conveyor-stop` | medium | reacting to a machine-driven sensor | conveyor |
| 7 | `drill-station` | hard | multi-step sequence, SET/RST, beacon | drill |
| 8 | `elevator-auto-return` | hard | timed auto-return, cancelable descent | elevator |

### 5. Client — `packages/client/src/`
- **Ladder editor** (`features/ladder/`) — grid canvas, instruction palette, device chips,
  vertical-link toggles, add/remove rungs, rows and columns. Supports **in-place address
  editing**: select a placed element and retype its address or preset. Zoom control (60–140%)
  for large programs. Editor state in Zustand.
- **Sim runner + HMI** (`features/sim/`) — run / step / reset; live rung highlighting; an
  interactive operator panel of push buttons, toggles, e-stops, lamps and motors bound to X/Y.
- **Machine views** (`features/sim/MachineView.tsx`) — puzzle-specific scenes chosen by
  `processId`. `Machine3D.tsx` is a dependency-free SVG 3D renderer (painter's-algorithm depth
  sort, drag-to-rotate, idle orbit while running) used by the drill station; the elevator gets a
  2D shaft view. Puzzles without a bespoke scene render none.
- **Resizable workspace** (`features/layout/Resizable.tsx`) — the play view is a full-height
  three-column workbench; the brief and operator panels are drag-resizable (widths persisted to
  `localStorage`) and collapsible, and each column scrolls independently so a long program never
  pushes the palette off screen.
- **Server state** via TanStack Query; auth context wraps the app.

### 6. Server — `packages/server/src/`
- **Auth** (`auth/`) — Passport local + Google + GitHub OAuth, `node:crypto` scrypt hashing,
  httpOnly session cookies backed by a custom `SqliteStore`.
- **Routes** (`routes/`) — puzzle list/detail, draft save, submit, progress, settings.
- **Submit flow** (`routes/puzzles.ts`) is two-phase: `validateProgram()` then `gradeProgram()`,
  both from `shared`. The server is the source of truth for scoring.
- **Persistence** — Node's builtin `node:sqlite`. Puzzles are referenced by `slug` only;
  content is never duplicated into the database.

### 7. Constraints that shape everything
- **Zero native dependencies.** `npm install` must work with no C++ toolchain. No
  better-sqlite3, argon2, bcrypt, sqlite3. See `CLAUDE.md` for the established substitutions.
- **Determinism.** Nothing in `shared` may read the clock, `Math.random()`, or the DOM.
