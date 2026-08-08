import type { CompareOp, LadderElement, Rung, VLink } from '../../ladder/types.js';
import type { AnalogRange, PuzzleDevice, PuzzleSpec } from '../types.js';

/**
 * The excavator plant, commissioned.
 *
 * First puzzle of the first category that is not a machine but a *plant*, and
 * the first one written in more than one program. Four stations ship working;
 * the player writes the fifth, the supervisor that decides whether the plant is
 * allowed to run at all.
 *
 * That split is the on-ramp. A five-program factory handed over whole is a wall,
 * and the ladder needed for a run latch is something the player already did in
 * puzzle 3. What is new here is everything around the ladder: sections, a scan
 * order, an interface block of bits one program publishes and four others read,
 * and a machine too big to fit in one window. The four station programs are
 * open and readable in their own windows on purpose. Reading somebody else's
 * working code is most of what commissioning a plant actually is.
 */

// --- Analog ranges --------------------------------------------------------------

/** The booth thermocouple, on a 0..200 C card. The cure band is 90..130 C. */
const TEMP_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 200,
  units: 'C',
  decimals: 0,
};

/** The film gauge, 0..400 um. A sound finish is 200..320 um. */
const FILM_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 400,
  units: 'um',
  decimals: 0,
};

/** The gun's flow command, as a percentage of the needle's travel. */
const FLOW_RANGE: AnalogRange = {
  countMin: 0,
  countMax: 4000,
  min: 0,
  max: 100,
  units: '%',
  decimals: 0,
};

/**
 * Every signal on the plant, in station order.
 *
 * Exported because every factory puzzle wires the same machine: the stations
 * that open up later are the same stations, and a device map that drifted
 * between puzzles would be a different plant wearing the same name.
 */
export const PLANT_DEVICES: PuzzleDevice[] = [
  // Plant
  { address: 'X0', label: 'Start', io: 'input', widget: 'momentary' },
  { address: 'X1', label: 'Stop', io: 'input', widget: 'momentary', normallyClosed: true },
  { address: 'X2', label: 'Emergency Stop', io: 'input', widget: 'estop', normallyClosed: true },
  { address: 'X3', label: 'Auto', io: 'input', widget: 'selector' },
  { address: 'Y0', label: 'Plant Running', io: 'output', widget: 'lamp', color: '#34d399' },
  { address: 'Y1', label: 'Line Held', io: 'output', widget: 'lamp', color: '#fbbf24' },

  // Weld shop
  { address: 'X4', label: 'Frame Blank Ready', io: 'input', widget: 'sensor' },
  { address: 'X5', label: 'Boom Blank Ready', io: 'input', widget: 'sensor' },
  { address: 'X6', label: 'Fixture Clamped', io: 'input', widget: 'sensor' },
  { address: 'X7', label: 'Carriage Home', io: 'input', widget: 'sensor' },
  { address: 'X8', label: 'Weld Buffer Full', io: 'input', widget: 'sensor' },
  { address: 'Y2', label: 'Clamp', io: 'output', widget: 'motor', color: '#e0a11b' },
  { address: 'Y3', label: 'Torch', io: 'output', widget: 'motor', color: '#f97316' },
  { address: 'Y4', label: 'Carriage', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y5', label: 'Release', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y6', label: 'Select Boom', io: 'output', widget: 'lamp', color: '#e879f9' },

  // Paint shop
  { address: 'X9', label: 'Part At Booth', io: 'input', widget: 'sensor' },
  { address: 'X10', label: 'Oven Busy', io: 'input', widget: 'sensor' },
  { address: 'X11', label: 'Paint Buffer Full', io: 'input', widget: 'sensor' },
  {
    address: 'D0',
    label: 'Booth Temperature',
    io: 'input',
    widget: 'gauge',
    signal: 'analog',
    range: TEMP_RANGE,
    color: '#f97316',
  },
  {
    address: 'D1',
    label: 'Film Thickness',
    io: 'input',
    widget: 'bar',
    signal: 'analog',
    range: FILM_RANGE,
    color: '#f0b429',
  },
  { address: 'Y7', label: 'Booth Infeed', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y8', label: 'Spray Gun', io: 'output', widget: 'motor', color: '#f0b429' },
  { address: 'Y9', label: 'Oven Infeed', io: 'output', widget: 'motor', color: '#f97316' },
  {
    address: 'D2',
    label: 'Heater Command',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: TEMP_RANGE,
    color: '#f97316',
  },
  {
    address: 'D3',
    label: 'Gun Flow Command',
    io: 'output',
    widget: 'bar',
    signal: 'analog',
    range: FLOW_RANGE,
    color: '#f0b429',
  },

  // Final assembly
  { address: 'X12', label: 'Frame Ready', io: 'input', widget: 'sensor' },
  { address: 'X13', label: 'Boom Ready', io: 'input', widget: 'sensor' },
  { address: 'X14', label: 'Machine Complete', io: 'input', widget: 'sensor' },
  { address: 'X15', label: 'Test Bay Clear', io: 'input', widget: 'sensor' },
  { address: 'Y10', label: 'Call Frame', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y11', label: 'Call Boom', io: 'output', widget: 'motor', color: '#e879f9' },
  { address: 'Y12', label: 'Lower Engine', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y13', label: 'Fit Cab', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y14', label: 'Pin Boom', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y15', label: 'Release To Test', io: 'output', widget: 'motor', color: '#f97316' },

  // Test and dispatch
  { address: 'X16', label: 'Machine At Test', io: 'input', widget: 'sensor' },
  { address: 'X17', label: 'Yard Space', io: 'input', widget: 'sensor' },
  { address: 'X18', label: 'Test Passed', io: 'input', widget: 'sensor' },
  { address: 'Y16', label: 'Hydraulic Pump', io: 'output', widget: 'motor', color: '#38bdf8' },
  { address: 'Y17', label: 'Function Test', io: 'output', widget: 'motor', color: '#34d399' },
  { address: 'Y18', label: 'Dispatch', io: 'output', widget: 'motor', color: '#f97316' },
];

// --- Ladder builders --------------------------------------------------------------
// Local, deliberately not shared with the test suite's copies: the station
// programs below are content, and content should not break in a test refactor.

const no = (device: string): LadderElement => ({ type: 'contact-no', device });
const nc = (device: string): LadderElement => ({ type: 'contact-nc', device });
const out = (device: string): LadderElement => ({ type: 'coil-out', device });
const set = (device: string): LadderElement => ({ type: 'coil-set', device });
const rst = (device: string): LadderElement => ({ type: 'coil-reset', device });
const tmr = (device: string, preset: number): LadderElement => ({
  type: 'timer',
  device,
  preset,
});
const mov = (source: string, device: string): LadderElement => ({
  type: 'mov',
  device,
  operands: [source],
});
const cmp = (op: CompareOp, a: string, b: string): LadderElement => ({
  type: 'compare',
  device: '',
  op,
  operands: [a, b],
});

function rung(id: string, rows: (LadderElement | null)[][], vlinks: VLink[] = []): Rung {
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    id,
    rows: rows.length,
    cols,
    cells: rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? null)),
    vlinks,
  };
}

// --- SEC1 WELD --------------------------------------------------------------------

/**
 * The weld shop, as commissioned.
 *
 * One fixture, one torch and one decision: which of the two blanks to load. The
 * station alternates strictly, frame then boom then frame, because final
 * assembly needs one of each and a shop that welds whichever is quicker fills
 * every buffer with frames and starves the plant while looking busy. The
 * alternation is the classic three-rung alternating relay, flipped on the
 * release pulse rather than on the start of a cycle, so a cycle held off by a
 * full buffer does not skip a turn.
 *
 * The clamp is deliberately *not* interlocked on the plant run bit. A weld
 * fixture that opened on an emergency stop would drop a half-welded weldment on
 * the floor; only the torch, the timer and the release stop. So the station
 * freezes mid-seam and picks up exactly where it left off.
 */
export const WELD_PROGRAM: Rung[] = [
  // Which blank the fixture loads. The model latches this at clamp time, so it
  // is safe to leave it following M10 for the whole cycle.
  rung('w-select', [[no('M10'), out('Y6')]]),
  // Start a cycle: the plant is running and the buffer downstream has room.
  rung('w-start', [[no('M0'), nc('X8'), nc('M11'), set('M11')]]),
  // Clamp for the whole cycle, emergency stop or not, and open as the release
  // begins. Holding the grip through the release stroke looks harmless and is
  // not: the fixture would pick up the next blank on the scan the old part left,
  // before the alternator had flipped, and weld two of the same kind in a row.
  rung('w-clamp', [[no('M11'), nc('M12'), out('Y2')]]),
  // Seam time. K=35 is 3.5 s, comfortably past the 3.0 s a frame needs, and the
  // seam saturates rather than over-welding, so one preset covers both parts.
  rung('w-seam-timer', [[no('M0'), no('M11'), no('X6'), tmr('T10', 35)]]),
  // The torch may only strike on a clamped part. X6 in series is that interlock.
  rung('w-torch', [[no('M0'), no('M11'), no('X6'), nc('T10'), out('Y3')]]),
  rung('w-release-arm', [[no('T10'), set('M12')]]),
  rung('w-release', [[no('M0'), no('M12'), out('Y5')]]),
  // The carriage leaving home says the stroke started; it coming back says the
  // part is on the rail. Two rungs rather than one because X7 CARRIAGE HOME is
  // true before the stroke as well as after it, so it only means "finished"
  // once something has recorded that it left.
  rung('w-stroke', [[no('M12'), nc('X7'), set('M13')]]),
  rung('w-done', [
    [no('M13'), no('X7'), out('M15'), rst('T10'), rst('M11'), rst('M12'), rst('M13')],
  ]),
  // Alternating relay: arm, clear, apply. Three rungs in this order flip M10
  // exactly once per pulse; two rungs cannot, because the second would see the
  // bit the first just wrote.
  rung('w-alt-arm', [[no('M15'), nc('M10'), set('M16')]]),
  rung('w-alt-clear', [[no('M15'), rst('M10')]]),
  rung('w-alt-apply', [[no('M16'), set('M10'), rst('M16')]]),
];

// --- SEC2 PAINT ---------------------------------------------------------------------

/**
 * The paint shop, as commissioned.
 *
 * The only station with analog work in it. The booth is held at 110 C whether or
 * not the line is running, because an oven that goes cold between shifts costs
 * an hour to bring back and the first part through it would be scrap. Film is
 * sprayed to 240 um, mid-band, and the part only goes into the oven once the
 * gauge says so.
 */
export const PAINT_PROGRAM: Rung[] = [
  // Recipe. Always live: the booth holds temperature with the plant stopped.
  rung('p-recipe', [[mov('K2200', 'D2'), mov('K4000', 'D3')]]),
  // Pull the next welded part in, but never on top of a full painted buffer.
  rung('p-infeed', [[no('M0'), nc('X9'), nc('X11'), out('Y7')]]),
  // Spray until the film gauge reaches 240 um, and only in a booth hot enough
  // for the paint to cross-link. Below the band the gun is just making fog.
  rung('p-spray', [
    [no('M0'), no('X9'), nc('X10'), cmp('<', 'D1', 'K2400'), cmp('>=', 'D0', 'K1900'), out('Y8')],
  ]),
  // Into the oven once the film is there, and only with somewhere to put it
  // afterward: the cure cannot be paused and the part has to come out.
  rung('p-oven', [
    [no('M0'), no('X9'), nc('X10'), cmp('>=', 'D1', 'K2400'), nc('X11'), out('Y9')],
  ]),
];

// --- SEC3 ASSEMBLY --------------------------------------------------------------------

/**
 * Final assembly, as commissioned.
 *
 * The station never takes a frame it cannot finish. Both parts are called in
 * together, on the one scan where the painted buffer holds one of each, so the
 * jig is either empty or building and never stuck holding half a machine
 * waiting for the other half. That single decision is what keeps the starve
 * latch out of this puzzle, and undoing it is what a later one is about.
 */
export const ASSEMBLY_PROGRAM: Rung[] = [
  rung('a-start', [[no('M0'), no('X12'), no('X13'), nc('M50'), set('M50')]]),
  // Both calls off one rung: an energized output passes power to its right, so
  // the frame and the boom are claimed on the same scan and cannot separate.
  rung('a-call', [[no('M50'), nc('T30'), out('Y10'), out('Y11')]]),
  rung('a-loaded', [[no('M50'), tmr('T30', 1)]]),
  // Engine, then cab, then boom. Each fitting is timed a little past what it
  // takes, and each waits on the one before it because the jig's interlocks say
  // so: no cab without an engine, no boom without a cab.
  rung('a-engine', [[no('M0'), no('T30'), nc('T31'), out('Y12')]]),
  rung('a-engine-timer', [[no('M0'), no('T30'), tmr('T31', 25)]]),
  rung('a-cab', [[no('M0'), no('T31'), nc('T32'), out('Y13')]]),
  rung('a-cab-timer', [[no('M0'), no('T31'), tmr('T32', 20)]]),
  // NC on M54 as well as on X14: the scan after the machine is released, X14
  // has gone false again and T32 is still standing done, so without it the jig
  // would pin a boom onto an empty fixture the moment it emptied.
  rung('a-boom', [[no('M0'), no('T32'), nc('X14'), nc('M54'), out('Y14')]]),
  // Release only into a test queue with room in it.
  rung('a-release', [[no('M0'), no('X14'), no('X15'), out('Y15'), set('M54')]]),
  // The step timers are reset by hand rather than left to fall out of M50
  // dropping. The very next scan can start another build, and it re-sets M50 in
  // rung 1 before rung 3 ever sees it low: without these the second machine
  // inherits three finished timers and the jig pins a boom onto an empty jig.
  rung('a-reset', [
    [no('M54'), nc('X14'), rst('T30'), rst('T31'), rst('T32'), rst('M50'), rst('M54')],
  ]),
];

// --- SEC4 TEST AND DISPATCH ---------------------------------------------------------

/**
 * Test and dispatch, as commissioned.
 *
 * Four rungs, and the whole station is one interlock: the function test may not
 * run until the hydraulics are up to pressure. K=15 is 1.5 s of pumping against
 * the 1.2 s the pack actually needs.
 */
export const TEST_PROGRAM: Rung[] = [
  rung('t-pump', [[no('M0'), no('X16'), out('Y16')]]),
  // NC on X18 so the timer clears the moment the test passes. The bay can pull
  // the next machine in on the same scan the last one drives off, and a pressure
  // timer still showing done from the previous machine would work the boom on a
  // dead circuit.
  rung('t-pressure', [[no('M0'), no('X16'), nc('X18'), tmr('T40', 15)]]),
  rung('t-cycle', [[no('M0'), no('T40'), nc('X18'), out('Y17')]]),
  // Drive it off into the yard, if the yard has a space for it.
  rung('t-dispatch', [[no('M0'), no('X18'), no('X17'), out('Y18')]]),
];

// --- The puzzle ------------------------------------------------------------------------

export const factorySupervisor: PuzzleSpec = {
  kind: 'ladder',
  slug: 'factory-supervisor',
  title: 'Excavator Plant: Commissioning',
  difficulty: 'tutorial',
  order: 47,
  category: 'factory',
  summary:
    'Meet the plant. Four stations already run; write the supervisor that decides whether they may.',
  briefing: [
    'A plant that builds 20 tonne excavators, in four stations: a weld shop, a paint shop,',
    'final assembly, and a test bay that drives every finished machine into the yard under',
    'its own hydraulics. Two part streams run through it. Frames and booms are welded and',
    'painted on the same line, and final assembly needs one of each to build anything at',
    'all, which is the problem this whole category is really about.',
    '',
    'None of that is yours today. The four stations are commissioned, running and open in',
    'their own windows, and you are welcome to read them. What is missing is the program',
    'above them: the one that decides whether the plant is allowed to run, and says so on',
    'one bit that all four stations are already wired to.',
    '',
    '## Sections and tasks',
    '- This puzzle is five programs, not one. Each station is a POU, a program organization',
    '  unit, with its own window. Open one from the tree on the left.',
    '- SUPERVISOR is yours. SEC1 to SEC4 ship written and are read only.',
    '- All five are called from one task, MAIN, every scan, in the order the tree shows:',
    '  supervisor first, then the four stations down the line. That order matters, and a',
    '  later puzzle will make you prove it.',
    '- The device space is flat, so each section is given a block of it to write to and',
    '  everything else is read only. Yours is M0 to M9, T0 to T3, and the two lamps.',
    '',
    '## Equipment',
    '- X0 START and X1 STOP on the plant panel. STOP is wired normally closed, so its bit',
    '  is on at rest and drops when the button is pressed.',
    '- X2 EMERGENCY STOP, also normally closed, and X3 AUTO, a maintained selector.',
    '- Y0 PLANT RUNNING, the green lamp, and Y1 LINE HELD, the amber one.',
    '- X8 WELD BUFFER FULL, X11 PAINT BUFFER FULL and X17 YARD SPACE are the three places',
    '  the line can back up. YARD SPACE reads the other way round from the other two: it is',
    '  on while there is still room.',
    '',
    '## The interface block',
    '- M0 PLANT RUN is the one bit you publish. Every station reads it and none of them',
    '  write it. With M0 off the plant does nothing at all.',
    '- Read the station programs and you will find M0 in series with almost every coil,',
    '  with one exception worth understanding: the weld clamp holds on regardless. A',
    '  fixture that opened on an emergency stop would drop a half welded frame on the',
    '  floor, so the torch stops and the grip does not.',
    '',
    '## Sequence of operation',
    '1. Latch M0 PLANT RUN from the START button and seal it in around itself.',
    '   a. STOP and EMERGENCY STOP both break the latch. Both are normally closed, so both',
    '      take an NO contact in series, not an NC one.',
    '   b. AUTO must be selected. In manual the plant may not start, and turning the',
    '      selector to manual while it is running stops it.',
    '2. Light Y0 PLANT RUNNING from M0.',
    '3. Light Y1 LINE HELD whenever the line is backing up: the weld buffer is full, or the',
    '   paint buffer is full, or the yard has no space left. Any one of the three.',
    '',
    '## Interlocks and safety',
    '- Nothing may restart on its own. Releasing STOP or the emergency stop must leave the',
    '  plant stopped until somebody presses START again. A seal-in gets this right for',
    '  free; a plain contact on START does not.',
    '- The emergency stop is a mushroom head and stays latched until it is twisted out. It',
    '  is drawn as a maintained switch on the panel for that reason.',
    '',
    '## Field notes',
    '- LINE HELD is information, not a fault. A full buffer is a line that is running well',
    '  enough to get ahead of itself, and every one of those bits is a real sensor the',
    '  station programs are already reading and acting on.',
    '- Watch the plant, not the ladder. The section buttons above the floor fly the camera',
    '  into one bay; the two lanes running across the middle of the shop are the painted',
    '  frames and the painted booms waiting for assembly, and a run where one lane fills',
    '  while the other stays empty is the failure this category exists to teach.',
    '- The first machine takes about thirty five seconds to reach the yard. Most of that is',
    '  the cure oven, which runs a fixed six seconds a part and cannot be hurried.',
    '',
    '## Acceptance',
    '- START does nothing in manual, and starts the plant in auto.',
    '- STOP and the emergency stop both drop PLANT RUNNING, and neither restarts the plant',
    '  when released.',
    '- An emergency stop part way through a weld leaves no damage, and the plant picks the',
    '  seam back up when it is started again.',
    '- Left running, the plant welds, paints, assembles and ships a complete excavator with',
    '  nothing jammed, blocked or scrapped.',
  ].join('\n'),
  hints: [
    'The run latch is one rung and you have built it before: two parallel rows, an NO ' +
      'contact on X0 in the first and an NO contact on M0 in the second, joined by a ' +
      'vertical link. Then NO contacts on X1, X2 and X3 in series, and an OUT coil on M0. ' +
      'X1 and X2 are normally closed field devices, so their bits are already on and an NO ' +
      'contact is what passes power at rest.',
    'X3 goes in series with the other two rather than in the seal branch, which is what ' +
      'makes turning the selector to manual stop a running plant instead of only ' +
      'preventing a start.',
    'The held lamp is three rows in one rung: NO on X8, NO on X11, and NC on X17, joined ' +
      'by vertical links into a single OUT coil on Y1. X17 is on while there IS space, so ' +
      'it is the one that takes an NC contact.',
    'If the plant runs but nothing moves, check that the coil is M0 and not something ' +
      'else. The four stations are wired to M0 by name, and the tree will tell you nobody ' +
      'is writing it.',
  ],
  devices: PLANT_DEVICES,
  registers: [
    { address: 'M0', label: 'Plant run', note: 'yours to write; all four stations read it' },
  ],
  // The union of what all five sections use. A shipped station is held to the
  // same allow-list the player is, so the list is the plant's, not the lesson's.
  allowedInstructions: [
    'contact-no',
    'contact-nc',
    'compare',
    'hwire',
    'coil-out',
    'coil-set',
    'coil-reset',
    'timer',
    'mov',
  ],
  processId: 'factory',
  pous: [
    {
      id: 'SUP',
      name: 'SUPERVISOR',
      title: 'Plant supervisor',
      editable: true,
      maxRungs: 8,
      owns: ['M0-M9', 'T0-T3', 'Y0', 'Y1'],
      brief: [
        'The program above the plant. Three rungs: a run latch, a running lamp and a held',
        'lamp.',
        '',
        '## Sequence of operation',
        '1. M0 PLANT RUN latches from X0 START, sealed in around itself, broken by X1 STOP',
        '   or X2 EMERGENCY STOP, and held only while X3 AUTO is selected.',
        '2. Y0 PLANT RUNNING follows M0.',
        '3. Y1 LINE HELD lights on X8 WELD BUFFER FULL, X11 PAINT BUFFER FULL, or the',
        '   absence of X17 YARD SPACE.',
        '',
        '## Field notes',
        '- X1 and X2 are normally closed, so both take NO contacts.',
        '- You own M0 to M9, T0 to T3, and the two lamps. Writing anything else is a',
        '  validation error, which is the whole discipline of sectioned code.',
      ].join('\n'),
    },
    {
      id: 'WELD',
      name: 'SEC1_WELD',
      title: 'Weld shop',
      editable: false,
      program: WELD_PROGRAM,
      owns: ['Y2-Y6', 'M10-M29', 'T10-T19', 'D10-D19'],
      brief: [
        'Clamp a blank, run the seam, release it onto the buffer rail. Frames and booms',
        'alternate strictly, because assembly needs one of each.',
        '',
        '## Sequence of operation',
        '1. M10 says which blank is next. Y6 SELECT BOOM follows it, and the fixture latches',
        '   the choice when it clamps.',
        '2. A cycle starts when M0 is on and X8 WELD BUFFER FULL is off.',
        '3. Y2 CLAMP holds for the whole cycle. X6 FIXTURE CLAMPED makes at 0.6 s.',
        '4. Y3 TORCH runs for T10, K=35, and only with X6 made.',
        '5. Y5 RELEASE runs until X6 drops, which is the fixture opening as the part leaves.',
        '6. That pulse flips M10, so the next blank is the other kind.',
        '',
        '## Interlocks and safety',
        '- The torch may not strike on an unclamped fixture. X6 in series with Y3.',
        '- The clamp ignores the plant run bit. Opening it mid seam would drop the part.',
      ].join('\n'),
    },
    {
      id: 'PAINT',
      name: 'SEC2_PAINT',
      title: 'Paint shop',
      editable: false,
      program: PAINT_PROGRAM,
      owns: ['Y7-Y9', 'D2', 'D3', 'M30-M49', 'T20-T29', 'D20-D29'],
      brief: [
        'Blast, spray and cure. The only station here with analog work in it, and the one',
        'that paces the whole plant.',
        '',
        '## Sequence of operation',
        '1. D2 HEATER COMMAND holds K=2200, which is 110 C, whether or not the line is',
        '   running. D3 GUN FLOW COMMAND holds K=4000, full flow.',
        '2. Y7 BOOTH INFEED pulls the next welded part in whenever the booth is empty and',
        '   the painted buffer is not full.',
        '3. Y8 SPRAY GUN runs until D1 FILM THICKNESS reaches K=2400, and only above K=1900',
        '   on D0 BOOTH TEMPERATURE.',
        '4. Y9 OVEN INFEED sends it to cure once the film is there.',
        '',
        '## Field notes',
        '- Paint only cross-links between 90 and 130 C. Sprayed cold it never sticks, and a',
        '  part whose booth drifts out of band during the six second bake comes out scrap.',
        '- The cure is a fixed dwell. No program can shorten it, which is why the only way',
        '  to a throughput target on this plant is to keep the other stations working while',
        '  the oven runs.',
      ].join('\n'),
    },
    {
      id: 'ASSY',
      name: 'SEC3_ASSEMBLY',
      title: 'Final assembly',
      editable: false,
      program: ASSEMBLY_PROGRAM,
      owns: ['Y10-Y15', 'M50-M69', 'T30-T39', 'D30-D39'],
      brief: [
        'Where the two streams meet. A painted frame and a painted boom become a machine.',
        '',
        '## Sequence of operation',
        '1. A build starts only when X12 FRAME READY and X13 BOOM READY are both on, and',
        '   both parts are called in on the same scan.',
        '2. Y12 LOWER ENGINE for T31, K=25. Then Y13 FIT CAB for T32, K=20. Then Y14 PIN',
        '   BOOM until X14 MACHINE COMPLETE.',
        '3. Y15 RELEASE TO TEST, but only with X15 TEST BAY CLEAR.',
        '',
        '## Interlocks and safety',
        '- No engine without a frame in the jig, no cab without the engine, no boom without',
        '  the cab. The jig trips on any of the three.',
        '- Taking a frame with no boom anywhere is not an interlock, it is a trap. The jig',
        '  will sit holding half a machine, and after fourteen seconds the run is a failure.',
        '  This program avoids it by never starting without both.',
      ].join('\n'),
    },
    {
      id: 'TEST',
      name: 'SEC4_TEST',
      title: 'Test and dispatch',
      editable: false,
      program: TEST_PROGRAM,
      owns: ['Y16-Y18', 'M70-M89', 'T40-T49', 'D40-D49'],
      brief: [
        'Pump it up, work the boom, drive it into the yard.',
        '',
        '## Sequence of operation',
        '1. Y16 HYDRAULIC PUMP runs whenever X16 MACHINE AT TEST is on.',
        '2. T40, K=15, gives the pack time to come up to pressure.',
        '3. Y17 FUNCTION TEST runs until X18 TEST PASSED.',
        '4. Y18 DISPATCH drives it off, if X17 YARD SPACE says there is room.',
        '',
        '## Interlocks and safety',
        '- The function test may not run before the hydraulics are up. Working the boom on',
        '  a dead circuit is how a test bay bends a stick.',
      ].join('\n'),
    },
  ],
  tasks: [
    {
      id: 'MAIN',
      name: 'MAIN',
      priority: 0,
      pous: ['SUP', 'WELD', 'PAINT', 'ASSY', 'TEST'],
    },
  ],
  taskAssignment: 'fixed',
  scenarios: [
    {
      name: 'The plant starts and stops',
      steps: [
        {
          label: 'In manual the start button does nothing',
          setInputs: { X0: true },
          holdMs: 1000,
          expect: { Y0: false },
          expectMachine: { jam: false },
        },
        {
          label: 'Select auto, with the button released',
          setInputs: { X0: false, X3: true },
          holdMs: 300,
          expect: { Y0: false },
        },
        {
          label: 'Press start and the plant runs',
          setInputs: { X0: true },
          holdMs: 300,
          expect: { Y0: true },
        },
        {
          label: 'Let go of the button and it stays running',
          setInputs: { X0: false },
          holdMs: 1000,
          expect: { Y0: true },
          expectMachine: { jam: false, running: true },
        },
        {
          label: 'Press stop',
          setInputs: { X1: false },
          holdMs: 300,
          expect: { Y0: false },
        },
        {
          label: 'Release it, and nothing restarts on its own',
          setInputs: { X1: true },
          holdMs: 1000,
          expect: { Y0: false },
        },
        {
          label: 'Back to manual with the plant already stopped, then start again in auto',
          setInputs: { X3: false, X0: true },
          holdMs: 500,
          expect: { Y0: false },
        },
        {
          label: 'Auto again, and the held button takes effect',
          setInputs: { X3: true },
          holdMs: 300,
          expect: { Y0: true },
        },
        {
          label: 'Turning the selector to manual stops a running plant',
          setInputs: { X0: false, X3: false },
          holdMs: 300,
          expect: { Y0: false },
        },
      ],
    },
    {
      name: 'The emergency stop drops the line',
      steps: [
        {
          label: 'Auto, start, and the weld shop clamps the first frame',
          setInputs: { X3: true, X0: true },
          holdMs: 4000,
          until: { bits: { X6: true } },
          expect: { Y0: true },
        },
        {
          label: 'Let the torch strike',
          setInputs: { X0: false },
          holdMs: 800,
          expect: { Y0: true, Y3: true },
        },
        {
          label: 'Hit the emergency stop: the torch goes out and the fixture keeps its grip',
          setInputs: { X2: false },
          holdMs: 500,
          expect: { Y0: false, Y3: false, Y2: true },
          expectMachine: { jam: false },
        },
        {
          label: 'Twist it out; the plant stays down until somebody presses start',
          setInputs: { X2: true },
          holdMs: 1000,
          expect: { Y0: false, Y3: false },
        },
        {
          label: 'Start again and the seam picks up where it stopped',
          setInputs: { X0: true },
          holdMs: 400,
          expect: { Y0: true },
        },
        {
          label: 'And the part comes off the fixture undamaged, into the paint booth',
          setInputs: { X0: false },
          holdMs: 12_000,
          until: { bits: { X9: true } },
          expectMachine: { jam: false, blocked: false, paintPart: 'f' },
        },
      ],
    },
    {
      name: 'The line reports when it backs up',
      steps: [
        {
          label: 'Auto and start, with nothing yet in any buffer',
          setInputs: { X3: true, X0: true },
          holdMs: 500,
          expect: { Y0: true, Y1: false },
        },
        {
          label: 'Run on until the weld shop gets three parts ahead of the paint booth',
          setInputs: { X0: false },
          holdMs: 45_000,
          until: { bits: { X8: true } },
          expect: { Y1: true },
          expectMachine: { jam: false, blocked: false },
        },
      ],
    },
    {
      name: 'One machine off the line',
      steps: [
        {
          label: 'Auto and start',
          setInputs: { X3: true, X0: true },
          holdMs: 500,
          expect: { Y0: true },
        },
        {
          label: 'A frame and a boom are welded, painted, married up, tested and driven off',
          setInputs: { X0: false },
          holdMs: 70_000,
          until: { machine: { shipped: 1 } },
          expectMachine: { jam: false, blocked: false, starved: false, scrapped: 0 },
        },
      ],
    },
  ],
};
