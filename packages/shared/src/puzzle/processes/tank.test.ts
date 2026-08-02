import { describe, expect, it } from 'vitest';
import type { PuzzleDevice } from '../types.js';
import { getProcess, type MachineState } from './index.js';

const dev = (address: string, io: 'input' | 'output'): PuzzleDevice => ({
  address,
  label: address,
  io,
  widget: io === 'input' ? 'sensor' : 'motor',
});

/** Valve + transmitter only — no discharge pump, so no dry-run fault. */
const valveOnly: PuzzleDevice[] = [dev('D20', 'output'), dev('D0', 'input')];
/** The full vessel, pump included. */
const withPump: PuzzleDevice[] = [...valveOnly, dev('Y0', 'output')];

function run(
  devices: PuzzleDevice[],
  machine: MachineState,
  outputs: Record<string, boolean>,
  registers: Record<string, number>,
  n: number,
  dtMs: number,
): { machine: MachineState; derivedInputs: Record<string, boolean>; derivedRegisters: Record<string, number> } {
  const process = getProcess('tank');
  let derivedInputs: Record<string, boolean> = {};
  let derivedRegisters: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const res = process.step({ outputs, inputs: {}, registers, machine, devices, dtMs });
    machine = res.machine;
    derivedInputs = res.derivedInputs ?? {};
    derivedRegisters = res.derivedRegisters ?? {};
  }
  return { machine, derivedInputs, derivedRegisters };
}

const init = (devices: PuzzleDevice[]): MachineState => getProcess('tank').init(devices);

describe('tank process — fixed-point determinism', () => {
  /**
   * The whole reason the model integrates on a fixed sub-step: the client used
   * to scan at 60ms while the grader ran at 50ms, and while booleans survived
   * that, an integrator would not have. Both cadences now run at 50, but the
   * model must not *depend* on that, so this pins the stronger property.
   */
  it('reaches the identical level whatever dt it is stepped at', () => {
    const regs = { D20: 2000 };
    const at10 = run(valveOnly, init(valveOnly), {}, regs, 600, 10);
    const at50 = run(valveOnly, init(valveOnly), {}, regs, 120, 50);
    const at60 = run(valveOnly, init(valveOnly), {}, regs, 100, 60);

    expect(at50.machine.levelMilli).toBe(at10.machine.levelMilli);
    expect(at60.machine.levelMilli).toBe(at10.machine.levelMilli);
  });

  it('carries a partial sub-step rather than losing or gaining flow', () => {
    // 35ms is 3.5 sub-steps: the remainder has to survive into the next call.
    const a = run(valveOnly, init(valveOnly), {}, { D20: 4000 }, 20, 35);
    const b = run(valveOnly, init(valveOnly), {}, { D20: 4000 }, 70, 10);
    expect(a.machine.levelMilli).toBe(b.machine.levelMilli);
  });

  it('keeps every reported quantity an integer', () => {
    const { machine, derivedRegisters } = run(valveOnly, init(valveOnly), {}, { D20: 1234 }, 200, 50);
    expect(Number.isInteger(machine.levelMilli)).toBe(true);
    expect(Number.isInteger(machine.level)).toBe(true);
    expect(Number.isInteger(derivedRegisters.D0)).toBe(true);
    expect(Number.isInteger(derivedRegisters.D1)).toBe(true);
  });
});

describe('tank process — dynamics', () => {
  /**
   * The constant the puzzles are authored against: with the pump off, the level
   * settles at the same count as the valve command. If this drifts, every
   * scenario band in the process-control category moves with it.
   */
  it('settles with level counts equal to valve counts', () => {
    for (const valve of [1000, 2000, 3000]) {
      const { derivedRegisters } = run(valveOnly, init(valveOnly), {}, { D20: valve }, 4000, 50);
      expect(derivedRegisters.D0).toBeGreaterThanOrEqual(valve - 20);
      expect(derivedRegisters.D0).toBeLessThanOrEqual(valve + 20);
    }
  });

  /**
   * A 4 s time constant, so five of them is 20 s and the level is there. Both
   * ends of this matter: much slower and live play is a waiting game, much
   * faster and there is no lag for a loop to be tuned against.
   */
  it('settles within 20 s of a step in valve command', () => {
    const empty = { ...init(valveOnly), levelMilli: 0, level: 0 };
    const filled = run(valveOnly, empty, {}, { D20: 3000 }, 400, 50);
    expect(filled.derivedRegisters.D0).toBeGreaterThan(2900);
    expect(filled.derivedRegisters.D0).toBeLessThanOrEqual(3000);

    const drained = run(valveOnly, filled.machine, {}, { D20: 0 }, 400, 50);
    expect(drained.derivedRegisters.D0).toBeLessThan(200);
  });

  it('is roughly one time constant from a step after 4 s', () => {
    const empty = { ...init(valveOnly), levelMilli: 0, level: 0 };
    const { derivedRegisters } = run(valveOnly, empty, {}, { D20: 3000 }, 80, 50);
    // 63 % of 3000 is 1896; integer truncation biases a little low.
    expect(derivedRegisters.D0).toBeGreaterThan(1650);
    expect(derivedRegisters.D0).toBeLessThan(2050);
  });

  it('reports discharge flow that rises with the pump', () => {
    const idle = run(withPump, init(withPump), { Y0: false }, { D20: 2000 }, 400, 50);
    const loaded = run(withPump, idle.machine, { Y0: true }, { D20: 2000 }, 40, 50);
    expect(loaded.derivedRegisters.D1).toBeGreaterThan(idle.derivedRegisters.D1);
    expect(loaded.derivedRegisters.D1).toBeLessThanOrEqual(4000);
  });

  it('shifts the equilibrium down when the discharge pump loads the tank', () => {
    const idle = run(withPump, init(withPump), { Y0: false }, { D20: 2000 }, 4000, 50);
    const loaded = run(withPump, idle.machine, { Y0: true }, { D20: 2000 }, 4000, 50);
    expect(loaded.derivedRegisters.D0).toBeLessThan(idle.derivedRegisters.D0 - 500);
  });
});

describe('tank process — float switches and faults', () => {
  it('trips the low float below 10 % and the high float above 90 %', () => {
    const low = run(valveOnly, init(valveOnly), {}, { D20: 0 }, 2000, 50);
    expect(low.derivedInputs.X1).toBe(true);
    expect(low.derivedInputs.X2).toBe(false);

    const high = run(valveOnly, init(valveOnly), {}, { D20: 3800 }, 4000, 50);
    expect(high.derivedInputs.X2).toBe(true);
    expect(high.derivedInputs.X1).toBe(false);
  });

  it('faults on overflow and freezes the vessel', () => {
    const over = run(valveOnly, init(valveOnly), {}, { D20: 4000 }, 6000, 50);
    expect(over.machine.jam).toBe(true);
    expect(over.machine.overflow).toBe(true);
    const frozen = over.machine.levelMilli;
    const later = run(valveOnly, over.machine, {}, { D20: 0 }, 200, 50);
    expect(later.machine.levelMilli).toBe(frozen);
  });

  it('faults when the discharge pump runs the vessel dry', () => {
    const dry = run(withPump, init(withPump), { Y0: true }, { D20: 0 }, 4000, 50);
    expect(dry.machine.jam).toBe(true);
    expect(dry.machine.dryRun).toBe(true);
  });

  it('has no dry-run fault at all when the puzzle never wires a pump', () => {
    const empty = run(valveOnly, init(valveOnly), { Y0: true }, { D20: 0 }, 4000, 50);
    expect(empty.machine.jam).toBe(false);
  });
});
