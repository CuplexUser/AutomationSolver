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
  vertical-link toggles, add/remove rungs, rows and columns. Editor state in Zustand.
  - **In-place editing** — select a placed element and retype its address or preset.
  - **Keyboard-first** — arrows move the selection (wrapping across rungs), a single letter
    places an instruction (`C` NO, `X` NC, `P`/`N` edge, `O`/`S`/`R` coils, `T`/`K`, `W` wire),
    `B` toggles a branch, `A` adds a rung, `Shift`+`→`/`↓` grows the rung, `Del` clears.
    The palette shows each key; the full list is under "Shortcuts".
  - **Density and zoom** — compact 72×52 cells, plus a 50–200% zoom (`Ctrl` +/−/0, or **Fit**,
    which sizes the program to the window — a two-rung tutorial scales up, an eight-rung sequence
    scales down). The zoom is remembered per puzzle, so the density suits the exercise.
- **Sim runner + HMI** (`features/sim/`) — run / step / reset; live rung highlighting; an
  interactive operator panel of push buttons, toggles, e-stops, lamps and motors bound to X/Y.
- **Machine views** (`features/sim/MachineView.tsx`) — puzzle-specific scenes chosen by
  `processId`. The drill station gets a 3D scene, the elevator a 2D shaft view; puzzles without a
  bespoke scene render none. The view is a diagnostic instrument, not decoration: it never
  animates on its own, and it carries a readout of the machine's actual state (clamp %, feed %,
  spindle).
  - `Machine3D.tsx` is a dependency-free SVG renderer for axis-aligned boxes: back-face culling
    plus an **exact painter's ordering** — for two boxes separated along any world axis, the plane
    between them is a separating plane and the box on the camera's side can never be occluded.
    (Ordering by centroid depth instead is what made parts vanish as the machine rotated: the flat
    machine bed's centroid can be nearer than a part standing on it but behind it in z.) Drag to
    rotate, scroll to zoom.
    - Each face's geometry **and** its outward normal are derived from an `(axis, side)` pair, so
      they cannot disagree. Hand-written corner lists and normals can, and when they did, the
      culler hid every +z/−z face until the machine was rotated 180°.
- **Resizable workspace** (`features/layout/Resizable.tsx`) — the play view is a full-height
  three-column workbench. The brief and operator panels are drag-resizable (widths persisted to
  `localStorage`, arrow keys when the divider is focused, double-click to collapse) and
  collapsible from the toolbar, and each column scrolls independently so a long program never
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
- **Determinism.** Nothing in `shared` may read the clock, `Math.random()`, or the DOM. This is
  enforced, not just documented: `npm run lint` (ESLint 10, flat config in `eslint.config.js`)
  bans those globals inside `packages/shared`.
