import type { PuzzleSpec } from '../types.js';

export const drillStation: PuzzleSpec = {
  slug: 'drill-station',
  title: 'Drill Station Cycle',
  difficulty: 'hard',
  order: 7,
  summary: 'Sequence a clamp, drill feed and warning beacon into one automatic stroke.',
  briefing: [
    'An automatic drill station runs one full stroke per cycle. On START (X0) — with the',
    'E-STOP (X1) healthy — the machine must:',
    '',
    '  1. CLAMP the part (Y0) and hold it for the whole cycle.',
    '  2. Once CLAMPED (X2), run the DRILL feed (Y1) down into the part.',
    '  3. Light the WARNING beacon (Y2) the whole time the drill is running.',
    '  4. When the drill reaches BOTTOM (X3), end the cycle: release everything and',
    '     latch the CYCLE DONE lamp (Y3) until the next START.',
    '',
    'X2 (Clamped) and X3 (At Bottom) are field sensors driven by the machine — you',
    "cannot press them. E-STOP is wired normally-closed, so it's ON while healthy.",
  ].join('\n'),
  hints: [
    'Rung 1: seal in a RUN bit M0 from (X0 OR M0), in series with X1 (NO) and a',
    'normally-closed X3 so reaching the bottom drops the cycle.',
    'Clamp Y0 follows M0. Drive the drill Y1 from M0 AND X2 (clamped).',
    'Warning Y2 follows the drill. SET Y3 on X3 (bottom) and RESET it on X0.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y2', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'Y3', label: 'Cycle Done', io: 'output', widget: 'lamp', color: '#22c55e' },
  ],
  registers: [{ address: 'M0', label: 'Run latch', note: 'seals in the cycle until the drill bottoms out' }],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 8,
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
          holdMs: 1000,
          expect: { Y1: false, Y0: false, Y3: true },
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
