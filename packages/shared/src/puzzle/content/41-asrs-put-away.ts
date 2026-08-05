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
 * The aisle, the mast and the fork: the part of the machine that is identical in
 * every puzzle of the category. Six position sensors along the rail, two level
 * sensors on the mast, both ends of the fork stroke, and the five coils that
 * drive them.
 */
export const CRANE_DEVICES: PuzzleDevice[] = [
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
  { address: 'X13', label: 'Slot Occupied', io: 'input', widget: 'sensor' },
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
  {
    address: 'D13',
    label: 'Code On Forks',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: CODE_RANGE,
    color: '#e879f9',
  },
  { address: 'Y0', label: 'Travel Forward', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y1', label: 'Travel Reverse', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y2', label: 'Lift Up', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y3', label: 'Lift Down', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y4', label: 'Fork Out', io: 'output', widget: 'motor', color: '#e879f9' },
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

export const asrsPutAway: PuzzleSpec = {
  kind: 'ladder',
  slug: 'asrs-put-away',
  title: 'Aisle Crane: First Put-Away',
  difficulty: 'medium',
  order: 41,
  category: 'warehouse',
  summary: 'Learn the crane: drive it to a slot on the position sensors, and put one pallet away.',
  briefing: [
    'Aisle 1 of the automated warehouse. One stacker crane runs the length of it, a rack',
    'of four bays stands alongside, and each bay has two levels. Everything in this',
    'category is addressed the same way: a position along the aisle, and a level.',
    '',
    'This first job is one pallet. It is waiting on the goods-in conveyor and it needs',
    'to be in the rack. Nothing is running yet and nothing is waiting on you, so take',
    'the time to learn how the crane is driven.',
    '',
    '## Equipment',
    '- The aisle is six positions long, numbered 0 to 5. Bays 1 to 4 are the rack.',
    '  Position 0 is the aisle head and position 5 is the far end.',
    '- Level 1 is the pick face and level 2 is the reserve above it. At the aisle head,',
    '  level 2 is the GOODS IN conveyor.',
    '- X20 to X25 AT POSITION 0 to 5: one sensor per position along the rail.',
    '- X26 AT LEVEL 1 and X27 AT LEVEL 2: the two mast sensors.',
    '- D0 POSITION and D1 LEVEL: the same sensors as a number. Each one holds the last',
    '  sensor the crane actually passed, so it reads where you are, never where you are',
    '  nearly.',
    '- X28 FORK HOME and X29 FORK OUT: both ends of the fork stroke.',
    '- X3 LOAD ON FORKS, and X13 SLOT OCCUPIED, the photo-eye that looks into whichever',
    '  slot the crane is parked at.',
    '- D13 CODE ON FORKS and D12 GOODS IN CODE: what material you are holding, and what',
    '  is waiting on the conveyor.',
    '- Y0 TRAVEL FORWARD, Y1 TRAVEL REVERSE, Y2 LIFT UP, Y3 LIFT DOWN, Y4 FORK OUT.',
    '- X0 AUTO: the cycle-start switch.',
    '',
    '## Sequence of operation',
    '1. In auto, drive to the goods-in conveyor at position 0, level 2.',
    '2. Run the fork all the way out and all the way back in again. That is the whole',
    '   transfer: the pallet comes with you when the stroke completes.',
    '3. Drive to bay 2, level 2, which the WMS shows as empty.',
    '4. Run the fork out and back again to leave the pallet there.',
    '5. Return to position 0, level 1, and stop.',
    '',
    '## Interlocks and safety',
    '- Never travel or lift with the fork anywhere but home. The fork is inside a rack',
    '  upright and the mast will fold. Wait for X28.',
    '- Never run the fork out unless the crane is lined up on both sensors. Half way',
    '  between two bays there is nothing in front of the fork but steel.',
    '- The end stops are mechanical. Driving into one simply holds the crane.',
    '',
    '## Field notes',
    '- The crane travels and lifts at the same time, so a move to a different bay and a',
    '  different level costs whichever of the two takes longer, not both added up.',
    '- Driving to a station is worth building once and reusing: put the position you',
    '  want in D52 and the level in D53, then let one rung compare those against D0 and',
    '  D1 and pick the coil. Every puzzle after this one is built on top of that rung.',
    '',
    '## Acceptance',
    '- The pallet from goods-in is in bay 2, level 2.',
    '- The crane is back at position 0, level 1, with its fork home.',
    '- Nothing folded and nothing was dropped.',
  ].join('\n'),
  hints: [
    'Build the move block first, and build it generic. One rung with four rows: ' +
      'compare D0 less than D52 drives Y0, greater than drives Y1, and the same pair on ' +
      'D1 against D53 drives Y2 and Y3. Put an NO contact on X28 in series with all four ' +
      'so nothing can move with the fork out.',
    'The job is three steps, so latch three relays one at a time - M1 go and collect, ' +
      'M2 go and store, M3 go home - and let one rung load D52 and D53 from whichever ' +
      'step is active. Since each step writes its own pair of MOVs, several rungs writing ' +
      'D52 is the normal way to select a value, not a double-coil mistake.',
    'For the fork, latch M11 when X29 makes and drive Y4 from "at target and not M11". ' +
      'The fork then goes out once, comes back on its own, and M11 tells the step chain ' +
      'the transfer is finished. Clear M11 whenever the crane is not at its target.',
    '"At target" is one rung: D0 equal to D52 in series with D1 equal to D53. Because D0 ' +
      'only updates when a position sensor makes, that comparison is true exactly when ' +
      'the crane has arrived, and never on the way past.',
  ],
  devices: [
    { address: 'X0', label: 'Auto', io: 'input', widget: 'toggle' },
    { address: 'X12', label: 'Goods In Ready', io: 'input', widget: 'sensor' },
    ...CRANE_DEVICES,
    {
      address: 'D12',
      label: 'Goods In Code',
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: CODE_RANGE,
      color: '#fbbf24',
    },
  ],
  registers: [
    { address: 'M1', label: 'Step 1: collect', note: 'at goods-in, position 0 level 2' },
    { address: 'M2', label: 'Step 2: store', note: 'at bay 2 level 2' },
    { address: 'M3', label: 'Step 3: go home', note: 'position 0 level 1' },
    { address: 'M4', label: 'Cycle finished', note: 'stops the job restarting' },
    { address: 'M0', label: 'At target', note: 'D0 matches D52 and D1 matches D53' },
    { address: 'M11', label: 'Transfer done', note: 'the fork has been all the way out' },
    ...TARGET_REGISTERS,
    ...WMS_REGISTERS,
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'compare',
    'mov',
    'hwire',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 20,
  processId: 'warehouse',
  scenarios: [
    {
      name: 'One pallet into the rack',
      steps: [
        {
          label: 'Switch to auto; the crane collects the pallet from goods-in',
          setInputs: { X0: true },
          holdMs: 30000,
          until: { bits: { X3: true } },
          expectMachine: { jam: false },
        },
        {
          label: 'It carries it to bay 2 and leaves it in the reserve level',
          holdMs: 30000,
          until: { machine: { storedAway: 1 } },
          expectMachine: { jam: false, slot22: 1 },
        },
        {
          label: 'And returns to the aisle head with the fork home',
          holdMs: 30000,
          until: { bits: { X20: true, X26: true, X28: true } },
          expectMachine: { jam: false, storedAway: 1, carrying: false },
        },
      ],
      parMs: 6600,
    },
  ],
};
