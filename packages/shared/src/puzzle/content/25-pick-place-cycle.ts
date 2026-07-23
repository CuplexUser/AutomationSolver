import type { PuzzleSpec } from '../types.js';

export const pickPlaceCycle: PuzzleSpec = {
  kind: 'ladder',
  slug: 'pick-place-cycle',
  title: 'Pick & Place: First Transfer',
  difficulty: 'medium',
  order: 25,
  category: 'pick-place',
  summary: 'Command reach, grip and swing through one clean transfer from infeed to tray.',
  briefing: [
    'Commission the robot cell with its first automatic transfer. The articulated',
    'arm serves one INFEED pad, fed by the conveyor, and one TRAY pad. All position',
    'sensors are prewired. Your program commands the four axis outputs.',
    '',
    'Operating procedure:',
    '',
    '  1. The arm powers up parked at the infeed (X0), reach up (X11), gripper open.',
    '  2. Command Reach Down (Y2) and wait for the down sensor (X10).',
    '  3. Close the gripper (Y3). The part is confirmed held when Gripped (X12)',
    '     turns on.',
    '  4. Drop Y2 so the arm lifts the part. Keep Y3 on the whole way.',
    '  5. At reach up (X11), command Swing to Tray (Y0). Drop Y0 on arrival at the',
    '     tray (X1).',
    '  6. Lower the reach again. At X10, drop Y3 to set the part down. The pad',
    '     confirms with Slot Occupied (X14).',
    '  7. Retract, command Swing to Infeed (Y1), and drop Y1 at X0.',
    '',
    'Safety notes:',
    '',
    '  1. The tray pad holds one part. While X14 is on, do not lower the reach or',
    '     close the gripper again. Park the arm retracted at the infeed.',
    '  2. Only open the gripper while carrying if the reach is fully down. A part',
    '     released mid-air jams the cell and lights the red beacon on the mast.',
    '  3. The swing axis is interlocked in hardware: the arm refuses to swing while',
    '     the reach is extended.',
  ].join('\n'),
  hints: [
    'Track the part with a Carrying latch M0: SET it on rise(X12), RESET it on ' +
      'rise(X14).',
    'Y2 needs two SET branches ORed together: at the infeed (X0, not carrying, X14 ' +
      'off), or at the tray (X1, carrying). RESET Y2 on rise(X12) or rise(X14): ' +
      'either milestone means retract.',
    'Y3: SET at the infeed once the reach is down (X10), not carrying, with X14 ' +
      'off. RESET at the tray once the reach is down while carrying.',
    'The swing rungs mirror each other: SET Y0 on M0 and X11, RESET it on X1. SET ' +
      'Y1 on nc(M0) and X11, RESET it on X0.',
  ],
  devices: [
    { address: 'X0', label: 'At Infeed', io: 'input', widget: 'sensor' },
    { address: 'X1', label: 'At Tray', io: 'input', widget: 'sensor' },
    { address: 'X10', label: 'Reach Down', io: 'input', widget: 'sensor' },
    { address: 'X11', label: 'Reach Up', io: 'input', widget: 'sensor' },
    { address: 'X12', label: 'Gripped', io: 'input', widget: 'sensor' },
    { address: 'X14', label: 'Slot Occupied', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Swing to Tray', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Swing to Infeed', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y2', label: 'Reach Down', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y3', label: 'Gripper Close', io: 'output', widget: 'motor', color: '#f59e0b' },
  ],
  registers: [
    { address: 'M0', label: 'Carrying', note: 'set on rise(X12), reset on rise(X14)' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'contact-rising', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 12,
  processId: 'pickPlace',
  scenarios: [
    {
      name: 'Full automatic pick-and-place cycle',
      steps: [
        {
          label: 'Reach lowers at the infeed before the gripper closes',
          holdMs: 200,
          expect: { Y2: true, Y3: false },
        },
        {
          label: 'Gripper closes once reach bottoms out',
          holdMs: 1000,
          expect: { Y3: true },
        },
        {
          label: 'Full stroke: part is picked, swung across, and placed on the tray pad',
          holdMs: 3800,
          expectMachine: { placed: 1, jam: false },
          expect: { X14: true },
        },
        {
          label: 'Pad occupied: the arm parks retracted at the infeed instead of double-loading',
          holdMs: 4000,
          expectMachine: { placed: 1, jam: false },
          expect: { Y2: false, Y3: false, X0: true },
        },
      ],
    },
  ],
};
