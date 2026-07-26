import type { PuzzleSpec } from '../types.js';

export const directControl: PuzzleSpec = {
  kind: 'ladder',
  slug: 'direct-control',
  title: 'Direct Control',
  difficulty: 'tutorial',
  order: 1,
  category: 'basics',
  summary: 'Wire a single input contact to a single output coil.',
  briefing: [
    'Welcome, technician. Your first job is the simplest control there is: make the',
    'RUN lamp follow the RUN switch. Both devices are already wired to the PLC, so',
    'the only thing missing is the program between them.',
    '',
    '## Equipment',
    '- X0 RUN SWITCH: a maintained toggle on the operator panel.',
    '- Y0 RUN LAMP: a green indicator beside it.',
    '',
    '## Sequence of operation',
    '1. Turn the switch ON. The lamp lights at once.',
    '2. Turn the switch OFF. The lamp goes dark at once.',
    '',
    '## Field notes',
    '- One rung does it: a normally-open contact addressed X0 in series with an output',
    '  coil addressed Y0.',
    '- The lamp holds no state of its own. It only ever mirrors the switch.',
  ].join('\n'),
  hints: [
    'Click a cell, choose the normally-open contact, and address it X0.',
    'Put an output coil in the last column addressed Y0.',
  ],
  devices: [
    { address: 'X0', label: 'Run Switch', io: 'input', widget: 'toggle' },
    { address: 'Y0', label: 'Run Lamp', io: 'output', widget: 'lamp', color: '#22c55e' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 1,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Lamp follows the switch',
      steps: [
        { label: 'Initially off', holdMs: 100, expect: { Y0: false } },
        { label: 'Switch ON', setInputs: { X0: true }, holdMs: 100, expect: { Y0: true } },
        { label: 'Switch OFF', setInputs: { X0: false }, holdMs: 100, expect: { Y0: false } },
      ],
    },
  ],
};
