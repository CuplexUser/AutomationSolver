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

## Packaging-machine expansion ✅ *shipped (first cut)* · ⏳ *full-machine rework planned*

A sixth category, `packaging`, modelled on the real "Laboration 7" carton packer, plus category
navigation on the puzzle list (`/puzzles/category/:category` + pill nav). What shipped this
round: the `packaging` process model (six double-acting pneumatic actuators `Y0`–`Y5`, each a
0→1 extension driving its two end-of-travel sensors; conveyor box-presence sensors `X14`–`X17`),
four puzzles of increasing difficulty (`pack-basics` → `pack-interlock` → `pack-sequence` →
`pack-batch`), a **procedural** `PackMachine3D` scene (three.js primitives, no glTF — the machine
is parametric boxes and rods), and the surrounding nav/routing. Also added this round outside
packaging: `run-on-timer`, `flasher`, `two-hand-press` (+ `press` process), and
`cabinet-two-station`.

**Known gap — the capstone does not yet drive the real machine.** `pack-batch` invents a
seventh output, a `Y6` "Batch Done" lamp, and only exercises `Y0`/`Y5`. The real machine has
**exactly six outputs** (`Y0` 2-pack, `Y1` 4-pack, `Y2` lift, `Y3` 16-pack-1, `Y4` 16-pack-2,
`Y5` back-stop) and no "batch done" line. The full-machine rework:

1. **Rebuild the capstone as `pack-full`** — a one-shot automatic cycle that sequences **all six
   actuators** in a believable packing order (back-stop forward → 2-pack out/retract → 4-pack
   out/retract → lift up → 16-pack-1 out/retract → 16-pack-2 out/retract → lift down → back-stop
   back), a one-hot step sequencer (`M0..M11`) with SET/RST transitions gated on each stage's end
   sensor, latched `Y5`/`Y2` (held across their sub-steps) and momentary `Y0`/`Y1`/`Y3`/`Y4`.
   ~32 rungs — precedent exists (`elevator-full` ≈ 29). Author the canonical in `grade.test.ts`
   via a `packFullCycle()` helper (like `dispatchCore()`), with scenario samples taken at
   mid-step midpoints (travel times: 2/4/16-pack 600 ms, lift 900 ms, back-stop 300 ms) so the
   asserts stay off the step boundaries.
2. **Drop the synthetic `Y6`.** Completion/idle is machine state (all sensors home), not an
   output; if a cue is wanted, use an internal `M` relay, never a fabricated `Y`.
3. **Model the two feed conveyors properly.** Promote `X14`–`X17` from scenario/HMI toggles to
   real belt dynamics in the process (cartons index onto the near/far bands and are consumed),
   so a puzzle can genuinely react to box flow instead of a hand-held toggle.
4. **Broaden the mid-tier puzzles** so `Y1`/`Y3`/`Y4` each get a dedicated exercise before the
   capstone (right now only `Y0`/`Y2`/`Y5` appear pre-capstone).
5. **Optional: a Blender hero model.** The procedural scene is deliberately swappable — the
   process model already exposes every actuator's extension — so a `pack-machine.glb` could
   replace `PackMachine3D` later without touching puzzle logic, matching the drill/elevator look.

## Phase 3 — Content depth

With replay and traces in place, harder content becomes fair rather than frustrating.

1. **Instruction set growth**, in dependency order: `MOV` and data registers (`D`), compare
   contacts (`=`, `>`, `<`), then off-delay and retentive timers. Each one needs: engine support,
   validator support, an editor glyph, and at least one puzzle that *requires* it.
2. **More process models** — traffic light, mixing tank, pick-and-place, palletizer. Each new
   `ProcessModel` is a small state machine; the 3D `Box3` renderer already accepts arbitrary
   scenes, so a new machine view is a `drillBoxes()`-style function, not new infrastructure.
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
