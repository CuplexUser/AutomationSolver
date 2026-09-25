import type { MachineState } from '@automationsolver/shared';

/**
 * The parts of a fly-in that do not care which plant it flies over.
 *
 * A fly-in is a camera path through a list of shots, a caption per shot, and a
 * real recorded run replayed underneath (`scripts/record-*-intro.ts`). Each view
 * that has one keeps its own shots and recording beside its scene
 * (`distribution/intro.ts`, `factoryLine/intro.ts`); the arithmetic lives here,
 * pure, so the director (`IntroDirector.tsx`) only asks it where the camera is
 * and which scan to draw at a given time into the intro.
 */

export interface Shot {
  /** When the camera passes through this pose, in seconds into the intro. */
  at: number;
  pos: [number, number, number];
  target: [number, number, number];
  /** The caption shown while the camera is nearest this shot; none for the ends. */
  caption?: { title: string; line: string };
}

/** Everything a view hands the shared fly-in machinery about its own intro. */
export interface IntroScript {
  shots: readonly Shot[];
  /** How long the fly-in lasts, from the first frame to the handover. */
  duration: number;
  /** The replay's playback rate against the recording's own time. */
  speed: number;
  /** The recording, base-relative so a deployed build finds it. */
  url: string;
  /** The `localStorage` key that remembers this viewer has seen it. */
  seenKey: string;
  /** The title card. */
  title: { eyebrow: string; name: string; blurb: string };
}

/**
 * Where a time falls on the path: the index of the shot it is leaving and how far
 * it is toward the next, as one number `u` in 0..1 along a curve through every
 * shot and then `end`. The first leg eases in and the last eases out, each
 * meeting the legs beside it at full speed so the flight never lurches.
 */
export function pathParam(t: number, times: readonly number[]): number {
  const n = times.length;
  if (t <= times[0]) return 0;
  if (t >= times[n - 1]) return 1;
  let k = 0;
  while (k < n - 2 && t >= times[k + 1]) k++;
  let s = (t - times[k]) / (times[k + 1] - times[k]);
  // 2s^2 - s^3 leaves at rest and arrives at slope 1; its mirror does the reverse.
  if (k === 0) s = 2 * s * s - s * s * s;
  else if (k === n - 2) s = 1 - (2 * (1 - s) ** 2 - (1 - s) ** 3);
  return (k + s) / (n - 1);
}

/** When the first caption may show: the title card (`machine-view.css`) is gone by then. */
export const CAPTIONS_FROM_S = 3.0;

/** The shot whose caption is showing at time `t`: the nearest one with a caption. */
export function captionAt(t: number, shots: readonly Shot[]): number {
  if (t < CAPTIONS_FROM_S) return -1;
  let best = -1;
  let bestD = Infinity;
  shots.forEach((s, i) => {
    if (!s.caption) return;
    const d = Math.abs(t - s.at);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// --- the recorded run ------------------------------------------------------------------

export interface RecordedShift {
  source: string;
  dt: number;
  first: MachineState;
  deltas: MachineState[];
}

/** Every scan of the recording, each one whole. */
export function decodeShift(rec: RecordedShift): MachineState[] {
  const frames: MachineState[] = [rec.first];
  for (const d of rec.deltas) frames.push({ ...frames[frames.length - 1], ...d });
  return frames;
}

/**
 * The scan to draw `t` seconds into the intro at playback rate `speed`, the one
 * after it and how far between them, for a scene that blends across scans. Past
 * the end of the recording it holds the last scan.
 */
export function shiftAt(
  frames: readonly MachineState[],
  dtMs: number,
  t: number,
  speed: number,
): { i: number; m: MachineState; next: MachineState; f: number } {
  const pos = Math.max(0, (t * speed * 1000) / dtMs);
  const i = Math.min(frames.length - 1, Math.floor(pos));
  const j = Math.min(frames.length - 1, i + 1);
  return { i, m: frames[i], next: frames[j], f: i === j ? 0 : pos - i };
}
