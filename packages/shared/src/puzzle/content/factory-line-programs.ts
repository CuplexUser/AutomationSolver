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
  // No X10 here. The plain program will not clamp a blank until the last part
  // has arrived at the store, three zones away — which is a second and a half of
  // travel plus a loader stroke that the fixture spends standing empty. What the
  // fixture actually needs is its own jaws free, and M11 already says that.
  rung('w-start', [[no('M0'), nc('X9'), nc('M11'), set('M11')]]),
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
  // The cycle is over when the weldment is on the spine, which the outfeed eye
  // says the instant the roll-off lands it on Z1. The plain program waits for
  // X10 instead — the same part, three zones and a loader stroke later.
  //
  // The *edge*, not the level. Z1 is the one zone the fixture can see, and when
  // the spine is backed up there is already a part standing on it: a level
  // contact would call the cycle finished with the weldment still in the jaws,
  // and the next worn tip would then be changed on a loaded fixture.
  rung('w-gone', [[no('M14'), re('X32'), set('M16')]]),
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
 * The portal robot's cycle. One step differs between the two store programs and
 * the rest of it is the same however the rack is run.
 *
 * Eight steps and two coils. Every rule on it is a rule a real portal has: it
 * cannot travel with the head down, because the head hangs below the rail and
 * the rail is not the only thing in the aisle; and it cannot let go with the head
 * up, because the part is then two meters over the floor. The vacuum is held
 * right through the traverse and broken only once the cups are back down on the
 * booth skid.
 *
 * Its five step latches live in **M60..M64**, up at the far end of the section's
 * M40-M69 block, and nothing else in this file may touch them. That fence is not
 * decoration. The rack logic below wants a handful of level relays for "there is
 * room in the frame pair" and "there is a boom to draw", and a level `OUT` coil
 * written *above* these rungs simply overwrites whatever the step chain latched
 * on the scan before — the portal then stops being a sequence and becomes a
 * follower of whichever rack flag it collided with. It still moves, so it reads
 * as working; it stalls for good the first time that flag goes false and stays
 * false, which on a rack is the moment the rack fills.
 */
const portalCycle = (lowerEarly: boolean): Rung[] => [
  // Begin a pick: parked over the store, head up, something on the outfeed, and
  // nothing already in hand or in progress.
  rung('por-pick', [
    [
      no('M0'),
      no('X14'),
      no('X17'),
      no('X13'),
      nc('X18'),
      nc('M61'),
      nc('M62'),
      nc('M63'),
      nc('M64'),
      set('M60'),
    ],
  ]),
  rung('por-got', [[no('M60'), no('X18'), set('M61'), rst('M60')]]),
  // Where the wait for the booth is spent. Held on the traverse step, the head
  // stays two meters up until the skid is clear and only then starts down, so
  // every changeover costs a full lower. Held on the set-down step instead, the
  // head is already on the skid when the booth goes idle and the only thing left
  // to do is break the vacuum — and it is safe, because the part is not placed
  // until the cups let go, which is what the interlock was ever guarding.
  lowerEarly
    ? rung('por-there', [[no('M61'), no('X15'), set('M62'), rst('M61')]])
    : rung('por-there', [[no('M61'), no('X15'), nc('X19'), set('M62'), rst('M61')]]),
  lowerEarly
    ? rung('por-set-down', [[no('M62'), no('X16'), nc('X19'), set('M63'), rst('M62')]])
    : rung('por-set-down', [[no('M62'), no('X16'), set('M63'), rst('M62')]]),
  // Vacuum off, head still down: the part is on the skid before the cups let go.
  rung('por-let-go', [[no('M63'), nc('X18'), set('M64'), rst('M63')]]),
  rung('por-parked', [[no('M64'), no('X14'), rst('M64')]]),
  // Every step above, then every coil below. That order is not tidiness: on the
  // scan the head arrives over the booth, the step that starts lowering it and
  // the coil that is still driving the traverse both want to be right, and only
  // one of them can be. Put a coil above the step that clears it and the portal
  // sets off down the rail with its head coming down.
  rung('por-run', [[no('M61'), no('X17'), out('Y10')]]),
  rung('por-home', [[no('M64'), no('X17'), out('Y11')]]),
  rung(
    'por-lower',
    [[no('M60'), out('Y12')], [no('M62')], [no('M63')]],
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  ),
  rung(
    'por-vac',
    [[no('M60'), out('Y13')], [no('M61')], [no('M62')]],
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
  ...portalCycle(false),
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
  ...portalCycle(true),
];

// --- SEC3 PAINT ---------------------------------------------------------------

/**
 * The paint shop, plainly.
 *
 * The booth is held at 110 C whether or not the line is running, because an oven
 * that goes cold between shifts costs an hour to bring back and the first part
 * through it would be scrap. Every part is then sprayed to 240 um whether it is
 * a hull or a stick — one recipe, one target, nothing to get wrong. It is the
 * concession that looks free and is not: a boom is specified 140 to 260, so the
 * extra hundred microns buys nothing, and the plant charges for it twice. Once
 * in the booth, spraying paint the part did not need, and again in the oven,
 * where the bake is a function of the film that went on.
 *
 * The purge is gated on the gun rather than on the booth. A flush that waited
 * for an empty booth would never run at all: it takes a full blast cycle, and
 * the portal is standing over the skid with the next part before the booth has
 * been clear half a second.
 */
export const PAINT_PLAIN: Rung[] = [
  rung('p-recipe', [[mov('K2200', 'D2'), mov('K4000', 'D3')]]),
  rung('p-drum', [[mov('D8', 'D15')]]),
  // Spray above purge, so the purge rung below reads this scan's gun rather than
  // last scan's. The two must never be commanded together.
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
  rung('p-purge', [[no('M0'), nc('Y14'), cmp('<>', 'D9', 'D8'), out('Y16')]]),
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
  // the frame and the boom are asked for together and the jig never sets out to
  // build half a machine.
  //
  // The calls stand until both parts are actually in, which D16 and D17 report,
  // rather than for a fixed window. A lane the sort is loading into is a lane
  // that is *moving*, and the jig cannot lift off a moving lane — so a call that
  // lasted one scan would silently miss, and the bench would later be run with
  // nothing on it.
  rung('a-call', [[no('M100'), nc('M102'), out('Y17'), out('Y18')]]),
  rung('a-both', [[no('M100'), cmp('>', 'D16', 'K0'), cmp('>', 'D17', 'K0'), set('M102')]]),
  rung('a-loaded', [[no('M102'), tmr('T40', 1)]]),
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
    [
      no('M104'),
      nc('X26'),
      rst('T40'),
      rst('T41'),
      rst('T42'),
      rst('M100'),
      rst('M102'),
      rst('M104'),
    ],
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
  // The call stands until the frame is in the jig, which D16 reports. The lane
  // has to be stopped for the jig to lift off it, and the sort runs that same
  // lane to take a part from the paddle, so a call that lasted one scan would
  // sooner or later be raised against a moving belt and quietly miss.
  rung('a-call-f', [[no('M100'), nc('M102'), out('Y17')]]),
  rung('a-got-f', [[no('M100'), cmp('>', 'D16', 'K0'), set('M102')]]),
  rung('a-loaded', [[no('M102'), tmr('T40', 1)]]),
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
      rst('M102'),
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
  //
  // K=18 covers the 1.6 s the pack takes to come up with a tenth in hand. A
  // preset sized exactly to the pump is a rung that jams the first time anything
  // about the pack changes, which is a lesson the plant would rather teach in a
  // briefing than in a stack trace.
  rung('t-pressure', [[no('M0'), no('X28'), nc('X29'), tmr('T50', 18)]]),
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
  rung('t-pressure', [[no('M0'), no('X28'), nc('X29'), tmr('T50', 18)]]),
  rung('t-cycle', [[no('M0'), no('T50'), nc('X29'), out('Y25')]]),
  rung('t-dispatch', [[no('M0'), no('X29'), no('X30'), out('Y26')]]),
  rung('t-call', [[cmp('>=', 'D12', 'K3'), set('M130')]]),
  rung('t-hold', [[no('M130'), out('Y27')]]),
  rung('t-release', [[no('X31'), cmp('<=', 'D12', 'K0'), rst('M130')]]),
];

// --- SEC6 CONV ----------------------------------------------------------------

/**
 * The spine, plainly: each run treated as one long belt.
 *
 * Perfectly sound and completely understandable. A run starts at one end and
 * stops when the far end is occupied, so nothing is ever pushed into anything,
 * nothing crashes, and every part gets where it is going.
 *
 * What it gives away is that a run is *twelve* belts, not four. Stopping the
 * whole of the weld outfeed because the store's infeed is busy holds up a part
 * standing three zones back that had a clear road in front of it. On a line
 * where every station is within a second of every other, a spine that pauses
 * every time the station on the end of it is loading is the plant's quietest
 * and largest loss.
 */
export const CONV_PLAIN: Rung[] = [
  // Weld outfeed to the store, run as one belt while the infeed is clear.
  rung('c-a1', [[no('M0'), nc('X34'), out('Y28')]]),
  rung('c-a2', [[no('M0'), nc('X34'), out('Y29')]]),
  rung('c-a3', [[no('M0'), nc('X34'), out('Y30')]]),
  // Oven discharge to the sort, likewise.
  rung('c-b1', [[no('M0'), nc('X38'), out('Y31')]]),
  rung('c-b2', [[no('M0'), nc('X38'), out('Y32')]]),
  rung('c-b3', [[no('M0'), nc('X38'), out('Y33')]]),
  rung('c-b4', [[no('M0'), nc('X38'), out('Y34')]]),
  // The sort reads the part it is holding and paddles it into its own lane. The
  // lane has to be turning to take it, so the paddle and the lane go together.
  rung('c-sortf', [[no('M0'), no('X38'), nc('X44'), nc('X45'), out('Y40')]]),
  rung('c-sortb', [[no('M0'), no('X38'), no('X44'), nc('X46'), out('Y41')]]),
  rung('c-lanef', [[no('Y40'), out('Y35')]]),
  rung('c-laneb', [[no('Y41'), out('Y36')]]),
  // Assembly out through test, and the dock apron.
  rung('c-c1', [[no('M0'), nc('X42'), out('Y37')]]),
  rung('c-c2', [[no('M0'), nc('X42'), out('Y38')]]),
  rung('c-d1', [[no('M0'), nc('X43'), out('Y39')]]),
];

/**
 * The spine, zone by zone: every belt runs while its own zone is clear.
 *
 * One rung each and shorter than the plain version, which is the nicest thing
 * about zero-pressure accumulation — the right answer is also the smaller one.
 * A zone that has nothing on it pulls in whatever is behind it and then stops,
 * so parts queue nose to tail and each one moves the moment the zone in front
 * of it empties, rather than when the whole run happens to be free.
 *
 * The two painted lanes are the exception and stay as they were, because they
 * are three deep and their eye reads *occupied*, not *full* — and because a lane
 * has to be stopped for the jig to lift a part off it. Running a lane on its own
 * eye would leave it turning under a part final assembly is trying to take.
 */
export const CONV_TUNED: Rung[] = [
  rung('c-z1', [[no('M0'), nc('X32'), out('Y28')]]),
  rung('c-z2', [[no('M0'), nc('X33'), out('Y29')]]),
  rung('c-z3', [[no('M0'), nc('X34'), out('Y30')]]),
  rung('c-z4', [[no('M0'), nc('X35'), out('Y31')]]),
  rung('c-z5', [[no('M0'), nc('X36'), out('Y32')]]),
  rung('c-z6', [[no('M0'), nc('X37'), out('Y33')]]),
  rung('c-z7', [[no('M0'), nc('X38'), out('Y34')]]),
  rung('c-sortf', [[no('M0'), no('X38'), nc('X44'), nc('X45'), out('Y40')]]),
  rung('c-sortb', [[no('M0'), no('X38'), no('X44'), nc('X46'), out('Y41')]]),
  rung('c-lanef', [[no('Y40'), out('Y35')]]),
  rung('c-laneb', [[no('Y41'), out('Y36')]]),
  rung('c-z10', [[no('M0'), nc('X41'), out('Y37')]]),
  rung('c-z11', [[no('M0'), nc('X42'), out('Y38')]]),
  rung('c-z12', [[no('M0'), nc('X43'), out('Y39')]]),
];
