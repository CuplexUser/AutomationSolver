import type { LadderProgram } from '../../ladder/types.js';
import type { PuzzleSpec } from '../types.js';
import {
  DC_INBOUND_1,
  DC_MAILBOX,
  DC_QA,
  mov,
  nc,
  no,
  out,
  rise,
  rst,
  rung,
  set,
} from './dc-plant.js';

/**
 * The hub commissioned: every pallet from the dock through QA, and on to the
 * truck or into quarantine.
 *
 * Six rungs, and the shape every later puzzle in the category grows from: an
 * order is *chosen* (a pending relay, one at a time), *posted* (the two MOVs and
 * the request), and *booked* on the manager's answer. The bookings are the
 * lesson. The plant only reports what is true (a pallet is on QA), and the
 * program has to remember what it has promised (a pallet is on its way there).
 */
export const DC_DISPATCH_DEMO: LadderProgram = {
  rungs: [
    // Collect from QA first: it frees the check for the next pallet.
    rung('dc-pick-qa', [[no('X6'), nc('M1'), nc('M10'), nc('M11'), set('M11')]]),
    // Take the next pallet in, but only if QA is not already promised to one.
    rung('dc-take-in', [[no('X3'), nc('M0'), nc('M10'), nc('M11'), set('M10')]]),
    // The order the pending relay stands for.
    rung('dc-order', [
      [no('M10'), mov('K1', 'D0'), mov('K10', 'D1')],
      [no('M11'), no('X7'), mov('K10', 'D0'), mov('K61', 'D1')],
      [no('M11'), nc('X7'), mov('K10', 'D0'), mov('K11', 'D1')],
    ]),
    // Ask until the manager answers.
    rung('dc-request', [[no('M10'), nc('X0'), out('Y0')], [no('M11')]], [{ row: 0, col: 1 }]),
    // Answered: book what was promised, and let the next order be chosen.
    rung('dc-booked', [
      [rise('X0'), no('M10'), set('M0'), rst('M10')],
      [rise('X0'), no('M11'), set('M1'), rst('M0'), rst('M11')],
    ]),
    // The pickup is done once QA is empty again.
    rung('dc-cleared', [[nc('X5'), rst('M1')]]),
  ],
};

export const dcDispatch: PuzzleSpec = {
  kind: 'ladder',
  slug: 'dc-dispatch',
  title: 'Cold Chain Hub: Fleet Commissioning',
  difficulty: 'tutorial',
  order: 54,
  category: 'distribution',
  summary: 'Order a forklift you never drive: every pallet from the dock through QA and out.',
  briefing: [
    'The Cold Chain Hub takes fresh produce off trucks, checks it, stores it and ships it,',
    'and nothing in it is carried by hand. A fleet of automated forklifts runs a one-way loop',
    'round the building, and the fleet manager that drives them takes orders from this PLC.',
    'You never turn a wheel. You say where a pallet is and where it should go, and a vehicle',
    'goes and does it.',
    '',
    'Today the hub is being commissioned with one vehicle and the shortest route through',
    'it: every pallet that comes off the truck at IN1 is checked at QA, then loaded on the',
    'outbound truck at OUT1 if it passed, or put in quarantine if it did not.',
    '',
    '## Equipment',
    '- Locations are numbered, and the number is how an order names them: IN1 is 1, QA is',
    '  10, QUARANTINE is 11 and OUT1 is 61.',
    '- X3 IN1 PALLET WAITING: at least one pallet is standing on the inbound dock.',
    '- X5 QA OCCUPIED: a pallet is on the QA table. X6 QA DONE: its check has finished.',
    '  X7 QA PASS: it passed, which only means something once X6 is on.',
    '- One vehicle. It drives the loop clockwise, and after a job it stays where it is',
    '  until the next one, or until another vehicle needs that spot.',
    '',
    '## The fleet manager',
    '- An order is two numbers and a request: the location to collect from in D0 ORDER',
    '  FROM, the location to deliver to in D1 ORDER TO, then Y0 ORDER REQUEST on.',
    '- The manager answers with X0 ORDER ACCEPTED when it has given the job to a vehicle,',
    '  or X1 ORDER REJECTED if the order makes no sense. It holds the answer until you drop',
    '  the request, and it reads D0 and D1 at the moment it accepts.',
    '- If every vehicle is busy it does not answer at all yet. Keep asking. X2 VEHICLE FREE',
    '  shows whether one is idle.',
    '- One order at a time goes through the mailbox. Drop the request once it is accepted,',
    '  and only then set up the next.',
    '',
    '## Sequence of operation',
    '1. When QA is done with a pallet, send it on: QA to OUT1 if it passed, QA to',
    '   QUARANTINE if it did not.',
    '2. Otherwise, when a pallet is waiting at IN1 and QA is free, send it from IN1 to QA.',
    '3. Post one order at a time and wait for the answer before choosing the next.',
    '',
    '## Interlocks and safety',
    '- A vehicle sent to collect from a place with nothing in it is a fault. So is a',
    '  second pallet arriving at QA while the first is still on the table: the vehicle',
    '  stands there holding it, and after 20 s the whole loop is stalled.',
    '- Nothing goes anywhere but QA before it has been checked, and a pallet that failed',
    '  goes to quarantine and nowhere else.',
    '',
    '## Field notes',
    '- The plant tells you what is true, not what you have promised. X5 only comes on when',
    '  a pallet lands on QA, and the vehicle carrying it may be 20 m away when you post the',
    '  order. Book QA yourself at the moment the order is accepted, in a relay of your own,',
    '  and free it again when you send the pallet on.',
    '- The same goes the other way: X6 stays on until a vehicle has actually lifted the',
    '  pallet off QA. Book the pickup too, or you will send a second vehicle for it.',
    '- A pending relay per kind of order, set only while nothing else is pending, makes',
    '  "one at a time" a rule the ladder cannot break. The rising edge of X0 is the moment',
    '  to turn a pending order into a booking.',
    '- MOV only writes while its row conducts, so three rows loading D0 and D1 from three',
    '  different relays is how you select an order, not a double coil.',
    '',
    '## Acceptance',
    '- Every pallet that passes QA ends up on the truck, and every one that fails ends up',
    '  in quarantine.',
    '- No vehicle is ever sent for a pallet that is not there, and the loop never stalls.',
    '- With nothing on the dock, nothing is ordered.',
  ].join('\n'),
  hints: [
    'Start with the order itself: one rung whose rows load D0 and D1. A relay M10 that ' +
      'means "take IN1 to QA" moves K1 into D0 and K10 into D1; a relay M11 that means ' +
      '"collect from QA" moves K10 into D0 and K61 or K11 into D1, depending on X7.',
    'Y0 is on while M10 or M11 is pending and X0 has not answered yet: M10 and M11 in ' +
      'parallel, then an NC contact on X0, into Y0. Once the answer comes, clear the ' +
      'pending relay and the request drops by itself.',
    'Bookings: on the rising edge of X0, a pending M10 becomes SET M0 "QA is promised". A ' +
      'pending M11 becomes SET M1 "pickup is promised" and RST M0. Reset M1 once X5 goes ' +
      'off. Then only choose M10 while M0 is off, and M11 while M1 is off.',
    'If a vehicle stands at QA holding a pallet until the loop stalls, a second pallet was ' +
      'sent there before the first left: M0 is missing from the IN1 rung. If one is sent to ' +
      'QA and finds nothing, the pickup was ordered twice: M1 is missing from the QA rung.',
  ],
  devices: [...DC_MAILBOX, ...DC_INBOUND_1, ...DC_QA],
  registers: [
    { address: 'M0', label: 'QA booked', note: 'a pallet is on QA or on its way there' },
    { address: 'M1', label: 'Pickup booked', note: 'a vehicle is on its way to collect from QA' },
    { address: 'M10', label: 'Order pending: IN1 to QA' },
    { address: 'M11', label: 'Order pending: collect from QA' },
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'contact-rising',
    'mov',
    'hwire',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 12,
  processId: 'distribution',
  plantConfig: {
    locs: '1,10,11,61',
    fleet: 1,
    in1: '301P,302P,403F,304P,305P,406P',
    inFirst: 1500,
    inEvery: 20_000,
  },
  demo: {
    scenario: 'Three good pallets',
    caption: 'Watch one vehicle take three pallets through QA and onto the truck.',
    program: DC_DISPATCH_DEMO,
  },
  scenarios: [
    {
      name: 'Three good pallets',
      initialMachine: { in1: '301P,302P,303P', inEvery: 8000 },
      steps: [
        {
          label: 'The first pallet is checked and loaded on the truck',
          holdMs: 90_000,
          until: { machine: { shipped: 1 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
        {
          label: 'The other two follow it, one at a time through QA',
          holdMs: 150_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, stalled: false, blocked: false, quarantined: 0 },
        },
        {
          label: 'With the dock empty, nothing more is ordered',
          holdMs: 5000,
          expect: { Y0: false },
          expectMachine: { jam: false, stalled: false },
        },
      ],
    },
    {
      name: 'A pallet fails its check',
      initialMachine: { in1: '301P,402F,303P', inEvery: 8000 },
      steps: [
        {
          label: 'The failed pallet goes to quarantine, and the good ones to the truck',
          holdMs: 180_000,
          until: { machine: { shipped: 2, quarantined: 1 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
      ],
    },
    {
      name: 'An empty dock',
      initialMachine: { in1: '' },
      steps: [
        {
          label: 'Nothing has arrived, so no vehicle is sent anywhere',
          holdMs: 8000,
          expect: { Y0: false },
          expectMachine: { jam: false },
        },
      ],
    },
  ],
};
