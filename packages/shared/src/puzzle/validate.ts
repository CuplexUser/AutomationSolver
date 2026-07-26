import { parseAddress } from '../ladder/address.js';
import {
  isConducting,
  isOutput,
  type ElementType,
  type LadderElement,
  type LadderProgram,
} from '../ladder/types.js';
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
      return new Set(['Y', 'M', 'T', 'C']);
    case 'timer':
      return new Set(['T']);
    case 'counter':
      return new Set(['C']);
    default: // contacts
      return new Set(['X', 'Y', 'M', 'T', 'C']);
  }
}

function checkElement(el: LadderElement, where: string, errors: string[]): void {
  if (el.type === 'hwire') return;
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
 */
const LAST_WRITER_WINS = new Set<ElementType>(['coil-out', 'timer', 'counter']);

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
