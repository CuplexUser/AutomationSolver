import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_GLOBALS, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * The weld bay, on the real line.
 *
 * First puzzle on the rebuilt floor, and the first thing that declares
 * `factory-line` as its process: 55 by 38 metres, seven sections, a zoned
 * conveyor running the length of the building and two part streams that have to
 * come out of this bay strictly turn about.
 *
 * The lesson is one fixture sequenced properly, and the lever is that **the two
 * parts are not the same job**. A frame is a hull and takes two runs with a roll
 * over between them; a boom is a stick and takes one.
 *
 * A program that gives every part the frame's treatment welds sound booms and
 * never faults, so it *solves* this puzzle — and it takes 9.2 s to make the first
 * two parts against 5.6 s, which is what the three `parMs` targets are for. That
 * split is the category's stated bargain: correctness unlocks what comes next and
 * throughput is scored on top of it.
 *
 * Worth knowing before writing an assertion here: the second pass on a boom is
 * **not** charged to the tip. `stepWeld` only advances `tipPasses` for a pass
 * that lays metal, and a boom is `done` after its first, so the extra arc
 * re-melts a cap that was already sound and costs exactly what it looks like it
 * costs, which is the time. The `tipPasses` assertions below pin the *mix* (a
 * frame really does spend two and a boom one) and cannot catch the slow program.
 *
 * No demo. Puzzle 47's demo existed because a briefing cannot show a plant
 * arriving, and by now the player has seen one; here the answer *is* the lesson,
 * and the new floor is live in the panel the whole time they are writing it.
 */
export const factoryWeld: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-weld',
  title: 'Excavator Line: The Weld Bay',
  difficulty: 'hard',
  order: 48,
  category: 'factory',
  summary:
    'A new floor, and one bay of it is yours. Sequence the fixture, alternate the mix, and stop welding every boom twice.',
  briefing: [
    'A bigger plant than the one you commissioned, and a real one. Fifty five metres of shop',
    'with a zoned conveyor running the length of it, a rack store, a portal robot over the',
    'aisle, a spray booth with its own cure oven, and a dock with a haulier who will not wait',
    'for ever. Seven programs run it. Six of them ship working and are open for you to read.',
    '',
    'The seventh is the weld bay, and it is empty. Everything on this line starts here: two',
    'kinds of blank go into one fixture, and what comes out of it decides what every other',
    'section spends its day doing.',
    '',
    '## Sections and tasks',
    '- SEC1_WELD is yours. The other six are read only.',
    '- All seven run from one task, MAIN, every scan, in the order the tree shows. The six',
    '  stations decide what they want and SEC6_CONVEYOR then moves everything, which is why',
    '  the spine is scanned last.',
    '- You own Y2 to Y7, M10 to M39, T10 to T19, C10 to C19 and D20 to D29. Writing anything',
    '  else is a validation error.',
    '',
    '## Equipment',
    '- X4 FRAME BLANK READY and X5 BOOM BLANK READY. Both are always on: the blanks are',
    '  stacked at the shop door and the shop never runs out of either.',
    '- Y6 SELECT BOOM picks which one the fixture loads. Off is a frame, on is a boom. The',
    '  fixture latches the choice at the moment it clamps, so moving it mid cycle is safe',
    '  and pointless.',
    '- Y2 CLAMP and X6 FIXTURE CLAMPED. The jaws take 0.4 s to make.',
    '- Y3 TORCH. Y4 ROTATE POSITIONER, with X7 POSITIONER AT A and X8 POSITIONER AT B. The',
    '  roll over takes 0.45 s each way.',
    '- Y5 RELEASE rolls the finished weldment out onto Z1, the first zone of the spine.',
    '- X9 TORCH TIP WORN and Y7 CHANGE TIP. A change takes 3 s.',
    '- X32 Z1 WELD OUTFEED is the eye on your own outfeed zone. X10 WELD OUTFEED OCCUPIED is',
    '  a different signal: it is the store infeed, three zones further down the line.',
    '',
    '## Sequence of operation',
    '1. Pick the next blank on Y6 and start a cycle. Frames and booms strictly turn about,',
    '   because final assembly needs one of each and a bay that runs whichever part is',
    '   quicker fills the rack with booms and starves the jig.',
    '2. Y2 CLAMP, and hold it for the whole cycle. Wait for X6.',
    '3. Lay the first pass with the positioner at A. A frame takes 1.1 s, a boom 1.2 s.',
    '4. A frame then rolls over on Y4 and takes a second pass at B.',
    '   a. A boom does not. It is finished after the first pass and goes straight out.',
    '5. Y5 RELEASE, until the weldment is on the spine.',
    '6. Flip the selector, so the next blank is the other kind.',
    '7. When X9 says the tip is worn, change it on Y7 with the fixture empty.',
    '',
    '## Interlocks and safety',
    '- The torch may only strike on a clamped fixture, and only with the positioner settled',
    '  at A or at B. An arc lit while the weldment is still turning is a jam.',
    '- The fixture may not be released part way through its passes, and may not be opened',
    '  with a seam half welded.',
    '- Y7 CHANGE TIP needs an empty fixture. A tip changed with a part in the jaws is a jam.',
    '- A worn tip is judged when a new weldment is started, never mid part. The part in the',
    '  jaws is always finished, and the check falls on the next one to go in.',
    '',
    '## Field notes',
    '- A contact tip is good for eight passes. A frame spends two of them and a boom one.',
    '  Nothing in the field says how many are left, only that they have run out, so counting',
    '  your own work is the only way to change a tip before it stops the bay.',
    '- Running a second pass over a boom does not damage it and does not cost a tip pass.',
    '  The seam is already laid, so the arc re-melts a cap that was sound. It costs exactly',
    '  what it looks like it costs, which is 1.75 s of fixture time on every boom the shop',
    '  makes, and the fixture is the first machine on the line.',
    '- Z1 has to be running and clear to take a weldment. If the spine is backed up the',
    '  release simply waits, holding the part in the jaws. Nothing breaks and nothing drops.',
    '- Waiting for X10 before starting the next blank is safe, obvious, and costs the bay a',
    '  second and a half of travel plus a loader stroke on every part. Your own outfeed eye',
    '  says the same thing sooner.',
    '- Watch D19 BLOCKED AT ZONE on the panel. It names the zone at the head of the queue,',
    '  which is the station holding the line up. Early on that will be you.',
    '',
    '## Acceptance',
    '- Frames and booms leave the bay strictly turn about, starting with a frame.',
    '- A frame is welded in two passes with a roll over between them.',
    '- A boom is welded in one. Giving it two is not a fault and the bay will still pass,',
    '  but every scenario here is timed and a bay that welds every boom twice is a bay that',
    '  scores badly on all three.',
    '- The torch never strikes on an open fixture or a moving positioner.',
    '- The tip is changed before it stops the bay, and never with a part in the fixture.',
    '- Left running, the line welds, paints, marries and ships machines with nothing jammed,',
    '  blocked, starved or scrapped.',
  ].join('\n'),
  hints: [
    'Build it as a step chain, one latch per step, and put every step rung above every ' +
      'coil rung. The scan a pass finishes on is the scan the torch has to go out, and a ' +
      'coil written above the step that clears it acts on a latch that is a scan stale.',
    'Two timers rather than one is what separates the two parts: a frame timer gated on the ' +
      'selector being off and a boom timer gated on it being on, both feeding the same ' +
      '"first pass done" latch through a vertical link. Then one more rung that says a boom ' +
      'is finished at that point, and the second pass and the rotation never happen for it.',
    'The alternating relay is three rungs and the order matters: arm on the release pulse ' +
      'with the selector clear, clear the selector, then apply the arm. Two rungs cannot do ' +
      'it, because the second would see the bit the first just wrote.',
    'If the bay stalls after a few parts, look at the tip. X9 comes on and stays on, and a ' +
      'start rung that ignores it will try to strike a new weldment on a worn tip. The ' +
      'change rung needs the fixture empty, which is the same latch your start rung uses.',
    'If the fixture jams changing a tip on a loaded part, the cycle-finished rung is ' +
      'reading Z1 as a level. When the spine is backed up there is already a part standing ' +
      'there, so the level is true before yours has left. Use the rising edge of the eye.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'M10', label: 'Next blank is a boom', note: 'drives Y6; flip it once per release' },
    { address: 'M11', label: 'Cycle in progress', note: 'suggested; you own M10 to M39' },
    { address: 'T10', label: 'Seam timer', note: 'K=12 is 1.2 s; you own T10 to T19' },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  pous: lineSections({ open: ['WELD'] }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  // The six sections you are not writing are written in names, so the symbol
  // picker on any device field offers the plant's own vocabulary. `optional`
  // rather than `required`: an address still resolves to itself, so nothing
  // saved against this puzzle before symbols existed has to be rewritten.
  symbols: 'optional',
  globals: LINE_GLOBALS,
  scenarios: [
    {
      name: 'A frame, then a boom',
      description: 'The two parts are not the same job, and the tip is what keeps the score.',
      steps: [
        {
          label: 'Auto and start, and the fixture clamps the first blank',
          setInputs: { X3: true, X0: true },
          holdMs: 3000,
          until: { bits: { X6: true } },
          expect: { Y0: true, Y2: true },
          expectMachine: { weldPart: 'f', jam: false },
        },
        {
          label: 'The frame is rolled over for its second pass',
          setInputs: { X0: false },
          holdMs: 6000,
          until: { bits: { X8: true } },
          expectMachine: { jam: false },
        },
        {
          label: 'It comes off the fixture onto the spine, two passes of tip life spent',
          holdMs: 6000,
          until: { machine: { welded: 1 } },
          expectMachine: { jam: false, tipPasses: 2 },
        },
        {
          label: 'The next blank is a boom',
          holdMs: 5000,
          until: { machine: { weldPart: 'b' } },
          expectMachine: { jam: false },
        },
        {
          label: 'And a boom costs one pass, not two',
          holdMs: 6000,
          until: { machine: { welded: 2 } },
          expectMachine: { jam: false, tipPasses: 3 },
        },
      ],
      // 5.55 s for the canonical bay. A boom given the frame treatment takes
      // 9.15 s to reach the same point, which is past the taper entirely.
      parMs: 5800,
    },
    {
      name: 'The tip is a consumable',
      description: 'Eight passes, no gauge, and a bay that stops if you let it run out.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Run on until the first tip change, with the fixture empty for it',
          setInputs: { X0: false },
          holdMs: 60_000,
          until: { machine: { tipChanges: 1 } },
          expectMachine: { jam: false, weldPart: '' },
        },
        {
          label: 'And the bay keeps welding afterwards',
          holdMs: 60_000,
          until: { machine: { welded: 12 } },
          expectMachine: { jam: false, blocked: false },
        },
      ],
      parMs: 41_500,
    },
    {
      name: 'A run off the line',
      description: 'The bay feeds a plant. Three complete machines, nothing scrapped.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Three excavators are welded, painted, married up, tested and driven off',
          setInputs: { X0: false },
          holdMs: 120_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // Calibrated against the canonical bay, which reaches three machines in
      // 47.4 s. A fixture that waits for the store before starting its next
      // blank still finishes, and finishes 11 s late.
      parMs: 49_500,
    },
  ],
};
