import {
  DC_LOCATIONS,
  DC_SECTIONS,
  DEPOT_STOPS,
  ENTER_MS,
  EXIT_MS,
  FORK_MS,
  locationByCode,
  loopPoint,
  outward,
  type LocationDef,
  type MachineState,
} from '@automationsolver/shared';
import type { Focus } from '../factory/camera';

/**
 * The hub's floor plan in scene units, derived from the plant's own geometry.
 *
 * The plant (`processes/distribution.ts`) works in millimeters on a plan whose
 * y runs south; the scene works in meters with z running south, so a plan point
 * (x, y) is simply (x / 1000, y / 1000) on the floor. Every station stands on the
 * stop the plant gives it, facing the loop, which is why moving a location in the
 * plant moves it here with no second number to keep in step.
 *
 * Pure functions only: the scene (`plant.ts`) calls these, and nothing here
 * touches three.js.
 */

const MM = 1 / 1000;

/** From the loop's centerline to a station's front edge. */
export const POCKET_M = 1.2;
/** Outbound docks stand deeper, so the truck door is behind the vehicle's pocket. */
export const DOCK_OUT_M = 1.65;
/** The truck's tail sits this far past the dock's front edge, against the wall's outer face. */
export const TRUCK_M = 0.55;
/** The charger's plate is centered on the pocket, so its front edge is almost on the loop. */
export const CHARGER_M = 0.15;
/** A vehicle in a pocket stands this far off the loop: its forks then reach the first slot. */
export const VEHICLE_POCKET_M = 1.15;

/** A point on the floor with a way of facing: `dir` points into the pocket, away from the loop. */
export interface Frame {
  x: number;
  z: number;
  dir: [number, number];
}

/** The pocket at stop `s` on one side of the loop, `offset` meters into it. */
export function pocketFrame(s: number, side: 'out' | 'in', offset: number): Frame {
  const p = loopPoint(s);
  const o = outward(p.heading);
  // `0 - v` rather than `-v`, so an axis-aligned inward direction has no -0 in it.
  const d: [number, number] = side === 'out' ? [o.x, o.y] : [0 - o.x, 0 - o.y];
  return { x: p.x * MM + d[0] * offset, z: p.y * MM + d[1] * offset, dir: d };
}

/**
 * The rotation that turns a kit station toward its pocket. A station is authored
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
  /** How far it reaches along the loop's direction of travel (the wrapper's U). */
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
    const stop = loc.drop >= 0 ? loc.drop : loc.pick;
    const at = (offset: number) => pocketFrame(stop, loc.side, offset);
    switch (loc.kind) {
      case 'dock-in':
        out.push({ code: loc.code, loc, asset: 'DockIn', slots: slotsOf('DockInSlot', 3), frame: at(POCKET_M), depth: 3.3, span: 0 });
        break;
      case 'qa':
        out.push({ code: loc.code, loc, asset: 'QaStation', slots: ['QaSlot'], frame: at(POCKET_M), depth: 1.6, span: 0 });
        break;
      case 'quarantine':
        out.push({ code: loc.code, loc, asset: 'QuarantineCage', slots: slotsOf('QuarantineSlot', 4), frame: at(POCKET_M), depth: 4, span: 0 });
        break;
      case 'flow':
        out.push({ code: loc.code, loc, asset: 'FlowLane', slots: slotsOf('FlowLaneSlot', 4), frame: at(POCKET_M), depth: 5.6, span: 0 });
        break;
      case 'room':
        out.push({ code: loc.code, loc, asset: 'RipeningRoom', slots: slotsOf('RoomSlot', 4), frame: at(POCKET_M), depth: 4.2, span: 0 });
        break;
      case 'drive-in':
        out.push({ code: loc.code, loc, asset: 'DriveInLane', slots: slotsOf('DriveInSlot', 4), frame: at(POCKET_M), depth: 4, span: 0 });
        break;
      case 'wrap-in':
        out.push({ code: loc.code, loc, asset: 'Wrapper', slots: slotsOf('WrapZone', 6), frame: at(POCKET_M), depth: 5.5, span: 4.2 });
        break;
      case 'dock-out':
        out.push({ code: loc.code, loc, asset: 'DockOut', slots: slotsOf('TruckSlot', 6), frame: at(DOCK_OUT_M), depth: 10.5, span: 0 });
        break;
      case 'charger':
        out.push({ code: loc.code, loc, asset: 'Charger', slots: [], frame: at(CHARGER_M), depth: 2.4, span: 0 });
        break;
      default:
        break;
    }
  }
  return out;
}

/** The floor rectangle a station covers, as plan-aligned bounds. */
export function stationBounds(st: StationDef): { x: [number, number]; z: [number, number] } {
  const { x, z, dir } = st.frame;
  // Along the loop's direction of travel: the pocket direction turned a quarter
  // turn, clockwise seen from above for the outside and anticlockwise inside.
  const along: [number, number] = st.loc.side === 'out' ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
  const pts: [number, number][] = [];
  for (const d of [0, st.depth]) {
    for (const a of [-0.9, 0.9 + st.span]) {
      pts.push([x + dir[0] * d + along[0] * a, z + dir[1] * d + along[1] * a]);
    }
  }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
}

// --- the building ----------------------------------------------------------------

/** The hall: the loop and everything on it, plus the depot and the charger south of it. */
export const HALL = { x: [-2.15, 27.5] as [number, number], z: [-5.8, 11.6] as [number, number] };
/** The north wall steps back behind the rooms: west of here it runs flush with the inbound docks. */
export const NORTH_STEP_X = 4.6;
export const NORTH_DOCK_Z = -4.2;
/** The truck yard outside the west wall. */
export const YARD = { x: [-15, HALL.x[0]] as [number, number], z: [-1, 11] as [number, number] };
export const WALL_H = 4.2;

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

/** Which side of the loop a pocket stop is on: every location's own, and the depot outside. */
export function pocketSide(stop: number): 'out' | 'in' {
  if (DEPOT_STOPS.includes(stop)) return 'out';
  const loc = DC_LOCATIONS.find((l) => l.drop === stop || l.pick === stop);
  return loc?.side ?? 'out';
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
/** The shorter way round from one yaw to another. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * Where vehicle `i` is and which way it faces, from nothing but the plant's state:
 * on the loop at its position, in a pocket at its stop, or turning between the
 * two while it enters or leaves one. Replay therefore shows exactly what the live
 * run showed.
 */
export function vehiclePose(m: MachineState, i: number): VehiclePose {
  const state = str(m, vKey(i, 'S'));
  if (state === 'off' || state === '') return { visible: false, x: 0, z: 0, yaw: 0, lift: 0, mode: 'idle' };
  const stuck = num(m, vKey(i, 'Wait')) > 3000;
  if (state === 'drive') {
    const s = num(m, vKey(i, 'Pos'));
    const p = loopPoint(s);
    return { visible: true, x: p.x * MM, z: p.y * MM, yaw: -p.heading, lift: 0, mode: stuck ? 'stuck' : 'moving' };
  }
  const stop = num(m, vKey(i, 'Pk'));
  const loop = loopPoint(stop);
  const pocket = pocketFrame(stop, pocketSide(stop), VEHICLE_POCKET_M);
  const inYaw = vehicleYaw(pocket.dir[0], pocket.dir[1]);
  const t = num(m, vKey(i, 'T'));
  let k = 1;
  if (state === 'enter') k = Math.min(1, t / ENTER_MS);
  else if (state === 'exit') k = 1 - Math.min(1, t / EXIT_MS);
  const x = lerp(loop.x * MM, pocket.x, k);
  const z = lerp(loop.y * MM, pocket.z, k);
  const yaw = lerpAngle(-loop.heading, inYaw, k);
  const lift = state === 'work' ? 0.09 * Math.sin((Math.PI * Math.min(t, FORK_MS)) / FORK_MS) : 0;
  const mode =
    state === 'charge'
      ? 'charging'
      : stuck
        ? 'stuck'
        : state === 'park' || state === 'hold'
          ? 'idle'
          : 'moving';
  return { visible: true, x, z, yaw, lift, mode };
}

// --- cameras -------------------------------------------------------------------------

/** The whole floor, the truck yard included, seen from the south-east and above. */
export const PLANT_FOCUS: Focus = {
  center: [6.5, 0, 3.4],
  halfWidth: 21,
  halfHeight: 11,
  dir: [0.18, 0.78, 0.6],
};

/**
 * A section's camera: the floor its locations stand on, framed from the loop's
 * side. FLEET's is the south leg, where the vehicles park and charge.
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
    for (const stop of DEPOT_STOPS) {
      const f = pocketFrame(stop, 'out', VEHICLE_POCKET_M);
      xs.push(f.x - 1, f.x + 1);
      zs.push(f.z - 2, f.z + 1.5);
    }
  }
  if (xs.length === 0) return undefined;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  return {
    center: [(x0 + x1) / 2, 0.8, (z0 + z1) / 2],
    halfWidth: Math.max(5, (x1 - x0) / 2 + 1.5),
    halfHeight: Math.max(3.5, (z1 - z0) / 2 * 0.8 + 1.8),
    dir: [0.12, 0.72, 0.68],
  };
}

/** A location's code and name, the way a briefing writes them: `QA 10`. */
export function signText(code: number): string {
  const loc = locationByCode(code);
  if (!loc) return String(code);
  if (loc.kind === 'wrap-in') return 'WRAP 50>51';
  return `${loc.name} ${code}`;
}
