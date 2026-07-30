import { SimEngine } from '../sim/scanCycle.js';
import type { RungEvalResult } from '../sim/rungSolver.js';
import type { LadderProgram } from '../ladder/types.js';
import { getProcess, type MachineState } from './processes/index.js';
import {
  describeBitFailure,
  describeBitWait,
  describeJamFailure,
  describeMachineFailure,
  describeMachineWait,
  describeTimeout,
  type JamOnset,
} from './failureText.js';
import {
  defaultInputs,
  outputDevices,
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
 */
export const CORRECTNESS_WEIGHT = 85;
/** Throughput marks run out at this multiple of par. */
export const PAR_SLACK = 1.5;

/** 1 at or under par, 0 at PAR_SLACK x par, linear between. */
export function throughputScore(elapsedMs: number, parMs: number): number {
  if (parMs <= 0) return 1;
  const worst = parMs * PAR_SLACK;
  if (elapsedMs <= parMs) return 1;
  if (elapsedMs >= worst) return 0;
  return (worst - elapsedMs) / (worst - parMs);
}

/** Grading dt in ms — the timeline replay must reproduce to match bit-for-bit. */
export const GRADE_DT = 50;

/** One scan's worth of state, captured only when tracing a scenario for replay. */
export interface TraceSample {
  tMs: number;
  stepIndex: number;
  bits: Record<string, boolean>;
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

function simulateScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
  samples: TraceSample[] | undefined,
): { steps: TraceStep[]; elapsedMs: number } {
  const engine = new SimEngine(program);
  engine.reset();
  const process = getProcess(spec.processId);
  let machine = process.init(spec.devices);
  const outDevs = outputDevices(spec);

  const inputs: Record<string, boolean> = {
    ...defaultInputs(spec.devices),
    ...scenario.initialInputs,
  };
  let derived: Record<string, boolean> = {};
  let tMs = 0;

  const stepResults: TraceStep[] = [];
  // A jam latches and freezes the machine, so it usually surfaces as a failed
  // assertion one or more steps after the scan that caused it. Remember where it
  // started so the message can point back at the real cause.
  let jamOnset: { tMs: number; stepIndex: number; stepLabel: string; reason?: string } | undefined;

  /** One scan: inputs in, ladder, process, and (when tracing) a sample out. */
  const scanOnce = (stepIndex: number, stepLabel: string): void => {
    engine.setInputs(inputs);
    engine.setInputs(derived);
    engine.scan(dt);
    tMs += dt;
    const outputs: Record<string, boolean> = {};
    for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
    const res = process.step({ outputs, inputs, machine, devices: spec.devices, dtMs: dt });
    machine = res.machine;
    derived = res.derivedInputs ?? {};
    if (!jamOnset && machine.jam === true) {
      jamOnset = {
        tMs,
        stepIndex,
        stepLabel,
        reason: typeof machine.jamReason === 'string' ? machine.jamReason : undefined,
      };
    }
    if (samples) {
      samples.push({
        tMs,
        stepIndex,
        bits: engine.snapshot().bits,
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
    return waits;
  };

  scenario.steps.forEach((step, stepIndex) => {
    Object.assign(inputs, step.setInputs ?? {});
    const startSample = samples?.length ?? 0;
    const failures: string[] = [];

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

  return { steps: stepResults, elapsedMs: tMs };
}

function runScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
): ScenarioResult {
  const { steps, elapsedMs } = simulateScenario(spec, program, scenario, dt, undefined);
  return {
    name: scenario.name,
    passed: steps.every((s) => s.passed),
    steps: steps.map(({ label, passed, failures }) => ({ label, passed, failures })),
    elapsedMs,
    parMs: scenario.parMs,
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

  // Throughput is only meaningful for a run that actually worked, and only for
  // scenarios that declared a par. Puzzles with no machine dynamics declare
  // none, so they keep scoring purely on correctness.
  const timed = scenarios.filter((s) => s.parMs !== undefined);
  const efficiency =
    timed.length === 0
      ? undefined
      : timed.reduce((sum, s) => sum + throughputScore(s.elapsedMs, s.parMs!), 0) / timed.length;

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
