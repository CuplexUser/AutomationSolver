import type { PuzzleSpec } from '../types.js';

export const cabinetTwoStation: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-two-station',
  title: 'Control from Two Stations',
  difficulty: 'medium',
  order: 17,
  category: 'control-cabinet',
  summary: 'Start and stop one DOL motor from two separate push-button stations.',
  briefing: [
    'Motor M1 is started and stopped from two places: a local station (S1 start,',
    'S2 stop) and a remote station (S3 start, S4 stop). Either START must be able',
    'to run it; either STOP must be able to halt it.',
    '',
    'Power circuit: the usual DOL path, all three phases through the contactor K1',
    'mains and the overload F1 to the motor (L1→U, L2→V, L3→W).',
    '',
    'Control circuit (L1 → … → N): put BOTH stop buttons (NC) in series so either',
    'one breaks the circuit, then BOTH start buttons (NO) in parallel so either one',
    'makes it, with the contactor seal-in aux (K1 13-14) parallel across the start',
    'group. Finish through the coil K1 A1-A2 and the overload NC contact F1 95-96.',
  ].join('\n'),
  hints: [
    'Stops in series: L1 → S2.21 … S2.22 → S4.21 … S4.22 → (start group).',
    'Starts in parallel: tie S1.13, S3.13 and the seal K1.13 all to the node after',
    'the stops (S4.22); tie S1.14, S3.14 and K1.14 all to the coil K1.A1.',
    'Coil return: K1.A2 → F1.95 … F1.96 → N.',
    'Power path per phase: L1 → K1.1, K1.2 → F1.1, F1.2 → U (and 3/4 → V, 5/6 → W).',
  ],
  devices: [
    { address: 'S1', label: 'Start (local)', io: 'input', widget: 'momentary' },
    { address: 'S2', label: 'Stop (local)', io: 'input', widget: 'momentary' },
    { address: 'S3', label: 'Start (remote)', io: 'input', widget: 'momentary' },
    { address: 'S4', label: 'Stop (remote)', io: 'input', widget: 'momentary' },
    { address: 'F1T', label: 'Overload trip (test)', io: 'input', widget: 'toggle' },
    { address: 'K1', label: 'Contactor', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'M1', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  cabinet: {
    // Panel: supply + contactor on the top rail, overload on the second; the two
    // button stations side by side on the door strip (start over stop each),
    // motor below the enclosure.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 250, y: 80 },
      { id: 'K1', type: 'contactor', label: 'Contactor', hmiAddress: 'K1', x: 430, y: 80 },
      { id: 'F1', type: 'overload', label: 'Overload relay', hmiAddress: 'F1T', x: 250, y: 220 },
      { id: 'S1', type: 'button-no', label: 'Start (local)', hmiAddress: 'S1', x: 70, y: 120 },
      { id: 'S2', type: 'button-nc', label: 'Stop (local)', hmiAddress: 'S2', x: 70, y: 230 },
      { id: 'S3', type: 'button-no', label: 'Start (remote)', hmiAddress: 'S3', x: 154, y: 120 },
      { id: 'S4', type: 'button-nc', label: 'Stop (remote)', hmiAddress: 'S4', x: 154, y: 230 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 430, y: 380 },
    ],
    // Diagram sheet: power circuit on the left (rails → K1 main → F1 main →
    // motor); control rung on the right — both stops in series at the top, the
    // parallel start/seal group below, then coil and overload NC to N. Spare
    // aux contacts parked at the right margin.
    schematic: [
      { componentId: 'PS', part: 'phases', x: 140, y: 40 },
      { componentId: 'K1', part: 'main', x: 140, y: 140 },
      { componentId: 'F1', part: 'main', x: 140, y: 240 },
      { componentId: 'M1', part: 'motor', x: 140, y: 350 },
      { componentId: 'S2', part: 'contact', x: 470, y: 60 },
      { componentId: 'S4', part: 'contact', x: 470, y: 150 },
      { componentId: 'S1', part: 'contact', x: 400, y: 250 },
      { componentId: 'S3', part: 'contact', x: 470, y: 250 },
      { componentId: 'K1', part: 'aux13', x: 540, y: 250 },
      { componentId: 'K1', part: 'coil', x: 470, y: 360 },
      { componentId: 'F1', part: 'aux95', x: 470, y: 450 },
      { componentId: 'PS', part: 'npe', x: 470, y: 540 },
      { componentId: 'K1', part: 'aux21', x: 660, y: 60 },
      { componentId: 'F1', part: 'aux97', x: 660, y: 150 },
    ],
  },
  maxWires: 26,
  scenarios: [
    {
      name: 'Local start, local stop',
      steps: [
        { label: 'At rest', holdMs: 100, expect: { K1: false, M1: false } },
        {
          label: 'Press local Start',
          setInputs: { S1: true },
          holdMs: 150,
          expect: { K1: true, M1: true },
          expectMachine: { M1_direction: 'fwd' },
        },
        { label: 'Release — sealed in', setInputs: { S1: false }, holdMs: 150, expect: { K1: true, M1: true } },
        { label: 'Press local Stop', setInputs: { S2: true }, holdMs: 100, expect: { K1: false, M1: false } },
        { label: 'Release Stop', setInputs: { S2: false }, holdMs: 100, expect: { M1: false } },
      ],
    },
    {
      name: 'Remote start, remote stop',
      steps: [
        { label: 'Press remote Start', setInputs: { S3: true }, holdMs: 150, expect: { K1: true, M1: true } },
        { label: 'Release — sealed in', setInputs: { S3: false }, holdMs: 150, expect: { M1: true } },
        { label: 'Press remote Stop', setInputs: { S4: true }, holdMs: 100, expect: { K1: false, M1: false } },
        { label: 'Release Stop', setInputs: { S4: false }, holdMs: 100, expect: { M1: false } },
      ],
    },
    {
      name: 'Either stop halts either start',
      steps: [
        { label: 'Start locally', setInputs: { S1: true }, holdMs: 120, expect: { M1: true } },
        { label: 'Release', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        { label: 'Stop from the remote station', setInputs: { S4: true }, holdMs: 100, expect: { M1: false } },
        { label: 'Release remote stop', setInputs: { S4: false }, holdMs: 100, expect: { M1: false } },
        { label: 'Start remotely', setInputs: { S3: true }, holdMs: 120, expect: { M1: true } },
        { label: 'Release', setInputs: { S3: false }, holdMs: 100, expect: { M1: true } },
        { label: 'Stop from the local station', setInputs: { S2: true }, holdMs: 100, expect: { M1: false } },
      ],
    },
    {
      name: 'Overload trip protects the motor',
      steps: [
        { label: 'Start the motor', setInputs: { S1: true }, holdMs: 100, expect: { M1: true } },
        { label: 'Release Start', setInputs: { S1: false }, holdMs: 100, expect: { M1: true } },
        { label: 'Overload trips', setInputs: { F1T: true }, holdMs: 150, expect: { K1: false, M1: false } },
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
