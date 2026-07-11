import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung } from '../ladder/types.js';
import { SimEngine } from './scanCycle.js';

function el(type: LadderElement['type'], device = '', preset?: number): LadderElement {
  return { type, device, preset };
}

function rung(
  id: string,
  rows: number,
  cols: number,
  fill: (r: number, c: number) => LadderElement | null,
  vlinks: { row: number; col: number }[] = [],
): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => fill(r, c)),
  );
  return { id, rows, cols, cells, vlinks };
}

/** Run several scans holding current inputs. */
function run(engine: SimEngine, scans: number, dt = 50): void {
  for (let i = 0; i < scans; i++) engine.scan(dt);
}

describe('SimEngine — start/stop seal-in', () => {
  // (X0 start OR Y0 seal) AND X1(NC stop) -> Y0
  const program: LadderProgram = {
    rungs: [
      rung(
        'r1',
        2,
        3,
        (r, c) => {
          if (r === 0 && c === 0) return el('contact-no', 'X0'); // start
          if (r === 1 && c === 0) return el('contact-no', 'Y0'); // seal
          if (r === 0 && c === 1) return el('contact-nc', 'X1'); // stop (NC)
          if (r === 0 && c === 2) return el('coil-out', 'Y0');
          return null;
        },
        [{ row: 0, col: 1 }],
      ),
    ],
  };

  it('latches on start and seals in after release', () => {
    const e = new SimEngine(program);
    e.setInput('X1', false); // stop not pressed
    e.setInput('X0', false);
    run(e, 2);
    expect(e.getBit('Y0')).toBe(false);

    e.setInput('X0', true); // press start
    run(e, 2);
    expect(e.getBit('Y0')).toBe(true);

    e.setInput('X0', false); // release start -> seal holds
    run(e, 2);
    expect(e.getBit('Y0')).toBe(true);

    e.setInput('X1', true); // press stop
    run(e, 2);
    expect(e.getBit('Y0')).toBe(false);

    e.setInput('X1', false); // release stop -> stays off
    run(e, 2);
    expect(e.getBit('Y0')).toBe(false);
  });
});

describe('SimEngine — on-delay timer', () => {
  // rung1: X0 -> T0 (K10 = 1000ms).  rung2: T0 -> Y0
  const program: LadderProgram = {
    rungs: [
      rung('r1', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'X0') : el('timer', 'T0', 10))),
      rung('r2', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'T0') : el('coil-out', 'Y0'))),
    ],
  };

  it('energizes Y0 only after preset elapses', () => {
    const e = new SimEngine(program);
    e.setInput('X0', true);
    run(e, 10, 50); // 500ms < 1000ms
    expect(e.getBit('T0')).toBe(false);
    expect(e.getBit('Y0')).toBe(false);
    run(e, 12, 50); // now well past 1000ms total
    expect(e.getBit('T0')).toBe(true);
    expect(e.getBit('Y0')).toBe(true);
  });

  it('resets when input drops before preset', () => {
    const e = new SimEngine(program);
    e.setInput('X0', true);
    run(e, 10, 50); // 500ms
    e.setInput('X0', false);
    run(e, 2, 50);
    expect(e.getBit('T0')).toBe(false);
    e.setInput('X0', true);
    run(e, 10, 50); // only 500ms again since reset
    expect(e.getBit('T0')).toBe(false);
  });
});

describe('SimEngine — counter', () => {
  // rung1: X0 (rising via counter's own edge) -> C0 K3.  rung2: C0 -> Y0. rung3: X1 -> RST C0
  const program: LadderProgram = {
    rungs: [
      rung('r1', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'X0') : el('counter', 'C0', 3))),
      rung('r2', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'C0') : el('coil-out', 'Y0'))),
      rung('r3', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'X1') : el('coil-reset', 'C0'))),
    ],
  };

  it('counts rising edges and sets done at preset', () => {
    const e = new SimEngine(program);
    const press = () => {
      e.setInput('X0', true);
      run(e, 1);
      e.setInput('X0', false);
      run(e, 1);
    };
    press();
    press();
    expect(e.getBit('C0')).toBe(false);
    press(); // third
    expect(e.getBit('C0')).toBe(true);
    expect(e.getBit('Y0')).toBe(true);

    // reset
    e.setInput('X1', true);
    run(e, 1);
    e.setInput('X1', false);
    run(e, 1);
    expect(e.getBit('C0')).toBe(false);
    expect(e.getBit('Y0')).toBe(false);
  });
});

describe('SimEngine — rising-edge contact', () => {
  // X0 rising -> SET M0 ; then coil Y0 mirrors M0 stays latched
  const program: LadderProgram = {
    rungs: [
      rung('r1', 1, 2, (_, c) => (c === 0 ? el('contact-rising', 'X0') : el('coil-set', 'M0'))),
      rung('r2', 1, 2, (_, c) => (c === 0 ? el('contact-no', 'M0') : el('coil-out', 'Y0'))),
    ],
  };

  it('fires once on the leading edge and latches M0', () => {
    const e = new SimEngine(program);
    e.setInput('X0', false);
    run(e, 2);
    expect(e.getBit('M0')).toBe(false);
    e.setInput('X0', true); // rising edge
    e.scan(50);
    expect(e.getBit('M0')).toBe(true);
    expect(e.getBit('Y0')).toBe(true);
    // holding X0 high does not "un-set"; M0 stays latched
    run(e, 5);
    expect(e.getBit('M0')).toBe(true);
  });
});
