import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captionAt, decodeShift, pathParam, shiftAt, type RecordedShift } from '../intro/cinema';
import { INTRO_S, introOutputs, SHIFT_SPEED, SHOTS } from './intro';

const recording = JSON.parse(
  readFileSync(new URL('../../../../public/intro/line-shift.json', import.meta.url), 'utf8'),
) as RecordedShift;
const frames = decodeShift(recording);
const times = [...SHOTS.map((s) => s.at), INTRO_S];
/** Seconds into the fly-in at which a scan of the recording plays. */
const introTime = (scan: number) => (scan * recording.dt) / 1000 / SHIFT_SPEED;

describe('the line fly-in path', () => {
  it('starts at the first shot, passes every shot on time and ends at the handover', () => {
    expect(pathParam(0, times)).toBe(0);
    SHOTS.forEach((s, i) => expect(pathParam(s.at, times)).toBeCloseTo(i / SHOTS.length, 9));
    expect(pathParam(INTRO_S, times)).toBe(1);
  });

  it('shows every caption in the order the steel travels', () => {
    const seen: number[] = [];
    for (let t = 0; t <= INTRO_S; t += 0.05) {
      const c = captionAt(t, SHOTS);
      if (c >= 0 && seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(seen).toEqual(SHOTS.flatMap((s, i) => (s.caption ? [i] : [])));
  });

  it('keeps every station shot under the services and the portal beam', () => {
    for (const s of SHOTS.slice(1, -1)) expect(s.pos[1]).toBeLessThan(4.6);
  });
});

describe('the recorded line shift', () => {
  it('covers the whole fly-in at its playback speed', () => {
    expect((frames.length - 1) * recording.dt).toBeGreaterThanOrEqual(INTRO_S * SHIFT_SPEED * 1000);
  });

  it('is the line running: machines shipping, and the torch and the gun both working', () => {
    const shipped = frames.map((m) => Number(m.shipped));
    expect(shipped[shipped.length - 1] - shipped[0]).toBeGreaterThanOrEqual(3);
    expect(frames.some((m) => introOutputs(m).Y3)).toBe(true);
    expect(frames.some((m) => introOutputs(m).Y14)).toBe(true);
    expect(frames.every((m) => m.jam === false && m.scrapped === 0)).toBe(true);
  });

  /**
   * The recorder's window and the dispatch shot are tuned together: the first
   * lorry pulls away full while that caption is up. Re-recording, or re-timing
   * the shots, without the other would cut to an empty apron.
   */
  it('has the lorry pulling away during the dispatch shot', () => {
    const dispatch = SHOTS.findIndex((s) => s.caption?.title === 'Dispatch');
    const leaves = frames.findIndex((m, i) => i > 0 && m.truckState === 'leaving' && frames[i - 1].truckState !== 'leaving');
    expect(leaves).toBeGreaterThan(0);
    expect(captionAt(introTime(leaves), SHOTS)).toBe(dispatch);
  });

  it('draws one scan per time and holds the last past the end', () => {
    expect(shiftAt(frames, recording.dt, 0, SHIFT_SPEED).i).toBe(0);
    expect(shiftAt(frames, recording.dt, INTRO_S * 10, SHIFT_SPEED).i).toBe(frames.length - 1);
  });
});
