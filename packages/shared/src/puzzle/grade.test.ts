import { describe, expect, it } from 'vitest';
import type { LadderElement, LadderProgram, Rung, VLink } from '../ladder/types.js';
import { getPuzzle } from './content/index.js';
import {
  CORRECTNESS_WEIGHT,
  PAR_SLACK,
  gradeProgram,
  throughputScore,
  traceScenario,
} from './grade.js';
import { validateProgram } from './validate.js';
import type { LadderPuzzleSpec } from './types.js';

/** Every puzzle in this file is a ladder puzzle; fail loudly if that changes. */
function getLadderPuzzle(slug: string): LadderPuzzleSpec | undefined {
  const spec = getPuzzle(slug);
  if (!spec) return undefined;
  if (spec.kind !== 'ladder') throw new Error(`puzzle ${slug} is not a ladder puzzle`);
  return spec;
}

// --- tiny ladder builders -------------------------------------------------
const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
const rise = (d: string): LadderElement => ({ type: 'contact-rising', device: d });
const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });
const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });
const wire: LadderElement = { type: 'hwire', device: '' };

function R(
  id: string,
  rows: number,
  cols: number,
  map: Record<string, LadderElement>,
  vlinks: VLink[] = [],
): Rung {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => map[`${r},${c}`] ?? null),
  );
  return { id, rows, cols, cells, vlinks };
}

// 5-floor call-dispatch core shared by every elevator5 puzzle: latches each
// call button, cascades "call pending above/below floor N", sets/clears the
// Up/Down latches per floor (stopping only where the floor's own call is
// still pending — tested before the clear rungs below it — so a further call
// beyond it can't suppress the stop), then clears the call and drives the
// motors. See docs on '09-elevator-dispatch' for the full design rationale.
function dispatchCore(): Rung[] {
  return [
    R('r1', 1, 2, { '0,0': no('X0'), '0,1': set('M0') }),
    R('r2', 1, 2, { '0,0': no('X1'), '0,1': set('M1') }),
    R('r3', 1, 2, { '0,0': no('X2'), '0,1': set('M2') }),
    R('r4', 1, 2, { '0,0': no('X3'), '0,1': set('M3') }),
    R('r5', 1, 2, { '0,0': no('X4'), '0,1': set('M4') }),
    R('r6', 2, 2, { '0,0': no('M3'), '0,1': out('M11'), '1,0': no('M4') }, [{ row: 0, col: 1 }]), // Above(3)
    R('r7', 2, 2, { '0,0': no('M2'), '0,1': out('M12'), '1,0': no('M11') }, [{ row: 0, col: 1 }]), // Above(2)
    R('r8', 2, 2, { '0,0': no('M1'), '0,1': out('M13'), '1,0': no('M12') }, [{ row: 0, col: 1 }]), // Above(1)
    R('r9', 2, 2, { '0,0': no('M0'), '0,1': out('M15'), '1,0': no('M1') }, [{ row: 0, col: 1 }]), // Below(3)
    R('r10', 2, 2, { '0,0': no('M15'), '0,1': out('M16'), '1,0': no('M2') }, [{ row: 0, col: 1 }]), // Below(4)
    R('r11', 2, 2, { '0,0': no('M16'), '0,1': out('M17'), '1,0': no('M3') }, [{ row: 0, col: 1 }]), // Below(5)
    R('r12', 4, 3, {
      '0,0': no('X10'), '0,1': no('M13'), '0,2': set('M5'),
      '1,0': no('X11'), '1,1': no('M12'), '1,2': set('M5'),
      '2,0': no('X12'), '2,1': no('M11'), '2,2': set('M5'),
      '3,0': no('X13'), '3,1': no('M4'), '3,2': set('M5'),
    }),
    R('r13', 4, 4, {
      '0,0': no('X11'), '0,1': nc('M12'), '0,2': no('M0'), '0,3': set('M6'),
      '1,0': no('X12'), '1,1': nc('M11'), '1,2': no('M15'), '1,3': set('M6'),
      '2,0': no('X13'), '2,1': nc('M4'), '2,2': no('M16'), '2,3': set('M6'),
      '3,0': no('X14'), '3,1': wire, '3,2': no('M17'), '3,3': set('M6'),
    }),
    R('r14', 4, 3, {
      '0,0': no('X11'), '0,1': no('M1'), '0,2': rst('M5'),
      '1,0': no('X12'), '1,1': no('M2'), '1,2': rst('M5'),
      '2,0': no('X13'), '2,1': no('M3'), '2,2': rst('M5'),
      '3,0': no('X14'), '3,1': wire, '3,2': rst('M5'),
    }),
    R('r15', 4, 3, {
      '0,0': no('X10'), '0,1': wire, '0,2': rst('M6'),
      '1,0': no('X11'), '1,1': no('M1'), '1,2': rst('M6'),
      '2,0': no('X12'), '2,1': no('M2'), '2,2': rst('M6'),
      '3,0': no('X13'), '3,1': no('M3'), '3,2': rst('M6'),
    }),
    R('r16', 1, 2, { '0,0': no('X10'), '0,1': rst('M0') }),
    R('r17', 1, 2, { '0,0': no('X11'), '0,1': rst('M1') }),
    R('r18', 1, 2, { '0,0': no('X12'), '0,1': rst('M2') }),
    R('r19', 1, 2, { '0,0': no('X13'), '0,1': rst('M3') }),
    R('r20', 1, 2, { '0,0': no('X14'), '0,1': rst('M4') }),
    R('r21', 1, 2, { '0,0': no('M5'), '0,1': out('Y0') }),
    R('r22', 1, 2, { '0,0': no('M6'), '0,1': out('Y1') }),
  ];
}

// Door subsystem shared by elevator5 puzzles that wire Y2/X15/X16: opens on a
// genuine-stop rising edge, dwells for the timer preset, then auto-closes.
function doorRungs(): Rung[] {
  return [
    R('r23', 5, 4, {
      '0,0': rise('X10'), '0,1': nc('M5'), '0,2': nc('M6'), '0,3': set('M20'),
      '1,0': rise('X11'), '1,1': nc('M5'), '1,2': nc('M6'), '1,3': set('M20'),
      '2,0': rise('X12'), '2,1': nc('M5'), '2,2': nc('M6'), '2,3': set('M20'),
      '3,0': rise('X13'), '3,1': nc('M5'), '3,2': nc('M6'), '3,3': set('M20'),
      '4,0': rise('X14'), '4,1': nc('M5'), '4,2': nc('M6'), '4,3': set('M20'),
    }),
    R('r24', 1, 2, { '0,0': no('M20'), '0,1': out('Y2') }),
    R('r25', 1, 2, { '0,0': no('X15'), '0,1': timer('T1', 30) }),
    R('r26', 1, 2, { '0,0': no('T1'), '0,1': rst('M20') }),
  ];
}

// Packer front end shared by pack-group / pack-lift / pack-full: one sealed
// full 2-pack stroke per matched pair — gated on the 4-pack cylinder being home
// (its rod crosses section 2) and on the pair count being incomplete — with C0
// counting strokes off the OUT sensor and loading the lift on completion.
function packFrontEnd(): Rung[] {
  return [
    R(
      'pp1',
      2,
      6,
      {
        '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X2'), '0,3': nc('C0'),
        '0,4': nc('X1'), '0,5': out('Y0'),
        '1,0': no('Y0'), '1,1': wire, '1,2': wire, '1,3': wire,
      },
      [{ row: 0, col: 4 }],
    ),
    R('pp2', 1, 2, { '0,0': no('X1'), '0,1': counter('C0', 2) }),
    R('pp3', 1, 3, { '0,0': no('C0'), '0,1': no('X4'), '0,2': out('Y1') }),
    R('pp4', 1, 2, { '0,0': no('X3'), '0,1': rst('C0') }),
  ];
}

// Lift/flip cycle: latch a flip request when the 4-pack pusher reaches OUT
// (the group is on the platform), release it at the top so the lift lowers.
// The process itself holds the lift down until the 4-pack rod is home again.
// In pack-full the flip output is additionally gated on the retaining
// bracket's pulled-back window (ship steps M1-M3): a flip landing with the
// bracket away would tip the on-end stack, so the lift waits at the bottom
// until the window closes.
function packFlip(gated = false): Rung[] {
  const flipOut = gated
    ? R('pl2', 1, 5, {
        '0,0': no('M0'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': nc('M3'), '0,4': out('Y2'),
      })
    : R('pl2', 1, 2, { '0,0': no('M0'), '0,1': out('Y2') });
  return [
    R('pl1', 1, 2, { '0,0': no('X3'), '0,1': set('M0') }),
    flipOut,
    R('pl3', 1, 2, { '0,0': no('X5'), '0,1': rst('M0') }),
  ];
}

// Shipping back end: count flips on C1 (K4 = 16 cartons in section 3); once
// the lift settles back down, run a one-hot step chain M1..M5 — bracket back,
// 16-pack-1 full stroke and home (the bracket springs forward again as M3
// clears), 16-pack-2 full stroke and home. C1 resets as the chain starts so
// flips for the NEXT pack count afresh.
function packShip(): Rung[] {
  // "step relay AND its end sensor" hand-off: SET the next relay, RST this one.
  const step = (id: string, m: string, sensor: string, nextM: string | null): Rung =>
    nextM
      ? R(
          id,
          2,
          3,
          { '0,0': no(m), '0,1': no(sensor), '0,2': set(nextM), '1,2': rst(m) },
          [{ row: 0, col: 2 }],
        )
      : R(id, 1, 3, { '0,0': no(m), '0,1': no(sensor), '0,2': rst(m) });
  return [
    // The bracket rests FORWARD (the stack needs it), pulled back across M1-M3.
    R('ps1', 1, 4, { '0,0': nc('M1'), '0,1': nc('M2'), '0,2': nc('M3'), '0,3': out('Y5') }),
    R('ps2', 1, 2, { '0,0': no('X5'), '0,1': counter('C1', 4) }),
    R(
      'ps3',
      2,
      3,
      { '0,0': rise('X4'), '0,1': no('C1'), '0,2': set('M1'), '1,2': rst('C1') },
      [{ row: 0, col: 2 }],
    ),
    R('ps4', 1, 2, { '0,0': no('M2'), '0,1': out('Y3') }),
    R('ps5', 1, 2, { '0,0': no('M4'), '0,1': out('Y4') }),
    step('ps6', 'M1', 'X12', 'M2'),
    step('ps7', 'M2', 'X7', 'M3'),
    step('ps8', 'M3', 'X6', 'M4'),
    step('ps9', 'M4', 'X11', 'M5'),
    step('ps10', 'M5', 'X10', null),
  ];
}

// Single-slot pick-and-place cycle (pick-place-cycle): a Carrying latch M0
// (set on rise(X12), reset on rise(X14)) gates reach/gripper at each end —
// extend+grip at the infeed only while not carrying and the slot is free,
// extend+release at the slot only while carrying — and the swing coils just
// need "carrying + retracted" / "not carrying + retracted" to start, since
// arriving (extending again) always drops the retracted sensor and prevents
// re-triggering.
function pickPlaceOneSlot(): Rung[] {
  return [
    R('pc1', 1, 2, { '0,0': rise('X12'), '0,1': set('M0') }),
    R('pc2', 1, 2, { '0,0': rise('X14'), '0,1': rst('M0') }),
    R(
      'pc3',
      2,
      4,
      {
        '0,0': no('X0'), '0,1': nc('M0'), '0,2': nc('X14'), '0,3': set('Y2'),
        '1,0': no('X1'), '1,1': no('M0'), '1,2': wire, '1,3': set('Y2'),
      },
    ),
    R(
      'pc4',
      2,
      2,
      { '0,0': rise('X12'), '0,1': rst('Y2'), '1,0': rise('X14'), '1,1': rst('Y2') },
    ),
    R('pc5', 1, 5, {
      '0,0': no('X0'), '0,1': nc('M0'), '0,2': no('X10'), '0,3': nc('X14'), '0,4': set('Y3'),
    }),
    R('pc6', 1, 4, { '0,0': no('X1'), '0,1': no('M0'), '0,2': no('X10'), '0,3': rst('Y3') }),
    R('pc7', 1, 3, { '0,0': no('M0'), '0,1': no('X11'), '0,2': set('Y0') }),
    R('pc8', 1, 2, { '0,0': no('X1'), '0,1': rst('Y0') }),
    R('pc9', 1, 3, { '0,0': nc('M0'), '0,1': no('X11'), '0,2': set('Y1') }),
    R('pc10', 1, 2, { '0,0': no('X0'), '0,1': rst('Y1') }),
  ];
}

// 4-slot pick-and-place tray core (pick-place-tray / -supply / -full): same
// Carrying-latch idea, generalized — a placement pulse M1 (any occupied
// sensor rising) resets Carrying, and the machine's own Tray Full sensor
// (X18) both lights Y4 and guards new picks. The swing-out RESET is an
// elevator5-style OR-cascade that only stops at the first station whose own
// occupied sensor is still off, so the arm correctly sails past already-full
// slots in passing. `gateSupply` adds the X13 (Part at Infeed) condition
// used from pick-place-supply onward; `gateOrder` adds pick-place-full's
// nc(C0) order-closed guard.
function pickPlaceTrayCore(gateSupply: boolean, gateOrder = false): Rung[] {
  const infeedConds: LadderElement[] = [no('X0'), nc('M0'), nc('X18')];
  if (gateSupply) infeedConds.push(no('X13'));
  if (gateOrder) infeedConds.push(nc('C0'));

  // Reach-down (Y2): the infeed branch (pick, gated on supply/order when
  // required) ORed with one branch per slot (place while carrying) — every
  // row spans the full column range, padding the shorter slot branches with
  // explicit wire cells rather than leaving them empty (an empty cell is an
  // open circuit, not a conductor).
  const extendCols = infeedConds.length + 1;
  const extendMap: Record<string, LadderElement> = {};
  infeedConds.forEach((el, c) => {
    extendMap[`0,${c}`] = el;
  });
  extendMap[`0,${extendCols - 1}`] = set('Y2');
  for (let i = 1; i <= 4; i++) {
    extendMap[`${i},0`] = no(`X${i}`);
    extendMap[`${i},1`] = no('M0');
    for (let c = 2; c < extendCols - 1; c++) extendMap[`${i},${c}`] = wire;
    extendMap[`${i},${extendCols - 1}`] = set('Y2');
  }

  const gripMap: Record<string, LadderElement> = {};
  [...infeedConds, no('X10')].forEach((el, c) => {
    gripMap[`0,${c}`] = el;
  });
  gripMap[`0,${extendCols}`] = set('Y3');

  return [
    // OUT coils don't OR across independent rows the way SET/RST do (each
    // row's own energized value would just overwrite the last one written) —
    // this needs one physical coil plus vlinks merging the branches, exactly
    // like dispatchCore's Above/Below cascades.
    R(
      'pt1',
      4,
      2,
      {
        '0,0': rise('X14'), '0,1': out('M1'),
        '1,0': rise('X15'),
        '2,0': rise('X16'),
        '3,0': rise('X17'),
      },
      [
        { row: 0, col: 1 },
        { row: 1, col: 1 },
        { row: 2, col: 1 },
      ],
    ),
    R('pt2', 1, 2, { '0,0': rise('X12'), '0,1': set('M0') }),
    R('pt3', 1, 2, { '0,0': no('M1'), '0,1': rst('M0') }),
    R('pt4', 1, 2, { '0,0': no('X18'), '0,1': out('Y4') }),
    R('pt5', 5, extendCols, extendMap),
    R('pt6', 2, 2, { '0,0': rise('X12'), '0,1': rst('Y2'), '1,0': no('M1'), '1,1': rst('Y2') }),
    R('pt7', 1, extendCols + 1, gripMap),
    R('pt8', 4, 4, {
      '0,0': no('X1'), '0,1': no('M0'), '0,2': no('X10'), '0,3': rst('Y3'),
      '1,0': no('X2'), '1,1': no('M0'), '1,2': no('X10'), '1,3': rst('Y3'),
      '2,0': no('X3'), '2,1': no('M0'), '2,2': no('X10'), '2,3': rst('Y3'),
      '3,0': no('X4'), '3,1': no('M0'), '3,2': no('X10'), '3,3': rst('Y3'),
    }),
    R('pt9', 1, 3, { '0,0': no('M0'), '0,1': no('X11'), '0,2': set('Y0') }),
    R('pt10', 4, 3, {
      '0,0': no('X1'), '0,1': nc('X14'), '0,2': rst('Y0'),
      '1,0': no('X2'), '1,1': nc('X15'), '1,2': rst('Y0'),
      '2,0': no('X3'), '2,1': nc('X16'), '2,2': rst('Y0'),
      '3,0': no('X4'), '3,1': nc('X17'), '3,2': rst('Y0'),
    }),
    R('pt11', 1, 3, { '0,0': nc('M0'), '0,1': no('X11'), '0,2': set('Y1') }),
    R('pt12', 1, 2, { '0,0': no('X0'), '0,1': rst('Y1') }),
  ];
}

// Supply-wait lamp (pick-place-supply onward): lit only while parked at the
// infeed with no part ready.
function pickPlaceSupplyLamp(): Rung[] {
  return [R('pt13', 1, 3, { '0,0': no('X0'), '0,1': nc('X13'), '0,2': out('Y6') })];
}

// Production order (pick-place-full): X20 passes straight through to the
// process's Y5 unload coil, C0 counts each Tray Full rise (K2 = the order),
// and its done bit lights Y7 — and, via nc(C0) in the tray core's infeed
// branches, keeps the order closed after the final unload. C0 is never
// reset; holding its done state is what ends the run.
function pickPlaceOrder(): Rung[] {
  return [
    R('pt14', 1, 2, { '0,0': no('X20'), '0,1': out('Y5') }),
    R('pt15', 1, 2, { '0,0': no('X18'), '0,1': counter('C0', 2) }),
    R('pt16', 1, 2, { '0,0': no('C0'), '0,1': out('Y7') }),
  ];
}

// Drill station: the seal-in every puzzle in the category starts from —
// (X0 OR M0) AND healthy AND NOT at-bottom — with the clamp holding for the
// whole cycle and the feed gated on the clamped sensor, not on the run latch.
function drillClampFeedCore(): Rung[] {
  return [
    R(
      'dc1',
      2,
      4,
      { '0,0': no('X0'), '1,0': no('M0'), '0,1': no('X1'), '0,2': nc('X3'), '0,3': out('M0') },
      [{ row: 0, col: 1 }],
    ),
    R('dc2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }),
    R('dc3', 1, 3, { '0,0': no('M0'), '0,1': no('X2'), '0,2': out('Y1') }),
  ];
}

// Drill station full stroke: the clamp/feed core above, extended with the
// beacon, the latched CYCLE DONE lamp and the eject pusher. Both cylinders
// report each end of travel here, and the machine enforces it — running the
// pusher across a head that is not yet fully up (X10) shears the bit off, so
// the eject cannot simply be fired at the bottom sensor.
function drillFullStroke(): Rung[] {
  return [
    // Run latch: (X0 OR M0) AND X1(healthy) AND X11(rod home) AND NOT X3(bottom).
    R(
      'dfs1',
      2,
      5,
      {
        '0,0': no('X0'),
        '1,0': no('M0'),
        '0,1': no('X1'),
        '0,2': no('X11'),
        '0,3': nc('X3'),
        '0,4': out('M0'),
      },
      [{ row: 0, col: 1 }],
    ),
    R('dfs2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }), // clamp whole cycle
    R('dfs3', 1, 3, { '0,0': no('M0'), '0,1': no('X2'), '0,2': out('Y1') }), // drill once clamped
    R('dfs4', 1, 2, { '0,0': no('Y1'), '0,1': out('Y2') }), // beacon while drilling
    R('dfs5', 1, 2, { '0,0': no('X3'), '0,1': set('Y3') }), // latch done at bottom
    R('dfs6', 1, 2, { '0,0': no('X0'), '0,1': rst('Y3') }), // clear on next start
    // The eject waits for the head to clear the bore. A rising edge on X10 is
    // what keeps this a one-shot: X10 and Y3 both stay on after the rod is
    // recalled, so a level contact would re-SET Y4 the scan after every RESET
    // and cycle the pusher forever.
    R('dfs7', 1, 3, { '0,0': rise('X10'), '0,1': no('Y3'), '0,2': set('Y4') }),
    R('dfs8', 1, 2, { '0,0': no('X4'), '0,1': rst('Y4') }), // stop at the end of the stroke
  ];
}

// Automatic drilling cycle (drill-spindle / drill-production): two stage relays
// — M0 "drilling this part", M1 "ejecting it" — started only by a part actually
// on the fixture. The feed is interlocked on clamped AND spindle-at-speed, and
// the bottom dwell timer both retracts the feed (via nc(T0), which is why the
// timer rung sits above the feed rung) and hands over to the eject stage.
// `mixed` adds drill-production's steel handling: nc(X6)/nc(C0) guards on the
// drill stage, a third relay M2 for the reject stage driving the diverter, and
// the batch counter that closes the order down.
function drillAutoCycle(mixed: boolean): Rung[] {
  const startConds: LadderElement[] = [no('X0'), no('X1'), no('X5'), nc('M1')];
  if (mixed) startConds.push(nc('X6'), nc('C0'));
  const startMap: Record<string, LadderElement> = {};
  startConds.forEach((el, c) => {
    startMap[`0,${c}`] = el;
  });
  startMap[`0,${startConds.length}`] = set('M0');

  const rungs: Rung[] = [
    R('ds1', 1, startConds.length + 1, startMap),
    // Clamp and spindle both follow the drilling stage, so dropping M0 at the end
    // of the dwell is what stops the rotation between parts.
    R('ds2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }),
    R('ds3', 1, 2, { '0,0': no('M0'), '0,1': out('Y5') }),
    R('ds4', 1, 2, { '0,0': no('Y5'), '0,1': out('Y2') }),
    R('ds5', 1, 2, { '0,0': no('X3'), '0,1': timer('T0', 10) }),
    R('ds6', 1, 5, {
      '0,0': no('M0'), '0,1': no('X2'), '0,2': no('X7'), '0,3': nc('T0'), '0,4': out('Y1'),
    }),
    R('ds7', 2, 2, { '0,0': no('T0'), '0,1': set('M1'), '1,1': rst('M0') }, [{ row: 0, col: 1 }]),
    R('ds8', 1, 2, { '0,0': no('M1'), '0,1': out('Y3') }),
  ];
  if (!mixed) {
    rungs.push(
      R('ds9', 1, 2, { '0,0': no('M1'), '0,1': out('Y4') }),
      R('ds10', 1, 2, { '0,0': no('X4'), '0,1': rst('M1') }),
      R('ds11', 2, 2, { '0,0': nc('X1'), '0,1': rst('M0'), '1,1': rst('M1') }, [{ row: 0, col: 1 }]),
    );
    return rungs;
  }
  rungs.push(
    // Steel: never clamped, never drilled — divert and push it to the scrap bin.
    R('dm1', 1, 6, {
      '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X5'), '0,3': no('X6'), '0,4': nc('C0'),
      '0,5': set('M2'),
    }),
    R('dm2', 1, 2, { '0,0': no('M2'), '0,1': out('Y6') }),
    // One physical eject coil fed by both stages — an OUT coil doesn't OR across
    // independent rows, so the merge has to be a vertical link.
    R('dm3', 2, 2, { '0,0': no('M1'), '0,1': out('Y4'), '1,0': no('M2') }, [{ row: 0, col: 1 }]),
    // Counting the dwell (one pulse per finished hole) is what keeps rejects out
    // of the batch; C0 is never reset, so its done bit parks the station.
    R('dm4', 1, 2, { '0,0': no('T0'), '0,1': counter('C0', 3) }),
    R('dm5', 1, 2, { '0,0': no('C0'), '0,1': out('Y7') }),
    R('dm6', 2, 2, { '0,0': no('X4'), '0,1': rst('M1'), '1,1': rst('M2') }, [{ row: 0, col: 1 }]),
    R(
      'dm7',
      3,
      2,
      { '0,0': nc('X1'), '0,1': rst('M0'), '1,1': rst('M1'), '2,1': rst('M2') },
      [{ row: 0, col: 1 }, { row: 1, col: 1 }],
    ),
  );
  return rungs;
}

// --- canonical solutions --------------------------------------------------
const solutions: Record<string, LadderProgram> = {
  'direct-control': {
    rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })],
  },
  'seal-in': {
    rungs: [
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('Y0'), '0,1': nc('X1'), '0,2': out('Y0') },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  estop: {
    rungs: [
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X0'),
          '1,0': no('Y0'),
          '0,1': no('X2'),
          '0,2': nc('X1'),
          '0,3': out('Y0'),
        },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  'delayed-start': {
    rungs: [
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('M0'), '0,1': nc('X1'), '0,2': out('M0') },
        [{ row: 0, col: 1 }],
      ),
      R('r2', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }),
      R('r3', 1, 2, { '0,0': no('M0'), '0,1': timer('T0', 20) }),
      R('r4', 1, 2, { '0,0': no('T0'), '0,1': out('Y0') }),
    ],
  },
  'batch-counter': {
    rungs: [
      R('r1', 1, 2, { '0,0': no('X0'), '0,1': counter('C0', 5) }),
      R('r2', 1, 2, { '0,0': no('C0'), '0,1': out('Y0') }),
      R('r3', 1, 2, { '0,0': no('X1'), '0,1': rst('C0') }),
    ],
  },
  'run-on-timer': {
    rungs: [
      // Motor seal-in: (X0 OR Y0) AND NOT X1 -> Y0
      R(
        'r1',
        2,
        3,
        { '0,0': no('X0'), '1,0': no('Y0'), '0,1': nc('X1'), '0,2': out('Y0') },
        [{ row: 0, col: 1 }],
      ),
      // Fan seal-in: (Y0 OR (Y1 AND NOT T0)) -> Y1 — follows the motor, then holds
      // itself until the run-on timer finishes.
      R(
        'r2',
        2,
        3,
        { '0,0': no('Y0'), '0,1': wire, '0,2': out('Y1'), '1,0': no('Y1'), '1,1': nc('T0') },
        [{ row: 0, col: 2 }],
      ),
      // Run-on timer counts only while the fan is on but the motor is off.
      R('r3', 1, 3, { '0,0': no('Y1'), '0,1': nc('Y0'), '0,2': timer('T0', 30) }),
    ],
  },
  flasher: {
    rungs: [
      // Two-timer oscillator: T0 times the on-phase, T1 the off-phase.
      R('r1', 1, 3, { '0,0': no('X0'), '0,1': nc('T1'), '0,2': timer('T0', 10) }),
      R('r2', 1, 2, { '0,0': no('T0'), '0,1': timer('T1', 10) }),
      // Beacon lit while enabled and T0 has not yet completed its phase.
      R('r3', 1, 3, { '0,0': no('X0'), '0,1': nc('T0'), '0,2': out('Y0') }),
    ],
  },
  'two-hand-press': {
    rungs: [
      // Advance only with both palms + healthy e-stop, and not already latched-done.
      R('r1', 1, 5, {
        '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X2'), '0,3': nc('M0'), '0,4': out('Y0'),
      }),
      R('r2', 1, 2, { '0,0': no('X3'), '0,1': set('M0') }), // latch done at bottom
      R('r3', 1, 3, { '0,0': nc('X0'), '0,1': nc('X1'), '0,2': rst('M0') }), // clear on both released
      R('r4', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }), // stroke-complete lamp
    ],
  },
  'pack-basics': {
    rungs: [
      // Seal a full stroke on a matched pair: (X14·X15 OR Y0) AND NOT X1 → Y0.
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X14'), '0,1': no('X15'), '0,2': nc('X1'), '0,3': out('Y0'),
          '1,0': no('Y0'), '1,1': wire,
        },
        [{ row: 0, col: 2 }],
      ),
    ],
  },
  'pack-group': { rungs: packFrontEnd() },
  'pack-lift': { rungs: [...packFrontEnd(), ...packFlip()] },
  'pack-full': { rungs: [...packFrontEnd(), ...packFlip(true), ...packShip()] },
  'conveyor-stop': {
    rungs: [
      R(
        'r1',
        2,
        4,
        {
          '0,0': no('X0'),
          '1,0': no('Y0'),
          '0,1': nc('X1'),
          '0,2': nc('X2'),
          '0,3': out('Y0'),
        },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  'drill-clamp-feed': { rungs: drillClampFeedCore() },
  'drill-spindle': { rungs: drillAutoCycle(false) },
  'drill-production': { rungs: drillAutoCycle(true) },
  'drill-station': { rungs: drillFullStroke() },
  'elevator-auto-return': {
    rungs: [
      R('r1', 1, 3, { '0,0': no('X0'), '0,1': nc('X5'), '0,2': out('Y0') }), // up while commanded, stop at top
      R('r2', 1, 3, { '0,0': nc('X3'), '0,1': nc('X0'), '0,2': timer('T0', 100) }), // idle timer
      // Descent latch: (T0 OR M0) AND NOT X3 AND NOT X0 -> M0
      R(
        'r3',
        2,
        4,
        {
          '0,0': no('T0'),
          '1,0': no('M0'),
          '0,1': nc('X3'),
          '0,2': nc('X0'),
          '0,3': out('M0'),
        },
        [{ row: 0, col: 1 }],
      ),
      R('r4', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }), // drive down
    ],
  },
  'elevator-5-dispatch': { rungs: dispatchCore() },
  'elevator-doors': { rungs: [...dispatchCore(), ...doorRungs()] },
  'pick-place-cycle': { rungs: pickPlaceOneSlot() },
  'pick-place-tray': { rungs: pickPlaceTrayCore(false) },
  'pick-place-supply': { rungs: [...pickPlaceTrayCore(true), ...pickPlaceSupplyLamp()] },
  'pick-place-full': {
    rungs: [...pickPlaceTrayCore(true, true), ...pickPlaceSupplyLamp(), ...pickPlaceOrder()],
  },
  'elevator-full': {
    rungs: [
      ...dispatchCore(),
      ...doorRungs(),
      // Any call pending, anywhere (a 5-way OR merged via vlinks into one coil).
      R(
        'r27',
        5,
        2,
        { '0,0': no('M0'), '1,0': no('M1'), '2,0': no('M2'), '3,0': no('M3'), '4,0': no('M4'), '4,1': out('M21') },
        [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }, { row: 3, col: 1 }],
      ),
      // Idle away from floor 1, nothing pending, not mid-trip -> count 10 s.
      R('r28', 1, 5, {
        '0,0': nc('X10'), '0,1': nc('M21'), '0,2': nc('M5'), '0,3': nc('M6'), '0,4': timer('T2', 100),
      }),
      // Treat the timeout exactly like a floor-1 call — dispatch/doors already
      // know what to do with one.
      R('r29', 1, 2, { '0,0': no('T2'), '0,1': set('M0') }),
    ],
  },
};

describe('gradeProgram — canonical solutions solve every puzzle', () => {
  for (const [slug, program] of Object.entries(solutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getLadderPuzzle(slug);
      expect(spec, `puzzle ${slug} exists`).toBeDefined();
      const validation = validateProgram(spec!, program);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      // A shipped solution must never trip an advisory either — otherwise the
      // warning is noise and players learn to ignore it.
      expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([]);
      const result = gradeProgram(spec!, program);
      const failed = result.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
      expect(failed, failed.join(' | ')).toEqual([]);
      expect(result.solved).toBe(true);
      expect(result.score).toBe(100);
    });
  }
});

/**
 * Correct but slower than par: every scenario passes, so the program is solved
 * and banks the whole correctness weight, but it gives up part of the
 * throughput weight and so falls short of 100.
 */
function expectSolvedButNotOptimal(spec: LadderPuzzleSpec, program: LadderProgram): void {
  const result = gradeProgram(spec, program);
  const failed = result.scenarios
    .filter((s) => !s.passed)
    .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
  expect(failed, failed.join(' | ')).toEqual([]);
  expect(result.solved).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(CORRECTNESS_WEIGHT);
  expect(result.score).toBeLessThan(100);
  expect(result.efficiency).toBeLessThan(1);
}

// A sequential machine is paced by the program driving it, so two equally
// correct solutions can reach the same milestone hundreds of ms apart. These
// are real player solutions that used to score 33% / 50% against scenarios
// whose deadlines were tuned to the canonical program's exact cycle time; they
// are the guardrail against grading pace instead of behaviour. Pace still
// costs marks — it just no longer costs the pass.
describe('gradeProgram — differently paced but correct solutions still solve', () => {
  it('drill-spindle: starting the spindle once CLAMPED is in, not with the clamp', () => {
    // Y5 waits for X2, which pushes spin-up, the feed, the dwell and the eject
    // ~400ms later than the canonical program. The feed is retracted by M0
    // dropping rather than by nc(T0), one scan later again.
    const spec = getLadderPuzzle('drill-spindle')!;
    const rungs = [
      R('a1', 1, 5, {
        '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X5'), '0,3': nc('M1'), '0,4': out('M0'),
      }),
      R('a2', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }),
      R('a3', 1, 3, { '0,0': no('M0'), '0,1': no('X2'), '0,2': out('Y5') }),
      R('a4', 1, 2, { '0,0': no('Y5'), '0,1': out('Y2') }),
      R('a5', 1, 4, { '0,0': no('M0'), '0,1': no('X2'), '0,2': no('X7'), '0,3': out('Y1') }),
      R('a6', 1, 3, { '0,0': no('X3'), '0,1': no('X7'), '0,2': timer('T0', 10) }),
      R('a7', 1, 3, { '0,0': no('M0'), '0,1': no('T0'), '0,2': set('M1') }),
      R('a8', 1, 2, { '0,0': no('M1'), '0,1': out('Y3') }),
      R('a9', 1, 2, { '0,0': no('M1'), '0,1': out('Y4') }),
      R('a10', 1, 2, { '0,0': no('X4'), '0,1': rst('M1') }),
    ];
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expectSolvedButNotOptimal(spec, { rungs });
  });

  it('pack-full: a front end that pauses instead of filling through the flip', () => {
    // Gating the 2-pack pusher on nc(M0) stops section 2 filling while the lift
    // is away, so the line runs un-pipelined: every flip lands ~900ms later
    // than the canonical program's, compounding over the four flips of a pack.
    const spec = getLadderPuzzle('pack-full')!;
    const rungs = [
      R(
        'b1',
        2,
        6,
        {
          '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X0'), '0,3': no('X2'),
          '0,4': nc('M0'), '0,5': out('Y0'),
          '1,0': no('Y0'), '1,1': nc('X1'), '1,2': wire, '1,3': wire,
        },
        [{ row: 0, col: 4 }],
      ),
      R('b2', 1, 2, { '0,0': no('X1'), '0,1': counter('C0', 2) }),
      R(
        'b3',
        2,
        4,
        {
          '0,0': no('X2'), '0,1': no('X4'), '0,2': no('C0'), '0,3': out('Y1'),
          '1,0': no('Y1'), '1,1': nc('X3'), '1,2': wire,
        },
        [{ row: 0, col: 3 }],
      ),
      R('b4', 1, 2, { '0,0': no('X3'), '0,1': rst('C0') }),
      R('b5', 1, 3, { '0,0': no('X3'), '0,1': no('X4'), '0,2': set('M0') }),
      R('b6', 1, 2, { '0,0': no('X5'), '0,1': rst('M0') }),
      R('b7', 1, 2, { '0,0': no('X5'), '0,1': counter('C1', 4) }),
      R('b8', 1, 5, {
        '0,0': no('M0'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': nc('M3'), '0,4': out('Y2'),
      }),
      R('b9', 1, 4, { '0,0': nc('M1'), '0,1': nc('M2'), '0,2': nc('M3'), '0,3': out('Y5') }),
      R(
        'b10',
        2,
        3,
        { '0,0': rise('X4'), '0,1': no('C1'), '0,2': set('M1'), '1,2': rst('C1') },
        [{ row: 0, col: 2 }],
      ),
      R('b11', 1, 2, { '0,0': no('M2'), '0,1': out('Y3') }),
      R('b12', 1, 2, { '0,0': no('M4'), '0,1': out('Y4') }),
      R('b13', 2, 3, { '0,0': no('M1'), '0,1': no('X12'), '0,2': set('M2'), '1,2': rst('M1') }, [
        { row: 0, col: 2 },
      ]),
      R('b14', 2, 3, { '0,0': no('M2'), '0,1': no('X7'), '0,2': set('M3'), '1,2': rst('M2') }, [
        { row: 0, col: 2 },
      ]),
      R('b15', 2, 3, { '0,0': no('M3'), '0,1': no('X6'), '0,2': set('M4'), '1,2': rst('M3') }, [
        { row: 0, col: 2 },
      ]),
      R('b16', 2, 3, { '0,0': no('M4'), '0,1': no('X11'), '0,2': set('M5'), '1,2': rst('M4') }, [
        { row: 0, col: 2 },
      ]),
      R('b17', 1, 3, { '0,0': no('M5'), '0,1': no('X10'), '0,2': rst('M5') }),
    ];
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expectSolvedButNotOptimal(spec, { rungs });
  });
});

describe('throughputScore', () => {
  it('gives full marks at or under par and none past the slack limit', () => {
    expect(throughputScore(5000, 10000)).toBe(1);
    expect(throughputScore(10000, 10000)).toBe(1);
    expect(throughputScore(10000 * PAR_SLACK, 10000)).toBe(0);
    expect(throughputScore(60000, 10000)).toBe(0);
  });

  it('tapers linearly between the two', () => {
    const half = 10000 * (1 + (PAR_SLACK - 1) / 2);
    expect(throughputScore(half, 10000)).toBeCloseTo(0.5, 6);
  });

  it('treats a scenario with no meaningful par as on time', () => {
    expect(throughputScore(9999, 0)).toBe(1);
  });
});

describe('gradeProgram — throughput only counts once the program works', () => {
  it('reports elapsed time and par per scenario', () => {
    const spec = getLadderPuzzle('drill-spindle')!;
    const result = gradeProgram(spec, solutions['drill-spindle']!);
    const cycle = result.scenarios.find((s) => s.name === 'Two parts run back to back')!;
    expect(cycle.parMs).toBeDefined();
    expect(cycle.elapsedMs).toBeGreaterThan(0);
    expect(cycle.elapsedMs).toBeLessThanOrEqual(cycle.parMs!);
    expect(result.efficiency).toBe(1);
  });

  it('withholds every throughput mark from a program that fails a scenario', () => {
    const spec = getLadderPuzzle('drill-spindle')!;
    // Never clamps, so the fixture stays empty and the run is over in no time —
    // a fast wrong answer must not out-score a slow right one.
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y5') })] };
    const result = gradeProgram(spec, bad);
    expect(result.solved).toBe(false);
    expect(result.score).toBeLessThan(CORRECTNESS_WEIGHT);
  });

  it('scores puzzles with no declared par on correctness alone', () => {
    const spec = getLadderPuzzle('seal-in')!;
    expect(spec.scenarios.every((s) => s.parMs === undefined)).toBe(true);
    const result = gradeProgram(spec, solutions['seal-in']!);
    expect(result.efficiency).toBeUndefined();
    expect(result.score).toBe(100);
  });
});

describe('gradeProgram — wrong programs do not solve', () => {
  it('a direct wire without seal-in fails the seal-in puzzle', () => {
    const spec = getLadderPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const result = gradeProgram(spec, bad);
    expect(result.solved).toBe(false);
    expect(result.score).toBeLessThan(100);
  });

  it('an empty program never solves', () => {
    const spec = getLadderPuzzle('direct-control')!;
    const empty: LadderProgram = { rungs: [R('r1', 1, 2, {})] };
    expect(gradeProgram(spec, empty).solved).toBe(false);
  });

  it('a latched (non-momentary) 2-pack pusher starves the whole packer line', () => {
    // Drive the 2-pack pusher with a SET instead of the sealed OUT coil: it
    // extends once and never springs back, so the extended plate blocks the
    // lanes, no further pair ever reaches the stop, and every downstream
    // milestone (flips, the shipped 16-pack) starves.
    const spec = getLadderPuzzle('pack-full')!;
    const stalled = [...packFrontEnd(), ...packFlip(), ...packShip()].map((r) =>
      r.id === 'pp1'
        ? R('pp1', 1, 5, {
            '0,0': no('X14'), '0,1': no('X15'), '0,2': no('X2'), '0,3': nc('C0'), '0,4': set('Y0'),
          })
        : r,
    );
    const validation = validateProgram(spec, { rungs: stalled });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(gradeProgram(spec, { rungs: stalled }).solved).toBe(false);
  });
});

describe('gradeProgram — plausible wrong elevator programs are rejected', () => {
  // Each of these must pass validation (structurally fine) and fail grading —
  // that is what proves the scenarios discriminate, not just that the puzzle
  // is solvable.
  function expectFailsGrading(slug: string, program: LadderProgram): ReturnType<typeof gradeProgram> {
    const spec = getLadderPuzzle(slug)!;
    const validation = validateProgram(spec, program);
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    const result = gradeProgram(spec, program);
    expect(result.solved).toBe(false);
    return result;
  }

  it('a down-preferring tie-break fails exactly the "prefers up" dispatch scenario', () => {
    // Same core, but the Up latch is gated on "nothing pending below" and the
    // Down latch is unconditional — i.e. down wins the both-sides tie.
    const downPref = dispatchCore().map((r) => {
      if (r.id === 'r12') {
        return R('r12', 4, 4, {
          '0,0': no('X10'), '0,1': no('M13'), '0,2': wire, '0,3': set('M5'),
          '1,0': no('X11'), '1,1': no('M12'), '1,2': nc('M0'), '1,3': set('M5'),
          '2,0': no('X12'), '2,1': no('M11'), '2,2': nc('M15'), '2,3': set('M5'),
          '3,0': no('X13'), '3,1': no('M4'), '3,2': nc('M16'), '3,3': set('M5'),
        });
      }
      if (r.id === 'r13') {
        return R('r13', 4, 3, {
          '0,0': no('X11'), '0,1': no('M0'), '0,2': set('M6'),
          '1,0': no('X12'), '1,1': no('M15'), '1,2': set('M6'),
          '2,0': no('X13'), '2,1': no('M16'), '2,2': set('M6'),
          '3,0': no('X14'), '3,1': no('M17'), '3,2': set('M6'),
        });
      }
      return r;
    });
    const result = expectFailsGrading('elevator-5-dispatch', { rungs: downPref });
    const failed = result.scenarios.filter((s) => !s.passed).map((s) => s.name);
    expect(failed).toEqual(['Idle with calls on both sides prefers up']);
  });

  it('unlatched call buttons (OUT instead of SET) fail dispatch', () => {
    const unlatched = dispatchCore().map((r) => {
      const m = /^r([1-5])$/.exec(r.id);
      if (!m) return r;
      const floor = Number(m[1]) - 1;
      return R(r.id, 1, 2, { '0,0': no(`X${floor}`), '0,1': out(`M${floor}`) });
    });
    expectFailsGrading('elevator-5-dispatch', { rungs: unlatched });
  });

  it('correct dispatch with no door logic fails the doors puzzle', () => {
    expectFailsGrading('elevator-doors', { rungs: dispatchCore() });
  });

  it('a level contact instead of a rising edge keeps reopening the door — never auto-closes', () => {
    const levelDoor = doorRungs().map((r) =>
      r.id === 'r23'
        ? R('r23', 5, 4, {
            '0,0': no('X10'), '0,1': nc('M5'), '0,2': nc('M6'), '0,3': set('M20'),
            '1,0': no('X11'), '1,1': nc('M5'), '1,2': nc('M6'), '1,3': set('M20'),
            '2,0': no('X12'), '2,1': nc('M5'), '2,2': nc('M6'), '2,3': set('M20'),
            '3,0': no('X13'), '3,1': nc('M5'), '3,2': nc('M6'), '3,3': set('M20'),
            '4,0': no('X14'), '4,1': nc('M5'), '4,2': nc('M6'), '4,3': set('M20'),
          })
        : r,
    );
    const result = expectFailsGrading('elevator-doors', { rungs: [...dispatchCore(), ...levelDoor] });
    const autoClose = result.scenarios.find((s) => s.name === 'Door opens on arrival, dwells, then auto-closes')!;
    expect(autoClose.passed).toBe(false);
  });

  it('dispatch + doors without the idle timer fails the auto-return scenario', () => {
    const result = expectFailsGrading('elevator-full', { rungs: [...dispatchCore(), ...doorRungs()] });
    const failed = result.scenarios.filter((s) => !s.passed).map((s) => s.name);
    expect(failed).toEqual(['Idle away from floor 1 auto-returns after 10 s']);
  });
});

describe('gradeProgram — plausible wrong drill-station programs are rejected', () => {
  function expectFailsGrading(slug: string, rungs: Rung[]): ReturnType<typeof gradeProgram> {
    const spec = getLadderPuzzle(slug)!;
    const validation = validateProgram(spec, { rungs });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    const result = gradeProgram(spec, { rungs });
    expect(result.solved).toBe(false);
    return result;
  }

  it('feeding straight off the run latch, before CLAMPED, fails the first puzzle', () => {
    const ungated = drillClampFeedCore().map((r) =>
      r.id === 'dc3' ? R('dc3', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }) : r,
    );
    expectFailsGrading('drill-clamp-feed', ungated);
  });

  it('ejecting off the bottom sensor drives the pusher into a head that is still down', () => {
    // The pre-revision solution: SET Y4 straight off X3. The rod now sweeps
    // across a bore the bit is still sitting in, which shears it off.
    const ejectAtBottom = drillFullStroke().map((r) =>
      r.id === 'dfs7' ? R('dfs7', 1, 2, { '0,0': no('X3'), '0,1': set('Y4') }) : r,
    );
    const result = expectFailsGrading('drill-station', ejectAtBottom);
    expect(result.scenarios.every((s) => !s.passed)).toBe(false); // the E-Stop abort still passes
    const jammed = result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('jam')));
    expect(jammed).toBe(true);
  });

  it('a level contact instead of a rising edge cycles the eject pusher forever', () => {
    // X10 and Y3 both stay on once the rod is recalled, so the SET re-fires the
    // scan after every RESET and the pusher never stays home.
    const levelEject = drillFullStroke().map((r) =>
      r.id === 'dfs7'
        ? R('dfs7', 1, 3, { '0,0': no('X10'), '0,1': no('Y3'), '0,2': set('Y4') })
        : r,
    );
    const result = expectFailsGrading('drill-station', levelEject);
    expect(result.scenarios[0].steps.at(-1)!.passed).toBe(false);
  });

  it('a full-stroke cycle that ignores the eject-home sensor re-clamps on an extended rod', () => {
    const noHomeGate = drillFullStroke().map((r) =>
      r.id === 'dfs1'
        ? R(
            'dfs1',
            2,
            4,
            { '0,0': no('X0'), '1,0': no('M0'), '0,1': no('X1'), '0,2': nc('X3'), '0,3': out('M0') },
            [{ row: 0, col: 1 }],
          )
        : r,
    );
    const result = expectFailsGrading('drill-station', noHomeGate);
    const restart = result.scenarios.find(
      (s) => s.name === 'A new part waits for the eject rod to come home',
    )!;
    expect(restart.passed).toBe(false);
  });

  it('feeding straight off the run latch drives the bit into an unclamped part', () => {
    const ungated = drillFullStroke().map((r) =>
      r.id === 'dfs3' ? R('dfs3', 1, 2, { '0,0': no('M0'), '0,1': out('Y1') }) : r,
    );
    const result = expectFailsGrading('drill-station', ungated);
    expect(result.scenarios.every((s) => !s.passed)).toBe(true);
  });

  it('feeding without waiting for spindle-at-speed snaps the bit', () => {
    const noInterlock = drillAutoCycle(false).map((r) =>
      r.id === 'ds6'
        ? R('ds6', 1, 4, { '0,0': no('M0'), '0,1': no('X2'), '0,2': nc('T0'), '0,3': out('Y1') })
        : r,
    );
    const result = expectFailsGrading('drill-spindle', noInterlock);
    // The crash is physical (a latched jam freezes the machine), so no scenario
    // that runs a part can pass — this isn't a single missed assertion.
    expect(result.scenarios.every((s) => !s.passed)).toBe(true);
  });

  it('dropping the clamp a scan before the feed rung notices snaps the bit on E-Stop', () => {
    // Gating the clamp on X1 but not the feed makes Y0 drop the scan the E-Stop
    // opens, while Y1 hangs on for one more scan (X2 only falls once the clamp
    // has physically moved). The bit is then driving into an unheld part.
    const clampOnlyEstop = drillAutoCycle(false).map((r) =>
      r.id === 'ds2'
        ? R('ds2', 1, 3, { '0,0': no('M0'), '0,1': no('X1'), '0,2': out('Y0') })
        : r,
    );
    const result = expectFailsGrading('drill-spindle', clampOnlyEstop);
    const estop = result.scenarios.find((s) => s.name.startsWith('E-Stop'))!;
    expect(estop.passed).toBe(false);
    // The jam latches during the E-Stop step but only breaks an assertion in the
    // step after it, so the message has to name the step that actually caused it.
    const failures = estop.steps.flatMap((s) => s.failures);
    expect(failures.some((f) => /jammed [\d.]+ s into the run, back in "Hit E-Stop/.test(f))).toBe(
      true,
    );
    expect(failures.some((f) => f.includes('the clamp was not holding'))).toBe(true);
    // The frozen machine never reaches the milestone the last step waits for.
    expect(failures.some((f) => f.includes('for the machine to produce 1 good part'))).toBe(true);
  });

  it('names the field device, not just the address, when an output is wrong', () => {
    const noBeacon = drillAutoCycle(false).filter((r) => r.id !== 'ds4');
    const result = expectFailsGrading('drill-spindle', noBeacon);
    const failures = result.scenarios.flatMap((s) => s.steps.flatMap((st) => st.failures));
    expect(failures).toContain('Warning Beacon (Y2) should be ON at this point, but it was OFF.');
  });

  it('retracting on the bottom sensor instead of dwelling leaves an unfinished hole', () => {
    // The stroke looks right and the part even reaches the belt, but the hole was
    // never finished, so it lands as scrap and the good count never moves.
    const noDwell = drillAutoCycle(false)
      .filter((r) => r.id !== 'ds5')
      .map((r) => {
        if (r.id === 'ds6') {
          return R('ds6', 1, 4, {
            '0,0': no('M0'), '0,1': no('X2'), '0,2': no('X7'), '0,3': out('Y1'),
          });
        }
        if (r.id === 'ds7') {
          return R('ds7', 2, 2, { '0,0': no('X3'), '0,1': set('M1'), '1,1': rst('M0') }, [
            { row: 0, col: 1 },
          ]);
        }
        return r;
      });
    const result = expectFailsGrading('drill-spindle', noDwell);
    expect(result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('good')))).toBe(
      true,
    );
  });

  it('leaving the spindle turning between parts fails the production run', () => {
    const alwaysSpinning = drillAutoCycle(true).map((r) =>
      r.id === 'ds3' ? R('ds3', 1, 2, { '0,0': no('X0'), '0,1': out('Y5') }) : r,
    );
    const result = expectFailsGrading('drill-production', alwaysSpinning);
    expect(result.scenarios[0].passed).toBe(false);
  });

  it('counting ejects instead of finished holes closes the batch a part early', () => {
    // Every stroke counts, including the rejected steel blank, so the station
    // parks after two good parts instead of three.
    const countsRejects = drillAutoCycle(true).map((r) =>
      r.id === 'dm4' ? R('dm4', 1, 2, { '0,0': no('X4'), '0,1': counter('C0', 3) }) : r,
    );
    const result = expectFailsGrading('drill-production', countsRejects);
    expect(result.scenarios[0].steps.some((s) => s.failures.some((f) => f.includes('good')))).toBe(
      true,
    );
  });

  it('treating steel like aluminium jams the production run', () => {
    // Without the nc(X6) guard the drill stage starts on a metal blank too.
    const drillsSteel = drillAutoCycle(true).map((r) =>
      r.id === 'ds1'
        ? R('ds1', 1, 6, {
            '0,0': no('X0'), '0,1': no('X1'), '0,2': no('X5'), '0,3': nc('M1'), '0,4': nc('C0'),
            '0,5': set('M0'),
          })
        : r,
    );
    const result = expectFailsGrading('drill-production', drillsSteel);
    const jammed = result.scenarios[0].steps.some((s) =>
      s.failures.some((f) => f.includes('jam')),
    );
    expect(jammed).toBe(true);
  });
});

describe('traceScenario', () => {
  it('matches gradeProgram pass/fail and samples every scan for a solved puzzle', () => {
    const spec = getLadderPuzzle('seal-in')!;
    const program = solutions['seal-in'];
    const grade = gradeProgram(spec, program);
    for (const scenario of spec.scenarios) {
      const trace = traceScenario(spec, program, scenario.name)!;
      expect(trace).toBeDefined();
      const expectedSamples = scenario.steps.reduce(
        (n, s) => n + Math.max(1, Math.ceil(s.holdMs / trace.dt)),
        0,
      );
      expect(trace.samples.length).toBe(expectedSamples);
      expect(trace.samples.at(-1)!.tMs).toBe(expectedSamples * trace.dt);

      const scenarioResult = grade.scenarios.find((s) => s.name === scenario.name)!;
      expect(trace.steps.map((s) => s.passed)).toEqual(scenarioResult.steps.map((s) => s.passed));
      expect(trace.steps.every((s) => s.passed)).toBe(scenarioResult.passed);

      // startSample indexes line up with cumulative iteration counts.
      let cursor = 0;
      trace.steps.forEach((s, i) => {
        expect(s.startSample).toBe(cursor);
        cursor += Math.max(1, Math.ceil(scenario.steps[i].holdMs / trace.dt));
      });
    }
  });

  it('marks the failing step for a wrong program', () => {
    const spec = getLadderPuzzle('seal-in')!;
    const bad: LadderProgram = { rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') })] };
    const scenario = spec.scenarios[0];
    const trace = traceScenario(spec, bad, scenario.name)!;
    expect(trace.steps.some((s) => !s.passed)).toBe(true);
  });

  it('returns undefined for an unknown scenario name', () => {
    const spec = getLadderPuzzle('direct-control')!;
    expect(traceScenario(spec, solutions['direct-control'], 'nope')).toBeUndefined();
  });
});

describe('validateProgram', () => {
  it('flags disallowed instructions', () => {
    const spec = getLadderPuzzle('direct-control')!; // timer not allowed here
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': timer('T0', 10) })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('not allowed'))).toBe(true);
  });

  it('flags a coil driving an input device kind', () => {
    const spec = getLadderPuzzle('direct-control')!;
    const prog: LadderProgram = {
      rungs: [R('r1', 1, 2, { '0,0': no('X0'), '0,1': out('X5') })],
    };
    const res = validateProgram(spec, prog);
    expect(res.valid).toBe(false);
  });
});

