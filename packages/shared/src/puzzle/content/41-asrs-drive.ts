import type { LadderElement, LadderProgram, Rung } from '../../ladder/types.js';
import type { AnalogRange, PuzzleDevice, PuzzleRegister, PuzzleSpec } from '../types.js';

/**
 * Shared analog ranges and device blocks for every warehouse puzzle.
 *
 * The crane's registers are all small whole numbers - a bay, a level, a material
 * code - rather than transmitter counts, because this machine's analog signals
 * are inventory data rather than field measurements. They still go through
 * `AnalogRange` so the HMI can label them, but count and value are the same
 * number and there is nothing to scale.
 */
export const BAY_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 5,
  min: 0,
  max: 5,
  units: 'bay',
  decimals: 0,
};

export const LEVEL_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 2,
  min: 0,
  max: 2,
  units: 'level',
  decimals: 0,
};

export const CODE_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4,
  min: 0,
  max: 4,
  units: 'code',
  decimals: 0,
};

/**
 * The aisle, the mast and the fork: the axes and their instrumentation. Six
 * position sensors along the rail, two level sensors on the mast, both ends of
 * the fork stroke, the readouts and the five coils that drive them.
 *
 * Split out from `CRANE_DEVICES` below so the commissioning puzzle can wire the
 * machine without the inventory half of it. A player meeting the crane for the
 * first time has an aisle, a mast and a fork to learn; the slot photo-eye and
 * the material code on the forks mean nothing until there is a WMS table to
 * check them against, and listing them early is a terminal assignment nobody
 * can use yet.
 */
const AISLE_SENSORS: PuzzleDevice[] = [
  { address: 'X20', label: 'At Position 0', io: 'input', widget: 'sensor' },
  { address: 'X21', label: 'At Bay 1', io: 'input', widget: 'sensor' },
  { address: 'X22', label: 'At Bay 2', io: 'input', widget: 'sensor' },
  { address: 'X23', label: 'At Bay 3', io: 'input', widget: 'sensor' },
  { address: 'X24', label: 'At Bay 4', io: 'input', widget: 'sensor' },
  { address: 'X25', label: 'At Position 5', io: 'input', widget: 'sensor' },
  { address: 'X26', label: 'At Level 1', io: 'input', widget: 'sensor' },
  { address: 'X27', label: 'At Level 2', io: 'input', widget: 'sensor' },
  { address: 'X28', label: 'Fork Home', io: 'input', widget: 'sensor' },
  { address: 'X29', label: 'Fork Out', io: 'input', widget: 'sensor' },
  { address: 'X3', label: 'Load On Forks', io: 'input', widget: 'sensor' },
];

const AISLE_READOUTS: PuzzleDevice[] = [
  {
    address: 'D0',
    label: 'Position',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: BAY_RANGE,
    color: '#38bdf8',
  },
  {
    address: 'D1',
    label: 'Level',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: LEVEL_RANGE,
    color: '#38bdf8',
  },
];

const CRANE_COILS: PuzzleDevice[] = [
  { address: 'Y0', label: 'Travel Forward', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y1', label: 'Travel Reverse', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y2', label: 'Lift Up', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y3', label: 'Lift Down', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y4', label: 'Fork Out', io: 'output', widget: 'motor', color: '#e879f9' },
];

/** The crane on its own: axes, end sensors, readouts and coils. */
export const CRANE_AXIS_DEVICES: PuzzleDevice[] = [
  ...AISLE_SENSORS,
  ...AISLE_READOUTS,
  ...CRANE_COILS,
];

/** The same crane once there is stock to reason about, for every puzzle after the first. */
export const CRANE_DEVICES: PuzzleDevice[] = [
  ...AISLE_SENSORS,
  { address: 'X13', label: 'Slot Occupied', io: 'input', widget: 'sensor' },
  ...AISLE_READOUTS,
  {
    address: 'D13',
    label: 'Code On Forks',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: CODE_RANGE,
    color: '#e879f9',
  },
  ...CRANE_COILS,
];

/**
 * The WMS slot table, as an IO list.
 *
 * Eight registers, one per slot, holding the material code stored there or 0 for
 * empty. They are written by the warehouse management system, not by the
 * program, and they change as stock is drawn down and put away - which is the
 * reason they are read every cycle rather than copied once.
 */
export const WMS_REGISTERS: PuzzleRegister[] = [
  { address: 'D101', label: 'Bay 1 level 1', note: 'material code stored there, 0 = empty' },
  { address: 'D102', label: 'Bay 2 level 1', note: 'material code stored there, 0 = empty' },
  { address: 'D103', label: 'Bay 3 level 1', note: 'material code stored there, 0 = empty' },
  { address: 'D104', label: 'Bay 4 level 1', note: 'material code stored there, 0 = empty' },
  { address: 'D201', label: 'Bay 1 level 2', note: 'material code stored there, 0 = empty' },
  { address: 'D202', label: 'Bay 2 level 2', note: 'material code stored there, 0 = empty' },
  { address: 'D203', label: 'Bay 3 level 2', note: 'material code stored there, 0 = empty' },
  { address: 'D204', label: 'Bay 4 level 2', note: 'material code stored there, 0 = empty' },
];

/** The move block's target registers, shared by every puzzle in the category. */
export const TARGET_REGISTERS: PuzzleRegister[] = [
  { address: 'D52', label: 'Target position', note: 'where the crane is driving to, 0 to 5' },
  { address: 'D53', label: 'Target level', note: 'K=1 pick face, K=2 reserve' },
];

// --- the worked run the player can watch ------------------------------------
// Small local builders, so the demo below reads as ladder rather than as a wall
// of grid literals. Deliberately not shared with the test suite's copies: this
// is content, and content should not be able to break by a test refactor.
const no = (device: string): LadderElement => ({ type: 'contact-no', device });
const nc = (device: string): LadderElement => ({ type: 'contact-nc', device });
const out = (device: string): LadderElement => ({ type: 'coil-out', device });
const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});
const cmp = (op: '=' | '<' | '>', a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op,
  operands: [a, b],
});

function rung(id: string, rows: (LadderElement | null)[][]): Rung {
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    id,
    rows: rows.length,
    cols,
    cells: rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? null)),
    vlinks: [],
  };
}

/**
 * The crane, commissioned. Five rungs, and the same five every later puzzle in
 * the category opens with.
 *
 * Shipped so the player can watch the machine do a full put-away before writing
 * a line of it. The replay shows the aisle, the panel and the readouts and
 * deliberately not the ladder: seeing what "arrived" looks like on a real
 * machine is the part that is hard to get from a paragraph, and it gives away
 * nothing that the Sequence of operation above does not already spell out.
 */
export const ASRS_DRIVE_DEMO: LadderProgram = {
  rungs: [
    // Where the crane is going, chosen by the panel selector.
    rung('demo-target', [
      [nc('X0'), mov('K0', 'D52'), mov('K2', 'D53')],
      [no('X0'), mov('K4', 'D52'), mov('K1', 'D53')],
    ]),
    // Drive whichever axis disagrees with its target, but only with the fork home.
    rung('demo-move', [
      [cmp('<', 'D0', 'D52'), no('X28'), out('Y0')],
      [cmp('>', 'D0', 'D52'), no('X28'), out('Y1')],
      [cmp('<', 'D1', 'D53'), no('X28'), out('Y2')],
      [cmp('>', 'D1', 'D53'), no('X28'), out('Y3')],
    ]),
    // Arrived: both axes on their target at the same time.
    rung('demo-at', [[cmp('=', 'D0', 'D52'), cmp('=', 'D1', 'D53'), out('M0')]]),
    rung('demo-lamp', [[no('M0'), out('Y6')]]),
    // The fork obeys the button, and only while the crane is standing still at a slot.
    rung('demo-fork', [[no('X1'), no('M0'), out('Y4')]]),
  ],
};

export const asrsDrive: PuzzleSpec = {
  kind: 'ladder',
  slug: 'asrs-drive',
  title: 'Aisle Crane: Commissioning',
  difficulty: 'tutorial',
  order: 41,
  category: 'warehouse',
  summary: 'Meet the stacker crane: drive it to a station by number, and know when it has arrived.',
  briefing: [
    'Aisle 1 of the automated warehouse. One stacker crane runs the length of it, a rack',
    'of four bays stands alongside, and each bay has two levels. Later in this category',
    'two production lines and a goods-in conveyor will all want that one crane at the',
    'same time, and deciding who gets it is what the whole category is about.',
    '',
    'None of that today. Before a crane is handed to the warehouse management system it',
    'is commissioned from a test panel, and the fitter decides where it goes. What you',
    'build is the piece underneath all of it: the block of rungs that takes a station',
    'written as two numbers, drives both axes to it, and knows when the crane is there.',
    '',
    '## Equipment',
    '- The aisle is six positions long, numbered 0 to 5. Bays 1 to 4 are the rack.',
    '  Position 0 is the aisle head and position 5 is the far end.',
    '- Level 1 is the pick face and level 2 is the reserve above it. At the aisle head,',
    '  level 2 is the GOODS IN conveyor.',
    '- X20 to X25 AT POSITION 0 to 5: one sensor per position along the rail.',
    '- X26 AT LEVEL 1 and X27 AT LEVEL 2: the two mast sensors.',
    '- D0 POSITION and D1 LEVEL: the same sensors written as a number, so you can do',
    '  arithmetic on them. Each holds the last sensor the crane actually passed, so it',
    '  reads where you are, never where you are nearly.',
    '- X28 FORK HOME and X29 FORK OUT: both ends of the fork stroke.',
    '- X3 LOAD ON FORKS: a pallet is on the forks right now.',
    '- X12 GOODS IN READY: a pallet is waiting on the inbound conveyor.',
    '- Y0 TRAVEL FORWARD, Y1 TRAVEL REVERSE, Y2 LIFT UP, Y3 LIFT DOWN, Y4 FORK OUT.',
    '- Y6 AT STATION: the lamp on the test panel.',
    '',
    '## The test panel',
    '- X0 STATION SELECT: off calls up GOODS IN, at position 0 level 2. On calls up the',
    '  one empty slot in the rack, bay 4 level 1.',
    '- X1 FORK OUT: held, the fork runs out. Released, it comes back.',
    '- Both of them are the fitter\'s, not the program\'s. Your job is to make the machine',
    '  obey them and to refuse the two things that would wreck it.',
    '',
    '## Sequence of operation',
    '1. Say where the crane should be, in two working registers: D52 for the position and',
    '   D53 for the level.',
    '   a. With STATION SELECT off, K0 into D52 and K2 into D53.',
    '   b. With it on, K4 into D52 and K1 into D53.',
    '2. Drive whichever axis disagrees with its target.',
    '   a. D0 less than D52 drives TRAVEL FORWARD, greater than drives TRAVEL REVERSE.',
    '   b. D1 less than D53 drives LIFT UP, greater than drives LIFT DOWN.',
    '3. Set M0 when the crane has arrived: D0 equal to D52 and D1 equal to D53, both at',
    '   the same time. Light AT STATION from it.',
    '4. Run the fork out while FORK OUT is held and M0 says the crane is standing at its',
    '   station.',
    '',
    '## Interlocks and safety',
    '- Never travel or lift with the fork anywhere but home. The fork is inside a rack',
    '  upright and the mast will fold. An NO contact on X28 in series with all four drive',
    '  coils is the whole interlock.',
    '- Never run the fork out unless the crane is lined up on both axes. Half way between',
    '  two bays there is nothing in front of the fork but steel. That is what M0 is for,',
    '  and it is why the fork button goes through it rather than straight to the coil.',
    '- The end stops are mechanical. Driving into one simply holds the crane.',
    '',
    '## Field notes',
    '- Both axes run at once, the way a real crane\'s do, so a move to another bay and',
    '  another level costs whichever of the two takes longer rather than both added up.',
    '  Four parallel rows in one rung, not four steps in a sequence.',
    '- D0 and D1 latch on the sensors rather than rounding to the nearest one. That is',
    '  what makes an equal comparison mean "arrived" instead of "more than half way',
    '  there", and it is why two comparisons can address the entire aisle.',
    '- MOV only writes while its rung conducts, so two rungs moving different numbers',
    '  into D52 is how you select a value, not a double-coil mistake.',
    '- A fork stroke moves the pallet when the stroke completes, not when it starts. Out',
    '  and back is one transfer: a pallet comes with you from a slot if the forks were',
    '  empty, and is left behind in it if they were not.',
    '- Reaching into an empty slot is not dangerous. It is a wasted trip, and on this',
    '  machine trips are the only thing you have to spend.',
    '',
    '## Acceptance',
    '- AT STATION lights when the crane is standing on the selected station, and goes out',
    '  as soon as it is sent to the other one.',
    '- Driven from the panel, the crane collects the waiting pallet from goods in and',
    '  leaves it in bay 4 level 1.',
    '- The fork stays home while the crane is moving, and the crane stays put while the',
    '  fork is out.',
  ].join('\n'),
  hints: [
    'Rung one is the target, in two rows: an NC contact on X0 into MOV K0 D52 and MOV ' +
      'K2 D53, and an NO contact on X0 into MOV K4 D52 and MOV K1 D53. The rows do not ' +
      'need vertical links - each one carries its own contact, so only the row that ' +
      'matches the selector writes.',
    'Rung two is the move block, four rows deep and the same shape in each: a compare ' +
      'contact, an NO contact on X28, then the coil. D0 < D52 drives Y0, D0 > D52 drives ' +
      'Y1, D1 < D53 drives Y2, D1 > D53 drives Y3. Build this one carefully - every ' +
      'puzzle in this category starts by copying it.',
    'Arrival is a rung of its own: compare D0 equal to D52 in series with D1 equal to ' +
      'D53, into an OUT coil on M0. Then M0 into Y6 for the lamp, and X1 in series with ' +
      'M0 into Y4 for the fork.',
    'If the mast folds, the X28 contact is missing from one of the four drive rows. If ' +
      'the fork trips on a slot the readout says you are at, the fork coil is being ' +
      'driven from the button alone rather than from the button and M0.',
  ],
  devices: [
    { address: 'X0', label: 'Station Select', io: 'input', widget: 'toggle' },
    { address: 'X1', label: 'Fork Out', io: 'input', widget: 'momentary' },
    { address: 'X12', label: 'Goods In Ready', io: 'input', widget: 'sensor' },
    ...CRANE_AXIS_DEVICES,
    { address: 'Y6', label: 'At Station', io: 'output', widget: 'lamp', color: '#34d399' },
  ],
  registers: [
    ...TARGET_REGISTERS,
    { address: 'M0', label: 'At station', note: 'D0 matches D52 and D1 matches D53' },
  ],
  allowedInstructions: ['contact-no', 'contact-nc', 'compare', 'mov', 'hwire', 'coil-out'],
  maxRungs: 8,
  processId: 'warehouse',
  demo: {
    scenario: 'One pallet away',
    caption: 'Watch a commissioned crane run the whole job, panel and all.',
    program: ASRS_DRIVE_DEMO,
  },
  scenarios: [
    {
      name: 'The crane finds its station',
      steps: [
        {
          label: 'The selector is on GOODS IN, so the crane lifts to the inbound conveyor',
          holdMs: 8000,
          until: { bits: { X20: true, X27: true } },
          thenHoldMs: 200,
          expect: { Y6: true, Y2: false, Y3: false },
          expectMachine: { jam: false },
        },
        {
          label: 'Select the rack slot: it travels down the aisle and drops to level 1',
          setInputs: { X0: true },
          holdMs: 12000,
          until: { bits: { X24: true, X26: true } },
          thenHoldMs: 200,
          expect: { Y6: true, Y0: false, Y1: false, Y2: false, Y3: false },
          expectMachine: { jam: false },
        },
        {
          label: 'And back again, which is the same two rungs run the other way',
          setInputs: { X0: false },
          holdMs: 12000,
          until: { bits: { X20: true, X27: true } },
          thenHoldMs: 200,
          expect: { Y6: true },
          expectMachine: { jam: false },
        },
      ],
    },
    {
      name: 'One pallet away',
      steps: [
        {
          label: 'A pallet is waiting at goods in, so drive up to it',
          holdMs: 8000,
          until: { bits: { X20: true, X27: true } },
          thenHoldMs: 200,
          expect: { Y6: true, X12: true },
          expectMachine: { jam: false },
        },
        {
          label: 'Run the fork out and the pallet comes onto the forks',
          setInputs: { X1: true },
          holdMs: 6000,
          until: { bits: { X3: true } },
          expect: { X29: true },
          expectMachine: { jam: false, carrying: true },
        },
        {
          label: 'Let go and the fork comes home with the pallet on it',
          setInputs: { X1: false },
          holdMs: 6000,
          until: { bits: { X28: true } },
          expect: { X3: true, Y4: false },
          expectMachine: { jam: false, carrying: true },
        },
        {
          label: 'Select the rack slot and carry it down to bay 4',
          setInputs: { X0: true },
          holdMs: 12000,
          until: { bits: { X24: true, X26: true } },
          thenHoldMs: 200,
          expect: { Y6: true },
          expectMachine: { jam: false, carrying: true },
        },
        {
          label: 'Run the fork out again and the pallet is left in the slot',
          setInputs: { X1: true },
          holdMs: 6000,
          until: { machine: { storedAway: 1 } },
          expectMachine: { jam: false, carrying: false, slot41: 1 },
        },
        {
          label: 'Bring the fork home, empty, and the put-away is finished',
          setInputs: { X1: false },
          holdMs: 6000,
          until: { bits: { X28: true } },
          expect: { X3: false, Y4: false },
          expectMachine: { jam: false, storedAway: 1 },
        },
      ],
    },
    {
      name: 'The interlocks hold',
      steps: [
        {
          label: 'The fork button is already held as the crane sets off, and the fork stays home',
          setInputs: { X0: true, X1: true },
          holdMs: 1000,
          expect: { Y4: false, X28: true },
          expectMachine: { jam: false },
        },
        {
          label: 'It runs out only once the crane is standing at the slot',
          holdMs: 10000,
          until: { bits: { X29: true } },
          expect: { X24: true, X26: true },
          expectMachine: { jam: false },
        },
        {
          label: 'Select the other station with the fork still out: nothing moves until it is home',
          setInputs: { X0: false },
          holdMs: 6000,
          until: { bits: { X28: true } },
          expect: { X24: true },
          expectMachine: { jam: false },
        },
        {
          label: 'And with the fork home the crane travels back to goods in',
          setInputs: { X1: false },
          holdMs: 12000,
          until: { bits: { X20: true, X27: true } },
          thenHoldMs: 200,
          expect: { Y6: true },
          expectMachine: { jam: false },
        },
      ],
    },
  ],
};
