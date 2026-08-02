import type { PuzzleSpec } from '../types.js';
import { FLOW_RANGE, LEVEL_RANGE, VALVE_RANGE } from './32-tank-level-readout.js';

export const tankPControl: PuzzleSpec = {
  kind: 'ladder',
  slug: 'tank-p-control',
  title: 'Vessel: Proportional Control',
  difficulty: 'medium',
  order: 34,
  category: 'process-control',
  summary: 'Build a P regulator out of registers and arithmetic, and meet the offset it leaves.',
  briefing: [
    'The valve is a modulating one now: it takes any command between shut and wide',
    'open, and it will sit wherever you put it. That means the valve no longer has to',
    'slam, and the level no longer has to saw between two marks. It also means you have',
    'to decide how far open it should be, every scan, from how far off setpoint you',
    'are. That decision is a regulator, and this one you build yourself out of the',
    'blocks you already have.',
    '',
    '## Equipment',
    '- D0 LEVEL: transmitter, raw counts, 4000 is full.',
    '- D20 VALVE: modulating command, 0 to 4000 raw counts.',
    '- D30 SETPOINT: where the level should be. The operator picks it, and the two',
    '  scenarios use 60 % (2400 counts).',
    '- X0 AUTO: maintained selector. Off means shut valve, stopped pump.',
    '- X3 DISCHARGE DEMAND: downstream is calling for product. It comes and goes on its',
    '  own, and it is the disturbance this puzzle is really about.',
    '- Y0 DISCHARGE PUMP, D1 DISCHARGE FLOW: the load, and what it is shifting.',
    '- D31 ERROR and D32 P TERM: your working registers (see Working Registers).',
    '',
    '## Sequence of operation',
    '1. With AUTO off, hold the valve shut and the pump stopped.',
    '2. With AUTO on, run the discharge pump whenever demand asks for it.',
    '3. Each scan, work out the error: setpoint minus measurement, into D31.',
    '4. Multiply that error by a gain, add a bias, and move the result to the valve.',
    '   A gain of 4 and a bias equal to the setpoint is a sound starting point.',
    '5. Hold 60 % whether the pump is running or not.',
    '',
    '## Field notes',
    '- Keep the gain a whole number. Error can reach 4000 counts, and a 16 bit register',
    '  stops at 32767, so a gain above 8 will peg the arithmetic before the valve ever',
    '  sees it. The next puzzle has a block that carries fractional gains properly.',
    '- Proportional action alone cannot sit exactly on setpoint. A valve that is 40 %',
    '  open is only 40 % open because there is still an error telling it to be. Raising',
    '  the gain shrinks the offset without ever closing it.',
    '- The bias is how a technician deals with that by hand: it is the valve position',
    '  the vessel needs at the design load, so the error only has to trim around it.',
    '  Watch what happens to it when the load changes.',
    '',
    '## Acceptance',
    '- The level settles within 3 % of setpoint at the design load.',
    '- It recovers to within 10 % when the discharge pump loads the vessel, and stays',
    '  there. Tighter than that scores better.',
  ].join('\n'),
  hints: [
    'Error first, on its own rung: SUB with D30 and D0, destination D31. It runs ' +
      'unconditionally, so a plain wire feeds it.',
    'Then the proportional term: MUL D31 by K4 into D32, then ADD D32 and D30 into ' +
      'D20. Gating both on the AUTO selector keeps a stopped vessel from filling.',
    'With AUTO off you still need the valve shut, so give D20 a second writer: X0 ' +
      '(NC) into MOV K0 D20. MOV only writes when its rung conducts, so the two ' +
      'never fight.',
    'If the loop overshoots badly on the way up, that is the gain and the bias ' +
      'both pushing at once while the level is far away. It is honest behaviour ' +
      'for a P controller, and the scenarios allow for it.',
  ],
  devices: [
    { address: 'X0', label: 'Auto', io: 'input', widget: 'toggle' },
    { address: 'X3', label: 'Discharge Demand', io: 'input', widget: 'toggle' },
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
    { address: 'D30', label: 'Setpoint', note: 'raw counts; the scenarios run at K2400' },
    { address: 'D31', label: 'Error', note: 'setpoint minus measurement' },
    { address: 'D32', label: 'Proportional term', note: 'error x gain, before the bias' },
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'compare',
    'mov',
    'math',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 10,
  processId: 'tank',
  scenarios: [
    {
      name: 'Holds setpoint with no load',
      steps: [
        {
          label: 'Switch to Auto with the setpoint at 60 % and nothing drawing off',
          setInputs: { X0: true, X3: false },
          holdMs: 1000,
          expect: { Y0: false },
        },
        {
          label: 'The loop brings the level up and parks it on setpoint',
          holdMs: 20000,
          control: {
            device: 'D0',
            setpoint: 2400,
            band: 120,
            settleMs: 8000,
            maxOvershoot: 900,
          },
          expectMachine: { jam: false },
        },
      ],
      // Calibrated against the reference gain of 4: a sound loop reaches this,
      // a lazy one tapers off it. Same discipline as the packaging cycle times.
      parIae: 700,
    },
    {
      name: 'The offset moves when the load does',
      steps: [
        {
          label: 'Settle on setpoint with nothing drawing off',
          setInputs: { X0: true, X3: false },
          holdMs: 30000,
          until: { analog: { D0: { min: 2300, max: 2500 } } },
          thenHoldMs: 4000,
          expectMachine: { jam: false },
        },
        {
          // A P controller cannot hold this exactly, and it is not asked to: the
          // band is wide enough for the offset a sound gain leaves, and the error
          // integral is what separates a well tuned loop from a lazy one.
          label: 'Demand starts and pulls the vessel down; the loop has to pull it back',
          setInputs: { X3: true },
          holdMs: 20000,
          expect: { Y0: true },
          control: {
            device: 'D0',
            setpoint: 2400,
            band: 400,
            settleMs: 10000,
          },
          expectMachine: { jam: false, overflow: false },
        },
        {
          label: 'Demand stops again and the level comes back up',
          setInputs: { X3: false },
          holdMs: 20000,
          expect: { Y0: false },
          control: {
            device: 'D0',
            setpoint: 2400,
            band: 200,
            settleMs: 10000,
          },
          expectMachine: { jam: false, overflow: false },
        },
      ],
      // Most of this is the offset a P controller simply has, so raising the
      // gain is the only way to bring it down. That is the intended lesson.
      parIae: 4200,
    },
  ],
};
