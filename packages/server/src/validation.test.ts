import { describe, expect, it } from 'vitest';
import { isMultiPou, PUZZLES } from '../../shared/src/index.js';
import { canonicalSolution } from '../../shared/src/puzzle/solutions.js';
import { programSchema, projectSchema } from './validation.js';

// Grading never passes through the transport schema, so a canonical answer (or a read-only
// section it carries) can grade perfectly and still be refused the moment it is saved to a slot.
describe('canonical solutions fit the save schema', () => {
  for (const spec of PUZZLES) {
    if (spec.kind !== 'ladder') continue;
    it(spec.slug, () => {
      const solution = canonicalSolution(spec);
      if (!solution) return;
      const schema = isMultiPou(spec) ? projectSchema : programSchema;
      const parsed = schema.safeParse(solution);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    });
  }
});
