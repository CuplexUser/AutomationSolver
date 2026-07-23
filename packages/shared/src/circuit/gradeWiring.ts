import { GRADE_DT, type GradeResult, type ScenarioResult } from '../puzzle/grade.js';
import { defaultInputs, type CabinetPuzzleSpec, type Scenario } from '../puzzle/types.js';
import { CabinetSim, type CabinetSimResult } from './solver.js';
import type { WiringDoc } from './types.js';

/**
 * Cabinet counterpart of gradeProgram: runs every scenario through CabinetSim
 * and returns the same GradeResult shape, so the client ResultsCard renders
 * both puzzle kinds identically.
 *
 * Beyond the step's expect/expectMachine assertions, any electrical fault
 * during a step (short circuit, contact chatter) fails that step — a wiring
 * that shorts the supply is never "correct", whatever the output bits say.
 */
export function gradeWiring(
  spec: CabinetPuzzleSpec,
  wiring: WiringDoc,
  opts: { dt?: number } = {},
): GradeResult {
  const dt = opts.dt ?? GRADE_DT;
  const scenarios = spec.scenarios.map((s) => runScenario(spec, wiring, s, dt));
  const passedCount = scenarios.filter((s) => s.passed).length;
  const score = scenarios.length === 0 ? 0 : Math.round((passedCount / scenarios.length) * 100);
  return { solved: passedCount === scenarios.length && scenarios.length > 0, score, scenarios };
}

/** One captured scan, for client-side replay of a graded cabinet scenario. */
export interface CabinetTraceSample {
  tMs: number;
  stepIndex: number;
  result: CabinetSimResult;
}

export interface CabinetScenarioTrace {
  scenarioName: string;
  dt: number;
  samples: CabinetTraceSample[];
  steps: { label: string; startSample: number; passed: boolean; failures: string[] }[];
}

export function traceCabinetScenario(
  spec: CabinetPuzzleSpec,
  wiring: WiringDoc,
  scenarioName: string,
  opts: { dt?: number } = {},
): CabinetScenarioTrace | undefined {
  const scenario = spec.scenarios.find((s) => s.name === scenarioName);
  if (!scenario) return undefined;
  const dt = opts.dt ?? GRADE_DT;
  const samples: CabinetTraceSample[] = [];
  const steps = simulateScenario(spec, wiring, scenario, dt, samples);
  return { scenarioName, dt, samples, steps };
}

function runScenario(
  spec: CabinetPuzzleSpec,
  wiring: WiringDoc,
  scenario: Scenario,
  dt: number,
): ScenarioResult {
  const steps = simulateScenario(spec, wiring, scenario, dt, undefined);
  return {
    name: scenario.name,
    passed: steps.every((s) => s.passed),
    steps: steps.map(({ label, passed, failures }) => ({ label, passed, failures })),
  };
}

function simulateScenario(
  spec: CabinetPuzzleSpec,
  wiring: WiringDoc,
  scenario: Scenario,
  dt: number,
  samples: CabinetTraceSample[] | undefined,
): { label: string; startSample: number; passed: boolean; failures: string[] }[] {
  const sim = new CabinetSim(spec.cabinet, wiring);
  sim.reset();
  const inputs: Record<string, boolean> = {
    ...defaultInputs(spec.devices),
    ...scenario.initialInputs,
  };
  let tMs = 0;

  return scenario.steps.map((step, stepIndex) => {
    Object.assign(inputs, step.setInputs ?? {});
    const iterations = Math.max(1, Math.ceil(step.holdMs / dt));
    const startSample = samples?.length ?? 0;
    const stepFaults = new Set<string>();
    for (let i = 0; i < iterations; i++) {
      sim.setInputs(inputs);
      const result = sim.step(dt);
      tMs += dt;
      for (const f of result.faults) stepFaults.add(f);
      if (samples) samples.push({ tMs, stepIndex, result });
    }

    const failures: string[] = [];
    for (const [addr, expected] of Object.entries(step.expect ?? {})) {
      const actual = sim.getBit(addr);
      if (actual !== expected) {
        failures.push(`${addr} expected ${expected ? 'ON' : 'OFF'} but was ${actual ? 'ON' : 'OFF'}`);
      }
    }
    const machine = sim.machine;
    for (const [key, expected] of Object.entries(step.expectMachine ?? {})) {
      const actual = machine[key];
      if (actual !== expected) {
        failures.push(`machine.${key} expected ${String(expected)} but was ${String(actual)}`);
      }
    }
    for (const f of stepFaults) if (!failures.includes(f)) failures.push(f);

    return { label: step.label, startSample, passed: failures.length === 0, failures };
  });
}
