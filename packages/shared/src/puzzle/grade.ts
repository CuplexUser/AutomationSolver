import { SimEngine } from '../sim/scanCycle.js';
import type { RungEvalResult } from '../sim/rungSolver.js';
import type { LadderProgram } from '../ladder/types.js';
import { getProcess, primeProcess, type MachineState } from './processes/index.js';
import {
  describeAnalogFailure,
  describeAnalogWait,
  describeBitFailure,
  describeBitWait,
  describeControlFailures,
  describeJamFailure,
  describeMachineFailure,
  describeMachineWait,
  describeTimeout,
  type ControlOutcome,
  type JamOnset,
} from './failureText.js';
import {
  analogDevices,
  defaultInputs,
  outputDevices,
  type AnalogBound,
  type ControlSpec,
  type LadderPuzzleSpec,
  type Scenario,
  type ScenarioCondition,
} from './types.js';

export interface StepResult {
  label: string;
  passed: boolean;
  failures: string[];
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
  /** Simulated ms this run took end to end. */
  elapsedMs: number;
  /** Target from the spec, when the scenario grades throughput at all. */
  parMs?: number;
  /** Integral of absolute error in count-seconds, over every `control` step. */
  iae?: number;
  /** Target from the spec, when the scenario grades control quality. */
  parIae?: number;
}

export interface GradeResult {
  solved: boolean;
  score: number; // 0..100
  scenarios: ScenarioResult[];
  /** Throughput against par, 0..1 — undefined when nothing declared a par. */
  efficiency?: number;
}

/**
 * How the two halves of the score split. Correctness is the bulk of it and is
 * what `solved` tracks; throughput is the remainder, and is only awarded once
 * every scenario passes (a program that faults has no meaningful cycle time).
 *
 * Analog puzzles spend the same remainder on control quality instead of on
 * cycle time (`parIae` in place of `parMs`), because for a regulator "how well
 * did it hold" *is* the performance question. Same weight, same taper, same
 * "correct but mediocre still unlocks what follows" property.
 */
export const CORRECTNESS_WEIGHT = 85;
/** Throughput marks run out at this multiple of par. */
export const PAR_SLACK = 1.5;

/**
 * 1 at or under par, 0 at PAR_SLACK x par, linear between.
 *
 * Used for both performance axes: `actual`/`par` are elapsed ms for a sequencing
 * puzzle and count-seconds of accumulated error for a regulating one. Lower is
 * better either way, which is why one curve serves both.
 */
export function throughputScore(actual: number, par: number): number {
  if (par <= 0) return 1;
  const worst = par * PAR_SLACK;
  if (actual <= par) return 1;
  if (actual >= worst) return 0;
  return (worst - actual) / (worst - par);
}

/** Grading dt in ms — the timeline replay must reproduce to match bit-for-bit. */
export const GRADE_DT = 50;

/** One scan's worth of state, captured only when tracing a scenario for replay. */
export interface TraceSample {
  tMs: number;
  stepIndex: number;
  bits: Record<string, boolean>;
  /** D-register image, so a replay can redraw the trend as well as the bits. */
  registers: Record<string, number>;
  rungResults: RungEvalResult[];
  machine: MachineState;
}

export interface TraceStep {
  label: string;
  startSample: number;
  /**
   * Sample the step's expectations were checked against. With milestone steps
   * this is not simply `next step's startSample - 1` in spirit: it is the exact
   * scan the grader judged, which is where a replay should land.
   */
  checkSample: number;
  passed: boolean;
  failures: string[];
}

export interface ScenarioTrace {
  scenarioName: string;
  dt: number;
  samples: TraceSample[];
  steps: TraceStep[];
}

/** Inside a `control` step: what the loop has done so far. */
interface ControlAccumulator {
  spec: ControlSpec;
  /** Approach direction, from the PV at step start: +1 rising, -1 falling, 0 already there. */
  direction: number;
  overshoot: number;
  settledMs: number;
  final: number;
}

function inBound(value: number, bound: AnalogBound): boolean {
  if (bound.min !== undefined && value < bound.min) return false;
  if (bound.max !== undefined && value > bound.max) return false;
  return true;
}

function simulateScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
  samples: TraceSample[] | undefined,
): { steps: TraceStep[]; elapsedMs: number; iae: number } {
  const engine = new SimEngine(program);
  engine.reset();
  const process = getProcess(spec.processId);
  let machine = process.init(spec.devices);
  const outDevs = outputDevices(spec);
  const analogDevs = analogDevices(spec);

  const inputs: Record<string, boolean> = {
    ...defaultInputs(spec.devices),
    ...scenario.initialInputs,
  };
  // The field image before rung one, so the first scan reads the machine that is
  // actually standing there rather than an all-zero register file.
  const primed = primeProcess(process, machine, spec.devices, inputs);
  let derived: Record<string, boolean> = primed.derivedInputs;
  let derivedRegs: Record<string, number> = primed.derivedRegisters;
  let tMs = 0;
  // Accumulated |error| x time over every control step, in count-milliseconds.
  // Converted to count-seconds once at the end; this is the analog puzzles'
  // performance axis, standing where cycle time stands for a sequencing one.
  let iaeCountMs = 0;
  let control: ControlAccumulator | undefined;

  const stepResults: TraceStep[] = [];
  // A jam latches and freezes the machine, so it usually surfaces as a failed
  // assertion one or more steps after the scan that caused it. Remember where it
  // started so the message can point back at the real cause.
  let jamOnset: { tMs: number; stepIndex: number; stepLabel: string; reason?: string } | undefined;

  /** One scan: inputs in, ladder, process, and (when tracing) a sample out. */
  const scanOnce = (stepIndex: number, stepLabel: string): void => {
    engine.setInputs(inputs);
    engine.setInputs(derived);
    engine.setRegisters(derivedRegs);
    engine.scan(dt);
    tMs += dt;
    const outputs: Record<string, boolean> = {};
    for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
    const registers: Record<string, number> = {};
    for (const d of analogDevs) registers[d.address] = engine.getRegister(d.address);
    const res = process.step({
      outputs,
      inputs,
      registers,
      machine,
      devices: spec.devices,
      dtMs: dt,
    });
    machine = res.machine;
    derived = res.derivedInputs ?? {};
    derivedRegs = res.derivedRegisters ?? {};

    // Control quality is measured on the value the *plant* now reports, not on
    // the one the program last read, so a loop cannot look good by ignoring a
    // sensor it has already sampled.
    if (control) {
      const pv = derivedRegs[control.spec.device] ?? engine.getRegister(control.spec.device);
      const err = pv - control.spec.setpoint;
      iaeCountMs += Math.abs(err) * dt;
      const past = control.direction === 0 ? Math.abs(err) : control.direction * err;
      if (past > control.overshoot) control.overshoot = past;
      control.settledMs = Math.abs(err) <= control.spec.band ? control.settledMs + dt : 0;
      control.final = pv;
    }

    if (!jamOnset && machine.jam === true) {
      jamOnset = {
        tMs,
        stepIndex,
        stepLabel,
        reason: typeof machine.jamReason === 'string' ? machine.jamReason : undefined,
      };
    }
    if (samples) {
      const snap = engine.snapshot();
      samples.push({
        tMs,
        stepIndex,
        bits: snap.bits,
        registers: snap.registers,
        rungResults: engine.lastRungResults,
        machine,
      });
    }
  };

  /** Every part of `cond` that does not hold right now, as a "waiting for" phrase. */
  const unmet = (cond: ScenarioCondition): string[] => {
    const waits: string[] = [];
    for (const [addr, want] of Object.entries(cond.bits ?? {})) {
      if (engine.getBit(addr) !== want) waits.push(describeBitWait(addr, want, spec.devices));
    }
    for (const [key, want] of Object.entries(cond.machine ?? {})) {
      if (machine[key] !== want) waits.push(describeMachineWait(key, want));
    }
    for (const [addr, bound] of Object.entries(cond.analog ?? {})) {
      if (!inBound(engine.getRegister(addr), bound)) {
        waits.push(describeAnalogWait(addr, bound, spec.devices));
      }
    }
    return waits;
  };

  scenario.steps.forEach((step, stepIndex) => {
    Object.assign(inputs, step.setInputs ?? {});
    const startSample = samples?.length ?? 0;
    const failures: string[] = [];

    if (step.control) {
      const pv = engine.getRegister(step.control.device);
      const gap = step.control.setpoint - pv;
      control = {
        spec: step.control,
        direction: gap > 0 ? 1 : gap < 0 ? -1 : 0,
        overshoot: 0,
        settledMs: 0,
        final: pv,
      };
    } else {
      control = undefined;
    }

    if (step.until) {
      // Milestone step: `holdMs` is the deadline, not the runtime.
      const deadline = Math.max(1, Math.ceil(step.holdMs / dt));
      let reached = false;
      for (let i = 0; i < deadline && !reached; i++) {
        scanOnce(stepIndex, step.label);
        reached = unmet(step.until).length === 0;
      }
      if (reached) {
        const settle = Math.ceil((step.thenHoldMs ?? 0) / dt);
        for (let i = 0; i < settle; i++) scanOnce(stepIndex, step.label);
      } else {
        failures.push(describeTimeout(unmet(step.until), step.holdMs));
      }
    } else {
      const iterations = Math.max(1, Math.ceil(step.holdMs / dt));
      for (let i = 0; i < iterations; i++) scanOnce(stepIndex, step.label);
    }

    for (const [addr, expected] of Object.entries(step.expect ?? {})) {
      const actual = engine.getBit(addr);
      if (actual !== expected) {
        failures.push(describeBitFailure(addr, expected, actual, spec.devices));
      }
    }
    for (const [addr, bound] of Object.entries(step.expectAnalog ?? {})) {
      const actual = engine.getRegister(addr);
      if (!inBound(actual, bound)) {
        failures.push(describeAnalogFailure(addr, bound, actual, spec.devices));
      }
    }
    if (control) {
      const outcome: ControlOutcome = {
        settledMs: control.settledMs,
        overshoot: Math.max(0, control.overshoot),
        finalError: Math.abs(control.final - control.spec.setpoint),
        final: control.final,
      };
      failures.push(...describeControlFailures(control.spec, outcome, spec.devices));
    }
    const onset: JamOnset | undefined = jamOnset
      ? { ...jamOnset, sameStep: jamOnset.stepIndex === stepIndex }
      : undefined;
    for (const [key, expected] of Object.entries(step.expectMachine ?? {})) {
      const actual = machine[key];
      if (actual !== expected) {
        failures.push(describeMachineFailure(key, expected, actual, onset));
      }
    }
    // A step that only checks bits still fails for pages after a jam, with no
    // hint as to why nothing moved. Say it once, at the end of the list.
    if (failures.length > 0 && onset && !('jam' in (step.expectMachine ?? {}))) {
      failures.push(describeJamFailure(onset));
    }
    stepResults.push({
      label: step.label,
      startSample,
      checkSample: Math.max(startSample, (samples?.length ?? 0) - 1),
      passed: failures.length === 0,
      failures,
    });
  });

  return { steps: stepResults, elapsedMs: tMs, iae: iaeCountMs / 1000 };
}

function runScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
): ScenarioResult {
  const { steps, elapsedMs, iae } = simulateScenario(spec, program, scenario, dt, undefined);
  return {
    name: scenario.name,
    passed: steps.every((s) => s.passed),
    steps: steps.map(({ label, passed, failures }) => ({ label, passed, failures })),
    elapsedMs,
    parMs: scenario.parMs,
    iae: scenario.parIae === undefined ? undefined : iae,
    parIae: scenario.parIae,
  };
}

export function gradeProgram(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  opts: { dt?: number } = {},
): GradeResult {
  const dt = opts.dt ?? GRADE_DT;
  const scenarios = spec.scenarios.map((s) => runScenario(spec, program, s, dt));
  if (scenarios.length === 0) return { solved: false, score: 0, scenarios };

  const passedCount = scenarios.filter((s) => s.passed).length;
  const solved = passedCount === scenarios.length;
  const correctness = passedCount / scenarios.length;

  // Performance is only meaningful for a run that actually worked, and only for
  // scenarios that declared a par. Puzzles with no machine dynamics declare
  // none, so they keep scoring purely on correctness. A scenario declares
  // either a cycle-time par or a control-quality one; both run through the same
  // taper and share the same 15 marks.
  const timed = scenarios.filter((s) => s.parMs !== undefined || s.parIae !== undefined);
  const efficiency =
    timed.length === 0
      ? undefined
      : timed.reduce(
          (sum, s) =>
            sum +
            (s.parIae !== undefined
              ? throughputScore(s.iae ?? 0, s.parIae)
              : throughputScore(s.elapsedMs, s.parMs!)),
          0,
        ) / timed.length;

  const throughput = solved ? (efficiency ?? 1) : 0;
  const score = Math.round(
    CORRECTNESS_WEIGHT * correctness + (100 - CORRECTNESS_WEIGHT) * throughput,
  );
  return { solved, score, scenarios, efficiency };
}

/**
 * Re-runs one named scenario capturing a scan-by-scan trace, for client-side
 * replay. Deterministic and side-effect-free like gradeProgram, so the client
 * can call it directly (no server round trip) as long as it uses the same dt
 * the grader used (GRADE_DT by default).
 */
export function traceScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenarioName: string,
  opts: { dt?: number } = {},
): ScenarioTrace | undefined {
  const scenario = spec.scenarios.find((s) => s.name === scenarioName);
  if (!scenario) return undefined;
  const dt = opts.dt ?? GRADE_DT;
  const samples: TraceSample[] = [];
  const { steps } = simulateScenario(spec, program, scenario, dt, samples);
  return { scenarioName, dt, samples, steps };
}
