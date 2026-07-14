import type { PuzzleSpec } from '../types.js';

export const sealIn: PuzzleSpec = {
  kind: 'ladder',
  slug: 'seal-in',
  title: 'Start / Stop Seal-In',
  difficulty: 'easy',
  order: 2,
  category: 'basics',
  summary: 'Latch a motor with momentary Start/Stop buttons using a seal-in contact.',
  briefing: [
    'A motor must start on a momentary START (X0) and keep running after the button',
    'is released. A momentary STOP (X1) must stop it. This is the classic seal-in',
    '(hold-in) circuit.',
    '',
    'Energize the motor contactor Y0 when START is pressed, seal it in with a',
    'normally-open Y0 contact in parallel with START, and break the rung with a',
    'normally-closed STOP contact so pressing STOP drops the motor out.',
  ].join('\n'),
  hints: [
    'Put X0 (NO) and Y0 (NO) in parallel using a vertical link.',
    'Place STOP (X1) as a normally-closed contact in series before the coil.',
    'The motor coil is Y0.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'Y0', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 1,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Start latches and seals in',
      steps: [
        { label: 'Idle', holdMs: 100, expect: { Y0: false } },
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 150, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 200, expect: { Y0: true } },
      ],
    },
    {
      name: 'Stop drops the motor',
      steps: [
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 100, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100, expect: { Y0: true } },
        { label: 'Press Stop', setInputs: { X1: true }, holdMs: 100, expect: { Y0: false } },
        { label: 'Release Stop', setInputs: { X1: false }, holdMs: 100, expect: { Y0: false } },
      ],
    },
    {
      name: 'Motor stays off on its own',
      steps: [{ label: 'No buttons', holdMs: 300, expect: { Y0: false } }],
    },
  ],
};
