import type { PuzzleSpec } from '../types.js';

export const eStop: PuzzleSpec = {
  kind: 'ladder',
  slug: 'estop',
  title: 'Emergency Stop',
  difficulty: 'easy',
  order: 3,
  category: 'basics',
  summary: 'Add a normally-closed E-Stop to a seal-in motor circuit.',
  briefing: [
    'Safety upgrade on the same starter: an emergency stop is being added to the',
    'seal-in circuit from the previous work order.',
    '',
    '## Equipment',
    '- X0 START and X1 STOP: momentary push buttons, as before.',
    '- X2 E-STOP: maintained mushroom head, wired normally closed.',
    '- Y0 MOTOR: the motor contactor.',
    '',
    '## Sequence of operation',
    '1. With the mushroom released, START and STOP behave exactly as they did before.',
    '2. Hit the E-Stop. The motor drops out immediately, whatever the seal-in is doing.',
    '3. While the mushroom stays pressed, pressing START must do nothing at all.',
    '4. Twist the mushroom free, then press START. The motor runs again.',
    '',
    '## Interlocks and safety',
    '- Releasing the E-Stop must never restart the machine by itself. The operator has',
    '  to press START again.',
    '- The E-Stop is wired normally closed, so X2 reads ON while the circuit is healthy',
    '  and OFF the instant the mushroom is hit. Test for "healthy" with a normally-OPEN',
    '  X2 contact.',
    '- Wiring a safety device normally closed is what makes a cut wire look like a',
    '  pressed E-Stop rather than a healthy one.',
  ].join('\n'),
  hints: [
    'Because the E-Stop is wired normally-closed, use a normally-OPEN X2 contact: it ' +
      'conducts while the E-Stop is healthy (X2 = ON).',
    'Keep the START/STOP seal-in from the previous puzzle and add X2 in series.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'X2', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'Y0', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 1,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Normal run with healthy E-Stop',
      steps: [
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 120, expect: { Y0: true } },
        { label: 'Press Stop', setInputs: { X1: true }, holdMs: 120, expect: { Y0: false } },
      ],
    },
    {
      name: 'E-Stop drops the motor and blocks restart',
      steps: [
        { label: 'Start motor', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100, expect: { Y0: true } },
        { label: 'Hit E-Stop', setInputs: { X2: false }, holdMs: 120, expect: { Y0: false } },
        {
          label: 'Try to start while pressed',
          setInputs: { X0: true },
          holdMs: 120,
          expect: { Y0: false },
        },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 60 },
      ],
    },
    {
      name: 'Runs again after E-Stop reset',
      initialInputs: { X2: false },
      steps: [
        { label: 'E-Stop still pressed', holdMs: 100, expect: { Y0: false } },
        { label: 'Release E-Stop', setInputs: { X2: true }, holdMs: 100, expect: { Y0: false } },
        { label: 'Press Start', setInputs: { X0: true }, holdMs: 120, expect: { Y0: true } },
      ],
    },
  ],
};
