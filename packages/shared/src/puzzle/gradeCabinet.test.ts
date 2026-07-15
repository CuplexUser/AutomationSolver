import { describe, expect, it } from 'vitest';
import { gradeWiring } from '../circuit/gradeWiring.js';
import { validateWiring } from '../circuit/validateWiring.js';
import type { Wire, WiringDoc } from '../circuit/types.js';
import { getPuzzle } from './content/index.js';
import type { CabinetPuzzleSpec } from './types.js';

// Canonical wirings — the guardrail proving every shipped cabinet puzzle is
// actually solvable, mirroring grade.test.ts for ladder puzzles.

let wireN = 0;
const w = (from: string, to: string): Wire => ({ id: `w${wireN++}`, from, to });

const solutions: Record<string, WiringDoc> = {
  'cabinet-lamp': {
    wires: [w('PS.L1', 'S1.13'), w('S1.14', 'H1.X1'), w('H1.X2', 'PS.N')],
  },
  'cabinet-dol': {
    wires: [
      // control: L1 → stop (NC) → start (NO, sealed by K1 13-14) → coil → overload 95-96 → N
      w('PS.L1', 'S2.21'),
      w('S2.22', 'S1.13'),
      w('S1.14', 'K1.A1'),
      w('K1.A2', 'F1.95'),
      w('F1.96', 'PS.N'),
      w('K1.13', 'S1.13'),
      w('K1.14', 'S1.14'),
      // power: three phases through the contactor, then the overload, to the motor
      w('PS.L1', 'K1.1'),
      w('PS.L2', 'K1.3'),
      w('PS.L3', 'K1.5'),
      w('K1.2', 'F1.1'),
      w('K1.4', 'F1.3'),
      w('K1.6', 'F1.5'),
      w('F1.2', 'M1.U'),
      w('F1.4', 'M1.V'),
      w('F1.6', 'M1.W'),
    ],
  },
  'cabinet-reversing': {
    wires: [
      // control feed through STOP
      w('PS.L1', 'S3.21'),
      w('S3.22', 'S1.13'),
      w('S3.22', 'S2.13'),
      // forward: S1 → K2 NC interlock → K1 coil
      w('S1.14', 'K2.21'),
      w('K2.22', 'K1.A1'),
      w('K1.A2', 'PS.N'),
      // reverse: S2 → K1 NC interlock → K2 coil
      w('S2.14', 'K1.21'),
      w('K1.22', 'K2.A1'),
      w('K2.A2', 'PS.N'),
      // seals across each start button
      w('K1.13', 'S1.13'),
      w('K1.14', 'S1.14'),
      w('K2.13', 'S2.13'),
      w('K2.14', 'S2.14'),
      // forward power: straight through K1
      w('PS.L1', 'K1.1'),
      w('PS.L2', 'K1.3'),
      w('PS.L3', 'K1.5'),
      w('K1.2', 'M1.U'),
      w('K1.4', 'M1.V'),
      w('K1.6', 'M1.W'),
      // reverse power: two phases swapped through K2, landing on the same motor terminals
      w('PS.L3', 'K2.1'),
      w('PS.L2', 'K2.3'),
      w('PS.L1', 'K2.5'),
      w('K2.2', 'M1.U'),
      w('K2.4', 'M1.V'),
      w('K2.6', 'M1.W'),
    ],
  },
  'cabinet-indication': {
    wires: [
      // control: same DOL rung as cabinet-dol
      w('PS.L1', 'S2.21'),
      w('S2.22', 'S1.13'),
      w('S1.14', 'K1.A1'),
      w('K1.A2', 'F1.95'),
      w('F1.96', 'PS.N'),
      w('K1.13', 'S1.13'),
      w('K1.14', 'S1.14'),
      // run lamp in parallel with the coil
      w('H1.X1', 'K1.A1'),
      w('H1.X2', 'K1.A2'),
      // trip lamp straight from L1 through the overload's NO aux
      w('PS.L1', 'F1.97'),
      w('F1.98', 'H2.X1'),
      w('H2.X2', 'PS.N'),
      // power: phases through the contactor, then the overload, to the motor
      w('PS.L1', 'K1.1'),
      w('PS.L2', 'K1.3'),
      w('PS.L3', 'K1.5'),
      w('K1.2', 'F1.1'),
      w('K1.4', 'F1.3'),
      w('K1.6', 'F1.5'),
      w('F1.2', 'M1.U'),
      w('F1.4', 'M1.V'),
      w('F1.6', 'M1.W'),
    ],
  },
  'cabinet-reversing-protected': {
    wires: [
      // common feed: e-stop → overload NC → stop, then split to both starts
      w('PS.L1', 'S0.21'),
      w('S0.22', 'F1.95'),
      w('F1.96', 'S3.21'),
      w('S3.22', 'S1.13'),
      w('S3.22', 'S2.13'),
      // forward: S1 → K2 NC interlock → K1 coil, sealed, lamp across coil
      w('S1.14', 'K2.21'),
      w('K2.22', 'K1.A1'),
      w('K1.A2', 'PS.N'),
      w('K1.13', 'S1.13'),
      w('K1.14', 'S1.14'),
      w('H1.X1', 'K1.A1'),
      w('H1.X2', 'K1.A2'),
      // reverse: S2 → K1 NC interlock → K2 coil, sealed, lamp across coil
      w('S2.14', 'K1.21'),
      w('K1.22', 'K2.A1'),
      w('K2.A2', 'PS.N'),
      w('K2.13', 'S2.13'),
      w('K2.14', 'S2.14'),
      w('H2.X1', 'K2.A1'),
      w('H2.X2', 'K2.A2'),
      // trip lamp straight from L1 through the overload's NO aux
      w('PS.L1', 'F1.97'),
      w('F1.98', 'H3.X1'),
      w('H3.X2', 'PS.N'),
      // forward power: straight through K1 into the overload
      w('PS.L1', 'K1.1'),
      w('PS.L2', 'K1.3'),
      w('PS.L3', 'K1.5'),
      // reverse power: two phases swapped through K2, joining the same overload inputs
      w('PS.L3', 'K2.1'),
      w('PS.L2', 'K2.3'),
      w('PS.L1', 'K2.5'),
      w('K1.2', 'F1.1'),
      w('K1.4', 'F1.3'),
      w('K1.6', 'F1.5'),
      w('K2.2', 'F1.1'),
      w('K2.4', 'F1.3'),
      w('K2.6', 'F1.5'),
      // overload to motor
      w('F1.2', 'M1.U'),
      w('F1.4', 'M1.V'),
      w('F1.6', 'M1.W'),
    ],
  },
};

function getCabinetPuzzle(slug: string): CabinetPuzzleSpec {
  const spec = getPuzzle(slug);
  if (!spec || spec.kind !== 'cabinet') throw new Error(`puzzle ${slug} is not a cabinet puzzle`);
  return spec;
}

describe('gradeWiring — canonical wirings solve every cabinet puzzle', () => {
  for (const [slug, wiring] of Object.entries(solutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getCabinetPuzzle(slug);
      const validation = validateWiring(spec, wiring);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      const result = gradeWiring(spec, wiring);
      const failed = result.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
      expect(failed, failed.join(' | ')).toEqual([]);
      expect(result.solved).toBe(true);
      expect(result.score).toBe(100);
    });
  }
});

describe('gradeWiring — wrong wirings do not solve', () => {
  it('an empty wiring never solves', () => {
    const spec = getCabinetPuzzle('cabinet-dol');
    expect(gradeWiring(spec, { wires: [] }).solved).toBe(false);
  });

  it('a shorted wiring grades as failed (not thrown) with a short-circuit failure', () => {
    const spec = getCabinetPuzzle('cabinet-dol');
    const shorted: WiringDoc = {
      wires: [...solutions['cabinet-dol'].wires, w('PS.L1', 'PS.N')],
    };
    const result = gradeWiring(spec, shorted);
    expect(result.solved).toBe(false);
    const allFailures = result.scenarios.flatMap((s) => s.steps.flatMap((st) => st.failures));
    expect(allFailures.some((f) => f.includes('Short circuit'))).toBe(true);
  });

  it('a reversing starter without the interlock fails the live-reversal scenario', () => {
    const spec = getCabinetPuzzle('cabinet-reversing');
    // Same as canonical but the coils bypass the opposite contactor's NC aux.
    const noInterlock: WiringDoc = {
      wires: solutions['cabinet-reversing'].wires
        .filter((x) => !['K2.21', 'K2.22', 'K1.21', 'K1.22'].includes(x.from) &&
                       !['K2.21', 'K2.22', 'K1.21', 'K1.22'].includes(x.to))
        .concat([w('S1.14', 'K1.A1'), w('S2.14', 'K2.A1')]),
    };
    const result = gradeWiring(spec, noInterlock);
    expect(result.solved).toBe(false);
    const interlock = result.scenarios.find((s) => s.name === 'Interlock blocks a live reversal');
    expect(interlock?.passed).toBe(false);
  });

  it('validateWiring rejects unknown terminals, self-loops and duplicates', () => {
    const spec = getCabinetPuzzle('cabinet-lamp');
    const bad: WiringDoc = {
      wires: [
        { id: 'a', from: 'PS.L1', to: 'PS.L1' },
        { id: 'b', from: 'PS.L9', to: 'H1.X1' },
        { id: 'c', from: 'S1.13', to: 'H1.X1' },
        { id: 'd', from: 'H1.X1', to: 'S1.13' },
      ],
    };
    const v = validateWiring(spec, bad);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('itself'))).toBe(true);
    expect(v.errors.some((e) => e.includes('unknown terminal'))).toBe(true);
    expect(v.errors.some((e) => e.includes('Duplicate wire between'))).toBe(true);
  });
});
