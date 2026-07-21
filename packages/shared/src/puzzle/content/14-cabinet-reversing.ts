import type { PuzzleSpec } from '../types.js';

export const cabinetReversing: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-reversing',
  title: 'Reversing Starter',
  difficulty: 'hard',
  order: 18,
  category: 'control-cabinet',
  summary: 'Two interlocked contactors drive the motor forward and reverse — without shorts.',
  briefing: [
    'The 400 V motor M1 must run in both directions. Contactor K1 connects the',
    'phases straight through (forward); contactor K2 must connect them with two',
    'phases swapped, which reverses the rotating field.',
    '',
    'If K1 and K2 ever close together they connect phase to phase: a dead short.',
    'Interlock them electrically: route each coil through the OTHER contactor\'s',
    'NC auxiliary contact (21-22), so pressing REVERSE while running forward does',
    'nothing until STOP is pressed first.',
    '',
    'Controls: S1 = FORWARD (NO), S2 = REVERSE (NO), S3 = STOP (NC). Each',
    'direction seals itself in with its own aux 13-14 contact.',
  ].join('\n'),
  hints: [
    'Forward control: L1 → S3.21 … S3.22 → S1.13 … S1.14 → K2.21 … K2.22 → K1.A1 … K1.A2 → N. Mirror it for reverse through K1.21-22.',
    'Seal each direction across its own start button: K1.13→S1.13 / K1.14→S1.14, and K2.13→S2.13 / K2.14→S2.14.',
    'Forward power: L1→K1.1, L2→K1.3, L3→K1.5, then K1.2→U, K1.4→V, K1.6→W.',
    'Reverse power: feed K2 with two phases swapped (e.g. L3→K2.1, L2→K2.3, L1→K2.5) and land K2.2/4/6 on the same U/V/W terminals.',
  ],
  devices: [
    { address: 'S1', label: 'Forward', io: 'input', widget: 'momentary' },
    { address: 'S2', label: 'Reverse', io: 'input', widget: 'momentary' },
    { address: 'S3', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'K1', label: 'Contactor FWD', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'K2', label: 'Contactor REV', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'M1', label: 'Motor', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  cabinet: {
    // Panel: supply + forward contactor on the top rail row, reverse contactor
    // on the second row, three door buttons, motor below the enclosure.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 250, y: 80 },
      { id: 'K1', type: 'contactor', label: 'Forward', hmiAddress: 'K1', x: 430, y: 80 },
      { id: 'K2', type: 'contactor', label: 'Reverse', hmiAddress: 'K2', x: 430, y: 220 },
      { id: 'S1', type: 'button-no', label: 'Forward', hmiAddress: 'S1', x: 70, y: 120 },
      { id: 'S2', type: 'button-no', label: 'Reverse', hmiAddress: 'S2', x: 70, y: 220 },
      { id: 'S3', type: 'button-nc', label: 'Stop', hmiAddress: 'S3', x: 70, y: 320 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 430, y: 390 },
    ],
    // Diagram sheet: two power branches (K1 straight, K2 phase-swapped) into
    // one motor; two mirrored control rungs with cross interlocks.
    schematic: [
      { componentId: 'PS', part: 'phases', x: 150, y: 40 },
      { componentId: 'K1', part: 'main', x: 110, y: 150 },
      { componentId: 'K2', part: 'main', x: 250, y: 150 },
      { componentId: 'M1', part: 'motor', x: 150, y: 330 },
      { componentId: 'S3', part: 'contact', x: 430, y: 110 },
      { componentId: 'S1', part: 'contact', x: 380, y: 200 },
      { componentId: 'K1', part: 'aux13', x: 315, y: 200 },
      { componentId: 'K2', part: 'aux21', x: 380, y: 290 },
      { componentId: 'K1', part: 'coil', x: 380, y: 380 },
      { componentId: 'S2', part: 'contact', x: 490, y: 200 },
      { componentId: 'K2', part: 'aux13', x: 555, y: 200 },
      { componentId: 'K1', part: 'aux21', x: 490, y: 290 },
      { componentId: 'K2', part: 'coil', x: 490, y: 380 },
      { componentId: 'PS', part: 'npe', x: 435, y: 470 },
    ],
  },
  maxWires: 32,
  scenarios: [
    {
      name: 'Forward runs and seals in',
      steps: [
        { label: 'At rest', holdMs: 100, expect: { K1: false, K2: false, M1: false } },
        {
          label: 'Press Forward',
          setInputs: { S1: true },
          holdMs: 150,
          expect: { K1: true, K2: false, M1: true },
          expectMachine: { M1_direction: 'fwd' },
        },
        {
          label: 'Release Forward',
          setInputs: { S1: false },
          holdMs: 200,
          expect: { K1: true, M1: true },
        },
      ],
    },
    {
      name: 'Reverse runs and seals in',
      steps: [
        {
          label: 'Press Reverse',
          setInputs: { S2: true },
          holdMs: 150,
          expect: { K2: true, K1: false, M1: true },
          expectMachine: { M1_direction: 'rev' },
        },
        {
          label: 'Release Reverse',
          setInputs: { S2: false },
          holdMs: 200,
          expect: { K2: true, M1: true },
          expectMachine: { M1_direction: 'rev' },
        },
      ],
    },
    {
      name: 'Stop works from either direction',
      steps: [
        { label: 'Run forward', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        { label: 'Press Stop', setInputs: { S3: true }, holdMs: 100, expect: { K1: false, K2: false, M1: false } },
        { label: 'Release Stop', setInputs: { S3: false }, holdMs: 150, expect: { M1: false } },
      ],
    },
    {
      name: 'Interlock blocks a live reversal',
      steps: [
        { label: 'Run forward', setInputs: { S1: true }, holdMs: 100, expect: { K1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { K1: true } },
        {
          label: 'Press Reverse while running forward',
          setInputs: { S2: true },
          holdMs: 200,
          expect: { K1: true, K2: false, M1: true },
          expectMachine: { shorted: false, M1_direction: 'fwd' },
        },
        {
          label: 'Release Reverse — still forward',
          setInputs: { S2: false },
          holdMs: 150,
          expect: { K1: true, K2: false },
          expectMachine: { M1_direction: 'fwd' },
        },
      ],
    },
    {
      name: 'Stop, then reverse',
      steps: [
        { label: 'Run forward', setInputs: { S1: true }, holdMs: 100, expect: { K1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { K1: true } },
        { label: 'Press Stop', setInputs: { S3: true }, holdMs: 100, expect: { K1: false } },
        { label: 'Release Stop', setInputs: { S3: false }, holdMs: 100, expect: { K1: false } },
        {
          label: 'Press Reverse',
          setInputs: { S2: true },
          holdMs: 150,
          expect: { K2: true, M1: true },
          expectMachine: { M1_direction: 'rev' },
        },
      ],
    },
    {
      name: 'Nothing runs on its own',
      steps: [
        {
          label: 'No buttons pressed',
          holdMs: 300,
          expect: { K1: false, K2: false, M1: false },
          expectMachine: { shorted: false },
        },
      ],
    },
  ],
};
