import type { PuzzleSpec } from '../types.js';
import {
  DC_ASN,
  DC_CHARGER,
  DC_DRIVE_IN_LANES,
  DC_FLOW_LANES,
  DC_INBOUND_1,
  DC_INBOUND_2,
  DC_MAILBOX,
  DC_QA,
  DC_QA_CODE,
  DC_ROOMS,
  DC_TRUCKS,
} from './dc-plant.js';
import { FLEET_OPEN_BRIEF, HUB_GLOBALS, hubSections, hubTasks, ripenProgram, storeProgram } from './dc-sections.js';

const SECTIONS = ['RECEIVE', 'RIPEN', 'STORE', 'SHIP'] as const;

/** Where SHIP publishes what each dock wants next, and where RIPEN and STORE read it. */
const WANTS = [
  { code: 61 as const, call: 'D751' },
  { code: 62 as const, call: 'D752' },
];

/** The stock already in the lanes at the start of the shift, and the stocktake that names it. */
const STOCK = {
  c31: '301pn0,302pn0',
  c32: '303pn0',
  c41: '406pn0,404pn0',
  c42: '405pn0,403pn0',
  stocktake: 'D300:31,D310:32,D330:41,D340:42,D350:43',
};

/**
 * The capstone: the whole hub, three vehicles, trucks instead of calls, and a
 * charger.
 *
 * Every earlier section ships written, and they are the answers to the earlier
 * puzzles, except that RIPEN and STORE now serve SHIP's requests instead of the
 * plant's calls. The player writes the two ends: SHIP, which turns a truck's
 * order into a stack and publishes it last line first, and FLEET, the dispatcher
 * they have been using since 57, which now also decides when a vehicle charges.
 * `parMs` is the canonical answer's time: a program that keeps the shipped
 * dispatcher with a charge rung that fires too early passes and visibly scores
 * less; one that fires too late runs a vehicle flat.
 */
export const dcHub: PuzzleSpec = {
  kind: 'ladder',
  slug: 'dc-hub',
  title: 'Cold Chain Hub: The Whole Hub',
  difficulty: 'hard',
  order: 59,
  category: 'distribution',
  summary: 'Trucks loaded last stop first, three vehicles to keep charged, and every section of the hub at once.',
  briefing: [
    'The whole hub, running a shift. Green bananas come in to be ripened, tomatoes and',
    'potatoes wait in the lanes, and the outbound docks no longer call for one pallet at a',
    'time: a truck backs up with an order for its whole route, and it leaves when it is',
    'loaded or when its slot runs out. Three vehicles, and they run on batteries.',
    '',
    'RECEIVE, RIPEN and STORE are written, and they are what you wrote for the earlier',
    'jobs. You have the two ends: SHIP, which turns each truck\'s order into what the docks',
    'want next, and FLEET, the dispatcher, which is yours to change for the first time.',
    '',
    '## Sections and tasks',
    '- RECEIVE, RIPEN, STORE, SHIP and FLEET, in that order, every scan.',
    '- SHIP owns Y6, M304, D540 to D542, M550 to M599, D750 to D899, T30 to T39 and Z6.',
    '- FLEET owns Y0, D0, D1, D3, M311 to M314, M399, D590 to D599 and Z7.',
    '- RIPEN ships to OUT1 whenever D751 names a product it has ripe. STORE ships to OUT1',
    '  for D751 and to OUT2 for D752. Each asks FLEET through its own slot.',
    '',
    '## Equipment',
    '- X13 and X14: a truck is at OUT1, at OUT2. D15 and D16: how many lines its order has,',
    '  0 with no truck there. D61 and D62: how many pallets are on it already.',
    '- The order line feed: X21 is on while a line is waiting, D8 is its dock (61 or 62)',
    '  and D9 its product. Turn Y6 on to take it, and the next line appears once Y6 has',
    '  been off again. A truck\'s lines are fed the moment it docks, in the order it will',
    '  drop them on its route.',
    '- The charger, location 70. X26 CHARGER IN USE, and D81 to D83 each vehicle\'s battery',
    '  in percent.',
    '- Three vehicles, and every pallet shipped carries its shipping notice as before.',
    '',
    '## Sequence of operation',
    '1. SHIP: push every order line onto its dock\'s stack, OUT1\'s at D760 and OUT2\'s at',
    '   D770, each K=7.',
    '2. SHIP: once a dock\'s whole order is on its stack, pop the next line into D751 or',
    '   D752, one pallet on its way to each dock at a time.',
    '3. SHIP: when RIPEN or STORE has an order to that dock accepted, set its register back',
    '   to 0, and wait for the dock\'s count to go up.',
    '4. FLEET: dispatch every section\'s requests as before, and send vehicles to charge',
    '   before they run flat.',
    '',
    '## Interlocks and safety',
    '- A trailer is loaded from the front, so the last stop\'s pallet goes on first. A pallet',
    '  out of that sequence is a fault, and so is a truck not loaded 150 s after docking.',
    '- A vehicle that runs its battery flat on the loop stops the hub.',
    '',
    '## Field notes',
    '- Two pallets on the loop to the same dock can arrive in either order. That is why a',
    '  dock has one on its way at a time, released when its count changes.',
    '- A section\'s order is accepted on its slot\'s pulse: RIPEN\'s M312 with D521 at 61,',
    '  STORE\'s M313 with D531 at 61 or 62.',
    '- FLEET\'s choosing rungs are the place for a charge: one more choice, ahead of the',
    '  slots, posted as D0 = 0 and D1 = 70. Only while X26 is off.',
    '- Every charge takes a vehicle off the floor for the drive to the charger and the',
    '  charge itself, and a charge always fills the battery. Topping up early costs more',
    '  than it saves. Leave it too late and the vehicle cannot finish its job and still',
    '  reach the charger. A battery lasts about a kilometer, the loop is 56 m, and a vehicle',
    '  is usually halfway round it when you decide.',
    '',
    '## Acceptance',
    '- Every truck leaves loaded, in sequence, in its slot, and no vehicle runs flat.',
    '- Scored on time as well: the hub\'s best program finishes each shift in about three',
    '  minutes.',
  ].join('\n'),
  hints: [
    'SHIP, the lines: one rung on X21 and not Y6, that computes Z6 as (D8 - 61) x 10, ' +
      'pushes D9 with SFWRP into D760Z6 with K=7, and turns Y6 on. Y6 then drops for a scan ' +
      'by itself, which is what lets the next line through.',
    'SHIP, the requests: a relay per dock, set once its stack count equals D15 (or D16) ' +
      'and reset when the stack is empty. While it is set, nothing is on its way and D751 is ' +
      '0, POPP the stack into D751.',
    'SHIP, the claims: on M312 with D521 = 61, or M313 with D531 = 61, move K0 into D751, ' +
      'set a "on its way" relay and copy D61. Reset the relay once D61 no longer equals the ' +
      'copy. The same for OUT2 with M313, D531 = 62 and D62.',
    'FLEET: start from the dispatcher you were given. A charge is one more choice, first: ' +
      'K9 into D590 when D590 is 0, X26 is off and any of D81 to D83 is low, three compares ' +
      'in parallel. The post rung then needs a second row for K9: K0 into D0 and K70 into D1.',
    'How low is low: every percent is 10 m of driving. A vehicle has to finish the job it is ' +
      'on and drive to the charger, which can be two whole laps. Any sooner than that and the ' +
      'hub spends vehicles on charging it did not need yet.',
  ],
  devices: [
    ...DC_MAILBOX,
    ...DC_INBOUND_1,
    ...DC_INBOUND_2,
    ...DC_QA,
    ...DC_QA_CODE,
    ...DC_ROOMS,
    ...DC_FLOW_LANES.slice(0, 2),
    ...DC_DRIVE_IN_LANES,
    ...DC_TRUCKS,
    ...DC_CHARGER,
    ...DC_ASN,
  ],
  registers: [
    { address: 'D751', label: 'OUT1 wants', note: 'the product SHIP asks for next, 0 once taken' },
    { address: 'D752', label: 'OUT2 wants', note: 'the product SHIP asks for next, 0 once taken' },
    { address: 'D760', label: 'OUT1 order stack', note: 'count, then lines in drop order' },
    { address: 'D770', label: 'OUT2 order stack', note: 'count, then lines in drop order' },
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'contact-rising',
    'contact-falling',
    'compare',
    'mov',
    'math',
    'timer',
    'sfwr',
    'sfrd',
    'pop',
    'hwire',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  indexRegisters: true,
  processId: 'distribution',
  pous: hubSections({
    sections: SECTIONS,
    open: ['SHIP', 'FLEET'],
    programs: {
      RIPEN: ripenProgram('D751'),
      STORE: storeProgram({ lanes: [31, 32, 41, 42, 43], docks: WANTS }),
    },
    maxRungs: { FLEET: 16, SHIP: 30 },
    briefs: { FLEET: FLEET_OPEN_BRIEF },
  }),
  tasks: hubTasks(SECTIONS),
  taskAssignment: 'fixed',
  symbols: 'optional',
  globals: HUB_GLOBALS,
  plantConfig: {
    locs: '1,2,10,11,21,22,31,32,41,42,43,61,62,70',
    fleet: 3,
    asn: true,
    battery: true,
    v0Batt: 250,
    v1Batt: 180,
    v2Batt: 300,
    ...STOCK,
    in1: '101P,102P,103P,104P',
    inFirst: 2000,
    inEvery: 5000,
    in2: '304P,407P,305P',
    in2First: 70_000,
    in2Every: 25_000,
    trucks61: '334;3113',
    trucks62: '4434',
  },
  scenarios: [
    {
      name: 'A shift at the hub',
      parMs: 189_500,
      steps: [
        {
          label: 'The first truck at each dock is loaded last stop first and leaves',
          holdMs: 160_000,
          until: { machine: { trucksOut: 2 } },
          expectMachine: { jam: false, stalled: false, blocked: false, late: false, flat: false },
        },
        {
          label: 'The bananas ripen and go out on the second truck at OUT1',
          holdMs: 150_000,
          until: { machine: { trucksOut: 3 } },
          expectMachine: { jam: false, stalled: false, blocked: false, late: false, flat: false },
        },
      ],
    },
    {
      name: 'Different orders',
      parMs: 191_500,
      initialMachine: {
        c31: '302pn0',
        c32: '301pn0,303pn0',
        c41: '404pn0',
        c42: '406pn0,405pn0',
        c43: '403pn0',
        v0Batt: 200,
        v1Batt: 300,
        v2Batt: 160,
        trucks61: '4343;113',
        trucks62: '344',
      },
      steps: [
        {
          label: 'Both docks load their first truck in reverse, from both kinds of lane',
          holdMs: 160_000,
          until: { machine: { trucksOut: 2 } },
          expectMachine: { jam: false, stalled: false, blocked: false, late: false, flat: false },
        },
        {
          label: 'Ripe bananas and a tomato fill the last truck',
          holdMs: 150_000,
          until: { machine: { trucksOut: 3 } },
          expectMachine: { jam: false, stalled: false, blocked: false, late: false, flat: false },
        },
      ],
    },
  ],
};
