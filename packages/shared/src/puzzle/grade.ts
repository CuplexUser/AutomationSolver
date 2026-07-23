import { SimEngine } from '../sim/scanCycle.js';
import type { RungEvalResult } from '../sim/rungSolver.js';
import type { LadderProgram } from '../ladder/types.js';
import { getProcess, type MachineState } from './processes/index.js';
import { defaultInputs, outputDevices, type LadderPuzzleSpec, type Scenario } from './types.js';

export interface StepResult {
  label: string;
  passed: boolean;
  failures: string[];
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  steps: StepResult[];
}

export interface GradeResult {
  solved: boolean;
  score: number; // 0..100
  scenarios: ScenarioResult[];
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
): { steps: TraceStep[] } {
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

  scenario.steps.forEach((step, stepIndex) => {
    Object.assign(inputs, step.setInputs ?? {});
    const iterations = Math.max(1, Math.ceil(step.holdMs / dt));
    const startSample = samples?.length ?? 0;
    for (let i = 0; i < iterations; i++) {
      engine.setInputs(inputs);
      engine.setInputs(derived);
      engine.scan(dt);
      tMs += dt;
      const outputs: Record<string, boolean> = {};
      for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
      const res = process.step({ outputs, inputs, machine, devices: spec.devices, dtMs: dt });
      machine = res.machine;
      derived = res.derivedInputs ?? {};
      if (samples) {
        samples.push({
          tMs,
          stepIndex,
          bits: engine.snapshot().bits,
          rungResults: engine.lastRungResults,
          machine,
        });
      }
    }

    const failures: string[] = [];
    for (const [addr, expected] of Object.entries(step.expect ?? {})) {
      const actual = engine.getBit(addr);
      if (actual !== expected) {
        failures.push(`${addr} expected ${expected ? 'ON' : 'OFF'} but was ${actual ? 'ON' : 'OFF'}`);
      }
    }
    for (const [key, expected] of Object.entries(step.expectMachine ?? {})) {
      const actual = machine[key];
      if (actual !== expected) {
        failures.push(`machine.${key} expected ${String(expected)} but was ${String(actual)}`);
      }
    }
    stepResults.push({ label: step.label, startSample, passed: failures.length === 0, failures });
  });

  return { steps: stepResults };
}

function runScenario(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
): ScenarioResult {
  const { steps } = simulateScenario(spec, program, scenario, dt, undefined);
  return {
    name: scenario.name,
    passed: steps.every((s) => s.passed),
    steps: steps.map(({ label, passed, failures }) => ({ label, passed, failures })),
  };
}

export function gradeProgram(
  spec: LadderPuzzleSpec,
  program: LadderProgram,
  opts: { dt?: number } = {},
): GradeResult {
  const dt = opts.dt ?? GRADE_DT;
  const scenarios = spec.scenarios.map((s) => runScenario(spec, program, s, dt));
  const passedCount = scenarios.filter((s) => s.passed).length;
  const score = scenarios.length === 0 ? 0 : Math.round((passedCount / scenarios.length) * 100);
  return { solved: passedCount === scenarios.length && scenarios.length > 0, score, scenarios };
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
