import type { ElementType, LadderProgram, Rung, TaskDef } from '../ladder/types.js';
import type { CabinetLayout } from '../circuit/types.js';

export type Difficulty = 'tutorial' | 'easy' | 'medium' | 'hard';

export type PuzzleCategory =
  | 'basics'
  | 'timers-counters'
  | 'stations'
  | 'elevator'
  | 'control-cabinet'
  | 'packaging'
  | 'pick-place'
  | 'drill'
  | 'process-control'
  | 'motion'
  | 'warehouse';

/** Display order of category sections on the puzzle list. */
export const CATEGORY_ORDER: readonly PuzzleCategory[] = [
  'basics',
  'timers-counters',
  'stations',
  'elevator',
  'control-cabinet',
  'packaging',
  'pick-place',
  'drill',
  'process-control',
  'motion',
  'warehouse',
];

export const CATEGORY_TITLES: Record<PuzzleCategory, string> = {
  basics: 'Basics',
  'timers-counters': 'Timers & Counters',
  stations: 'Stations',
  elevator: 'Elevator',
  'control-cabinet': 'Control Cabinet',
  packaging: 'Packaging Machine',
  'pick-place': 'Pick & Place',
  drill: 'Drill Station',
  'process-control': 'Process Control',
  motion: 'Motion Control',
  warehouse: 'Automated Warehouse',
};

/** One-line blurb per category for the puzzle-list section headers / nav. */
export const CATEGORY_BLURBS: Record<PuzzleCategory, string> = {
  basics: 'Contacts, coils and seal-in logic.',
  'timers-counters': 'On-delay, off-delay, oscillators and counting.',
  stations: 'Sequenced single-station machines.',
  elevator: 'Multi-floor dispatch and door interlocks.',
  'control-cabinet': 'Wire real 400 V starters terminal to terminal.',
  packaging: 'Group boxes 2 → 4 → 16 with pushers, a flipping lift and an out-feed.',
  'pick-place': 'Index a robot arm between an infeed and a tray, one part at a time.',
  drill: 'Clamp, spin up, drill and sort mixed stock through one automatic station.',
  'process-control':
    'Analog signals and regulators: scale a transmitter, then hold a level on setpoint.',
  motion:
    'Speed references, ramp parameters and stopping distance on a drive that carries a load.',
  warehouse:
    'One stacker crane, eight rack slots and two production lines that both want feeding.',
};

/** How a device is drawn/driven on the HMI panel. */
export type WidgetType =
  | 'momentary' // push button (spring return)
  | 'toggle' // maintained switch
  | 'estop' // emergency stop (NC, maintained, latching visual)
  | 'selector' // 2-position selector
  | 'lamp' // indicator lamp
  | 'motor' // motor / rotating machine
  | 'sensor' // read-only field sensor (driven by the process model)
  | 'gauge' // analog reading, dial
  | 'bar' // analog reading, bar graph
  | 'trend'; // analog reading, strip chart over time

export interface PuzzleDevice {
  address: string; // "X0", "Y0", or a "D0" register for analog signals
  label: string;
  io: 'input' | 'output';
  widget: WidgetType;
  /** Field device wired normally-closed: physical rest state = energized (true). */
  normallyClosed?: boolean;
  /** Lamp/motor color hint for the HMI. */
  color?: string;
  /**
   * Word device rather than a bit: `address` is a D register carrying raw
   * counts. Inputs are written by the process model, outputs are read by it.
   */
  signal?: 'digital' | 'analog';
  /** Analog only: raw count range and what those counts mean in the field. */
  range?: AnalogRange;
}

/**
 * How to read an analog device's raw counts.
 *
 * The register always holds counts, because that is what the card gives the CPU;
 * `min`/`max`/`units` say what they represent so the HMI can label the gauge in
 * engineering units without the *program* ever being handed pre-scaled values.
 */
export interface AnalogRange {
  /** Raw count at `min` (almost always 0). */
  countMin: number;
  /** Raw count at `max` (4000 on the FX analog cards these puzzles model). */
  countMax: number;
  min: number;
  max: number;
  units: string;
  /** Decimals to show when displaying the scaled value. */
  decimals?: number;
}

/** Scale raw counts into engineering units, for display only. */
export function scaleCounts(counts: number, range: AnalogRange): number {
  const span = range.countMax - range.countMin;
  if (span === 0) return range.min;
  const t = (counts - range.countMin) / span;
  return range.min + t * (range.max - range.min);
}

export function isAnalog(device: PuzzleDevice): boolean {
  return device.signal === 'analog';
}

/**
 * An internal working device (M relay, T timer, C counter) a puzzle expects the
 * player to use. Unlike PuzzleDevice these are not wired to the HMI — they exist
 * only inside the program — but harder puzzles still need them spelled out in a
 * list rather than buried in the briefing prose.
 */
export interface PuzzleRegister {
  address: string; // "M0", "T0", "C0"
  label: string; // what it represents, e.g. "Run latch"
  note?: string; // preset / usage hint, e.g. "preset K20 = 2.0 s"
}

/**
 * A point the run has to reach: bit states and/or machine-state props that must
 * all hold at the same instant.
 */
export interface ScenarioCondition {
  /** Device/register bits (ladder addresses or cabinet component ids). */
  bits?: Record<string, boolean>;
  /** Machine-state props reported by the process model. */
  machine?: Record<string, string | number | boolean>;
  /** D-register values, as an inclusive range in raw counts. */
  analog?: Record<string, AnalogBound>;
}

/** An inclusive band a register has to be inside. Either end may be open. */
export interface AnalogBound {
  min?: number;
  max?: number;
}

/**
 * A control-quality assertion, evaluated over the *whole* step rather than at
 * its final instant.
 *
 * This is what separates an analog exercise from a sequencing one: a loop that
 * happens to be sitting on setpoint when the clock runs out has not been shown
 * to work, and a loop that got there via a 40 % overshoot is a loop that would
 * have put product on the floor. So the step asks for a value held inside a band
 * for a stretch of time, and can additionally cap the worst excursion along the
 * way.
 */
export interface ControlSpec {
  /** Register carrying the process value, in raw counts. */
  device: string;
  /** Target, in the same raw counts. */
  setpoint: number;
  /** Half-width of the acceptable band, in counts. */
  band: number;
  /** The value must stay inside the band this long, ending at the step's end. */
  settleMs: number;
  /** Cap on the worst excursion past setpoint during the step, in counts. */
  maxOvershoot?: number;
  /**
   * Cap on the final offset from setpoint. Left open on the P-control puzzle —
   * droop is the lesson there, not the failure.
   */
  maxSteadyError?: number;
}

export interface ScenarioStep {
  label: string;
  /** Input bits set at the start of this step; persist until changed by a later step. */
  setInputs?: Record<string, boolean>;
  /**
   * Simulated milliseconds to run before checking expectations. When `until` is
   * set this is the deadline instead: the step ends as soon as the milestone is
   * reached, and only a run that never reaches it uses the whole budget (and
   * fails).
   */
  holdMs: number;
  /**
   * Milestone to run to, rather than checking at a fixed deadline.
   *
   * Sequential machines are paced by the program driving them, so two equally
   * correct solutions can reach the same milestone hundreds of ms apart (start
   * the spindle with the clamp or once CLAMPED is in; keep the front end
   * filling during a flip or wait for the flip to finish). Asserting at a hard
   * deadline turns that legitimate difference into a wall of failures, so
   * anything the program's own pace controls waits for the milestone and
   * asserts there.
   */
  until?: ScenarioCondition;
  /**
   * Extra run time after `until` is reached, before the expectations are
   * checked — for "and it is still like that a moment later" assertions such as
   * the drill holding its dwell at the bottom of the stroke.
   */
  thenHoldMs?: number;
  /** Expected device-bit states at the end of the step (ladder addresses or cabinet component ids). */
  expect?: Record<string, boolean>;
  /** Expected machine-state props at the end of the step. */
  expectMachine?: Record<string, string | number | boolean>;
  /** Expected D-register bands at the end of the step, in raw counts. */
  expectAnalog?: Record<string, AnalogBound>;
  /** Control quality demanded across the step. */
  control?: ControlSpec;
}

export interface Scenario {
  name: string;
  description?: string;
  /** Initial X input overrides before step 0 (on top of NC rest defaults). */
  initialInputs?: Record<string, boolean>;
  steps: ScenarioStep[];
  /**
   * Simulated ms a well-paced program takes to run this scenario end to end.
   *
   * Correctness alone is a pass: a program that drives the machine safely and
   * hits every milestone is solved and unlocks what comes next, however
   * leisurely it is. Throughput is then graded on top, because on a real line
   * an un-pipelined cycle is a worse program even when it never faults. Full
   * marks at or under par, tapering to none at `PAR_SLACK` times par.
   *
   * Omit it where pace is not a design goal (every puzzle without machine
   * dynamics); those scenarios simply score full throughput marks.
   */
  parMs?: number;
  /**
   * Control-quality target: integral of absolute error in count-seconds,
   * summed over every step that declares a `control` spec.
   *
   * It takes the same 15 marks `parMs` does and runs through the same taper, so
   * an analog puzzle scores on how *well* the loop held rather than on how fast
   * it finished — for a regulator those are the same question. Declare one or
   * the other, not both.
   */
  parIae?: number;
}

interface PuzzleSpecBase {
  slug: string;
  title: string;
  difficulty: Difficulty;
  order: number;
  /** Unlock/grouping category. The first puzzle of each category is always unlocked. */
  category: PuzzleCategory;
  summary: string; // one-line teaser for the list
  briefing: string; // full goal description (plain text, newlines allowed)
  hints?: string[];
  /** HMI devices — both puzzle kinds drive/observe these on the operator panel. */
  devices: PuzzleDevice[];
  scenarios: Scenario[];
}

/**
 * A worked run of the machine the player can watch before writing anything.
 *
 * A briefing can describe a stacker crane; it cannot show one arriving. So the
 * puzzle may ship a reference program and the name of a scenario to run it
 * through, and the client plays the resulting trace back through the same
 * replay machinery a graded submission uses - the 3D machine, the operator
 * panel and the readouts all live, and the ladder deliberately dark. The player
 * sees what the machine does, not how the rungs are drawn.
 *
 * Reserve it for the puzzle that introduces a machine. Once the player has seen
 * the thing move, a demo of the next job is just the answer.
 */
export interface PuzzleDemo {
  /** Which of the puzzle's own scenarios to run, by name. */
  scenario: string;
  /** One line saying what is about to be shown. */
  caption: string;
  /** The program that drives it. Graded alongside the canonical solutions. */
  program: LadderProgram;
}

/**
 * One section of a multi-POU puzzle.
 *
 * A plant is too much program to hand over in one piece, so a puzzle can ship
 * some sections already working and open only the ones it is teaching. That is
 * what makes a five-POU factory a fair first puzzle rather than a wall: the
 * first one opens the supervisor and runs the four stations for you, and each
 * puzzle after it takes one more away.
 */
export interface PouSlot {
  id: string;
  /** Program name in the tree, e.g. `SEC2_PAINT`. */
  name: string;
  /** Human title for the window and the section brief, e.g. `Paint shop`. */
  title: string;
  /** The player writes this one. Otherwise it ships pre-written and read-only. */
  editable: boolean;
  /** The rungs this section ships with. Required when `editable` is false. */
  program?: Rung[];
  maxRungs?: number;
  /**
   * Device ranges this POU may write, as `M120-M139` or a bare `M16`.
   *
   * The device space is flat, so nothing stops section 2 latching section 3's
   * working relay — except that on a real plant it is the bug nobody finds for a
   * week. Declaring the ownership makes it a validation error instead, which is
   * the whole discipline of splitting a program into sections. Omit to let a POU
   * write anywhere.
   */
  owns?: string[];
  /** This section's page of the instruction manual, in the briefing's format. */
  brief?: string;
}

/** A classic PLC puzzle: the player writes a ladder program. */
export interface LadderPuzzleSpec extends PuzzleSpecBase {
  kind: 'ladder';
  /** Internal working registers (M/T/C) the puzzle expects — surfaced as an IO list. */
  registers?: PuzzleRegister[];
  allowedInstructions: ElementType[];
  maxRungs?: number;
  /** Key into the process registry. Use 'passthrough' when no dynamics are needed. */
  processId: string;
  /** A run of the machine the player can watch before starting. */
  demo?: PuzzleDemo;
  /**
   * The sections this puzzle is programmed in. Present = a multi-POU puzzle,
   * which is also what selects the workspace layout on the client.
   */
  pous?: PouSlot[];
  /** The task set the puzzle declares. Required alongside `pous`. */
  tasks?: TaskDef[];
  /**
   * Whether the player may move POUs between tasks and reorder them.
   *
   * `fixed` (the default) grades the schedule the puzzle declared; `player`
   * hands over the task configuration, which is the capstone's job — where the
   * supervisor placed last, or an interlock parked in the slow task, is the
   * failure the scenario is built to catch.
   */
  taskAssignment?: 'fixed' | 'player';
}

/** A control-cabinet puzzle: the player wires terminals of fixed components. */
export interface CabinetPuzzleSpec extends PuzzleSpecBase {
  kind: 'cabinet';
  cabinet: CabinetLayout;
  maxWires?: number;
}

export type PuzzleSpec = LadderPuzzleSpec | CabinetPuzzleSpec;

/** Default rest state of every input bit, honoring normally-closed wiring. */
export function defaultInputs(devices: PuzzleDevice[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const d of devices) {
    if (d.io === 'input' && !isAnalog(d)) out[d.address] = d.normallyClosed === true;
  }
  return out;
}

export function inputDevices(spec: PuzzleSpec): PuzzleDevice[] {
  return spec.devices.filter((d) => d.io === 'input' && !isAnalog(d));
}

export function outputDevices(spec: PuzzleSpec): PuzzleDevice[] {
  return spec.devices.filter((d) => d.io === 'output' && !isAnalog(d));
}

/** Analog devices in either direction, in declaration order. */
export function analogDevices(spec: PuzzleSpec): PuzzleDevice[] {
  return spec.devices.filter(isAnalog);
}
