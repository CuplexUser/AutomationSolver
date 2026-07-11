/**
 * Ladder-logic domain model (Mitsubishi FX-series flavor, simplified but authentic).
 *
 * A program is an ordered list of rungs. Each rung is a grid of cells. Cells hold
 * elements (contacts/coils/function-blocks). Horizontal neighbours are in series;
 * vertical links join rows to form parallel branches.
 */

/** Device families addressable in a program. */
export type DeviceKind = 'X' | 'Y' | 'M' | 'T' | 'C';

/** All element kinds a cell can hold. */
export type ElementType =
  | 'contact-no' // normally open   --| |--
  | 'contact-nc' // normally closed --|/|--
  | 'contact-rising' // rising edge     --|P|--
  | 'contact-falling' // falling edge    --|N|--
  | 'hwire' // horizontal wire (always conducts)
  | 'coil-out' // output coil     --( )--
  | 'coil-set' // set (latch)     --(S)--
  | 'coil-reset' // reset (unlatch)  --(R)--
  | 'timer' // on-delay timer  --(T Kn)--
  | 'counter'; // counter         --(C Kn)--

/** Element kinds that conduct power horizontally (edges in the rung graph). */
export const CONDUCTING_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'contact-no',
  'contact-nc',
  'contact-rising',
  'contact-falling',
  'hwire',
]);

/** Element kinds that are outputs/sinks (energize based on their left node). */
export const OUTPUT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'coil-out',
  'coil-set',
  'coil-reset',
  'timer',
  'counter',
]);

export function isConducting(type: ElementType): boolean {
  return CONDUCTING_TYPES.has(type);
}

export function isOutput(type: ElementType): boolean {
  return OUTPUT_TYPES.has(type);
}

/** A single placed element. `device` is an address like "X0", "Y1", "T0". */
export interface LadderElement {
  type: ElementType;
  /** Device address. Empty string allowed only for `hwire`. */
  device: string;
  /** Preset (K value) for timer/counter. Timer units are 100ms (K10 = 1.0s). */
  preset?: number;
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
