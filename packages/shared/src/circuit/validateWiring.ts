import type { ValidationResult } from '../puzzle/validate.js';
import type { CabinetPuzzleSpec } from '../puzzle/types.js';
import { layoutTerminals, type WiringDoc } from './types.js';

/**
 * Structural validation of a wiring document — the cabinet counterpart of
 * validateProgram. Deliberately does NOT check electrical behavior (shorts,
 * dead circuits): that is grading's job, so an unusual-but-correct topology is
 * never rejected here.
 */
export function validateWiring(spec: CabinetPuzzleSpec, wiring: WiringDoc): ValidationResult {
  const errors: string[] = [];
  const known = new Set(layoutTerminals(spec.cabinet));

  if (spec.maxWires != null && wiring.wires.length > spec.maxWires) {
    errors.push(`Too many wires: ${wiring.wires.length} used, max ${spec.maxWires}`);
  }

  const seenPairs = new Set<string>();
  const seenIds = new Set<string>();
  for (const w of wiring.wires) {
    if (seenIds.has(w.id)) errors.push(`Duplicate wire id "${w.id}"`);
    seenIds.add(w.id);
    for (const t of [w.from, w.to]) {
      if (!known.has(t)) errors.push(`Wire ${w.id}: unknown terminal "${t}"`);
    }
    if (w.from === w.to) {
      errors.push(`Wire ${w.id}: connects terminal "${w.from}" to itself`);
      continue;
    }
    const pair = [w.from, w.to].sort().join('~');
    if (seenPairs.has(pair)) errors.push(`Duplicate wire between "${w.from}" and "${w.to}"`);
    seenPairs.add(pair);
  }

  return { valid: errors.length === 0, errors };
}
