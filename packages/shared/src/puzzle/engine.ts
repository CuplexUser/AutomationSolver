import type { ProgramDoc } from '../ladder/types.js';
import { SimEngine } from '../sim/scanCycle.js';
import type { MachineState, ProcessModel } from './processes/index.js';
import { runnableProject } from './symbols.js';
import { isAnalog, type LadderPuzzleSpec } from './types.js';

/**
 * The registers the plant writes: every analog *input* device, the field
 * transmitters. A plain destination on one of these is already refused by the
 * validator; an indexed or queue write can only be caught while it runs, and
 * this is the set the engine catches it against.
 */
export function protectedRegisters(spec: LadderPuzzleSpec): ReadonlySet<string> {
  return new Set(spec.devices.filter((d) => isAnalog(d) && d.io === 'input').map((d) => d.address));
}

/**
 * A submission, assembled, resolved and loaded into an engine fenced the way the
 * grader fences it.
 *
 * The grader and the client's live run both build their engine here, for the
 * same reason `runnableProject` exists: two places constructing an engine
 * slightly differently is how the client and the server stop agreeing.
 */
export function engineFor(spec: LadderPuzzleSpec, program: ProgramDoc): SimEngine {
  return new SimEngine(runnableProject(spec, program), {
    protectedRegisters: protectedRegisters(spec),
  });
}

/**
 * The plant as it stands before anything runs: the model's own rest state with
 * the puzzle's `plantConfig` laid over it. The grader then lays a scenario's
 * `initialMachine` over this; live play has no scenario and uses it as is.
 */
export function plantAtStart(spec: LadderPuzzleSpec, process: ProcessModel): MachineState {
  return { ...process.init(spec.devices), ...spec.plantConfig };
}
