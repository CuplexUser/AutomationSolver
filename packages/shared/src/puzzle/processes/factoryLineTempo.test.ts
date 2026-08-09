import { describe, expect, it } from 'vitest';
import { factoryLine } from './factoryLine.js';
import type { MachineState } from './index.js';
import { SimEngine } from '../../sim/scanCycle.js';
import type { LadderProject, Rung } from '../../ladder/types.js';
import { isAnalog } from '../types.js';
import { LINE_DEVICES, SUP_PROGRAM } from '../content/factory-line-plant.js';
import {
  ASSEMBLY_PLAIN,
  ASSEMBLY_TUNED,
  CONV_PLAIN,
  CONV_TUNED,
  PAINT_PLAIN,
  PAINT_TUNED,
  STORE_PLAIN,
  STORE_TUNED,
  TEST_PLAIN,
  TEST_TUNED,
  WELD_PLAIN,
  WELD_TUNED,
} from '../content/factory-line-programs.js';

/**
 * The plant's tempo, measured rather than asserted from the constants.
 *
 * A station's *lever* is how many machines a shift loses when that one section
 * is swapped from its tuned program to its plain one, everything else held. It
 * is the only number that says whether a station puzzle is worth playing: a bay
 * with a lever of zero is a bay where the player's work cannot be felt, however
 * interesting the mechanism is.
 *
 * This file exists because that number cannot be reasoned about. Every attempt
 * to work it out from the timing constants has been wrong, in both directions —
 * the store looked like the slowest station and was not the constraint, and the
 * conveyor looked like the largest lever in the design and turned out to have
 * none at all. Six sections interacting through nine buffers is past the point
 * where anybody's arithmetic is worth more than a run.
 *
 * It is also the only place a *jam* in a shipped program shows up. Two of them
 * hid here for as long as the line ran one part at a time: assembly claimed its
 * frame and its boom in a fixed hundred-millisecond window, and the weld bay
 * read its outfeed eye as a level. Both are correct on an empty line and both
 * fail the first time there is traffic, which is exactly what a soak is for.
 */

const outDevs = LINE_DEVICES.filter((d) => d.io === 'output' && !isAnalog(d));
const anaDevs = LINE_DEVICES.filter(isAnalog);
const SECTIONS = ['WELD', 'STORE', 'PAINT', 'ASSY', 'TEST', 'CONV'] as const;
type Section = (typeof SECTIONS)[number];

const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const s_ = (v: unknown) => (typeof v === 'string' ? v : '');

/** What each station counts as doing something rather than waiting. */
const BUSY: Record<string, (m: MachineState) => boolean> = {
  // The store's program drives the rack *and* the portal, so its load is the
  // union: while the head is out over the aisle, the rack cannot stroke.
  STORE: (m) =>
    n(m.storeLoad) > 0 ||
    n(m.storePick) > 0 ||
    s_(m.portalPart) !== '' ||
    n(m.portalLift) > 0 ||
    (n(m.portalAt) > 0 && n(m.portalAt) < 1),
  WELD: (m) => s_(m.weldPart) !== '' || n(m.tipChange) > 0,
  PAINT: (m) => s_(m.boothStage) !== 'idle' || n(m.purge) > 0,
  ASSY: (m) => n(m.assyFrame) > 0 || n(m.assyBoom) > 0,
  TEST: (m) => m.testPart === true,
};

/** Every zone of the spine, and how wide a token is on each. */
const SPINE_KEYS = [
  'z1',
  'z2',
  'storeIn',
  'z4',
  'z5',
  'z6',
  'z7',
  'laneF',
  'laneB',
  'z10',
  'z11',
  'z12',
];
const PAINTED = new Set(['z4', 'z5', 'z6', 'z7']);

interface Tempo {
  shipped: number;
  /** Seconds each station spends working, per machine shipped. */
  load: Record<string, number>;
  machine: MachineState;
  /** Parts standing on the spine, averaged over the shift and at its peak. */
  spineAvg: number;
  spineMax: number;
  /** The deepest either painted lane ever got. */
  laneMax: number;
}

function runLine(sections: Record<Section, Rung[]>, ms: number): Tempo {
  const project: LadderProject = {
    pous: [
      { id: 'SUP', name: 'SUP', rungs: SUP_PROGRAM },
      ...SECTIONS.map((id) => ({ id, name: id, rungs: sections[id] })),
    ],
    tasks: [{ id: 'MAIN', name: 'MAIN', priority: 0, pous: ['SUP', ...SECTIONS] }],
  };
  const engine = new SimEngine(project);
  engine.reset();
  let machine = factoryLine.init(LINE_DEVICES);
  const inputs: Record<string, boolean> = { X0: true, X1: true, X2: true, X3: true };
  let derived: Record<string, boolean> = {};
  let derivedRegs: Record<string, number> = {};
  const busy: Record<string, number> = {};
  const dt = 50;
  let spineSum = 0;
  let spineMax = 0;
  let laneMax = 0;

  for (let t = 0; t < ms; t += dt) {
    engine.setInputs(inputs);
    engine.setInputs(derived);
    engine.setRegisters(derivedRegs);
    engine.scan(dt);
    const outputs: Record<string, boolean> = {};
    for (const d of outDevs) outputs[d.address] = engine.getBit(d.address);
    const registers: Record<string, number> = {};
    for (const d of anaDevs) registers[d.address] = engine.getRegister(d.address);
    const res = factoryLine.step({
      outputs,
      inputs,
      registers,
      machine,
      devices: LINE_DEVICES,
      dtMs: dt,
    });
    machine = res.machine;
    derived = res.derivedInputs ?? {};
    derivedRegs = res.derivedRegisters ?? {};
    for (const [k, f] of Object.entries(BUSY)) if (f(machine)) busy[k] = (busy[k] ?? 0) + 1;
    let onSpine = 0;
    for (const k of SPINE_KEYS) onSpine += s_(machine[k]).length / (PAINTED.has(k) ? 2 : 1);
    spineSum += onSpine;
    spineMax = Math.max(spineMax, onSpine);
    laneMax = Math.max(laneMax, s_(machine.laneF).length, s_(machine.laneB).length);
  }

  const shipped = n(machine.shipped);
  const load: Record<string, number> = {};
  for (const k of Object.keys(BUSY)) {
    load[k] = shipped > 0 ? ((busy[k] ?? 0) * dt) / shipped / 1000 : 0;
  }
  return { shipped, load, machine, spineAvg: spineSum / (ms / dt), spineMax, laneMax };
}

const PLAIN: Record<Section, Rung[]> = {
  WELD: WELD_PLAIN,
  STORE: STORE_PLAIN,
  PAINT: PAINT_PLAIN,
  ASSY: ASSEMBLY_PLAIN,
  TEST: TEST_PLAIN,
  CONV: CONV_PLAIN,
};
const TUNED: Record<Section, Rung[]> = {
  WELD: WELD_TUNED,
  STORE: STORE_TUNED,
  PAINT: PAINT_TUNED,
  ASSY: ASSEMBLY_TUNED,
  TEST: TEST_TUNED,
  CONV: CONV_TUNED,
};

/** Long enough that a station's difference shows as machines rather than noise. */
const SHIFT_MS = 300_000;

/** Each configuration is soaked once and read by several tests. */
const cache = new Map<string, Tempo>();
const soak = (name: string, sections: Record<Section, Rung[]>): Tempo => {
  const hit = cache.get(name);
  if (hit) return hit;
  const run = runLine(sections, SHIFT_MS);
  cache.set(name, run);
  return run;
};
const tuned = () => soak('tuned', TUNED);
const plain = () => soak('plain', PLAIN);
const swapped = (s: Section) => soak(`swap:${s}`, { ...TUNED, [s]: PLAIN[s] });

/** Nothing in this file is a valid measurement of a plant that stopped. */
function expectRan(where: string, t: Tempo): void {
  expect({ where, reason: t.machine.jamReason ?? '', shipped: t.shipped > 0 }).toEqual({
    where,
    reason: '',
    shipped: true,
  });
}

describe('factory-line — tempo', () => {
  it('runs every station within a second of the others', { timeout: 60_000 }, () => {
    // The point of the retiming pass. Before it the store and its portal ran
    // 2.3 s per machine longer than anything else, which made every other bay
    // structurally slack: a player could halve the paint shop's cycle and ship
    // exactly the same number of machines.
    const values = Object.values(tuned().load);
    const spread = Math.max(...values) - Math.min(...values);
    expect(spread).toBeLessThan(1);
  });

  it('pipelines, so the buffers on the line are actually used', { timeout: 60_000 }, () => {
    // The property the overlap pass was for, and the one this plant went a long
    // time without. While every tuned section waited for its own part to arrive
    // somewhere before starting the next, every buffer on the line was empty at
    // every instant of the shift — the weld bay made a part, that part travelled
    // alone to the jig, and only then did the next one start. A line in that
    // state ships the *sum* of its station times rather than the largest of
    // them, and it can never show a queue, which is the one thing the spine
    // exists to teach.
    const t = tuned();
    expect(t.spineAvg).toBeGreaterThan(2);
    expect(t.laneMax).toBeGreaterThan(1);
    // The weld bay runs ahead of the line rather than in lockstep with it.
    expect(n(t.machine.welded)).toBeGreaterThan(2 * t.shipped);
  });

  it('never faults, in any configuration', { timeout: 120_000 }, () => {
    // A jam ships fewer machines, so it reads as a lever unless it is checked
    // for. Both of the ones this caught only appeared once the line had traffic
    // on it, which no single-station unit test puts there.
    expectRan('tuned', tuned());
    expectRan('plain', plain());
    for (const section of SECTIONS) expectRan(section, swapped(section));
  });

  it('gives the weld bay, paint, assembly and test a lever', { timeout: 120_000 }, () => {
    // Swap one section to its plain program and the shift has to ship fewer
    // machines. Anything else means that bay's puzzle cannot be felt.
    //
    // The store and the conveyor are missing from this list and that is a known
    // gap, not an oversight — see FACTORY-LINE-DESIGN.md §5a. Neither of their
    // plain programs costs the plant anything, because neither of them blocks
    // the station that is actually setting the pace.
    const base = tuned().shipped;
    for (const section of ['WELD', 'PAINT', 'ASSY', 'TEST'] as const) {
      expect({ section, better: base > swapped(section).shipped }).toEqual({
        section,
        better: true,
      });
    }
  });

  it('ships more with every section tuned than with every section plain', { timeout: 60_000 }, () => {
    expect(tuned().shipped).toBeGreaterThan(plain().shipped);
  });
});
