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
  slug: 'batch-counter',
  title: 'Batch Counter',
  difficulty: 'medium',
  order: 5,
  summary: 'Count 5 parts, latch a BATCH FULL lamp, and reset on demand.',
  briefing: [
    'A sensor pulses the PART DETECT input (X0) once for every part on the line.',
    'After 5 parts, light the BATCH FULL lamp (Y0). The lamp stays on until the',
    'operator presses RESET (X1), which clears the count.',
    '',
    'Use a counter with preset K5 and a reset instruction.',
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
