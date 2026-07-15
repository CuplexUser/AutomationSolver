import type { PuzzleSpec } from '../types.js';

export const elevatorAutoReturn: PuzzleSpec = {
  kind: 'ladder',
  slug: 'elevator-auto-return',
  title: 'Elevator — Automatic Descent',
  difficulty: 'hard',
  order: 11,
  category: 'elevator',
  summary: 'Drive a 3-floor elevator up on command and auto-return to the ground after 10 s idle.',
  briefing: [
    'A 3-floor passenger elevator. Hold the UP command (X0) to drive the car up (Y0);',
    'it must stop when it reaches the top floor (X5).',
    '',
    'The graded feature is AUTOMATIC DESCENT: whenever the car is parked away from',
    'floor 1 (X3 off) with no UP command for 10 seconds, it must drive DOWN (Y1) to',
    'floor 1 and stop there. A new UP command cancels a pending or active descent.',
    '',
    'Floor sensors X3/X4/X5 are driven by the car — you cannot press them. Timer',
    'presets are in 100 ms units, so K100 = 10 s.',
  ].join('\n'),
  hints: [
    'Drive up: X0 (NO) in series with a normally-closed X5 so the car stops at the top.',
    'Run an on-delay timer T0 (K100) while the car is away from floor 1 (NC X3) and no',
    'up command (NC X0). When T0 finishes, seal in a descent bit M0.',
    'Break the M0 seal-in with NC X3 (reached the bottom) and NC X0 (up cancels it);',
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
    { address: 'T0', label: 'Idle timer', note: 'on-delay, preset K100 = 10 s' },
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
          label: 'Hold Up — car climbs to floor 3',
          setInputs: { X0: true },
          holdMs: 2500,
          expect: { X5: true, Y0: false },
        },
        {
          label: 'Release Up — car waits (under 10 s, no descent)',
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
          label: 'Car already at floor 1 — never auto-descends',
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
          label: 'Wait out the timer — descent begins',
          setInputs: { X0: false },
          holdMs: 11000,
          expect: { Y1: true },
        },
        {
          label: 'Press Up — descent cancels, car climbs again',
          setInputs: { X0: true },
          holdMs: 500,
          expect: { Y1: false, Y0: true },
        },
      ],
    },
  ],
};
