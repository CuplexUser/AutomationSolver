import type { PuzzleSpec } from '../types.js';

export const packBasics: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pack-basics',
  title: 'Packer Intro: Pneumatic Stroke',
  difficulty: 'easy',
  order: 21,
  category: 'packaging',
  summary: 'Meet the packaging machine: fire one clean pusher stroke that stops itself at the end sensor.',
  briefing: [
    'Welcome to the carton packer. Its actuators are double-acting pneumatic',
    'cylinders: energize the output and the cylinder EXTENDS; drop the output and a',
    'spring RETRACTS it. Each has two end-of-travel sensors you read but cannot press.',
    '',
    'Here you drive just one — the 2-PACK PUSHER (Y0). Its home sensor is IN (X0) and',
    'its extended sensor is OUT (X1).',
    '',
    'On a tap of START (X20) the pusher must make ONE full stroke: extend until it',
    'reaches OUT (X1), then retract on its own and rest at IN. Because the cylinder',
    'retracts whenever Y0 is off, the trick is to seal Y0 on at START and let the OUT',
    'sensor break that seal.',
  ].join('\n'),
  hints: [
    'This is the "index to a sensor" idea from the Stations track, applied to a',
    'cylinder: seal Y0 in from (X20 OR Y0) and put a normally-closed X1 in series.',
    'One rung is enough: (X20 ∥ Y0) · X1(NC) → Y0.',
    'START is momentary — tap it and let go; the seal keeps the stroke going, and OUT',
    'ends it.',
  ],
  devices: [
    { address: 'X20', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X0', label: 'Pusher In', io: 'input', widget: 'sensor' },
    { address: 'X1', label: 'Pusher Out', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: '2-Pack Pusher', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 2,
  processId: 'packaging',
  scenarios: [
    {
      name: 'One stroke per start tap',
      steps: [
        { label: 'Tap Start — pusher extends', setInputs: { X20: true }, holdMs: 100, expect: { Y0: true, X1: false } },
        { label: 'Release Start — stroke seals in', setInputs: { X20: false }, holdMs: 300, expect: { Y0: true } },
        { label: 'Reaches OUT — retracts on its own', holdMs: 500, expect: { Y0: false } },
        { label: 'Back home and resting', holdMs: 700, expect: { Y0: false, X0: true } },
      ],
    },
    {
      name: 'Rests until started',
      steps: [{ label: 'No start — pusher stays home', holdMs: 400, expect: { Y0: false, X0: true } }],
    },
  ],
};
