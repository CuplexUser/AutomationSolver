import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * The excavator line as it actually stands: six stations, real transport
 * between them, and two part streams that have to arrive married.
 *
 * `factory.ts` is the same plant with the awkward parts taken out — a cure oven
 * welded to the spray booth, a buffer that is a number rather than a rack, a
 * yard nothing ever empties. That is the right plant to *meet*, and it is the
 * wrong one to work on, so the commissioning puzzle keeps it and everything
 * after it runs this one. Two models rather than one with a dozen feature flags:
 * the flow is different, not merely bigger, and a `stepPaint` that branched six
 * ways on which oven was fitted would be worse than either.
 *
 * ## The line
 *
 *   WELD ──▶ STORE (4 lanes) ──portal──▶ BOOTH ──▶ OVEN ──▶ lanes ──▶ ASSY ──▶ TEST ──▶ DOCK
 *
 * Nothing moves between those on its own. The rack store is loaded and picked by
 * the program, the portal robot travels, lowers and grips under the program, and
 * a part left standing on an infeed is a part the station behind it cannot
 * release. Transport *is* the program here, which is the difference between a
 * plant and four machines in a row.
 *
 * ## The three things that make it hard
 *
 * **The mix.** Final assembly needs a frame and a boom, so every part of the
 * line has to run 1:1 whatever else it is optimizing. A weld shop that runs the
 * quick part flat out fills the store with booms and starves the jig.
 *
 * **The color.** Machines are built to an order book, and both parts of a
 * machine carry its color. The gun holds one color at a time and changing it
 * means a purge, which is booth time nobody gets back. Since the color of a
 * part is decided when it is sprayed, the *order the store feeds the booth* is
 * what decides which machine each part belongs to — feed two frames in a row and
 * the frame lane and the boom lane drift a machine apart, and the jig marries a
 * frame to a boom in the wrong color.
 *
 * **The tempo.** Six stations, each with slack in the wrong place. Every one of
 * them has a plain program that works and a better one that does not cost more
 * rungs — a second seam pass a boom never needed, a bench that could have run
 * during the engine drop, a lorry sent for ten seconds too late.
 *
 * ## Fixed-point, always
 *
 * The booth is a continuous plant, so it follows the discipline `tank.ts` and
 * `axis.ts` set: integer milli-counts, integrated on a fixed `SUB_MS` sub-step
 * with a carried remainder, never on the caller's `dt`. The trajectory is then
 * identical at any scan rate, which is what lets the client's live run and the
 * server's grade agree count for count.
 *
 * ## I/O map
 *
 *   PLANT    X0  Start            X1  Stop (NC)       X2  E-Stop (NC)
 *            X3  Auto
 *            Y0  Plant Running    Y1  Line Held
 *
 *   WELD     X4  Frame Blank      X5  Boom Blank      X6  Fixture Clamped
 *            X7  Positioner At A  X8  Positioner At B X9  Torch Tip Worn
 *            X10 Store Infeed Occupied
 *            Y2  Clamp            Y3  Torch           Y4  Rotate Positioner
 *            Y5  Release          Y6  Select Boom     Y7  Change Tip
 *
 *   STORE    X11 Part At Infeed   X12 Boom At Infeed  X13 Part At Outfeed
 *            D4..D7 Lane 1..4 Count
 *            Y8  Load Into Lane   Y9  Pick From Lane
 *            D13 Load Lane        D14 Pick Lane
 *
 *   PORTAL   X14 At Store         X15 At Booth        X16 Down
 *            X17 Up               X18 Part Held
 *            Y10 Travel To Booth  Y11 Travel To Store Y12 Lower   Y13 Vacuum
 *
 *   PAINT    X19 Part At Booth    X20 Boom In Booth   X21 Oven Full
 *            X22 Painted Lane Full
 *            D0  Booth Temperature   D1  Film Thickness
 *            D8  Next Paint Color   D9  Color In Gun
 *            Y14 Spray Gun        Y15 Oven Infeed     Y16 Purge Gun
 *            D2  Heater Command   D3  Gun Flow        D15 Color Command
 *
 *   ASSY     X23 Frame Ready      X24 Boom Ready      X25 Boom Made Up
 *            X26 Machine Complete X27 Test Bay Clear
 *            D10 Frame Color Ready  D11 Boom Color Ready
 *            Y17 Call Frame       Y18 Call Boom       Y19 Lower Engine
 *            Y20 Fit Cab          Y21 Make Up Boom    Y22 Pin Boom
 *            Y23 Release To Test
 *
 *   TEST     X28 Machine At Test  X29 Test Passed     X30 Yard Space
 *            X31 Truck At Dock    D12 Machines In Yard
 *            Y24 Hydraulic Pump   Y25 Function Test   Y26 Dispatch
 *            Y27 Call Truck
 */

/** Integration sub-step. `dt` is consumed in whole multiples of this. */
const SUB_MS = 10;

/** Raw count full scale, as on every analog card these puzzles model. */
const COUNTS_FULL = 4000;
/** Milli-count scale for the integrated analog states. */
const MILLI = 100;

// --- Weld ---------------------------------------------------------------------

const WELD_CLAMP_MS = 500;
/**
 * Arc time per pass, per part.
 *
 * A frame is a hull and takes two runs with a rotation between them; a boom is a
 * stick and takes one. A program that gives every part the frame's treatment is
 * correct, produces sound booms, and spends an extra pass and an extra rotation
 * on half of everything it makes.
 */
const WELD_PASS_MS = { f: [1100, 1100], b: [1200] } as const;
const WELD_ROTATE_MS = 600;
const WELD_RELEASE_MS = 400;
/** Passes a contact tip is good for. A frame spends two of them. */
const TIP_LIFE = 8;
/** A tip change, on an empty fixture. Whenever you spend it, you spend it. */
const TIP_CHANGE_MS = 3000;

// --- Store --------------------------------------------------------------------

/** Lanes in the rack, and how deep each one is. */
const STORE_LANES = 4;
const LANE_DEPTH = 2;
const STORE_LOAD_MS = 800;
const STORE_PICK_MS = 800;

// --- Portal robot -------------------------------------------------------------

const PORTAL_TRAVEL_MS = 800;
const PORTAL_LIFT_MS = 300;
/** Vacuum make and break. A part is only held once the cups have pulled down. */
const PORTAL_GRIP_MS = 200;

// --- Paint --------------------------------------------------------------------

const PAINT_BLAST_MS = 1200;
/** Booth temperature lag: sub-steps to close ~63 % of the gap to the heater. */
const TEMP_LAG = 220;
/** Film laid down per sub-step at full gun flow, in milli-counts. */
const FILM_RATE = 1000;
/** Cure is only sound inside this band, in raw counts (1800..2600 = 90..130 C). */
const CURE_MIN = 1800;
const CURE_MAX = 2600;
/** Film that passes inspection, per part. A boom is specified thinner. */
const FILM_WINDOW = { f: { min: 2000, max: 3200 }, b: { min: 1400, max: 2600 } } as const;
/**
 * Flushing the gun and the line through to the waste pot.
 *
 * Exactly a blast cycle long, and that is the point. The purge goes to waste,
 * not through the part, so nothing stops it running while the next part is being
 * blasted — and a program that waits for the booth to be empty before it changes
 * color pays for every changeover twice.
 */
const PURGE_MS = 1200;
/** Rack positions in the cure oven. */
const OVEN_RACKS = 2;
/** Bake time as a function of film: more paint on the part, longer in the oven. */
const CURE_BASE_MS = 3000;
const cureMsFor = (filmCounts: number): number => CURE_BASE_MS + Math.trunc((filmCounts * 5) / 4);

/**
 * The order book: the color of each machine, in the order they are due.
 *
 * Read modulo its length, so a long run repeats rather than running out. Written
 * with consecutive pairs on purpose — two machines in a row wanting the same
 * color is four parts the booth can spray without stopping to purge, and
 * spotting that is the paint shop's whole optimization.
 */
const ORDER_COLORS = [1, 1, 2, 3, 3, 2, 4, 4, 1, 2, 2, 3] as const;
/** Paint drums on the wall, numbered as they are on the floor. */
const COLORS = 4;

// --- Assembly -----------------------------------------------------------------

const ASSY_ENGINE_MS = 2200;
const ASSY_CAB_MS = 1800;
/**
 * Hanging the cylinders and hoses on a boom, on the bench beside the jig.
 *
 * It needs a boom and nothing else, so it can run at the same time as anything.
 * A program that runs it in its turn is correct and gives away every second.
 */
const ASSY_PREP_MS = 1600;
const ASSY_BOOM_MS = 2400;

// --- Test and dispatch --------------------------------------------------------

const TEST_PUMP_MS = 1200;
const TEST_CYCLE_MS = 2600;
const DISPATCH_MS = 1400;

const TRUCK_ARRIVE_MS = 10_000;
const TRUCK_LOAD_MS = 1000;
const TRUCK_CAP = 6;
/** A driver's hours: they will not sit on the dock for ever waiting to fill up. */
const TRUCK_DWELL_MS = 15_000;
const TRUCK_CLEAR_MS = 5000;
/** The haulier's rotation: the dock cannot take trucks back to back. */
const TRUCK_GAP_MS = 10_000;
/** Fewer than this on a departing truck is a trip that half paid for itself. */
const TRUCK_PART_LOAD = 4;

// --- Buffers ------------------------------------------------------------------

/** Painted parts waiting for assembly, per type, carried as color digits. */
const PA_CAP = 3;
/** Finished machines waiting for the test bay. */
const AT_CAP = 2;
/** Dispatch yard. Filling it stops the line from the far end. */
const YARD_CAP = 6;
/**
 * How long the jig may hold half a machine before the run is a failure.
 * Generous: this catches a line with the wrong *mix*, not one running late.
 */
const STARVE_MS = 16_000;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown): boolean => v === true;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Part codes: 'f' frame, 'b' boom. */
type PartCode = 'f' | 'b';

/** How many arc passes a part needs, and how long each one runs. */
const passesFor = (part: string): readonly number[] =>
  WELD_PASS_MS[(part === 'b' ? 'b' : 'f') as PartCode];

type Fault = (key: 'jam' | 'blocked' | 'starved', reason: string) => void;

/** Everything one sub-step of the plant needs. */
interface Ctx {
  m: MachineState;
  y: (address: string) => boolean;
  reg: (address: string) => number;
  fault: Fault;
}

export const factoryLine: ProcessModel = {
  id: 'factory-line',

  init: (): MachineState => {
    const m: MachineState = {
      // Plant
      running: false,
      fault: false,
      jam: false,
      blocked: false,
      starved: false,

      // Weld. `weldPass` is how many passes are finished; `weldSeam` is how far
      // through the current one.
      weldPart: '',
      weldClamp: 0,
      weldPass: 0,
      weldSeam: 0,
      weldRotate: 0,
      weldRelease: 0,
      tipPasses: 0,
      tipChange: 0,
      tipChanges: 0,
      welded: 0,

      // Store. The infeed and outfeed each hold at most one part; the lanes hold
      // their contents as a string of part codes, front of the lane first, so
      // the 3D view can draw the rack and the mix is visible at a glance.
      storeIn: '',
      storeOut: '',
      storeLoad: 0,
      storePick: 0,

      // Portal robot. `portalAt` is 0 at the store, 1 at the booth.
      portalAt: 0,
      portalLift: 0,
      portalGrip: 0,
      portalPart: '',

      // Paint
      boothPart: '',
      boothStage: 'idle',
      boothBlast: 0,
      boothTempM: 0,
      filmM: 0,
      gunColor: 1,
      purge: 0,
      purges: 0,
      sprayed: 0,
      painted: 0,
      scrapped: 0,

      // Painted lanes, as strings of color digits ('112' is three parts).
      laneF: '',
      laneB: '',

      // Assembly
      assyFrame: 0, // color, 0 = no frame in the jig
      assyBoom: 0,
      assyEngine: 0,
      assyCab: 0,
      assyPrep: 0,
      assyPin: 0,
      assyStarveMs: 0,
      bufAt: 0,

      // Test and dispatch
      testPart: false,
      testPump: 0,
      testCycle: 0,
      testDispatch: 0,
      shipped: 0,
      yard: 0,

      truckState: 'away',
      // Ready for the first call: the shift has not started, so the haulier has
      // not just left.
      truckT: TRUCK_GAP_MS,
      truckDwell: 0,
      truckLoad: 0,
      trucksSent: 0,
      partLoads: 0,

      remainderMs: 0,
    };
    for (let i = 0; i < STORE_LANES; i++) m[`lane${i}`] = '';
    for (let i = 0; i < OVEN_RACKS; i++) {
      m[`ovenPart${i}`] = '';
      m[`ovenColor${i}`] = 0;
      m[`ovenCure${i}`] = 0;
      m[`ovenMs${i}`] = 0;
      m[`ovenBad${i}`] = false;
    }
    return m;
  },

  step: (ctx: ProcessStepCtx): ProcessResult => {
    const m = { ...ctx.machine };
    const y = (address: string): boolean => ctx.outputs[address] === true;
    const reg = (address: string): number => clamp(num(ctx.registers[address]), 0, COUNTS_FULL);

    const faulted = bool(m.jam) || bool(m.blocked) || bool(m.starved);
    let steps = 0;
    if (!faulted) {
      const total = num(m.remainderMs) + ctx.dtMs;
      steps = Math.floor(total / SUB_MS);
      m.remainderMs = total - steps * SUB_MS;
    }

    const fault: Fault = (key, reason) => {
      if (bool(m[key])) return;
      m[key] = true;
      m.jamReason = reason;
    };

    const c: Ctx = { m, y, reg, fault };
    for (let i = 0; i < steps; i++) {
      if (bool(m.jam) || bool(m.blocked) || bool(m.starved)) break;
      stepWeld(c);
      stepStore(c);
      stepPortal(c);
      stepBooth(c);
      stepOven(c);
      stepAssembly(c);
      stepTest(c);
      stepDock(c);
    }

    m.running = y('Y0');
    m.fault = y('Y1');

    return { machine: m, derivedInputs: sensors(m), derivedRegisters: registers(m) };
  },
};

// --- Weld ---------------------------------------------------------------------

/**
 * Clamp a blank, run its seams, roll it onto the store's infeed.
 *
 * `Y6` picks which blank the fixture loads and is latched at clamp time, so
 * moving the selector part way through a cycle does not turn a frame into a
 * boom. The positioner is the new work: a frame's second pass is on its other
 * side, and the torch may not strike while the fixture is turning.
 */
function stepWeld({ m, y, fault }: Ctx): void {
  // Tip change first: it is maintenance, not a step of the cycle, and it needs
  // the fixture empty. Abandoning one half way leaves the old tip in.
  if (y('Y7')) {
    if (str(m.weldPart) !== '' || num(m.weldClamp) > 0) {
      fault('jam', 'the contact tip was changed with a part still in the fixture');
      return;
    }
    m.tipChange = Math.min(1, num(m.tipChange) + SUB_MS / TIP_CHANGE_MS);
    if (num(m.tipChange) >= 1) {
      m.tipPasses = 0;
      m.tipChange = 0;
      m.tipChanges = num(m.tipChanges) + 1;
    }
    return;
  }
  m.tipChange = 0;

  const clamped = num(m.weldClamp) >= 1;
  const part = str(m.weldPart);
  const passes = passesFor(part);
  const done = num(m.weldPass) >= passes.length;

  // Load: clamping an empty fixture picks up whichever blank Y6 selects.
  if (y('Y2')) {
    if (part === '') m.weldPart = y('Y6') ? 'b' : 'f';
    m.weldClamp = Math.min(1, num(m.weldClamp) + SUB_MS / WELD_CLAMP_MS);
  } else if (num(m.weldPass) > 0 && !done) {
    fault('jam', 'the fixture was released with the weldment only part way through its passes');
    return;
  } else if (num(m.weldSeam) > 0) {
    fault('jam', 'the fixture was released with a seam half welded');
    return;
  } else {
    m.weldClamp = Math.max(0, num(m.weldClamp) - SUB_MS / WELD_CLAMP_MS);
    // An unwelded blank can be dropped back out of an open fixture. A finished
    // weldment cannot: it stays put until something releases it onto the
    // outfeed, so opening the jaws early costs a program nothing and loses it
    // nothing either. Clearing it here instead would make a held-open fixture
    // quietly swallow the part it had just spent four seconds making.
    if (num(m.weldClamp) <= 0 && num(m.weldPass) <= 0) m.weldPart = '';
  }

  // The positioner. It rolls the weldment over between passes, and it is the one
  // thing on this fixture that must not be moving while the arc is lit.
  const rotating = y('Y4');
  const before = num(m.weldRotate);
  m.weldRotate = rotating
    ? Math.min(1, before + SUB_MS / WELD_ROTATE_MS)
    : Math.max(0, before - SUB_MS / WELD_ROTATE_MS);
  const settled = num(m.weldRotate) <= 0 || num(m.weldRotate) >= 1;

  // Weld.
  if (y('Y3')) {
    if (!clamped || m.weldPart === '') {
      fault('jam', 'the torch struck with nothing clamped in the fixture');
      return;
    }
    if (!settled) {
      fault('jam', 'the torch struck while the positioner was still rolling the weldment over');
      return;
    }
    // A worn tip is judged when a *weldment* is started, not when a pass is.
    // The tip runs out on the pass it is laying, and half of those passes are
    // the first of two — a shop that downed tools with a frame half welded in
    // the fixture would be a shop nobody could program. So the part in the jaws
    // is always finished, and the check falls on the next one to go in.
    if (num(m.weldPass) <= 0 && num(m.weldSeam) <= 0 && num(m.tipPasses) >= TIP_LIFE) {
      fault('jam', 'the torch struck a new pass on a worn contact tip and burned back into the diffuser');
      return;
    }
    // Which pass this is decides where the fixture has to be pointing: pass one
    // on the side the positioner parks at, pass two on the other. An arc lit
    // over a seam that is already laid is not a crash — it re-melts a cap that
    // was sound, which is a poor thing to do and not a broken one. It costs
    // exactly what it looks like it costs, which is the time. A program that
    // gives every boom a frame's two runs and a rotation pays that on half of
    // everything the shop makes, and never sees a fault for it.
    const onThisSide = !done && (num(m.weldPass) === 1) === (num(m.weldRotate) >= 1);
    if (onThisSide) {
      m.weldSeam = Math.min(1, num(m.weldSeam) + SUB_MS / passes[num(m.weldPass)]);
      if (num(m.weldSeam) >= 1) {
        m.weldPass = num(m.weldPass) + 1;
        m.weldSeam = 0;
        m.tipPasses = num(m.tipPasses) + 1;
      }
    }
  }

  // Release onto the store's infeed roller, which holds one part.
  if (y('Y5') && done) {
    m.weldRelease = Math.min(1, num(m.weldRelease) + SUB_MS / WELD_RELEASE_MS);
    if (num(m.weldRelease) >= 1) {
      if (str(m.storeIn) !== '') {
        fault('blocked', 'a welded part was rolled out onto an infeed that still had one on it');
        return;
      }
      m.storeIn = m.weldPart;
      m.welded = num(m.welded) + 1;
      m.weldPart = '';
      m.weldPass = 0;
      m.weldRelease = 0;
      // The fixture opens to let the part out, so the next blank needs a fresh
      // clamp cycle — holding Y2 through a release does not inherit the grip.
      m.weldClamp = 0;
    }
  } else if (!y('Y5')) {
    m.weldRelease = 0;
  }
}

// --- Store --------------------------------------------------------------------

/**
 * Four gravity lanes, two deep, loaded and picked by the program.
 *
 * The lanes are the only thing standing between the weld bay and the booth, and
 * the only place on the line where the *order* parts come out can differ from
 * the order they went in. Sorting frames and booms into lanes of their own is
 * what makes the booth's next part a choice rather than whatever turned up.
 */
function stepStore({ m, y, reg, fault }: Ctx): void {
  const loadLane = Math.round(reg('D13'));
  const pickLane = Math.round(reg('D14'));

  // Load: take the part waiting on the infeed into the selected lane.
  if (y('Y8')) {
    if (loadLane < 1 || loadLane > STORE_LANES) {
      fault('jam', `the loader was told to stack into lane ${loadLane}, and the rack has ${STORE_LANES}`);
      return;
    }
    // Stroking with nothing on the infeed is a wasted stroke, not a crash: the
    // pusher goes out into thin air and comes back. It has to be, because the
    // field image a program is deciding on is always one scan behind the plant —
    // the part it was pushing left on the sub-step the stroke completed, and a
    // level-driven coil is still on for the rest of that scan.
    if (str(m.storeIn) === '') {
      m.storeLoad = 0;
      return;
    }
    const key = `lane${loadLane - 1}`;
    m.storeLoad = Math.min(1, num(m.storeLoad) + SUB_MS / STORE_LOAD_MS);
    if (num(m.storeLoad) >= 1) {
      if (str(m[key]).length >= LANE_DEPTH) {
        fault('blocked', `a part was stacked into lane ${loadLane}, which was already full`);
        return;
      }
      m[key] = str(m[key]) + str(m.storeIn);
      m.storeIn = '';
      m.storeLoad = 0;
    }
  } else {
    m.storeLoad = 0;
  }

  // Pick: release the front part of the selected lane onto the outfeed.
  if (y('Y9')) {
    if (pickLane < 1 || pickLane > STORE_LANES) {
      fault('jam', `the picker was told to draw from lane ${pickLane}, and the rack has ${STORE_LANES}`);
      return;
    }
    // Same as the loader: the outfeed still being occupied means the picker
    // simply has nowhere to put what it would draw, so it waits.
    if (str(m.storeOut) !== '') {
      m.storePick = 0;
      return;
    }
    const key = `lane${pickLane - 1}`;
    const lane = str(m[key]);
    // Drawing from an empty lane is a wasted stroke, not a crash: the mechanism
    // simply comes back with nothing, exactly as it would on the floor.
    if (lane.length === 0) {
      m.storePick = 0;
      return;
    }
    m.storePick = Math.min(1, num(m.storePick) + SUB_MS / STORE_PICK_MS);
    if (num(m.storePick) >= 1) {
      m.storeOut = lane[0];
      m[key] = lane.slice(1);
      m.storePick = 0;
    }
  } else {
    m.storePick = 0;
  }
}

// --- Portal robot -------------------------------------------------------------

/**
 * The gantry over the aisle: travel, lower, vacuum, raise, travel.
 *
 * Two stations and one job, and every rule on it is the same rule a real portal
 * has. It cannot travel with the head down, because the head is below the rail
 * and the rail is not the only thing in the aisle. It cannot let go with the
 * head up, because the part is then two meters above the floor.
 */
function stepPortal({ m, y, fault }: Ctx): void {
  const lift = num(m.portalLift);
  const at = num(m.portalAt);

  // Travel. Forward is toward the booth.
  const fwd = y('Y10');
  const rev = y('Y11');
  if (fwd || rev) {
    if (lift > 0) {
      fault('jam', 'the portal set off along the rail with its head still down in the aisle');
      return;
    }
    if (fwd && rev) {
      fault('jam', 'the portal was commanded both ways along the rail at once');
      return;
    }
    m.portalAt = fwd
      ? Math.min(1, at + SUB_MS / PORTAL_TRAVEL_MS)
      : Math.max(0, at - SUB_MS / PORTAL_TRAVEL_MS);
  }

  // Lower and raise. Only at a station, so the head never comes down in the
  // middle of the aisle onto whatever is standing there.
  const atStation = num(m.portalAt) <= 0 || num(m.portalAt) >= 1;
  if (y('Y12')) {
    if (!atStation) {
      fault('jam', 'the portal lowered its head half way along the rail');
      return;
    }
    m.portalLift = Math.min(1, lift + SUB_MS / PORTAL_LIFT_MS);
  } else {
    m.portalLift = Math.max(0, lift - SUB_MS / PORTAL_LIFT_MS);
  }

  // The vacuum. Grip builds while the cups are commanded and pressed down.
  const down = num(m.portalLift) >= 1;
  const suck = y('Y13');
  m.portalGrip = suck
    ? Math.min(1, num(m.portalGrip) + SUB_MS / PORTAL_GRIP_MS)
    : Math.max(0, num(m.portalGrip) - SUB_MS / PORTAL_GRIP_MS);

  const held = str(m.portalPart) !== '';
  const atStore = num(m.portalAt) <= 0;
  const atBooth = num(m.portalAt) >= 1;

  // Pick: the cups pull down onto whatever is under them.
  if (!held && down && num(m.portalGrip) >= 1) {
    if (atStore && str(m.storeOut) !== '') {
      m.portalPart = m.storeOut;
      m.storeOut = '';
    }
  }

  // Place: letting go. Up in the air is a dropped part; over the store is a part
  // put back where it came from, which is allowed and pointless.
  if (held && !suck && num(m.portalGrip) <= 0) {
    if (!down) {
      fault('jam', 'the portal dropped its part from the top of the stroke');
      return;
    }
    if (atBooth) {
      if (str(m.boothPart) !== '' || str(m.boothStage, 'idle') !== 'idle') {
        fault('jam', 'the portal set a part down on a booth skid that was still loaded');
        return;
      }
      m.boothPart = m.portalPart;
      m.boothStage = 'blast';
      m.boothBlast = 0;
      m.filmM = 0;
    } else if (atStore) {
      if (str(m.storeOut) !== '') {
        fault('jam', 'the portal set a part back down on an outfeed that was already occupied');
        return;
      }
      m.storeOut = m.portalPart;
    }
    m.portalPart = '';
  }
}

// --- Paint --------------------------------------------------------------------

/**
 * The booth: blast, spray, hand over to the oven.
 *
 * The gun holds one color at a time. Spraying with the drum selector set to
 * anything other than what is actually in the line lays down a blend, and a
 * blend is scrap — so a color change costs a purge, and a purge costs booth
 * time whether the booth had anything better to do or not.
 */
function stepBooth({ m, y, reg, fault }: Ctx): void {
  // Booth temperature: first-order lag toward the heater command. One heater and
  // one duct feed both chambers, which is why the bake is judged against the
  // same band the gun is.
  const heater = reg('D2') * MILLI;
  m.boothTempM = num(m.boothTempM) + Math.trunc((heater - num(m.boothTempM)) / TEMP_LAG);
  const tempCounts = Math.round(num(m.boothTempM) / MILLI);

  // Purge. It runs to the waste pot, so it needs nothing from the booth but
  // time, and it deliberately does *not* stop the stage machine — blasting the
  // next part while the line flushes through is free, and noticing that is worth
  // a changeover every machine.
  const wanted = clamp(Math.round(reg('D15')), 0, COLORS);
  if (y('Y16')) {
    if (y('Y14')) {
      fault('jam', 'the gun was purged while it was still spraying, all over the part');
      return;
    }
    if (wanted < 1) {
      fault('jam', 'the gun was purged with no drum selected to flush through to');
      return;
    }
    m.purge = Math.min(1, num(m.purge) + SUB_MS / PURGE_MS);
    if (num(m.purge) >= 1) {
      m.gunColor = wanted;
      m.purge = 0;
      m.purges = num(m.purges) + 1;
    }
  } else {
    m.purge = 0;
  }

  const stage = str(m.boothStage, 'idle');
  if (stage === 'idle') return;

  if (stage === 'blast') {
    m.boothBlast = Math.min(1, num(m.boothBlast) + SUB_MS / PAINT_BLAST_MS);
    if (num(m.boothBlast) >= 1) m.boothStage = 'spray';
    return;
  }

  if (y('Y14')) {
    const flow = reg('D3');
    // Paint only cross-links inside the band. Below it the film never sets;
    // above it the solvent flashes off before it levels.
    if (tempCounts >= CURE_MIN && tempCounts <= CURE_MAX) {
      m.filmM = Math.min(
        COUNTS_FULL * MILLI,
        num(m.filmM) + Math.trunc((FILM_RATE * flow) / COUNTS_FULL),
      );
    }
    // Spraying with the selector on a drum the line is not loaded with pulls the
    // old color through behind the new one. The part is finished before anyone
    // sees it.
    if (wanted !== 0 && wanted !== num(m.gunColor, 1)) m.boothBlend = true;
  }

  // Into the oven, on the program's say-so and only into a free rack.
  if (!y('Y15')) return;
  const rack = freeRack(m);
  if (rack < 0) return;

  const part = str(m.boothPart);
  const film = Math.round(num(m.filmM) / MILLI);
  const want = FILM_WINDOW[(part === 'b' ? 'b' : 'f') as PartCode];
  // The color is decided here, by which machine on the order book this part
  // belongs to — which is decided in turn by the order the store fed the booth.
  // Counted on the way *in* to the oven rather than out of it: two racks means
  // two parts in flight, and a due color that lagged by two parts would be a
  // number no program could act on.
  const due = ORDER_COLORS[Math.floor(num(m.sprayed) / 2) % ORDER_COLORS.length];
  m.sprayed = num(m.sprayed) + 1;

  m[`ovenPart${rack}`] = part;
  m[`ovenColor${rack}`] = due;
  m[`ovenCure${rack}`] = 0;
  m[`ovenMs${rack}`] = cureMsFor(film);
  m[`ovenBad${rack}`] =
    bool(m.boothBlend) || film < want.min || film > want.max || num(m.gunColor, 1) !== due;

  m.boothPart = '';
  m.boothStage = 'idle';
  m.boothBlast = 0;
  m.filmM = 0;
  m.boothBlend = false;
}

/** The first empty rack, or -1 when the oven is full. */
function freeRack(m: MachineState): number {
  for (let i = 0; i < OVEN_RACKS; i++) {
    if (str(m[`ovenPart${i}`]) === '') return i;
  }
  return -1;
}

/**
 * Two racks, each baking its own part for its own length of time.
 *
 * A rack whose part is done but whose lane is full simply holds it. The
 * discharge is a door, and a door with a full rail behind it does not open —
 * faulting here would punish a program for something it could not have seen,
 * since the rack it would have to have predicted was loaded six seconds ago.
 */
function stepOven({ m }: Ctx): void {
  const tempCounts = Math.round(num(m.boothTempM) / MILLI);

  for (let i = 0; i < OVEN_RACKS; i++) {
    const part = str(m[`ovenPart${i}`]);
    if (part === '') continue;

    if (num(m[`ovenCure${i}`]) < 1) {
      const bakeMs = num(m[`ovenMs${i}`], CURE_BASE_MS);
      m[`ovenCure${i}`] = Math.min(1, num(m[`ovenCure${i}`]) + SUB_MS / bakeMs);
      // Judged continuously through the bake: a booth that drifts out of band
      // half way through has already spoiled the finish.
      if (tempCounts < CURE_MIN || tempCounts > CURE_MAX) m[`ovenBad${i}`] = true;
      if (num(m[`ovenCure${i}`]) < 1) continue;
    }

    if (bool(m[`ovenBad${i}`])) {
      m.scrapped = num(m.scrapped) + 1;
      m.painted = num(m.painted) + 1;
    } else {
      const key = part === 'f' ? 'laneF' : 'laneB';
      if (str(m[key]).length >= PA_CAP) continue; // the door stays shut
      m[key] = str(m[key]) + String(num(m[`ovenColor${i}`], 1));
      m.painted = num(m.painted) + 1;
    }
    m[`ovenPart${i}`] = '';
    m[`ovenColor${i}`] = 0;
    m[`ovenCure${i}`] = 0;
    m[`ovenMs${i}`] = 0;
    m[`ovenBad${i}`] = false;
  }
}

// --- Assembly -----------------------------------------------------------------

/**
 * Where the two streams meet, and where a wrong order upstream finally costs.
 *
 * The jig takes a frame off one lane and a boom off the other, and the two have
 * to be the same color, because they are two halves of one machine on one order
 * line. Nothing here can put that right: by the time a mismatched pair is in the
 * jig, the mistake was made in the store an hour ago.
 */
function stepAssembly({ m, y, fault }: Ctx): void {
  // Call a part in off its painted lane.
  if (y('Y17') && num(m.assyFrame) === 0 && str(m.laneF).length > 0) {
    m.assyFrame = Number(str(m.laneF)[0]);
    m.laneF = str(m.laneF).slice(1);
  }
  if (y('Y18') && num(m.assyBoom) === 0 && str(m.laneB).length > 0) {
    m.assyBoom = Number(str(m.laneB)[0]);
    m.laneB = str(m.laneB).slice(1);
  }

  const hasFrame = num(m.assyFrame) > 0;
  const hasBoom = num(m.assyBoom) > 0;

  // Build. Frame first, then the engine, then the cab; and the boom only onto a
  // machine that is ready for it and made up on the bench.
  if (y('Y19')) {
    if (!hasFrame) {
      fault('jam', 'the engine was lowered with no frame in the jig');
      return;
    }
    m.assyEngine = Math.min(1, num(m.assyEngine) + SUB_MS / ASSY_ENGINE_MS);
  }
  if (y('Y20')) {
    if (num(m.assyEngine) < 1) {
      fault('jam', 'the cab was fitted before the engine was in');
      return;
    }
    m.assyCab = Math.min(1, num(m.assyCab) + SUB_MS / ASSY_CAB_MS);
  }
  if (y('Y21')) {
    if (!hasBoom) {
      fault('jam', 'the make-up bench was run with no boom on it');
      return;
    }
    m.assyPrep = Math.min(1, num(m.assyPrep) + SUB_MS / ASSY_PREP_MS);
  }
  if (y('Y22')) {
    if (!hasBoom || num(m.assyCab) < 1) {
      fault('jam', 'the boom was pinned before the machine was ready for it');
      return;
    }
    if (num(m.assyPrep) < 1) {
      fault('jam', 'a boom with no cylinders or hoses on it was pinned to the machine');
      return;
    }
    if (num(m.assyFrame) !== num(m.assyBoom)) {
      fault(
        'jam',
        `a boom in color ${num(m.assyBoom)} was pinned to a machine in color ${num(m.assyFrame)} — ` +
          'the two lanes have drifted a machine apart',
      );
      return;
    }
    m.assyPin = Math.min(1, num(m.assyPin) + SUB_MS / ASSY_BOOM_MS);
  }

  const complete = num(m.assyEngine) >= 1 && num(m.assyCab) >= 1 && num(m.assyPin) >= 1;

  if (y('Y23') && complete) {
    if (num(m.bufAt) >= AT_CAP) {
      fault('blocked', 'a finished machine was released into a full test queue');
      return;
    }
    m.bufAt = num(m.bufAt) + 1;
    m.assyFrame = 0;
    m.assyBoom = 0;
    m.assyEngine = 0;
    m.assyCab = 0;
    m.assyPrep = 0;
    m.assyPin = 0;
  }

  // Starvation is a half-built machine that cannot be finished: one part in the
  // jig, none of the other type anywhere, and no sign of one. An empty line at
  // the start of a shift is idle, not starved.
  const halfBuilt =
    (hasFrame && !hasBoom && str(m.laneB).length === 0) ||
    (hasBoom && !hasFrame && str(m.laneF).length === 0);
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
function stepTest({ m, y, fault }: Ctx): void {
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

  if (y('Y24')) m.testPump = Math.min(1, num(m.testPump) + SUB_MS / TEST_PUMP_MS);

  if (y('Y25')) {
    if (num(m.testPump) < 1) {
      fault('jam', 'the function test ran before the hydraulics were up to pressure');
      return;
    }
    m.testCycle = Math.min(1, num(m.testCycle) + SUB_MS / TEST_CYCLE_MS);
  }

  if (y('Y26') && num(m.testCycle) >= 1) {
    // The bay couples to the machine through a quick release, and a quick
    // release is only quick while it is not under pressure.
    if (y('Y24')) {
      fault('jam', 'the machine was driven off the pad with the test rig still coupled and under pressure');
      return;
    }
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

/**
 * The haulier, and the one place on this plant where waiting is a decision.
 *
 * `Y27 CALL TRUCK` does two jobs, because on a real dock one button does: raise
 * it and a truck is sent for, hold it and the truck stays, drop it and the truck
 * pulls off with whatever it has. Nothing can be hurried — arrival takes as long
 * as it takes and the dock will not take another truck for a rotation after one
 * leaves — so the station is entirely a question of *when*, asked about a thing
 * that answers ten seconds late.
 */
function stepDock({ m, y }: Ctx): void {
  const state = str(m.truckState, 'away');
  m.truckT = num(m.truckT) + SUB_MS;

  if (state === 'away') {
    if (y('Y27') && num(m.truckT) >= TRUCK_GAP_MS) {
      m.truckState = 'coming';
      m.truckT = 0;
    }
    return;
  }

  if (state === 'coming') {
    if (num(m.truckT) >= TRUCK_ARRIVE_MS) {
      m.truckState = 'docked';
      m.truckT = 0;
      m.truckDwell = 0;
      m.truckLoad = 0;
    }
    return;
  }

  if (state === 'docked') {
    m.truckDwell = num(m.truckDwell) + SUB_MS;
    if (num(m.truckLoad) < TRUCK_CAP && num(m.yard) > 0 && num(m.truckT) >= TRUCK_LOAD_MS) {
      m.truckT = 0;
      m.yard = num(m.yard) - 1;
      m.truckLoad = num(m.truckLoad) + 1;
    }
    const full = num(m.truckLoad) >= TRUCK_CAP;
    const outOfHours = num(m.truckDwell) >= TRUCK_DWELL_MS;
    if (full || outOfHours || !y('Y27')) {
      if (num(m.truckLoad) < TRUCK_PART_LOAD) m.partLoads = num(m.partLoads) + 1;
      m.truckState = 'leaving';
      m.truckT = 0;
    }
    return;
  }

  if (num(m.truckT) >= TRUCK_CLEAR_MS) {
    m.truckState = 'away';
    m.truckT = 0;
    m.truckLoad = 0;
    m.trucksSent = num(m.trucksSent) + 1;
  }
}

// --- The field image ----------------------------------------------------------

function sensors(m: MachineState): Record<string, boolean> {
  const stage = str(m.boothStage, 'idle');
  return {
    // Weld
    X4: true, // frame blanks are always available at the shop door
    X5: true, // and so are booms
    X6: num(m.weldClamp) >= 1,
    X7: num(m.weldRotate) <= 0,
    X8: num(m.weldRotate) >= 1,
    X9: num(m.tipPasses) >= TIP_LIFE,
    X10: str(m.storeIn) !== '',
    // Store
    X11: str(m.storeIn) !== '',
    X12: str(m.storeIn) === 'b',
    X13: str(m.storeOut) !== '',
    // Portal
    X14: num(m.portalAt) <= 0,
    X15: num(m.portalAt) >= 1,
    X16: num(m.portalLift) >= 1,
    X17: num(m.portalLift) <= 0,
    X18: str(m.portalPart) !== '',
    // Paint
    X19: stage !== 'idle',
    X20: stage !== 'idle' && str(m.boothPart) === 'b',
    X21: freeRack(m) < 0,
    X22: str(m.laneF).length >= PA_CAP || str(m.laneB).length >= PA_CAP,
    // Assembly
    X23: str(m.laneF).length > 0,
    X24: str(m.laneB).length > 0,
    X25: num(m.assyPrep) >= 1,
    X26: num(m.assyEngine) >= 1 && num(m.assyCab) >= 1 && num(m.assyPin) >= 1,
    X27: num(m.bufAt) < AT_CAP,
    // Test
    X28: bool(m.testPart),
    X29: num(m.testCycle) >= 1,
    X30: num(m.yard) < YARD_CAP,
    X31: str(m.truckState, 'away') === 'docked',
  };
}

function registers(m: MachineState): Record<string, number> {
  const image: Record<string, number> = {
    D0: Math.round(num(m.boothTempM) / MILLI),
    D1: Math.round(num(m.filmM) / MILLI),
    // The color the next part off the booth is due in. Two parts to a machine,
    // so it holds for a pair and then moves on.
    D8: ORDER_COLORS[Math.floor(num(m.sprayed) / 2) % ORDER_COLORS.length],
    D9: num(m.gunColor, 1),
    D10: str(m.laneF).length > 0 ? Number(str(m.laneF)[0]) : 0,
    D11: str(m.laneB).length > 0 ? Number(str(m.laneB)[0]) : 0,
    D12: num(m.yard),
    // What is standing in the jig right now, so a program that starts a build on
    // a frame alone can at least refuse the boom that would ruin it.
    D16: num(m.assyFrame),
    D17: num(m.assyBoom),
  };
  for (let i = 0; i < STORE_LANES; i++) image[`D${4 + i}`] = str(m[`lane${i}`]).length;
  return image;
}

/**
 * POU ids the line puzzles give their six station programs.
 *
 * A contract, not a naming convention: the plant view frames a bay by the id of
 * the section the player has selected, so a puzzle that renamed one would
 * silently lose its camera preset.
 */
export const LINE_SECTIONS = {
  supervisor: 'SUP',
  weld: 'WELD',
  store: 'STORE',
  paint: 'PAINT',
  assembly: 'ASSY',
  test: 'TEST',
} as const;

/** Capacities, bands and rates the 3D view and the briefings both quote. */
export const LINE_LIMITS = {
  STORE_LANES,
  LANE_DEPTH,
  PA_CAP,
  AT_CAP,
  YARD_CAP,
  CURE_MIN,
  CURE_MAX,
  FILM_WINDOW,
  CURE_BASE_MS,
  TIP_LIFE,
  TIP_CHANGE_MS,
  PURGE_MS,
  OVEN_RACKS,
  COLORS,
  ORDER_COLORS,
  TRUCK_ARRIVE_MS,
  TRUCK_CAP,
  TRUCK_PART_LOAD,
  TRUCK_DWELL_MS,
  WELD_PASS_MS,
} as const;
