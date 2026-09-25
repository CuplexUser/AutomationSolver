import type { IntroScript, Shot } from '../intro/cinema';

/**
 * The excavator line fly-in: a camera path down the whole line, running.
 *
 * What it shows is a real run, not a staged one: `public/intro/line-shift.json`
 * is 30 s of the capstone's "A shift" on its tuned sections, recorded by
 * `scripts/record-line-intro.ts` and replayed here through the scene itself. The
 * player sees the plant the category ends on, every station working and a
 * machine leaving the test pad every seven seconds, before the view settles on
 * the section they are about to write.
 *
 * This file is the line's script and nothing else; the path, the captions and
 * the replay are the shared fly-in machinery in `../intro/`.
 */

/**
 * The replay's playback rate. The line's cycle is slow at 1x from a camera that
 * is moving; at 1.5x a part visibly travels while its shot is up. The recorder's
 * window is chosen for this rate (see `record-line-intro.ts`).
 */
export const SHIFT_SPEED = 1.5;

/** How long the fly-in lasts, from the first frame to the handover. */
export const INTRO_S = 19.5;

/**
 * The shots, in plant meters (x east, z south; row A along the north wall, row B
 * along the south, the aisle at z -4..0). The story follows the steel: welded,
 * stored, painted, married up on the jig, proven on the test pad, and out of the
 * load port on a lorry. The last shot is timed to the first lorry pulling away
 * full in the recording.
 *
 * The rules `camera.tsx` sets for the section presets hold here too. The station
 * shots stand in the aisle at 3 to 4 m, under the services (5.8 m) and the portal
 * beam (4.8 m), and each looks into its cell through the side it is open on: the
 * weld bay and the store from the south, the booth through its south glazing,
 * assembly from the north. The dispatch shot stands outside, off the apron the
 * lorry drives out on.
 */
export const SHOTS: readonly Shot[] = [
  { at: 0, pos: [38, 26, 40], target: [-2, 0, -2] },
  {
    at: 3.2,
    pos: [-12, 3.6, -1.5],
    target: [-21, 1.2, -12],
    caption: { title: 'Weld bay', line: 'Frames and booms, welded on a turning positioner' },
  },
  {
    at: 5.8,
    pos: [-8, 3.4, 0.5],
    target: [-5, 1.6, -11],
    caption: { title: 'Rack store', line: 'Four gravity lanes and a portal robot over the aisle' },
  },
  {
    at: 8.4,
    pos: [11, 3.0, -0.5],
    target: [7.5, 1.8, -8],
    caption: { title: 'Paint shop', line: "Sprayed in the order's color, then cured in the oven" },
  },
  {
    at: 11.0,
    pos: [21, 3.8, -1],
    target: [14, 1.4, 6.5],
    caption: { title: 'Final assembly', line: 'A frame and a boom married up on the jig' },
  },
  {
    at: 13.6,
    pos: [3.5, 3.4, 0.5],
    target: [-3, 1.2, 11],
    caption: { title: 'Test pad', line: 'Every machine run up and proven before it ships' },
  },
  {
    at: 16.2,
    pos: [8, 6, 31],
    target: [-13, 1.2, 19],
    caption: { title: 'Dispatch', line: 'Loaded at the port and driven off by the lorry' },
  },
];

export const LINE_INTRO: IntroScript = {
  shots: SHOTS,
  duration: INTRO_S,
  speed: SHIFT_SPEED,
  // Base-relative, so the deployed build finds it under whatever path it is served from.
  url: `${import.meta.env.BASE_URL}intro/line-shift.json`,
  seenKey: 'excavatorLine.introSeen',
  title: {
    eyebrow: 'Where this category ends',
    name: 'Excavator Line',
    blurb: 'The whole line on a tuned program: every station working, a machine shipped every seven seconds.',
  },
};

/** The coils the scene draws from beside the machine image, folded into each recorded frame. */
export function introOutputs(frame: Record<string, unknown>): Record<string, boolean> {
  return { Y3: frame.Y3 === true, Y14: frame.Y14 === true, Y16: frame.Y16 === true };
}
