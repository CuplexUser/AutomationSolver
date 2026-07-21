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
    'While the HAZARD switch (X0) is on, the BEACON (Y0) must flash: roughly one',
    'second on, one second off, repeating for as long as the switch is held. Turning',
    'the switch off stops the flashing and leaves the beacon dark.',
    '',
    'A single on-delay timer can only fire once. To make it repeat, cross-couple two',
    'of them into an oscillator: T0 times the "on" phase, T1 the "off" phase, and',
    'each one resets the other. Presets are in units of 100 ms (K10 = 1.0 s).',
  ].join('\n'),
  hints: [
    'Rung 1: run T0 (K10) from X0 in series with a normally-closed T1 contact.',
    'Rung 2: run T1 (K10) from a normally-open T0 contact.',
    'When T1 finishes it opens rung 1, which resets T0; that in turn resets T1, and',
    'the cycle starts over.',
    'Rung 3: light the beacon while the switch is on but T0 has not finished its phase',
    '— X0 in series with a normally-closed T0 contact → Y0.',
  ],
  devices: [
    { address: 'X0', label: 'Hazard', io: 'input', widget: 'toggle' },
    { address: 'Y0', label: 'Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
  ],
  registers: [
    { address: 'T0', label: 'On phase', note: 'on-delay, preset K10 = 1.0 s' },
    { address: 'T1', label: 'Off phase', note: 'on-delay, preset K10 = 1.0 s' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'timer'],
  maxRungs: 4,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Beacon flashes while enabled',
      steps: [
        { label: 'Switch on — first flash is lit', setInputs: { X0: true }, holdMs: 500, expect: { Y0: true } },
        { label: 'First gap', holdMs: 1000, expect: { Y0: false } },
        { label: 'Second flash', holdMs: 1000, expect: { Y0: true } },
        { label: 'Second gap', holdMs: 1000, expect: { Y0: false } },
      ],
    },
    {
      name: 'Disabled beacon stays dark',
      steps: [
        { label: 'Switch off — dark', holdMs: 1500, expect: { Y0: false } },
        { label: 'Switch on — starts flashing', setInputs: { X0: true }, holdMs: 500, expect: { Y0: true } },
        { label: 'Switch off — goes dark at once', setInputs: { X0: false }, holdMs: 400, expect: { Y0: false } },
      ],
    },
  ],
};
