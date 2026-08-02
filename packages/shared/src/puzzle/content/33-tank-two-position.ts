import type { PuzzleSpec } from '../types.js';
import { FLOW_RANGE, LEVEL_RANGE, VALVE_RANGE } from './32-tank-level-readout.js';

export const tankTwoPosition: PuzzleSpec = {
  kind: 'ladder',
  slug: 'tank-two-position',
  title: 'Vessel: Two-Position Control',
  difficulty: 'easy',
  order: 33,
  category: 'process-control',
  summary: 'Hold a level automatically with a valve that is only ever shut or wide open.',
  briefing: [
    'The vessel now feeds a discharge pump, and the operator wants the level kept',
    'between marks without anyone standing at the panel. The supply valve can still',
    'only be commanded shut or wide open, so this is control by switching: fill until',
    'the level is high enough, stop until it is low enough, repeat.',
    '',
    '## Equipment',
    '- D0 LEVEL: transmitter, raw counts, 4000 is full.',
    '- D20 VALVE: command, raw counts. This puzzle only ever writes 0 or 4000 to it.',
    '- X0 AUTO: maintained selector. With it off, the valve is shut and the pump is idle.',
    '- Y0 DISCHARGE PUMP: the load. It runs whenever AUTO is on and there is something',
    '  to pump.',
    '- D1 DISCHARGE FLOW: what the pump is actually shifting, for the trend.',
    '- M0: fill latch (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. With AUTO off, hold the valve shut and the pump stopped.',
    '2. With AUTO on, run the discharge pump.',
    '3. Start filling when the level falls to 40 % (1600 counts) or below.',
    '4. Stop filling when it reaches 60 % (2400 counts) or above.',
    '5. Between those two marks, keep doing whatever you were already doing. That gap is',
    '   the whole point: without it the valve would chatter on and off every scan.',
    '',
    '## Interlocks and safety',
    '- Never let the vessel overflow. It is a fault, not a nuisance, and it ends the run.',
    '- Never run the discharge pump dry. Below 1 % it takes damage.',
    '',
    '## Field notes',
    '- A latch built from two compare contacts is the same seal-in circuit you have',
    '  written before. The low mark sets it, the high mark resets it.',
    '- Watch the valve on the trend. It slams fully open and fully shut, over and over.',
    '  A real valve has a limited number of those in it, which is the argument for the',
    '  next puzzle.',
    '',
    '## Acceptance',
    '- The level cycles inside the marks and never leaves the 35 % to 65 % window once',
    '  the loop has settled.',
    '- No overflow and no dry running, in either scenario.',
  ].join('\n'),
  hints: [
    'The latch is one rung: (D0 <= K1600) in parallel with M0, in series with a ' +
      'compare that has not yet reached the top mark, driving M0. Simplest form is ' +
      '(D0 <= K1600 OR M0) AND (D0 < K2400) into M0.',
    'The valve is then two rungs off that latch: M0 (NO) into MOV K4000 D20, and ' +
      'M0 (NC) into MOV K0 D20. Gate both on the AUTO selector so a stopped ' +
      'vessel never fills.',
    'The pump is a plain coil on X0. Do not try to be clever and stop it at the ' +
      'low mark: the fill latch is what keeps the vessel off the dry trip.',
  ],
  devices: [
    { address: 'X0', label: 'Auto', io: 'input', widget: 'toggle' },
    {
      address: 'D0',
      label: 'Level',
      io: 'input',
      widget: 'trend',
      signal: 'analog',
      range: LEVEL_RANGE,
      color: '#38bdf8',
    },
    {
      address: 'D1',
      label: 'Discharge Flow',
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: FLOW_RANGE,
      color: '#c084fc',
    },
    {
      address: 'D20',
      label: 'Supply Valve',
      io: 'output',
      widget: 'bar',
      signal: 'analog',
      range: VALVE_RANGE,
      color: '#34d399',
    },
    { address: 'Y0', label: 'Discharge Pump', io: 'output', widget: 'motor', color: '#a78bfa' },
  ],
  registers: [
    { address: 'M0', label: 'Fill latch', note: 'set at the low mark, reset at the high mark' },
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'compare',
    'mov',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 8,
  processId: 'tank',
  scenarios: [
    {
      name: 'Cycling between the marks',
      steps: [
        {
          label: 'Switch to Auto: the pump runs and the valve opens to catch the falling level',
          setInputs: { X0: true },
          holdMs: 12000,
          until: { analog: { D20: { min: 4000 } } },
          expect: { Y0: true },
          expectMachine: { jam: false },
        },
        {
          label: 'The level climbs to the top mark and the valve shuts again',
          holdMs: 20000,
          until: { analog: { D20: { max: 0 } } },
          expectAnalog: { D0: { min: 2350 } },
          expectMachine: { jam: false },
        },
        {
          label: 'Left alone, it keeps cycling inside the marks',
          holdMs: 40000,
          control: { device: 'D0', setpoint: 2000, band: 600, settleMs: 20000 },
          expectMachine: { jam: false, dryRun: false, overflow: false },
        },
      ],
      // No par: there is nothing to tune here. Narrowing the gap would lower the
      // error integral while wearing the valve out faster, and rewarding that is
      // the opposite of what this puzzle is for.
    },
    {
      name: 'Auto off leaves the vessel alone',
      steps: [
        {
          label: 'Run in Auto for a while so the level is up between the marks',
          setInputs: { X0: true },
          holdMs: 30000,
          until: { analog: { D0: { min: 2350 } } },
          expectMachine: { jam: false },
        },
        {
          label: 'Switch out of Auto: valve shut, pump stopped',
          setInputs: { X0: false },
          holdMs: 1000,
          expect: { Y0: false },
          expectAnalog: { D20: { max: 0 } },
        },
        {
          label: 'Nothing refills it while the selector is off',
          holdMs: 8000,
          expectAnalog: { D20: { max: 0 } },
          expect: { Y0: false },
          expectMachine: { jam: false },
        },
      ],
    },
  ],
};
