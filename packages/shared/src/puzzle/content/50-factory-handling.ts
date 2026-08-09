import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * The rack store and the portal robot.
 *
 * Two mechanisms in one section, and the section is one because the program
 * that drives the rack is the program that drives the gantry over it: while the
 * head is out over the aisle the rack cannot stroke, so the two are one machine
 * whatever the drawings say.
 *
 * The lesson is **order**. Everywhere else on this line a part comes out in the
 * order it went in; here it does not have to. Four gravity lanes two deep, and
 * which lane a part is put away in decides which part the booth is offered next.
 *
 * ## What is graded, and what is not
 *
 * FACTORY-LINE-DESIGN.md §5a records the store's throughput lever as **zero**:
 * `STORE_PLAIN` runs one lane in and one lane out, and over a balanced shift it
 * costs the plant nothing, because the buffer the line actually leans on is the
 * spine rather than the rack. So this puzzle does not pretend to measure a
 * lever. It grades the thing a one-lane store genuinely cannot do.
 *
 * A rack run as a queue can only hand the booth what the weld bay happened to
 * make, and the weld bay hands over frames and booms strictly turn about, so a
 * queue is *usually* right. The third scenario starts a shift the way a real one
 * starts: with two frames left in lane 1 by the shift before. A queue then feeds
 * three frames in a row, the booth colors them as three halves of two different
 * machines, and the frame lane and the boom lane drift a machine apart for good
 * about forty seconds later, in a bay nobody was looking at. A sorted rack
 * absorbs the same two frames without a hiccup, because it is not a queue.
 *
 * That is the honest shape of this station: the sorting is not faster, it is
 * what makes the line's mix *recoverable*. The `parMs` targets are calibrated to
 * catch a portal that dawdles between stations, which is a real cost and a
 * smaller one.
 */
export const factoryHandling: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-handling',
  title: 'Excavator Line: The Rack Store',
  difficulty: 'hard',
  order: 50,
  category: 'factory',
  summary:
    'Four gravity lanes and a portal robot over the aisle. The one place on the line where parts can leave in a different order from the one they arrived in.',
  briefing: [
    'Between the weld bay and the spray booth there is a rack, and the rack is the only thing',
    'on this line with a memory. Everything else takes the part in front of it. The store can',
    'put a part away in one of four places and draw from whichever of the four it likes, and',
    'that choice is what decides which part the booth is offered next.',
    '',
    'Over the aisle in front of the rack runs the portal robot: a gantry on a rail with a',
    'vacuum head hanging under it. It is the only way a part gets from the rack to the booth',
    'skid, and every rule on it is a rule a real gantry has.',
    '',
    '## Sections and tasks',
    '- SEC2_STORE is yours. The other six are read only.',
    '- All seven run from one task, MAIN, every scan. The spine is scanned last, after the six',
    '  stations have decided what they want.',
    '- You own Y8 to Y13, D13, D14, M40 to M69, T20 to T29, C20 to C29 and D30 to D39.',
    '',
    '## Equipment',
    '- Four gravity lanes, numbered 1 to 4, each two parts deep. D4 to D7 count what is',
    '  standing in them. A lane is a queue: what goes in first comes out first.',
    '- Y8 LOAD INTO LANE takes whatever is standing on the store infeed into the lane D13',
    '  selects. X11 PART AT STORE INFEED says there is something to take, and X12 BOOM AT',
    '  STORE INFEED says what it is.',
    '- Y9 PICK FROM LANE draws the front part of the lane D14 selects onto the outfeed. X13',
    '  PART AT STORE OUTFEED says the outfeed is occupied. Both strokes take 0.7 s.',
    '- The portal: Y10 TRAVEL TO BOOTH and Y11 TRAVEL TO STORE, with X14 PORTAL AT STORE and',
    '  X15 PORTAL AT BOOTH. Y12 LOWER HEAD, with X16 PORTAL DOWN and X17 PORTAL UP. Y13',
    '  VACUUM, with X18 PART HELD. Travel takes 0.55 s, the head 0.22 s and the cups 0.15 s.',
    '- X19 PART AT BOOTH says the skid under the head at the booth end is loaded.',
    '',
    '## Sequence of operation',
    '1. Put away whatever arrives on the infeed. Write the lane number into D13 first, then',
    '   stroke Y8.',
    '2. Draw the part the booth should have next onto the outfeed. Write the lane number into',
    '   D14, then stroke Y9.',
    '3. The portal parks over the store. Lower the head, make vacuum, lift, travel to the',
    '   booth, lower again, and break vacuum to set the part on the skid.',
    '4. Travel home empty and wait for the next one.',
    '',
    '## Interlocks and safety',
    '- The portal may not travel with its head down. The head hangs below the rail and the',
    '  rail is not the only thing in the aisle.',
    '- The portal may not let go with its head up. The part is then two meters over the floor.',
    '- The head may only be lowered at one end of the rail or the other, never half way.',
    '- Setting a part down on a skid that is still loaded is a crash. X19 says whether it is.',
    '- Stacking into a lane that is already two deep is a crash, and so is naming a lane',
    '  outside 1 to 4.',
    '',
    '## Field notes',
    '- A stroke against nothing is not a crash. The loader pushing an empty infeed and the',
    '  picker drawing from an empty lane both simply come back with nothing.',
    '- The loader lifts a part off Z3, so Z3 has to be stopped for it. The spine handles that',
    '  on its own: a zone holding a part has its drive off already.',
    '- Final assembly needs a frame and a boom of the same color, and a part is colored when',
    '  it is sprayed. So the order you feed the booth is the order the machines are built in.',
    '  Feed two of the same kind in a row and the two painted lanes drift a machine apart. No',
    '  program downstream can put that right, because by then the mistake is an hour old.',
    '- The weld bay hands over frames and booms turn about, so a rack run as a single queue',
    '  is usually right. Usually. A shift does not always start with an empty rack.',
    '- Four lanes two deep is eight parts of buffer instead of two, which is a booth that',
    '  keeps spraying right through a tip change in the weld bay.',
    '- The wait for the booth can be spent with the head already down on the skid, since a',
    '  part is not placed until the cups let go.',
    '',
    '## Acceptance',
    '- Parts reach the booth skid, and the line welds, paints, marries and ships machines.',
    '- The portal never travels with its head down and never lets go with it up.',
    '- Nothing is stacked into a full lane and nothing is set down on a loaded skid.',
    '- A shift that starts with two frames already in the rack still builds machines out of',
    '  one frame and one boom each, with nothing starved and nothing scrapped.',
  ].join('\n'),
  hints: [
    'Write the lane number before you stroke. A MOV into D13 and a MOV into D14 on rungs of ' +
      'their own, each gated on the condition that picks that lane, and the strokes below ' +
      'them reading nothing but "is there something to move".',
    'Several MOVs into one register is the value-selection idiom, not a double coil: each ' +
      'one fires only on the scan its own rung conducts. Four rungs choosing a load lane and ' +
      'four choosing a pick lane is a perfectly ordinary way to write this.',
    'Sort on X12. A frame belongs in lane 1 or lane 2 and a boom in lane 3 or lane 4, and ' +
      'the rule for which of the pair is "the first one with room in it", which is a compare ' +
      'against D4 to D7.',
    'Draw out turn about: a frame, then a boom, then a frame. That needs a relay that flips ' +
      'once per part drawn, and the pulse to flip it on is the rising edge of X13, not the ' +
      'level. A level contact is true for as long as the part stands there and would flip ' +
      'the relay every scan.',
    'Build the portal as a step chain, one latch per step, with every step rung above every ' +
      'coil rung. Fence its latches at the far end of your block and let nothing else touch ' +
      'them: a level OUT coil written above the chain overwrites whatever the chain latched ' +
      'on the scan before, and the portal quietly stops being a sequence.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'M46', label: 'Next part out is a boom', note: 'suggested; flip it once per pick' },
    { address: 'M60', label: 'Portal step 1', note: 'suggested: fence the portal chain in M60 to M64' },
    { address: 'D30', label: 'Working register', note: 'you own D30 to D39' },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  pous: lineSections({ open: ['STORE'] }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  scenarios: [
    {
      name: 'The first part reaches the booth',
      description: 'Rack in, rack out, and a gantry that has to obey both of its interlocks.',
      steps: [
        {
          label: 'Auto and start, and the weld bay rolls its first weldment onto the spine',
          setInputs: { X3: true, X0: true },
          holdMs: 8000,
          until: { machine: { welded: 1 } },
          expect: { Y0: true },
          expectMachine: { jam: false },
        },
        {
          label: 'It travels the run and arrives on the store infeed',
          setInputs: { X0: false },
          holdMs: 10_000,
          until: { bits: { X11: true } },
          expectMachine: { jam: false, blocked: false },
        },
        {
          label: 'The loader stacks it and the picker draws it back out onto the outfeed',
          holdMs: 10_000,
          until: { bits: { X13: true } },
          expectMachine: { jam: false, blocked: false },
        },
        {
          label: 'The portal lifts it, crosses the aisle and sets it on the booth skid',
          holdMs: 10_000,
          until: { bits: { X19: true } },
          expectMachine: { jam: false, blocked: false },
        },
      ],
      // 7.65 s for the canonical store. A portal that waits for the booth with
      // its head still up reaches the same point about a lift later.
      parMs: 8100,
    },
    {
      name: 'A run off the line',
      description: 'The store feeds a plant. Three complete machines, nothing scrapped.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Three excavators are welded, stored, painted, married up and driven off',
          setInputs: { X0: false },
          holdMs: 140_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 47.4 s for the canonical store, and a one-lane rack reaches it on the
      // same scan. That is the store's measured lever, and it is zero.
      parMs: 49_000,
    },
    {
      name: 'A rack left out of order',
      description:
        'The shift before left two frames standing in lane 1. A queue feeds three frames in a row on the back of it.',
      // Counters and buffers only, per the `initialMachine` contract. Two parts
      // in one lane is the plainest disturbance a real rack has, and it is the
      // only thing on this line that can put the mix out: everything else hands
      // over strictly turn about.
      //
      // The damage is not immediate and that is the point. The first two frames
      // are sprayed as one machine's worth, the frame lane runs one part ahead
      // of the boom lane from then on, and the jig is holding a frame it can
      // never marry about forty seconds after the mistake was made.
      initialMachine: { lane0: 'ff' },
      steps: [
        {
          label: 'Auto and start, with two frames already in the rack',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Both of them go through the booth, and the jig is never handed two frames',
          setInputs: { X0: false },
          holdMs: 140_000,
          until: { machine: { shipped: 2 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
        {
          label: 'And the line keeps its mix afterwards',
          holdMs: 140_000,
          until: { machine: { shipped: 4 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 52.85 s for the canonical store. A rack run as one queue never reaches
      // the first milestone at all: the frame lane fills, the jig holds a frame
      // it can never marry, and the line stands.
      parMs: 55_500,
    },
  ],
};
