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
    'Welcome, technician. Your first job is the simplest control there is:',
    'make the RUN lamp (Y0) follow the RUN switch (X0).',
    '',
    'Place a normally-open contact for X0 in series with an output coil for Y0.',
    'When the switch is ON, the lamp is ON; when it is OFF, the lamp is OFF.',
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
