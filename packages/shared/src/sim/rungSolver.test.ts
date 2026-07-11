import { describe, expect, it } from 'vitest';
import type { LadderElement, Rung } from '../ladder/types.js';
import { evaluateRung } from './rungSolver.js';

function el(type: LadderElement['type'], device = '', preset?: number): LadderElement {
  return { type, device, preset };
}

function rung(
  rows: number,
  cols: number,
  fill: (r: number, c: number) => LadderElement | null,
  vlinks: { row: number; col: number }[] = [],
): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => fill(r, c)),
  );
  return { id: 'r', rows, cols, cells, vlinks };
}

/** conducts helper keyed by device truth table. */
function conductsFrom(state: Record<string, boolean>) {
  return (e: LadderElement): boolean => {
    const v = state[e.device] === true;
    switch (e.type) {
      case 'contact-no':
        return v;
      case 'contact-nc':
        return !v;
      case 'hwire':
        return true;
      default:
        return false;
    }
  };
}

function outEnergized(res: ReturnType<typeof evaluateRung>, device: string): boolean {
  return res.outputs.find((o) => o.element.device === device)?.energized ?? false;
}

describe('evaluateRung', () => {
  it('single NO contact in series with a coil', () => {
    const r = rung(1, 2, (_, c) => (c === 0 ? el('contact-no', 'X0') : el('coil-out', 'Y0')));
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: true })), 'Y0')).toBe(true);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: false })), 'Y0')).toBe(false);
  });

  it('series contacts are logical AND', () => {
    const r = rung(1, 3, (_, c) =>
      c === 0 ? el('contact-no', 'X0') : c === 1 ? el('contact-no', 'X1') : el('coil-out', 'Y0'),
    );
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: true, X1: true })), 'Y0')).toBe(true);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: true, X1: false })), 'Y0')).toBe(false);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: false, X1: true })), 'Y0')).toBe(false);
  });

  it('parallel branches (vertical link) are logical OR', () => {
    // row0col0 = X0, row1col0 = X1, coil at row0col1, vlink joins node col1.
    const r = rung(
      2,
      2,
      (rw, c) => {
        if (c === 0 && rw === 0) return el('contact-no', 'X0');
        if (c === 0 && rw === 1) return el('contact-no', 'X1');
        if (c === 1 && rw === 0) return el('coil-out', 'Y0');
        return null;
      },
      [{ row: 0, col: 1 }],
    );
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: true, X1: false })), 'Y0')).toBe(true);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: false, X1: true })), 'Y0')).toBe(true);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: false, X1: false })), 'Y0')).toBe(false);
  });

  it('NC contact conducts when device is false', () => {
    const r = rung(1, 2, (_, c) => (c === 0 ? el('contact-nc', 'X0') : el('coil-out', 'Y0')));
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: false })), 'Y0')).toBe(true);
    expect(outEnergized(evaluateRung(r, conductsFrom({ X0: true })), 'Y0')).toBe(false);
  });

  it('open circuit does not energize the coil', () => {
    // empty cell between rail and coil = no path
    const r = rung(1, 2, (_, c) => (c === 0 ? null : el('coil-out', 'Y0')));
    expect(outEnergized(evaluateRung(r, conductsFrom({})), 'Y0')).toBe(false);
  });
});
