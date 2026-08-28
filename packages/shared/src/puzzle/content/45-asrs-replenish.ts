import type { PuzzleSpec } from '../types.js';
import { CODE_RANGE, CRANE_DEVICES, TARGET_REGISTERS, WMS_REGISTERS } from './41-asrs-drive.js';

export const asrsReplenish: PuzzleSpec = {
  kind: 'ladder',
  slug: 'asrs-replenish',
  title: 'Goods In',
  difficulty: 'hard',
  order: 45,
  category: 'warehouse',
  summary: 'Stock arrives while orders are going out, and the inbound conveyor will not wait.',
  briefing: [
    'Goods in is running again. Pallets arrive on the conveyor above line A, at position',
    '0 level 2, and they have to go into the rack. Line A is still calling for material',
    'at the same time, off the conveyor directly below.',
    '',
    'So the crane now has two different jobs, and they run in opposite directions. A',
    'retrieval collects from a slot and delivers to a station. A put-away collects from',
    'goods in and delivers to a slot. Same crane, same fork, same move block - the only',
    'thing that changes is where it picks up and where it puts down.',
    '',
    'The inbound conveyor holds two pallets. When a third arrives and there is no room,',
    'goods in stops, and a stopped goods in is a failed run exactly like a stopped line.',
    'Feeding the line is more urgent than putting stock away, but "more urgent" is not',
    '"instead of".',
    '',
    '## Equipment',
    '- X12 GOODS IN READY: a pallet is waiting on the inbound conveyor.',
    '- D12 GOODS IN CODE: what material it is.',
    '- The rack starts with two slots empty. As orders go out, more open up.',
    '- Y5 NO STOCK and Y6 PUT AWAY: light Y6 while the crane is working an inbound',
    '  pallet, so the shift leader can see which job is in hand.',
    '',
    '## Sequence of operation',
    '1. If line A is calling and the rack has what it wants, run a retrieval.',
    '2. Otherwise, if a pallet is waiting at goods in and the rack has a free slot, run',
    '   a put-away: collect from position 0 level 2, and deliver to the nearest empty',
    '   slot.',
    '3. If there is nothing to do, stand still.',
    '',
    '## Interlocks and safety',
    '- A slot holds one pallet. Pushing a second one in wrecks both.',
    '- Nothing goes back out onto the inbound conveyor. It only runs one way.',
    '- The line still only accepts what it asked for, and still only two at a time.',
    '',
    '## Field notes',
    '- An empty slot is a slot whose register reads zero, so the search you already have',
    '  will find one without changing a rung: run the same eight tests a second time',
    '  against K=0, into their own registers, and the nearest free slot falls out.',
    '- Line B is not on this shift, and both jobs start and finish at the aisle head, so',
    '  the nearest slot is simply the lowest bay again. The distance registers the two-line',
    '  job needed are not wanted here: work up the bays and take the first hit.',
    '- Whichever job is in hand, the crane collects somewhere and delivers somewhere. Write',
    '  the rung that sets the target - D52 and D53 - around those two ideas: which job it is',
    '  says which pair of places, and whether the fork is loaded says which of the pair you',
    '  are driving to now.',
    '- Put-aways are not free time. Every pallet you store now is a pallet that is there',
    '  to be picked later, and every one you leave on the conveyor is one closer to',
    '  stopping goods in.',
    '',
    '## Acceptance',
    '- Line A never stops.',
    '- Goods in never backs up.',
    '- Four pallets put away and four delivered, with nothing driven into an occupied',
    '  slot.',
  ].join('\n'),
  hints: [
    'Decide the job once, while the crane is still idle, and hold the decision for the ' +
      'whole cycle. M6 is that decision: reset it when line A is calling for something the ' +
      'order search found, and set it when the job in hand is a put-away instead - a pallet ' +
      'at goods in, a free slot found, and either no call at all or a call for something the ' +
      'rack has run out of. Latch it with SET and RST rather than reading X10 and X12 live, ' +
      'because both of those move while the crane is out in the aisle. Y6 is then just M6.',
    'The eight search rungs you already have run twice, unchanged in shape. Once against ' +
      'D10, writing the order slot into D50 and D51 and setting M2 - "the rack has what the ' +
      'line wants". Once against K=0, writing the free slot into D56 and D57 and setting M4 - ' +
      '"there is room for an inbound pallet", because an empty slot is just a slot whose ' +
      'register reads zero. Clear M2 and M4 on the same idle rung, so both searches see the ' +
      'table as it is now rather than as it was before the last transfer.',
    '"The target rung" is the one that writes D52 and D53 - where the crane is driving to. ' +
      'It is not the M0 rung, which only reports that it got there. Every cycle is collect ' +
      'somewhere, then deliver somewhere: M6 picks which pair of places this cycle uses, and ' +
      'M3 (carrying) picks which of the pair you are heading for right now. So the rung is ' +
      'four rows:\n\n' +
      'M6 off, M3 off - collect the order:   MOV D50 D52, MOV D51 D53\n' +
      'M6 off, M3 on  - deliver to line A:   MOV K0 D52, MOV K1 D53\n' +
      'M6 on, M3 off  - collect at goods in: MOV K0 D52, MOV K2 D53\n' +
      'M6 on, M3 on   - deliver to the slot: MOV D56 D52, MOV D57 D53\n\n' +
      'Each row starts with M1 in series with its own M6 and M3 contacts, so exactly one row ' +
      'conducts and only that row\'s MOVs write.',
    'If the crane sets off and then changes its mind halfway, the target rung is not gated ' +
      'on M1 and the searches are still revising D50 and D56 underneath it. If the fork comes ' +
      'back empty from goods in, the put-away collect row is driving level 1 - that is line ' +
      'A\'s handover conveyor; the inbound one is level 2. And if goods in backs up, the crane ' +
      'stood still with a pallet waiting upstairs: a line conveyor holds two pallets and can ' +
      'wait a cycle, an idle crane cannot give that time back.',
  ],
  devices: [
    { address: 'X4', label: 'Line A Running', io: 'input', widget: 'toggle' },
    { address: 'X10', label: 'Call A', io: 'input', widget: 'sensor' },
    { address: 'X12', label: 'Goods In Ready', io: 'input', widget: 'sensor' },
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
      address: 'D12',
      label: 'Goods In Code',
      io: 'input',
      widget: 'bar',
      signal: 'analog',
      range: CODE_RANGE,
      color: '#4ade80',
    },
    { address: 'Y5', label: 'No Stock', io: 'output', widget: 'lamp', color: '#f87171' },
    { address: 'Y6', label: 'Put Away', io: 'output', widget: 'lamp', color: '#4ade80' },
  ],
  registers: [
    { address: 'M0', label: 'At target', note: 'D0 matches D52 and D1 matches D53' },
    { address: 'M1', label: 'Cycle running', note: 'one job, start to finish' },
    { address: 'M2', label: 'Order slot found', note: 'the rack has what the line wants' },
    { address: 'M3', label: 'Carrying', note: 'latched off X3; picks the target' },
    { address: 'M4', label: 'Empty slot found', note: 'there is room for an inbound pallet' },
    { address: 'M6', label: 'Put-away cycle', note: 'held for the whole cycle; drives Y6' },
    { address: 'M11', label: 'Transfer done', note: 'the fork has been all the way out' },
    { address: 'D50', label: 'Order slot bay', note: 'where the order is picked from' },
    { address: 'D51', label: 'Order slot level', note: 'where the order is picked from' },
    { address: 'D56', label: 'Empty slot bay', note: 'where the inbound pallet goes' },
    { address: 'D57', label: 'Empty slot level', note: 'where the inbound pallet goes' },
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
  maxRungs: 45,
  processId: 'warehouse',
  scenarios: [
    {
      name: 'Orders out and stock in',
      steps: [
        {
          label: 'The line calls and a pallet is already waiting upstairs',
          setInputs: { X4: true },
          holdMs: 60000,
          until: { machine: { storedAway: 1 } },
          expectMachine: { jam: false, starved: false, blocked: false },
        },
        {
          // The two latches are the real assertion here: neglect the line and
          // `starved` catches it, neglect goods in and `blocked` does.
          label: 'Both jobs keep running without either backing up',
          holdMs: 220000,
          until: { machine: { deliveredA: 4 } },
          expectMachine: { jam: false, starved: false, blocked: false },
        },
      ],
    },
  ],
};
