import type { Rung } from '../../ladder/types.js';
import { build } from './factory-line-plant.js';

/**
 * The five station programs, each in two forms.
 *
 * `*_PLAIN` is the answer somebody writes first: it runs the line, it never
 * faults, and it leaves a quarter of the plant's output on the floor. `*_TUNED`
 * is the same station after somebody has thought about it, in about the same
 * number of rungs. Neither is a trick — the plain one is what a careful
 * engineer produces in an afternoon, and every second it gives away is given
 * away for a reason that looked like caution at the time.
 *
 * The station puzzles ship TUNED neighbors, so the bay under test really is the
 * one holding the line up. The capstone seeds all six with PLAIN, because there
 * the plant is the puzzle.
 */

const { no, nc, re, out, set, rst, tmr, mov, cmp, rung } = build;

// --- SEC1 WELD ----------------------------------------------------------------

/**
 * The weld shop, plainly: every part gets a frame's treatment.
 *
 * Two passes with a roll over between them, one preset covering both, and a tip
 * changed the moment the field says to. It makes sound frames and sound booms,
 * and it spends a pass, a rotation and a pass of tip life on every boom that
 * only ever needed one run down one side.
 */
export const WELD_PLAIN: Rung[] = [
  rung('w-select', [[no('M10'), out('Y6')]]),
  // A cycle starts with the plant running, the outfeed clear, and a tip that can
  // still lay a pass.
  rung('w-start', [[no('M0'), nc('X10'), nc('X9'), nc('M11'), set('M11')]]),
  // The jaws hold for the whole cycle and open as the release begins. Holding
  // them through the release looks harmless and is not: the fixture would pick
  // up the next blank on the scan the old part left, before the alternating
  // relay had flipped, and weld two of the same kind in a row.
  rung('w-clamp', [[no('M11'), nc('M14'), out('Y2')]]),
  // The two passes, timed on their own conditions rather than off the arc bits.
  // The order of these rungs is load bearing: the step latches are set *above*
  // the coils that read them, so the scan a pass finishes on is the scan the
  // torch goes out. Drive the timer from the arc bit instead and the arc bit is
  // a scan stale — the positioner starts rolling the weldment over with the arc
  // still lit, which is the one thing this fixture will not have.
  // K=13 covers the longest single pass on the fixture, which is the boom's.
  // A preset that only just covers it is a preset that sometimes cuts the arc a
  // scan early, and a pass left at 99 % is a seam the fixture will not release.
  rung('w-t1', [[no('M0'), no('M11'), no('X6'), no('X7'), nc('M13'), tmr('T10', 13)]]),
  rung('w-p1', [[no('T10'), set('M13')]]),
  rung('w-t2', [[no('M0'), no('M11'), no('X6'), no('X8'), no('M13'), nc('M14'), tmr('T11', 13)]]),
  rung('w-p2', [[no('T11'), set('M14')]]),
  rung('w-arc1', [[no('M0'), no('M11'), no('X6'), no('X7'), nc('M13'), out('M20')]]),
  rung('w-arc2', [[no('M0'), no('M11'), no('X6'), no('X8'), no('M13'), nc('M14'), out('M21')]]),
  // One coil for the torch, fed from either pass. Two rungs both driving Y3
  // would be a double coil, and only the second would ever take effect.
  rung('w-torch', [[no('M20'), out('Y3')], [no('M21')]], [{ row: 0, col: 1 }]),
  // Roll it over, and keep Y4 on through pass two: let it go and the positioner
  // rolls straight back to A with the arc still lit.
  rung('w-rotate', [[no('M0'), no('M13'), nc('M14'), out('Y4')]]),
  rung('w-release', [[no('M0'), no('M14'), nc('M16'), out('Y5')]]),
  rung('w-gone', [[no('M14'), no('X10'), set('M16')]]),
  rung('w-done', [
    [no('M16'), out('M17'), rst('T10'), rst('T11'), rst('M11'), rst('M13'), rst('M14'), rst('M16')],
  ]),
  // Alternating relay: arm, clear, apply. Three rungs in this order flip M10
  // exactly once per pulse; two cannot, because the second would see the bit the
  // first just wrote.
  rung('w-alt-arm', [[no('M17'), nc('M10'), set('M18')]]),
  rung('w-alt-clear', [[no('M17'), rst('M10')]]),
  rung('w-alt-apply', [[no('M18'), set('M10'), rst('M18')]]),
  // The tip, changed when the field says so and the fixture is empty.
  rung('w-tip', [[no('M0'), no('X9'), nc('M11'), out('Y7')]]),
];

/**
 * The weld shop, with the two parts on their own schedules.
 *
 * A boom is a stick: one run down one side and it is finished. Skipping its
 * second pass and its rotation takes it from three and nine tenths of a second
 * to two and two tenths, saves a pass off the tip every time, and costs three
 * rungs.
 */
export const WELD_TUNED: Rung[] = [
  rung('w-select', [[no('M10'), out('Y6')]]),
  rung('w-start', [[no('M0'), nc('X10'), nc('X9'), nc('M11'), set('M11')]]),
  rung('w-clamp', [[no('M11'), nc('M14'), out('Y2')]]),
  // One timer per part. M10 is the selector, and the fixture latched it when it
  // clamped, so it is stable for the whole cycle.
  rung('w-t1-f', [[no('M0'), no('M11'), no('X6'), no('X7'), nc('M10'), nc('M13'), tmr('T10', 12)]]),
  rung('w-t1-b', [[no('M0'), no('M11'), no('X6'), no('X7'), no('M10'), nc('M13'), tmr('T12', 13)]]),
  rung('w-p1', [[no('T10'), set('M13')], [no('T12')]], [{ row: 0, col: 1 }]),
  // A boom is finished after that one pass, so it skips straight to the release
  // and never rolls the positioner over at all.
  rung('w-b-done', [[no('M13'), no('M10'), set('M14')]]),
  rung('w-t2', [
    [no('M0'), no('M11'), no('X6'), no('X8'), no('M13'), nc('M10'), nc('M14'), tmr('T11', 12)],
  ]),
  rung('w-p2', [[no('T11'), set('M14')]]),
  rung('w-arc1', [[no('M0'), no('M11'), no('X6'), no('X7'), nc('M13'), out('M20')]]),
  rung('w-arc2', [
    [no('M0'), no('M11'), no('X6'), no('X8'), no('M13'), nc('M10'), nc('M14'), out('M21')],
  ]),
  rung('w-torch', [[no('M20'), out('Y3')], [no('M21')]], [{ row: 0, col: 1 }]),
  rung('w-rotate', [[no('M0'), no('M13'), nc('M10'), nc('M14'), out('Y4')]]),
  rung('w-release', [[no('M0'), no('M14'), nc('M16'), out('Y5')]]),
  rung('w-gone', [[no('M14'), no('X10'), set('M16')]]),
  rung('w-done', [
    [
      no('M16'),
      out('M17'),
      rst('T10'),
      rst('T11'),
      rst('T12'),
      rst('M11'),
      rst('M13'),
      rst('M14'),
      rst('M16'),
    ],
  ]),
  rung('w-alt-arm', [[no('M17'), nc('M10'), set('M18')]]),
  rung('w-alt-clear', [[no('M17'), rst('M10')]]),
  rung('w-alt-apply', [[no('M18'), set('M10'), rst('M18')]]),
  rung('w-tip', [[no('M0'), no('X9'), nc('M11'), out('Y7')]]),
];

// --- SEC2 STORE AND PORTAL ----------------------------------------------------

/**
 * The portal robot's cycle, which is the same however the rack is run.
 *
 * Eight steps and two coils. Every rule on it is a rule a real portal has: it
 * cannot travel with the head down, because the head hangs below the rail and
 * the rail is not the only thing in the aisle; and it cannot let go with the head
 * up, because the part is then two meters over the floor. The vacuum is held
 * right through the traverse and broken only once the cups are back down on the
 * booth skid.
 */
const PORTAL_CYCLE: Rung[] = [
  // Begin a pick: parked over the store, head up, something on the outfeed, and
  // nothing already in hand or in progress.
  rung('por-pick', [
    [
      no('M0'),
      no('X14'),
      no('X17'),
      no('X13'),
      nc('X18'),
      nc('M42'),
      nc('M43'),
      nc('M44'),
      nc('M45'),
      set('M41'),
    ],
  ]),
  rung('por-got', [[no('M41'), no('X18'), set('M42'), rst('M41')]]),
  rung('por-there', [[no('M42'), no('X15'), nc('X19'), set('M43'), rst('M42')]]),
  rung('por-set-down', [[no('M43'), no('X16'), set('M44'), rst('M43')]]),
  // Vacuum off, head still down: the part is on the skid before the cups let go.
  rung('por-let-go', [[no('M44'), nc('X18'), set('M45'), rst('M44')]]),
  rung('por-parked', [[no('M45'), no('X14'), rst('M45')]]),
  // Every step above, then every coil below. That order is not tidiness: on the
  // scan the head arrives over the booth, the step that starts lowering it and
  // the coil that is still driving the traverse both want to be right, and only
  // one of them can be. Put a coil above the step that clears it and the portal
  // sets off down the rail with its head coming down.
  rung('por-run', [[no('M42'), no('X17'), out('Y10')]]),
  rung('por-home', [[no('M45'), no('X17'), out('Y11')]]),
  rung(
    'por-lower',
    [[no('M41'), out('Y12')], [no('M43')], [no('M44')]],
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  ),
  rung(
    'por-vac',
    [[no('M41'), out('Y13')], [no('M42')], [no('M43')]],
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  ),
];

/**
 * The store, plainly: one lane, in and out.
 *
 * Everything goes into lane 1 and everything comes out of lane 1, which works
 * exactly as long as the weld shop hands over frames and booms strictly turn
 * about — and it works, because it does. It also leaves the rest of the rack
 * doing nothing, so two parts of buffer are all that stands between a weld shop
 * stopped to change a tip and a booth with nothing to spray.
 */
export const STORE_PLAIN: Rung[] = [
  rung('s-lane', [[mov('K1', 'D13'), mov('K1', 'D14')]]),
  rung('s-load', [[no('M0'), no('X11'), cmp('<', 'D4', 'K2'), out('Y8')]]),
  rung('s-pick', [[no('M0'), nc('X13'), cmp('>', 'D4', 'K0'), out('Y9')]]),
  ...PORTAL_CYCLE,
];

/**
 * The store, sorted: frames down two lanes, booms down the other two.
 *
 * Two things fall out of that. The rack holds eight parts instead of two, so the
 * booth keeps spraying through a tip change and the weld bay keeps welding
 * through a color change. And the booth's next part becomes a *choice* — the
 * picker takes a frame, then a boom, then a frame, whatever order they arrived
 * in, which is what keeps the two painted lanes level and the two halves of a
 * machine in the same color.
 */
export const STORE_TUNED: Rung[] = [
  // Put away: the first lane of the pair that has room in it.
  rung('s-put-f1', [[no('M0'), nc('X12'), cmp('<', 'D4', 'K2'), mov('K1', 'D13')]]),
  rung('s-put-f2', [[no('M0'), nc('X12'), cmp('>=', 'D4', 'K2'), mov('K2', 'D13')]]),
  rung('s-put-b1', [[no('M0'), no('X12'), cmp('<', 'D6', 'K2'), mov('K3', 'D13')]]),
  rung('s-put-b2', [[no('M0'), no('X12'), cmp('>=', 'D6', 'K2'), mov('K4', 'D13')]]),
  rung(
    's-room-f',
    [
      [nc('X12'), cmp('<', 'D4', 'K2'), out('M40')],
      [nc('X12'), cmp('<', 'D5', 'K2')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-room-b',
    [
      [no('X12'), cmp('<', 'D6', 'K2'), out('M41')],
      [no('X12'), cmp('<', 'D7', 'K2')],
    ],
    [{ row: 0, col: 2 }],
  ),
  // Both rows run from the rail. A branch row that starts half way along with
  // nothing to its left is not a branch, it is a dead row: power reaches a cell
  // through the rail or through a vertical link, and this one had neither.
  rung(
    's-load',
    [
      [no('M0'), no('X11'), no('M40'), out('Y8')],
      [no('M0'), no('X11'), no('M41')],
    ],
    [{ row: 0, col: 3 }],
  ),
  // Draw out: whichever type is due next, from the fuller lane of its pair.
  rung('s-take-f1', [[nc('M46'), cmp('>', 'D4', 'K0'), mov('K1', 'D14')]]),
  rung('s-take-f2', [[nc('M46'), cmp('<=', 'D4', 'K0'), mov('K2', 'D14')]]),
  rung('s-take-b1', [[no('M46'), cmp('>', 'D6', 'K0'), mov('K3', 'D14')]]),
  rung('s-take-b2', [[no('M46'), cmp('<=', 'D6', 'K0'), mov('K4', 'D14')]]),
  rung(
    's-have-f',
    [
      [nc('M46'), cmp('>', 'D4', 'K0'), out('M47')],
      [nc('M46'), cmp('>', 'D5', 'K0')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-have-b',
    [
      [no('M46'), cmp('>', 'D6', 'K0'), out('M48')],
      [no('M46'), cmp('>', 'D7', 'K0')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-pick',
    [
      [no('M0'), nc('X13'), no('M47'), out('Y9')],
      [no('M0'), nc('X13'), no('M48')],
    ],
    [{ row: 0, col: 3 }],
  ),
  // Turn about on the rising edge of a part landing on the outfeed. A level
  // contact cannot do this: it is true for as long as the part sits there, and
  // the relay would flip on every scan of it.
  rung('s-alt-arm', [[re('X13'), nc('M46'), set('M49')]]),
  rung('s-alt-clear', [[re('X13'), rst('M46')]]),
  rung('s-alt-apply', [[no('M49'), set('M46'), rst('M49')]]),
  ...PORTAL_CYCLE,
];

// --- SEC3 PAINT ---------------------------------------------------------------

/**
 * The paint shop, plainly.
 *
 * The booth is held at 110 C whether or not the line is running, because an oven
 * that goes cold between shifts costs an hour to bring back and the first part
 * through it would be scrap. Every part is sprayed to 240 um whether it is a
 * hull or a stick, and the gun is only ever changed over with the booth standing
 * empty — which is careful, and wrong: the purge goes to the waste pot, and the
 * booth could have been blasting the next part the whole time.
 */
export const PAINT_PLAIN: Rung[] = [
  rung('p-recipe', [[mov('K2200', 'D2'), mov('K4000', 'D3')]]),
  rung('p-drum', [[mov('D8', 'D15')]]),
  // Change over, but only with nothing in the booth.
  rung('p-purge', [[no('M0'), nc('X19'), cmp('<>', 'D9', 'D8'), out('Y16')]]),
  rung('p-spray', [
    [
      no('M0'),
      no('X19'),
      cmp('=', 'D9', 'D8'),
      cmp('<', 'D1', 'K2400'),
      cmp('>=', 'D0', 'K1900'),
      out('Y14'),
    ],
  ]),
  rung('p-oven', [
    [
      no('M0'),
      no('X19'),
      cmp('=', 'D9', 'D8'),
      cmp('>=', 'D1', 'K2400'),
      nc('X21'),
      nc('X22'),
      out('Y15'),
    ],
  ]),
];

/**
 * The paint shop, with a recipe per part and a changeover that costs nothing.
 *
 * The film target moves into a register chosen by X20, so one spray rung serves
 * both parts: a boom takes 150 um instead of 240, which is nearly a second less
 * spraying and most of a second less bake, both of them booth time. And the
 * purge runs whenever the color is wrong, blast or no blast, because it flushes
 * to waste and the part in the booth never sees it.
 */
export const PAINT_TUNED: Rung[] = [
  rung('p-recipe', [[mov('K2200', 'D2'), mov('K4000', 'D3')]]),
  rung('p-drum', [[mov('D8', 'D15')]]),
  // Two MOVs into one register is the value-selection idiom, not a double write:
  // each fires only on the scan its own rung conducts.
  rung('p-target-f', [[no('M0'), nc('X20'), mov('K2100', 'D40')]]),
  rung('p-target-b', [[no('M0'), no('X20'), mov('K1500', 'D40')]]),
  // Spray first, so the purge rung below reads this scan's gun rather than last
  // scan's. The two must never be commanded together.
  rung('p-spray', [
    [
      no('M0'),
      no('X19'),
      cmp('=', 'D9', 'D8'),
      cmp('<', 'D1', 'D40'),
      cmp('>=', 'D0', 'K1900'),
      out('Y14'),
    ],
  ]),
  rung('p-purge', [[no('M0'), nc('Y14'), cmp('<>', 'D9', 'D8'), out('Y16')]]),
  rung('p-oven', [
    [
      no('M0'),
      no('X19'),
      cmp('=', 'D9', 'D8'),
      cmp('>=', 'D1', 'D40'),
      nc('X21'),
      nc('X22'),
      out('Y15'),
    ],
  ]),
];

// --- SEC4 ASSEMBLY ------------------------------------------------------------

/**
 * Final assembly, plainly.
 *
 * Both parts are claimed on the one scan where the painted lanes hold one of
 * each, so the jig is either empty or building and can never be caught holding
 * half a machine. It is the safe program and it is the slow one — and it makes
 * the boom up in its turn, after the cab, because a list of steps written down
 * in order is a list of steps run in order. The bench was never waiting for the
 * cab. It was waiting for a boom, which it has had since the build began.
 */
export const ASSEMBLY_PLAIN: Rung[] = [
  rung('a-start', [[no('M0'), no('X23'), no('X24'), nc('M100'), set('M100')]]),
  // Both calls off one rung: an energized output passes power to its right, so
  // the frame and the boom are claimed on the same scan and cannot separate.
  rung('a-call', [[no('M100'), nc('T40'), out('Y17'), out('Y18')]]),
  rung('a-loaded', [[no('M100'), tmr('T40', 1)]]),
  rung('a-engine', [[no('M0'), no('T40'), nc('T41'), out('Y19')]]),
  rung('a-engine-t', [[no('M0'), no('T40'), tmr('T41', 25)]]),
  rung('a-cab', [[no('M0'), no('T41'), nc('T42'), out('Y20')]]),
  rung('a-cab-t', [[no('M0'), no('T41'), tmr('T42', 20)]]),
  // NC on M104 and X26 for the same reason the pin rung carries them: the scan
  // after a machine is released the step timers are still standing done and the
  // jig is empty, so without them the bench runs with nothing on it.
  rung('a-prep', [[no('M0'), no('T42'), nc('X25'), nc('X26'), nc('M104'), out('Y21')]]),
  rung('a-pin', [[no('M0'), no('T42'), no('X25'), nc('X26'), nc('M104'), out('Y22')]]),
  rung('a-release', [[no('M0'), no('X26'), no('X27'), out('Y23'), set('M104')]]),
  rung('a-reset', [
    [no('M104'), nc('X26'), rst('T40'), rst('T41'), rst('T42'), rst('M100'), rst('M104')],
  ]),
];

/**
 * Final assembly, with the bench running alongside the jig.
 *
 * Two changes. The build starts on a frame alone rather than waiting for the
 * pair, and claims a boom whenever one turns up during the engine drop — a
 * gamble against the starve latch that the line's own turn-about makes safe, and
 * hedged anyway by refusing a boom whose color does not match the frame already
 * in the jig. And the boom is made up while the engine goes in, because the
 * bench is beside the jig and not in front of it.
 */
export const ASSEMBLY_TUNED: Rung[] = [
  rung('a-start', [[no('M0'), no('X23'), nc('M100'), set('M100')]]),
  rung('a-call-f', [[no('M100'), nc('T40'), out('Y17')]]),
  rung('a-loaded', [[no('M100'), tmr('T40', 1)]]),
  // The call for a boom stands for the whole build, and only for a boom that
  // belongs to the same machine as the frame already in the jig: D16 is what the
  // jig is holding, D11 what is at the head of the boom lane.
  rung('a-call-b', [[no('M100'), nc('M101'), cmp('=', 'D11', 'D16'), out('Y18')]]),
  rung('a-have-b', [[no('M100'), cmp('>', 'D17', 'K0'), set('M101')]]),
  rung('a-engine', [[no('M0'), no('T40'), nc('T41'), out('Y19')]]),
  rung('a-engine-t', [[no('M0'), no('T40'), tmr('T41', 23)]]),
  rung('a-cab', [[no('M0'), no('T41'), nc('T42'), out('Y20')]]),
  rung('a-cab-t', [[no('M0'), no('T41'), tmr('T42', 19)]]),
  // The bench, from the moment there is a boom to put on it.
  rung('a-prep', [[no('M0'), no('M101'), nc('X25'), nc('X26'), nc('M104'), out('Y21')]]),
  rung('a-pin', [[no('M0'), no('T42'), no('X25'), nc('X26'), nc('M104'), out('Y22')]]),
  rung('a-release', [[no('M0'), no('X26'), no('X27'), out('Y23'), set('M104')]]),
  rung('a-reset', [
    [
      no('M104'),
      nc('X26'),
      rst('T40'),
      rst('T41'),
      rst('T42'),
      rst('M100'),
      rst('M101'),
      rst('M104'),
    ],
  ]),
];

// --- SEC5 TEST AND DISPATCH ---------------------------------------------------

/**
 * Test and dispatch, plainly.
 *
 * Pump, test, drive it off — with the pump dropped the moment the test passes,
 * because the bay couples through a quick release and a quick release dragged
 * off the pad under pressure comes away with the hose in it.
 *
 * The truck is sent for when the yard is full, which is the program everybody
 * writes first and the one that costs the most: the yard is then full for the
 * whole ten seconds the lorry takes to arrive, and a full yard is a line
 * standing still all the way back to the weld fixture.
 */
export const TEST_PLAIN: Rung[] = [
  rung('t-pump', [[no('M0'), no('X28'), nc('X29'), out('Y24')]]),
  // NC on X29 so the timer clears the moment the test passes: the bay can pull
  // the next machine in on the same scan the last one drives off, and a pressure
  // timer still standing done would work the boom on a dead circuit.
  rung('t-pressure', [[no('M0'), no('X28'), nc('X29'), tmr('T50', 15)]]),
  rung('t-cycle', [[no('M0'), no('T50'), nc('X29'), out('Y25')]]),
  rung('t-dispatch', [[no('M0'), no('X29'), no('X30'), out('Y26')]]),
  // Send for a lorry once there is nowhere left to put a machine …
  rung('t-call', [[nc('X30'), set('M130')]]),
  // … hold it on the dock while it loads …
  rung('t-hold', [[no('M130'), out('Y27')]]),
  // … and let it go once the yard behind it is clear.
  rung('t-release', [[no('X31'), cmp('<=', 'D12', 'K0'), rst('M130')]]),
];

/**
 * Test and dispatch, with the lorry sent for before it is needed.
 *
 * One rung different. Called at three machines in the yard rather than at six,
 * the truck is standing on the dock with spaces still free behind it, and the
 * line never once has to stop and wait for it.
 */
export const TEST_TUNED: Rung[] = [
  rung('t-pump', [[no('M0'), no('X28'), nc('X29'), out('Y24')]]),
  rung('t-pressure', [[no('M0'), no('X28'), nc('X29'), tmr('T50', 15)]]),
  rung('t-cycle', [[no('M0'), no('T50'), nc('X29'), out('Y25')]]),
  rung('t-dispatch', [[no('M0'), no('X29'), no('X30'), out('Y26')]]),
  rung('t-call', [[cmp('>=', 'D12', 'K3'), set('M130')]]),
  rung('t-hold', [[no('M130'), out('Y27')]]),
  rung('t-release', [[no('X31'), cmp('<=', 'D12', 'K0'), rst('M130')]]),
];
