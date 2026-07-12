import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung, VLink } from '../ladder/types.js';
import { getPuzzle } from './content/index.js';
import { gradeProgram, traceScenario } from './grade.js';
import { validateProgram } from './validate.js';

// --- tiny ladder builders -------------------------------------------------
const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });
const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });

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
  'drill-station': {
    rungs: [
      // Run latch: (X0 OR M0) AND X1(healthy) AND NOT X3(bottom) -> M0
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X0'),
          '1,0': no('M0'),
          '0,1': no('X1'),
          '0,2': nc('X3'),
          '0,3': out('M0'),
        },
        [{ row: 0, col: 1 }],
      ),
      R('r2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }), // clamp whole cycle
      R('r3', 1, 3, { '0,0': no('M0'), '0,1': no('X2'), '0,2': out('Y1') }), // drill once clamped
      R('r4', 1, 2, { '0,0': no('Y1'), '0,1': out('Y2') }), // beacon while drilling
      R('r5', 1, 2, { '0,0': no('X3'), '0,1': set('Y3') }), // latch done at bottom
      R('r6', 1, 2, { '0,0': no('X0'), '0,1': rst('Y3') }), // clear on next start
      // Triggering off X3 (momentary) rather than Y3 (latched) avoids a SET/RESET
      // fight: Y3 stays true until the next start, so it would keep re-SETting Y4
      // every scan even while r8 is trying to RESET it once X4 senses ejected.
      R('r7', 1, 2, { '0,0': no('X3'), '0,1': set('Y4') }), // start ejecting once bottomed out
      R('r8', 1, 2, { '0,0': no('X4'), '0,1': rst('Y4') }), // stop once clear of the platform
    ],
  },
  'elevator-auto-return': {
    rungs: [
      R('r1', 1, 3, { '0,0': no('X0'), '0,1': nc('X5'), '0,2': out('Y0') }), // up while commanded, stop at top
      R('r2', 1, 3, { '0,0': nc('X3'), '0,1': nc('X0'), '0,2': timer('T0', 100) }), // idle timer
      // Descent latch: (T0 OR M0) AND NOT X3 AND NOT X0 -> M0
      R(
        'r3',
        2,
        4,
        {
          '0,0': no('T0'),
          '1,0': no('M0'),
          '0,1': nc('X3'),
          '0,2': nc('X0'),
          '0,3': out('M0'),
        },
        [{ row: 0, col: 1 }],
      ),
      R('r4', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }), // drive down
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

describe('traceScenario', () => {
  it('matches gradeProgram pass/fail and samples every scan for a solved puzzle', () => {
    const spec = getPuzzle('seal-in')!;
    const program = solutions['seal-in'];
    const grade = gradeProgram(spec, program);
    for (const scenario of spec.scenarios) {
      const trace = traceScenario(spec, program, scenario.name)!;
      expect(trace).toBeDefined();
      const expectedSamples = scenario.steps.reduce(
        (n, s) => n + Math.max(1, Math.ceil(s.holdMs / trace.dt)),
        0,
      );
      expect(trace.samples.length).toBe(expectedSamples);
      expect(trace.samples.at(-1)!.tMs).toBe(expectedSamples * trace.dt);

      const scenarioResult = grade.scenarios.find((s) => s.name === scenario.name)!;
      expect(trace.steps.map((s) => s.passed)).toEqual(scenarioResult.steps.map((s) => s.passed));
      expect(trace.steps.every((s) => s.passed)).toBe(scenarioResult.passed);

      // startSample indexes line up with cumulative iteration counts.
      let cursor = 0;
      trace.steps.forEach((s, i) => {
        expect(s.startSample).toBe(cursor);
        cursor += Math.max(1, Math.ceil(scenario.steps[i].holdMs / trace.dt));
      });
    }
  });

  it('marks the failing step for a wrong program', () => {
    const spec = getPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const scenario = spec.scenarios[0];
    const trace = traceScenario(spec, bad, scenario.name)!;
    expect(trace.steps.some((s) => !s.passed)).toBe(true);
  });

  it('returns undefined for an unknown scenario name', () => {
    const spec = getPuzzle('direct-control')!;
    expect(traceScenario(spec, solutions['direct-control'], 'nope')).toBeUndefined();
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
