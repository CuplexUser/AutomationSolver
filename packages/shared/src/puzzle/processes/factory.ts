import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * A mid-size excavator line: four stations, two part streams, one plant.
 *
 * Every machine before this one was a machine. This is a *factory*, and the
 * difference is not size — it is that no station here can be programmed
 * correctly on its own. Weld can run flat out and still starve final assembly;
 * paint can hold a perfect cure and still block the line; the supervisor can
 * stop everything safely and leave a part baking in the oven. The four sections
 * are four programs that only work as one, which is the whole reason the
 * category needs POUs and tasks at all.
 *
 * ## The line
 *
 *   WELD  ->  PAINT  ->  (buffer)  ->  ASSEMBLY  ->  TEST & DISPATCH
 *
 * Weld and paint each handle **two part types** — chassis frames and booms —
 * and final assembly needs *one of each* to build a machine. So the line's real
 * problem is not keeping the stations busy, it is keeping the **mix** right: a
 * program that welds frames as fast as it can will fill every buffer with
 * frames and starve assembly of booms, and the plant will look busy while
 * shipping nothing. That is the lesson, and `parMs` pays for noticing it.
 *
 * ## Backpressure
 *
 * Buffers are small and finite, and they push back up the line: the yard fills,
 * so test holds, so assembly blocks, so paint cannot discharge its oven, so
 * weld has nowhere to put a finished part. A section that ignores its
 * downstream neighbour's `full` bit overruns a buffer and latches `blocked`.
 * Nothing about that is a hidden rule — every buffer's state is a sensor the
 * program can read.
 *
 * ## The oven paces everything
 *
 * Cure is a *fixed dwell*: `PAINT_CURE_MS`, and no program can shorten it. It
 * is the line's slowest single step by design, so the throughput target is only
 * reachable by pipelining — welding the next part while the last one bakes —
 * rather than by running the four stations in turn. A sequential program is
 * perfectly correct and comfortably misses par.
 *
 * ## Fixed-point, always
 *
 * The paint booth is a continuous plant (temperature lag, film build), so it
 * follows the same discipline `tank.ts` and `axis.ts` do: integer milli-counts,
 * integrated on a fixed `SUB_MS` sub-step with a carried remainder, never on the
 * caller's `dt`. The trajectory is then identical at any scan rate, which is
 * what lets the client's live run and the server's grade agree count for count.
 *
 * ## I/O convention (fixed across every factory puzzle)
 *
 *   Plant     X0 start   X1 stop (NC)   X2 e-stop (NC)   X3 auto/manual
 *             Y0 running lamp           Y1 fault lamp
 *   Weld      X4 frame blank   X5 boom blank   X6 clamped   X7 carriage home
 *             X8 weld buffer full
 *             Y2 clamp   Y3 torch   Y4 carriage   Y5 release   Y6 select boom
 *   Paint     X9 part at booth   X10 oven busy   X11 paint buffer full
 *             Y7 booth infeed   Y8 spray gun   Y9 oven infeed
 *             D0 booth temperature (in)   D1 film thickness (in)
 *             D2 heater command (out)     D3 gun flow command (out)
 *   Assembly  X12 frame ready   X13 boom ready   X14 machine complete
 *             X15 test bay clear
 *             Y10 call frame   Y11 call boom   Y12 engine   Y13 cab
 *             Y14 boom pin     Y15 release to test
 *   Test      X16 machine at test   X17 yard space   X18 test passed
 *             Y16 hydraulic pump   Y17 function test   Y18 dispatch
 */

/** Integration sub-step. `dt` is consumed in whole multiples of this. */
const SUB_MS = 10;

/** Raw count full scale, as on every analog card these puzzles model. */
const COUNTS_FULL = 4000;
/** Milli-count scale for the integrated analog states. */
const MILLI = 100;

// --- Station timings ----------------------------------------------------------
// Chosen so the cure oven is the single slowest step: pipelining is the only
// way to par, and a sequential program misses it without ever faulting.

const WELD_CLAMP_MS = 600;
/** A frame is a bigger weldment than a boom, so the mix costs different time. */
const WELD_SEAM_MS = { f: 3000, b: 2000 } as const;
const WELD_RELEASE_MS = 500;

const PAINT_BLAST_MS = 1200;
const PAINT_SPRAY_MS = 2400;
/** Fixed oven dwell. No program can shorten it; the line is paced by it. */
const PAINT_CURE_MS = 6000;

const ASSY_ENGINE_MS = 2200;
const ASSY_CAB_MS = 1800;
const ASSY_BOOM_MS = 2400;

const TEST_PUMP_MS = 1200;
const TEST_CYCLE_MS = 2600;
const DISPATCH_MS = 1400;

// --- Buffers ------------------------------------------------------------------
/** Welded, waiting for paint. Overrunning it latches `blocked`. */
const WP_CAP = 3;
/** Painted, waiting for assembly — held per type, so the mix is visible. */
const PA_CAP = 3;
/** Finished machines waiting for test. */
const AT_CAP = 2;
/** Dispatch yard. Filling it stops the line from the far end. */
const YARD_CAP = 6;

/**
 * How long assembly may wait on a missing part type before the run is a
 * failure. Generous — this is meant to catch a program that has the *mix*
 * wrong, not one that is merely a little behind.
 */
const STARVE_MS = 14_000;

// --- Paint booth dynamics -----------------------------------------------------
/** Booth temperature lag: sub-steps to close ~63 % of the gap to the heater. */
const TEMP_LAG = 220;
/**
 * Film laid down per sub-step at full gun flow, in milli-counts.
 *
 * Sized so a pass at full flow builds 10 counts (1 um) per sub-step: the good
 * band is then reached after 2.0 s of spraying and exceeded after 3.2 s. Film is
 * `flow x time`, so the station has two knobs and a window rather than a single
 * right answer, and backing the flow off widens the window at the cost of cycle
 * time — which is exactly the trade the throughput target prices.
 */
const FILM_RATE = 1000;
/** Cure is only sound inside this band, in raw counts (1800..2600 = 90..130 C). */
const CURE_MIN = 1800;
const CURE_MAX = 2600;
/** Film thickness that passes inspection, in raw counts (2000..3200 = 200..320 um). */
const FILM_MIN = 2000;
const FILM_MAX = 3200;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown): boolean => v === true;

/** Part codes as they travel in the queue strings: 'f' frame, 'b' boom. */
type PartCode = 'f' | 'b';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const factory: ProcessModel = {
  id: 'factory',

  init: (): MachineState => ({
    // Plant
    running: false,
    fault: false,
    jam: false,
    blocked: false,
    starved: false,

    // Weld: what is in the fixture, how far along, and what it is waiting on.
    weldPart: '',
    weldClamp: 0,
    weldSeam: 0,
    weldRelease: 0,

    // Buffers travel as strings so the *order* and the mix are both visible —
    // 'ffb' is three parts waiting, two of them frames, and the 3D view draws
    // exactly that.
    bufWp: '',

    // Paint
    paintPart: '',
    paintStage: 'idle',
    paintBlast: 0,
    paintSpray: 0,
    paintCure: 0,
    // Continuous, carried in milli-counts.
    boothTempM: 0,
    filmM: 0,
    paintDefect: false,
    scrapped: 0,

    bufPaFrames: 0,
    bufPaBooms: 0,

    // Assembly
    assyHasFrame: false,
    assyHasBoom: false,
    assyEngine: 0,
    assyCab: 0,
    assyBoom: 0,
    assyStarveMs: 0,

    bufAt: 0,

    // Test and dispatch
    testPart: false,
    testPump: 0,
    testCycle: 0,
    testDispatch: 0,
    shipped: 0,
    yard: 0,

    // Carried sub-step remainder, so integration never depends on dt.
    remainderMs: 0,
  }),

  step: (ctx: ProcessStepCtx): ProcessResult => {
    const m = { ...ctx.machine };
    const y = (address: string): boolean => ctx.outputs[address] === true;
    const reg = (address: string): number => clamp(num(ctx.registers[address]), 0, COUNTS_FULL);

    // The plant runs only while the program says so *and* nothing has latched.
    // A hard fault freezes every station on the spot, the way an interlock does.
    const faulted = bool(m.jam) || bool(m.blocked) || bool(m.starved);

    let steps = 0;
    if (!faulted) {
      const total = num(m.remainderMs) + ctx.dtMs;
      steps = Math.floor(total / SUB_MS);
      m.remainderMs = total - steps * SUB_MS;
    }

    const fault = (key: 'jam' | 'blocked' | 'starved', reason: string): void => {
      if (bool(m[key])) return;
      m[key] = true;
      m.jamReason = reason;
    };

    for (let i = 0; i < steps; i++) {
      if (bool(m.jam) || bool(m.blocked) || bool(m.starved)) break;
      stepWeld(m, y, fault);
      stepPaint(m, y, reg, fault);
      stepAssembly(m, y, fault);
      stepTest(m, y, fault);
    }

    m.running = y('Y0');
    m.fault = y('Y1');

    return {
      machine: m,
      derivedInputs: sensors(m),
      derivedRegisters: {
        D0: Math.round(num(m.boothTempM) / MILLI),
        D1: Math.round(num(m.filmM) / MILLI),
      },
    };
  },
};

// --- Weld ---------------------------------------------------------------------

/**
 * Clamp, run the seam, release into the buffer.
 *
 * `Y6` picks which blank the fixture loads, and it is latched at clamp time:
 * changing the selector halfway through a seam does not turn a frame into a
 * boom, it is simply ignored until the fixture is empty again. Striking the
 * torch on an unclamped fixture is the station's signature interlock.
 */
function stepWeld(
  m: MachineState,
  y: (a: string) => boolean,
  fault: (k: 'jam' | 'blocked' | 'starved', reason: string) => void,
): void {
  const clamped = num(m.weldClamp) >= 1;
  const part = str(m.weldPart);

  // Load: clamping an empty fixture picks up whichever blank Y6 selects.
  if (y('Y2')) {
    if (part === '') m.weldPart = y('Y6') ? 'b' : 'f';
    m.weldClamp = Math.min(1, num(m.weldClamp) + SUB_MS / WELD_CLAMP_MS);
  } else if (num(m.weldSeam) > 0 && num(m.weldSeam) < 1) {
    fault('jam', 'the fixture was released with a seam half welded');
    return;
  } else {
    m.weldClamp = Math.max(0, num(m.weldClamp) - SUB_MS / WELD_CLAMP_MS);
    if (num(m.weldClamp) <= 0 && num(m.weldSeam) <= 0) m.weldPart = '';
  }

  // Weld: the torch may only strike on a clamped part.
  if (y('Y3')) {
    if (!clamped || m.weldPart === '') {
      fault('jam', 'the torch struck with nothing clamped in the fixture');
      return;
    }
    const seamMs = WELD_SEAM_MS[m.weldPart as PartCode];
    m.weldSeam = Math.min(1, num(m.weldSeam) + SUB_MS / seamMs);
  }

  // Release: a finished part goes to the weld buffer, which can overflow.
  if (y('Y5') && num(m.weldSeam) >= 1) {
    m.weldRelease = Math.min(1, num(m.weldRelease) + SUB_MS / WELD_RELEASE_MS);
    if (num(m.weldRelease) >= 1) {
      const queue = str(m.bufWp);
      if (queue.length >= WP_CAP) {
        fault('blocked', 'a welded part was released into a full weld buffer');
        return;
      }
      m.bufWp = queue + m.weldPart;
      m.weldPart = '';
      m.weldSeam = 0;
      m.weldRelease = 0;
      // The fixture opens to let the part out, so the next blank needs a fresh
      // clamp cycle — holding Y2 through a release does not inherit the grip.
      m.weldClamp = 0;
    }
  } else if (!y('Y5')) {
    m.weldRelease = 0;
  }
}

// --- Paint --------------------------------------------------------------------

/**
 * Blast, spray, cure — and the only station with a real control loop.
 *
 * The booth temperature lags the heater command, and film only builds while the
 * gun runs *inside the cure band*. Spraying a cold booth lays down paint that
 * will not cure; baking an under-filmed part does not add any. Either way the
 * part comes out of the oven as scrap, which shows up two stations later as a
 * machine assembly never got to build.
 */
function stepPaint(
  m: MachineState,
  y: (a: string) => boolean,
  reg: (a: string) => number,
  fault: (k: 'jam' | 'blocked' | 'starved', reason: string) => void,
): void {
  // Booth temperature: first-order lag toward the heater command.
  const heater = reg('D2') * MILLI;
  m.boothTempM = num(m.boothTempM) + Math.trunc((heater - num(m.boothTempM)) / TEMP_LAG);

  const stage = str(m.paintStage, 'idle');
  const tempCounts = Math.round(num(m.boothTempM) / MILLI);

  // Infeed: pull the next welded part into the booth.
  if (stage === 'idle') {
    if (y('Y7')) {
      const queue = str(m.bufWp);
      if (queue.length > 0) {
        m.paintPart = queue[0];
        m.bufWp = queue.slice(1);
        m.paintStage = 'blast';
        m.paintBlast = 0;
        m.paintSpray = 0;
        m.filmM = 0;
        m.paintDefect = false;
      }
    }
    return;
  }

  if (stage === 'blast') {
    m.paintBlast = Math.min(1, num(m.paintBlast) + SUB_MS / PAINT_BLAST_MS);
    if (num(m.paintBlast) >= 1) m.paintStage = 'spray';
    return;
  }

  if (stage === 'spray') {
    if (y('Y8')) {
      const flow = reg('D3');
      // Paint only *sticks* in the band. Below it the film never cross-links;
      // above it the solvent flashes off before it levels.
      const inBand = tempCounts >= CURE_MIN && tempCounts <= CURE_MAX;
      if (inBand) {
        m.filmM = Math.min(
          COUNTS_FULL * MILLI,
          num(m.filmM) + Math.trunc((FILM_RATE * flow) / COUNTS_FULL),
        );
      }
    }
    m.paintSpray = Math.min(1, num(m.paintSpray) + SUB_MS / PAINT_SPRAY_MS);
    // Into the oven on the program's say-so, not automatically: deciding the
    // part is coated is the station's job.
    if (y('Y9')) {
      m.paintStage = 'cure';
      m.paintCure = 0;
    }
    return;
  }

  if (stage === 'cure') {
    m.paintCure = Math.min(1, num(m.paintCure) + SUB_MS / PAINT_CURE_MS);
    // Judged continuously through the bake, not at the end: a booth that drifts
    // out of band halfway through has already spoiled the finish.
    if (tempCounts < CURE_MIN || tempCounts > CURE_MAX) m.paintDefect = true;
    if (num(m.paintCure) < 1) return;

    const film = Math.round(num(m.filmM) / MILLI);
    const bad = bool(m.paintDefect) || film < FILM_MIN || film > FILM_MAX;
    const part = str(m.paintPart);

    if (bad) {
      m.scrapped = num(m.scrapped) + 1;
    } else {
      const frames = num(m.bufPaFrames);
      const booms = num(m.bufPaBooms);
      if ((part === 'f' ? frames : booms) >= PA_CAP) {
        fault('blocked', 'a cured part left the oven into a full paint buffer');
        return;
      }
      if (part === 'f') m.bufPaFrames = frames + 1;
      else m.bufPaBooms = booms + 1;
    }

    m.paintPart = '';
    m.paintStage = 'idle';
    m.paintCure = 0;
    m.filmM = 0;
    m.paintDefect = false;
  }
}

// --- Assembly -----------------------------------------------------------------

/**
 * Marry a painted frame and a painted boom into a machine.
 *
 * This is where the two streams meet, and where a wrong mix upstream finally
 * costs something: the station calls for what it needs, and if the buffer never
 * holds one of the two it simply waits. `starved` is that wait running past
 * `STARVE_MS` — not a crash, a line that stopped earning.
 */
function stepAssembly(
  m: MachineState,
  y: (a: string) => boolean,
  fault: (k: 'jam' | 'blocked' | 'starved', reason: string) => void,
): void {
  const hasFrame = bool(m.assyHasFrame);
  const hasBoom = bool(m.assyHasBoom);

  // Call a part in off the painted buffer.
  if (y('Y10') && !hasFrame && num(m.bufPaFrames) > 0) {
    m.bufPaFrames = num(m.bufPaFrames) - 1;
    m.assyHasFrame = true;
  }
  if (y('Y11') && !hasBoom && num(m.bufPaBooms) > 0) {
    m.bufPaBooms = num(m.bufPaBooms) - 1;
    m.assyHasBoom = true;
  }

  // Build. The frame has to be in the jig before anything is fitted to it, and
  // the boom cannot be pinned to a machine that has no engine or cab yet.
  if (y('Y12')) {
    if (!bool(m.assyHasFrame)) {
      fault('jam', 'the engine was lowered with no frame in the jig');
      return;
    }
    m.assyEngine = Math.min(1, num(m.assyEngine) + SUB_MS / ASSY_ENGINE_MS);
  }
  if (y('Y13')) {
    if (num(m.assyEngine) < 1) {
      fault('jam', 'the cab was fitted before the engine was in');
      return;
    }
    m.assyCab = Math.min(1, num(m.assyCab) + SUB_MS / ASSY_CAB_MS);
  }
  if (y('Y14')) {
    if (!bool(m.assyHasBoom) || num(m.assyCab) < 1) {
      fault('jam', 'the boom was pinned before the machine was ready for it');
      return;
    }
    m.assyBoom = Math.min(1, num(m.assyBoom) + SUB_MS / ASSY_BOOM_MS);
  }

  const complete = num(m.assyEngine) >= 1 && num(m.assyCab) >= 1 && num(m.assyBoom) >= 1;

  // Release the finished machine to the test bay.
  if (y('Y15') && complete) {
    if (num(m.bufAt) >= AT_CAP) {
      fault('blocked', 'a finished machine was released into a full test queue');
      return;
    }
    m.bufAt = num(m.bufAt) + 1;
    m.assyHasFrame = false;
    m.assyHasBoom = false;
    m.assyEngine = 0;
    m.assyCab = 0;
    m.assyBoom = 0;
  }

  // Starvation is specifically *a half-built machine that cannot be finished*:
  // one part in the jig, none of the other type anywhere, and no sign of one.
  // An empty line at the start of a shift is idle, not starved, and a plant
  // that latched a failure simply for standing still before the first part
  // arrived would fail every scenario during its own start-up.
  const halfBuilt =
    (bool(m.assyHasFrame) && !bool(m.assyHasBoom) && num(m.bufPaBooms) === 0) ||
    (bool(m.assyHasBoom) && !bool(m.assyHasFrame) && num(m.bufPaFrames) === 0);
  if (halfBuilt) {
    m.assyStarveMs = num(m.assyStarveMs) + SUB_MS;
    if (num(m.assyStarveMs) >= STARVE_MS) {
      fault(
        'starved',
        'final assembly waited too long for a part it never got — the line built the wrong mix',
      );
    }
  } else {
    m.assyStarveMs = 0;
  }
}

// --- Test and dispatch --------------------------------------------------------

/** Pump up, run the function cycle, drive it off into the yard. */
function stepTest(
  m: MachineState,
  y: (a: string) => boolean,
  fault: (k: 'jam' | 'blocked' | 'starved', reason: string) => void,
): void {
  if (!bool(m.testPart)) {
    if (num(m.bufAt) > 0) {
      m.bufAt = num(m.bufAt) - 1;
      m.testPart = true;
      m.testPump = 0;
      m.testCycle = 0;
      m.testDispatch = 0;
    }
    return;
  }

  if (y('Y16')) m.testPump = Math.min(1, num(m.testPump) + SUB_MS / TEST_PUMP_MS);

  if (y('Y17')) {
    if (num(m.testPump) < 1) {
      fault('jam', 'the function test ran before the hydraulics were up to pressure');
      return;
    }
    m.testCycle = Math.min(1, num(m.testCycle) + SUB_MS / TEST_CYCLE_MS);
  }

  if (y('Y18') && num(m.testCycle) >= 1) {
    if (num(m.yard) >= YARD_CAP) {
      fault('blocked', 'a machine was dispatched into a full yard');
      return;
    }
    m.testDispatch = Math.min(1, num(m.testDispatch) + SUB_MS / DISPATCH_MS);
    if (num(m.testDispatch) >= 1) {
      m.yard = num(m.yard) + 1;
      m.shipped = num(m.shipped) + 1;
      m.testPart = false;
      m.testPump = 0;
      m.testCycle = 0;
      m.testDispatch = 0;
    }
  }
}

// --- The field image ----------------------------------------------------------

/**
 * Every sensor the plant reports, derived from state.
 *
 * The buffer-full bits are deliberately real sensors rather than something the
 * program has to infer by counting: on a real line they are a photo-eye at the
 * end of a rail, and making the program count what it can see would be a puzzle
 * about bookkeeping rather than about scheduling.
 */
function sensors(m: MachineState): Record<string, boolean> {
  return {
    // Weld
    X4: true, // frame blanks are always available at the shop door
    X5: true, // and so are booms
    X6: num(m.weldClamp) >= 1,
    X7: num(m.weldRelease) <= 0,
    X8: str(m.bufWp).length >= WP_CAP,
    // Paint
    X9: str(m.paintStage, 'idle') !== 'idle',
    X10: str(m.paintStage) === 'cure',
    X11: num(m.bufPaFrames) >= PA_CAP || num(m.bufPaBooms) >= PA_CAP,
    // Assembly
    X12: num(m.bufPaFrames) > 0,
    X13: num(m.bufPaBooms) > 0,
    X14: num(m.assyEngine) >= 1 && num(m.assyCab) >= 1 && num(m.assyBoom) >= 1,
    X15: num(m.bufAt) < AT_CAP,
    // Test
    X16: bool(m.testPart),
    X17: num(m.yard) < YARD_CAP,
    X18: num(m.testCycle) >= 1,
  };
}

/**
 * POU ids the factory puzzles give their four station programs.
 *
 * These are a contract, not a naming convention: the plant view frames a bay by
 * the id of the section the player has selected, so a puzzle that renamed one
 * would silently lose its camera preset.
 */
export const FACTORY_SECTIONS = {
  supervisor: 'SUP',
  weld: 'WELD',
  paint: 'PAINT',
  assembly: 'ASSY',
  test: 'TEST',
} as const;

/** Capacities and band limits the 3D view and the briefings both quote. */
export const FACTORY_LIMITS = {
  WP_CAP,
  PA_CAP,
  AT_CAP,
  YARD_CAP,
  CURE_MIN,
  CURE_MAX,
  FILM_MIN,
  FILM_MAX,
  PAINT_CURE_MS,
} as const;

/** Unused today, kept so the registry's `init(devices)` signature is honoured. */
export type FactoryDevices = PuzzleDevice[];
