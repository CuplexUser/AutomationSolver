import type { PuzzleSpec } from '../types.js';

export const packSequence: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pack-sequence',
  title: 'Packer: Guarded Push Cycle',
  difficulty: 'hard',
  order: 23,
  category: 'packaging',
  summary: 'Sequence a back-stop and a pusher into one automatic guarded stroke.',
  briefing: [
    'To square a carton before it moves on, the BACK-STOP (Y5) swings FORWARD to hold',
    'it, THEN the 2-PACK PUSHER (Y0) squares it against the stop, and only after the',
    'pusher is clear does the back-stop swing back. One tap of START (X20) runs the',
    'whole four-step cycle:',
    '',
    '  1. Back-stop FORWARD (Y5) until it reaches FORWARD (X13).',
    '  2. Pusher OUT (Y0) until it reaches OUT (X1).',
    '  3. Pusher retracts (Y0 off) until it is back IN (X0).',
    '  4. Back-stop back (Y5 off) until it reaches BACK (X12). Cycle done.',
    '',
    'Sensors: back-stop BACK (X12) / FORWARD (X13); pusher IN (X0) / OUT (X1). Start',
    'only from the fully-home state (back-stop back, pusher in).',
  ].join('\n'),
  hints: [
    'Drive this as a one-hot step sequencer with SET/RESET latches M0..M3, one per',
    'step. Each transition sets the next step and resets the current one.',
    'Rung starts: SET M0 on (X20 · X12 · X0). Then M0·X13 → SET M1 / RST M0; M1·X1 →',
    'SET M2 / RST M1; M2·X0 → SET M3 / RST M2; M3·X12 → RST M3.',
    'Outputs: the back-stop stays forward for steps 1-3, so Y5 = M0 OR M1 OR M2. The',
    'pusher only extends in step 2, so Y0 = M1 (dropping it in step 3 makes it retract).',
  ],
  devices: [
    { address: 'X20', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X0', label: 'Pusher In', io: 'input', widget: 'sensor' },
    { address: 'X1', label: 'Pusher Out', io: 'input', widget: 'sensor' },
    { address: 'X12', label: 'Back-Stop Back', io: 'input', widget: 'sensor' },
    { address: 'X13', label: 'Back-Stop Forward', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: '2-Pack Pusher', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y5', label: 'Back-Stop', io: 'output', widget: 'motor', color: '#f59e0b' },
  ],
  registers: [
    { address: 'M0', label: 'Step 1 — back-stop forward' },
    { address: 'M1', label: 'Step 2 — pusher out' },
    { address: 'M2', label: 'Step 3 — pusher retract' },
    { address: 'M3', label: 'Step 4 — back-stop back' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 12,
  processId: 'packaging',
  scenarios: [
    {
      name: 'One guarded push cycle',
      steps: [
        {
          label: 'Tap Start — back-stop swings forward first',
          setInputs: { X20: true },
          holdMs: 100,
          expect: { Y5: true, Y0: false },
        },
        {
          label: 'Back-stop forward — now the pusher extends',
          setInputs: { X20: false },
          holdMs: 500,
          expect: { Y0: true, Y5: true },
        },
        {
          label: 'Pusher reached OUT — it retracts, stop stays forward',
          holdMs: 700,
          expect: { Y0: false, Y5: true },
        },
        {
          label: 'Pusher home — back-stop swings back, cycle ends',
          holdMs: 1200,
          expect: { Y5: false, X12: true },
        },
      ],
    },
    {
      name: 'Idle until started',
      steps: [{ label: 'No start — nothing moves', holdMs: 400, expect: { Y0: false, Y5: false } }],
    },
  ],
};
