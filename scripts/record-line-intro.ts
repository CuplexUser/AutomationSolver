/**
 * Records the excavator line fly-in: a stretch of the solved capstone, running.
 *
 * The same idea as `record-dc-intro.ts`: the fly-in replays a real run, not a
 * staged one. The capstone's canonical program is every section tuned
 * (`lineProject({})`, the program `grade.test.ts` proves scores full marks),
 * traced through the same `traceScenario` the replay view uses. The scene reads
 * the plant's `machine` image and three coils a state snapshot cannot tell apart
 * (the torch striking, the gun spraying, the booth purging), so those three are
 * folded into each frame under their own addresses. The first scan is stored
 * whole and every later one as just the fields that changed.
 *
 * Deterministic, so re-running it only changes the file when the plant, the
 * capstone or its tuned sections changed. Re-run it when one of those did:
 *
 *   npx tsx scripts/record-line-intro.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPuzzle, traceScenario, type LadderPuzzleSpec, type MachineState } from '../packages/shared/src/index.js';
import { lineProject } from '../packages/shared/src/puzzle/content/factory-line-sections.js';

/**
 * The window, in "A shift"'s own time. By 38 s the line is in its stride, a
 * machine leaving the test pad every 7.25 s, and the first lorry docks at 57.5 s,
 * is loaded by 61.5 s and has pulled away by 66.6 s. The fly-in plays it at 1.5x,
 * which puts the loading and the lorry leaving inside the dispatch shot
 * (`factoryLine/intro.ts`): move one and the other has to move with it.
 */
const FROM_MS = 38_000;
const TO_MS = 68_000;

/** The coils the scene draws from, beside the machine image. */
const COILS = ['Y3', 'Y14', 'Y16'] as const;

const OUT = fileURLToPath(new URL('../packages/client/public/intro/line-shift.json', import.meta.url));

const spec = getPuzzle('factory-line') as LadderPuzzleSpec;
const scenario = spec.scenarios.find((s) => s.name === 'A shift');
if (!scenario) throw new Error('factory-line has no "A shift" scenario');
const trace = traceScenario(spec, lineProject({}), scenario.name);
if (!trace) throw new Error('factory-line could not be traced');

const frames = trace.samples
  .filter((s) => s.tMs >= FROM_MS && s.tMs <= TO_MS)
  .map((s): MachineState => {
    const f: MachineState = { ...s.machine };
    for (const y of COILS) f[y] = s.bits[y] === true;
    return f;
  });
const deltas: MachineState[] = [];
for (let i = 1; i < frames.length; i++) {
  const d: MachineState = {};
  for (const [k, v] of Object.entries(frames[i])) if (frames[i - 1][k] !== v) d[k] = v;
  deltas.push(d);
}

const body = { source: `factory-line, "${trace.scenarioName}", ${FROM_MS}-${TO_MS} ms`, dt: trace.dt, first: frames[0], deltas };
writeFileSync(OUT, `${JSON.stringify(body)}\n`);
// oxlint-disable-next-line no-console -- a build script reporting what it wrote
console.log(`${frames.length} scans, ${(JSON.stringify(body).length / 1024).toFixed(0)} kB -> ${OUT}`);
