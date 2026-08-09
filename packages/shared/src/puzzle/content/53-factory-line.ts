import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_GLOBALS, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_SECTION_IDS, LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * The capstone: the whole plant, already running, and a shift to make it earn
 * more.
 *
 * Every other puzzle in this category hands the player one empty section and
 * five working neighbors. This one hands over all seven, **seeded with the plain
 * programs**, which is the opposite arrangement and the point of it. There is
 * nothing to commission here. The line works, it never faults, and it ships
 * twenty three machines a shift where the same plant will do thirty seven, and
 * the whole of the difference is spread across seven programs somebody else
 * wrote in an afternoon.
 *
 * So the question stops being "can you write a section" and becomes the one the
 * category has been building toward: **which station is holding the line up?**
 *
 * ## What the plant actually charges for
 *
 * Measured rather than guessed, and it is worth stating plainly because the
 * answer is not symmetric. From the all-plain seed, only the weld bay has a
 * lever at all: fixing it alone takes the shift from 23 machines to 30, and
 * fixing any other single section is worth nothing until it is fixed. Once it
 * is, assembly is worth six machines, the paint shop two and the test bay two,
 * and the store and the conveyor are worth nothing in either order. See
 * FACTORY-LINE-DESIGN.md §5a for why, and for the one plant change that would
 * give the spine a lever.
 *
 * That shape is deliberately not hidden. A capstone whose briefing lists six
 * equal improvements would be teaching that a line is a sum of its stations,
 * which is the belief this whole category exists to take away. The briefing
 * points at D19 and the queue instead, and lets the player find the constraint
 * where a real one is found, which is by watching it.
 *
 * ## Grading
 *
 * One axis, and it is the same one the rest of the game uses: `parMs`, time to
 * ship a fixed number of machines. That is the same question as output in a
 * fixed window and needed no new machinery. The plain seed passes every
 * scenario, because it is a plant that works and the player was handed it
 * working; it simply scores badly, which is the category's stated bargain.
 */
export const factoryLineCapstone: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-line',
  title: 'Excavator Line: The Whole Plant',
  difficulty: 'hard',
  order: 53,
  category: 'factory',
  summary:
    'Seven programs, all of them yours, all of them already working. The line runs. Now find out which station is holding it up and make it earn its floor space.',
  briefing: [
    'The excavator line is commissioned and running. Seven programs drive it, every one of',
    'them written, tested and signed off, and not one of them faults. Blanks go into the weld',
    'fixture at one end and lorries leave the dock at the other, and the plant has been doing',
    'that all week.',
    '',
    'It is also doing it about a third slower than the same steel and the same motors are',
    'capable of, and every second of that is inside a program. Nothing here needs commissioning.',
    'Every section needs reading.',
    '',
    '## Sections and tasks',
    '- All seven sections are yours, and all seven ship with the program that is running the',
    '  plant today. Change as much or as little of them as you like.',
    '- All seven run from one task, MAIN, every scan, in the order the tree shows. The six',
    '  stations decide what they want and SEC6_CONVEYOR then moves everything, which is why',
    '  the spine is scanned last.',
    '- Each section still owns only its own block of devices, exactly as it did when they were',
    '  written by six different people. A section reaching into its neighbor is a validation',
    '  error, today as much as any other day.',
    '',
    '## The plant',
    '- SEC1_WELD, the fixture and the positioner. Two kinds of blank, one torch, a consumable',
    '  tip, and everything downstream depends on what comes out of here in what order.',
    '- SEC2_STORE, four gravity lanes and the portal robot over the aisle.',
    '- SEC3_PAINT, the spray booth and the cure oven. The only analog work on the line.',
    '- SEC4_ASSEMBLY, the jig and the make-up bench.',
    '- SEC5_TEST, the test bay, the yard and the haulier.',
    '- SEC6_CONVEYOR, twelve zones of accumulating spine and one diverter.',
    '- SUPERVISOR, the run latch every section reads.',
    '',
    '## Sequence of operation',
    '1. Watch the plant run before you change anything. It works. The panel is live and every',
    '   number on it is real.',
    '2. Find the station that is setting the pace. D19 BLOCKED AT ZONE names the zone at the',
    '   head of the queue on the spine, which is the station holding the line up, and D18',
    '   PARTS ON SPINE says how much is standing about waiting for it.',
    '3. Fix that station. Then look again, because it will be a different one.',
    '4. Keep the line running while you do it. A plant that ships faster and jams on the third',
    '   machine has not been improved.',
    '',
    '## Interlocks and safety',
    '- Every interlock the six station puzzles taught still applies, and the plant still',
    '  enforces all of them. Nothing here is relaxed because the program came pre-written.',
    '- A frame married to a boom of another color is still a jam. A jig holding half a machine',
    '  for sixteen seconds is still a starve. A part sprayed in the wrong color is still scrap.',
    '',
    '## Field notes',
    '- A station standing idle is not the constraint. A station that is never idle is. The',
    '  spray booth is worth watching in particular: it is blocked more often than it is',
    '  starved, and those two want opposite fixes.',
    '- Saved seconds have to have somewhere to go. Speeding up a station that is already',
    '  waiting on the one in front of it changes nothing at all, which is why the order these',
    '  are fixed in matters more than how many of them are fixed.',
    '- Not every section has something to give. Two of them have been measured at exactly',
    '  nothing on a balanced line, and finding out which two is part of the job.',
    '- The weld bay is the first machine on the line and the only one with no buffer in front',
    '  of it. Whatever else is true, nothing downstream can run on parts the fixture has not',
    '  made yet.',
    '',
    '## Acceptance',
    '- The line ships machines, continuously, with nothing jammed, blocked, starved or',
    '  scrapped, from a cold start and from a yard that is already full.',
    '- It ships them faster than the plant you were handed. Every scenario here is timed',
    '  against the same line run properly, and the programs as they stand are a long way',
    '  outside par on all three.',
  ].join('\n'),
  hints: [
    'Do not start writing. Start the plant and watch D19 for a minute. It names the zone at ' +
      'the head of the queue, and the station on the end of that zone is the one costing you ' +
      'machines. Every other number on the panel is a symptom of it.',
    'The weld fixture gates its cycle on X10, which is the store infeed three zones and a ' +
      'loader stroke away. What the fixture actually needs before it clamps the next blank ' +
      'is its own jaws free. Its own outfeed eye says the part has gone, and says it a second ' +
      'and a half sooner.',
    'A boom is a stick and takes one arc pass. The fixture gives every part two passes and a ' +
      'roll over between them, which is 1.75 s spent on half of everything the plant makes, ' +
      'at the one machine on the line with nothing buffering it.',
    'The make-up bench needs a boom and nothing else, so it can run during the engine drop. ' +
      'The film target belongs to the part, not to the booth, and paint sprayed on is paint ' +
      'baked off the clock later. The lorry takes ten seconds to arrive whether you send for ' +
      'it at three machines in the yard or at six.',
    'Two of the seven sections cannot be made to pay on this plant, however they are ' +
      'written. The rack is not the buffer the line leans on, the spine is, and a plain ' +
      'spine only blocks stations that had slack anyway. Time spent there is time not spent ' +
      'on the fixture.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'D18', label: 'Parts on spine', note: 'read only, a gauge for the whole line' },
    {
      address: 'D19',
      label: 'Blocked at zone',
      note: 'read only; names the station holding the line up, 0 while the spine is flowing',
    },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  // Every section open, every section seeded with the program that is running
  // the plant today. `PouSlot.program` on an editable slot is what makes that
  // possible: the interesting question is not "can you write a line" but "here
  // is one that works, now make it earn more", and the answer to that begins by
  // reading code somebody else left you.
  pous: lineSections({ open: [...LINE_SECTION_IDS], seedPlain: true }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  // Every section is seeded, so every section arrives with its declarations
  // already made: the whole plant is handed over written in names, which is the
  // form the capstone is meant to be read in before it is improved.
  symbols: 'optional',
  globals: LINE_GLOBALS,
  scenarios: [
    {
      name: 'A cold start',
      description: 'An empty plant, and the first machine out of the door.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'The first excavator is welded, stored, painted, married up, tested and driven off',
          setInputs: { X0: false },
          holdMs: 120_000,
          until: { machine: { shipped: 1 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 32.9 s for the plant run properly, 41.2 s as it was handed over. On one
      // machine almost all of that gap is the weld fixture, which is the only
      // station with nothing buffering it.
      parMs: 34_400,
    },
    {
      name: 'A shift',
      description:
        'Twelve machines, back to back. This is the scenario the plant is actually judged on.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Twelve excavators are built and dispatched with nothing standing idle for long',
          setInputs: { X0: false },
          holdMs: 300_000,
          until: { machine: { shipped: 12 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 112.7 s for the plant run properly against 170.3 s as handed over, which
      // is past the taper entirely and scores nothing. Fixing the weld bay alone
      // takes it to 135.5 s, which is most of the way to half marks and is where
      // most players will find themselves after the first hour.
      parMs: 117_700,
    },
    {
      name: 'The morning after a full yard',
      description:
        'Six machines still parked, the rack backed up and two finished machines standing on the outfeed run. The line has to dig itself out.',
      // Counters and buffers only, per the `initialMachine` contract. This is
      // the state the plant is in when the haulier was late the evening before:
      // the dock has to clear the yard, the spine has to drain from the far end,
      // and the weld bay has to be running again the moment there is anywhere to
      // put a weldment.
      //
      // Deliberately *not* a disturbed rack. The seed a capstone hands over has
      // to be a plant that works, not a broken one, and a queue-run store fed
      // two frames in a row marries the wrong pair about a minute later. That is
      // puzzle 50's lesson and it would be a trap here, where the player is
      // being asked to make a working line faster rather than to find a bug in
      // somebody else's code.
      initialMachine: {
        yard: 6,
        truckState: 'away',
        truckT: 0,
        laneF: '11',
        laneB: '11',
        z10: 'm',
        z11: 'm',
      },
      steps: [
        {
          label: 'Auto and start, with the yard full and the haulier just gone',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'The lorry comes, the yard empties and ten machines go out behind it',
          setInputs: { X0: false },
          holdMs: 300_000,
          until: { machine: { shipped: 10 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 88.1 s properly, 100.3 s as handed over. The first twenty seconds of
      // this one belong to the haulier and no program can shorten them, which is
      // why the milestone is ten machines rather than six: at six the yard is
      // still the pacer and every configuration finishes on the same scan.
      parMs: 92_100,
    },
  ],
};
