import type { PuzzleSpec } from '../types.js';

export const drillProduction: PuzzleSpec = {
  kind: 'ladder',
  slug: 'drill-production',
  title: 'Drill Station: Production Run',
  difficulty: 'hard',
  order: 32,
  category: 'drill',
  summary: 'Sort mixed stock: drill the aluminium, reject the steel, and count a batch of three.',
  briefing: [
    'Final acceptance test. The infeed now delivers MIXED stock — aluminium blanks',
    'that get drilled, and hardened steel blanks that cannot be. An inductive',
    'sensor reads the part on the fixture: METAL PART (X6) is on for steel, off for',
    'aluminium. Two new actuators are wired: the REJECT GATE (Y6), a diverter that',
    'routes an ejected part into the scrap bin instead of onto the outfeed belt,',
    'and the BATCH DONE lamp (Y7).',
    '',
    'While AUTO CYCLE (X0) is selected and the E-STOP (X1) is healthy:',
    '',
    '  1. Aluminium (X5 on, X6 off): run the full cycle from the last work order —',
    '     clamp, spindle up to speed, feed down, 1.0 s dwell at the bottom (T0,',
    '     K10), stop the spindle, release, then eject with the gate CLOSED so the',
    '     finished part reaches the belt. Light PART DONE (Y3) while it leaves.',
    '  2. Steel (X5 on, X6 on): do not clamp it and do not start the spindle —',
    '     feeding into hardened stock snaps the bit and jams the machine. Open the',
    '     REJECT GATE (Y6) and eject the blank straight into the scrap bin, then',
    '     close the gate again.',
    '  3. Count finished holes on counter C0, preset K3. Rejected steel blanks are',
    '     not production — they must not count.',
    '  4. When C0 completes, light BATCH DONE (Y7) and close the order down: park',
    '     the station and start no further cycle, even though the infeed keeps',
    '     delivering stock. Leave Y7 on.',
    '',
    'All earlier rules still apply: the feed needs CLAMPED (X2) *and* SPINDLE AT',
    'SPEED (X7), the pusher is interlocked against the clamp, the beacon (Y2) is',
    'lit whenever the spindle turns, and the E-STOP drops every actuator.',
    '',
    'Sending an undrilled blank down the belt, or a good aluminium part into the',
    'scrap bin, is a routing fault — the batch is only accepted with zero of them.',
  ].join('\n'),
  hints: [
    'Keep the previous program intact and add a third stage relay M2 = "rejecting ' +
      'this blank". SET M2 on X0 AND X1 AND X5 AND X6 (steel on the fixture) AND ' +
      'nc(C0); it replaces the drill stage for steel, so add nc(X6) to the SET M0 ' +
      'rung so metal can never start a drilling cycle.',
    'Y6 is a plain NO contact on M2. The eject coil is now driven by two branches ' +
      '— M0-side eject (M1) OR reject (M2) — and an OUT coil does not OR across ' +
      'independent rows: use one coil with a vertical link merging the two rows.',
    'Reset both M1 and M2 on X4 (two coils in one rung, joined by a vertical ' +
      'link): a completed stroke ends either kind of eject.',
    'Count on the dwell, not on the eject: no(T0) → C0 (K3) counts exactly one ' +
      'finished hole per part, so rejects can never sneak into the batch.',
    'Close the order the way the pick & place production run does: nc(C0) in ' +
      'series in *both* the SET M0 and SET M2 rungs, and no(C0) → out(Y7). Never ' +
      'reset C0 — holding its done state is what parks the station.',
  ],
  devices: [
    { address: 'X0', label: 'Auto Cycle', io: 'input', widget: 'selector' },
    { address: 'X1', label: 'E-Stop', io: 'input', widget: 'estop', normallyClosed: true },
    { address: 'X2', label: 'Clamped', io: 'input', widget: 'sensor' },
    { address: 'X3', label: 'Drill At Bottom', io: 'input', widget: 'sensor' },
    { address: 'X4', label: 'Ejected', io: 'input', widget: 'sensor' },
    { address: 'X5', label: 'Part Present', io: 'input', widget: 'sensor' },
    { address: 'X6', label: 'Metal Part', io: 'input', widget: 'sensor' },
    { address: 'X7', label: 'Spindle At Speed', io: 'input', widget: 'sensor' },
    { address: 'Y0', label: 'Clamp', io: 'output', widget: 'lamp', color: '#38bdf8' },
    { address: 'Y1', label: 'Drill Feed', io: 'output', widget: 'motor', color: '#a78bfa' },
    { address: 'Y2', label: 'Warning Beacon', io: 'output', widget: 'lamp', color: '#f59e0b' },
    { address: 'Y3', label: 'Part Done', io: 'output', widget: 'lamp', color: '#22c55e' },
    { address: 'Y4', label: 'Eject', io: 'output', widget: 'motor', color: '#fb7185' },
    { address: 'Y5', label: 'Spindle Motor', io: 'output', widget: 'motor', color: '#e879f9' },
    { address: 'Y6', label: 'Reject Gate', io: 'output', widget: 'motor', color: '#f97316' },
    { address: 'Y7', label: 'Batch Done', io: 'output', widget: 'lamp', color: '#facc15' },
  ],
  registers: [
    { address: 'M0', label: 'Drilling stage', note: 'aluminium only — clamped, spindle running' },
    { address: 'M1', label: 'Eject stage', note: 'good part to the belt, gate closed' },
    { address: 'M2', label: 'Reject stage', note: 'steel blank to the scrap bin, gate open' },
    { address: 'T0', label: 'Bottom dwell', note: 'preset K10 = 1.0 s at full depth' },
    { address: 'C0', label: 'Batch counter', note: 'preset K3, counts finished holes, never reset' },
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
  maxRungs: 18,
  processId: 'drill',
  scenarios: [
    {
      name: 'Mixed stock: three holes, one reject',
      steps: [
        {
          label: 'Auto on — the first aluminium blank is drilled and shipped',
          setInputs: { X0: true },
          holdMs: 4200,
          expect: { Y7: false },
          expectMachine: { good: 1, scrap: 0, bad: 0, jam: false },
        },
        {
          label: 'A steel blank arrives — no clamp, no spindle, gate opens',
          holdMs: 700,
          expect: { X5: true, X6: true, Y0: false, Y5: false, Y1: false, Y6: true, Y4: true },
        },
        {
          label: 'Steel goes down the reject chute, not onto the belt',
          holdMs: 900,
          expect: { Y6: false, Y4: false, Y7: false },
          expectMachine: { good: 1, scrap: 1, bad: 0, jam: false },
        },
        {
          label: 'Two more aluminium parts complete the batch of three',
          holdMs: 8500,
          expect: { Y7: true, Y4: false },
          expectMachine: { good: 3, scrap: 1, bad: 0, jam: false },
        },
        {
          label: 'Batch done — the station parks although more stock keeps arriving',
          holdMs: 2500,
          expect: { X5: true, Y7: true, Y0: false, Y1: false, Y4: false, Y5: false, Y6: false },
          expectMachine: { good: 3, scrap: 1, bad: 0, jam: false },
        },
      ],
    },
    {
      name: 'E-Stop drops every actuator mid-cycle',
      steps: [
        {
          label: 'Run up to the drilling phase',
          setInputs: { X0: true },
          holdMs: 1600,
          expect: { Y1: true, Y5: true, Y0: true },
        },
        {
          label: 'Hit E-Stop — clamp, feed, spindle and gate all drop',
          setInputs: { X1: false },
          holdMs: 200,
          expect: { Y0: false, Y1: false, Y5: false, Y4: false, Y6: false },
        },
        {
          label: 'Released — the blank is drilled properly and counts once',
          setInputs: { X1: true },
          holdMs: 3500,
          expect: { Y7: false },
          expectMachine: { good: 1, scrap: 0, bad: 0, jam: false },
        },
      ],
    },
  ],
};
