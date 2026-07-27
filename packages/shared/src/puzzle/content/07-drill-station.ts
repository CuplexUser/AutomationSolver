import type { PuzzleSpec } from '../types.js';

export const drillStation: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-station',
  title: 'Drill Station: Full Stroke',
  difficulty: 'medium',
  order: 30,
  category: 'drill',
  summary:
    'Sequence clamp, feed, beacon and eject into one stroke, with both cylinders sensed at each end of travel.',
  briefing: [
    'The drill station runs one full stroke per part: clamp, drill, retract, eject.',
    'This work order commissions the whole stroke as a single sealed-in cycle.',
    '',
    'Since the last revision both cylinders report BOTH ends of their travel, not',
    'just the working end, so the program can tell "not out yet" from "safely home".',
    '',
    '## Equipment',
    '- X0 START: momentary push button. X1 E-STOP: maintained mushroom, normally closed.',
    '- X2 CLAMPED, X3 DRILL AT BOTTOM, X10 DRILL UP, X4 EJECT EXTENDED, X11 EJECT HOME:',
    '  machine-driven field sensors. You cannot press them yourself.',
    '- X3 and X10 are the two ends of the feed stroke; X4 and X11 are the two ends of',
    '  the eject stroke. Mid-travel both sensors of a pair read OFF.',
    '- Y0 CLAMP, Y1 DRILL FEED, Y2 WARNING BEACON, Y3 CYCLE DONE, Y4 EJECT.',
    '- M0: run latch (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Press START with the E-Stop healthy and the eject rod home (X11). The CLAMP Y0',
    '   closes and the cycle seals in, so the operator can release the button straight',
    '   away.',
    '2. CLAMPED (X2) confirms the part is really held. Only then does the DRILL FEED',
    '   Y1 run down into it.',
    '3. The WARNING beacon Y2 stays lit the whole time the feed is running.',
    '4. DRILL AT BOTTOM (X3) ends the cycle: drop the feed, release the clamp, and',
    '   latch the CYCLE DONE lamp Y3 until the next START.',
    '5. The head takes about 0.4 s to come back up. Wait for DRILL UP (X10). Only then',
    '   does the EJECT pusher Y4 shove the part onto the roller band.',
    '6. EJECT EXTENDED (X4) stops the pusher, which springs home. EJECT HOME (X11)',
    '   reports the rod clear of the fixture and the station is ready for the next part.',
    '',
    '## Interlocks and safety',
    '- Never feed the drill into an unclamped part: gate Y1 on X2. The bit snaps and',
    '  the machine faults out.',
    '- Never run the eject rod while the head is still down. The pusher sweeps across',
    '  the bore and shears the bit off. X10, not "X3 has gone off again", is what',
    '  proves the head is clear.',
    '- Do not clamp a new part while the eject rod is still out of its bore. Gate the',
    '  run latch on X11.',
    '- The E-Stop is normally closed, so X1 reads ON while healthy. Pressing it must',
    '  drop the clamp and the feed together.',
    '',
    '## Field notes',
    '- A rising-edge contact |P| conducts for exactly one scan, on the OFF to ON',
    '  transition of its device. It is the tool of choice for firing a SET off a',
    '  sensor that then stays on.',
  ].join('\n'),
  hints: [
    'Rung 1: seal in a RUN bit M0 from (X0 OR M0), in series with X1 (NO), X11 (NO, ' +
      'the eject rod home) and a normally-closed X3 so reaching the bottom drops the ' +
      'cycle.',
    'Clamp Y0 follows M0 (a NO contact on M0). Drive the drill Y1 from M0 AND X2 ' +
      '(clamped), both NO contacts. Feeding off M0 alone drives the bit into a loose ' +
      'part and faults the machine.',
    'Warning Y2 follows the drill (a NO contact on Y1). SET Y3 on a NO contact on ' +
      'X3 (bottom) and RESET it on a NO contact on X0.',
    'The eject has to wait for the head: SET Y4 from X10 (drill up) in series with ' +
      'Y3 (this cycle really has drilled something). RESET Y4 on a NO contact on X4 ' +
      '(extended) to stop the rod at the end of its stroke.',
    'Use a RISING EDGE contact |P| on X10 for that SET. A plain NO contact fights ' +
      'its own reset: X10 and Y3 both stay on after the rod is recalled, so the SET ' +
      're-fires the very next scan and the pusher cycles forever. The edge fires once ' +
      'per stroke, the instant the head finishes retracting.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'X10', label: 'Drill Up', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Eject Extended', io: 'input', widget: 'sensor' },
    { address: 'X11', label: 'Eject Home', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y2', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'Y3', label: 'Cycle Done', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'Y4', label: 'Eject', io: 'output', widget: 'motor', color: '#fb7185' },
  ],
  registers: [{ address: 'M0', label: 'Run latch', note: 'seals in the cycle until the drill bottoms out' }],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'contact-rising',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 10,
  processId: 'drill',
  scenarios: [
    {
      name: 'Full automatic stroke',
      steps: [
        {
          label: 'Press Start: clamp closes, both cylinders still at home',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true, Y1: false, X2: false, X10: true, X11: true },
        },
        {
          label: 'Release Start: cycle stays sealed in',
          setInputs: { X0: false },
          holdMs: 150,
          expect: { Y0: true, Y1: false },
        },
        {
          label: 'Clamped: drill feeds, beacon lights, the head leaves its up sensor',
          holdMs: 400,
          expect: { X2: true, Y1: true, Y2: true, X3: false, X10: false },
        },
        {
          label: 'Drill bottoms out: cycle ends, done latches',
          holdMs: 700,
          expect: { Y1: false, Y0: false, Y3: true },
        },
        {
          label: 'Head still retracting: the pusher has to hold off',
          holdMs: 200,
          expect: { X10: false, Y4: false },
        },
        {
          label: 'Drill fully up: only now does the eject pusher run',
          holdMs: 300,
          expect: { X10: true, Y4: true, X4: false, X11: false },
        },
        {
          label: 'Part clears the platform: the rod stops and springs home',
          holdMs: 700,
          expect: { Y4: false, X4: false, X11: true },
          expectMachine: { jam: false },
        },
      ],
    },
    {
      name: 'A new part waits for the eject rod to come home',
      steps: [
        {
          label: 'Start one stroke',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true },
        },
        {
          label: 'Release Start: the stroke runs on to the eject by itself',
          setInputs: { X0: false },
          holdMs: 1750,
          expect: { Y4: true, X11: false, Y0: false },
        },
        {
          label: 'Press Start again mid-eject: the clamp must stay open',
          setInputs: { X0: true },
          holdMs: 200,
          expect: { Y0: false, X11: false },
        },
        {
          label: 'Rod home again: the held Start button finally takes',
          holdMs: 600,
          expect: { X11: true, Y0: true },
          expectMachine: { jam: false },
        },
      ],
    },
    {
      name: 'E-Stop aborts the cycle',
      steps: [
        {
          label: 'Start and reach the drilling phase',
          setInputs: { X0: true },
          holdMs: 700,
          expect: { Y1: true },
        },
        {
          label: 'Hit E-Stop: clamp and drill drop at once',
          setInputs: { X0: false, X1: false },
          holdMs: 150,
          expect: { Y0: false, Y1: false },
        },
        {
          label: 'Head retracts on an aborted cycle without launching the pusher',
          setInputs: { X1: true },
          holdMs: 500,
          expect: { X10: true, Y3: false, Y4: false, Y0: false },
          expectMachine: { jam: false },
        },
      ],
    },
  ],
};
