import type { PuzzleSpec } from '../types.js';

export const packInterlock: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pack-interlock',
  title: 'Packer: Lift / Push Interlock',
  difficulty: 'medium',
  order: 22,
  category: 'packaging',
  summary: 'Two actuators that must never collide — each may move only when the other is clear.',
  briefing: [
    'The LIFT (Y2) raises a stack into the wrapping head; the 2-PACK PUSHER (Y0)',
    'shoves cartons across the deck. Their paths cross, so they must be interlocked:',
    'the pusher may only extend while the lift is fully DOWN, and the lift may only',
    'rise while the pusher is fully HOME.',
    '',
    'Both are hold-to-run: the operator holds PUSH (X20) or RAISE (X21) and the',
    'actuator moves while held, retracting/lowering the moment the button is released.',
    '',
    'Sensors: pusher IN (X0) / OUT (X1); lift DOWN (X4) / UP (X5). Gate each output',
    'with the far actuator\'s "clear" sensor so a careless operator can never drive',
    'them into each other.',
  ].join('\n'),
  hints: [
    'Push: X20 in series with X4 (lift down) → Y0. No seal-in — releasing PUSH must',
    'let it retract.',
    'Raise: X21 in series with X0 (pusher home) → Y2.',
    'Because each interlock reads the OTHER actuator\'s home sensor, neither can start',
    'once the other has left home.',
  ],
  devices: [
    { address: 'X20', label: 'Push', io: 'input', widget: 'momentary' },
    { address: 'X21', label: 'Raise', io: 'input', widget: 'momentary' },
    { address: 'X0', label: 'Pusher In', io: 'input', widget: 'sensor' },
    { address: 'X1', label: 'Pusher Out', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Lift Down', io: 'input', widget: 'sensor' },
    { address: 'X5', label: 'Lift Up', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: '2-Pack Pusher', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y2', label: 'Lift', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 3,
  processId: 'packaging',
  scenarios: [
    {
      name: 'Push is blocked while the lift is raised',
      steps: [
        { label: 'Push with lift down — extends', setInputs: { X20: true }, holdMs: 300, expect: { Y0: true } },
        { label: 'Release Push — retracts', setInputs: { X20: false }, holdMs: 300, expect: { Y0: false } },
        { label: 'Raise the lift', setInputs: { X21: true }, holdMs: 1000, expect: { Y2: true, X5: true } },
        {
          label: 'Try to push with the lift up — blocked',
          setInputs: { X20: true },
          holdMs: 300,
          expect: { Y0: false },
        },
      ],
    },
    {
      name: 'Raise is blocked while the pusher is out',
      steps: [
        { label: 'Push and leave home', setInputs: { X20: true }, holdMs: 400, expect: { Y0: true, X0: false } },
        {
          label: 'Try to raise with the pusher out — blocked',
          setInputs: { X21: true },
          holdMs: 300,
          expect: { Y2: false },
        },
        { label: 'Release Push — pusher returns home', setInputs: { X20: false, X21: false }, holdMs: 700, expect: { X0: true } },
        { label: 'Now raise is allowed', setInputs: { X21: true }, holdMs: 300, expect: { Y2: true } },
      ],
    },
  ],
};
