import { INDEX_REGISTER_COUNT } from './address.js';
import { INT16_MAX, INT16_MIN } from './types.js';

/**
 * A word operand: a data register, an index register, a data register offset
 * by an index register, or a literal constant.
 *
 * Written the Mitsubishi way — `D10` for a register, `K500` for a constant —
 * because the `K` prefix is already how presets read on timers and counters, so
 * `K` keeps meaning "a number I typed" everywhere in the editor.
 *
 * `Z0`..`Z7` and `D100Z0` exist only in puzzles that offer index registers; the
 * validator holds everything else to plain `D` and `K`, which is why the
 * original two variants are exactly as they were.
 */
export type ValueRef =
  | { kind: 'D'; address: string }
  | { kind: 'Z'; address: string }
  | { kind: 'DZ'; base: number; index: string }
  | { kind: 'K'; value: number };

/** Highest data register the platform has. An indexed address past it is an operation error. */
export const D_MAX = 9999;

const REGISTER_RE = /^D(\d{1,4})$/;
const INDEX_RE = /^Z(\d)$/;
const INDEXED_RE = /^D(\d{1,4})Z(\d)$/;
const CONSTANT_RE = /^K?(-?\d{1,5})$/;

function parseIndex(digit: string): string | null {
  const n = Number.parseInt(digit, 10);
  return n < INDEX_REGISTER_COUNT ? `Z${n}` : null;
}

/**
 * Parse a place a value can be read from or written to: `D10`, `Z0` or
 * `D100Z0`. Everything `parseValueOperand` accepts except a constant, which is
 * what a destination or a queue head has to be.
 */
export function parseWordTarget(operand: string): Exclude<ValueRef, { kind: 'K' }> | null {
  const s = operand.trim().toUpperCase();

  const reg = REGISTER_RE.exec(s);
  if (reg) return { kind: 'D', address: `D${Number.parseInt(reg[1], 10)}` };

  const z = INDEX_RE.exec(s);
  if (z) {
    const index = parseIndex(z[1]);
    return index === null ? null : { kind: 'Z', address: index };
  }

  const dz = INDEXED_RE.exec(s);
  if (dz) {
    const index = parseIndex(dz[2]);
    return index === null ? null : { kind: 'DZ', base: Number.parseInt(dz[1], 10), index };
  }
  return null;
}

/** Parse `"D10"` / `"Z0"` / `"D100Z0"` / `"K500"` / `"-20"`. Returns null if it is none. */
export function parseValueOperand(operand: string): ValueRef | null {
  const s = operand.trim().toUpperCase();
  if (s === '') return null;

  const target = parseWordTarget(s);
  if (target) return target;

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

/** True when the operand needs index registers: a bare `Z` or an indexed `D`. */
export function usesIndexRegister(ref: ValueRef): boolean {
  return ref.kind === 'Z' || ref.kind === 'DZ';
}

/** Normalized display form: registers as-is, constants always `K`-prefixed. */
export function formatValueOperand(ref: ValueRef): string {
  switch (ref.kind) {
    case 'D':
    case 'Z':
      return ref.address;
    case 'DZ':
      return `D${ref.base}${ref.index}`;
    case 'K':
      return `K${ref.value}`;
  }
}

/**
 * The register an operand names *right now*. An indexed operand resolves
 * against the current value of its index register, and resolves to `null` when
 * that lands outside `D0`..`D9999` — which the engine treats as an operation
 * error rather than guessing. A constant names no register at all.
 */
export function effectiveAddress(
  ref: ValueRef,
  registers: ReadonlyMap<string, number>,
): string | null {
  switch (ref.kind) {
    case 'D':
    case 'Z':
      return ref.address;
    case 'DZ': {
      const n = ref.base + (registers.get(ref.index) ?? 0);
      return n >= 0 && n <= D_MAX ? `D${n}` : null;
    }
    case 'K':
      return null;
  }
}

/**
 * The register an operand names with every index register at zero: the base of
 * an indexed operand, the register itself otherwise. What static checks
 * (ownership, overlap) can know without running the program.
 */
export function staticBase(operand: string): string | null {
  const ref = parseWordTarget(operand);
  if (!ref) return null;
  return ref.kind === 'DZ' ? `D${ref.base}` : ref.address;
}

/** Resolve an operand against a register file. Unknown registers read as 0. */
export function readValue(ref: ValueRef, registers: ReadonlyMap<string, number>): number {
  if (ref.kind === 'K') return ref.value;
  const address = effectiveAddress(ref, registers);
  return address === null ? 0 : (registers.get(address) ?? 0);
}
