import type { PuzzleSpec } from '../types.js';

export const runOnTimer: PuzzleSpec = {
  kind: 'ladder',
  slug: 'run-on-timer',
  title: 'Extractor Run-On',
  difficulty: 'medium',
  order: 6,
  category: 'timers-counters',
  summary: 'Keep an extractor fan running for 3 seconds after the motor stops (off-delay).',
  briefing: [
    'A grinding motor throws dust, so its EXTRACTOR fan must keep clearing the air',
    'for a while after the motor shuts off.',
    '',
    'START (X0) runs the MOTOR (Y0) and seals it in; STOP (X1) drops it. The',
    'EXTRACTOR (Y1) runs whenever the motor runs AND for 3 seconds after it stops,',
    'then switches off on its own. Before the motor has ever run, the extractor',
    'must stay off — no fan running at power-up.',
    '',
    'The engine only has on-delay timers, so build the off-delay yourself: seal the',
    'fan in and let a timer break the seal 3 s after the motor drops. Presets are in',
    'units of 100 ms (K30 = 3.0 s).',
  ].join('\n'),
  hints: [
    'Rung 1: the usual seal-in motor — (X0 OR Y0) in series with normally-closed X1 → Y0.',
    'Rung 2: seal the fan Y1 from (Y0 OR (Y1 AND normally-closed T0)). It follows the',
    'motor directly, and once the motor drops it holds itself until the timer finishes.',
    'Rung 3: run the timer only while the fan is on but the motor is off — Y1 AND',
    'normally-closed Y0 → T0 (K30). That way it never counts (and never trips the fan)',
    'until an actual stop, and it resets as soon as the fan drops.',
  ],
  devices: [
    { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary' },
    { address: 'Y0', label: 'Motor', io: 'output', widget: 'motor', color: '#38bdf8' },
    { address: 'Y1', label: 'Extractor Fan', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  registers: [{ address: 'T0', label: 'Run-on delay', note: 'on-delay, preset K30 = 3.0 s' }],
  allowedInstructions: ['contact-no', 'contact-nc', 'coil-out', 'timer'],
  maxRungs: 4,
  processId: 'passthrough',
  scenarios: [
    {
      name: 'Fan runs on for 3 s after the motor stops',
      steps: [
        {
          label: 'Press Start — motor and fan run',
          setInputs: { X0: true },
          holdMs: 200,
          expect: { Y0: true, Y1: true },
        },
        {
          label: 'Release Start — motor seals in',
          setInputs: { X0: false },
          holdMs: 200,
          expect: { Y0: true, Y1: true },
        },
        {
          label: 'Press Stop — motor drops, fan keeps running',
          setInputs: { X1: true },
          holdMs: 100,
          expect: { Y0: false, Y1: true },
        },
        {
          label: 'Release Stop — fan still clearing (under 3 s)',
          setInputs: { X1: false },
          holdMs: 2400,
          expect: { Y0: false, Y1: true },
        },
        {
          label: 'Past 3 s — fan switches off',
          holdMs: 900,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
    {
      name: 'No fan before the first start',
      steps: [
        {
          label: 'Idle from power-up — nothing runs',
          holdMs: 3500,
          expect: { Y0: false, Y1: false },
        },
      ],
    },
    {
      name: 'Restarting cancels the run-on',
      steps: [
        { label: 'Start', setInputs: { X0: true }, holdMs: 150, expect: { Y0: true, Y1: true } },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 100, expect: { Y0: true } },
        { label: 'Stop', setInputs: { X1: true }, holdMs: 100, expect: { Y0: false, Y1: true } },
        { label: 'Release Stop — mid run-on', setInputs: { X1: false }, holdMs: 1500, expect: { Y1: true } },
        {
          label: 'Restart before the fan times out',
          setInputs: { X0: true },
          holdMs: 200,
          expect: { Y0: true, Y1: true },
        },
        { label: 'Release Start', setInputs: { X0: false }, holdMs: 200, expect: { Y0: true, Y1: true } },
      ],
    },
  ],
};
