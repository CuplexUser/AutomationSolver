import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * The spine: twelve zones, one photo-eye and one drive on each.
 *
 * The section that makes this category's stated vision literal rather than
 * aspirational. Transport stops being the thing between the stations and becomes
 * a station, and it is the one the other six all have to hand parts to.
 *
 * Three rules carry the whole puzzle, and only the third is a surprise:
 *
 * 1. A zone's drive runs that zone's *own* belt, and a part only enters a zone
 *    while that zone is running and clear. So a program does not push parts along
 *    the spine, it decides which stretches of belt are turning.
 * 2. Nothing faults. A drive called with a full zone in front turns under a part
 *    that is going nowhere, which is why a badly written spine is slow rather
 *    than broken.
 * 3. **You cannot pick a part off a moving belt.** A station lifting from a zone
 *    needs that zone stopped. Without this the answer to every zone is "run it
 *    all the time" and accumulation does the rest, which is a mechanism with no
 *    decision in it. With it, a zone has to be run to fill and stopped to empty,
 *    so the program has to know which of those it is doing.
 *
 * Rule 3 is what makes this gradeable at all. "Run everything always" stops the
 * store's loader, the jig and the test bay from ever taking a part, so the line
 * ships nothing; "run nothing" blocks the weld bay's release. Both fail on
 * correctness rather than on pace, which is the right way round.
 *
 * ## On the lever
 *
 * FACTORY-LINE-DESIGN.md §3 claims the spine is the biggest lever in the plant
 * and §5a records that it measures **zero** over a balanced 300 s shift. Writing
 * this puzzle tried to recover the lever inside a scenario and could not: under
 * a full yard, with the rack full, both painted lanes loaded and two machines
 * standing on the outfeed run, `CONV_PLAIN` and `CONV_TUNED` ship the same ten
 * machines in ninety seconds. The plain spine holds its queue back at the
 * stations instead of out on the belts, which is visible on `D19` and costs
 * nothing. So the lever is zero everywhere, not merely in the balanced case.
 *
 * This puzzle therefore grades **correctness**, and there is a great deal of it:
 * twelve zones, the pick-off-a-stopped-belt rule that a "run everything" answer
 * breaks silently, a diverter that crashes if it reads the part wrong, and a
 * line that has to survive back-pressure without deadlocking. `parMs` is
 * calibrated to catch a spine that stalls parts needlessly; it does not separate
 * the two shipped programs, and no assertion here pretends it does.
 *
 * If the lever is wanted, it needs the plant change §5a describes (the booth's
 * infeed off a zone rather than off the portal's skid) and this spec's third
 * scenario is where it would show up.
 */
export const factoryConveyor: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-conveyor',
  title: 'Excavator Line: The Conveyor',
  difficulty: 'hard',
  order: 49,
  category: 'factory',
  summary:
    'Twelve zones of accumulating conveyor and one diverter. Decide which belts are turning, and which have to stop.',
  briefing: [
    'The line is fifty five metres long and nothing on it moves on its own. Between the weld',
    'bay and the dock there are twelve zones of roller conveyor, each with one photo-eye and',
    'one drive, and a diverter half way along that has to tell a frame from a boom.',
    '',
    'All six stations ship working. The conveyor is empty, so at the moment the weld bay has',
    'nowhere to put a weldment and everything downstream of it is standing idle.',
    '',
    '## Sections and tasks',
    '- SEC6_CONVEYOR is yours. The other six are read only.',
    '- All seven run from one task, MAIN, every scan. The spine is scanned last, after the six',
    '  stations have decided what they want.',
    '- You own Y28 to Y41, M160 to M199, T60 to T69, C60 to C69 and D80 to D99.',
    '',
    '## Equipment',
    '- Twelve zones, in the order a part travels them. Z1 to Z3 carry bare steel from the weld',
    '  bay to the rack store. Z4 to Z7 carry painted parts from the cure oven down to the sort.',
    '  Z8 and Z9 are the two painted lanes into final assembly. Z10 to Z12 take finished',
    '  machines out through the test bay to the dock apron.',
    '- Each zone has an eye and a drive: X32 and Y28 are Z1, X33 and Y29 are Z2, and so on in',
    '  step up to X43 and Y39 for Z12.',
    '- Z8 and Z9 hold three parts each. Every other zone holds one.',
    '- At the sort: X44 BOOM AT SORT reads what is standing on Z7, X45 and X46 say the frame',
    '  lane and the boom lane are full, and Y40 and Y41 are the two paddles.',
    '- D18 PARTS ON SPINE and D19 BLOCKED AT ZONE are gauges, not commands.',
    '',
    '## Sequence of operation',
    '1. Run each zone so that parts move down the line and queue up behind whatever is in',
    '   their way. A zone takes the part behind it only while that zone is running and clear.',
    '2. At the sort, read X44 and paddle the part into its own lane on Y40 or Y41.',
    '3. Stop a zone when the station on the end of it is lifting a part off.',
    '',
    '## Interlocks and safety',
    '- Both paddles at once is a crash. The part goes into the gap between the lanes.',
    '- A frame paddled into the boom lane, or a boom into the frame lane, is a crash too. The',
    '  jig calls for a boom, gets a frame, and the two streams drift a machine apart.',
    '- Nothing else on the spine faults. A drive called into an occupied zone simply turns',
    '  under a part that is going nowhere, which costs seconds and breaks nothing.',
    '',
    '## Field notes',
    '- You cannot pick a part off a moving belt. The store loader lifting off Z3, the jig',
    '  calling a part off a painted lane, and the test bay taking a machine off Z11 all need',
    '  that zone stopped. A spine that runs every belt all the time never delivers anything at',
    '  all, and it will look like it is working.',
    '- The paddle at the sort needs the lane it is pushing into to be turning to take the',
    '  part, while the jig needs that same lane stopped to lift one off it. That is one coil',
    '  asked for two opposite things, and sequencing it is the sort of whole problem.',
    '- A zone advance takes 0.5 s and the paddle 0.4 s.',
    '- D19 names the furthest downstream zone that cannot move on, which is the front of the',
    '  queue and therefore the station holding the line up. Zero means the spine is flowing.',
    '- Interlocking a whole run on the station at the end of it is sound and understandable,',
    '  and it holds up a part three zones back that had a clear road in front of it.',
    '',
    '## Acceptance',
    '- Parts travel the whole line: welded, stored, painted, sorted, married, tested, dispatched.',
    '- Frames go down the frame lane and booms down the boom lane, every time.',
    '- Both paddles are never called together.',
    '- With the yard full and no lorry due, the line backs up onto the spine without jamming,',
    '  and clears itself once the lorry has been and gone.',
  ].join('\n'),
  hints: [
    'Start with one rung per zone and the simplest rule that can work: run this belt while ' +
      'this zone is clear. That is an NC contact on the zone eye driving the zone drive, ' +
      'twelve times over. A zone with nothing on it pulls in whatever is behind it and then ' +
      'stops, which is exactly what accumulation is.',
    'That rule is also what stops the belt at the right moment. A zone holding a part has ' +
      'its own eye made, so its drive is already off, and the station on the end of it can ' +
      'lift the part away. You do not need a separate rung to stop a zone for a station.',
    'The two painted lanes are the exception and cannot follow the rule, because they hold ' +
      'three parts and their eye reads occupied rather than full. Run each lane only while ' +
      'you are paddling into it, and it will be stopped every other moment, which is when ' +
      'the jig wants it.',
    'The sort is two coils per direction, not one. Raise the paddle and run the lane it ' +
      'pushes into, together, off the same rung: a paddle raised against a dead lane leaves ' +
      'the part standing on Z7 for ever.',
    'X45 and X46 say a lane is full. Divert into a full lane and the paddle strokes against ' +
      'a lane that cannot take the part, so put them in series with their own paddle.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'D18', label: 'Parts on spine', note: 'read only, a gauge for the whole line' },
    { address: 'D19', label: 'Blocked at zone', note: 'read only; 0 while the spine is flowing' },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  pous: lineSections({ open: ['CONV'] }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  scenarios: [
    {
      name: 'A part reaches the booth',
      description:
        'Run A end to end: the weld bay can let go, and the store can lift a part off a stopped belt.',
      steps: [
        {
          label: 'Auto and start, and the weld bay rolls its first weldment onto Z1',
          setInputs: { X3: true, X0: true },
          holdMs: 8000,
          until: { machine: { welded: 1 } },
          expect: { Y0: true },
          expectMachine: { jam: false },
        },
        {
          label: 'It travels the run and the loader stacks it into the rack',
          setInputs: { X0: false },
          holdMs: 10_000,
          until: { machine: { lane0: 'f' } },
          expectMachine: { jam: false, blocked: false },
        },
        {
          label: 'The portal takes it to the booth and the gun starts on it',
          holdMs: 12_000,
          until: { machine: { sprayed: 1 } },
          expectMachine: { jam: false, blocked: false },
        },
      ],
      // 10.85 s for the canonical spine. Calibrated to catch a spine that stalls
      // parts needlessly; `CONV_PLAIN` reaches this milestone on the same scan.
      parMs: 11_400,
    },
    {
      name: 'The sort keeps the two streams apart',
      description: 'Painted parts come off the oven mixed and have to leave the sort separated.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Three excavators are built, so six parts have been through the sort',
          setInputs: { X0: false },
          holdMs: 140_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      parMs: 49_800,
    },
    {
      name: 'The yard fills and the queue grows backwards',
      description:
        'Six machines in the yard and a haulier who has just left. The line has nowhere to put anything.',
      // Mid shift with the haulier late: the rack is full, both painted lanes are
      // loaded, two finished machines are standing on the outfeed run and the
      // yard has no space. The dock apron cannot discharge, so the test bay
      // cannot dispatch, so the jig cannot release, and the line goes down from
      // the far end.
      //
      // Counters and buffers only, per the `initialMachine` contract: nothing
      // here describes an actuator part way through a move. Starting the run from
      // an *empty* line with a full yard does nothing at all, which is worth
      // knowing before writing another scenario like this one. The first part
      // does not reach the test bay for forty seconds, by which time the lorry
      // has been and gone.
      initialMachine: {
        yard: 6,
        truckState: 'away',
        truckT: 0,
        lane0: 'ff',
        lane1: 'ff',
        lane2: 'bb',
        lane3: 'bb',
        laneF: '11',
        laneB: '11',
        z10: 'm',
        z11: 'm',
      },
      steps: [
        {
          label: 'Auto and start, with the yard already full and the rack backed up',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'The queue grows out onto the spine, seven parts standing on it, and nothing crashes',
          setInputs: { X0: false },
          holdMs: 60_000,
          until: { analog: { D18: { min: 7 } } },
          expectMachine: { jam: false, blocked: false, starved: false },
        },
        {
          label: 'The lorry comes, the yard empties and the line picks itself back up',
          holdMs: 90_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      parMs: 39_200,
    },
  ],
};
