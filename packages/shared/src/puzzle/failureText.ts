import { scaleCounts, type AnalogBound, type ControlSpec, type PuzzleDevice } from './types.js';

/**
 * Player-facing wording for a failed scenario assertion.
 *
 * The grader used to emit raw assertion dumps ("Y1 expected ON but was OFF",
 * "machine.jam expected false but was true"), which read like test output and
 * say nothing about what the machine actually did. These builders turn the same
 * facts into sentences that name the field device and, for a jam, say when it
 * happened and what broke. House style applies: no em dashes.
 */

const onOff = (v: boolean): string => (v ? 'ON' : 'OFF');

/** "Drill Feed (Y1)" when the puzzle labels the address, plain "Y1" otherwise. */
export function deviceName(address: string, devices: readonly PuzzleDevice[]): string {
  const label = devices.find((d) => d.address === address)?.label;
  return label ? `${label} (${address})` : address;
}

export function describeBitFailure(
  address: string,
  expected: boolean,
  actual: boolean,
  devices: readonly PuzzleDevice[],
): string {
  return `${deviceName(address, devices)} should be ${onOff(expected)} at this point, but it was ${onOff(actual)}.`;
}

/** "Drill Feed (Y1) to come ON" — the thing a timed-out step was waiting for. */
export function describeBitWait(
  address: string,
  expected: boolean,
  devices: readonly PuzzleDevice[],
): string {
  return `${deviceName(address, devices)} to ${expected ? 'come ON' : 'go OFF'}`;
}

/** Where and why a run jammed, so a later step can point back at the cause. */
export interface JamOnset {
  tMs: number;
  stepLabel: string;
  reason?: string;
  /** True when the jam happened inside the step now being reported. */
  sameStep: boolean;
}

const seconds = (tMs: number): string => `${(tMs / 1000).toFixed(1)} s`;

export function describeJamFailure(onset?: JamOnset): string {
  const tail = 'A jam freezes the machine, so nothing after it ran.';
  if (!onset) return `The machine jammed during this run. ${tail}`;
  const where = onset.sameStep
    ? `The machine jammed ${seconds(onset.tMs)} into the run`
    : `The machine jammed ${seconds(onset.tMs)} into the run, back in "${onset.stepLabel}"`;
  return onset.reason ? `${where}: ${onset.reason}. ${tail}` : `${where}. ${tail}`;
}

/** Counters that describe output the machine has produced so far. */
const PRODUCED: Record<string, [string, string]> = {
  good: ['good part', 'good parts'],
  bad: ['spoiled part', 'spoiled parts'],
  scrap: ['scrapped part', 'scrapped parts'],
  placed: ['part in the tray', 'parts in the tray'],
  finished: ['finished pack', 'finished packs'],
};

/** Counters that describe how much is sitting somewhere right now. */
const HELD: Record<string, string> = {
  sec2: 'The 4-pack station (section 2)',
  sec3: 'The 16-pack station (section 3)',
  sec4: 'The out-feed station (section 4)',
  liftLoad: 'The lift platform',
};

const SLOT = /^slot([1-9])$/;

const count = (n: number, [one, many]: [string, string]): string =>
  n === 0 ? `no ${many}` : n === 1 ? `1 ${one}` : `${n} ${many}`;

const boxes = (n: number): string => (n === 0 ? 'no boxes' : n === 1 ? '1 box' : `${n} boxes`);

const MOTOR_DIRECTION: Record<string, string> = {
  fwd: 'running forwards',
  rev: 'running in reverse',
  off: 'stopped',
  stop: 'stopped',
};

const direction = (v: unknown): string =>
  typeof v === 'string' ? (MOTOR_DIRECTION[v] ?? `"${v}"`) : 'stopped';

/**
 * Sentence for a failed `expectMachine` entry. `jam` is special: the interesting
 * facts (when, why) live in `onset` rather than in the boolean itself.
 */
export function describeMachineFailure(
  key: string,
  expected: number | boolean | string,
  actual: unknown,
  onset?: JamOnset,
): string {
  if (key === 'jam') {
    return expected === true
      ? 'The machine was expected to jam here, but it kept running.'
      : describeJamFailure(onset);
  }

  if (key === 'shorted') {
    return expected === true
      ? 'This step expects a short circuit, but the circuit stayed healthy.'
      : 'The wiring short circuited and blew the fuse.';
  }

  if (key === 'M1_direction') {
    return `The motor should be ${direction(expected)} at this point, but it was ${direction(actual)}.`;
  }

  const produced = PRODUCED[key];
  if (produced && typeof expected === 'number') {
    const had = typeof actual === 'number' ? actual : 0;
    const got = had === 0 ? 'none' : String(had);
    return `The machine should have produced ${count(expected, produced)} by now, but it has produced ${got}.`;
  }

  const held = HELD[key];
  if (held && typeof expected === 'number') {
    const had = typeof actual === 'number' ? actual : 0;
    return `${held} should be holding ${boxes(expected)} at this point, but it held ${boxes(had)}.`;
  }

  const slot = SLOT.exec(key);
  if (slot) {
    return expected === true
      ? `Tray slot ${slot[1]} should be full at this point, but it was empty.`
      : `Tray slot ${slot[1]} should be empty at this point, but it held a part.`;
  }

  if (typeof expected === 'boolean') {
    return `${key} should be ${expected ? 'true' : 'false'} at this point, but it was ${actual === true ? 'true' : 'false'}.`;
  }
  return `${key} should be ${String(expected)} at this point, but it was ${String(actual)}.`;
}

/** "the machine to produce 3 good parts" — for a milestone that was never reached. */
export function describeMachineWait(key: string, expected: number | boolean | string): string {
  if (key === 'jam') return expected === true ? 'the machine to jam' : 'the machine to run clear';

  const produced = PRODUCED[key];
  if (produced && typeof expected === 'number') {
    return `the machine to produce ${count(expected, produced)}`;
  }

  const held = HELD[key];
  if (held && typeof expected === 'number') {
    return `${held.replace(/^The /, 'the ')} to be holding ${boxes(expected)}`;
  }

  const slot = SLOT.exec(key);
  if (slot) return `tray slot ${slot[1]} to ${expected === true ? 'fill' : 'empty'}`;

  return `${key} to be ${String(expected)}`;
}

/** "A and B", "A, B and C" — player-facing lists, never a bare comma run. */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * A step that waits for a milestone and never gets there. Says what the run was
 * waiting for and how long it waited, which is far more useful than the
 * end-of-window bit dump a fixed-deadline step produces.
 */
export function describeTimeout(waits: readonly string[], timeoutMs: number): string {
  return `Waited ${seconds(timeoutMs)} for ${joinAnd(waits)}, but the machine never got there.`;
}

/**
 * Analog wording.
 *
 * Registers hold raw counts, but nobody thinks in counts, so every number a
 * player reads is rendered in the device's engineering units when the puzzle
 * declared a range. "52.4 % (2096 counts)" keeps both: the unit you reason in,
 * and the number you would actually see in the register monitor.
 */
function analogValue(
  address: string,
  counts: number,
  devices: readonly PuzzleDevice[],
): string {
  const range = devices.find((d) => d.address === address)?.range;
  if (!range) return `${counts}`;
  const decimals = range.decimals ?? 1;
  return `${scaleCounts(counts, range).toFixed(decimals)} ${range.units} (${counts} counts)`;
}

function boundText(
  address: string,
  bound: AnalogBound,
  devices: readonly PuzzleDevice[],
): string {
  const lo = bound.min === undefined ? undefined : analogValue(address, bound.min, devices);
  const hi = bound.max === undefined ? undefined : analogValue(address, bound.max, devices);
  if (lo !== undefined && hi !== undefined) return `between ${lo} and ${hi}`;
  if (lo !== undefined) return `at least ${lo}`;
  if (hi !== undefined) return `no more than ${hi}`;
  return 'any value';
}

export function describeAnalogFailure(
  address: string,
  bound: AnalogBound,
  actual: number,
  devices: readonly PuzzleDevice[],
): string {
  return (
    `${deviceName(address, devices)} should be ${boundText(address, bound, devices)} at this ` +
    `point, but it read ${analogValue(address, actual, devices)}.`
  );
}

export function describeAnalogWait(
  address: string,
  bound: AnalogBound,
  devices: readonly PuzzleDevice[],
): string {
  return `${deviceName(address, devices)} to come ${boundText(address, bound, devices)}`;
}

/** What a control step measured, for the failure sentences below. */
export interface ControlOutcome {
  settledMs: number;
  overshoot: number;
  finalError: number;
  final: number;
}

/**
 * Why a control step failed. Reported one reason at a time and in the order a
 * technician would look at them: did it get there at all, did it get there
 * violently, did it get there properly.
 */
export function describeControlFailures(
  spec: ControlSpec,
  outcome: ControlOutcome,
  devices: readonly PuzzleDevice[],
): string[] {
  const name = deviceName(spec.device, devices);
  const value = (counts: number): string => analogValue(spec.device, counts, devices);
  const band = `${value(spec.setpoint)} plus or minus ${spec.band} counts`;
  const failures: string[] = [];

  if (outcome.settledMs < spec.settleMs) {
    failures.push(
      outcome.settledMs === 0
        ? `${name} never settled inside ${band}. It finished at ${value(outcome.final)}.`
        : `${name} only held inside ${band} for ${seconds(outcome.settledMs)} at the end of ` +
          `this step, and ${seconds(spec.settleMs)} was asked for.`,
    );
  }
  if (spec.maxOvershoot !== undefined && outcome.overshoot > spec.maxOvershoot) {
    failures.push(
      `${name} overshot the setpoint by ${outcome.overshoot} counts, and the limit is ` +
        `${spec.maxOvershoot}. Back the gain off, or start slowing down sooner.`,
    );
  }
  if (spec.maxSteadyError !== undefined && outcome.finalError > spec.maxSteadyError) {
    failures.push(
      `${name} came to rest ${outcome.finalError} counts from setpoint, and the limit is ` +
        `${spec.maxSteadyError}. A proportional term alone always leaves an offset like this.`,
    );
  }
  return failures;
}
