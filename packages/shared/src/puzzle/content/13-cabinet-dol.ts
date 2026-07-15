import type { PuzzleSpec } from '../types.js';

export const cabinetDol: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-dol',
  title: 'DOL Motor Starter',
  difficulty: 'medium',
  order: 16,
  category: 'control-cabinet',
  summary: 'Wire a direct-on-line 400V starter: contactor, overload, start/stop with seal-in.',
  briefing: [
    'Commission a direct-on-line (DOL) starter for the 400 V motor M1.',
    '',
    'Power circuit: all three phases L1/L2/L3 run through the contactor mains',
    '(K1: 1-2, 3-4, 5-6), then through the thermal overload (F1: 1-2, 3-4, 5-6)',
    'to the motor terminals U, V, W. The motor must run forward (phase order',
    'L1→U, L2→V, L3→W).',
    '',
    'Control circuit (L1 → … → N): the STOP button S2 (NC), the START button S1',
    '(NO) with a seal-in contact so the motor keeps running after START is',
    'released (use K1 aux 13-14 in parallel with S1), the contactor coil',
    'K1 A1-A2, and the overload NC contact F1 95-96 so a trip stops the motor',
    'and prevents a restart until the overload is reset.',
  ].join('\n'),
  hints: [
    'Control path: L1 → S2.21 … S2.22 → S1.13 … S1.14 → K1.A1 … K1.A2 → F1.95 … F1.96 → N.',
    'Seal-in: wire K1.13 to S1.13 and K1.14 to S1.14 — the aux contact bridges the START button once K1 pulls in.',
    'Power path per phase: L1 → K1.1, K1.2 → F1.1, F1.2 → U (and likewise 3/4 → V, 5/6 → W).',
    'Use the "Overload trip (test)" toggle on the operator panel to verify the trip behavior.',
  ],
  devices: [
    { address: 'S1', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'S2', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'F1T', label: 'Overload trip (test)', io: 'input', widget: 'toggle' },
    { address: 'K1', label: 'Contactor', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'M1', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  cabinet: {
    // Panel: two DIN-rail rows (supply + contactor, then the overload),
    // start/stop buttons on the door strip, motor below the enclosure.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 250, y: 80 },
      { id: 'K1', type: 'contactor', label: 'Contactor', hmiAddress: 'K1', x: 430, y: 80 },
      { id: 'F1', type: 'overload', label: 'Overload relay', hmiAddress: 'F1T', x: 250, y: 220 },
      { id: 'S1', type: 'button-no', label: 'Start', hmiAddress: 'S1', x: 70, y: 150 },
      { id: 'S2', type: 'button-nc', label: 'Stop', hmiAddress: 'S2', x: 70, y: 250 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 430, y: 380 },
    ],
    // Diagram sheet: power circuit on the left (rails → K1 main → F1 main →
    // motor), control rung on the right, spare contacts parked at the margin.
    schematic: [
      { componentId: 'PS', part: 'phases', x: 140, y: 40 },
      { componentId: 'K1', part: 'main', x: 140, y: 140 },
      { componentId: 'F1', part: 'main', x: 140, y: 240 },
      { componentId: 'M1', part: 'motor', x: 140, y: 350 },
      { componentId: 'S2', part: 'contact', x: 420, y: 120 },
      { componentId: 'S1', part: 'contact', x: 420, y: 210 },
      { componentId: 'K1', part: 'aux13', x: 500, y: 210 },
      { componentId: 'K1', part: 'coil', x: 420, y: 310 },
      { componentId: 'F1', part: 'aux95', x: 420, y: 400 },
      { componentId: 'PS', part: 'npe', x: 420, y: 490 },
      { componentId: 'K1', part: 'aux21', x: 590, y: 120 },
      { componentId: 'F1', part: 'aux97', x: 590, y: 210 },
    ],
  },
  maxWires: 24,
  scenarios: [
    {
      name: 'Start and seal in',
      steps: [
        { label: 'At rest', holdMs: 100, expect: { K1: false, M1: false } },
        {
          label: 'Press Start',
          setInputs: { S1: true },
          holdMs: 150,
          expect: { K1: true, M1: true },
          expectMachine: { M1_direction: 'fwd' },
        },
        {
          label: 'Release Start',
          setInputs: { S1: false },
          holdMs: 200,
          expect: { K1: true, M1: true },
        },
      ],
    },
    {
      name: 'Stop drops the motor',
      steps: [
        { label: 'Press Start', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release Start', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        { label: 'Press Stop', setInputs: { S2: true }, holdMs: 100, expect: { K1: false, M1: false } },
        { label: 'Release Stop', setInputs: { S2: false }, holdMs: 150, expect: { K1: false, M1: false } },
      ],
    },
    {
      name: 'Overload trip protects the motor',
      steps: [
        { label: 'Start the motor', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release Start', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Overload trips',
          setInputs: { F1T: true },
          holdMs: 150,
          expect: { K1: false, M1: false },
        },
        {
          label: 'Overload resets — no self-restart',
          setInputs: { F1T: false },
          holdMs: 200,
          expect: { K1: false, M1: false },
        },
      ],
    },
    {
      name: 'Nothing runs on its own',
      steps: [
        {
          label: 'No buttons pressed',
          holdMs: 300,
          expect: { K1: false, M1: false },
          expectMachine: { shorted: false },
        },
      ],
    },
  ],
};
