import type { PuzzleSpec } from '../types.js';
import { LINE_DEVICES, LINE_INSTRUCTIONS } from './factory-line-plant.js';
import { LINE_TASKS, lineSections } from './factory-line-sections.js';

/**
 * The spray booth and the cure oven: the only analog work on the line, and the
 * station that sets its pace.
 *
 * Three separate things have to be true at once, and each of them fails in a
 * different way:
 *
 * 1. **The band.** Paint only cross-links between 90 and 130 C, and the same
 *    heater feeds the booth and the oven. Below the band the film never sets and
 *    the gun lays nothing down at all; drift out of it half way through a bake
 *    and the finish is already spoiled. So the heater command is a rung that
 *    runs whether the line does or not.
 * 2. **The spec.** A frame wants 200 to 320 um and a boom 140 to 260, and the
 *    bake is a function of the film that went on the part. Paint sprayed on is
 *    paint baked off the clock later, twice over, which is what makes one recipe
 *    for both parts the most expensive kind of caution on this plant.
 * 3. **The color.** The gun holds one color at a time. Spray with the drum
 *    selector on something other than what is in the line and the part is scrap
 *    before anyone sees it; flush with no drum selected and the station faults.
 *    The purge goes to the waste pot rather than through the part, so it can run
 *    while the next part is being blasted, and a changeover then costs nothing.
 *
 * Scrap is the discriminator throughout. Every scenario asserts `scrapped: 0`,
 * and each of the three ways to get it wrong produces a scrapped part rather
 * than a slow one, which is the right way round for a station where the mistake
 * is invisible until the part comes out of the oven.
 *
 * The lever is real here but small: the plant measures the paint shop at two
 * machines a shift, so the `parMs` on the second scenario is the one that
 * separates a recipe per part from one recipe for both.
 */
export const factoryPaint: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-paint',
  title: 'Excavator Line: The Paint Shop',
  difficulty: 'hard',
  order: 51,
  category: 'factory',
  summary:
    'Blast, spray to a film spec, bake. Hold the cure band, give each part its own recipe, and change color without stopping.',
  briefing: [
    'Two machines in one cell. The spray booth blasts a part, coats it and hands it to the',
    'cure oven, which has two racks of its own so the next part can be sprayed while the last',
    'one bakes. One heater and one duct feed both chambers.',
    '',
    'This is the only station on the line with analog work in it, and it is the station the',
    'rest of the plant waits for. Everything here is a number: a temperature that has to stay',
    'inside a band, a film thickness that has to land inside a window, and a drum number that',
    'has to match what is actually in the gun.',
    '',
    '## Sections and tasks',
    '- SEC3_PAINT is yours. The other six are read only.',
    '- All seven run from one task, MAIN, every scan. The spine is scanned last, after the six',
    '  stations have decided what they want.',
    '- You own Y14 to Y16, D2, D3, D15, M70 to M99, T30 to T39, C30 to C39 and D40 to D49.',
    '',
    '## Equipment',
    '- D2 HEATER COMMAND, in raw counts. The card is 0 to 4000 counts over 0 to 200 C, so',
    '  110 C is K=2200. D0 BOOTH TEMPERATURE reads back on the same scale and lags the',
    '  command by a couple of seconds.',
    '- D3 GUN FLOW COMMAND, 0 to 4000 counts over 0 to 100 percent of the needle.',
    '- Y14 SPRAY GUN. D1 FILM THICKNESS is the gauge, 0 to 4000 counts over 0 to 400 um, and',
    '  it builds at flow times time while the gun is on and the booth is in band.',
    '- X19 PART AT BOOTH says the skid is loaded. X20 BOOM IN BOOTH says what is on it.',
    '- Y15 OVEN INFEED sends the part through to a rack. X21 OVEN FULL says both are taken.',
    '- D8 NEXT PAINT COLOR is the drum the order book calls for. D9 COLOR IN GUN is what is',
    '  actually loaded. D15 DRUM SELECT is your command, and Y16 PURGE GUN flushes the line',
    '  through to it. A flush takes 1.2 s, exactly one blast cycle.',
    '- X22 PAINTED LANE FULL says the lane on the far end of the spine has no room.',
    '',
    '## Sequence of operation',
    '1. Hold the booth at 110 C, running or not. An oven that goes cold between shifts costs',
    '   an hour to bring back and the first part through it would be scrap anyway.',
    '2. Hold the gun flow open at full.',
    '3. When a part lands on the skid the booth blasts it for 1.2 s on its own. Nothing to do.',
    '4. Spray it until D1 reaches the target for whatever is on the skid.',
    '   a. A frame is specified 200 to 320 um, which is K=2000 to K=3200.',
    '   b. A boom is specified 140 to 260 um, which is K=1400 to K=2600.',
    '5. Send it to the oven on Y15, into a free rack, with room in the painted lane beyond.',
    '6. Whenever D9 is not D8, flush the gun to the drum the book calls for.',
    '',
    '## Interlocks and safety',
    '- The gun may never spray and purge at once. That is paint and thinners together, all',
    '  over the part and the booth.',
    '- A purge needs a drum selected to flush through to. Purging onto nothing is a fault.',
    '- Spraying with the selector on a drum the line is not loaded with pulls the old color',
    '  through behind the new one. The part is scrap and nothing says so until it is baked.',
    '- Paint only cross-links between 90 and 130 C, which is K=1800 to K=2600. Out of band',
    '  the gun lays nothing down, and a bake that drifts out of band has already spoiled the',
    '  finish on the part in the rack.',
    '',
    '## Field notes',
    '- Bake time is 3.0 s plus 1.25 ms per count of film. Paint sprayed on is paint baked off',
    '  the clock later, so a boom given the frame recipe costs the booth twice: once at the',
    '  gun and again in the oven, on half of everything the plant makes.',
    '- The purge flushes to the waste pot, not through the part, so it does not stop the booth',
    '  working. Started when a part lands, it hides inside that part own blast and the',
    '  changeover is free. Waiting for an empty booth instead means waiting for ever: the',
    '  portal is standing over the skid with the next part within half a second.',
    '- The order book runs in pairs. Two machines in a row in the same color is four parts the',
    '  booth can spray without stopping, and D8 is where that shows.',
    '- The oven holds two racks, so a part can be baking while the next one is sprayed. A rack',
    '  whose part is done but whose lane is full simply holds it, which is a door that does',
    '  not open rather than a fault.',
    '',
    '## Acceptance',
    '- Every part comes out of the oven inside its own film window and in the color the order',
    '  book called for. Nothing is scrapped.',
    '- The booth holds the cure band throughout.',
    '- The gun is never sprayed and purged together, and never purged onto no drum.',
    '- A color change happens without the line stopping for it.',
  ].join('\n'),
  hints: [
    'Two MOVs on one rung with no contacts in front of them will hold the heater and the ' +
      'flow open for the whole shift. K=2200 into D2 and K=4000 into D3. The booth takes a ' +
      'couple of seconds to come up and everything else waits for it.',
    'The drum command is not a decision. MOV D8 into D15 unconditionally and the selector ' +
      'always points at the drum the book wants; what is left to decide is only whether to ' +
      'flush the line through to it, which is a compare of D9 against D8.',
    'Put the spray rung above the purge rung and interlock the purge on NC of the spray ' +
      'coil. The two are then mutually exclusive within one scan, and the purge reads this ' +
      'scan gun rather than last scan.',
    'One spray rung can serve both parts if the target is a register rather than a constant. ' +
      'Two rungs choosing it, one gated on X20 and one on NC X20, and the spray rung compares ' +
      'D1 against that register. Several MOVs into one register is value selection, not a ' +
      'double write.',
    'The oven infeed rung is the spray rung with the compare turned around, plus NC X21 for ' +
      'a free rack and NC X22 for room in the lane beyond. Leave either of those out and the ' +
      'station tries to push a part into somewhere that cannot take it.',
  ],
  devices: LINE_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'published by the supervisor; every section reads it' },
    { address: 'D40', label: 'Film target', note: 'suggested; you own D40 to D49' },
    { address: 'M70', label: 'Working relay', note: 'you own M70 to M99' },
  ],
  allowedInstructions: [...LINE_INSTRUCTIONS],
  processId: 'factory-line',
  pous: lineSections({ open: ['PAINT'] }),
  tasks: LINE_TASKS,
  taskAssignment: 'fixed',
  scenarios: [
    {
      name: 'The booth comes up and coats its first part',
      description: 'Nothing is sprayed at all until the band is held, and the band is a rung.',
      steps: [
        {
          label: 'Auto and start, and the booth is brought up into the cure band',
          setInputs: { X3: true, X0: true },
          holdMs: 20_000,
          until: { analog: { D0: { min: 1800 } } },
          expect: { Y0: true },
          expectMachine: { jam: false },
        },
        {
          label: 'The first part is blasted, coated and sent through to a rack',
          setInputs: { X0: false },
          holdMs: 30_000,
          until: { machine: { sprayed: 1 } },
          expectAnalog: { D0: { min: 1800, max: 2600 } },
          expectMachine: { jam: false, blocked: false },
        },
        {
          label: 'And it comes out of the oven sound',
          holdMs: 30_000,
          until: { machine: { painted: 1 } },
          expectMachine: { jam: false, scrapped: 0 },
        },
      ],
      // 16.5 s for the canonical booth, and almost all of it is the heater lag.
      // One recipe for both parts reaches the same point 0.7 s later, which is
      // the whole of the lever on a single frame.
      parMs: 16_900,
    },
    {
      name: 'A boom is not a frame',
      description:
        'Twelve parts, six machines. Every one inside its own window, and the booth charges twice for the paint a part did not need.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'Six machines worth of parts are coated and baked, none of them scrap',
          setInputs: { X0: false },
          holdMs: 200_000,
          until: { machine: { painted: 12 } },
          expectMachine: { jam: false, blocked: false, scrapped: 0 },
        },
      ],
      // The scenario the recipe is worth something in. 51.5 s for the canonical
      // booth against 59.6 s for one recipe covering both parts: eight seconds
      // over six machines, spent a third at the gun and two thirds in the oven.
      // Four parts is not enough to see it, which is why this one runs to
      // twelve.
      parMs: 53_000,
    },
    {
      name: 'The order book turns over',
      description:
        'The fifth part is a different color from the fourth. Change it without stopping and without scrapping anything.',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 1000,
          expect: { Y0: true },
        },
        {
          label: 'The line runs on to the changeover and the gun is flushed through for it',
          setInputs: { X0: false },
          holdMs: 140_000,
          until: { machine: { purges: 1 } },
          expectMachine: { jam: false, scrapped: 0 },
        },
        {
          label: 'And three machines are built out of parts that all match their order line',
          holdMs: 140_000,
          until: { machine: { shipped: 3 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
      // 47.4 s for the canonical booth. A purge that waits for the booth to be
      // empty never runs at all and deadlocks here rather than scoring badly.
      parMs: 49_000,
    },
  ],
};
