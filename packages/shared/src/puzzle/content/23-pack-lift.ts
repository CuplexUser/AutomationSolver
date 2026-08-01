import type { PuzzleSpec } from '../types.js';

export const packLift: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pack-lift',
  title: 'Packer: Lift & Flip',
  difficulty: 'hard',
  order: 23,
  category: 'packaging',
  summary: 'Flip each loaded 4-pack over into section 3. Four flips build the 16-pack.',
  briefing: [
    'The lift is a flipper. Drive it up with a 4-pack on the tray and it tips the group',
    'over the wall into section 3, where the cartons land standing on end. Each flip',
    'shoves the previous column along, so four flips stack a block of 16.',
    '',
    '## Equipment',
    '- The whole front end from the previous work orders: pair strokes, stroke counter',
    '  and 4-pack load.',
    '- Y2 LIFT / FLIPPER, with sensors X4 LIFT DOWN and X5 LIFT UP.',
    '- M0: flip in progress (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. When the 4-pack pusher reaches OUT (X3), the group is on the tray. Latch a flip',
    '   request and drive Y2 from the latch.',
    '2. Hold the command on. The lift physically refuses to rise while the 4-pack rod',
    '   is still under the tray, and goes as soon as the rod clears X2.',
    '3. At the top (X5) the load tips over the wall into section 3.',
    '4. Release the latch so the lift comes back down, ready for the next group.',
    '',
    '## Field notes',
    '- X3 is true only for a moment while the 4-pack pusher is out, but the flip takes',
    '  much longer. Latching it is what keeps the lift up: an unlatched X3 to Y2 rung',
    '  drops the lift as soon as the pusher springs home.',
    '- The rise needs no interlock of your own. The machine holds the lift at the',
    '  bottom until the rod is home, as long as the command stays on.',
    '- The retaining bracket that backs the tippy on-end stack is parked forward for',
    '  you in this work order.',
    '',
    '## Acceptance',
    '- Let it run: the line should flip group after group without a jam.',
  ].join('\n'),
  hints: [
    'Three new rungs on top of the 4-pack solution: X3 → SET M0, then M0 → Y2, then ' +
      'X5 → RST M0.',
    'Latching off X3 matters: it is only true for a moment while the 4-pack pusher is ' +
      'out, but the flip takes much longer: an unlatched X3 → Y2 drops the lift the ' +
      'moment the pusher springs home.',
    'No extra interlock is needed for the rise itself: the machine holds the lift at ' +
      'the bottom until the 4-pack rod is home, as long as Y2 stays commanded.',
  ],
  devices: [
    { address: 'X14', label: 'Box at Stop (near)', io: 'input', widget: 'sensor' },
    { address: 'X15', label: 'Box at Stop (far)', io: 'input', widget: 'sensor' },
    { address: 'X0', label: '2-Pack In', io: 'input', widget: 'sensor' },
    { address: 'X1', label: '2-Pack Out', io: 'input', widget: 'sensor' },
    { address: 'X2', label: '4-Pack In', io: 'input', widget: 'sensor' },
    { address: 'X3', label: '4-Pack Out', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Lift Down', io: 'input', widget: 'sensor' },
    { address: 'X5', label: 'Lift Up', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: '2-Pack Pusher', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: '4-Pack Pusher', io: 'output', widget: 'motor', color: '#f59e0b' },
    { address: 'Y2', label: 'Lift / Flipper', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  registers: [
    { address: 'C0', label: 'Pair-stroke counter', note: 'preset K=2: two strokes = one 4-pack' },
    { address: 'M0', label: 'Flip in progress' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset', 'counter'],
  maxRungs: 9,
  processId: 'packaging',
  scenarios: [
    {
      name: 'Loaded 4-packs flip over into section 3',
      steps: [
        {
          label: 'First 4-pack loads onto the lift',
          holdMs: 4600,
          expect: { Y2: true },
          expectMachine: { liftLoad: 4, jam: false },
        },
        {
          label: 'Flip! Four cartons land on end in section 3',
          holdMs: 1400,
          expect: { Y2: false },
          expectMachine: { sec3: 4, liftLoad: 0, jam: false },
        },
        { label: 'Lift back down, ready for the next group', holdMs: 900, expect: { X4: true } },
        {
          label: 'Second flip lands: eight cartons staged',
          holdMs: 2400,
          expectMachine: { sec3: 8, jam: false },
        },
      ],
    },
    {
      name: 'Machine starts empty: everything rests',
      steps: [
        { label: 'Lanes still filling: no strokes, lift stays down', holdMs: 900, expect: { Y0: false, Y1: false, Y2: false, X4: true } },
      ],
    },
  ],
};
