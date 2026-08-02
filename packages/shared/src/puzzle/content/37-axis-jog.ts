import type { AnalogRange, PuzzleSpec } from '../types.js';

/**
 * Shared analog ranges for every axis puzzle.
 *
 * The transmitter reads raw counts, as always. What the counts *mean* lives
 * here so the HMI can label the gauge without the program ever being handed a
 * pre-scaled number: 4000 counts of position is the full two-metre stroke, 4000
 * counts of reference is the drive's full speed, and a ramp parameter is
 * already in its own engineering unit (counts of speed per second), which is
 * exactly why it needs no conversion and reads the same on both sides.
 */
export const POSITION_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 2000,
  units: 'mm',
  decimals: 0,
};

export const SPEED_RANGE: AnalogRange = {
  countMin: -4000,
  countMax: 4000,
  min: -100,
  max: 100,
  units: '%',
  decimals: 0,
};

export const REFERENCE_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '%',
  decimals: 0,
};

export const RAMP_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 4000,
  units: 'cts/s',
  decimals: 0,
};

export const axisJog: PuzzleSpec = {
  kind: 'ladder',
  slug: 'axis-jog',
  title: 'Traverse: Jog the Carriage',
  difficulty: 'easy',
  order: 37,
  category: 'motion',
  summary: 'Commission a drive: load its ramp parameters, then jog a carriage without crashing it.',
  briefing: [
    'A transfer carriage runs on a two metre rail between two work stations. It is',
    'driven by an inverter, and an inverter does not take positions. It takes a speed',
    'reference and a direction, and it changes speed at whatever rate its parameters',
    'say. Everything else in this category follows from that one fact.',
    '',
    'This first job is commissioning. Get the parameters in, prove the carriage jogs',
    'both ways, and prove it reaches both end limits without hitting anything.',
    '',
    '## Equipment',
    '- D0 POSITION: transmitter, raw counts. 0 is the home stop, 4000 the far stop.',
    '- D1 SPEED: what the drive is actually doing right now. It is signed, so reverse',
    '  reads as a negative number.',
    '- D20 SPEED REFERENCE: how fast you are asking for, 0 to 4000. Direction is not in',
    '  here, it comes from the two run coils.',
    '- D40 ACCEL and D41 DECEL: the ramp parameters, in counts of speed per second.',
    '  This drive trips above 2000 on accel and above 2500 on decel.',
    '- X0 JOG FORWARD and X1 JOG REVERSE: momentary push buttons.',
    '- X10 AT HOME and X11 AT END: the overtravel limits.',
    '- Y0 RUN FORWARD and Y1 RUN REVERSE.',
    '',
    '## Sequence of operation',
    '1. Load the drive parameters every scan, so they are in before anything starts:',
    '   a. K1200 into D40 and K1500 into D41.',
    '   b. K1200 into D20, which is a steady jog of about 150 counts a second.',
    '2. Run forward while JOG FORWARD is held and the carriage is not at the end limit.',
    '3. Run reverse while JOG REVERSE is held and the carriage is not at home.',
    '',
    '## Interlocks and safety',
    '- The drive refuses to start at all until both ramp parameters are loaded. That is',
    '  not this simulator being fussy: an inverter with no ramp times in it has not been',
    '  commissioned, and real ones fault exactly the same way.',
    '- Never drive both run coils at once. The drive has no direction to turn in and',
    '  simply ramps to a stop.',
    '- The end stops are steel. Arriving at one still moving is a crash, not a stop.',
    '',
    '## Field notes',
    '- Releasing the button does not stop the carriage, it starts the deceleration',
    '  ramp. Watch how far it still travels afterwards. That distance is the whole',
    '  subject of the next work order.',
    '',
    '## Acceptance',
    '- A short jog moves the carriage forward and it stays where it stopped.',
    '- Held down, it reaches each limit in turn and nothing crashes.',
  ].join('\n'),
  hints: [
    'The parameters go on plain unconditional rungs: a horizontal wire into MOV K1200 ' +
      'D40, another into MOV K1500 D41, another into MOV K1200 D20. They are just ' +
      'numbers the drive reads, so they want to be there before anything else happens.',
    'The jog rungs are ordinary motor rungs: X0 in series with an NC contact on X11 ' +
      'drives Y0, and X1 in series with an NC contact on X10 drives Y1.',
    'If the drive trips the moment you start, check that both D40 and D41 really got ' +
      'written. A drive with a zero ramp parameter has nothing to ramp along.',
  ],
  devices: [
    { address: 'X0', label: 'Jog Forward', io: 'input', widget: 'momentary' },
    { address: 'X1', label: 'Jog Reverse', io: 'input', widget: 'momentary' },
    { address: 'X10', label: 'At Home', io: 'input', widget: 'sensor' },
    { address: 'X11', label: 'At End', io: 'input', widget: 'sensor' },
    {
      address: 'D0',
      label: 'Position',
      io: 'input',
      widget: 'trend',
      signal: 'analog',
      range: POSITION_RANGE,
      color: '#38bdf8',
    },
    {
      address: 'D1',
      label: 'Speed',
      io: 'input',
      widget: 'gauge',
      signal: 'analog',
      range: SPEED_RANGE,
      color: '#fbbf24',
    },
    {
      address: 'D20',
      label: 'Speed Reference',
      io: 'output',
      widget: 'bar',
      signal: 'analog',
      range: REFERENCE_RANGE,
      color: '#34d399',
    },
    {
      address: 'D40',
      label: 'Accel Rate',
      io: 'output',
      widget: 'bar',
      signal: 'analog',
      range: RAMP_RANGE,
      color: '#a78bfa',
    },
    {
      address: 'D41',
      label: 'Decel Rate',
      io: 'output',
      widget: 'bar',
      signal: 'analog',
      range: RAMP_RANGE,
      color: '#a78bfa',
    },
    { address: 'Y0', label: 'Run Forward', io: 'output', widget: 'motor', color: '#34d399' },
    { address: 'Y1', label: 'Run Reverse', io: 'output', widget: 'motor', color: '#f97316' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'compare', 'mov', 'hwire', 'coil-out'],
  maxRungs: 8,
  processId: 'axis',
  scenarios: [
    {
      name: 'A short jog moves the carriage and it stays put',
      steps: [
        {
          label: 'Hold Jog Forward for four seconds',
          setInputs: { X0: true },
          holdMs: 4000,
          expect: { Y0: true, Y1: false },
          expectMachine: { jam: false },
        },
        {
          label: 'Release it; the carriage ramps down and stops short of the far end',
          setInputs: { X0: false },
          holdMs: 3000,
          expect: { Y0: false, Y1: false },
          expectAnalog: { D0: { min: 800, max: 1400 }, D1: { min: 0, max: 0 } },
          expectMachine: { jam: false },
        },
      ],
    },
    {
      name: 'It reaches both limits without hitting anything',
      steps: [
        {
          label: 'Jog forward until the end limit makes',
          setInputs: { X0: true },
          holdMs: 40000,
          until: { bits: { X11: true } },
          expectMachine: { jam: false },
        },
        {
          label: 'Release, and the carriage is parked at the end',
          setInputs: { X0: false },
          holdMs: 2000,
          expect: { X11: true, Y0: false },
          expectMachine: { jam: false },
        },
        {
          label: 'Jog reverse all the way back to the home limit',
          setInputs: { X1: true },
          holdMs: 45000,
          until: { bits: { X10: true } },
          expectMachine: { jam: false },
        },
        {
          label: 'Release, and it is parked at home',
          setInputs: { X1: false },
          holdMs: 2000,
          expect: { X10: true, Y1: false },
          expectMachine: { jam: false },
        },
      ],
    },
  ],
};
