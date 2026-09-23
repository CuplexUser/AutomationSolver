import type { PuzzleSpec } from '../types.js';
import {
  DC_ASN,
  DC_CALL_OUT1,
  DC_CALL_OUT2,
  DC_DRIVE_IN_LANES,
  DC_FLOW_LANES,
  DC_INBOUND_1,
  DC_INBOUND_2,
  DC_MAILBOX,
  DC_QA,
  DC_QA_CODE,
} from './dc-plant.js';
import { HUB_GLOBALS, hubSections, hubTasks } from './dc-sections.js';

const SECTIONS = ['RECEIVE', 'STORE'] as const;

/**
 * Smart storage: FIFO lanes and LIFO lanes side by side, and a rule for each.
 *
 * The puzzle the category is named for. Two suppliers deliver the same product
 * with their lots out of step, so "put it in the next free lane" buries old
 * stock behind new, and the oldest lot can no longer leave first. The rule
 * that fixes it is one line per lane kind: a flow lane only takes a lot no
 * older than the one at its back, a drive-in lane only one no newer than the
 * one on top. Kept that way, every lane is ordered, and first expired first out
 * is a search for the lowest code among the lane ends.
 */
export const dcDriveIn: PuzzleSpec = {
  kind: 'ladder',
  slug: 'dc-drive-in',
  title: 'Cold Chain Hub: Smart Storage',
  difficulty: 'hard',
  order: 58,
  category: 'distribution',
  summary: 'Flow lanes and drive-in lanes, two suppliers out of step, two docks calling: store so the oldest can always leave first.',
  briefing: [
    'The hub stores tomatoes and potatoes, and ships them to two trucks at once. Storage',
    'is two kinds of rack: two flow lanes that give back their oldest pallet, and three',
    'drive-in lanes, dense blocks of rack a vehicle drives into, which give back their',
    'newest. Both hold four pallets.',
    '',
    'Potatoes come from two farms, and the second one\'s lots are older than the first',
    'one\'s even though they arrive later. Put a pallet in the wrong lane and an older lot',
    'ends up behind a newer one, where it cannot leave first. STORE is yours: where every',
    'pallet goes, and which one leaves when a truck calls.',
    '',
    '## Sections and tasks',
    '- RECEIVE, STORE and FLEET, in that order, every scan. RECEIVE and FLEET are written.',
    '- STORE owns M303, D530 to D532, M500 to M549, D300 to D369, D720 to D749, T20 to T29,',
    '  and Z4 and Z5. It asks FLEET through slot 3: FROM in D530, TO in D531, the notice',
    '  in D532, raise M303, and drop it on the scan M313 comes on.',
    '',
    '## Equipment',
    '- QA (10), with X5, X6, X7 and D5. Every pallet that passes QA is yours to collect;',
    '  RECEIVE quarantines the failures.',
    '- F1 and F2 (31, 32): flow lanes, loaded at the back and picked from the front. D31',
    '  and D32 are how many pallets are physically in them.',
    '- L1, L2 and L3 (41, 42, 43): drive-in lanes, one face, the last pallet in is the',
    '  first out. D41 to D43 are their counts.',
    '- OUT1 (61) and OUT2 (62). D13 and D14 are what each is calling for, and every',
    '  pallet shipped needs a shipping notice. Tomatoes are product 3, potatoes 4.',
    '- Two vehicles.',
    '',
    '## Sequence of operation',
    '1. When a dock calls for a product, find the oldest lot of it that can leave, take its',
    '   code off its lane\'s table into D532, and order the lane to that dock.',
    '2. When a passed pallet is on QA, store it in a lane that can take it without burying',
    '   anything: next to its own product first, and in an empty lane only when nothing fits.',
    '',
    '## Interlocks and safety',
    '- Setting a pallet in front of an older lot, or of another product, in a drive-in lane',
    '  buries it, and that is a fault the moment it happens.',
    '- A lot may not leave while an older lot of the same product is anywhere in storage.',
    '- A wrong shipping notice, or a product the dock did not call for, is a fault.',
    '',
    '## Field notes',
    '- The rule that keeps everything shippable is one line per kind. A flow lane takes a',
    '  pallet if it is empty, or if its last pallet is the same product with a lot no newer',
    '  than this one. A drive-in lane takes it if it is empty, or if its top pallet is the',
    '  same product with a lot no older than this one.',
    '- Kept that way, every lane is in order, so the oldest lot of a product is always at',
    '  the end of some lane where it can leave: the front of a flow lane, the top of a',
    '  drive-in lane. Shipping is then a search for the lowest code among the lane ends.',
    '- If the lowest code is in a lane that is busy, wait for it. Shipping the second',
    '  lowest instead breaks the rule the search was for.',
    '- A code is product x 100 + lot, so "product 4" is every code from 400 to 499. Two',
    '  compares, and no division, test a lane end against a product.',
    '- A flow lane has two faces: a vehicle loading its back does not stop another picking',
    '  its front. A drive-in lane has one. A lane\'s count going up means a pallet arrived,',
    '  going down means one left: enough to release the booking on the right face.',
    '- Tables: F1 at D300, F2 at D310, L1 at D330, L2 at D340, L3 at D350, each K5.',
  ].join('\n'),
  hints: [
    'Start with the ends of every lane, each scan. A flow lane\'s front is D301 (for F1); ' +
      'its back is the table indexed by its own count: MOV D300 Z4, then D300Z4. A ' +
      'drive-in lane\'s top is the same index expression on its table, and it is both ends.',
    'Can this lane take the pallet on QA: fewer than four, not being loaded already, and ' +
      'either empty or (for a flow lane) back between the product x 100 and D5, or (for a ' +
      'drive-in lane) top between D5 and product x 100 + 99.',
    'Shipping per dock: MOV K9999 into a best register, then one rung per lane that keeps ' +
      'the lowest lane end in the called product\'s range, and the lane it came from. Ship ' +
      'only if that lane can send now. Flow lanes are read with SFRDP, drive-in lanes with ' +
      'POPP, both into D532.',
    'If a vehicle finds a drive-in lane holding the wrong pallet for its notice, something ' +
      'was loaded into that lane while a pick from it was on its way: one move at a time in ' +
      'a lane with one face.',
  ],
  devices: [
    ...DC_MAILBOX,
    ...DC_INBOUND_1,
    ...DC_INBOUND_2,
    ...DC_QA,
    ...DC_QA_CODE,
    ...DC_FLOW_LANES.slice(0, 2),
    ...DC_DRIVE_IN_LANES,
    ...DC_CALL_OUT1,
    ...DC_CALL_OUT2,
    ...DC_ASN,
  ],
  registers: [
    { address: 'D300', label: 'F1 table', note: 'count, then front to back' },
    { address: 'D310', label: 'F2 table', note: 'count, then front to back' },
    { address: 'D330', label: 'L1 table', note: 'count, then bottom to top' },
    { address: 'D340', label: 'L2 table', note: 'count, then bottom to top' },
    { address: 'D350', label: 'L3 table', note: 'count, then bottom to top' },
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
  pous: hubSections({ sections: SECTIONS, open: ['STORE'], maxRungs: { STORE: 72 } }),
  tasks: hubTasks(SECTIONS),
  taskAssignment: 'fixed',
  symbols: 'optional',
  globals: HUB_GLOBALS,
  plantConfig: {
    locs: '1,2,10,11,31,32,41,42,43,61,62',
    fleet: 2,
    asn: true,
    in1: '301P,410P,302P,411P,303P,408P',
    in2: '405P,304P,406P',
    inFirst: 2000,
    inEvery: 28_000,
    calls61: '3,3,3,3',
    calls62: '4,4,4,4,4',
  },
  scenarios: [
    {
      name: 'Two farms, two trucks',
      steps: [
        {
          label: 'Stock goes into the lanes without burying anything, and the first calls are filled',
          holdMs: 240_000,
          until: { machine: { shipped: 4 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
        {
          label: 'Every call filled, oldest lot first, from both kinds of lane',
          holdMs: 240_000,
          until: { machine: { shipped: 9 } },
          expectMachine: { jam: false, stalled: false, blocked: false },
        },
      ],
    },
  ],
};
