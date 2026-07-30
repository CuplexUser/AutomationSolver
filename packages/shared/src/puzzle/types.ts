import type { ElementType } from '../ladder/types.js';
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
  | 'drill';

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
};

/** How a device is drawn/driven on the HMI panel. */
export type WidgetType =
  | 'momentary' // push button (spring return)
  | 'toggle' // maintained switch
  | 'estop' // emergency stop (NC, maintained, latching visual)
  | 'selector' // 2-position selector
  | 'lamp' // indicator lamp
  | 'motor' // motor / rotating machine
  | 'sensor'; // read-only field sensor (driven by the process model)

export interface PuzzleDevice {
  address: string; // "X0", "Y0" ...
  label: string;
  io: 'input' | 'output';
  widget: WidgetType;
  /** Field device wired normally-closed: physical rest state = energized (true). */
  normallyClosed?: boolean;
  /** Lamp/motor color hint for the HMI. */
  color?: string;
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

/** A classic PLC puzzle: the player writes a ladder program. */
export interface LadderPuzzleSpec extends PuzzleSpecBase {
  kind: 'ladder';
  /** Internal working registers (M/T/C) the puzzle expects — surfaced as an IO list. */
  registers?: PuzzleRegister[];
  allowedInstructions: ElementType[];
  maxRungs?: number;
  /** Key into the process registry. Use 'passthrough' when no dynamics are needed. */
  processId: string;
}

/** A control-cabinet puzzle: the player wires terminals of fixed components. */
export interface CabinetPuzzleSpec extends PuzzleSpecBase {
  kind: 'cabinet';
  cabinet: CabinetLayout;
  maxWires?: number;
}

export type PuzzleSpec = LadderPuzzleSpec | CabinetPuzzleSpec;

/** Default rest state of every input, honoring normally-closed wiring. */
export function defaultInputs(devices: PuzzleDevice[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const d of devices) {
    if (d.io === 'input') out[d.address] = d.normallyClosed === true;
  }
  return out;
}

export function inputDevices(spec: PuzzleSpec): PuzzleDevice[] {
  return spec.devices.filter((d) => d.io === 'input');
}

export function outputDevices(spec: PuzzleSpec): PuzzleDevice[] {
  return spec.devices.filter((d) => d.io === 'output');
}
