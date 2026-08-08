import { describe, expect, it } from 'vitest';
import { factoryLine, LINE_LIMITS } from './factoryLine.js';
import type { MachineState } from './index.js';
import { SimEngine } from '../../sim/scanCycle.js';
import type { LadderProject, Rung } from '../../ladder/types.js';
import { isAnalog } from '../types.js';
import { LINE_DEVICES, SUP_PROGRAM } from '../content/factory-line-plant.js';
import {
  ASSEMBLY_PLAIN,
  ASSEMBLY_TUNED,
  PAINT_PLAIN,
  PAINT_TUNED,
  STORE_PLAIN,
  STORE_TUNED,
  TEST_PLAIN,
  TEST_TUNED,
  WELD_PLAIN,
  WELD_TUNED,
} from '../content/factory-line-programs.js';

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
    m = factoryLine.step({ outputs, inputs: {}, registers, machine: m, devices: [], dtMs }).machine;
  }
  return m;
}

function sensors(machine: MachineState, registers: Record<string, number> = {}) {
  return factoryLine.step({ outputs: {}, inputs: {}, registers, machine, devices: [], dtMs: 0 })
    .derivedInputs!;
}

function words(machine: MachineState) {
  return factoryLine.step({ outputs: {}, inputs: {}, registers: {}, machine, devices: [], dtMs: 0 })
    .derivedRegisters!;
}

const ON = (...addresses: string[]): Record<string, boolean> =>
  Object.fromEntries(addresses.map((a) => [a, true]));

/** Heater command that lands the booth in the middle of the cure band. */
const IN_BAND = { D2: 2200, D3: 4000 };

/**
 * Long enough for the booth to come up into the cure band from cold.
 *
 * The chamber is a first-order lag, so it does not arrive the moment the heater
 * is asked for: reaching the bottom of the band from stone cold takes about four
 * seconds, and paint laid before it gets there never sets at all. A real shift
 * pays this once at the start and the plain program keeps the booth hot for
 * exactly that reason.
 */
const WARM_MS = 8000;

const fresh = (): MachineState => factoryLine.init([]);

/**
 * One weld cycle, driven the way a correct program drives it.
 *
 * Clamp first, strike only once the fixture reports clamped, roll the weldment
 * over between a frame's two passes with the arc out, and release only when the
 * passes are done. Every one of those is an interlock on this fixture, so a test
 * that wants a welded part has to sequence it the way a solution does.
 */
function weldOne(machine: MachineState, part: 'f' | 'b', dtMs = 50): MachineState {
  const sel = part === 'b' ? ['Y6'] : [];
  let m = run(machine, 600, dtMs, ON('Y2', ...sel));
  // A hair over the longest pass on the fixture, for the same reason the shipped
  // programs use a preset a tenth over: a pass driven for exactly its own length
  // lands on 0.99999 and the fixture will not release a seam left short.
  m = run(m, 1300, dtMs, ON('Y2', 'Y3', ...sel));
  if (part === 'f') {
    m = run(m, 700, dtMs, ON('Y2', 'Y4', ...sel)); // roll over, arc out
    m = run(m, 1300, dtMs, ON('Y2', 'Y3', 'Y4', ...sel)); // second pass, held at B
  }
  return run(m, 500, dtMs, ON('Y5'));
}

/** Store a part standing on the infeed into `lane` (1-based). */
function loadLane(machine: MachineState, lane: number, dtMs = 50): MachineState {
  return run(machine, 900, dtMs, ON('Y8'), { D13: lane });
}

/** Draw the front part of `lane` out onto the outfeed. */
function pickLane(machine: MachineState, lane: number, dtMs = 50): MachineState {
  return run(machine, 900, dtMs, ON('Y9'), { D14: lane });
}

/**
 * The portal's full round trip: pick off the outfeed, carry, set on the skid.
 *
 * Lower and grip, raise, travel, lower, let go, raise, travel home — with the
 * vacuum held right through the traverse, because the head is over the aisle.
 */
function portalDrop(
  machine: MachineState,
  dtMs = 50,
  registers: Record<string, number> = {},
): MachineState {
  let m = run(machine, 400, dtMs, ON('Y12', 'Y13'), registers); // down onto the part, cups on
  // The raises get a margin over the 300 ms stroke on purpose. A head left a
  // hundredth of the way down is still down as far as the rail interlock is
  // concerned, and the portal jams the moment it is asked to travel.
  m = run(m, 400, dtMs, ON('Y13'), registers); // raise, still holding
  m = run(m, 900, dtMs, ON('Y10', 'Y13'), registers); // across to the booth
  m = run(m, 400, dtMs, ON('Y12', 'Y13'), registers); // down onto the skid
  return run(m, 300, dtMs, ON('Y12'), registers); // cups off, head still down
}

/** Raise off the skid and go back for the next one. */
function portalHome(
  machine: MachineState,
  dtMs = 50,
  registers: Record<string, number> = {},
): MachineState {
  const m = run(machine, 400, dtMs, {}, registers);
  return run(m, 900, dtMs, ON('Y11'), registers);
}

/** The portal's full round trip: pick off the outfeed, carry, set down, return. */
function portalCarry(
  machine: MachineState,
  dtMs = 50,
  registers: Record<string, number> = {},
): MachineState {
  return portalHome(portalDrop(machine, dtMs, registers), dtMs, registers);
}

describe('factory-line — the trajectory does not depend on dt', () => {
  // The invariant every continuous plant here is pinned by: integrate on a fixed
  // sub-step with a carried remainder, and the same slice of plant produces the
  // same state whether it arrives as 60 scans or as 300.
  it('welds a frame identically at 50 ms and at 10 ms', () => {
    expect(weldOne(fresh(), 'f', 10)).toEqual(weldOne(fresh(), 'f', 50));
  });

  it('holds for the booth’s integrators too', () => {
    const spray = (dt: number) => {
      let m = weldOne(fresh(), 'f', dt);
      m = loadLane(m, 1, dt);
      m = pickLane(m, 1, dt);
      m = portalCarry(m, dt);
      m = run(m, WARM_MS, dt, {}, IN_BAND); // blast, and bring the booth up
      return run(m, 1000, dt, ON('Y14'), IN_BAND); // spray
    };
    expect(spray(10)).toEqual(spray(50));
  });
});

describe('factory-line — weld', () => {
  it('clamps, runs two passes and rolls a frame onto the infeed', () => {
    const m = weldOne(fresh(), 'f');
    expect(m.storeIn).toBe('f');
    expect(m.weldPart).toBe('');
    expect(m.jam).toBe(false);
    expect(m.welded).toBe(1);
  });

  it('takes a boom in one pass when the selector says so', () => {
    const m = weldOne(fresh(), 'b');
    expect(m.storeIn).toBe('b');
    expect(m.jam).toBe(false);
  });

  it('jams if the torch strikes with nothing clamped', () => {
    expect(run(fresh(), 200, 50, ON('Y3')).jam).toBe(true);
  });

  it('jams if the torch strikes while the positioner is rolling over', () => {
    let m = run(fresh(), 600, 50, ON('Y2'));
    m = run(m, 1200, 50, ON('Y2', 'Y3'));
    // Y4 and Y3 together, part way through the roll.
    expect(run(m, 200, 50, ON('Y2', 'Y3', 'Y4')).jam).toBe(true);
  });

  it('jams if the fixture is released with a weldment part way through', () => {
    let m = run(fresh(), 600, 50, ON('Y2'));
    m = run(m, 1200, 50, ON('Y2', 'Y3')); // one of a frame's two passes
    expect(run(m, 200, 50, {}).jam).toBe(true);
  });

  it('blocks if a welded part is rolled onto an occupied infeed', () => {
    const m = weldOne(fresh(), 'f');
    expect(weldOne(m, 'b').blocked).toBe(true);
  });

  // Round the rack as we go: a lane is two deep, so eight booms only fit if they
  // are spread over all four of them.
  const stow = (m: MachineState, i: number) => loadLane(m, (i % LINE_LIMITS.STORE_LANES) + 1);

  it('wears the tip a pass at a time and reports it worn', () => {
    let m = fresh();
    // A boom spends one pass, a frame two; a tip is good for eight.
    for (let i = 0; i < 4; i++) m = stow(weldOne(m, 'b'), i);
    expect(m.tipPasses).toBe(4);
    expect(sensors(m).X9).toBe(false);
    for (let i = 4; i < LINE_LIMITS.TIP_LIFE; i++) m = stow(weldOne(m, 'b'), i);
    expect(m.tipPasses).toBe(LINE_LIMITS.TIP_LIFE);
    expect(sensors(m).X9).toBe(true);
  });

  it('finishes the weldment in the jaws before the worn tip stops it', () => {
    let m = fresh();
    for (let i = 0; i < LINE_LIMITS.TIP_LIFE - 1; i++) m = stow(weldOne(m, 'b'), i);
    // The eighth pass on a tip good for eight is allowed, because the check falls
    // when a weldment is started rather than when a pass is: a frame half welded
    // in the jaws is always finished.
    m = weldOne(m, 'b');
    expect(m.jam).toBe(false);
    expect(m.storeIn).toBe('b');
    m = stow(m, LINE_LIMITS.TIP_LIFE - 1);
    // The ninth strikes a new weldment on a spent tip.
    expect(weldOne(m, 'b').jam).toBe(true);
  });

  it('changes the tip only on an empty fixture', () => {
    let m = fresh();
    m = run(m, LINE_LIMITS.TIP_CHANGE_MS + 200, 50, ON('Y7'));
    expect(m.tipChanges).toBe(1);
    expect(m.tipPasses).toBe(0);
    expect(m.jam).toBe(false);

    const held = run(fresh(), 600, 50, ON('Y2'));
    expect(run(held, 200, 50, ON('Y7')).jam).toBe(true);
  });
});

describe('factory-line — rack store', () => {
  it('stacks into the selected lane and reports the count', () => {
    let m = weldOne(fresh(), 'f');
    m = loadLane(m, 3);
    expect(m.lane2).toBe('f');
    expect(m.storeIn).toBe('');
    expect(words(m).D6).toBe(1);
  });

  it('draws the front of a lane onto the outfeed, first in first out', () => {
    let m = weldOne(fresh(), 'f');
    m = loadLane(m, 1);
    m = weldOne(m, 'b');
    m = loadLane(m, 1);
    expect(m.lane0).toBe('fb');
    m = pickLane(m, 1);
    expect(m.storeOut).toBe('f');
    expect(m.lane0).toBe('b');
  });

  it('treats a stroke on an empty infeed or an empty lane as a wasted stroke', () => {
    // Both have to be harmless: the image a program decides on is a scan behind
    // the plant, so a level-driven coil is still on after the move completed.
    expect(run(fresh(), 1000, 50, ON('Y8'), { D13: 1 }).jam).toBe(false);
    expect(run(fresh(), 1000, 50, ON('Y9'), { D14: 1 }).jam).toBe(false);
  });

  it('jams on a lane number the rack does not have', () => {
    const m = weldOne(fresh(), 'f');
    expect(run(m, 200, 50, ON('Y8'), { D13: 5 }).jam).toBe(true);
    expect(run(m, 200, 50, ON('Y9'), { D14: 0 }).jam).toBe(true);
  });

  it('blocks if a part is stacked into a full lane', () => {
    let m = fresh();
    for (let i = 0; i < LINE_LIMITS.LANE_DEPTH; i++) {
      m = weldOne(m, 'f');
      m = loadLane(m, 1);
    }
    m = weldOne(m, 'f');
    expect(loadLane(m, 1).blocked).toBe(true);
  });
});

describe('factory-line — portal robot', () => {
  const withPartOut = (): MachineState => pickLane(loadLane(weldOne(fresh(), 'f'), 1), 1);

  it('carries a part from the outfeed onto the booth skid', () => {
    const dropped = portalDrop(withPartOut());
    expect(dropped.boothPart).toBe('f');
    expect(dropped.boothStage).toBe('blast');
    const m = portalHome(dropped);
    expect(m.jam).toBe(false);
    expect(m.storeOut).toBe('');
    expect(m.portalPart).toBe('');
    expect(m.boothPart).toBe('f');
  });

  it('jams if it sets off along the rail with the head down', () => {
    const m = run(withPartOut(), 400, 50, ON('Y12', 'Y13'));
    expect(run(m, 200, 50, ON('Y10', 'Y12', 'Y13')).jam).toBe(true);
  });

  it('jams if it lowers half way along the rail', () => {
    let m = run(withPartOut(), 400, 50, ON('Y12', 'Y13'));
    m = run(m, 300, 50, ON('Y13'));
    m = run(m, 400, 50, ON('Y10', 'Y13')); // part way across
    expect(run(m, 200, 50, ON('Y12', 'Y13')).jam).toBe(true);
  });

  it('jams if it drops the part from the top of the stroke', () => {
    let m = run(withPartOut(), 400, 50, ON('Y12', 'Y13'));
    m = run(m, 300, 50, ON('Y13')); // up, holding
    expect(run(m, 300, 50, {}).jam).toBe(true);
  });

  it('jams if it is driven both ways along the rail at once', () => {
    expect(run(fresh(), 200, 50, ON('Y10', 'Y11')).jam).toBe(true);
  });
});

describe('factory-line — booth and oven', () => {
  /** A frame standing on the booth skid, blasted, in a booth that is up to heat. */
  const readyToSpray = (dt = 50): MachineState => {
    const m = portalCarry(pickLane(loadLane(weldOne(fresh(), 'f'), 1), 1), dt);
    return run(m, WARM_MS, dt, {}, IN_BAND);
  };

  /** The same part on the same skid, in a booth nobody ever lit. */
  const coldAndReady = (): MachineState =>
    run(portalCarry(pickLane(loadLane(weldOne(fresh(), 'f'), 1), 1)), 1400, 50, {});

  it('lays film only inside the cure band', () => {
    const inBand = run(readyToSpray(), 1000, 50, ON('Y14'), IN_BAND);
    expect(words(inBand).D1).toBeGreaterThan(0);
    // Same gun, same second, a booth that was never brought up. Paint below the
    // band never cross-links, so none of it counts as film.
    const cold = coldAndReady();
    expect(words(cold).D0).toBeLessThan(LINE_LIMITS.CURE_MIN);
    expect(words(run(cold, 1000, 50, ON('Y14'), { D2: 0, D3: 4000 })).D1).toBe(0);
  });

  it('bakes longer for a thicker film', () => {
    const bake = (target: number) => {
      let m = readyToSpray();
      // Bounded rather than a bare `while`: a regression that stops the gun
      // laying film should fail this test, not hang the suite on it.
      for (let t = 0; t < 10_000 && words(m).D1 < target; t += 50) {
        m = run(m, 50, 50, ON('Y14'), IN_BAND);
      }
      expect(words(m).D1).toBeGreaterThanOrEqual(target);
      m = run(m, 100, 50, ON('Y15'), IN_BAND);
      return Number(m.ovenMs0);
    };
    expect(bake(2800)).toBeGreaterThan(bake(1600));
    expect(bake(1600)).toBeGreaterThan(LINE_LIMITS.CURE_BASE_MS);
  });

  it('scraps a part sprayed with the selector on a drum the gun is not loaded with', () => {
    let m = readyToSpray();
    // The gun holds colour 1 out of the box; ask for 2 without purging.
    m = run(m, 1000, 50, ON('Y14'), { ...IN_BAND, D15: 2 });
    expect(m.boothBlend).toBe(true);
  });

  it('changes the gun over on a completed purge', () => {
    const m = run(fresh(), LINE_LIMITS.PURGE_MS + 200, 50, ON('Y16'), { D15: 3 });
    expect(m.gunColor).toBe(3);
    expect(m.purges).toBe(1);
  });

  it('jams if the gun is purged while it is spraying, or onto no drum at all', () => {
    expect(run(readyToSpray(), 200, 50, ON('Y14', 'Y16'), { ...IN_BAND, D15: 2 }).jam).toBe(true);
    expect(run(fresh(), 200, 50, ON('Y16'), { D15: 0 }).jam).toBe(true);
  });

  it('purges free of the booth, so a blast and a flush run together', () => {
    // The flush goes to the waste pot: the part on the skid never sees it, and
    // the stage machine does not pause for it.
    let m = portalDrop(pickLane(loadLane(weldOne(fresh(), 'f'), 1), 1));
    expect(m.boothStage).toBe('blast');
    // A flush is exactly a blast cycle long, so it fits inside one for free: the
    // gun comes out the far end loaded with the new colour and the part on the
    // skid has finished blasting, having never seen a drop of it.
    m = run(m, LINE_LIMITS.PURGE_MS + 100, 50, ON('Y16'), { ...IN_BAND, D15: 4 });
    expect(m.gunColor).toBe(4);
    expect(m.boothStage).toBe('spray');
    expect(m.boothBlend).toBeFalsy();
    expect(m.jam).toBe(false);
  });

  it('holds a baked part in the oven while its painted lane is full', () => {
    // The discharge is a door, and a door with a full rail behind it does not
    // open. Faulting here would punish a program for a rack loaded six seconds
    // before it could have known.
    const m: MachineState = {
      ...fresh(),
      laneF: 'f'.repeat(LINE_LIMITS.PA_CAP),
      ovenPart0: 'f',
      ovenColor0: 1,
      ovenCure0: 1,
      ovenMs0: LINE_LIMITS.CURE_BASE_MS,
    };
    const after = run(m, 2000, 50, {}, IN_BAND);
    expect(after.ovenPart0).toBe('f');
    expect(after.jam).toBe(false);
    expect(after.blocked).toBe(false);
  });
});

describe('factory-line — final assembly', () => {
  const withParts = (frame = '1', boom = '1'): MachineState => ({
    ...fresh(),
    laneF: frame,
    laneB: boom,
  });

  it('builds engine, cab and boom in order and releases to test', () => {
    let m = run(withParts(), 100, 50, ON('Y17', 'Y18'));
    expect(m.assyFrame).toBe(1);
    expect(m.assyBoom).toBe(1);
    m = run(m, 2400, 50, ON('Y19', 'Y21')); // engine down, bench alongside
    m = run(m, 1900, 50, ON('Y20'));
    m = run(m, 2500, 50, ON('Y22'));
    expect(sensors(m).X26).toBe(true);
    m = run(m, 100, 50, ON('Y23'));
    // Straight into the bay: the test station pulls off the queue on the same
    // sub-step the jig puts a machine on it, so `bufAt` is back to nought.
    expect(m.testPart).toBe(true);
    expect(m.assyFrame).toBe(0);
    expect(m.assyBoom).toBe(0);
    expect(m.jam).toBe(false);
  });

  it('jams if the cab goes on before the engine, or the boom before the cab', () => {
    const loaded = run(withParts(), 100, 50, ON('Y17', 'Y18'));
    expect(run(loaded, 200, 50, ON('Y20')).jam).toBe(true);
    expect(run(loaded, 200, 50, ON('Y22')).jam).toBe(true);
  });

  it('jams if a boom is pinned without being made up on the bench', () => {
    let m = run(withParts(), 100, 50, ON('Y17', 'Y18'));
    m = run(m, 2400, 50, ON('Y19'));
    m = run(m, 1900, 50, ON('Y20'));
    expect(run(m, 200, 50, ON('Y22')).jam).toBe(true);
  });

  it('jams when a boom is pinned to a machine in another colour', () => {
    let m = run(withParts('1', '2'), 100, 50, ON('Y17', 'Y18'));
    m = run(m, 2400, 50, ON('Y19', 'Y21'));
    m = run(m, 1900, 50, ON('Y20'));
    const bad = run(m, 200, 50, ON('Y22'));
    expect(bad.jam).toBe(true);
    expect(String(bad.jamReason)).toContain('drifted a machine apart');
  });

  it('starves when the jig holds half a machine and the other lane never fills', () => {
    let m = run(withParts('1', ''), 100, 50, ON('Y17'));
    expect(m.assyFrame).toBe(1);
    m = run(m, 20_000, 50, {});
    expect(m.starved).toBe(true);
  });

  it('does not call an empty line starved', () => {
    expect(run(fresh(), 20_000, 50, {}).starved).toBe(false);
  });
});

describe('factory-line — test bay and dock', () => {
  const atTest = (): MachineState => run({ ...fresh(), bufAt: 1 }, 50, 50, {});

  it('pumps up, runs the cycle and drives the machine into the yard', () => {
    let m = run(atTest(), 1300, 50, ON('Y24'));
    m = run(m, 2700, 50, ON('Y24', 'Y25'));
    expect(sensors(m).X29).toBe(true);
    m = run(m, 1500, 50, ON('Y26')); // pump dropped first
    expect(m.yard).toBe(1);
    expect(m.shipped).toBe(1);
    expect(m.jam).toBe(false);
  });

  it('jams if the function test runs before the hydraulics are up', () => {
    expect(run(atTest(), 200, 50, ON('Y25')).jam).toBe(true);
  });

  it('jams if the machine is driven off with the rig still under pressure', () => {
    let m = run(atTest(), 1300, 50, ON('Y24'));
    m = run(m, 2700, 50, ON('Y24', 'Y25'));
    expect(run(m, 200, 50, ON('Y24', 'Y26')).jam).toBe(true);
  });

  it('sends a truck that arrives, loads and leaves', () => {
    let m: MachineState = { ...fresh(), yard: 5 };
    m = run(m, LINE_LIMITS.TRUCK_ARRIVE_MS + 200, 50, ON('Y27'));
    expect(m.truckState).toBe('docked');
    expect(sensors(m).X31).toBe(true);
    m = run(m, 6000, 50, ON('Y27'));
    expect(m.yard).toBe(0);
    m = run(m, 6000, 50, {}); // drop the call and it pulls off
    expect(m.trucksSent).toBe(1);
  });

  it('counts a lorry sent away part loaded', () => {
    let m: MachineState = { ...fresh(), yard: 1 };
    m = run(m, LINE_LIMITS.TRUCK_ARRIVE_MS + 1200, 50, ON('Y27'));
    m = run(m, 6000, 50, {});
    expect(m.partLoads).toBe(1);
  });

  it('will not take another truck inside the haulier’s rotation', () => {
    let m: MachineState = { ...fresh(), yard: 6 };
    m = run(m, LINE_LIMITS.TRUCK_ARRIVE_MS + 8000, 50, ON('Y27'));
    m = run(m, 6000, 50, {}); // away
    expect(m.truckState).toBe('away');
    // Call again straight afterwards: the dock is still turning round.
    m = run(m, 2000, 50, ON('Y27'));
    expect(m.truckState).toBe('away');
  });
});

// --- The shipped programs, on the plant ---------------------------------------

const outDevs = LINE_DEVICES.filter((d) => d.io === 'output' && !isAnalog(d));
const anaDevs = LINE_DEVICES.filter(isAnalog);

interface LineResult {
  machine: MachineState;
  shipped: number;
}

/**
 * Run the whole line for `ms` with one program per section.
 *
 * This is the guardrail the station tests cannot be: every fault on this plant
 * is a collision between two sections that are each correct alone, and the only
 * way to see one is to run all six together for long enough that the buffers
 * fill. Both bugs this file was written after — a portal whose step latches were
 * being overwritten by the rack's room flags, and a purge gated on an empty
 * booth the portal never leaves empty long enough — ran clean for a minute
 * apiece before they stopped the line for good.
 */
function runLine(sections: Record<string, Rung[]>, ms: number): LineResult {
  const project: LadderProject = {
    pous: [
      { id: 'SUP', name: 'SUP', rungs: SUP_PROGRAM },
      { id: 'WELD', name: 'WELD', rungs: sections.WELD },
      { id: 'STORE', name: 'STORE', rungs: sections.STORE },
      { id: 'PAINT', name: 'PAINT', rungs: sections.PAINT },
      { id: 'ASSY', name: 'ASSY', rungs: sections.ASSY },
      { id: 'TEST', name: 'TEST', rungs: sections.TEST },
    ],
    tasks: [
      {
        id: 'MAIN',
        name: 'MAIN',
        priority: 0,
        pous: ['SUP', 'WELD', 'STORE', 'PAINT', 'ASSY', 'TEST'],
      },
    ],
  };
  const engine = new SimEngine(project);
  engine.reset();
  let machine = factoryLine.init(LINE_DEVICES);
  const inputs: Record<string, boolean> = { X0: true, X1: true, X2: true, X3: true };
  let derived: Record<string, boolean> = {};
  let derivedRegs: Record<string, number> = {};
  const dt = 50;

  for (let t = 0; t < ms; t += dt) {
    engine.setInputs(inputs);
    engine.setInputs(derived);
    engine.setRegisters(derivedRegs);
    engine.scan(dt);
    const outputs: Record<string, boolean> = {};
    for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
    const registers: Record<string, number> = {};
    for (const d of anaDevs) registers[d.address] = engine.getRegister(d.address);
    const res = factoryLine.step({
      outputs,
      inputs,
      registers,
      machine,
      devices: LINE_DEVICES,
      dtMs: dt,
    });
    machine = res.machine;
    derived = res.derivedInputs ?? {};
    derivedRegs = res.derivedRegisters ?? {};
  }
  return { machine, shipped: Number(machine.shipped) };
}

const PLAIN: Record<string, Rung[]> = {
  WELD: WELD_PLAIN,
  STORE: STORE_PLAIN,
  PAINT: PAINT_PLAIN,
  ASSY: ASSEMBLY_PLAIN,
  TEST: TEST_PLAIN,
};
const TUNED: Record<string, Rung[]> = {
  WELD: WELD_TUNED,
  STORE: STORE_TUNED,
  PAINT: PAINT_TUNED,
  ASSY: ASSEMBLY_TUNED,
  TEST: TEST_TUNED,
};

/** Long enough for every buffer on the line to fill and start pushing back. */
const SOAK_MS = 180_000;

describe('factory-line — the shipped programs run the plant', () => {
  const clean = (r: LineResult) => ({
    jam: r.machine.jam,
    blocked: r.machine.blocked,
    starved: r.machine.starved,
    scrapped: r.machine.scrapped,
    reason: r.machine.jamReason ?? '',
  });
  const OK = { jam: false, blocked: false, starved: false, scrapped: 0, reason: '' };

  it('runs a full shift on the tuned programs with no fault and no scrap', { timeout: 30_000 }, () => {
    const r = runLine(TUNED, SOAK_MS);
    expect(clean(r)).toEqual(OK);
    expect(r.shipped).toBeGreaterThan(15);
  });

  it('runs a full shift on the plain programs too, only slower', { timeout: 30_000 }, () => {
    // The capstone seeds all six sections with these, so "plain" has to mean
    // leaves output on the floor, never stops the line.
    const r = runLine(PLAIN, SOAK_MS);
    expect(clean(r)).toEqual(OK);
    expect(r.shipped).toBeGreaterThan(10);
  });

  it('ships more tuned than plain', { timeout: 30_000 }, () => {
    expect(runLine(TUNED, SOAK_MS).shipped).toBeGreaterThan(runLine(PLAIN, SOAK_MS).shipped);
  });

  it.each(Object.keys(TUNED))(
    'runs clean with %s plain and the rest tuned',
    { timeout: 30_000 },
    (section) => {
      // How a station puzzle is actually configured: tuned neighbours, one bay
      // the player is about to rewrite. Each of these has to survive a shift.
      expect(clean(runLine({ ...TUNED, [section]: PLAIN[section] }, SOAK_MS))).toEqual(OK);
    },
  );
});
