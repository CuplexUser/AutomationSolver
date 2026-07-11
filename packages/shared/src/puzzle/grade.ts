import { SimEngine } from '../sim/scanCycle.js';
import type { LadderProgram } from '../ladder/types.js';
import { getProcess } from './processes/index.js';
import { defaultInputs, outputDevices, type PuzzleSpec, type Scenario } from './types.js';

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

const DEFAULT_DT = 50;

function runScenario(
  spec: PuzzleSpec,
  program: LadderProgram,
  scenario: Scenario,
  dt: number,
): ScenarioResult {
  const engine = new SimEngine(program);
  engine.reset();
  const process = getProcess(spec.processId);
  let machine = process.init(spec.devices);
  const outDevs = outputDevices(spec);

  const inputs: Record<string, boolean> = {
    ...defaultInputs(spec.devices),
    ...(scenario.initialInputs ?? {}),
  };
  let derived: Record<string, boolean> = {};

  const stepResults: StepResult[] = [];

  for (const step of scenario.steps) {
    Object.assign(inputs, step.setInputs ?? {});
    const iterations = Math.max(1, Math.ceil(step.holdMs / dt));
    for (let i = 0; i < iterations; i++) {
      engine.setInputs(inputs);
      engine.setInputs(derived);
      engine.scan(dt);
      const outputs: Record<string, boolean> = {};
      for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
      const res = process.step({ outputs, inputs, machine, devices: spec.devices, dtMs: dt });
      machine = res.machine;
      derived = res.derivedInputs ?? {};
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
    stepResults.push({ label: step.label, passed: failures.length === 0, failures });
  }

  return {
    name: scenario.name,
    passed: stepResults.every((s) => s.passed),
    steps: stepResults,
  };
}

export function gradeProgram(
  spec: PuzzleSpec,
  program: LadderProgram,
  opts: { dt?: number } = {},
): GradeResult {
  const dt = opts.dt ?? DEFAULT_DT;
  const scenarios = spec.scenarios.map((s) => runScenario(spec, program, s, dt));
  const passedCount = scenarios.filter((s) => s.passed).length;
  const score = scenarios.length === 0 ? 0 : Math.round((passedCount / scenarios.length) * 100);
  return { solved: passedCount === scenarios.length && scenarios.length > 0, score, scenarios };
}
