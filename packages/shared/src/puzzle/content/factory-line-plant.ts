import type { CompareOp, LadderElement, Rung, VarDecl, VLink } from '../../ladder/types.js';
import type { AnalogRange, PuzzleDevice } from '../types.js';

/**
 * The excavator line: every signal on it, and the six programs that run it.
 *
 * Shared because the four station puzzles and the capstone are the *same plant*
 * seen from six desks. The paint puzzle hands the player the booth and ships the
 * other five working; the assembly puzzle hands over the jig and ships the
 * booth. If each spec carried its own copy of the five it was not teaching they
 * would drift the first time one of them was fixed, and the player would be
 * commissioning a slightly different factory every time.
 *
 * Two sets of programs. `*_PLAIN` is the answer somebody writes first: it runs
 * the line, it never faults, and it leaves a quarter of the plant's output on
 * the floor. `*_TUNED` is the same station after somebody has thought about it,
 * in about the same number of rungs. The station puzzles ship TUNED neighbors,
 * so the bay under test really is the one holding the line up; the capstone
 * seeds all six with PLAIN, because there the plant is the puzzle.
 */

// --- Analog ranges ------------------------------------------------------------

const TEMP_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 200,
  units: 'C',
  decimals: 0,
};

/** The film gauge, 0..400 um. */
const FILM_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 400,
  units: 'um',
  decimals: 0,
};

/** The gun's flow command, as a percentage of the needle's travel. */
const FLOW_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '%',
  decimals: 0,
};

/** A plain small integer: a lane count, a drum number, a tally on a gate. */
const countRange = (max: number, units: string): AnalogRange => ({
  countMin: 0,
  countMax: max,
  min: 0,
  max,
  units,
  decimals: 0,
});

const LANE_RANGE = countRange(2, 'parts');
const DRUM_RANGE = countRange(4, 'drum');
const YARD_RANGE = countRange(6, 'machines');

/**
 * Every signal on the line, in station order.
 *
 * The order is the order of the shop floor, not of the address, because this
 * list is also the operator panel and a panel laid out by address number is a
 * panel nobody can find anything on.
 */
export const LINE_DEVICES: PuzzleDevice[] = [
  // --- Plant ---
  { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
  { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary', normallyClosed: true },
  { address: 'X2', label: 'Emergency Stop', io: 'input', widget: 'estop', normallyClosed: true },
  { address: 'X3', label: 'Auto', io: 'input', widget: 'selector' },
  { address: 'Y0', label: 'Plant Running', io: 'output', widget: 'lamp', color: '#34d399' },
  { address: 'Y1', label: 'Line Held', io: 'output', widget: 'lamp', color: '#fbbf24' },

  // --- Weld shop ---
  { address: 'X4', label: 'Frame Blank Ready', io: 'input', widget: 'sensor' },
  { address: 'X5', label: 'Boom Blank Ready', io: 'input', widget: 'sensor' },
  { address: 'X6', label: 'Fixture Clamped', io: 'input', widget: 'sensor' },
  { address: 'X7', label: 'Positioner At A', io: 'input', widget: 'sensor' },
  { address: 'X8', label: 'Positioner At B', io: 'input', widget: 'sensor' },
  { address: 'X9', label: 'Torch Tip Worn', io: 'input', widget: 'sensor' },
  { address: 'X10', label: 'Weld Outfeed Occupied', io: 'input', widget: 'sensor' },
  { address: 'Y2', label: 'Clamp', io: 'output', widget: 'motor', color: '#e0a11b' },
  { address: 'Y3', label: 'Torch', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y4', label: 'Rotate Positioner', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y5', label: 'Release', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y6', label: 'Select Boom', io: 'output', widget: 'lamp', color: '#e879f9' },
  { address: 'Y7', label: 'Change Tip', io: 'output', widget: 'motor', color: '#e879f9' },

  // --- Rack store ---
  { address: 'X11', label: 'Part At Store Infeed', io: 'input', widget: 'sensor' },
  { address: 'X12', label: 'Boom At Store Infeed', io: 'input', widget: 'sensor' },
  { address: 'X13', label: 'Part At Store Outfeed', io: 'input', widget: 'sensor' },
  { address: 'Y8', label: 'Load Into Lane', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y9', label: 'Pick From Lane', io: 'output', widget: 'motor', color: '#38bdf8' },
  {
    address: 'D13',
    label: 'Load Lane Select',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: countRange(4, 'lane'),
    color: '#38bdf8',
  },
  {
    address: 'D14',
    label: 'Pick Lane Select',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: countRange(4, 'lane'),
    color: '#38bdf8',
  },
  ...[0, 1, 2, 3].map(
    (i): PuzzleDevice => ({
      address: `D${4 + i}`,
      label: `Lane ${i + 1} Count`,
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: LANE_RANGE,
      color: i < 2 ? '#94a3b8' : '#e879f9',
    }),
  ),

  // --- Portal robot ---
  { address: 'X14', label: 'Portal At Store', io: 'input', widget: 'sensor' },
  { address: 'X15', label: 'Portal At Booth', io: 'input', widget: 'sensor' },
  { address: 'X16', label: 'Portal Down', io: 'input', widget: 'sensor' },
  { address: 'X17', label: 'Portal Up', io: 'input', widget: 'sensor' },
  { address: 'X18', label: 'Part Held', io: 'input', widget: 'sensor' },
  { address: 'Y10', label: 'Travel To Booth', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y11', label: 'Travel To Store', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y12', label: 'Lower Head', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y13', label: 'Vacuum', io: 'output', widget: 'motor', color: '#ef4444' },

  // --- Paint shop ---
  { address: 'X19', label: 'Part At Booth', io: 'input', widget: 'sensor' },
  { address: 'X20', label: 'Boom In Booth', io: 'input', widget: 'sensor' },
  { address: 'X21', label: 'Oven Full', io: 'input', widget: 'sensor' },
  { address: 'X22', label: 'Painted Lane Full', io: 'input', widget: 'sensor' },
  {
    address: 'D0',
    label: 'Booth Temperature',
    io: 'input',
    widget: 'gauge',
    signal: 'analog',
    range: TEMP_RANGE,
    color: '#f97316',
  },
  {
    address: 'D1',
    label: 'Film Thickness',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: FILM_RANGE,
    color: '#f0b429',
  },
  {
    address: 'D8',
    label: 'Next Paint Color',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  {
    address: 'D9',
    label: 'Color In Gun',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  { address: 'Y14', label: 'Spray Gun', io: 'output', widget: 'motor', color: '#f0b429' },
  { address: 'Y15', label: 'Oven Infeed', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y16', label: 'Purge Gun', io: 'output', widget: 'motor', color: '#a78bfa' },
  {
    address: 'D2',
    label: 'Heater Command',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: TEMP_RANGE,
    color: '#f97316',
  },
  {
    address: 'D3',
    label: 'Gun Flow Command',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: FLOW_RANGE,
    color: '#f0b429',
  },
  {
    address: 'D15',
    label: 'Drum Select',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },

  // --- Final assembly ---
  { address: 'X23', label: 'Frame Ready', io: 'input', widget: 'sensor' },
  { address: 'X24', label: 'Boom Ready', io: 'input', widget: 'sensor' },
  { address: 'X25', label: 'Boom Made Up', io: 'input', widget: 'sensor' },
  { address: 'X26', label: 'Machine Complete', io: 'input', widget: 'sensor' },
  { address: 'X27', label: 'Test Bay Clear', io: 'input', widget: 'sensor' },
  {
    address: 'D10',
    label: 'Frame Color Ready',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  {
    address: 'D11',
    label: 'Boom Color Ready',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  // What the jig is actually holding, as against what is standing at the head of
  // a lane. Both sections' programs have read these since the line was built;
  // they are declared here because a value a program refers to by name has to be
  // a device the puzzle names, and D16 and D17 are as much field values as the
  // lane colors above them.
  {
    address: 'D16',
    label: 'Frame In Jig',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  {
    address: 'D17',
    label: 'Boom In Jig',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: DRUM_RANGE,
    color: '#a78bfa',
  },
  { address: 'Y17', label: 'Call Frame', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y18', label: 'Call Boom', io: 'output', widget: 'motor', color: '#e879f9' },
  { address: 'Y19', label: 'Lower Engine', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y20', label: 'Fit Cab', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y21', label: 'Make Up Boom', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y22', label: 'Pin Boom', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y23', label: 'Release To Test', io: 'output', widget: 'motor', color: '#f97316' },

  // --- Test and dispatch ---
  { address: 'X28', label: 'Machine At Test', io: 'input', widget: 'sensor' },
  { address: 'X29', label: 'Test Passed', io: 'input', widget: 'sensor' },
  { address: 'X30', label: 'Yard Space', io: 'input', widget: 'sensor' },
  { address: 'X31', label: 'Truck At Dock', io: 'input', widget: 'sensor' },
  {
    address: 'D12',
    label: 'Machines In Yard',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: YARD_RANGE,
    color: '#34d399',
  },
  { address: 'Y24', label: 'Hydraulic Pump', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y25', label: 'Function Test', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y26', label: 'Dispatch', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y27', label: 'Call Truck', io: 'output', widget: 'motor', color: '#38bdf8' },

  // --- The spine ---
  // Twelve zones, each an eye and a drive, in the order a part travels them. The
  // regularity is the point: once a player has written one zone they have
  // written all twelve, and the puzzle is what the *rule* between them is rather
  // than how any one of them works.
  ...zonePair(1, 'X32', 'Y28', 'Weld Outfeed'),
  ...zonePair(2, 'X33', 'Y29', 'Transfer'),
  ...zonePair(3, 'X34', 'Y30', 'Store Infeed'),
  ...zonePair(4, 'X35', 'Y31', 'Oven Discharge'),
  ...zonePair(5, 'X36', 'Y32', 'East Transfer N'),
  ...zonePair(6, 'X37', 'Y33', 'East Transfer S'),
  ...zonePair(7, 'X38', 'Y34', 'Sort'),
  ...zonePair(8, 'X39', 'Y35', 'Frame Lane'),
  ...zonePair(9, 'X40', 'Y36', 'Boom Lane'),
  ...zonePair(10, 'X41', 'Y37', 'Assembly Outfeed'),
  ...zonePair(11, 'X42', 'Y38', 'Test Infeed'),
  ...zonePair(12, 'X43', 'Y39', 'Dock Apron'),
  { address: 'X44', label: 'Boom At Sort', io: 'input', widget: 'lamp', color: '#f472b6' },
  { address: 'X45', label: 'Frame Lane Full', io: 'input', widget: 'lamp', color: '#fbbf24' },
  { address: 'X46', label: 'Boom Lane Full', io: 'input', widget: 'lamp', color: '#fbbf24' },
  { address: 'Y40', label: 'Divert To Frame Lane', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y41', label: 'Divert To Boom Lane', io: 'output', widget: 'motor', color: '#f472b6' },
  {
    address: 'D18',
    label: 'Parts On Spine',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: countRange(14, 'parts'),
    color: '#a78bfa',
  },
  {
    address: 'D19',
    label: 'Blocked At Zone',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: countRange(12, 'zone'),
    color: '#fb923c',
  },
];

/**
 * One zone's eye and drive.
 *
 * Written as a helper rather than as twenty-four literal entries because the
 * regularity is real: the spine is one mechanism repeated twelve times, and a
 * device list that spelled each one out by hand would invite the twelve to drift
 * apart in ways the plant does not.
 */
function zonePair(n: number, eye: string, drive: string, name: string): PuzzleDevice[] {
  return [
    {
      address: eye,
      label: `Z${n} ${name}`,
      // The derived symbol would be `Z1WeldOutfeed`, which names the place rather
      // than the signal. An eye reads *occupied*, and a program that says
      // `NOT Z3Occupied` is saying the thing the rung actually means.
      symbol: `Z${n}Occupied`,
      io: 'input',
      widget: 'lamp',
      color: '#a3e635',
    },
    {
      address: drive,
      label: `Z${n} Drive`,
      symbol: `Z${n}Drive`,
      io: 'output',
      widget: 'motor',
      color: '#e8621a',
    },
  ];
}

/**
 * The instruction set the line is wired for.
 *
 * A counter is in it because one station genuinely needs one: a torch tip is
 * good for a fixed number of passes and nothing in the field says how many are
 * left, only that they have run out. Counting your own work is the only way to
 * change it before it stops you.
 */
export const LINE_INSTRUCTIONS = [
  'contact-no',
  'contact-nc',
  'contact-rising',
  'compare',
  'hwire',
  'coil-out',
  'coil-set',
  'coil-reset',
  'timer',
  'counter',
  'mov',
] as const;

/**
 * What each section is allowed to write, in the plant's flat device space.
 *
 * A property of the plant, not of whichever puzzle happens to be opening a bay:
 * a section reads whatever it likes and drives only its own.
 */
export const LINE_OWNS = {
  SUP: ['M0-M9', 'T0-T4', 'C0-C4', 'D70-D79', 'Y0', 'Y1'],
  WELD: ['Y2-Y7', 'M10-M39', 'T10-T19', 'C10-C19', 'D20-D29'],
  STORE: ['Y8-Y13', 'D13', 'D14', 'M40-M69', 'T20-T29', 'C20-C29', 'D30-D39'],
  PAINT: ['Y14-Y16', 'D2', 'D3', 'D15', 'M70-M99', 'T30-T39', 'C30-C39', 'D40-D49'],
  ASSY: ['Y17-Y23', 'M100-M129', 'T40-T49', 'C40-C49', 'D50-D59'],
  TEST: ['Y24-Y27', 'M130-M159', 'T50-T59', 'C50-C59', 'D60-D69'],
  CONV: ['Y28-Y41', 'M160-M199', 'T60-T69', 'C60-C69', 'D80-D99'],
} as const;

// --- Ladder builders ----------------------------------------------------------

const no = (device: string): LadderElement => ({ type: 'contact-no', device });
const nc = (device: string): LadderElement => ({ type: 'contact-nc', device });
const out = (device: string): LadderElement => ({ type: 'coil-out', device });
const set = (device: string): LadderElement => ({ type: 'coil-set', device });
const rst = (device: string): LadderElement => ({ type: 'coil-reset', device });
const tmr = (device: string, preset: number): LadderElement => ({ type: 'timer', device, preset });
const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});
const re = (device: string): LadderElement => ({ type: 'contact-rising', device });
const cmp = (op: CompareOp, a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op,
  operands: [a, b],
});

function rung(id: string, rows: (LadderElement | null)[][], vlinks: VLink[] = []): Rung {
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    id,
    rows: rows.length,
    cols,
    cells: rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? null)),
    vlinks,
  };
}

export const build = { no, nc, re, out, set, rst, tmr, mov, cmp, rung };

// --- The line's globals -------------------------------------------------------

/**
 * The one name every section on this plant shares.
 *
 * A local would not do: `PlantRun` is written in the supervisor and read in all
 * six stations, and a name private to one POU is invisible in the others by
 * design. So it is a global, shipped by the puzzle rather than declared by the
 * player, and `fixed` because a submission that renamed or moved it would be
 * rewriting the supervisor's half of a handshake from the far end of it.
 *
 * It is deliberately the *only* one so far. The spine's published interface —
 * `SpineReady`, `WeldReleaseOk` and the rest — is new behaviour rather than a
 * rename, so it belongs with the puzzles that ask for it, not with a conversion
 * that has to ship the same machine counts it started with.
 */
export const LINE_GLOBALS: VarDecl[] = [
  {
    name: 'PlantRun',
    kind: 'bool',
    address: 'M0',
    fixed: true,
    comment: 'Published by the supervisor. Every section reads it and none of them write it.',
  },
];

// --- SUPERVISOR ---------------------------------------------------------------

/**
 * The program above the plant, as the commissioning puzzle left it.
 *
 * A run latch, a lamp that follows it, and an amber that says the line is
 * backing up. Every station below reads the one bit it publishes and none of
 * them write it.
 */
export const SUP_PROGRAM: Rung[] = [
  rung(
    'sup-run',
    [
      [no('Start'), no('Stop'), no('EmergencyStop'), no('Auto'), out('PlantRun')],
      [no('PlantRun')],
    ],
    [{ row: 0, col: 1 }],
  ),
  rung('sup-lamp', [[no('PlantRun'), out('PlantRunning')]]),
  // Three ways the line backs up, ORed into one amber lamp. YardSpace is on
  // while there IS room, so it is the one that inverts.
  rung(
    'sup-held',
    [[no('WeldOutfeedOccupied'), out('LineHeld')], [no('PaintedLaneFull')], [nc('YardSpace')]],
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  ),
];
