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
  | 'pick-place';

/** Display order of category sections on the puzzle list. */
export const CATEGORY_ORDER: readonly PuzzleCategory[] = [
  'basics',
  'timers-counters',
  'stations',
  'elevator',
  'control-cabinet',
  'packaging',
  'pick-place',
];

export const CATEGORY_TITLES: Record<PuzzleCategory, string> = {
  basics: 'Basics',
  'timers-counters': 'Timers & Counters',
  stations: 'Stations',
  elevator: 'Elevator',
  'control-cabinet': 'Control Cabinet',
  packaging: 'Packaging Machine',
  'pick-place': 'Pick & Place',
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

export interface ScenarioStep {
  label: string;
  /** Input bits set at the start of this step; persist until changed by a later step. */
  setInputs?: Record<string, boolean>;
  /** Simulated milliseconds to run before checking expectations. */
  holdMs: number;
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
