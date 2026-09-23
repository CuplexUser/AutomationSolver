import type { LadderElement, Rung } from '../../ladder/types.js';
import type { AnalogRange, PuzzleDevice } from '../types.js';

/**
 * The Cold Chain Hub's wiring: one block per piece of plant, so each puzzle in
 * the category lists exactly the equipment it builds and nothing it does not
 * (a register list is a promise). Addresses never move between puzzles, and a
 * location's count always sits in the register numbered like its code: lane 31's
 * count is D31, room 21's is D21.
 *
 * The plant itself is `processes/distribution.ts`, and docs/COLD-CHAIN.md is the
 * design. The numbers here are inventory data, not transmitter counts, so count
 * and value are the same number and there is nothing to scale.
 */

const whole = (max: number, units: string): AnalogRange => ({
  countMin: 0,
  countMax: max,
  min: 0,
  max,
  units,
  decimals: 0,
});

export const LOCATION_RANGE = whole(99, 'code');
export const PALLET_RANGE = whole(499, 'code');
export const COUNT_RANGE = whole(4, 'pallets');

/** The fleet manager's mailbox: the order, the request, and the manager's answer. */
export const DC_MAILBOX: PuzzleDevice[] = [
  {
    address: 'D0',
    label: 'Order From',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: LOCATION_RANGE,
    color: '#38bdf8',
  },
  {
    address: 'D1',
    label: 'Order To',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: LOCATION_RANGE,
    color: '#38bdf8',
  },
  { address: 'Y0', label: 'Order Request', io: 'output', widget: 'lamp', color: '#38bdf8' },
  { address: 'X0', label: 'Order Accepted', io: 'input', widget: 'sensor' },
  { address: 'X1', label: 'Order Rejected', io: 'input', widget: 'sensor' },
  { address: 'X2', label: 'Vehicle Free', io: 'input', widget: 'sensor' },
];

export const DC_INBOUND_1: PuzzleDevice[] = [
  { address: 'X3', label: 'IN1 Pallet Waiting', io: 'input', widget: 'sensor' },
];

export const DC_INBOUND_2: PuzzleDevice[] = [
  { address: 'X4', label: 'IN2 Pallet Waiting', io: 'input', widget: 'sensor' },
];

export const DC_QA: PuzzleDevice[] = [
  { address: 'X5', label: 'QA Occupied', io: 'input', widget: 'sensor' },
  { address: 'X6', label: 'QA Done', io: 'input', widget: 'sensor' },
  { address: 'X7', label: 'QA Pass', io: 'input', widget: 'sensor' },
];

/** What QA read off the pallet: product x 100 + lot. The only scan in the plant. */
export const DC_QA_CODE: PuzzleDevice[] = [
  {
    address: 'D5',
    label: 'QA Pallet Code',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: PALLET_RANGE,
    color: '#fbbf24',
  },
];

// --- a small rung-building kit for the demos -----------------------------------
// Local to content, the way 41-asrs-drive.ts keeps its own: content should not
// be able to break by a test refactor.

export const no = (device: string): LadderElement => ({ type: 'contact-no', device });
export const nc = (device: string): LadderElement => ({ type: 'contact-nc', device });
export const rise = (device: string): LadderElement => ({ type: 'contact-rising', device });
export const out = (device: string): LadderElement => ({ type: 'coil-out', device });
export const set = (device: string): LadderElement => ({ type: 'coil-set', device });
export const rst = (device: string): LadderElement => ({ type: 'coil-reset', device });
export const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});

/**
 * One rung from rows of elements, left-aligned. `links` are the node columns
 * where row r joins row r+1, for parallel branches that share a tail.
 */
export function rung(
  id: string,
  rows: (LadderElement | null)[][],
  links: { row: number; col: number }[] = [],
): Rung {
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    id,
    rows: rows.length,
    cols,
    cells: rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? null)),
    vlinks: links,
  };
}

/** The stretch wrapper's line: its infeed, the labeler and the outfeed. */
export const DC_WRAPPER: PuzzleDevice[] = [
  { address: 'X10', label: 'Wrapper Infeed Clear', io: 'input', widget: 'sensor' },
  { address: 'X11', label: 'Pallet At Labeler', io: 'input', widget: 'sensor' },
  { address: 'X12', label: 'Outfeed Pallet Ready', io: 'input', widget: 'sensor' },
  {
    address: 'D2',
    label: 'Label Door',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: LOCATION_RANGE,
    color: '#a78bfa',
  },
  { address: 'Y1', label: 'Print Label', io: 'output', widget: 'lamp', color: '#a78bfa' },
];

/** The WMS routing table: which outbound door each product ships from, D101 to D104. */
export const DC_ROUTES: PuzzleDevice[] = [1, 2, 3, 4].map((p) => ({
  address: `D${100 + p}`,
  label: `Door For Product ${p}`,
  io: 'input' as const,
  widget: 'bar' as const,
  signal: 'analog' as const,
  range: LOCATION_RANGE,
  color: '#94a3b8',
}));

export const math = (
  op: 'add' | 'sub' | 'mul' | 'div',
  a: string,
  b: string,
  device: string,
): LadderElement => ({ type: 'math', device, op, operands: [a, b] });
export const fall = (device: string): LadderElement => ({ type: 'contact-falling', device });

/** The three FIFO flow lanes: how many pallets each holds, in the register numbered like its code. */
export const DC_FLOW_LANES: PuzzleDevice[] = [31, 32, 33].map((code) => ({
  address: `D${code}`,
  label: `F${code - 30} Pallets`,
  io: 'input' as const,
  widget: 'bar' as const,
  signal: 'analog' as const,
  range: COUNT_RANGE,
  color: '#34d399',
}));

/** What OUT1 is calling for next: a product, or 0 while it is between calls. */
export const DC_CALL_OUT1: PuzzleDevice[] = [
  {
    address: 'D13',
    label: 'OUT1 Calling For',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: whole(4, 'product'),
    color: '#f472b6',
  },
];

/** The advance shipping notice: the code the program says it is shipping, read when an order to a dock is accepted. */
export const DC_ASN: PuzzleDevice[] = [
  {
    address: 'D3',
    label: 'Shipping Notice Code',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: PALLET_RANGE,
    color: '#f472b6',
  },
];

/** The two ripening rooms: doors, starts, their sensors and their counts. */
export const DC_ROOMS: PuzzleDevice[] = [
  { address: 'Y2', label: 'R1 Door Open', io: 'output', widget: 'motor', color: '#fbbf24' },
  { address: 'Y3', label: 'R2 Door Open', io: 'output', widget: 'motor', color: '#fbbf24' },
  { address: 'Y4', label: 'R1 Start Cycle', io: 'output', widget: 'lamp', color: '#34d399' },
  { address: 'Y5', label: 'R2 Start Cycle', io: 'output', widget: 'lamp', color: '#34d399' },
  { address: 'X15', label: 'R1 Door Fully Open', io: 'input', widget: 'sensor' },
  { address: 'X16', label: 'R2 Door Fully Open', io: 'input', widget: 'sensor' },
  { address: 'X22', label: 'R1 Door Shut', io: 'input', widget: 'sensor' },
  { address: 'X23', label: 'R2 Door Shut', io: 'input', widget: 'sensor' },
  { address: 'X24', label: 'R1 Doorway Clear', io: 'input', widget: 'sensor' },
  { address: 'X25', label: 'R2 Doorway Clear', io: 'input', widget: 'sensor' },
  { address: 'X17', label: 'R1 Batch Ripe', io: 'input', widget: 'sensor' },
  { address: 'X20', label: 'R2 Batch Ripe', io: 'input', widget: 'sensor' },
  ...[21, 22].map((code) => ({
    address: `D${code}`,
    label: `R${code - 20} Pallets`,
    io: 'input' as const,
    widget: 'bar' as const,
    signal: 'analog' as const,
    range: COUNT_RANGE,
    color: '#fbbf24',
  })),
];

/** The three LIFO drive-in lanes' counts, D41 to D43. */
export const DC_DRIVE_IN_LANES: PuzzleDevice[] = [41, 42, 43].map((code) => ({
  address: `D${code}`,
  label: `L${code - 40} Pallets`,
  io: 'input' as const,
  widget: 'bar' as const,
  signal: 'analog' as const,
  range: COUNT_RANGE,
  color: '#fb923c',
}));

/** What OUT2 is calling for next: a product, or 0 while it is between calls. */
export const DC_CALL_OUT2: PuzzleDevice[] = [
  {
    address: 'D14',
    label: 'OUT2 Calling For',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: whole(4, 'product'),
    color: '#f472b6',
  },
];
