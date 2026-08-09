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
- Mitsubishi FX addressing: `X` inputs, `Y` outputs, `M` relays, `T` timers, `C` counters,
  and `D` **data registers** — 16-bit signed *words* rather than bits.
- A program is an ordered list of **rungs**; a rung is a grid of cells plus vertical links.
- Bit elements: NO / NC / rising-edge / falling-edge contacts, OUT / SET / RST coils, timer,
  counter, horizontal wire.
- **Word elements** (`value.ts` parses their operands, `"D10"` or `"K500"`):
  - `compare` — a conducting contact carrying an operator (`= <> > < >= <=`) and two operands.
    The one element with no `device` at all: both sides are operands.
  - `mov` — move a constant or register into a destination register.
  - `math` — `add` / `sub` / `mul` / `div` into a destination.
  - `pid` — a loop block: setpoint and process-value operands, a destination, and `PidParams`
    (gain in hundredths, integral/derivative times in ms, sample time, output clamp, error-sign
    flip). `ti`/`td` of 0 disable their term, so one block is a P, a PI or a full PID.
- Registers **saturate** at ±32767 rather than wrapping (`saturate16`), and integer arithmetic
  is the point: it is bit-exact on every platform, so the client/server agreement is absolute
  rather than merely likely. Expressions evaluate at full precision and saturate on the *store*,
  which is why "divide before you multiply" is a lesson the puzzles teach.

### 2. Simulation engine — `shared/src/sim/`
- `rungSolver.ts` — treats a rung as a graph and floods power from the left rail using
  disjoint-set union over column-boundary nodes. Series = AND, vertical links = OR.
  An energized output passes power on to its right, so outputs stacked left to right after
  one contact all fire from it (a fixpoint, so a dead block never backfeeds).
  Returns energized coils plus the live nodes/cells the UI highlights.
- `scanCycle.ts` — `SimEngine`: evaluate rungs top→bottom, apply coils immediately (a later
  rung sees an earlier rung's coil in the *same* scan), tick timers/counters by `dt`.
  `prevBits` is snapshotted at the **end** of each scan, which is what makes edge contacts work.
- Timer presets are K-units of 100 ms (`TIMER_BASE_MS`).
- A **register file** alongside the bit image, with `getRegister`/`setRegisters` mirroring
  `getBit`/`setInputs`. `MOV` and the math blocks write only while their rung conducts, so two
  rungs moving different values into one register is how you *select* a value, not a
  double-coil bug — hence their exemption from the validator's `LAST_WRITER_WINS` advisory,
  and `pid`'s inclusion in it.
- The **PID block** runs on its own `sampleMs` rather than every scan (authentic, and it
  decouples tuning from scan rate), holds its output between samples, accumulates the integral
  in a wide internal accumulator a 16-bit register could not carry, applies **conditional
  integration** so a loop against its output limit cannot wind up, and clears its state whenever
  its rung drops so a de-energized loop comes back clean.
- **One cadence.** The client's live scan dt *is* `GRADE_DT` (50 ms). Booleans survived the old
  60/50 mismatch because every process model's timings are exact multiples of both; an
  integrator does not, so this is now a single constant with the client importing it.

#### POUs and tasks

A station is one rung list; a plant is not. `LadderProject` layers **program organization
units** and **tasks** over the existing model without touching it:

- `Pou` is an id, a name and a rung list. `TaskDef` is a priority, an optional `intervalMs` and
  the POU ids it calls, in order. `LadderProject` is the two lists. `ProgramDoc` is
  `LadderProgram | LadderProject`, and **`toProject()` is the single boundary** where the old
  shape becomes the new one — which is why all 46 pre-existing puzzles, every saved slot in the
  database and the Pages demo needed no migration at all.
- `SimEngine.scan(dt)` walks `tasksInScanOrder` (priority, then declaration order). A task with
  no `intervalMs` runs every scan with the caller's `dt`; a periodic one runs when `tMs` reaches
  an absolute `nextDue` and is handed `intervalMs` as its `dt`, so **a timer in a 200 ms task
  advances 200 ms per execution**, not 50.
- Task intervals **must be integer multiples of `GRADE_DT`** (enforced in `validate.ts`).
  Then `nextDue` lands exactly on the grid, the arithmetic is integer-exact, and there is
  nothing for client and server to disagree about.
- **Edge detection uses one input image per task**, snapshotted at the end of that task's
  execution; `conducts()` reads the image of the task currently running. For a single-task
  project this is byte-identical to the old single end-of-scan snapshot — which is what
  preserved every existing behaviour — and for a slow task it means the task sees edges at its
  own rate, which is the authentic behaviour and the mechanism behind the "the interlock ran
  too slowly" lesson. Rejected: per-instance edge memory. It is what real LDP does, but its
  `prev` is mid-scan rather than end-of-scan, which silently changes any rung that reads a bit
  a later rung writes.
- Timer/counter/PID state stays keyed by device, because a `T` device is global on real
  hardware. `lastResults` is a `Record<pouId, RungEvalResult[]>`, and a POU whose task did not
  run this scan keeps its previous results so the UI does not flicker.

### 3. Puzzle system — `shared/src/puzzle/`
- **`PuzzleSpec`** (`types.ts`) — a discriminated union on `kind`:
  - **`LadderPuzzleSpec`** (`kind: 'ladder'`) — briefing, hints, `devices` (the physical I/O),
    optional `registers` (internal M/T/C the puzzle expects, surfaced as an IO list),
    `allowedInstructions`, `maxRungs`, a `processId`, graded `scenarios`, and an optional
    `demo`.
  - **`demo`** (`PuzzleDemo`) — a reference program plus the name of one of the puzzle's own
    scenarios. The client plays the resulting trace through the ordinary replay machinery with
    rung highlighting suppressed, so the player watches the *machine* work without being shown
    the ladder. Reserved for the puzzle that introduces a machine (`asrs-drive` is the only one
    so far): after that, a demo of the next job is just the answer. Held to the same bar as a
    canonical solution by `grade.test.ts` — it must validate and it must pass every step of the
    scenario it claims to demonstrate.
  - **`CabinetPuzzleSpec`** (`kind: 'cabinet'`) — same base (devices/scenarios/briefing) but a
    fixed `cabinet` component layout instead of ladder fields; the player's "program" is a
    `WiringDoc` (see §3b).
  - **`pous` / `tasks` / `taskAssignment`** — present means the puzzle is written in sections,
    and that is also what selects the workspace layout on the client (§9). A `PouSlot` is
    `{ id, name, title, editable, program?, maxRungs?, owns?, brief? }`.
    - `editable: false` ships the section pre-written and read-only, which is what makes a
      five-POU factory a fair first puzzle: puzzle 1 opens the supervisor and runs the four
      stations for you, and each later one takes another away. Same on-ramp shape as the ASRS
      commissioning puzzle, applied to whole programs instead of whole rungs.
    - `owns` is a list of device ranges (`M120-M139`, `T4-T7`, a bare `D2`) the section may
      **write**. The device space is flat, so this is the only thing standing between a
      sectioned program and section 3 quietly latching section 2's step relay. Reads are
      deliberately unfenced — a section reads its neighbours' handshakes and the plant run bit,
      and that asymmetry is the point. Checked only for `editable` slots: a shipped fixture is
      the author's own code.
    - `brief` is that section's page of the manual, in the same format as `briefing`. A plant
      manual read one station at a time is a manual; read whole it is a wall.
  - **`project.ts`** is where a submission and a puzzle's own sections become one runnable
    program, and it is shared by client and server for the same reason the grader is:
    `assembleProject(spec, submitted)` always takes non-editable sections **from the spec**, so
    a hand-written payload cannot rewrite the fixtures it is graded against, and takes tasks
    from the spec unless `taskAssignment: 'player'`. `initialProject(spec)` is the empty
    starting state; `editableSlots`, `parseDeviceRange`/`inDeviceRanges` back the ownership
    check.
  - **`briefing`** is written as an instruction manual, not prose: a one-paragraph lead, then
    `## Section` blocks (`Equipment`, `Sequence of operation`, `Interlocks and safety`,
    `Field notes`, `Acceptance`; cabinet puzzles use `Power circuit` / `Control circuit` /
    `Indication` / `Safety rules`). Blocks are separated by blank lines; `1.` (with optional
    `a.` sub-steps) becomes an `<ol>`, `- ` a `<ul>`, anything else a paragraph. The renderer
    is `Briefing` in `client/src/pages/play/BriefColumn.tsx`.
  - Every spec also carries a **`category`** (`basics` / `timers-counters` / `stations` /
    `elevator` / `control-cabinet` / `packaging` / `pick-place` / `drill` / `process-control` /
    `motion` / `warehouse` / `factory`) — the unit of unlock progression and list grouping
    (`CATEGORY_ORDER` / `CATEGORY_TITLES` / `CATEGORY_BLURBS` in `types.ts`).
  - Categories group into five **tracks** (`CATEGORY_TRACK`, `TRACK_ORDER`, `TRACK_TITLES`,
    `TRACK_BLURBS`, `categoriesInTrack`): `fundamentals`, `panel`, `machines`, `process`,
    `plants`. Twelve categories is the right granularity for gating progress and much too fine
    a one for navigation — as a flat pill row it wrapped onto two lines and turned a curriculum
    into a wall. **A track is navigation only**: nothing about locking, grading or content knows
    it exists. `control-cabinet` gets a track to itself because it is a different *kind* of
    puzzle rather than a harder version of the same one.
  - **Analog devices** set `signal: 'analog'`, address a `D` register and carry an
    `AnalogRange` (raw count span plus what those counts mean in the field). Transmitters
    report **raw counts**, never pre-scaled engineering units, because that is what an A/D card
    actually hands the CPU — scaling it is the first puzzle's lesson. `defaultInputs`,
    `inputDevices` and `outputDevices` all skip them; `analogDevices()` returns them.
- **Process models** (`processes/`) — small state machines that react to `Y` outputs and drive
  `X` inputs. Registered via `registerProcess`.
  - **`primeProcess()`** steps the model once with `dtMs: 0` before rung one and keeps only the
    derived image, so the first scan reads the machine that is actually standing there instead
    of an all-zero register file. Both `grade.ts` and the client's `useSimRunner` call it at the
    same point, which is what keeps live play and the graded run the same run. On the boolean
    puzzles it costs a scan of one wrong sensor; a word device makes it permanent — the stacker
    crane parks at level 1 with `D1` reading 0, so a program driving to `D53 = 1` commanded a
    lift for one scan and left the mast an eighth of a level high for the rest of the run,
    lined up with nothing and tripping the fork on a slot the readout said it was at.
  - `passthrough` — no machine dynamics; the HMI *is* the process.
  - `conveyor` — moves a part and derives a position sensor.
  - `drill` — the whole drill station, grown by **feature detection off the puzzle's own device
    list** (the `elevator5` door trick, widened) so one model serves all four puzzles in the
    `drill` category and the two easy ones still see the machine they always saw. Base: clamp
    travel (`Y0`→`X2` Clamped), feed depth (`Y1`→`X3` At Bottom) and the eject pusher
    (`Y4`→`X4` Eject Extended), plus the one interlock no drill station can do without —
    advancing the feed into an unclamped part snaps the bit and latches a packaging-style
    `jam` (frozen machine, asserted `false` by every scenario). **`X10` wired** instruments
    the *retracted* end of both strokes as well (`X10` Drill Up = feed fully home, `X11` Eject
    Home = rod fully home); with the head's position visible, running the pusher across a bore
    the bit is still in becomes a crash too (`jam`), which is what forces the eject to be
    fired off `X10` rather than off the bottom sensor. Those two sensors are feature-gated
    precisely because the older puzzles cannot see "head fully up" and legitimately start the
    pusher on the same scan the feed coil drops. **`Y5` wired** adds a real spindle with
    spin-up/coast (`600ms`/`900ms`) reporting `X7` At Speed, plus the remaining feed
    interlocks — advancing below speed or into hardened stock also snaps the bit; pushing a
    still *fully* clamped part is
    interlocked mechanically instead (elevator5-door style: the rod simply doesn't move), so
    releasing the clamp on the same scan the pusher starts isn't punished as a crash. **`X5`
    wired** adds real work pieces: a blank slides onto a cleared fixture after `700ms`
    (→ `X5` Part Present), the hole is finished by a **dwell** of `800ms` at full depth with the
    bit turning — not by touching `X3`, which is what makes the puzzles' 1.0 s `T0` dwell load
    bearing — and each part is classified as it leaves on a completed stroke: `good` (drilled
    aluminium to the belt), `scrap` (steel down the reject chute) or `bad` (either routing
    mistake). **`X6` wired** makes the infeed alternate aluminium and hardened steel from a fixed
    deterministic sequence (`DRILL_STOCK`) → `X6` Metal Part. **`Y6` wired** adds the diverter
    that decides belt vs. scrap bin. Machine state (`clamp`/`drill`/`push`/`gate` 0..1, `speed`,
    `spinning`, `warning`, `done`, `part`, `drilled`, the counters) drives the 3D view; `done`
    follows whichever completion lamp the puzzle wires (`Y3` or `Y7`).
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
  - `tank` — the buffer vessel, and the first plant with genuinely **continuous** state. Level
    is carried in milli-counts and integrated on a fixed 10 ms sub-step with a carried
    remainder, so the trajectory is identical whatever `dt` the caller uses — the guarantee the
    boolean models get from exact-multiple timings, which an integrator cannot get that way.
    Fixed I/O convention: `D0` level transmitter (raw 0..4000 counts), `D1` discharge flow,
    `D20` supply valve command, `X1`/`X2` low/high floats, `Y0` discharge pump. Inflow is
    proportional to valve opening and outflow to level, with the constants pinned so that **at
    rest, level counts equal valve counts** (50 % open holds 50 % full) and the time constant is
    4 s. That leaves P control with a visible, load-dependent droop, which is the whole argument
    for integral action and the thing the category is built around. Overflowing the vessel or
    running the discharge pump dry latches the packaging-style `jam`; the pump (and so the
    dry-run fault) is feature-detected off `Y0`, elevator5-door style.
  - `axis` — the transfer carriage on a variable-frequency drive: the second continuous plant,
    and the first where the *rate of change* is what the program commands. Position and velocity
    are carried in milli-counts on the same fixed 10 ms sub-step the tank uses. The program
    writes a speed reference (`D20`) and a direction (`Y0`/`Y1`); the drive ramps the actual
    speed toward it at whatever **drive parameter registers** `D40`/`D41` currently say, and
    position integrates what comes out. Two consequences carry the whole category: a speed
    reference is not a position (stopping somewhere means seeing the target coming), and the
    ramp rates are part of the *cycle* rather than constants, because the accel and decel a
    motor and a set of forks can survive both halve with a pallet on board.
    - Fixed I/O convention: `D0` position (0..4000 counts of a 2 m stroke), `D1` **signed**
      actual speed, `D2` hoist, `D3` sway amplitude, `D20`/`D21` speed references, `D40`/`D41`
      ramp parameters, `X10`/`X11` overtravel limits, `X12`/`X13` station proximity, `X14` load
      on forks, `X15`–`X17` hook up / hook down / sway OK, `Y0`–`Y4` forward, reverse, hoist up,
      hoist down, forks. Forks (`Y4`) and hoist (`Y2`) are feature-detected, so one model serves
      the whole ramp and a puzzle that never wires them cannot fail an interlock it can't see.
    - **What trips it**: running with a ramp parameter still at zero (a real inverter is not
      commissioned either), exceeding the accel or decel limit for the *current* load, arriving
      at a hard end stop above `CRASH_SPEED`, operating the forks with the carriage moving,
      setting a pallet down anywhere but the drop station, running a *loaded* carriage past the
      drop station into the rack face, and lowering the crane's hook while the load still swings.
    - **Sway** is a fixed-point pendulum driven by the trolley's change in speed, with a ~2 s
      period and a ~1.4 s decay. The program is handed the **amplitude** (`sqrt(x² + (v/ω)²)`),
      not the instantaneous angle: a swinging load passes through vertical four times a second,
      so an interlock on the angle would go true at exactly the moment the load moves fastest.
      `Math.sqrt` is the one transcendental IEEE-754 specifies exactly, so this stays bit-exact.
      A side effect that falls out of the physics rather than being written in: a ramp lasting
      about one pendulum period cancels its own excitation, so the *fastest* legal ramp is not
      the fastest cycle. The crane's `parMs` quietly rewards finding that.
  - `warehouse` — one stacker crane in one aisle, a rack of 4 bays x 2 levels, and two
    production lines that both want feeding from it. Every other model runs a *sequence*; this
    one runs a **schedule**, which is the whole category. Three things demand the crane at once
    (line A, line B, goods in), there is one crane, and what serving any of them costs depends
    on where the crane is standing.
    - **The aisle** is six positions, `0`..`5`, and two levels. Position 0 level 1 is line A's
      infeed conveyor and level 2 above it is the goods-in conveyor; bays 1–4 are the rack
      (level 1 pick face, level 2 reserve); position 5 level 1 is line B. The two lines sit at
      opposite ends deliberately: distance from A is the bay number and from B it is `5 - bay`,
      so *the nearest slot holding a material differs depending on who asked for it*.
    - **Chaotic storage.** Materials are not assigned to bays. The WMS scatters them and
      publishes the whole table, one register per slot (`D101`–`D104` pick face, `D201`–`D204`
      reserve, `0` = empty), so finding stock is a search-and-minimize rather than a lookup —
      and the answer moves as stock is drawn down and put back.
    - **Driven, not commanded**: `Y0`/`Y1` traverse, `Y2`/`Y3` lift, `Y4` fork, and the program
      stops itself on the position sensors (`X20`–`X25`, `X26`/`X27`) the way `elevator5` stops
      on its floors. Travel and lift run together, so a move costs
      `max(bays x 800ms, levels x 600ms)`. `D0`/`D1` report the same sensor chain as a number —
      **the last sensor passed, latched, not the nearest one rounded** — which is what makes
      `[= D0 D50]` mean "arrived" instead of "more than half way there", and what collapses
      driving anywhere into one small rung block. End stops simply hold the crane.
    - **The fork** is one stroke on the `pickPlace` contract: the transfer lands when the
      out-stroke completes, and whether it picks or places is implied by what the crane is
      carrying. `X13` is a carriage photo-eye that reads the slot in front of the fork — a
      confirmation of the table, never a substitute, since you only get it after driving there.
    - **The category opens under a test panel.** `asrs-drive` wires only the crane
      (`CRANE_AXIS_DEVICES` — the aisle half of `CRANE_DEVICES`, without the slot photo-eye or
      the material code), and the *scenario* works the selector and the fork button, so the
      player builds the move block and the two interlocks with nothing else in the frame.
      `asrs-put-away` then asks for the same job with the operator replaced by a step chain.
    - **What trips it**: moving with the fork out (the mast folds) and stroking the fork
      between slots are the two signature interlocks; after that the faults are all logistics —
      a pallet into an occupied slot, onto a full infeed conveyor, into a line that asked for
      something else, or back out onto the inbound conveyor. All latch `jam` with a reason.
    - **Two failure latches beside `jam`**, because these are caused by the *schedule* rather
      than by a move: `starved` (a line's consume tick found its infeed conveyor empty) and
      `blocked` (a pallet reached goods in with nowhere to go). Both are asserted exactly the
      way `jam` is, so the grader needed no changes — and they are what turns "be fair to both
      lines" from a rule into a consequence.
    - Line demand, and what arrives at goods in, are deterministic sequences in the
      `DRILL_STOCK` tradition. A line's demand register names the material for the *next* pallet
      it will accept and advances on delivery, so a program has to re-read it every cycle.
      Rates are the category's difficulty dial: goods in supplies at half a line's consume
      period so two lines and the inbound flow roughly balance, and the capstone then sits at
      about nine tenths of the crane.
  - `factory` — the excavator plant. Every other model here is a *machine*; this one is a
    **line**, and the difference is that no station in it can be programmed correctly on its
    own. Four stations coupled by finite buffers: weld -> paint -> final assembly ->
    test and dispatch.
    - **Two part streams.** Weld and paint each handle chassis frames and booms, and final
      assembly needs one of *each* to build a machine. So the plant's real problem is the
      **mix**, not utilisation: a shop that welds frames as fast as it can fills every buffer
      with frames and starves assembly while looking perfectly busy.
    - **Backpressure is real and visible.** Buffers are small (`WP_CAP` 3, `PA_CAP` 3 per type,
      `AT_CAP` 2, `YARD_CAP` 6) and every one of them publishes a full/space sensor the program
      can read. Overrunning one latches `blocked`; a half-built machine that cannot be finished
      latches `starved` after `STARVE_MS`. Both assert through the existing `expectMachine`
      path, so the grader needed nothing new — the warehouse's finding, reused.
    - **`starved` is specifically a half-built machine**, not an idle one. The first version
      ran the clock whenever assembly's buffers were empty, which failed every scenario during
      its own start-up. An empty line at the start of a shift is idle; a jig holding a frame
      with no boom anywhere is starved.
    - **The oven paces everything.** Cure is a fixed `PAINT_CURE_MS` dwell no program can
      shorten, and it is the slowest single step by design, so throughput targets are only
      reachable by pipelining rather than by running the four stations in turn.
    - **The one continuous plant here is the paint booth**: booth temperature is a first-order
      lag on the heater command, and film builds as flow x time but *only inside the cure
      band*. Both are integer milli-counts on the fixed `SUB_MS` sub-step with a carried
      remainder, same discipline as `tank.ts`/`axis.ts` and pinned by the same first test.
      Spraying a cold booth lays down paint that never cross-links, and a booth that drifts out
      of band during the bake spoils the finish; either way the part comes out of the oven as
      scrap, which shows up two stations later as a machine assembly never got to build.
    - Buffers travel as **strings** (`bufWp: 'ffb'`) rather than counts, so the order and the
      mix are both in the state and the 3D view can draw exactly what is queued.
    - `FACTORY_SECTIONS` exports the POU ids the puzzles use (`SUP`/`WELD`/`PAINT`/`ASSY`/
      `TEST`). They are a contract, not a convention: the plant view frames a bay by the id of
      the selected section.
    - **Used by the commissioning tutorial only.** Everything after it runs `factory-line`.
  - `factory-line` — the same plant rebuilt at honest scale, and the model every factory puzzle
    after the tutorial declares. Seven sections (`SUP`/`WELD`/`STORE`/`PAINT`/`ASSY`/`TEST`/
    `CONV`), 47 in / 42 out / 22 registers, and three transport mechanisms the program drives:
    a four-lane rack store, a portal robot over the aisle, and a **twelve-zone accumulating
    conveyor** that is a program section in its own right. Two rules carry the spine: a part
    only enters a zone while that zone is running and clear, and a station cannot lift a part
    off a zone that is moving. Split from `factory` rather than feature-flagged onto it because
    the *flow* differs rather than the fittings, which is also what leaves puzzle 47 provably
    untouched. `LINE_SECTIONS`, `LINE_LIMITS` and `LINE_ZONES` are the contracts the 3D scene
    and the briefings both quote. **[FACTORY.md](./FACTORY.md)** and
    **[FACTORY-LINE-DESIGN.md](./FACTORY-LINE-DESIGN.md)** carry this one in full; it is the
    only process model deep enough to need its own documents.
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
  - `pickPlace` — a robot arm swinging between an infeed (station 0) and up to 4 tray slots
    (stations 1..slotCount, the count derived from how many of `X1`-`X4` the puzzle wires — an
    elevator5-door-style feature detect widened from a boolean to a count). Fixed address
    convention: `X0` at infeed, `X1`-`X4` at slot 1-4, `X10`/`X11` reach down/up, `X12` Gripped (a
    live confirmation — `reach>=1 && grip>=1 &&` (carrying or a part is actually at the current
    station) — never a latch), `X13` Infeed Ready (feature-detected: absent means a bottomless
    supply, present means a real deplete/refill cycle), `X14`-`X17` slot 1-4 occupied, `Y0`/`Y1`
    swing to tray/infeed, `Y2` reach down, `Y3` gripper close, `Y5` Reset Tray (feature-detected —
    an idempotent "operator unloads the tray" action, clearing occupancy but never `jam`, only
    while nothing is carried). Swing travel is `600ms`/station — the same exact-common-multiple
    trick as `elevator5`'s `900ms`, needed here so a multi-slot sweep can detect an already-full
    slot in passing (elevator5-style OR-cascade) without ever stopping there. The arm cannot
    physically swing while reach is extended (would crash the tray guarding), enforced in the
    model itself like elevator5's door. A part is picked the instant reach leaves the bottom with
    the gripper closed and nothing already carried, and placed the instant the gripper finishes
    opening while carrying; dropping mid-air or placing into an occupied slot both latch a
    packaging-style `jam` that every scenario asserts stays false.
- **Validator** (`validate.ts`) — structural checks: instruction allow-list, device kind/role
  match, presets present, every rung drives an output, and for word instructions the operand
  *shape* (right count, each one a register or a constant, a real operator, sane PID tuning).
- **Grader** (`grade.ts`) — runs each scenario's scripted input timeline through `SimEngine` +
  the process model and checks the `expect` assertions. `grade.test.ts` holds a canonical
  solution for **every shipped puzzle** — that test is the guardrail against authoring an
  impossible puzzle.
  - A step with `until` runs to a **milestone** instead of a fixed deadline (`holdMs` becomes
    its timeout, `thenHoldMs` a settle window). Sequential machines are paced by the program
    driving them, so asserting at a hard deadline grades pace rather than behaviour.
  - A step can also carry a **`control`** spec (setpoint, band, settle time, optional overshoot
    and steady-error caps) evaluated across the *whole step* rather than at its final instant.
    That distinction is what separates an analog exercise from a sequencing one: a loop that
    happens to be sitting on setpoint when the clock runs out has not been shown to work, and
    one that got there through a 40 % overshoot would have put product on the floor.
    `expectAnalog` and `ScenarioCondition.analog` give the same band checks at an instant, for
    end-of-step assertions and `until` milestones.
  - **Scoring** splits `CORRECTNESS_WEIGHT` (85) for scenarios passed and 15 for performance.
    Performance compares each scenario's `elapsedMs` against its declared `parMs`, full marks at
    or under par tapering to zero at `PAR_SLACK` (1.5) x par, and is only awarded once every
    scenario passes. Scenarios with no `parMs` (E-Stop checks, every puzzle without machine
    dynamics) score on correctness alone. So a correct but leisurely program is `solved` and
    unlocks what follows, and still has to be pipelined to reach 100.
    - Regulating scenarios spend the same 15 marks on **control quality** instead: they declare
      `parIae` (integral of absolute error in count-seconds, accumulated over every `control`
      step) in place of `parMs` and run through the identical taper, because for a loop "how
      well did it hold" *is* the performance question. Declare one or the other, never both.
      Pars are calibrated against the canonical solution's measured value, the way the
      packaging cycle times were.
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
| 25 | `pick-place-cycle` | medium | sequence swing/reach/grip into one transfer, park instead of overfilling | pickPlace |
| 26 | `pick-place-tray` | hard | generalize to 4 pads, an elevator5-style sweep, Y4 lamp from the X18 sensor | pickPlace |
| 27 | `pick-place-supply` | hard | wait on a feature-detected finite infeed sensor (X13) + supply lamp | pickPlace |
| 28 | `pick-place-full` | hard | capstone: two-tray order — operator unloads (X20→Y5), tray counter C0, Y7 lamp | pickPlace |
| 29 | `drill-clamp-feed` | easy | seal one stroke in, feed only once X2 confirms the clamp | drill |
| 30 | `drill-station` | medium | multi-step sequence, SET/RST, beacon, both ends of both cylinders (X3/X10, X4/X11), rising-edge one-shot eject | drill |
| 31 | `drill-spindle` | hard | spindle Y5 + X7 at-speed interlock, 1.0 s bottom dwell on T0, rotation off between parts | drill |
| 32 | `drill-production` | hard | capstone: mixed stock — X6 metal diverted undrilled via Y6, C0 counts holes and parks the batch | drill |
| 33 | `tank-level-readout` | tutorial | first analog signal: scale raw counts with DIV, drive alarms from compare contacts | tank |
| 34 | `tank-two-position` | easy | hysteresis latch from two compares; watch the valve slam and wear | tank |
| 35 | `tank-p-control` | medium | a P regulator hand-built from SUB/MUL/ADD, whole-number gain, manual-reset bias | tank |
| 36 | `tank-pid` | hard | the PID block: integral kills the offset, anti-windup keeps the fill from overshooting | tank |
| 37 | `tank-auto` | hard | capstone: two recipe setpoints, hand mode, and a high-level trip that latches over both | tank |
| 38 | `axis-jog` | easy | commission a drive: ramp parameters into D40/D41 before it will start, then jog to both limits | axis |
| 39 | `axis-profile` | medium | position from a speed reference: signed distance-to-go, rapid, then an approach that starts before the target | axis |
| 40 | `axis-loaded` | hard | two ramp tables swapped in flight off X14, *and* the stopping distance they imply | axis |
| 41 | `axis-crane` | hard | capstone: hoist plus traverse, and a load on a rope that is still swinging after the trolley stops | axis |
| 42 | `asrs-drive` | tutorial | the crane's coordinate interface, under a test panel: target registers, the four-row move block, arrival, and both signature interlocks. Ships a watchable demo | warehouse |
| 43 | `asrs-put-away` | easy | the panel replaced by a program: a one-hot step chain over three stops and the latched fork stroke | warehouse |
| 44 | `asrs-retrieval` | hard | search the WMS slot table for a demanded material, nearest slot first, and keep a line fed | warehouse |
| 45 | `asrs-two-lines` | hard | two lines at opposite ends: latch which one a cycle belongs to, and compute distance from *its* station | warehouse |
| 46 | `asrs-replenish` | hard | a second job in the opposite direction — put-away into the nearest empty slot, without letting goods in back up | warehouse |
| 47 | `asrs-dual-cycle` | hard | capstone: three demands on one crane, trips planned as a list of stops, a stop switch, and dual-command cycling | warehouse |
| 48 | `factory-supervisor` | tutorial | the first puzzle written in **sections**: four station POUs ship working and read-only, the player writes the supervisor whose one bit lets them run | factory |
| 49 | `factory-weld` | hard | the rebuilt line's first bay: sequence a fixture with a positioner, alternate the mix, and live with a consumable tip | factory-line |
| 50 | `factory-conveyor` | hard | twelve zones of zero-pressure accumulation, a diverter that reads the part, and the rule that you cannot pick one off a moving belt | factory-line |
| 51 | `factory-handling` | hard | sort a rack by type and drive a portal robot, so a shift that starts out of order can still be recovered | factory-line |
| 52 | `factory-paint` | hard | hold an analog cure band, spray each part to its own film spec, and change color without stopping or scrapping | factory-line |
| 53 | `factory-assembly` | hard | two sections at once: interlock a build, run the bench beside the jig, and send for a lorry ten seconds before it is needed | factory-line |
| 54 | `factory-line` | hard | capstone: **all seven sections open and seeded with the working plant**, graded on how much faster it ships than the line you were handed | factory-line |

Categories: 1–3 `basics`, 4–7 `timers-counters`, 8 + 10 `stations`, 11–14 `elevator`,
15–20 `control-cabinet`, 21–24 `packaging`, 25–28 `pick-place`, 29–32 `drill`,
33–37 `process-control`, 38–41 `motion`, 42–47 `warehouse`, 48–54 `factory`.

### 5. Client — `packages/client/src/`
- **Ladder editor** (`features/ladder/`) — grid canvas, instruction palette, device chips,
  vertical-link toggles, add/remove rungs, rows and columns. Editor state in Zustand.
  - **In-place editing** — select a placed element and retype its address, preset, word
    operands, operator or PID tuning.
  - **Contextual fields** — the toolbar shows *only* the fields the active instruction uses
    (whatever is selected, falling back to the last thing placed), labelled per instruction:
    a MOV shows `Source` and `→ Dest`, a MATH adds `A`/`Op`/`B`, a compare drops the
    destination entirely, and `Preset K` appears for timers and counters alone. Showing every
    box at once was actively misleading — a Preset K beside a DIV reads as part of the
    division, an operator dropdown beside a MOV reads as though a move could compare.
    The PID tuning row (Kp, Ti, Td, output range) follows the same rule.
  - **Word instructions** — a destination must be a `D` register, checked at placement rather
    than left to submit-time validation (otherwise a leftover `X0` in the address box silently
    becomes a DIV's destination). Operands normalize through `parseValueOperand`, so a bare
    `10` is stored and shown as `K10`: constant-versus-register is the whole grammar of these
    instructions and a naked number hides it. A `compare` renders as a contact with its
    operator between the bars; `mov`/`math`/`pid` render as function blocks showing their
    operands as an expression (`D0÷K4`) with an arrow-prefixed destination underneath.
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
    - `startDemo(spec)` runs the same machinery over the puzzle's shipped `demo` instead, from a
      "▶ Watch the machine run" button above the briefing. It opens already playing, drops the
      jump-to-failure control (nothing failed), and blanks `evalResults` — the rungs on screen
      are the player's and the ones driving the machine are not, so lighting up their grid from
      a trace of someone else's program would show power in cells that do not exist.
  - **Trace strip** (`TraceStrip.tsx`) — a logic-analyzer view (one row per device/register,
    filled where the bit is high) reading `SimRunner.history`; the live runner keeps a rolling
    ~24s window, replay supplies the full (already-bounded) scenario trace with a scrubbable
    cursor synced to the `ReplayBar`.
  - **Analog strip** (`HmiPanel`) — word devices get their own block above the lamp grid,
    showing the register's raw counts *and* the engineering value they stand for, so the scaling
    lesson stays visible rather than being quietly done for the player. A `trend` widget draws
    the last stretch of `SimRunner.history` as a strip chart: a regulator cannot be judged, let
    alone tuned, from an instantaneous number. Because history carries the register image, the
    trend redraws under replay scrubbing exactly like the bits do.
  - **Live words in the work-order column** (`BriefColumn.tsx`, `LiveRegisterState.registers`) —
    Terminal Assignment lights a chip for every *bit*, but a word device has no lamp to light, so
    its row said nothing at all while the sim ran. Analog terminals now carry their live counts
    with the engineering value under them, and Working Registers shows each `D` as a raw word (no
    range to scale by — it's scratch space whose meaning the player chose). The value column is
    rendered only on puzzles that actually have an analog device, so boolean puzzles keep the
    full panel width for device names.
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
    elevator's contract, via `OrbitControls` with `enableRotate={false}`), or neither. `panBounds`
    adds screen-plane panning with the view center clamped to a scene-space box (the camera is
    shifted by the same delta as the target, or clamping alone would tilt it). `fitExtent`
    (`{halfWidth, halfHeight}`) makes `cameraPosition` a *direction* only: the distance is derived
    from the live viewport each resize, so a wide machine can't be cropped by a narrow panel. It
    dollies along the current view direction, so re-fitting never resets an orbit — but
    `maxDistance` has to sit above the widest fit or `OrbitControls` pulls the camera back in.
  - **`DrillStation3D.tsx`** (`interactive`) — `drill-station.glb`; named nodes
    (`scene.getObjectByName(...)`) looked up once and driven imperatively from `machine.clamp` /
    `machine.drill` / `machine.spinning` / `machine.push`. The work piece runs through a small
    stage machine (chute → fixture → ejected) because a shipped part isn't the part that drops in
    next; the stock-aware puzzles drive those transitions from `machine.part` directly, the
    simpler ones from the cycle-done lamp. `BlockBody`/`BlockPlug` get **cloned** materials so
    hardened steel can be re-tinted without leaking into the rest of the scene, and a blank
    ejected with the diverter open (`machine.gate`) slides off the belt's edge and drops out of
    sight instead of riding to the far drum. The readout beside the scene grows the same way the
    process model does — spindle spin-up state, stock material, drilled/rejected/fault counts
    appear only for the puzzles that wire them.
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
  - **`TankVessel3D.tsx`** (`processId: 'tank'`, `interactive`) — the first of the two scenes built
    **procedurally** rather than from a `.glb`, on purpose: the Blender machines' interest is in
    linkages and shapes, while this one's whole subject is a number moving, and a cylinder of
    liquid whose height *is* that number says it better than geometry would. Level scales a
    unit-height liquid cylinder re-seated to grow from the vessel floor; the inlet stream's
    radius is the valve opening, which makes a modulating valve legible at a glance in a way a
    gauge is not; float-switch trip rings mark 10 % and 90 %; a fault re-tints the liquid. Still
    swappable for a hero model later, the way `PackMachine3D` was.
    - **The liquid, the surface disc and the inlet stream are opaque on purpose.** three renders
      opaque → transmissive → transparent, and the transmission render target holds only the
      first two groups, so the original transmissive glass shell both left the liquid out of its
      refraction *and* (writing depth first) depth-culled it — the column was invisible at every
      level. The shell is now plain blended glass with `depthWrite={false}`, which sorts
      correctly against opaque contents and skips a whole scene pass.
    - The bright surface disc floats `SURFACE_LIFT` above the liquid cylinder's top cap rather
      than sitting on it; coplanar the two z-fight and the surface strobes as the level moves.
  - **`AxisRig3D.tsx`** (`processId: 'axis'`, `interactive` + `panBounds`) —
    `transfer-carriage.glb`: a portal gantry with a traversing trolley, a rope hoist and a pair
    of fork arms that close **across the aisle** on a `ForkHead` turned 90°. That one shape
    decision is what makes the machine buildable — whatever is wide along the travel sweeps the
    whole stroke and has to clear every column, rack frame and end stop, while whatever is wide
    across it only has to fit the aisle once. One scene serves all four motion puzzles, parking
    the hoist and the forks by feature detection off the machine state exactly as the process
    model grows its interlocks (`machine.hasForks`, `machine.hasHoist`).
    - The blend is dimensioned **from** the process model, not eyeballed: 0..4000 counts of
      stroke *is* the runway between the buffers, so `xOf()` is a straight mapping. Wheel
      rotation is derived from travel (one turn per 2πr), the rope's payout and the drum's
      rotation are the same number, and the festoon carriers spread evenly between the trolley
      and the fixed anchor the way a real one does.
    - Sway pivots `RopeSwing` by `machine.sway` — the *instantaneous* angle, not the amplitude
      the program interlocks against — over a pendulum of rope length **plus 1.45**, the
      distance the load hangs below the block. Bare rope length makes the carriage cartwheel
      with the hook right up under the drum.
    - The glb is exported Y-up, so Blender's Z became three's Y and a Blender rotation about Y
      became a three rotation about Z **negated**. That is the only coordinate wrinkle, and it
      is why the drum, the wheels and the sway all carry a minus sign.
    - Lamps are driven in place, so each driven lens has its **own material** in the blend
      (`Stack Green`, `Stack Red`, `LED Pick`, `LED Drop`, `LED Beacon`) and the scene is cloned
      per instance on top of that. Green/red is healthy-versus-faulted; the two station lamps
      are X12/X13 read off the same window the process model uses; the trolley beacon flashes
      while the drive runs, the one thing on the rig with a clock of its own.
  - **`PickPlaceArm3D.tsx`** (`processId: 'pickPlace'`, `interactive`) — renders the
    Blender-authored `pick-place-arm.glb` (source: `D:\Code\Claude\Design\PickPlaceArm.blend`;
    see the pack/elevator entries above — node names are load-bearing the same way).
    `SwingPivot` (base yaw) carries the articulated `ShoulderPivot` → `ElbowPivot` →
    `ReachCarriage` chain; reach is a two-link IK move (shoulder/elbow pitch about local X, the
    carriage counter-pitches by `-(q1+q2)` so the gripper hangs plumb, wrist descending a
    vertical line over the pad); `GripperFingerL`/`R` slide along local X for grip;
    `InfeedPart`/`TraySlotPart_0..3`/`CarriedPart` are pure visibility toggles off `machine.*`;
    `ConveyorPart` lerps along the infeed conveyor whenever a fresh part is due; the mast's
    `JamLamp`/`TrayFullLamp` materials are mutated red/green. Every transform is still a pure
    function of `machine.*`, same contract the other Blender-backed scenes follow.
  - **`Warehouse3D.tsx`** (`processId: 'warehouse'`, `interactive` + `panBounds` + `fitExtent`) —
    built **procedurally** rather than from a glTF, the `TankVessel3D` precedent for the same
    reason. What has to be readable off it is *where the stock is*, so the plant is modelled as a
    real aisle: braced upright frames in racking livery, beams and deck slats, a floor rail with
    sleeper plate, a top guide rail on stub columns off the rack, a twin-mast stacker crane whose
    load rides *between* the columns on a three-stage telescopic fork, hoist chains that pay out
    with the carriage, roller conveyors on legs (the goods-in deck straddles Line A's rather than
    standing legs through it), and a clad building wall behind. Legibility is carried by four
    devices: every slot wears a placard with its **WMS register name** (`D101`..`D204`), each
    material has its **own load shape** as well as its color (plate / drums / sacks / bar), each
    station's lamp shows the **material that line is calling for** (and goes red when it stops),
    and the crane's beacon reads green / amber / red. The fork's full stroke lands a pallet
    exactly where the slot draws its own, so a transfer reads as continuous. Signage is painted
    into `CanvasTexture`s rather than fetched as a font, which keeps the scene offline-clean.
    Everything that doesn't move (`Plant`, `StationFrame`, and `Pallet`, which takes scalar
    x/y/z so the memo actually holds) sits behind `memo`, because the sim re-renders this tree
    20 times a second and only the crane, the lamps and the pallets that changed should
    reconcile. The whole scene is still a pure function of the machine state with no clock of its
    own, so replay scrubbing shows exactly what the live run showed.
- **Resizable workspace** (`features/layout/Resizable.tsx`) — the play view is a full-height
  three-column workbench. The brief and operator panels are drag-resizable (widths persisted to
  `localStorage`, arrow keys when the divider is focused, double-click to collapse) and
  collapsible from the toolbar, and each column scrolls independently so a long program never
  pushes the palette off screen.
- **Save slots** (`features/slots/`) — `useActiveSlot` resolves which of a puzzle's several named
  save slots is "active" (remembered per user in `user_settings.activeSlot`, falling back to the
  most-recently-updated slot) and loads its program; `SlotsPanel` lists/creates/renames/deletes
  slots. New slots come either from the current program or blank ("New (start fresh)"), the blank
  program being supplied by the play surface (`emptyProgram()` for ladder, `{ wires: [] }` for
  cabinet) so the panel stays kind-agnostic. The editor waits for slot resolution before rendering interactively, so a fast typist
  can't have their first edits clobbered by the async slot load.
- **Puzzle list, navigated in two levels** (`pages/PuzzleListPage.tsx`) — the five tracks live in
  the **top bar**, in the space the brand and the account links were leaving empty
  (`components/TopBar.tsx`, shown on list routes only: a play screen has its own nav and no room
  to spare, the plant workspace least of all). The page's pill row is then *within* the current
  track, so it holds at most five pills and never wraps; on the All view it is absent entirely
  and each group of category sections gets a track rule across the page instead. Categories are
  still what a section header names and still the unit of progression. Routes:
  `/puzzles`, `/puzzles/track/:track`, `/puzzles/category/:category`, all before
  `/puzzles/:slug` in `App.tsx` (React Router's specificity ranking, not order, is what keeps a
  two-segment path from being read as a slug). Each pill shows `solved/total` and lights green
  when complete. A track holding a single category suppresses that category's header titles,
  which would otherwise repeat the page heading two lines below itself.
- **Server state** via TanStack Query; auth context wraps the app.

#### The plant workspace — `features/workspace/`, `pages/play/FactoryPlay.tsx`

Selected by `PuzzlePlayPage` when `isMultiPou(spec)`; every single-program puzzle keeps
`LadderPlay` and the three-column workbench exactly as it was. A station fits in three columns;
a plant does not, so here the machine **is** the page.

- `FloatingWindow.tsx` — title-bar drag, resize from any of the eight edges and corners
  (`resizeBox` clamps a north or west delta *before* moving the origin, or a window at its
  minimum slides sideways for as long as the pointer keeps going), always-on-top, maximize, close,
  z-order on focus, clamped so a window can never be dragged fully off screen (`KEEP_VISIBLE`).
  Geometry persists per `(puzzleSlug, windowId)` in localStorage; the on-top pin and maximize
  deliberately do not — a window remembers the size and place the player chose, never a pose.
  Pointer capture, following `features/layout/Resizable.tsx` — which is exactly why the drag
  handler has to bail out on a press that lands on a button: a captured pointer retargets the
  *click* to the capture element, so grabbing the bar unconditionally swallowed every one of
  the window's own controls. Maximize is `position: absolute` inside `.workspace`, not `fixed`
  over the viewport, so the title bar (and with it the way back out) can't slide under the app's
  top bar. On-top windows sit in a z-band above the others; the top bar is above both.
- `useWindows.ts` — the open set as an array whose order *is* the z-order, so focus is a splice.
- `PinnableSidebar.tsx` — the briefing, demoted from a column to a tab down the edge. Click
  opens it as an overlay over the 3D; the pin pushes the layout instead. Reuses `BriefColumn`
  whole; only the chrome is new, and it shows the focused section's `brief` when there is one.
  It opens **pinned unless the player has said otherwise** (absent preference ≠ collapsed): a
  work order nobody has read yet is not optional chrome.
- **Run/Stop over the plant** (`.ws-stage-bar`). The only run commands used to live in the
  operator panel, which in this layout is a window you have to open first — so the plant could
  not be started at all from the view it is meant to be watched in. The stage carries a small
  ▶/■ pair on the *same* runner the panel drives, so the two are always in step.
- **The rail's foot is weighted, not uniform** (`components/icons.tsx`). Five identical outlined
  buttons said nothing about which mattered: the operator panel is the plant's own control desk
  and the one thing a player reaches for mid-run, so it is the only item with a filled face and
  a lit on-state; "clear the desk" is housekeeping and recedes; Save and Submit sit under a
  hairline as the pair that commits work. Each carries a drawn icon.
- **The demonstration loops, and has no transport** (`DemoStrip`). A station's demo is a thing
  you watch once; a line is a thing you study, so `factory-supervisor` ships `demo.loop` and the
  plant runs a complete excavator off the line — weld, paint, marry up, test, yard — in 36.5 s
  and starts again, at the trace's own 50 ms cadence so it moves at the speed it really moves.
  In place of the scrub bar there is a caption and the step the cycle is in; the only command on
  screen is the one that ends it. Graded replays keep the full `ReplayBar`.
- The section chips only offer bays the scene can frame. The supervisor POU's "bay" is the
  whole floor, so its chip did precisely what "Whole plant" does — two buttons for one view,
  which reads as one of them being broken.
- `PouExplorer.tsx` — tasks in scan order, POUs numbered in call order underneath, rung counts,
  read-only badges, and a warning on a POU no task calls.
- `LadderEditor` gained `pouId`, `focused` and `readOnly`. The global keydown handler bails when
  `!focused`, which is what stops four open windows all reacting to one keypress, and each
  window is handed `evalResults[pouId]` alone so editing one does not re-render the other three
  twenty times a second. It also gained `windowed`, which moves the toolbar *inside* the ladder
  scroller: a window body doesn't scroll (the ladder inside it does), so a toolbar above the
  scroller could never scroll out of reach and its `position: sticky` pin did nothing. Rendered
  inside, the pin means exactly what it means in the play column — pinned it sticks to the top
  of the program, unpinned it scrolls away with it.
- **Pins are drawn, not typed** (`components/PinIcon.tsx`). All three pins (window on-top, work
  order, ladder toolbar) were the 📌 emoji, which the font paints in colour whatever the CSS
  says, so an unpinned control still looked lit and the only thing separating the states was a
  ring around the button. The icon is `currentColor`: upright and filled when pinned, tilted
  and hollow when not — and because it carries its own state, `.pin-toggle.on` drops the ring
  the other toggles keep, which around a lit icon read as a second control behind the first.
- "Clear the desk" closes every window: the 3D-only view is simply that state, not a mode.

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

### 7. Landing page — `site/`
- **Its own workspace, its own Vite build.** One hand-written `index.html` (all the marketing
  copy, styles and markup, no framework) plus `demo/main.ts`, the playable rung in the hero.
  `npm run build:pages` runs `vite build` into `_site/`, then `scripts/build-pages.mjs` adds the
  two things Vite never sees: `docs/shots/` and the og:image.
- **The demo runs the shipped engine.** `demo/main.ts` imports `SimEngine`, `validateProgram`,
  `gradeProgram` and `GRADE_DT` from `@automationsolver/shared` and drives work order 02's real
  `PuzzleSpec` — its scenarios, its scoring, its failure text. Submit is the same two phases the
  server runs. The page once carried a hand-ported miniature solver instead; it was a second
  implementation of the one thing this project claims not to have twice, so it is now a build
  step rather than a copy. **Don't reintroduce one.**
- **Rendering rule: build the scaffold once, then repaint.** The grid guides, rails, cell click
  targets and branch dots are created a single time; a scan only flips `live`/`on` classes on
  nodes that already exist, and the element glyphs are redrawn only when the program changes.
  Rebuilding the SVG every scan destroys the node the pointer is pressing on, and a `click`
  only fires when press and release land on the same node — which silently swallowed most
  clicks the last time this was written the easy way.
- **Placement is idempotent**, matching the real editor: clicking a cell that already holds the
  selected instruction does nothing, rather than toggling it away, so a double click cannot undo
  itself. Erase is the eraser tool, a right click, or Delete on a focused cell.
- **Base-relative assets.** Pages serves from `/AutomationSolver/`, so `vite.config.ts` sets
  `base: './'`. Absolute asset paths 404 there.
- **Deployment** is `.github/workflows/pages.yml` on **every** push to `main`: `npm ci`, typecheck
  the demo, `npm run build:pages`, upload `_site/`. The `paths:` filter it used to carry is
  deliberately gone — in August 2026 GitHub began recording pushes to `main` (they appear in the
  repo's `PushEvent` list) without creating any run from them, while `workflow_dispatch` on the
  same file kept working. An unfiltered trigger costs about a minute of free Actions time and
  removes the failure mode; `gh workflow run pages.yml --ref main` remains the manual lever.

### 8. The plant scene — `features/sim/Factory3D.tsx` + `features/sim/factory/`

Procedural, not glTF, for a reason the other scenes do not have: the same excavator is visible
at every stage of its own build, so the geometry has to turn parts on and off and recolor them
as it moves down the line. That is a node-toggling chore in an imported model and a plain
function of machine state in code.

- **`Factory3D.tsx` is the plan of the floor and nothing else** — where each bay stands, which
  lane runs between them, which sign hangs over what — plus `FactoryRig` (the bare scene) and
  the canvas around it. Each bay is one file under `factory/`: `WeldBay`, `PaintBay`,
  `AssemblyBay`, `TestBay` (with the yard), `buffers` (the three queues between them),
  `Building`, `camera`. What they share lives in `factory/plant.ts` (layout constants,
  materials, `FINISH`, and the `numOf`/`strOf`/`boolOf` readers every bay narrows
  `MachineState` with), `factory/Excavator.tsx`, `factory/indicators.tsx` (bar gauge, stack
  light) and `factory/textures.tsx` (the canvas-painted slab, lanes and signs).
- **One composed scene, four camera presets.** `SECTION_FOCUS` is keyed by `FACTORY_SECTIONS`,
  and `SectionCamera` flies to the selected bay over `FLY_MS`, deriving the distance from the
  live viewport rather than baking it into a position. `MachineCanvas` is deliberately given no
  `fitExtent` here so that `SectionCamera` is the *only* thing touching the camera — two
  authorities fight on every resize.
- The floor plan is a **U**: weld -> weld buffer -> booth -> oven along the back row, the two
  painted lanes running across the middle, then assembly -> test queue -> test -> yard back
  along the front. A straight line 40 units long frames badly and no real plant builds one
  either. Painted floor chevrons say which way each leg runs.
- `ExcavatorFrame` / `ExcavatorHouse` / `ExcavatorCab` / `ExcavatorBoom` are the four pieces the
  line actually builds with, and `Excavator` assembles them with 0..1 fittings so the jig's job
  is watchable. The frame and the boom double as the two loose part types in every buffer.
- The scene takes the **coil image as well as the machine state**, because a snapshot cannot
  tell a torch that is striking from a seam that merely stopped.
- `memo` with scalar props on everything static, following `Warehouse3D`'s discipline: the sim
  re-renders this tree twenty times a second.

### 9. Constraints that shape everything
- **Zero native dependencies.** `npm install` must work with no C++ toolchain. No
  better-sqlite3, argon2, bcrypt, sqlite3. The README's "Zero native dependencies" table lists
  the established substitutions.
- **Determinism.** Nothing in `shared` may read the clock, `Math.random()`, or the DOM. This is
  enforced, not just documented: `npm run lint` (ESLint 10, flat config in `eslint.config.js`)
  bans those globals inside `packages/shared`.
