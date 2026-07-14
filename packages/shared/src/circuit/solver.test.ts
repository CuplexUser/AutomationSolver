import { describe, expect, it } from 'vitest';
import { CabinetSim } from './solver.js';
import type { CabinetLayout, Wire, WiringDoc } from './types.js';

let wireN = 0;
const w = (from: string, to: string): Wire => ({ id: `w${wireN++}`, from, to });
const doc = (...wires: Wire[]): WiringDoc => ({ wires });

const lampLayout: CabinetLayout = {
  components: [
    { id: 'PS', type: 'supply3ph', label: 'Supply', x: 0, y: 0 },
    { id: 'S1', type: 'button-no', label: 'Button', hmiAddress: 'S1', x: 0, y: 100 },
    { id: 'SN', type: 'button-nc', label: 'NC button', hmiAddress: 'SN', x: 60, y: 100 },
    { id: 'H1', type: 'lamp', label: 'Lamp', hmiAddress: 'H1', x: 120, y: 100 },
    { id: 'H2', type: 'lamp', label: 'Lamp 2', hmiAddress: 'H2', x: 180, y: 100 },
  ],
};

const sealLayout: CabinetLayout = {
  components: [
    { id: 'PS', type: 'supply3ph', label: 'Supply', x: 0, y: 0 },
    { id: 'S1', type: 'button-no', label: 'Start', hmiAddress: 'S1', x: 0, y: 100 },
    { id: 'K1', type: 'contactor', label: 'Contactor', hmiAddress: 'K1', x: 100, y: 100 },
  ],
};

const motorLayout: CabinetLayout = {
  components: [
    { id: 'PS', type: 'supply3ph', label: 'Supply', x: 0, y: 0 },
    { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 0, y: 100 },
  ],
};

describe('CabinetSim — nets and loads', () => {
  it('a lamp across L1 and N energizes; wires conduct, loads do not', () => {
    const sim = new CabinetSim(lampLayout, doc(w('PS.L1', 'H1.X1'), w('H1.X2', 'PS.N')));
    const res = sim.step(50);
    expect(res.energized.H1).toBe(true);
    expect(res.shorted).toBe(false);
  });

  it('two lamps in series do not energize (binary potential model)', () => {
    // H1.X2 → H2.X1 joins the two lamps, but a load never merges nets, so the
    // middle net floats — documents the all-or-nothing potential model.
    const sim = new CabinetSim(
      lampLayout,
      doc(w('PS.L1', 'H1.X1'), w('H1.X2', 'H2.X1'), w('H2.X2', 'PS.N')),
    );
    const res = sim.step(50);
    expect(res.energized.H1).toBe(false);
    expect(res.energized.H2).toBe(false);
  });

  it('NO button conducts only while pressed; NC only while released', () => {
    const sim = new CabinetSim(
      lampLayout,
      doc(w('PS.L1', 'S1.13'), w('S1.14', 'H1.X1'), w('H1.X2', 'PS.N'),
          w('PS.L1', 'SN.21'), w('SN.22', 'H2.X1'), w('H2.X2', 'PS.N')),
    );
    let res = sim.step(50);
    expect(res.energized.H1).toBe(false);
    expect(res.energized.H2).toBe(true);
    sim.setInputs({ S1: true, SN: true });
    res = sim.step(50);
    expect(res.energized.H1).toBe(true);
    expect(res.energized.H2).toBe(false);
  });

  it('a lamp across L1 and PE does not energize', () => {
    const sim = new CabinetSim(lampLayout, doc(w('PS.L1', 'H1.X1'), w('H1.X2', 'PS.PE')));
    expect(sim.step(50).energized.H1).toBe(false);
  });
});

describe('CabinetSim — short circuits', () => {
  it('a direct L1–N wire is a short: fault reported, everything de-energizes', () => {
    const sim = new CabinetSim(
      lampLayout,
      doc(w('PS.L1', 'PS.N'), w('PS.L1', 'H1.X1'), w('H1.X2', 'PS.N')),
    );
    const res = sim.step(50);
    expect(res.shorted).toBe(true);
    expect(res.faults.some((f) => f.includes('Short circuit'))).toBe(true);
    expect(res.energized.H1).toBe(false);
  });

  it('a short through a pressed button only faults while pressed', () => {
    const sim = new CabinetSim(lampLayout, doc(w('PS.L1', 'S1.13'), w('S1.14', 'PS.N')));
    expect(sim.step(50).shorted).toBe(false);
    sim.setInputs({ S1: true });
    expect(sim.step(50).shorted).toBe(true);
    sim.setInputs({ S1: false });
    expect(sim.step(50).shorted).toBe(false);
  });
});

describe('CabinetSim — contactor state and seal-in', () => {
  const sealWiring = doc(
    w('PS.L1', 'S1.13'),
    w('S1.14', 'K1.A1'),
    w('K1.A2', 'PS.N'),
    // seal-in: aux 13-14 in parallel with the start button
    w('K1.13', 'S1.13'),
    w('K1.14', 'S1.14'),
  );

  it('latches through its own aux contact across steps', () => {
    const sim = new CabinetSim(sealLayout, sealWiring);
    expect(sim.step(50).energized.K1).toBe(false);
    sim.setInputs({ S1: true });
    expect(sim.step(50).energized.K1).toBe(true);
    sim.setInputs({ S1: false });
    expect(sim.step(50).energized.K1).toBe(true); // sealed
    expect(sim.step(50).unstable).toBe(false);
  });

  it('reset() drops the latch', () => {
    const sim = new CabinetSim(sealLayout, sealWiring);
    sim.setInputs({ S1: true });
    sim.step(50);
    sim.reset();
    expect(sim.step(50).energized.K1).toBe(false);
  });

  it('a coil fed through its own NC aux chatters: unstable, forced off', () => {
    const sim = new CabinetSim(
      sealLayout,
      doc(w('PS.L1', 'K1.21'), w('K1.22', 'K1.A1'), w('K1.A2', 'PS.N')),
    );
    const res = sim.step(50);
    expect(res.unstable).toBe(true);
    expect(res.energized.K1).toBe(false);
    expect(res.faults.some((f) => f.includes('Unstable'))).toBe(true);
    // Deterministic: a second step reproduces the same outcome.
    const res2 = sim.step(50);
    expect(res2.unstable).toBe(true);
    expect(res2.energized.K1).toBe(false);
  });
});

describe('CabinetSim — motor phases and direction', () => {
  it('runs forward on L1/L2/L3 → U/V/W', () => {
    const sim = new CabinetSim(
      motorLayout,
      doc(w('PS.L1', 'M1.U'), w('PS.L2', 'M1.V'), w('PS.L3', 'M1.W')),
    );
    const m = sim.step(50).motors.M1;
    expect(m).toEqual({ running: true, direction: 'fwd', singlePhased: false });
  });

  it('a cyclic rotation of phases still runs forward', () => {
    const sim = new CabinetSim(
      motorLayout,
      doc(w('PS.L2', 'M1.U'), w('PS.L3', 'M1.V'), w('PS.L1', 'M1.W')),
    );
    expect(sim.step(50).motors.M1.direction).toBe('fwd');
  });

  it('swapping two phases reverses', () => {
    const sim = new CabinetSim(
      motorLayout,
      doc(w('PS.L2', 'M1.U'), w('PS.L1', 'M1.V'), w('PS.L3', 'M1.W')),
    );
    const m = sim.step(50).motors.M1;
    expect(m.running).toBe(true);
    expect(m.direction).toBe('rev');
  });

  it('two phases only = single-phased, not running', () => {
    const sim = new CabinetSim(motorLayout, doc(w('PS.L1', 'M1.U'), w('PS.L2', 'M1.V')));
    const res = sim.step(50);
    expect(res.motors.M1.running).toBe(false);
    expect(res.motors.M1.singlePhased).toBe(true);
    expect(res.faults.some((f) => f.includes('single-phased'))).toBe(true);
  });
});

describe('CabinetSim — overload relay', () => {
  const layout: CabinetLayout = {
    components: [
      { id: 'PS', type: 'supply3ph', label: 'Supply', x: 0, y: 0 },
      { id: 'F1', type: 'overload', label: 'Overload', hmiAddress: 'F1T', x: 0, y: 100 },
      { id: 'H1', type: 'lamp', label: 'Run lamp', hmiAddress: 'H1', x: 100, y: 100 },
      { id: 'H2', type: 'lamp', label: 'Trip lamp', hmiAddress: 'H2', x: 160, y: 100 },
      { id: 'M1', type: 'motor3', label: 'Motor', hmiAddress: 'M1', x: 0, y: 200 },
    ],
  };
  const wiring = doc(
    // power through the overload poles
    w('PS.L1', 'F1.1'), w('PS.L2', 'F1.3'), w('PS.L3', 'F1.5'),
    w('F1.2', 'M1.U'), w('F1.4', 'M1.V'), w('F1.6', 'M1.W'),
    // 95-96 (NC) feeds the run lamp, 97-98 (NO) the trip lamp
    w('PS.L1', 'F1.95'), w('F1.96', 'H1.X1'), w('H1.X2', 'PS.N'),
    w('PS.L1', 'F1.97'), w('F1.98', 'H2.X1'), w('H2.X2', 'PS.N'),
  );

  it('trip opens the poles and 95-96, closes 97-98', () => {
    const sim = new CabinetSim(layout, wiring);
    let res = sim.step(50);
    expect(res.motors.M1.running).toBe(true);
    expect(res.energized.H1).toBe(true);
    expect(res.energized.H2).toBe(false);

    sim.setInputs({ F1T: true });
    res = sim.step(50);
    expect(res.motors.M1.running).toBe(false);
    expect(res.energized.H1).toBe(false);
    expect(res.energized.H2).toBe(true);

    sim.setInputs({ F1T: false });
    res = sim.step(50);
    expect(res.motors.M1.running).toBe(true);
  });
});
