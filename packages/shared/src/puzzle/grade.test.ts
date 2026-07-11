import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung, VLink } from '../ladder/types.js';
import { getPuzzle } from './content/index.js';
import { gradeProgram } from './grade.js';
import { validateProgram } from './validate.js';

// --- tiny ladder builders -------------------------------------------------
const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });
const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });

function R(
  id: string,
  rows: number,
  cols: number,
  map: Record<string, LadderElement>,
  vlinks: VLink[] = [],
): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => map[`${r},${c}`] ?? null),
  );
  return { id, rows, cols, cells, vlinks };
}

// --- canonical solutions --------------------------------------------------
const solutions: Record<string, LadderProgram> = {
  'direct-control': {
    rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })],
  },
  'seal-in': {
    rungs: [
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('Y0'), '0,1': nc('X1'), '0,2': out('Y0') },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  estop: {
    rungs: [
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X0'),
          '1,0': no('Y0'),
          '0,1': no('X2'),
          '0,2': nc('X1'),
          '0,3': out('Y0'),
        },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  'delayed-start': {
    rungs: [
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('M0'), '0,1': nc('X1'), '0,2': out('M0') },
        [{ row: 0, col: 1 }],
      ),
      R('r2', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }),
      R('r3', 1, 2, { '0,0': no('M0'), '0,1': timer('T0', 20) }),
      R('r4', 1, 2, { '0,0': no('T0'), '0,1': out('Y0') }),
    ],
  },
  'batch-counter': {
    rungs: [
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': counter('C0', 5) }),
      R('r2', 1, 2, { '0,0': no('C0'), '0,1': out('Y0') }),
      R('r3', 1, 2, { '0,0': no('X1'), '0,1': rst('C0') }),
    ],
  },
  'conveyor-stop': {
    rungs: [
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X0'),
          '1,0': no('Y0'),
          '0,1': nc('X1'),
          '0,2': nc('X2'),
          '0,3': out('Y0'),
        },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
};

describe('gradeProgram — canonical solutions solve every puzzle', () => {
  for (const [slug, program] of Object.entries(solutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getPuzzle(slug);
      expect(spec, `puzzle ${slug} exists`).toBeDefined();
      const validation = validateProgram(spec!, program);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      const result = gradeProgram(spec!, program);
      const failed = result.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
      expect(failed, failed.join(' | ')).toEqual([]);
      expect(result.solved).toBe(true);
      expect(result.score).toBe(100);
    });
  }
});

describe('gradeProgram — wrong programs do not solve', () => {
  it('a direct wire without seal-in fails the seal-in puzzle', () => {
    const spec = getPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const result = gradeProgram(spec, bad);
    expect(result.solved).toBe(false);
    expect(result.score).toBeLessThan(100);
  });

  it('an empty program never solves', () => {
    const spec = getPuzzle('direct-control')!;
    const empty: LadderProgram = { rungs: [R('r1', 1, 2, {})] };
    expect(gradeProgram(spec, empty).solved).toBe(false);
  });
});

describe('validateProgram', () => {
  it('flags disallowed instructions', () => {
    const spec = getPuzzle('direct-control')!; // timer not allowed here
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': timer('T0', 10) })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('not allowed'))).toBe(true);
  });

  it('flags a coil driving an input device kind', () => {
    const spec = getPuzzle('direct-control')!;
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('X5') })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
  });
});
