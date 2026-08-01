import type { PuzzleSpec } from '../types.js';

export const elevatorAutoReturn: PuzzleSpec = {
  kind: 'ladder',
  slug: 'elevator-auto-return',
  title: 'Elevator: Automatic Descent',
  difficulty: 'medium',
  order: 11,
  category: 'elevator',
  summary: 'Drive a 3-floor elevator up on command and auto-return to the ground after 10 s idle.',
  briefing: [
    'A three-floor goods elevator. The hoist is driven by a hold-to-run UP command,',
    'and the feature being commissioned here is the automatic descent that returns',
    'the empty car to the ground floor.',
    '',
    '## Equipment',
    '- X0 UP COMMAND: maintained switch. Hold it to drive the car up.',
    '- X3, X4, X5 AT FLOOR 1, 2, 3: car-driven position sensors. You cannot press them.',
    '- Y0 MOTOR UP and Y1 MOTOR DOWN.',
    '- T0 and M0: idle timer and descent latch (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Hold UP. The car climbs while the command is held.',
    '2. AT FLOOR 3 (X5) stops the climb even if the command stays on. The car must not',
    '   drive into the top stop.',
    '3. Whenever the car sits away from floor 1 with no UP command, the idle timer runs.',
    '4. After 10 seconds of that, the car drives DOWN on its own and parks at floor 1.',
    '5. A new UP command cancels the descent, whether it is still counting down or the',
    '   car is already moving.',
    '',
    '## Field notes',
    '- Timer presets are in units of 100 ms, so K=100 = 10.0 s.',
    '- A car already parked at floor 1 must never start a descent.',
  ].join('\n'),
  hints: [
    'Drive up: X0 (NO) in series with a normally-closed X5 so the car stops at the ' +
      'top.',
    'Run an on-delay timer T0 (K=100) while the car is away from floor 1 (NC X3) and ' +
      'no up command (NC X0). When T0 finishes, seal in a descent bit M0.',
    'Break the M0 seal-in with NC X3 (reached the bottom) and NC X0 (up cancels it); ' +
      'drive the down output Y1 from M0.',
  ],
  devices: [
    { address: 'X0', label: 'Up Command', io: 'input', widget: 'toggle' },
    { address: 'X3', label: 'At Floor 1', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'At Floor 2', io: 'input', widget: 'sensor' },
    { address: 'X5', label: 'At Floor 3', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Motor Up', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Motor Down', io: 'output', widget: 'motor', color: '#f59e0b' },
  ],
  registers: [
    { address: 'T0', label: 'Idle timer', note: 'on-delay, preset K=100 = 10 s' },
    { address: 'M0', label: 'Descent latch', note: 'runs the car down until floor 1' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'timer'],
  maxRungs: 6,
  processId: 'elevator',
  scenarios: [
    {
      name: 'Auto-returns to ground after 10 s',
      steps: [
        {
          label: 'Hold Up: car climbs to floor 3',
          setInputs: { X0: true },
          holdMs: 2500,
          expect: { X5: true, Y0: false },
        },
        {
          label: 'Release Up: car waits (under 10 s, no descent)',
          setInputs: { X0: false },
          holdMs: 8000,
          expect: { Y1: false, X5: true },
        },
        {
          label: 'After 10 s idle the car descends to floor 1',
          holdMs: 6000,
          expect: { X3: true, Y1: false },
        },
      ],
    },
    {
      name: 'Stays put at the ground floor',
      steps: [
        {
          label: 'Car already at floor 1: never auto-descends',
          holdMs: 12000,
          expect: { Y1: false, X3: true },
        },
      ],
    },
    {
      name: 'Up command cancels a descent',
      steps: [
        { label: 'Climb to floor 3', setInputs: { X0: true }, holdMs: 2500, expect: { X5: true } },
        {
          label: 'Wait out the timer: descent begins',
          setInputs: { X0: false },
          holdMs: 11000,
          expect: { Y1: true },
        },
        {
          label: 'Press Up: descent cancels, car climbs again',
          setInputs: { X0: true },
          holdMs: 500,
          expect: { Y1: false, Y0: true },
        },
      ],
    },
  ],
};
