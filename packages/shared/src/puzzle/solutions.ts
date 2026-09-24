import type {
  LadderElement,
  LadderProgram,
  LadderProject,
  Pou,
  ProgramDoc,
  Rung,
  VLink,
} from '../ladder/types.js';
import {
  ASSEMBLY_TUNED,
  CONV_TUNED,
  LINE_VARS,
  PAINT_TUNED,
  STORE_TUNED,
  TEST_TUNED,
  WELD_TUNED,
} from './content/factory-line-programs.js';
import {
  HUB_FLEET_PROGRAM,
  RIPEN_PROGRAM,
  SHIP_PROGRAM,
  storeProgram,
} from './content/dc-sections.js';
import { assembleProject, isMultiPou } from './project.js';
import type { LadderPuzzleSpec } from './types.js';

/**
 * The canonical solution to every ladder puzzle.
 *
 * `grade.test.ts` proves each one solves its puzzle with full marks, which is
 * the guardrail against shipping an impossible puzzle. The client's developer
 * mode loads them into a slot so a puzzle can be watched working.
 *
 * Deliberately not re-exported from the package index: it is reached only
 * through the `@automationsolver/shared/solutions` subpath, which the client
 * imports dynamically behind `import.meta.env.DEV`, so a production bundle never
 * carries the answers.
 */

// --- tiny ladder builders -------------------------------------------------
export const no = (d: string): LadderElement => ({ type: 'contact-no', device: d });
export const nc = (d: string): LadderElement => ({ type: 'contact-nc', device: d });
export const rise = (d: string): LadderElement => ({ type: 'contact-rising', device: d });
export const out = (d: string): LadderElement => ({ type: 'coil-out', device: d });
export const timer = (d: string, k: number): LadderElement => ({ type: 'timer', device: d, preset: k });
export const counter = (d: string, k: number): LadderElement => ({ type: 'counter', device: d, preset: k });
export const rst = (d: string): LadderElement => ({ type: 'coil-reset', device: d });
export const set = (d: string): LadderElement => ({ type: 'coil-set', device: d });
export const wire: LadderElement = { type: 'hwire', device: '' };

// Word instructions. `compare` is the only element with no `device` at all:
// both sides are operands.
export const mov = (source: string, dest: string): LadderElement => ({
  type: 'mov',
  device: dest,
  operands: [source],
});
export const math = (
  op: 'add' | 'sub' | 'mul' | 'div',
  a: string,
  b: string,
  dest: string,
): LadderElement => ({ type: 'math', device: dest, op, operands: [a, b] });
export const cmp = (
  op: '=' | '<>' | '>' | '<' | '>=' | '<=',
  a: string,
  b: string,
): LadderElement => ({ type: 'compare', device: '', op, operands: [a, b] });
export const pid = (
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

export function R(
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

/** A queue instruction: head, the value in or the register out, and n. */
const queueOp = (type: 'sfwr' | 'sfrd' | 'pop', head: string, operand: string, n: number): LadderElement => ({
  type,
  device: head,
  operands: [operand],
  preset: n,
});

/**
 * The Cold Chain Hub's flow-lane program. Three FIFO lanes, one table each
 * (D300, D310, D320, four pallets and the pointer: K5), and the call on OUT1
 * served from whichever lane has the called product at its front with the
 * lowest code. Every move books its lane until the lane's count changes, so a
 * table is never read for a pallet that has not arrived, or written for one that
 * has not left.
 */
function flowLaneRungs(): Rung[] {
  const lanes = [1, 2, 3].map((k) => ({
    k,
    code: 30 + k,
    head: 300 + (k - 1) * 10,
    booked: `M2${k}`,
    front: `D29${k}`,
    back: `D28${k}`,
    seen: `D25${k}`,
    z: `Z${k}`,
  }));
  const rungs: Rung[] = [
    // What is at the front and the back of every lane, and what QA is holding.
    R('f1', 7, 2, {
      '0,0': math('div', 'D301', 'K100', 'D291'),
      '1,0': math('div', 'D311', 'K100', 'D292'),
      '2,0': math('div', 'D321', 'K100', 'D293'),
      '3,0': math('div', 'D5', 'K100', 'D280'),
      '4,0': mov('D300', 'Z1'), '4,1': math('div', 'D300Z1', 'K100', 'D281'),
      '5,0': mov('D310', 'Z2'), '5,1': math('div', 'D310Z2', 'K100', 'D282'),
      '6,0': mov('D320', 'Z3'), '6,1': math('div', 'D320Z3', 'K100', 'D283'),
    }),
    // The lane to serve the call from: lowest front code of the called product,
    // busy or not. If the lowest is in a busy lane the answer is to wait for it;
    // shipping the next lowest from another lane is exactly what FEFO forbids.
    R('f2', 1, 2, { '0,0': mov('K0', 'D29'), '0,1': mov('K9999', 'D28') }),
    ...lanes.map((l) =>
      R(`f3${l.k}`, 1, 5, {
        '0,0': cmp('>', `D${l.head}`, 'K0'), '0,1': cmp('=', l.front, 'D13'),
        '0,2': cmp('<', `D${l.head + 1}`, 'D28'), '0,3': mov(`D${l.head + 1}`, 'D28'),
        '0,4': mov(`K${l.code}`, 'D29'),
      }),
    ),
    R('f35', 3, 3, Object.fromEntries(
      lanes.flatMap((l, row) => [
        [`${row},0`, cmp('=', 'D29', `K${l.code}`)], [`${row},1`, no(l.booked)],
        ...(row === 0 ? [['0,2', out('M16')]] : []),
      ]),
    ), [
      { row: 0, col: 2 },
      { row: 1, col: 2 },
    ]),
    // Ship: pop the chosen lane straight into the shipping notice, and book it.
    R('f4', 1, 14, {
      '0,0': cmp('>', 'D13', 'K0'), '0,1': nc('M4'), '0,2': nc('M10'), '0,3': nc('M11'),
      '0,4': nc('M12'), '0,5': cmp('>', 'D29', 'K0'), '0,6': nc('M16'), '0,7': set('M12'),
      '0,8': set('M4'),
      '0,9': out('M15'), '0,10': mov('D29', 'D27'), '0,11': math('sub', 'D29', 'K31', 'Z0'),
      '0,12': math('mul', 'Z0', 'K10', 'Z0'), '0,13': queueOp('sfrd', 'D300Z0', 'D3', 5),
    }),
    R('f5', 3, 4, Object.fromEntries(
      lanes.flatMap((l, row) => [
        [`${row},0`, no('M15')], [`${row},1`, cmp('=', 'D27', `K${l.code}`)],
        [`${row},2`, set(l.booked)], [`${row},3`, mov(`D${l.code}`, l.seen)],
      ]),
    )),
    // Put away: the first lane that is empty or already ends in this product.
    ...lanes.map((l) =>
      R(`f6${l.k}`, 2, 14, {
        '0,0': no('X6'), '0,1': nc('M1'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': nc('M12'),
        '0,5': cmp('<', `D${l.head}`, 'K4'), '0,6': nc(l.booked), '0,7': cmp('=', `D${l.head}`, 'K0'),
        '1,7': cmp('=', l.back, 'D280'),
        '0,8': set('M11'), '0,9': set('M1'), '0,10': rst('M0'), '0,11': set(l.booked),
        '0,12': mov(`K${l.code}`, 'D26'), '0,13': mov(`D${l.code}`, l.seen),
      }, [
        { row: 0, col: 7 },
        { row: 0, col: 8 },
      ]),
    ),
    // ...and into its table, the scan it was chosen.
    R('f7', 1, 4, {
      '0,0': rise('M11'), '0,1': math('sub', 'D26', 'K31', 'Z4'), '0,2': math('mul', 'Z4', 'K10', 'Z4'),
      '0,3': queueOp('sfwr', 'D300Z4', 'D5', 5),
    }),
    // Bring the next pallet in.
    R('f8', 1, 7, {
      '0,0': no('X3'), '0,1': nc('M0'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': nc('M12'),
      '0,5': set('M10'), '0,6': set('M0'),
    }),
    R('f9', 3, 3, {
      '0,0': no('M10'), '0,1': mov('K1', 'D0'), '0,2': mov('K10', 'D1'),
      '1,0': no('M11'), '1,1': mov('K10', 'D0'), '1,2': mov('D26', 'D1'),
      '2,0': no('M12'), '2,1': mov('D27', 'D0'), '2,2': mov('K61', 'D1'),
    }),
    R('f10', 3, 3, {
      '0,0': no('M10'), '0,1': nc('X0'), '0,2': out('Y0'), '1,0': no('M11'), '2,0': no('M12'),
    }, [
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ]),
    R('f11', 1, 4, { '0,0': rise('X0'), '0,1': rst('M10'), '0,2': rst('M11'), '0,3': rst('M12') }),
    R('f12', 5, 2, {
      '0,0': nc('X5'), '0,1': rst('M1'),
      '1,0': cmp('=', 'D13', 'K0'), '1,1': rst('M4'),
      '2,0': cmp('<>', 'D31', 'D251'), '2,1': rst('M21'),
      '3,0': cmp('<>', 'D32', 'D252'), '3,1': rst('M22'),
      '4,0': cmp('<>', 'D33', 'D253'), '4,1': rst('M23'),
    }),
  ];
  return rungs;
}

// 5-floor call-dispatch core shared by every elevator5 puzzle: latches each
// call button, cascades "call pending above/below floor N", sets/clears the
// Up/Down latches per floor (stopping only where the floor's own call is
// still pending — tested before the clear rungs below it — so a further call
// beyond it can't suppress the stop), then clears the call and drives the
// motors. See docs on '09-elevator-dispatch' for the full design rationale.
export function dispatchCore(): Rung[] {
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
export function doorRungs(): Rung[] {
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
export function packFrontEnd(): Rung[] {
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
export function packFlip(gated = false): Rung[] {
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
export function packShip(): Rung[] {
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
export function drillClampFeedCore(): Rung[] {
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
export function drillFullStroke(): Rung[] {
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
export function drillAutoCycle(mixed: boolean): Rung[] {
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
export const solutions: Record<string, LadderProgram> = {
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
      R('u1', 1, 3, { '0,0': nc('M1'), '0,1': rst('M2'), '0,2': rst('M4') }),
      // Line B is not on this shift: both jobs collect and deliver at the aisle
      // head, so rung order is distance order again and the cheap search is the
      // right one for both of them.
      ...slotFirstMatchRungs('u2_', 'D10', 'D50', 'D51', 'M2', 'M1'),
      // The same eight tests find a home for an inbound pallet: an empty slot is
      // just a slot whose register reads zero.
      ...slotFirstMatchRungs('u3_', 'K0', 'D56', 'D57', 'M4', 'M1'),
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
  // --- Cold Chain Hub --------------------------------------------------------
  // An order is chosen (one pending relay at a time), posted (MOVs and the
  // request) and booked on the rising edge of the manager's answer. The two
  // bookings are what the puzzle is for: QA is promised from the moment an
  // order to it is accepted, not from the moment a pallet lands on it.
  'dc-dispatch': {
    rungs: [
      R('h1', 1, 5, {
        '0,0': no('X6'), '0,1': nc('M1'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': set('M11'),
      }),
      R('h2', 1, 5, {
        '0,0': no('X3'), '0,1': nc('M0'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': set('M10'),
      }),
      R('h3', 3, 4, {
        '0,0': no('M10'), '0,1': wire, '0,2': mov('K1', 'D0'), '0,3': mov('K10', 'D1'),
        '1,0': no('M11'), '1,1': no('X7'), '1,2': mov('K10', 'D0'), '1,3': mov('K61', 'D1'),
        '2,0': no('M11'), '2,1': nc('X7'), '2,2': mov('K10', 'D0'), '2,3': mov('K11', 'D1'),
      }),
      R('h4', 2, 3, { '0,0': no('M10'), '0,1': nc('X0'), '0,2': out('Y0'), '1,0': no('M11') }, [
        { row: 0, col: 1 },
      ]),
      R('h5', 2, 5, {
        '0,0': rise('X0'), '0,1': no('M10'), '0,2': set('M0'), '0,3': rst('M10'),
        '1,0': rise('X0'), '1,1': no('M11'), '1,2': set('M1'), '1,3': rst('M0'), '1,4': rst('M11'),
      }),
      R('h6', 1, 2, { '0,0': nc('X5'), '0,1': rst('M1') }),
    ],
  },
  // The same shape with a third order (outfeed to its dock) and a table. The
  // push rides on the booking row of the order that puts a pallet on the line;
  // the pop, the shift and the door lookup ride on a one-scan pulse at the
  // labeler. The table is the FX layout, count at D200 and codes from D201,
  // which is exactly what SFWR/SFRD will keep for the player one puzzle later.
  'dc-label': {
    rungs: [
      R('l1', 1, 6, {
        '0,0': no('X12'), '0,1': nc('M3'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': nc('M12'),
        '0,5': set('M12'),
      }),
      R('l2', 1, 8, {
        '0,0': no('X6'), '0,1': nc('M1'), '0,2': nc('M2'), '0,3': no('X10'), '0,4': nc('M10'),
        '0,5': nc('M11'), '0,6': nc('M12'), '0,7': set('M11'),
      }),
      R('l3', 1, 6, {
        '0,0': no('X3'), '0,1': nc('M0'), '0,2': nc('M10'), '0,3': nc('M11'), '0,4': nc('M12'),
        '0,5': set('M10'),
      }),
      R('l4', 3, 3, {
        '0,0': no('M10'), '0,1': mov('K1', 'D0'), '0,2': mov('K10', 'D1'),
        '1,0': no('M11'), '1,1': mov('K10', 'D0'), '1,2': mov('K50', 'D1'),
        '2,0': no('M12'), '2,1': mov('K51', 'D0'), '2,2': mov('D22', 'D1'),
      }),
      R('l5', 3, 3, {
        '0,0': no('M10'), '0,1': nc('X0'), '0,2': out('Y0'), '1,0': no('M11'), '2,0': no('M12'),
      }, [
        { row: 0, col: 1 },
        { row: 1, col: 1 },
      ]),
      R('l6', 3, 9, {
        '0,0': rise('X0'), '0,1': no('M10'), '0,2': set('M0'), '0,3': rst('M10'),
        '1,0': rise('X0'), '1,1': no('M11'), '1,2': set('M1'), '1,3': set('M2'), '1,4': rst('M0'),
        '1,5': rst('M11'), '1,6': mov('D200', 'Z0'), '1,7': mov('D5', 'D201Z0'),
        '1,8': math('add', 'D200', 'K1', 'D200'),
        '2,0': rise('X0'), '2,1': no('M12'), '2,2': set('M3'), '2,3': rst('M12'),
      }),
      R('l7', 4, 2, {
        '0,0': nc('X5'), '0,1': rst('M1'),
        '1,0': { type: 'contact-falling', device: 'X10' }, '1,1': rst('M2'),
        '2,0': nc('X12'), '2,1': rst('M3'),
        '3,0': nc('X11'), '3,1': rst('M13'),
      }),
      R('l8', 1, 6, {
        '0,0': no('X11'), '0,1': nc('X12'), '0,2': nc('M3'), '0,3': nc('M13'), '0,4': out('M14'),
        '0,5': set('M13'),
      }),
      R('l9', 1, 8, {
        '0,0': no('M14'), '0,1': mov('D201', 'D20'), '0,2': mov('D202', 'D201'),
        '0,3': mov('D203', 'D202'), '0,4': mov('D204', 'D203'), '0,5': mov('D205', 'D204'),
        '0,6': mov('D206', 'D205'), '0,7': math('sub', 'D200', 'K1', 'D200'),
      }),
      R('l10', 1, 5, {
        '0,0': no('M14'), '0,1': math('div', 'D20', 'K100', 'Z1'), '0,2': mov('D100Z1', 'D2'),
        '0,3': mov('D2', 'D22'), '0,4': out('Y1'),
      }),
    ],
  },
  'dc-flow-lanes': { rungs: flowLaneRungs() },
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
/** One section of the excavator line, submitted the way the client posts it. */
export function lineSolution(id: string, name: string, rungs: Rung[]): Pou {
  return { id, name, rungs, vars: LINE_VARS[id].map((v) => ({ ...v })) };
}

export const projectSolutions: Record<string, LadderProject> = {
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
  // The weld bay's answer is the tuned program the plant's own soak test
  // measures, imported rather than copied out: two drifting copies of the same
  // twenty rungs is how a puzzle quietly stops being the one that was measured.
  // Only the section the player owns is submitted, so `assembleProject` still
  // has to supply the other six.
  //
  // A section's declarations travel with its rungs, exactly as the client posts
  // them: the programs are written in names, and rungs submitted without the
  // table that defines them would resolve to nothing.
  'factory-weld': {
    pous: [lineSolution('WELD', 'SEC1_WELD', WELD_TUNED)],
    tasks: [],
  },
  'factory-conveyor': {
    pous: [lineSolution('CONV', 'SEC6_CONVEYOR', CONV_TUNED)],
    tasks: [],
  },
  'factory-handling': {
    pous: [lineSolution('STORE', 'SEC2_STORE', STORE_TUNED)],
    tasks: [],
  },
  'factory-paint': {
    pous: [lineSolution('PAINT', 'SEC3_PAINT', PAINT_TUNED)],
    tasks: [],
  },
  // The first puzzle in this category that opens two sections at once, so its
  // answer is two POUs. Everything else about the shape is the same.
  'factory-assembly': {
    pous: [
      lineSolution('ASSY', 'SEC4_ASSEMBLY', ASSEMBLY_TUNED),
      lineSolution('TEST', 'SEC5_TEST', TEST_TUNED),
    ],
    tasks: [],
  },
  // The capstone: every section open, and the canonical answer is the whole
  // plant run properly. The supervisor is left out on purpose — it is editable
  // here, so `assembleProject` takes it from the slot's own seed, which proves
  // a partial submission is merged the way the client posts one.
  // The first Cold Chain Hub puzzle in sections: the rooms, submitted alone,
  // and merged over RECEIVE and FLEET the way the client posts it.
  'dc-ripening': {
    pous: [{ id: 'RIPEN', name: 'RIPEN', rungs: RIPEN_PROGRAM }],
    tasks: [],
  },
  'dc-drive-in': {
    pous: [
      {
        id: 'STORE',
        name: 'STORE',
        rungs: storeProgram({
          lanes: [31, 32, 41, 42, 43],
          docks: [
            { code: 61, call: 'D13' },
            { code: 62, call: 'D14' },
          ],
        }),
      },
    ],
    tasks: [],
  },
  // The capstone opens the two ends of the hub, so its answer is two sections.
  'dc-hub': {
    pous: [
      { id: 'SHIP', name: 'SHIP', rungs: SHIP_PROGRAM },
      { id: 'FLEET', name: 'FLEET', rungs: HUB_FLEET_PROGRAM },
    ],
    tasks: [],
  },
  'factory-line': {
    pous: [
      lineSolution('WELD', 'SEC1_WELD', WELD_TUNED),
      lineSolution('STORE', 'SEC2_STORE', STORE_TUNED),
      lineSolution('PAINT', 'SEC3_PAINT', PAINT_TUNED),
      lineSolution('ASSY', 'SEC4_ASSEMBLY', ASSEMBLY_TUNED),
      lineSolution('TEST', 'SEC5_TEST', TEST_TUNED),
      lineSolution('CONV', 'SEC6_CONVEYOR', CONV_TUNED),
    ],
    tasks: [],
  },
};

/**
 * The canonical answer to `spec`, shaped the way the editor holds it, or
 * undefined when none is recorded.
 *
 * A sectioned puzzle's answer carries only the sections the player writes, so
 * it is merged over the puzzle's own the same way a submission is: the editor
 * then opens with every section present, fixtures included.
 */
export function canonicalSolution(spec: LadderPuzzleSpec): ProgramDoc | undefined {
  const project = projectSolutions[spec.slug];
  if (project) return assembleProject(spec, structuredClone(project));
  const program = solutions[spec.slug];
  if (!program) return undefined;
  return isMultiPou(spec) ? assembleProject(spec, structuredClone(program)) : structuredClone(program);
}
