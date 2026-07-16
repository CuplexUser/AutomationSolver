import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung, VLink } from '../ladder/types.js';
import { getPuzzle } from './content/index.js';
import { gradeProgram, traceScenario } from './grade.js';
import { validateProgram } from './validate.js';
import type { LadderPuzzleSpec } from './types.js';

/** Every puzzle in this file is a ladder puzzle; fail loudly if that changes. */
function getLadderPuzzle(slug: string): LadderPuzzleSpec | undefined {
  const spec = getPuzzle(slug);
  if (!spec) return undefined;
  if (spec.kind !== 'ladder') throw new Error(`puzzle ${slug} is not a ladder puzzle`);
  return spec;
}

// --- tiny ladder builders -------------------------------------------------
const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const rise = (d: string): LadderElement => ({ type: 'contact-rising', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });
const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });
const wire: LadderElement = { type: 'hwire', device: '' };

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

// 5-floor call-dispatch core shared by every elevator5 puzzle: latches each
// call button, cascades "call pending above/below floor N", sets/clears the
// Up/Down latches per floor (stopping only where the floor's own call is
// still pending — tested before the clear rungs below it — so a further call
// beyond it can't suppress the stop), then clears the call and drives the
// motors. See docs on '09-elevator-dispatch' for the full design rationale.
function dispatchCore(): Rung[] {
  return [
    R('r1', 1, 2, { '0,0': no('X0'), '0,1': set('M0') }),
    R('r2', 1, 2, { '0,0': no('X1'), '0,1': set('M1') }),
    R('r3', 1, 2, { '0,0': no('X2'), '0,1': set('M2') }),
    R('r4', 1, 2, { '0,0': no('X3'), '0,1': set('M3') }),
    R('r5', 1, 2, { '0,0': no('X4'), '0,1': set('M4') }),
    R('r6', 2, 2, { '0,0': no('M3'), '0,1': out('M11'), '1,0': no('M4') }, [{ row: 0, col: 1 }]), // Above(3)
    R('r7', 2, 2, { '0,0': no('M2'), '0,1': out('M12'), '1,0': no('M11') }, [{ row: 0, col: 1 }]), // Above(2)
    R('r8', 2, 2, { '0,0': no('M1'), '0,1': out('M13'), '1,0': no('M12') }, [{ row: 0, col: 1 }]), // Above(1)
    R('r9', 2, 2, { '0,0': no('M0'), '0,1': out('M15'), '1,0': no('M1') }, [{ row: 0, col: 1 }]), // Below(3)
    R('r10', 2, 2, { '0,0': no('M15'), '0,1': out('M16'), '1,0': no('M2') }, [{ row: 0, col: 1 }]), // Below(4)
    R('r11', 2, 2, { '0,0': no('M16'), '0,1': out('M17'), '1,0': no('M3') }, [{ row: 0, col: 1 }]), // Below(5)
    R('r12', 4, 3, {
      '0,0': no('X10'), '0,1': no('M13'), '0,2': set('M5'),
      '1,0': no('X11'), '1,1': no('M12'), '1,2': set('M5'),
      '2,0': no('X12'), '2,1': no('M11'), '2,2': set('M5'),
      '3,0': no('X13'), '3,1': no('M4'), '3,2': set('M5'),
    }),
    R('r13', 4, 4, {
      '0,0': no('X11'), '0,1': nc('M12'), '0,2': no('M0'), '0,3': set('M6'),
      '1,0': no('X12'), '1,1': nc('M11'), '1,2': no('M15'), '1,3': set('M6'),
      '2,0': no('X13'), '2,1': nc('M4'), '2,2': no('M16'), '2,3': set('M6'),
      '3,0': no('X14'), '3,1': wire, '3,2': no('M17'), '3,3': set('M6'),
    }),
    R('r14', 4, 3, {
      '0,0': no('X11'), '0,1': no('M1'), '0,2': rst('M5'),
      '1,0': no('X12'), '1,1': no('M2'), '1,2': rst('M5'),
      '2,0': no('X13'), '2,1': no('M3'), '2,2': rst('M5'),
      '3,0': no('X14'), '3,1': wire, '3,2': rst('M5'),
    }),
    R('r15', 4, 3, {
      '0,0': no('X10'), '0,1': wire, '0,2': rst('M6'),
      '1,0': no('X11'), '1,1': no('M1'), '1,2': rst('M6'),
      '2,0': no('X12'), '2,1': no('M2'), '2,2': rst('M6'),
      '3,0': no('X13'), '3,1': no('M3'), '3,2': rst('M6'),
    }),
    R('r16', 1, 2, { '0,0': no('X10'), '0,1': rst('M0') }),
    R('r17', 1, 2, { '0,0': no('X11'), '0,1': rst('M1') }),
    R('r18', 1, 2, { '0,0': no('X12'), '0,1': rst('M2') }),
    R('r19', 1, 2, { '0,0': no('X13'), '0,1': rst('M3') }),
    R('r20', 1, 2, { '0,0': no('X14'), '0,1': rst('M4') }),
    R('r21', 1, 2, { '0,0': no('M5'), '0,1': out('Y0') }),
    R('r22', 1, 2, { '0,0': no('M6'), '0,1': out('Y1') }),
  ];
}

// Door subsystem shared by elevator5 puzzles that wire Y2/X15/X16: opens on a
// genuine-stop rising edge, dwells for the timer preset, then auto-closes.
function doorRungs(): Rung[] {
  return [
    R('r23', 5, 4, {
      '0,0': rise('X10'), '0,1': nc('M5'), '0,2': nc('M6'), '0,3': set('M20'),
      '1,0': rise('X11'), '1,1': nc('M5'), '1,2': nc('M6'), '1,3': set('M20'),
      '2,0': rise('X12'), '2,1': nc('M5'), '2,2': nc('M6'), '2,3': set('M20'),
      '3,0': rise('X13'), '3,1': nc('M5'), '3,2': nc('M6'), '3,3': set('M20'),
      '4,0': rise('X14'), '4,1': nc('M5'), '4,2': nc('M6'), '4,3': set('M20'),
    }),
    R('r24', 1, 2, { '0,0': no('M20'), '0,1': out('Y2') }),
    R('r25', 1, 2, { '0,0': no('X15'), '0,1': timer('T1', 30) }),
    R('r26', 1, 2, { '0,0': no('T1'), '0,1': rst('M20') }),
  ];
}

// Packer front end shared by pack-group / pack-lift / pack-full: one sealed
// full 2-pack stroke per matched pair — gated on the 4-pack cylinder being home
// (its rod crosses section 2) and on the pair count being incomplete — with C0
// counting strokes off the OUT sensor and loading the lift on completion.
function packFrontEnd(): Rung[] {
  return [
    R(
      'pp1',
      2,
      6,
      {
        '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X2'), '0,3': nc('C0'),
        '0,4': nc('X1'), '0,5': out('Y0'),
        '1,0': no('Y0'), '1,1': wire, '1,2': wire, '1,3': wire,
      },
      [{ row: 0, col: 4 }],
    ),
    R('pp2', 1, 2, { '0,0': no('X1'), '0,1': counter('C0', 2) }),
    R('pp3', 1, 3, { '0,0': no('C0'), '0,1': no('X4'), '0,2': out('Y1') }),
    R('pp4', 1, 2, { '0,0': no('X3'), '0,1': rst('C0') }),
  ];
}

// Lift/flip cycle: latch a flip request when the 4-pack pusher reaches OUT
// (the group is on the platform), release it at the top so the lift lowers.
// The process itself holds the lift down until the 4-pack rod is home again.
function packFlip(): Rung[] {
  return [
    R('pl1', 1, 2, { '0,0': no('X3'), '0,1': set('M0') }),
    R('pl2', 1, 2, { '0,0': no('M0'), '0,1': out('Y2') }),
    R('pl3', 1, 2, { '0,0': no('X5'), '0,1': rst('M0') }),
  ];
}

// Shipping back end: count flips on C1 (K4 = 16 boxes in section 3); once the
// lift settles back down, run a one-hot step chain M1..M6 — back-stop forward,
// 16-pack-1 full stroke and home, back-stop released, 16-pack-2 full stroke and
// home. C1 resets as the chain starts so flips for the NEXT pack count afresh.
function packShip(): Rung[] {
  // "step relay AND its end sensor" hand-off: SET the next relay, RST this one.
  const step = (id: string, m: string, sensor: string, nextM: string | null): Rung =>
    nextM
      ? R(
          id,
          2,
          3,
          { '0,0': no(m), '0,1': no(sensor), '0,2': set(nextM), '1,2': rst(m) },
          [{ row: 0, col: 2 }],
        )
      : R(id, 1, 3, { '0,0': no(m), '0,1': no(sensor), '0,2': rst(m) });
  return [
    R('ps1', 1, 2, { '0,0': no('X5'), '0,1': counter('C1', 4) }),
    R(
      'ps2',
      2,
      3,
      { '0,0': rise('X4'), '0,1': no('C1'), '0,2': set('M1'), '1,2': rst('C1') },
      [{ row: 0, col: 2 }],
    ),
    // Back-stop forward across steps 1-3 (receiving and squaring the pack).
    R(
      'ps3',
      3,
      2,
      { '0,0': no('M1'), '1,0': no('M2'), '2,0': no('M3'), '0,1': out('Y5') },
      [{ row: 0, col: 1 }, { row: 1, col: 1 }],
    ),
    R('ps4', 1, 2, { '0,0': no('M2'), '0,1': out('Y3') }),
    R('ps5', 1, 2, { '0,0': no('M5'), '0,1': out('Y4') }),
    step('ps6', 'M1', 'X13', 'M2'),
    step('ps7', 'M2', 'X7', 'M3'),
    step('ps8', 'M3', 'X6', 'M4'),
    step('ps9', 'M4', 'X12', 'M5'),
    step('ps10', 'M5', 'X11', 'M6'),
    step('ps11', 'M6', 'X10', null),
  ];
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
  'run-on-timer': {
    rungs: [
      // Motor seal-in: (X0 OR Y0) AND NOT X1 -> Y0
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('Y0'), '0,1': nc('X1'), '0,2': out('Y0') },
        [{ row: 0, col: 1 }],
      ),
      // Fan seal-in: (Y0 OR (Y1 AND NOT T0)) -> Y1 — follows the motor, then holds
      // itself until the run-on timer finishes.
      R(
        'r2',
        2,
        3,
        { '0,0': no('Y0'), '0,1': wire, '0,2': out('Y1'), '1,0': no('Y1'), '1,1': nc('T0') },
        [{ row: 0, col: 2 }],
      ),
      // Run-on timer counts only while the fan is on but the motor is off.
      R('r3', 1, 3, { '0,0': no('Y1'), '0,1': nc('Y0'), '0,2': timer('T0', 30) }),
    ],
  },
  flasher: {
    rungs: [
      // Two-timer oscillator: T0 times the on-phase, T1 the off-phase.
      R('r1', 1, 3, { '0,0': no('X0'), '0,1': nc('T1'), '0,2': timer('T0', 10) }),
      R('r2', 1, 2, { '0,0': no('T0'), '0,1': timer('T1', 10) }),
      // Beacon lit while enabled and T0 has not yet completed its phase.
      R('r3', 1, 3, { '0,0': no('X0'), '0,1': nc('T0'), '0,2': out('Y0') }),
    ],
  },
  'two-hand-press': {
    rungs: [
      // Advance only with both palms + healthy e-stop, and not already latched-done.
      R('r1', 1, 5, {
        '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X2'), '0,3': nc('M0'), '0,4': out('Y0'),
      }),
      R('r2', 1, 2, { '0,0': no('X3'), '0,1': set('M0') }), // latch done at bottom
      R('r3', 1, 3, { '0,0': nc('X0'), '0,1': nc('X1'), '0,2': rst('M0') }), // clear on both released
      R('r4', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }), // stroke-complete lamp
    ],
  },
  'pack-basics': {
    rungs: [
      // Seal a full stroke on a matched pair: (X14·X15 OR Y0) AND NOT X1 → Y0.
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X14'), '0,1': no('X15'), '0,2': nc('X1'), '0,3': out('Y0'),
          '1,0': no('Y0'), '1,1': wire,
        },
        [{ row: 0, col: 2 }],
      ),
    ],
  },
  'pack-group': { rungs: packFrontEnd() },
  'pack-lift': { rungs: [...packFrontEnd(), ...packFlip()] },
  'pack-full': { rungs: [...packFrontEnd(), ...packFlip(), ...packShip()] },
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
  'elevator-5-dispatch': { rungs: dispatchCore() },
  'elevator-doors': { rungs: [...dispatchCore(), ...doorRungs()] },
  'elevator-full': {
    rungs: [
      ...dispatchCore(),
      ...doorRungs(),
      // Any call pending, anywhere (a 5-way OR merged via vlinks into one coil).
      R(
        'r27',
        5,
        2,
        { '0,0': no('M0'), '1,0': no('M1'), '2,0': no('M2'), '3,0': no('M3'), '4,0': no('M4'), '4,1': out('M21') },
        [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }],
      ),
      // Idle away from floor 1, nothing pending, not mid-trip -> count 10 s.
      R('r28', 1, 5, {
        '0,0': nc('X10'), '0,1': nc('M21'), '0,2': nc('M5'), '0,3': nc('M6'), '0,4': timer('T2', 100),
      }),
      // Treat the timeout exactly like a floor-1 call — dispatch/doors already
      // know what to do with one.
      R('r29', 1, 2, { '0,0': no('T2'), '0,1': set('M0') }),
    ],
  },
};

describe('gradeProgram — canonical solutions solve every puzzle', () => {
  for (const [slug, program] of Object.entries(solutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getLadderPuzzle(slug);
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
