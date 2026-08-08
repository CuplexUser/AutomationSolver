import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POU_ID,
  toProgram,
  toProject,
  type LadderElement,
  type LadderProgram,
  type LadderProject,
  type Rung,
} from '../ladder/types.js';
import { SimEngine } from './scanCycle.js';

function el(type: LadderElement['type'], device = '', preset?: number): LadderElement {
  return { type, device, preset };
}

/** A one-row rung of the given elements, left to right. */
function line(id: string, ...els: (LadderElement | null)[]): Rung {
  return { id, rows: 1, cols: els.length, cells: [els], vlinks: [] };
}

function run(engine: SimEngine, scans: number, dt = 50): void {
  for (let i = 0; i < scans; i++) engine.scan(dt);
}

describe('toProject / toProgram', () => {
  it('wraps a flat program as one POU under one every-scan task', () => {
    const program: LadderProgram = {
      rungs: [line('r1', el('contact-no', 'X0'), el('coil-out', 'Y0'))],
    };
    const project = toProject(program);

    expect(project.pous).toHaveLength(1);
    expect(project.pous[0].id).toBe(DEFAULT_POU_ID);
    expect(project.pous[0].rungs).toBe(program.rungs);
    expect(project.tasks).toHaveLength(1);
    expect(project.tasks[0].intervalMs).toBeUndefined();
    expect(project.tasks[0].pous).toEqual([DEFAULT_POU_ID]);
  });

  it('round-trips a single-POU project back to a flat program', () => {
    const program: LadderProgram = {
      rungs: [line('r1', el('contact-no', 'X0'), el('coil-out', 'Y0'))],
    };
    expect(toProgram(toProject(program)).rungs).toEqual(program.rungs);
  });

  it('leaves a project alone', () => {
    const project: LadderProject = { pous: [], tasks: [] };
    expect(toProject(project)).toBe(project);
  });
});

describe('SimEngine — a single-POU project is the flat program', () => {
  // The whole backward-compatibility claim in one test: the same rungs, run
  // both ways, must agree scan for scan. Every shipped puzzle rides on it.
  const rungs = [
    line('r1', el('contact-no', 'X0'), el('timer', 'T0', 4)),
    line('r2', el('contact-rising', 'T0'), el('coil-set', 'M0')),
    line('r3', el('contact-no', 'M0'), el('coil-out', 'Y0')),
  ];

  it('produces an identical bit trace', () => {
    const flat = new SimEngine({ rungs });
    const wrapped = new SimEngine(toProject({ rungs }));

    for (let i = 0; i < 20; i++) {
      const x0 = i >= 2;
      flat.setInput('X0', x0);
      wrapped.setInput('X0', x0);
      flat.scan(50);
      wrapped.scan(50);
      expect(wrapped.snapshot().bits).toEqual(flat.snapshot().bits);
      expect(wrapped.snapshot().timers).toEqual(flat.snapshot().timers);
    }
  });
});

/**
 * A two-task project: MAIN every scan, SLOW every 200 ms.
 *
 * `TICK` counts SLOW's executions by latching a counter off its own scan, and
 * `MIRROR` is MAIN copying X0 straight to Y0 so the two rates are visible in one
 * trace.
 */
function twoTaskProject(): LadderProject {
  return {
    pous: [
      { id: 'fast', name: 'MAIN_POU', rungs: [line('r1', el('contact-no', 'X0'), el('coil-out', 'Y0'))] },
      { id: 'slow', name: 'SLOW_POU', rungs: [line('r1', el('hwire'), el('counter', 'C0', 9999))] },
    ],
    tasks: [
      { id: 'main', name: 'MAIN', priority: 0, pous: ['fast'] },
      { id: 'slow', name: 'SLOW', intervalMs: 200, priority: 1, pous: ['slow'] },
    ],
  };
}

describe('SimEngine — task scheduling', () => {
  it('runs a periodic task on the first scan and then every interval', () => {
    const e = new SimEngine(twoTaskProject());
    // A counter counts rising edges of its own rung, and this rung is always
    // live, so it ticks exactly once — on the task's first execution. What the
    // schedule is doing is easier to read off the rung results.
    const ran: number[] = [];
    for (let i = 0; i < 21; i++) {
      const before = e.resultsFor('slow');
      e.scan(50);
      if (e.resultsFor('slow') !== before) ran.push(i);
    }
    // dt=50, interval=200 -> due at t = 0, 200, 400, 600, 800, 1000 ms,
    // which are scans 0, 4, 8, 12, 16, 20.
    expect(ran).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it('runs an interval-less task on every scan', () => {
    const e = new SimEngine(twoTaskProject());
    e.setInput('X0', true);
    e.scan(50);
    expect(e.getBit('Y0')).toBe(true);
    e.setInput('X0', false);
    e.scan(50);
    expect(e.getBit('Y0')).toBe(false);
  });

  it('holds a slow POU’s rung results between executions', () => {
    const e = new SimEngine(twoTaskProject());
    e.scan(50);
    const first = e.resultsFor('slow');
    expect(first).toHaveLength(1);
    e.scan(50); // not due
    expect(e.resultsFor('slow')).toBe(first);
  });

  it('runs tasks in priority order within one scan', () => {
    // LOW priority writes M0; HIGH priority reads it into Y0. Running HIGH
    // first means Y0 lags M0 by a scan, which is the entire reason task order
    // is content rather than trivia.
    const project: LadderProject = {
      pous: [
        { id: 'writer', name: 'WRITER', rungs: [line('r1', el('contact-no', 'X0'), el('coil-out', 'M0'))] },
        { id: 'reader', name: 'READER', rungs: [line('r1', el('contact-no', 'M0'), el('coil-out', 'Y0'))] },
      ],
      tasks: [
        { id: 'a', name: 'READ_FIRST', priority: 0, pous: ['reader'] },
        { id: 'b', name: 'WRITE_SECOND', priority: 1, pous: ['writer'] },
      ],
    };
    const e = new SimEngine(project);
    e.setInput('X0', true);
    e.scan(50);
    expect(e.getBit('M0')).toBe(true);
    expect(e.getBit('Y0')).toBe(false); // read before the write: one scan late
    e.scan(50);
    expect(e.getBit('Y0')).toBe(true);
  });

  it('runs POUs within a task in call order', () => {
    const pous = [
      { id: 'writer', name: 'WRITER', rungs: [line('r1', el('contact-no', 'X0'), el('coil-out', 'M0'))] },
      { id: 'reader', name: 'READER', rungs: [line('r1', el('contact-no', 'M0'), el('coil-out', 'Y0'))] },
    ];
    const writeFirst = new SimEngine({
      pous,
      tasks: [{ id: 't', name: 'MAIN', priority: 0, pous: ['writer', 'reader'] }],
    });
    writeFirst.setInput('X0', true);
    writeFirst.scan(50);
    expect(writeFirst.getBit('Y0')).toBe(true);

    const readFirst = new SimEngine({
      pous,
      tasks: [{ id: 't', name: 'MAIN', priority: 0, pous: ['reader', 'writer'] }],
    });
    readFirst.setInput('X0', true);
    readFirst.scan(50);
    expect(readFirst.getBit('Y0')).toBe(false);
  });
});

describe('SimEngine — a task’s dt is its own period', () => {
  it('advances a timer in a 200 ms task by 200 ms per execution', () => {
    // K10 = 1.0 s. On a 200 ms task that is five executions, not twenty scans.
    const project: LadderProject = {
      pous: [
        {
          id: 'slow',
          name: 'SLOW_POU',
          rungs: [
            line('r1', el('contact-no', 'X0'), el('timer', 'T0', 10)),
            line('r2', el('contact-no', 'T0'), el('coil-out', 'Y0')),
          ],
        },
      ],
      tasks: [{ id: 'slow', name: 'SLOW', intervalMs: 200, priority: 0, pous: ['slow'] }],
    };
    const e = new SimEngine(project);
    e.setInput('X0', true);

    // Executions at t = 0, 200, 400, 600, 800 -> elapsed reaches 1000 ms on the
    // fifth, which lands on scan 16 (t = 800 ms).
    run(e, 16);
    expect(e.getBit('T0')).toBe(false);
    e.scan(50); // scan 16 is t=800: the fifth execution
    expect(e.getBit('T0')).toBe(true);
    expect(e.getBit('Y0')).toBe(true);
    expect(e.snapshot().timers['T0'].elapsed).toBe(1000);
  });
});

describe('SimEngine — per-task edge detection', () => {
  // The same rising-edge contact on X0 in both a fast and a slow task. Each has
  // its own input image, so neither can consume the other's edge.
  const project: LadderProject = {
    pous: [
      { id: 'fast', name: 'FAST_POU', rungs: [line('r1', el('contact-rising', 'X0'), el('counter', 'C0', 9999))] },
      { id: 'slow', name: 'SLOW_POU', rungs: [line('r1', el('contact-rising', 'X0'), el('counter', 'C1', 9999))] },
    ],
    tasks: [
      { id: 'main', name: 'MAIN', priority: 0, pous: ['fast'] },
      { id: 'slow', name: 'SLOW', intervalMs: 200, priority: 1, pous: ['slow'] },
    ],
  };

  it('lets both tasks see the same edge exactly once', () => {
    const e = new SimEngine(project);
    e.setInput('X0', false);
    run(e, 4); // t = 0..150; SLOW ran at t=0 with X0 low
    e.setInput('X0', true); // rises and stays high
    run(e, 12);

    expect(e.snapshot().counters['C0'].count).toBe(1);
    expect(e.snapshot().counters['C1'].count).toBe(1);
  });

  it('does not let a slow task fire twice on one edge', () => {
    const e = new SimEngine(project);
    e.setInput('X0', true); // high from the very first scan
    run(e, 20);
    // The first execution of each task sees prev=false (empty image), so the
    // edge fires once there and never again while X0 stays high.
    expect(e.snapshot().counters['C1'].count).toBe(1);
  });
});
