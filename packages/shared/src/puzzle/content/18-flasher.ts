import type { PuzzleSpec } from '../types.js';

export const flasher: PuzzleSpec = {
  kind: 'ladder',
  slug: 'flasher',
  title: 'Hazard Flasher',
  difficulty: 'hard',
  order: 7,
  category: 'timers-counters',
  summary: 'Blink a hazard beacon ~1 s on / 1 s off with a two-timer oscillator.',
  briefing: [
    'A hazard beacon over a shared aisle has to blink while the hazard switch is on.',
    'A single on-delay timer fires only once, so the flash rate comes from two timers',
    'cross-coupled into an oscillator.',
    '',
    '## Equipment',
    '- X0 HAZARD: maintained switch.',
    '- Y0 BEACON: amber lamp.',
    '- T0 and T1: the on phase and the off phase, preset K=10 each (see Working',
    '  Registers).',
    '',
    '## Sequence of operation',
    '1. Turn the hazard switch on. The beacon lights.',
    '2. It goes dark about a second later, lights again a second after that, and keeps',
    '   alternating for as long as the switch is held.',
    '3. Turn the switch off. The flashing stops at once and the beacon stays dark.',
    '',
    '## Field notes',
    '- Timer presets are in units of 100 ms, so K=10 = 1.0 s.',
    '- The oscillator is two rungs: T0 times one phase and is broken by T1, and T1 is',
    '  driven by T0. Each timer resetting the other is what makes the pattern repeat.',
    '- Read the lamp off the oscillator on its own rung, so the switch can black it out',
    '  instantly without waiting for a phase to finish.',
  ].join('\n'),
  hints: [
    'Rung 1: run T0 (K=10) from X0 in series with a normally-closed T1 contact.',
    'Rung 2: run T1 (K=10) from a normally-open T0 contact.',
    'When T1 finishes it opens rung 1, which resets T0; that in turn resets T1, and ' +
      'the cycle starts over.',
    'Rung 3: light the beacon while the switch is on but T0 has not finished its ' +
      'phase: X0 in series with a normally-closed T0 contact → Y0.',
  ],
  devices: [
    { address: 'X0', label: 'Hazard', io: 'input', widget: 'toggle' },
    { address: 'Y0', label: 'Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
  ],
  registers: [
    { address: 'T0', label: 'On phase', note: 'on-delay, preset K=10 = 1.0 s' },
    { address: 'T1', label: 'Off phase', note: 'on-delay, preset K=10 = 1.0 s' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'timer'],
  maxRungs: 4,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Beacon flashes while enabled',
      steps: [
        { label: 'Switch on: first flash is lit', setInputs: { X0: true }, holdMs: 500, expect: { Y0: true } },
        { label: 'First gap', holdMs: 1000, expect: { Y0: false } },
        { label: 'Second flash', holdMs: 1000, expect: { Y0: true } },
        { label: 'Second gap', holdMs: 1000, expect: { Y0: false } },
      ],
    },
    {
      name: 'Disabled beacon stays dark',
      steps: [
        { label: 'Switch off: dark', holdMs: 1500, expect: { Y0: false } },
        { label: 'Switch on: starts flashing', setInputs: { X0: true }, holdMs: 500, expect: { Y0: true } },
        { label: 'Switch off: goes dark at once', setInputs: { X0: false }, holdMs: 400, expect: { Y0: false } },
      ],
    },
  ],
};
