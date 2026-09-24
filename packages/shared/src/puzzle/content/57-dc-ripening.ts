import type { PuzzleSpec } from '../types.js';
import {
  DC_ASN,
  DC_CALL_OUT1,
  DC_INBOUND_1,
  DC_INBOUND_2,
  DC_MAILBOX,
  DC_QA,
  DC_QA_CODE,
  DC_ROOMS,
} from './dc-plant.js';
import { HUB_GLOBALS, hubSections, hubTasks } from './dc-sections.js';

const SECTIONS = ['RECEIVE', 'RIPEN'] as const;

/**
 * The first puzzle written in sections, and the ripening rooms.
 *
 * Two lessons that belong together. The rooms are the plant's processing step
 * with a clock of its own (fill, shut, gas, open) and a door that must never
 * close on a vehicle or open on a batch. And a room with one door is a stack,
 * which is where POPP earns its place: every pallet leaves newest first and
 * each needs its own shipping notice.
 *
 * The program is now three sections sharing one fleet: RECEIVE and FLEET ship
 * written, RIPEN is the player's, and the request slot is the only thing it
 * needs to know about either of them.
 */
export const dcRipening: PuzzleSpec = {
  kind: 'ladder',
  slug: 'dc-ripening',
  title: 'Cold Chain Hub: Ripening Rooms',
  difficulty: 'hard',
  order: 57,
  category: 'distribution',
  summary: 'Fill, shut, gas and empty two ripening rooms, one product to a batch, newest pallet out first.',
  briefing: [
    'Bananas and avocados come off the truck green, and nobody buys a green banana. They',
    'go from QA into one of two ripening rooms, a batch at a time: fill the room, shut',
    'the door, run the gas cycle, open it again and ship.',
    '',
    'The hub\'s program is in sections now. RECEIVE brings pallets in and checks them,',
    'FLEET talks to the vehicles for everybody, and RIPEN, the rooms, is yours.',
    '',
    '## Sections and tasks',
    '- RECEIVE, RIPEN and FLEET, all in one task, every scan, in that order.',
    '- RIPEN owns Y2 to Y5, M302, D520 to D522, M450 to M499, D650 to D719, T10 to T19,',
    '  and Z2 and Z3. Writing outside that block is a validation error.',
    '- RIPEN asks FLEET for a vehicle through slot 2: put FROM in D520 and TO in D521,',
    '  the shipping notice in D522, and raise M302. FLEET turns M312 on for one scan when',
    '  the order is accepted. Drop M302 on that scan.',
    '',
    '## Equipment',
    '- QA (10): X5, X6, X7 and D5 as before. RECEIVE brings every pallet to QA and takes',
    '  the failures away. A pallet that passes, product 1 or 2, is yours to collect.',
    '- R1 and R2, locations 21 and 22, each four pallets deep with one door.',
    '- Y2 and Y3 open the doors while on and close them while off. X15 and X16 say fully',
    '  open, X22 and X23 fully shut. X24 and X25 are light curtains across the doorways.',
    '- Y4 and Y5 start a room\'s gas cycle on their rising edge. It takes 20 s, and X17 or',
    '  X20 comes on when that room\'s batch is ripe.',
    '- D21 and D22: how many pallets are in each room.',
    '- OUT1 (61) and D13 OUT1 CALLING FOR, as before. It calls for bananas (1) and',
    '  avocados (2), and every pallet shipped needs a shipping notice.',
    '- Two vehicles.',
    '',
    '## Sequence of operation',
    '1. Collect every passed green pallet from QA into a room that is filling, whose door',
    '   is open, which has room, and which is empty or already holds that product. Add its',
    '   code to that room\'s table.',
    '2. Shut a room when it is full, or when it has pallets and nothing has gone in for',
    '   30 s. Keep the door open until the doorway is clear, and start the cycle once it',
    '   is shut.',
    '3. When the batch is ripe, open the door, and ship from the room whenever OUT1 calls',
    '   for its product: the notice is the code on top of the room\'s table.',
    '4. An empty room is filling again.',
    '',
    '## Interlocks and safety',
    '- One product to a batch, and nothing leaves a room green.',
    '- Starting a room with its door open, opening it mid-cycle and closing it on a vehicle',
    '  are all faults.',
    '',
    '## Field notes',
    '- A room has one door. The last pallet in is the first one out, so its table is a',
    '  stack: SFWRP adds a code, and POPP takes the newest one off, straight into D522.',
    '  R1\'s table at D700, R2\'s at D710, each K5.',
    '- A state number per room (filling, closing, ripening, ripe) turns the cycle into a',
    '  handful of compares, and the door command into three of them in parallel.',
    '- Book a room while a vehicle is on its way to or from it, and release it when the',
    '  room\'s count changes, as you did for the lanes. The timer that closes a part-full',
    '  room should only run while nothing is on its way in.',
  ].join('\n'),
  hints: [
    'Work out two relays per room every scan: "this room can take the pallet on QA" and "this ' +
      'room can ship what OUT1 is calling for". Then the requests are short: a pending pallet ' +
      'on QA and a room that can take it, and slot 2 is free.',
    'The take: set a QA booking, set the room\'s booking, copy its count, K10 into D520, the ' +
      'room\'s code into D521, SFWRP D5 into the room\'s table, and raise M302. The ship: set a ' +
      'call booking, the room booking and the count copy, the room into D520, K61 into D521, ' +
      'POPP the room\'s table into D522, and raise M302.',
    'The cycle, as four rows on a state register D671: 0 to 1 when the room is full or its ' +
      'timer has run; 1 to 2 when X22 and X24 are on, driving Y4 on the same row; 2 to 3 on ' +
      'X17; and 3 to 0 when the table is empty and nothing is on its way.',
    'If a room is closed on a vehicle, the door rung is dropping Y2 as soon as the state goes ' +
      'to 1: keep it on through state 1 until the doorway curtain is clear.',
  ],
  devices: [
    ...DC_MAILBOX,
    ...DC_INBOUND_1,
    ...DC_INBOUND_2,
    ...DC_QA,
    ...DC_QA_CODE,
    ...DC_ROOMS,
    ...DC_CALL_OUT1,
    ...DC_ASN,
  ],
  registers: [
    { address: 'D700', label: 'R1 table', note: 'count, then codes bottom to top: a stack' },
    { address: 'D710', label: 'R2 table', note: 'count, then codes bottom to top: a stack' },
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
  pous: hubSections({ sections: SECTIONS, open: ['RIPEN'] }),
  tasks: hubTasks(SECTIONS),
  taskAssignment: 'fixed',
  symbols: 'optional',
  globals: HUB_GLOBALS,
  plantConfig: {
    locs: '1,2,10,11,21,22,61',
    fleet: 2,
    asn: true,
    // A truckload of bananas first, then the avocados: a room fills with one product.
    in1: '101P,102P,104P,105P',
    in2: '201P,202P',
    inFirst: 2000,
    inEvery: 15_000,
    in2First: 100_000,
    calls61: '1,1,2,1,2,1',
  },
  scenarios: [
    {
      name: 'A day\'s bananas and avocados',
      steps: [
        {
          label: 'The first batch is gassed and the first ripe pallet goes out',
          holdMs: 240_000,
          until: { machine: { shipped: 1 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
        {
          label: 'Every call is filled from the rooms, each pallet under its own notice',
          holdMs: 225_000,
          until: { machine: { shipped: 6 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
      ],
    },
  ],
};
