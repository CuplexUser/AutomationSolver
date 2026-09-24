import {
  AISLE_HALF_MM,
  BAY_MM,
  DC_AISLES,
  DC_BAYS,
  DC_EDGES,
  DC_JUNCTIONS,
  DC_LOCATIONS,
  DC_SECTIONS,
  DEPOT_BAYS,
  DOCK_OUT_FRONT_MM,
  ENTER_FAR_MS,
  ENTER_MS,
  EXIT_FAR_MS,
  EXIT_NEAR_MS,
  FORK_MS,
  PIVOT_MS,
  STATION_FRONT_MM,
  aisleDir,
  aisleLength,
  bayFrame,
  bayPos,
  edgePoint,
  locationByCode,
  nearLane,
  type LocationDef,
  type MachineState,
} from '@automationsolver/shared';
import type { Focus } from '../factory/camera';

/**
 * The hub's floor plan in scene units, derived from the plant's own roads.
 *
 * The plant (`processes/dcRoads.ts`) works in millimeters on a plan whose y runs
 * south; the scene works in meters with z running south, so a plan point (x, y)
 * is simply (x / 1000, y / 1000) on the floor. Every station stands on the bay
 * the plant gives it, facing the aisle, and every vehicle is posed from the
 * plant's edge and distance, which is why moving a bay or an aisle in the plant
 * moves it here with no second number to keep in step.
 *
 * Pure functions only: the scene (`plant.ts`) calls these, and nothing here
 * touches three.js.
 */

export const MM = 1 / 1000;

/** From an aisle's centerline to a station's front edge, and to a vehicle standing in the bay. */
export const FRONT_M = STATION_FRONT_MM * MM;
export const BAY_M = BAY_MM * MM;
export const AISLE_HALF_M = AISLE_HALF_MM * MM;
/** An outbound dock stands deeper, so the truck door is behind the vehicle's bay. */
export const DOCK_OUT_M = DOCK_OUT_FRONT_MM * MM;
/** The truck's tail sits this far past the dock's front edge, against the wall's outer face. */
export const TRUCK_M = 0.55;
/** The charger's plate is 1 m into the asset, so the asset starts that far short of the bay. */
export const CHARGER_M = BAY_M - 1.0;

/** A point on the floor with a way of facing: `dir` points into the bay, away from the aisle. */
export interface Frame {
  x: number;
  z: number;
  dir: [number, number];
}

/** The bay `bay`'s frame, `offset` meters from the aisle's centerline into it. */
export function bayFrameAt(bay: number, offset: number): Frame {
  const f = bayFrame(bay);
  // `0 + v` rather than `v`, so an axis-aligned direction has no -0 in it.
  const d: [number, number] = [0 + f.nx, 0 + f.ny];
  return { x: f.x * MM + d[0] * offset, z: f.y * MM + d[1] * offset, dir: d };
}

/**
 * The rotation that turns a kit station toward its bay. A station is authored
 * running away from its origin along Blender +Y, which the exporter made three's
 * -Z, so this is the yaw that points local -Z along `dir`.
 */
export function stationYaw(dir: [number, number]): number {
  return Math.atan2(-dir[0], -dir[1]);
}

/** The yaw that points a vehicle's forks (its local +X) along a floor direction. */
export function vehicleYaw(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** The yaw of a vehicle driving on a plan heading, body first with its forks trailing. */
export function travelYaw(heading: number): number {
  return Math.PI - heading;
}

// --- stations ------------------------------------------------------------------

/** What the kit calls each kind of location, and how its pallets are laid out. */
export interface StationDef {
  code: number;
  loc: LocationDef;
  asset: string;
  /** Slot empties in the kit, in the order the plant lists a location's pallets. */
  slots: string[];
  frame: Frame;
  /** How far the station reaches from its front edge, for framing a section. */
  depth: number;
  /** Its width across the bay, for the apron painted in front of it. */
  width: number;
  /** How far it reaches along the aisle past its own width, toward the kit's +X (the wrapper's U). */
  span: number;
}

const slotsOf = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, k) => `${prefix}${k}`);

/**
 * Every station this puzzle built. The wrapper's outfeed (51) is the far leg of
 * the one wrapper asset at 50, so it has no station of its own.
 */
export function stationsFor(built: ReadonlySet<number>): StationDef[] {
  const out: StationDef[] = [];
  for (const loc of DC_LOCATIONS) {
    if (!built.has(loc.code)) continue;
    const bay = loc.drop >= 0 ? loc.drop : loc.pick;
    const at = (offset: number) => bayFrameAt(bay, offset);
    const add = (asset: string, slots: string[], frame: Frame, depth: number, width: number, span = 0) =>
      out.push({ code: loc.code, loc, asset, slots, frame, depth, width, span });
    switch (loc.kind) {
      case 'dock-in':
        add('DockIn', slotsOf('DockInSlot', 3), at(FRONT_M), 3.3, 1.9);
        break;
      case 'qa':
        add('QaStation', ['QaSlot'], at(FRONT_M), 1.6, 1.8);
        break;
      case 'quarantine':
        add('QuarantineCage', slotsOf('QuarantineSlot', 4), at(FRONT_M), 4, 1.8);
        break;
      case 'flow':
        add('FlowLane', slotsOf('FlowLaneSlot', 4), at(FRONT_M), 5.6, 1.4);
        break;
      case 'room':
        add('RipeningRoom', slotsOf('RoomSlot', 4), at(FRONT_M), 4.2, 1.9);
        break;
      case 'drive-in':
        add('DriveInLane', slotsOf('DriveInSlot', 4), at(FRONT_M), 4, 1.4);
        break;
      case 'wrap-in':
        add('Wrapper', slotsOf('WrapZone', 6), at(FRONT_M), 5.5, 1.3, 3.0);
        break;
      case 'dock-out':
        add('DockOut', slotsOf('TruckSlot', 6), at(DOCK_OUT_M), 0.5, 2.9);
        break;
      case 'charger':
        add('Charger', [], at(CHARGER_M), 2.4, 1.3);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Along the aisle, toward the kit's +X: the direction a station's local +X runs on the floor. */
export function alongOf(dir: [number, number]): [number, number] {
  return [0 - dir[1], 0 + dir[0]];
}

/** The floor rectangle a station covers, as plan-aligned bounds. */
export function stationBounds(st: StationDef): { x: [number, number]; z: [number, number] } {
  const { x, z, dir } = st.frame;
  const along = alongOf(dir);
  const pts: [number, number][] = [];
  for (const d of [0, st.depth]) {
    for (const a of [-st.width / 2, st.width / 2 + st.span]) {
      pts.push([x + dir[0] * d + along[0] * a, z + dir[1] * d + along[1] * a]);
    }
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
}

// --- the floor's paint --------------------------------------------------------------

/** A rectangle on the floor: its center, and its size along x and z. */
export interface FloorRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** A painted chevron: where, and which way it points (a plan heading). */
export interface Arrow {
  x: number;
  z: number;
  heading: number;
}

const junctionAt = (j: number) => ({ x: DC_JUNCTIONS[j].x * MM, z: DC_JUNCTIONS[j].y * MM });

/** The aisles' asphalt, one rectangle per aisle plus one per junction box. */
export function aisleSurfaces(): FloorRect[] {
  const out: FloorRect[] = [];
  const w = AISLE_HALF_M * 2;
  DC_AISLES.forEach((aisle, i) => {
    const a = junctionAt(aisle.a);
    const b = junctionAt(aisle.b);
    const len = aisleLength(i) * MM - w;
    const horizontal = aisleDir(i).y === 0;
    out.push({
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      w: horizontal ? len : w,
      d: horizontal ? w : len,
    });
  });
  DC_JUNCTIONS.forEach((_, j) => out.push({ ...junctionAt(j), w, d: w }));
  return out;
}

/**
 * The lines painted on the aisles: an edge line down each side and a dashed
 * divider between the lanes, all stopping at the junction boxes so no line
 * crosses another.
 */
export function aisleLines(): { edges: FloorRect[]; dashes: FloorRect[] } {
  const edges: FloorRect[] = [];
  const dashes: FloorRect[] = [];
  const W = 0.08;
  DC_AISLES.forEach((aisle, i) => {
    const a = junctionAt(aisle.a);
    const b = junctionAt(aisle.b);
    const d = aisleDir(i);
    const horizontal = d.y === 0;
    const start = AISLE_HALF_M;
    const len = aisleLength(i) * MM - 2 * AISLE_HALF_M;
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    for (const side of [-1, 1]) {
      const off = side * (AISLE_HALF_M - W / 2);
      edges.push(horizontal ? { x: cx, z: cz + off, w: len, d: W } : { x: cx + off, z: cz, w: W, d: len });
    }
    for (let s = start + 0.5; s + 1 <= start + len - 0.5; s += 2) {
      const m = s + 0.5;
      dashes.push(
        horizontal
          ? { x: a.x + d.x * m, z: a.z, w: 1, d: 0.06 }
          : { x: a.x, z: a.z + d.y * m, w: 0.06, d: 1 },
      );
    }
  });
  return { edges, dashes };
}

/** Chevrons down the middle of every lane, each pointing the way its lane runs. */
export function laneArrows(): Arrow[] {
  const out: Arrow[] = [];
  for (const e of DC_EDGES) {
    if (e.kind !== 'lane') continue;
    const heading = Math.atan2(e.d0.y, e.d0.x);
    const len = e.len * MM;
    for (let s = 1.6; s < len - 1; s += 4.5) {
      const p = edgePoint(e.id, s / MM);
      out.push({ x: p.x * MM, z: p.y * MM, heading });
    }
  }
  return out;
}

/**
 * The apron in front of a bay, between the aisle's edge line and whatever stands
 * there: a vehicle pivots in it, and the location's code is painted on it.
 */
export function apron(bay: number, width: number, depth: number): { rect: FloorRect; center: [number, number] } {
  const from = AISLE_HALF_M + 0.06;
  const to = from + depth;
  const a = bayFrameAt(bay, (from + to) / 2);
  const across = Math.abs(a.dir[0]) > 0.5;
  return {
    rect: { x: a.x, z: a.z, w: across ? to - from : width, d: across ? width : to - from },
    center: [a.x, a.z],
  };
}

/** Every bay a station on this floor is served from, with its apron's width and depth. */
export function stationBays(
  stations: readonly StationDef[],
): { bay: number; code: number; width: number; depth: number; reach: number }[] {
  const out: { bay: number; code: number; width: number; depth: number; reach: number }[] = [];
  for (const st of stations) {
    const front = st.loc.kind === 'dock-out' ? DOCK_OUT_M : st.loc.kind === 'charger' ? CHARGER_M : FRONT_M;
    const depth = (st.loc.kind === 'dock-out' ? DOCK_OUT_M : FRONT_M) - AISLE_HALF_M - 0.06;
    // How far from the aisle's centerline the station ends, for a code that has to go beyond it.
    const reach = front + st.depth;
    const bays = new Set([st.loc.drop, st.loc.pick].filter((b) => b >= 0));
    // The wrapper's outfeed is its own location, served from its own bay.
    if (st.loc.kind === 'wrap-in') {
      const outfeed = locationByCode(51);
      if (outfeed) bays.add(outfeed.pick);
    }
    for (const bay of bays) {
      const code = st.loc.kind === 'wrap-in' && bay !== st.loc.drop ? 51 : st.code;
      out.push({ bay, code, width: st.loc.kind === 'charger' ? 1.3 : st.width, depth, reach });
    }
  }
  return out;
}

// --- the building ----------------------------------------------------------------

/** The west wall's hall face: behind the outbound docks' own walls. */
export const WEST_WALL_X = -(DOCK_OUT_M + 0.25);
/** The north wall runs flush with the goods-in doors, then steps back behind QA to clear quarantine and the rooms. */
export const NORTH_DOCK_Z = -(FRONT_M + 3.0);
export const NORTH_STEP_X = 9.8;
export const NORTH_BACK_Z = -(FRONT_M + 4.55);
/** The slab: the hall and everything built on it. East and south are open floor. */
export const HALL = { x: [WEST_WALL_X - 0.2, 29.0] as [number, number], z: [NORTH_BACK_Z - 0.2, 19.0] as [number, number] };
/** The truck yard outside the west wall. */
export const YARD = { x: [-21, WEST_WALL_X - 0.2] as [number, number], z: [-2, 11.5] as [number, number] };
export const WALL_H = 4.6;

/**
 * A wall run with the openings a puzzle's docks cut in it. `from`/`to` are along
 * the run, and every opening is [start, end] on the same axis.
 */
export function wallSegments(from: number, to: number, openings: [number, number][]): [number, number][] {
  const cuts = [...openings].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let at = from;
  for (const [a, b] of cuts) {
    if (a > at + 0.01) out.push([at, Math.min(a, to)]);
    at = Math.max(at, b);
  }
  if (to > at + 0.01) out.push([at, to]);
  return out;
}

// --- the vehicles -------------------------------------------------------------------

const vKey = (i: number, key: string): string => `v${i}${key}`;
const num = (m: MachineState, k: string, d = 0): number => (typeof m[k] === 'number' ? (m[k] as number) : d);
const str = (m: MachineState, k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '');

/** The bay vehicle `i`'s current trip ends at, the way the plant works it out. */
export function tripBay(m: MachineState, i: number): number {
  const leg = str(m, vKey(i, 'Leg'));
  if (leg === 'src') return locationByCode(num(m, vKey(i, 'From')))?.pick ?? -1;
  if (leg === 'dst') return locationByCode(num(m, vKey(i, 'To')))?.drop ?? -1;
  if (leg === 'chg') return locationByCode(70)?.drop ?? -1;
  return DEPOT_BAYS[i] ?? -1;
}

export interface VehiclePose {
  visible: boolean;
  x: number;
  z: number;
  yaw: number;
  /** Fork lift above its rest, in meters. */
  lift: number;
  /** Driving, working or charging: what the beacon shows. */
  mode: 'idle' | 'moving' | 'charging' | 'stuck';
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
/** The shorter way round from one yaw to another. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** A point on a lane, in scene meters, with the yaw of a vehicle driving it. */
function onLane(lane: number, s: number): { x: number; z: number; yaw: number } {
  const p = edgePoint(lane, s);
  return { x: p.x * MM, z: p.y * MM, yaw: travelYaw(p.heading) };
}

/**
 * Where vehicle `i` is and which way it faces, from nothing but the plant's state:
 * on a lane or round a junction at its distance along the edge; in a bay; or
 * between the two, pivoting on the lane and reversing in fork first, or driving
 * out and pivoting onto its new heading. Replay therefore shows exactly what the
 * live run showed.
 */
export function vehiclePose(m: MachineState, i: number): VehiclePose {
  const state = str(m, vKey(i, 'S'));
  if (state === 'off' || state === '') return { visible: false, x: 0, z: 0, yaw: 0, lift: 0, mode: 'idle' };
  const stuck = num(m, vKey(i, 'Wait')) > 3000;
  const laden = str(m, vKey(i, 'Load')) !== '';
  const carry = laden ? 0.08 : 0;
  if (state === 'drive') {
    const p = onLane(num(m, vKey(i, 'E')), num(m, vKey(i, 'Pos')));
    return { visible: true, ...p, lift: carry, mode: stuck ? 'stuck' : 'moving' };
  }
  const bay = num(m, vKey(i, 'Pk'));
  const inBay = bayFrameAt(bay, BAY_M);
  const bayYaw = vehicleYaw(inBay.dir[0], inBay.dir[1]);
  const t = num(m, vKey(i, 'T'));
  let x = inBay.x;
  let z = inBay.z;
  let yaw = bayYaw;
  if (state === 'enter') {
    const lane = num(m, vKey(i, 'E'));
    const total = lane === nearLane(bay) ? ENTER_MS : ENTER_FAR_MS;
    const at = onLane(lane, bayPos(bay, lane));
    const pivot = ease(clamp01(t / PIVOT_MS));
    const back = ease(clamp01((t - PIVOT_MS) / (total - PIVOT_MS)));
    x = lerp(at.x, inBay.x, back);
    z = lerp(at.z, inBay.z, back);
    yaw = lerpAngle(at.yaw, bayYaw, pivot);
  } else if (state === 'exit' && t > 0) {
    const lane = num(m, vKey(i, 'Xe'));
    const total = lane === nearLane(bay) ? EXIT_NEAR_MS : EXIT_FAR_MS;
    const at = onLane(lane, bayPos(bay, lane));
    const out = ease(clamp01(t / (total - PIVOT_MS)));
    const pivot = ease(clamp01((t - (total - PIVOT_MS)) / PIVOT_MS));
    x = lerp(inBay.x, at.x, out);
    z = lerp(inBay.z, at.z, out);
    yaw = lerpAngle(bayYaw, at.yaw, pivot);
  }
  const lift = state === 'work' ? 0.1 * Math.sin((Math.PI * Math.min(t, FORK_MS)) / FORK_MS) + carry : carry;
  const mode =
    state === 'charge' ? 'charging' : stuck ? 'stuck' : state === 'park' || state === 'hold' ? 'idle' : 'moving';
  return { visible: true, x, z, yaw, lift, mode };
}

/**
 * The rest of a driving vehicle's route, as points on the floor from where it is
 * to where it will stop: the path the fleet manager planned for it. Empty when
 * it is not on the road.
 */
export function routeAhead(m: MachineState, i: number, step = 0.5): [number, number][] {
  if (str(m, vKey(i, 'S')) !== 'drive') return [];
  const edges = str(m, vKey(i, 'Rt'))
    .split('.')
    .filter((s) => s !== '')
    .map((s) => Number.parseInt(s, 10));
  const ri = num(m, vKey(i, 'Ri'));
  if (edges.length === 0 || ri >= edges.length) return [];
  const bay = tripBay(m, i);
  const last = edges.length - 1;
  const pts: [number, number][] = [];
  for (let k = ri; k <= last; k++) {
    const e = DC_EDGES[edges[k]];
    const from = k === ri ? num(m, vKey(i, 'Pos')) : 0;
    const to = k === last && bay >= 0 ? bayPos(bay, e.id) : e.len;
    for (let s = from; s < to; s += step / MM) {
      const p = edgePoint(e.id, s);
      pts.push([p.x * MM, p.y * MM]);
    }
    const p = edgePoint(e.id, Math.max(from, to));
    pts.push([p.x * MM, p.y * MM]);
  }
  // And on into the bay it is going to.
  if (bay >= 0) {
    const f = bayFrameAt(bay, BAY_M);
    pts.push([f.x, f.z]);
  }
  return pts;
}

// --- cameras -------------------------------------------------------------------------

/** The whole floor, the truck yard included, seen from the south-east and above. */
export const PLANT_FOCUS: Focus = {
  center: [5, 0, 6],
  halfWidth: 25,
  halfHeight: 13,
  dir: [0.18, 0.78, 0.6],
};

/**
 * A section's camera: the floor its locations stand on, framed from the aisle's
 * side. FLEET's is the fleet corner, where the vehicles park and charge.
 */
export function sectionFocus(section: string, stations: readonly StationDef[]): Focus | undefined {
  const codes = DC_SECTIONS[section];
  if (!codes) return undefined;
  const mine = stations.filter((s) => codes.includes(s.code));
  const xs: number[] = [];
  const zs: number[] = [];
  for (const st of mine) {
    const b = stationBounds(st);
    xs.push(...b.x);
    zs.push(...b.z);
  }
  if (section === 'FLEET') {
    for (const bay of DEPOT_BAYS) {
      const f = bayFrameAt(bay, BAY_M);
      xs.push(f.x - 1.5, f.x + 1.5);
      zs.push(f.z - 1, f.z + 1);
    }
  }
  if (xs.length === 0) return undefined;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  return {
    center: [(x0 + x1) / 2, 0.8, (z0 + z1) / 2],
    halfWidth: Math.max(5, (x1 - x0) / 2 + 1.5),
    halfHeight: Math.max(3.5, ((z1 - z0) / 2) * 0.8 + 1.8),
    dir: [0.12, 0.72, 0.68],
  };
}

/** A location's name and code, the way a briefing writes them: `QA 10`. */
export function signText(code: number): string {
  const loc = locationByCode(code);
  if (!loc) return String(code);
  if (loc.kind === 'wrap-in') return `WRAP IN ${code}`;
  if (loc.kind === 'wrap-out') return `WRAP OUT ${code}`;
  return `${loc.name} ${code}`;
}

/** Each parking bay's name, for its floor paint. */
export const DEPOT_NAMES = DEPOT_BAYS.map((b) => DC_BAYS[b].name);
