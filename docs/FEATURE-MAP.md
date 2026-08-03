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

### 3. Puzzle system — `shared/src/puzzle/`
- **`PuzzleSpec`** (`types.ts`) — a discriminated union on `kind`:
  - **`LadderPuzzleSpec`** (`kind: 'ladder'`) — briefing, hints, `devices` (the physical I/O),
    optional `registers` (internal M/T/C the puzzle expects, surfaced as an IO list),
    `allowedInstructions`, `maxRungs`, a `processId`, and graded `scenarios`.
  - **`CabinetPuzzleSpec`** (`kind: 'cabinet'`) — same base (devices/scenarios/briefing) but a
    fixed `cabinet` component layout instead of ladder fields; the player's "program" is a
    `WiringDoc` (see §3b).
  - **`briefing`** is written as an instruction manual, not prose: a one-paragraph lead, then
    `## Section` blocks (`Equipment`, `Sequence of operation`, `Interlocks and safety`,
    `Field notes`, `Acceptance`; cabinet puzzles use `Power circuit` / `Control circuit` /
    `Indication` / `Safety rules`). Blocks are separated by blank lines; `1.` (with optional
    `a.` sub-steps) becomes an `<ol>`, `- ` a `<ul>`, anything else a paragraph. The renderer
    is `Briefing` in `client/src/pages/play/BriefColumn.tsx`.
  - Every spec also carries a **`category`** (`basics` / `timers-counters` / `stations` /
    `elevator` / `control-cabinet` / `packaging` / `pick-place` / `drill` / `process-control`) —
    the unit of unlock progression and list grouping (`CATEGORY_ORDER` / `CATEGORY_TITLES` /
    `CATEGORY_BLURBS` in `types.ts`).
  - **Analog devices** set `signal: 'analog'`, address a `D` register and carry an
    `AnalogRange` (raw count span plus what those counts mean in the field). Transmitters
    report **raw counts**, never pre-scaled engineering units, because that is what an A/D card
    actually hands the CPU — scaling it is the first puzzle's lesson. `defaultInputs`,
    `inputDevices` and `outputDevices` all skip them; `analogDevices()` returns them.
- **Process models** (`processes/`) — small state machines that react to `Y` outputs and drive
  `X` inputs. Registered via `registerProcess`.
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

Categories: 1–3 `basics`, 4–7 `timers-counters`, 8 + 10 `stations`, 11–14 `elevator`,
15–20 `control-cabinet`, 21–24 `packaging`, 25–28 `pick-place`, 29–32 `drill`,
33–37 `process-control`, 38–41 `motion`.

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
    elevator's contract, via `OrbitControls` with `enableRotate={false}`), or neither.
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
  - **`TankVessel3D.tsx`** (`processId: 'tank'`, `interactive`) — the one scene built
    **procedurally** rather than from a `.glb`, on purpose: every other machine's interest is in
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
