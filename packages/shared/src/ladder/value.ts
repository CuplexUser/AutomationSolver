import { INT16_MAX, INT16_MIN } from './types.js';

/**
 * A word operand: either a data register to read, or a literal constant.
 *
 * Written the Mitsubishi way — `D10` for a register, `K500` for a constant —
 * because the `K` prefix is already how presets read on timers and counters, so
 * `K` keeps meaning "a number I typed" everywhere in the editor.
 */
export type ValueRef = { kind: 'D'; address: string } | { kind: 'K'; value: number };

const REGISTER_RE = /^D(\d{1,4})$/;
const CONSTANT_RE = /^K?(-?\d{1,5})$/;

/** Parse `"D10"` / `"K500"` / `"-20"`. Returns null if it is neither. */
export function parseValueOperand(operand: string): ValueRef | null {
  const s = operand.trim().toUpperCase();
  if (s === '') return null;

  const reg = REGISTER_RE.exec(s);
  if (reg) return { kind: 'D', address: `D${Number.parseInt(reg[1], 10)}` };

  const con = CONSTANT_RE.exec(s);
  if (con) {
    const value = Number.parseInt(con[1], 10);
    if (Number.isNaN(value) || value < INT16_MIN || value > INT16_MAX) return null;
    return { kind: 'K', value };
  }
  return null;
}

export function isValueOperand(operand: string): boolean {
  return parseValueOperand(operand) !== null;
}

/** Normalized display form: registers as-is, constants always `K`-prefixed. */
export function formatValueOperand(ref: ValueRef): string {
  return ref.kind === 'D' ? ref.address : `K${ref.value}`;
}

/** Resolve an operand against a register file. Unknown registers read as 0. */
export function readValue(ref: ValueRef, registers: ReadonlyMap<string, number>): number {
  return ref.kind === 'K' ? ref.value : (registers.get(ref.address) ?? 0);
}
