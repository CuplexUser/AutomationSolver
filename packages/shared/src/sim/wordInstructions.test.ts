import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, PidParams, Rung } from '../ladder/types.js';
import { INT16_MAX, INT16_MIN } from '../ladder/types.js';
import { SimEngine } from './scanCycle.js';

/** One rung, one row: the elements in series left to right. */
function rung(id: string, els: (LadderElement | null)[]): Rung {
  return { id, rows: 1, cols: els.length, cells: [els], vlinks: [] };
}

function program(...rungs: Rung[]): LadderProgram {
  return { rungs };
}

const wire = (): LadderElement => ({ type: 'hwire', device: '' });
const no = (device: string): LadderElement => ({ type: 'contact-no', device });
const out = (device: string): LadderElement => ({ type: 'coil-out', device });
const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});
const math = (
  op: 'add' | 'sub' | 'mul' | 'div',
  a: string,
  b: string,
  device: string,
): LadderElement => ({ type: 'math', device, op, operands: [a, b] });
const cmp = (op: '=' | '<>' | '>' | '<' | '>=' | '<=', a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op,
  operands: [a, b],
});

describe('MOV', () => {
  it('loads a constant and copies a register', () => {
    const engine = new SimEngine(program(rung('r1', [mov('K1234', 'D0')]), rung('r2', [mov('D0', 'D1')])));
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(1234);
    expect(engine.getRegister('D1')).toBe(1234);
  });

  it('only writes while its rung conducts, which is what makes value selection work', () => {
    // The idiom two rungs of the motion puzzles will lean on: one MOV per
    // condition into the same destination, whichever rung is live wins.
    const engine = new SimEngine(
      program(rung('r1', [no('X0'), mov('K500', 'D0')]), rung('r2', [no('X1'), mov('K900', 'D0')])),
    );
    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(500);

    engine.setInput('X0', false);
    engine.setInput('X1', true);
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(900);

    // Neither condition: the last value is held, not cleared.
    engine.setInput('X1', false);
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(900);
  });

  it('reads a never-written register as zero', () => {
    const engine = new SimEngine(program(rung('r1', [mov('D77', 'D0')])));
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(0);
  });

  it('stacks after one condition: several writes, one contact', () => {
    // X0 --[MOV K10 D30]--[MOV K20 D33]--( Y0 )--
    const engine = new SimEngine(
      program(rung('r1', [no('X0'), mov('K10', 'D30'), mov('K20', 'D33'), out('Y0')])),
    );
    engine.scan(50);
    expect(engine.getRegister('D30')).toBe(0);
    expect(engine.getRegister('D33')).toBe(0);
    expect(engine.getBit('Y0')).toBe(false);

    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getRegister('D30')).toBe(10);
    expect(engine.getRegister('D33')).toBe(20);
    expect(engine.getBit('Y0')).toBe(true);
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, multiplies and truncates division toward zero', () => {
    const engine = new SimEngine(
      program(
        rung('r1', [mov('K100', 'D0')]),
        rung('r2', [math('add', 'D0', 'K5', 'D1')]),
        rung('r3', [math('sub', 'D0', 'K130', 'D2')]),
        rung('r4', [math('mul', 'D0', 'K3', 'D3')]),
        rung('r5', [math('div', 'K7', 'K2', 'D4')]),
        rung('r6', [math('div', 'K-7', 'K2', 'D5')]),
      ),
    );
    engine.scan(50);
    expect(engine.getRegister('D1')).toBe(105);
    expect(engine.getRegister('D2')).toBe(-30);
    expect(engine.getRegister('D3')).toBe(300);
    expect(engine.getRegister('D4')).toBe(3);
    expect(engine.getRegister('D5')).toBe(-3); // toward zero, not toward -inf
  });

  /**
   * The 16-bit ceiling is load bearing: it is why the hand-built P controller
   * puzzle uses whole-number gains, and why "divide before you multiply" is a
   * thing players have to learn rather than a detail the engine hides.
   */
  it('saturates rather than wrapping', () => {
    const engine = new SimEngine(
      program(
        rung('r1', [mov('K4000', 'D0')]),
        rung('r2', [math('mul', 'D0', 'K1000', 'D1')]),
        rung('r3', [math('mul', 'D0', 'K-1000', 'D2')]),
      ),
    );
    engine.scan(50);
    expect(engine.getRegister('D1')).toBe(INT16_MAX);
    expect(engine.getRegister('D2')).toBe(INT16_MIN);
  });

  it('leaves the destination alone on a divide by zero', () => {
    const engine = new SimEngine(
      program(rung('r1', [mov('K42', 'D1')]), rung('r2', [math('div', 'K100', 'D9', 'D1')])),
    );
    engine.scan(50);
    expect(engine.getRegister('D1')).toBe(42);
  });

  it('clears a register on RST', () => {
    const engine = new SimEngine(
      program(rung('r1', [mov('K42', 'D0')]), rung('r2', [no('X0'), { type: 'coil-reset', device: 'D0' }])),
    );
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(42);
    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getRegister('D0')).toBe(0);
  });
});

describe('compare contacts', () => {
  it('conducts on each operator', () => {
    const engine = new SimEngine(
      program(
        rung('r1', [mov('K500', 'D0')]),
        rung('r2', [cmp('=', 'D0', 'K500'), out('M0')]),
        rung('r3', [cmp('<>', 'D0', 'K500'), out('M1')]),
        rung('r4', [cmp('>', 'D0', 'K499'), out('M2')]),
        rung('r5', [cmp('<', 'D0', 'K500'), out('M3')]),
        rung('r6', [cmp('>=', 'D0', 'K500'), out('M4')]),
        rung('r7', [cmp('<=', 'D0', 'K499'), out('M5')]),
      ),
    );
    engine.scan(50);
    expect(engine.getBit('M0')).toBe(true);
    expect(engine.getBit('M1')).toBe(false);
    expect(engine.getBit('M2')).toBe(true);
    expect(engine.getBit('M3')).toBe(false);
    expect(engine.getBit('M4')).toBe(true);
    expect(engine.getBit('M5')).toBe(false);
  });

  it('puts a compare in series with a contact', () => {
    const engine = new SimEngine(
      program(rung('r1', [mov('K80', 'D0')]), rung('r2', [no('X0'), cmp('>', 'D0', 'K50'), out('Y0')])),
    );
    engine.scan(50);
    expect(engine.getBit('Y0')).toBe(false);
    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getBit('Y0')).toBe(true);
  });
});

describe('PID block', () => {
  const tuning = (over: Partial<PidParams> = {}): PidParams => ({
    kp: 100,
    ti: 0,
    td: 0,
    sampleMs: 100,
    outMin: 0,
    outMax: 4000,
    ...over,
  });

  const loop = (params: PidParams): LadderProgram =>
    program(rung('r1', [wire(), { type: 'pid', device: 'D20', operands: ['D10', 'D0'], pid: params }]));

  it('drives the output proportional to error, at gain', () => {
    const engine = new SimEngine(loop(tuning({ kp: 200 })));
    engine.setRegisters({ D10: 2000, D0: 1000 });
    engine.scan(50);
    // err 1000, gain 2.00
    expect(engine.getRegister('D20')).toBe(2000);
  });

  it('clamps to the configured output range', () => {
    const engine = new SimEngine(loop(tuning({ kp: 800, outMax: 4000 })));
    engine.setRegisters({ D10: 4000, D0: 0 });
    engine.scan(50);
    expect(engine.getRegister('D20')).toBe(4000);
  });

  it('flips the error sign when reverse acting', () => {
    const engine = new SimEngine(loop(tuning({ kp: 100, reverse: true, outMin: -4000 })));
    engine.setRegisters({ D10: 1000, D0: 2000 });
    engine.scan(50);
    expect(engine.getRegister('D20')).toBe(1000);
  });

  it('holds its output between samples and only recomputes on the sample tick', () => {
    const engine = new SimEngine(loop(tuning({ kp: 100, sampleMs: 200 })));
    engine.setRegisters({ D10: 2000, D0: 1000 });
    engine.scan(50); // first scan primes the loop
    expect(engine.getRegister('D20')).toBe(1000);

    engine.setRegisters({ D0: 1500 });
    engine.scan(50);
    expect(engine.getRegister('D20')).toBe(1000); // held: 100ms into a 200ms sample
    engine.scan(50);
    engine.scan(50);
    engine.scan(50);
    expect(engine.getRegister('D20')).toBe(500); // resampled: err is now 500
  });

  it('winds the integral in until the offset is gone', () => {
    const engine = new SimEngine(loop(tuning({ kp: 100, ti: 1000 })));
    engine.setRegisters({ D10: 2000, D0: 1900 });
    engine.scan(50);
    const first = engine.getRegister('D20');
    for (let i = 0; i < 40; i++) engine.scan(50);
    // Same error the whole time, so everything above the proportional term is
    // integral action accumulating.
    expect(engine.getRegister('D20')).toBeGreaterThan(first);
  });

  /**
   * Conditional integration. Without it, a loop held against its limit banks
   * error it must later unwind, and the classic symptom is an output that stays
   * pinned long after the process value has come back.
   */
  it('does not wind up while the output is against a limit', () => {
    const engine = new SimEngine(loop(tuning({ kp: 100, ti: 200, outMax: 1000 })));
    engine.setRegisters({ D10: 4000, D0: 0 });
    for (let i = 0; i < 100; i++) engine.scan(50); // 5s pinned at the limit
    expect(engine.getRegister('D20')).toBe(1000);

    // Process value arrives at setpoint: a wound-up loop would sit at the limit
    // for seconds, a well-behaved one comes off it on the next sample.
    engine.setRegisters({ D0: 4000 });
    engine.scan(50);
    engine.scan(50);
    engine.scan(50);
    expect(engine.getRegister('D20')).toBeLessThan(1000);
  });

  it('clears its state when the rung drops, so a de-energized loop cannot wind up', () => {
    const gated = program(
      rung('r1', [no('X0'), { type: 'pid', device: 'D20', operands: ['D10', 'D0'], pid: tuning({ kp: 100, ti: 200 }) }]),
    );
    const engine = new SimEngine(gated);
    engine.setRegisters({ D10: 4000, D0: 0 });
    for (let i = 0; i < 100; i++) engine.scan(50); // off the whole time

    engine.setInput('X0', true);
    engine.scan(50);
    // First live sample is proportional only; no banked integral from the wait.
    expect(engine.getRegister('D20')).toBe(4000);
  });
});
