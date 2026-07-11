import type { PuzzleSpec } from '../types.js';

export const eStop: PuzzleSpec = {
  slug: 'estop',
  title: 'Emergency Stop',
  difficulty: 'easy',
  order: 3,
  summary: 'Add a normally-closed E-Stop to a seal-in motor circuit.',
  briefing: [
    'Safety first. Extend the seal-in motor circuit with an EMERGENCY STOP (X2).',
    '',
    'The E-Stop is a maintained, normally-closed field device: its input is ON when',
    'the circuit is healthy and drops to OFF the instant the mushroom is pressed.',
    'Wire a normally-open X2 contact in series so the motor can only run while the',
    'E-Stop is healthy, and cannot restart until it is released.',
  ].join('\n'),
  hints: [
    'Because the E-Stop is wired normally-closed, use a normally-OPEN X2 contact —',
    'it conducts while the E-Stop is healthy (X2 = ON).',
    'Keep the START/STOP seal-in from the previous puzzle and add X2 in series.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'X2', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'Y0', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 1,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Normal run with healthy E-Stop',
      steps: [
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 120, expect: { Y0: true } },
        { label: 'Press Stop', setInputs: { X1: true }, holdMs: 120, expect: { Y0: false } },
      ],
    },
    {
      name: 'E-Stop drops the motor and blocks restart',
      steps: [
        { label: 'Start motor', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100, expect: { Y0: true } },
        { label: 'Hit E-Stop', setInputs: { X2: false }, holdMs: 120, expect: { Y0: false } },
        {
          label: 'Try to start while pressed',
          setInputs: { X0: true },
          holdMs: 120,
          expect: { Y0: false },
        },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 60 },
      ],
    },
    {
      name: 'Runs again after E-Stop reset',
      initialInputs: { X2: false },
      steps: [
        { label: 'E-Stop still pressed', holdMs: 100, expect: { Y0: false } },
        { label: 'Release E-Stop', setInputs: { X2: true }, holdMs: 100, expect: { Y0: false } },
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
      ],
    },
  ],
};
