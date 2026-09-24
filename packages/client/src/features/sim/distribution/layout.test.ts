import { describe, expect, it } from 'vitest';
import { DC_LOCATIONS, ENTER_MS } from '@automationsolver/shared';
import {
  POCKET_M,
  VEHICLE_POCKET_M,
  sectionFocus,
  stationYaw,
  stationsFor,
  vehiclePose,
  vehicleYaw,
  wallSegments,
} from './layout';

const ALL = new Set(DC_LOCATIONS.map((l) => l.code));
const byCode = (code: number) => stationsFor(ALL).find((s) => s.code === code)!;

describe('the hub floor plan', () => {
  it('stands every station a pocket off its own stop, facing away from the loop', () => {
    // QA is on the north leg, outside: it runs north, toward -z.
    const qa = byCode(10);
    expect(qa.frame.x).toBeCloseTo(5.5);
    expect(qa.frame.z).toBeCloseTo(-POCKET_M);
    expect(qa.frame.dir).toEqual([0, -1]);
    // F1 is loaded from the north leg on the inside: it runs south, toward +z.
    const f1 = byCode(31);
    expect(f1.frame.dir).toEqual([0, 1]);
    expect(f1.frame.z).toBeCloseTo(POCKET_M);
  });

  it('makes a flow lane exactly as long as the space between its load face and its pick face', () => {
    // The lane's far end must land a pocket short of the south leg, or the
    // vehicle collecting from its front would be reaching into rollers.
    const f1 = byCode(31);
    expect(f1.frame.z + f1.depth).toBeCloseTo(8 - POCKET_M);
  });

  it('builds only what the puzzle built, and gives the wrapper outfeed no station of its own', () => {
    const codes = stationsFor(new Set([1, 10, 50, 51, 61])).map((s) => s.code);
    expect(codes).toEqual([1, 10, 50, 61]);
  });

  it('turns a station so its local -z runs into the pocket', () => {
    // three's rotation about Y by yaw maps local (0, 0, -1) to (-sin, 0, -cos).
    for (const dir of [[0, -1], [0, 1], [1, 0], [-1, 0]] as [number, number][]) {
      const yaw = stationYaw(dir);
      expect(-Math.sin(yaw)).toBeCloseTo(dir[0]);
      expect(-Math.cos(yaw)).toBeCloseTo(dir[1]);
    }
  });
});

describe('vehicle poses come from the plant state alone', () => {
  it('puts a driving vehicle on the loop, forks along the direction of travel', () => {
    const p = vehiclePose({ v0S: 'drive', v0Pos: 10_000 }, 0);
    expect(p.visible).toBe(true);
    expect([p.x, p.z]).toEqual([10, 0]);
    // The north leg runs east: forks (+x) east means no turn at all.
    expect(p.yaw).toBeCloseTo(0);
  });

  it('parks a vehicle in its pocket, facing the station', () => {
    const p = vehiclePose({ v0S: 'hold', v0Pk: 5500 }, 0);
    expect(p.x).toBeCloseTo(5.5);
    expect(p.z).toBeCloseTo(-VEHICLE_POCKET_M);
    expect(p.yaw).toBeCloseTo(vehicleYaw(0, -1));
  });

  it('turns in halfway through entering a pocket', () => {
    const p = vehiclePose({ v0S: 'enter', v0Pk: 5500, v0T: ENTER_MS / 2 }, 0);
    expect(p.z).toBeCloseTo(-VEHICLE_POCKET_M / 2);
    expect(p.yaw).toBeCloseTo(vehicleYaw(0, -1) / 2);
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
    // The flow lanes (x 10 to 13) and the drive-in lanes (x 4.5 to 7.5) are all in frame.
    expect(store.center[0] - store.halfWidth).toBeLessThan(4.5);
    expect(store.center[0] + store.halfWidth).toBeGreaterThan(13);
    expect(sectionFocus('NOT A SECTION', stations)).toBeUndefined();
  });
});
