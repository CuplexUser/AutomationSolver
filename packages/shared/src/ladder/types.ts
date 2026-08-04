/**
 * Ladder-logic domain model (Mitsubishi FX-series flavor, simplified but authentic).
 *
 * A program is an ordered list of rungs. Each rung is a grid of cells. Cells hold
 * elements (contacts/coils/function-blocks). Horizontal neighbours are in series;
 * vertical links join rows to form parallel branches.
 */

/**
 * Device families addressable in a program.
 *
 * `D` is the odd one out: X/Y/M/T/C are single bits, a D is a 16-bit signed
 * *word*. It never appears on a contact or a coil — only as an operand of the
 * word instructions (compare / mov / math / pid) — which is why every element
 * that touches one carries `operands` rather than just a `device`.
 */
export type DeviceKind = 'X' | 'Y' | 'M' | 'T' | 'C' | 'D';

/** All element kinds a cell can hold. */
export type ElementType =
  | 'contact-no' // normally open   --| |--
  | 'contact-nc' // normally closed --|/|--
  | 'contact-rising' // rising edge     --|P|--
  | 'contact-falling' // falling edge    --|N|--
  | 'compare' // compare contact --[D0 > K500]--
  | 'hwire' // horizontal wire (always conducts)
  | 'coil-out' // output coil     --( )--
  | 'coil-set' // set (latch)     --(S)--
  | 'coil-reset' // reset (unlatch)  --(R)--
  | 'timer' // on-delay timer  --(T Kn)--
  | 'counter' // counter         --(C Kn)--
  | 'mov' // move            --[MOV S D]--
  | 'math' // + - * /         --[ADD S1 S2 D]--
  | 'pid'; // PID loop        --[PID SV PV MV]--

/** Comparison performed by a `compare` contact, on its two word operands. */
export type CompareOp = '=' | '<>' | '>' | '<' | '>=' | '<=';

/** Arithmetic performed by a `math` output, on its two word operands. */
export type MathOp = 'add' | 'sub' | 'mul' | 'div';

export const COMPARE_OPS: readonly CompareOp[] = ['=', '<>', '>', '<', '>=', '<='];
export const MATH_OPS: readonly MathOp[] = ['add', 'sub', 'mul', 'div'];

/** Mnemonic shown on the block face, e.g. ADD. */
export const MATH_MNEMONIC: Record<MathOp, string> = {
  add: 'ADD',
  sub: 'SUB',
  mul: 'MUL',
  div: 'DIV',
};

/** Operator symbol, for writing a block's operands as the expression they are. */
export const MATH_SYMBOL: Record<MathOp, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
};

/**
 * Tuning for a `pid` block.
 *
 * Gains are integers in hundredths (`kp: 250` is a gain of 2.50) — the block
 * computes in a wider internal accumulator, so unlike a hand-built P controller
 * it can carry that precision without overflowing a 16-bit register. `ti`/`td`
 * of 0 disable their term, so the same block is a P, a PI or a full PID.
 */
export interface PidParams {
  kp: number; // proportional gain x100
  ti: number; // integral time in ms; 0 = no integral action
  td: number; // derivative time in ms; 0 = no derivative action
  sampleMs: number; // loop sample time; the block only computes this often
  outMin: number;
  outMax: number;
  /**
   * Flip the error sign. Default is `SV - PV`: the output rises as the
   * measurement falls below setpoint, which is what a filling or heating loop
   * needs. Set this for a loop that must open up as PV rises above SV (cooling,
   * pressure relief).
   */
  reverse?: boolean;
}

/** Element kinds that conduct power horizontally (edges in the rung graph). */
export const CONDUCTING_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'contact-no',
  'contact-nc',
  'contact-rising',
  'contact-falling',
  'compare',
  'hwire',
]);

/** Element kinds that are outputs/sinks (energize based on their left node). */
export const OUTPUT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'coil-out',
  'coil-set',
  'coil-reset',
  'timer',
  'counter',
  'mov',
  'math',
  'pid',
]);

/** Element kinds whose operands are words, not bits. */
export const WORD_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'compare',
  'mov',
  'math',
  'pid',
]);

export function isWordInstruction(type: ElementType): boolean {
  return WORD_TYPES.has(type);
}

export function isConducting(type: ElementType): boolean {
  return CONDUCTING_TYPES.has(type);
}

export function isOutput(type: ElementType): boolean {
  return OUTPUT_TYPES.has(type);
}

/**
 * Device kinds each element role may legally address.
 *
 * The validator holds a submitted program to this; the editor uses the same
 * table to aim a device chip at the field that can actually take the address, so
 * a click on `X0` can never land in a PID's output. `compare` and `hwire`
 * address nothing at all and so accept nothing.
 */
export function allowedDeviceKinds(type: ElementType): ReadonlySet<DeviceKind> {
  switch (type) {
    case 'coil-out':
    case 'coil-set':
      return new Set<DeviceKind>(['Y', 'M']);
    case 'coil-reset':
      return new Set<DeviceKind>(['Y', 'M', 'T', 'C', 'D']);
    case 'timer':
      return new Set<DeviceKind>(['T']);
    case 'counter':
      return new Set<DeviceKind>(['C']);
    case 'mov':
    case 'math':
    case 'pid':
      return new Set<DeviceKind>(['D']);
    case 'compare':
    case 'hwire':
      return new Set<DeviceKind>();
    default: // contacts
      return new Set<DeviceKind>(['X', 'Y', 'M', 'T', 'C']);
  }
}

/**
 * A single placed element.
 *
 * `device` is the address the element *acts on*: the bit a contact reads, the
 * coil/timer/counter it drives, or the destination register of a word
 * instruction. `compare` acts on nothing, so it leaves `device` empty and puts
 * both sides in `operands`.
 */
export interface LadderElement {
  type: ElementType;
  /** Device address. Empty string allowed only for `hwire` and `compare`. */
  device: string;
  /** Preset (K value) for timer/counter. Timer units are 100ms (K10 = 1.0s). */
  preset?: number;
  /**
   * Word operands, as source strings: a register (`"D10"`) or a constant
   * (`"K500"`, `"K-20"`). `compare`/`math` take two, `mov` one, `pid` two
   * (setpoint then process value).
   */
  operands?: string[];
  /** Which comparison / which arithmetic. Only on `compare` and `math`. */
  op?: CompareOp | MathOp;
  /** Loop tuning. Only on `pid`. */
  pid?: PidParams;
}

/** Register width. Stores saturate here rather than wrapping. */
export const INT16_MIN = -32768;
export const INT16_MAX = 32767;

/** Clamp a computed value into a 16-bit signed register. */
export function saturate16(value: number): number {
  const n = Math.trunc(value);
  if (n < INT16_MIN) return INT16_MIN;
  if (n > INT16_MAX) return INT16_MAX;
  return n;
}

/** A vertical link joining node(row, col) to node(row+1, col) at a node-column. */
export interface VLink {
  row: number; // upper row of the pair (0..rows-2)
  col: number; // node-column 0..cols
}

/** A rung: a grid of cells plus vertical links between rows. */
export interface Rung {
  id: string;
  rows: number; // parallel-branch rows (>= 1)
  cols: number; // series columns (>= 1)
  /** cells[row][col]; null = empty. Dimensions rows x cols. */
  cells: (LadderElement | null)[][];
  vlinks: VLink[];
  comment?: string;
}

export interface LadderProgram {
  rungs: Rung[];
}

/** Convenience: an empty rung of the given size. */
export function makeEmptyRung(id: string, rows = 3, cols = 8): Rung {
  const cells: (LadderElement | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
  return { id, rows, cols, cells, vlinks: [] };
}

export function emptyProgram(): LadderProgram {
  return { rungs: [makeEmptyRung('r1')] };
}
