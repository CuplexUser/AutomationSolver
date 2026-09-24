import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';
import {
  BAY,
  DC_EDGES,
  ENTER_FAR_MS,
  ENTER_MS,
  EXIT_FAR_MS,
  EXIT_NEAR_MS,
  VMAX_MM_S,
  bayPos,
  bayRoute,
  bayToBay,
  farLane,
  nearLane,
  route,
  routeToBay,
} from './dcRoads.js';

/**
 * Cold Chain Hub: a food distribution center run by a fleet of automated
 * forklifts.
 *
 * Every plant before this one is driven. This one is *dispatched*: the program
 * never turns a wheel. It posts transport orders ("from here, to there") to a
 * fleet manager, the way a real PLC talks to a real AGV system, and the manager
 * picks a vehicle, routes it across the floor, keeps it out of the way of the
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
 * A grid of two-lane aisles, one lane each way, with a cross aisle down the
 * middle (`dcRoads.ts` holds the plan and the routing). Every place a pallet can
 * stand is a **location** with a code (the mailbox's language) and one or two
 * **bays** off an aisle. A vehicle takes the fastest route there, stops level
 * with the bay, pivots and reverses in fork first, so a working vehicle stands
 * off the road and never blocks traffic; it leaves in whichever direction its
 * next trip is shorter. Only one vehicle fits a bay, and the next one waits in
 * its lane a full vehicle short of it so the occupant can still get out. The
 * flow lanes span the block between the north and south aisles, loaded from one
 * and picked from the other, which is what makes them first-in first-out.
 *
 * Traffic is kept the way a real fleet manager keeps it: vehicles follow at a
 * safe gap and brake for what is ahead, slow for turns, take a junction one at a
 * time and only when they can clear it, and book the bay a trip ends at before
 * they turn into its lane. None of that can gridlock a correct program.
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

/** Top speed empty and laden, mm/s, in the compressed time every plant here runs on. */
export const VMAX_LADEN_MM_S = 2500;
/** Acceleration, per sub-step: 2.5 m/s². Braking is harder, 3 m/s². */
export const ACCEL_MM_S_STEP = 25;
export const DECEL_MM_S2 = 3000;
/** The slowest a vehicle closes the last few millimeters on a stop. */
export const VCREEP_MM_S = 300;
/**
 * A vehicle's footprint along its lane, from the middle: body first, and the
 * forks and any pallet behind. It drives body first and reverses into a bay.
 */
export const VEHICLE_FRONT_MM = 1100;
export const VEHICLE_REAR_MM = 1100;
/** Clear floor a vehicle keeps between its front and anything ahead. */
export const GAP_MM = 400;
/** The stretch of lane either side of a bay's axis a vehicle holds while it pivots there. */
export const ZONE_MM = 1100;
/** Where a vehicle waits for a busy bay: this far short of it, so whoever is in it can still get out. */
export const WAIT_BACK_MM = VEHICLE_FRONT_MM + ZONE_MM + GAP_MM;
/** How far ahead a vehicle looks for traffic and junctions. */
const LOOKAHEAD_MM = 9000;

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
export const TRUCK_MS = 180_000;
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
export const BATTERY_MM_PER_UNIT = 1000;
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
  /** Bay a vehicle sets a pallet down from (`DC_BAYS`), or -1 when nothing is ever put here. */
  drop: number;
  /** Bay a vehicle lifts a pallet from, or -1 when nothing is ever taken from here. */
  pick: number;
}

/**
 * Every location the hub has. A puzzle builds only some of them (`locs` in its
 * `plantConfig`), but they always stand in the same place, so a distance learned
 * in one puzzle holds in the next. Where each bay is, and why, is `dcRoads.ts`.
 */
export const DC_LOCATIONS: readonly LocationDef[] = [
  { code: 1, name: 'IN1', kind: 'dock-in', drop: -1, pick: BAY.IN1 },
  { code: 2, name: 'IN2', kind: 'dock-in', drop: -1, pick: BAY.IN2 },
  { code: 10, name: 'QA', kind: 'qa', drop: BAY.QA, pick: BAY.QA },
  { code: 11, name: 'QUARANTINE', kind: 'quarantine', drop: BAY.QUARANTINE, pick: -1 },
  { code: 31, name: 'F1', kind: 'flow', drop: BAY['F1 load'], pick: BAY['F1 pick'] },
  { code: 32, name: 'F2', kind: 'flow', drop: BAY['F2 load'], pick: BAY['F2 pick'] },
  { code: 33, name: 'F3', kind: 'flow', drop: BAY['F3 load'], pick: BAY['F3 pick'] },
  { code: 21, name: 'R1', kind: 'room', drop: BAY.R1, pick: BAY.R1 },
  { code: 22, name: 'R2', kind: 'room', drop: BAY.R2, pick: BAY.R2 },
  { code: 50, name: 'WRAP IN', kind: 'wrap-in', drop: BAY['WRAP IN'], pick: -1 },
  { code: 51, name: 'WRAP OUT', kind: 'wrap-out', drop: -1, pick: BAY['WRAP OUT'] },
  { code: 41, name: 'L1', kind: 'drive-in', drop: BAY.L1, pick: BAY.L1 },
  { code: 42, name: 'L2', kind: 'drive-in', drop: BAY.L2, pick: BAY.L2 },
  { code: 43, name: 'L3', kind: 'drive-in', drop: BAY.L3, pick: BAY.L3 },
  { code: 70, name: 'CHARGER', kind: 'charger', drop: BAY.CHARGER, pick: -1 },
  { code: 61, name: 'OUT1', kind: 'dock-out', drop: BAY.OUT1, pick: -1 },
  { code: 62, name: 'OUT2', kind: 'dock-out', drop: BAY.OUT2, pick: -1 },
];

/**
 * The locations each section of the sectioned hub puzzles runs, keyed by the
 * section's POU id (content/dc-sections.ts), so the scene can frame a section by
 * the floor it owns. FLEET owns no location; it gets the vehicles' own corner,
 * the parking bays and the charger.
 */
export const DC_SECTIONS: Readonly<Record<string, readonly number[]>> = {
  RECEIVE: [1, 2, 10, 11],
  RIPEN: [21, 22],
  STORE: [31, 32, 33, 41, 42, 43],
  SHIP: [61, 62],
  FLEET: [70],
};

/** Each vehicle's own parking bay, beside the charger on the cross aisle. */
export const DEPOT_BAYS: readonly number[] = [BAY.P1, BAY.P2, BAY.P3];
/** Most vehicles a puzzle can have. */
export const MAX_FLEET = DEPOT_BAYS.length;

const LOCATION_BY_CODE = new Map(DC_LOCATIONS.map((l) => [l.code, l]));

export function locationByCode(code: number): LocationDef | undefined {
  return LOCATION_BY_CODE.get(code);
}

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
  /** A vehicle is charging, on its way to the charger, or will go once its job is done. */
  charging: 'X26',
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
  /** How many lines the order of the truck docked at OUT1 or OUT2 has, or 0 with no truck there. */
  lines1: 'D15',
  lines2: 'D16',
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

// State keys are built once and reused. The plant reads them several times a
// sub-step, and a key built afresh each time is a new string to hash on every
// lookup, which was a visible share of grading a three-vehicle plant.
const V_KEYS: Record<string, string>[] = [];
const C_KEYS: string[] = [];
const v = (i: number, key: string): string => ((V_KEYS[i] ??= {})[key] ??= `v${i}${key}`);
const contentsKey = (code: number): string => (C_KEYS[code] ??= `c${code}`);

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

/** In a bay: parked, pivoting in, working, backing out or on the charger. */
const BAY_STATES = new Set<VehicleState>(['park', 'enter', 'hold', 'work', 'exit', 'charge']);

function fleetSize(m: MachineState): number {
  return Math.max(1, Math.min(MAX_FLEET, num(m, 'fleet', 1)));
}

/** The bay vehicle `i`'s current trip ends at. */
function bayFor(m: MachineState, i: number): number {
  const leg = str(m, v(i, 'Leg')) as Leg;
  if (leg === 'src') return locationByCode(num(m, v(i, 'From')))?.pick ?? -1;
  if (leg === 'dst') return locationByCode(num(m, v(i, 'To')))?.drop ?? -1;
  if (leg === 'chg') return locationByCode(70)!.drop;
  return DEPOT_BAYS[i];
}

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
    m[v(i, 'Pk')] = DEPOT_BAYS[i];
    // On the road: an edge (-1 in a bay), the distance along it, speed in mm/s
    // and its sub-millimeter remainder, the route and where on it, the junction
    // it has claimed, the bay it has booked and the lane it is backing out onto.
    m[v(i, 'E')] = -1;
    m[v(i, 'Pos')] = 0;
    m[v(i, 'V')] = 0;
    m[v(i, 'Rem')] = 0;
    m[v(i, 'Rt')] = '';
    m[v(i, 'Ri')] = 0;
    m[v(i, 'Box')] = -1;
    m[v(i, 'Res')] = -1;
    m[v(i, 'Xe')] = -1;
    m[v(i, 'Xp')] = -1;
    m[v(i, 'Want')] = -1;
    m[v(i, 'WantT')] = 0;
    m[v(i, 'Xc')] = 0;
    m[v(i, 'T')] = 0;
    m[v(i, 'From')] = 0;
    m[v(i, 'To')] = 0;
    m[v(i, 'Load')] = '';
    m[v(i, 'Asn')] = -1;
    m[v(i, 'Batt')] = BATTERY_FULL;
    m[v(i, 'Bmm')] = 0;
    m[v(i, 'Wait')] = 0;
    m[v(i, 'ChgNext')] = false;
  }
  m.trucksOut = 0;
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
function stored(m: MachineState): { code: number; token: string; pallet: Pallet }[] {
  const out: { code: number; token: string; pallet: Pallet }[] = [];
  for (const loc of DC_LOCATIONS) {
    if (loc.kind !== 'flow' && loc.kind !== 'drive-in') continue;
    for (const t of contents(m, loc.code)) out.push({ code: loc.code, token: t, pallet: parsePallet(t) });
  }
  return out;
}

/**
 * Pallets already on their way out: for every vehicle sent to collect from a
 * lane for a dock or the wrapper, the pallet at that lane's out end, the next
 * one for a second vehicle, and so on. An older lot a vehicle is already
 * fetching is leaving first, whichever of the two vehicles gets there first, so
 * first-expired-first-out does not count it as left behind.
 */
function claimedForShipping(m: MachineState): Set<string> {
  const claims = new Map<number, number>();
  for (let j = 0; j < MAX_FLEET; j++) {
    if (str(m, v(j, 'Leg')) !== 'src') continue;
    const from = num(m, v(j, 'From'));
    const kind = locationByCode(from)?.kind;
    const dest = locationByCode(num(m, v(j, 'To')))?.kind;
    if ((kind === 'flow' || kind === 'drive-in') && (dest === 'dock-out' || dest === 'wrap-in')) {
      claims.set(from, (claims.get(from) ?? 0) + 1);
    }
  }
  const going = new Set<string>();
  for (const [code, n] of claims) {
    const items = contents(m, code);
    const outFirst = locationByCode(code)!.kind === 'flow' ? items : [...items].reverse();
    for (const t of outFirst.slice(0, n)) going.add(t);
  }
  return going;
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
 * holding it; a mistake throws. Checked when the vehicle is in the bay, which
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
        const going = claimedForShipping(m);
        const older = stored(m).find(
          (s) => s.pallet.product === p.product && s.pallet.lot < p.lot && !going.has(s.token),
        );
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

const ROUTES = new Map<string, number[]>();

/** A vehicle's route, which the state bag keeps as edge ids joined by dots, parsed once. */
function routeOf(m: MachineState, i: number): number[] {
  const key = str(m, v(i, 'Rt'));
  let r = ROUTES.get(key);
  if (!r) {
    r = key === '' ? [] : key.split('.').map((s) => Number.parseInt(s, 10));
    ROUTES.set(key, r);
  }
  return r;
}

const stateOf = (m: MachineState, j: number): VehicleState => str(m, v(j, 'S')) as VehicleState;

/**
 * What the rest of the fleet will cost a trip planned now, per edge, in
 * milliseconds: a vehicle stopped in a lane is a queue, one driving it is a
 * follow, one pivoting across it holds it for a moment, and the lanes still
 * ahead of it on its route are lanes it will be in. Routing on top of these
 * sends a second vehicle round the block rather than into the back of a queue.
 */
const QUEUED_MS = 4000;
const FOLLOW_MS = 600;
const PIVOT_BLOCK_MS = 1500;
const PLANNED_MS = 300;

function traffic(m: MachineState, self: number): number[] {
  const t: number[] = [];
  const add = (e: number, ms: number) => {
    t[e] = (t[e] ?? 0) + ms;
  };
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === self) continue;
    const s = stateOf(m, j);
    if (s === 'drive') {
      add(num(m, v(j, 'E')), num(m, v(j, 'V')) === 0 ? QUEUED_MS : FOLLOW_MS);
      const rt = routeOf(m, j);
      for (let k = num(m, v(j, 'Ri')) + 1; k < rt.length; k++) add(rt[k], PLANNED_MS);
    } else if (pivoting(m, j)) {
      const pk = num(m, v(j, 'Pk'));
      const on = s === 'enter' ? num(m, v(j, 'E')) : num(m, v(j, 'Xe'));
      add(on, PIVOT_BLOCK_MS);
      if (on !== nearLane(pk)) add(nearLane(pk), PIVOT_BLOCK_MS);
    }
  }
  return t;
}

/** Is a vehicle other than `self` in this bay: parked, pivoting in, working or not yet out? */
function bayOccupied(m: MachineState, bay: number, self: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j !== self && BAY_STATES.has(stateOf(m, j)) && num(m, v(j, 'Pk')) === bay) return true;
  }
  return false;
}

/** Has a vehicle other than `self` booked this bay for the end of its trip? */
function bookedByOther(m: MachineState, bay: number, self: number): number {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j !== self && stateOf(m, j) !== 'off' && num(m, v(j, 'Res')) === bay) return j;
  }
  return -1;
}

/**
 * May vehicle `i` book `bay` now? Not while somebody else has it, nor while a
 * vehicle waiting in a bay to pull out asked for it first: otherwise vehicles
 * arriving through the junctions could book it ahead of that one forever.
 * Asking records the request; booking, arriving or changing trip clears it.
 */
function mayBook(m: MachineState, i: number, bay: number): boolean {
  if (num(m, v(i, 'Want')) !== bay) {
    m[v(i, 'Want')] = bay;
    m[v(i, 'WantT')] = num(m, 'tMs');
  }
  if (bookedByOther(m, bay, i) >= 0) return false;
  const mine = num(m, v(i, 'WantT'));
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === i || num(m, v(j, 'Want')) !== bay || bayFor(m, j) !== bay) continue;
    // Only a vehicle waiting in a bay to pull out holds a place in line: on the
    // road, vehicles already queue in the order they stand in.
    if (stateOf(m, j) !== 'exit') continue;
    const theirs = num(m, v(j, 'WantT'));
    if (theirs < mine || (theirs === mine && j < i)) return false;
  }
  return true;
}

function book(m: MachineState, i: number, bay: number): void {
  m[v(i, 'Res')] = bay;
  m[v(i, 'Want')] = -1;
}

function junctionTaken(m: MachineState, junction: number, self: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j !== self && stateOf(m, j) !== 'off' && num(m, v(j, 'Box')) === junction) return true;
  }
  return false;
}

/** Braking distance from `vel` down to `to`, in millimeters (speeds in mm/s). */
const brake = (vel: number, to = 0): number => Math.floor((vel * vel - to * to) / (2 * DECEL_MM_S2));

/** The fastest a vehicle may go and still be down to `to` within `d` millimeters. */
const allowed = (d: number, to = 0): number => (d <= 0 ? Math.min(to, 0) : Math.floor(Math.sqrt(2 * DECEL_MM_S2 * d + to * to)));

/** Is vehicle `j` holding a stretch of lane while it pivots into or out of a bay? */
function pivoting(m: MachineState, j: number): boolean {
  const s = stateOf(m, j);
  return s === 'enter' || (s === 'exit' && num(m, v(j, 'T')) > 0);
}

/**
 * Where on `lane` a pivoting vehicle holds its stretch, or -1. Crossing the
 * aisle, in or out, holds both lanes, and a vehicle on its way to cross into a
 * bay holds the near lane's stretch from the moment it claims the crossing.
 */
function zoneOn(m: MachineState, j: number, lane: number): number {
  if (stateOf(m, j) === 'drive') {
    if (num(m, v(j, 'Xc')) !== 1) return -1;
    const bay = bayFor(m, j);
    return nearLane(bay) === lane ? bayPos(bay, lane) : -1;
  }
  if (!pivoting(m, j)) return -1;
  const pk = num(m, v(j, 'Pk'));
  // The lane it pivots on: where it came from, or where it is going.
  const on = stateOf(m, j) === 'enter' ? num(m, v(j, 'E')) : num(m, v(j, 'Xe'));
  if (on === lane || (on !== nearLane(pk) && nearLane(pk) === lane)) return bayPos(pk, lane);
  return -1;
}

/**
 * The nearest thing ahead on `edge` past `from` (a distance along it): the rear
 * of a vehicle driving it or the near end of a stretch a vehicle is pivoting on.
 * Infinity when the edge is clear.
 */
function firstObstacle(m: MachineState, self: number, edge: number, from: number): number {
  let best = Infinity;
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === self) continue;
    const s = stateOf(m, j);
    if (s === 'drive') {
      if (num(m, v(j, 'E')) === edge) {
        const p = num(m, v(j, 'Pos'));
        if (p > from) best = Math.min(best, p - VEHICLE_REAR_MM);
      }
      const at = zoneOn(m, j, edge);
      if (at >= 0 && at > from) best = Math.min(best, at - ZONE_MM);
    } else if (pivoting(m, j)) {
      const at = zoneOn(m, j, edge);
      if (at >= 0 && at > from) best = Math.min(best, at - ZONE_MM);
    }
  }
  return best;
}

/** Is vehicle `j` about to come onto `lane` through the junction at its start? */
function comingOnto(m: MachineState, j: number, lane: number): boolean {
  const rt = routeOf(m, j);
  const ri = num(m, v(j, 'Ri'));
  const here = DC_EDGES[rt[ri]];
  if (here.kind !== 'lane') return here.next[0] === lane;
  return num(m, v(j, 'Box')) >= 0 && rt[ri + 2] === lane;
}

/**
 * Can a vehicle pull out of `bay` onto `lane` now? The stretch it pivots on has
 * to be empty, and nothing coming along the lane may be too close to stop for
 * it. Pulling across the aisle needs the near lane clear as well.
 */
function clearToPullOut(m: MachineState, self: number, bay: number, lane: number): boolean {
  const near = nearLane(bay);
  if (!stretchClear(m, self, lane, bayPos(bay, lane))) return false;
  return lane === near || stretchClear(m, self, near, bayPos(bay, near));
}

function stretchClear(m: MachineState, self: number, lane: number, at: number): boolean {
  const lo = at - ZONE_MM - GAP_MM;
  const hi = at + ZONE_MM + GAP_MM;
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === self) continue;
    const s = stateOf(m, j);
    if (s === 'drive') {
      if (num(m, v(j, 'E')) === lane) {
        const p = num(m, v(j, 'Pos'));
        if (p - VEHICLE_REAR_MM < hi && p + VEHICLE_FRONT_MM > lo) return false;
        const vel = num(m, v(j, 'V'));
        if (p + VEHICLE_FRONT_MM <= lo && vel > 0 && brake(vel) + GAP_MM > lo - p - VEHICLE_FRONT_MM) return false;
        // Never in front of a vehicle on its way to a crossing it has claimed further on.
        if (p < at && num(m, v(j, 'Xc')) === 1 && bayPos(bayFor(m, j), lane) > lo) return false;
      } else if (lo < LANDING_MM + 2000 && comingOnto(m, j, lane)) {
        return false;
      }
      const z = zoneOn(m, j, lane);
      if (z >= 0 && z - ZONE_MM < hi && z + ZONE_MM > lo) return false;
    } else if (pivoting(m, j)) {
      const z = zoneOn(m, j, lane);
      if (z >= 0 && z - ZONE_MM < hi && z + ZONE_MM > lo) return false;
    }
  }
  return true;
}

/**
 * How long a vehicle waits to cross into a bay, or at least to pull out the
 * way it wants, before the manager sends it the long way round instead. Passing
 * traffic clears in a second or three; a wait this long is two vehicles each
 * waiting for the other.
 */
const DETOUR_MS = 6000;
/** Pulling out the other way is worth it straight away only if it costs no more than this. */
const ALT_EXIT_MS = 2000;
/** The longest a vehicle waits for its preferred way out, well inside `STALL_MS`. */
const MAX_PATIENCE_MS = 12_000;

/** Is the vehicle in `target` waiting to pull out for `pk`, where vehicle `i` is waiting to leave for `target`? */
function swapping(m: MachineState, i: number, pk: number, target: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === i || stateOf(m, j) !== 'exit' || num(m, v(j, 'Pk')) !== target) continue;
    if (bayFor(m, j) === pk) return true;
  }
  return false;
}

/** Room a vehicle needs past a junction to be wholly out of it, with its gap. */
const LANDING_MM = VEHICLE_REAR_MM + VEHICLE_FRONT_MM + GAP_MM;
/** How far short of a junction a vehicle asks for it, beyond its braking distance. */
const CLAIM_MM = 800;

/**
 * May vehicle `i` take the junction the connector `rt[k]` crosses? Only one
 * vehicle is in a junction at a time, and only a vehicle that can get wholly out
 * the other side: room on the lane beyond, and a place to stop past it. Into the
 * trip's last lane, it must also book the bay first.
 */
function canTakeJunction(m: MachineState, i: number, rt: number[], k: number, ds: number, limit: number, bay: number): boolean {
  const e = DC_EDGES[rt[k]];
  if (junctionTaken(m, e.junction, i)) return false;
  const beyond = rt[k + 1];
  if (firstObstacle(m, i, beyond, -1) < LANDING_MM) return false;
  if (k + 1 === rt.length - 1 && num(m, v(i, 'Res')) !== bay) {
    if (!mayBook(m, i, bay)) return false;
    book(m, i, bay);
  }
  return limit >= ds + e.len + VEHICLE_REAR_MM;
}

/**
 * May vehicle `i` claim the crossing into `bay` from the far lane? The near
 * lane's stretch has to be clear now, and the spot it will stop on must not be
 * inside a crossing somebody else has claimed: two vehicles each standing in
 * the other's way across the aisle is the one gridlock two-way aisles invite.
 */
function canClaimCrossing(m: MachineState, i: number, bay: number, lane: number, goal: number): boolean {
  if (!stretchClear(m, i, nearLane(bay), bayPos(bay, nearLane(bay)))) return false;
  // Nothing between it and the bay: a claim held behind somebody is a claim in their way.
  const onLane = num(m, v(i, 'E')) === lane;
  if (firstObstacle(m, i, lane, onLane ? num(m, v(i, 'Pos')) : -1) < goal + VEHICLE_FRONT_MM + GAP_MM) return false;
  const lo = goal - VEHICLE_REAR_MM - GAP_MM;
  const hi = goal + VEHICLE_FRONT_MM + GAP_MM;
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j === i || stateOf(m, j) === 'off') continue;
    const z = zoneOn(m, j, lane);
    if (z >= 0 && z - ZONE_MM < hi && z + ZONE_MM > lo) return false;
  }
  return true;
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
          : leg === 'chg'
            ? 'the charger'
            : 'its parking bay';
    throw new Fault(`vehicle ${i + 1} has been ${what} ${where} for ${STALL_MS / 1000} s`, {
      cause: 'stalled',
    });
  }
}

/**
 * One sub-step on the road: look ahead along the route for the stop, traffic,
 * junctions and turns, pick the speed that can still stop for all of them, and
 * drive. Speeds are integer mm/s and the fraction of a millimeter carries over,
 * so the trajectory is the same at any `dt`.
 */
function stepDrive(m: MachineState, i: number): void {
  const rt = routeOf(m, i);
  let ri = num(m, v(i, 'Ri'));
  let pos = num(m, v(i, 'Pos'));
  const vel = num(m, v(i, 'V'));
  const bay = bayFor(m, i);
  const last = rt.length - 1;
  const goal = bayPos(bay, rt[last]);
  const here = DC_EDGES[rt[ri]];

  // A junction is let go once the vehicle's rear is out of it.
  const box = num(m, v(i, 'Box'));
  if (box >= 0 && here.kind === 'lane' && here.from === box && pos >= VEHICLE_REAR_MM) m[v(i, 'Box')] = -1;

  let toGoal = goal - pos;
  for (let k = ri; k < last; k++) toGoal += DC_EDGES[rt[k]].len;
  const busy = bayOccupied(m, bay, i) || bookedByOther(m, bay, i) >= 0;
  let limit = busy ? Math.max(0, toGoal - (goal - waitPoint(m, i, rt[last], goal))) : toGoal;

  // Into a bay from the far lane: the crossing is claimed as early as it can
  // be, like a junction, and a claimed crossing is a stretch nobody else drives
  // into (see `zoneOn`).
  const crossing = rt[last] === farLane(bay);
  if (crossing && num(m, v(i, 'Xc')) !== 1 && !busy && toGoal <= LOOKAHEAD_MM) {
    // A crossing is claimed together with the bay's booking, never without it:
    // a claim on a bay somebody else has booked stands in that vehicle's way in.
    const mine = num(m, v(i, 'Res')) === bay;
    if (canClaimCrossing(m, i, bay, rt[last], goal) && (mine || mayBook(m, i, bay))) {
      if (!mine) book(m, i, bay);
      m[v(i, 'Xc')] = 1;
    }
  }

  const laden = str(m, v(i, 'Load')) !== '';
  let cap = Math.min(
    vel + ACCEL_MM_S_STEP,
    here.kind === 'left' || here.kind === 'right' ? here.vmax : laden ? VMAX_LADEN_MM_S : VMAX_MM_S,
  );
  let ds = -pos;
  for (let k = ri; k <= last && ds < LOOKAHEAD_MM; k++) {
    const e = DC_EDGES[rt[k]];
    if (k > ri && e.kind !== 'lane') {
      const stopAt = ds - VEHICLE_FRONT_MM;
      if (num(m, v(i, 'Box')) !== e.junction) {
        if (stopAt > brake(vel) + CLAIM_MM || !canTakeJunction(m, i, rt, k, ds, limit, bay)) {
          limit = Math.min(limit, stopAt);
          break;
        }
        m[v(i, 'Box')] = e.junction;
      }
      if (e.kind !== 'straight') cap = Math.min(cap, allowed(ds, e.vmax));
    }
    const ob = firstObstacle(m, i, e.id, k === ri ? pos : -1);
    if (ob < Infinity) limit = Math.min(limit, ds + ob - VEHICLE_FRONT_MM - GAP_MM);
    ds += e.len;
  }

  let speed = Math.min(cap, allowed(limit));
  if (speed < VCREEP_MM_S && limit > 0) speed = Math.min(VCREEP_MM_S, Math.max(cap, speed));
  const acc = num(m, v(i, 'Rem')) + (limit > 0 ? speed : 0);
  let stepMm = Math.floor(acc / 100);
  let rem = acc - stepMm * 100;
  if (stepMm >= limit) {
    stepMm = Math.max(0, limit);
    speed = 0;
    rem = 0;
  }

  if (stepMm === 0) {
    m[v(i, 'V')] = limit > 0 ? speed : 0;
    m[v(i, 'Rem')] = rem;
    if (limit > 0) return;
    if (ri === last && pos === goal && !busy) {
      // Arriving on the far lane, it reverses across the near one: that has to
      // be clear, and claimed. Somebody waiting for their own crossing may be
      // standing in it, so after a few seconds the manager sends this vehicle
      // round the block to come in on the near lane instead.
      const near = nearLane(bay);
      if (rt[last] !== near) {
        if (num(m, v(i, 'Xc')) !== 1 && num(m, v(i, 'Res')) === bay && canClaimCrossing(m, i, bay, rt[last], goal)) {
          m[v(i, 'Xc')] = 1;
        }
        if (num(m, v(i, 'Xc')) !== 1 || !stretchClear(m, i, near, bayPos(bay, near))) {
          if (num(m, v(i, 'Wait')) >= DETOUR_MS) {
            planTo(m, i, rt[last], pos, near);
            m[v(i, 'Wait')] = 0;
            return;
          }
          waitFor(m, i, 'waiting to cross into');
          return;
        }
      }
      m[v(i, 'Xc')] = 0;
      m[v(i, 'Want')] = -1;
      m[v(i, 'S')] = 'enter';
      m[v(i, 'Pk')] = bay;
      m[v(i, 'T')] = 0;
      m[v(i, 'V')] = 0;
      m[v(i, 'Wait')] = 0;
      m[v(i, 'Res')] = -1;
      m[v(i, 'Box')] = -1;
      return;
    }
    waitFor(m, i, busy ? 'queued for a busy bay on its way to' : 'held up in traffic on its way to');
    return;
  }
  pos += stepMm;
  while (ri < last && pos >= DC_EDGES[rt[ri]].len) {
    pos -= DC_EDGES[rt[ri]].len;
    ri++;
  }
  m[v(i, 'Pos')] = pos;
  m[v(i, 'Ri')] = ri;
  m[v(i, 'E')] = rt[ri];
  m[v(i, 'V')] = speed;
  m[v(i, 'Rem')] = rem;
  m[v(i, 'Wait')] = 0;
  drain(m, i, stepMm);
}

/**
 * Plan a vehicle's trip from `pos` along `start` to the bay its leg ends at,
 * with the traffic as it is now. A vehicle on the last lane of its trip always
 * holds the bay's booking: a route that gets there without crossing another
 * junction books it now, and if somebody else has it, the trip goes in from the
 * bay's other lane instead, which is a junction away.
 */
function planTo(m: MachineState, i: number, start: number, pos: number, lane = -1): void {
  const bay = bayFor(m, i);
  const jam = traffic(m, i);
  let r = lane < 0 ? routeToBay(start, pos, bay, jam) : route(start, pos, lane, bayPos(bay, lane), jam);
  m[v(i, 'Res')] = -1;
  if (num(m, v(i, 'Want')) !== bay) m[v(i, 'Want')] = -1;
  const immediate = r.edges.length === 1 || (r.edges.length === 2 && DC_EDGES[start].kind !== 'lane');
  if (immediate) {
    if (mayBook(m, i, bay)) {
      book(m, i, bay);
    } else {
      const lane = r.edges[r.edges.length - 1] === nearLane(bay) ? farLane(bay) : nearLane(bay);
      r = route(start, pos, lane, bayPos(bay, lane), jam);
    }
  }
  m[v(i, 'Rt')] = r.edges.join('.');
  m[v(i, 'Ri')] = 0;
  m[v(i, 'Xc')] = 0;
}

/** A new trip for a vehicle already on the road, from where it is. */
function replan(m: MachineState, i: number): void {
  planTo(m, i, routeOf(m, i)[num(m, v(i, 'Ri'))], num(m, v(i, 'Pos')));
}

/**
 * Where on `lane` a vehicle waits for the busy bay at `goal`: a vehicle's length
 * short of it, and further back still past any other bay on the lane that has a
 * vehicle in it, because a vehicle standing across a bay's mouth is in the way
 * of whoever has to pull out of it. Can be behind the lane's start, which means
 * waiting before the junction.
 */
function waitPoint(m: MachineState, self: number, lane: number, goal: number): number {
  let p = goal - WAIT_BACK_MM;
  for (let pass = 0; pass < MAX_FLEET; pass++) {
    let moved = false;
    for (let j = 0; j < MAX_FLEET; j++) {
      if (j === self || !BAY_STATES.has(stateOf(m, j))) continue;
      const pk = num(m, v(j, 'Pk'));
      if (nearLane(pk) !== lane && farLane(pk) !== lane) continue;
      const q = bayPos(pk, lane);
      if (q >= goal) continue;
      if (p - VEHICLE_REAR_MM - GAP_MM < q + ZONE_MM && p + VEHICLE_FRONT_MM + GAP_MM > q - ZONE_MM) {
        p = q - ZONE_MM - VEHICLE_FRONT_MM - GAP_MM;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return p;
}

/** Is another vehicle on its way to this bay? */
function wanted(m: MachineState, bay: number, self: number): boolean {
  for (let j = 0; j < MAX_FLEET; j++) {
    if (j !== self && stateOf(m, j) === 'drive' && bayFor(m, j) === bay) return true;
  }
  return false;
}

function idle(m: MachineState, i: number): boolean {
  if (bool(m, v(i, 'ChgNext'))) return false;
  const s = str(m, v(i, 'S')) as VehicleState;
  const leg = str(m, v(i, 'Leg')) as Leg;
  return s === 'park' || ((s === 'drive' || s === 'exit') && leg === 'home');
}

/** What a trip to `bay` would take vehicle `i` from where it is now, for "nearest". */
function tripCost(m: MachineState, i: number, bay: number): number {
  if (stateOf(m, i) === 'drive') return routeToBay(routeOf(m, i)[num(m, v(i, 'Ri'))], num(m, v(i, 'Pos')), bay).cost;
  const pk = num(m, v(i, 'Pk'));
  return pk === bay ? 0 : bayRoute(pk, bay).cost;
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

  // A charge order names no vehicle: the one with the lowest battery goes, now if
  // it is idle, or as soon as its job is done. Taken at once either way, which is
  // what a real fleet manager does with a charge request.
  if (from === 0 && to === 70 && builtLocations(m).has(70)) {
    let pick = -1;
    for (let i = 0; i < fleet; i++) {
      if (charging(m, i)) continue;
      if (pick < 0 || num(m, v(i, 'Batt')) < num(m, v(pick, 'Batt'))) pick = i;
    }
    if (pick < 0) return;
    if (idle(m, pick)) assign(m, pick, 'chg', 0, 70, -1);
    else m[v(pick, 'ChgNext')] = true;
    m.ack = true;
    return;
  }

  if (from === to || !isPickable(m, from) || !isDroppable(m, to)) {
    m.nak = true;
    return;
  }
  const src = locationByCode(from)!.pick;
  let pick = -1;
  let best = Infinity;
  for (let i = 0; i < fleet; i++) {
    if (!idle(m, i)) continue;
    const d = tripCost(m, i, src);
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

/** Sent to charge: on its way, on the charger, or going once its job is done. */
function charging(m: MachineState, i: number): boolean {
  return bool(m, v(i, 'ChgNext')) || str(m, v(i, 'Leg')) === 'chg';
}

function assign(m: MachineState, i: number, leg: Leg, from: number, to: number, asn: number): void {
  m[v(i, 'Leg')] = leg;
  m[v(i, 'From')] = from;
  m[v(i, 'To')] = to;
  m[v(i, 'Asn')] = asn;
  const s = str(m, v(i, 'S'));
  if (s === 'park') {
    m[v(i, 'S')] = 'exit';
    m[v(i, 'T')] = 0;
  } else if (s === 'drive') {
    replan(m, i);
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
  if (batt <= 0) throw new Fault(`vehicle ${i + 1} ran its battery flat on the road`, { cause: 'flat' });
}

function stepVehicle(m: MachineState, i: number): void {
  const state = str(m, v(i, 'S')) as VehicleState;
  const leg = str(m, v(i, 'Leg')) as Leg;
  const t = num(m, v(i, 'T')) + SUB_MS;

  // A charge that was waiting for this vehicle's job to finish starts the moment
  // it would otherwise have been free for the next one.
  if (bool(m, v(i, 'ChgNext')) && (state === 'park' || ((state === 'drive' || state === 'exit') && leg === 'home'))) {
    m[v(i, 'ChgNext')] = false;
    m[v(i, 'Leg')] = 'chg';
    if (state === 'park') {
      m[v(i, 'S')] = 'exit';
      m[v(i, 'T')] = 0;
    } else if (state === 'drive') {
      replan(m, i);
    }
    return;
  }

  switch (state) {
    case 'off':
      return;

    // Park at last position, the policy real fleet managers default to: an idle
    // vehicle stays in the bay it last worked in until another vehicle heads for
    // that bay, and only then goes home. The difference is a round trip every
    // time a program collects a pallet it has just set down for a check.
    case 'park': {
      const pk = num(m, v(i, 'Pk'));
      if (pk === DEPOT_BAYS[i] || !wanted(m, pk, i)) return;
      m[v(i, 'Leg')] = 'home';
      m[v(i, 'S')] = 'exit';
      m[v(i, 'T')] = 0;
      return;
    }

    case 'drive':
      stepDrive(m, i);
      return;

    // Pivot on the lane, then reverse in, fork first.
    case 'enter':
      if (t < (num(m, v(i, 'E')) === nearLane(num(m, v(i, 'Pk'))) ? ENTER_MS : ENTER_FAR_MS)) {
        m[v(i, 'T')] = t;
        return;
      }
      m[v(i, 'T')] = 0;
      m[v(i, 'E')] = -1;
      m[v(i, 'S')] = leg === 'home' ? 'park' : leg === 'chg' ? 'charge' : 'hold';
      if (leg === 'home') m[v(i, 'Leg')] = '';
      return;

    case 'hold': {
      const ready =
        leg === 'src'
          ? canPick(m, num(m, v(i, 'From')), num(m, v(i, 'To'))) !== null
          : canDrop(m, num(m, v(i, 'To')), str(m, v(i, 'Load')), num(m, v(i, 'Asn')));
      if (!ready) {
        waitFor(m, i, leg === 'src' ? 'waiting to pick at' : 'waiting to set down at');
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

    // Still in the bay until the way out is clear; then forward out, onto the
    // near lane or across it to the far one, and a pivot onto the new heading.
    case 'exit': {
      const pk = num(m, v(i, 'Pk'));
      const target = bayFor(m, i);
      if (num(m, v(i, 'T')) === 0) {
        // A vehicle already in the bay its next job starts from never leaves it.
        if (target === pk && leg !== '') {
          m[v(i, 'S')] = leg === 'home' ? 'park' : leg === 'chg' ? 'charge' : 'hold';
          if (leg === 'home') m[v(i, 'Leg')] = '';
          return;
        }
        // The way out its route prefers, chosen once with the traffic as it is
        // now. The other way is only taken if it costs little more, or once the
        // preferred one has been blocked long enough to look like a standoff.
        let prefer = num(m, v(i, 'Xp'));
        if (prefer < 0) {
          const jam = traffic(m, i);
          const best = bayToBay(pk, target, -1, jam);
          const alt = bayToBay(pk, target, best.exit === nearLane(pk) ? farLane(pk) : nearLane(pk), jam);
          prefer = best.exit;
          m[v(i, 'Xp')] = prefer;
          m[v(i, 'Xd')] = alt.cost - best.cost;
        }
        const other = prefer === nearLane(pk) ? farLane(pk) : nearLane(pk);
        // Break-even: the other way once the wait has cost as much as it would,
        // and never later than a standoff could last without stalling the hub.
        // Two vehicles each waiting to take the other's bay is a standoff at once.
        const extra = num(m, v(i, 'Xd'));
        const patience = Math.min(MAX_PATIENCE_MS, Math.max(DETOUR_MS, extra));
        const lanes =
          extra <= ALT_EXIT_MS || num(m, v(i, 'Wait')) >= patience || swapping(m, i, pk, target)
            ? [prefer, other]
            : [prefer];
        let out = -1;
        for (const lane of lanes) {
          // Straight on along the lane it pulls out onto: the bay is booked first.
          const direct = (lane === nearLane(target) || lane === farLane(target)) && bayPos(target, lane) >= bayPos(pk, lane);
          if (direct && !mayBook(m, i, target)) continue;
          // Pulling out just short of a bay somebody is still in would stand in their way out.
          if (direct && bayOccupied(m, target, i) && waitPoint(m, i, lane, bayPos(target, lane)) < bayPos(pk, lane)) continue;
          if (!clearToPullOut(m, i, pk, lane)) continue;
          if (direct) book(m, i, target);
          out = lane;
          break;
        }
        if (out < 0) {
          waitFor(m, i, 'waiting to pull out on its way to');
          return;
        }
        m[v(i, 'Xe')] = out;
        m[v(i, 'T')] = SUB_MS;
        m[v(i, 'Wait')] = 0;
        return;
      }
      const lane = num(m, v(i, 'Xe'));
      if (t < (lane === nearLane(pk) ? EXIT_NEAR_MS : EXIT_FAR_MS)) {
        m[v(i, 'T')] = t;
        return;
      }
      const at = bayPos(pk, lane);
      m[v(i, 'S')] = 'drive';
      m[v(i, 'E')] = lane;
      m[v(i, 'Pos')] = at;
      m[v(i, 'V')] = 0;
      m[v(i, 'Rem')] = 0;
      planTo(m, i, lane, at);
      m[v(i, 'Pk')] = -1;
      m[v(i, 'Xe')] = -1;
      m[v(i, 'Xp')] = -1;
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

/** Is a vehicle anywhere in a room's bay, going in, working or backing out? */
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
        m.trucksOut = num(m, 'trucksOut') + 1;
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
    [DC_IN.charging]: Array.from({ length: fleetSize(m) }, (_, i) => charging(m, i)).some(Boolean),
  };
  const allRegs: Record<string, number> = {
    [DC_REG.qaCode]: qaDone && qaPallet ? palletCode(qaPallet) : 0,
    [DC_REG.freeVehicles]: freeVehicles(m),
    [DC_REG.lineDock]: line === '' ? 0 : Number.parseInt(line.slice(0, 2), 10),
    [DC_REG.lineProduct]: line === '' ? 0 : Number.parseInt(line.slice(2), 10),
    [DC_REG.quarantine]: contents(m, 11).length,
    [DC_REG.call1]: num(m, 'call61'),
    [DC_REG.call2]: num(m, 'call62'),
    [DC_REG.lines1]: str(m, 't61') === 'docked' ? truckOrder(m, 61).length : 0,
    [DC_REG.lines2]: str(m, 't62') === 'docked' ? truckOrder(m, 62).length : 0,
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

/** The addresses a puzzle wired, built once per device list rather than once per scan. */
const DECLARED = new WeakMap<readonly PuzzleDevice[], ReadonlySet<string>>();

function declaredOf(devices: readonly PuzzleDevice[]): ReadonlySet<string> {
  let set = DECLARED.get(devices);
  if (!set) {
    set = new Set(devices.map((d) => d.address));
    DECLARED.set(devices, set);
  }
  return set;
}

function step(ctx: ProcessStepCtx): ProcessResult {
  const m: MachineState = { ...ctx.machine };
  settle(m);
  const declared = declaredOf(ctx.devices);

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
