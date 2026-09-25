import type { IntroScript, Shot } from '../intro/cinema';

/**
 * The Cold Chain Hub fly-in: a camera path over the whole hub, running.
 *
 * What it shows is a real run, not a staged one: `public/intro/dc-hub-shift.json`
 * is a stretch of the capstone solved by its canonical sections, recorded by
 * `scripts/record-dc-intro.ts` and replayed here through the scene's own `pose`.
 * The player sees the floor the category ends on, every station built and every
 * vehicle busy, before the view settles on the puzzle they are about to solve.
 *
 * This file is the hub's script and nothing else; the path, the captions and the
 * replay are the shared fly-in machinery in `../intro/`.
 */

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

export const HUB_INTRO: IntroScript = {
  shots: SHOTS,
  duration: INTRO_S,
  speed: SHIFT_SPEED,
  // Base-relative, so the deployed build finds it under whatever path it is served from.
  url: `${import.meta.env.BASE_URL}intro/dc-hub-shift.json`,
  seenKey: 'coldChain.introSeen',
  title: {
    eyebrow: 'Where this category ends',
    name: 'Cold Chain Hub',
    blurb: 'The whole hub on a solved program: every station built, every vehicle busy.',
  },
};
