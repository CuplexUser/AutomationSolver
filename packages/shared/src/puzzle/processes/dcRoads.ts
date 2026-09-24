/**
 * The Cold Chain Hub's roads: the aisles the forklifts drive, the junctions
 * where aisles meet, the bays they pull into, and the shortest way between any
 * two of them.
 *
 * ## The floor
 *
 * Plan coordinates, millimeters, x east and y south (the scene maps them to
 * three's x and z unchanged). Every aisle is **two lanes**, one each way, and
 * traffic keeps right: the lane a vehicle drives in is 700 mm to the right of
 * the aisle's centerline, and an aisle is 2.8 m from edge line to edge line.
 * Aisles meet at **junctions**, each a 2.8 m box. A lane ends at the box's edge,
 * and a vehicle crosses the box on a *connector*: straight on, a tight right
 * turn round the near corner, or a wide left turn across the other lane. Nobody
 * turns round in a junction, and nobody needs to, because every bay can be left
 * in either direction.
 *
 * ## Bays
 *
 * Every place a vehicle works is a **bay** off one side of an aisle: a station's
 * front edge stands 2.25 m from the centerline, which leaves a 0.85 m apron
 * between the aisle's edge line and the station, and a vehicle working there
 * stands wholly off the road. A vehicle arrives on the **near lane** (the one on
 * the bay's side, so the bay is on its right), stops level with the bay, pivots
 * a quarter turn and reverses in fork first. It leaves forward, onto the near
 * lane or straight across it onto the far lane, whichever way its next trip is
 * shorter, and pivots onto its new heading there.
 *
 * ## Edges and routes
 *
 * Lanes and connectors are both **edges**: a vehicle's place on the floor is an
 * edge and a distance along it, and a route is a list of edges. Routes are found
 * by Dijkstra over whole edges, costed in the time a vehicle takes to drive them
 * (turns are slow), with every tie broken on edge index, so a route is the same
 * route everywhere the plant runs. Nothing in this file keeps state.
 */

// --- Dimensions -------------------------------------------------------------------------------

/** From an aisle's centerline to the middle of either lane. */
export const LANE_OFFSET_MM = 700;
/** From an aisle's centerline to its edge line: an aisle is two lanes, 2.8 m wide. A junction's box is as wide. */
export const AISLE_HALF_MM = 1400;
/** From an aisle's centerline to the front edge of a station, across the apron. */
export const STATION_FRONT_MM = 2250;
/** From an aisle's centerline to a vehicle standing in a bay (the middle of its footprint). */
export const BAY_MM = 2200;
/** An outbound dock's front edge is deeper, so the dock door is behind the vehicle's bay. */
export const DOCK_OUT_FRONT_MM = 2700;

// --- Junctions and aisles -----------------------------------------------------------------------

export interface JunctionDef {
  name: string;
  x: number;
  y: number;
}

/**
 * The junctions. Four corners and a cross aisle between the north and south
 * aisles, so a vehicle on the south side of the hub is never more than half the
 * floor from the north side.
 */
export const DC_JUNCTIONS: readonly JunctionDef[] = [
  { name: 'NW', x: 0, y: 0 },
  { name: 'CN', x: 16_000, y: 0 },
  { name: 'NE', x: 26_000, y: 0 },
  { name: 'SW', x: 0, y: 10_100 },
  { name: 'CS', x: 16_000, y: 10_100 },
  { name: 'SE', x: 26_000, y: 10_100 },
];

export interface AisleDef {
  name: string;
  /** Junction indices. An aisle runs from its west or north end, `a`, to `b`. */
  a: number;
  b: number;
}

/**
 * The aisles. The north and south aisles are 10.1 m apart, center to center,
 * which is a flow lane's 5.6 m plus a station front's 2.25 m at each end: the
 * flow lanes span the block between them, loaded from the north and picked
 * from the south.
 */
export const DC_AISLES: readonly AisleDef[] = [
  { name: 'N1', a: 0, b: 1 },
  { name: 'N2', a: 1, b: 2 },
  { name: 'E', a: 2, b: 5 },
  { name: 'S1', a: 3, b: 4 },
  { name: 'S2', a: 4, b: 5 },
  { name: 'W', a: 0, b: 3 },
  { name: 'C', a: 1, b: 4 },
];

// --- Bays ---------------------------------------------------------------------------------------

export interface BayDef {
  /** What the floor paint and a stall message call it. */
  name: string;
  aisle: number;
  /** Millimeters along the aisle from its `a` end to the bay's axis. */
  at: number;
  /** 1: on the right of the aisle's a-to-b direction; -1: on its left. */
  side: 1 | -1;
}

/**
 * Every bay on the floor. A location has one (a room is filled and emptied
 * through one door) or two (a flow lane is loaded from one aisle and picked
 * from another); the depot has one per vehicle. Indices are what the plant's
 * state stores, so the list only ever grows at the end.
 */
export const DC_BAYS: readonly BayDef[] = [
  // North aisle, west half. Goods in, QA and quarantine on the north side...
  { name: 'IN1', aisle: 0, at: 3800, side: -1 },
  { name: 'IN2', aisle: 0, at: 6200, side: -1 },
  { name: 'QA', aisle: 0, at: 8600, side: -1 },
  { name: 'QUARANTINE', aisle: 0, at: 11_000, side: -1 },
  // ...and the flow lanes' load faces on the south side.
  { name: 'F1 load', aisle: 0, at: 4400, side: 1 },
  { name: 'F2 load', aisle: 0, at: 5900, side: 1 },
  { name: 'F3 load', aisle: 0, at: 7400, side: 1 },
  // North aisle, east half: the ripening rooms.
  { name: 'R1', aisle: 1, at: 3600, side: -1 },
  { name: 'R2', aisle: 1, at: 6200, side: -1 },
  // South aisle, west end, outside: the stretch wrapper, its outfeed 3 m further
  // west, next to the outbound docks it feeds.
  { name: 'WRAP IN', aisle: 3, at: 6400, side: 1 },
  { name: 'WRAP OUT', aisle: 3, at: 3400, side: 1 },
  // South aisle, north side: the flow lanes' pick faces and the drive-in lanes.
  { name: 'F1 pick', aisle: 3, at: 4400, side: -1 },
  { name: 'F2 pick', aisle: 3, at: 5900, side: -1 },
  { name: 'F3 pick', aisle: 3, at: 7400, side: -1 },
  { name: 'L1', aisle: 3, at: 9200, side: -1 },
  { name: 'L2', aisle: 3, at: 10_700, side: -1 },
  { name: 'L3', aisle: 3, at: 12_200, side: -1 },
  // The cross aisle, east side: the fleet's corner, the charger and a bay per vehicle.
  { name: 'CHARGER', aisle: 6, at: 3000, side: -1 },
  { name: 'P1', aisle: 6, at: 4500, side: -1 },
  { name: 'P2', aisle: 6, at: 6000, side: -1 },
  { name: 'P3', aisle: 6, at: 7500, side: -1 },
  // West aisle, outside: the outbound docks, trucks backed onto the wall behind them.
  { name: 'OUT2', aisle: 5, at: 3600, side: 1 },
  { name: 'OUT1', aisle: 5, at: 6500, side: 1 },
];

export const BAY = Object.fromEntries(DC_BAYS.map((b, i) => [b.name, i])) as Record<string, number>;

// --- Geometry ------------------------------------------------------------------------------------

interface Vec {
  x: number;
  y: number;
}

/** The unit direction of an aisle from `a` to `b`. Aisles are axis-aligned. */
export function aisleDir(aisle: number): Vec {
  const { a, b } = DC_AISLES[aisle];
  const A = DC_JUNCTIONS[a];
  const B = DC_JUNCTIONS[b];
  return { x: Math.sign(B.x - A.x), y: Math.sign(B.y - A.y) };
}

export function aisleLength(aisle: number): number {
  const { a, b } = DC_AISLES[aisle];
  const A = DC_JUNCTIONS[a];
  const B = DC_JUNCTIONS[b];
  return Math.abs(B.x - A.x) + Math.abs(B.y - A.y);
}

/** Right of a heading, in plan (y south): east's right is south. */
const rightOf = (d: Vec): Vec => ({ x: 0 - d.y, y: d.x });

/** A bay's frame: the point on the aisle's centerline level with it, and the unit normal pointing into it. */
export function bayFrame(bay: number): { x: number; y: number; nx: number; ny: number } {
  const def = DC_BAYS[bay];
  const A = DC_JUNCTIONS[DC_AISLES[def.aisle].a];
  const d = aisleDir(def.aisle);
  const r = rightOf(d);
  return { x: A.x + d.x * def.at, y: A.y + d.y * def.at, nx: r.x * def.side, ny: r.y * def.side };
}

// --- Edges ---------------------------------------------------------------------------------------

export type EdgeKind = 'lane' | 'straight' | 'right' | 'left';

export interface Edge {
  id: number;
  kind: EdgeKind;
  len: number;
  /** Where it starts, and its heading there (a unit vector in plan). */
  x0: number;
  y0: number;
  d0: Vec;
  /** Where it ends, and its heading there. */
  x1: number;
  y1: number;
  d1: Vec;
  /** A lane's aisle, and which way it runs: 1 from `a` to `b`, -1 back. -1/0 on a connector. */
  aisle: number;
  dir: 1 | -1 | 0;
  /** A connector's junction; for a lane, the junction it ends at. */
  junction: number;
  /** A lane's junction at its start. */
  from: number;
  /** Edges a vehicle may take from the end of this one. */
  next: number[];
  /** For an arc, its center and radius. */
  cx: number;
  cy: number;
  r: number;
  /** Top speed on it, mm/s. */
  vmax: number;
}

/** Top speed on a lane or straight across a junction, mm/s. */
export const VMAX_MM_S = 3000;
/**
 * Round a turn, the speed that keeps sideways acceleration at 1.6 m/s², so a
 * laden mast does not sway: the tight right turn is taken at about 1.1 m/s and
 * the wide left turn across the junction at about 1.8 m/s.
 */
export const LATERAL_MM_S2 = 1600;

/** The top speed an edge allows, mm/s. */
export function edgeSpeed(edge: number): number {
  const e = DC_EDGES[edge];
  return e.kind === 'left' || e.kind === 'right' ? e.vmax : VMAX_MM_S;
}

function buildEdges(): Edge[] {
  const edges: Edge[] = [];
  const blank = { cx: 0, cy: 0, r: 0, next: [] as number[], vmax: VMAX_MM_S };
  // Lanes: two per aisle, a-to-b first.
  DC_AISLES.forEach((aisle, ai) => {
    const A = DC_JUNCTIONS[aisle.a];
    const B = DC_JUNCTIONS[aisle.b];
    const d = aisleDir(ai);
    for (const dir of [1, -1] as const) {
      const [P, Q] = dir === 1 ? [A, B] : [B, A];
      const h = { x: d.x * dir, y: d.y * dir };
      const o = rightOf(h);
      const x0 = P.x + h.x * AISLE_HALF_MM + o.x * LANE_OFFSET_MM;
      const y0 = P.y + h.y * AISLE_HALF_MM + o.y * LANE_OFFSET_MM;
      const x1 = Q.x - h.x * AISLE_HALF_MM + o.x * LANE_OFFSET_MM;
      const y1 = Q.y - h.y * AISLE_HALF_MM + o.y * LANE_OFFSET_MM;
      edges.push({
        ...blank,
        next: [],
        id: edges.length,
        kind: 'lane',
        len: Math.abs(x1 - x0) + Math.abs(y1 - y0),
        x0,
        y0,
        d0: h,
        x1,
        y1,
        d1: h,
        aisle: ai,
        dir,
        junction: dir === 1 ? aisle.b : aisle.a,
        from: dir === 1 ? aisle.a : aisle.b,
      });
    }
  });
  const lanes = edges.slice();
  // Connectors: from every lane ending at a junction to every lane leaving it
  // along another aisle.
  for (const inn of lanes) {
    for (const out of lanes) {
      if (out.from !== inn.junction || out.aisle === inn.aisle) continue;
      const a = inn.d1;
      const b = out.d0;
      let kind: EdgeKind = 'straight';
      let len = Math.abs(out.x0 - inn.x1) + Math.abs(out.y0 - inn.y1);
      let cx = 0;
      let cy = 0;
      let r = 0;
      if (a.x !== b.x || a.y !== b.y) {
        // A quarter turn: right if the new heading is the old one's right.
        const rt = rightOf(a);
        kind = rt.x === b.x && rt.y === b.y ? 'right' : 'left';
        r = Math.abs(out.x0 - inn.x1);
        // The arc's center is `r` from the lane's end, toward the inside of the turn.
        const side = kind === 'right' ? rt : { x: 0 - rt.x, y: 0 - rt.y };
        cx = inn.x1 + side.x * r;
        cy = inn.y1 + side.y * r;
        len = Math.round((Math.PI * r) / 2);
      }
      const id = edges.length;
      edges.push({
        id,
        kind,
        len,
        x0: inn.x1,
        y0: inn.y1,
        d0: a,
        x1: out.x0,
        y1: out.y0,
        d1: b,
        aisle: -1,
        dir: 0,
        junction: inn.junction,
        from: inn.junction,
        next: [out.id],
        cx,
        cy,
        r,
        vmax: r > 0 ? Math.floor(Math.sqrt(LATERAL_MM_S2 * r)) : VMAX_MM_S,
      });
      inn.next.push(id);
    }
  }
  return edges;
}

export const DC_EDGES: readonly Edge[] = buildEdges();

/** The lane an aisle carries in one direction: 1 from `a` to `b`, -1 back. */
export function laneOf(aisle: number, dir: 1 | -1): number {
  return aisle * 2 + (dir === 1 ? 0 : 1);
}

/** The lane a bay is reached from: the one it is on the right of. */
export function nearLane(bay: number): number {
  const def = DC_BAYS[bay];
  return laneOf(def.aisle, def.side === 1 ? 1 : -1);
}

/** The lane across the aisle from a bay. */
export function farLane(bay: number): number {
  const def = DC_BAYS[bay];
  return laneOf(def.aisle, def.side === 1 ? -1 : 1);
}

/** How far along `lane` a vehicle stands when it is level with `bay`. */
export function bayPos(bay: number, lane: number): number {
  const def = DC_BAYS[bay];
  const e = DC_EDGES[lane];
  const at = e.dir === 1 ? def.at : aisleLength(def.aisle) - def.at;
  return at - AISLE_HALF_MM;
}

/** A point on an edge, and the heading there, as an angle: 0 east, positive turning south. */
export function edgePoint(edge: number, s: number): { x: number; y: number; heading: number } {
  const e = DC_EDGES[edge];
  const t = e.len === 0 ? 0 : Math.max(0, Math.min(1, s / e.len));
  if (e.kind === 'lane' || e.kind === 'straight') {
    return { x: e.x0 + (e.x1 - e.x0) * t, y: e.y0 + (e.y1 - e.y0) * t, heading: Math.atan2(e.d0.y, e.d0.x) };
  }
  const a0 = Math.atan2(e.y0 - e.cy, e.x0 - e.cx);
  const a1 = Math.atan2(e.y1 - e.cy, e.x1 - e.cx);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const a = a0 + da * t;
  const h0 = Math.atan2(e.d0.y, e.d0.x);
  return { x: e.cx + Math.cos(a) * e.r, y: e.cy + Math.sin(a) * e.r, heading: h0 + da * t };
}

// --- Routing ------------------------------------------------------------------------------------

/** What an edge costs to drive, in milliseconds at its top speed. */
function edgeCost(edge: number): number {
  return Math.floor((DC_EDGES[edge].len * 1000) / edgeSpeed(edge));
}

/**
 * Extra cost, in milliseconds, of driving onto each edge: what the traffic on it
 * is expected to add. Indexed by edge id; missing entries cost nothing.
 */
export type Congestion = readonly number[];

const NO_TRAFFIC: Congestion = [];

// Scratch for Dijkstra, reused: routes are planned while a grade runs.
const DIST = new Float64Array(DC_EDGES.length);
const PREV = new Int32Array(DC_EDGES.length);
const DONE = new Uint8Array(DC_EDGES.length);

/**
 * The fastest way from `pos` along `start` to `goal` on lane `target`. The route
 * starts with `start`. When the goal is ahead on the same lane that is the whole
 * route; otherwise Dijkstra over whole edges, each costed as the time to drive
 * it plus whatever `traffic` says is on it. Ties go to the lower edge index, so
 * the answer depends on nothing but the floor and the traffic.
 */
export function route(
  start: number,
  pos: number,
  target: number,
  goal: number,
  traffic: Congestion = NO_TRAFFIC,
): { edges: number[]; cost: number } {
  if (start === target && goal >= pos) {
    return { edges: [start], cost: Math.floor(((goal - pos) * 1000) / VMAX_MM_S) };
  }
  const n = DC_EDGES.length;
  const dist = DIST;
  const prev = PREV;
  const done = DONE;
  dist.fill(Infinity);
  prev.fill(-1);
  done.fill(0);
  // Cost to the *start* of each edge.
  const rest = Math.floor(((DC_EDGES[start].len - pos) * 1000) / VMAX_MM_S);
  for (const nx of DC_EDGES[start].next) {
    const c = rest + (traffic[nx] ?? 0);
    if (c < dist[nx]) {
      dist[nx] = c;
      prev[nx] = start;
    }
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] === 0 && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    }
    if (u < 0) break;
    if (u === target) break;
    done[u] = 1;
    const c = dist[u] + edgeCost(u);
    for (const nx of DC_EDGES[u].next) {
      const cn = c + (traffic[nx] ?? 0);
      if (cn < dist[nx]) {
        dist[nx] = cn;
        prev[nx] = u;
      }
    }
  }
  if (dist[target] === Infinity) return { edges: [], cost: Infinity };
  // Walked back from the target. When the goal is behind the vehicle on its own
  // lane, the target *is* the start, and the route goes round the block to it.
  const edges: number[] = [target];
  for (let e = prev[target]; e !== start; e = prev[e]) edges.push(e);
  edges.push(start);
  edges.reverse();
  return { edges, cost: dist[target] + Math.floor((goal * 1000) / VMAX_MM_S) };
}

/** Leaving a bay: forward onto the near lane, or on across it to the far one. */
export const EXIT_NEAR_MS = 1000;
export const EXIT_FAR_MS = 1400;
/** Arriving: a quarter-turn pivot on the lane, then reversing in; from the far lane, across the near one. */
export const ENTER_MS = 1000;
export const ENTER_FAR_MS = 1400;
/** Of the moves in and out, the part spent pivoting on the lane. */
export const PIVOT_MS = 350;

/** The fastest way from `pos` along `start` into `bay`, arriving on whichever lane is quicker. */
export function routeToBay(
  start: number,
  pos: number,
  bay: number,
  traffic: Congestion = NO_TRAFFIC,
): { edges: number[]; cost: number } {
  let best = { edges: [] as number[], cost: Infinity };
  for (const [lane, enter] of [
    [nearLane(bay), ENTER_MS],
    [farLane(bay), ENTER_FAR_MS],
  ] as const) {
    const r = route(start, pos, lane, bayPos(bay, lane), traffic);
    if (r.cost + enter < best.cost) best = { edges: r.edges, cost: r.cost + enter };
  }
  return best;
}

export interface BayRoute {
  /** The lane the vehicle leaves onto. */
  exit: number;
  edges: number[];
  cost: number;
}

/** The fastest way out of bay `from` and into bay `to`, leaving the way `exit` says, or whichever is quicker. */
export function bayToBay(from: number, to: number, exit = -1, traffic: Congestion = NO_TRAFFIC): BayRoute {
  let best: BayRoute = { exit: -1, edges: [], cost: Infinity };
  for (const [lane, extra] of [
    [nearLane(from), EXIT_NEAR_MS],
    [farLane(from), EXIT_FAR_MS],
  ] as const) {
    if (exit >= 0 && lane !== exit) continue;
    const r = routeToBay(lane, bayPos(from, lane), to, traffic);
    const cost = r.cost + extra;
    if (cost < best.cost) best = { exit: lane, edges: r.edges, cost };
  }
  return best;
}

const BAY_ROUTES: BayRoute[][] = DC_BAYS.map((_, a) => DC_BAYS.map((__, b) => bayToBay(a, b)));

/** The fastest route between two bays on an empty floor, worked out once when the module loads. */
export function bayRoute(from: number, to: number): BayRoute {
  return BAY_ROUTES[from][to];
}
