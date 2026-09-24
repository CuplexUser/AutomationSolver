import { describe, expect, it } from 'vitest';
import { BAY, DC_LOCATIONS, ENTER_MS, PIVOT_MS, bayPos, nearLane } from '@automationsolver/shared';
import {
  BAY_M,
  FRONT_M,
  aisleLines,
  routeAhead,
  sectionFocus,
  stationBays,
  stationYaw,
  stationsFor,
  travelYaw,
  vehiclePose,
  vehicleYaw,
  wallSegments,
} from './layout';

const ALL = new Set(DC_LOCATIONS.map((l) => l.code));
const byCode = (code: number) => stationsFor(ALL).find((s) => s.code === code)!;

describe('the hub floor plan', () => {
  it('stands every station across its apron from the aisle, facing away from it', () => {
    // QA is on the north side of the north aisle: it runs north, toward -z.
    const qa = byCode(10);
    expect(qa.frame.x).toBeCloseTo(8.6);
    expect(qa.frame.z).toBeCloseTo(-FRONT_M);
    expect(qa.frame.dir).toEqual([0, -1]);
    // F1 is loaded from the north aisle on its south side: it runs south, toward +z.
    const f1 = byCode(31);
    expect(f1.frame.dir).toEqual([0, 1]);
    expect(f1.frame.z).toBeCloseTo(FRONT_M);
  });

  it('makes a flow lane exactly as long as the space between its load face and its pick face', () => {
    // The lane's far end must land at the south aisle's station front, or the
    // vehicle collecting from its front would be reaching into rollers.
    const f1 = byCode(31);
    expect(f1.frame.z + f1.depth).toBeCloseTo(10.1 - FRONT_M);
  });

  it('builds only what the puzzle built, and gives the wrapper outfeed no station of its own', () => {
    const codes = stationsFor(new Set([1, 10, 50, 51, 61])).map((s) => s.code);
    expect(codes).toEqual([1, 10, 50, 61]);
    // ...but it does get its own apron and its own code on the floor.
    const aprons = stationBays(stationsFor(new Set([50, 51]))).map((b) => b.code);
    expect(aprons.sort()).toEqual([50, 51]);
  });

  it('turns a station so its local -z runs into the bay', () => {
    // three's rotation about Y by yaw maps local (0, 0, -1) to (-sin, 0, -cos).
    for (const dir of [[0, -1], [0, 1], [1, 0], [-1, 0]] as [number, number][]) {
      const yaw = stationYaw(dir);
      expect(-Math.sin(yaw)).toBeCloseTo(dir[0]);
      expect(-Math.cos(yaw)).toBeCloseTo(dir[1]);
    }
  });

  it('paints no aisle line into a junction', () => {
    const { edges } = aisleLines();
    for (const r of edges) {
      // Every junction is a 2.8 m box: no edge line may reach into one.
      for (const [jx, jz] of [[0, 0], [16, 0], [26, 0], [0, 10.1], [16, 10.1], [26, 10.1]]) {
        const inX = Math.abs(r.x - jx) < r.w / 2 + 1.4 - 0.01;
        const inZ = Math.abs(r.z - jz) < r.d / 2 + 1.4 - 0.01;
        const overlapX = r.x - r.w / 2 < jx + 1.39 && r.x + r.w / 2 > jx - 1.39;
        const overlapZ = r.z - r.d / 2 < jz + 1.39 && r.z + r.d / 2 > jz - 1.39;
        expect(inX && inZ && overlapX && overlapZ).toBe(false);
      }
    }
  });
});

describe('vehicle poses come from the plant state alone', () => {
  it('drives a vehicle in its lane, body first', () => {
    // Lane 0 is the north aisle, eastbound, 700 mm right of the centerline (south).
    const p = vehiclePose({ v0S: 'drive', v0E: 0, v0Pos: 5000 }, 0);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(6.4);
    expect(p.z).toBeCloseTo(0.7);
    // Heading east with the forks trailing: forks (+x) point west.
    expect(p.yaw).toBeCloseTo(travelYaw(0));
    expect(Math.cos(p.yaw)).toBeCloseTo(-1);
  });

  it('parks a vehicle in its bay, forks toward the station', () => {
    const p = vehiclePose({ v0S: 'hold', v0Pk: BAY.QA }, 0);
    expect(p.x).toBeCloseTo(8.6);
    expect(p.z).toBeCloseTo(-BAY_M);
    expect(p.yaw).toBeCloseTo(vehicleYaw(0, -1));
  });

  it('pivots on the lane first, then reverses in', () => {
    const lane = nearLane(BAY.QA);
    const at = bayPos(BAY.QA, lane);
    const pivoted = vehiclePose({ v0S: 'enter', v0Pk: BAY.QA, v0E: lane, v0Pos: at, v0T: PIVOT_MS }, 0);
    expect(pivoted.z).toBeCloseTo(-0.7);
    expect(Math.cos(pivoted.yaw)).toBeCloseTo(Math.cos(vehicleYaw(0, -1)));
    expect(Math.sin(pivoted.yaw)).toBeCloseTo(Math.sin(vehicleYaw(0, -1)));
    const half = vehiclePose({ v0S: 'enter', v0Pk: BAY.QA, v0E: lane, v0Pos: at, v0T: (PIVOT_MS + ENTER_MS) / 2 }, 0);
    expect(half.z).toBeLessThan(-0.7);
    expect(half.z).toBeGreaterThan(-BAY_M);
  });

  it('draws the route still ahead, ending in the bay', () => {
    const m = { v0S: 'drive', v0Leg: 'dst', v0To: 10, v0E: 1, v0Pos: 1000, v0Rt: '1', v0Ri: 0 };
    const pts = routeAhead(m, 0);
    expect(pts.length).toBeGreaterThan(2);
    const [x, z] = pts[pts.length - 1];
    expect(x).toBeCloseTo(8.6);
    expect(z).toBeCloseTo(-BAY_M);
    expect(routeAhead({ v0S: 'park' }, 0)).toEqual([]);
  });

  it('hides a vehicle the puzzle does not have', () => {
    expect(vehiclePose({ v2S: 'off' }, 2).visible).toBe(false);
  });
});

describe('the building', () => {
  it('cuts each dock door out of its wall run', () => {
    expect(wallSegments(0, 10, [[6, 7], [2, 3]])).toEqual([
      [0, 2],
      [3, 6],
      [7, 10],
    ]);
    expect(wallSegments(0, 10, [])).toEqual([[0, 10]]);
  });

  it('frames a section around the floor it owns', () => {
    const stations = stationsFor(ALL);
    const store = sectionFocus('STORE', stations)!;
    // The flow lanes (x 3.7 to 8.1) and the drive-in lanes (to x 12.9) are all in frame.
    expect(store.center[0] - store.halfWidth).toBeLessThan(3.7);
    expect(store.center[0] + store.halfWidth).toBeGreaterThan(12.9);
    expect(sectionFocus('NOT A SECTION', stations)).toBeUndefined();
  });
});
