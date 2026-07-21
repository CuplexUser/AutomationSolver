import type { PuzzleSpec } from '../types.js';

export const conveyorStop: PuzzleSpec = {
  kind: 'ladder',
  slug: 'conveyor-stop',
  title: 'Index to Sensor',
  difficulty: 'easy',
  order: 8,
  category: 'stations',
  summary: 'Run a conveyor until a part reaches the sensor, then stop automatically.',
  briefing: [
    'A conveyor indexes a part into a work cell. On START (X0) the BELT (Y0) runs and',
    'seals in. When the PART SENSOR (X2) sees the part arrive, the belt must stop on',
    'its own. STOP (X1) also stops the belt at any time.',
    '',
    'The part sensor is a field device driven by the machine, so you cannot press it.',
    'Break the seal-in when the sensor is made so the belt halts with the part in place.',
  ].join('\n'),
  hints: [
    'Start from the seal-in circuit: (X0 OR Y0) in series with normally-closed X1.',
    'Add a normally-closed X2 contact in series so the belt drops when the part arrives.',
    'The belt is Y0; the sensor is X2.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'X2', label: 'Part Sensor', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Belt', io: 'output', widget: 'motor', color: '#38bdf8' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out'],
  maxRungs: 1,
  processId: 'conveyor',
  scenarios: [
    {
      name: 'Belt runs then stops at the sensor',
      steps: [
        { label: 'Press Start — belt runs', setInputs: { X0: true }, holdMs: 500, expect: { Y0: true, X2: false } },
        { label: 'Release Start — belt seals in', setInputs: { X0: false }, holdMs: 200, expect: { Y0: true } },
        { label: 'Part reaches sensor — belt stops', holdMs: 900, expect: { Y0: false, X2: true } },
        { label: 'Belt stays stopped', holdMs: 300, expect: { Y0: false } },
      ],
    },
    {
      name: 'Stop halts the belt early',
      steps: [
        { label: 'Start the belt', setInputs: { X0: true }, holdMs: 200, expect: { Y0: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100, expect: { Y0: true } },
        { label: 'Press Stop before the part arrives', setInputs: { X1: true }, holdMs: 150, expect: { Y0: false } },
      ],
    },
  ],
};
