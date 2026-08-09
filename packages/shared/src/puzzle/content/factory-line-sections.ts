import type { LadderProject, Pou, Rung, TaskDef } from '../../ladder/types.js';
import type { PouSlot } from '../types.js';
import { resolveProject } from '../symbols.js';
import { LINE_DEVICES, LINE_GLOBALS, LINE_OWNS, SUP_PROGRAM } from './factory-line-plant.js';
import {
  ASSEMBLY_PLAIN,
  ASSEMBLY_TUNED,
  CONV_PLAIN,
  CONV_TUNED,
  LINE_VARS,
  PAINT_PLAIN,
  PAINT_TUNED,
  STORE_PLAIN,
  STORE_TUNED,
  TEST_PLAIN,
  TEST_TUNED,
  WELD_PLAIN,
  WELD_TUNED,
} from './factory-line-programs.js';

/**
 * The seven sections of the excavator line, and who is writing which one today.
 *
 * Every puzzle from 48 on is the *same plant seen from a different desk*: the
 * weld puzzle opens the weld bay and ships the other six working, the paint
 * puzzle opens the booth and ships the weld bay. Written out per puzzle that
 * would be six copies of seven section briefs, and the first time one of them
 * was corrected the player would be commissioning a slightly different factory
 * depending on which puzzle they had reached.
 *
 * So the sections live here once and a puzzle says which one it is opening.
 */

export const LINE_SECTION_IDS = ['SUP', 'WELD', 'STORE', 'PAINT', 'ASSY', 'TEST', 'CONV'] as const;
export type LineSectionId = (typeof LINE_SECTION_IDS)[number];

/**
 * Scan order, and it is load bearing.
 *
 * The six stations decide what they want and the spine then moves everything,
 * which is why `CONV` is last rather than first: a zone drive written *above*
 * the station reading its eye would hand every station an image of the spine a
 * scan stale, and the plant's measured tempo is the tempo of this order.
 */
export const LINE_TASKS: TaskDef[] = [
  { id: 'MAIN', name: 'MAIN', priority: 0, pous: [...LINE_SECTION_IDS] },
];

interface SectionDef {
  name: string;
  title: string;
  /** What the section does, for the window the player is reading it in. */
  brief: string;
  /** Rungs when the puzzle ships this section working. */
  tuned: Rung[];
  /** Rungs when the puzzle seeds this section for the player to improve. */
  plain: Rung[];
  /** Headroom when the puzzle opens this section. */
  maxRungs: number;
}

const SECTIONS: Record<LineSectionId, SectionDef> = {
  SUP: {
    name: 'SUPERVISOR',
    title: 'Plant supervisor',
    tuned: SUP_PROGRAM,
    plain: SUP_PROGRAM,
    maxRungs: 8,
    brief: [
      'The program above the plant. A run latch, a running lamp, and an amber that says the',
      'line is backing up. PlantRun is a global: every section below reads it and none of them',
      'write it.',
      '',
      '## Sequence of operation',
      '1. PlantRun latches from X0 START, sealed in around itself, broken by X1 STOP or',
      '   X2 EMERGENCY STOP, and held only while X3 AUTO is selected.',
      '2. Y0 PLANT RUNNING follows PlantRun.',
      '3. Y1 LINE HELD lights on X10 WELD OUTFEED OCCUPIED, X22 PAINTED LANE FULL, or the',
      '   absence of X30 YARD SPACE.',
      '',
      '## Field notes',
      '- With PlantRun off the plant does nothing at all, with one exception: the weld clamp holds',
      '  on regardless, because a fixture that opened on an emergency stop would drop a half',
      '  welded frame on the floor.',
    ].join('\n'),
  },

  WELD: {
    name: 'SEC1_WELD',
    title: 'Weld bay',
    tuned: WELD_TUNED,
    plain: WELD_PLAIN,
    maxRungs: 24,
    brief: [
      'One fixture, one torch, one positioner and two kinds of blank. Clamp, lay the seams,',
      'roll the weldment off onto Z1.',
      '',
      '## Sequence of operation',
      '1. A selector bit says which blank is next. Y6 SELECT BOOM follows it, and the fixture',
      '   latches the choice when it clamps.',
      '2. Y2 CLAMP holds for the whole cycle. X6 FIXTURE CLAMPED makes at 0.4 s.',
      '3. Y3 TORCH lays the first pass with the positioner at A, X7.',
      '4. A frame is rolled over on Y4 ROTATE POSITIONER and takes a second pass at B, X8. A',
      '   boom is finished after the first.',
      '5. Y5 RELEASE rolls it onto Z1 as soon as that zone is running and clear.',
      '6. The release flips M10, so the next blank is the other kind.',
      '',
      '## Interlocks and safety',
      '- The torch may not strike on an unclamped fixture, and may not strike while the',
      '  positioner is still turning.',
      '- Y7 CHANGE TIP needs an empty fixture. A tip changed on a loaded one is a jam.',
    ].join('\n'),
  },

  STORE: {
    name: 'SEC2_STORE',
    title: 'Rack store and portal',
    tuned: STORE_TUNED,
    plain: STORE_PLAIN,
    maxRungs: 34,
    brief: [
      'Four gravity lanes two deep, and the portal robot that feeds the booth off them. The',
      'one place on the line where parts can leave in a different order from the one they',
      'arrived in.',
      '',
      '## Sequence of operation',
      '1. Y8 LOAD INTO LANE takes whatever is standing on Z3 into the lane D13 selects.',
      '   Frames go to lanes 1 and 2, booms to lanes 3 and 4.',
      '2. Y9 PICK FROM LANE draws the front part of the lane D14 selects onto the outfeed.',
      '   The picker takes a frame, then a boom, turn about, so the two painted lanes stay',
      '   level and the two halves of a machine keep the same color.',
      '3. The portal parks over the store. It lowers, makes vacuum, lifts, travels to the',
      '   booth, lowers again and breaks vacuum onto the skid.',
      '',
      '## Interlocks and safety',
      '- The portal may not travel with its head down, and may not let go with it up.',
      '- The loader can only lift off Z3 while Z3 is stopped. A part cannot be picked off a',
      '  moving belt.',
    ].join('\n'),
  },

  PAINT: {
    name: 'SEC3_PAINT',
    title: 'Spray booth and cure oven',
    tuned: PAINT_TUNED,
    plain: PAINT_PLAIN,
    maxRungs: 14,
    brief: [
      'Blast, spray to a film spec, bake. The only section with analog work in it, and the',
      'one setting the plant pace.',
      '',
      '## Sequence of operation',
      '1. D2 HEATER COMMAND holds K=2200, which is 110 C, running or not. D3 GUN FLOW',
      '   COMMAND holds K=4000.',
      '2. Y14 SPRAY GUN runs until D1 FILM THICKNESS reaches the target for the part in the',
      '   booth: K=2100 for a frame, K=1500 for a boom, which X20 BOOM IN BOOTH selects.',
      '3. Y16 PURGE GUN flushes to waste whenever D9 COLOR IN GUN is not D8 NEXT PAINT',
      '   COLOR. It runs alongside a blast, so a changeover costs nothing.',
      '4. Y15 OVEN INFEED sends the part to a free rack. The bake is a function of the film',
      '   that went on it.',
      '',
      '## Interlocks and safety',
      '- The gun may never spray and purge at once.',
      '- Paint only cross-links between 90 and 130 C. A booth that drifts out of band during',
      '  the bake has already spoiled the finish.',
    ].join('\n'),
  },

  ASSY: {
    name: 'SEC4_ASSEMBLY',
    title: 'Final assembly',
    tuned: ASSEMBLY_TUNED,
    plain: ASSEMBLY_PLAIN,
    maxRungs: 20,
    brief: [
      'Where the two streams meet. A painted frame and a painted boom become a machine, and',
      'they have to be the same color, because they are two halves of one order line.',
      '',
      '## Sequence of operation',
      '1. A build starts on a frame off the frame lane. Y17 CALL FRAME stands until D16 FRAME',
      '   IN JIG says the frame is in the jig.',
      '2. Y18 CALL BOOM claims a boom whose color matches, and the bench runs it up on Y21',
      '   MAKE UP BOOM while the engine goes in.',
      '3. Y19 LOWER ENGINE, then Y20 FIT CAB, then Y22 PIN BOOM.',
      '4. Y23 RELEASE TO TEST rolls it onto Z10 when that zone is running and clear.',
      '',
      '## Interlocks and safety',
      '- No engine without a frame, no cab without the engine, no pin without the cab and a',
      '  boom made up on the bench.',
      '- A boom pinned to a frame in a different color is a jam. So is a jig left holding',
      '  half a machine for sixteen seconds.',
      '- A lane has to be stopped for the jig to lift off it, and running for the sort to',
      '  push into it. That is the same coil asked for two opposite things.',
    ].join('\n'),
  },

  TEST: {
    name: 'SEC5_TEST',
    title: 'Test bay and dock',
    tuned: TEST_TUNED,
    plain: TEST_PLAIN,
    maxRungs: 14,
    brief: [
      'Pump it up, work every function, drive it into the yard. Then get a lorry to the dock',
      'before the yard fills, because a full yard stops the line from the far end.',
      '',
      '## Sequence of operation',
      '1. Y24 HYDRAULIC PUMP runs while X28 MACHINE AT TEST is on. A timer at K=18 gives the',
      '   pack time to come up.',
      '2. Y25 FUNCTION TEST runs until X29 TEST PASSED.',
      '3. Y26 DISPATCH drives it onto Z12, with the pump dropped first.',
      '4. Y27 CALL TRUCK sends for a lorry and holds it on the dock while it loads.',
      '',
      '## Interlocks and safety',
      '- The function test may not run before the hydraulics are up.',
      '- The bay couples through a quick release, and a quick release dragged off the pad',
      '  under pressure comes away with the hose in it.',
      '',
      '## Field notes',
      '- A lorry takes ten seconds to arrive and the dock will not take another for a',
      '  rotation after one leaves. Everything about this station is a question of when.',
    ].join('\n'),
  },

  CONV: {
    name: 'SEC6_CONVEYOR',
    title: 'Zoned conveyor',
    tuned: CONV_TUNED,
    plain: CONV_PLAIN,
    maxRungs: 20,
    brief: [
      'Twelve zones of zero pressure accumulation, one photo-eye and one drive on each, and',
      'the diverter at the sort that reads a part and sends it down its own lane.',
      '',
      '## Sequence of operation',
      '1. Each zone drive runs its own belt. A part only enters a zone while that zone is',
      '   running and clear, so a program does not push parts along the spine, it decides',
      '   which stretches of belt are turning.',
      '2. At the sort, X44 BOOM AT SORT says what is standing on Z7. Y40 and Y41 paddle it',
      '   into the frame lane or the boom lane.',
      '3. D18 PARTS ON SPINE and D19 BLOCKED AT ZONE are gauges. D19 names the zone at the',
      '   head of the queue, which is the station holding the line up.',
      '',
      '## Interlocks and safety',
      '- Nothing faults. A drive called with a full zone in front simply turns under a part',
      '  that is going nowhere.',
      '- Both paddles at once is a genuine crash: the part goes between the lanes.',
      '- A lane has to be turning to take a part from the paddle, so a divert is two coils.',
    ].join('\n'),
  },
};

/** How a puzzle wants one section set up. */
export interface SectionOptions {
  /** Sections the player writes. Everything else ships working and read only. */
  open: LineSectionId[];
  /**
   * Ship the *plain* program in these sections rather than the tuned one.
   *
   * The capstone seeds all six stations plain and opens all six, because there
   * the plant is the puzzle. A station puzzle ships tuned neighbors, so the bay
   * under test really is the one holding the line up.
   */
  seedPlain?: boolean;
}

/**
 * The seven section slots, with the named ones opened up.
 *
 * An opened section starts from a blank page unless `seedPlain` says otherwise,
 * in which case it starts from the program somebody already left in it.
 */
export function lineSections(opts: SectionOptions): PouSlot[] {
  const open = new Set<LineSectionId>(opts.open);
  return LINE_SECTION_IDS.map((id): PouSlot => {
    const def = SECTIONS[id];
    const editable = open.has(id);
    // A shipped section is always the tuned one. Seeding plain is for a section
    // the player is being handed, where the point is to read it and do better.
    const program = editable ? (opts.seedPlain ? def.plain : undefined) : def.tuned;
    // Declarations travel with the program that uses them, and only with it. A
    // section handed over blank ships none: its storage is the player's to name,
    // and a table of latches for a program they have not written yet would be
    // the answer rather than the puzzle.
    const vars = program ? LINE_VARS[id] : undefined;
    return {
      id,
      name: def.name,
      title: def.title,
      editable,
      ...(program ? { program } : {}),
      ...(vars && vars.length > 0 ? { vars: vars.map((v) => ({ ...v })) } : {}),
      ...(editable ? { maxRungs: def.maxRungs } : {}),
      owns: [...LINE_OWNS[id]],
      brief: def.brief,
    };
  });
}

/**
 * The whole plant as one runnable project: seven sections, one task, resolved.
 *
 * Not a puzzle and not graded — this is how the line is driven by the things
 * that are *not* a submission: the soak tests, the tempo harness and the
 * client's dev preview. All three built a `SimEngine` out of raw rungs by hand
 * until the programs were written in names, at which point the missing
 * resolution pass stopped being a duplication and started being a bug. So there
 * is one function, and it resolves against the plant's own symbol table.
 *
 * A section left out falls back to the tuned program, since the interesting
 * runs are "everything tuned but this one".
 */
export function lineProject(sections: Partial<Record<LineSectionId, Rung[]>>): LadderProject {
  const pous: Pou[] = LINE_SECTION_IDS.map((id): Pou => {
    const vars = LINE_VARS[id];
    return {
      id,
      name: SECTIONS[id].name,
      rungs: id === 'SUP' ? SUP_PROGRAM : (sections[id] ?? SECTIONS[id].tuned),
      ...(vars && vars.length > 0 ? { vars: vars.map((v) => ({ ...v })) } : {}),
    };
  });
  const project: LadderProject = {
    pous,
    tasks: LINE_TASKS.map((task) => ({ ...task })),
    globals: LINE_GLOBALS.map((v) => ({ ...v })),
  };
  return resolveProject({ symbols: 'optional', devices: LINE_DEVICES }, project).project;
}
