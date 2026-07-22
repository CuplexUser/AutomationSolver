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
 * Two-lane box packer, mirroring the Blender-designed machine (pack-machine.glb).
 * The feed belt runs continuously and starts EMPTY — boxes enter the two lanes
 * staggered and travel to an end stop. Six double-acting pneumatic actuators
 * (two visible tie-rod cylinders up front, hidden actuators after that) group
 * the flat cartons 2 → 4 → 16 → out:
 *   Y0 2-pack push   (X0 in / X1 out)   pushes a matched pair off the belt
 *                                       into the section-2 file — two strokes
 *                                       stage a 4-pack. Its L-gate blocks the
 *                                       lanes while the plate is away, so
 *                                       arriving boxes hold short of the stop.
 *   Y1 4-pack push   (X2 in / X3 out)   pushes the 4-file onto the flipper
 *                                       tray (lift must be down/empty). Its
 *                                       L-gate crosses the section-2 entry, so
 *                                       a 2-pack stroke completing while it is
 *                                       away from home jams the machine.
 *   Y2 lift/flipper  (X4 down / X5 up)  tips its load over the wall into
 *                                       section 3, where the cartons stand ON
 *                                       END; four flips build a 16-pack
 *   Y3 16-pack1 push (X6 in / X7 out)   slides the 16-block into section 4 —
 *                                       its plate sweeps across the retaining
 *                                       bracket's line, so the bracket must be
 *                                       BACK first
 *   Y4 16-pack2 push (X10 in / X11 out) pushes the pack onto the out-feed
 *                                       belt, which carries it to the
 *                                       finished station
 *   Y5 retaining bracket (X12 back / X13 forward) — the counter-hold that
 *                                       backs the tippy on-end stack in
 *                                       section 3. Flips landing without it
 *                                       forward tip the stack (jam). Only
 *                                       enforced when the puzzle wires Y5;
 *                                       earlier puzzles have it parked
 *                                       forward mechanically.
 * Box-flow sensors are derived from the modelled lanes (never scenario-set):
 *   X14/X15 box at the stop (near/far lane), X16/X17 box waiting in the queue.
 * X20, when the puzzle wires it, is the belt-run command: boxes advance only
 * while it is on (absent = belt always running).
 *
 * A pusher picks its product up the moment it leaves home and delivers it only
 * when the stroke COMPLETES (position crosses fully out) — dropping the coil
 * mid-stroke strands the boxes and latches `jam`, as does pushing a lone box,
 * over-filling a section, loading a raised/occupied lift, or running the
 * 16-pack strokes against the bracket rules above. Scenarios assert `jam`
 * stays false. Actuator travels are multiples of both scan cadences (60ms
 * client, 50ms grader) so end sensors trip on the same scan under either.
 * `ship` (0..1, cosmetic) tracks the latest finished pack riding the out-feed
 * belt so the 3D view can animate the transit; grading never reads it.
 */
const PACK_ACTUATORS = [
  { cmd: 'Y0', inS: 'X0', outS: 'X1', ms: 600, key: 'push2' },
  { cmd: 'Y1', inS: 'X2', outS: 'X3', ms: 600, key: 'push4' },
  { cmd: 'Y2', inS: 'X4', outS: 'X5', ms: 900, key: 'lift' },
  { cmd: 'Y3', inS: 'X6', outS: 'X7', ms: 600, key: 'push16a' },
  { cmd: 'Y4', inS: 'X10', outS: 'X11', ms: 600, key: 'push16b' },
  { cmd: 'Y5', inS: 'X12', outS: 'X13', ms: 300, key: 'backstop' },
] as const;

const PACK_EPS = 0.02;
/** Full lane travel time; the queue hold point sits halfway, so queue → stop = 600ms. */
const LANE_FEED_MS = 1200;
const LANE_QUEUE_POS = 0.5;
/** Arriving boxes hold short of the stop while the 2-pack plate is extended. */
const LANE_BLOCKED_CAP = 0.8;

const PACK_LANES = [
  { lead: 'laneA1', next: 'laneA2', carry: 'carryA', atStop: 'X14', inQueue: 'X16' },
  { lead: 'laneB1', next: 'laneB2', carry: 'carryB', atStop: 'X15', inQueue: 'X17' },
] as const;

/** The puzzle wires the retaining bracket — enforce its interlocks (elevator5-style feature detect). */
function packHasBracket(devices: PuzzleDevice[]): boolean {
  return devices.some((d) => d.address === 'Y5');
}

/** Cosmetic out-feed transit time for the latest finished pack (ship 0 → 1). */
const OUTFEED_MS = 3000;

const packaging: ProcessModel = {
  id: 'packaging',
  init: () => ({
    push2: 0,
    push4: 0,
    lift: 0,
    push16a: 0,
    push16b: 0,
    backstop: 0,
    // Lane positions 0..1 (1 = at the stop); negative = not yet on the belt.
    // The machine starts EMPTY, and lane B trails lane A so the very first
    // pair demonstrably does NOT line up at the same instant.
    laneA1: 0,
    laneA2: -0.55,
    laneB1: -0.25,
    laneB2: -0.8,
    // Boxes riding a mid-stroke pusher plate (delivered at end of stroke).
    carryA: false,
    carryB: false,
    carry4: 0,
    carry16a: 0,
    carry16b: 0,
    // Section box counts along the line, and finished 16-packs shipped.
    sec2: 0,
    liftLoad: 0,
    sec3: 0,
    sec4: 0,
    finished: 0,
    ship: 1,
    jam: false,
  }),
  step: ({ outputs, inputs, machine, devices, dtMs }) => {
    const m: MachineState = { ...machine };
    // A jam is a fault the machine can't run through — like a real line, it
    // freezes solid (actuators, belts, transfers) until something resets it.
    // Without this, a stuck operator can keep cycling outputs after the jam
    // (e.g. flipping more boxes into an already-overfull section 3), which
    // drives section counts — and anything positioned off them, like the
    // retaining bracket — arbitrarily far past their normal range.
    const wasJammed = machine.jam === true;
    let jam = wasJammed;
    const hasBracket = packHasBracket(devices);
    const dt = wasJammed ? 0 : dtMs;

    // -- actuators -----------------------------------------------------------
    const pos: Record<string, { prev: number; next: number }> = {};
    for (const a of PACK_ACTUATORS) {
      const prev = num(machine[a.key]);
      let extend = outputs[a.cmd] === true;
      // Physical interlock: the lift cannot leave the bottom while the 4-pack
      // rod is still extended under its platform.
      if (a.key === 'lift' && prev <= PACK_EPS && num(machine.push4) > PACK_EPS) extend = false;
      // Puzzles that don't wire Y5 have the retaining bracket parked forward
      // mechanically: it drives itself out at power-up and stays there.
      if (a.key === 'backstop' && !hasBracket) extend = true;
      const next = extend ? Math.min(1, prev + dt / a.ms) : Math.max(0, prev - dt / a.ms);
      m[a.key] = next;
      pos[a.key] = { prev, next };
    }
    const strokeStarts = (k: string) => pos[k].prev <= PACK_EPS && pos[k].next > PACK_EPS;
    const strokeEnds = (k: string) => pos[k].prev < 1 - PACK_EPS && pos[k].next >= 1 - PACK_EPS;
    const strokeAborts = (k: string) => pos[k].prev > PACK_EPS && pos[k].next <= PACK_EPS;

    // -- product transfers (downstream stages first) --------------------------
    // 16-pack2: section 4 → out-feed belt, which carries the pack to the
    // finished station (`ship` animates that transit; the count is final at
    // the stroke's end). The bracket sits north of section 4 — no interaction.
    if (strokeStarts('push16b') && num(m.sec4) > 0) {
      m.carry16b = num(m.sec4);
      m.sec4 = 0;
    }
    if (strokeEnds('push16b') && num(m.carry16b) > 0) {
      m.finished = num(m.finished) + 1;
      m.ship = 0;
      m.carry16b = 0;
    }
    // 16-pack1: section 3 → section 4. Its plate sweeps across the bracket's
    // line, so the bracket must be fully BACK — and section 4 must be clear.
    if (strokeStarts('push16a') && num(m.sec3) > 0) {
      m.carry16a = num(m.sec3);
      m.sec3 = 0;
    }
    if (strokeEnds('push16a') && num(m.carry16a) > 0) {
      if (num(m.backstop) <= PACK_EPS && num(m.sec4) === 0) m.sec4 = num(m.carry16a);
      else jam = true; // plate swept into the bracket / crashed into the last pack
      m.carry16a = 0;
    }
    // Lift: flips its load over into section 3 at the top of the stroke. The
    // on-end cartons tip over unless the bracket backs the stack (only when
    // the puzzle wires Y5 — otherwise it is parked forward for you).
    if (strokeEnds('lift') && num(m.liftLoad) > 0) {
      if (hasBracket && num(m.backstop) < 1 - PACK_EPS) jam = true;
      m.sec3 = num(m.sec3) + num(m.liftLoad);
      m.liftLoad = 0;
      if (num(m.sec3) > 16) jam = true;
    }
    // 4-pack: section 2 → lift platform, which must be down and empty.
    if (strokeStarts('push4') && num(m.sec2) > 0) {
      m.carry4 = num(m.sec2);
      m.sec2 = 0;
    }
    if (strokeEnds('push4') && num(m.carry4) > 0) {
      if (pos.lift.next <= PACK_EPS && num(m.liftLoad) === 0) m.liftLoad = num(m.carry4);
      else jam = true; // boxes dumped against a raised or occupied lift
      m.carry4 = 0;
    }
    // 2-pack: picks up whatever is at the stop when it sets off …
    if (strokeStarts('push2')) {
      for (const { lead, next, carry } of PACK_LANES) {
        if (num(m[lead]) >= 1 - PACK_EPS) {
          m[carry] = true;
          m[lead] = num(m[next]);
          m[next] = 0; // endless supply: a fresh box enters as the queue advances
        }
      }
    }
    // … and lands it in section 2 at full stroke. A lone box goes in askew, a
    // third pair over-fills, and an extended 4-pack rod is in the way.
    if (strokeEnds('push2') && (m.carryA === true || m.carryB === true)) {
      if (m.carryA !== m.carryB || pos.push4.next > PACK_EPS) {
        jam = true;
      } else {
        m.sec2 = num(m.sec2) + 2;
        if (num(m.sec2) > 4) jam = true;
      }
      m.carryA = false;
      m.carryB = false;
    }
    // A pusher recalled mid-stroke strands its boxes off every station.
    for (const k of ['push4', 'push16a', 'push16b'] as const) {
      const carryKey = k === 'push4' ? 'carry4' : k === 'push16a' ? 'carry16a' : 'carry16b';
      if (strokeAborts(k) && num(m[carryKey]) > 0) {
        jam = true;
        m[carryKey] = 0;
      }
    }
    if (strokeAborts('push2') && (m.carryA === true || m.carryB === true)) {
      jam = true;
      m.carryA = false;
      m.carryB = false;
    }

    // -- feed belt -------------------------------------------------------------
    const beltOn = inputs['X20'] !== false && !wasJammed;
    if (beltOn) {
      for (const { lead, next } of PACK_LANES) {
        const leadCap = pos.push2.next <= PACK_EPS ? 1 : LANE_BLOCKED_CAP;
        const leadPos = num(m[lead]);
        if (leadPos < leadCap) m[lead] = Math.min(leadCap, leadPos + dtMs / LANE_FEED_MS);
        const nextPos = num(m[next]);
        if (nextPos < LANE_QUEUE_POS) m[next] = Math.min(LANE_QUEUE_POS, nextPos + dtMs / LANE_FEED_MS);
      }
    }

    // -- out-feed transit (cosmetic; drives the 3D view only) ------------------
    if (!wasJammed && num(m.ship, 1) < 1) m.ship = Math.min(1, num(m.ship) + dtMs / OUTFEED_MS);

    // -- sensors ---------------------------------------------------------------
    const derivedInputs: Record<string, boolean> = {};
    for (const a of PACK_ACTUATORS) {
      derivedInputs[a.inS] = pos[a.key].next <= PACK_EPS;
      derivedInputs[a.outS] = pos[a.key].next >= 1 - PACK_EPS;
    }
    for (const { lead, next, atStop, inQueue } of PACK_LANES) {
      derivedInputs[atStop] = num(m[lead]) >= 1 - PACK_EPS;
      derivedInputs[inQueue] = num(m[next]) >= LANE_QUEUE_POS - PACK_EPS;
    }

    m.jam = jam;
    return { machine: m, derivedInputs };
  },
};

/**
 * Pick-and-place robot arm. A single arm swings on a vertical pivot between an
 * infeed station (0) and up to 4 tray slots (1..slotCount), extends/retracts a
 * reach axis to pick height, and closes/opens a gripper. Fixed address
 * convention (fixed for the same reason elevator5's is: too many same-widget
 * devices to disambiguate dynamically):
 *   X0      At Infeed (station 0)
 *   X1-X4   At Slot 1-4 (stations 1..slotCount — slotCount is however many of
 *           these are wired, elevator5-door-style feature detection widened
 *           from a boolean to a count)
 *   X10     Reach Down (fully extended)   X11 Reach Up (fully retracted)
 *   X12     Gripped — a live confirmation (reach down · gripper closed · a
 *           part is actually under the fingers, whether about to be picked up
 *           or already carried and about to be set down), never a latch
 *   X13     Infeed Ready — feature-detected: absent means a bottomless
 *           supply, present means a real deplete/refill cycle
 *   X14-X17 Slot 1-4 Occupied             X18 Tray Full (every wired slot occupied)
 *   X20     Reset button (only meaningful alongside the Y5 reset coil below)
 *   Y0/Y1   Swing to Tray / Swing to Infeed        Y2 Reach Down     Y3 Gripper Close
 *   Y5      Reset Tray — feature-detected like elevator5's door: its mere
 *           presence in `devices` lets an operator clear tray occupancy
 *           (never `jam`) while nothing is being carried
 * Swing travel is 600ms/station: divisible by both the client's 60ms live
 * scan and the grader's 50ms scan, so a continuous swing lands exactly on
 * every intermediate station on some scan — needed so a multi-slot sweep can
 * detect an already-occupied slot in passing without stopping there, the same
 * exact-common-multiple trick elevator5 uses for its floor stops. The arm
 * physically cannot swing while reach is extended (it would crash into the
 * tray guarding) — enforced here, not just graded, exactly like elevator5's
 * door interlock.
 * A part is picked the instant reach leaves the bottom with the gripper
 * closed and nothing already carried (grabs whatever is at the current
 * station, or silently comes up empty); it's placed the instant the gripper
 * finishes opening while carrying. Both illegal moves — dropping mid-air, or
 * placing into an already-occupied slot — latch `jam`, exactly like
 * packaging's fault latch, and every scenario asserts it stays false.
 */
function pickPlaceSlotCount(devices: PuzzleDevice[]): number {
  return [1, 2, 3, 4].filter((k) => devices.some((d) => d.address === `X${k}`)).length;
}

function pickPlaceHasInfeedSensor(devices: PuzzleDevice[]): boolean {
  return devices.some((d) => d.address === 'X13');
}

function pickPlaceHasReset(devices: PuzzleDevice[]): boolean {
  return devices.some((d) => d.address === 'Y5');
}

const PP_SWING_MS = 600;
const PP_REACH_DOWN_MS = 400;
const PP_REACH_UP_MS = 300;
const PP_GRIP_CLOSE_MS = 300;
const PP_GRIP_OPEN_MS = 250;
const PP_REFILL_MS = 1500;
const PP_POS_EPS = 0.02;

function pickPlaceSlotAt(m: MachineState, idx: number): boolean {
  if (idx === 1) return m.slot1 === true;
  if (idx === 2) return m.slot2 === true;
  if (idx === 3) return m.slot3 === true;
  if (idx === 4) return m.slot4 === true;
  return false;
}

function pickPlaceSetSlotAt(m: MachineState, idx: number, value: boolean): void {
  if (idx === 1) m.slot1 = value;
  else if (idx === 2) m.slot2 = value;
  else if (idx === 3) m.slot3 = value;
  else if (idx === 4) m.slot4 = value;
}

const pickPlace: ProcessModel = {
  id: 'pickPlace',
  init: () => ({
    station: 0,
    dir: 0,
    reach: 0,
    grip: 0,
    carrying: false,
    infeedPart: true,
    refillT: 0,
    slot1: false,
    slot2: false,
    slot3: false,
    slot4: false,
    placed: 0,
    jam: false,
  }),
  step: ({ outputs, devices, machine, dtMs }) => {
    const m: MachineState = { ...machine };
    const slotCount = pickPlaceSlotCount(devices);
    const hasInfeedSensor = pickPlaceHasInfeedSensor(devices);
    const hasReset = pickPlaceHasReset(devices);

    let jam = machine.jam === true;
    const dt = jam ? 0 : dtMs;

    // Swing physical interlock: cannot move while reach is extended (would
    // crash into the tray guarding), exactly like elevator5's door interlock.
    const prevReach = num(machine.reach);
    const canSwing = prevReach <= PP_POS_EPS;
    const swingOut = outputs['Y0'] === true && outputs['Y1'] !== true && canSwing;
    const swingIn = outputs['Y1'] === true && outputs['Y0'] !== true && canSwing;
    let station = num(machine.station);
    let dir = 0;
    if (swingOut) {
      station = Math.min(slotCount, station + dt / PP_SWING_MS);
      dir = 1;
    } else if (swingIn) {
      station = Math.max(0, station - dt / PP_SWING_MS);
      dir = -1;
    }

    // Reach and gripper: independent travel-fraction actuators, drill-style.
    const reachCmd = outputs['Y2'] === true;
    const reach = reachCmd
      ? Math.min(1, prevReach + dt / PP_REACH_DOWN_MS)
      : Math.max(0, prevReach - dt / PP_REACH_UP_MS);
    const prevGrip = num(machine.grip);
    const gripCmd = outputs['Y3'] === true;
    const grip = gripCmd
      ? Math.min(1, prevGrip + dt / PP_GRIP_CLOSE_MS)
      : Math.max(0, prevGrip - dt / PP_GRIP_OPEN_MS);

    // Infeed supply (feature-detected): absent = bottomless, present = a real
    // deplete/refill cycle.
    let infeedPart = machine.infeedPart !== false;
    let refillT = num(machine.refillT);
    if (!hasInfeedSensor) {
      infeedPart = true;
      refillT = 0;
    } else if (!infeedPart) {
      refillT += dt;
      if (refillT >= PP_REFILL_MS) {
        infeedPart = true;
        refillT = 0;
      }
    }

    let carrying = machine.carrying === true;
    let placed = num(machine.placed);

    const partPresentAt = (stationVal: number): boolean => {
      const idx = Math.round(stationVal);
      if (Math.abs(stationVal - idx) > PP_POS_EPS) return false;
      return idx === 0 ? infeedPart : pickPlaceSlotAt(m, idx);
    };

    // Pick: reach just leaves the bottom while the gripper is still closed and
    // nothing is already carried — grabs whatever is at the current station,
    // or silently comes up empty if nothing is there.
    const justLeftBottom = prevReach >= 1 && reach < 1;
    if (justLeftBottom && prevGrip >= 1 && !carrying) {
      if (partPresentAt(station)) {
        carrying = true;
        const idx = Math.round(station);
        if (idx === 0) {
          infeedPart = false;
          refillT = 0;
        } else {
          pickPlaceSetSlotAt(m, idx, false);
        }
      }
    }

    // Place: the gripper finishes opening while carrying. Dropping mid-air
    // (reach not down) or placing into an already-occupied slot both jam.
    const gripJustOpened = prevGrip > 0 && grip <= 0;
    if (gripJustOpened && carrying) {
      if (reach < 1) {
        jam = true;
      } else {
        const idx = Math.round(station);
        if (idx === 0 || pickPlaceSlotAt(m, idx)) {
          jam = true;
        } else {
          pickPlaceSetSlotAt(m, idx, true);
          placed += 1;
        }
      }
      carrying = false;
    }

    // Reset (feature-detected): an idempotent "operator unloads the tray"
    // action — clears occupancy, never jam, only while nothing is carried.
    if (hasReset && outputs['Y5'] === true && !carrying) {
      m.slot1 = false;
      m.slot2 = false;
      m.slot3 = false;
      m.slot4 = false;
      placed = 0;
    }

    const derivedInputs: Record<string, boolean> = {
      X0: Math.abs(station) <= PP_POS_EPS,
      X1: Math.abs(station - 1) <= PP_POS_EPS,
      X2: Math.abs(station - 2) <= PP_POS_EPS,
      X3: Math.abs(station - 3) <= PP_POS_EPS,
      X4: Math.abs(station - 4) <= PP_POS_EPS,
      X10: reach >= 1,
      X11: reach <= 0,
      X12: reach >= 1 && grip >= 1 && (carrying || partPresentAt(station)),
      X14: m.slot1 === true,
      X15: m.slot2 === true,
      X16: m.slot3 === true,
      X17: m.slot4 === true,
    };
    const occupied = [m.slot1, m.slot2, m.slot3, m.slot4].slice(0, slotCount).filter((v) => v === true).length;
    derivedInputs.X18 = slotCount > 0 && occupied >= slotCount;
    if (hasInfeedSensor) derivedInputs.X13 = infeedPart;

    m.station = station;
    m.dir = dir;
    m.reach = reach;
    m.grip = grip;
    m.carrying = carrying;
    m.infeedPart = infeedPart;
    m.refillT = refillT;
    m.placed = placed;
    m.jam = jam;

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
  [pickPlace.id, pickPlace],
]);

export function getProcess(id: string): ProcessModel {
  return registry.get(id) ?? passthrough;
}

export function registerProcess(model: ProcessModel): void {
  registry.set(model.id, model);
}
