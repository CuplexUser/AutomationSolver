import type { PuzzleSpec } from '../types.js';

export const cabinetLamp: PuzzleSpec = {
  kind: 'cabinet',
  slug: 'cabinet-lamp',
  title: 'Panel Lamp Circuit',
  difficulty: 'tutorial',
  order: 15,
  category: 'control-cabinet',
  summary: 'Wire your first control circuit: a pushbutton switching a panel lamp.',
  briefing: [
    'Welcome to the control cabinet. Here you wire real components instead of writing',
    'ladder logic: click one terminal, then another, to run a wire between them. The',
    'job is a panel indicator lamp driven by a test button.',
    '',
    '## Equipment',
    '- S1 LAMP TEST BUTTON: momentary, contact 13-14, closed only while held.',
    '- H1 PANEL LAMP: terminals X1 and X2.',
    '- The supply: phase L1 and neutral N, 230 V control voltage.',
    '',
    '## Control circuit',
    '1. Run a wire from L1 to the button input S1.13.',
    '2. Continue from the button output S1.14 to the lamp terminal H1.X1.',
    '3. Return from H1.X2 to N.',
    '',
    '## Safety rules',
    '- Never join L1 straight to N, or to another phase, without a load in between.',
    '  That is a dead short and the main breaker trips.',
    '- PE (protective earth) is not part of this circuit.',
    '',
    '## Acceptance',
    '- The lamp lights while the button is held and goes dark when it is released,',
    '  with no short at any point.',
  ].join('\n'),
  hints: [
    'Three wires: L1 → S1.13, S1.14 → H1.X1, H1.X2 → N.',
    'The button conducts 13→14 only while pressed; the lamp lights when its two terminals sit on L1 and N.',
    'PE (protective earth) is not needed for this circuit.',
  ],
  devices: [
    { address: 'S1', label: 'Lamp test button', io: 'input', widget: 'momentary' },
    { address: 'H1', label: 'Panel lamp', io: 'output', widget: 'lamp', color: '#facc15' },
  ],
  cabinet: {
    // Panel: rail-mounted gear on DIN-rail rows inside the enclosure,
    // buttons/lamps on the door strip at the left.
    components: [
      { id: 'PS', type: 'supply3ph', label: '400V supply', x: 250, y: 80 },
      { id: 'S1', type: 'button-no', label: 'Test button', hmiAddress: 'S1', x: 70, y: 150 },
      { id: 'H1', type: 'lamp', label: 'Panel lamp', hmiAddress: 'H1', x: 70, y: 280 },
    ],
    // Diagram sheet: one control rung between the L1 rail (top) and N rail (bottom).
    schematic: [
      { componentId: 'PS', part: 'phases', x: 200, y: 40 },
      { componentId: 'S1', part: 'contact', x: 200, y: 150 },
      { componentId: 'H1', part: 'lamp', x: 200, y: 260 },
      { componentId: 'PS', part: 'npe', x: 200, y: 370 },
    ],
  },
  maxWires: 6,
  scenarios: [
    {
      name: 'Lamp follows the button',
      steps: [
        { label: 'At rest', holdMs: 100, expect: { H1: false }, expectMachine: { shorted: false } },
        { label: 'Press S1', setInputs: { S1: true }, holdMs: 150, expect: { H1: true } },
        { label: 'Release S1', setInputs: { S1: false }, holdMs: 150, expect: { H1: false } },
      ],
    },
    {
      name: 'No short circuits',
      steps: [
        { label: 'At rest', holdMs: 100, expectMachine: { shorted: false } },
        { label: 'Held down', setInputs: { S1: true }, holdMs: 200, expectMachine: { shorted: false } },
      ],
    },
  ],
};
