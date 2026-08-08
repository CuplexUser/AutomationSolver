import { describe, expect, it } from 'vitest';
import type {
  LadderElement,
  LadderProgram,
  LadderProject,
  Rung,
  VLink,
} from '../ladder/types.js';
import { getPuzzle, PUZZLES } from './content/index.js';
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

// Word instructions. `compare` is the only element with no `device` at all:
// both sides are operands.
const mov = (source: string, dest: string): LadderElement => ({
  type: 'mov',
  device: dest,
  operands: [source],
});
const math = (
  op: 'add' | 'sub' | 'mul' | 'div',
  a: string,
  b: string,
  dest: string,
): LadderElement => ({ type: 'math', device: dest, op, operands: [a, b] });
const cmp = (
  op: '=' | '<>' | '>' | '<' | '>=' | '<=',
  a: string,
  b: string,
): LadderElement => ({ type: 'compare', device: '', op, operands: [a, b] });
const pid = (
  sv: string,
  pv: string,
  mv: string,
  tuning: { kp: number; ti?: number; td?: number },
): LadderElement => ({
  type: 'pid',
  device: mv,
  operands: [sv, pv],
  pid: {
    kp: tuning.kp,
    ti: tuning.ti ?? 0,
    td: tuning.td ?? 0,
    sampleMs: 100,
    outMin: 0,
    outMax: 4000,
  },
});

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

/**
 * The stacker crane's move block, shared by every warehouse solution.
 *
 * Two rungs and the whole aisle is addressable: drive whichever axis disagrees
 * with its target register, and report arrival when neither does. It works as a
 * plain comparison only because `D0`/`D1` latch on the position sensors rather
 * than rounding to the nearest one - a rounded encoder would call itself "there"
 * half a bay out and stop the crane in mid air. The `X28` contact in every row
 * is the interlock that keeps the mast off the rack: nothing moves unless the
 * fork is home.
 */
function craneMoveRungs(moveId: string, atTargetId: string): Rung[] {
  return [
    R(moveId, 4, 3, {
      '0,0': cmp('<', 'D0', 'D52'), '0,1': no('X28'), '0,2': out('Y0'),
      '1,0': cmp('>', 'D0', 'D52'), '1,1': no('X28'), '1,2': out('Y1'),
      '2,0': cmp('<', 'D1', 'D53'), '2,1': no('X28'), '2,2': out('Y2'),
      '3,0': cmp('>', 'D1', 'D53'), '3,1': no('X28'), '3,2': out('Y3'),
    }),
    R(atTargetId, 1, 3, {
      '0,0': cmp('=', 'D0', 'D52'),
      '0,1': cmp('=', 'D1', 'D53'),
      '0,2': out('M0'),
    }),
  ];
}

/**
 * The eight WMS slot registers, listed pick-face-first within each bay and in
 * ascending bay order. From the aisle head that is also nearest-first, which is
 * the shortcut `asrs-retrieval` is allowed to lean on and `asrs-two-lines`
 * takes away.
 */
const WMS_SLOTS: readonly { reg: string; bay: number; level: number }[] = [
  { reg: 'D101', bay: 1, level: 1 },
  { reg: 'D201', bay: 1, level: 2 },
  { reg: 'D102', bay: 2, level: 1 },
  { reg: 'D202', bay: 2, level: 2 },
  { reg: 'D103', bay: 3, level: 1 },
  { reg: 'D203', bay: 3, level: 2 },
  { reg: 'D104', bay: 4, level: 1 },
  { reg: 'D204', bay: 4, level: 2 },
];

/**
 * Search the slot table in rung order and keep the first hit: one rung per slot,
 * each gated on the found relay still being clear. Correct only where rung order
 * and distance order agree, which is to say only from the aisle head.
 */
function slotFirstMatchRungs(
  prefix: string,
  want: string,
  bayDest: string,
  levelDest: string,
  found: string,
  gate: string,
): Rung[] {
  return WMS_SLOTS.map((s, i) =>
    R(`${prefix}${i}`, 1, 6, {
      '0,0': nc(gate),
      '0,1': nc(found),
      '0,2': cmp('=', s.reg, want),
      '0,3': mov(`K${s.bay}`, bayDest),
      '0,4': mov(`K${s.level}`, levelDest),
      '0,5': set(found),
    }),
  );
}

/**
 * The same search done properly: every slot compares its bay's distance against
 * the best found so far, so the answer no longer depends on which order the
 * rungs happen to be in. `D61`..`D64` hold the distance to each bay from
 * whichever station is being served, which is what lets one block of rungs serve
 * a line at either end of the aisle.
 */
function slotNearestRungs(
  prefix: string,
  want: string,
  bayDest: string,
  levelDest: string,
  best: string,
  found: string,
  gate: string,
): Rung[] {
  return WMS_SLOTS.map((s, i) =>
    R(`${prefix}${i}`, 1, 7, {
      '0,0': nc(gate),
      '0,1': cmp('=', s.reg, want),
      '0,2': cmp('<', `D6${s.bay}`, best),
      '0,3': mov(`K${s.bay}`, bayDest),
      '0,4': mov(`K${s.level}`, levelDest),
      '0,5': mov(`D6${s.bay}`, best),
      '0,6': set(found),
    }),
  );
}

/** Distance to each bay from line A's end of the aisle, and from line B's. */
function bayDistanceRungs(id: string, servingB: string | undefined): Rung {
  if (!servingB) {
    return R(id, 1, 5, {
      '0,0': wire,
      '0,1': mov('K1', 'D61'), '0,2': mov('K2', 'D62'),
      '0,3': mov('K3', 'D63'), '0,4': mov('K4', 'D64'),
    });
  }
  return R(id, 2, 5, {
    '0,0': nc(servingB),
    '0,1': mov('K1', 'D61'), '0,2': mov('K2', 'D62'),
    '0,3': mov('K3', 'D63'), '0,4': mov('K4', 'D64'),
    '1,0': no(servingB),
    '1,1': mov('K4', 'D61'), '1,2': mov('K3', 'D62'),
    '1,3': mov('K2', 'D63'), '1,4': mov('K1', 'D64'),
  });
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

  // --- process control ----------------------------------------------------
  // The valve is written from several rungs on purpose. MOV only writes while
  // its rung conducts, so "whichever condition is true supplies the value" is
  // the idiom, and the rung order below each PID block is what lets a trip
  // overrule a running loop.
  'tank-level-readout': {
    rungs: [
      R('r1', 1, 2, { '0,0': wire, '0,1': math('div', 'D0', 'K4', 'D10') }),
      R('r2', 1, 2, { '0,0': no('X0'), '0,1': mov('K4000', 'D20') }),
      R('r3', 1, 2, { '0,0': nc('X0'), '0,1': mov('K0', 'D20') }),
      R('r4', 1, 2, { '0,0': cmp('>=', 'D10', 'K800'), '0,1': out('Y1') }),
      R('r5', 1, 2, { '0,0': cmp('<=', 'D10', 'K200'), '0,1': out('Y2') }),
    ],
  },
  'tank-two-position': {
    rungs: [
      // Fill latch: set at the low mark, held until the high mark.
      R(
        'r1',
        2,
        3,
        {
          '0,0': cmp('<=', 'D0', 'K1600'),
          '1,0': no('M0'),
          '0,1': cmp('<', 'D0', 'K2400'),
          '0,2': out('M0'),
        },
        [{ row: 0, col: 1 }],
      ),
      R('r2', 1, 2, { '0,0': no('X0'), '0,1': out('Y0') }),
      R('r3', 1, 3, { '0,0': no('X0'), '0,1': no('M0'), '0,2': mov('K4000', 'D20') }),
      R(
        'r4',
        2,
        2,
        { '0,0': nc('X0'), '1,0': nc('M0'), '0,1': mov('K0', 'D20') },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  'tank-p-control': {
    rungs: [
      R('r1', 1, 2, { '0,0': wire, '0,1': mov('K2400', 'D30') }),
      R('r2', 1, 2, { '0,0': wire, '0,1': math('sub', 'D30', 'D0', 'D31') }),
      // Whole-number gain: error reaches 2400 counts, so anything above 8 would
      // peg the register before the valve ever saw it.
      R('r3', 1, 2, { '0,0': wire, '0,1': math('mul', 'D31', 'K4', 'D32') }),
      // Bias = setpoint, the valve position this vessel needs at zero load.
      R('r4', 1, 2, { '0,0': no('X0'), '0,1': math('add', 'D32', 'D30', 'D20') }),
      R('r5', 1, 2, { '0,0': nc('X0'), '0,1': mov('K0', 'D20') }),
      R('r6', 1, 3, { '0,0': no('X0'), '0,1': no('X3'), '0,2': out('Y0') }),
    ],
  },
  'tank-pid': {
    rungs: [
      R('r1', 1, 2, { '0,0': wire, '0,1': mov('K2400', 'D30') }),
      // Ti at the vessel's own time constant is the textbook cancellation, and
      // it leaves a closed loop with no overshoot to speak of.
      R('r2', 1, 2, { '0,0': no('X0'), '0,1': pid('D30', 'D0', 'D20', { kp: 300, ti: 4000 }) }),
      R('r3', 1, 2, { '0,0': nc('X0'), '0,1': mov('K0', 'D20') }),
      R('r4', 1, 3, { '0,0': no('X0'), '0,1': no('X3'), '0,2': out('Y0') }),
      R('r5', 1, 4, {
        '0,0': no('X0'),
        '0,1': cmp('>=', 'D0', 'K2320'),
        '0,2': cmp('<=', 'D0', 'K2480'),
        '0,3': out('Y1'),
      }),
    ],
  },
  'tank-auto': {
    rungs: [
      R('r1', 1, 2, { '0,0': no('X4'), '0,1': mov('K2800', 'D30') }),
      R('r2', 1, 2, { '0,0': nc('X4'), '0,1': mov('K1600', 'D30') }),
      // Trip latch: the float seals it in, only reset lets go.
      R(
        'r3',
        2,
        3,
        { '0,0': no('X2'), '1,0': no('M0'), '0,1': nc('X5'), '0,2': out('M0') },
        [{ row: 0, col: 1 }],
      ),
      R('r4', 1, 2, { '0,0': no('M0'), '0,1': out('Y2') }),
      // Three writers to the valve, in priority order down the program: the
      // loop, then hand mode over the top of it, then the trip over both.
      R('r5', 1, 3, {
        '0,0': no('X0'),
        '0,1': nc('M0'),
        '0,2': pid('D30', 'D0', 'D20', { kp: 300, ti: 4000 }),
      }),
      R('r6', 1, 3, { '0,0': no('X6'), '0,1': nc('M0'), '0,2': mov('K4000', 'D20') }),
      R(
        'r7',
        2,
        3,
        {
          '0,0': no('M0'),
          '0,1': wire,
          '1,0': nc('X0'),
          '1,1': nc('X6'),
          '0,2': mov('K0', 'D20'),
        },
        [{ row: 0, col: 2 }],
      ),
      R('r8', 1, 3, { '0,0': no('X0'), '0,1': no('X3'), '0,2': out('Y0') }),
      // The on-setpoint band moves with the recipe, so it is computed, not typed.
      R('r9', 1, 2, { '0,0': wire, '0,1': math('sub', 'D30', 'K80', 'D33') }),
      R('r10', 1, 2, { '0,0': wire, '0,1': math('add', 'D30', 'K80', 'D34') }),
      R('r11', 1, 4, {
        '0,0': no('X0'),
        '0,1': cmp('>=', 'D0', 'D33'),
        '0,2': cmp('<=', 'D0', 'D34'),
        '0,3': out('Y1'),
      }),
    ],
  },

  // --- motion --------------------------------------------------------------
  // Every axis solution starts by writing the drive parameters on plain
  // unconditional rungs. That is not ceremony: the drive refuses to start
  // without them, exactly like a real inverter with no ramp times commissioned.
  'axis-jog': {
    rungs: [
      R('r1', 1, 2, { '0,0': wire, '0,1': mov('K1200', 'D40') }),
      R('r2', 1, 2, { '0,0': wire, '0,1': mov('K1500', 'D41') }),
      R('r3', 1, 2, { '0,0': wire, '0,1': mov('K1200', 'D20') }),
      R('r4', 1, 3, { '0,0': no('X0'), '0,1': nc('X11'), '0,2': out('Y0') }),
      R('r5', 1, 3, { '0,0': no('X1'), '0,1': nc('X10'), '0,2': out('Y1') }),
    ],
  },
  'axis-profile': {
    rungs: [
      R('r1', 1, 2, { '0,0': wire, '0,1': mov('K2000', 'D40') }),
      R('r2', 1, 2, { '0,0': wire, '0,1': mov('K2500', 'D41') }),
      R('r3', 1, 2, { '0,0': no('X0'), '0,1': mov('K3400', 'D30') }),
      R('r4', 1, 2, { '0,0': nc('X0'), '0,1': mov('K400', 'D30') }),
      R('r5', 1, 2, { '0,0': wire, '0,1': math('sub', 'D30', 'D0', 'D31') }),
      // A 40-count deadband, or the carriage hunts either side of the mark
      // forever: a speed reference has no idea it has arrived.
      R('r6', 1, 2, { '0,0': cmp('>', 'D31', 'K40'), '0,1': out('Y0') }),
      R('r7', 1, 2, { '0,0': cmp('<', 'D31', 'K-40'), '0,1': out('Y1') }),
      // Far from the target either way: rapid. The two rows are the OR.
      R(
        'r8',
        2,
        2,
        { '0,0': cmp('>', 'D31', 'K400'), '1,0': cmp('<', 'D31', 'K-400'), '0,1': mov('K4000', 'D20') },
        [{ row: 0, col: 1 }],
      ),
      R('r9', 1, 3, {
        '0,0': cmp('<=', 'D31', 'K400'),
        '0,1': cmp('>=', 'D31', 'K-400'),
        '0,2': mov('K400', 'D20'),
      }),
    ],
  },
  'axis-loaded': {
    rungs: [
      // Two ramp tables and, just as importantly, two slow-down distances.
      R('r1', 1, 2, { '0,0': no('X14'), '0,1': mov('K1000', 'D40') }),
      R('r2', 1, 2, { '0,0': no('X14'), '0,1': mov('K1200', 'D41') }),
      R('r3', 1, 2, { '0,0': no('X14'), '0,1': mov('K1000', 'D32') }),
      R('r4', 1, 2, { '0,0': nc('X14'), '0,1': mov('K2000', 'D40') }),
      R('r5', 1, 2, { '0,0': nc('X14'), '0,1': mov('K2500', 'D41') }),
      R('r6', 1, 2, { '0,0': nc('X14'), '0,1': mov('K400', 'D32') }),
      // Loaded means "go to the rack", empty means "go back for another".
      R('r7', 1, 2, { '0,0': no('X14'), '0,1': mov('K3400', 'D30') }),
      R('r8', 1, 2, { '0,0': nc('X14'), '0,1': mov('K400', 'D30') }),
      R('r9', 1, 2, { '0,0': wire, '0,1': math('sub', 'D30', 'D0', 'D31') }),
      R('r10', 1, 2, { '0,0': wire, '0,1': math('sub', 'K0', 'D32', 'D33') }),
      R('r11', 1, 2, { '0,0': cmp('>', 'D31', 'K40'), '0,1': out('Y0') }),
      R('r12', 1, 2, { '0,0': cmp('<', 'D31', 'K-40'), '0,1': out('Y1') }),
      R(
        'r13',
        2,
        2,
        { '0,0': cmp('>', 'D31', 'D32'), '1,0': cmp('<', 'D31', 'D33'), '0,1': mov('K4000', 'D20') },
        [{ row: 0, col: 1 }],
      ),
      R('r14', 1, 3, {
        '0,0': cmp('<=', 'D31', 'D32'),
        '0,1': cmp('>=', 'D31', 'D33'),
        '0,2': mov('K400', 'D20'),
      }),
      // Released-and-heading-home latch. Without it the forks close again on
      // the way back and the pallet count never advances.
      R('r15', 1, 4, {
        '0,0': no('X13'),
        '0,1': no('X14'),
        '0,2': cmp('=', 'D1', 'K0'),
        '0,3': set('M0'),
      }),
      R('r16', 1, 4, {
        '0,0': no('X12'),
        '0,1': nc('X14'),
        '0,2': cmp('=', 'D1', 'K0'),
        '0,3': rst('M0'),
      }),
      R('r17', 1, 2, { '0,0': nc('M0'), '0,1': out('Y4') }),
    ],
  },
  'axis-crane': {
    rungs: [
      R('r1', 1, 2, { '0,0': no('X14'), '0,1': mov('K1000', 'D40') }),
      R('r2', 1, 2, { '0,0': no('X14'), '0,1': mov('K1200', 'D41') }),
      R('r3', 1, 2, { '0,0': no('X14'), '0,1': mov('K1000', 'D32') }),
      R('r4', 1, 2, { '0,0': nc('X14'), '0,1': mov('K2000', 'D40') }),
      R('r5', 1, 2, { '0,0': nc('X14'), '0,1': mov('K2500', 'D41') }),
      R('r6', 1, 2, { '0,0': nc('X14'), '0,1': mov('K400', 'D32') }),
      R('r7', 1, 2, { '0,0': wire, '0,1': mov('K4000', 'D21') }),
      R('r8', 1, 2, { '0,0': no('X14'), '0,1': mov('K3400', 'D30') }),
      R('r9', 1, 2, { '0,0': nc('X14'), '0,1': mov('K400', 'D30') }),
      R('r10', 1, 2, { '0,0': wire, '0,1': math('sub', 'D30', 'D0', 'D31') }),
      R('r11', 1, 2, { '0,0': wire, '0,1': math('sub', 'K0', 'D32', 'D33') }),
      // "A transfer is due here": at a station, stopped, swing settled, and
      // holding the wrong thing for that station. X17 is what keeps the hook
      // out of the rack while the pallet is still moving.
      R(
        'r12',
        2,
        5,
        {
          '0,0': no('X12'), '0,1': nc('X14'),
          '1,0': no('X13'), '1,1': no('X14'),
          '0,2': cmp('=', 'D1', 'K0'), '0,3': no('X17'), '0,4': set('M1'),
        },
        [{ row: 0, col: 2 }],
      ),
      R(
        'r13',
        2,
        3,
        {
          '0,0': no('X12'), '0,1': no('X14'),
          '1,0': no('X13'), '1,1': nc('X14'),
          '0,2': rst('M1'),
        },
        [{ row: 0, col: 2 }],
      ),
      R('r14', 1, 4, { '0,0': no('X0'), '0,1': no('M1'), '0,2': nc('X16'), '0,3': out('Y3') }),
      R('r15', 1, 4, { '0,0': no('X0'), '0,1': nc('M1'), '0,2': nc('X15'), '0,3': out('Y2') }),
      R('r16', 1, 4, { '0,0': no('M1'), '0,1': no('X16'), '0,2': no('X12'), '0,3': set('M2') }),
      R('r17', 1, 4, { '0,0': no('M1'), '0,1': no('X16'), '0,2': no('X13'), '0,3': rst('M2') }),
      R('r18', 1, 2, { '0,0': no('M2'), '0,1': out('Y4') }),
      // The trolley only runs with the hook up and nothing pending, which is
      // the interlock against traversing with the rope paid out.
      R('r19', 1, 5, {
        '0,0': no('X0'), '0,1': no('X15'), '0,2': nc('M1'),
        '0,3': cmp('>', 'D31', 'K40'), '0,4': out('Y0'),
      }),
      R('r20', 1, 5, {
        '0,0': no('X0'), '0,1': no('X15'), '0,2': nc('M1'),
        '0,3': cmp('<', 'D31', 'K-40'), '0,4': out('Y1'),
      }),
      R(
        'r21',
        2,
        2,
        { '0,0': cmp('>', 'D31', 'D32'), '1,0': cmp('<', 'D31', 'D33'), '0,1': mov('K4000', 'D20') },
        [{ row: 0, col: 1 }],
      ),
      R('r22', 1, 3, {
        '0,0': cmp('<=', 'D31', 'D32'),
        '0,1': cmp('>=', 'D31', 'D33'),
        '0,2': mov('K400', 'D20'),
      }),
    ],
  },
  // The commissioning job is the move block on its own, with the panel standing
  // in for the step chain the next puzzle asks for. Every warehouse solution
  // below opens with these same rungs.
  'asrs-drive': {
    rungs: [
      R('d1', 2, 3, {
        '0,0': nc('X0'), '0,1': mov('K0', 'D52'), '0,2': mov('K2', 'D53'),
        '1,0': no('X0'), '1,1': mov('K4', 'D52'), '1,2': mov('K1', 'D53'),
      }),
      ...craneMoveRungs('d2', 'd3'),
      R('d4', 1, 2, { '0,0': no('M0'), '0,1': out('Y6') }),
      // The fork obeys the button only through M0, which is the interlock: a
      // stroke started between slots goes into a rack upright.
      R('d5', 1, 3, { '0,0': no('X1'), '0,1': no('M0'), '0,2': out('Y4') }),
    ],
  },
  'asrs-put-away': {
    rungs: [
      R('r1', 1, 6, {
        '0,0': no('X0'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': nc('M3'), '0,4': nc('M4'),
        '0,5': set('M1'),
      }),
      R('r2', 1, 2, { '0,0': no('X29'), '0,1': set('M11') }),
      // Where the crane is going, selected by whichever step is live. Several
      // rungs writing D52 is the value-selection idiom, not a double coil.
      R('r3', 3, 4, {
        '0,0': nc('M1'), '0,1': nc('M2'), '0,2': mov('K0', 'D52'), '0,3': mov('K1', 'D53'),
        '1,0': no('M1'), '1,1': wire, '1,2': mov('K0', 'D52'), '1,3': mov('K2', 'D53'),
        '2,0': no('M2'), '2,1': wire, '2,2': mov('K2', 'D52'), '2,3': mov('K2', 'D53'),
      }),
      ...craneMoveRungs('r4', 'r5'),
      R('r6', 1, 2, { '0,0': nc('M0'), '0,1': rst('M11') }),
      R(
        'r7',
        2,
        4,
        {
          '0,0': no('M1'), '0,1': no('M0'), '0,2': nc('M11'), '0,3': out('Y4'),
          '1,0': no('M2'),
        },
        [{ row: 0, col: 1 }],
      ),
      // The one-hot chain advances in reverse rung order, so a step that has
      // just been set cannot also be completed by the rung below it in the same
      // scan - the target register it depends on has not been reloaded yet.
      R('r8', 1, 5, {
        '0,0': no('M3'), '0,1': no('M0'), '0,2': no('X28'), '0,3': rst('M3'), '0,4': set('M4'),
      }),
      R('r9', 1, 6, {
        '0,0': no('M2'), '0,1': no('M11'), '0,2': no('X28'), '0,3': rst('M2'), '0,4': set('M3'),
        '0,5': rst('M11'),
      }),
      R('r10', 1, 6, {
        '0,0': no('M1'), '0,1': no('M11'), '0,2': no('X28'), '0,3': rst('M1'), '0,4': set('M2'),
        '0,5': rst('M11'),
      }),
    ],
  },
  'asrs-retrieval': {
    rungs: [
      // The search only runs between cycles, so the table cannot shift under a
      // trip that is already committed to a slot.
      R('s1', 1, 2, { '0,0': nc('M1'), '0,1': rst('M2') }),
      ...slotFirstMatchRungs('s2_', 'D10', 'D50', 'D51', 'M2', 'M1'),
      // Start on the call AND a hit, never on the call alone.
      R('s3', 1, 4, { '0,0': no('X10'), '0,1': no('M2'), '0,2': nc('M1'), '0,3': set('M1') }),
      R('s4', 1, 2, { '0,0': no('X29'), '0,1': set('M11') }),
      // Latched, not X3 direct: the instant the pallet is handed over X3 drops,
      // and an unlatched target would send the crane back down the aisle with
      // its fork still in the conveyor.
      R('s5', 1, 2, { '0,0': no('X3'), '0,1': set('M3') }),
      // Gated on the cycle relay, so the target can only change while the crane
      // is committed to a trip. Left ungated, an idle crane sets off after a
      // target the search is still revising, and can end up "arrived" - D0
      // holding a sensor it passed a moment ago - while it is half way between
      // two bays. The fork then goes out into a rack upright.
      R('s6', 2, 4, {
        '0,0': no('M1'), '0,1': nc('M3'), '0,2': mov('D50', 'D52'), '0,3': mov('D51', 'D53'),
        '1,0': no('M1'), '1,1': no('M3'), '1,2': mov('K0', 'D52'), '1,3': mov('K1', 'D53'),
      }),
      ...craneMoveRungs('s7', 's8'),
      R('s9', 1, 2, { '0,0': nc('M0'), '0,1': rst('M11') }),
      R('s10', 1, 4, { '0,0': no('M1'), '0,1': no('M0'), '0,2': nc('M11'), '0,3': out('Y4') }),
      R('s11', 1, 9, {
        '0,0': no('M1'), '0,1': no('M3'), '0,2': no('M11'), '0,3': no('X28'), '0,4': nc('X3'),
        '0,5': rst('M1'), '0,6': rst('M2'), '0,7': rst('M3'), '0,8': rst('M11'),
      }),
      R('s12', 1, 3, { '0,0': no('X10'), '0,1': nc('M2'), '0,2': out('Y5') }),
    ],
  },
  'asrs-two-lines': {
    rungs: [
      R('t1', 1, 3, { '0,0': nc('M1'), '0,1': rst('M2'), '0,2': mov('K99', 'D65') }),
      // Commit to a line while idle and hold it: line A first when both call,
      // which there is just enough crane for.
      R('t2', 2, 4, {
        '0,0': nc('M1'), '0,1': no('X10'), '0,2': wire, '0,3': rst('M5'),
        '1,0': nc('M1'), '1,1': nc('X10'), '1,2': no('X11'), '1,3': set('M5'),
      }),
      R('t3', 2, 2, {
        '0,0': nc('M5'), '0,1': mov('D10', 'D70'),
        '1,0': no('M5'), '1,1': mov('D11', 'D70'),
      }),
      bayDistanceRungs('t4', 'M5'),
      ...slotNearestRungs('t5_', 'D70', 'D50', 'D51', 'D65', 'M2', 'M1'),
      R(
        't6',
        2,
        4,
        {
          '0,0': no('X10'), '0,1': no('M2'), '0,2': nc('M1'), '0,3': set('M1'),
          '1,0': no('X11'),
        },
        [{ row: 0, col: 1 }],
      ),
      R('t7', 1, 2, { '0,0': no('X29'), '0,1': set('M11') }),
      R('t8', 1, 2, { '0,0': no('X3'), '0,1': set('M3') }),
      R('t9', 3, 5, {
        '0,0': no('M1'), '0,1': nc('M3'), '0,2': wire,
        '0,3': mov('D50', 'D52'), '0,4': mov('D51', 'D53'),
        '1,0': no('M1'), '1,1': no('M3'), '1,2': nc('M5'),
        '1,3': mov('K0', 'D52'), '1,4': mov('K1', 'D53'),
        '2,0': no('M1'), '2,1': no('M3'), '2,2': no('M5'),
        '2,3': mov('K5', 'D52'), '2,4': mov('K1', 'D53'),
      }),
      ...craneMoveRungs('t10', 't11'),
      R('t12', 1, 2, { '0,0': nc('M0'), '0,1': rst('M11') }),
      R('t13', 1, 4, { '0,0': no('M1'), '0,1': no('M0'), '0,2': nc('M11'), '0,3': out('Y4') }),
      R('t14', 1, 9, {
        '0,0': no('M1'), '0,1': no('M3'), '0,2': no('M11'), '0,3': no('X28'), '0,4': nc('X3'),
        '0,5': rst('M1'), '0,6': rst('M2'), '0,7': rst('M3'), '0,8': rst('M11'),
      }),
      R(
        't15',
        2,
        3,
        { '0,0': no('X10'), '0,1': nc('M2'), '0,2': out('Y5'), '1,0': no('X11') },
        [{ row: 0, col: 1 }],
      ),
    ],
  },
  'asrs-replenish': {
    rungs: [
      R('u1', 1, 5, {
        '0,0': nc('M1'), '0,1': rst('M2'), '0,2': rst('M4'),
        '0,3': mov('K99', 'D65'), '0,4': mov('K99', 'D66'),
      }),
      bayDistanceRungs('u2', undefined),
      ...slotNearestRungs('u3_', 'D10', 'D50', 'D51', 'D65', 'M2', 'M1'),
      // The same eight tests find a home for an inbound pallet: an empty slot is
      // just a slot whose register reads zero.
      ...slotNearestRungs('u4_', 'K0', 'D56', 'D57', 'D66', 'M4', 'M1'),
      // Retrieval when the line is calling for something in stock; put-away when
      // it is not, and also when it is calling for something that has run out.
      R('u5', 3, 6, {
        '0,0': nc('M1'), '0,1': no('X10'), '0,2': no('M2'), '0,3': wire, '0,4': wire,
        '0,5': rst('M6'),
        '1,0': nc('M1'), '1,1': nc('X10'), '1,2': no('X12'), '1,3': no('M4'), '1,4': wire,
        '1,5': set('M6'),
        '2,0': nc('M1'), '2,1': no('X10'), '2,2': nc('M2'), '2,3': no('X12'), '2,4': no('M4'),
        '2,5': set('M6'),
      }),
      R('u6', 2, 5, {
        '0,0': nc('M1'), '0,1': nc('M6'), '0,2': no('X10'), '0,3': no('M2'), '0,4': set('M1'),
        '1,0': nc('M1'), '1,1': no('M6'), '1,2': no('X12'), '1,3': no('M4'), '1,4': set('M1'),
      }),
      R('u7', 1, 2, { '0,0': no('X29'), '0,1': set('M11') }),
      R('u8', 1, 2, { '0,0': no('X3'), '0,1': set('M3') }),
      // Both jobs are "collect somewhere, deliver somewhere"; only the two
      // somewheres swap over.
      R('u9', 4, 5, {
        '0,0': no('M1'), '0,1': nc('M3'), '0,2': nc('M6'),
        '0,3': mov('D50', 'D52'), '0,4': mov('D51', 'D53'),
        '1,0': no('M1'), '1,1': nc('M3'), '1,2': no('M6'),
        '1,3': mov('K0', 'D52'), '1,4': mov('K2', 'D53'),
        '2,0': no('M1'), '2,1': no('M3'), '2,2': nc('M6'),
        '2,3': mov('K0', 'D52'), '2,4': mov('K1', 'D53'),
        '3,0': no('M1'), '3,1': no('M3'), '3,2': no('M6'),
        '3,3': mov('D56', 'D52'), '3,4': mov('D57', 'D53'),
      }),
      ...craneMoveRungs('u10', 'u11'),
      R('u12', 1, 2, { '0,0': nc('M0'), '0,1': rst('M11') }),
      R('u13', 1, 4, { '0,0': no('M1'), '0,1': no('M0'), '0,2': nc('M11'), '0,3': out('Y4') }),
      R('u14', 1, 11, {
        '0,0': no('M1'), '0,1': no('M3'), '0,2': no('M11'), '0,3': no('X28'), '0,4': nc('X3'),
        '0,5': rst('M1'), '0,6': rst('M2'), '0,7': rst('M3'), '0,8': rst('M4'), '0,9': rst('M6'),
        '0,10': rst('M11'),
      }),
      R('u15', 1, 3, { '0,0': no('X10'), '0,1': nc('M2'), '0,2': out('Y5') }),
      R('u16', 1, 2, { '0,0': no('M6'), '0,1': out('Y6') }),
    ],
  },
  'asrs-dual-cycle': {
    rungs: [
      R('v1', 1, 4, {
        '0,0': nc('M1'), '0,1': rst('M2'), '0,2': rst('M4'), '0,3': mov('K99', 'D65'),
      }),
      // Take turns. Strict priority for line A works while there is crane to
      // spare, and at full rate it simply never yields - A is calling again
      // before B has been reached, and B stops. M9 remembers who went last.
      R('v2', 4, 5, {
        '0,0': nc('M1'), '0,1': no('X10'), '0,2': nc('X11'), '0,3': wire, '0,4': rst('M5'),
        '1,0': nc('M1'), '1,1': nc('X10'), '1,2': no('X11'), '1,3': wire, '1,4': set('M5'),
        '2,0': nc('M1'), '2,1': no('X10'), '2,2': no('X11'), '2,3': no('M9'), '2,4': set('M5'),
        '3,0': nc('M1'), '3,1': no('X10'), '3,2': no('X11'), '3,3': nc('M9'), '3,4': rst('M5'),
      }),
      R('v3', 2, 2, {
        '0,0': nc('M5'), '0,1': mov('D10', 'D70'),
        '1,0': no('M5'), '1,1': mov('D11', 'D70'),
      }),
      bayDistanceRungs('v4', 'M5'),
      ...slotNearestRungs('v5_', 'D70', 'D56', 'D57', 'D65', 'M4', 'M1'),
      // The put-away leg always starts from goods in at the aisle head, so bay
      // order is distance order for it and the cheap search is the right one.
      ...slotFirstMatchRungs('v6_', 'K0', 'D50', 'D51', 'M2', 'M1'),
      R('v7', 2, 2, { '0,0': no('X10'), '0,1': out('M8'), '1,0': no('X11') }, [
        { row: 0, col: 1 },
      ]),
      // Which legs this trip has. Both is the whole point of the puzzle.
      R('v8', 3, 6, {
        '0,0': nc('M1'), '0,1': nc('X6'), '0,2': no('M8'), '0,3': no('M4'), '0,4': wire,
        '0,5': set('M7'),
        // The put-away leg is only worth adding to a trip when the crane is
        // already near the aisle head. Bolting it onto a trip that starts at the
        // far end means driving the whole aisle back empty first, which is the
        // deadhead a dual cycle exists to avoid.
        '1,0': nc('M1'), '1,1': nc('X6'), '1,2': no('X12'), '1,3': no('M2'),
        '1,4': cmp('<=', 'D0', 'K2'), '1,5': set('M6'),
        // But never stand still for it. With no order to fetch, the crane must
        // go and do the put-away from wherever it is - otherwise it parks at the
        // far end waiting for stock that only a put-away could deliver, and the
        // whole aisle deadlocks.
        '2,0': nc('M1'), '2,1': nc('X6'), '2,2': no('X12'), '2,3': no('M2'), '2,4': nc('M7'),
        '2,5': set('M6'),
      }),
      R('v9', 2, 5, {
        '0,0': nc('M1'), '0,1': no('M6'), '0,2': wire, '0,3': set('M1'), '0,4': mov('K1', 'D40'),
        '1,0': nc('M1'), '1,1': nc('M6'), '1,2': no('M7'), '1,3': set('M1'),
        '1,4': mov('K3', 'D40'),
      }),
      // Remember which line this trip's order leg belongs to, for the next
      // time both of them are calling at once.
      R('v9b', 2, 4, {
        '0,0': no('M1'), '0,1': no('M7'), '0,2': nc('M5'), '0,3': set('M9'),
        '1,0': no('M1'), '1,1': no('M7'), '1,2': no('M5'), '1,3': rst('M9'),
      }),
      R('v10', 1, 2, { '0,0': no('X29'), '0,1': set('M11') }),
      // A trip is a list of stops, and the step counter says which one is next.
      R('v11', 6, 5, {
        '0,0': no('M1'), '0,1': cmp('=', 'D40', 'K1'), '0,2': wire,
        '0,3': mov('K0', 'D52'), '0,4': mov('K2', 'D53'),
        '1,0': no('M1'), '1,1': cmp('=', 'D40', 'K2'), '1,2': wire,
        '1,3': mov('D50', 'D52'), '1,4': mov('D51', 'D53'),
        '2,0': no('M1'), '2,1': cmp('=', 'D40', 'K3'), '2,2': wire,
        '2,3': mov('D56', 'D52'), '2,4': mov('D57', 'D53'),
        '3,0': no('M1'), '3,1': cmp('=', 'D40', 'K4'), '3,2': nc('M5'),
        '3,3': mov('K0', 'D52'), '3,4': mov('K1', 'D53'),
        '4,0': no('M1'), '4,1': cmp('=', 'D40', 'K4'), '4,2': no('M5'),
        '4,3': mov('K5', 'D52'), '4,4': mov('K1', 'D53'),
        // Idle and not stopping: stay where the last trip left you. Driving home
        // between trips is a whole aisle of travel nobody asked for.
        '5,0': nc('M1'), '5,1': no('X6'), '5,2': wire,
        '5,3': mov('K0', 'D52'), '5,4': mov('K1', 'D53'),
      }),
      ...craneMoveRungs('v12', 'v13'),
      R('v14', 1, 2, { '0,0': nc('M0'), '0,1': rst('M11') }),
      R('v15', 1, 4, { '0,0': no('M1'), '0,1': no('M0'), '0,2': nc('M11'), '0,3': out('Y4') }),
      // Stepped in reverse rung order, so a stop just arrived at cannot also be
      // completed in the same scan.
      R('v16', 1, 10, {
        '0,0': no('M1'), '0,1': cmp('=', 'D40', 'K4'), '0,2': no('M11'), '0,3': no('X28'),
        '0,4': nc('X3'), '0,5': rst('M1'), '0,6': rst('M6'), '0,7': rst('M7'), '0,8': rst('M11'),
        '0,9': rst('M2'),
      }),
      R('v17', 1, 7, {
        '0,0': no('M1'), '0,1': cmp('=', 'D40', 'K3'), '0,2': no('M11'), '0,3': no('X28'),
        '0,4': no('X3'), '0,5': mov('K4', 'D40'), '0,6': rst('M11'),
      }),
      R('v18', 2, 9, {
        '0,0': no('M1'), '0,1': cmp('=', 'D40', 'K2'), '0,2': no('M11'), '0,3': no('X28'),
        '0,4': no('M7'), '0,5': mov('K3', 'D40'), '0,6': rst('M11'), '0,7': wire, '0,8': wire,
        '1,0': no('M1'), '1,1': cmp('=', 'D40', 'K2'), '1,2': no('M11'), '1,3': no('X28'),
        '1,4': nc('M7'), '1,5': rst('M1'), '1,6': rst('M6'), '1,7': rst('M11'), '1,8': rst('M2'),
      }),
      R('v19', 1, 7, {
        '0,0': no('M1'), '0,1': cmp('=', 'D40', 'K1'), '0,2': no('M11'), '0,3': no('X28'),
        '0,4': no('X3'), '0,5': mov('K2', 'D40'), '0,6': rst('M11'),
      }),
      R('v20', 1, 3, { '0,0': no('M8'), '0,1': nc('M4'), '0,2': out('Y5') }),
      R('v21', 1, 2, { '0,0': no('M6'), '0,1': out('Y6') }),
      R('v22', 1, 2, { '0,0': no('M1'), '0,1': out('Y7') }),
    ],
  },
};

/**
 * Canonical answers to the puzzles written in sections.
 *
 * These are `LadderProject`s rather than rung lists because that is what the
 * client posts: only the POUs the player owns, merged over the puzzle's own
 * fixtures by `assembleProject`. Submitting the editable section alone is the
 * shape under test, so the maps below deliberately do not carry the four
 * station programs — if `assembleProject` ever stopped supplying them, every
 * one of these would fail rather than quietly grading the player's copy.
 */
const projectSolutions: Record<string, LadderProject> = {
  'factory-supervisor': {
    pous: [
      {
        id: 'SUP',
        name: 'SUPERVISOR',
        rungs: [
          // Start, sealed in around M0, broken by stop, e-stop or leaving auto.
          // X1 and X2 are normally closed field devices, so both take NO
          // contacts: their bits are on at rest and drop when pressed.
          R(
            'sup-run',
            2,
            5,
            {
              '0,0': no('X0'),
              '1,0': no('M0'),
              '0,1': no('X1'),
              '0,2': no('X2'),
              '0,3': no('X3'),
              '0,4': out('M0'),
            },
            [{ row: 0, col: 1 }],
          ),
          R('sup-lamp', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') }),
          // Three ways the line backs up, ORed into the one amber lamp. X17 is
          // on while there IS yard space, so it is the one that inverts.
          R(
            'sup-held',
            3,
            2,
            {
              '0,0': no('X8'),
              '1,0': no('X11'),
              '2,0': nc('X17'),
              '0,1': out('Y1'),
            },
            [
              { row: 0, col: 1 },
              { row: 1, col: 1 },
            ],
          ),
        ],
      },
    ],
    tasks: [],
  },
};

describe('gradeProgram — canonical solutions solve every sectioned puzzle', () => {
  for (const [slug, project] of Object.entries(projectSolutions)) {
    it(`solves "${slug}"`, () => {
      const spec = getLadderPuzzle(slug);
      expect(spec, `puzzle ${slug} exists`).toBeDefined();
      const validation = validateProgram(spec!, project);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      expect(validation.warnings, JSON.stringify(validation.warnings)).toEqual([]);
      const result = gradeProgram(spec!, project);
      const failed = result.scenarios
        .filter((s) => !s.passed)
        .map((s) => `${s.name}: ${s.steps.flatMap((st) => st.failures).join('; ')}`);
      expect(failed, failed.join(' | ')).toEqual([]);
      expect(result.solved).toBe(true);
      expect(result.score).toBe(100);
    });
  }
});

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

// A shipped demo is a program the player watches rather than one they write, so
// nothing else would ever notice it rotting. Hold it to the same bar as a
// canonical solution: it has to validate, and it has to drive the machine
// through the scenario it claims to demonstrate.
describe('puzzle demos run the machine they promise', () => {
  const demos = PUZZLES.filter(
    (p): p is LadderPuzzleSpec => p.kind === 'ladder' && p.demo !== undefined,
  );

  it('there is at least one, so this suite cannot pass by finding none', () => {
    expect(demos.length).toBeGreaterThan(0);
  });

  for (const spec of demos) {
    it(`"${spec.slug}" demonstrates "${spec.demo!.scenario}"`, () => {
      const { program, scenario } = spec.demo!;
      expect(
        spec.scenarios.map((s) => s.name),
        'the demo names a scenario this puzzle actually has',
      ).toContain(scenario);
      const validation = validateProgram(spec, program);
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
      const trace = traceScenario(spec, program, scenario);
      expect(trace).toBeDefined();
      const failed = trace!.steps.filter((s) => !s.passed).map((s) => s.failures.join('; '));
      expect(failed, failed.join(' | ')).toEqual([]);
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

  /**
   * The analog puzzles spend the same 15 marks on control quality. A loop that
   * holds setpoint loosely is still solved and still unlocks what follows, and
   * still does not reach 100 — the exact property the cycle-time axis has.
   */
  it('scores a regulating puzzle on its error integral instead of on elapsed time', () => {
    const spec = getLadderPuzzle('tank-p-control')!;
    expect(spec.scenarios.every((s) => s.parMs === undefined)).toBe(true);
    expect(spec.scenarios.some((s) => s.parIae !== undefined)).toBe(true);

    const sloppy = structuredClone(solutions['tank-p-control']!);
    // Gain 2 instead of 4: still inside every band the puzzle asks for, but it
    // takes longer to get there and sits further out once loaded. Gain 1 would
    // miss the band outright, which is a different failure to the one under
    // test here.
    sloppy.rungs[2]!.cells[0]![1] = math('mul', 'D31', 'K2', 'D32');
    const result = gradeProgram(spec, sloppy);

    expect(result.solved).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(CORRECTNESS_WEIGHT);
    expect(result.score).toBeLessThan(100);
    const loaded = result.scenarios.find((s) => s.name === 'The offset moves when the load does')!;
    expect(loaded.iae).toBeGreaterThan(loaded.parIae!);
  });
});

describe('gradeProgram — analog puzzles reject the plausible wrong answer', () => {
  /**
   * The discriminator for the P-control puzzle. Open-loop — park the valve at
   * the setpoint and hope — lands exactly on target at the design load, so the
   * no-load scenario alone would pass it. The load step is what exposes that
   * there is no feedback at all.
   */
  it('tank-p-control: an open-loop valve position fails the moment the load changes', () => {
    const spec = getLadderPuzzle('tank-p-control')!;
    const openLoop: LadderProgram = {
      rungs: [
        R('r1', 1, 2, { '0,0': no('X0'), '0,1': mov('K2400', 'D20') }),
        R('r2', 1, 2, { '0,0': nc('X0'), '0,1': mov('K0', 'D20') }),
        R('r3', 1, 3, { '0,0': no('X0'), '0,1': no('X3'), '0,2': out('Y0') }),
      ],
    };
    const result = gradeProgram(spec, openLoop);
    expect(result.solved).toBe(false);
    const byName = new Map(result.scenarios.map((s) => [s.name, s]));
    expect(byName.get('Holds setpoint with no load')!.passed).toBe(true);
    expect(byName.get('The offset moves when the load does')!.passed).toBe(false);
  });

  /**
   * The discriminator for the PID puzzle: proportional action alone. It reaches
   * a level and holds it steadily, which is exactly what makes the offset the
   * only thing separating it from a right answer.
   */
  it('tank-pid: a P-only block leaves an offset the tight band will not accept', () => {
    const spec = getLadderPuzzle('tank-pid')!;
    const pOnly = structuredClone(solutions['tank-pid']!);
    pOnly.rungs[1]!.cells[0]![1] = pid('D30', 'D0', 'D20', { kp: 300, ti: 0 });
    const result = gradeProgram(spec, pOnly);
    expect(result.solved).toBe(false);
    const failures = result.scenarios
      .flatMap((s) => s.steps)
      .flatMap((s) => s.failures)
      .join(' ');
    expect(failures).toContain('proportional term alone');
  });

  /**
   * The discriminator for the capstone: a trip that follows the float instead of
   * latching on it. It looks right while the float is made and quietly reopens
   * the valve the moment the level falls back, which is the failure mode a
   * latch exists to prevent.
   */
  it('tank-auto: a non-latching trip lets go as soon as the level falls back', () => {
    const spec = getLadderPuzzle('tank-auto')!;
    const noLatch = structuredClone(solutions['tank-auto']!);
    noLatch.rungs[2] = R('r3', 1, 2, { '0,0': no('X2'), '0,1': out('M0') });
    const result = gradeProgram(spec, noLatch);
    expect(result.solved).toBe(false);
    const trip = result.scenarios.find((s) => s.name.startsWith('Hand mode overfills'))!;
    expect(trip.passed).toBe(false);
  });
});

describe('gradeProgram — motion puzzles reject the plausible wrong answer', () => {
  /** Swap one cell of a canonical solution, without disturbing the original. */
  function variant(slug: string, patch: (rungs: Rung[]) => void): LadderProgram {
    const program = structuredClone(solutions[slug]!);
    patch(program.rungs);
    return program;
  }

  /**
   * The drive is not a motor contactor. It has to be commissioned before it
   * will turn at all, and both ramp parameters are part of that — which is the
   * first thing this whole category has to teach.
   */
  it('axis-jog: a drive with no ramp parameters refuses to start', () => {
    const spec = getLadderPuzzle('axis-jog')!;
    const noParams: LadderProgram = {
      rungs: [
        R('r1', 1, 2, { '0,0': wire, '0,1': mov('K1200', 'D20') }),
        R('r2', 1, 3, { '0,0': no('X0'), '0,1': nc('X11'), '0,2': out('Y0') }),
        R('r3', 1, 3, { '0,0': no('X1'), '0,1': nc('X10'), '0,2': out('Y1') }),
      ],
    };
    const result = gradeProgram(spec, noParams);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('parameters were loaded');
  });

  it('axis-jog: ramping harder than the motor can pull trips it on overcurrent', () => {
    const spec = getLadderPuzzle('axis-jog')!;
    const tooHard = variant('axis-jog', (rungs) => {
      rungs[0]!.cells[0]![1] = mov('K4000', 'D40');
    });
    const result = gradeProgram(spec, tooHard);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('overcurrent');
  });

  /**
   * The discriminator for the profile puzzle. Rapid all the way is the answer a
   * bit-logic instinct gives you: drop the coil when you get there. The drive
   * does not stop when the coil drops, it starts a ramp, and the carriage is
   * hundreds of counts past the station window by the time that ramp finishes.
   */
  it('axis-profile: rapid all the way sails past the station window', () => {
    const spec = getLadderPuzzle('axis-profile')!;
    const noApproach = variant('axis-profile', (rungs) => {
      // Both speed-reference rungs write full reference: no approach phase.
      rungs[8]!.cells[0]![2] = mov('K4000', 'D20');
    });
    const result = gradeProgram(spec, noApproach);
    expect(result.solved).toBe(false);
  });

  /**
   * The discriminator for the loaded puzzle, in its blunt form: the empty ramp
   * table asks the motor for torque it does not have the moment a pallet is on
   * the forks.
   */
  it('axis-loaded: the empty ramp table trips the drive as soon as it is loaded', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const oneTable = variant('axis-loaded', (rungs) => {
      rungs[0]!.cells[0]![1] = mov('K2000', 'D40');
      rungs[1]!.cells[0]![1] = mov('K2500', 'D41');
    });
    const result = gradeProgram(spec, oneTable);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('overcurrent');
  });

  /**
   * And in its subtle form, which is the one the puzzle is really about: the
   * ramp *parameters* get swapped, because those are the two numbers the
   * briefing hands you, but the slow-down distance they imply does not. The
   * drive is perfectly happy. The pallet still ends up in the wrong place,
   * because half the ramp rate is twice the stopping distance.
   */
  it('axis-loaded: keeping the empty slow-down distance overshoots the drop station', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const oneDistance = variant('axis-loaded', (rungs) => {
      rungs[2]!.cells[0]![1] = mov('K400', 'D32');
    });
    const result = gradeProgram(spec, oneDistance);
    expect(result.solved).toBe(false);
  });

  /**
   * The discriminator for the crane. Everything about this program is right
   * except that it treats "stopped" as "settled" — and a load on a rope is
   * still swinging several seconds after the trolley has stopped dead.
   */
  it('axis-crane: lowering before the swing dies catches the rack', () => {
    const spec = getLadderPuzzle('axis-crane')!;
    const noWait = variant('axis-crane', (rungs) => {
      // Same transfer-pending latch, minus the X17 permission.
      rungs[11]!.cells[0]![3] = wire;
    });
    const result = gradeProgram(spec, noWait);
    expect(result.solved).toBe(false);
    const failures = result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');
    expect(failures).toContain('swinging');
  });

  /**
   * Using the gentle table for everything is not wrong, it is just timid: the
   * pallets all arrive, nothing trips, and the cycle is slow enough to cost
   * part of the throughput weight. Same property the packaging cycle times
   * have, on a puzzle where the temptation to over-derate is much stronger.
   */
  it('axis-loaded: derating the empty moves too still solves, but scores less', () => {
    const spec = getLadderPuzzle('axis-loaded')!;
    const timid = variant('axis-loaded', (rungs) => {
      rungs[3]!.cells[0]![1] = mov('K1000', 'D40');
      rungs[4]!.cells[0]![1] = mov('K1200', 'D41');
      rungs[5]!.cells[0]![1] = mov('K1000', 'D32');
    });
    expectSolvedButNotOptimal(spec, timid);
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

/**
 * The warehouse category is about deciding, not about driving, so every one of
 * these is a program that drives the crane perfectly well and decides badly.
 * Each failure is a consequence the machine reports - a stopped line, a backed-up
 * conveyor, a folded mast - rather than a rule the grader is checking.
 */
describe('gradeProgram — warehouse puzzles reject the plausible wrong answer', () => {
  function variant(slug: string, patch: (rungs: Rung[]) => Rung[]): LadderProgram {
    return { rungs: patch(structuredClone(solutions[slug]!).rungs) };
  }

  const failureText = (result: ReturnType<typeof gradeProgram>): string =>
    result.scenarios.flatMap((s) => s.steps).flatMap((s) => s.failures).join(' ');

  /**
   * The tutorial's two rules, each broken on its own. Both are the same mistake
   * from opposite ends - trusting one half of the machine's state - and the
   * commissioning job exists so a player meets them here, on a crane doing one
   * pallet, rather than four puzzles later in the middle of a schedule.
   */
  it('asrs-drive: a move block without the fork-home contact folds the mast', () => {
    const spec = getLadderPuzzle('asrs-drive')!;
    const noInterlock = variant('asrs-drive', (rungs) =>
      rungs.map((r) =>
        r.id === 'd2'
          ? R('d2', 4, 2, {
              '0,0': cmp('<', 'D0', 'D52'), '0,1': out('Y0'),
              '1,0': cmp('>', 'D0', 'D52'), '1,1': out('Y1'),
              '2,0': cmp('<', 'D1', 'D53'), '2,1': out('Y2'),
              '3,0': cmp('>', 'D1', 'D53'), '3,1': out('Y3'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, noInterlock);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('fork still out in a slot');
  });

  /**
   * The other half: a fork coil wired straight to the button reaches into
   * whatever the crane happens to be passing, and `D0` reading the bay it last
   * went by is no defence - the readout is honest, the fork is simply not there
   * yet.
   */
  it('asrs-drive: a fork driven from the button alone strokes between slots', () => {
    const spec = getLadderPuzzle('asrs-drive')!;
    const ungated = variant('asrs-drive', (rungs) =>
      rungs.map((r) => (r.id === 'd5' ? R('d5', 1, 2, { '0,0': no('X1'), '0,1': out('Y4') }) : r)),
    );
    const result = gradeProgram(spec, ungated);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('still between slots');
  });

  /**
   * The whole point of the WMS table. Bay 1 holds what line A asks for twice
   * running, so a program that only ever looks there gets two deliveries in
   * before it has nothing left to find and the line stops.
   */
  it('asrs-retrieval: only ever searching the nearest bay runs the line dry', () => {
    const spec = getLadderPuzzle('asrs-retrieval')!;
    const bayOneOnly = variant('asrs-retrieval', (rungs) =>
      rungs.filter((r) => !r.id.startsWith('s2_') || r.id === 's2_0' || r.id === 's2_1'),
    );
    const result = gradeProgram(spec, bayOneOnly);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('starved');
  });

  /**
   * A cycle belongs to the line that asked for it. Search the right slot, fetch
   * the right material, and then hand every pallet over at the aisle head
   * regardless of who ordered it, and line A's conveyor takes the two it has
   * room for and then has pallets pushed onto the floor - while line B, at the
   * other end, never sees anything at all.
   */
  it('asrs-two-lines: delivering everything to the aisle head buries line A', () => {
    const spec = getLadderPuzzle('asrs-two-lines')!;
    const oneStation = variant('asrs-two-lines', (rungs) =>
      rungs.map((r) =>
        r.id === 't9'
          ? R('t9', 2, 5, {
              '0,0': no('M1'), '0,1': nc('M3'), '0,2': wire,
              '0,3': mov('D50', 'D52'), '0,4': mov('D51', 'D53'),
              '1,0': no('M1'), '1,1': no('M3'), '1,2': wire,
              '1,3': mov('K0', 'D52'), '1,4': mov('K1', 'D53'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, oneStation);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain("line A's infeed conveyor, which was already full");
  });

  /**
   * The signature interlock, and the one thing in this category that is a crash
   * rather than a cost. Drop the fork-home contact out of the move block and the
   * crane sets off down the aisle with its fork still inside a rack upright.
   */
  it('asrs-two-lines: a move block without the fork-home contact folds the mast', () => {
    const spec = getLadderPuzzle('asrs-two-lines')!;
    const noInterlock = variant('asrs-two-lines', (rungs) =>
      rungs.map((r) =>
        r.id === 't10'
          ? R('t10', 4, 2, {
              '0,0': cmp('<', 'D0', 'D52'), '0,1': out('Y0'),
              '1,0': cmp('>', 'D0', 'D52'), '1,1': out('Y1'),
              '2,0': cmp('<', 'D1', 'D53'), '2,1': out('Y2'),
              '3,0': cmp('>', 'D1', 'D53'), '3,1': out('Y3'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, noInterlock);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('fork still out');
  });

  /**
   * Feeding the line first is right. Feeding the line *only* is not: the inbound
   * conveyor holds two pallets and then goods in stops, which fails the run just
   * as surely as a stopped line does.
   */
  it('asrs-replenish: never putting anything away backs the inbound conveyor up', () => {
    const spec = getLadderPuzzle('asrs-replenish')!;
    const ordersOnly = variant('asrs-replenish', (rungs) =>
      rungs.map((r) =>
        // Kill the put-away leg: the mode relay can now only ever be cleared.
        r.id === 'u5' ? R('u5', 1, 2, { '0,0': nc('M1'), '0,1': rst('M6') }) : r,
      ),
    );
    const result = gradeProgram(spec, ordersOnly);
    expect(result.solved).toBe(false);
    expect(failureText(result)).toContain('blocked');
  });

  /**
   * At full rate every pallet the lines eat has to be replaced, so a crane that
   * only ever runs orders is not merely leaving stock on the dock - it is
   * emptying the rack it is picking from. Goods in backs up and the lines run
   * out of the very material sitting on the conveyor above them.
   */
  it('asrs-dual-cycle: running orders only empties the rack and blocks goods in', () => {
    const spec = getLadderPuzzle('asrs-dual-cycle')!;
    const ordersOnly = variant('asrs-dual-cycle', (rungs) =>
      rungs.map((r) =>
        r.id === 'v8'
          ? R('v8', 1, 5, {
              '0,0': nc('M1'), '0,1': nc('X6'), '0,2': no('M8'), '0,3': no('M4'),
              '0,4': set('M7'),
            })
          : r,
      ),
    );
    const result = gradeProgram(spec, ordersOnly);
    expect(result.solved).toBe(false);
  });
});

describe('gradeProgram — the plausible wrong supervisor is rejected', () => {
  const spec = () => getLadderPuzzle('factory-supervisor')!;

  /** The canonical project with its supervisor swapped for a different one. */
  function supervisor(rungs: Rung[]): LadderProject {
    return { pous: [{ id: 'SUP', name: 'SUPERVISOR', rungs }], tasks: [] };
  }

  const lamp = R('lamp', 1, 2, { '0,0': no('M0'), '0,1': out('Y0') });
  const held = R(
    'held',
    3,
    2,
    { '0,0': no('X8'), '1,0': no('X11'), '2,0': nc('X17'), '0,1': out('Y1') },
    [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ],
  );

  it('no seal-in: the plant runs only while the button is held', () => {
    const result = gradeProgram(
      spec(),
      supervisor([
        R('run', 1, 5, {
          '0,0': no('X0'),
          '0,1': no('X1'),
          '0,2': no('X2'),
          '0,3': no('X3'),
          '0,4': out('M0'),
        }),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('auto in the seal branch: turning the selector to manual does not stop it', () => {
    // A seal that carries X3 in the *branch* rather than in series still starts
    // correctly and still stops on either button, so three of the four scenarios
    // pass. Only the last step of the first one catches it, which is exactly why
    // that step is in there.
    const result = gradeProgram(
      spec(),
      supervisor([
        R(
          'run',
          2,
          4,
          {
            '0,0': no('X0'),
            '0,1': no('X3'),
            '1,0': no('M0'),
            '0,2': no('X1'),
            '0,3': out('M0'),
          },
          [{ row: 0, col: 2 }],
        ),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('NC contacts on the normally closed buttons: the plant never starts', () => {
    const result = gradeProgram(
      spec(),
      supervisor([
        R(
          'run',
          2,
          5,
          {
            '0,0': no('X0'),
            '1,0': no('M0'),
            '0,1': nc('X1'),
            '0,2': nc('X2'),
            '0,3': no('X3'),
            '0,4': out('M0'),
          },
          [{ row: 0, col: 1 }],
        ),
        lamp,
        held,
      ]),
    );
    expect(result.solved).toBe(false);
  });

  it('a supervisor reaching into the weld shop is a validation error', () => {
    // The device space is flat, so nothing in the engine stops this. The
    // ownership declaration is the only thing that does, and it is the whole
    // discipline of writing a plant in sections.
    const validation = validateProgram(
      spec(),
      supervisor([
        R('run', 1, 2, { '0,0': no('X0'), '0,1': out('M0') }),
        lamp,
        held,
        R('meddle', 1, 2, { '0,0': no('M0'), '0,1': out('Y2') }),
      ]),
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('Y2');
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

