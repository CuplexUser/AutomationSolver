import type { PuzzleSpec } from '../types.js';

export const drillSpindle: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-spindle',
  title: 'Drill Station: Spindle & Dwell',
  difficulty: 'hard',
  order: 31,
  category: 'drill',
  summary: 'Start the spindle, wait for full speed, dwell at depth, then stop the rotation again.',
  briefing: [
    'The station has been rebuilt for unattended running. The infeed now drops a',
    'fresh work piece onto the fixture on its own, and the spindle motor (Y5) is',
    'wired separately from the feed (Y1) — so your program is responsible for',
    'starting and stopping the rotation around each part.',
    '',
    'While AUTO CYCLE (X0) is selected and the E-STOP (X1) is healthy, repeat for',
    'every part that arrives:',
    '',
    '  1. Wait for PART PRESENT (X5). An empty fixture must leave the machine idle',
    '     — no clamp, and above all no spindle turning in thin air.',
    '  2. CLAMP the part (Y0) and start the SPINDLE (Y5) turning.',
    '  3. Feed down (Y1) only once CLAMPED (X2) *and* SPINDLE AT SPEED (X7) are',
    '     both on. Feeding into an unclamped part, or with the bit not yet up to',
    '     speed, snaps the bit and jams the machine.',
    '  4. At BOTTOM (X3), hold the feed down for a full 1.0 s (timer T0, preset',
    '     K10) so the hole is finished. Retracting the moment X3 comes on leaves an',
    '     unfinished hole and the part is scrapped.',
    '  5. Once the dwell is done: retract the feed, STOP the spindle, release the',
    '     clamp, light PART DONE (Y3) and run the EJECT pusher (Y4) until EJECTED',
    '     (X4) reports the part clear.',
    '  6. Retract the pusher and wait for the next part. The spindle must be off',
    '     the whole time the machine is waiting.',
    '',
    'The WARNING beacon (Y2) has to be lit whenever the spindle is turning.',
    '',
    'Notes:',
    '',
    '  1. X2, X3, X4, X5 and X7 are all machine-driven field sensors.',
    '  2. The pusher is mechanically interlocked against the clamp: while the part',
    '     is fully clamped the rod physically cannot move, so release first.',
    '  3. The E-STOP is normally-closed. Pressing it must drop the clamp, the feed',
    '     and the spindle at once.',
  ].join('\n'),
  hints: [
    'Two stage relays make the sequence readable: M0 = "drilling this part", ' +
      'M1 = "ejecting it". SET M0 on X0 AND X1 AND X5 AND nc(M1), so a new cycle ' +
      'can only start on a fresh part once the last one has left.',
    'Clamp Y0 and spindle Y5 are plain NO contacts on M0 — that alone is what ' +
      'stops the rotation once the part is drilled, since M0 drops at the end of ' +
      'the drilling stage. Beacon Y2 follows Y5.',
    'Drive the dwell timer straight off the bottom sensor: no(X3) → T0 (K10). It ' +
      'resets itself when the feed leaves the bottom, so no latch is needed.',
    'Feed Y1 = M0 AND X2 AND X7 AND nc(T0): the nc(T0) is what retracts the feed ' +
      'when the dwell completes. Put the timer rung above the feed rung so the ' +
      'feed drops in the same scan.',
    'Hand over on the dwell: no(T0) SETs M1 and RESETs M0 in one rung (two coils ' +
      'on separate rows joined by a vertical link). Y4 and Y3 follow M1; RESET M1 ' +
      'on X4. A separate rung with nc(X1) resetting M0 and M1 is the E-Stop.',
  ],
  devices: [
    { address: 'X0', label: 'Auto Cycle', io: 'input', widget: 'selector' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Ejected', io: 'input', widget: 'sensor' },
    { address: 'X5', label: 'Part Present', io: 'input', widget: 'sensor' },
    { address: 'X7', label: 'Spindle At Speed', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y2', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'Y3', label: 'Part Done', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'Y4', label: 'Eject', io: 'output', widget: 'motor', color: '#fb7185' },
    { address: 'Y5', label: 'Spindle Motor', io: 'output', widget: 'motor', color: '#e879f9' },
  ],
  registers: [
    { address: 'M0', label: 'Drilling stage', note: 'clamped + spindle running on this part' },
    { address: 'M1', label: 'Eject stage', note: 'set when the dwell finishes, reset on X4' },
    { address: 'T0', label: 'Bottom dwell', note: 'preset K10 = 1.0 s at full depth' },
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'contact-rising',
    'coil-out',
    'coil-set',
    'coil-reset',
    'timer',
    'counter',
  ],
  maxRungs: 14,
  processId: 'drill',
  scenarios: [
    {
      name: 'Two parts run back to back',
      steps: [
        {
          label: 'Auto selected, fixture still empty — nothing may move',
          setInputs: { X0: true },
          holdMs: 500,
          expect: { X5: false, Y0: false, Y5: false, Y1: false },
        },
        {
          label: 'A part arrives — clamp closes and the spindle spins up',
          holdMs: 350,
          expect: { X5: true, Y0: true, Y5: true, Y2: true, Y1: false },
        },
        {
          label: 'Clamped and up to speed — only now does the feed go down',
          holdMs: 700,
          expect: { X2: true, X7: true, Y1: true, X3: false },
        },
        {
          label: 'At full depth the feed holds for the dwell',
          holdMs: 1000,
          expect: { X3: true, Y1: true, Y5: true },
        },
        {
          label: 'Dwell done — feed retracts, spindle stops, the part is pushed out',
          holdMs: 900,
          expect: { Y1: false, Y5: false, Y0: false, Y3: true, Y4: true, X4: false },
        },
        {
          label: 'Part clear — one good part shipped and the pusher retracts',
          holdMs: 700,
          expect: { Y4: false, Y3: false },
          expectMachine: { good: 1, bad: 0, jam: false },
        },
        {
          label: 'The next part is drilled the same way, hands off',
          holdMs: 4500,
          expectMachine: { good: 2, bad: 0, jam: false },
        },
      ],
    },
    {
      name: 'Auto off parks the machine with the spindle stopped',
      steps: [
        {
          label: 'One part runs through',
          setInputs: { X0: true },
          holdMs: 4200,
          expectMachine: { good: 1, bad: 0, jam: false },
        },
        {
          label: 'Auto off — the next part waits on the fixture, spindle idle',
          setInputs: { X0: false },
          holdMs: 2000,
          expect: { X5: true, Y0: false, Y5: false, Y1: false, Y4: false },
          expectMachine: { good: 1, bad: 0, jam: false },
        },
        {
          label: 'Auto back on — the waiting part is drilled',
          setInputs: { X0: true },
          holdMs: 3500,
          expectMachine: { good: 2, bad: 0, jam: false },
        },
      ],
    },
    {
      name: 'E-Stop drops the spindle mid-cycle',
      steps: [
        {
          label: 'Run up to the drilling phase',
          setInputs: { X0: true },
          holdMs: 1600,
          expect: { Y1: true, Y5: true },
        },
        {
          label: 'Hit E-Stop — clamp, feed and spindle all drop',
          setInputs: { X1: false },
          holdMs: 200,
          expect: { Y0: false, Y1: false, Y5: false, Y4: false },
        },
        {
          label: 'Released — the part is drilled properly and still counts',
          setInputs: { X1: true },
          holdMs: 3500,
          expectMachine: { good: 1, bad: 0, jam: false },
        },
      ],
    },
  ],
};
