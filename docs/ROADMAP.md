# Development Plan — the historical record

> **This is no longer a plan and no longer a queue.** [`TODO.md`](../TODO.md) at the repo root is
> the only work list. What follows is the account of how each phase actually landed, kept because
> the *reasoning* is worth having and because several phases record findings that cut against
> their own original intent. Where a section below ends with "still to come", check `TODO.md`:
> some of it shipped, some of it is a box there, and some of it was dropped on purpose.

A gradual feature-set plan. Each phase was independently shippable, ended in a playable state,
and left the codebase healthy — no phase depended on a later one to make sense. Phases were
ordered so that the risky, load-bearing work (the engine) stayed ahead of the work that depends
on it (content, then UI, then new puzzle families).

See [FEATURE-MAP.md](./FEATURE-MAP.md) for what already exists, and [FACTORY.md](./FACTORY.md) for the excavator plant, which is deep enough to have its own document.

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

## Drill-station expansion ✅ *shipped* (ahead of the phased plan)

An eighth category, `drill`, which promotes the one-off `drill-station` puzzle into a four-step
ramp on the machine the `drill-station.glb` hero model already showed:
`drill-clamp-feed` (seal one stroke in, feed only once `X2` Clamped confirms) →
`drill-station` (the existing full stroke: beacon, done lamp, eject — moved here from `stations`,
slug untouched so saved slots and progress survive) → `drill-spindle` (the spindle motor `Y5`
becomes the player's, with an `X7` at-speed interlock, a 1.0 s dwell at full depth on `T0`, and
the rotation stopped again between parts) → `drill-production` (capstone: mixed stock — an
inductive `X6` reads hardened steel that must be diverted undrilled through the `Y6` reject gate
while aluminium is drilled and shipped, with `C0` counting finished holes to close a batch of
three and park the station).

The `drill` process model grew from three travel fractions into the whole machine, all
**feature-detected off the puzzle's own device list** (the `elevator5`/`pickPlace` precedent) so
the two easy puzzles still see exactly the machine they saw before: `Y5` adds a spin-up/coast
spindle and the feed interlocks, `X5` adds work pieces that physically arrive, are drilled by a
*dwell* rather than by touching the bottom, and are counted good/scrap/bad as they leave, `X6`
adds the deterministic aluminium/steel stock sequence, `Y6` adds the diverter. Crashing the bit
(feeding unclamped, not up to speed, or into steel) latches the packaging-style `jam`; shoving a
still-clamped part is interlocked mechanically instead, so a one-scan release overlap isn't
punished. Six discriminating negative tests in `grade.test.ts` cover the mistakes the ramp is
about: feeding before the clamp, feeding before at-speed, retracting instead of dwelling, leaving
the spindle turning between parts, counting ejects instead of holes, and drilling steel. No new
ladder instructions were needed — the fourth category in a row to need none.

## Process-control expansion ✅ *shipped* (ahead of the phased plan)

A ninth category, `process-control`, and the first time anything in the game is a **continuous
value** rather than a bit. This is Phase 3's "instruction set growth" delivered in the shape the
content wanted: not `MOV` for its own sake, but analog signals, regulators, and a way to grade
how *well* a value is held.

Three layers, each shippable on its own:

1. **Analog in the engine.** `D` data registers as 16-bit signed integers that saturate rather
   than wrap — integers precisely because the arithmetic is then bit-exact on every platform,
   keeping the client/server agreement absolute rather than merely likely. Four word
   instructions (`compare`, `mov`, `math`, `pid`) carrying their sources in `operands`. The
   prerequisite that made any of it safe: **the client's live scan dt is now `GRADE_DT`**, since
   booleans tolerated the old 60/50 mismatch only because every process model's timings were
   exact multiples of both, and an integrator does not.
2. **Analog in the plant and the UI.** `ProcessStepCtx` gained `registers` in and
   `derivedRegisters` out (purely additive — every existing model compiled untouched); devices
   gained `signal: 'analog'` and a raw-count `range`; the HMI gained a gauge/bar/trend strip, and
   the trend redraws under replay scrubbing because history now carries the register image.
3. **Grading a regulator.** A `control` spec evaluated across a whole step (band, settle time,
   overshoot and steady-error caps) rather than at its final instant, and `parIae` spending the
   existing 15 performance marks on the error integral instead of on cycle time. No change to
   the scoring model: same weight, same taper, same "correct but mediocre still unlocks what
   follows" property.

The `tank` plant integrates on a fixed 10 ms sub-step with a carried remainder, so its
trajectory is identical at any `dt`, and its constants are pinned so level counts equal valve
counts at rest with a 4 s time constant — which is what leaves P control a visible,
load-dependent droop to teach against.

Five puzzles walk the ramp: `tank-level-readout` (scale raw counts, alarm off compare contacts)
→ `tank-two-position` (hysteresis, and watch the valve slam) → `tank-p-control` (a P regulator
**hand-built** from SUB/MUL/ADD with a whole-number gain, so the block that comes next replaces
something the player has felt) → `tank-pid` (integral kills the offset; anti-windup keeps the
long fill from sailing past setpoint) → `tank-auto` (capstone: two recipe setpoints, hand mode,
and a high-level trip latching over both). Three discriminating negative tests cover the
plausible wrong answers the ramp is about: an open-loop valve position that only fails once the
load moves, a P-only block that holds steadily at the wrong number, and a trip that follows the
float instead of latching on it.

## Phase 3 — Content depth

With replay and traces in place, harder content becomes fair rather than frustrating.

1. ~~**Instruction set growth**: `MOV` and data registers (`D`), compare contacts~~ — shipped
   with the process-control expansion above, along with arithmetic and a `PID` block. Still
   outstanding: **off-delay and retentive timers**. Each needs engine support, validator
   support, an editor glyph, and at least one puzzle that *requires* it.
2. **More process models** — traffic light, palletizer (pick-and-place and the level-controlled
   vessel have both shipped, see above). Each new `ProcessModel` is a small state machine.
3. **Fault-injection scenarios** — an overload trips mid-cycle, a sensor sticks. Tests whether a
   program is *robust*, not merely correct on the happy path.

**Done means:** ~20 puzzles spanning tutorial → expert, each shipping with a canonical solution
in `grade.test.ts`.

## Motion — shipped

The second half of the analog plan's first item: a traverse axis with real dynamics, and the
first plant where the *rate of change* is what the program commands rather than the value.

`processes/axis.ts` integrates position and velocity in milli-counts on the same fixed 10 ms
sub-step the tank uses. The program writes a speed reference and a direction; the drive ramps
toward it at whatever **drive parameter registers** `D40`/`D41` currently say. Both facts that
follow are the category: a speed reference is not a position, so stopping somewhere means seeing
the target coming; and the ramp rates belong to the *cycle*, not to commissioning, because what a
motor and a set of forks can survive halves with a pallet on board.

Four puzzles walk it: `axis-jog` (commission the drive — it will not start with a ramp parameter
at zero — then jog to both limits without hitting one) → `axis-profile` (signed distance-to-go,
rapid, and an approach that has to start well before the target) → `axis-loaded` (**the** puzzle:
two ramp tables swapped in flight off the load sensor, *and* the stopping distance they imply,
which is the number people forget) → `axis-crane` (hoist plus traverse for an ASRS put-away, with
a load on a rope that is still swinging seconds after the trolley has stopped).

Two details worth keeping. The crane is handed the sway **amplitude**, not the instantaneous
angle: a pendulum passes through vertical four times a second, so an interlock on the angle would
go true exactly when the load is moving fastest. And because the sway is a real pendulum, a ramp
lasting about one swing period cancels its own excitation — so the fastest legal ramp is not the
fastest cycle, and `parMs` quietly rewards anyone who notices. Six negative tests in
`grade.test.ts` cover the plausible wrong answers, including the subtle one: swapping the two
ramp parameters but keeping the empty slow-down distance leaves the drive perfectly happy and
puts the pallet into the rack face.

## Automated warehouse — shipped

A tenth category, `warehouse`, and the first machine in the game that is not a sequence. One
stacker crane serves a rack of 4 bays x 2 levels, two production lines call for material from
opposite ends of the aisle, and goods in keeps pushing pallets at all of it. The correct program
is a **scheduler**, which nothing before this needed.

Four things are new, and none of them needed an engine change:

1. **Concurrent, asynchronous demand on a shared machine.** Three requesters, one crane. A cycle
   has to be committed to one of them and held there, because a call can drop mid-aisle.
2. **Chaotic storage.** Materials are scattered and the WMS publishes the whole slot table, so
   "which slot" is a search-and-minimize, not a lookup — and because the two lines are at
   opposite ends, *the nearest slot for a material depends on who asked for it*. Distance from
   line A is the bay number, from line B it is `5 - bay`.
3. **Two failure latches beside `jam`.** `starved` (a line ran its conveyor empty) and `blocked`
   (goods in backed up) are caused by the schedule rather than by a move, and they are what turn
   "be fair to both lines" from a rule the grader checks into a consequence the machine reports.
   Both assert through the existing `expectMachine` path, so `grade.ts` was untouched.
4. **A latched encoder.** `D0`/`D1` hold the last position sensor the crane passed rather than
   the nearest one rounded, which makes `[= D0 D50]` mean "arrived" and collapses driving
   anywhere in the aisle into a two-rung move block — deliberately, so the rung budget goes on
   deciding rather than on driving.

Six puzzles walk it: `asrs-drive` (commissioning, under a test panel) → `asrs-put-away` (the
same job with the panel replaced by a step chain) → `asrs-retrieval` (search the table for a
demanded material and keep a line fed) → `asrs-two-lines` (two stations, so the search needs a
real distance rather than rung order, and a cycle needs a latch) → `asrs-replenish` (a second job
running the opposite way, with a bounded inbound backlog) → `asrs-dual-cycle` (capstone: all
three demands, trips planned as a list of stops, a shift-end stop switch, and dual-command
cycling). `maxRungs` ramps 8 → 50, which also lifted the server's transport ceiling from 32.

**The on-ramp was rebuilt after the fact**, because the category opened by asking for four
unfamiliar things at once: the move block, the arrival comparison, a one-hot step chain and the
latched fork stroke, with a twenty-row terminal assignment beside it. The split is along the
operator: `asrs-drive` wires only the aisle half of the crane, hands the selector and the fork
button to the *scenario*, and asks for nothing but the coordinate interface and the two
signature interlocks — one of which is graded by a scenario built specifically to break a fork
coil wired to the button alone. `asrs-put-away` then asks for the same run with the fitter taken
off the panel, so the step chain arrives on a machine the player has already driven. Two things
came out of building it:

- **The first scan read a machine that was not there.** The derived image was empty until after
  rung one, so `D0`/`D1` read 0 while the crane stood at (0, 1); a program driving to level 1
  commanded a lift for a single scan and left the mast permanently between levels. Fixed at the
  source with `primeProcess()` (step the model once at `dtMs: 0` before scanning, keep only the
  sensor image), called identically by the grader and the client. No existing canonical solution
  changed behaviour, which is the evidence it was a latent bug rather than a rule anyone relied
  on.
- **A briefing cannot show a stacker crane arriving.** So `LadderPuzzleSpec` grew an optional
  `demo`: a reference program plus a scenario name, played through the existing replay machinery
  with the ladder deliberately dark. It is the introducing puzzle's privilege only — one puzzle
  later, a demonstration is just the answer.

Two findings worth recording, because they cut against the original design intent:

- **Throughput scoring is structurally blind here**, so `parMs` is declared only on
  `asrs-put-away`. Every other scenario is paced by the lines' consume clocks rather than by the
  crane: a faster program finishes each cycle sooner and then waits for the next call, so
  elapsed time is identical. Choosing a worse slot eats slack, it does not delay anything.
  The schema already sanctions omitting par "where pace is not a design goal".
- **Dual-command cycling is worth roughly a tenth of the crane on this geometry, not a
  categorical requirement.** Put-aways always start at the aisle head, so a trip serving line B
  crosses the aisle either way. Attempts to tune the rates until single-command *failed* put the
  canonical itself on a knife edge (it fails at a 10 % tighter rate and single-command passes at
  a 7 % looser one), which would have made a brittle puzzle. The capstone is therefore graded on
  correctness under load, and the briefing says dual command buys back margin rather than
  claiming it is the only way through.

Seven negative tests in `grade.test.ts` cover the mistakes that genuinely fail: searching only
the nearest bay (the line runs dry), a move block without the fork-home contact (the mast folds,
checked on the tutorial and again on the capstone geometry), a fork coil driven from the button
alone (it strokes between slots), delivering everything to the aisle head (line A's conveyor
overflows and line B never eats), never putting anything away (goods in blocks), and running
orders only at full rate (the rack empties out from under the lines).

## Excavator plant — shipped

An eleventh category, `factory`, and the first thing in the game that is not a machine but a
**plant**: four stations coupled into one line, and the first puzzle written in more than one
program. It needed the largest engine change since the analog expansion, and every bit of it
was additive.

**POUs and tasks.** `LadderProject` layers program organization units and tasks over
`LadderProgram`, which was not touched; `toProject()` is the single boundary between the two
shapes, which is why 46 puzzles, every saved slot and the Pages demo needed no migration at all.
The gate for the phase was the existing suite passing with no edits to any canonical solution,
and it did. Two decisions are worth recording:

- **Task intervals are forced to integer multiples of `GRADE_DT`**, and scheduling uses an
  absolute `nextDue`. Anything else drifts off the 50 ms grid and client and server stop
  agreeing, which is the one thing this codebase will not trade.
- **Edge detection is one input image per task**, not per instance. Real LDP keys edge memory
  to the instruction instance, but that `prev` is mid-scan rather than end-of-scan, which
  silently changes behaviour for any rung reading a bit a later rung writes. Per-task keeps a
  single-task project byte-identical to what it was, and still lets a slow task see edges at
  its own rate — which is the mechanism a later puzzle's "the interlock ran too slowly" lesson
  needs.

**The plant.** Mid-size excavators, built in four bays: weld, paint, final assembly, and test
and dispatch. What makes it a plant rather than four machines is that **two part streams**
(chassis frames and booms) run through the same weld shop and the same booth, and final assembly
needs one of each. So the line's real problem is the *mix*: a weld shop running flat out on
frames fills every buffer and starves assembly while looking perfectly busy. Buffers are small,
finite and instrumented, so ignoring a downstream full bit latches `blocked`, and a jig holding
half a machine it can never finish latches `starved` — both through the existing `expectMachine`
path, exactly as the warehouse's two latches do. The cure oven is a fixed dwell no program can
shorten, which is what makes pipelining the only route to a throughput target.

**A new play layout**, used by this category only. A station fits in a three-column workbench; a
plant does not. The 3D floor is the page, the section programs float in resizable windows the
player opens for whatever they are working on, and the briefing collapses to a pinnable tab. The
3D is one composed scene with a camera preset per bay rather than four scenes swapped in, so the
whole plant and one bay are the same model at two distances. It is drawn procedurally because
the same excavator appears in every bay at a different stage of its own build, and turning parts
on and off is a function in code and a chore in a `.glb`.

`factory-supervisor` is the on-ramp, and it takes the same shape the ASRS rebuild arrived at,
applied to whole programs instead of whole rungs: four stations ship **working and read-only**,
and the player writes only the supervisor whose one bit lets them run. The ladder is three rungs
they have built before; everything new is around it. `PouSlot.editable` is what makes that
possible, and `owns` makes structured programming enforceable in a flat device space — an
editable section writing outside its block is a validation error, while reads stay deliberately
free.

Two bugs the fixtures found, both worth keeping in mind when writing any station program here:

- **A held clamp reloads.** The weld fixture kept its grip through the release stroke, so on the
  scan the old part left it picked up the next blank — using the part selector as it stood
  *before* the alternating relay flipped. The station welded two frames in a row and the plant
  slowly filled with frames. Opening the clamp when the release begins fixes it.
- **Step timers do not reset themselves.** Assembly re-sets its cycle latch in rung one, before
  the timer rungs ever see it low, so the second machine inherited three finished timers and the
  jig pinned a boom onto an empty fixture. Reset step timers explicitly.

**The rest of the category then grew its own plant.** A rack store, a portal robot, multi-pass
welding, a four-drum booth with its own cure oven, a dock with a haulier, and a **twelve-zone
accumulating conveyor the player programs as a seventh section** — all in a second process model
(`factory-line`) that leaves the commissioning puzzle's plant provably untouched. Six more
puzzles ship on it, one per section plus a capstone: `factory-weld` → `factory-conveyor` →
`factory-handling` → `factory-paint` → `factory-assembly` → `factory-line`. The capstone is the
first puzzle in the game that opens **every** section and seeds them all with a working program:
there is nothing to commission, the line ships 23 machines a shift where it will do 37, and the
question is which station is holding it up.

Three findings from building it cut against the design intent and are worth recording here, with
the full account in **[FACTORY.md](./FACTORY.md)** and
**[FACTORY-LINE-DESIGN.md](./FACTORY-LINE-DESIGN.md)**:

- **A station's lever is zero unless its plain program blocks whatever is setting the pace.**
  Measured over a 300 s shift, the store and the conveyor cost the plant nothing however badly
  they are written, and no scenario can recover it. Both puzzles grade correctness and say so.
- **A section with no throughput lever can still have the category's best lesson.** Sorting the
  rack is not faster; it is the only thing that makes the line's *mix* recoverable, and a shift
  that starts with two frames in one lane proves it as a jam rather than as seconds.
- **Six sections interacting through nine buffers is past the point where arithmetic beats a
  run.** `factoryLineTempo.test.ts` soaks a shift per configuration and is the only place any
  timing number in those documents comes from. Every attempt to reason one out was wrong, in
  both directions.

Read [FACTORY.md](./FACTORY.md) rather than this section.

## Next: the rest of the analog plan

Agreed with the analog design and still to build:

1. **Paint — `paint`, category `finishing`.** Atomizing pressure and paint flow as lagged loops,
   plus four CMYK dosing pumps trimmed against an inline color sensor sitting *downstream of the
   mixer*, so the color loops have real dead time and a naive high gain oscillates. Four puzzles
   ending in a batch of parts in different colors, with purge waste costing performance marks.
   The part's material color is driven straight from machine state, which makes the color error
   visible rather than inferred.

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
