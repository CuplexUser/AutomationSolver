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
