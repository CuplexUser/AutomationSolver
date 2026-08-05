import { describe, expect, it } from 'vitest';
import type { PuzzleDevice } from '../types.js';
import { getProcess, type MachineState } from './index.js';
import {
  CONSUME_MS,
  GOODS_IN_MS,
  GOODS_IN_QUEUE,
  LINE_A_RECIPE,
  WAREHOUSE_SLOTS,
  slotRegister,
} from './warehouse.js';

/** Scans of the standard 50 ms grading step that cover `ms` of plant time. */
const scans = (ms: number): number => Math.ceil(ms / 50);

const dev = (address: string, io: 'input' | 'output'): PuzzleDevice => ({
  address,
  label: address,
  io,
  widget: io === 'input' ? 'sensor' : 'motor',
});

/** Bare crane: the aisle and the fork, and nothing that demands anything of it. */
const bare: PuzzleDevice[] = [dev('X20', 'input'), dev('Y0', 'output')];
/** One production line calling for material. */
const lineA: PuzzleDevice[] = [...bare, dev('X10', 'input')];
/** Both lines. */
const bothLines: PuzzleDevice[] = [...lineA, dev('X11', 'input')];
/** Both lines and the goods-in conveyor: the full machine. */
const full: PuzzleDevice[] = [...bothLines, dev('X12', 'input')];
/** Goods-in with no lines at all: the first puzzle's single scripted put-away. */
const putAwayOnly: PuzzleDevice[] = [...bare, dev('X12', 'input')];

interface Run {
  machine: MachineState;
  derivedInputs: Record<string, boolean>;
  derivedRegisters: Record<string, number>;
}

/**
 * Step the plant `n` times. `script` may override the outputs or the scenario
 * inputs per step, which is how the sequencing tests below drive the crane.
 */
function run(
  devices: PuzzleDevice[],
  start: MachineState,
  outputs: Record<string, boolean>,
  n: number,
  dtMs = 50,
  inputs: Record<string, boolean> = {},
  script?: (m: MachineState, i: number) => {
    outputs?: Record<string, boolean>;
    inputs?: Record<string, boolean>;
  },
): Run {
  const process = getProcess('warehouse');
  let machine = start;
  let derivedInputs: Record<string, boolean> = {};
  let derivedRegisters: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const over = script?.(machine, i) ?? {};
    const res = process.step({
      outputs: over.outputs ?? outputs,
      inputs: over.inputs ?? inputs,
      registers: {},
      machine,
      devices,
      dtMs,
    });
    machine = res.machine;
    derivedInputs = res.derivedInputs ?? {};
    derivedRegisters = res.derivedRegisters ?? {};
  }
  return { machine, derivedInputs, derivedRegisters };
}

const init = (devices: PuzzleDevice[]): MachineState => getProcess('warehouse').init(devices);

/**
 * Drive to a station the way a correct program does: hold the direction coils
 * until the sensors say you are there, then let go.
 *
 * It stops the instant it arrives rather than running a fixed budget, because
 * the plant has clocks in it now - a helper that idles for the leftover scans
 * would feed the lines and fill the goods-in conveyor behind the test's back.
 */
function driveTo(
  devices: PuzzleDevice[],
  start: MachineState,
  bay: number,
  level: number,
  inputs: Record<string, boolean> = {},
): MachineState {
  const process = getProcess('warehouse');
  let m = start;
  for (let i = 0; i < 400; i++) {
    const pos = m.pos as number;
    const lvl = m.level as number;
    if (Math.abs(pos - bay) <= 0.02 && Math.abs(lvl - level) <= 0.02) return m;
    m = process.step({
      outputs: {
        Y0: pos < bay - 0.02,
        Y1: pos > bay + 0.02,
        Y2: lvl < level - 0.02,
        Y3: lvl > level + 0.02,
      },
      inputs,
      registers: {},
      machine: m,
      devices,
      dtMs: 50,
    }).machine;
  }
  throw new Error(`crane never reached bay ${bay} level ${level}`);
}

/** Run the fork all the way out and all the way back in again. */
function forkCycle(
  devices: PuzzleDevice[],
  start: MachineState,
  inputs: Record<string, boolean> = {},
): MachineState {
  const out = run(devices, start, { Y4: true }, 14, 50, inputs);
  return run(devices, out.machine, {}, 12, 50, inputs).machine;
}

describe('warehouse process — the aisle', () => {
  it('lands exactly on a position sensor whatever route it took to get there', () => {
    // Four bays out and three back: eleven position boundaries of float
    // addition, and it still has to read as being at bay 1 on the nose.
    let m = init(bare);
    m = driveTo(bare, m, 4, 2);
    m = driveTo(bare, m, 1, 1);
    expect(m.pos).toBe(1);
    expect(m.level).toBe(1);
    const { derivedInputs, derivedRegisters } = run(bare, m, {}, 1);
    expect(derivedInputs.X21).toBe(true);
    expect(derivedInputs.X26).toBe(true);
    expect(derivedRegisters.D0).toBe(1);
    expect(derivedRegisters.D1).toBe(1);
  });

  /**
   * What makes `[= D0 D50]` usable as "arrived". A rounded encoder would call
   * itself bay 2 half way between bays 1 and 2 and stop the crane in mid air.
   */
  it('holds the encoder at the last sensor it passed, never at the nearest one', () => {
    const rolling = run(bare, init(bare), { Y0: true }, 26); // 1.625 positions
    expect(rolling.machine.pos as number).toBeGreaterThan(1.5);
    expect(rolling.derivedRegisters.D0).toBe(1);

    const further = run(bare, rolling.machine, { Y0: true }, 6); // past bay 2
    expect(further.derivedRegisters.D0).toBe(2);
  });

  it('travels and lifts at the same time, so a move costs the longer of the two', () => {
    // Bay 1 is 800 ms away and the level change is 600 ms, so arriving at both
    // takes 800 ms - 16 scans - not 1400.
    const { machine } = run(bare, init(bare), { Y0: true, Y2: true }, 16);
    expect(machine.pos).toBe(1);
    expect(machine.level).toBe(2);
  });

  it('holds at the end stops rather than faulting on one scan of overtravel', () => {
    const { machine, derivedInputs } = run(bare, init(bare), { Y1: true, Y3: true }, 40);
    expect(machine.pos).toBe(0);
    expect(machine.level).toBe(1);
    expect(machine.jam).toBe(false);
    expect(derivedInputs.X20).toBe(true);
  });

  it('stands still when both directions are commanded at once', () => {
    const { machine } = run(bare, init(bare), { Y0: true, Y1: true, Y2: true, Y3: true }, 40);
    expect(machine.pos).toBe(0);
    expect(machine.level).toBe(1);
    expect(machine.jam).toBe(false);
  });
});

describe('warehouse process — the fork', () => {
  it('wrecks the mast if the crane moves with the fork out', () => {
    const out = run(bare, init(bare), { Y4: true }, 14);
    expect(out.derivedInputs.X29).toBe(true);
    const driven = run(bare, out.machine, { Y4: true, Y0: true }, 2);
    expect(driven.machine.jam).toBe(true);
    expect(driven.machine.jamReason).toContain('fork still out');
  });

  it('still blocks the move while the fork is only part way back in', () => {
    const out = run(bare, init(bare), { Y4: true }, 14);
    const halfBack = run(bare, out.machine, {}, 4);
    expect(halfBack.derivedInputs.X28).toBe(false);
    const driven = run(bare, halfBack.machine, { Y0: true }, 2);
    expect(driven.machine.jam).toBe(true);
  });

  it('wrecks the fork if it is run out between slots', () => {
    // Stop the traverse half way between bay 1 and bay 2, then stroke.
    const rolling = run(bare, init(bare), { Y0: true }, 24);
    expect(rolling.machine.pos).toBeCloseTo(1.5, 6);
    const stroked = run(bare, rolling.machine, { Y4: true }, 2);
    expect(stroked.machine.jam).toBe(true);
    expect(stroked.machine.jamReason).toContain('between slots');
  });

  it('picks a pallet up out of a rack slot and leaves the slot empty', () => {
    const atBay1 = driveTo(bare, init(bare), 1, 1);
    expect(atBay1.slot11).toBe(1);
    const after = forkCycle(bare, atBay1);
    expect(after.carrying).toBe(true);
    expect(after.loadCode).toBe(1);
    expect(after.slot11).toBe(0);
  });

  it('comes up empty from an empty slot without faulting', () => {
    const atBay1 = driveTo(bare, init(bare), 1, 1);
    const emptied = forkCycle(bare, atBay1);
    // Put it back, then reach into the same slot a third time with nothing there.
    const replaced = forkCycle(bare, emptied);
    expect(replaced.carrying).toBe(false);
    expect(replaced.slot11).toBe(1);
  });

  it('refuses to push a pallet into a slot that already has one', () => {
    const atBay1 = driveTo(bare, init(bare), 1, 1);
    const holding = forkCycle(bare, atBay1); // picked bay 1 level 1
    const atBay2 = driveTo(bare, holding, 2, 1); // bay 2 level 1 holds material 3
    const crashed = forkCycle(bare, atBay2);
    expect(crashed.jam).toBe(true);
    expect(crashed.jamReason).toContain('already had one in it');
  });

  it('reports the carriage photo-eye only for the slot it is parked at', () => {
    const atBay1 = driveTo(bare, init(bare), 1, 1);
    expect(run(bare, atBay1, {}, 1).derivedInputs.X13).toBe(true);
    const emptied = forkCycle(bare, atBay1);
    expect(run(bare, emptied, {}, 1).derivedInputs.X13).toBe(false);
  });

  it('publishes every slot of the WMS table as its own register', () => {
    const { derivedRegisters } = run(bare, init(bare), {}, 1);
    for (const slot of WAREHOUSE_SLOTS) {
      const reg = slotRegister(slot.bay, slot.level);
      expect(derivedRegisters[reg], reg).toBe(init(bare)[slot.key]);
    }
    expect(derivedRegisters.D101).toBe(1);
    expect(derivedRegisters.D204).toBe(3);
  });
});

describe('warehouse process — the production lines', () => {
  const running = { X4: true, X5: true };

  it('calls for a pallet only while the line is running and has room', () => {
    const idle = run(bothLines, init(bothLines), {}, 1, 50, {});
    expect(idle.derivedInputs.X10).toBe(false);

    // One pallet on the conveyor at power-up, so a running line is calling for
    // its second from the first scan.
    const justStarted = run(bothLines, init(bothLines), {}, 1, 50, running);
    expect(justStarted.machine.bufferA).toBe(1);
    expect(justStarted.derivedInputs.X10).toBe(true);
  });

  it('stops calling once its conveyor is full again', () => {
    const atSlot = driveTo(lineA, init(lineA), 1, 2, running); // material 2
    const holding = forkCycle(lineA, atSlot, running);
    const atLine = driveTo(lineA, holding, 0, 1, running);
    const delivered = forkCycle(lineA, atLine, running);
    expect(delivered.bufferA).toBe(2);
    expect(run(lineA, delivered, {}, 1, 50, running).derivedInputs.X10).toBe(false);
  });

  it('names the next material it will accept, and only that one', () => {
    const { derivedRegisters } = run(lineA, init(lineA), {}, 1, 50, running);
    expect(derivedRegisters.D10).toBe(LINE_A_RECIPE[0]);
  });

  it('takes the material it asked for and moves its demand on', () => {
    // Line A wants material 2 first; bay 1 level 2 has one.
    const atSlot = driveTo(lineA, init(lineA), 1, 2, running);
    const holding = forkCycle(lineA, atSlot, running);
    expect(holding.loadCode).toBe(2);
    const atLine = driveTo(lineA, holding, 0, 1, running);
    const delivered = forkCycle(lineA, atLine, running);
    expect(delivered.jam).toBe(false);
    expect(delivered.deliveredA).toBe(1);
    const { derivedRegisters } = run(lineA, delivered, {}, 1, 50, running);
    expect(derivedRegisters.D10).toBe(LINE_A_RECIPE[1]);
  });

  it('rejects a pallet of the wrong material at the infeed', () => {
    // Line A wants material 2; hand it the material 1 out of bay 1 level 1.
    const atSlot = driveTo(lineA, init(lineA), 1, 1, running);
    const holding = forkCycle(lineA, atSlot, running);
    expect(holding.loadCode).toBe(1);
    const atLine = driveTo(lineA, holding, 0, 1, running);
    const refused = forkCycle(lineA, atLine, running);
    expect(refused.jam).toBe(true);
    expect(refused.jamReason).toContain('handed material 1');
  });

  it('stops the line when its consume tick finds the buffer empty', () => {
    // One pallet of slack and nothing delivered: the first tick eats it, and
    // the second finds nothing left.
    const fed = run(lineA, init(lineA), {}, scans(CONSUME_MS * 1.5), 50, { X4: true });
    expect(fed.machine.starved).toBe(false);
    expect(fed.machine.bufferA).toBe(0);
    const starved = run(lineA, fed.machine, {}, scans(CONSUME_MS), 50, { X4: true });
    expect(starved.machine.starved).toBe(true);
  });

  it('leaves a line that is not running alone', () => {
    const parked = run(bothLines, init(bothLines), {}, 2000, 50, {});
    expect(parked.machine.starved).toBe(false);
    expect(parked.machine.bufferA).toBe(1);
  });

});

describe('warehouse process — goods in', () => {
  const running = { X4: true, X5: true };

  it('hands over the pallet waiting on the conveyor', () => {
    const atGoodsIn = driveTo(full, init(full), 0, 2, running);
    expect(run(full, atGoodsIn, {}, 1, 50, running).derivedInputs.X12).toBe(true);
    const holding = forkCycle(full, atGoodsIn, running);
    expect(holding.carrying).toBe(true);
    expect(holding.loadCode).toBe(GOODS_IN_QUEUE[0]);
    expect(holding.goodsWaiting).toBe(0);
  });

  it('puts a pallet away into an empty slot and records it in the table', () => {
    const atGoodsIn = driveTo(full, init(full), 0, 2, running);
    const holding = forkCycle(full, atGoodsIn, running);
    // Bay 2 level 2 is one of the two slots the goods-in rack leaves empty.
    const atSlot = driveTo(full, holding, 2, 2, running);
    const stored = forkCycle(full, atSlot, running);
    expect(stored.jam).toBe(false);
    expect(stored.slot22).toBe(GOODS_IN_QUEUE[0]);
    expect(stored.storedAway).toBe(1);
    const { derivedRegisters } = run(full, stored, {}, 1, 50, running);
    expect(derivedRegisters.D202).toBe(GOODS_IN_QUEUE[0]);
  });

  it('will not take a pallet back out onto the inbound conveyor', () => {
    const atBay1 = driveTo(full, init(full), 1, 1, running);
    const holding = forkCycle(full, atBay1, running);
    const atGoodsIn = driveTo(full, holding, 0, 2, running);
    const refused = forkCycle(full, atGoodsIn, running);
    expect(refused.jam).toBe(true);
    expect(refused.jamReason).toContain('only runs inwards');
  });

  it('backs the conveyor up when nothing is put away', () => {
    // One pallet is already waiting, so the first arrival fills the conveyor
    // and the second has nowhere to go.
    const idle = run(full, init(full), {}, scans(GOODS_IN_MS * 1.5), 50, running);
    expect(idle.machine.goodsWaiting).toBe(2);
    expect(idle.machine.blocked).toBe(false);
    const backedUp = run(full, idle.machine, {}, scans(GOODS_IN_MS), 50, running);
    expect(backedUp.machine.blocked).toBe(true);
  });

  /**
   * Feature detection, elevator5-door style. The first puzzle is a single
   * scripted put-away and must never grow a queue behind it, and a puzzle that
   * wires no lines must not be able to starve one.
   */
  it('gives a put-away-only puzzle one pallet, no inflow and no lines', () => {
    const quiet = run(putAwayOnly, init(putAwayOnly), {}, 2000, 50, { X4: true, X5: true });
    expect(quiet.machine.goodsWaiting).toBe(1);
    expect(quiet.machine.blocked).toBe(false);
    expect(quiet.machine.starved).toBeUndefined();
    expect(quiet.machine.bufferA).toBeUndefined();
    expect(quiet.derivedInputs.X10).toBeUndefined();
  });

  it('gives a retrieval-only puzzle a full rack and no goods-in at all', () => {
    const m = init(bothLines);
    expect(WAREHOUSE_SLOTS.every((s) => (m[s.key] as number) !== 0)).toBe(true);
    const { derivedInputs, derivedRegisters } = run(bothLines, m, {}, 1, 50, { X4: true });
    expect(derivedInputs.X12).toBeUndefined();
    expect(derivedRegisters.D12).toBeUndefined();
  });
});
