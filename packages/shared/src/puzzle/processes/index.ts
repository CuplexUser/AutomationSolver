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

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

/**
 * Drill station — a sequential machine. Outputs drive a clamp, a drill feed and
 * an eject pusher; the process integrates their travel and reports back position
 * sensors:
 *   Y0 clamp → X2 "Clamped"     (clamp fully closed)
 *   Y1 drill → X3 "At Bottom"   (drill fully advanced)
 *   Y4 eject → X4 "Ejected"     (part pushed clear onto the roller band)
 * Machine state (clamp/drill/push 0..1, spinning, warning, done) drives the 3D view.
 */
const drill: ProcessModel = {
  id: 'drill',
  init: () => ({ clamp: 0, drill: 0, push: 0, spinning: false, warning: false, done: false }),
  step: ({ outputs, machine, dtMs }) => {
    const clampMs = 400;
    const releaseMs = 300;
    const drillMs = 800;
    const retractMs = 400;
    const pushMs = 500;
    const pushRetractMs = 300;
    const clampCmd = outputs['Y0'] === true;
    const drillCmd = outputs['Y1'] === true;
    const pushCmd = outputs['Y4'] === true;
    let clamp = num(machine.clamp);
    let drill = num(machine.drill);
    let push = num(machine.push);
    clamp = clampCmd ? Math.min(1, clamp + dtMs / clampMs) : Math.max(0, clamp - dtMs / releaseMs);
    // The drill can only advance once the part is clamped.
    drill = drillCmd ? Math.min(1, drill + dtMs / drillMs) : Math.max(0, drill - dtMs / retractMs);
    push = pushCmd ? Math.min(1, push + dtMs / pushMs) : Math.max(0, push - dtMs / pushRetractMs);
    return {
      machine: {
        clamp,
        drill,
        push,
        spinning: drillCmd,
        warning: outputs['Y2'] === true,
        done: outputs['Y3'] === true,
      },
      derivedInputs: { X2: clamp >= 1, X3: drill >= 1, X4: push >= 1 },
    };
  },
};

/**
 * Two-hand safety press. The press ram (Y0) advances while commanded and
 * retracts otherwise; the machine reports a single bottom-of-stroke sensor:
 *   Y0 press → X3 "At Bottom" (ram fully advanced)
 * Machine state (ram 0..1) drives any bespoke view.
 */
const press: ProcessModel = {
  id: 'press',
  init: () => ({ ram: 0 }),
  step: ({ outputs, machine, dtMs }) => {
    const advanceMs = 600;
    const retractMs = 400;
    const advancing = outputs['Y0'] === true;
    let ram = num(machine.ram);
    ram = advancing ? Math.min(1, ram + dtMs / advanceMs) : Math.max(0, ram - dtMs / retractMs);
    return { machine: { ram }, derivedInputs: { X3: ram >= 1 } };
  },
};

/**
 * Passenger elevator over 3 floors. Y0 drives the car up, Y1 down; the process
 * integrates a continuous car position (1..3) and reports floor sensors:
 *   X3 "At Floor 1", X4 "At Floor 2", X5 "At Floor 3".
 * Machine state (pos, dir) drives the shaft animation.
 */
const elevator: ProcessModel = {
  id: 'elevator',
  init: () => ({ pos: 1, dir: 0 }),
  step: ({ outputs, machine, dtMs }) => {
    const floorMs = 1000; // travel time per floor
    let pos = num(machine.pos, 1);
    const up = outputs['Y0'] === true;
    const down = outputs['Y1'] === true;
    let dir = 0;
    if (up && !down) {
      pos = Math.min(3, pos + dtMs / floorMs);
      dir = 1;
    } else if (down && !up) {
      pos = Math.max(1, pos - dtMs / floorMs);
      dir = -1;
    }
    const eps = 0.03;
    return {
      machine: { pos, dir },
      derivedInputs: {
        X3: Math.abs(pos - 1) < eps,
        X4: Math.abs(pos - 2) < eps,
        X5: Math.abs(pos - 3) < eps,
      },
    };
  },
};

/**
 * 5-floor passenger elevator with per-floor dispatch and an optional door.
 * Fixed address convention (shared by every puzzle that uses this process,
 * since — unlike `conveyor` — there are too many same-widget devices for a
 * dynamic widget lookup to disambiguate which is which):
 *   X0-X4   call buttons, floors 1-5
 *   X10-X14 floor-arrival sensors, floors 1-5
 *   X15/X16 door-open / door-closed sensors (only if the puzzle wires a door)
 *   Y0/Y1   motor up / motor down
 *   Y2      door-open command — its mere presence in `devices` is the
 *           door-feature-detect switch; puzzles that omit it get no door at
 *           all (`door` stays fully open/retracted and never gates motion).
 * Travel is 900ms/floor: the smallest value divisible by both the client's
 * live scan interval (60ms, useSimRunner.ts) and the grader's scan interval
 * (50ms, GRADE_DT) — that guarantees a same-scan cutoff of Y0/Y1 on seeing an
 * arrival sensor lands `pos` exactly on the integer under both scan cadences,
 * which matters here (unlike the 3-floor `elevator` above) because dispatch
 * needs reliable stops at *interior* floors, not just the two extremes a
 * clamp would save you at.
 */
function elevator5HasDoor(devices: PuzzleDevice[]): boolean {
  return devices.some((d) => d.address === 'Y2');
}

const elevator5: ProcessModel = {
  id: 'elevator5',
  init: (devices) => ({ pos: 1, dir: 0, door: elevator5HasDoor(devices) ? 0 : 1 }),
  step: ({ outputs, machine, devices, dtMs }) => {
    const floorMs = 900;
    const doorMs = 500;
    const eps = 0.02;
    const hasDoor = elevator5HasDoor(devices);

    let door = num(machine.door, hasDoor ? 0 : 1);
    if (hasDoor) {
      const openCmd = outputs['Y2'] === true;
      door = openCmd ? Math.min(1, door + dtMs / doorMs) : Math.max(0, door - dtMs / doorMs);
    } else {
      door = 1;
    }
    // Physical interlock: the car cannot move unless the door is confirmed
    // closed. A correct program only ever asserts Y0/Y1 after seeing X16, so
    // this is a no-op for it; an incorrect one sees the car visibly refuse to
    // move rather than failing a hidden assertion after the fact.
    const doorClosed = !hasDoor || door <= eps;

    let pos = num(machine.pos, 1);
    const up = outputs['Y0'] === true && outputs['Y1'] !== true && doorClosed;
    const down = outputs['Y1'] === true && outputs['Y0'] !== true && doorClosed;
    let dir = 0;
    if (up) {
      pos = Math.min(5, pos + dtMs / floorMs);
      dir = 1;
    } else if (down) {
      pos = Math.max(1, pos - dtMs / floorMs);
      dir = -1;
    }

    const derivedInputs: Record<string, boolean> = {
      X10: Math.abs(pos - 1) < eps,
      X11: Math.abs(pos - 2) < eps,
      X12: Math.abs(pos - 3) < eps,
      X13: Math.abs(pos - 4) < eps,
      X14: Math.abs(pos - 5) < eps,
    };
    if (hasDoor) {
      derivedInputs.X15 = door >= 1 - eps;
      derivedInputs.X16 = door <= eps;
    }
    return { machine: { pos, dir, door }, derivedInputs };
  },
};

/**
 * Carton packaging machine — six double-acting pneumatic actuators plus a
 * conveyor. Each actuator extends (position 0→1) while its output coil is
 * energized and retracts (spring return) otherwise; the machine reports the two
 * end-of-travel sensors for each. Fixed address convention (shared by every
 * packaging puzzle, mirroring the real Laboration-7 I/O list):
 *   Y0 2-pack push    → X0 in  / X1 out
 *   Y1 4-pack push    → X2 in  / X3 out
 *   Y2 lift up        → X4 down (in) / X5 up (out)
 *   Y3 16-pack1 push  → X6 in  / X7 out
 *   Y4 16-pack2 push  → X10 in / X11 out
 *   Y5 back-stop fwd  → X12 back (in) / X13 forward (out)
 * The conveyor box-presence sensors X14-X17 are driven by the scenario/HMI (a
 * carton either is or isn't there), so the process leaves them alone and only
 * mirrors them into machine state for the view. Every actuator's travel is a
 * multiple of both scan cadences (60ms client, 50ms grader) so end sensors trip
 * on the same scan under either — see the elevator5 note for why that matters.
 */
const PACK_ACTUATORS = [
  { cmd: 'Y0', inS: 'X0', outS: 'X1', ms: 600, key: 'push2' },
  { cmd: 'Y1', inS: 'X2', outS: 'X3', ms: 600, key: 'push4' },
  { cmd: 'Y2', inS: 'X4', outS: 'X5', ms: 900, key: 'lift' },
  { cmd: 'Y3', inS: 'X6', outS: 'X7', ms: 600, key: 'push16a' },
  { cmd: 'Y4', inS: 'X10', outS: 'X11', ms: 600, key: 'push16b' },
  { cmd: 'Y5', inS: 'X12', outS: 'X13', ms: 300, key: 'backstop' },
] as const;

const PACK_BOX_SENSORS = ['X14', 'X15', 'X16', 'X17'] as const;

const packaging: ProcessModel = {
  id: 'packaging',
  init: () => {
    const m: MachineState = {};
    for (const a of PACK_ACTUATORS) m[a.key] = 0;
    for (const s of PACK_BOX_SENSORS) m[`box_${s}`] = false;
    return m;
  },
  step: ({ outputs, inputs, machine, dtMs }) => {
    const eps = 0.02;
    const m: MachineState = {};
    const derivedInputs: Record<string, boolean> = {};
    for (const a of PACK_ACTUATORS) {
      const pos = num(machine[a.key]);
      const extend = outputs[a.cmd] === true;
      const next = extend ? Math.min(1, pos + dtMs / a.ms) : Math.max(0, pos - dtMs / a.ms);
      m[a.key] = next;
      derivedInputs[a.inS] = next <= eps;
      derivedInputs[a.outS] = next >= 1 - eps;
    }
    for (const s of PACK_BOX_SENSORS) m[`box_${s}`] = inputs[s] === true;
    return { machine: m, derivedInputs };
  },
};

const registry = new Map<string, ProcessModel>([
  [passthrough.id, passthrough],
  [conveyor.id, conveyor],
  [drill.id, drill],
  [press.id, press],
  [packaging.id, packaging],
  [elevator.id, elevator],
  [elevator5.id, elevator5],
]);

export function getProcess(id: string): ProcessModel {
  return registry.get(id) ?? passthrough;
}

export function registerProcess(model: ProcessModel): void {
  registry.set(model.id, model);
}
