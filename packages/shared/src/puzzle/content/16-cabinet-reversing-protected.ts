import type { PuzzleSpec } from '../types.js';

export const cabinetReversingProtected: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-reversing-protected',
  title: 'Reversing with Protection',
  difficulty: 'hard',
  order: 20,
  category: 'control-cabinet',
  summary:
    'The full machine: reversing starter with overload, emergency stop and three pilot lights.',
  briefing: [
    'Commission the complete reversing starter for motor M1 — this cabinet has',
    'everything a real one does.',
    '',
    'Power circuit: K1 connects the phases straight through (forward), K2 with',
    'two phases swapped (reverse). Both contactors feed the thermal overload F1',
    '(1-2, 3-4, 5-6) and the overload feeds the motor, so a trip protects both',
    'directions. Interlock the contactors through each other\'s NC auxiliary',
    '(21-22) — closing both at once is a dead short.',
    '',
    'Control circuit: the EMERGENCY STOP S0 (NC) and the overload contact',
    'F1 95-96 must be able to kill BOTH directions, so put them in the common',
    'feed before the circuit splits. Then STOP (S3, NC), and one sealed start',
    'rung per direction: S1 = FORWARD, S2 = REVERSE.',
    '',
    'Indication: H1 (green) lights while running forward, H2 (blue) while',
    'running reverse — wire each in parallel with its contactor coil. H3 (red)',
    'must light while the overload is tripped: F1 closes 97-98 on a trip. Feed',
    'H3 straight from L1 so it shows the trip whatever else is going on.',
  ].join('\n'),
  hints: [
    'Common feed: L1 → S0.21 … S0.22 → F1.95 … F1.96 → S3.21 … S3.22, then split to S1.13 and S2.13.',
    'Forward rung: S1.14 → K2.21 … K2.22 → K1.A1 … K1.A2 → N, sealed by K1.13/14 across S1, with H1 in parallel with the coil (X1→A1, X2→A2). Mirror everything for reverse through K1.21-22.',
    'Forward power: L1→K1.1, L2→K1.3, L3→K1.5. Reverse power: swap two phases into K2 (e.g. L3→K2.1, L2→K2.3, L1→K2.5).',
    'Join both contactor outputs onto the overload inputs (K1.2 and K2.2 → F1.1, …), then F1.2→U, F1.4→V, F1.6→W.',
    'Trip lamp: L1 → F1.97 … F1.98 → H3.X1 … H3.X2 → N.',
  ],
  devices: [
    { address: 'S1', label: 'Forward', io: 'input', widget: 'momentary' },
    { address: 'S2', label: 'Reverse', io: 'input', widget: 'momentary' },
    { address: 'S3', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'S0', label: 'Emergency stop', io: 'input', widget: 'estop' },
    { address: 'F1T', label: 'Overload trip (test)', io: 'input', widget: 'toggle' },
    { address: 'K1', label: 'Contactor FWD', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'K2', label: 'Contactor REV', io: 'output', widget: 'lamp', color: '#a78bfa' },
    { address: 'H1', label: 'Forward lamp', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'H2', label: 'Reverse lamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'H3', label: 'Trip lamp', io: 'output', widget: 'lamp', color: '#ef4444' },
    { address: 'M1', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  cabinet: {
    // Panel: supply + forward contactor on the top row, overload + reverse
    // contactor on the second row; the door strip is a 3-column grid —
    // buttons across the top, pilot lights below, e-stop centered at the
    // bottom; motor below the enclosure. The rail rows sit further right
    // than in the other cabinet puzzles to make room for the wide strip.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 420, y: 80 },
      { id: 'K1', type: 'contactor', label: 'Forward', hmiAddress: 'K1', x: 600, y: 80 },
      { id: 'F1', type: 'overload', label: 'Overload relay', hmiAddress: 'F1T', x: 420, y: 220 },
      { id: 'K2', type: 'contactor', label: 'Reverse', hmiAddress: 'K2', x: 600, y: 220 },
      { id: 'S1', type: 'button-no', label: 'Forward', hmiAddress: 'S1', x: 70, y: 120 },
      { id: 'S2', type: 'button-no', label: 'Reverse', hmiAddress: 'S2', x: 154, y: 120 },
      { id: 'S3', type: 'button-nc', label: 'Stop', hmiAddress: 'S3', x: 238, y: 120 },
      { id: 'H1', type: 'lamp', label: 'Forward', hmiAddress: 'H1', x: 70, y: 210 },
      { id: 'H2', type: 'lamp', label: 'Reverse', hmiAddress: 'H2', x: 154, y: 210 },
      { id: 'H3', type: 'lamp', label: 'Trip', hmiAddress: 'H3', x: 238, y: 210 },
      { id: 'S0', type: 'button-nc', label: 'E-Stop', hmiAddress: 'S0', x: 154, y: 300 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 600, y: 400 },
    ],
    // Diagram sheet: power on the left (both mains into the overload, then the
    // motor); the common e-stop/overload/stop feed at the top right, then the
    // two mirrored sealed direction rungs with coil-parallel lamps, and the
    // trip-lamp rung at the far right.
    schematic: [
      { componentId: 'PS', part: 'phases', x: 150, y: 40 },
      { componentId: 'K1', part: 'main', x: 110, y: 150 },
      { componentId: 'K2', part: 'main', x: 250, y: 150 },
      { componentId: 'F1', part: 'main', x: 150, y: 260 },
      { componentId: 'M1', part: 'motor', x: 150, y: 370 },
      { componentId: 'S0', part: 'contact', x: 430, y: 60 },
      { componentId: 'F1', part: 'aux95', x: 430, y: 150 },
      { componentId: 'S3', part: 'contact', x: 430, y: 240 },
      { componentId: 'S1', part: 'contact', x: 380, y: 330 },
      { componentId: 'K1', part: 'aux13', x: 315, y: 330 },
      { componentId: 'K2', part: 'aux21', x: 380, y: 420 },
      { componentId: 'K1', part: 'coil', x: 380, y: 510 },
      { componentId: 'H1', part: 'lamp', x: 315, y: 510 },
      { componentId: 'S2', part: 'contact', x: 490, y: 330 },
      { componentId: 'K2', part: 'aux13', x: 555, y: 330 },
      { componentId: 'K1', part: 'aux21', x: 490, y: 420 },
      { componentId: 'K2', part: 'coil', x: 490, y: 510 },
      { componentId: 'H2', part: 'lamp', x: 555, y: 510 },
      { componentId: 'F1', part: 'aux97', x: 630, y: 330 },
      { componentId: 'H3', part: 'lamp', x: 630, y: 510 },
      { componentId: 'PS', part: 'npe', x: 435, y: 600 },
    ],
  },
  maxWires: 44,
  scenarios: [
    {
      name: 'Forward runs with its lamp',
      steps: [
        {
          label: 'At rest',
          holdMs: 100,
          expect: { K1: false, K2: false, M1: false, H1: false, H2: false, H3: false },
        },
        {
          label: 'Press Forward',
          setInputs: { S1: true },
          holdMs: 150,
          expect: { K1: true, K2: false, M1: true, H1: true, H2: false },
          expectMachine: { M1_direction: 'fwd' },
        },
        {
          label: 'Release Forward',
          setInputs: { S1: false },
          holdMs: 200,
          expect: { K1: true, M1: true, H1: true },
        },
      ],
    },
    {
      name: 'Reverse runs with its lamp',
      steps: [
        {
          label: 'Press Reverse',
          setInputs: { S2: true },
          holdMs: 150,
          expect: { K2: true, K1: false, M1: true, H2: true, H1: false },
          expectMachine: { M1_direction: 'rev' },
        },
        {
          label: 'Release Reverse',
          setInputs: { S2: false },
          holdMs: 200,
          expect: { K2: true, M1: true, H2: true },
          expectMachine: { M1_direction: 'rev' },
        },
      ],
    },
    {
      name: 'Stop works from either direction',
      steps: [
        { label: 'Run forward', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Press Stop',
          setInputs: { S3: true },
          holdMs: 100,
          expect: { K1: false, K2: false, M1: false, H1: false, H2: false },
        },
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
          expect: { K1: true, K2: false, M1: true, H2: false },
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
      name: 'Emergency stop kills everything',
      steps: [
        { label: 'Run forward', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Hit the E-Stop',
          setInputs: { S0: true },
          holdMs: 150,
          expect: { K1: false, K2: false, M1: false, H1: false, H2: false },
        },
        {
          label: 'Release the E-Stop — no self-restart',
          setInputs: { S0: false },
          holdMs: 200,
          expect: { K1: false, K2: false, M1: false },
        },
      ],
    },
    {
      name: 'Overload trip stops the motor and lights the trip lamp',
      steps: [
        { label: 'Run reverse', setInputs: { S2: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release', setInputs: { S2: false }, holdMs: 100, expect: { M1: true } },
        {
          label: 'Overload trips',
          setInputs: { F1T: true },
          holdMs: 150,
          expect: { K1: false, K2: false, M1: false, H1: false, H2: false, H3: true },
        },
        {
          label: 'Overload resets — lamp clears, no self-restart',
          setInputs: { F1T: false },
          holdMs: 200,
          expect: { K1: false, K2: false, M1: false, H3: false },
        },
      ],
    },
    {
      name: 'Nothing runs on its own',
      steps: [
        {
          label: 'No buttons pressed',
          holdMs: 300,
          expect: { K1: false, K2: false, M1: false, H1: false, H2: false, H3: false },
          expectMachine: { shorted: false },
        },
      ],
    },
  ],
};
