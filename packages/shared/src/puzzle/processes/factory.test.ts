import { describe, expect, it } from 'vitest';
import { factory, FACTORY_LIMITS } from './factory.js';
import type { MachineState } from './index.js';

/** Drive the plant for `ms` with a fixed set of outputs and registers. */
function run(
  machine: MachineState,
  ms: number,
  dtMs: number,
  outputs: Record<string, boolean>,
  registers: Record<string, number> = {},
): MachineState {
  let m = machine;
  for (let t = 0; t < ms; t += dtMs) {
    m = factory.step({ outputs, inputs: {}, registers, machine: m, devices: [], dtMs }).machine;
  }
  return m;
}

function sensors(machine: MachineState, registers: Record<string, number> = {}) {
  return factory.step({ outputs: {}, inputs: {}, registers, machine, devices: [], dtMs: 0 })
    .derivedInputs!;
}

const ON = (...addresses: string[]): Record<string, boolean> =>
  Object.fromEntries(addresses.map((a) => [a, true]));

/** Heater command that lands the booth in the middle of the cure band. */
const IN_BAND = { D2: 2200, D3: 4000 };

/**
 * One complete weld cycle, driven the way a correct program drives it: clamp
 * *first*, strike the torch only once the fixture reports clamped, then release.
 * Striking early is the station's interlock, so a test that wants a welded part
 * has to sequence it properly — same as a solution does.
 */
function weldOne(machine: MachineState, part: 'f' | 'b', dtMs = 50): MachineState {
  const sel = part === 'b' ? ['Y6'] : [];
  let m = run(machine, 700, dtMs, ON('Y2', ...sel));
  m = run(m, part === 'f' ? 3200 : 2200, dtMs, ON('Y2', 'Y3', ...sel));
  return run(m, 600, dtMs, ON('Y5'));
}

describe('factory — the trajectory does not depend on dt', () => {
  // The invariant every continuous plant here is pinned by: integrate on a fixed
  // sub-step with a carried remainder, and the same 3 seconds of plant produce
  // the same state whether they arrive as 60 scans or as 300.
  it('reaches identical state at 50 ms and at 10 ms', () => {
    expect(weldOne(factory.init([]), 'f', 10)).toEqual(weldOne(factory.init([]), 'f', 50));
  });

  it('holds for the paint booth’s integrators too', () => {
    // Get a part into the booth and spraying, then compare the analog states.
    const spray = (dt: number) => {
      let m = weldOne(factory.init([]), 'f', dt);
      m = run(m, 2000, dt, ON('Y7'), IN_BAND); // pull it into the booth, blast
      return run(m, 2000, dt, ON('Y8'), IN_BAND); // spray
    };
    expect(spray(10)).toEqual(spray(50));
  });
});

describe('factory — weld station', () => {
  it('clamps, welds and releases a frame into the buffer', () => {
    const m = weldOne(factory.init([]), 'f');
    expect(m.bufWp).toBe('f');
    expect(m.weldPart).toBe('');
    expect(m.jam).toBe(false);
  });

  it('loads a boom when the selector says so', () => {
    expect(weldOne(factory.init([]), 'b').bufWp).toBe('b');
  });

  it('keeps the queue in the order the parts were welded', () => {
    let m = weldOne(factory.init([]), 'f');
    m = weldOne(m, 'b');
    expect(m.bufWp).toBe('fb');
  });

  it('jams if the torch strikes with nothing clamped', () => {
    const m = run(factory.init([]), 500, 50, ON('Y3'));
    expect(m.jam).toBe(true);
    expect(m.jamReason).toContain('nothing clamped');
  });

  it('blocks when the weld buffer overruns', () => {
    // Four parts into a buffer that holds three, with nothing pulling them out.
    let m = factory.init([]);
    for (let i = 0; i < FACTORY_LIMITS.WP_CAP + 1; i++) m = weldOne(m, 'f');
    expect(m.blocked).toBe(true);
    expect(m.jamReason).toContain('full weld buffer');
  });
});

describe('factory — paint booth', () => {
  /** A welded part sitting in the weld buffer, ready for the booth. */
  const welded = (part: 'f' | 'b' = 'f'): MachineState => weldOne(factory.init([]), part);

  /** The booth transmitters as the program would read them. */
  function registers(m: MachineState, cmd: Record<string, number>) {
    return factory.step({ outputs: {}, inputs: {}, registers: cmd, machine: m, devices: [], dtMs: 0 })
      .derivedRegisters!;
  }

  it('holds the booth temperature toward the heater command', () => {
    const m = run(factory.init([]), 20_000, 50, {}, { D2: 2200 });
    const regs = registers(m, { D2: 2200 });
    expect(regs.D0).toBeGreaterThan(2000);
    expect(regs.D0).toBeLessThanOrEqual(2200);
  });

  it('builds film only while the booth is inside the cure band', () => {
    // The booth is a lagged oven, so it has to be brought up to temperature
    // before anything is sprayed — which is the station's whole job.
    let hot = run(welded(), 8000, 50, {}, IN_BAND);
    hot = run(hot, 1500, 50, ON('Y7'), IN_BAND);
    hot = run(hot, 2000, 50, ON('Y8'), IN_BAND);

    // Heater off: the booth never reaches the band, so nothing sticks.
    let cold = run(welded(), 8000, 50, {}, { D2: 0, D3: 4000 });
    cold = run(cold, 1500, 50, ON('Y7'), { D2: 0, D3: 4000 });
    cold = run(cold, 2000, 50, ON('Y8'), { D2: 0, D3: 4000 });

    expect(Number(hot.filmM)).toBeGreaterThan(0);
    expect(Number(cold.filmM)).toBe(0);
  });

  /** A welded part sprayed to a good film in a booth already up to temperature. */
  function sprayed(part: 'f' | 'b' = 'f'): MachineState {
    let m = run(welded(part), 8000, 50, {}, IN_BAND); // preheat
    m = run(m, 1500, 50, ON('Y7'), IN_BAND); // infeed + blast
    return run(m, 2400, 50, ON('Y8'), IN_BAND); // spray to film
  }

  it('delivers a good part to the painted buffer after the fixed cure', () => {
    let m = run(sprayed(), 100, 50, ON('Y9'), IN_BAND); // into the oven
    expect(m.paintStage).toBe('cure');

    m = run(m, FACTORY_LIMITS.PAINT_CURE_MS + 200, 50, {}, IN_BAND);
    expect(m.bufPaFrames).toBe(1);
    expect(m.scrapped).toBe(0);
  });

  it('scraps a part baked out of the cure band', () => {
    let m = run(sprayed(), 100, 50, ON('Y9'), IN_BAND);
    // Heater cut the moment it goes in the oven: the finish never cross-links.
    m = run(m, FACTORY_LIMITS.PAINT_CURE_MS + 200, 50, {}, { D2: 0 });
    expect(m.scrapped).toBe(1);
    expect(m.bufPaFrames).toBe(0);
  });
});

describe('factory — assembly needs both streams', () => {
  it('starves when the line only ever builds frames', () => {
    // No booms are ever welded, so assembly can never finish a machine. This is
    // the category's central failure and it must be reachable without any
    // interlock being broken.
    let m = factory.init([]);
    m.bufPaFrames = 3;
    m.bufPaBooms = 0;
    m = run(m, 15_000, 50, ON('Y10'));
    expect(m.starved).toBe(true);
    expect(m.jamReason).toContain('wrong mix');
  });

  it('does not starve while both types keep arriving', () => {
    let m = factory.init([]);
    m.bufPaFrames = 2;
    m.bufPaBooms = 2;
    m = run(m, 15_000, 50, ON('Y10', 'Y11'));
    expect(m.starved).toBe(false);
    expect(m.assyHasFrame).toBe(true);
    expect(m.assyHasBoom).toBe(true);
  });

  it('jams if the engine is lowered with no frame in the jig', () => {
    const m = run(factory.init([]), 500, 50, ON('Y12'));
    expect(m.jam).toBe(true);
    expect(m.jamReason).toContain('no frame in the jig');
  });

  it('builds and releases a machine in order', () => {
    let m = factory.init([]);
    m.bufPaFrames = 1;
    m.bufPaBooms = 1;
    m = run(m, 100, 50, ON('Y10', 'Y11'));
    m = run(m, 2400, 50, ON('Y12'));
    m = run(m, 2000, 50, ON('Y13'));
    m = run(m, 2600, 50, ON('Y14'));
    expect(sensors(m).X14).toBe(true);

    // Released into the test queue — from which the bay pulls it on the same
    // sub-step, so the machine is already on the test pad rather than queued.
    m = run(m, 100, 50, ON('Y15'));
    expect(m.testPart).toBe(true);
    expect(m.assyHasFrame).toBe(false);
    expect(m.assyEngine).toBe(0);
  });
});

describe('factory — test and dispatch', () => {
  it('pumps, tests and ships a machine', () => {
    let m = factory.init([]);
    m.bufAt = 1;
    m = run(m, 100, 50, {}); // the bay pulls it in
    expect(m.testPart).toBe(true);

    m = run(m, 1400, 50, ON('Y16'));
    m = run(m, 2800, 50, ON('Y16', 'Y17'));
    expect(sensors(m).X18).toBe(true);

    m = run(m, 1600, 50, ON('Y16', 'Y17', 'Y18'));
    expect(m.shipped).toBe(1);
    expect(m.testPart).toBe(false);
  });

  it('jams if the function test runs before pressure is up', () => {
    let m = factory.init([]);
    m.bufAt = 1;
    m = run(m, 100, 50, {});
    m = run(m, 500, 50, ON('Y17'));
    expect(m.jam).toBe(true);
    expect(m.jamReason).toContain('up to pressure');
  });

  it('blocks when the yard is full', () => {
    let m = factory.init([]);
    m.bufAt = 1;
    m.yard = FACTORY_LIMITS.YARD_CAP;
    m = run(m, 100, 50, {});
    m = run(m, 1400, 50, ON('Y16'));
    m = run(m, 2800, 50, ON('Y16', 'Y17'));
    m = run(m, 200, 50, ON('Y16', 'Y17', 'Y18'));
    expect(m.blocked).toBe(true);
    expect(m.jamReason).toContain('full yard');
  });
});
