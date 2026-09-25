import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { captionAt, CAPTIONS_FROM_S, decodeShift, pathParam, shiftAt, type RecordedShift } from '../intro/cinema';
import { INTRO_S, SHIFT_SPEED, SHOTS } from './intro';
import { buildHubPlant } from './plant';
import { kitTree, stubCanvas } from './testKit';

stubCanvas();

const recording = JSON.parse(
  readFileSync(new URL('../../../../public/intro/dc-hub-shift.json', import.meta.url), 'utf8'),
) as RecordedShift;
const frames = decodeShift(recording);
const times = [...SHOTS.map((s) => s.at), INTRO_S];

describe('the fly-in path', () => {
  it('starts at the first shot, passes every shot on time and ends at the handover', () => {
    expect(pathParam(0, times)).toBe(0);
    SHOTS.forEach((s, i) => expect(pathParam(s.at, times)).toBeCloseTo(i / SHOTS.length, 9));
    expect(pathParam(INTRO_S, times)).toBe(1);
  });

  it('only ever moves forward', () => {
    let last = -1;
    for (let t = 0; t <= INTRO_S; t += 0.01) {
      const u = pathParam(t, times);
      expect(u).toBeGreaterThanOrEqual(last);
      last = u;
    }
  });

  it('keeps the captions off the title card, then shows each in turn', () => {
    expect(captionAt(CAPTIONS_FROM_S - 0.01, SHOTS)).toBe(-1);
    const seen = new Set<number>();
    for (let t = CAPTIONS_FROM_S; t <= INTRO_S; t += 0.05) seen.add(captionAt(t, SHOTS));
    expect([...seen]).toEqual(SHOTS.flatMap((s, i) => (s.caption ? [i] : [])));
  });
});

describe('the recorded shift', () => {
  it('covers the whole fly-in at its playback speed', () => {
    expect((frames.length - 1) * recording.dt).toBeGreaterThanOrEqual(INTRO_S * SHIFT_SPEED * 1000);
  });

  it('is the whole hub with its full fleet', () => {
    expect(frames[0].locs).toBe('1,2,10,11,21,22,31,32,41,42,43,61,62,70');
    expect(frames[0].fleet).toBe(3);
  });

  /**
   * The recorder's window and the outbound shot are tuned together: OUT1's full
   * trailer pulls away while that caption is up. Re-recording, or re-timing the
   * shots, without the other would cut to an empty yard.
   */
  it("has OUT1's truck pulling away during the outbound shot", () => {
    const outbound = SHOTS.findIndex((s) => s.caption?.title === 'Outbound');
    const leaves = frames.findIndex((m, i) => i > 0 && m.t61 === 'away' && frames[i - 1].t61 !== 'away');
    expect(leaves).toBeGreaterThan(0);
    const t = (leaves * recording.dt) / 1000 / SHIFT_SPEED;
    expect(captionAt(t, SHOTS)).toBe(outbound);
  });

  it('poses through the real scene, every vehicle on the floor and gliding between scans', () => {
    const plant = buildHubPlant(kitTree(), String(frames[0].locs), 3);
    const agvs: THREE.Object3D[] = [];
    plant.group.traverse((o) => {
      if (o.getObjectByName('AgvForks') && o.parent === plant.group) agvs.push(o);
    });
    expect(agvs).toHaveLength(3);
    for (let t = 0; t <= INTRO_S; t += 0.25) {
      const { m, next, f } = shiftAt(frames, recording.dt, t, SHIFT_SPEED);
      plant.pose(m, 1 / 60, { next, f });
      for (const a of agvs) {
        expect(a.visible).toBe(true);
        expect(Number.isFinite(a.position.x) && Number.isFinite(a.position.z)).toBe(true);
      }
    }
    plant.dispose();
  });
});
