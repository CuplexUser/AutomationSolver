import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProject, Rung } from '../ladder/types.js';
import {
  assembleProject,
  inDeviceRanges,
  initialProject,
  parseDeviceRange,
  parseDeviceRanges,
} from './project.js';
import type { LadderPuzzleSpec } from './types.js';
import { validateProgram } from './validate.js';

const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });

/** A one-row rung of the given elements, left to right. */
function line(id: string, ...els: (LadderElement | null)[]): Rung {
  return { id, rows: 1, cols: els.length, cells: [els], vlinks: [] };
}

/** Two sections: SEC1 the player's, SEC2 shipped working. */
function twoSectionSpec(overrides: Partial<LadderPuzzleSpec> = {}): LadderPuzzleSpec {
  return {
    kind: 'ladder',
    slug: 'test-sections',
    title: 'Test',
    difficulty: 'easy',
    order: 0,
    category: 'basics',
    summary: '',
    briefing: '',
    devices: [],
    scenarios: [],
    allowedInstructions: ['contact-no', 'coil-out'],
    processId: 'passthrough',
    pous: [
      { id: 's1', name: 'SEC1', title: 'Section 1', editable: true, owns: ['Y0-Y3', 'M100-M119'] },
      {
        id: 's2',
        name: 'SEC2',
        title: 'Section 2',
        editable: false,
        program: [line('r1', no('M100'), out('Y4'))],
      },
    ],
    tasks: [{ id: 'main', name: 'MAIN', priority: 0, pous: ['s1', 's2'] }],
    ...overrides,
  };
}

describe('assembleProject', () => {
  it('takes editable sections from the submission and fixtures from the spec', () => {
    const spec = twoSectionSpec();
    const submitted: LadderProject = {
      pous: [{ id: 's1', name: 'SEC1', rungs: [line('r1', no('X0'), out('Y0'))] }],
      tasks: [],
    };
    const project = assembleProject(spec, submitted);

    expect(project.pous.map((p) => p.id)).toEqual(['s1', 's2']);
    expect(project.pous[0].rungs).toEqual(submitted.pous[0].rungs);
    expect(project.pous[1].rungs).toEqual(spec.pous![1].program);
  });

  it('ignores a submission trying to rewrite a section it does not own', () => {
    // Otherwise a hand-written payload could replace the fixtures it is being
    // graded against, which is the whole point of grading on the server.
    const spec = twoSectionSpec();
    const submitted: LadderProject = {
      pous: [
        { id: 's1', name: 'SEC1', rungs: [line('r1', no('X0'), out('Y0'))] },
        { id: 's2', name: 'SEC2', rungs: [line('hack', no('X9'), out('Y4'))] },
      ],
      tasks: [],
    };
    expect(assembleProject(spec, submitted).pous[1].rungs).toEqual(spec.pous![1].program);
  });

  it('takes tasks from the spec unless the puzzle hands over the schedule', () => {
    const playerTasks = [{ id: 'main', name: 'MAIN', priority: 0, pous: ['s2', 's1'] }];
    const submitted: LadderProject = { pous: [], tasks: playerTasks };

    expect(assembleProject(twoSectionSpec(), submitted).tasks[0].pous).toEqual(['s1', 's2']);
    expect(
      assembleProject(twoSectionSpec({ taskAssignment: 'player' }), submitted).tasks[0].pous,
    ).toEqual(['s2', 's1']);
  });

  it('wraps a flat program for a single-POU puzzle', () => {
    const spec = twoSectionSpec({ pous: undefined, tasks: undefined });
    const rungs = [line('r1', no('X0'), out('Y0'))];
    expect(assembleProject(spec, { rungs }).pous[0].rungs).toBe(rungs);
  });
});

describe('initialProject', () => {
  it('opens editable sections empty and fills in the provided ones', () => {
    const project = initialProject(twoSectionSpec());
    expect(project.pous[0].rungs).toHaveLength(1);
    expect(project.pous[0].rungs[0].cells.flat().every((c) => c === null)).toBe(true);
    expect(project.pous[1].rungs).toEqual(twoSectionSpec().pous![1].program);
  });
});

describe('device ranges', () => {
  it('parses the three spellings', () => {
    expect(parseDeviceRange('M120-M139')).toEqual({ kind: 'M', from: 120, to: 139 });
    expect(parseDeviceRange('M120-139')).toEqual({ kind: 'M', from: 120, to: 139 });
    expect(parseDeviceRange('M16')).toEqual({ kind: 'M', from: 16, to: 16 });
  });

  it('rejects a malformed or backwards range rather than throwing', () => {
    expect(parseDeviceRange('M139-M120')).toBeNull();
    expect(parseDeviceRange('nonsense')).toBeNull();
    expect(parseDeviceRanges(['M0-M9', 'rubbish'])).toHaveLength(1);
  });

  it('tests membership by family and index', () => {
    const ranges = parseDeviceRanges(['M100-M119', 'Y0-Y3']);
    expect(inDeviceRanges('M100', ranges)).toBe(true);
    expect(inDeviceRanges('M119', ranges)).toBe(true);
    expect(inDeviceRanges('M120', ranges)).toBe(false);
    expect(inDeviceRanges('D100', ranges)).toBe(false); // same index, wrong family
    expect(inDeviceRanges('Y2', ranges)).toBe(true);
  });
});

describe('validateProgram — sectioned programs', () => {
  const submit = (spec: LadderPuzzleSpec, rungs: Rung[]) =>
    validateProgram(spec, { pous: [{ id: 's1', name: 'SEC1', rungs }], tasks: [] });

  it('accepts a section writing only what it owns', () => {
    const result = submit(twoSectionSpec(), [line('r1', no('X0'), out('Y0'))]);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('refuses a section writing another section’s device', () => {
    const result = submit(twoSectionSpec(), [line('r1', no('X0'), out('Y4'))]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('SEC1 may not write Y4');
    expect(result.errors[0]).toContain('Y0-Y3, M100-M119');
  });

  it('lets a section read anything it likes', () => {
    // Reading a neighbour's handshake is the interface; only writing is fenced.
    const result = submit(twoSectionSpec(), [line('r1', no('Y4'), out('M100'))]);
    expect(result.errors).toEqual([]);
  });

  it('names the section in rung-level errors', () => {
    const result = submit(twoSectionSpec(), [line('r1', no('X0'))]); // no output
    expect(result.errors).toContain('SEC1 rung 1 has no output/coil');
  });

  it('warns when two sections drive the same coil', () => {
    const result = submit(twoSectionSpec(), [line('r1', no('X0'), out('Y4'))]);
    expect(result.warnings.some((w) => w.includes('SEC1 rung 1, SEC2 rung 1'))).toBe(true);
  });
});

describe('validateProgram — task set', () => {
  const withTasks = (tasks: LadderPuzzleSpec['tasks']) =>
    validateProgram(twoSectionSpec({ tasks }), {
      pous: [{ id: 's1', name: 'SEC1', rungs: [line('r1', no('X0'), out('Y0'))] }],
      tasks: [],
    });

  it('refuses an interval that does not land on the scan grid', () => {
    const result = withTasks([{ id: 'main', name: 'MAIN', intervalMs: 75, priority: 0, pous: ['s1', 's2'] }]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('does not land on the 50 ms scan');
  });

  it('accepts a whole multiple of the scan', () => {
    const result = withTasks([{ id: 'main', name: 'MAIN', intervalMs: 200, priority: 0, pous: ['s1', 's2'] }]);
    expect(result.errors).toEqual([]);
  });

  it('refuses a task calling a program that does not exist', () => {
    const result = withTasks([{ id: 'main', name: 'MAIN', priority: 0, pous: ['s1', 's2', 'ghost'] }]);
    expect(result.errors.some((e) => e.includes('calls ghost'))).toBe(true);
  });

  it('refuses one program called from two tasks', () => {
    const result = withTasks([
      { id: 'a', name: 'MAIN', priority: 0, pous: ['s1', 's2'] },
      { id: 'b', name: 'SLOW', intervalMs: 200, priority: 1, pous: ['s1'] },
    ]);
    expect(result.errors.some((e) => e.includes('SEC1 is called from MAIN and SLOW'))).toBe(true);
  });

  it('warns about a program no task ever calls', () => {
    const result = withTasks([{ id: 'main', name: 'MAIN', priority: 0, pous: ['s1'] }]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('SEC2 is not called from any task'))).toBe(true);
  });
});
