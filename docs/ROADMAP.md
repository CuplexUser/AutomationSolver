# Development Plan

A gradual feature-set plan. Each phase is independently shippable, ends in a playable state,
and leaves the codebase healthy — no phase depends on a later one to make sense. Phases are
ordered so that the risky, load-bearing work (the engine) stays ahead of the work that depends
on it (content, then UI, then new puzzle families).

See [FEATURE-MAP.md](./FEATURE-MAP.md) for what already exists.

---

## Phase 0 — Foundation ✅ *shipped*

Monorepo, shared engine (rung solver + scan cycle), puzzle schema, validator, grader,
server with auth and authoritative grading, React client with the grid ladder editor and the
live HMI panel, and the first six puzzles.

**Done means:** a signed-in player can open a puzzle, build a rung program, run it live, submit
it, and see the server's per-scenario verdict — with the client's local sim agreeing with the
server's grade.

## Phase 1 — Complex programs, comfortably ✅ *shipped*

The editor and layout had to stop being the limiting factor before harder puzzles could be
authored.

- In-place address/preset editing of already-placed elements.
- Working-register (M/T/C) IO lists on puzzles that need them, not buried in the briefing prose.
- Full-height, resizable, collapsible three-column workspace with independently scrolling columns.
- Keyboard-first editing (arrows to move, a letter per instruction) and compact cells + zoom.
- Two hard puzzles with real machine dynamics (`drill-station`, `elevator-auto-return`), each
  with a Blender-authored 3D machine view: drag-to-rotate for the drill, a fixed camera (scroll
  still zooms) for the elevator shaft.
- ESLint 10 across the monorepo, including rules that enforce the engine's determinism.
- Favicon and app identity.

**Done means:** an 8-rung program with branches is comfortable to build and read on a laptop
screen, without reaching for the mouse.

---

## Phase 2 — Learning curve and feedback ✅ *shipped*

The engine is trustworthy; the weakest link was the moment a player got stuck and didn't know why.

1. **Per-scenario replay.** `traceScenario()` (`shared/src/puzzle/grade.ts`) re-runs one scenario
   capturing a scan-by-scan trace; the client calls it directly (no server round trip — the
   engine is deterministic) and a scrubbable `ReplayBar` drives the same `LadderEditor`/`HmiPanel`
   views the live sim uses, via a read-only `SimRunner` adapter.
2. **A timing/trace view.** `TraceStrip` — a logic-analyzer strip under the ladder showing X/Y/M/T
   bits over time — reads a rolling history from the live sim or the full replay trace through
   that same `SimRunner.history` field.
3. **Progressive hints.** Hints reveal one at a time, remembered per puzzle in `localStorage`.
4. **Puzzle-map progression.** The server gates each puzzle behind the previous one being solved
   (`lockInfo()` in `routes/puzzles.ts`, enforced on submit too, not just the UI) and the puzzle
   list shows locked cards with what unlocks them.
5. **Multiple save slots per puzzle** (added mid-phase, beyond the original scope): the single
   per-puzzle draft became a `solution_slots` table — players can save, load, rename, and delete
   several named attempts per puzzle, with the last-used slot remembered per user.

**Done means:** a player who fails a hard puzzle can see *when* their program diverged, not just
*that* it did.

## Elevator expansion ✅ *shipped* (ahead of the phased plan)

A side quest ahead of Phase 3's content push: the 3-floor `elevator` process model was joined by
`elevator5` (5 floors, per-floor call buttons, an optional door), three new hard puzzles of
increasing difficulty (`elevator-5-dispatch` → `elevator-doors` → `elevator-full`, the last one
"the fully functional 5-story elevator"), and a single shared Blender-authored `elevator-shaft.glb`
— a cylindrical, one-side-open cutaway — that both the legacy 3-floor puzzle and the three new
5-floor puzzles render (see FEATURE-MAP.md's Machine views section). All solvable with the
already-shipped instruction set — no `MOV`/compare needed.

## Packaging-machine expansion ✅ *shipped (full-machine rework done)*

A sixth category, `packaging`, modelled on the real "Laboration 7" box packer, plus category
navigation on the puzzle list (`/puzzles/category/:category` + pill nav). Also added alongside
the first cut, outside packaging: `run-on-timer`, `flasher`, `two-hand-press` (+ `press`
process), and `cabinet-two-station`.

**The machine is now the real product line, not six abstract cylinders.** The `packaging`
process models the actual flow: a feed belt with **two lanes of boxes** advancing to an end stop
(`X20` belt run; `X14`–`X17` derived from the modelled lanes, no longer HMI toggles), and six
actuators that genuinely move product — 2-pack strokes (`Y0`) stage pairs into section 2 in two
steps, the 4-pack stroke (`Y1`) loads the lift, the lift (`Y2`) **flips** its 4-pack over into
section 3, four flips build the 16-pack, 16-pack-1 (`Y3`) pushes it into section 4 against the
forward back-stop (`Y5`), and 16-pack-2 (`Y4`) ships it to the finished station once the stop
releases. Pushers pick boxes up when they leave home and deliver only on a completed stroke;
wrong moves (lone box, over-fill, raised/occupied lift, misplaced back-stop, aborted stroke)
latch a `jam` flag every scenario asserts stays false. The lift's rise is physically interlocked
on the 4-pack rod being home, like the elevator door.

The four puzzles teach the line stage by stage, each building on the last: `pack-basics` (seal
one full stroke per matched pair) → `pack-group` (count strokes on `C0`, load the lift) →
`pack-lift` (latch the flip cycle) → `pack-full` (count flips on `C1`, ship via a one-hot
`M1..M6` step chain). Canonicals live in `grade.test.ts` as composable helpers
(`packFrontEnd()` / `packFlip()` / `packShip()`), timings verified against a probe run, plus a
discriminating negative test (a latched 2-pack pusher blocks the lanes and starves the line).
`PackMachine3D` renders the whole line procedurally — belts, gantry pusher, flipper, back-stop,
out-feed, and every individual box straight from machine state.

Remaining ideas:

1. **Optional: a Blender hero model.** The procedural scene is deliberately swappable — the
   process model already exposes every actuator's extension and all box positions — so a
   `pack-machine.glb` could replace `PackMachine3D` later without touching puzzle logic.
2. **Optional: jam-recovery play.** `jam` currently latches forever; a reset input (or HMI
   button) plus scenarios that recover from a provoked jam could make a fifth puzzle.

## Pick-and-place expansion ✅ *shipped* (ahead of the phased plan)

A seventh category, `pick-place`: a robot arm swings between an infeed and up to 4 tray slots,
extending/retracting to reach and gripping/releasing to transfer parts — reusing two proven
techniques rather than inventing new engine mechanics: `drill`'s independent travel-fraction
actuators for the reach/gripper axes, and `elevator5`'s exact-common-multiple swing timing
(`600ms`/station) so a multi-slot sweep can detect an already-full slot in passing without
stopping there. Four puzzles teach it stage by stage: `pick-place-cycle` (one transfer to a
single pad, park instead of overfilling) → `pick-place-tray` (generalize to 4 pads, an
elevator5-style sweep that sails past occupied pads, `Y4` lamp from the machine's `X18` Tray
Full sensor) → `pick-place-supply` (a feature-detected finite infeed sensor `X13` + a
supply-wait lamp) → `pick-place-full` (capstone: a two-tray production order — operator unloads
via `X20`→`Y5`, completed trays counted on `C0`, `Y7` order-complete lamp, picks blocked once
the order closes). No new ladder instructions were needed, continuing the precedent `elevator5`
and `packaging` set. Ships with a Blender-authored `pick-place-arm.glb` (source:
`D:\Code\Claude\Design\PickPlaceArm.blend`) — a FANUC-style articulated arm (base turret,
shoulder/elbow links driven by two-link IK in the client, counter-pitching wrist, two-finger
gripper) over floor-level pads, an infeed conveyor, a signal mast and warning-tape dressing —
following the same node-name contract as the elevator shaft and pack machine.

## Phase 3 — Content depth

With replay and traces in place, harder content becomes fair rather than frustrating.

1. **Instruction set growth**, in dependency order: `MOV` and data registers (`D`), compare
   contacts (`=`, `>`, `<`), then off-delay and retentive timers. Each one needs: engine support,
   validator support, an editor glyph, and at least one puzzle that *requires* it.
2. **More process models** — traffic light, mixing tank, palletizer (pick-and-place already
   shipped, see above). Each new `ProcessModel` is a small state machine; the 3D `Box3` renderer
   already accepts arbitrary scenes, so a new machine view is a `drillBoxes()`-style function, not
   new infrastructure.
3. **Fault-injection scenarios** — an overload trips mid-cycle, a sensor sticks. Tests whether a
   program is *robust*, not merely correct on the happy path.

**Done means:** ~20 puzzles spanning tutorial → expert, each shipping with a canonical solution
in `grade.test.ts`.

## Phase 4 — Craft and competition

Once solving is solid, reward solving *well*.

1. **Scoring beyond pass/fail** — rung count, instruction count, scan-time efficiency.
2. **Leaderboards** per puzzle on those metrics.
3. **Solution sharing** — read-only permalinks to a program.
4. **Daily/weekly challenge** — one rotating puzzle.

## Phase 5 — The second puzzle family: control-cabinet wiring

The long-deferred idea from the original plan, and the reason `shared/puzzle` was abstracted
behind process models in the first place.

Players place contactors, overloads, relays and push buttons on a DIN rail and wire an AC
motor-control circuit (DOL start, star-delta, forward/reverse with interlock). The **process
model and scenario/grading machinery are reusable as-is**; what is new is a second *program*
representation (a netlist instead of a rung grid) and a second solver (continuity/coil
energization instead of rung power flow).

Sequenced as: netlist model → continuity solver + tests → wiring canvas → 3–4 wiring puzzles →
puzzle-type routing in the client and the submit endpoint.

**Done means:** `PuzzleSpec` carries a `kind` (`ladder` | `wiring`), the server grades both, and
the puzzle list mixes them.

---

## Ground rules for every phase

- **The engine is the crown jewels.** Any change in `shared/src/sim/` lands with unit tests
  first. Nothing there may read the clock, `Math.random()`, or the DOM.
- **Every new puzzle ships with a canonical solution in `grade.test.ts`.** That test is the only
  thing standing between the player and an impossible puzzle.
- **Zero native dependencies, permanently.** `npm install` must work with no C++ toolchain.
- **The server stays the source of truth for scoring.** The client sim is for feedback, never
  for grades.
