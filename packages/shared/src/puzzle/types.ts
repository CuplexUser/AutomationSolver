import type { ElementType } from '../ladder/types.js';

export type Difficulty = 'tutorial' | 'easy' | 'medium' | 'hard';

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

export interface ScenarioStep {
  label: string;
  /** X inputs set at the start of this step; persist until changed by a later step. */
  setInputs?: Record<string, boolean>;
  /** Simulated milliseconds to run before checking expectations. */
  holdMs: number;
  /** Expected device-bit states at the end of the step (Y/M/X/T/C). */
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

export interface PuzzleSpec {
  slug: string;
  title: string;
  difficulty: Difficulty;
  order: number;
  summary: string; // one-line teaser for the list
  briefing: string; // full goal description (plain text, newlines allowed)
  hints?: string[];
  devices: PuzzleDevice[];
  allowedInstructions: ElementType[];
  maxRungs?: number;
  /** Key into the process registry. Use 'passthrough' when no dynamics are needed. */
  processId: string;
  scenarios: Scenario[];
}

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
