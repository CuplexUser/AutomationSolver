import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung } from '../ladder/types.js';
import type { LadderPuzzleSpec } from './types.js';
import { validateProgram } from './validate.js';

// --- tiny ladder builders (same shape as grade.test.ts) -------------------
const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });

function R(id: string, rows: number, cols: number, map: Record<string, LadderElement>): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => map[`${r},${c}`] ?? null),
  );
  return { id, rows, cols, cells, vlinks: [] };
}

/** A permissive spec — these tests are about the warning, not the error rules. */
const spec: LadderPuzzleSpec = {
  kind: 'ladder',
  slug: 'test-spec',
  title: 'Test',
  difficulty: 'easy',
  order: 0,
  category: 'basics',
  summary: '',
  briefing: '',
  devices: [],
  scenarios: [],
  allowedInstructions: ['contact-no', 'coil-out', 'coil-set', 'coil-reset', 'timer'],
  processId: 'passthrough',
};

const check = (rungs: Rung[]) => validateProgram(spec, { rungs } as LadderProgram);

describe('validateProgram — duplicate output coils', () => {
  it('warns when the same OUT coil is driven from two rungs, without failing validation', () => {
    const result = check([
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') }),
      R('r2', 1, 2, { '0,0': no('X1'), '0,1': out('Y0') }),
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Y0');
    expect(result.warnings[0]).toContain('rungs 1, 2');
  });

  it('lists every rung driving the device, in order', () => {
    const result = check([
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('M0') }),
      R('r2', 1, 2, { '0,0': no('X1'), '0,1': out('Y0') }),
      R('r3', 1, 2, { '0,0': no('X2'), '0,1': out('M0') }),
      R('r4', 1, 2, { '0,0': no('X3'), '0,1': out('M0') }),
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('rungs 1, 3, 4');
  });

  it('does not warn about SET and RST on the same bit — that is the normal idiom', () => {
    const result = check([
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': set('M5') }),
      R('r2', 1, 2, { '0,0': no('X1'), '0,1': rst('M5') }),
      R('r3', 1, 2, { '0,0': no('X2'), '0,1': set('M5') }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns about a duplicated timer, which fights over the same accumulator', () => {
    const result = check([
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': timer('T0', 30) }),
      R('r2', 1, 2, { '0,0': no('X1'), '0,1': timer('T0', 50) }),
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('T0');
  });

  it('counts a device once per rung, so repeats inside one rung do not warn', () => {
    const result = check([
      R('r1', 2, 2, { '0,0': no('X0'), '0,1': out('Y0'), '1,0': no('X1'), '1,1': out('Y0') }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('stays quiet when every output owns its own device', () => {
    const result = check([
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') }),
      R('r2', 1, 2, { '0,0': no('X1'), '0,1': out('Y1') }),
      R('r3', 1, 2, { '0,0': no('X2'), '0,1': set('M0') }),
    ]);
    expect(result.warnings).toEqual([]);
  });
});

// --- index registers and the queue instructions -------------------------------
describe('validateProgram — index registers and queues', () => {
  const mov = (source: string, dest: string): LadderElement => ({
    type: 'mov',
    device: dest,
    operands: [source],
  });
  const queue = (
    type: 'sfwr' | 'sfrd' | 'pop',
    head: string,
    operand: string,
    n: number | undefined = 5,
  ): LadderElement => ({ type, device: head, operands: [operand], preset: n });
  const pidBlock = (dest: string, pv: string): LadderElement => ({
    type: 'pid',
    device: dest,
    operands: ['K100', pv],
    pid: { kp: 100, ti: 0, td: 0, sampleMs: 100, outMin: 0, outMax: 100 },
  });

  const wordSpec = (over: Partial<LadderPuzzleSpec> = {}): LadderPuzzleSpec => ({
    ...spec,
    allowedInstructions: ['contact-no', 'coil-out', 'coil-reset', 'mov', 'pid', 'sfwr', 'sfrd', 'pop'],
    ...over,
  });
  const run = (s: LadderPuzzleSpec, ...els: LadderElement[]) =>
    validateProgram(s, {
      rungs: els.map((el, i) => R(`r${i + 1}`, 1, 2, { '0,0': no('X0'), '0,1': el })),
    } as LadderProgram);

  it('keeps Z out of a puzzle that does not offer index registers, however it is written', () => {
    const s = wordSpec();
    for (const el of [mov('D100Z0', 'D1'), mov('K1', 'Z0'), mov('K1', 'D100Z0'), rst('Z0')]) {
      const result = run(s, el);
      expect(result.valid, JSON.stringify(el)).toBe(false);
      expect(result.errors.join(' ')).toContain('no index registers');
    }
  });

  it('still names only D and K when a puzzle has no index registers', () => {
    const result = run(wordSpec(), mov('Q5', 'D1'));
    expect(result.errors).toEqual([
      'rung 1 @ r0c1: "Q5" is not a register or a constant (expected D0-D9999 or K123)',
    ]);
  });

  it('accepts indexed sources and destinations, and Z as a word, once they are offered', () => {
    const s = wordSpec({ indexRegisters: true });
    const result = run(s, mov('D100Z0', 'D1'), mov('K1', 'Z0'), mov('D5', 'D200Z1'), rst('Z0'));
    expect(result.errors).toEqual([]);
  });

  it('keeps a PID on plain registers even when indexing is offered', () => {
    const s = wordSpec({ indexRegisters: true });
    expect(run(s, pidBlock('D100Z0', 'D1')).errors.join(' ')).toContain('plain register');
    expect(run(s, pidBlock('D10', 'D1Z0')).errors.join(' ')).toContain('plain registers');
  });

  it('accepts a queue with a plain or an indexed head', () => {
    const s = wordSpec({ indexRegisters: true });
    const result = run(
      s,
      queue('sfwr', 'D200', 'D10'),
      queue('sfrd', 'D200', 'D20'),
      queue('pop', 'D300Z0', 'D21'),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('asks a queue for a table length the FX accepts', () => {
    const s = wordSpec();
    const noPreset: LadderElement = { type: 'sfwr', device: 'D200', operands: ['D10'] };
    expect(run(s, noPreset).errors.join(' ')).toContain('table length');
    for (const n of [1, 513]) {
      expect(run(s, queue('sfwr', 'D200', 'D10', n)).errors.join(' ')).toContain('table length');
    }
  });

  it('refuses a constant as the register a queue reads into', () => {
    const result = run(wordSpec(), queue('sfrd', 'D200', 'K5'));
    expect(result.errors.join(' ')).toContain('is a constant');
  });

  it('refuses a Z as the head of a table', () => {
    const result = run(wordSpec({ indexRegisters: true }), queue('sfwr', 'Z0', 'D10'));
    expect(result.errors.join(' ')).toContain("queue's head");
  });

  it('refuses a read into the queue\'s own table, and a table past D9999', () => {
    const s = wordSpec();
    expect(run(s, queue('sfrd', 'D200', 'D203')).errors.join(' ')).toContain('inside its own table');
    expect(run(s, queue('sfwr', 'D9998', 'D1')).errors.join(' ')).toContain('runs past D9999');
  });

  it('warns when one head is used at two lengths', () => {
    const result = run(wordSpec(), queue('sfwr', 'D200', 'D10', 5), queue('sfrd', 'D200', 'D20', 6));
    expect(result.valid).toBe(true);
    expect(result.warnings.join(' ')).toContain('K6 long here but K5');
  });

  it('refuses a table laid over a plant register', () => {
    const s = wordSpec({
      devices: [
        {
          address: 'D202',
          label: 'Lane Count',
          io: 'input',
          widget: 'gauge',
          signal: 'analog',
          range: { countMin: 0, countMax: 4, min: 0, max: 4, units: '' },
        },
      ],
    });
    expect(run(s, queue('sfwr', 'D200', 'D10')).errors.join(' ')).toContain('covers Lane Count (D202)');
  });

  it('never counts a queue write as a double coil', () => {
    const result = run(wordSpec(), queue('sfwr', 'D200', 'D10'), queue('sfwr', 'D200', 'D11'));
    expect(result.warnings).toEqual([]);
  });
});
