import { parseAddress } from '../ladder/address.js';
import {
  COMPARE_OPS,
  isConducting,
  isOutput,
  isWordInstruction,
  MATH_OPS,
  type CompareOp,
  type ElementType,
  type LadderElement,
  type LadderProgram,
  type MathOp,
} from '../ladder/types.js';
import { isValueOperand } from '../ladder/value.js';
import type { LadderPuzzleSpec } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Non-blocking advice: the program still grades, but something looks wrong. */
  warnings: string[];
}

/** Device kinds each element role may legally reference. */
function allowedKinds(type: ElementType): ReadonlySet<string> {
  switch (type) {
    case 'coil-out':
    case 'coil-set':
      return new Set(['Y', 'M']);
    case 'coil-reset':
      return new Set(['Y', 'M', 'T', 'C', 'D']);
    case 'timer':
      return new Set(['T']);
    case 'counter':
      return new Set(['C']);
    case 'mov':
    case 'math':
    case 'pid':
      return new Set(['D']);
    default: // contacts
      return new Set(['X', 'Y', 'M', 'T', 'C']);
  }
}

/** How many word operands each instruction takes. */
const OPERAND_COUNT: Partial<Record<ElementType, number>> = {
  compare: 2,
  mov: 1,
  math: 2,
  pid: 2,
};

const OPERAND_ROLE: Partial<Record<ElementType, string[]>> = {
  compare: ['left', 'right'],
  mov: ['source'],
  math: ['first', 'second'],
  pid: ['setpoint', 'process value'],
};

/**
 * Word instructions carry their sources in `operands` rather than in `device`,
 * so they need a shape check the bit instructions never did: the right number of
 * operands, each one a register or a constant.
 */
function checkWordOperands(el: LadderElement, where: string, errors: string[]): void {
  const want = OPERAND_COUNT[el.type] ?? 0;
  const roles = OPERAND_ROLE[el.type] ?? [];
  const got = el.operands ?? [];
  for (let i = 0; i < want; i++) {
    const raw = got[i];
    if (raw === undefined || raw.trim() === '') {
      errors.push(`${where}: ${el.type} needs a ${roles[i] ?? `operand ${i + 1}`}`);
    } else if (!isValueOperand(raw)) {
      errors.push(`${where}: "${raw}" is not a register or a constant (expected D0-D9999 or K123)`);
    }
  }

  if (el.type === 'compare' && !COMPARE_OPS.includes(el.op as CompareOp)) {
    errors.push(`${where}: compare needs one of ${COMPARE_OPS.join(' ')}`);
  }
  if (el.type === 'math' && !MATH_OPS.includes(el.op as MathOp)) {
    errors.push(`${where}: math needs one of ${MATH_OPS.join(' ')}`);
  }
  if (el.type === 'pid') {
    const p = el.pid;
    if (!p) {
      errors.push(`${where}: PID block has no tuning`);
    } else {
      if (p.kp <= 0) errors.push(`${where}: PID needs a gain greater than 0`);
      if (p.sampleMs <= 0) errors.push(`${where}: PID needs a sample time greater than 0`);
      if (p.outMax <= p.outMin) errors.push(`${where}: PID output range is empty`);
      if (p.ti < 0 || p.td < 0) errors.push(`${where}: PID times cannot be negative`);
    }
  }
}

function checkElement(el: LadderElement, where: string, errors: string[]): void {
  if (el.type === 'hwire') return;

  if (isWordInstruction(el.type)) checkWordOperands(el, where, errors);
  // A compare acts on nothing — both sides are operands — so it is the one
  // element with no `device` to check.
  if (el.type === 'compare') return;

  const ref = parseAddress(el.device);
  if (!ref) {
    errors.push(`${where}: invalid device address "${el.device}"`);
    return;
  }
  const kinds = allowedKinds(el.type);
  if (!kinds.has(ref.kind)) {
    errors.push(`${where}: ${el.type} cannot reference ${ref.kind} device (${el.device})`);
  }
  if ((el.type === 'timer' || el.type === 'counter') && (!el.preset || el.preset <= 0)) {
    errors.push(`${where}: ${el.type} ${el.device} needs a preset greater than 0`);
  }
}

/**
 * Output roles where the last write of the scan wins, so driving one device
 * from two rungs silently discards the earlier one. SET/RST are deliberately
 * exempt: latching a bit in one rung and clearing it in another is the normal
 * idiom, not a mistake.
 *
 * MOV and the math blocks are exempt for the same reason: they only write when
 * their rung conducts, so two rungs moving different values into one register is
 * how you *select* a value (one accel figure loaded, another unloaded), not a
 * double-coil bug. A second PID driving the same output is, though.
 */
const LAST_WRITER_WINS = new Set<ElementType>(['coil-out', 'timer', 'counter', 'pid']);

/**
 * Classic "double coil" check. A device is counted once per rung however many
 * cells reference it, so this only reports the cross-rung case.
 */
function duplicateOutputWarnings(program: LadderProgram): string[] {
  const rungsByDevice = new Map<string, number[]>();
  program.rungs.forEach((rung, ri) => {
    const seen = new Set<string>();
    for (const row of rung.cells) {
      for (const el of row) {
        if (!el || !LAST_WRITER_WINS.has(el.type) || seen.has(el.device)) continue;
        seen.add(el.device);
        const rungs = rungsByDevice.get(el.device);
        if (rungs) rungs.push(ri + 1);
        else rungsByDevice.set(el.device, [ri + 1]);
      }
    }
  });

  const warnings: string[] = [];
  for (const [device, rungs] of rungsByDevice) {
    if (rungs.length < 2) continue;
    warnings.push(
      `${device} is driven from rungs ${rungs.join(', ')} — only the last one takes effect each ` +
        `scan. Merge them into one rung (parallel rows joined by vertical links), or use SET/RST.`,
    );
  }
  return warnings;
}

export function validateProgram(spec: LadderPuzzleSpec, program: LadderProgram): ValidationResult {
  const errors: string[] = [];
  const allowed = new Set<ElementType>(spec.allowedInstructions);
  allowed.add('hwire'); // wires are always permitted

  if (spec.maxRungs != null && program.rungs.length > spec.maxRungs) {
    errors.push(`Program uses ${program.rungs.length} rungs but the limit is ${spec.maxRungs}`);
  }

  program.rungs.forEach((rung, ri) => {
    let hasOutput = false;
    rung.cells.forEach((row, r) => {
      row.forEach((el, c) => {
        if (!el) return;
        const where = `rung ${ri + 1} @ r${r}c${c}`;
        if (!isConducting(el.type) && !isOutput(el.type)) {
          errors.push(`${where}: unknown element type`);
          return;
        }
        if (!allowed.has(el.type)) {
          errors.push(`${where}: instruction ${el.type} is not allowed in this puzzle`);
        }
        if (isOutput(el.type)) hasOutput = true;
        checkElement(el, where, errors);
      });
    });
    if (!hasOutput) errors.push(`rung ${ri + 1} has no output/coil`);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings: duplicateOutputWarnings(program),
  };
}
