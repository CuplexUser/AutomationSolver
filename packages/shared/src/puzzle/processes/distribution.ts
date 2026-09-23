import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * Cold Chain Hub: a food distribution center run by a fleet of automated
 * forklifts.
 *
 * Every plant before this one is driven. This one is *dispatched*: the program
 * never turns a wheel. It posts transport orders ("from here, to there") to a
 * fleet manager, the way a real PLC talks to a real AGV system, and the manager
 * picks a vehicle, drives it round the loop, keeps it out of the way of the
 * others and puts the pallet down. What is left for the program is everything
 * the manager cannot know: which of four things wanting a forklift gets the next
 * one, where a pallet should go, and - because the plant has exactly one
 * scanner, at QA - *which pallet is which*. Past QA no lane, room or dock reads a
 * label, so the program is the warehouse management system, and the plant checks
 * its claims at the labeler, at the advance shipping notice and at the trailer.
 * See docs/COLD-CHAIN.md for the design; this header is the contract.
 *
 * ## The floor
 *
 * A one-way loop, 20 x 8 m, 56 m round, driven clockwise seen from above: east
 * along the north leg, south, west along the south leg, north. Position on it is
 * `s`, millimeters from the north-west corner. Every place a pallet can stand is
 * a **location** with a code (the mailbox's language) and one or two **stops**
 * on the loop. A vehicle leaves the loop into a stop's *pocket* to work there, so
 * a working vehicle never blocks traffic - but only one vehicle fits a pocket,
 * and the next one waits on the loop, a full gap short of the stop so the
 * occupant can still get out. The flow lanes span the inside of the loop and
 * have two stops, a load face on the north leg and a pick face on the south leg,
 * which is what makes them first-in first-out.
 *
 * ## Determinism
 *
 * Integer millimeters and milliseconds on a fixed `SUB_MS` sub-step with a
 * carried remainder, the discipline of `tank.ts` and `axis.ts`: the fleet's
 * trajectory is the same at any `dt`, which the first test pins. Vehicles update
 * in index order and every tie breaks on index.
 *
 * ## Pallets
 *
 * A pallet is a six-character token, `PLLQRD`: product (1 digit), lot (2
 * digits), QA state (`P`/`F` unchecked with the truth it will reveal, `p`/`f`
 * checked), ripeness (`n` does not ripen, `g` green, `r` ripe) and label (`0`
 * none, `1` OUT1, `2` OUT2). Its **code**, the one number the program tracks, is
 * `product x 100 + lot`. Lower lots expire sooner and must ship first.
 */

// --- Timing and geometry -------------------------------------------------------

/** Internal sub-step. Every timer and distance below advances on this grid. */
export const SUB_MS = 10;
/** Travel per sub-step on the loop: 3 m/s, in the compressed time every plant here runs on. */
export const SPEED_MM = 30;
/** The loop, in millimeters round. */
export const LOOP_MM = 56_000;
/** Front-to-front distance a vehicle keeps behind the one ahead. */
export const MIN_GAP_MM = 2000;
/** A vehicle's length: nothing may merge closer than this to another. */
export const VEHICLE_MM = 1500;
/** Where a vehicle waits for a busy pocket: this far short of the stop. */
export const WAIT_BACK_MM = 2000;

/** Turning off the loop into a pocket, and back out. */
export const ENTER_MS = 800;
export const EXIT_MS = 800;
/** One fork cycle: lift or set down a pallet. */
export const FORK_MS = 1200;

/** A vehicle that cannot do its job for this long has stalled the plant. */
export const STALL_MS = 20_000;
/** An inbound pallet that finds its dock full for this long has blocked goods in. */
export const BLOCK_MS = 20_000;

export const QA_MS = 4000;
/** Travel between wrapper zones, and the wrap itself. */
export const ZONE_MS = 1200;
export const WRAP_MS = 5000;
/** A ripening room's door, open or shut, and its gas cycle. */
export const DOOR_MS = 2000;
export const RIPEN_MS = 20_000;
/** A truck that is not loaded this long after docking has missed its slot. */
export const TRUCK_MS = 150_000;
/** The yard turnaround between one truck leaving and the next docking. */
export const TRUCK_GAP_MS = 6000;

/** After a call is claimed, the dock is quiet this long before calling for the next. */
export const CALL_GAP_MS = 3000;

/** Pallets an inbound dock stages before the truck behind it has to wait. */
export const DOCK_CAP = 3;
/** Pallets a lane, a room or quarantine holds. */
export const LANE_CAP = 4;

/** Battery in tenths of a percent, and what drains and fills it. */
export const BATTERY_FULL = 1000;
export const BATTERY_MM_PER_UNIT = 300;
export const CHARGE_MS_PER_UNIT = 20;

/** Products. 1 and 2 arrive green where the plant has ripening rooms. */
export const DC_PRODUCTS = ['', 'Bananas', 'Avocados', 'Tomatoes', 'Potatoes'] as const;
const RIPENING_PRODUCTS = new Set([1, 2]);

export type LocationKind =
  | 'dock-in'
  | 'qa'
  | 'quarantine'
  | 'room'
  | 'flow'
  | 'drive-in'
  | 'wrap-in'
  | 'wrap-out'
  | 'dock-out'
  | 'charger';

export interface LocationDef {
  code: number;
  name: string;
  kind: LocationKind;
  /** Stop a vehicle sets a pallet down at, or -1 when nothing is ever put here. */
  drop: number;
  /** Stop a vehicle lifts a pallet from, or -1 when nothing is ever taken from here. */
  pick: number;
  /** Which side of the loop the pocket is on, for the scene. */
  side: 'out' | 'in';
}

/**
 * Every location the hub has. A puzzle builds only some of them (`locs` in its
 * `plantConfig`), but they always stand in the same place, so a distance learned
 * in one puzzle holds in the next.
 */
export const DC_LOCATIONS: readonly LocationDef[] = [
  { code: 1, name: 'IN1', kind: 'dock-in', drop: -1, pick: 1500, side: 'out' },
  { code: 2, name: 'IN2', kind: 'dock-in', drop: -1, pick: 3500, side: 'out' },
  { code: 10, name: 'QA', kind: 'qa', drop: 5500, pick: 5500, side: 'out' },
  { code: 11, name: 'QUARANTINE', kind: 'quarantine', drop: 7500, pick: -1, side: 'out' },
  { code: 31, name: 'F1', kind: 'flow', drop: 10_000, pick: 38_000, side: 'in' },
  { code: 32, name: 'F2', kind: 'flow', drop: 11_500, pick: 36_500, side: 'in' },
  { code: 33, name: 'F3', kind: 'flow', drop: 13_000, pick: 35_000, side: 'in' },
  { code: 21, name: 'R1', kind: 'room', drop: 15_500, pick: 15_500, side: 'out' },
  { code: 22, name: 'R2', kind: 'room', drop: 17_500, pick: 17_500, side: 'out' },
  { code: 50, name: 'WRAP IN', kind: 'wrap-in', drop: 22_000, pick: -1, side: 'out' },
  { code: 51, name: 'WRAP OUT', kind: 'wrap-out', drop: -1, pick: 25_000, side: 'out' },
  { code: 41, name: 'L1', kind: 'drive-in', drop: 40_500, pick: 40_500, side: 'in' },
  { code: 42, name: 'L2', kind: 'drive-in', drop: 42_000, pick: 42_000, side: 'in' },
  { code: 43, name: 'L3', kind: 'drive-in', drop: 43_500, pick: 43_500, side: 'in' },
  // Just downstream of the parking bays: on a one-way loop anything upstream of
  // them is a whole lap away, which a vehicle sent to charge may not have.
  { code: 70, name: 'CHARGER', kind: 'charger', drop: 46_000, pick: -1, side: 'out' },
  // Outbound last, on the west leg, and immediately upstream of the inbound docks:
  // a vehicle that has just loaded a truck is at the start of the next job.
  { code: 61, name: 'OUT1', kind: 'dock-out', drop: 50_000, pick: -1, side: 'out' },
  { code: 62, name: 'OUT2', kind: 'dock-out', drop: 53_000, pick: -1, side: 'out' },
];

/** Each vehicle's own parking pocket, on the outside of the south leg. */
export const DEPOT_STOPS: readonly number[] = [29_500, 31_000, 32_500];
/** Most vehicles a puzzle can have. */
export const MAX_FLEET = DEPOT_STOPS.length;

const LOCATION_BY_CODE = new Map(DC_LOCATIONS.map((l) => [l.code, l]));

export function locationByCode(code: number): LocationDef | undefined {
  return LOCATION_BY_CODE.get(code);
}

/**
 * The loop's corners in plan (x east, y south, millimeters), in travel order
 * from `s = 0`. The scene and the briefings read the same numbers.
 */
export const LOOP_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [20_000, 0],
  [20_000, 8000],
  [0, 8000],
];

/** Point and heading on the loop. Heading is radians, 0 = east, clockwise positive (plan y is south). */
export function loopPoint(s: number): { x: number; y: number; heading: number } {
  let rest = ((s % LOOP_MM) + LOOP_MM) % LOOP_MM;
  for (let i = 0; i < LOOP_CORNERS.length; i++) {
    const [x0, y0] = LOOP_CORNERS[i];
    const [x1, y1] = LOOP_CORNERS[(i + 1) % LOOP_CORNERS.length];
    const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (rest <= len) {
      const t = len === 0 ? 0 : rest / len;
      return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, heading: Math.atan2(y1 - y0, x1 - x0) };
    }
    rest -= len;
  }
  return { x: 0, y: 0, heading: 0 };
}

/**
 * Which way "out" is at a point on the loop, as a unit vector in plan. The loop
 * runs clockwise, so the outside is always to the travel direction's left.
 */
export function outward(heading: number): { x: number; y: number } {
  return { x: Math.round(Math.sin(heading)), y: -Math.round(Math.cos(heading)) };
}

// --- Pallet tokens ---------------------------------------------------------------

export interface Pallet {
  product: number;
  lot: number;
  /** `P`/`F` not yet checked (the truth QA will reveal), `p`/`f` checked. */
  qa: 'P' | 'F' | 'p' | 'f';
  ripe: 'n' | 'g' | 'r';
  /** 0 unlabeled, 1 for OUT1, 2 for OUT2. */
  label: number;
}

export function parsePallet(token: string): Pallet {
  return {
    product: Number.parseInt(token[0] ?? '0', 10),
    lot: Number.parseInt(token.slice(1, 3), 10),
    qa: (token[3] ?? 'P') as Pallet['qa'],
    ripe: (token[4] ?? 'n') as Pallet['ripe'],
    label: Number.parseInt(token[5] ?? '0', 10),
  };
}

export function formatPallet(p: Pallet): string {
  return `${p.product}${String(p.lot).padStart(2, '0')}${p.qa}${p.ripe}${p.label}`;
}

/** The one number a program tracks a pallet by. */
export function palletCode(p: Pallet): number {
  return p.product * 100 + p.lot;
}

const split = (list: string): string[] => (list === '' ? [] : list.split(','));
const join = (items: readonly string[]): string => items.join(',');

// --- Faults ----------------------------------------------------------------------

class Fault extends Error {}

// --- I/O --------------------------------------------------------------------------

/** The program's side of the mailbox, and the other commands it gives. */
export const DC_OUT = {
  request: 'Y0',
  print: 'Y1',
  door1: 'Y2',
  door2: 'Y3',
  start1: 'Y4',
  start2: 'Y5',
  lineAck: 'Y6',
} as const;

/** Registers the program writes and the plant reads. */
export const DC_CMD = {
  from: 'D0',
  to: 'D1',
  labelDoor: 'D2',
  asnCode: 'D3',
} as const;

/** Sensors the plant drives. */
export const DC_IN = {
  ack: 'X0',
  nak: 'X1',
  vehicleFree: 'X2',
  in1: 'X3',
  in2: 'X4',
  qaBusy: 'X5',
  qaDone: 'X6',
  qaPass: 'X7',
  infeedClear: 'X10',
  atLabeler: 'X11',
  outfeedReady: 'X12',
  truck1: 'X13',
  truck2: 'X14',
  door1Open: 'X15',
  door2Open: 'X16',
  ripe1: 'X17',
  ripe2: 'X20',
  lineReady: 'X21',
  door1Shut: 'X22',
  door2Shut: 'X23',
  /** The light curtain across each room's doorway: no vehicle in it. */
  doorway1Clear: 'X24',
  doorway2Clear: 'X25',
} as const;

/** Transmitters: registers the plant writes. */
export const DC_REG = {
  qaCode: 'D5',
  freeVehicles: 'D7',
  lineDock: 'D8',
  lineProduct: 'D9',
  /** What an outbound dock is calling for, product 1 to 4, or 0 between calls. */
  call1: 'D13',
  call2: 'D14',
  quarantine: 'D11',
  /** A room, lane or dock's count sits in the register numbered like its code. */
  count: (code: number): string => `D${code}`,
  battery: (vehicle: number): string => `D${80 + vehicle}`,
  route: (product: number): string => `D${100 + product}`,
} as const;

// --- Helpers over the state bag ----------------------------------------------------

const num = (m: MachineState, k: string, d = 0): number => (typeof m[k] === 'number' ? (m[k] as number) : d);
const str = (m: MachineState, k: string, d = ''): string => (typeof m[k] === 'string' ? (m[k] as string) : d);
const bool = (m: MachineState, k: string): boolean => m[k] === true;

const v = (i: number, key: string): string => `v${i}${key}`;
const contentsKey = (code: number): string => `c${code}`;

/** Codes this puzzle actually built, from `plantConfig.locs`. */
export function builtLocations(m: MachineState): Set<number> {
  return new Set(
    str(m, 'locs')
      .split(',')
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => LOCATION_BY_CODE.has(n)),
  );
}

type VehicleState = 'off' | 'park' | 'drive' | 'enter' | 'hold' | 'work' | 'exit' | 'charge';
type Leg = '' | 'src' | 'dst' | 'home' | 'chg';

const POCKET_STATES = new Set<VehicleState>(['park', 'enter', 'hold', 'work', 'exit', 'charge']);

function fleetSize(m: MachineState): number {
  return Math.max(1, Math.min(MAX_FLEET, num(m, 'fleet', 1)));
}

function stopFor(m: MachineState, i: number): number {
  const leg = str(m, v(i, 'Leg')) as Leg;
  if (leg === 'src') return locationByCode(num(m, v(i, 'From')))?.pick ?? -1;
  if (leg === 'dst') return locationByCode(num(m, v(i, 'To')))?.drop ?? -1;
  if (leg === 'chg') return locationByCode(70)!.drop;
  return DEPOT_STOPS[i];
}

const ahead = (from: number, to: number): number => (((to - from) % LOOP_MM) + LOOP_MM) % LOOP_MM;

// --- The model --------------------------------------------------------------------------

function init(): MachineState {
  const m: MachineState = {
    locs: '1,10,61',
    fleet: 1,
    rem: 0,
    tMs: 0,
    ack: false,
    nak: false,
    jam: false,
    jamReason: '',
    stalled: false,
    blocked: false,
    late: false,
    flat: false,
    received: 0,
    shipped: 0,
    quarantined: 0,
    // Inbound: what each dock's trucks bring, in order, and when.
    in1: '',
    in2: '',
    inFirst: 2000,
    inEvery: 12_000,
    a1T: -1,
    a2T: -1,
    a1Wait: 0,
    a2Wait: 0,
    qaT: 0,
    routes: '61,61,61,61',
    asn: false,
    battery: false,
    // The wrapper line: infeed, two accumulation zones, the wrap, the labeler, outfeed.
    w0: '',
    w1: '',
    w2: '',
    w3: '',
    w4: '',
    w5: '',
    wt0: 0,
    wt1: 0,
    wt2: 0,
    wt3: 0,
    wt4: 0,
    wt5: 0,
    prevPrint: false,
    prevLineAck: false,
    feed: '',
  };
  for (const loc of DC_LOCATIONS) m[contentsKey(loc.code)] = '';
  for (const r of [1, 2]) {
    m[`r${r}Door`] = 0;
    m[`r${r}Run`] = false;
    m[`r${r}T`] = 0;
    m[`r${r}Done`] = false;
    m[`r${r}Prev`] = false;
  }
  for (const d of [61, 62]) {
    m[`calls${d}`] = '';
    m[`call${d}`] = 0;
    m[`call${d}T`] = -1;
    m[`trucks${d}`] = '';
    m[`t${d}`] = 'none';
    m[`t${d}T`] = 0;
    m[`o${d}`] = '';
    m[`k${d}`] = 0;
  }
  for (let i = 0; i < MAX_FLEET; i++) {
    m[v(i, 'S')] = 'park';
    m[v(i, 'Leg')] = '';
    m[v(i, 'Pos')] = DEPOT_STOPS[i];
    m[v(i, 'Pk')] = DEPOT_STOPS[i];
    m[v(i, 'T')] = 0;
    m[v(i, 'From')] = 0;
    m[v(i, 'To')] = 0;
    m[v(i, 'Load')] = '';
    m[v(i, 'Asn')] = -1;
    m[v(i, 'Batt')] = BATTERY_FULL;
    m[v(i, 'Bmm')] = 0;
    m[v(i, 'Wait')] = 0;
  }
  return m;
}

/**
 * Lay out anything a configuration asked for that `init` cannot know about:
 * vehicles past the fleet size go off, and each dock's first truck comes in.
 * Idempotent, so running it on every step costs nothing after the first.
 */
function settle(m: MachineState): void {
  const fleet = fleetSize(m);
  for (let i = 0; i < MAX_FLEET; i++) {
    if (i >= fleet) m[v(i, 'S')] = 'off';
  }
  for (const d of [61, 62]) {
    // A dock with a call list calls for its first product straight away.
    if (num(m, `call${d}T`) < 0) {
      m[`callOn${d}`] = str(m, `calls${d}`) !== '';
      m[`call${d}T`] = 0;
    }
    if (str(m, `t${d}`) === 'none') {
      const trucks = split(str(m, `trucks${d}`).replaceAll(';', ','));
      m[`t${d}`] = trucks.length > 0 ? 'away' : 'open';
      m[`t${d}T`] = TRUCK_GAP_MS;
    }
  }
  // Each dock can keep its own timetable (`in2First`, `in2Every`); by default the
  // two share one, IN2 half a period behind IN1.
  if (num(m, 'a1T') < 0) m.a1T = num(m, 'in1First', num(m, 'inFirst'));
  if (num(m, 'a2T') < 0) m.a2T = num(m, 'in2First', num(m, 'inFirst') + Math.trunc(num(m, 'inEvery') / 2));
}

// --- Locations: what is there, what may go in and what may come out ------------------------

function contents(m: MachineState, code: number): string[] {
  return split(str(m, contentsKey(code)));
}

function setContents(m: MachineState, code: number, items: readonly string[]): void {
  m[contentsKey(code)] = join(items);
}

/** Everything in storage (lanes of either kind), for the first-expired-first-out rule. */
function stored(m: MachineState): { code: number; pallet: Pallet }[] {
  const out: { code: number; pallet: Pallet }[] = [];
  for (const loc of DC_LOCATIONS) {
    if (loc.kind !== 'flow' && loc.kind !== 'drive-in') continue;
    for (const t of contents(m, loc.code)) out.push({ code: loc.code, pallet: parsePallet(t) });
  }
  return out;
}

const describe = (p: Pallet): string => `${DC_PRODUCTS[p.product] ?? 'product ' + p.product} lot ${p.lot}`;

function roomIndex(code: number): 1 | 2 {
  return code === 21 ? 1 : 2;
}

function doorOpen(m: MachineState, code: number): boolean {
  return num(m, `r${roomIndex(code)}Door`) >= DOOR_MS;
}

function truckOrder(m: MachineState, dock: number): number[] {
  return str(m, `o${dock}`)
    .split('')
    .map((c) => Number.parseInt(c, 10))
    .filter((n) => n > 0);
}

/**
 * Can this pallet be set down here now? `true` to go ahead, `false` to wait
 * holding it; a mistake throws. Checked when the vehicle is in the pocket, which
 * is when a real one finds out.
 */
function canDrop(m: MachineState, code: number, token: string, asn: number): boolean {
  const loc = locationByCode(code)!;
  const p = parsePallet(token);
  const here = loc.name;

  if ((p.qa === 'P' || p.qa === 'F') && loc.kind !== 'qa') {
    throw new Fault(`${describe(p)} went to ${here} without going through QA first`);
  }
  if (p.qa === 'f' && loc.kind !== 'quarantine') {
    throw new Fault(`${describe(p)} failed QA and went to ${here} instead of quarantine`);
  }
  if (p.qa === 'p' && loc.kind === 'quarantine') {
    throw new Fault(`${describe(p)} passed QA and was quarantined anyway`);
  }
  // A failed pallet is quarantined however ripe it is; only a good one has to ripen first.
  if (p.ripe === 'g' && loc.kind !== 'room' && loc.kind !== 'qa' && loc.kind !== 'quarantine') {
    throw new Fault(`${describe(p)} is still green and went to ${here}; it ripens first`);
  }

  const items = contents(m, code);
  switch (loc.kind) {
    case 'qa':
      return items.length === 0;
    case 'quarantine':
    case 'flow':
      return items.length < LANE_CAP;
    case 'drive-in': {
      if (items.length >= LANE_CAP) return false;
      const top = items.length > 0 ? parsePallet(items[items.length - 1]) : null;
      if (top && (top.product !== p.product || top.lot < p.lot)) {
        throw new Fault(
          `${describe(p)} was set down in front of ${describe(top)} in ${here}, which only opens ` +
            `from the front: the older pallet is buried`,
        );
      }
      return true;
    }
    case 'room': {
      const r = roomIndex(code);
      if (!doorOpen(m, code) || bool(m, `r${r}Run`) || items.length >= LANE_CAP) return false;
      if (p.ripe === 'n') throw new Fault(`${describe(p)} does not ripen and went into ${here}`);
      const other = items.map(parsePallet).find((q) => q.product !== p.product);
      if (other) {
        throw new Fault(`${describe(p)} went into ${here} with ${describe(other)}: one product per batch`);
      }
      return true;
    }
    case 'wrap-in':
      return str(m, 'w0') === '';
    case 'dock-out': {
      const truck = str(m, `t${code}`);
      if (truck !== 'open' && truck !== 'docked') return false;
      if (builtLocations(m).has(50)) {
        const door = code === 61 ? 1 : 2;
        if (p.label === 0) throw new Fault(`${describe(p)} reached ${here} without a label`);
        if (p.label !== door) {
          throw new Fault(`${describe(p)} is labeled for OUT${p.label} and was loaded at ${here}`);
        }
      }
      if (bool(m, 'asn') && asn !== palletCode(p)) {
        throw new Fault(
          `the shipping notice for ${here} said ${asn}, and the pallet loaded was ${palletCode(p)} (${describe(p)})`,
        );
      }
      if (truck === 'docked') {
        const order = truckOrder(m, code);
        const loaded = num(m, `k${code}`);
        if (loaded >= order.length) return false;
        const want = order[order.length - 1 - loaded];
        if (want !== p.product) {
          throw new Fault(
            `${here}'s trailer is loaded last stop first, so it wanted ${DC_PRODUCTS[want]} next and got ${describe(p)}`,
          );
        }
      }
      return true;
    }
    default:
      return false;
  }
}

function drop(m: MachineState, code: number, token: string): void {
  const loc = locationByCode(code)!;
  const items = contents(m, code);
  switch (loc.kind) {
    case 'qa':
      m.qaT = 0;
      setContents(m, code, [token]);
      return;
    case 'quarantine':
      m.quarantined = num(m, 'quarantined') + 1;
      setContents(m, code, [...items, token]);
      return;
    case 'wrap-in':
      m.w0 = token;
      m.wt0 = 0;
      return;
    case 'dock-out': {
      m.shipped = num(m, 'shipped') + 1;
      if (str(m, `t${code}`) === 'docked') m[`k${code}`] = num(m, `k${code}`) + 1;
      // The scene draws the trailer; only what fits in one is worth keeping.
      setContents(m, code, [...items, token].slice(-LANE_CAP));
      return;
    }
    case 'room': {
      const r = roomIndex(code);
      m[`r${r}Done`] = false;
      setContents(m, code, [...items, token]);
      return;
    }
    default:
      setContents(m, code, [...items, token]);
  }
}

/**
 * Can a pallet be lifted here now? The token if so, `null` to wait; a mistake
 * throws. `to` is where the job is taking it, because first-expired-first-out
 * is a rule about what *leaves*.
 */
function canPick(m: MachineState, code: number, to: number): string | null {
  const loc = locationByCode(code)!;
  const items = contents(m, code);
  const here = loc.name;
  switch (loc.kind) {
    case 'dock-in':
      if (items.length === 0) throw new Fault(`a vehicle was sent to pick at ${here}, and nothing was there`);
      return items[0];
    case 'qa': {
      if (items.length === 0) throw new Fault('a vehicle was sent to pick at QA, and nothing was there');
      const p = parsePallet(items[0]);
      return p.qa === 'P' || p.qa === 'F' ? null : items[0];
    }
    case 'room': {
      if (items.length === 0) throw new Fault(`a vehicle was sent to pick at ${here}, and it was empty`);
      const r = roomIndex(code);
      if (!doorOpen(m, code) || bool(m, `r${r}Run`)) return null;
      const top = items[items.length - 1];
      if (parsePallet(top).ripe === 'g') {
        throw new Fault(`${describe(parsePallet(top))} came out of ${here} green, before its cycle ran`);
      }
      return top;
    }
    case 'flow':
    case 'drive-in': {
      if (items.length === 0) throw new Fault(`a vehicle was sent to pick at ${here}, and it was empty`);
      const token = loc.kind === 'flow' ? items[0] : items[items.length - 1];
      const destKind = locationByCode(to)?.kind;
      if (destKind === 'dock-out' || destKind === 'wrap-in') {
        const p = parsePallet(token);
        const older = stored(m).find((s) => s.pallet.product === p.product && s.pallet.lot < p.lot);
        if (older) {
          throw new Fault(
            `${describe(p)} left storage while ${describe(older.pallet)} was still in ` +
              `${locationByCode(older.code)!.name}: the oldest lot ships first`,
          );
        }
      }
      return token;
    }
    case 'wrap-out': {
      const t = str(m, 'w5');
      if (t === '') throw new Fault('a vehicle was sent to the wrapper outfeed, and nothing was there');
      return t;
    }
    default:
      return null;
  }
}

function lift(m: MachineState, code: number): void {
  const loc = locationByCode(code)!;
  const items = contents(m, code);
  switch (loc.kind) {
    case 'room':
    case 'drive-in':
      setContents(m, code, items.slice(0, -1));
      if (loc.kind === 'room' && items.length === 1) m[`r${roomIndex(code)}Done`] = false;
      return;
    case 'wrap-out':
      m.w5 = '';
      m.wt5 = 0;
      return;
    default:
      setContents(m, code, items.slice(1));
  }
}

// --- The fleet ---------------------------------------------------------------------------------

function onLoop(m: MachineState, i: number): boolean {
  return str(m, v(i, 'S')) === 'drive';
}

/** Is this pocket taken by a vehicle other than `self`? */
function pocketBusy(m: MachineState, s: number, self: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === self) continue;
    if (POCKET_STATES.has(str(m, v(j, 'S')) as VehicleState) && num(m, v(j, 'Pk')) === s) return true;
  }
  return false;
}

/** Distance to the nearest vehicle ahead on the loop, or Infinity. */
function gapAhead(m: MachineState, i: number): number {
  let best = Infinity;
  const pos = num(m, v(i, 'Pos'));
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === i || !onLoop(m, j)) continue;
    const d = ahead(pos, num(m, v(j, 'Pos')));
    if (d > 0 && d < best) best = d;
  }
  return best;
}

/** Can a vehicle leaving the pocket at `s` rejoin the loop without touching anybody? */
function mergeClear(m: MachineState, s: number, i: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === i || !onLoop(m, j)) continue;
    const pos = num(m, v(j, 'Pos'));
    if (ahead(s, pos) < VEHICLE_MM || ahead(pos, s) < VEHICLE_MM) return false;
  }
  return true;
}

/** Is another vehicle on its way to this pocket? */
function wanted(m: MachineState, pk: number, self: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j !== self && onLoop(m, j) && stopFor(m, j) === pk) return true;
  }
  return false;
}

function idle(m: MachineState, i: number): boolean {
  const s = str(m, v(i, 'S')) as VehicleState;
  const leg = str(m, v(i, 'Leg')) as Leg;
  return s === 'park' || ((s === 'drive' || s === 'exit') && leg === 'home');
}

/** Where a vehicle is, for "nearest": its pocket if it is in one, else its place on the loop. */
function whereOnLoop(m: MachineState, i: number): number {
  return onLoop(m, i) ? num(m, v(i, 'Pos')) : num(m, v(i, 'Pk'));
}

function freeVehicles(m: MachineState): number {
  let n = 0;
  for (let i = 0; i < fleetSize(m); i++) if (idle(m, i)) n++;
  return n;
}

function isPickable(m: MachineState, code: number): boolean {
  return builtLocations(m).has(code) && (locationByCode(code)?.pick ?? -1) >= 0;
}

function isDroppable(m: MachineState, code: number): boolean {
  return builtLocations(m).has(code) && (locationByCode(code)?.drop ?? -1) >= 0 && code !== 70;
}

/**
 * The mailbox. Four-phase: the program raises REQ with the order in D0/D1; the
 * manager answers ACK (taken) or NAK (malformed) and holds it until REQ drops.
 * A well-formed order with no vehicle free is simply not answered yet.
 */
function mailbox(m: MachineState, outputs: Record<string, boolean>, regs: Record<string, number>): void {
  const req = outputs[DC_OUT.request] === true;
  if (!req) {
    m.ack = false;
    m.nak = false;
    return;
  }
  if (bool(m, 'ack') || bool(m, 'nak')) return;

  const from = regs[DC_CMD.from] ?? 0;
  const to = regs[DC_CMD.to] ?? 0;
  const fleet = fleetSize(m);

  if (from === 0 && to === 70 && builtLocations(m).has(70)) {
    let pick = -1;
    for (let i = 0; i < fleet; i++) {
      if (!idle(m, i)) continue;
      if (pick < 0 || num(m, v(i, 'Batt')) < num(m, v(pick, 'Batt'))) pick = i;
    }
    if (pick < 0) return;
    assign(m, pick, 'chg', 0, 70, -1);
    m.ack = true;
    return;
  }

  if (from === to || !isPickable(m, from) || !isDroppable(m, to)) {
    m.nak = true;
    return;
  }
  const stop = locationByCode(from)!.pick;
  let pick = -1;
  let best = Infinity;
  for (let i = 0; i < fleet; i++) {
    if (!idle(m, i)) continue;
    const d = ahead(whereOnLoop(m, i), stop);
    if (d < best) {
      best = d;
      pick = i;
    }
  }
  if (pick < 0) return;
  const asn = bool(m, 'asn') && locationByCode(to)?.kind === 'dock-out' ? (regs[DC_CMD.asnCode] ?? 0) : -1;
  // A dock that calls is answered by the order that claims its call: the call is
  // taken the moment a vehicle is assigned to it, so several can be on their way,
  // and the shipping notice says whether what was promised is what it asked for.
  if (bool(m, `callOn${to}`)) {
    const call = num(m, `call${to}`);
    if (call === 0) return;
    if (Math.trunc(asn / 100) !== call) {
      throw new Fault(
        `${locationByCode(to)!.name} was calling for ${DC_PRODUCTS[call]} and was promised ${asn} instead`,
      );
    }
    m[`call${to}`] = 0;
    m[`call${to}T`] = CALL_GAP_MS;
  }
  assign(m, pick, 'src', from, to, asn);
  m.ack = true;
}

function assign(m: MachineState, i: number, leg: Leg, from: number, to: number, asn: number): void {
  m[v(i, 'Leg')] = leg;
  m[v(i, 'From')] = from;
  m[v(i, 'To')] = to;
  m[v(i, 'Asn')] = asn;
  if (str(m, v(i, 'S')) === 'park') {
    m[v(i, 'S')] = 'exit';
    m[v(i, 'T')] = 0;
  }
}

function drain(m: MachineState, i: number, mm: number): void {
  if (!bool(m, 'battery')) return;
  let acc = num(m, v(i, 'Bmm')) + mm;
  let batt = num(m, v(i, 'Batt'));
  while (acc >= BATTERY_MM_PER_UNIT && batt > 0) {
    acc -= BATTERY_MM_PER_UNIT;
    batt -= 1;
  }
  m[v(i, 'Bmm')] = acc;
  m[v(i, 'Batt')] = batt;
  if (batt <= 0) throw new Fault(`vehicle ${i + 1} ran its battery flat on the loop`, { cause: 'flat' });
}

function stepVehicle(m: MachineState, i: number): void {
  const state = str(m, v(i, 'S')) as VehicleState;
  const leg = str(m, v(i, 'Leg')) as Leg;
  const t = num(m, v(i, 'T')) + SUB_MS;

  switch (state) {
    case 'off':
      return;

    // Park at last position, the policy real fleet managers default to: an idle
    // vehicle stays in the pocket it last worked in until another vehicle heads
    // for that pocket, and only then goes home. On a one-way loop the difference
    // is a whole lap every time a program collects a pallet it has just set down
    // for a check.
    case 'park': {
      const pk = num(m, v(i, 'Pk'));
      if (pk === DEPOT_STOPS[i] || !wanted(m, pk, i)) return;
      m[v(i, 'Leg')] = 'home';
      m[v(i, 'S')] = 'exit';
      m[v(i, 'T')] = 0;
      return;
    }

    case 'drive': {
      const stop = stopFor(m, i);
      const pos = num(m, v(i, 'Pos'));
      const busy = pocketBusy(m, stop, i);
      const toStop = ahead(pos, stop);
      // Waiting for a busy pocket happens a full gap short of it, so whoever is
      // in it can still get out; a vehicle already past that point just stops.
      let target = busy ? stop - WAIT_BACK_MM : stop;
      if (busy && toStop <= WAIT_BACK_MM) target = pos;
      const d = ahead(pos, target);
      if (d === 0) {
        if (!busy && toStop === 0) {
          m[v(i, 'S')] = 'enter';
          m[v(i, 'Pk')] = stop;
          m[v(i, 'T')] = 0;
          m[v(i, 'Wait')] = 0;
          return;
        }
        waitFor(m, i, 'queued on the loop');
        return;
      }
      const room = gapAhead(m, i) - MIN_GAP_MM;
      const stepMm = Math.max(0, Math.min(SPEED_MM, d, room));
      if (stepMm === 0) {
        waitFor(m, i, 'queued on the loop');
        return;
      }
      m[v(i, 'Pos')] = (pos + stepMm) % LOOP_MM;
      m[v(i, 'Wait')] = 0;
      drain(m, i, stepMm);
      return;
    }

    case 'enter':
      if (t < ENTER_MS) {
        m[v(i, 'T')] = t;
        return;
      }
      m[v(i, 'T')] = 0;
      m[v(i, 'S')] = leg === 'home' ? 'park' : leg === 'chg' ? 'charge' : 'hold';
      if (leg === 'home') m[v(i, 'Leg')] = '';
      return;

    case 'hold': {
      const ready =
        leg === 'src'
          ? canPick(m, num(m, v(i, 'From')), num(m, v(i, 'To'))) !== null
          : canDrop(m, num(m, v(i, 'To')), str(m, v(i, 'Load')), num(m, v(i, 'Asn')));
      if (!ready) {
        waitFor(m, i, leg === 'src' ? 'waiting to pick' : 'waiting to set down');
        return;
      }
      m[v(i, 'S')] = 'work';
      m[v(i, 'T')] = 0;
      m[v(i, 'Wait')] = 0;
      return;
    }

    case 'work': {
      if (t < FORK_MS) {
        m[v(i, 'T')] = t;
        return;
      }
      if (leg === 'src') {
        const from = num(m, v(i, 'From'));
        const token = canPick(m, from, num(m, v(i, 'To')));
        if (token === null) {
          m[v(i, 'S')] = 'hold';
          m[v(i, 'T')] = 0;
          return;
        }
        lift(m, from);
        m[v(i, 'Load')] = token;
        m[v(i, 'Leg')] = 'dst';
      } else {
        const to = num(m, v(i, 'To'));
        const token = str(m, v(i, 'Load'));
        if (!canDrop(m, to, token, num(m, v(i, 'Asn')))) {
          m[v(i, 'S')] = 'hold';
          m[v(i, 'T')] = 0;
          return;
        }
        drop(m, to, token);
        m[v(i, 'Load')] = '';
        m[v(i, 'Leg')] = '';
        m[v(i, 'From')] = 0;
        m[v(i, 'To')] = 0;
        m[v(i, 'Asn')] = -1;
        // Idle, where it stands (see `park`), except in a ripening room's
        // doorway, which it would be holding open for the door to close on.
        if (locationByCode(to)?.kind !== 'room') {
          m[v(i, 'S')] = 'park';
          m[v(i, 'T')] = 0;
          return;
        }
        m[v(i, 'Leg')] = 'home';
      }
      m[v(i, 'S')] = 'exit';
      m[v(i, 'T')] = 0;
      return;
    }

    case 'exit': {
      if (t < EXIT_MS) {
        m[v(i, 'T')] = t;
        return;
      }
      m[v(i, 'T')] = EXIT_MS;
      const pk = num(m, v(i, 'Pk'));
      // A vehicle already in the pocket its next job starts from never leaves it.
      if (stopFor(m, i) === pk && leg !== '') {
        m[v(i, 'S')] = leg === 'home' ? 'park' : leg === 'chg' ? 'charge' : 'hold';
        m[v(i, 'T')] = 0;
        if (leg === 'home') m[v(i, 'Leg')] = '';
        return;
      }
      if (!mergeClear(m, pk, i)) return;
      m[v(i, 'S')] = 'drive';
      m[v(i, 'Pos')] = pk;
      m[v(i, 'Pk')] = -1;
      m[v(i, 'T')] = 0;
      return;
    }

    case 'charge': {
      let acc = t;
      let batt = num(m, v(i, 'Batt'));
      while (acc >= CHARGE_MS_PER_UNIT && batt < BATTERY_FULL) {
        acc -= CHARGE_MS_PER_UNIT;
        batt += 1;
      }
      m[v(i, 'Batt')] = batt;
      m[v(i, 'T')] = acc;
      if (batt >= BATTERY_FULL) {
        m[v(i, 'Leg')] = '';
        m[v(i, 'S')] = 'park';
        m[v(i, 'T')] = 0;
      }
    }
  }
}

function waitFor(m: MachineState, i: number, what: string): void {
  const w = num(m, v(i, 'Wait')) + SUB_MS;
  m[v(i, 'Wait')] = w;
  if (w >= STALL_MS) {
    const leg = str(m, v(i, 'Leg'));
    const where =
      leg === 'src'
        ? locationByCode(num(m, v(i, 'From')))?.name
        : leg === 'dst'
          ? locationByCode(num(m, v(i, 'To')))?.name
          : 'its parking bay';
    throw new Fault(`vehicle ${i + 1} has been ${what} at ${where} for ${STALL_MS / 1000} s`, {
      cause: 'stalled',
    });
  }
}

// --- The rest of the plant ----------------------------------------------------------------------

function stepInbound(m: MachineState): void {
  for (const dock of [1, 2]) {
    const schedule = split(str(m, `in${dock}`));
    if (schedule.length === 0) continue;
    const timer = num(m, `a${dock}T`) - SUB_MS;
    if (timer > 0) {
      m[`a${dock}T`] = timer;
      continue;
    }
    m[`a${dock}T`] = 0;
    const items = contents(m, dock);
    if (items.length >= DOCK_CAP) {
      const wait = num(m, `a${dock}Wait`) + SUB_MS;
      m[`a${dock}Wait`] = wait;
      if (wait >= BLOCK_MS) {
        throw new Fault(`IN${dock} stayed full for ${BLOCK_MS / 1000} s and the truck could not unload`, {
          cause: 'blocked',
        });
      }
      continue;
    }
    const [next, ...rest] = schedule;
    const p = parsePallet(`${next}n0`);
    if (RIPENING_PRODUCTS.has(p.product) && builtLocations(m).has(21)) p.ripe = 'g';
    setContents(m, dock, [...items, formatPallet(p)]);
    m[`in${dock}`] = join(rest);
    m[`a${dock}T`] = num(m, `in${dock}Every`, num(m, 'inEvery'));
    m[`a${dock}Wait`] = 0;
    m.received = num(m, 'received') + 1;
  }
}

function stepQa(m: MachineState): void {
  const items = contents(m, 10);
  if (items.length === 0) return;
  const p = parsePallet(items[0]);
  if (p.qa !== 'P' && p.qa !== 'F') return;
  const t = num(m, 'qaT') + SUB_MS;
  m.qaT = t;
  if (t < QA_MS) return;
  p.qa = p.qa === 'P' ? 'p' : 'f';
  setContents(m, 10, [formatPallet(p)]);
}

function routeFor(m: MachineState, product: number): number {
  const table = str(m, 'routes')
    .split(',')
    .map((s) => Number.parseInt(s, 10));
  return table[product - 1] ?? 0;
}

/**
 * The stretch wrapper's conveyor. Six single-pallet zones; a pallet moves on
 * once it has been in its zone long enough and the next is clear, the wrap
 * zone holds it for the wrap and the labeler holds it until it has a label.
 */
function stepWrapper(m: MachineState): void {
  for (let k = 0; k <= 5; k++) {
    if (str(m, `w${k}`) !== '') m[`wt${k}`] = num(m, `wt${k}`) + SUB_MS;
  }
  for (let k = 4; k >= 0; k--) {
    const token = str(m, `w${k}`);
    if (token === '' || str(m, `w${k + 1}`) !== '') continue;
    const dwell = k === 3 ? WRAP_MS : ZONE_MS;
    if (num(m, `wt${k}`) < dwell) continue;
    if (k === 4 && parsePallet(token).label === 0) continue;
    m[`w${k + 1}`] = token;
    m[`wt${k + 1}`] = 0;
    m[`w${k}`] = '';
    m[`wt${k}`] = 0;
  }
}

function atLabeler(m: MachineState): boolean {
  const token = str(m, 'w4');
  return token !== '' && num(m, 'wt4') >= ZONE_MS && parsePallet(token).label === 0;
}

function printLabel(m: MachineState, door: number): void {
  if (!atLabeler(m)) return;
  const p = parsePallet(str(m, 'w4'));
  const want = routeFor(m, p.product);
  if (door !== 61 && door !== 62) {
    throw new Fault(`the labeler was asked to print for dock ${door}, which does not exist`);
  }
  if (door !== want) {
    throw new Fault(`${describe(p)} was labeled for ${door === 61 ? 'OUT1' : 'OUT2'}; it ships from ${want === 61 ? 'OUT1' : 'OUT2'}`);
  }
  p.label = door === 61 ? 1 : 2;
  m.w4 = formatPallet(p);
}

/** Is a vehicle anywhere in a room's pocket, going in, working or backing out? */
function inDoorway(m: MachineState, code: number): boolean {
  const stop = locationByCode(code)!.drop;
  for (let i = 0; i < MAX_FLEET; i++) {
    const s = str(m, v(i, 'S'));
    if (s !== 'park' && s !== 'drive' && s !== 'off' && num(m, v(i, 'Pk')) === stop) return true;
  }
  return false;
}

function stepRooms(m: MachineState, outputs: Record<string, boolean>): void {
  for (const r of [1, 2] as const) {
    const code = r === 1 ? 21 : 22;
    const cmd = outputs[r === 1 ? DC_OUT.door1 : DC_OUT.door2] === true;
    const door = num(m, `r${r}Door`);
    const next = cmd ? Math.min(DOOR_MS, door + SUB_MS) : Math.max(0, door - SUB_MS);
    if (next < door && inDoorway(m, code)) {
      throw new Fault(`R${r}'s door was closed on a vehicle in its doorway`);
    }
    m[`r${r}Door`] = next;
    if (bool(m, `r${r}Run`)) {
      if (next > 0) {
        throw new Fault(`R${r}'s door opened in the middle of its ripening cycle and the batch spoiled`, {
          cause: 'spoiled',
        });
      }
      const t = num(m, `r${r}T`) + SUB_MS;
      m[`r${r}T`] = t;
      if (t >= RIPEN_MS) {
        setContents(
          m,
          code,
          contents(m, code).map((tok) => formatPallet({ ...parsePallet(tok), ripe: 'r' })),
        );
        m[`r${r}Run`] = false;
        m[`r${r}Done`] = true;
      }
    }
  }
}

function startRooms(m: MachineState, outputs: Record<string, boolean>): void {
  for (const r of [1, 2] as const) {
    const code = r === 1 ? 21 : 22;
    const on = outputs[r === 1 ? DC_OUT.start1 : DC_OUT.start2] === true;
    const was = bool(m, `r${r}Prev`);
    m[`r${r}Prev`] = on;
    if (!on || was || bool(m, `r${r}Run`) || contents(m, code).length === 0) continue;
    if (num(m, `r${r}Door`) > 0) throw new Fault(`R${r} was started with its door open`);
    m[`r${r}Run`] = true;
    m[`r${r}T`] = 0;
    m[`r${r}Done`] = false;
  }
}

/**
 * Outbound trucks, where a puzzle has them. Each dock has a list of trucks, each
 * an order of products in the sequence it will *drop* them; the trailer fills
 * from the front, so it has to be loaded in reverse. The order reaches the
 * program one line at a time, through the line feed, as the truck docks.
 */
function stepTrucks(m: MachineState): void {
  for (const d of [61, 62]) {
    const state = str(m, `t${d}`);
    if (state === 'open' || state === 'none') continue;
    const t = num(m, `t${d}T`) - SUB_MS;
    if (state === 'away') {
      if (t > 0) {
        m[`t${d}T`] = t;
        continue;
      }
      const queue = split(str(m, `trucks${d}`).replaceAll(';', ','));
      if (queue.length === 0) {
        m[`t${d}`] = 'done';
        continue;
      }
      const [order, ...rest] = queue;
      m[`trucks${d}`] = rest.join(';');
      m[`o${d}`] = order;
      m[`k${d}`] = 0;
      m[`t${d}`] = 'docked';
      m[`t${d}T`] = TRUCK_MS;
      setContents(m, d, []);
      const lines = order.split('').map((c) => `${d}${c}`);
      m.feed = join([...split(str(m, 'feed')), ...lines]);
      continue;
    }
    if (state === 'docked') {
      const order = truckOrder(m, d);
      if (num(m, `k${d}`) >= order.length) {
        m[`t${d}`] = 'away';
        m[`t${d}T`] = TRUCK_GAP_MS;
        continue;
      }
      if (t <= 0) {
        throw new Fault(`the truck at ${d === 61 ? 'OUT1' : 'OUT2'} missed its slot half loaded`, { cause: 'late' });
      }
      m[`t${d}T`] = t;
    }
  }
}

/** Outbound calls: the next product on a dock's list, once the gap after the last has passed. */
function stepCalls(m: MachineState): void {
  for (const d of [61, 62]) {
    if (!bool(m, `callOn${d}`) || num(m, `call${d}`) !== 0) continue;
    const queue = split(str(m, `calls${d}`));
    if (queue.length === 0) continue;
    const t = num(m, `call${d}T`) - SUB_MS;
    if (t > 0) {
      m[`call${d}T`] = t;
      continue;
    }
    m[`call${d}`] = Number.parseInt(queue[0], 10);
    m[`calls${d}`] = join(queue.slice(1));
    m[`call${d}T`] = 0;
  }
}

function stepLineFeed(m: MachineState, outputs: Record<string, boolean>): void {
  const on = outputs[DC_OUT.lineAck] === true;
  const was = bool(m, 'prevLineAck');
  m.prevLineAck = on;
  if (on && !was) m.feed = join(split(str(m, 'feed')).slice(1));
}

// --- Sensors -------------------------------------------------------------------------------------

function sensors(m: MachineState, declared: ReadonlySet<string>): {
  bits: Record<string, boolean>;
  regs: Record<string, number>;
} {
  const bits: Record<string, boolean> = {};
  const regs: Record<string, number> = {};
  const qa = contents(m, 10);
  const qaPallet = qa.length > 0 ? parsePallet(qa[0]) : null;
  const qaDone = qaPallet !== null && (qaPallet.qa === 'p' || qaPallet.qa === 'f');
  const line = split(str(m, 'feed'))[0] ?? '';

  const allBits: Record<string, boolean> = {
    [DC_IN.ack]: bool(m, 'ack'),
    [DC_IN.nak]: bool(m, 'nak'),
    [DC_IN.vehicleFree]: freeVehicles(m) > 0,
    [DC_IN.in1]: contents(m, 1).length > 0,
    [DC_IN.in2]: contents(m, 2).length > 0,
    [DC_IN.qaBusy]: qaPallet !== null,
    [DC_IN.qaDone]: qaDone,
    [DC_IN.qaPass]: qaDone && qaPallet?.qa === 'p',
    [DC_IN.infeedClear]: str(m, 'w0') === '',
    [DC_IN.atLabeler]: atLabeler(m),
    [DC_IN.outfeedReady]: str(m, 'w5') !== '',
    [DC_IN.truck1]: str(m, 't61') === 'docked' || str(m, 't61') === 'open',
    [DC_IN.truck2]: str(m, 't62') === 'docked' || str(m, 't62') === 'open',
    [DC_IN.door1Open]: num(m, 'r1Door') >= DOOR_MS,
    [DC_IN.door2Open]: num(m, 'r2Door') >= DOOR_MS,
    [DC_IN.ripe1]: bool(m, 'r1Done') && contents(m, 21).length > 0,
    [DC_IN.ripe2]: bool(m, 'r2Done') && contents(m, 22).length > 0,
    [DC_IN.lineReady]: line !== '',
    [DC_IN.door1Shut]: num(m, 'r1Door') === 0,
    [DC_IN.door2Shut]: num(m, 'r2Door') === 0,
    [DC_IN.doorway1Clear]: !inDoorway(m, 21),
    [DC_IN.doorway2Clear]: !inDoorway(m, 22),
  };
  const allRegs: Record<string, number> = {
    [DC_REG.qaCode]: qaDone && qaPallet ? palletCode(qaPallet) : 0,
    [DC_REG.freeVehicles]: freeVehicles(m),
    [DC_REG.lineDock]: line === '' ? 0 : Number.parseInt(line.slice(0, 2), 10),
    [DC_REG.lineProduct]: line === '' ? 0 : Number.parseInt(line.slice(2), 10),
    [DC_REG.quarantine]: contents(m, 11).length,
    [DC_REG.call1]: num(m, 'call61'),
    [DC_REG.call2]: num(m, 'call62'),
  };
  for (const code of [21, 22, 31, 32, 33, 41, 42, 43]) allRegs[DC_REG.count(code)] = contents(m, code).length;
  for (const code of [61, 62]) allRegs[DC_REG.count(code)] = num(m, `k${code}`);
  for (let i = 0; i < MAX_FLEET; i++) allRegs[DC_REG.battery(i + 1)] = Math.trunc(num(m, v(i, 'Batt')) / 10);
  for (let p = 1; p <= 4; p++) allRegs[DC_REG.route(p)] = routeFor(m, p);

  // Only what the puzzle wired: a register the program is using as scratch
  // must not be overwritten by a transmitter this puzzle never installed.
  for (const [k, val] of Object.entries(allBits)) if (declared.has(k)) bits[k] = val;
  for (const [k, val] of Object.entries(allRegs)) if (declared.has(k)) regs[k] = val;
  return { bits, regs };
}

/**
 * The stocktake download: seeded lanes published once, in the FX table layout
 * (pointer, then one pallet code per entry, oldest first), at the heads the
 * puzzle names in `stocktake` (`"D200:31,D210:32"`). Written on the priming step
 * only, so from the first scan the tables are the program's.
 *
 * Code 50 means the wrapper line: every pallet on it still waiting for a label,
 * the one nearest the labeler first, which is the order they will reach it.
 */
function stocktake(m: MachineState): Record<string, number> {
  const regs: Record<string, number> = {};
  for (const entry of split(str(m, 'stocktake'))) {
    const [head, codeText] = entry.split(':');
    const h = Number.parseInt(head.slice(1), 10);
    const code = Number.parseInt(codeText, 10);
    const tokens =
      code === 50
        ? [4, 3, 2, 1, 0].map((k) => str(m, `w${k}`)).filter((t) => t !== '' && parsePallet(t).label === 0)
        : contents(m, code);
    const items = tokens.map(parsePallet);
    // A drive-in lane is a stack: its table runs bottom to top, the way POP reads it.
    regs[`D${h}`] = items.length;
    items.forEach((p, k) => {
      regs[`D${h + 1 + k}`] = palletCode(p);
    });
  }
  return regs;
}

function step(ctx: ProcessStepCtx): ProcessResult {
  const m: MachineState = { ...ctx.machine };
  settle(m);
  const declared = new Set(ctx.devices.map((d) => d.address));

  if (ctx.dtMs === 0) {
    const { bits, regs } = sensors(m, declared);
    return { machine: m, derivedInputs: bits, derivedRegisters: { ...regs, ...stocktake(m) } };
  }

  if (!bool(m, 'jam')) {
    try {
      startRooms(m, ctx.outputs);
      stepLineFeed(m, ctx.outputs);
      if (ctx.outputs[DC_OUT.print] === true && !bool(m, 'prevPrint')) {
        printLabel(m, ctx.registers[DC_CMD.labelDoor] ?? 0);
      }
      m.prevPrint = ctx.outputs[DC_OUT.print] === true;

      const total = num(m, 'rem') + ctx.dtMs;
      const subs = Math.floor(total / SUB_MS);
      m.rem = total - subs * SUB_MS;
      const fleet = fleetSize(m);
      for (let k = 0; k < subs; k++) {
        m.tMs = num(m, 'tMs') + SUB_MS;
        // Every sub-step, not every step: an order waiting on a busy fleet is
        // taken the moment a vehicle frees up, which must not depend on dt.
        mailbox(m, ctx.outputs, ctx.registers);
        stepInbound(m);
        stepQa(m);
        stepWrapper(m);
        stepRooms(m, ctx.outputs);
        stepTrucks(m);
        stepCalls(m);
        for (let i = 0; i < fleet; i++) stepVehicle(m, i);
      }
    } catch (err) {
      if (!(err instanceof Fault)) throw err;
      m.jam = true;
      m.jamReason = err.message;
      const cause = err.cause;
      if (cause === 'stalled' || cause === 'blocked' || cause === 'late' || cause === 'flat') m[cause] = true;
    }
  }

  const { bits, regs } = sensors(m, declared);
  return { machine: m, derivedInputs: bits, derivedRegisters: regs };
}

export const distribution: ProcessModel = {
  id: 'distribution',
  init: (_devices: PuzzleDevice[]) => init(),
  step,
};
