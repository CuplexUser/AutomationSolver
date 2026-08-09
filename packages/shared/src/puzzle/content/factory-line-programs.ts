import type { Rung, VarDecl, VarKind } from '../../ladder/types.js';
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
 *
 * ## Written in names, not addresses
 *
 * Every device here is a symbol. `X6` is `FixtureClamped` because the plant
 * declares it that way; `M11` is `InCycle` because `LINE_VARS.WELD` declares it
 * that way. Resolution happens once, between assembly and the engine, and the
 * engine still sees nothing but addresses — so this file reads as a description
 * of a factory while running exactly the bytes it ran when it was a memory map.
 *
 * Three rules the conversion follows and the next author should too:
 *
 * - **Working storage is declared where it is used.** A section's latches, step
 *   relays and timers are its `LINE_VARS` entry and nothing else can see them.
 *   The one exception is `PlantRun`, which is a global because six sections read
 *   what the supervisor writes.
 * - **One declaration list per section serves both its programs.** PLAIN and
 *   TUNED are never loaded together, and a name that meant one thing in each
 *   would be worse than the address it replaced. Where the two genuinely wanted
 *   different bits — assembly's frame and boom claims — PLAIN was given the same
 *   two names rather than the names being blurred to cover one bit.
 * - **`fixed: true` on all of them.** These ship with the puzzle. A player may
 *   read them and code against them; renaming or moving one would rewrite half
 *   of a handshake from the wrong end.
 */

const { no, nc, re, out, set, rst, tmr, mov, cmp, rung } = build;

// --- Declarations -------------------------------------------------------------

const decl =
  (kind: VarKind) =>
  (name: string, address: string, comment: string): VarDecl => ({
    name,
    kind,
    address,
    comment,
    fixed: true,
  });

const bit = decl('bool');
const word = decl('int');
const clock = decl('timer');

/**
 * Every section's private working storage, by section id.
 *
 * The addresses are the ones each section already owned (`LINE_OWNS`), which is
 * why nothing here needs a memory pool: these are placed by the plant, not
 * allocated out of the player's block. Two sections' locals can never collide,
 * because the blocks do not overlap and the allocator is never asked.
 */
export const LINE_VARS: Record<string, VarDecl[]> = {
  // The supervisor's only storage is the run latch, and that is a global.
  SUP: [],

  WELD: [
    bit('BoomNext', 'M10', 'The next blank off the rack is a boom. Flips once per cycle.'),
    bit('InCycle', 'M11', 'The fixture is loaded and working. Latched at the clamp.'),
    bit('PassOneDone', 'M13', 'The first seam is laid.'),
    bit('WeldDone', 'M14', 'Every seam this part needs is laid. A boom reaches it one pass early.'),
    bit('PartGone', 'M16', 'The weldment is off the fixture and away.'),
    bit('CycleDone', 'M17', 'One scan wide, at the end of a cycle.'),
    bit('FlipArm', 'M18', 'Middle step of the alternating relay that flips BoomNext.'),
    bit('ArcAtA', 'M20', 'Strike the torch for the pass taken at position A.'),
    bit('ArcAtB', 'M21', 'Strike the torch for the pass taken at position B.'),
    clock('PassA', 'T10', 'How long the A-side pass runs.'),
    clock('PassB', 'T11', 'How long the B-side pass runs.'),
    clock('BoomPass', 'T12', "A boom's single pass, which is longer than a frame's. Tuned only."),
  ],

  STORE: [
    bit('RoomForFrame', 'M40', 'One of the two frame lanes has space in it.'),
    bit('RoomForBoom', 'M41', 'One of the two boom lanes has space in it.'),
    bit('BoomDue', 'M46', 'The booth is owed a boom next rather than a frame.'),
    bit('HaveFrame', 'M47', 'There is a frame standing in one of the frame lanes.'),
    bit('HaveBoom', 'M48', 'There is a boom standing in one of the boom lanes.'),
    bit('TurnArm', 'M49', 'Middle step of the alternating relay that flips BoomDue.'),
    // The portal's step chain. Up at the far end of the block on purpose: a
    // level coil written above these rungs would overwrite whatever the chain
    // latched last scan, and the portal would stop being a sequence.
    bit('StepPick', 'M60', 'Down on the outfeed, making vacuum.'),
    bit('StepCarry', 'M61', 'Part in hand, travelling to the booth.'),
    bit('StepLower', 'M62', 'Over the booth skid, coming down.'),
    bit('StepRelease', 'M63', 'Down on the skid, breaking vacuum.'),
    bit('StepHome', 'M64', 'Empty, travelling back to the store.'),
  ],

  PAINT: [
    word('FilmTarget', 'D40', 'Microns of paint this part is specified for. Tuned only.'),
  ],

  ASSY: [
    bit('Building', 'M100', 'A machine is being built on the jig.'),
    bit('BoomIn', 'M101', 'The boom this machine is made of is on the jig. Drops the boom call.'),
    bit('FrameIn', 'M102', 'The frame this machine is made of is on the jig. Drops the frame call.'),
    bit('Released', 'M104', 'The finished machine has been rolled off to test.'),
    clock('Settle', 'T40', 'A moment after loading, before the build starts.'),
    clock('EngineIn', 'T41', 'How long the engine takes to come down.'),
    clock('CabOn', 'T42', 'How long the cab takes to go on.'),
  ],

  TEST: [
    bit('TruckCalled', 'M130', 'A lorry has been sent for and has not left yet.'),
    clock('PumpUp', 'T50', 'How long the hydraulic pack takes to come up to pressure.'),
  ],

  // The spine holds no state of its own at all. Every zone drive is a function
  // of that zone's eye and nothing else, which is the whole of what zero
  // pressure accumulation means.
  CONV: [],
};

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
  rung('w-select', [[no('BoomNext'), out('SelectBoom')]]),
  // A cycle starts with the plant running, the outfeed clear, and a tip that can
  // still lay a pass.
  rung('w-start', [
    [no('PlantRun'), nc('WeldOutfeedOccupied'), nc('TorchTipWorn'), nc('InCycle'), set('InCycle')],
  ]),
  // The jaws hold for the whole cycle and open as the release begins. Holding
  // them through the release looks harmless and is not: the fixture would pick
  // up the next blank on the scan the old part left, before the alternating
  // relay had flipped, and weld two of the same kind in a row.
  rung('w-clamp', [[no('InCycle'), nc('WeldDone'), out('Clamp')]]),
  // The two passes, timed on their own conditions rather than off the arc bits.
  // The order of these rungs is load bearing: the step latches are set *above*
  // the coils that read them, so the scan a pass finishes on is the scan the
  // torch goes out. Drive the timer from the arc bit instead and the arc bit is
  // a scan stale — the positioner starts rolling the weldment over with the arc
  // still lit, which is the one thing this fixture will not have.
  // K=13 covers the longest single pass on the fixture, which is the boom's.
  // A preset that only just covers it is a preset that sometimes cuts the arc a
  // scan early, and a pass left at 99 % is a seam the fixture will not release.
  rung('w-t1', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtA'),
      nc('PassOneDone'),
      tmr('PassA', 13),
    ],
  ]),
  rung('w-p1', [[no('PassA'), set('PassOneDone')]]),
  rung('w-t2', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtB'),
      no('PassOneDone'),
      nc('WeldDone'),
      tmr('PassB', 13),
    ],
  ]),
  rung('w-p2', [[no('PassB'), set('WeldDone')]]),
  rung('w-arc1', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtA'),
      nc('PassOneDone'),
      out('ArcAtA'),
    ],
  ]),
  rung('w-arc2', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtB'),
      no('PassOneDone'),
      nc('WeldDone'),
      out('ArcAtB'),
    ],
  ]),
  // One coil for the torch, fed from either pass. Two rungs both driving the
  // torch would be a double coil, and only the second would ever take effect.
  rung('w-torch', [[no('ArcAtA'), out('Torch')], [no('ArcAtB')]], [{ row: 0, col: 1 }]),
  // Roll it over, and keep the positioner turning through pass two: let it go
  // and it rolls straight back to A with the arc still lit.
  rung('w-rotate', [
    [no('PlantRun'), no('PassOneDone'), nc('WeldDone'), out('RotatePositioner')],
  ]),
  rung('w-release', [[no('PlantRun'), no('WeldDone'), nc('PartGone'), out('Release')]]),
  rung('w-gone', [[no('WeldDone'), no('WeldOutfeedOccupied'), set('PartGone')]]),
  rung('w-done', [
    [
      no('PartGone'),
      out('CycleDone'),
      rst('PassA'),
      rst('PassB'),
      rst('InCycle'),
      rst('PassOneDone'),
      rst('WeldDone'),
      rst('PartGone'),
    ],
  ]),
  // Alternating relay: arm, clear, apply. Three rungs in this order flip
  // BoomNext exactly once per pulse; two cannot, because the second would see
  // the bit the first just wrote.
  rung('w-alt-arm', [[no('CycleDone'), nc('BoomNext'), set('FlipArm')]]),
  rung('w-alt-clear', [[no('CycleDone'), rst('BoomNext')]]),
  rung('w-alt-apply', [[no('FlipArm'), set('BoomNext'), rst('FlipArm')]]),
  // The tip, changed when the field says so and the fixture is empty.
  rung('w-tip', [[no('PlantRun'), no('TorchTipWorn'), nc('InCycle'), out('ChangeTip')]]),
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
  rung('w-select', [[no('BoomNext'), out('SelectBoom')]]),
  // No WeldOutfeedOccupied here. The plain program will not clamp a blank until
  // the last part has arrived at the store, three zones away — which is a second
  // and a half of travel plus a loader stroke that the fixture spends standing
  // empty. What the fixture actually needs is its own jaws free, and InCycle
  // already says that.
  rung('w-start', [[no('PlantRun'), nc('TorchTipWorn'), nc('InCycle'), set('InCycle')]]),
  rung('w-clamp', [[no('InCycle'), nc('WeldDone'), out('Clamp')]]),
  // One timer per part. BoomNext is the selector, and the fixture latched it
  // when it clamped, so it is stable for the whole cycle.
  rung('w-t1-f', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtA'),
      nc('BoomNext'),
      nc('PassOneDone'),
      tmr('PassA', 12),
    ],
  ]),
  rung('w-t1-b', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtA'),
      no('BoomNext'),
      nc('PassOneDone'),
      tmr('BoomPass', 13),
    ],
  ]),
  rung('w-p1', [[no('PassA'), set('PassOneDone')], [no('BoomPass')]], [{ row: 0, col: 1 }]),
  // A boom is finished after that one pass, so it skips straight to the release
  // and never rolls the positioner over at all.
  rung('w-b-done', [[no('PassOneDone'), no('BoomNext'), set('WeldDone')]]),
  rung('w-t2', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtB'),
      no('PassOneDone'),
      nc('BoomNext'),
      nc('WeldDone'),
      tmr('PassB', 12),
    ],
  ]),
  rung('w-p2', [[no('PassB'), set('WeldDone')]]),
  rung('w-arc1', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtA'),
      nc('PassOneDone'),
      out('ArcAtA'),
    ],
  ]),
  rung('w-arc2', [
    [
      no('PlantRun'),
      no('InCycle'),
      no('FixtureClamped'),
      no('PositionerAtB'),
      no('PassOneDone'),
      nc('BoomNext'),
      nc('WeldDone'),
      out('ArcAtB'),
    ],
  ]),
  rung('w-torch', [[no('ArcAtA'), out('Torch')], [no('ArcAtB')]], [{ row: 0, col: 1 }]),
  rung('w-rotate', [
    [no('PlantRun'), no('PassOneDone'), nc('BoomNext'), nc('WeldDone'), out('RotatePositioner')],
  ]),
  rung('w-release', [[no('PlantRun'), no('WeldDone'), nc('PartGone'), out('Release')]]),
  // The cycle is over when the weldment is on the spine, which zone 1's eye says
  // the instant the roll-off lands it there. The plain program waits for the
  // store's own infeed instead — the same part, three zones and a loader stroke
  // later.
  //
  // The *edge*, not the level. Z1 is the one zone the fixture can see, and when
  // the spine is backed up there is already a part standing on it: a level
  // contact would call the cycle finished with the weldment still in the jaws,
  // and the next worn tip would then be changed on a loaded fixture.
  rung('w-gone', [[no('WeldDone'), re('Z1Occupied'), set('PartGone')]]),
  rung('w-done', [
    [
      no('PartGone'),
      out('CycleDone'),
      rst('PassA'),
      rst('PassB'),
      rst('BoomPass'),
      rst('InCycle'),
      rst('PassOneDone'),
      rst('WeldDone'),
      rst('PartGone'),
    ],
  ]),
  rung('w-alt-arm', [[no('CycleDone'), nc('BoomNext'), set('FlipArm')]]),
  rung('w-alt-clear', [[no('CycleDone'), rst('BoomNext')]]),
  rung('w-alt-apply', [[no('FlipArm'), set('BoomNext'), rst('FlipArm')]]),
  rung('w-tip', [[no('PlantRun'), no('TorchTipWorn'), nc('InCycle'), out('ChangeTip')]]),
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
 * Its five step latches are **`StepPick` to `StepHome`**, up at the far end of
 * the section's block, and nothing else in this file may touch them. That fence
 * is not decoration. The rack logic below wants a handful of level relays for
 * "there is room in the frame pair" and "there is a boom to draw", and a level
 * `OUT` coil written *above* these rungs simply overwrites whatever the step
 * chain latched on the scan before — the portal then stops being a sequence and
 * becomes a follower of whichever rack flag it collided with. It still moves, so
 * it reads as working; it stalls for good the first time that flag goes false
 * and stays false, which on a rack is the moment the rack fills.
 *
 * Under scoping the collision is now unrepresentable between *sections*. Inside
 * one section it is still the author's job, which is what the names are for.
 */
const portalCycle = (lowerEarly: boolean): Rung[] => [
  // Begin a pick: parked over the store, head up, something on the outfeed, and
  // nothing already in hand or in progress.
  rung('por-pick', [
    [
      no('PlantRun'),
      no('PortalAtStore'),
      no('PortalUp'),
      no('PartAtStoreOutfeed'),
      nc('PartHeld'),
      nc('StepCarry'),
      nc('StepLower'),
      nc('StepRelease'),
      nc('StepHome'),
      set('StepPick'),
    ],
  ]),
  rung('por-got', [[no('StepPick'), no('PartHeld'), set('StepCarry'), rst('StepPick')]]),
  // Where the wait for the booth is spent. Held on the traverse step, the head
  // stays two meters up until the skid is clear and only then starts down, so
  // every changeover costs a full lower. Held on the set-down step instead, the
  // head is already on the skid when the booth goes idle and the only thing left
  // to do is break the vacuum — and it is safe, because the part is not placed
  // until the cups let go, which is what the interlock was ever guarding.
  lowerEarly
    ? rung('por-there', [
        [no('StepCarry'), no('PortalAtBooth'), set('StepLower'), rst('StepCarry')],
      ])
    : rung('por-there', [
        [
          no('StepCarry'),
          no('PortalAtBooth'),
          nc('PartAtBooth'),
          set('StepLower'),
          rst('StepCarry'),
        ],
      ]),
  lowerEarly
    ? rung('por-set-down', [
        [
          no('StepLower'),
          no('PortalDown'),
          nc('PartAtBooth'),
          set('StepRelease'),
          rst('StepLower'),
        ],
      ])
    : rung('por-set-down', [
        [no('StepLower'), no('PortalDown'), set('StepRelease'), rst('StepLower')],
      ]),
  // Vacuum off, head still down: the part is on the skid before the cups let go.
  rung('por-let-go', [[no('StepRelease'), nc('PartHeld'), set('StepHome'), rst('StepRelease')]]),
  rung('por-parked', [[no('StepHome'), no('PortalAtStore'), rst('StepHome')]]),
  // Every step above, then every coil below. That order is not tidiness: on the
  // scan the head arrives over the booth, the step that starts lowering it and
  // the coil that is still driving the traverse both want to be right, and only
  // one of them can be. Put a coil above the step that clears it and the portal
  // sets off down the rail with its head coming down.
  rung('por-run', [[no('StepCarry'), no('PortalUp'), out('TravelToBooth')]]),
  rung('por-home', [[no('StepHome'), no('PortalUp'), out('TravelToStore')]]),
  rung(
    'por-lower',
    [[no('StepPick'), out('LowerHead')], [no('StepLower')], [no('StepRelease')]],
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  ),
  rung(
    'por-vac',
    [[no('StepPick'), out('Vacuum')], [no('StepCarry')], [no('StepLower')]],
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
  rung('s-lane', [[mov('K1', 'LoadLaneSelect'), mov('K1', 'PickLaneSelect')]]),
  rung('s-load', [
    [no('PlantRun'), no('PartAtStoreInfeed'), cmp('<', 'Lane1Count', 'K2'), out('LoadIntoLane')],
  ]),
  rung('s-pick', [
    [no('PlantRun'), nc('PartAtStoreOutfeed'), cmp('>', 'Lane1Count', 'K0'), out('PickFromLane')],
  ]),
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
  rung('s-put-f1', [
    [
      no('PlantRun'),
      nc('BoomAtStoreInfeed'),
      cmp('<', 'Lane1Count', 'K2'),
      mov('K1', 'LoadLaneSelect'),
    ],
  ]),
  rung('s-put-f2', [
    [
      no('PlantRun'),
      nc('BoomAtStoreInfeed'),
      cmp('>=', 'Lane1Count', 'K2'),
      mov('K2', 'LoadLaneSelect'),
    ],
  ]),
  rung('s-put-b1', [
    [
      no('PlantRun'),
      no('BoomAtStoreInfeed'),
      cmp('<', 'Lane3Count', 'K2'),
      mov('K3', 'LoadLaneSelect'),
    ],
  ]),
  rung('s-put-b2', [
    [
      no('PlantRun'),
      no('BoomAtStoreInfeed'),
      cmp('>=', 'Lane3Count', 'K2'),
      mov('K4', 'LoadLaneSelect'),
    ],
  ]),
  rung(
    's-room-f',
    [
      [nc('BoomAtStoreInfeed'), cmp('<', 'Lane1Count', 'K2'), out('RoomForFrame')],
      [nc('BoomAtStoreInfeed'), cmp('<', 'Lane2Count', 'K2')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-room-b',
    [
      [no('BoomAtStoreInfeed'), cmp('<', 'Lane3Count', 'K2'), out('RoomForBoom')],
      [no('BoomAtStoreInfeed'), cmp('<', 'Lane4Count', 'K2')],
    ],
    [{ row: 0, col: 2 }],
  ),
  // Both rows run from the rail. A branch row that starts half way along with
  // nothing to its left is not a branch, it is a dead row: power reaches a cell
  // through the rail or through a vertical link, and this one had neither.
  rung(
    's-load',
    [
      [no('PlantRun'), no('PartAtStoreInfeed'), no('RoomForFrame'), out('LoadIntoLane')],
      [no('PlantRun'), no('PartAtStoreInfeed'), no('RoomForBoom')],
    ],
    [{ row: 0, col: 3 }],
  ),
  // Draw out: whichever type is due next, from the fuller lane of its pair.
  rung('s-take-f1', [
    [nc('BoomDue'), cmp('>', 'Lane1Count', 'K0'), mov('K1', 'PickLaneSelect')],
  ]),
  rung('s-take-f2', [
    [nc('BoomDue'), cmp('<=', 'Lane1Count', 'K0'), mov('K2', 'PickLaneSelect')],
  ]),
  rung('s-take-b1', [
    [no('BoomDue'), cmp('>', 'Lane3Count', 'K0'), mov('K3', 'PickLaneSelect')],
  ]),
  rung('s-take-b2', [
    [no('BoomDue'), cmp('<=', 'Lane3Count', 'K0'), mov('K4', 'PickLaneSelect')],
  ]),
  rung(
    's-have-f',
    [
      [nc('BoomDue'), cmp('>', 'Lane1Count', 'K0'), out('HaveFrame')],
      [nc('BoomDue'), cmp('>', 'Lane2Count', 'K0')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-have-b',
    [
      [no('BoomDue'), cmp('>', 'Lane3Count', 'K0'), out('HaveBoom')],
      [no('BoomDue'), cmp('>', 'Lane4Count', 'K0')],
    ],
    [{ row: 0, col: 2 }],
  ),
  rung(
    's-pick',
    [
      [no('PlantRun'), nc('PartAtStoreOutfeed'), no('HaveFrame'), out('PickFromLane')],
      [no('PlantRun'), nc('PartAtStoreOutfeed'), no('HaveBoom')],
    ],
    [{ row: 0, col: 3 }],
  ),
  // Turn about on the rising edge of a part landing on the outfeed. A level
  // contact cannot do this: it is true for as long as the part sits there, and
  // the relay would flip on every scan of it.
  rung('s-alt-arm', [[re('PartAtStoreOutfeed'), nc('BoomDue'), set('TurnArm')]]),
  rung('s-alt-clear', [[re('PartAtStoreOutfeed'), rst('BoomDue')]]),
  rung('s-alt-apply', [[no('TurnArm'), set('BoomDue'), rst('TurnArm')]]),
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
  rung('p-recipe', [[mov('K2200', 'HeaterCommand'), mov('K4000', 'GunFlowCommand')]]),
  rung('p-drum', [[mov('NextPaintColor', 'DrumSelect')]]),
  // Spray above purge, so the purge rung below reads this scan's gun rather than
  // last scan's. The two must never be commanded together.
  rung('p-spray', [
    [
      no('PlantRun'),
      no('PartAtBooth'),
      cmp('=', 'ColorInGun', 'NextPaintColor'),
      cmp('<', 'FilmThickness', 'K2400'),
      cmp('>=', 'BoothTemperature', 'K1900'),
      out('SprayGun'),
    ],
  ]),
  rung('p-purge', [
    [no('PlantRun'), nc('SprayGun'), cmp('<>', 'ColorInGun', 'NextPaintColor'), out('PurgeGun')],
  ]),
  rung('p-oven', [
    [
      no('PlantRun'),
      no('PartAtBooth'),
      cmp('=', 'ColorInGun', 'NextPaintColor'),
      cmp('>=', 'FilmThickness', 'K2400'),
      nc('OvenFull'),
      nc('PaintedLaneFull'),
      out('OvenInfeed'),
    ],
  ]),
];

/**
 * The paint shop, with a recipe per part and a changeover that costs nothing.
 *
 * The film target moves into a register chosen by the part in the booth, so one
 * spray rung serves both: a boom takes 150 um instead of 240, which is nearly a
 * second less spraying and most of a second less bake, both of them booth time.
 * And the purge runs whenever the color is wrong, blast or no blast, because it
 * flushes to waste and the part in the booth never sees it.
 */
export const PAINT_TUNED: Rung[] = [
  rung('p-recipe', [[mov('K2200', 'HeaterCommand'), mov('K4000', 'GunFlowCommand')]]),
  rung('p-drum', [[mov('NextPaintColor', 'DrumSelect')]]),
  // Two MOVs into one register is the value-selection idiom, not a double write:
  // each fires only on the scan its own rung conducts.
  rung('p-target-f', [[no('PlantRun'), nc('BoomInBooth'), mov('K2100', 'FilmTarget')]]),
  rung('p-target-b', [[no('PlantRun'), no('BoomInBooth'), mov('K1500', 'FilmTarget')]]),
  // Spray first, so the purge rung below reads this scan's gun rather than last
  // scan's. The two must never be commanded together.
  rung('p-spray', [
    [
      no('PlantRun'),
      no('PartAtBooth'),
      cmp('=', 'ColorInGun', 'NextPaintColor'),
      cmp('<', 'FilmThickness', 'FilmTarget'),
      cmp('>=', 'BoothTemperature', 'K1900'),
      out('SprayGun'),
    ],
  ]),
  rung('p-purge', [
    [no('PlantRun'), nc('SprayGun'), cmp('<>', 'ColorInGun', 'NextPaintColor'), out('PurgeGun')],
  ]),
  rung('p-oven', [
    [
      no('PlantRun'),
      no('PartAtBooth'),
      cmp('=', 'ColorInGun', 'NextPaintColor'),
      cmp('>=', 'FilmThickness', 'FilmTarget'),
      nc('OvenFull'),
      nc('PaintedLaneFull'),
      out('OvenInfeed'),
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
  rung('a-start', [
    [no('PlantRun'), no('FrameReady'), no('BoomReady'), nc('Building'), set('Building')],
  ]),
  // Both calls off one rung: an energized output passes power to its right, so
  // the frame and the boom are asked for together and the jig never sets out to
  // build half a machine.
  //
  // The calls stand until both parts are actually in, which FrameInJig and
  // BoomInJig report, rather than for a fixed window. A lane the sort is loading
  // into is a lane that is *moving*, and the jig cannot lift off a moving lane —
  // so a call that lasted one scan would silently miss, and the bench would
  // later be run with nothing on it.
  rung('a-call', [[no('Building'), nc('FrameIn'), out('CallFrame'), out('CallBoom')]]),
  // One rung claims both, because this program only ever takes them together.
  // Two names for the two claims all the same: BoomIn is what the release
  // resets, and a bit that is set and never cleared is a bit that lies the
  // second time round.
  rung('a-both', [
    [
      no('Building'),
      cmp('>', 'FrameInJig', 'K0'),
      cmp('>', 'BoomInJig', 'K0'),
      set('FrameIn'),
      set('BoomIn'),
    ],
  ]),
  rung('a-loaded', [[no('FrameIn'), tmr('Settle', 1)]]),
  rung('a-engine', [[no('PlantRun'), no('Settle'), nc('EngineIn'), out('LowerEngine')]]),
  rung('a-engine-t', [[no('PlantRun'), no('Settle'), tmr('EngineIn', 25)]]),
  rung('a-cab', [[no('PlantRun'), no('EngineIn'), nc('CabOn'), out('FitCab')]]),
  rung('a-cab-t', [[no('PlantRun'), no('EngineIn'), tmr('CabOn', 20)]]),
  // NC on Released and MachineComplete for the same reason the pin rung carries
  // them: the scan after a machine is released the step timers are still
  // standing done and the jig is empty, so without them the bench runs with
  // nothing on it.
  rung('a-prep', [
    [
      no('PlantRun'),
      no('CabOn'),
      nc('BoomMadeUp'),
      nc('MachineComplete'),
      nc('Released'),
      out('MakeUpBoom'),
    ],
  ]),
  rung('a-pin', [
    [
      no('PlantRun'),
      no('CabOn'),
      no('BoomMadeUp'),
      nc('MachineComplete'),
      nc('Released'),
      out('PinBoom'),
    ],
  ]),
  rung('a-release', [
    [no('PlantRun'), no('MachineComplete'), no('TestBayClear'), out('ReleaseToTest'), set('Released')],
  ]),
  rung('a-reset', [
    [
      no('Released'),
      nc('MachineComplete'),
      rst('Settle'),
      rst('EngineIn'),
      rst('CabOn'),
      rst('Building'),
      rst('FrameIn'),
      rst('BoomIn'),
      rst('Released'),
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
  rung('a-start', [[no('PlantRun'), no('FrameReady'), nc('Building'), set('Building')]]),
  // The call stands until the frame is in the jig, which FrameInJig reports. The
  // lane has to be stopped for the jig to lift off it, and the sort runs that
  // same lane to take a part from the paddle, so a call that lasted one scan
  // would sooner or later be raised against a moving belt and quietly miss.
  rung('a-call-f', [[no('Building'), nc('FrameIn'), out('CallFrame')]]),
  rung('a-got-f', [[no('Building'), cmp('>', 'FrameInJig', 'K0'), set('FrameIn')]]),
  rung('a-loaded', [[no('FrameIn'), tmr('Settle', 1)]]),
  // The call for a boom stands for the whole build, and only for a boom that
  // belongs to the same machine as the frame already in the jig: FrameInJig is
  // what the jig is holding, BoomColorReady what is at the head of the boom lane.
  rung('a-call-b', [
    [no('Building'), nc('BoomIn'), cmp('=', 'BoomColorReady', 'FrameInJig'), out('CallBoom')],
  ]),
  rung('a-have-b', [[no('Building'), cmp('>', 'BoomInJig', 'K0'), set('BoomIn')]]),
  rung('a-engine', [[no('PlantRun'), no('Settle'), nc('EngineIn'), out('LowerEngine')]]),
  rung('a-engine-t', [[no('PlantRun'), no('Settle'), tmr('EngineIn', 23)]]),
  rung('a-cab', [[no('PlantRun'), no('EngineIn'), nc('CabOn'), out('FitCab')]]),
  rung('a-cab-t', [[no('PlantRun'), no('EngineIn'), tmr('CabOn', 19)]]),
  // The bench, from the moment there is a boom to put on it.
  rung('a-prep', [
    [
      no('PlantRun'),
      no('BoomIn'),
      nc('BoomMadeUp'),
      nc('MachineComplete'),
      nc('Released'),
      out('MakeUpBoom'),
    ],
  ]),
  rung('a-pin', [
    [
      no('PlantRun'),
      no('CabOn'),
      no('BoomMadeUp'),
      nc('MachineComplete'),
      nc('Released'),
      out('PinBoom'),
    ],
  ]),
  rung('a-release', [
    [no('PlantRun'), no('MachineComplete'), no('TestBayClear'), out('ReleaseToTest'), set('Released')],
  ]),
  rung('a-reset', [
    [
      no('Released'),
      nc('MachineComplete'),
      rst('Settle'),
      rst('EngineIn'),
      rst('CabOn'),
      rst('Building'),
      rst('BoomIn'),
      rst('FrameIn'),
      rst('Released'),
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
  rung('t-pump', [
    [no('PlantRun'), no('MachineAtTest'), nc('TestPassed'), out('HydraulicPump')],
  ]),
  // NC on TestPassed so the timer clears the moment the test passes: the bay can
  // pull the next machine in on the same scan the last one drives off, and a
  // pressure timer still standing done would work the boom on a dead circuit.
  //
  // K=18 covers the 1.6 s the pack takes to come up with a tenth in hand. A
  // preset sized exactly to the pump is a rung that jams the first time anything
  // about the pack changes, which is a lesson the plant would rather teach in a
  // briefing than in a stack trace.
  rung('t-pressure', [
    [no('PlantRun'), no('MachineAtTest'), nc('TestPassed'), tmr('PumpUp', 18)],
  ]),
  rung('t-cycle', [[no('PlantRun'), no('PumpUp'), nc('TestPassed'), out('FunctionTest')]]),
  rung('t-dispatch', [[no('PlantRun'), no('TestPassed'), no('YardSpace'), out('Dispatch')]]),
  // Send for a lorry once there is nowhere left to put a machine …
  rung('t-call', [[nc('YardSpace'), set('TruckCalled')]]),
  // … hold it on the dock while it loads …
  rung('t-hold', [[no('TruckCalled'), out('CallTruck')]]),
  // … and let it go once the yard behind it is clear.
  rung('t-release', [
    [no('TruckAtDock'), cmp('<=', 'MachinesInYard', 'K0'), rst('TruckCalled')],
  ]),
];

/**
 * Test and dispatch, with the lorry sent for before it is needed.
 *
 * One rung different. Called at three machines in the yard rather than at six,
 * the truck is standing on the dock with spaces still free behind it, and the
 * line never once has to stop and wait for it.
 */
export const TEST_TUNED: Rung[] = [
  rung('t-pump', [
    [no('PlantRun'), no('MachineAtTest'), nc('TestPassed'), out('HydraulicPump')],
  ]),
  rung('t-pressure', [
    [no('PlantRun'), no('MachineAtTest'), nc('TestPassed'), tmr('PumpUp', 18)],
  ]),
  rung('t-cycle', [[no('PlantRun'), no('PumpUp'), nc('TestPassed'), out('FunctionTest')]]),
  rung('t-dispatch', [[no('PlantRun'), no('TestPassed'), no('YardSpace'), out('Dispatch')]]),
  rung('t-call', [[cmp('>=', 'MachinesInYard', 'K3'), set('TruckCalled')]]),
  rung('t-hold', [[no('TruckCalled'), out('CallTruck')]]),
  rung('t-release', [
    [no('TruckAtDock'), cmp('<=', 'MachinesInYard', 'K0'), rst('TruckCalled')],
  ]),
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
  rung('c-a1', [[no('PlantRun'), nc('Z3Occupied'), out('Z1Drive')]]),
  rung('c-a2', [[no('PlantRun'), nc('Z3Occupied'), out('Z2Drive')]]),
  rung('c-a3', [[no('PlantRun'), nc('Z3Occupied'), out('Z3Drive')]]),
  // Oven discharge to the sort, likewise.
  rung('c-b1', [[no('PlantRun'), nc('Z7Occupied'), out('Z4Drive')]]),
  rung('c-b2', [[no('PlantRun'), nc('Z7Occupied'), out('Z5Drive')]]),
  rung('c-b3', [[no('PlantRun'), nc('Z7Occupied'), out('Z6Drive')]]),
  rung('c-b4', [[no('PlantRun'), nc('Z7Occupied'), out('Z7Drive')]]),
  // The sort reads the part it is holding and paddles it into its own lane. The
  // lane has to be turning to take it, so the paddle and the lane go together.
  rung('c-sortf', [
    [
      no('PlantRun'),
      no('Z7Occupied'),
      nc('BoomAtSort'),
      nc('FrameLaneFull'),
      out('DivertToFrameLane'),
    ],
  ]),
  rung('c-sortb', [
    [
      no('PlantRun'),
      no('Z7Occupied'),
      no('BoomAtSort'),
      nc('BoomLaneFull'),
      out('DivertToBoomLane'),
    ],
  ]),
  rung('c-lanef', [[no('DivertToFrameLane'), out('Z8Drive')]]),
  rung('c-laneb', [[no('DivertToBoomLane'), out('Z9Drive')]]),
  // Assembly out through test, and the dock apron.
  rung('c-c1', [[no('PlantRun'), nc('Z11Occupied'), out('Z10Drive')]]),
  rung('c-c2', [[no('PlantRun'), nc('Z11Occupied'), out('Z11Drive')]]),
  rung('c-d1', [[no('PlantRun'), nc('Z12Occupied'), out('Z12Drive')]]),
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
  rung('c-z1', [[no('PlantRun'), nc('Z1Occupied'), out('Z1Drive')]]),
  rung('c-z2', [[no('PlantRun'), nc('Z2Occupied'), out('Z2Drive')]]),
  rung('c-z3', [[no('PlantRun'), nc('Z3Occupied'), out('Z3Drive')]]),
  rung('c-z4', [[no('PlantRun'), nc('Z4Occupied'), out('Z4Drive')]]),
  rung('c-z5', [[no('PlantRun'), nc('Z5Occupied'), out('Z5Drive')]]),
  rung('c-z6', [[no('PlantRun'), nc('Z6Occupied'), out('Z6Drive')]]),
  rung('c-z7', [[no('PlantRun'), nc('Z7Occupied'), out('Z7Drive')]]),
  rung('c-sortf', [
    [
      no('PlantRun'),
      no('Z7Occupied'),
      nc('BoomAtSort'),
      nc('FrameLaneFull'),
      out('DivertToFrameLane'),
    ],
  ]),
  rung('c-sortb', [
    [
      no('PlantRun'),
      no('Z7Occupied'),
      no('BoomAtSort'),
      nc('BoomLaneFull'),
      out('DivertToBoomLane'),
    ],
  ]),
  rung('c-lanef', [[no('DivertToFrameLane'), out('Z8Drive')]]),
  rung('c-laneb', [[no('DivertToBoomLane'), out('Z9Drive')]]),
  rung('c-z10', [[no('PlantRun'), nc('Z10Occupied'), out('Z10Drive')]]),
  rung('c-z11', [[no('PlantRun'), nc('Z11Occupied'), out('Z11Drive')]]),
  rung('c-z12', [[no('PlantRun'), nc('Z12Occupied'), out('Z12Drive')]]),
];
