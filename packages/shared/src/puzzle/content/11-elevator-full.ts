import type { PuzzleSpec } from '../types.js';

export const elevatorFull: PuzzleSpec = {
  kind: 'ladder',
  slug: 'elevator-full',
  title: 'Elevator — Fully Functional',
  difficulty: 'hard',
  order: 14,
  category: 'elevator',
  summary: 'The complete 5-story elevator: dispatch, doors, and an automatic return to the lobby when idle.',
  briefing: [
    'The complete 5-floor elevator: per-floor call dispatch, a door that opens on',
    'arrival and auto-closes, and now AUTOMATIC RETURN: if the car sits idle away',
    'from floor 1 with no calls pending anywhere for 10 seconds, it must return to',
    'floor 1 on its own.',
    '',
    'You do not need a bespoke descent path for this: treat an idle timeout exactly',
    'like a call placed at floor 1 and let the dispatch and door logic you already',
    'have handle the rest, including opening the door once it gets there.',
  ].join('\n'),
  hints: [
    'Run an on-delay timer (K100 = 10.0 s) gated by NOT at floor 1 AND no call pending',
    'anywhere (all five call lamps off) AND the Up/Down latches both off (truly idle,',
    'not mid-trip).',
    'When it finishes, SET the floor-1 call latch — the same bit the floor-1 call',
    'button sets. Everything downstream (dispatch, stopping, the door) already knows',
    'what to do with a pending floor-1 call.',
    'A fresh call anywhere, or the car already being at floor 1, should hold the timer',
    'at zero so it never fires needlessly.',
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
    { address: 'X15', label: 'Door Open', io: 'input', widget: 'sensor' },
    { address: 'X16', label: 'Door Closed', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Motor Up', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Motor Down', io: 'output', widget: 'motor', color: '#f59e0b' },
    { address: 'Y2', label: 'Door Open Command', io: 'output', widget: 'motor', color: '#a78bfa' },
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
    { address: 'M20', label: 'Door open latch', note: 'drives Y2; cleared by the dwell timer' },
    { address: 'T1', label: 'Dwell timer', note: 'on-delay, preset K30 = 3.0 s' },
    { address: 'M21', label: 'Any call pending', note: 'OR of the five call lamps' },
    { address: 'T2', label: 'Idle-return timer', note: 'on-delay, preset K100 = 10.0 s' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'contact-rising', 'coil-out', 'coil-set', 'coil-reset', 'timer'],
  maxRungs: 32,
  processId: 'elevator5',
  scenarios: [
    {
      name: 'Dispatch and doors still work',
      steps: [
        { label: 'Press call for floor 3', setInputs: { X2: true }, holdMs: 150, expect: { M2: true } },
        {
          label: 'Release — car climbs and arrives',
          setInputs: { X2: false },
          holdMs: 2200,
          expect: { X12: true },
        },
        { label: 'Door finishes opening', holdMs: 700, expect: { X15: true } },
        { label: 'Door auto-closes', holdMs: 3700, expect: { X16: true, X15: false } },
      ],
    },
    {
      name: 'Idle away from floor 1 auto-returns after 10 s',
      steps: [
        // The idle countdown is gated purely on "away from floor 1, nothing
        // pending, latches off" — it starts the moment the car goes idle after
        // arriving (mid door-cycle), not at some later point in this script, so
        // the whole trigger-plus-return round trip finishes inside one generous
        // hold rather than needing to be caught mid-flight.
        { label: 'Press call for floor 4', setInputs: { X3: true }, holdMs: 150, expect: { M3: true } },
        {
          label: 'Release, and wait out the idle-return-and-arrive round trip',
          setInputs: { X3: false },
          holdMs: 17400,
          expect: { X10: true, X16: false, X15: true },
        },
      ],
    },
    {
      name: 'A manual call before the timeout cancels the pending return',
      steps: [
        { label: 'Press call for floor 2', setInputs: { X1: true }, holdMs: 150, expect: { M1: true } },
        {
          label: 'Release — car climbs and arrives',
          setInputs: { X1: false },
          holdMs: 1300,
          expect: { X11: true },
        },
        {
          label: 'Idle for a while — comfortably under the 10 s timeout',
          holdMs: 6000,
          expect: { M0: false },
        },
        {
          label: 'A fresh call resets the idle window — no return fires',
          setInputs: { X4: true },
          holdMs: 800,
          expect: { M0: false, Y0: true },
        },
      ],
    },
  ],
};
