# Cold Chain Hub

The sequel to Automated Warehouse: a food distribution center run by a fleet of automated
forklifts, with processing steps between goods in and goods out. Everything about the
`distribution` category lives here — what it is for, what the plant does, what the two engine
additions it needed are, and what each puzzle settled.
[FEATURE-MAP.md](./FEATURE-MAP.md) is the whole codebase's "what exists"; this is a category deep
enough to need its own, like [FACTORY.md](./FACTORY.md).

> **Reference, not a queue.** [`TODO.md`](../TODO.md) is the only work list; this category's
> remaining items are its **P3b** section. Anything this document describes as not built yet is
> only scheduled if there is a box for it there.

## The vision

Automated Warehouse teaches a crane. The player drives it, stops it on its sensors, strokes its
fork, and the category's real subject — *scheduling* one machine that three customers want at
once — sits on top of a lot of low-level motion.

A distribution center run by AGVs is the next level up, and the point of the sequel is that the
player **never drives a vehicle**. A fleet manager does that, the way a real one does: it takes a
transport order (from here, to there), picks a free forklift, routes it, keeps it out of the way of
the others, and reports when the pallet is down. What is left for the PLC is everything the fleet
manager cannot know:

1. **Flows.** Which of four things wanting a forklift gets the next one. A goods-in dock that is
   not cleared blocks the truck behind it; a wrapper that is not fed idles the labeler; a ripening
   room that is not emptied cannot start its next batch.
2. **Storage policy.** Which lane a pallet goes into, and which lane the next one comes out of. A
   FIFO flow lane hands back its oldest pallet; a LIFO drive-in lane hands back its newest. Food
   ships **first expired, first out**, so where a pallet is put decides whether it can ever leave
   in the right order.
3. **Identity.** This is the premise that makes the other two real: **the plant has exactly one
   scanner, at QA.** Past that point no lane, room, conveyor or dock reads a label (cold rooms
   frost them, and scanners in every lane are money nobody spends). So the PLC is the warehouse
   management system — it has to *know* what is in every lane, in order, because nothing will tell
   it again. The plant checks those claims at the labeler and at dispatch, so a program that loses
   track of a pallet fails the way a real DC fails: a wrong label, a wrong advance shipping notice,
   or an old lot left behind a new one.

The player should finish the category able to look at a DC and say which *policy* is costing it,
not which machine.

## Two engine additions

Tracking identity through lanes means holding queues in data registers. The engine had no way to
address a register by a computed number, so it gets the two things a real FX has for exactly this.

### Index registers

`Z0`–`Z7` are word devices, written by `MOV`/`ADD`/`SUB` like any destination. An operand
`D100Z0` means the data register at `100 + Z0`. That is Mitsubishi's own indexed addressing, and it
is **located**: the player still reads real addresses off the monitor, which is why it does not
reverse the "no symbolic arrays" decision in
[VARIABLES-AND-POUS.md](./VARIABLES-AND-POUS.md) — `ARRAY[1..4] OF INT` stays out.

- Allowed on: compare operands, `MOV` source and destination, math operands and destination, the
  queue instructions' data and destination operands, and the queue head. **Not on `PID`**, whose
  state is keyed on its destination address.
- A puzzle opts in with `indexRegisters: true`. Without it any `Z` or indexed operand is a
  validation error and every existing message reads exactly as before.
- An effective address outside `D0`–`D9999` is an **operation error**: the instruction does
  nothing at all, a compare does not conduct, and the engine records it (`opDiagnostics`). It does
  not fail a scenario by itself — on a real FX it is a continuation error — but a failing step says
  it happened.
- A runtime fence stops an indexed or queue write landing on a plant register the player does not
  own. Built once, by `engineFor(spec, doc)`, and used by both the grader and the client runner so
  they fence identically.

### Queue instructions: `SFWRP`, `SFRDP`, `POPP`

The FX shift-register pair and its LIFO companion. Element shape: `device` is the **queue head**
(the pointer), `operands[0]` the data (`SFWR`) or the destination (`SFRD`, `POP`), `preset` is
`n`.

- **`n` counts the pointer**, the FX way: `K5` is a pointer plus four data words, `head+1` to
  `head+4`. A lane four pallets deep is a `K5` table, which is a small lesson in itself.
- `SFWR`: full (`pointer ≥ n-1`) writes nothing and records a notice; otherwise
  `pointer += 1`, then `D[head+pointer] = data`.
- `SFRD`: `data = D[head+1]`, shift `head+2…` down by one, `pointer -= 1`, write the destination
  last. The last word is left as it was, as on the FX.
- `POP`: `data = D[head+pointer]`, `pointer -= 1`. The word read is not cleared.
- Empty (`pointer = 0`) does nothing for `SFRD`/`POP`. A pointer outside `0…n-1` is an operation
  error.
- **Always edge-triggered.** A continuous `SFWR` at a 50 ms scan fills a `K5` table in four scans
  with nothing visible happening, which is why FX programs use the `P` forms. The block face says
  `SFWRP`/`SFRDP`/`POPP` so the behavior is written on it. The engine keeps a per-instance "was
  energized last execution" bit — the same memory the counter already keeps — and clears it on
  reset.

> **Verify before shipping:** the `n` convention and `SFRD`'s treatment of the last word against
> the FX3U programming manual.

### What is natural, and what is forced

The category does **not** force these instructions. A rung is up to 12 rows by 16 columns and an
output passes power to its right, so a compare-decoded lookup of twelve entries fits in one rung,
and a hand-built stack costs about as many rungs as `POP`. The decision (2026-09-23) was to unlock
each tool per puzzle and let table sizes and volumes make it the obvious one, rather than add an
element budget. `maxRungs` is sized from the canonical solution plus generous headroom and is never
tightened to force an approach.

Stated honestly per tool: index registers are strongly natural once a table holds more than a
handful of entries; `SFWR`/`SFRD` are natural once there are several lanes, because one routine
with an indexed head serves them all; **`POP` is the weakest** — a hand-rolled stack with a `Z`
pointer is about two elements longer. Its puzzles use several stacks so the gap compounds.

## The plant

`processId: 'distribution'`, `packages/shared/src/puzzle/processes/distribution.ts`. The numbers
below are the design targets; the plant box pins them and this section is updated with what was
measured.

### Locations

Every place a pallet can stand has a **location code**, which is what the mailbox speaks.

| Code | Location | Behavior |
|---|---|---|
| 1, 2 | Inbound docks | A truck drops pallets on a deterministic schedule; a dock left full blocks the next |
| 10 | QA station | The **only** scan: publishes product and lot into D registers, then pass or fail |
| 11 | Quarantine | Where a failed pallet goes; it never ships |
| 21, 22 | Ripening rooms | 4 deep, one door, so **LIFO**. Batch cycle on a timer, door interlocked |
| 31–33 | Flow lanes | Gravity pallet flow, 4 deep: load at the back, pick at the front, so **FIFO** |
| 41–43 | Drive-in lanes | 4 deep, one face, so **LIFO** |
| 50 / 51 | Wrapper infeed / labeler exit | An accumulating conveyor through the stretch wrapper; the labeler needs a door code |
| 61, 62 | Outbound docks | A trailer loaded front to back, so the trailer itself is **LIFO** |
| 70 | Charger | Capstone only |

Lanes and rooms publish **count, full and empty**. Nothing past QA publishes identity.

### The fleet manager

The PLC's interface is a transport-order mailbox, a four-phase handshake like a real
PLC-to-fleet-manager link:

1. The program writes the source into `D0` and the destination into `D1`, and raises `Y0` (REQ).
2. The manager accepts only while a vehicle is idle: it raises `ACK` and holds it until `REQ`
   drops, then drops `ACK`. `NAK` answers a malformed order (unknown code, source equals
   destination) and nothing else.
3. The nearest idle vehicle takes the job (ties broken by vehicle index). The program learns the
   pallet has arrived from the destination's own count.

`D0`/`D1` (and `D3`, the shipping notice) are declared as analog *output* devices, because the
grader only hands the plant the registers of `analogDevices(spec)`.

**Logistics mistakes are judged when the vehicle gets there**, not when the order is posted,
because that is when a real one finds out. An empty source is a fault. An occupied or full
destination makes the vehicle **wait holding the pallet**; a wait longer than `STALL_MS` latches
`stalled`. A correct program never gridlocks the plant.

A charge order is `D0 = 0`, `D1 = 70`, and it names no vehicle: the one with the lowest battery goes,
at once if it is idle or as soon as its current job is done, and the manager answers straight away
either way, the way a real one queues a charge request. `X26` is on from then until that vehicle is
full, and `D81`–`D83` are the batteries in percent.

### Kinematics

One to three AGVs on a one-way loop of about 30 m, with every location a spur stop off it. About
2 m/s, about 3 s per pick or drop. Zone blocking: a vehicle cannot enter the segment ahead while
another holds it, so a busy station queues traffic behind it, visibly.

Determinism is the same discipline as `tank.ts`, `axis.ts` and `factoryLine.ts`: integer
millimeters, a fixed `SUB_MS` internal sub-step with a carried remainder, vehicles iterated in
index order and every tie broken by index. **The first test pins that the fleet's trajectory is
identical at dt 10, 50 and 60 ms.** State is flat keys (`agv{i}Pos`, `agv{i}State`,
`agv{i}Load`, `agv{i}Batt`, a key per lane slot holding a pallet id, `pal{id}` = product x 100 +
lot) so replay and the 3D view read it directly.

`DC_LAYOUT` (loop and spur geometry in millimeters), `DC_LOCATIONS` and `DC_SECTIONS` are exported
and re-exported from `processes/index.ts`. They are the contract the 3D scene and the briefings
quote, the way `LINE_ZONES` is for the excavator line. Here the plant owns the geometry, unlike the
excavator line's, because distance is what the vehicles' timing is made of.

### What it checks

Latched faults, asserted through `expectMachine` exactly like the warehouse's `jam`, `starved`
and `blocked`, so the grader needs nothing new. Each carries a `jamReason` naming the pallet, the
lot and the place.

- `mislabel` — the labeler printed a door that is not where this pallet is going.
- **ASN mismatch** — at dispatch the program writes the product and lot it believes it is shipping
  into a report register and pulses a bit; the plant compares against the truth. This is lot
  traceability, the real reason a food DC tracks lots, and it is what makes identity matter even in
  a lane holding one product.
- `fefo` — shipped product P while *any* stored pallet of P holds an older lot, reachable or not.
- `buried` — a drop that puts a pallet over an older lot of the same product or over a different
  product in a LIFO lane. Latched *at the drop*, so the cause is findable; `fefo` alone would only
  fire when the damage shipped.
- `mixedBatch` — two products in one ripening room. `spoiled` — a ripening door opened mid-cycle.
- `stalled`, a truck leaving short or out of sequence, a flat battery.

### What was measured

- **Pace.** At 3 m/s, 0.8 s into and out of a pocket and a 1.2 s fork cycle, one pallet from
  IN1 through QA to OUT1 costs about 32 s with one vehicle, 21 s with two and 16 s with three
  (seven pallets: 221 s, 148 s, 113 s). One vehicle's pace is one lap of the loop plus three
  pocket visits and the check; that lap is what the one-way loop charges for every trip that
  has to go back upstream.
- **Park at last position.** The first cut sent every idle vehicle home after each drop, and a
  single vehicle took 57 s a pallet: it would set a pallet down on QA, leave, and then have to
  drive a whole lap to come back for it four seconds later. An idle vehicle now stays in the
  pocket it last worked in until another vehicle heads for that pocket, and only then goes home.
  Real fleet managers default to the same policy. A ten-second timeout was tried first and
  dropped: on a one-way loop "going home" is usually most of a lap, and it cost a freshly
  charged vehicle 17% of its battery to drive from the charger back to its bay. It never
  parks in a ripening room's doorway, where the door would close on it.
- **The charger sits just downstream of the parking bays** (s = 53.5 m, the end of the west
  leg). It was first placed upstream of them, which on a one-way loop is a lap away: a vehicle
  on 30% could not reach it.
- **A full battery lasts 1 km**, about eighteen laps (`BATTERY_MM_PER_UNIT` = 1000). It was first
  300 m, which in the capstone meant a vehicle ran flat 80 s into the shift while another sat on
  the one charger: charging was the whole job, and the flows were not.
- **The mailbox runs every sub-step.** It first ran once per `step()`, so an order waiting on a
  busy fleet was accepted at the first step boundary after a vehicle freed up, which depends on
  `dt`. The sub-step invariance test caught it the day lingering made mid-step idling common.

- **Stations in flow order.** The first floor plan put the outbound docks mid-way round the
  loop, upstream of the flow lanes' pick faces and the drive-in lanes, so every shipment from
  storage drove most of a lap to reach a dock and puzzle 58 blocked its own goods in. The loop is
  now 20 x 8 m (56 m) with the stations in the order a pallet visits them: docks in, QA, lane
  load faces, rooms, wrapper, parking and pick faces on the south leg, drive-in lanes, charger,
  and the outbound docks last, on the west leg, immediately upstream of the inbound docks.
- **A call is claimed when an order is accepted, not when it lands.** Calls first advanced on
  delivery plus a gap, which serialized every dock to one pallet per round trip and pushed
  puzzle 57 to 377 s. The manager now takes a dock's call when it accepts an order to that dock,
  checking the shipping notice's product against it, and the dock checks the pallet against the
  notice on arrival. Several shipments to one dock can be on their way. That exposed a real bug
  in puzzle 56's first canonical: its search skipped busy lanes, so two quick calls for the same
  product shipped a newer lot from another lane while the older one waited behind a move in
  flight. Search every lane; if the best one is busy, wait.
- **Receiving is by truckload.** Docks keep their own timetables (`in2First`, `in2Every`).
  Interleaving two products one pallet at a time left every ripening room closing on its quiet
  timer with a single pallet in it.
- **Measured scenario lengths** (canonical programs): 54 about 110 s, 55 113 to 200 s, 56 70 to
  143 s, 57 279 s, 58 231 s, 59 189 and 191 s. Step budgets are about 1.5 times these.
- **An older lot already being fetched is leaving.** With two docks both wanting potatoes, the
  order for lot 3 was accepted first and lot 4's second, and lot 4's vehicle, nearer its lane,
  lifted first: the first-expired-first-out check faulted a program that had released them in
  the right order. The check now counts the out-end pallets of any lane a vehicle is already on
  its way to collect from for a dock as gone. It still fires on a newer lot shipped while an
  older one sits unclaimed.
- **Trucks need the whole order before the first pallet.** A truck's lines are fed as it docks,
  and a program cannot tell the last line from a pause in the feed, so the plant publishes the
  order's length (`D15`, `D16`): a dock's stack is complete when its count reaches it.
- **The capstone's par is about charging late.** Measured over two shifts with the fleet starting
  between 16% and 30%: sending a vehicle to charge below 15% finishes in 189 s and 191 s, below
  18% to 70% takes 194 to 222 s, and below 10% or never runs one flat. Every charge fills the
  battery, so an early one takes a vehicle off the floor for longer and sooner than it needs. The
  draft lesson was *charge in the lulls*; with the batteries full enough to make that matter,
  charging was not needed at all, and a dispatcher that never charged was the fastest.
- **Dispatch priority did not earn a lesson.** Serving RIPEN and RECEIVE ahead of storage, and
  choosing only while a vehicle is free (the shipped FLEET commits the mailbox to whoever asked
  first), won 27 s in one shift and lost it in another as batteries changed. Swings of ±15% from
  small policy changes are the loop's nature: which vehicle is nearest when an order lands
  decides whether a banana reaches its room before the quiet timer. The capstone's briefing
  claims only what held in every run.
- **Grading cost.** `dc-hub` is the heaviest grade in the game. It first took about 4.7 s for
  two shifts (the excavator line 1.5 s), and profiling took it to about 2.4 s (the line to
  0.85 s), with every trace byte-identical: word operands parsed once and cached (`value.ts`),
  the rungs' highlighting detail skipped when a grade records no trace, a typed-array
  union-find with no per-scan closures (tsx wraps every named inner function in a naming
  helper, which alone cost 0.9 s), and the plant's state keys built once. What is left is
  spread thin: the engine's per-task copy of the bit image, and the plant's state bag, which
  is a dictionary of about 150 string keys. Grading in a worker is the fix that stops the
  request thread blocking at all, and it is a deployment change (the API is a Vercel
  function), so it is a TODO box of its own.

### The tutorial needs its bookings

The draft said the reservation bits could wait for the first two-vehicle puzzle, because with
one vehicle and an ACK only when it is idle, dispatch order is arrival order. That was wrong.
QA only reports a pallet once it lands, so a program that orders IN1 to QA whenever QA is empty
sends the second pallet while the first is still on the forks; the one vehicle carries the
second to a table the first is standing on, and stalls. And QA DONE stays on until a vehicle
has lifted the pallet, so a program without a pickup booking sends for it twice and the second
vehicle finds nothing. Both are provoked in `grade.test.ts`. So puzzle 54 teaches the two
bookings, and the reservation lesson of puzzle 56 becomes the *arrival order* one.

### Seeded stock without breaking the premise

A scenario that starts with stock in the lanes has pallets whose identities the player's tables
never saw. Rather than start every scenario empty (slow), the plant does a **stocktake download**:
on the priming step only, it publishes the initial lane tables into spec-declared registers in the
FX layout (pointer, then data). The plant never writes those registers again, so from the first
scan they are the player's. The table addresses are fixed by each spec, the warehouse's `D101`
precedent, and sit outside the player's memory pool.

## The puzzles

Orders 54–59, category `distribution`, in the `plants` track after `factory` — so no shipped
puzzle's `order` moves, and POUs and symbols are already familiar when puzzle 57 needs them. All
use `symbols: 'optional'`.

| # | Slug | Workspace / AGVs | New idea | What makes it needed |
|---|---|---|---|---|
| 54 | `dc-dispatch` (tutorial, demo) | single / 1 | The mailbox handshake, routing QA pass to a dock and fail to quarantine, and two bookings | No queues and no `Z` yet. The bookings are needed even with one vehicle (see below) |
| 55 | `dc-label` | single / 1 | Index registers: a door lookup `MOV D300Z0 D22`, and a hand-built ring FIFO (head and tail in `Z`) through the wrapper line | The labeler needs the identity of the pallet coming *out*; the line holds four to six mixed pallets |
| 56 | `dc-flow-lanes` | single / 2 | `SFWRP`/`SFRDP` with indexed heads (`D200Z0`, `Z0` = lane x 10); FEFO by reading lane fronts; reservations; the ASN report | Two vehicles seeded so arrivals reorder against dispatches: enqueue at dispatch and the tables lie. Volumes spread a product across lanes |
| 57 | `dc-ripening` | POUs / 2 | `POPP`: LIFO ripening rooms, batch purity, the door interlock, a timed cycle | Pallets leave a one-door room newest first, and each needs its identity for the ASN |
| 58 | `dc-drive-in` | POUs / 2 | Smart put-away across FIFO *and* LIFO lanes, with lots from two suppliers arriving out of order | Push only onto the same product with a lot no older than the top; peek the top with `MOV D300 Z1`, `MOV D300Z1 D41` |
| 59 | `dc-hub` (capstone) | POUs / 3 | SHIP and FLEET open: trailers loaded in reverse drop order (a `POPP` stack of order lines per dock), one pallet in flight per dock, battery charging, `parMs` | A pallet out of sequence, a late truck or a flat battery is a fault; charging too early passes and scores less (see "What was measured") |

Authoring rules the category follows, from the rest of the game: briefings in the manual format
with no em dashes; presets written `K=3`; sequential steps wait on `until` milestones, never fixed
deadlines; scenario budgets in the warehouse's 40–260 s range; every puzzle ships a canonical
solution and at least one plausible wrong answer in `grade.test.ts`.

## The 3D view

A Blender **kit**, not a whole-hall model: `D:\Code\Blender\Automation-cold-storage-assets.blend`
exports `packages/client/public/models/dc-kit.glb` (Draco, modifiers applied, about 300 KB). The
blend is a build product: `Automation-cold-storage-assets.build.py` beside it deletes everything
and builds the kit from nothing, and a `README` text inside the blend repeats its conventions.
The scene places clones from the plant's own geometry, so a layout change is a code change and
never a trip back to Blender.

**The roots**, one per asset, each cloned by name:

| Root | What the client drives |
|---|---|
| `AGV` | `AgvForks` (the lift, in Z), `AgvPalletAnchor` (parent a carried pallet here), `AgvBeacon` |
| `Pallet`, `Load_Bananas`, `Load_BananasGreen`, `Load_Avocados`, `Load_AvocadosGreen`, `Load_Tomatoes`, `Load_Potatoes`, `LoadWrap`, `LoadLabel` | All share the pallet's origin, so a stack is one transform. The green loads are the unripe fruit; `LoadLabelStripe` takes the dock's color |
| `FlowLane` | `FlowLaneSlot0`–`3` (0 is the pick end), `FlowLaneLoad` (where a dropped pallet lands before it rolls) |
| `DriveInLane` | `DriveInSlot0`–`3` (0 is the deepest) |
| `RipeningRoom` | `RoomSlot0`–`3` (0 at the back), `RoomDoor` (scale Z: 1 shut), `RoomRoof` (hide to see in), `RoomLamp` |
| `QaStation` | `QaSlot`, `QaLampPass`, `QaLampBusy`, `QaLampFail` |
| `QuarantineCage` | `QuarantineSlot0`–`3` |
| `DockIn` | `DockInSlot0`–`2` (0 is picked first), `DockInShutter` |
| `DockOut` | `DockOutShutter`, `DockOutLampRed`, `DockOutLampGreen` |
| `Truck` | `TruckSlot0`–`5` (0 at the front of the body), `TruckRoof` (hidden in the scene) |
| `Wrapper` | `WrapZone0`–`5`, `WrapTurntable` (spin), `WrapCarriage` (Z), `LabelerPad`, `LabelerLamp` |
| `Charger` | `ChargerLamp` |
| `Column`, `WallPanel` | Repeated round the hall |

**Conventions**, which the build script's docstring states and the client relies on:

- Meters, Blender Z up. The exporter turns Blender (x, y, z) into three's (x, z, -y), checked by
  parsing the GLB: `TruckSlot0` at Blender (0, 6.55, 1.2) arrives at (0, 1.2, -6.55).
- A station's origin is the middle of its front edge at floor level, the face a vehicle comes in
  from, and the station runs away from it along Blender +Y (three -Z). A lane is 1.4 m wide on
  the plant's 1.5 m pitch, and slots are 0.9 m apart.
- A pallet is 1.2 m along X and 0.8 m along Y, and stands that way in every slot: parent it to
  the slot with an identity transform. The AGV carries it 0.8 m along its forks, which is why
  `AgvPalletAnchor` is a quarter turn.
- The AGV is 1.55 m long, forks forward along +X, origin in the middle of its footprint.
- Every lamp lens has its own material, dark until the client lights it, the way the earlier
  scenes drive their stack lights through `emissive`.
- A root's rest position in the file is only there so the kit can be looked at; the client sets
  every transform.

Wider decisions:

- The model URL is base-relative (`import.meta.env.BASE_URL`), per the deployment rule. The older
  scenes' `'/models/...'` is not the pattern to copy.
- Pallets are drawn from the plant's **true** identity, so when a player's tables are wrong the
  view shows it before the grader does.
- Every moving thing is a pure function of `machine`, with no clock of its own, so replay shows
  exactly what the live run showed.
- One view serves both layouts: a panel in the single-program puzzles, the whole stage plus
  section cameras (keyed on `DC_SECTIONS`) in the plant workspace.

**What the scene settled** (`features/sim/Distribution3D.tsx`, `distribution/layout.ts`,
`distribution/plant.ts`):

- **The floor plan exists once.** `layout.ts` turns the plant's stops and sides into scene
  frames: a station's front edge stands 1.2 m off the loop (1.65 m for an outbound dock, so its
  wall is behind the vehicle's pocket), and a vehicle in a pocket stands 1.15 m off it, where
  its forks reach the first slot. With those, a flow lane is exactly the 5.6 m between its two
  faces, which a test pins. `DC_SECTIONS` in the plant names the locations each section owns,
  and a section camera frames their floor.
- **Two roofs come off.** A closed room hides its batch, and a closed trailer hides the load
  order the capstone is about. The kit keeps both roofs as their own nodes (`RoomRoof`,
  `TruckRoof`) and the scene hides them.
- **The building is only the two walls the camera faces**, west (the truck doors) and north
  (the goods-in doors, stepping back behind the rooms), with each puzzle's dock doors cut out of
  them. East and south are open floor with columns, so the loop can be seen.
- **How it was checked without a browser.** The layout code was run against a real capstone
  trace and the placements rebuilt in Blender from the kit's own objects, which is what caught
  the closed trailer and a wall run built backwards. `plant.test.ts` then rebuilds the GLB's node
  tree from its JSON chunk and poses a state against it, so a renamed slot fails a test.
