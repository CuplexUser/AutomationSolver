import type { PuzzleDevice } from './types.js';

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
