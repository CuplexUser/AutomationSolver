import { describe, expect, it } from 'vitest';
import type { PuzzleDevice } from '../types.js';
import { getProcess, type MachineState } from './index.js';

// Minimal device lists — the process only inspects addresses (Y2 presence is
// the door-feature-detect switch), so labels/widgets are placeholders.
const dev = (address: string, io: 'input' | 'output'): PuzzleDevice => ({
  address,
  label: address,
  io,
  widget: io === 'input' ? 'sensor' : 'motor',
});

const motorOnly: PuzzleDevice[] = [dev('Y0', 'output'), dev('Y1', 'output')];
const withDoor: PuzzleDevice[] = [
  dev('Y0', 'output'),
  dev('Y1', 'output'),
  dev('Y2', 'output'),
  dev('X15', 'input'),
  dev('X16', 'input'),
];

/** Step the process `n` times with fixed outputs, returning the final state. */
function run(
  devices: PuzzleDevice[],
  machine: MachineState,
  outputs: Record<string, boolean>,
  n: number,
  dtMs: number,
): { machine: MachineState; derivedInputs: Record<string, boolean> } {
  const process = getProcess('elevator5');
  let derivedInputs: Record<string, boolean> = {};
  for (let i = 0; i < n; i++) {
    const res = process.step({ outputs, inputs: {}, machine, devices, dtMs });
    machine = res.machine;
    derivedInputs = res.derivedInputs ?? {};
  }
  return { machine, derivedInputs };
}

describe('elevator5 process — travel and floor sensors', () => {
  // "Exactly" up to float accumulation (~1e-15) — well inside the model's
  // 0.02 sensor window, which is the contract the puzzles depend on.
  it('lands on a floor sensor after 900ms of Y0 at the 50ms grading scan', () => {
    const init = getProcess('elevator5').init(motorOnly);
    const { machine, derivedInputs } = run(motorOnly, init, { Y0: true }, 18, 50);
    expect(machine.pos).toBeCloseTo(2, 9);
    expect(derivedInputs.X11).toBe(true);
    expect(derivedInputs.X10).toBe(false);
    expect(derivedInputs.X12).toBe(false);
  });

  it('lands on a floor sensor after 900ms of Y0 at the 60ms client scan', () => {
    const init = getProcess('elevator5').init(motorOnly);
    const { machine, derivedInputs } = run(motorOnly, init, { Y0: true }, 15, 60);
    expect(machine.pos).toBeCloseTo(2, 9);
    expect(derivedInputs.X11).toBe(true);
  });

  it('reports no floor sensor between floors', () => {
    const init = getProcess('elevator5').init(motorOnly);
    const { derivedInputs } = run(motorOnly, init, { Y0: true }, 9, 50); // pos = 1.5
    expect(Object.values(derivedInputs)).not.toContain(true);
  });

  it('clamps at the top and bottom floors', () => {
    const init = getProcess('elevator5').init(motorOnly);
    const top = run(motorOnly, init, { Y0: true }, 200, 50);
    expect(top.machine.pos).toBe(5);
    expect(top.derivedInputs.X14).toBe(true);
    const bottom = run(motorOnly, top.machine, { Y1: true }, 200, 50);
    expect(bottom.machine.pos).toBe(1);
    expect(bottom.derivedInputs.X10).toBe(true);
  });

  it('does not move when both motor outputs are asserted at once', () => {
    const init = getProcess('elevator5').init(motorOnly);
    const { machine } = run(motorOnly, init, { Y0: true, Y1: true }, 20, 50);
    expect(machine.pos).toBe(1);
  });
});

describe('elevator5 process — door', () => {
  it('a puzzle without a Y2 device gets no door: motion is never gated', () => {
    const init = getProcess('elevator5').init(motorOnly);
    expect(init.door).toBe(1); // fully open/retracted, permanently
    const { machine, derivedInputs } = run(motorOnly, init, { Y0: true }, 18, 50);
    expect(machine.pos).toBeCloseTo(2, 9);
    expect(derivedInputs).not.toHaveProperty('X15');
    expect(derivedInputs).not.toHaveProperty('X16');
  });

  it('with a door, the car starts door-closed and free to move', () => {
    const init = getProcess('elevator5').init(withDoor);
    expect(init.door).toBe(0);
    const { machine, derivedInputs } = run(withDoor, init, { Y0: true }, 18, 50);
    expect(machine.pos).toBeCloseTo(2, 9);
    expect(derivedInputs.X16).toBe(true);
    expect(derivedInputs.X15).toBe(false);
  });

  it('Y2 opens the door in 500ms and reports X15; releasing closes it back to X16', () => {
    const init = getProcess('elevator5').init(withDoor);
    const open = run(withDoor, init, { Y2: true }, 10, 50);
    expect(open.machine.door).toBeCloseTo(1, 9);
    expect(open.derivedInputs.X15).toBe(true);
    expect(open.derivedInputs.X16).toBe(false);
    const closed = run(withDoor, open.machine, {}, 10, 50);
    expect(closed.machine.door).toBeCloseTo(0, 9);
    expect(closed.derivedInputs.X16).toBe(true);
  });

  it('physically interlocks motion: Y0 with the door open moves nothing', () => {
    const init = getProcess('elevator5').init(withDoor);
    const open = run(withDoor, init, { Y2: true }, 10, 50);
    const stuck = run(withDoor, open.machine, { Y0: true, Y2: true }, 40, 50);
    expect(stuck.machine.pos).toBe(1);
    // Once the door closes again, the same command moves the car.
    const closed = run(withDoor, stuck.machine, {}, 10, 50);
    const moving = run(withDoor, closed.machine, { Y0: true }, 18, 50);
    expect(moving.machine.pos).toBeCloseTo(2, 9);
  });
});
