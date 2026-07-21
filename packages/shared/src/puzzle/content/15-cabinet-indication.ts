import type { PuzzleSpec } from '../types.js';

export const cabinetIndication: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-indication',
  title: 'Run & Trip Indication',
  difficulty: 'medium',
  order: 19,
  category: 'control-cabinet',
  summary: 'Add pilot lights to a DOL starter: a run lamp on the coil, a trip lamp on the overload.',
  briefing: [
    'The DOL starter from the last work order is back. This time the door gets',
    'two pilot lights so the operator can see what the cabinet is doing.',
    '',
    'Wire the starter as before: all three phases through the contactor',
    '(K1: 1-2, 3-4, 5-6) and the thermal overload (F1: 1-2, 3-4, 5-6) to the',
    'motor, and the control rung L1 → STOP (S2) → START (S1, sealed by K1',
    '13-14) → K1 coil → F1 95-96 → N.',
    '',
    'Indication: the green RUN lamp H1 must light exactly when K1 is pulled in',
    '(wire it in parallel with the coil). The red TRIP lamp H2 must light while',
    'the overload is tripped: F1 closes its 97-98 auxiliary contact on a trip.',
  ].join('\n'),
  hints: [
    'Run lamp: H1.X1 to K1.A1 and H1.X2 to K1.A2 — the lamp sees exactly the voltage the coil sees.',
    'Trip lamp: L1 → F1.97 … F1.98 → H2.X1 … H2.X2 → N. Feed it straight from L1 so it works even while the control rung is dead.',
    'Control path: L1 → S2.21 … S2.22 → S1.13 … S1.14 → K1.A1 … K1.A2 → F1.95 … F1.96 → N, with K1.13/14 sealing across S1.',
    'Use the "Overload trip (test)" toggle to verify: motor and run lamp drop, trip lamp lights, and nothing restarts on reset.',
  ],
  devices: [
    { address: 'S1', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'S2', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'F1T', label: 'Overload trip (test)', io: 'input', widget: 'toggle' },
    { address: 'K1', label: 'Contactor', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'H1', label: 'Run lamp', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'H2', label: 'Trip lamp', io: 'output', widget: 'lamp', color: '#ef4444' },
    { address: 'M1', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  cabinet: {
    // Panel: same two rail rows as the DOL starter; the door strip grows two
    // pilot lights under the buttons.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 250, y: 80 },
      { id: 'K1', type: 'contactor', label: 'Contactor', hmiAddress: 'K1', x: 430, y: 80 },
      { id: 'F1', type: 'overload', label: 'Overload relay', hmiAddress: 'F1T', x: 250, y: 220 },
      { id: 'S1', type: 'button-no', label: 'Start', hmiAddress: 'S1', x: 70, y: 150 },
      { id: 'S2', type: 'button-nc', label: 'Stop', hmiAddress: 'S2', x: 70, y: 250 },
      { id: 'H1', type: 'lamp', label: 'Run', hmiAddress: 'H1', x: 70, y: 350 },
      { id: 'H2', type: 'lamp', label: 'Trip', hmiAddress: 'H2', x: 70, y: 450 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 430, y: 380 },
    ],
    // Diagram sheet: DOL power column on the left; control rung with the run
    // lamp parallel to the coil, and a separate trip-lamp rung on the right.
    schematic: [
      { componentId: 'PS', part: 'phases', x: 140, y: 40 },
      { componentId: 'K1', part: 'main', x: 140, y: 140 },
      { componentId: 'F1', part: 'main', x: 140, y: 240 },
      { componentId: 'M1', part: 'motor', x: 140, y: 350 },
      { componentId: 'S2', part: 'contact', x: 420, y: 120 },
      { componentId: 'S1', part: 'contact', x: 420, y: 210 },
      { componentId: 'K1', part: 'aux13', x: 500, y: 210 },
      { componentId: 'K1', part: 'coil', x: 420, y: 310 },
      { componentId: 'H1', part: 'lamp', x: 500, y: 310 },
      { componentId: 'F1', part: 'aux95', x: 420, y: 400 },
      { componentId: 'PS', part: 'npe', x: 420, y: 490 },
      { componentId: 'F1', part: 'aux97', x: 590, y: 120 },
      { componentId: 'H2', part: 'lamp', x: 590, y: 300 },
      { componentId: 'K1', part: 'aux21', x: 660, y: 400 },
    ],
  },
  maxWires: 28,
  scenarios: [
    {
      name: 'Start, seal in, run lamp follows',
      steps: [
        { label: 'At rest', holdMs: 100, expect: { K1: false, M1: false, H1: false, H2: false } },
        {
          label: 'Press Start',
          setInputs: { S1: true },
          holdMs: 150,
          expect: { K1: true, M1: true, H1: true, H2: false },
          expectMachine: { M1_direction: 'fwd' },
        },
        {
          label: 'Release Start',
          setInputs: { S1: false },
          holdMs: 200,
          expect: { K1: true, M1: true, H1: true },
        },
      ],
    },
    {
      name: 'Stop drops motor and run lamp',
      steps: [
        { label: 'Press Start', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release Start', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Press Stop',
          setInputs: { S2: true },
          holdMs: 100,
          expect: { K1: false, M1: false, H1: false },
        },
        {
          label: 'Release Stop',
          setInputs: { S2: false },
          holdMs: 150,
          expect: { K1: false, M1: false, H1: false },
        },
      ],
    },
    {
      name: 'Trip lights the trip lamp',
      steps: [
        { label: 'Start the motor', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release Start', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Overload trips',
          setInputs: { F1T: true },
          holdMs: 150,
          expect: { K1: false, M1: false, H1: false, H2: true },
        },
        {
          label: 'Overload resets — lamp clears, no self-restart',
          setInputs: { F1T: false },
          holdMs: 200,
          expect: { K1: false, M1: false, H1: false, H2: false },
        },
      ],
    },
    {
      name: 'Nothing runs on its own',
      steps: [
        {
          label: 'No buttons pressed',
          holdMs: 300,
          expect: { K1: false, M1: false, H1: false, H2: false },
          expectMachine: { shorted: false },
        },
      ],
    },
  ],
};
