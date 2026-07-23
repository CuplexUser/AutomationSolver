import type { PuzzleSpec } from '../types.js';

export const drillStation: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-station',
  title: 'Drill Station Cycle',
  difficulty: 'hard',
  order: 9,
  category: 'stations',
  summary: 'Sequence a clamp, drill feed, warning beacon and eject pusher into one automatic stroke.',
  briefing: [
    'An automatic drill station runs one full stroke per cycle. On START (X0), with',
    'the E-STOP (X1) healthy, the machine must:',
    '',
    '  1. CLAMP the part (Y0) and hold it for the whole cycle.',
    '  2. Once CLAMPED (X2), run the DRILL feed (Y1) down into the part.',
    '  3. Light the WARNING beacon (Y2) the whole time the drill is running.',
    '  4. When the drill reaches BOTTOM (X3), end the cycle: release everything and',
    '     latch the CYCLE DONE lamp (Y3) until the next START.',
    '  5. Once DONE, run the EJECT pusher (Y4) to shove the part onto the roller band;',
    '     stop pushing as soon as it senses EJECTED (X4).',
    '',
    'X2 (Clamped), X3 (At Bottom) and X4 (Ejected) are field sensors driven by the',
    "machine, so you cannot press them. E-STOP is wired normally-closed, so it's",
    'ON while healthy.',
  ].join('\n'),
  hints: [
    'Rung 1: seal in a RUN bit M0 from (X0 OR M0), in series with X1 (NO) and a ' +
      'normally-closed X3 so reaching the bottom drops the cycle.',
    'Clamp Y0 follows M0. Drive the drill Y1 from M0 AND X2 (clamped).',
    'Warning Y2 follows the drill. SET Y3 on X3 (bottom) and RESET it on X0.',
    'SET Y4 on X3 (bottom) to start ejecting, and RESET Y4 on X4 (ejected) to stop — ' +
      'triggering off Y3 instead works at first but fights its own reset once X4 ' +
      'senses ejected, since Y3 never goes false again until the next start.',
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
          label: 'Press Start — clamp closes, drill still up',
          setInputs: { X0: true },
          holdMs: 150,
          expect: { Y0: true, Y1: false, X2: false },
        },
        {
          label: 'Release Start — cycle stays sealed in',
          setInputs: { X0: false },
          holdMs: 150,
          expect: { Y0: true, Y1: false },
        },
        {
          label: 'Clamped — drill feeds and beacon lights',
          holdMs: 500,
          expect: { X2: true, Y1: true, Y2: true, X3: false },
        },
        {
          label: 'Drill bottoms out — cycle ends, done latches',
          holdMs: 500,
          expect: { Y1: false, Y0: false, Y3: true },
        },
        {
          label: 'Done latched — eject pusher runs',
          holdMs: 250,
          expect: { Y4: true, X4: false },
        },
        {
          label: 'Part clears the platform — eject stops itself',
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
          label: 'Hit E-Stop — clamp and drill drop at once',
          setInputs: { X1: false },
          holdMs: 150,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
  ],
};
