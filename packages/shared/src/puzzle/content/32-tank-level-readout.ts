import type { PuzzleSpec } from '../types.js';

/** Shared by every vessel puzzle: 0..4000 raw counts is 0..100 % of span. */
export const LEVEL_RANGE = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '%',
  decimals: 1,
} as const;

export const VALVE_RANGE = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '% open',
  decimals: 1,
} as const;

export const FLOW_RANGE = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '% flow',
  decimals: 1,
} as const;

export const tankLevelReadout: PuzzleSpec = {
  kind: 'ladder',
  slug: 'tank-level-readout',
  title: 'Vessel: Reading the Level',
  difficulty: 'tutorial',
  order: 32,
  category: 'process-control',
  summary: 'First analog signal: scale a raw transmitter into percent and drive the alarms off it.',
  briefing: [
    'A buffer vessel with a level transmitter, a supply valve and two alarm lamps. This',
    'is the first puzzle where a signal is a number rather than a bit, so before any',
    'control loop there is a more basic job: turn what the card gives you into',
    'something you can reason about.',
    '',
    '## Equipment',
    '- D0 LEVEL: the transmitter, as raw counts from the analog input card. 0 counts is',
    '  an empty vessel and 4000 counts is a full one. It is not a percentage, and no',
    '  part of the machine will make it one for you.',
    '- D20 VALVE: the supply valve command, raw counts to the analog output card. 0 is',
    '  shut and 4000 is wide open. Anything in between is a real, partly open valve.',
    '- X0 FILL: maintained selector. The operator holds the valve open with it.',
    '- Y1 HIGH LEVEL and Y2 LOW LEVEL: alarm lamps.',
    '- D10: your scaled level, in tenths of a percent (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. Scale the transmitter. Divide D0 by 4 into D10, so a full vessel reads 1000 and',
    '   the number means tenths of a percent.',
    '2. Drive the valve from the selector. With FILL on, move 4000 into D20. With it off,',
    '   move 0 into D20.',
    '3. Light HIGH LEVEL (Y1) whenever the vessel is at or above 80.0 %.',
    '4. Light LOW LEVEL (Y2) whenever it is at or below 20.0 %.',
    '',
    '## Field notes',
    '- A compare contact is a contact like any other. It conducts when the comparison',
    '  holds, and it goes in series and in parallel with the contacts you already know.',
    '- Registers are 16 bit, so they stop at 32767. Multiplying a 4000 count reading by',
    '  1000 does not give you 4000000, it gives you 32767. Divide before you multiply.',
    '- MOV only writes while its rung conducts. That is what lets two rungs move',
    '  different values into the same register without fighting each other.',
    '',
    '## Acceptance',
    '- D10 tracks the vessel: about 250 when it is a quarter full, about 1000 when full.',
    '- Both alarms are correct on the way up and on the way down.',
  ].join('\n'),
  hints: [
    'Rung 1 is the scaling: a plain wire into a DIV block, D0 divided by K4, ' +
      'destination D10. It runs every scan, unconditionally.',
    'The valve takes two rungs, or one rung with two rows: X0 (NO) into MOV K4000 ' +
      'D20, and X0 (NC) into MOV K0 D20. Whichever rung conducts is the one that ' +
      'writes.',
    'The alarms are compare contacts straight onto coils: D10 >= K800 into Y1, and ' +
      'D10 <= K200 into Y2. You could compare the raw D0 against K3200 and K800 ' +
      'instead, but the scaled value is the one a person can read off a screen.',
  ],
  devices: [
    { address: 'X0', label: 'Fill', io: 'input', widget: 'toggle' },
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
      address: 'D20',
      label: 'Supply Valve',
      io: 'output',
      widget: 'bar',
      signal: 'analog',
      range: VALVE_RANGE,
      color: '#34d399',
    },
    { address: 'Y1', label: 'High Level', io: 'output', widget: 'lamp', color: '#f87171' },
    { address: 'Y2', label: 'Low Level', io: 'output', widget: 'lamp', color: '#fbbf24' },
  ],
  registers: [{ address: 'D10', label: 'Scaled level', note: 'tenths of a percent, 1000 = full' }],
  allowedInstructions: ['contact-no', 'contact-nc', 'compare', 'mov', 'math', 'coil-out'],
  maxRungs: 8,
  processId: 'tank',
  scenarios: [
    {
      name: 'Scaling and the low alarm',
      steps: [
        {
          // Starts a quarter full and already draining, so this is a band round
          // "about 24 %", not a fixed number.
          label: 'At rest the vessel sits about a quarter full and the scaled value agrees',
          holdMs: 200,
          expectAnalog: { D10: { min: 225, max: 255 }, D20: { max: 0 } },
          expect: { Y1: false, Y2: false },
        },
        {
          label: 'Leave the valve shut: the vessel drains and the low alarm comes in',
          holdMs: 16000,
          until: { bits: { Y2: true } },
          expectAnalog: { D10: { max: 200 } },
          expect: { Y2: true, Y1: false },
        },
      ],
    },
    {
      name: 'Filling and the high alarm',
      steps: [
        {
          label: 'Open the valve: the level climbs and the low alarm stays out',
          setInputs: { X0: true },
          holdMs: 2000,
          expectAnalog: { D20: { min: 4000 } },
          expect: { Y2: false },
        },
        {
          label: 'The vessel passes 80 % and the high alarm comes in',
          holdMs: 20000,
          until: { bits: { Y1: true } },
          expectAnalog: { D10: { min: 800 } },
          expect: { Y1: true, Y2: false },
        },
        {
          label: 'Shut the valve: the alarm clears again on the way down',
          setInputs: { X0: false },
          holdMs: 20000,
          until: { bits: { Y1: false } },
          expectAnalog: { D20: { max: 0 }, D10: { max: 800 } },
          expect: { Y1: false },
        },
      ],
    },
  ],
};
