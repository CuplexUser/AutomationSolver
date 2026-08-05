import type { PuzzleSpec } from '../types.js';
import { CODE_RANGE, CRANE_DEVICES, TARGET_REGISTERS, WMS_REGISTERS } from './41-asrs-put-away.js';

export const asrsRetrieval: PuzzleSpec = {
  kind: 'ladder',
  slug: 'asrs-retrieval',
  title: 'Order Picking',
  difficulty: 'hard',
  order: 42,
  category: 'warehouse',
  summary: 'A line calls for a material. Find which slot holds it, fetch it, and keep the line fed.',
  briefing: [
    'Production line A runs off a conveyor at the aisle head, and that conveyor holds',
    'two pallets. The line eats one every so often, and when there is room for another',
    'it calls for one. What it calls for is a material code, not a slot: where that',
    'material lives is your problem, not the line\'s.',
    '',
    'The rack does not keep one material per bay. Pallets were put away wherever there',
    'was room, so a material is usually in more than one slot and never in the same one',
    'twice running. The WMS publishes the whole table, one register per slot, and it is',
    'the only honest answer to "where is it".',
    '',
    '## Equipment',
    '- X4 LINE A RUNNING and X10 CALL A. The call is the permission to start a cycle,',
    '  not merely a suggestion: the conveyor holds two pallets and a third will not fit.',
    '- D10 LINE A DEMAND: the material code line A will accept next. It changes as soon',
    '  as a delivery is taken, so read it, do not remember it.',
    '- D101 to D104 hold the material in bays 1 to 4 at level 1, and D201 to D204 the',
    '  same bays at level 2. A zero means the slot is empty.',
    '- Y5 NO STOCK: light it when the line is calling for something the rack has not got.',
    '- The crane, the sensors and the fork are as they were on the last job.',
    '',
    '## Sequence of operation',
    '1. Wait for CALL A.',
    '2. Search the WMS table for a slot holding the material in D10, and take the',
    '   nearest one. Distance from line A is simply the bay number.',
    '3. Drive there, fork out and back to collect the pallet.',
    '4. Drive to position 0, level 1, fork out and back to hand it over.',
    '5. Go again when the line next calls.',
    '',
    '## Interlocks and safety',
    '- The line only accepts the material it is calling for. Hand it anything else and',
    '  the pallet has to be scrapped off the conveyor.',
    '- Two pallets is the whole conveyor. Delivering a third pushes one on the floor.',
    '- Everything the crane could break on the last job it can still break on this one.',
    '',
    '## Field notes',
    '- Reaching into a slot the table says is empty is not dangerous. It is just eight',
    '  seconds you do not get back, and on this machine seconds are what the line eats.',
    '- Working up the bays in order and taking the first match is enough here, because',
    '  bay order and distance order are the same thing when you are stood at position 0.',
    '  Do not get attached to it.',
    '- Once the rack has nothing left of what the line wants, there is no cycle to run.',
    '  Say so on the lamp and stand still.',
    '',
    '## Acceptance',
    '- Four deliveries, each the material that was asked for, none of them late enough',
    '  to stop the line.',
    '- Run long enough and the rack empties. When it does, the lamp comes on and the',
    '  crane stays where it is.',
  ].join('\n'),
  hints: [
    'Keep the search out of the cycle. While the crane is idle, clear a "found" relay ' +
      'and let eight rungs in bay order test their slot register against D10 - each one ' +
      'gated on the found relay being clear, so the first match wins and the rest stand ' +
      'down. Each match moves its own bay and level into D50 and D51 and sets the relay.',
    'Do not start on the call alone. Start on the call AND the found relay, so a cycle ' +
      'never begins for a material that is not in the rack. That same "calling but not ' +
      'found" pair is the no-stock lamp.',
    'The crane goes to two places per cycle, so latch a "carrying" relay off X3 and let ' +
      'one rung pick the target: not carrying means the slot in D50 and D51, carrying ' +
      'means position 0, level 1. Latch it rather than using X3 directly, or the moment ' +
      'the pallet is handed over the crane will set off back to the slot with the fork ' +
      'still out.',
    'End the cycle on "was carrying, fork has been out, fork is home again, and X3 has ' +
      'gone". Clear the found relay there too, so the next cycle searches the table as ' +
      'it is then, not as it was.',
  ],
  devices: [
    { address: 'X4', label: 'Line A Running', io: 'input', widget: 'toggle' },
    { address: 'X10', label: 'Call A', io: 'input', widget: 'sensor' },
    ...CRANE_DEVICES,
    {
      address: 'D10',
      label: 'Line A Demand',
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: CODE_RANGE,
      color: '#fbbf24',
    },
    { address: 'Y5', label: 'No Stock', io: 'output', widget: 'lamp', color: '#f87171' },
  ],
  registers: [
    { address: 'M0', label: 'At target', note: 'D0 matches D52 and D1 matches D53' },
    { address: 'M1', label: 'Cycle running', note: 'one retrieval, start to finish' },
    { address: 'M2', label: 'Slot found', note: 'the search hit something' },
    { address: 'M3', label: 'Carrying', note: 'latched off X3; picks the target' },
    { address: 'M11', label: 'Transfer done', note: 'the fork has been all the way out' },
    { address: 'D50', label: 'Chosen bay', note: 'what the search picked' },
    { address: 'D51', label: 'Chosen level', note: 'what the search picked' },
    ...TARGET_REGISTERS,
    ...WMS_REGISTERS,
  ],
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'compare',
    'mov',
    'math',
    'hwire',
    'coil-out',
    'coil-set',
    'coil-reset',
  ],
  maxRungs: 30,
  processId: 'warehouse',
  scenarios: [
    {
      name: 'Four orders from line A',
      steps: [
        {
          label: 'Start the line; the first pallet it asks for is brass, in bay 1',
          setInputs: { X4: true },
          holdMs: 40000,
          until: { machine: { deliveredA: 1 } },
          expectMachine: { jam: false, starved: false },
        },
        {
          label: 'It keeps up as the nearest slot moves down the aisle',
          holdMs: 120000,
          until: { machine: { deliveredA: 4 } },
          expectMachine: { jam: false, starved: false },
        },
      ],
    },
    {
      name: 'The rack runs dry',
      steps: [
        {
          label: 'Let it run until every last pallet has been picked',
          setInputs: { X4: true },
          holdMs: 220000,
          until: { machine: { deliveredA: 8 } },
          expectMachine: { jam: false, starved: false },
        },
        {
          label: 'Now there is nothing left to fetch, so the lamp comes on',
          holdMs: 20000,
          until: { bits: { Y5: true } },
          expect: { Y5: true },
          expectMachine: { jam: false, carrying: false },
        },
      ],
    },
  ],
};
