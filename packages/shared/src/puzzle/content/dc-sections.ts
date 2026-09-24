import type { LadderElement, Rung, TaskDef, VarDecl } from '../../ladder/types.js';
import type { PouSlot } from '../types.js';
import { math, mov, nc, no, out, rise, rst, rung, set } from './dc-plant.js';

/**
 * The Cold Chain Hub in sections, for the puzzles written in them (57 on).
 *
 * The hub splits the way a real one does: by stage, each stage owning its
 * locations, the moves *out of* them and the tables that say what is in them.
 * They share one fleet manager, so one section, FLEET, owns the mailbox and
 * every other section asks it for a vehicle through a request slot of its own.
 * FLEET ships written until the capstone: it is the interface every other
 * section is written against, and the lesson is using an interface, not
 * re-deriving one. The capstone hands it over, because by then the policy
 * inside it is what is worth changing.
 *
 * Like `factory-line-sections.ts`, every section lives here once, and a puzzle
 * says which ones its plant has and which of them it opens.
 */

export const HUB_SECTION_IDS = ['RECEIVE', 'RIPEN', 'STORE', 'SHIP', 'FLEET'] as const;
export type HubSectionId = (typeof HUB_SECTION_IDS)[number];

const cmp = (op: '=' | '<>' | '>' | '<' | '>=' | '<=', a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op,
  operands: [a, b],
});
const timer = (device: string, k: number): LadderElement => ({ type: 'timer', device, preset: k });
const queue = (type: 'sfwr' | 'sfrd' | 'pop', head: string, operand: string, n: number): LadderElement => ({
  type,
  device: head,
  operands: [operand],
  preset: n,
});
const fall = (device: string): LadderElement => ({ type: 'contact-falling', device });
const wire: LadderElement = { type: 'hwire', device: '' };

// --- The request slots ----------------------------------------------------------------

/** Which slot each section asks the fleet through. Lower numbers are further upstream. */
export const HUB_SLOT: Record<Exclude<HubSectionId, 'FLEET'>, number> = {
  RECEIVE: 1,
  RIPEN: 2,
  STORE: 3,
  SHIP: 4,
};

/** Slot k: request relay M30k, accepted pulse M31k, and FROM, TO, NOTICE at D5k0 to D5k2. */
export function slotDevices(k: number): { req: string; accepted: string; from: string; to: string; asn: string } {
  return {
    req: `M30${k}`,
    accepted: `M31${k}`,
    from: `D5${k}0`,
    to: `D5${k}1`,
    asn: `D5${k}2`,
  };
}

/** The slots as globals, so a section can say `RipenRequest` rather than M302. */
export const HUB_GLOBALS: VarDecl[] = (Object.entries(HUB_SLOT) as [string, number][]).flatMap(
  ([section, k]) => {
    const s = slotDevices(k);
    const name = section[0] + section.slice(1).toLowerCase();
    return [
      { name: `${name}Request`, kind: 'bool', address: s.req, fixed: true, comment: 'raised by the section' },
      { name: `${name}Accepted`, kind: 'bool', address: s.accepted, fixed: true, comment: 'one scan, from FLEET' },
      { name: `${name}From`, kind: 'int', address: s.from, fixed: true },
      { name: `${name}To`, kind: 'int', address: s.to, fixed: true },
      { name: `${name}Notice`, kind: 'int', address: s.asn, fixed: true, comment: 'shipping notice code' },
    ];
  },
);

// --- FLEET: the dispatcher ---------------------------------------------------------------

/**
 * One slot at a time into the mailbox, downstream first.
 *
 * A request is chosen only while nothing is being asked (D590 = 0), then its
 * three registers are copied into D0, D1 and D3 through an index (slot k's are
 * ten registers apart), and Y0 asks until the manager answers. The rising edge
 * of the answer pulses the slot's accepted relay for one scan and frees the
 * mailbox. Downstream first is a policy, and the right one here: a hub that
 * drains before it fills never backs up into its own docks.
 */
export const FLEET_PROGRAM: Rung[] = [
  ...[4, 3, 2, 1].map((k) =>
    rung(`fleet-choose-${k}`, [[cmp('=', 'D590', 'K0'), nc('M399'), no(`M30${k}`), mov(`K${k}`, 'D590')]]),
  ),
  rung('fleet-post', [
    [
      cmp('>', 'D590', 'K0'),
      math('mul', 'D590', 'K10', 'Z7'),
      mov('D500Z7', 'D0'),
      mov('D501Z7', 'D1'),
      mov('D502Z7', 'D3'),
    ],
  ]),
  rung('fleet-ask', [[cmp('>', 'D590', 'K0'), nc('X0'), out('Y0')]]),
  rung('fleet-answer', [
    ...[1, 2, 3, 4].map((k) => [rise('X0'), cmp('=', 'D590', `K${k}`), out(`M31${k}`)]),
    [rise('X0'), mov('K0', 'D590')],
    [no('X1'), mov('K0', 'D590'), set('M399')],
  ]),
];

/** Any of the three batteries below `k` percent: three compares in parallel, then `tail`. */
function anyBatteryBelow(lead: LadderElement[], k: number, tail: LadderElement[]): (LadderElement | null)[][] {
  const n = lead.length;
  const pad = Array.from({ length: n }, () => null);
  return [
    [...lead, cmp('<', 'D81', `K${k}`), ...tail],
    [...pad, cmp('<', 'D82', `K${k}`)],
    [...pad, cmp('<', 'D83', `K${k}`)],
  ];
}

/**
 * The capstone's dispatcher: FLEET as the earlier puzzles ship it, and the
 * charger. A charge order is D0 = 0, D1 = 70, chosen as K9 in the dispatcher's
 * own slot register ahead of every request; the manager takes it at once and
 * sends the vehicle with the lowest battery as soon as its job is done, so
 * posting one never waits for a vehicle to be free.
 *
 * `chargeBelow` is the whole policy, and the capstone's answer is the one that
 * measured fastest: 10%. Earlier is slower, because every charge takes a vehicle
 * off the floor, and 3% runs one flat (docs/COLD-CHAIN.md). Left out, nothing
 * ever charges.
 */
export function fleetProgram(opts: { chargeBelow?: number }): Rung[] {
  const [choose, post, ask, answer] = [FLEET_PROGRAM.slice(0, 4), FLEET_PROGRAM[4], FLEET_PROGRAM[5], FLEET_PROGRAM[6]];
  const links = [
    { row: 0, col: 3 },
    { row: 1, col: 3 },
    { row: 0, col: 4 },
    { row: 1, col: 4 },
  ];
  const charge = (below: number): Rung =>
    rung('fleet-charge', anyBatteryBelow([cmp('=', 'D590', 'K0'), nc('M399'), nc('X26')], below, [mov('K9', 'D590')]), links);
  return [
    ...(opts.chargeBelow !== undefined ? [charge(opts.chargeBelow)] : []),
    ...choose,
    rung('fleet-post', [
      [cmp('>', 'D590', 'K0'), cmp('<', 'D590', 'K9'), ...post.cells[0].slice(1)],
      [cmp('=', 'D590', 'K9'), mov('K0', 'D0'), mov('K70', 'D1')],
    ]),
    ask,
    answer,
  ];
}

/** The capstone's canonical dispatcher. */
export const HUB_FLEET_PROGRAM: Rung[] = fleetProgram({ chargeBelow: 10 });

// --- SHIP: the outbound trucks -----------------------------------------------------------

/**
 * Outbound by the truckload. A truck's order arrives as lines, in the order the
 * truck will *drop* them, and the trailer fills from the front, so the last line
 * has to go on first: every line is pushed onto its dock's stack as it arrives,
 * and once the whole order is in, POPP gives them back last first.
 *
 * SHIP moves nothing itself. It publishes what each dock wants next, and the
 * section that holds that product (RIPEN for fruit, STORE for the rest) ships it
 * under its own slot. SHIP watches for the order that claims its request, and
 * keeps one pallet on its way to each dock at a time: two on the road at once
 * could arrive in either order, and a trailer is loaded in sequence.
 */
export const SHIP_PROGRAM: Rung[] = [
  // Every line onto its dock's stack: OUT1's at D760, OUT2's at D770.
  rung('ship-line', [
    [
      no('X21'),
      nc('Y6'),
      math('sub', 'D8', 'K61', 'Z6'),
      math('mul', 'Z6', 'K10', 'Z6'),
      queue('sfwr', 'D760Z6', 'D9', 7),
      out('Y6'),
    ],
  ]),
  ...([1, 2] as const).map((k) =>
    rung(`ship-order-in-${k}`, [
      [cmp('=', `D7${k + 5}0`, `D1${k + 4}`), cmp('>', `D1${k + 4}`, 'K0'), set(`M56${k}`)],
      [cmp('=', `D7${k + 5}0`, 'K0'), rst(`M56${k}`)],
    ]),
  ),
  // The whole order is in, nothing is on its way, and the last request was taken: the next line, last first.
  ...([1, 2] as const).map((k) =>
    rung(`ship-want-${k}`, [
      [no(`M56${k}`), nc(`M55${k}`), cmp('=', `D75${k}`, 'K0'), queue('pop', `D7${k + 5}0`, `D75${k}`, 7)],
    ]),
  ),
  // Claimed: RIPEN ships to OUT1 through slot 2, STORE to either dock through slot 3.
  rung('ship-claimed', [
    [no('M312'), cmp('=', 'D521', 'K61'), mov('K0', 'D751'), set('M551'), mov('D61', 'D753')],
    [no('M313'), cmp('=', 'D531', 'K61'), mov('K0', 'D751'), set('M551'), mov('D61', 'D753')],
    [no('M313'), cmp('=', 'D531', 'K62'), mov('K0', 'D752'), set('M552'), mov('D62', 'D754')],
  ]),
  rung('ship-landed', [
    [cmp('<>', 'D61', 'D753'), rst('M551')],
    [cmp('<>', 'D62', 'D754'), rst('M552')],
  ]),
];

// --- RECEIVE: the docks and QA -----------------------------------------------------------

/**
 * Goods in: IN1 and IN2 to QA, turn about, and anything that fails to
 * quarantine. Passed pallets are not RECEIVE's to move: whoever stores that
 * product collects it from QA, which is why QA is booked from the moment an
 * order to it is accepted until a pallet is lifted *off* it, by anybody.
 */
export const RECEIVE_PROGRAM: Rung[] = [
  // A failed pallet leaves QA for quarantine before anything else comes in.
  rung('recv-quarantine', [
    [nc('M301'), no('X6'), nc('X7'), nc('M403'), mov('K10', 'D510'), mov('K11', 'D511'), set('M404'), set('M301')],
  ]),
  // IN1 unless IN1 went last and IN2 is waiting.
  rung(
    'recv-in1',
    [[nc('M301'), nc('M400'), no('X3'), nc('M402'), mov('K1', 'D510'), mov('K10', 'D511'), set('M401'), set('M301')], [null, null, null, nc('X4')]],
    [
      { row: 0, col: 3 },
      { row: 0, col: 4 },
    ],
  ),
  rung('recv-in2', [
    [nc('M301'), nc('M400'), no('X4'), mov('K2', 'D510'), mov('K10', 'D511'), set('M401'), set('M301')],
  ]),
  rung('recv-accepted', [
    [no('M311'), no('M401'), set('M400'), rst('M401')],
    [no('M311'), no('M404'), set('M403'), rst('M404')],
    [no('M311'), cmp('=', 'D510', 'K1'), set('M402')],
    [no('M311'), cmp('=', 'D510', 'K2'), rst('M402')],
    [no('M311'), rst('M301')],
  ]),
  rung('recv-qa-cleared', [[fall('X5'), rst('M400'), rst('M403')]]),
];

// --- RIPEN: the two rooms ------------------------------------------------------------------

/**
 * Per room: whether it can take the pallet on QA, whether it can ship what OUT1
 * is calling for, and the four-state cycle (0 filling, 1 closing, 2 ripening,
 * 3 ripe) that drives its door and its start. A room is a stack, so its table
 * is pushed with SFWRP and shipped from with POPP straight into the notice.
 */
function roomRungs(r: 1 | 2, call: string): Rung[] {
  const head = r === 1 ? 'D700' : 'D710';
  const first = r === 1 ? 'D701' : 'D711';
  const product = `D66${r}`;
  const state = `D67${r}`;
  const booked = `M46${r}`;
  const seen = `D68${r}`;
  const count = r === 1 ? 'D21' : 'D22';
  const code = r === 1 ? 'K21' : 'K22';
  const open = r === 1 ? 'X15' : 'X16';
  const shut = r === 1 ? 'X22' : 'X23';
  const clear = r === 1 ? 'X24' : 'X25';
  const ripe = r === 1 ? 'X17' : 'X20';
  const door = r === 1 ? 'Y2' : 'Y3';
  const start = r === 1 ? 'Y4' : 'Y5';
  const batch = r === 1 ? 'T10' : 'T11';
  const canTake = `M48${r}`;
  const canShip = `M48${r + 2}`;
  return [
    rung(`ripen-product-${r}`, [[math('div', first, 'K100', product)]]),
    // Can this room take the pallet on QA: filling, door open, room left, same product or empty.
    rung(
      `ripen-can-take-${r}`,
      [
        [cmp('=', state, 'K0'), no(open), cmp('<', head, 'K4'), nc(booked), cmp('=', head, 'K0'), out(canTake)],
        [null, null, null, null, cmp('=', product, 'D650')],
      ],
      [
        { row: 0, col: 4 },
        { row: 0, col: 5 },
      ],
    ),
    // Can this room ship what OUT1 is calling for: ripe, open, stocked, that product.
    rung(`ripen-can-ship-${r}`, [
      [cmp('=', state, 'K3'), no(open), cmp('>', head, 'K0'), nc(booked), cmp('=', product, call), out(canShip)],
    ]),
    rung(`ripen-ship-${r}`, [
      [
        no('M485'),
        no(canShip),
        nc('M302'),
        set('M470'),
        set('M302'),
        set(booked),
        mov(count, seen),
        mov(code, 'D520'),
        mov('K61', 'D521'),
        queue('pop', head, 'D522', 5),
      ],
    ]),
    rung(`ripen-take-${r}`, [
      [
        no('M480'),
        no(canTake),
        nc('M302'),
        set('M452'),
        set('M302'),
        set(booked),
        mov(count, seen),
        mov('K10', 'D520'),
        mov(code, 'D521'),
        queue('sfwr', head, 'D5', 5),
      ],
    ]),
    // The batch timer runs while a filling room has pallets and nothing on the way.
    rung(`ripen-batch-${r}`, [[cmp('=', state, 'K0'), cmp('>', head, 'K0'), nc(booked), timer(batch, 300)]]),
    rung(`ripen-cycle-${r}`, [
      // Full, or quiet for 30 s: close up.
      [cmp('=', state, 'K0'), cmp('>', head, 'K0'), nc(booked), cmp('=', head, 'K4'), mov('K1', state)],
      [null, null, null, no(batch)],
      // Shut and clear: start the gas.
      [cmp('=', state, 'K1'), no(shut), no(clear), mov('K2', state), out(start)],
      [cmp('=', state, 'K2'), no(ripe), mov('K3', state)],
      [cmp('=', state, 'K3'), cmp('=', head, 'K0'), nc(booked), mov('K0', state)],
    ], [
      { row: 0, col: 3 },
      { row: 0, col: 4 },
    ]),
    // Open while filling or emptying, and while closing until the doorway is clear.
    rung(
      `ripen-door-${r}`,
      [[cmp('=', state, 'K0'), wire, out(door)], [cmp('=', state, 'K3'), wire], [cmp('=', state, 'K1'), nc(clear)]],
      [
        { row: 0, col: 2 },
        { row: 1, col: 2 },
      ],
    ),
  ];
}

/**
 * The rooms, shipping to OUT1 whenever `call` names one of their products: the
 * plant's own call register D13 in puzzle 57, SHIP's request in the capstone.
 */
export function ripenProgram(call: string): Rung[] {
  return [
    rung('ripen-qa-product', [[math('div', 'D5', 'K100', 'D650')]]),
    // A green pallet on QA that is ours to collect.
    rung('ripen-qa-ours', [
      [no('X6'), no('X7'), cmp('>=', 'D650', 'K1'), cmp('<=', 'D650', 'K2'), nc('M452'), out('M480')],
    ]),
    // OUT1 is calling and no shipment of ours is on its way.
    rung('ripen-call', [[cmp('>', call, 'K0'), nc('M470'), out('M485')]]),
    ...roomRungs(1, call),
    ...roomRungs(2, call),
    rung('ripen-accepted', [[no('M312'), rst('M302')]]),
    rung('ripen-released', [
      [fall('X5'), rst('M452')],
      [cmp('=', call, 'K0'), rst('M470')],
      [cmp('<>', 'D21', 'D681'), rst('M461')],
      [cmp('<>', 'D22', 'D682'), rst('M462')],
    ]),
  ];
}

export const RIPEN_PROGRAM: Rung[] = ripenProgram('D13');

// --- STORE: the lanes --------------------------------------------------------------------------

/** A storage lane, as the STORE program sees it. */
interface Lane {
  /** 0 to 5: F1, F2, F3, L1, L2, L3. Everything else about the lane is numbered from it. */
  j: number;
  code: number;
  head: number;
  kind: 'flow' | 'drive';
}

const ALL_LANES: Lane[] = [31, 32, 33, 41, 42, 43].map((code, j) => ({
  j,
  code,
  head: 300 + 10 * j,
  kind: code < 40 ? 'flow' : 'drive',
}));

/** An outbound dock STORE ships to, and the register that says what it wants next. */
export interface StoreDock {
  code: 61 | 62;
  call: string;
}

/**
 * The storage lanes, both kinds, and shipping to whatever the docks call for.
 *
 * Every lane is kept *ordered*: a flow lane's lots never go down from front to
 * back, a drive-in lane's never go up from bottom to top. That is the whole
 * smart put-away rule (a flow lane takes a pallet whose lot is no older than
 * the one at its back, a drive-in lane one no newer than the one on top), and
 * what it buys is that the oldest lot of any product is always at some lane's
 * *out* end, so first-expired-first-out is a search for the lowest code among
 * the lane ends. The search counts booked lanes too and simply waits when the
 * best one is busy, because shipping the second best would break the rule.
 *
 * Bookings are per face. A flow lane is loaded at the back and picked at the
 * front, so a put-away in flight blocks the next put-away and nothing else; a
 * drive-in lane has one face and one move at a time. A lane's count going up is
 * a pallet arriving and going down is one leaving, which releases each face's
 * booking on its own however busy the other face is.
 */
export function storeProgram(opts: { lanes: readonly number[]; docks: readonly StoreDock[] }): Rung[] {
  const lanes = ALL_LANES.filter((l) => opts.lanes.includes(l.code));
  const put = (l: Lane) => `M51${l.j}`;
  const canTake = (l: Lane) => `M52${l.j}`;
  const canShip = (l: Lane) => `M53${l.j}`;
  const pick = (l: Lane) => `M54${l.j}`;
  const prev = (l: Lane) => `D72${l.j}`;
  const outCode = (l: Lane) => `D73${l.j}`;
  const backCode = (l: Lane) => `D74${l.j}`;
  const head = (l: Lane) => `D${l.head}`;
  const count = (l: Lane) => `D${l.code}`;
  const dockRegs = (d: StoreDock, k: number) => ({
    lo: k === 0 ? 'D726' : 'D736',
    hi: k === 0 ? 'D727' : 'D737',
    best: k === 0 ? 'D728' : 'D738',
    lane: k === 0 ? 'D729' : 'D739',
    booked: k === 0 ? 'M502' : 'M503',
    pulse: k === 0 ? 'M504' : 'M505',
    ...d,
  });

  const rungs: Rung[] = [
    // What would leave each lane next, and what the next pallet in would stand beside.
    rung(
      'store-ends',
      lanes.map((l) =>
        l.kind === 'flow'
          ? [mov(head(l), 'Z4'), mov(`${head(l)}Z4`, backCode(l)), mov(`D${l.head + 1}`, outCode(l))]
          : [mov(head(l), 'Z4'), mov(`${head(l)}Z4`, outCode(l)), mov(outCode(l), backCode(l))],
      ),
    ),
    // Codes as ranges: product P is P x 100 to P x 100 + 99, so no lane needs a division.
    rung('store-ranges', [
      ...opts.docks.map((d, k) => {
        const r = dockRegs(d, k);
        return [math('mul', r.call, 'K100', r.lo), math('add', r.lo, 'K99', r.hi)];
      }),
      [math('div', 'D5', 'K100', 'D748'), math('mul', 'D748', 'K100', 'D746'), math('add', 'D746', 'K99', 'D747')],
    ]),
    // Which lanes could send a pallet out right now.
    rung(
      'store-can-ship',
      lanes.map((l) =>
        l.kind === 'flow'
          ? [cmp('>', count(l), 'K0'), nc(pick(l)), out(canShip(l))]
          : [cmp('>', head(l), 'K0'), nc(pick(l)), nc(put(l)), out(canShip(l))],
      ),
    ),
  ];

  opts.docks.forEach((d, k) => {
    const r = dockRegs(d, k);
    rungs.push(rung(`store-search-${d.code}`, [[mov('K9999', r.best), mov('K0', r.lane)]]));
    for (const l of lanes) {
      rungs.push(
        rung(`store-best-${d.code}-${l.code}`, [
          [
            cmp('>', head(l), 'K0'),
            cmp('>=', outCode(l), r.lo),
            cmp('<=', outCode(l), r.hi),
            cmp('<', outCode(l), r.best),
            mov(outCode(l), r.best),
            mov(`K${l.code}`, r.lane),
          ],
        ]),
      );
    }
    // Ship only from the best lane, and only once it can send: never the second best.
    rungs.push(
      rung(
        `store-ship-${d.code}`,
        lanes.map((l, i) =>
          i === 0
            ? [
                cmp('>', r.call, 'K0'),
                nc(r.booked),
                nc('M303'),
                cmp('=', r.lane, `K${l.code}`),
                no(canShip(l)),
                out(r.pulse),
                set(r.booked),
                set('M303'),
                mov(r.lane, 'D530'),
                mov(`K${d.code}`, 'D531'),
              ]
            : [null, null, null, cmp('=', r.lane, `K${l.code}`), no(canShip(l))],
        ),
        lanes.slice(1).flatMap((_, i) => [
          { row: i, col: 3 },
          { row: i, col: 5 },
        ]),
      ),
    );
    rungs.push(
      rung(
        `store-ship-lane-${d.code}`,
        lanes.map((l) => [
          no(r.pulse),
          cmp('=', r.lane, `K${l.code}`),
          set(pick(l)),
          queue(l.kind === 'flow' ? 'sfrd' : 'pop', head(l), 'D532', 5),
        ]),
      ),
    );
  });

  rungs.push(
    // A passed pallet on QA that is not produce for the rooms is ours.
    rung('store-qa-ours', [[no('X6'), no('X7'), cmp('>=', 'D748', 'K3'), nc('M501'), out('M500')]]),
    // Which lanes could take it, by the rule for their kind.
    ...lanes.map((l) =>
      rung(
        `store-can-take-${l.code}`,
        [
          l.kind === 'flow'
            ? [cmp('<', head(l), 'K4'), nc(put(l)), wire, cmp('=', head(l), 'K0'), wire, out(canTake(l))]
            : [cmp('<', head(l), 'K4'), nc(put(l)), nc(pick(l)), cmp('=', head(l), 'K0'), wire, out(canTake(l))],
          l.kind === 'flow'
            ? [null, null, null, cmp('>=', backCode(l), 'D746'), cmp('<=', backCode(l), 'D5')]
            : [null, null, null, cmp('>=', backCode(l), 'D5'), cmp('<=', backCode(l), 'D747')],
        ],
        [
          { row: 0, col: 3 },
          { row: 0, col: 5 },
        ],
      ),
    ),
    // Put it beside its own kind first, and into an empty lane only when nothing fits.
    ...(['beside', 'empty'] as const).flatMap((pass) =>
      lanes.map((l) =>
        rung(`store-take-${pass}-${l.code}`, [
          [
            no('M500'),
            no(canTake(l)),
            cmp(pass === 'beside' ? '>' : '=', head(l), 'K0'),
            nc('M303'),
            set('M501'),
            set('M303'),
            set(put(l)),
            mov('K10', 'D530'),
            mov(`K${l.code}`, 'D531'),
            queue('sfwr', head(l), 'D5', 5),
          ],
        ]),
      ),
    ),
    rung('store-accepted', [[no('M313'), rst('M303')]]),
    rung('store-released', [
      [fall('X5'), rst('M501')],
      ...opts.docks.map((d, k) => [cmp('=', d.call, 'K0'), rst(dockRegs(d, k).booked)]),
      ...lanes.flatMap((l) => [
        [cmp('>', count(l), prev(l)), rst(put(l))],
        [cmp('<', count(l), prev(l)), rst(pick(l))],
      ]),
    ]),
    rung('store-counts', lanes.map((l) => [mov(count(l), prev(l))])),
  );
  return rungs;
}

// --- The sections ------------------------------------------------------------------------------

interface SectionDef {
  name: string;
  title: string;
  brief: string;
  owns: string[];
  program?: Rung[];
  maxRungs: number;
}

const SECTIONS: Record<HubSectionId, SectionDef> = {
  FLEET: {
    name: 'FLEET',
    title: 'Fleet dispatcher',
    owns: ['Y0', 'D0-D1', 'D3', 'M311-M314', 'M399', 'D590-D599', 'Z7'],
    program: FLEET_PROGRAM,
    maxRungs: 12,
    brief: [
      'The one section that talks to the fleet manager. Every other section asks it for a',
      'vehicle through a request slot of its own, and it passes one request at a time into',
      'the mailbox.',
      '',
      '## The request slots',
      '- RECEIVE is slot 1, RIPEN 2, STORE 3, SHIP 4.',
      '- Slot k is the relay M30k, raised by its section, and three registers written by it:',
      '  FROM at D5k0, TO at D5k1 and the shipping notice at D5k2. Slot 2 is M302, D520 to',
      '  D522.',
      '- When the manager accepts a slot\'s order, FLEET turns the relay M31k on for exactly',
      '  one scan. Drop the request on that scan and book whatever you promised.',
      '- Hold the slot\'s registers steady from raising the request until it is accepted.',
      '',
      '## Sequence of operation',
      '1. With nothing being asked, take the most downstream slot that is requesting: SHIP,',
      '   then STORE, then RIPEN, then RECEIVE. A hub that empties before it fills never',
      '   backs up into its own docks.',
      '2. Copy its three registers into D0, D1 and D3 and ask on Y0.',
      '3. On the answer, pulse the slot\'s accepted relay and free the mailbox.',
      '',
      '## Field notes',
      '- A rejected order means a section asked for something impossible. FLEET latches M399',
      '  and stops dispatching until the plant is reset.',
      '- FLEET is scanned last, after every section has decided what it wants.',
    ].join('\n'),
  },
  RECEIVE: {
    name: 'RECEIVE',
    title: 'Docks and QA',
    owns: ['M301', 'D510-D512', 'M400-M449', 'D600-D649'],
    program: RECEIVE_PROGRAM,
    maxRungs: 16,
    brief: [
      'Goods in: both inbound docks, the QA table and quarantine.',
      '',
      '## Sequence of operation',
      '1. A pallet that failed QA goes to quarantine first.',
      '2. Otherwise, with QA free, bring in the next pallet: IN1 and IN2 take turns.',
      '',
      '## Field notes',
      '- A pallet that passes is not RECEIVE\'s to move. The section that stores that product',
      '  collects it from QA.',
      '- QA is booked from the moment an order to it is accepted until a pallet is lifted off',
      '  it, by anybody.',
    ].join('\n'),
  },
  RIPEN: {
    name: 'RIPEN',
    title: 'Ripening rooms',
    owns: ['M302', 'D520-D522', 'Y2-Y5', 'M450-M499', 'D650-D699', 'D700-D719', 'T10-T19', 'Z2-Z3'],
    program: RIPEN_PROGRAM,
    maxRungs: 40,
    brief: [
      'Two ripening rooms, R1 and R2. Bananas and avocados arrive green and leave a room',
      'ripe, a batch at a time.',
      '',
      '## Sequence of operation',
      '1. Collect every passed green pallet (products 1 and 2) from QA into a room that is',
      '   filling, has its door open, has room, and is empty or already holds that product.',
      '2. Close a room up when it is full, or when it has pallets and nothing has gone in for',
      '   30 s. Start its cycle once the door is shut.',
      '3. When it is ripe, open it and ship from it to OUT1 whenever OUT1 asks for its',
      '   product, with a shipping notice for every pallet.',
      '4. Once it is empty it is filling again.',
      '',
      '## Interlocks and safety',
      '- One product to a batch. A room started with its door open, or opened in the middle',
      '  of a cycle, is a fault; so is a door closed on a vehicle in the doorway.',
      '- X24 and X25 are the light curtains across the two doorways.',
      '',
      '## Field notes',
      '- A room has one door, so the last pallet in is the first out. Keep a table per room,',
      '  add with SFWRP and ship with POPP straight into the notice register.',
    ].join('\n'),
  },
  STORE: {
    name: 'STORE',
    title: 'Storage lanes',
    owns: ['M303', 'D530-D532', 'M500-M549', 'D300-D369', 'D720-D749', 'T20-T29', 'Z4-Z5'],
    maxRungs: 60,
    brief: [
      'The storage lanes: flow lanes that give back their oldest pallet, and drive-in lanes',
      'that give back their newest. Tomatoes and potatoes, products 3 and 4.',
      '',
      '## Sequence of operation',
      '1. When a dock wants a product, find the lowest code of it at any lane\'s out end, take',
      '   it off that lane\'s table into the notice, and order the lane to the dock. If that',
      '   lane is busy, wait for it.',
      '2. Collect every passed pallet of product 3 or 4 from QA into a lane that can take it',
      '   without burying anything: beside its own product first, an empty lane only when',
      '   nothing fits.',
      '',
      '## Field notes',
      '- A flow lane takes a pallet no older than the one at its back, a drive-in lane one no',
      '  newer than the one on top. Kept that way, the oldest lot is always at an out end.',
      '- Tables: F1 at D300, F2 at D310, L1 at D330, L2 at D340, L3 at D350, each K=5.',
    ].join('\n'),
  },
  SHIP: {
    name: 'SHIP',
    title: 'Outbound',
    owns: ['M304', 'D540-D542', 'Y1', 'Y6', 'D2', 'M550-M599', 'D750-D899', 'T30-T39', 'Z6'],
    maxRungs: 40,
    brief: [
      'Outbound, by the truckload. SHIP moves nothing itself: it says what each dock wants',
      'next, and the section that holds that product ships it.',
      '',
      '## Sequence of operation',
      '1. Take every order line as it arrives and push its product onto its dock\'s stack.',
      '2. Once a dock\'s whole order is on its stack, pop the next line into what that dock',
      '   wants, while nothing is on its way to that dock.',
      '3. When a section\'s order to the dock is accepted, set what the dock wants back to 0',
      '   and wait for the pallet to land.',
      '',
      '## Field notes',
      '- A trailer is loaded from the front, so its last stop goes on first. The lines arrive',
      '  in drop order, and a stack gives them back the other way round.',
      '- Two pallets on their way to one dock can arrive in either order. One at a time.',
    ].join('\n'),
  },
};

export interface HubSectionOptions {
  /** The sections this puzzle's plant has. FLEET is always added. */
  sections: readonly Exclude<HubSectionId, 'FLEET'>[];
  /** The ones the player writes. */
  open: readonly HubSectionId[];
  /** Programs for the sections this puzzle ships written, where they differ from the defaults. */
  programs?: Partial<Record<HubSectionId, Rung[]>>;
  /** Headroom for an open section, where it differs from the default. */
  maxRungs?: Partial<Record<HubSectionId, number>>;
  /** Briefs for the sections this puzzle describes differently, as the capstone does FLEET. */
  briefs?: Partial<Record<HubSectionId, string>>;
}

/** FLEET's brief where the player writes it: the job, not the policy it used to ship with. */
export const FLEET_OPEN_BRIEF = [
  'The dispatcher, and the charger with it. Every section asks for a vehicle through a',
  'request slot of its own, and FLEET decides who gets the next one.',
  '',
  '## The request slots',
  '- RECEIVE is slot 1, RIPEN 2, STORE 3, SHIP 4. SHIP moves nothing and never asks.',
  '- Slot k is the relay M30k, raised by its section, and FROM at D5k0, TO at D5k1 and the',
  '  shipping notice at D5k2. Slot 2 is M302, D520 to D522.',
  '- When the manager accepts a slot\'s order, turn the relay M31k on for exactly one scan:',
  '  the section drops its request on that scan.',
  '',
  '## The charger',
  '- A charge order is D0 = 0 and D1 = 70. The manager answers at once, and sends the',
  '  vehicle with the lowest battery as soon as its job is done.',
  '- X26 is on from then until that vehicle is full. One vehicle charges at a time.',
  '- D81 to D83: each vehicle\'s battery in percent. A full battery lasts about a',
  '  kilometer of driving, and a charge from empty takes 20 s.',
  '',
  '## Sequence of operation',
  '1. With nothing being asked, take the most downstream slot that is requesting: SHIP,',
  '   then STORE, then RIPEN, then RECEIVE. Copy its three registers into D0, D1 and D3',
  '   and ask on Y0.',
  '2. On the answer, pulse the slot\'s accepted relay and free the mailbox.',
  '3. Send a vehicle to charge before its battery runs out, and not much sooner.',
  '',
  '## Field notes',
  '- FLEET is scanned last, after every section has decided what it wants.',
  '- A rejected order means a section asked for something impossible. Stop dispatching.',
].join('\n');

export function hubSections(opts: HubSectionOptions): PouSlot[] {
  const open = new Set<HubSectionId>(opts.open);
  const ids = HUB_SECTION_IDS.filter((id) => id === 'FLEET' || opts.sections.includes(id));
  return ids.map((id): PouSlot => {
    const def = SECTIONS[id];
    const editable = open.has(id);
    const program = editable ? undefined : (opts.programs?.[id] ?? def.program);
    return {
      id,
      name: def.name,
      title: def.title,
      editable,
      ...(program ? { program } : {}),
      ...(editable ? { maxRungs: opts.maxRungs?.[id] ?? def.maxRungs } : {}),
      owns: [...def.owns],
      brief: opts.briefs?.[id] ?? def.brief,
    };
  });
}

/** One task, sections in flow order and FLEET last, so it sees what every section asked for this scan. */
export function hubTasks(sections: readonly Exclude<HubSectionId, 'FLEET'>[]): TaskDef[] {
  const order = HUB_SECTION_IDS.filter((id) => id === 'FLEET' || sections.includes(id));
  return [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: [...order] }];
}
