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
- **`PuzzleSpec`** (`types.ts`) — a discriminated union on `kind`:
  - **`LadderPuzzleSpec`** (`kind: 'ladder'`) — briefing, hints, `devices` (the physical I/O),
    optional `registers` (internal M/T/C the puzzle expects, surfaced as an IO list),
    `allowedInstructions`, `maxRungs`, a `processId`, and graded `scenarios`.
  - **`CabinetPuzzleSpec`** (`kind: 'cabinet'`) — same base (devices/scenarios/briefing) but a
    fixed `cabinet` component layout instead of ladder fields; the player's "program" is a
    `WiringDoc` (see §3b).
  - Every spec also carries a **`category`** (`basics` / `timers-counters` / `stations` /
    `elevator` / `control-cabinet` / `packaging`) — the unit of unlock progression and list
    grouping (`CATEGORY_ORDER` / `CATEGORY_TITLES` / `CATEGORY_BLURBS` in `types.ts`).
- **Process models** (`processes/`) — small state machines that react to `Y` outputs and drive
  `X` inputs. Registered via `registerProcess`.
  - `passthrough` — no machine dynamics; the HMI *is* the process.
  - `conveyor` — moves a part and derives a position sensor.
  - `drill` — clamp travel, drill feed depth, spindle/beacon/done state; derives `X2` (clamped)
    and `X3` (at bottom).
  - `press` — a single ram (`Y0`) that advances/retracts; derives `X3` (at bottom). Backs the
    two-hand safety press.
  - `packaging` — the two-lane box packer, mirroring the Blender-designed machine
    (`pack-machine.glb`): a continuously running feed belt that starts **empty** (two lanes of
    staggered boxes advancing to an end stop; sensors `X14`–`X17` derived from the modelled
    lanes) plus six double-acting pneumatic actuators (`Y0`–`Y5`), each a 0→1 extension driving
    its two end-of-travel sensors (`Y0`→`X0`/`X1`, `Y2` lift→`X4`/`X5`, `Y5`
    bracket→`X12`/`X13`, …). Product genuinely moves: 2-pack strokes stage pairs into the
    section-2 file (two steps = a 4-pack), the 4-pack stroke loads the flipper tray, the lift
    **flips** its load over the wall into section 3 where the cartons stand on end (four flips
    = 16), 16-pack-1 slides the block into section 4, 16-pack-2 pushes it onto the out-feed
    belt (`ship` animates the cosmetic transit). The `Y5` **retaining bracket** is the
    counter-hold backing the tippy on-end stack: flips landing without it forward tip the
    stack, and the 16-pack-1 plate sweeps across its line so it must be back before that push
    — both enforced only when the puzzle wires `Y5` (elevator5-style feature detect; other
    puzzles have it parked forward mechanically). A pusher picks its boxes up when it leaves
    home and only delivers on a **completed** stroke; wrong moves (lone box, over-fill,
    raised/occupied lift, bracket misplaced, aborted stroke) latch a `jam` flag that
    scenarios assert stays false. Address convention is fixed across all packaging puzzles
    (mirrors the real Laboration-7 I/O list).
  - `elevator` — continuous car position across 3 floors; derives the floor sensors `X3`/`X4`/`X5`.
  - `elevator5` — the same continuous-position idea generalized to 5 floors with per-floor call
    buttons (`X0`–`X4`), floor sensors (`X10`–`X14`), and an optional door (feature-detected by
    the mere presence of a `Y2` device in the puzzle's `devices`, e.g.
    `devices.some(d => d.address === 'Y2')` — puzzles without a door omit `Y2` entirely and the
    model just holds `door` fully open). Floor-to-floor travel is `900ms` — deliberately the
    smallest value divisible by both the client's live scan interval (`DT=60ms`,
    `useSimRunner.ts`) and the server's grading interval (`GRADE_DT=50ms`, `grade.ts`) — so a
    same-scan stop lands `pos` exactly on the integer floor under both cadences, unlike the
    legacy `elevator` model (`floorMs=1000`) which only ever needs to land on the two floors its
    `Math.min`/`Math.max` clamp already guarantees. The door interlock (`Y0`/`Y1` are ignored
    while the door isn't confirmed closed) is enforced **physically in the process model**, not
    just graded — an incorrect program sees the car visibly refuse to move rather than failing a
    hidden assertion after the fact.
- **Validator** (`validate.ts`) — structural checks: instruction allow-list, device kind/role
  match, presets present, every rung drives an output.
- **Grader** (`grade.ts`) — runs each scenario's scripted input timeline through `SimEngine` +
  the process model and checks the `expect` assertions. `grade.test.ts` holds a canonical
  solution for **every shipped puzzle** — that test is the guardrail against authoring an
  impossible puzzle.
  - `traceScenario()` re-runs one named scenario capturing a scan-by-scan `ScenarioTrace`
    (bits, rung eval results, machine state per scan, plus per-step pass/fail with a
    `startSample` index). It shares its scan loop with `gradeProgram()` (`simulateScenario()`,
    capture on/off) so the two can never disagree. Deterministic and side-effect-free like
    `gradeProgram`, so the **client calls it directly** — no server round trip — to power replay.

### 3b. Control-cabinet circuit domain — `shared/src/circuit/`
The second puzzle genre: instead of ladder logic the player wires terminals of fixed components
(3-phase supply, contactors, thermal overload, pushbuttons, lamps, 3-phase motor). Pure
deterministic TS under the same lint bans as the rest of `shared`.
- **`types.ts`** — component/terminal registry (`terminalsOf`). Terminal ids (`"K1.A1"`,
  `"F1.96"`, IEC numbering) are a **persistence API**: saved slots embed them, so the names are
  frozen once shipped.
- **`solver.ts`** — `CabinetSim`, the cabinet counterpart of `SimEngine`. Nets via
  disjoint-set union (wires + closed internal contacts; loads never merge nets); one supply
  potential per net; ≥2 potentials on a net = short circuit → breaker trips, everything
  de-energizes, fault reported. Contactor coils are the sequential state; each `step()` iterates
  to a fixpoint (max 8) — non-convergence (contact chatter) forces all coils off with an
  "unstable" fault. Motor runs on 3 distinct phases; direction from permutation parity
  (even = fwd, transposition = rev).
- **`validateWiring.ts` / `gradeWiring.ts`** — the cabinet counterparts of
  `validateProgram`/`gradeProgram`, returning the same `ValidationResult`/`GradeResult` shapes so
  the client ResultsCard renders both kinds identically. Any electrical fault during a graded
  step fails that step. `gradeCabinet.test.ts` holds canonical wirings for every shipped cabinet
  puzzle — the same solvability guardrail as `grade.test.ts`.
- **`schematic.ts`** — the diagram-side representation: each component type breaks into
  distributed IEC parts (a contactor = 3-pole `main` + `coil` + `aux13`/`aux21`), each part
  carrying a subset of the component's terminals at symbol-local offsets. Puzzles author where
  each part sits on the diagram sheet via `CabinetLayout.schematic`; `schematic.test.ts`
  enforces that every terminal belongs to exactly one part and every part of every shipped
  cabinet puzzle has exactly one placement (no terminal is unreachable in the schematic view).

### 4. Puzzle content — `shared/src/puzzle/content/`

| # | Slug | Difficulty | Teaches | Process |
|---|------|-----------|---------|---------|
| 1 | `direct-control` | tutorial | contact → coil | passthrough |
| 2 | `seal-in` | easy | latching / seal-in branch | passthrough |
| 3 | `estop` | easy | normally-closed safety wiring | passthrough |
| 4 | `delayed-start` | medium | on-delay timer + run latch | passthrough |
| 5 | `batch-counter` | medium | counter with reset | passthrough |
| 6 | `run-on-timer` | medium | off-delay built from an on-delay timer (fan run-on) | passthrough |
| 7 | `flasher` | hard | two-timer oscillator, symmetric blink | passthrough |
| 8 | `conveyor-stop` | medium | reacting to a machine-driven sensor | conveyor |
| 9 | `drill-station` | hard | multi-step sequence, SET/RST, beacon | drill |
| 10 | `two-hand-press` | medium | two-hand safety AND-gate, anti-repeat latch | press |
| 11 | `elevator-auto-return` | hard | timed auto-return, cancelable descent | elevator |
| 12 | `elevator-5-dispatch` | hard | multi-floor call dispatch, up/down latch + tie-break | elevator5 |
| 13 | `elevator-doors` | hard | rising-edge door trigger, dwell timer, physical move interlock | elevator5 |
| 14 | `elevator-full` | hard | capstone: dispatch + doors + idle auto-return timer | elevator5 |
| 15 | `cabinet-lamp` | tutorial | first wiring: button + lamp control circuit | (cabinet) |
| 16 | `cabinet-dol` | medium | DOL 400V starter: contactor, overload, seal-in | (cabinet) |
| 17 | `cabinet-two-station` | medium | control from two stations: parallel starts, series stops | (cabinet) |
| 18 | `cabinet-reversing` | hard | two interlocked contactors, phase-swap reversal | (cabinet) |
| 19 | `cabinet-indication` | medium | pilot lights: run lamp across the coil, trip lamp on the overload 97-98 aux | (cabinet) |
| 20 | `cabinet-reversing-protected` | hard | capstone: reversing + overload + e-stop + fwd/rev/trip lamps | (cabinet) |
| 21 | `pack-basics` | easy | match a pair on the two lanes, seal one full push stroke | packaging |
| 22 | `pack-group` | medium | count two pair-strokes (C0), load the staged 4-pack onto the lift | packaging |
| 23 | `pack-lift` | hard | latch the flip cycle: lift up on load, release at the top | packaging |
| 24 | `pack-full` | hard | capstone: count four flips, then ship the 16-pack via a one-hot step chain | packaging |

Categories: 1–3 `basics`, 4–7 `timers-counters`, 8–10 `stations`, 11–14 `elevator`,
15–20 `control-cabinet`, 21–24 `packaging`.

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
- **Cabinet editor** (`features/cabinet/`) — the play surface for `kind: 'cabinet'` puzzles,
  lazy-loaded into its own chunk from `PuzzlePlayPage` (which dispatches on `spec.kind`;
  `pages/play/LadderPlay.tsx` is the ladder branch, `CabinetPlay.tsx` the cabinet one, both
  sharing `pages/play/BriefColumn.tsx`). **Two editable views of the same `WiringDoc`**, toggled
  by tabs in `CabinetEditor.tsx` (choice persisted in `localStorage['as-cabinet-view']`):
  - **⚡ Schematic** (`SchematicView.tsx`) — an IEC circuit diagram on white drawing paper
    (theme-independent, like a print): supply rails span the sheet, components render as their
    distributed parts from `shared/circuit/schematic.ts` with `-K1` cross-references, wires run
    as Manhattan paths.
  - **🔧 Panel** (`PanelView.tsx`) — an illustrated cabinet: enclosure + mounting plate, DIN
    rails and slotted wire ducts derived from component rows (no extra schema), door strip with
    real operators (green I / red O buttons, glowing lamp lens), finned motor with spinning-fan
    run cue. Panel-to-panel wires route orthogonally through the ducts (per-wire lane offsets,
    left spine duct for row crossings); wires to the door exit via the spine and hang as a loose
    harness; motor cables stay bezier.
  - Shared machinery: `useWiringGestures.ts` (drag or click-click wiring, `data-terminal` hit
    test, Esc/Delete keys), `WiresLayer.tsx` (wire + hit paths, pending rubber band, ✕ delete
    control, per-view color palettes), `usePanZoom.tsx` (wheel zoom toward the cursor,
    drag-to-pan when zoomed, corner +/−/fit buttons).
  Double-click a wire to remove it (Esc cancels, Delete removes the selected wire). Wires and
  terminals color by live net potential (IEC-ish: L1 brown, L2 black, L3 grey, N blue,
  PE green-yellow) via `useCabinetSim`, which drives the shared `CabinetSim` exactly like
  `useSimRunner` drives `SimEngine`. Wiring state in Zustand (`cabinetStore.ts` — wire ids are
  generated client-side because `shared` is banned from non-determinism).
- **Sim runner + HMI** (`features/sim/`) — run / step / reset; live rung highlighting; an
  interactive operator panel of push buttons, toggles, e-stops, lamps and motors bound to X/Y.
  `HmiPanel` renders from the narrow **`HmiRunner`** contract, which both the ladder `SimRunner`
  and the cabinet runner implement, with the machine visualization injected as a `machineSlot` —
  so the same operator panel serves both puzzle kinds. Digit keys **1–9** drive the pressable
  inputs in panel order (hold = momentary, tap = toggle/e-stop; sensors get no key) so multiple
  buttons can be held at once — required by Two-Hand Press's simultaneous palm buttons.
  - **`SimRunner` is the shared contract** (`{running, inputs, bits, machine, evalResults,
    history, start/stop/step/reset/setInput}`) that `LadderEditor`, `HmiPanel` and `MachineView`
    all render from — they don't know or care whether it's backed by a live `useSimRunner` engine
    or a scripted replay, since `editable = !running` already makes `running: true` a read-only
    signal for free.
  - **Replay** (`useReplay.ts`, `ReplayBar.tsx`) — calls `traceScenario()` on the program that was
    just submitted and exposes the trace through a read-only `SimRunner` adapter, scrubbed by
    scan index; play/pause, jump-to-first-failure, and a close button that hands control back to
    the live runner. Wired from a "▶ Replay" button on each failing scenario in the results card.
  - **Trace strip** (`TraceStrip.tsx`) — a logic-analyzer view (one row per device/register,
    filled where the bit is high) reading `SimRunner.history`; the live runner keeps a rolling
    ~24s window, replay supplies the full (already-bounded) scenario trace with a scrubbable
    cursor synced to the `ReplayBar`.
  - **Progressive hints** — `PuzzlePlayPage`'s `HintsPanel` reveals `spec.hints` one at a time;
    the reveal count is remembered per puzzle in `localStorage`.
- **Machine views** (`features/sim/MachineView.tsx`) — puzzle-specific 3D scenes chosen by
  `processId`. The view is a diagnostic instrument, not decoration: it never animates on its own —
  every transform is driven each frame straight from the deterministic `machine.*` state the
  process model computes from `dt` — and it carries a readout of the machine's actual state
  (clamp %, feed %, spindle; floor/direction/door for the elevator; section box counts and
  shipped packs for the packer, plus a jam tag). Every scene is **glTF-backed** (drill,
  elevator, packer) — hero models authored in Blender, loaded as `.glb` via `useGLTF`, driven
  by looking up named nodes. Best for detailed geometry; the cost is that node names are a
  load-bearing coupling and a typo silently no-ops.
  - **`PackMachine3D.tsx`** (`processId: 'packaging'`) — `pack-machine.glb`, exported from
    `PackMachine.blend`. The glb carries one node per moving part: five `*Carriage` empties
    (pusher plates + rods + L-gates), the `FlipperPivot` hinge, the `BracketCarriage`
    counter-hold, and a complete carton set (`BeltBox*`, `CarryBox*`, `Sec2Box_*`,
    `Carry4Box_*`, `LiftBox*`, `Sec3Box_c_r`, `Sec4Box_c_r`, `ShipBox_c_r`, `DoneBox_c_r`)
    whose positions/visibility are re-derived every frame as a pure function of `machine.*` —
    lane positions, section counts, carry flags and actuator extensions place everything, so
    the scene never animates on its own.
  - **`MachineCanvas.tsx`** — the shared `<Canvas>` + ambient/directional lights + optional
    `OrbitControls` rig both scenes render into, parameterized by camera position/fov/target/
    distance bounds/height. Three control modes: `interactive` (drag-to-rotate + scroll-to-zoom,
    the drill station's contract), `zoomable` (fixed camera angle, scroll still zooms — the
    elevator's contract, via `OrbitControls` with `enableRotate={false}`), or neither.
  - **`DrillStation3D.tsx`** (`interactive`) — `drill-station.glb`; named nodes
    (`scene.getObjectByName(...)`) looked up once and driven imperatively from `machine.clamp` /
    `machine.drill` / `machine.spinning` / `machine.push`.
  - **`ElevatorShaft3D.tsx`** (`zoomable`, fixed angle) — one shared `elevator-shaft.glb` (a
    cylindrical cutaway shaft, one side open, terracotta frame rings + mullions, per-floor plaques)
    authored for the 5-floor case; the 3-floor legacy puzzle (`processId: 'elevator'`) hides the
    floor-4/5 slabs, arrival lights, frame rings, plaques and call-button knobs rather than
    maintaining a second model. Drives `Car.position.y` from `machine.pos`, the door leaves' local
    X from `machine.door` (only meaningful when the puzzle has a `Y2` device), and the hoist
    cable's scale/position from the car's height so it always spans ceiling-to-car-top. The
    fixed camera distance is derived from the served floor count so the whole shaft (plus one
    floor's headroom) fills the frame regardless of `floorCount`.
  - Both scenes share the same silent-failure risk: a node name typo in the `.glb` is a no-op, not
    an error — `scene.getObjectByName(...)` just returns `undefined` and that part of the scene
    stops animating.
- **Resizable workspace** (`features/layout/Resizable.tsx`) — the play view is a full-height
  three-column workbench. The brief and operator panels are drag-resizable (widths persisted to
  `localStorage`, arrow keys when the divider is focused, double-click to collapse) and
  collapsible from the toolbar, and each column scrolls independently so a long program never
  pushes the palette off screen.
- **Save slots** (`features/slots/`) — `useActiveSlot` resolves which of a puzzle's several named
  save slots is "active" (remembered per user in `user_settings.activeSlot`, falling back to the
  most-recently-updated slot) and loads its program; `SlotsPanel` lists/creates/renames/deletes
  slots. The editor waits for slot resolution before rendering interactively, so a fast typist
  can't have their first edits clobbered by the async slot load.
- **Puzzle list + category nav** (`pages/PuzzleListPage.tsx`) — grouped by category, each section
  headed with its `CATEGORY_BLURBS` line. A pill nav routes between an **All** view and a single
  category via `/puzzles/category/:category` (the route sits before `/puzzles/:slug` in `App.tsx`;
  React Router's specificity ranking, not order, keeps the two-segment category path from being
  read as a slug). Each pill shows that category's `solved/total` and lights green when complete.
- **Server state** via TanStack Query; auth context wraps the app.

### 6. Server — `packages/server/src/`
- **Auth** (`auth/`) — Passport local + Google + GitHub OAuth, `node:crypto` scrypt hashing,
  httpOnly session cookies backed by a custom `SqliteStore`.
- **Routes** (`routes/`) — puzzle list/detail, save slots, submit, progress, settings.
- **Submit flow** (`routes/puzzles.ts`) is two-phase and branches on `spec.kind`:
  `validateProgram()`+`gradeProgram()` for ladder, `validateWiring()`+`gradeWiring()` for
  cabinet (`parseProgramBody()` picks the matching zod schema). The server is the source of
  truth for scoring.
- **Puzzle-map locking** (`routes/puzzles.ts`) — `lockInfo()` runs one sequential chain **per
  category**: the first puzzle of each category is always unlocked; within a category a puzzle
  is locked unless its predecessor is solved (or the puzzle itself already is, so a historical
  solve is never un-solved by a neighbor). Enforced on `GET /puzzles/:slug` and
  `POST /puzzles/:slug/submit` (403), not just hidden in the UI — the puzzle list just annotates
  each item with `locked`/`requiresTitle`/`category` for display.
- **Save slots** — `solution_slots` (`db/index.ts`) replaces the old one-draft-per-puzzle
  `solutions` table (kept, unused, only so a returning player's old draft lazily migrates into
  "Slot 1" the first time `listSlots()` is called). `POST/GET/PUT/DELETE
  /puzzles/:slug/slots[/:id]` are full CRUD; submitting also saves into whichever slot is
  "active" per `user_settings.activeSlot`, creating a first slot if none exists yet, so a
  submission never loses work.
- **Persistence** — Node's builtin `node:sqlite`. Puzzles are referenced by `slug` only;
  content is never duplicated into the database.

### 7. Constraints that shape everything
- **Zero native dependencies.** `npm install` must work with no C++ toolchain. No
  better-sqlite3, argon2, bcrypt, sqlite3. See `CLAUDE.md` for the established substitutions.
- **Determinism.** Nothing in `shared` may read the clock, `Math.random()`, or the DOM. This is
  enforced, not just documented: `npm run lint` (ESLint 10, flat config in `eslint.config.js`)
  bans those globals inside `packages/shared`.
