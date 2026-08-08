# The Excavator Plant

Everything about the `factory` category in one place: what it is for, what exists today, what
is half built, and what is left. [FEATURE-MAP.md](./FEATURE-MAP.md) is the whole codebase's
"what exists"; this is the one category deep enough to need its own.

> **The plant is being rebuilt.** [FACTORY-LINE-DESIGN.md](./FACTORY-LINE-DESIGN.md) is the
> locked specification for the new floor: 55 x 38 m, a **fully zoned conveyor the player
> programs** as a seventh section, and all six stations retimed so the bottleneck moves. It
> supersedes this document's layout, its I/O totals, its station timings and the "deliberately
> left out" note about a conveyor spine. What stays true here is the vision, the two-plants
> decision, and the plain-versus-tuned pairing.

## The vision

Every other category in this game teaches a **machine**. A drill station, a packaging line, a
stacker crane — each is one mechanism, sequenced end to end, and a correct program is a program
that drives it safely through its cycle.

A factory is not a bigger machine. It is several machines that only work as one, and almost
everything that makes it hard is in the word *as*. A weld bay can run flat out and starve final
assembly. A paint booth can hold a perfect cure and still block the line. A supervisor can stop
everything safely and leave a part baking in an oven. None of those are bugs in a station. They
are what happens when six correct programs are put next to each other by somebody who was only
ever looking at one of them.

So the category has three jobs, in order:

1. **Teach structured programming.** POUs, tasks, a scan order, an interface block of bits one
   section publishes and five others read, and a device space fenced by ownership so a section
   reaching into its neighbor's relays is a validation error rather than a bug nobody finds for
   a week.
2. **Make transport the program.** On a station, parts appear. Here a part is welded onto an
   outfeed roller, stacked into a rack lane, lifted by a portal robot, set on a booth skid,
   baked, discharged into a lane and married in a jig — and every one of those moves is a coil
   somebody has to drive at the right moment. A part left standing on an infeed is a part the
   station behind it cannot release.
3. **Make "correct" and "good" different words.** Every station has a plain program that works
   and a better one that costs about the same number of rungs. The plain one is not a straw man;
   it is what a careful engineer writes in an afternoon, and every second it gives away is given
   away for a reason that looked like caution at the time. Correctness passes and unlocks what
   comes next. Throughput is scored on top.

The player should finish the category able to look at a running line and say *which station is
holding it up* — which is the only question that matters on a real one.

## Two plants, deliberately

There are two process models, and that is a design decision rather than an accident.

| | `factory` (`processes/factory.ts`) | `factory-line` (`processes/factoryLine.ts`) |
|---|---|---|
| Used by | puzzle 47, the commissioning tutorial | every puzzle after it |
| Sections | 5 (SUP, WELD, PAINT, ASSY, TEST) | 6 (+ STORE) |
| Buffers | numbers | a rack the program loads and picks |
| Cure oven | welded to the spray booth, fixed dwell | its own machine, two racks, bake set by film |
| Yard | fills up and stops the line | served by a haulier the program calls |
| I/O | 19 in / 19 out / 4 registers | 32 in / 28 out / 18 registers |

The tutorial plant is the real one with the awkward parts taken out. That is the right plant to
*meet* and the wrong one to work on: a first factory puzzle whose lesson is "here is a run
latch" should not also be asking which of four rack lanes a boom belongs in.

Splitting them rather than feature-flagging one model was the second decision. An earlier pass
did put the extra kit behind `devices`-based feature detection, the way `drill` and `elevator5`
do — and it worked, and it was wrong. Those models detect *options on one machine*. Here the
flow itself is different: parts take a different route, `X10` means a different thing, and a
`stepPaint` branching six ways on which oven was fitted is worse than either version of it
written plainly. Puzzle 47 is now provably untouched, which is worth more than the shared code.

## The line

```
  WELD ──▶ outfeed ──▶ RACK STORE ──▶ PORTAL ──▶ BOOTH ──▶ OVEN ──▶ lanes ──▶ ASSY ──▶ TEST ──▶ DOCK
  fixture              4 lanes × 2     travel     blast      2 racks   frames    jig +    rig +   haulier
  positioner           sorted by       lower      spray      bake by   booms     bench    yard
  tip                  type            vacuum     purge      film
```

Two part streams run through all of it — chassis **frames** and **booms** — and final assembly
needs one of each. That single fact is what makes every station's local optimum wrong if it is
taken alone.

### The three things that make it hard

**The mix.** Every station has to run 1:1 whatever else it is optimizing. A weld shop that runs
the quick part flat out fills the rack with booms and starves the jig, and the plant looks busy
while shipping nothing.

**The color.** Machines are built to an order book and both halves of a machine carry its color.
The gun holds one color at a time; changing it costs a purge. Because a part's color is decided
when it is *sprayed*, the order the store feeds the booth is what decides which machine each
part belongs to — feed two frames in a row and the frame lane and the boom lane drift a machine
apart, and the jig marries a frame to a boom in the wrong color. There is no way to see that
coming from inside the assembly program. The mistake was made in the store, minutes earlier.

**The tempo.** Six stations, each with slack in the wrong place: a second seam pass a boom never
needed, a make-up bench that could have run during the engine drop, a purge that could have run
during a blast, a lorry sent for ten seconds too late.

## What each station is

### Weld
A fixture with a **rotating positioner**. A frame is a hull and takes two arc passes with a
roll-over between them; a boom is a stick and takes one. There is no seam-complete sensor — the
program times each pass — and the torch may not strike while the positioner is moving. Running
the arc over a seam already laid is not a crash; it re-melts a sound cap, which costs exactly
what it looks like it costs, which is the time.

The **contact tip** is good for eight passes and then has to be changed on an empty fixture, at
whatever moment the program chooses to spend three seconds. The check falls when a *weldment* is
started, not a pass, so a frame half welded in the jaws is always finished.

- `X4` `X5` blanks · `X6` clamped · `X7` `X8` positioner A/B · `X9` tip worn · `X10` outfeed occupied
- `Y2` clamp · `Y3` torch · `Y4` rotate · `Y5` release · `Y6` select boom · `Y7` change tip
- Frame pass 1100 ms ×2, rotate 600 ms; boom 1200 ms ×1; clamp 500 ms; release 400 ms

### Rack store and portal robot
**Four gravity lanes, two deep**, loaded and picked by lane number (`D13`, `D14`) rather than by
a fork on an axis — the ASRS category already teaches positioning, and what is new here is
*sorting*. Frames down two lanes and booms down the other two buys eight parts of buffer instead
of two, and turns the booth's next part into a choice rather than whatever turned up.

The **portal robot** spans the aisle: travel, lower, vacuum, raise, travel. Every rule on it is
a rule a real portal has — it cannot travel with the head down because the head hangs below the
rail, and it cannot let go with the head up because the part is then two meters over the floor.

- `X11` part at infeed · `X12` boom at infeed · `X13` part at outfeed · `D4..D7` lane counts
- `X14` `X15` at store / at booth · `X16` `X17` down / up · `X18` part held
- `Y8` load · `Y9` pick · `Y10` `Y11` travel · `Y12` lower · `Y13` vacuum

### Paint
The booth and the oven are **two machines**, so the next part is blasted while the last one
bakes. Film builds at flow × time and only inside the cure band; a frame wants 200–320 um and a
boom 140–260, and **bake time scales with film**, so paint sprayed on is paint baked off the
clock later. That is the paint shop's lever: a boom given the frame's recipe costs spray time in
the booth and a second helping of it in the oven.

Four drums on the wall; spraying with the selector on a drum the line is not loaded with pulls
the old color through behind the new one and the part is scrap. A purge flushes to the waste pot
and takes exactly one blast cycle. It was meant to be a second lever — spend it during a blast
for free, or with the booth standing empty and pay for it — but there is no way to spend it
badly: the flush does not stop the stage machine, so any purge started when a part lands is
already hidden inside that part's blast, and no sensor tells the program the blast has finished.
Gating it on an empty booth is not a slow program but a stopped one, since the portal refills
the skid within half a second. So the purge is a **correctness** trap here, not a timing one:
purge onto no drum, or spray while purging, and the station faults.

- `X19` part at booth · `X20` boom in booth · `X21` oven full · `X22` lane full
- `D0` booth temperature · `D1` film · `D8` next color due · `D9` color in gun
- `Y14` spray · `Y15` oven infeed · `Y16` purge · `D2` heater · `D3` flow · `D15` drum select
- Cure band 90–130 °C; bake = 3000 ms + film × 1.25; purge 1200 ms; order book of 12 machines

### Final assembly
Engine, then cab, then boom — each interlocked on the one before it. The **make-up bench** hangs
cylinders and hoses on the boom the jig is already holding, so it needs nothing but a boom and
can run at the same time as anything; a program that runs it in its turn is correct and gives
away every second of it. A jig holding half a machine it can never finish latches `starved`
after 16 s. A frame and a boom from different order lines jam on the pin.

- `X23` `X24` frame / boom ready · `X25` boom made up · `X26` complete · `X27` test bay clear
- `D10` `D11` color at the head of each lane · `D16` `D17` color in the jig
- `Y17` `Y18` call · `Y19` engine · `Y20` cab · `Y21` make up · `Y22` pin · `Y23` release

### Test and dispatch
Pump to pressure, run the function cycle, drive it off. The bay couples through a **quick
release**, and a quick release dragged off the pad under pressure comes away with the hose in
it. The yard holds six and is served by a **haulier**: `Y27` raises a call, holds the truck on
the dock, and drops to send it away. Nothing can be hurried — ten seconds to arrive, a driver's
hours that will not wait past fifteen, and a rotation before the dock takes another. Calling on
a full yard stops the line for the whole arrival; calling too early sends a lorry away part
loaded and shuts the dock for a rotation.

- `X28` at test · `X29` passed · `X30` yard space · `X31` truck at dock · `D12` machines in yard
- `Y24` pump · `Y25` function test · `Y26` dispatch · `Y27` call truck

## Every station in two forms

`content/factory-line-programs.ts` carries each station twice.

**`*_PLAIN`** runs the line, never faults, and leaves about a quarter of the plant's output on
the floor. Every one of its concessions is a plausible one: give every part the heavier part's
treatment at the fixture and again at the gun, use one lane so the sequence cannot get out of
order, claim both parts together so the jig is never caught holding half a machine, send for the
lorry when there is nowhere left to put a machine.

"Never faults" is load bearing rather than decorative, and it is the property the soak test
exists to hold: the capstone seeds all six sections with these, so a plain program that stops
the line is not a slow answer the player improves on but a broken plant they are handed.

**`*_TUNED`** is the same station after somebody has thought about it, in about the same number
of rungs — and is the canonical solution for that station's puzzle.

That pairing does two jobs. A station puzzle ships **tuned neighbors**, so the bay under test
really is the one holding the line up rather than being masked by an untuned one upstream. The
capstone seeds all six sections with **plain** programs, because there the plant is the puzzle:
the player is handed a line that works and asked to make it earn more.

## Engine work this needed

All additive; nothing existing changed behavior.

- **`PouSlot.program` on an editable slot** is now a *starting point* rather than only a
  read-only fixture. `initialProject` seeds from it. A capstone that hands over a whole plant
  cannot ask for six programs from a blank page, and does not want to — the interesting question
  is not "can you write a line" but "here is one that works, now make it earn more", and the
  answer to that begins by reading code somebody else left you.
- **`Scenario.initialMachine`** merges over the process model's `init`, so a puzzle about one
  station of six can start the run where the lesson is instead of spending forty seconds filling
  the five bays upstream of it.
- `LINE_SECTIONS` and `LINE_LIMITS` exported the way `FACTORY_SECTIONS` / `FACTORY_LIMITS` are,
  so the 3D view and the briefings quote one set of numbers.

## Progress

### Shipped
- **Puzzle 47 `factory-supervisor`** — the commissioning tutorial. Four stations ship working
  and read-only; the player writes the supervisor whose one bit lets them run. Unchanged by all
  of the above and verified so.

### Built, tested, not yet wired to a puzzle
- `processes/factoryLine.ts` — the six-station plant, complete.
- `content/factory-line-plant.ts` — device map, analog ranges, per-section ownership blocks,
  the supervisor program.
- `content/factory-line-programs.ts` — all five stations in plain and tuned form, 118 rungs.
- `processes/factoryLine.test.ts` — 48 tests: dt-independence for the fixture and the booth's
  integrators, every station's interlocks and faults, and a **soak** that runs all six sections
  together for a three-minute shift in all seven shipped combinations (all tuned, all plain, and
  each station plain against tuned neighbors). That soak is the guardrail the per-station tests
  cannot be: both bugs below ran clean for a minute apiece before they stopped the line for good,
  because each section was correct on its own and only collided once the buffers filled.
- Repo is green: `npm test` (365 tests), `npm run typecheck`, `npm run lint`.
- Tuned end to end: **9.1 s/machine**, no faults, no scrap. Plain end to end: 11.5 s/machine —
  a quarter of the output left on the floor, which is what the pairing promised.

### Fixed
- **The portal robot's step latches collided with the rack's room flags.** `PORTAL_CYCLE` used
  M41-M45 for its five-step chain while `STORE_TUNED` drove `M41` as a level `OUT` coil meaning
  "there is room in a boom lane" — and drove it from a rung *above* the portal's, so the latch
  the chain set on one scan was overwritten on the next. The portal stopped being a sequence and
  became a follower of a rack flag, which still moves and so still reads as working; it stalled
  for good the first time that flag went false and stayed false, which on a rack is the moment
  the rack fills. Fixed by fencing the portal into **M60-M64** at the far end of the section's
  block, documented in place as a block nothing else may touch.
- **`PAINT_PLAIN`'s purge could never run.** It gated the flush on `nc X19` — an empty booth —
  and the booth is never empty for the 1200 ms a purge takes, because the portal stages over the
  skid holding the next part and drops it within ~400 ms of the booth clearing. The first
  changeover therefore deadlocked the line: a part in the booth that could not be sprayed
  (`D9 <> D8`) and a gun that could not be flushed. Regated on `nc Y14` like the tuned version.

### Known open
- **Only the weld bay and final assembly have a throughput lever.** Measured over a 300 s shift,
  swapping one station from tuned to plain against tuned neighbors costs: weld 33 → 26 machines,
  assembly 33 → 31, and store, paint and test **33 → 33, exactly**. From all-plain, tuning the
  weld bay alone recovers 26 → 31 and tuning any other station alone recovers nothing at all.
  The line is weld-paced, so three of the five station puzzles currently have a lever that
  measures zero and the capstone reduces to "fix the weld bay". See *Balance* below.

### Not started
- The balance pass described below, which the specs depend on.
- The five puzzle specs and briefings.
- Canonical solutions in `grade.test.ts`, and the negative tests that prove the plausible wrong
  answers fail.
- Par calibration for each station and for the capstone.
- The 3D scene: `Factory3D` and `features/sim/factory/` currently draw the five-section plant.
  The rack wall, the portal robot, the drum bank, the dock and the conveyor runs are all still
  to build, along with the fencing, hazard striping, floor markings and per-bay HMI panels that
  make it read as a shop floor rather than four objects on a slab.

## The plan

Five puzzles, one per *area* rather than per section, since there are six sections now.

| # | Slug | Opens | The lesson | The lever |
|---|---|---|---|---|
| 48 | `factory-weld` | WELD | sequence a fixture with a positioner; alternate the mix; live with a consumable | one seam schedule per part, not one for both |
| 49 | `factory-handling` | STORE | sort a rack by type; drive a portal robot; de-couple two neighbors | four lanes instead of one, and a picker that chooses |
| 50 | `factory-paint` | PAINT | hold an analog band; spray to a spec; batch a changeover | purge during the blast, and bake no longer than the part needs |
| 51 | `factory-assembly` | ASSY + TEST | interlock a build; take a calculated risk on supply; run a dock | the bench beside the jig, and a lorry sent for early |
| 52 | `factory-line` | all six, seeded plain | the plant is the puzzle | all of the above, at once, against the clock |

**Grading.** Correctness is the pass and unlocks what follows, as everywhere else. Throughput
takes the same 15 marks and the same `PAR_SLACK` taper the rest of the game uses. Station
puzzles grade against that station's own output (`welded`, `painted`) so a par is not silently
set by a neighbor; the capstone grades time to ship a fixed number of machines, which is the
same question as output in a fixed window and reuses `parMs` rather than inventing an axis.

## Balance

The station timings need a pass before any of the five specs are written, because three of the
five levers in the table above currently measure nothing. Per machine, each station's own cycle
comes to roughly:

| Station | Per machine | Notes |
|---|---|---|
| Weld | ~7.2 s | 3.9 s frame + 2.2 s boom + ~1.1 s amortized tip change |
| Assembly | 6.4 s | engine 2.2 + cab 1.8 + pin 2.4, with the bench overlapped |
| Oven | ~5.2 s | two racks, bake 3.0 s + film × 1.25 |
| Test | 5.2 s | pump 1.2 + cycle 2.6 + dispatch 1.4 |
| Booth | ~2.8 s | blast 1.2 + spray ~0.2, twice |

Weld is the constraint by a full second over the next station and by more than two over the
rest, so the store, the booth and the dock are never asked for anything they cannot already do.
Two ways out, and they are not exclusive:

1. **Grade a station puzzle on the station**, which the plan already half says: score `welded`
   or `painted` rather than `shipped`, and use `Scenario.initialMachine` to start the run with
   the bay under test actually loaded — a rack that begins full, an order book that begins on a
   changeover, a yard that begins nearly full. A lever invisible at the line's pace is plainly
   visible when the station is the thing being asked for output.
2. **Close the gap between the stations** so the capstone is a six-way optimization rather than
   a one-way one. The booth in particular is idle better than half the time.

The store has a third problem underneath the timing one: `STORE_TUNED` sorts by type, but the
weld bay hands over frames and booms strictly turn about, so plain FIFO out of one lane already
produces a perfectly alternating feed. Sorting can only pay for itself when the arrival order is
*disturbed* — by a tip change landing mid-pair, or by a weld schedule that batches. Puzzle 49's
scenarios have to create that disorder or its lesson has nothing to bite on.

**Deliberately left out for now.** A conveyor spine with stoppers and diverters at each station.
The store and the portal already make transport programmable, and a third transport mechanism
would add I/O without adding a lesson. If the plant ever needs a fifth teachable station, that
is where it comes from.
