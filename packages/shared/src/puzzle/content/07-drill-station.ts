import type { PuzzleSpec } from '../types.js';

export const drillStation: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-station',
  title: 'Drill Station: Full Stroke',
  difficulty: 'medium',
  order: 30,
  category: 'drill',
  summary: 'Sequence a clamp, drill feed, warning beacon and eject pusher into one automatic stroke.',
  briefing: [
    'The drill station runs one full stroke per part: clamp, drill, retract, eject.',
    'This work order commissions the whole stroke as a single sealed-in cycle.',
    '',
    '## Equipment',
    '- X0 START: momentary push button. X1 E-STOP: maintained mushroom, normally closed.',
    '- X2 CLAMPED, X3 DRILL AT BOTTOM, X4 EJECTED: machine-driven field sensors. You',
    '  cannot press them yourself.',
    '- Y0 CLAMP, Y1 DRILL FEED, Y2 WARNING BEACON, Y3 CYCLE DONE, Y4 EJECT.',
    '- M0: run latch (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Press START with the E-Stop healthy. The CLAMP Y0 closes and the cycle seals',
    '   in, so the operator can release the button straight away.',
    '2. CLAMPED (X2) confirms the part is really held. Only then does the DRILL FEED',
    '   Y1 run down into it.',
    '3. The WARNING beacon Y2 stays lit the whole time the feed is running.',
    '4. DRILL AT BOTTOM (X3) ends the cycle: drop the feed, release the clamp, and',
    '   latch the CYCLE DONE lamp Y3 until the next START.',
    '5. With the cycle done, the EJECT pusher Y4 shoves the part onto the roller band.',
    '6. EJECTED (X4) stops the pusher, which springs home. The station waits for the',
    '   next part.',
    '',
    '## Interlocks and safety',
    '- Never feed the drill into an unclamped part: gate Y1 on X2.',
    '- The E-Stop is normally closed, so X1 reads ON while healthy. Pressing it must',
    '  drop the clamp and the feed together.',
  ].join('\n'),
  hints: [
    'Rung 1: seal in a RUN bit M0 from (X0 OR M0), in series with X1 (NO) and a ' +
      'normally-closed X3 so reaching the bottom drops the cycle.',
    'Clamp Y0 follows M0 (a NO contact on M0). Drive the drill Y1 from M0 AND X2 ' +
      '(clamped), both NO contacts.',
    'Warning Y2 follows the drill (a NO contact on Y1). SET Y3 on a NO contact on ' +
      'X3 (bottom) and RESET it on a NO contact on X0.',
    'SET Y4 on a NO contact on X3 (bottom). A SET only needs X3 true for a single ' +
      'scan, so it is fine that X3 drops again the instant the run latch releases; ' +
      'no seal-in needed. RESET Y4 on a NO contact on X4 (ejected) to stop it. ' +
      'Triggering the SET off Y3 instead works at first but fights its own reset ' +
      'once X4 senses ejected, since Y3 never goes false again until the next start.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Ejected', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y2', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'Y3', label: 'Cycle Done', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'Y4', label: 'Eject', io: 'output', widget: 'motor', color: '#fb7185' },
  ],
  registers: [{ address: 'M0', label: 'Run latch', note: 'seals in the cycle until the drill bottoms out' }],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 10,
  processId: 'drill',
  scenarios: [
    {
      name: 'Full automatic stroke',
      steps: [
        {
          label: 'Press Start: clamp closes, drill still up',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true, Y1: false, X2: false },
        },
        {
          label: 'Release Start: cycle stays sealed in',
          setInputs: { X0: false },
          holdMs: 150,
          expect: { Y0: true, Y1: false },
        },
        {
          label: 'Clamped: drill feeds and beacon lights',
          holdMs: 500,
          expect: { X2: true, Y1: true, Y2: true, X3: false },
        },
        {
          label: 'Drill bottoms out: cycle ends, done latches',
          holdMs: 500,
          expect: { Y1: false, Y0: false, Y3: true },
        },
        {
          label: 'Done latched: eject pusher runs',
          holdMs: 250,
          expect: { Y4: true, X4: false },
        },
        {
          label: 'Part clears the platform: eject stops itself',
          holdMs: 500,
          expect: { Y4: false },
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
          setInputs: { X1: false },
          holdMs: 150,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
  ],
};
