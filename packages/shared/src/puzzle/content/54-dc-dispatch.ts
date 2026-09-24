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
    'The Cold Chain Hub moves pallets with driverless forklifts, and you never drive one.',
    'Your PLC posts transport orders ("collect here, deliver there") to a fleet manager,',
    'and the manager sends a forklift to do the job. Today there is one forklift and one',
    'route: a pallet comes off the truck at IN1, is checked at QA, then goes to the',
    'outbound truck at OUT1 if it passed, or to QUARANTINE if it failed.',
    '',
    'Your program does three things, over and over: choose the next order, post it to the',
    'manager, and remember what it has ordered. Watch the demonstration first, then build',
    'it one step of the sequence below at a time.',
    '',
    '## Equipment',
    '- Every place has a number, and an order names places by number: IN1 is 1, QA is 10,',
    '  QUARANTINE is 11, OUT1 is 61.',
    '- X3 IN1 PALLET WAITING: a pallet is on the inbound dock.',
    '- X5 QA OCCUPIED: a pallet is standing on the QA table.',
    '- X6 QA DONE: the check has finished. It stays on until a forklift lifts the pallet.',
    '- X7 QA PASS: the pallet passed. Read it while X6 is on.',
    '- X1 ORDER REJECTED and X2 VEHICLE FREE are not needed today.',
    '',
    '## Posting an order',
    '1. Move the place to collect from into D0 and the place to deliver to into D1.',
    '2. Turn Y0 ORDER REQUEST on.',
    '3. Wait for X0 ORDER ACCEPTED. If the forklift is busy the answer takes a while, so',
    '   keep Y0 on until it comes.',
    '4. Turn Y0 off. The forklift does the rest on its own, and X0 goes off again.',
    '',
    '## Your relays',
    '- M10 and M11 say which order is being posted right now. Only one may be on at a time.',
    '  M10: bring a pallet from IN1 to QA. M11: take the pallet on QA out.',
    '- M0 and M1 are bookings: they remember what you have already ordered, because the',
    '  sensors only show what is there right now. M0: QA is taken, a pallet is on it or on',
    '  its way. M1: a forklift is already coming to collect from QA.',
    '',
    '## Sequence of operation',
    '1. Choose an order, only while M10 and M11 are both off:',
    '   a. X6 on and M1 off: SET M11 (take the checked pallet out).',
    '   b. X3 on and M0 off: SET M10 (bring the next pallet in).',
    '2. Post it: while M10 is on, D0 = K1 and D1 = K10. While M11 is on, D0 = K10 and',
    '   D1 = K61 if X7 is on or K11 if it is off. Y0 is on while M10 or M11 is on and X0',
    '   is off.',
    '3. On the rising edge of X0, book the order and clear it:',
    '   a. M10 accepted: SET M0, RST M10.',
    '   b. M11 accepted: SET M1, RST M0 (QA is free for the next pallet), RST M11.',
    '4. When X5 goes off, the pallet has been lifted: RST M1.',
    '',
    '## Why the bookings',
    '- Without M0: after the IN1 order is accepted, the pallet spends a while on the',
    '  forklift. X5 is off, QA looks empty, and a second pallet is sent to it.',
    '- Without M1: after the pickup is accepted, X6 stays on until the forklift arrives, so',
    '  the same pickup is ordered again and a forklift finds nothing there.',
    '- Both of these are faults, and so is a pallet going anywhere but QA before its check.',
    '',
    '## Field notes',
    '- MOV only writes while its row conducts, so three rows loading D0 and D1 from M10 and',
    '  M11 is how you choose an order, not a double coil.',
    '- Watch the demonstration with the Working Registers list in view: M10, M11, M0 and',
    '  M1 light up as the forklift works.',
    '',
    '## Acceptance',
    '- Every pallet that passes QA ends up on the truck, and every one that fails ends up',
    '  in quarantine.',
    '- With nothing on the dock, nothing is ordered.',
  ].join('\n'),
  hints: [
    'Six rungs, in the order of the Sequence of operation: two that choose an order (SET ' +
      'M11 or M10), one that loads D0 and D1, one that drives Y0, one that books the order ' +
      'when X0 comes on, and one that clears M1. The next hints give each rung exactly.',
    'Rung 1: NO X6, NC M1, NC M10, NC M11, SET M11.',
    'Rung 2: NO X3, NC M0, NC M10, NC M11, SET M10.',
    'Rung 3, three rows. Row 1: NO M10, MOV K1 D0, MOV K10 D1. Row 2: NO M11, NO X7, ' +
      'MOV K10 D0, MOV K61 D1. Row 3: NO M11, NC X7, MOV K10 D0, MOV K11 D1.',
    'Rung 4: NO M10 with NO M11 in parallel below it, then NC X0, OUT Y0. X0 must be ' +
      'normally closed: Y0 asks while there is no answer yet, and drops the moment X0 comes on. ' +
      'With NO X0, Y0 waits for an answer to a question it never asks.',
    'Rung 5, two rows. Row 1: rising X0, NO M10, SET M0, RST M10. Row 2: rising X0, ' +
      'NO M11, then three outputs: SET M1, RST M0, RST M11. Without RST M0, QA stays booked ' +
      'after the first pallet and no second one is ever brought in.',
    'Rung 6: NC X5, RST M1. Normally closed: the pickup is done when QA is empty, so X5 is off.',
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
    caption: 'Watch one forklift take three pallets through QA and onto the truck, with M10, M11, M0 and M1 lighting up in Working Registers.',
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
