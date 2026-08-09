import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_GLOBALS, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * Final assembly and the dock: the last two sections, and the first puzzle in
 * this category that opens two of them at once.
 *
 * They go together because they are the same lesson from opposite ends. The jig
 * is where the line's mix finally has to be right, and the dock is where a
 * decision has to be taken ten seconds before anybody can see whether it was the
 * right one. Between them they hold both of the plant's remaining levers:
 *
 * - **The bench beside the jig.** Hanging cylinders and hoses on a boom needs a
 *   boom and nothing else, so it can run during the engine drop. A program that
 *   runs it in its turn is correct and gives away 1.6 s of every machine.
 * - **The lorry sent for early.** Ten seconds to arrive, and a yard that fills
 *   stops the line all the way back to the weld fixture. Calling at three
 *   machines rather than at six means the truck is standing on the dock with
 *   spaces still free behind it.
 *
 * Measured over a shift, assembly is worth six machines and the test bay two,
 * which makes this the largest lever left after the weld bay. Both scenarios
 * that carry a `parMs` are calibrated against it.
 *
 * The correctness half is the interlock chain, and it is graded by the plant
 * rather than by an assertion: an engine into an empty jig, a cab before the
 * engine, a boom pinned with no cylinders on it, a machine dragged off the test
 * pad with the rig still under pressure. Every one of those is a jam, and every
 * scenario here asserts there is not one.
 */
export const factoryAssembly: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-assembly',
  title: 'Excavator Line: Assembly and Dispatch',
  difficulty: 'hard',
  order: 52,
  category: 'factory',
  summary:
    'Marry a frame to a boom, test the machine and get it on a lorry. Two sections, an interlocked build, and a haulier who takes ten seconds to arrive.',
  briefing: [
    'The far end of the line, and the two sections that turn parts back into machines. The jig',
    'takes a painted frame off one lane and a painted boom off the other and builds an',
    'excavator out of them. The test bay pumps it up, works every function and drives it into',
    'the yard, and the yard is emptied by a haulier who has to be sent for.',
    '',
    'Both sections are yours. They are one puzzle because they are one problem: everything',
    'here is about doing a thing before you are asked for it. The bench can run during the',
    'engine drop. The lorry can be on its way while there is still room in the yard. Neither',
    'is wrong done late, and both are cheaper done early.',
    '',
    '## Sections and tasks',
    '- SEC4_ASSEMBLY and SEC5_TEST are both yours. The other five are read only.',
    '- All seven run from one task, MAIN, every scan. The spine is scanned last, after the six',
    '  stations have decided what they want.',
    '- SEC4_ASSEMBLY owns Y17 to Y23, M100 to M129, T40 to T49, C40 to C49 and D50 to D59.',
    '- SEC5_TEST owns Y24 to Y27, M130 to M159, T50 to T59, C50 to C59 and D60 to D69.',
    '- A section writing outside its own block is a validation error, even though both of them',
    '  are yours today.',
    '',
    '## Equipment',
    '- Y17 CALL FRAME and Y18 CALL BOOM lift a part off its painted lane into the jig. X23',
    '  FRAME READY and X24 BOOM READY say there is one to take. D10 and D11 are the colors at',
    '  the head of each lane, and D16 and D17 are the colors of what is in the jig.',
    '- Y19 LOWER ENGINE takes 2.0 s, Y20 FIT CAB 1.7 s, Y22 PIN BOOM 2.3 s.',
    '- Y21 MAKE UP BOOM runs the bench beside the jig for 1.6 s. X25 BOOM MADE UP says it is',
    '  done.',
    '- X26 MACHINE COMPLETE. Y23 RELEASE TO TEST rolls it onto Z10, and X27 TEST BAY CLEAR is',
    '  that zone.',
    '- Y24 HYDRAULIC PUMP, and the pack takes 1.6 s to come up. Y25 FUNCTION TEST runs 3.6 s',
    '  and X29 TEST PASSED reports it. Y26 DISPATCH takes 1.8 s.',
    '- Y27 CALL TRUCK. D12 MACHINES IN YARD counts the yard, which holds six, and X30 YARD',
    '  SPACE says there is room. X31 TRUCK AT DOCK says the lorry is standing there.',
    '',
    '## Sequence of operation',
    '1. Call a frame in off the frame lane and hold the call up until D16 says it is in the',
    '   jig. A lane the sort is loading into is a lane that is moving, and the jig cannot lift',
    '   a part off a moving lane, so a call that lasts one scan will sooner or later miss.',
    '2. Call a boom whose color matches the frame already in the jig, and hold that call up',
    '   the same way.',
    '3. Lower the engine, then fit the cab, then pin the boom.',
    '4. Run the bench on the boom at any point after there is a boom to run it on.',
    '5. Release to test on Y23 once X26 makes and Z10 is running and clear.',
    '6. Pump up, run the function cycle, drop the pump, dispatch.',
    '7. Raise Y27 to send for a lorry. Hold it up while the lorry loads and drop it to send',
    '   the lorry away.',
    '',
    '## Interlocks and safety',
    '- No engine without a frame in the jig. No cab before the engine is in. No pin before the',
    '  cab, and never onto a boom the bench has not made up.',
    '- A boom in one color pinned to a frame in another is a jam. Nothing at this end of the',
    '  line can put that right: the mistake was made in the store, minutes earlier.',
    '- A jig left holding half a machine it cannot finish latches starved after 16 s.',
    '- The function test may not run before the hydraulics are up.',
    '- The bay couples through a quick release, and a quick release dragged off the pad under',
    '  pressure comes away with the hose in it. Drop the pump before you dispatch.',
    '',
    '## Field notes',
    '- The make-up bench is beside the jig, not in front of it. It needs a boom and nothing',
    '  else, so it can run at the same time as the engine drop, the cab, or nothing at all. A',
    '  program that runs it in its turn is correct and gives away 1.6 s of every machine.',
    '- Starting a build on a frame alone is a gamble against the starve latch, and the line',
    '  hands over turn about, which is what makes the gamble a good one. Hedge it by refusing',
    '  a boom whose color does not match the frame you are already holding.',
    '- A lorry takes ten seconds to arrive, will not sit on the dock past fifteen, and the',
    '  dock will not take another for a rotation after one leaves. Send for it when the yard',
    '  is full and the yard is full for the whole of that ten seconds, which stops the test',
    '  bay, which stops the jig, and the line goes down from the far end.',
    '- Step timers do not reset themselves. Re-latching a cycle in the rung above the timers',
    '  hands the next machine three finished steps, and the jig pins a boom onto an empty',
    '  fixture.',
    '',
    '## Acceptance',
    '- Machines are built engine, cab, boom, in that order, out of a frame and a boom of the',
    '  same color, and driven off the pad with the pump dropped.',
    '- Nothing is jammed, blocked or starved, and nothing is scrapped.',
    '- The yard is emptied by lorries that were sent for in time, so the line never has to',
    '  stand and wait for one.',
  ].join('\n'),
  hints: [
    'Write the build as a step chain, one latch per step, with every step rung above every ' +
      'coil rung. The step that says the frame is in the jig is a compare of D16 against K0, ' +
      'not a contact on X23: X23 says there is a frame on the lane, not that you have it.',
    'The call coils have to stand up until the part is actually in. Seal them on the same ' +
      'latch that says you have it, so the call is dropped by the arrival rather than by a ' +
      'timer.',
    'The bench is not a step. Drive Y21 from "there is a boom in the jig and it is not made ' +
      'up yet", with nothing about the engine or the cab in the rung, and it will run itself ' +
      'during the engine drop for free.',
    'Reset every step timer explicitly when the machine is released. Re-setting the cycle ' +
      'latch above the timer rungs is not enough: the timers never see it low, so the next ' +
      'machine inherits three finished steps.',
    'The truck rung is a compare, not a contact. X30 goes off when the yard is already full, ' +
      'which is ten seconds too late. Compare D12 against a smaller number and the lorry is ' +
      'standing on the dock before the yard is.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'M100', label: 'Build in progress', note: 'suggested; assembly owns M100 to M129' },
    { address: 'T40', label: 'Step timer', note: 'assembly owns T40 to T49; reset them explicitly' },
    { address: 'M130', label: 'Truck called', note: 'suggested; the test bay owns M130 to M159' },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  pous: lineSections({ open: ['ASSY', 'TEST'] }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  symbols: 'optional',
  globals: LINE_GLOBALS,
  scenarios: [
    {
      name: 'The first machine is built and driven off',
      description: 'Frame, engine, cab, boom, pin, test, dispatch. Every step on the one before it.',
      steps: [
        {
          label: 'Auto and start, and the first painted frame reaches the jig',
          setInputs: { X3: true, X0: true },
          holdMs: 40_000,
          until: { analog: { D16: { min: 1 } } },
          expect: { Y0: true },
          expectMachine: { jam: false },
        },
        {
          label: 'The engine goes in, the cab follows and the boom is pinned',
          setInputs: { X0: false },
          holdMs: 30_000,
          until: { bits: { X26: true } },
          expectMachine: { jam: false, starved: false },
        },
        {
          label: 'It is released, pumped up, worked through its functions and driven into the yard',
          holdMs: 30_000,
          until: { machine: { shipped: 1 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 32.9 s for the canonical pair. A jig that waits for both parts before it
      // starts, and runs the bench in its turn, takes 37.1 s to the same point.
      parMs: 34_400,
    },
    {
      name: 'The bench beside the jig',
      description:
        'Six machines. The bench needs a boom and nothing else, and every second it waits for the cab is a second off the line.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Six excavators are married up, tested and dispatched',
          setInputs: { X0: false },
          holdMs: 200_000,
          until: { machine: { shipped: 6 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 69.2 s for the canonical pair against 81.0 s for a build run strictly
      // in the order it is written down. Nearly two seconds a machine, and all
      // of it is the bench standing idle behind a cab it never needed.
      parMs: 72_300,
    },
    {
      name: 'A yard that is nearly full',
      description:
        'Four machines already parked and the haulier not sent for. The lorry takes ten seconds however early you ask.',
      // Counters only, per the `initialMachine` contract. The yard is the one
      // buffer on this plant that a program can see filling and can do
      // something about ten seconds ahead of the moment it matters, which is
      // why it is the dock's whole lesson.
      initialMachine: { yard: 4 },
      steps: [
        {
          label: 'Auto and start, with four machines already standing in the yard',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Four more are built and dispatched, and the line never stands waiting for a lorry',
          setInputs: { X0: false },
          holdMs: 200_000,
          until: { machine: { shipped: 4 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 54.7 s for the canonical pair. Sending for the lorry only once the yard
      // is full costs 5.7 s of that on its own, with the jig and the bench left
      // exactly as they were, which is what makes this scenario the dock's.
      parMs: 57_100,
    },
  ],
};
