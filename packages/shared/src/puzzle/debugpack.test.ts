import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung, VLink } from '../ladder/types.js';
import { getPuzzle } from './content/index.js';
import { gradeProgram, traceScenario } from './grade.js';
import type { LadderPuzzleSpec } from './types.js';

const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const rise = (d: string): LadderElement => ({ type: 'contact-rising', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });
const wire: LadderElement = { type: 'hwire', device: '' };

function R(id: string, rows: number, cols: number, map: Record<string, LadderElement>, vlinks: VLink[] = []): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => map[`${r},${c}`] ?? null),
  );
  return { id, rows, cols, cells, vlinks };
}

function solution(): LadderProgram {
  const step = (id: string, m: string, sensor: string, nextM: string | null): Rung =>
    nextM
      ? R(id, 2, 3, { '0,0': no(m), '0,1': no(sensor), '0,2': set(nextM), '1,2': rst(m) }, [{ row: 0, col: 2 }])
      : R(id, 1, 3, { '0,0': no(m), '0,1': no(sensor), '0,2': rst(m) });
  return {
    rungs: [
      R('pp1', 2, 6, {
        '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X2'), '0,3': nc('C0'),
        '0,4': nc('X1'), '0,5': out('Y0'),
        '1,0': no('Y0'), '1,1': wire, '1,2': wire, '1,3': wire,
      }, [{ row: 0, col: 4 }]),
      R('pp2', 1, 2, { '0,0': no('X1'), '0,1': counter('C0', 2) }),
      R('pp3', 1, 3, { '0,0': no('C0'), '0,1': no('X4'), '0,2': out('Y1') }),
      R('pp4', 1, 2, { '0,0': no('X3'), '0,1': rst('C0') }),
      R('pl1', 1, 2, { '0,0': no('X3'), '0,1': set('M0') }),
      R('pl2', 1, 5, {
        '0,0': no('M0'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': nc('M3'), '0,4': out('Y2'),
      }),
      R('pl3', 1, 2, { '0,0': no('X5'), '0,1': rst('M0') }),
      R('ps1', 1, 4, { '0,0': nc('M1'), '0,1': nc('M2'), '0,2': nc('M3'), '0,3': out('Y5') }),
      R('ps2', 1, 2, { '0,0': no('X5'), '0,1': counter('C1', 4) }),
      R('ps3', 2, 3, { '0,0': rise('X4'), '0,1': no('C1'), '0,2': set('M1'), '1,2': rst('C1') }, [{ row: 0, col: 2 }]),
      R('ps4', 1, 2, { '0,0': no('M2'), '0,1': out('Y3') }),
      R('ps5', 1, 2, { '0,0': no('M4'), '0,1': out('Y4') }),
      step('ps6', 'M1', 'X12', 'M2'),
      step('ps7', 'M2', 'X7', 'M3'),
      step('ps8', 'M3', 'X6', 'M4'),
      step('ps9', 'M4', 'X11', 'M5'),
      step('ps10', 'M5', 'X10', null),
    ],
  };
}

describe('debug pack-full timeline', () => {
  it('prints milestones', () => {
    const spec = getPuzzle('pack-full') as LadderPuzzleSpec;
    const program = solution();
    const longSpec: LadderPuzzleSpec = {
      ...spec,
      scenarios: [{ name: 'long', steps: [{ label: 'run', holdMs: 30000, expect: {} }] }],
    };
    const trace = traceScenario(longSpec, program, 'long')!;
    const lines: string[] = [];
    const prev: Record<string, unknown> = {};
    for (const s of trace.samples) {
      const keys = ['sec2', 'liftLoad', 'sec3', 'sec4', 'finished', 'jam'] as const;
      const changed = keys.filter((k) => s.machine[k] !== prev[k]);
      if (changed.length) {
        lines.push(`${s.tMs} ${changed.map((k) => `${k}=${String(s.machine[k])}`).join(' ')}`);
        for (const k of changed) prev[k] = s.machine[k];
      }
    }
    lines.push('grade: ' + JSON.stringify(gradeProgram(spec, program).scenarios.map((s) => s.steps.map((st) => st.failures))));
    writeFileSync('debugpack.out.txt', lines.join('\n'));
  });
});
