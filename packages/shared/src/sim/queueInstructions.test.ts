import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, LadderProject, Rung } from '../ladder/types.js';
import { SimEngine } from './scanCycle.js';

/** One rung, one row: the elements in series left to right. */
function rung(id: string, els: (LadderElement | null)[]): Rung {
  return { id, rows: 1, cols: els.length, cells: [els], vlinks: [] };
}
function program(...rungs: Rung[]): LadderProgram {
  return { rungs };
}

const no = (device: string): LadderElement => ({ type: 'contact-no', device });
const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});
const add = (a: string, b: string, device: string): LadderElement => ({
  type: 'math',
  op: 'add',
  device,
  operands: [a, b],
});
const cmp = (a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op: '=',
  operands: [a, b],
});
const out = (device: string): LadderElement => ({ type: 'coil-out', device });
const rst = (device: string): LadderElement => ({ type: 'coil-reset', device });
const sfwr = (data: string, head: string, n: number): LadderElement => ({
  type: 'sfwr',
  device: head,
  operands: [data],
  preset: n,
});
const sfrd = (head: string, into: string, n: number): LadderElement => ({
  type: 'sfrd',
  device: head,
  operands: [into],
  preset: n,
});
const pop = (head: string, into: string, n: number): LadderElement => ({
  type: 'pop',
  device: head,
  operands: [into],
  preset: n,
});

/** Pulse an input for one scan, then release it for one. */
function pulse(engine: SimEngine, input: string): void {
  engine.setInput(input, true);
  engine.scan(50);
  engine.setInput(input, false);
  engine.scan(50);
}

function table(engine: SimEngine, head: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => engine.getRegister(`D${head + i}`));
}

describe('index registers', () => {
  it('are written like any word and offset the operand they index', () => {
    const engine = new SimEngine(
      program(
        rung('r1', [mov('K2', 'Z0')]),
        rung('r2', [mov('K77', 'D100Z0')]),
        rung('r3', [mov('D100Z0', 'D50')]),
        rung('r4', [add('Z0', 'K1', 'Z1')]),
      ),
    );
    engine.scan(50);
    expect(engine.getRegister('Z0')).toBe(2);
    expect(engine.getRegister('D102')).toBe(77);
    expect(engine.getRegister('D50')).toBe(77);
    expect(engine.getRegister('Z1')).toBe(3);
    expect(engine.opDiagnostics.errors).toBe(0);
  });

  it('walk a table one entry per value of the index', () => {
    // The idiom that replaces a compare per entry: one indexed MOV serves them all.
    const engine = new SimEngine(program(rung('r1', [mov('D10', 'Z0')]), rung('r2', [mov('D200Z0', 'D1')])));
    for (let i = 0; i < 4; i++) engine.setRegister(`D${200 + i}`, 10 * (i + 1));
    for (let i = 0; i < 4; i++) {
      engine.setRegister('D10', i);
      engine.scan(50);
      expect(engine.getRegister('D1')).toBe(10 * (i + 1));
    }
  });

  it('refuse an indexed address outside the register file: nothing written, error recorded', () => {
    const engine = new SimEngine(
      program(
        rung('r1', [mov('K-5', 'Z0')]),
        rung('r2', [mov('K9', 'D1Z0')]),
        rung('r3', [cmp('D1Z0', 'K0'), out('Y0')]),
      ),
    );
    engine.scan(50);
    expect(engine.getBit('Y0')).toBe(false);
    expect(engine.opDiagnostics.errors).toBe(2);
    expect(engine.opDiagnostics.firstError).toMatchObject({
      code: 'index-range',
      pouId: 'main',
      rungIndex: 1,
      row: 0,
      col: 0,
    });
  });

  it('are cleared by RST like a data register', () => {
    const engine = new SimEngine(program(rung('r1', [mov('K4', 'Z3')]), rung('r2', [no('X0'), rst('Z3')])));
    engine.scan(50);
    expect(engine.getRegister('Z3')).toBe(4);
    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getRegister('Z3')).toBe(0);
  });

  it('cannot push an indexed write onto a protected register', () => {
    const engine = new SimEngine(program(rung('r1', [mov('K3', 'Z0')]), rung('r2', [mov('K1', 'D0Z0')])), {
      protectedRegisters: new Set(['D3']),
    });
    engine.scan(50);
    expect(engine.getRegister('D3')).toBe(0);
    expect(engine.opDiagnostics.firstError?.code).toBe('protected');
  });
});

describe('SFWRP / SFRDP: a FIFO the FX way', () => {
  const fifo = () =>
    new SimEngine(
      program(rung('w', [no('X0'), sfwr('D10', 'D200', 5)]), rung('r', [no('X1'), sfrd('D200', 'D20', 5)])),
    );

  it('keeps the pointer at the head and the entries after it; n counts the pointer', () => {
    const engine = fifo();
    for (const v of [11, 22, 33]) {
      engine.setRegister('D10', v);
      pulse(engine, 'X0');
    }
    expect(table(engine, 200, 5)).toEqual([3, 11, 22, 33, 0]);
  });

  it('writes once per rising edge, however long the rung stays on', () => {
    const engine = fifo();
    engine.setRegister('D10', 5);
    engine.setInput('X0', true);
    for (let i = 0; i < 10; i++) engine.scan(50);
    expect(engine.getRegister('D200')).toBe(1);
  });

  it('refuses a write to a full table with a notice, not an error', () => {
    const engine = fifo();
    for (const v of [1, 2, 3, 4, 5]) {
      engine.setRegister('D10', v);
      pulse(engine, 'X0');
    }
    expect(table(engine, 200, 5)).toEqual([4, 1, 2, 3, 4]);
    expect(engine.opDiagnostics).toMatchObject({ errors: 0, notices: 1 });
  });

  it('reads the oldest entry, shifts the rest down and leaves the last word as it was', () => {
    const engine = fifo();
    for (const v of [11, 22, 33, 44]) {
      engine.setRegister('D10', v);
      pulse(engine, 'X0');
    }
    pulse(engine, 'X1');
    expect(engine.getRegister('D20')).toBe(11);
    expect(table(engine, 200, 5)).toEqual([3, 22, 33, 44, 44]);
    pulse(engine, 'X1');
    expect(engine.getRegister('D20')).toBe(22);
  });

  it('does nothing reading an empty table', () => {
    const engine = fifo();
    engine.setRegister('D20', 99);
    pulse(engine, 'X1');
    expect(engine.getRegister('D20')).toBe(99);
    expect(engine.opDiagnostics).toMatchObject({ errors: 0, notices: 0 });
  });

  it('refuses a corrupt pointer without touching the table', () => {
    const engine = fifo();
    engine.setRegister('D200', 9);
    engine.setRegister('D10', 1);
    pulse(engine, 'X0');
    expect(table(engine, 200, 5)).toEqual([9, 0, 0, 0, 0]);
    expect(engine.opDiagnostics.firstError?.code).toBe('queue-pointer');
  });

  it('serves several tables from one routine through an indexed head', () => {
    // Lane k's table at D200 + 10k: one pair of rungs, whatever the lane count.
    const engine = new SimEngine(
      program(
        rung('lane', [mov('D5', 'Z0')]),
        rung('w', [no('X0'), sfwr('D10', 'D200Z0', 5)]),
        rung('r', [no('X1'), sfrd('D200Z0', 'D20', 5)]),
      ),
    );
    engine.setRegister('D5', 10);
    engine.setRegister('D10', 7);
    pulse(engine, 'X0');
    engine.setRegister('D5', 0);
    engine.setRegister('D10', 8);
    pulse(engine, 'X0');
    expect(table(engine, 200, 2)).toEqual([1, 8]);
    expect(table(engine, 210, 2)).toEqual([1, 7]);
    engine.setRegister('D5', 10);
    pulse(engine, 'X1');
    expect(engine.getRegister('D20')).toBe(7);
  });

  it('refuses a table that runs past D9999', () => {
    const engine = new SimEngine(program(rung('w', [no('X0'), sfwr('K1', 'D9998', 5)])));
    pulse(engine, 'X0');
    expect(engine.opDiagnostics.firstError?.code).toBe('queue-range');
  });

  it('refuses to write a table over a protected register', () => {
    const engine = new SimEngine(program(rung('w', [no('X0'), sfwr('K1', 'D200', 5)])), {
      protectedRegisters: new Set(['D203']),
    });
    pulse(engine, 'X0');
    expect(engine.getRegister('D200')).toBe(0);
    expect(engine.opDiagnostics.firstError?.code).toBe('protected');
  });

  it('hands a read to the next block on the same rung within the scan', () => {
    const engine = new SimEngine(
      program(
        rung('w', [no('X0'), sfwr('K42', 'D200', 5)]),
        rung('r', [no('X1'), sfrd('D200', 'D20', 5), mov('D20', 'D21')]),
      ),
    );
    pulse(engine, 'X0');
    engine.setInput('X1', true);
    engine.scan(50);
    expect(engine.getRegister('D21')).toBe(42);
  });
});

describe('POPP: a LIFO', () => {
  it('reads the newest entry and leaves the word it read', () => {
    const engine = new SimEngine(
      program(rung('w', [no('X0'), sfwr('D10', 'D300', 5)]), rung('p', [no('X1'), pop('D300', 'D30', 5)])),
    );
    for (const v of [1, 2, 3]) {
      engine.setRegister('D10', v);
      pulse(engine, 'X0');
    }
    pulse(engine, 'X1');
    expect(engine.getRegister('D30')).toBe(3);
    expect(table(engine, 300, 5)).toEqual([2, 1, 2, 3, 0]);
    pulse(engine, 'X1');
    expect(engine.getRegister('D30')).toBe(2);
    pulse(engine, 'X1');
    pulse(engine, 'X1');
    expect(engine.getRegister('D30')).toBe(1);
    expect(engine.getRegister('D300')).toBe(0);
  });
});

describe('queue pulses under tasks', () => {
  it('fire once per rising edge seen by a slow task, not once per scan', () => {
    const project: LadderProject = {
      pous: [{ id: 'slow', name: 'SLOW', rungs: [rung('w', [no('X0'), sfwr('K1', 'D200', 10)])] }],
      tasks: [{ id: 'slow', name: 'SLOW', intervalMs: 200, priority: 0, pous: ['slow'] }],
    };
    const engine = new SimEngine(project);
    engine.setInput('X0', true);
    for (let i = 0; i < 20; i++) engine.scan(50);
    expect(engine.getRegister('D200')).toBe(1);
    engine.setInput('X0', false);
    for (let i = 0; i < 4; i++) engine.scan(50);
    engine.setInput('X0', true);
    for (let i = 0; i < 4; i++) engine.scan(50);
    expect(engine.getRegister('D200')).toBe(2);
  });

  it('forget their edges on reset, so a powered block fires again on the first scan', () => {
    const engine = new SimEngine(program(rung('w', [no('X0'), sfwr('K1', 'D200', 5)])));
    engine.setInput('X0', true);
    engine.scan(50);
    engine.reset();
    engine.setInput('X0', true);
    engine.scan(50);
    expect(engine.getRegister('D200')).toBe(1);
    expect(engine.opDiagnostics).toEqual({ errors: 0, notices: 0 });
  });
});
