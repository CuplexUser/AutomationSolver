import type { PuzzleSpec } from '../types.js';

export const delayedStart: PuzzleSpec = {
  slug: 'delayed-start',
  title: 'Delayed Start',
  difficulty: 'medium',
  order: 4,
  summary: 'Sound a warning beacon, then start the motor after a 2-second timer.',
  briefing: [
    'A conveyor must warn nearby workers before it starts. On START (X0) the WARNING',
    'beacon (Y1) lights immediately and seals in. Two seconds later the MOTOR (Y0)',
    'starts. STOP (X1) drops everything at once.',
    '',
    'Use an on-delay timer. Timer presets are in units of 100 ms, so K20 = 2.0 s.',
  ].join('\n'),
  hints: [
    'Rung 1: seal in a run command (X0 OR the run bit) AND normally-closed X1.',
    'Rung 2: drive the beacon Y1 and the timer T0 (preset K20) from the run bit.',
    'Rung 3: a normally-open T0 contact drives the motor Y0.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'Y0', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
  ],
  registers: [
    { address: 'M0', label: 'Run latch', note: 'seals in the start command' },
    { address: 'T0', label: 'Start delay', note: 'on-delay, preset K20 = 2.0 s' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'timer'],
  maxRungs: 4,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Beacon first, then motor after 2 s',
      steps: [
        {
          label: 'Press Start — beacon on, motor still off',
          setInputs: { X0: true },
          holdMs: 800,
          expect: { Y1: true, Y0: false },
        },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 200, expect: { Y1: true } },
        {
          label: 'After the delay the motor runs',
          holdMs: 1600,
          expect: { Y0: true, Y1: true },
        },
      ],
    },
    {
      name: 'Stop drops everything',
      steps: [
        { label: 'Start and wait past delay', setInputs: { X0: true }, holdMs: 2400, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100 },
        {
          label: 'Press Stop',
          setInputs: { X1: true },
          holdMs: 150,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
  ],
};
