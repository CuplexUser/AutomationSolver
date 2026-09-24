import type { MachineState } from '@automationsolver/shared';

/**
 * The Cold Chain Hub fly-in: a camera path over the whole hub, running.
 *
 * What it shows is a real run, not a staged one: `public/intro/dc-hub-shift.json`
 * is a stretch of the capstone solved by its canonical sections, recorded by
 * `scripts/record-dc-intro.ts` and replayed here through the scene's own `pose`.
 * The player sees the floor the category ends on, every station built and every
 * vehicle busy, before the view settles on the puzzle they are about to solve.
 *
 * Everything in this file is pure: the director (`IntroDirector.tsx`) asks it
 * where the camera is and which scan to draw at a given time into the intro.
 */

export interface Shot {
  /** When the camera passes through this pose, in seconds into the intro. */
  at: number;
  pos: [number, number, number];
  target: [number, number, number];
  /** The caption shown while the camera is nearest this shot; none for the ends. */
  caption?: { title: string; line: string };
}

/**
 * The replay's playback rate. At 1x a vehicle crossing the hall reads as slow
 * from the heights the camera flies at; at 1.5x the floor looks as busy as it is.
 * The recorder's window is chosen for this rate (see `record-dc-intro.ts`).
 */
export const SHIFT_SPEED = 1.5;

/** How long the fly-in lasts, from the first frame to the handover. */
export const INTRO_S = 19.5;

/**
 * The shots, in hall meters (x east, z south; the yard is west of x = -3).
 * The story follows the goods: in at the north doors and QA, into the ripening
 * rooms, past the fleet at its charger and the racking, and out on a truck. The
 * outbound shot is timed to OUT1's trailer pulling away full in the recording.
 *
 * Every camera position clears what is under it: the walls are 4.6 m and the
 * racking stands inside x 3.7..12.9, z 2.3..7.8, so the path runs along the main
 * aisle and crosses the west wall above 6 m.
 */
export const SHOTS: readonly Shot[] = [
  { at: 0, pos: [-24, 24, 32], target: [6, 0, 3] },
  {
    at: 3.2,
    pos: [12, 6.5, 1],
    target: [5.5, 1, -4.2],
    caption: { title: 'Goods in', line: 'Unloaded at the north doors, checked at QA' },
  },
  {
    at: 6.4,
    pos: [16, 9, 1.5],
    target: [21, 0.5, -4.5],
    caption: { title: 'Ripening rooms', line: 'Filled, sealed, gassed and opened ripe' },
  },
  {
    at: 9.4,
    pos: [25, 5, 10],
    target: [18.5, 0.8, 5],
    caption: { title: 'The fleet', line: 'Three AGVs, one dispatcher, one charger' },
  },
  {
    at: 12.2,
    pos: [16, 7, 13],
    target: [8, 1, 5.5],
    caption: { title: 'Storage', line: 'Flow lanes and drive-in racking' },
  },
  {
    at: 15.5,
    pos: [-12, 7, 16],
    target: [-6, 1.5, 5],
    caption: { title: 'Outbound', line: 'Trailers loaded in drop order' },
  },
];

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
export function captionAt(t: number, shots: readonly Shot[] = SHOTS): number {
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

// --- the recorded shift ----------------------------------------------------------------

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
 * The scan to draw `t` seconds into the intro, the one after it and how far
 * between them, for the scene to blend the vehicles across. Past the end of the
 * recording it holds the last scan.
 */
export function shiftAt(
  frames: readonly MachineState[],
  dtMs: number,
  t: number,
): { m: MachineState; next: MachineState; f: number } {
  const pos = Math.max(0, (t * SHIFT_SPEED * 1000) / dtMs);
  const i = Math.min(frames.length - 1, Math.floor(pos));
  const j = Math.min(frames.length - 1, i + 1);
  return { m: frames[i], next: frames[j], f: i === j ? 0 : pos - i };
}
