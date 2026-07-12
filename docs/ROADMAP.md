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
- Ladder zoom (60–140%).
- Two hard puzzles with real machine dynamics (`drill-station`, `elevator-auto-return`), a
  drag-to-rotate 3D machine view for the drill, and a 2D shaft view for the elevator.
- Favicon and app identity.

**Done means:** an 8-rung program with branches is comfortable to build and read on a laptop screen.

---

## Phase 2 — Learning curve and feedback *(next)*

The engine is trustworthy; the weakest link is now the moment a player is stuck and doesn't know why.

1. **Per-scenario replay.** When a submission fails, replay the failing scenario in the client
   with the rung highlighting live, scrubbing the exact timeline the grader used. The trace is
   already deterministic — this is presentation, not new simulation.
2. **A timing/trace view.** A simple logic-analyzer strip under the ladder showing X/Y/M/T bits
   over the last few seconds of scans. This is the single highest-value debugging aid for
   sequence puzzles.
3. **Progressive hints.** Hints exist but are all-or-nothing; reveal them one at a time.
4. **Puzzle-map progression.** Gate later puzzles behind earlier ones and show the path.

**Done means:** a player who fails a hard puzzle can see *when* their program diverged, not just
*that* it did.

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
