import { describe, expect, it } from 'vitest';
import type {
  LadderProgram,
  LadderProject,
  Rung,
} from '../ladder/types.js';
import { getPuzzle, PUZZLES } from './content/index.js';
import {
  ASSEMBLY_TUNED,
  PAINT_TUNED,
  STORE_PLAIN,
  STORE_TUNED,
  TEST_TUNED,
  WELD_TUNED,
} from './content/factory-line-programs.js';
import {
  CORRECTNESS_WEIGHT,
  PAR_SLACK,
  gradeProgram,
  throughputScore,
  traceScenario,
} from './grade.js';
import { validateProgram } from './validate.js';
import {
  fleetProgram,
  HUB_FLEET_PROGRAM,
  RIPEN_PROGRAM,
  SHIP_PROGRAM,
} from './content/dc-sections.js';
import type { LadderPuzzleSpec } from './types.js';
import {
  canonicalSolution,
  cmp,
  counter,
  dispatchCore,
  doorRungs,
  drillAutoCycle,
  drillClampFeedCore,
  drillFullStroke,
  lineSolution,
  math,
  mov,
  nc,
  no,
  out,
  packFlip,
  packFrontEnd,
  packShip,
  pid,
  projectSolutions,
  R,
  rise,
  rst,
  set,
  solutions,
  timer,
  wire,
} from './solutions.js';

/** Every puzzle in this file is a ladder puzzle; fail loudly if that changes. */
function getLadderPuzzle(slug: string): LadderPuzzleSpec | undefined {
  const spec = getPuzzle(slug);
  if (!spec) return undefined;
  if (spec.kind !== 'ladder') throw new Error(`puzzle ${slug} is not a ladder puzzle`);
  return spec;
}

describe('gradeProgram — canonical solutions solve every sectioned puzzle', () => {
  for (const [slug, project] of Object.entries(projectSolutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getLadderPuzzle(slug);
      expect(spec, `puzzle ${slug} exists`).toBeDefined();
      const validation = validateProgram(spec!, project);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([]);
      const result = gradeProgram(spec!, project);
      const failed = result.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
      expect(failed, failed.join(' | ')).toEqual([]);
      expect(result.solved).toBe(true);
      expect(result.score).toBe(100);
    }, 60_000);
  }
});

describe('gradeProgram — canonical solutions solve every puzzle', () => {
  for (const [slug, program] of Object.entries(solutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getLadderPuzzle(slug);
      expect(spec, `puzzle ${slug} exists`).toBeDefined();
      const validation = validateProgram(spec!, program);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      // A shipped solution must never trip an advisory either — otherwise the
      // warning is noise and players learn to ignore it.
      expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([]);
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

// A shipped demo is a program the player watches rather than one they write, so
// nothing else would ever notice it rotting. Hold it to the same bar as a
// canonical solution: it has to validate, and it has to drive the machine
// through the scenario it claims to demonstrate.
// Developer mode loads these into a slot, so the editor-shaped answer has to
// solve too: a sectioned one arrives with the fixtures merged in, and a
// single-list one untouched.
describe('canonicalSolution hands the editor an answer that still solves', () => {
  for (const slug of ['dc-dispatch', 'factory-supervisor']) {
    it(`"${slug}"`, () => {
      const spec = getLadderPuzzle(slug)!;
      const program = canonicalSolution(spec);
      expect(program).toBeDefined();
      expect(gradeProgram(spec, program!).solved).toBe(true);
    }, 60_000);
  }

  it('is undefined for a puzzle with no recorded answer', () => {
    const spec = getLadderPuzzle('dc-dispatch')!;
    expect(canonicalSolution({ ...spec, slug: 'no-such-puzzle' })).toBeUndefined();
  });
});

describe('puzzle demos run the machine they promise', () => {
  const demos = PUZZLES.filter(
    (p): p is LadderPuzzleSpec => p.kind === 'ladder' && p.demo !== undefined,
  );

  it('there is at least one, so this suite cannot pass by finding none', () => {
    expect(demos.length).toBeGreaterThan(0);
  });

  for (const spec of demos) {
    it(`"${spec.slug}" demonstrates "${spec.demo!.scenario}"`, () => {
      const { program, scenario } = spec.demo!;
      expect(
        spec.scenarios.map((s) => s.name),
        'the demo names a scenario this puzzle actually has',
      ).toContain(scenario);
      const validation = validateProgram(spec, program);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      const trace = traceScenario(spec, program, scenario);
      expect(trace).toBeDefined();
      const failed = trace!.steps.filter((s) => !s.passed).map((s) => s.failures.join('; '));
      expect(failed, failed.join(' | ')).toEqual([]);
    });
  }
});

/**
 * Correct but slower than par: every scenario passes, so the program is solved
 * and banks the whole correctness weight, but it gives up part of the
 * throughput weight and so falls short of 100.
 */
function expectSolvedButNotOptimal(spec: LadderPuzzleSpec, program: LadderProgram): void {
  const result = gradeProgram(spec, program);
  const failed = result.scenarios
    .filter((s) => !s.passed)
    .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
  expect(failed, failed.join(' | ')).toEqual([]);
  expect(result.solved).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(CORRECTNESS_WEIGHT);
  expect(result.score).toBeLessThan(100);
  expect(result.efficiency).toBeLessThan(1);
}

// A sequential machine is paced by the program driving it, so two equally
// correct solutions can reach the same milestone hundreds of ms apart. These
// are real player solutions that used to score 33% / 50% against scenarios
// whose deadlines were tuned to the canonical program's exact cycle time; they
// are the guardrail against grading pace instead of behaviour. Pace still
// costs marks — it just no longer costs the pass.
describe('gradeProgram — differently paced but correct solutions still solve', () => {
  it('drill-spindle: starting the spindle once CLAMPED is in, not with the clamp', () => {
    // Y5 waits for X2, which pushes spin-up, the feed, the dwell and the eject
    // ~400ms later than the canonical program. The feed is retracted by M0
    // dropping rather than by nc(T0), one scan later again.
    const spec = getLadderPuzzle('drill-spindle')!;
    const rungs = [
      R('a1', 1, 5, {
        '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X5'), '0,3': nc('M1'), '0,4': out('M0'),
      }),
      R('a2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }),
      R('a3', 1, 3, { '0,0': no('M0'), '0,1': no('X2'), '0,2': out('Y5') }),
      R('a4', 1, 2, { '0,0': no('Y5'), '0,1': out('Y2') }),
      R('a5', 1, 4, { '0,0': no('M0'), '0,1': no('X2'), '0,2': no('X7'), '0,3': out('Y1') }),
      R('a6', 1, 3, { '0,0': no('X3'), '0,1': no('X7'), '0,2': timer('T0', 10) }),
      R('a7', 1, 3, { '0,0': no('M0'), '0,1': no('T0'), '0,2': set('M1') }),
      R('a8', 1, 2, { '0,0': no('M1'), '0,1': out('Y3') }),
      R('a9', 1, 2, { '0,0': no('M1'), '0,1': out('Y4') }),
      R('a10', 1, 2, { '0,0': no('X4'), '0,1': rst('M1') }),
    ];
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expectSolvedButNotOptimal(spec, { rungs });
  });

  it('pack-full: a front end that pauses instead of filling through the flip', () => {
    // Gating the 2-pack pusher on nc(M0) stops section 2 filling while the lift
    // is away, so the line runs un-pipelined: every flip lands ~900ms later
    // than the canonical program's, compounding over the four flips of a pack.
    const spec = getLadderPuzzle('pack-full')!;
    const rungs = [
      R(
        'b1',
        2,
        6,
        {
          '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X0'), '0,3': no('X2'),
          '0,4': nc('M0'), '0,5': out('Y0'),
          '1,0': no('Y0'), '1,1': nc('X1'), '1,2': wire, '1,3': wire,
        },
        [{ row: 0, col: 4 }],
      ),
      R('b2', 1, 2, { '0,0': no('X1'), '0,1': counter('C0', 2) }),
      R(
        'b3',
        2,
        4,
        {
          '0,0': no('X2'), '0,1': no('X4'), '0,2': no('C0'), '0,3': out('Y1'),
          '1,0': no('Y1'), '1,1': nc('X3'), '1,2': wire,
        },
        [{ row: 0, col: 3 }],
      ),
      R('b4', 1, 2, { '0,0': no('X3'), '0,1': rst('C0') }),
      R('b5', 1, 3, { '0,0': no('X3'), '0,1': no('X4'), '0,2': set('M0') }),
      R('b6', 1, 2, { '0,0': no('X5'), '0,1': rst('M0') }),
      R('b7', 1, 2, { '0,0': no('X5'), '0,1': counter('C1', 4) }),
      R('b8', 1, 5, {
        '0,0': no('M0'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': nc('M3'), '0,4': out('Y2'),
      }),
      R('b9', 1, 4, { '0,0': nc('M1'), '0,1': nc('M2'), '0,2': nc('M3'), '0,3': out('Y5') }),
      R(
        'b10',
        2,
        3,
        { '0,0': rise('X4'), '0,1': no('C1'), '0,2': set('M1'), '1,2': rst('C1') },
        [{ row: 0, col: 2 }],
      ),
      R('b11', 1, 2, { '0,0': no('M2'), '0,1': out('Y3') }),
      R('b12', 1, 2, { '0,0': no('M4'), '0,1': out('Y4') }),
      R('b13', 2, 3, { '0,0': no('M1'), '0,1': no('X12'), '0,2': set('M2'), '1,2': rst('M1') }, [
        { row: 0, col: 2 },
      ]),
      R('b14', 2, 3, { '0,0': no('M2'), '0,1': no('X7'), '0,2': set('M3'), '1,2': rst('M2') }, [
        { row: 0, col: 2 },
      ]),
      R('b15', 2, 3, { '0,0': no('M3'), '0,1': no('X6'), '0,2': set('M4'), '1,2': rst('M3') }, [
        { row: 0, col: 2 },
      ]),
      R('b16', 2, 3, { '0,0': no('M4'), '0,1': no('X11'), '0,2': set('M5'), '1,2': rst('M4') }, [
        { row: 0, col: 2 },
      ]),
      R('b17', 1, 3, { '0,0': no('M5'), '0,1': no('X10'), '0,2': rst('M5') }),
    ];
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expectSolvedButNotOptimal(spec, { rungs });
  });
});

describe('throughputScore', () => {
  it('gives full marks at or under par and none past the slack limit', () => {
    expect(throughputScore(5000, 10000)).toBe(1);
    expect(throughputScore(10000, 10000)).toBe(1);
    expect(throughputScore(10000 * PAR_SLACK, 10000)).toBe(0);
    expect(throughputScore(60000, 10000)).toBe(0);
  });

  it('tapers linearly between the two', () => {
    const half = 10000 * (1 + (PAR_SLACK - 1) / 2);
    expect(throughputScore(half, 10000)).toBeCloseTo(0.5, 6);
  });

  it('treats a scenario with no meaningful par as on time', () => {
    expect(throughputScore(9999, 0)).toBe(1);
  });
});

describe('gradeProgram — throughput only counts once the program works', () => {
  it('reports elapsed time and par per scenario', () => {
    const spec = getLadderPuzzle('drill-spindle')!;
    const result = gradeProgram(spec, solutions['drill-spindle']!);
    const cycle = result.scenarios.find((s) => s.name === 'Two parts run back to back')!;
    expect(cycle.parMs).toBeDefined();
    expect(cycle.elapsedMs).toBeGreaterThan(0);
    expect(cycle.elapsedMs).toBeLessThanOrEqual(cycle.parMs!);
    expect(result.efficiency).toBe(1);
  });

  it('withholds every throughput mark from a program that fails a scenario', () => {
    const spec = getLadderPuzzle('drill-spindle')!;
    // Never clamps, so the fixture stays empty and the run is over in no time —
    // a fast wrong answer must not out-score a slow right one.
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y5') })] };
    const result = gradeProgram(spec, bad);
    expect(result.solved).toBe(false);
    expect(result.score).toBeLessThan(CORRECTNESS_WEIGHT);
  });

  it('scores puzzles with no declared par on correctness alone', () => {
    const spec = getLadderPuzzle('seal-in')!;
    expect(spec.scenarios.every((s) => s.parMs === undefined)).toBe(true);
    const result = gradeProgram(spec, solutions['seal-in']!);
    expect(result.efficiency).toBeUndefined();
    expect(result.score).toBe(100);
  });

  /**
   * The analog puzzles spend the same 15 marks on control quality. A loop that
   * holds setpoint loosely is still solved and still unlocks what follows, and
   * still does not reach 100 — the exact property the cycle-time axis has.
   */
  it('scores a regulating puzzle on its error integral instead of on elapsed time', () => {
    const spec = getLadderPuzzle('tank-p-control')!;
    expect(spec.scenarios.every((s) => s.parMs === undefined)).toBe(true);
    expect(spec.scenarios.some((s) => s.parIae !== undefined)).toBe(true);

    const sloppy = structuredClone(solutions['tank-p-control']!);
    // Gain 2 instead of 4: still inside every band the puzzle asks for, but it
    // takes longer to get there and sits further out once loaded. Gain 1 would
    // miss the band outright, which is a different failure to the one under
    // test here.
    sloppy.rungs[2]!.cells[0]![1] = math('mul', 'D31', 'K2', 'D32');
    const result = gradeProgram(spec, sloppy);

    expect(result.solved).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(CORRECTNESS_WEIGHT);
    expect(result.score).toBeLessThan(100);
    const loaded = result.scenarios.find((s) => s.name === 'The offset moves when the load does')!;
    expect(loaded.iae).toBeGreaterThan(loaded.parIae!);
  });
});

describe('gradeProgram — analog puzzles reject the plausible wrong answer', () => {
  /**
   * The discriminator for the P-control puzzle. Open-loop — park the valve at
   * the setpoint and hope — lands exactly on target at the design load, so the
   * no-load scenario alone would pass it. The load step is what exposes that
   * there is no feedback at all.
   */
  it('tank-p-control: an open-loop valve position fails the moment the load changes', () => {
    const spec = getLadderPuzzle('tank-p-control')!;
    const openLoop: LadderProgram = {
      rungs: [
        R('r1', 1, 2, { '0,0': no('X0'), '0,1': mov('K2400', 'D20') }),
        R('r2', 1, 2, { '0,0': nc('X0'), '0,1': mov('K0', 'D20') }),
        R('r3', 1, 3, { '0,0': no('X0'), '0,1': no('X3'), '0,2': out('Y0') }),
      ],
    };
    const result = gradeProgram(spec, openLoop);
    expect(result.solved).toBe(false);
    const byName = new Map(result.scenarios.map((s) => [s.name, s]));
    expect(byName.get('Holds setpoint with no load')!.passed).toBe(true);
    expect(byName.get('The offset moves when the load does')!.passed).toBe(false);
  });

  /**
   * The discriminator for the PID puzzle: proportional action alone. It reaches
   * a level and holds it steadily, which is exactly what makes the offset the
   * only thing separating it from a right answer.
   */
  it('tank-pid: a P-only block leaves an offset the tight band will not accept', () => {
    const spec = getLadderPuzzle('tank-pid')!;
    const pOnly = structuredClone(solutions['tank-pid']!);
    pOnly.rungs[1]!.cells[0]![1] = pid('D30', 'D0', 'D20', { kp: 300, ti: 0 });
    const result = gradeProgram(spec, pOnly);
    expect(result.solved).toBe(false);
    const failures = result.scenarios
      .flatMap((s) => s.steps)
      .flatMap((s) => s.failures)
      .join(' ');
    expect(failures).toContain('proportional term alone');
  });

  /**
   * The discriminator for the capstone: a trip that follows the float instead of
   * latching on it. It looks right while the float is made and quietly reopens
   * the valve the moment the level falls back, which is the failure mode a
   * latch exists to prevent.
   */
  it('tank-auto: a non-latching trip lets go as soon as the level falls back', () => {
    const spec = getLadderPuzzle('tank-auto')!;
    const noLatch = structuredClone(solutions['tank-auto']!);
    noLatch.rungs[2] = R('r3', 1, 2, { '0,0': no('X2'), '0,1': out('M0') });
    const result = gradeProgram(spec, noLatch);
    expect(result.solved).toBe(false);
    const trip = result.scenarios.find((s) => s.name.startsWith('Hand mode overfills'))!;
    expect(trip.passed).toBe(false);
  });
});

describe('gradeProgram — motion puzzles reject the plausible wrong answer', () => {
  /** Swap one cell of a canonical solution, without disturbing the original. */
  function variant(slug: string, patch: (rungs: Rung[]) => void): LadderProgram {
    const program = structuredClone(solutions[slug]!);
    patch(program.rungs);
    return program;
  }

  /**
   * The drive is not a motor contactor. It has to be commissioned before it
   * will turn at all, and both ramp parameters are part of that — which is the
   * first thing this whole category has to teach.
   */
  it('axis-jog: a drive with no ramp parameters refuses to start', () => {
    const spec = getLadderPuzzle('axis-jog')!;
    const noParams: LadderProgram = {
      rungs: [
        R('r1', 1, 2, { '0,0': wire, '0,1': mov('K1200', 'D20') }),
        R('r2', 1, 3, { '0,0': no('X0'), '0,1': nc('X11'), '0,2': out('Y0') }),
        R('r3', 1, 3, { '0,0': no('X1'), '0,1': nc('X10'), '0,2': out('Y1') }),
      ],
    };
    const result = gradeProgram(spec, noParams);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('parameters were loaded');
  });

  it('axis-jog: ramping harder than the motor can pull trips it on overcurrent', () => {
    const spec = getLadderPuzzle('axis-jog')!;
    const tooHard = variant('axis-jog', (rungs) => {
      rungs[0]!.cells[0]![1] = mov('K4000', 'D40');
    });
    const result = gradeProgram(spec, tooHard);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('overcurrent');
  });

  /**
   * The discriminator for the profile puzzle. Rapid all the way is the answer a
   * bit-logic instinct gives you: drop the coil when you get there. The drive
   * does not stop when the coil drops, it starts a ramp, and the carriage is
   * hundreds of counts past the station window by the time that ramp finishes.
   */
  it('axis-profile: rapid all the way sails past the station window', () => {
    const spec = getLadderPuzzle('axis-profile')!;
    const noApproach = variant('axis-profile', (rungs) => {
      // Both speed-reference rungs write full reference: no approach phase.
      rungs[8]!.cells[0]![2] = mov('K4000', 'D20');
    });
    const result = gradeProgram(spec, noApproach);
    expect(result.solved).toBe(false);
  });

  /**
   * The discriminator for the loaded puzzle, in its blunt form: the empty ramp
   * table asks the motor for torque it does not have the moment a pallet is on
   * the forks.
   */
  it('axis-loaded: the empty ramp table trips the drive as soon as it is loaded', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const oneTable = variant('axis-loaded', (rungs) => {
      rungs[0]!.cells[0]![1] = mov('K2000', 'D40');
      rungs[1]!.cells[0]![1] = mov('K2500', 'D41');
    });
    const result = gradeProgram(spec, oneTable);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('overcurrent');
  });

  /**
   * And in its subtle form, which is the one the puzzle is really about: the
   * ramp *parameters* get swapped, because those are the two numbers the
   * briefing hands you, but the slow-down distance they imply does not. The
   * drive is perfectly happy. The pallet still ends up in the wrong place,
   * because half the ramp rate is twice the stopping distance.
   */
  it('axis-loaded: keeping the empty slow-down distance overshoots the drop station', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const oneDistance = variant('axis-loaded', (rungs) => {
      rungs[2]!.cells[0]![1] = mov('K400', 'D32');
    });
    const result = gradeProgram(spec, oneDistance);
    expect(result.solved).toBe(false);
  });

  /**
   * The discriminator for the crane. Everything about this program is right
   * except that it treats "stopped" as "settled" — and a load on a rope is
   * still swinging several seconds after the trolley has stopped dead.
   */
  it('axis-crane: lowering before the swing dies catches the rack', () => {
    const spec = getLadderPuzzle('axis-crane')!;
    const noWait = variant('axis-crane', (rungs) => {
      // Same transfer-pending latch, minus the X17 permission.
      rungs[11]!.cells[0]![3] = wire;
    });
    const result = gradeProgram(spec, noWait);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('swinging');
  });

  /**
   * Using the gentle table for everything is not wrong, it is just timid: the
   * pallets all arrive, nothing trips, and the cycle is slow enough to cost
   * part of the throughput weight. Same property the packaging cycle times
   * have, on a puzzle where the temptation to over-derate is much stronger.
   */
  it('axis-loaded: derating the empty moves too still solves, but scores less', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const timid = variant('axis-loaded', (rungs) => {
      rungs[3]!.cells[0]![1] = mov('K1000', 'D40');
      rungs[4]!.cells[0]![1] = mov('K1200', 'D41');
      rungs[5]!.cells[0]![1] = mov('K1000', 'D32');
    });
    expectSolvedButNotOptimal(spec, timid);
  });
});

describe('gradeProgram — wrong programs do not solve', () => {
  it('a direct wire without seal-in fails the seal-in puzzle', () => {
    const spec = getLadderPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const result = gradeProgram(spec, bad);
    expect(result.solved).toBe(false);
    expect(result.score).toBeLessThan(100);
  });

  it('an empty program never solves', () => {
    const spec = getLadderPuzzle('direct-control')!;
    const empty: LadderProgram = { rungs: [R('r1', 1, 2, {})] };
    expect(gradeProgram(spec, empty).solved).toBe(false);
  });

  it('a latched (non-momentary) 2-pack pusher starves the whole packer line', () => {
    // Drive the 2-pack pusher with a SET instead of the sealed OUT coil: it
    // extends once and never springs back, so the extended plate blocks the
    // lanes, no further pair ever reaches the stop, and every downstream
    // milestone (flips, the shipped 16-pack) starves.
    const spec = getLadderPuzzle('pack-full')!;
    const stalled = [...packFrontEnd(), ...packFlip(), ...packShip()].map((r) =>
      r.id === 'pp1'
        ? R('pp1', 1, 5, {
            '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X2'), '0,3': nc('C0'), '0,4': set('Y0'),
          })
        : r,
    );
    const validation = validateProgram(spec, { rungs: stalled });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(gradeProgram(spec, { rungs: stalled }).solved).toBe(false);
  });
});

describe('gradeProgram — plausible wrong elevator programs are rejected', () => {
  // Each of these must pass validation (structurally fine) and fail grading —
  // that is what proves the scenarios discriminate, not just that the puzzle
  // is solvable.
  function expectFailsGrading(slug: string, program: LadderProgram): ReturnType<typeof gradeProgram> {
    const spec = getLadderPuzzle(slug)!;
    const validation = validateProgram(spec, program);
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    const result = gradeProgram(spec, program);
    expect(result.solved).toBe(false);
    return result;
  }

  it('a down-preferring tie-break fails exactly the "prefers up" dispatch scenario', () => {
    // Same core, but the Up latch is gated on "nothing pending below" and the
    // Down latch is unconditional — i.e. down wins the both-sides tie.
    const downPref = dispatchCore().map((r) => {
      if (r.id === 'r12') {
        return R('r12', 4, 4, {
          '0,0': no('X10'), '0,1': no('M13'), '0,2': wire, '0,3': set('M5'),
          '1,0': no('X11'), '1,1': no('M12'), '1,2': nc('M0'), '1,3': set('M5'),
          '2,0': no('X12'), '2,1': no('M11'), '2,2': nc('M15'), '2,3': set('M5'),
          '3,0': no('X13'), '3,1': no('M4'), '3,2': nc('M16'), '3,3': set('M5'),
        });
      }
      if (r.id === 'r13') {
        return R('r13', 4, 3, {
          '0,0': no('X11'), '0,1': no('M0'), '0,2': set('M6'),
          '1,0': no('X12'), '1,1': no('M15'), '1,2': set('M6'),
          '2,0': no('X13'), '2,1': no('M16'), '2,2': set('M6'),
          '3,0': no('X14'), '3,1': no('M17'), '3,2': set('M6'),
        });
      }
      return r;
    });
    const result = expectFailsGrading('elevator-5-dispatch', { rungs: downPref });
    const failed = result.scenarios.filter((s) => !s.passed).map((s) => s.name);
    expect(failed).toEqual(['Idle with calls on both sides prefers up']);
  });

  it('unlatched call buttons (OUT instead of SET) fail dispatch', () => {
    const unlatched = dispatchCore().map((r) => {
      const m = /^r([1-5])$/.exec(r.id);
      if (!m) return r;
      const floor = Number(m[1]) - 1;
      return R(r.id, 1, 2, { '0,0': no(`X${floor}`), '0,1': out(`M${floor}`) });
    });
    expectFailsGrading('elevator-5-dispatch', { rungs: unlatched });
  });

  it('correct dispatch with no door logic fails the doors puzzle', () => {
    expectFailsGrading('elevator-doors', { rungs: dispatchCore() });
  });

  it('a level contact instead of a rising edge keeps reopening the door — never auto-closes', () => {
    const levelDoor = doorRungs().map((r) =>
      r.id === 'r23'
        ? R('r23', 5, 4, {
            '0,0': no('X10'), '0,1': nc('M5'), '0,2': nc('M6'), '0,3': set('M20'),
            '1,0': no('X11'), '1,1': nc('M5'), '1,2': nc('M6'), '1,3': set('M20'),
            '2,0': no('X12'), '2,1': nc('M5'), '2,2': nc('M6'), '2,3': set('M20'),
            '3,0': no('X13'), '3,1': nc('M5'), '3,2': nc('M6'), '3,3': set('M20'),
            '4,0': no('X14'), '4,1': nc('M5'), '4,2': nc('M6'), '4,3': set('M20'),
          })
        : r,
    );
    const result = expectFailsGrading('elevator-doors', { rungs: [...dispatchCore(), ...levelDoor] });
    const autoClose = result.scenarios.find((s) => s.name === 'Door opens on arrival, dwells, then auto-closes')!;
    expect(autoClose.passed).toBe(false);
  });

  it('dispatch + doors without the idle timer fails the auto-return scenario', () => {
    const result = expectFailsGrading('elevator-full', { rungs: [...dispatchCore(), ...doorRungs()] });
    const failed = result.scenarios.filter((s) => !s.passed).map((s) => s.name);
    expect(failed).toEqual(['Idle away from floor 1 auto-returns after 10 s']);
  });
});

describe('gradeProgram — plausible wrong drill-station programs are rejected', () => {
  function expectFailsGrading(slug: string, rungs: Rung[]): ReturnType<typeof gradeProgram> {
    const spec = getLadderPuzzle(slug)!;
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    const result = gradeProgram(spec, { rungs });
    expect(result.solved).toBe(false);
    return result;
  }

  it('feeding straight off the run latch, before CLAMPED, fails the first puzzle', () => {
    const ungated = drillClampFeedCore().map((r) =>
      r.id === 'dc3' ? R('dc3', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }) : r,
    );
    expectFailsGrading('drill-clamp-feed', ungated);
  });

  it('ejecting off the bottom sensor drives the pusher into a head that is still down', () => {
    // The pre-revision solution: SET Y4 straight off X3. The rod now sweeps
    // across a bore the bit is still sitting in, which shears it off.
    const ejectAtBottom = drillFullStroke().map((r) =>
      r.id === 'dfs7' ? R('dfs7', 1, 2, { '0,0': no('X3'), '0,1': set('Y4') }) : r,
    );
    const result = expectFailsGrading('drill-station', ejectAtBottom);
    expect(result.scenarios.every((s) => !s.passed)).toBe(false); // the E-Stop abort still passes
    const jammed = result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('jam')));
    expect(jammed).toBe(true);
  });

  it('a level contact instead of a rising edge cycles the eject pusher forever', () => {
    // X10 and Y3 both stay on once the rod is recalled, so the SET re-fires the
    // scan after every RESET and the pusher never stays home.
    const levelEject = drillFullStroke().map((r) =>
      r.id === 'dfs7'
        ? R('dfs7', 1, 3, { '0,0': no('X10'), '0,1': no('Y3'), '0,2': set('Y4') })
        : r,
    );
    const result = expectFailsGrading('drill-station', levelEject);
    expect(result.scenarios[0].steps.at(-1)!.passed).toBe(false);
  });

  it('a full-stroke cycle that ignores the eject-home sensor re-clamps on an extended rod', () => {
    const noHomeGate = drillFullStroke().map((r) =>
      r.id === 'dfs1'
        ? R(
            'dfs1',
            2,
            4,
            { '0,0': no('X0'), '1,0': no('M0'), '0,1': no('X1'), '0,2': nc('X3'), '0,3': out('M0') },
            [{ row: 0, col: 1 }],
          )
        : r,
    );
    const result = expectFailsGrading('drill-station', noHomeGate);
    const restart = result.scenarios.find(
      (s) => s.name === 'A new part waits for the eject rod to come home',
    )!;
    expect(restart.passed).toBe(false);
  });

  it('feeding straight off the run latch drives the bit into an unclamped part', () => {
    const ungated = drillFullStroke().map((r) =>
      r.id === 'dfs3' ? R('dfs3', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }) : r,
    );
    const result = expectFailsGrading('drill-station', ungated);
    expect(result.scenarios.every((s) => !s.passed)).toBe(true);
  });

  it('feeding without waiting for spindle-at-speed snaps the bit', () => {
    const noInterlock = drillAutoCycle(false).map((r) =>
      r.id === 'ds6'
        ? R('ds6', 1, 4, { '0,0': no('M0'), '0,1': no('X2'), '0,2': nc('T0'), '0,3': out('Y1') })
        : r,
    );
    const result = expectFailsGrading('drill-spindle', noInterlock);
    // The crash is physical (a latched jam freezes the machine), so no scenario
    // that runs a part can pass — this isn't a single missed assertion.
    expect(result.scenarios.every((s) => !s.passed)).toBe(true);
  });

  it('dropping the clamp a scan before the feed rung notices snaps the bit on E-Stop', () => {
    // Gating the clamp on X1 but not the feed makes Y0 drop the scan the E-Stop
    // opens, while Y1 hangs on for one more scan (X2 only falls once the clamp
    // has physically moved). The bit is then driving into an unheld part.
    const clampOnlyEstop = drillAutoCycle(false).map((r) =>
      r.id === 'ds2'
        ? R('ds2', 1, 3, { '0,0': no('M0'), '0,1': no('X1'), '0,2': out('Y0') })
        : r,
    );
    const result = expectFailsGrading('drill-spindle', clampOnlyEstop);
    const estop = result.scenarios.find((s) => s.name.startsWith('E-Stop'))!;
    expect(estop.passed).toBe(false);
    // The jam latches during the E-Stop step but only breaks an assertion in the
    // step after it, so the message has to name the step that actually caused it.
    const failures = estop.steps.flatMap((s) => s.failures);
    expect(failures.some((f) => /jammed [\d.]+ s into the run, back in "Hit E-Stop/.test(f))).toBe(
      true,
    );
    expect(failures.some((f) => f.includes('the clamp was not holding'))).toBe(true);
    // The frozen machine never reaches the milestone the last step waits for.
    expect(failures.some((f) => f.includes('for the machine to produce 1 good part'))).toBe(true);
  });

  it('names the field device, not just the address, when an output is wrong', () => {
    const noBeacon = drillAutoCycle(false).filter((r) => r.id !== 'ds4');
    const result = expectFailsGrading('drill-spindle', noBeacon);
    const failures = result.scenarios.flatMap((s) => s.steps.flatMap((st) => st.failures));
    expect(failures).toContain('Warning Beacon (Y2) should be ON at this point, but it was OFF.');
  });

  it('retracting on the bottom sensor instead of dwelling leaves an unfinished hole', () => {
    // The stroke looks right and the part even reaches the belt, but the hole was
    // never finished, so it lands as scrap and the good count never moves.
    const noDwell = drillAutoCycle(false)
      .filter((r) => r.id !== 'ds5')
      .map((r) => {
        if (r.id === 'ds6') {
          return R('ds6', 1, 4, {
            '0,0': no('M0'), '0,1': no('X2'), '0,2': no('X7'), '0,3': out('Y1'),
          });
        }
        if (r.id === 'ds7') {
          return R('ds7', 2, 2, { '0,0': no('X3'), '0,1': set('M1'), '1,1': rst('M0') }, [
            { row: 0, col: 1 },
          ]);
        }
        return r;
      });
    const result = expectFailsGrading('drill-spindle', noDwell);
    expect(result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('good')))).toBe(
      true,
    );
  });

  it('leaving the spindle turning between parts fails the production run', () => {
    const alwaysSpinning = drillAutoCycle(true).map((r) =>
      r.id === 'ds3' ? R('ds3', 1, 2, { '0,0': no('X0'), '0,1': out('Y5') }) : r,
    );
    const result = expectFailsGrading('drill-production', alwaysSpinning);
    expect(result.scenarios[0].passed).toBe(false);
  });

  it('counting ejects instead of finished holes closes the batch a part early', () => {
    // Every stroke counts, including the rejected steel blank, so the station
    // parks after two good parts instead of three.
    const countsRejects = drillAutoCycle(true).map((r) =>
      r.id === 'dm4' ? R('dm4', 1, 2, { '0,0': no('X4'), '0,1': counter('C0', 3) }) : r,
    );
    const result = expectFailsGrading('drill-production', countsRejects);
    expect(result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('good')))).toBe(
      true,
    );
  });

  it('treating steel like aluminium jams the production run', () => {
    // Without the nc(X6) guard the drill stage starts on a metal blank too.
    const drillsSteel = drillAutoCycle(true).map((r) =>
      r.id === 'ds1'
        ? R('ds1', 1, 6, {
            '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X5'), '0,3': nc('M1'), '0,4': nc('C0'),
            '0,5': set('M0'),
          })
        : r,
    );
    const result = expectFailsGrading('drill-production', drillsSteel);
    const jammed = result.scenarios[0].steps.some((s) =>
      s.failures.some((f) => f.includes('jam')),
    );
    expect(jammed).toBe(true);
  });
});

describe('traceScenario', () => {
  it('matches gradeProgram pass/fail and samples every scan for a solved puzzle', () => {
    const spec = getLadderPuzzle('seal-in')!;
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
    const spec = getLadderPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const scenario = spec.scenarios[0];
    const trace = traceScenario(spec, bad, scenario.name)!;
    expect(trace.steps.some((s) => !s.passed)).toBe(true);
  });

  it('returns undefined for an unknown scenario name', () => {
    const spec = getLadderPuzzle('direct-control')!;
    expect(traceScenario(spec, solutions['direct-control'], 'nope')).toBeUndefined();
  });
});

/**
 * The warehouse category is about deciding, not about driving, so every one of
 * these is a program that drives the crane perfectly well and decides badly.
 * Each failure is a consequence the machine reports - a stopped line, a backed-up
 * conveyor, a folded mast - rather than a rule the grader is checking.
 */
describe('gradeProgram — warehouse puzzles reject the plausible wrong answer', () => {
  function variant(slug: string, patch: (rungs: Rung[]) => Rung[]): LadderProgram {
    return { rungs: patch(structuredClone(solutions[slug]!).rungs) };
  }

  const failureText = (result: ReturnType<typeof gradeProgram>): string =>
    result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');

  /**
   * The tutorial's two rules, each broken on its own. Both are the same mistake
   * from opposite ends - trusting one half of the machine's state - and the
   * commissioning job exists so a player meets them here, on a crane doing one
   * pallet, rather than four puzzles later in the middle of a schedule.
   */
  it('asrs-drive: a move block without the fork-home contact folds the mast', () => {
    const spec = getLadderPuzzle('asrs-drive')!;
    const noInterlock = variant('asrs-drive', (rungs) =>
      rungs.map((r) =>
        r.id === 'd2'
          ? R('d2', 4, 2, {
              '0,0': cmp('<', 'D0', 'D52'), '0,1': out('Y0'),
              '1,0': cmp('>', 'D0', 'D52'), '1,1': out('Y1'),
              '2,0': cmp('<', 'D1', 'D53'), '2,1': out('Y2'),
              '3,0': cmp('>', 'D1', 'D53'), '3,1': out('Y3'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, noInterlock);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('fork still out in a slot');
  });

  /**
   * The other half: a fork coil wired straight to the button reaches into
   * whatever the crane happens to be passing, and `D0` reading the bay it last
   * went by is no defence - the readout is honest, the fork is simply not there
   * yet.
   */
  it('asrs-drive: a fork driven from the button alone strokes between slots', () => {
    const spec = getLadderPuzzle('asrs-drive')!;
    const ungated = variant('asrs-drive', (rungs) =>
      rungs.map((r) => (r.id === 'd5' ? R('d5', 1, 2, { '0,0': no('X1'), '0,1': out('Y4') }) : r)),
    );
    const result = gradeProgram(spec, ungated);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('still between slots');
  });

  /**
   * The whole point of the WMS table. Bay 1 holds what line A asks for twice
   * running, so a program that only ever looks there gets two deliveries in
   * before it has nothing left to find and the line stops.
   */
  it('asrs-retrieval: only ever searching the nearest bay runs the line dry', () => {
    const spec = getLadderPuzzle('asrs-retrieval')!;
    const bayOneOnly = variant('asrs-retrieval', (rungs) =>
      rungs.filter((r) => !r.id.startsWith('s2_') || r.id === 's2_0' || r.id === 's2_1'),
    );
    const result = gradeProgram(spec, bayOneOnly);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('starved');
  });

  /**
   * A cycle belongs to the line that asked for it. Search the right slot, fetch
   * the right material, and then hand every pallet over at the aisle head
   * regardless of who ordered it, and line A's conveyor takes the two it has
   * room for and then has pallets pushed onto the floor - while line B, at the
   * other end, never sees anything at all.
   */
  it('asrs-two-lines: delivering everything to the aisle head buries line A', () => {
    const spec = getLadderPuzzle('asrs-two-lines')!;
    const oneStation = variant('asrs-two-lines', (rungs) =>
      rungs.map((r) =>
        r.id === 't9'
          ? R('t9', 2, 5, {
              '0,0': no('M1'), '0,1': nc('M3'), '0,2': wire,
              '0,3': mov('D50', 'D52'), '0,4': mov('D51', 'D53'),
              '1,0': no('M1'), '1,1': no('M3'), '1,2': wire,
              '1,3': mov('K0', 'D52'), '1,4': mov('K1', 'D53'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, oneStation);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain("line A's infeed conveyor, which was already full");
  });

  /**
   * The signature interlock, and the one thing in this category that is a crash
   * rather than a cost. Drop the fork-home contact out of the move block and the
   * crane sets off down the aisle with its fork still inside a rack upright.
   */
  it('asrs-two-lines: a move block without the fork-home contact folds the mast', () => {
    const spec = getLadderPuzzle('asrs-two-lines')!;
    const noInterlock = variant('asrs-two-lines', (rungs) =>
      rungs.map((r) =>
        r.id === 't10'
          ? R('t10', 4, 2, {
              '0,0': cmp('<', 'D0', 'D52'), '0,1': out('Y0'),
              '1,0': cmp('>', 'D0', 'D52'), '1,1': out('Y1'),
              '2,0': cmp('<', 'D1', 'D53'), '2,1': out('Y2'),
              '3,0': cmp('>', 'D1', 'D53'), '3,1': out('Y3'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, noInterlock);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('fork still out');
  });

  /**
   * Feeding the line first is right. Feeding the line *only* is not: the inbound
   * conveyor holds two pallets and then goods in stops, which fails the run just
   * as surely as a stopped line does.
   */
  it('asrs-replenish: never putting anything away backs the inbound conveyor up', () => {
    const spec = getLadderPuzzle('asrs-replenish')!;
    const ordersOnly = variant('asrs-replenish', (rungs) =>
      rungs.map((r) =>
        // Kill the put-away leg: the mode relay can now only ever be cleared.
        r.id === 'u5' ? R('u5', 1, 2, { '0,0': nc('M1'), '0,1': rst('M6') }) : r,
      ),
    );
    const result = gradeProgram(spec, ordersOnly);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('blocked');
  });

  /**
   * At full rate every pallet the lines eat has to be replaced, so a crane that
   * only ever runs orders is not merely leaving stock on the dock - it is
   * emptying the rack it is picking from. Goods in backs up and the lines run
   * out of the very material sitting on the conveyor above them.
   */
  it('asrs-dual-cycle: running orders only empties the rack and blocks goods in', () => {
    const spec = getLadderPuzzle('asrs-dual-cycle')!;
    const ordersOnly = variant('asrs-dual-cycle', (rungs) =>
      rungs.map((r) =>
        r.id === 'v8'
          ? R('v8', 1, 5, {
              '0,0': nc('M1'), '0,1': nc('X6'), '0,2': no('M8'), '0,3': no('M4'),
              '0,4': set('M7'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, ordersOnly);
    expect(result.solved).toBe(false);
  });
});

describe('gradeProgram — Cold Chain Hub puzzles reject the plausible wrong answer', () => {
  function variant(slug: string, patch: (rungs: Rung[]) => Rung[]): LadderProgram {
    return { rungs: patch(structuredClone(solutions[slug]!).rungs) };
  }

  const failureText = (result: ReturnType<typeof gradeProgram>): string =>
    result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');

  /**
   * The two bookings, each left out on its own. Both are the same mistake: taking
   * the plant's word for what is true as though it were a record of what has been
   * promised. X5 only comes on once a pallet lands, and X6 stays on until one is
   * lifted, so neither can stand in for the program's own relay.
   */
  it('dc-dispatch: without booking QA, a second pallet is sent to a full table', () => {
    const spec = getLadderPuzzle('dc-dispatch')!;
    const unbooked = variant('dc-dispatch', (rungs) =>
      rungs.map((r) =>
        r.id === 'h2'
          ? R('h2', 1, 4, { '0,0': no('X3'), '0,1': nc('M10'), '0,2': nc('M11'), '0,3': set('M10') })
          : r,
      ),
    );
    const result = gradeProgram(spec, unbooked);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('waiting to set down at QA');
  });

  it('dc-dispatch: without booking the pickup, a second vehicle is sent for it', () => {
    const spec = getLadderPuzzle('dc-dispatch')!;
    const unbooked = variant('dc-dispatch', (rungs) =>
      rungs.map((r) =>
        r.id === 'h1'
          ? R('h1', 1, 4, { '0,0': no('X6'), '0,1': nc('M10'), '0,2': nc('M11'), '0,3': set('M11') })
          : r,
      ),
    );
    const result = gradeProgram(spec, unbooked);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('nothing was there');
  });

  /**
   * The table read but never shifted: the first code on it is taken to be the
   * pallet at the labeler every time. Right once, and wrong at the second
   * pallet the night shift left, whose product ships from the other dock.
   */
  it('dc-label: a table that is read but never shifted mislabels the second pallet', () => {
    const spec = getLadderPuzzle('dc-label')!;
    const noShift = variant('dc-label', (rungs) =>
      rungs.map((r) =>
        r.id === 'l9'
          ? R('l9', 1, 3, {
              '0,0': no('M14'), '0,1': mov('D201', 'D20'), '0,2': math('sub', 'D200', 'K1', 'D200'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, noShift);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('was labeled for');
  });

  /**
   * First fit instead of oldest first: the first lane with the called product at
   * its front wins. Right while each product lives in one lane, and wrong the
   * moment tomatoes are in two and the older ones are further down the rack.
   */
  it('dc-flow-lanes: taking the first lane with the product ships a newer lot first', () => {
    const spec = getLadderPuzzle('dc-flow-lanes')!;
    const firstFit = variant('dc-flow-lanes', (rungs) =>
      rungs.map((r) => {
        if (!r.id.startsWith('f3')) return r;
        const next = structuredClone(r);
        next.cells[0][2] = cmp('=', 'D29', 'K0');
        return next;
      }),
    );
    const result = gradeProgram(spec, firstFit);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('the oldest lot ships first');
  });

  /** RIPEN swapped for a patched copy, submitted the way the client posts a section. */
  function ripenVariant(patch: (rungs: Rung[]) => Rung[]): LadderProject {
    return { pous: [{ id: 'RIPEN', name: 'RIPEN', rungs: patch(structuredClone(RIPEN_PROGRAM)) }], tasks: [] };
  }

  /**
   * The door dropped the moment a room decides to close, without waiting for the
   * light curtain: the vehicle that set the last pallet down is still backing
   * out of the doorway.
   */
  it('dc-ripening: a door that closes without waiting for the doorway closes on a vehicle', () => {
    const spec = getLadderPuzzle('dc-ripening')!;
    const noCurtain = ripenVariant((rungs) =>
      rungs.map((r) =>
        r.id.startsWith('ripen-door-')
          ? { ...r, rows: 2, cells: r.cells.slice(0, 2), vlinks: [{ row: 0, col: 2 }] }
          : r,
      ),
    );
    const result = gradeProgram(spec, noCurtain);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('closed on a vehicle');
  });

  /**
   * A room read as though it were a lane: SFRDP takes the first pallet in, but
   * the one in the doorway is the last. The notice names a pallet at the back
   * of the room.
   */
  it('dc-ripening: reading a room first-in first-out ships under the wrong notice', () => {
    const spec = getLadderPuzzle('dc-ripening')!;
    const asQueue = ripenVariant((rungs) =>
      rungs.map((r) => ({
        ...r,
        cells: r.cells.map((row) => row.map((el) => (el?.type === 'pop' ? { ...el, type: 'sfrd' as const } : el))),
      })),
    );
    const result = gradeProgram(spec, asQueue);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('shipping notice');
  });

  /** The capstone's two sections, either one swapped for a patched copy. */
  function hub(opts: { ship?: Rung[]; fleet?: Rung[] }): LadderProject {
    return {
      pous: [
        { id: 'SHIP', name: 'SHIP', rungs: opts.ship ?? structuredClone(SHIP_PROGRAM) },
        { id: 'FLEET', name: 'FLEET', rungs: opts.fleet ?? structuredClone(HUB_FLEET_PROGRAM) },
      ],
      tasks: [],
    };
  }

  /** A capstone grade simulates two shifts of a three-vehicle plant: seconds, not milliseconds. */
  const HUB_MS = 60_000;

  /**
   * An order read front to back: SFRDP gives the lines back in the order they
   * arrived, which is the order the truck drops them, so the first stop's pallet
   * goes in first and ends up at the back of the trailer.
   */
  it('dc-hub: loading a truck in drop order puts its first stop at the back', () => {
    const spec = getLadderPuzzle('dc-hub')!;
    const inOrder = hub({
      ship: structuredClone(SHIP_PROGRAM).map((r) => ({
        ...r,
        cells: r.cells.map((row) => row.map((el) => (el?.type === 'pop' ? { ...el, type: 'sfrd' as const } : el))),
      })),
    });
    const result = gradeProgram(spec, inOrder);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('loaded last stop first');
  }, HUB_MS);

  /** The dispatcher the earlier puzzles shipped, unchanged: the fleet starts part charged, and a shift is longer than a battery. */
  it('dc-hub: a dispatcher that never charges runs a vehicle flat', () => {
    const spec = getLadderPuzzle('dc-hub')!;
    const result = gradeProgram(spec, hub({ fleet: fleetProgram({}) }));
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('battery flat');
  }, HUB_MS);

  /** Too late: below 3% a vehicle cannot finish the job it is on and still reach the charger. */
  it('dc-hub: charging below 3% runs a vehicle flat on its way', () => {
    const spec = getLadderPuzzle('dc-hub')!;
    const result = gradeProgram(spec, hub({ fleet: fleetProgram({ chargeBelow: 3 }) }));
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('battery flat');
  }, HUB_MS);

  /**
   * Too early: every charge fills the battery, so a vehicle sent at 25% or 70%
   * is off the floor longer, and sooner, than one sent at 10%. It works, and it
   * is the program most players will write first.
   */
  for (const below of [25, 70]) {
    it(`dc-hub: charging below ${below}% is solved, and slower than par`, () => {
      const spec = getLadderPuzzle('dc-hub')!;
      const result = gradeProgram(spec, hub({ fleet: fleetProgram({ chargeBelow: below }) }));
      expect(result.solved).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(CORRECTNESS_WEIGHT);
      expect(result.score).toBeLessThan(100);
    }, HUB_MS);
  }
});

describe('gradeProgram — the plausible wrong spine is rejected', () => {
  const spec = () => getLadderPuzzle('factory-conveyor')!;

  /** A submission carrying only the conveyor, which is all the player owns. */
  function conveyor(rungs: Rung[]): LadderProject {
    return { pous: [{ id: 'CONV', name: 'SEC6_CONVEYOR', rungs }], tasks: [] };
  }

  const DRIVES = [
    'Y28', 'Y29', 'Y30', 'Y31', 'Y32', 'Y33',
    'Y34', 'Y35', 'Y36', 'Y37', 'Y38', 'Y39',
  ];
  /** The sort, done right, so these tests fail for the reason they claim to. */
  const SORT = [
    R('sortf', 1, 5, {
      '0,0': no('M0'), '0,1': no('X38'), '0,2': nc('X44'), '0,3': nc('X45'), '0,4': out('Y40'),
    }),
    R('sortb', 1, 5, {
      '0,0': no('M0'), '0,1': no('X38'), '0,2': no('X44'), '0,3': nc('X46'), '0,4': out('Y41'),
    }),
    R('lanef', 1, 2, { '0,0': no('Y40'), '0,1': out('Y35') }),
    R('laneb', 1, 2, { '0,0': no('Y41'), '0,1': out('Y36') }),
  ];

  it('every belt turning all the time: nothing can ever be lifted off one', () => {
    // The trap this puzzle is built around. It looks like it is working - parts
    // move, no fault, no crash - and the store's loader, the jig and the test
    // bay can never take a part off a belt that is moving, so nothing arrives.
    const result = gradeProgram(
      spec(),
      conveyor([
        ...DRIVES.map((y, i) => R(`run${i}`, 1, 2, { '0,0': no('M0'), '0,1': out(y) })),
        ...SORT.slice(0, 2),
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('a paddle raised against a lane that is not running leaves the part on the sort', () => {
    // A divert is two coils, not one. The paddle pushes and the lane has to be
    // turning to take what it is pushed.
    const result = gradeProgram(
      spec(),
      conveyor([
        ...DRIVES.slice(0, 7).map((y, i) =>
          R(`z${i}`, 1, 3, { '0,0': no('M0'), '0,1': nc(`X${32 + i}`), '0,2': out(y) }),
        ),
        ...DRIVES.slice(9).map((y, i) =>
          R(`o${i}`, 1, 3, { '0,0': no('M0'), '0,1': nc(`X${41 + i}`), '0,2': out(y) }),
        ),
        ...SORT.slice(0, 2),
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('a spine that never turns: the weld bay has nowhere to put a weldment', () => {
    const result = gradeProgram(spec(), conveyor(SORT));
    expect(result.solved).toBe(false);
  });
});

/**
 * The four sectioned puzzles that finish the excavator line, and the mistakes
 * each one is actually about.
 *
 * Every variant below starts from the shipped program for that section and
 * changes one thing, so a test that fails tells you which rung was carrying the
 * lesson rather than that some hand-written program somewhere did not work.
 */
describe('gradeProgram — the plausible wrong line sections are rejected', () => {
  /** A shipped section with one rung replaced, or dropped when `make` is null. */
  function patch(rungs: Rung[], edits: Record<string, Rung | null>): Rung[] {
    return structuredClone(rungs).flatMap((r) => {
      if (!(r.id in edits)) return [r];
      const replacement = edits[r.id];
      return replacement ? [replacement] : [];
    });
  }

  // The section's own declarations come along, because the rungs being patched
  // are written in the names they define. A patch is free to reach past them and
  // use a bare address — resolution's last step is the address itself — which is
  // what several of the variants below do.
  const section = (id: string, name: string, rungs: Rung[]): LadderProject => ({
    pous: [lineSolution(id, name, rungs)],
    tasks: [],
  });

  const failureText = (result: ReturnType<typeof gradeProgram>): string =>
    result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');

  // --- 50, the rack store and the portal ------------------------------------

  const store = (rungs: Rung[]) => section('STORE', 'SEC2_STORE', rungs);

  /**
   * The store's whole lesson, and the one thing a rack run as a queue cannot
   * do. Two frames standing in lane 1 at the start of the shift are two frames
   * fed to the booth back to back, which colors them as halves of two different
   * machines, and the jig finds out about it forty seconds later.
   */
  it('factory-handling: one lane in and one lane out cannot recover the mix', () => {
    const result = gradeProgram(getLadderPuzzle('factory-handling')!, store(STORE_PLAIN));
    expect(result.solved).toBe(false);
  });

  it('factory-handling: the portal sets off along the rail with its head down', () => {
    // The head is still down on the outfeed at the moment it takes hold of the
    // part, so a traverse that does not wait for X17 starts with two metres of
    // gantry hanging into the aisle.
    const result = gradeProgram(
      getLadderPuzzle('factory-handling')!,
      store(
        patch(STORE_TUNED, {
          'por-run': R('por-run', 1, 2, { '0,0': no('M61'), '0,1': out('Y10') }),
        }),
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('head still down');
  });

  it('factory-handling: the portal lets go at the top of the stroke', () => {
    // Lowering on the way in but not on the way out is the easiest half of this
    // interlock to write and the expensive half to leave out: the cups break
    // vacuum while the head is on its way back up and the part falls.
    const result = gradeProgram(
      getLadderPuzzle('factory-handling')!,
      store(
        patch(STORE_TUNED, {
          'por-lower': R(
            'por-lower',
            2,
            2,
            { '0,0': no('M60'), '0,1': out('Y12'), '1,0': no('M62') },
            [{ row: 0, col: 1 }],
          ),
        }),
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('from the top of the stroke');
  });

  it('factory-handling: a picker that always draws from lane 1 never sends a boom', () => {
    // Sorting the rack on the way in and then drawing from the first lane on
    // the way out is half a store. The booms go into lanes of their own and
    // stay there, and the jig is left holding a frame it can never marry.
    const result = gradeProgram(
      getLadderPuzzle('factory-handling')!,
      store(
        patch(STORE_TUNED, {
          's-take-f1': R('s-take-f1', 1, 2, { '0,0': wire, '0,1': mov('K1', 'D14') }),
          's-take-f2': null,
          's-take-b1': null,
          's-take-b2': null,
          's-have-f': null,
          's-have-b': null,
          's-pick': R('s-pick', 1, 4, {
            '0,0': no('M0'), '0,1': nc('X13'), '0,2': cmp('>', 'D4', 'K0'), '0,3': out('Y9'),
          }),
          's-alt-arm': null,
          's-alt-clear': null,
          's-alt-apply': null,
        }),
      ),
    );
    expect(result.solved).toBe(false);
  });

  // --- 51, the paint shop ----------------------------------------------------

  const paint = (rungs: Rung[]) => section('PAINT', 'SEC3_PAINT', rungs);

  it('factory-paint: a booth left cold lays no film at all', () => {
    // Paint only cross-links between 90 and 130 C, so out of band the gun runs
    // and nothing happens. The station looks like it is working and the film
    // gauge never moves.
    const result = gradeProgram(
      getLadderPuzzle('factory-paint')!,
      paint(patch(PAINT_TUNED, { 'p-recipe': null })),
    );
    expect(result.solved).toBe(false);
  });

  it('factory-paint: a flush with no drum selected faults the station', () => {
    // The easiest rung in the section to forget, because the drum command is
    // not a decision: it is a MOV of the order book straight through to the
    // selector. Leave it out and the first changeover flushes onto nothing.
    const result = gradeProgram(
      getLadderPuzzle('factory-paint')!,
      paint(patch(PAINT_TUNED, { 'p-drum': null })),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('no drum selected');
  });

  it('factory-paint: spraying and purging together puts thinners on the part', () => {
    // Both rungs written as the plain statement of what they are for - spray
    // whenever there is a part, flush whenever the color is wrong - and at a
    // changeover both are true at once.
    const result = gradeProgram(
      getLadderPuzzle('factory-paint')!,
      paint(
        patch(PAINT_TUNED, {
          'p-spray': R('p-spray', 1, 5, {
            '0,0': no('M0'), '0,1': no('X19'), '0,2': cmp('<', 'D1', 'D40'),
            '0,3': cmp('>=', 'D0', 'K1900'), '0,4': out('Y14'),
          }),
          'p-purge': R('p-purge', 1, 3, {
            '0,0': no('M0'), '0,1': cmp('<>', 'D9', 'D8'), '0,2': out('Y16'),
          }),
        }),
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('still spraying');
  });

  it('factory-paint: spraying through a changeover with no purge scraps the part', () => {
    // The failure this station is built around, because nothing reports it. The
    // gun lays the old color down behind the new one, the part goes into the
    // oven looking exactly like every other part, and it comes out scrap.
    const result = gradeProgram(
      getLadderPuzzle('factory-paint')!,
      paint(
        patch(PAINT_TUNED, {
          'p-spray': R('p-spray', 1, 5, {
            '0,0': no('M0'), '0,1': no('X19'), '0,2': cmp('<', 'D1', 'D40'),
            '0,3': cmp('>=', 'D0', 'K1900'), '0,4': out('Y14'),
          }),
          'p-purge': null,
        }),
      ),
    );
    expect(result.solved).toBe(false);
  });

  // --- 52, assembly and dispatch ---------------------------------------------

  const build = (assy: Rung[], test: Rung[]): LadderProject => ({
    pous: [
      lineSolution('ASSY', 'SEC4_ASSEMBLY', assy),
      lineSolution('TEST', 'SEC5_TEST', test),
    ],
    tasks: [],
  });

  it('factory-assembly: the boom is pinned before the cab is on', () => {
    const result = gradeProgram(
      getLadderPuzzle('factory-assembly')!,
      build(
        patch(ASSEMBLY_TUNED, {
          'a-pin': R('a-pin', 1, 5, {
            '0,0': no('M0'), '0,1': no('X25'), '0,2': nc('X26'), '0,3': nc('M104'),
            '0,4': out('Y22'),
          }),
        }),
        TEST_TUNED,
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('before the machine was ready');
  });

  it('factory-assembly: the bench is run for the whole build rather than on a boom', () => {
    // "Run the bench while a build is in progress" is one contact away from
    // "run the bench while there is a boom on it", and the build starts on a
    // frame alone.
    const result = gradeProgram(
      getLadderPuzzle('factory-assembly')!,
      build(
        patch(ASSEMBLY_TUNED, {
          'a-prep': R('a-prep', 1, 6, {
            '0,0': no('M0'), '0,1': no('M100'), '0,2': nc('X25'), '0,3': nc('X26'),
            '0,4': nc('M104'), '0,5': out('Y21'),
          }),
        }),
        TEST_TUNED,
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('no boom on it');
  });

  it('factory-assembly: the function test runs before the pack is up', () => {
    const result = gradeProgram(
      getLadderPuzzle('factory-assembly')!,
      build(
        ASSEMBLY_TUNED,
        patch(TEST_TUNED, {
          't-cycle': R('t-cycle', 1, 3, {
            '0,0': no('M0'), '0,1': nc('X29'), '0,2': out('Y25'),
          }),
        }),
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('up to pressure');
  });

  it('factory-assembly: the machine is driven off the pad still under pressure', () => {
    // The pump held on for as long as there is a machine at test is the obvious
    // rung and the one that takes the hose with it. The quick release has to be
    // dropped before the dispatch, which means the pump comes off on X29.
    const result = gradeProgram(
      getLadderPuzzle('factory-assembly')!,
      build(
        ASSEMBLY_TUNED,
        patch(TEST_TUNED, {
          't-pump': R('t-pump', 1, 3, { '0,0': no('M0'), '0,1': no('X28'), '0,2': out('Y24') }),
        }),
      ),
    );
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('still coupled and under pressure');
  });

  // --- 53, the capstone ------------------------------------------------------

  /**
   * The capstone's bargain, asserted rather than described.
   *
   * The plant as it is handed over **passes**, and that is the design: a player
   * is given a line that works and asked to make it earn more, so a seed that
   * failed would be a broken plant rather than a slow one. It simply scores
   * badly, and the canonical scores 100 on the same three scenarios.
   */
  it('factory-line: the plant as handed over solves the capstone and scores badly', () => {
    const spec = getLadderPuzzle('factory-line')!;
    // Nothing submitted at all, so every section falls back to the seed in its
    // own slot - which is exactly what a player who changes nothing posts.
    const handedOver = { pous: [], tasks: [] };
    // It has to *validate* as well as pass. A seeded section is a submission
    // like any other once the player owns it, so a seed that broke its own
    // ownership block would hand out a validation error nobody had earned.
    const validation = validateProgram(spec, handedOver);
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([]);
    const asHandedOver = gradeProgram(spec, handedOver);
    expect(asHandedOver.solved).toBe(true);
    expect(asHandedOver.score).toBeLessThan(95);
  });

  it('factory-line: a weld bay that stops changing its tip jams the plant', () => {
    // The three seconds a tip change costs are the most visible idle time in
    // the building and the cheapest thing to delete. The bay then strikes a new
    // weldment on a worn tip and burns back into the diffuser.
    const spec = getLadderPuzzle('factory-line')!;
    const result = gradeProgram(spec, {
      pous: [
        lineSolution(
          'WELD',
          'SEC1_WELD',
          patch(WELD_TUNED, {
            'w-start': R('w-start', 1, 3, {
              '0,0': no('M0'), '0,1': nc('M11'), '0,2': set('M11'),
            }),
          }),
        ),
      ],
      tasks: [],
    });
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('worn contact tip');
  });
});

describe('gradeProgram — the plausible wrong supervisor is rejected', () => {
  const spec = () => getLadderPuzzle('factory-supervisor')!;

  /** The canonical project with its supervisor swapped for a different one. */
  function supervisor(rungs: Rung[]): LadderProject {
    return { pous: [{ id: 'SUP', name: 'SUPERVISOR', rungs }], tasks: [] };
  }

  const lamp = R('lamp', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') });
  const held = R(
    'held',
    3,
    2,
    { '0,0': no('X8'), '1,0': no('X11'), '2,0': nc('X17'), '0,1': out('Y1') },
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  );

  it('no seal-in: the plant runs only while the button is held', () => {
    const result = gradeProgram(
      spec(),
      supervisor([
        R('run', 1, 5, {
          '0,0': no('X0'),
          '0,1': no('X1'),
          '0,2': no('X2'),
          '0,3': no('X3'),
          '0,4': out('M0'),
        }),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('auto in the seal branch: turning the selector to manual does not stop it', () => {
    // A seal that carries X3 in the *branch* rather than in series still starts
    // correctly and still stops on either button, so three of the four scenarios
    // pass. Only the last step of the first one catches it, which is exactly why
    // that step is in there.
    const result = gradeProgram(
      spec(),
      supervisor([
        R(
          'run',
          2,
          4,
          {
            '0,0': no('X0'),
            '0,1': no('X3'),
            '1,0': no('M0'),
            '0,2': no('X1'),
            '0,3': out('M0'),
          },
          [{ row: 0, col: 2 }],
        ),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('NC contacts on the normally closed buttons: the plant never starts', () => {
    const result = gradeProgram(
      spec(),
      supervisor([
        R(
          'run',
          2,
          5,
          {
            '0,0': no('X0'),
            '1,0': no('M0'),
            '0,1': nc('X1'),
            '0,2': nc('X2'),
            '0,3': no('X3'),
            '0,4': out('M0'),
          },
          [{ row: 0, col: 1 }],
        ),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('a supervisor reaching into the weld shop is a validation error', () => {
    // The device space is flat, so nothing in the engine stops this. The
    // ownership declaration is the only thing that does, and it is the whole
    // discipline of writing a plant in sections.
    const validation = validateProgram(
      spec(),
      supervisor([
        R('run', 1, 2, { '0,0': no('X0'), '0,1': out('M0') }),
        lamp,
        held,
        R('meddle', 1, 2, { '0,0': no('M0'), '0,1': out('Y2') }),
      ]),
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('Y2');
  });
});

describe('validateProgram', () => {
  it('flags disallowed instructions', () => {
    const spec = getLadderPuzzle('direct-control')!; // timer not allowed here
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': timer('T0', 10) })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('not allowed'))).toBe(true);
  });

  it('flags a coil driving an input device kind', () => {
    const spec = getLadderPuzzle('direct-control')!;
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('X5') })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
  });
});

