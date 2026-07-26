import type { PuzzleSpec, ScenarioStep } from '../types.js';

/** Build a momentary pulse on X0 (part passing the sensor). */
function pulse(n: number, expectFull: boolean): ScenarioStep[] {
  return [
    { label: `Part ${n} detected`, setInputs: { X0: true }, holdMs: 80 },
    {
      label: `Gap after part ${n}`,
      setInputs: { X0: false },
      holdMs: 80,
      expect: { Y0: expectFull },
    },
  ];
}

export const batchCounter: PuzzleSpec = {
  kind: 'ladder',
  slug: 'batch-counter',
  title: 'Batch Counter',
  difficulty: 'medium',
  order: 5,
  category: 'timers-counters',
  summary: 'Count 5 parts, latch a BATCH FULL lamp, and reset on demand.',
  briefing: [
    'A packing line fills trays of five. A photo-eye over the belt pulses once per',
    'part; your program keeps the tally and tells the operator when the tray is full.',
    '',
    '## Equipment',
    '- X0 PART DETECT: photo-eye, one pulse per part passing.',
    '- X1 RESET: momentary push button on the panel.',
    '- Y0 BATCH FULL: green lamp.',
    '- C0: batch counter, preset K5 (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Each pulse on X0 steps the counter C0 by one.',
    '2. On the fifth part C0 reaches its preset and the BATCH FULL lamp Y0 lights.',
    '3. The lamp stays lit while the operator swaps the tray. It is not a flicker on',
    '   the fifth pulse.',
    '4. Press RESET. The count clears, the lamp goes out, and the next part starts a',
    '   fresh batch from one.',
    '',
    '## Field notes',
    '- A counter steps on the rising edge of its input, so one part is one count no',
    '  matter how long the photo-eye stays blocked.',
    '- Counting has to resume normally after a reset, so drive the lamp from the',
    '  counter itself rather than latching it anywhere else.',
  ].join('\n'),
  hints: [
    'Rung 1: a normally-open X0 contact drives counter C0 with preset K5.',
    'Rung 2: a normally-open C0 contact drives the lamp Y0.',
    'Rung 3: a normally-open X1 contact drives a RESET of C0.',
  ],
  devices: [
    { address: 'X0', label: 'Part Detect', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Reset', io: 'input', widget: 'momentary' },
    { address: 'Y0', label: 'Batch Full', io: 'output', widget: 'lamp', color: '#22c55e' },
  ],
  registers: [{ address: 'C0', label: 'Batch count', note: 'preset K5, reset by X1' }],
  allowedInstructions: ['contact-no', 'contact-nc', 'counter', 'coil-out', 'coil-reset'],
  maxRungs: 3,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Fifth part latches BATCH FULL',
      steps: [
        ...pulse(1, false),
        ...pulse(2, false),
        ...pulse(3, false),
        ...pulse(4, false),
        ...pulse(5, true),
        { label: 'Stays latched', holdMs: 200, expect: { Y0: true } },
      ],
    },
    {
      name: 'Reset clears the count',
      steps: [
        ...pulse(1, false),
        ...pulse(2, false),
        ...pulse(3, false),
        ...pulse(4, false),
        ...pulse(5, true),
        { label: 'Press Reset', setInputs: { X1: true }, holdMs: 100, expect: { Y0: false } },
        { label: 'Release Reset', setInputs: { X1: false }, holdMs: 80, expect: { Y0: false } },
        ...pulse(1, false),
        ...pulse(2, false),
      ],
    },
  ],
};
