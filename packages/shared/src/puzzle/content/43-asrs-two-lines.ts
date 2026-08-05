import type { PuzzleSpec } from '../types.js';
import { CODE_RANGE, CRANE_DEVICES, TARGET_REGISTERS, WMS_REGISTERS } from './41-asrs-put-away.js';

export const asrsTwoLines: PuzzleSpec = {
  kind: 'ladder',
  slug: 'asrs-two-lines',
  title: 'Two Lines, One Crane',
  difficulty: 'hard',
  order: 43,
  category: 'warehouse',
  summary: 'Line B opens at the far end of the aisle. Now the nearest slot depends on who asked.',
  briefing: [
    'Line B has been commissioned at the far end of the aisle, position 5. It calls for',
    'material exactly the way line A does, off its own conveyor, on its own clock, and',
    'it does not care that there is only one crane.',
    '',
    'Two things change, and the second one is the job.',
    '',
    'The first is that a cycle now belongs to a line. Which station the pallet goes to,',
    'and which demand register says what to fetch, are decided the moment you commit',
    'and must not change until the pallet has been handed over. A call can drop while',
    'you are still in the aisle, because the line got what it asked for from the pallet',
    'already on its conveyor.',
    '',
    'The second is that the nearest slot is no longer the lowest bay. Standing at line',
    'A, bay 1 is one move away and bay 4 is four. Standing at line B it is the other way',
    'round. The same material, asked for by the other line, is in a different slot.',
    '',
    '## Equipment',
    '- X5 LINE B RUNNING and X11 CALL B, matching line A\'s pair.',
    '- D11 LINE B DEMAND: what line B will accept next.',
    '- Line A hands over at position 0 level 1. Line B hands over at position 5 level 1.',
    '- Y5 NO STOCK: a calling line wants something the rack has not got.',
    '- Everything else is as it was.',
    '',
    '## Sequence of operation',
    '1. When a line calls, decide which line this cycle is for, and hold that decision.',
    '2. Work out how far each bay is from that line\'s station.',
    '3. Search the WMS table for the material that line wants, and take the slot with',
    '   the shortest distance.',
    '4. Fetch it and hand it over at that line\'s station.',
    '',
    '## Interlocks and safety',
    '- Each line only accepts the material it is calling for. They are not the same.',
    '- Neither conveyor holds more than two pallets.',
    '- A line whose conveyor runs empty stops, and a stopped line is a failed run. It is',
    '  not enough to serve both eventually.',
    '',
    '## Field notes',
    '- Distance from line A is the bay number. Distance from line B is 5 minus the bay',
    '  number. Four registers hold those distances and one rung can load whichever set',
    '  applies, which is cheaper than writing the search out twice.',
    '- With the distances to hand, the search stops depending on the order the rungs are',
    '  in: keep the best distance found so far in a register, start it above anything',
    '  reachable, and let each slot replace it only if it beats it.',
    '- There is enough crane to keep both lines fed, but not much to spare. Time spent',
    '  driving to a slot that was not the closest one is time the other line is waiting.',
    '',
    '## Acceptance',
    '- Four deliveries to each line, each the material that was asked for.',
    '- Neither line ever stops.',
  ].join('\n'),
  hints: [
    'Decide the line while the crane is idle and latch it: one relay, reset when line A ' +
      'is calling and set when line B is calling and A is not. Everything downstream - ' +
      'which demand register, which distances, which station - reads that one relay.',
    'Load the distances from it in a single rung of two rows. Serving A moves K=1 to K=4 ' +
      'into D61 to D64; serving B moves K=4 down to K=1 into the same four registers. ' +
      'Copy the demand the same way, from D10 or D11 into one register the search reads.',
    'Clear a "best so far" register to something bigger than the aisle, say K=99, on the ' +
      'same rung that clears the found relay. Then each of the eight slot rungs is: this ' +
      'slot holds what we want, AND its bay distance is less than the best so far - move ' +
      'the bay, the level and that distance in, and set found.',
    'If a line stops, look at what the crane was doing when the other one was served ' +
      'twice in a row. Serving whoever is calling is fine; going somewhere further away ' +
      'than you had to is what costs the run.',
  ],
  devices: [
    { address: 'X4', label: 'Line A Running', io: 'input', widget: 'toggle' },
    { address: 'X5', label: 'Line B Running', io: 'input', widget: 'toggle' },
    { address: 'X10', label: 'Call A', io: 'input', widget: 'sensor' },
    { address: 'X11', label: 'Call B', io: 'input', widget: 'sensor' },
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
    {
      address: 'D11',
      label: 'Line B Demand',
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: CODE_RANGE,
      color: '#fb923c',
    },
    { address: 'Y5', label: 'No Stock', io: 'output', widget: 'lamp', color: '#f87171' },
  ],
  registers: [
    { address: 'M0', label: 'At target', note: 'D0 matches D52 and D1 matches D53' },
    { address: 'M1', label: 'Cycle running', note: 'one retrieval, start to finish' },
    { address: 'M2', label: 'Slot found', note: 'the search hit something' },
    { address: 'M3', label: 'Carrying', note: 'latched off X3; picks the target' },
    { address: 'M5', label: 'Serving line B', note: 'held for the whole cycle' },
    { address: 'M11', label: 'Transfer done', note: 'the fork has been all the way out' },
    { address: 'D50', label: 'Chosen bay', note: 'what the search picked' },
    { address: 'D51', label: 'Chosen level', note: 'what the search picked' },
    ...TARGET_REGISTERS,
    { address: 'D61', label: 'Distance to bay 1', note: 'from the station being served' },
    { address: 'D62', label: 'Distance to bay 2', note: 'from the station being served' },
    { address: 'D63', label: 'Distance to bay 3', note: 'from the station being served' },
    { address: 'D64', label: 'Distance to bay 4', note: 'from the station being served' },
    { address: 'D65', label: 'Best distance so far', note: 'start it at K=99' },
    { address: 'D70', label: 'Material wanted', note: 'copied from D10 or D11' },
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
  maxRungs: 40,
  processId: 'warehouse',
  scenarios: [
    {
      name: 'Both lines, four pallets each',
      steps: [
        {
          label: 'Both lines start; the crane serves whoever is calling',
          setInputs: { X4: true, X5: true },
          holdMs: 90000,
          // Line B is the one a lazy arbiter leaves behind, so it is the one
          // the milestone waits on. That neither line ever stopped is the
          // `starved` latch's job, not a counter's.
          until: { machine: { deliveredB: 2 } },
          expectMachine: { jam: false, starved: false },
        },
        {
          label: 'And keeps both fed while the stock it wants moves down the rack',
          holdMs: 160000,
          until: { machine: { deliveredB: 4 } },
          expectMachine: { jam: false, starved: false },
        },
      ],
    },
    {
      // Eight slots against two lines and no goods in: the rack is emptied on
      // purpose here, so a program that starts a cycle on the call alone runs
      // out of table to search and fetches whatever its registers were last
      // left holding. `starved` is not asserted past this point - with nothing
      // left in the rack the lines are going to stop, and that is the warehouse
      // being empty rather than the program being wrong.
      name: 'Both lines outrun the rack',
      steps: [
        {
          label: 'Keep going until there is nothing left of what a line is asking for',
          setInputs: { X4: true, X5: true },
          holdMs: 300000,
          until: { bits: { Y5: true } },
          expect: { Y5: true },
          expectMachine: { jam: false },
        },
        {
          label: 'And the crane stands still rather than fetching the wrong thing',
          holdMs: 12000,
          expectMachine: { jam: false, carrying: false },
        },
      ],
    },
  ],
};
