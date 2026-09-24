/**
 * Records the Cold Chain Hub fly-in: a stretch of the solved capstone, running.
 *
 * The fly-in is a glimpse of where the category ends up, so it replays a real run
 * rather than a staged one: the capstone's own spec, driven by its canonical
 * sections (the ones `grade.test.ts` proves solve it), through the same
 * `traceScenario` the replay view uses. Only the plant's `machine` image is kept,
 * which is all the 3D scene reads; the first scan is stored whole and every later
 * one as just the fields that changed.
 *
 * Deterministic, so re-running it only changes the file when the plant, the
 * capstone or its solution changed. Re-run it when one of those did:
 *
 *   npx tsx scripts/record-dc-intro.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPuzzle, traceScenario, type LadderPuzzleSpec, type MachineState } from '../packages/shared/src/index.js';
import { HUB_FLEET_PROGRAM, SHIP_PROGRAM } from '../packages/shared/src/puzzle/content/dc-sections.js';

/**
 * The window, in the first scenario's own time. Through it every vehicle is busy
 * and the ripening rooms are filling, and OUT1's truck pulls away full at 69.9 s
 * and the next one is backed in by 75.9 s. The fly-in plays it at 1.5x, which
 * puts the truck leaving inside its outbound-docks shot (`intro.ts`): move one
 * and the other has to move with it.
 */
const FROM_MS = 48_000;
const TO_MS = 84_000;

const OUT = fileURLToPath(new URL('../packages/client/public/intro/dc-hub-shift.json', import.meta.url));

const spec = getPuzzle('dc-hub') as LadderPuzzleSpec;
const program = {
  pous: [
    { id: 'SHIP', name: 'SHIP', rungs: SHIP_PROGRAM },
    { id: 'FLEET', name: 'FLEET', rungs: HUB_FLEET_PROGRAM },
  ],
  tasks: [],
};
const trace = traceScenario(spec, program, spec.scenarios[0].name);
if (!trace) throw new Error('dc-hub has no first scenario');

const frames = trace.samples.filter((s) => s.tMs >= FROM_MS && s.tMs <= TO_MS).map((s) => s.machine);
const deltas: MachineState[] = [];
for (let i = 1; i < frames.length; i++) {
  const d: MachineState = {};
  for (const [k, v] of Object.entries(frames[i])) if (frames[i - 1][k] !== v) d[k] = v;
  deltas.push(d);
}

const body = { source: `dc-hub, "${trace.scenarioName}", ${FROM_MS}-${TO_MS} ms`, dt: trace.dt, first: frames[0], deltas };
writeFileSync(OUT, `${JSON.stringify(body)}\n`);
// oxlint-disable-next-line no-console -- a build script reporting what it wrote
console.log(`${frames.length} scans, ${(JSON.stringify(body).length / 1024).toFixed(0)} kB -> ${OUT}`);
