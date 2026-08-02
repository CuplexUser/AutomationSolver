import { describe, expect, it } from 'vitest';
import type { PuzzleDevice } from '../types.js';
import { getProcess, type MachineState } from './index.js';

const dev = (address: string, io: 'input' | 'output'): PuzzleDevice => ({
  address,
  label: address,
  io,
  widget: io === 'input' ? 'sensor' : 'motor',
});

/** Bare traverse: no forks, so no load interlocks exist at all. */
const bare: PuzzleDevice[] = [dev('D0', 'input'), dev('D20', 'output')];
/** The traverse with forks on it. */
const withForks: PuzzleDevice[] = [...bare, dev('Y4', 'output')];
/** The full crane: forks on a hoist rope. */
const withHoist: PuzzleDevice[] = [...withForks, dev('Y2', 'output')];

interface Run {
  machine: MachineState;
  derivedInputs: Record<string, boolean>;
  derivedRegisters: Record<string, number>;
}

/**
 * Step the plant `n` times with a fixed command. `script` may override either
 * per step, which is how the sequencing tests below drive the forks.
 */
function run(
  devices: PuzzleDevice[],
  start: MachineState,
  outputs: Record<string, boolean>,
  registers: Record<string, number>,
  n: number,
  dtMs: number,
  script?: (m: MachineState, i: number) => { outputs?: Record<string, boolean>; registers?: Record<string, number> },
): Run {
  const process = getProcess('axis');
  let machine = start;
  let derivedInputs: Record<string, boolean> = {};
  let derivedRegisters: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const over = script?.(machine, i) ?? {};
    const res = process.step({
      outputs: over.outputs ?? outputs,
      inputs: {},
      registers: over.registers ?? registers,
      machine,
      devices,
      dtMs,
    });
    machine = res.machine;
    derivedInputs = res.derivedInputs ?? {};
    derivedRegisters = res.derivedRegisters ?? {};
  }
  return { machine, derivedInputs, derivedRegisters };
}

const init = (devices: PuzzleDevice[]): MachineState => getProcess('axis').init(devices);

/** A commissioned drive: mid-range ramp rates, well inside the empty limits. */
const PARAMS = { D40: 1000, D41: 1000, D20: 4000 };

describe('axis process — fixed-point determinism', () => {
  /**
   * The property the whole fixed sub-step exists for, and the one an integrator
   * cannot get from exact-multiple timings the way the boolean models do. A
   * position that depended on `dt` would put the client's live run and the
   * server's grade on different trajectories within a second.
   */
  it('reaches the identical position whatever dt it is stepped at', () => {
    const at10 = run(bare, init(bare), { Y0: true }, PARAMS, 300, 10);
    const at50 = run(bare, init(bare), { Y0: true }, PARAMS, 60, 50);
    const at60 = run(bare, init(bare), { Y0: true }, PARAMS, 50, 60);

    expect(at50.machine.posMilli).toBe(at10.machine.posMilli);
    expect(at60.machine.posMilli).toBe(at10.machine.posMilli);
    expect(at50.machine.velMilli).toBe(at10.machine.velMilli);
  });

  it('carries a partial sub-step rather than losing or gaining travel', () => {
    // 35ms is 3.5 sub-steps: the remainder has to survive into the next call.
    const a = run(bare, init(bare), { Y0: true }, PARAMS, 20, 35);
    const b = run(bare, init(bare), { Y0: true }, PARAMS, 70, 10);
    expect(a.machine.posMilli).toBe(b.machine.posMilli);
  });

  it('reports whole counts on every register it drives', () => {
    const { machine, derivedRegisters } = run(withHoist, init(withHoist), { Y0: true, Y3: true }, { ...PARAMS, D21: 4000 }, 37, 50);
    for (const [key, value] of Object.entries(derivedRegisters)) {
      expect(Number.isInteger(value), `${key} = ${value}`).toBe(true);
    }
    expect(Number.isInteger(machine.pos)).toBe(true);
    expect(Number.isInteger(machine.vel)).toBe(true);
  });
});

describe('axis process — the ramp is the parameter', () => {
  it('takes as long to reach full speed as the accel rate says', () => {
    // 1000 counts of speed per second, so 4000 counts of reference is 4.0 s.
    const short = run(bare, init(bare), { Y0: true }, PARAMS, 78, 50); // 3.9 s
    const long = run(bare, init(bare), { Y0: true }, PARAMS, 80, 50); // 4.0 s
    expect(short.machine.vel).toBeLessThan(4000);
    expect(long.machine.vel).toBe(4000);
  });

  it('brakes on the decel parameter, not the accel one', () => {
    const start = init(bare);
    // Up to full speed on a slow ramp, then let go with a fast one.
    const cruising = run(bare, start, { Y0: true }, { D40: 500, D41: 2500, D20: 4000 }, 200, 50);
    expect(cruising.machine.vel).toBe(4000);
    const coasting = run(bare, cruising.machine, {}, { D40: 500, D41: 2500, D20: 4000 }, 32, 50);
    // 4000 / 2500 = 1.6 s to stop, so 1.6 s later it is stationary — which it
    // would be nowhere near if braking used the 500 the accel side does.
    expect(coasting.machine.vel).toBe(0);
  });

  it('brakes to a stop before accelerating the other way', () => {
    const start = init(bare);
    const fwd = run(bare, start, { Y0: true }, PARAMS, 100, 50);
    expect(fwd.machine.vel).toBe(4000);
    // Reverse commanded: the drive must pass through zero, never jump the sign.
    const process = getProcess('axis');
    let m = fwd.machine;
    let sawZero = false;
    let previous = m.vel as number;
    for (let i = 0; i < 200; i++) {
      m = process.step({
        outputs: { Y1: true },
        inputs: {},
        registers: PARAMS,
        machine: m,
        devices: bare,
        dtMs: 50,
      }).machine;
      const vel = m.vel as number;
      if (vel === 0) sawZero = true;
      // Sign never flips without stopping first.
      expect(previous > 0 && vel < 0).toBe(false);
      previous = vel;
    }
    expect(sawZero).toBe(true);
    expect(m.vel).toBe(-4000);
  });
});

describe('axis process — what trips the drive', () => {
  it('refuses to start until both ramp parameters are loaded', () => {
    const noDecel = run(bare, init(bare), { Y0: true }, { D40: 1000, D41: 0, D20: 4000 }, 4, 50);
    expect(noDecel.machine.jam).toBe(true);
    expect(noDecel.machine.jamReason).toContain('parameters were loaded');
  });

  it('leaves a drive alone that has parameters but no run command', () => {
    const idle = run(bare, init(bare), {}, { D40: 0, D41: 0, D20: 4000 }, 20, 50);
    expect(idle.machine.jam).toBe(false);
  });

  it('trips on overcurrent above the empty accel limit, and not below it', () => {
    const ok = run(bare, init(bare), { Y0: true }, { D40: 2000, D41: 2000, D20: 4000 }, 40, 50);
    expect(ok.machine.jam).toBe(false);
    const over = run(bare, init(bare), { Y0: true }, { D40: 2001, D41: 2000, D20: 4000 }, 4, 50);
    expect(over.machine.jam).toBe(true);
    expect(over.machine.jamReason).toContain('overcurrent');
  });

  /** The fact `axis-loaded` is built on: the same ramp is legal empty and not loaded. */
  it('halves the accel limit once a pallet is on the forks', () => {
    const picked = pickUp();
    expect(picked.loaded).toBe(true);
    const wouldBeFineEmpty = run(withForks, picked, { Y0: true, Y4: true }, { D40: 1500, D41: 1000, D20: 4000 }, 4, 50);
    expect(wouldBeFineEmpty.machine.jam).toBe(true);
    expect(wouldBeFineEmpty.machine.jamReason).toContain('loaded carriage too hard');
  });

  it('slides the pallet off the forks when a loaded carriage brakes too hard', () => {
    const picked = pickUp();
    const params = { D40: 1000, D41: 1000, D20: 4000 };
    const cruising = run(withForks, picked, { Y0: true, Y4: true }, params, 40, 50);
    expect(cruising.machine.jam).toBe(false);
    // Same carriage, same load, only the braking parameter changed.
    const braked = run(
      withForks,
      cruising.machine,
      { Y4: true },
      { D40: 1000, D41: 2500, D20: 4000 },
      4,
      50,
    );
    expect(braked.machine.jam).toBe(true);
    expect(braked.machine.jamReason).toContain('slid off the forks');
  });

  it('crashes into an end stop at speed but not at a crawl', () => {
    const fast = run(bare, init(bare), { Y1: true }, { D40: 2000, D41: 2000, D20: 4000 }, 200, 50);
    expect(fast.machine.jam).toBe(true);
    expect(fast.machine.jamReason).toContain('home end stop');

    const crawl = run(bare, init(bare), { Y1: true }, { D40: 2000, D41: 2000, D20: 200 }, 400, 50);
    expect(crawl.machine.jam).toBe(false);
    expect(crawl.machine.pos).toBe(0);
  });

  it('stops a loaded carriage that runs past the drop station into the rack', () => {
    const picked = pickUp();
    // Full speed, and never a command to slow down: it sails through the station.
    const over = run(withForks, picked, { Y0: true, Y4: true }, { D40: 1000, D41: 1000, D20: 4000 }, 400, 50);
    expect(over.machine.jam).toBe(true);
    expect(over.machine.jamReason).toContain('rack face');
  });
});

/** Close the forks on the pallet waiting at the pick station, and return the state. */
function pickUp(devices: PuzzleDevice[] = withForks): MachineState {
  const { machine } = run(devices, init(devices), { Y4: true }, { D40: 1000, D41: 1000, D20: 0 }, 10, 50);
  return machine;
}

describe('axis process — the forks', () => {
  it('picks up at the pick station and only with the carriage stopped', () => {
    expect(pickUp().loaded).toBe(true);

    // Same command, issued while rolling: the forks are wrecked instead.
    const rolling = run(withForks, init(withForks), { Y0: true }, { D40: 1000, D41: 1000, D20: 4000 }, 20, 50);
    const grabbed = run(withForks, rolling.machine, { Y0: true, Y4: true }, { D40: 1000, D41: 1000, D20: 4000 }, 10, 50);
    expect(grabbed.machine.jam).toBe(true);
    expect(grabbed.machine.jamReason).toContain('still moving');
  });

  it('counts a pallet only when it is set down at the drop station', () => {
    // Carry it out, stop inside the window, then open the forks.
    const carried = run(
      withForks,
      pickUp(),
      { Y4: true },
      { D40: 1000, D41: 1000, D20: 4000 },
      600,
      50,
      (m) => ({
        outputs: { Y0: (m.pos as number) < 3360, Y4: true },
        registers: {
          D40: 1000,
          D41: 1000,
          D20: 3400 - (m.pos as number) > 1000 ? 4000 : 400,
        },
      }),
    );
    expect(carried.machine.jam).toBe(false);
    expect(carried.machine.loaded).toBe(true);
    expect(carried.machine.placed).toBe(0);

    const released = run(withForks, carried.machine, {}, { D40: 1000, D41: 1000, D20: 0 }, 20, 50);
    expect(released.machine.loaded).toBe(false);
    expect(released.machine.placed).toBe(1);
  });

  /**
   * Feature detection, elevator5-door style: a puzzle that never wires the
   * forks must not be able to fail a load interlock it has no way to see.
   */
  it('gives a puzzle with no forks no load state at all', () => {
    const { machine, derivedInputs } = run(bare, init(bare), { Y4: true, Y0: true }, PARAMS, 40, 50);
    expect(machine.loaded).toBeUndefined();
    expect(machine.hasForks).toBeUndefined();
    expect(derivedInputs.X14).toBeUndefined();
    expect(machine.jam).toBe(false);
  });
});

describe('axis process — sway', () => {
  const craneParams = { D40: 1000, D41: 1200, D20: 4000, D21: 4000 };

  it('stays still while the trolley does', () => {
    const { machine, derivedRegisters } = run(withHoist, init(withHoist), { Y3: true }, craneParams, 100, 50);
    expect(machine.swayAmp).toBe(0);
    expect(derivedRegisters.D3).toBe(0);
  });

  /**
   * The reason the *amplitude* is what the program is handed. A pendulum passes
   * through vertical four times a second, so an interlock on the instantaneous
   * angle would go true at exactly the moment the load is moving fastest.
   */
  it('reports an envelope that decays instead of an angle that oscillates', () => {
    const moved = run(withHoist, init(withHoist), { Y0: true }, craneParams, 60, 50);
    const stopped = run(withHoist, moved.machine, {}, craneParams, 60, 50);
    expect(stopped.machine.vel).toBe(0);
    expect(stopped.machine.swayAmp as number).toBeGreaterThan(0);

    // The angle crosses zero repeatedly over the next few seconds; the
    // amplitude never goes back up.
    const process = getProcess('axis');
    let m = stopped.machine;
    let crossings = 0;
    let previousAngle = m.sway as number;
    let previousAmp = m.swayAmp as number;
    for (let i = 0; i < 100; i++) {
      m = process.step({ outputs: {}, inputs: {}, registers: craneParams, machine: m, devices: withHoist, dtMs: 50 }).machine;
      const angle = m.sway as number;
      if (previousAngle > 0 !== angle > 0) crossings++;
      expect(m.swayAmp as number).toBeLessThanOrEqual(previousAmp);
      previousAngle = angle;
      previousAmp = m.swayAmp as number;
    }
    expect(crossings).toBeGreaterThan(2);
  });

  it('catches the rack if the hook comes down while the load is still swinging', () => {
    const moved = run(withHoist, init(withHoist), { Y0: true }, craneParams, 60, 50);
    const stopped = run(withHoist, moved.machine, {}, craneParams, 20, 50);
    expect(stopped.machine.jam).toBe(false);
    const lowered = run(withHoist, stopped.machine, { Y3: true }, craneParams, 2, 50);
    expect(lowered.machine.jam).toBe(true);
    expect(lowered.machine.jamReason).toContain('swinging');
  });

  it('lets the hook down once the swing has died away', () => {
    const moved = run(withHoist, init(withHoist), { Y0: true }, craneParams, 60, 50);
    const settled = run(withHoist, moved.machine, {}, craneParams, 400, 50);
    expect(settled.derivedInputs.X17).toBe(true);
    const lowered = run(withHoist, settled.machine, { Y3: true }, craneParams, 100, 50);
    expect(lowered.machine.jam).toBe(false);
    expect(lowered.derivedInputs.X16).toBe(true);
  });
});
