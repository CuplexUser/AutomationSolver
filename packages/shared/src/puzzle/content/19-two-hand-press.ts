import type { PuzzleSpec } from '../types.js';

export const twoHandPress: PuzzleSpec = {
  kind: 'ladder',
  slug: 'two-hand-press',
  title: 'Two-Hand Press',
  difficulty: 'medium',
  order: 10,
  category: 'stations',
  summary: 'Advance a stamping press only while both palm buttons are held, with anti-repeat.',
  briefing: [
    'A stamping press must be impossible to operate one-handed. The PRESS ram (Y0)',
    'may advance only while BOTH palm buttons — LEFT (X0) and RIGHT (X1) — are held',
    'and the E-STOP (X2) is healthy. Let go of either palm and the ram retracts at',
    'once.',
    '',
    'When the ram reaches BOTTOM (X3) the stroke is finished: retract, and light the',
    'STROKE COMPLETE lamp (Y1). To stop an operator taping a button down for repeat',
    'strokes, the press must not advance again until BOTH palms have been released',
    'and pressed afresh.',
    '',
    'BOTTOM (X3) is a field sensor driven by the press — you cannot press it. The',
    'E-STOP is wired normally-closed, so it reads ON while healthy.',
  ].join('\n'),
  hints: [
    'Rung 1: advance Y0 from X0 AND X1 AND X2 (all normally-open) in series with a',
    'normally-closed done-latch M0 — the latch is what blocks a repeat stroke.',
    'Rung 2: SET M0 when the ram bottoms out (normally-open X3).',
    'Rung 3: RESET M0 only when both palms are released — normally-closed X0 in series',
    'with normally-closed X1.',
    'Rung 4: drive the STROKE COMPLETE lamp Y1 from M0.',
  ],
  devices: [
    { address: 'X0', label: 'Palm Left', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Palm Right', io: 'input', widget: 'momentary' },
    { address: 'X2', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X3', label: 'At Bottom', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Press', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Stroke Complete', io: 'output', widget: 'lamp', color: '#22c55e' },
  ],
  registers: [
    { address: 'M0', label: 'Done latch', note: 'blocks a repeat stroke until both palms release' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 6,
  processId: 'press',
  scenarios: [
    {
      name: 'Both hands complete one stroke, then it locks out',
      steps: [
        {
          label: 'Left palm only — nothing moves',
          setInputs: { X0: true },
          holdMs: 300,
          expect: { Y0: false },
        },
        {
          label: 'Add the right palm — press advances',
          setInputs: { X1: true },
          holdMs: 300,
          expect: { Y0: true, X3: false },
        },
        {
          label: 'Ram bottoms out — retract and latch complete',
          holdMs: 600,
          expect: { Y0: false, Y1: true },
        },
        {
          label: 'Still holding both — no repeat stroke',
          holdMs: 400,
          expect: { Y0: false, Y1: true },
        },
        {
          label: 'Release both palms — lockout clears',
          setInputs: { X0: false, X1: false },
          holdMs: 300,
          expect: { Y1: false },
        },
      ],
    },
    {
      name: 'Releasing a hand retracts the ram',
      steps: [
        { label: 'Both palms — advancing', setInputs: { X0: true, X1: true }, holdMs: 200, expect: { Y0: true } },
        { label: 'Let go of the right palm', setInputs: { X1: false }, holdMs: 250, expect: { Y0: false, Y1: false } },
        { label: 'Grab it again — advances once more', setInputs: { X1: true }, holdMs: 200, expect: { Y0: true } },
      ],
    },
    {
      name: 'E-stop drops the press',
      steps: [
        { label: 'Both palms — advancing', setInputs: { X0: true, X1: true }, holdMs: 200, expect: { Y0: true } },
        { label: 'Hit the E-Stop', setInputs: { X2: false }, holdMs: 200, expect: { Y0: false } },
        {
          label: 'Release palms and reset the E-Stop',
          setInputs: { X0: false, X1: false, X2: true },
          holdMs: 200,
          expect: { Y0: false },
        },
      ],
    },
  ],
};
