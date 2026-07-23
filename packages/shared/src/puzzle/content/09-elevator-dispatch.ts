import type { PuzzleSpec } from '../types.js';

export const elevatorDispatch: PuzzleSpec = {
  kind: 'ladder',
  slug: 'elevator-5-dispatch',
  title: 'Elevator — 5-Floor Dispatch',
  difficulty: 'hard',
  order: 12,
  category: 'elevator',
  summary: 'Wire per-floor call buttons so a 5-floor car dispatches toward whichever floors are called.',
  briefing: [
    'A 5-floor passenger elevator with a call button on every floor (X0-X4, floors 1-5).',
    'Pressing a call button must light that floor\'s call lamp (M0-M4) and, eventually,',
    'send the car there.',
    '',
    'Drive the car UP (Y0) toward any pending call above it, or DOWN (Y1) toward any',
    'pending call below it. If calls are pending on both sides while the car is idle,',
    "prefer UP. Stop exactly at a floor that has a pending call for it (X10-X14 are the",
    'floor-arrival sensors, floor 1-5) and clear that floor\'s call lamp. If a further',
    'call is still pending beyond it, continue on in the same direction after',
    'clearing the one just served.',
  ].join('\n'),
  hints: [
    'Latch each call with a SET on its button (X0-X4 -> SET M0-M4) and RESET it once ' +
      'the car reaches that floor.',
    'Build "is a call pending above/below floor N" as a small cascade of OR coils, ' +
      'e.g.',
    'Above(3) = call(4) OR call(5), Above(2) = call(3) OR Above(3), and so on; mirror ' +
      'it downward for Below(N).',
    'SET an Up latch when parked at a floor with a call pending above it; SET a Down ' +
      'latch only when nothing is pending above but something is pending below — that ' +
      'is the up-first tie-break. Drive Y0/Y1 straight from those latches.',
    'Stop by RESETting the latch when the current floor\'s OWN call bit is still on — ' +
      'test it before the rung that clears the call, so a further call beyond this ' +
      'floor cannot suppress the stop here.',
  ],
  devices: [
    { address: 'X0', label: 'Call Floor 1', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Call Floor 2', io: 'input', widget: 'momentary' },
    { address: 'X2', label: 'Call Floor 3', io: 'input', widget: 'momentary' },
    { address: 'X3', label: 'Call Floor 4', io: 'input', widget: 'momentary' },
    { address: 'X4', label: 'Call Floor 5', io: 'input', widget: 'momentary' },
    { address: 'X10', label: 'At Floor 1', io: 'input', widget: 'sensor' },
    { address: 'X11', label: 'At Floor 2', io: 'input', widget: 'sensor' },
    { address: 'X12', label: 'At Floor 3', io: 'input', widget: 'sensor' },
    { address: 'X13', label: 'At Floor 4', io: 'input', widget: 'sensor' },
    { address: 'X14', label: 'At Floor 5', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Motor Up', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Motor Down', io: 'output', widget: 'motor', color: '#f59e0b' },
    { address: 'M0', label: 'Call Lamp 1', io: 'output', widget: 'lamp' },
    { address: 'M1', label: 'Call Lamp 2', io: 'output', widget: 'lamp' },
    { address: 'M2', label: 'Call Lamp 3', io: 'output', widget: 'lamp' },
    { address: 'M3', label: 'Call Lamp 4', io: 'output', widget: 'lamp' },
    { address: 'M4', label: 'Call Lamp 5', io: 'output', widget: 'lamp' },
  ],
  registers: [
    { address: 'M5', label: 'Up latch', note: 'drives Y0; set/cleared per floor' },
    { address: 'M6', label: 'Down latch', note: 'drives Y1; set/cleared per floor' },
    { address: 'M11', label: 'Above(3)', note: 'call pending on floor 4 or 5' },
    { address: 'M12', label: 'Above(2)', note: 'call pending on floor 3, 4 or 5' },
    { address: 'M13', label: 'Above(1)', note: 'call pending on floor 2, 3, 4 or 5' },
    { address: 'M15', label: 'Below(3)', note: 'call pending on floor 1 or 2' },
    { address: 'M16', label: 'Below(4)', note: 'call pending on floor 1, 2 or 3' },
    { address: 'M17', label: 'Below(5)', note: 'call pending on floor 1, 2, 3 or 4' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'coil-set', 'coil-reset'],
  maxRungs: 24,
  processId: 'elevator5',
  scenarios: [
    {
      name: 'Single call above dispatches up and stops there',
      steps: [
        { label: 'Press call for floor 4', setInputs: { X3: true }, holdMs: 150, expect: { M3: true } },
        {
          label: 'Release the button — car climbs and stops at floor 4',
          setInputs: { X3: false },
          holdMs: 3200,
          expect: { X13: true, Y0: false, M3: false },
        },
      ],
    },
    {
      name: 'Single call below dispatches down and stops there',
      steps: [
        {
          label: 'Call floor 5 — car climbs from floor 1',
          setInputs: { X4: true },
          holdMs: 4100,
          expect: { X14: true, Y0: false },
        },
        {
          label: 'Call floor 2 — car descends and stops there',
          setInputs: { X4: false, X1: true },
          holdMs: 3200,
          expect: { X11: true, Y1: false, M1: false },
        },
      ],
    },
    {
      name: 'Two calls in the same direction serviced in one sweep',
      steps: [
        {
          label: 'Press calls for floor 3 and floor 5',
          setInputs: { X2: true, X4: true },
          holdMs: 150,
          expect: { M2: true, M4: true },
        },
        {
          label: 'Release both — car climbs, serving both without a new press',
          setInputs: { X2: false, X4: false },
          holdMs: 4000,
          expect: { X14: true, Y0: false, M2: false, M4: false },
        },
      ],
    },
    {
      name: 'Idle with calls on both sides prefers up',
      steps: [
        {
          label: 'Call floor 3 — car parks there, idle',
          setInputs: { X2: true },
          holdMs: 100,
          expect: { M2: true },
        },
        {
          label: 'Release — car finishes travelling to floor 3',
          setInputs: { X2: false },
          holdMs: 2300,
          expect: { X12: true, Y0: false, M2: false },
        },
        {
          label: 'Call floor 1 and floor 5 together — car commits up first',
          setInputs: { X0: true, X4: true },
          holdMs: 200,
          expect: { Y0: true, Y1: false },
        },
      ],
    },
  ],
};
