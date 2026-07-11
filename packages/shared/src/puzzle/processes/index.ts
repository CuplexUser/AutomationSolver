import type { PuzzleDevice } from '../types.js';

/** Arbitrary per-puzzle machine state (positions, speeds, flags). */
export type MachineState = Record<string, number | boolean | string>;

export interface ProcessStepCtx {
  outputs: Record<string, boolean>; // current Y bits from the PLC
  inputs: Record<string, boolean>; // current X bits (scenario/HMI driven)
  machine: MachineState;
  devices: PuzzleDevice[];
  dtMs: number;
}

export interface ProcessResult {
  machine: MachineState;
  /** X inputs the process asserts (sensors); merged over scenario/HMI inputs. */
  derivedInputs?: Record<string, boolean>;
}

export interface ProcessModel {
  id: string;
  init(devices: PuzzleDevice[]): MachineState;
  step(ctx: ProcessStepCtx): ProcessResult;
}

/** No dynamics: the machine simply reflects outputs; HMI reads Y bits directly. */
const passthrough: ProcessModel = {
  id: 'passthrough',
  init: () => ({}),
  step: ({ machine }) => ({ machine }),
};

/**
 * Single-part conveyor. The belt output (first 'motor' widget) moves a part from
 * position 0 to 1 over `travelMs`. A part sensor (device address 'X2' by
 * convention, or the first 'sensor' widget) reads true while the part is within
 * [detectFrom, detectTo] of travel.
 */
const conveyor: ProcessModel = {
  id: 'conveyor',
  init: () => ({ pos: 0, present: true }),
  step: ({ outputs, machine, devices, dtMs }) => {
    const travelMs = 2000;
    const detectFrom = 0.45;
    const detectTo = 0.6;
    const belt = devices.find((d) => d.widget === 'motor');
    const sensor = devices.find((d) => d.widget === 'sensor');
    let pos = typeof machine.pos === 'number' ? machine.pos : 0;
    const present = machine.present !== false;
    if (belt && outputs[belt.address] && present) {
      pos = Math.min(1, pos + dtMs / travelMs);
    }
    const derivedInputs: Record<string, boolean> = {};
    if (sensor) {
      derivedInputs[sensor.address] = present && pos >= detectFrom && pos <= detectTo;
    }
    return { machine: { pos, present }, derivedInputs };
  },
};

const registry = new Map<string, ProcessModel>([
  [passthrough.id, passthrough],
  [conveyor.id, conveyor],
]);

export function getProcess(id: string): ProcessModel {
  return registry.get(id) ?? passthrough;
}

export function registerProcess(model: ProcessModel): void {
  registry.set(model.id, model);
}
