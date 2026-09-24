import { describe, expect, it } from 'vitest';
import type { MachineState } from './index.js';
import {
  distribution,
  DOOR_MS,
  EXIT_MS,
  LOOP_MM,
  QA_MS,
  RIPEN_MS,
  STALL_MS,
  VEHICLE_MM,
  parsePallet,
} from './distribution.js';

/** Every device the hub can have, so every sensor is published. */
const ALL = [
  'X0', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X10', 'X11', 'X12', 'X13', 'X14',
  'X15', 'X16', 'X17', 'X20', 'X21', 'X22', 'X23', 'X24', 'X25', 'X26',
  'D5', 'D7', 'D8', 'D9', 'D11', 'D13', 'D14', 'D15', 'D16', 'D21', 'D22', 'D31', 'D32', 'D33', 'D41', 'D42', 'D43',
  'D61', 'D62', 'D81', 'D82', 'D83', 'D101', 'D102', 'D103', 'D104',
].map((address) => ({ address, label: address, io: 'input' as const, widget: 'sensor' as const }));

interface Rig {
  m: MachineState;
  bits: Record<string, boolean>;
  regs: Record<string, number>;
  outputs: Record<string, boolean>;
  cmd: Record<string, number>;
  t: number;
}

function rig(config: MachineState): Rig {
  const m = { ...distribution.init(ALL), ...config };
  const primed = distribution.step({ outputs: {}, inputs: {}, registers: {}, machine: m, devices: ALL, dtMs: 0 });
  return { m, bits: primed.derivedInputs ?? {}, regs: primed.derivedRegisters ?? {}, outputs: {}, cmd: {}, t: 0 };
}

function tick(r: Rig, dt = 50): void {
  const res = distribution.step({
    outputs: r.outputs,
    inputs: {},
    registers: r.cmd,
    machine: r.m,
    devices: ALL,
    dtMs: dt,
  });
  r.m = res.machine;
  r.bits = res.derivedInputs ?? {};
  r.regs = res.derivedRegisters ?? {};
  r.t += dt;
}

function runFor(r: Rig, ms: number, dt = 50): void {
  for (let t = 0; t < ms; t += dt) tick(r, dt);
}

function runUntil(r: Rig, done: (r: Rig) => boolean, limitMs = 120_000, dt = 50): void {
  for (let t = 0; t < limitMs; t += dt) {
    if (done(r)) return;
    tick(r, dt);
  }
  throw new Error(`timed out; jam: ${String(r.m.jamReason)}`);
}

/** The four-phase handshake, the way a program would do it. */
function dispatch(r: Rig, from: number, to: number, asn?: number): void {
  r.cmd = { ...r.cmd, D0: from, D1: to, ...(asn === undefined ? {} : { D3: asn }) };
  r.outputs = { ...r.outputs, Y0: true };
  runUntil(r, (x) => x.bits.X0 === true || x.bits.X1 === true || x.m.jam === true, 60_000);
  r.outputs = { ...r.outputs, Y0: false };
  tick(r);
}

const noFault = (r: Rig) => expect(r.m.jamReason).toBe('');

describe('distribution: the fleet is the same fleet at any dt', () => {
  function trace(dt: number): string[] {
    const r = rig({ locs: '1,10,61', fleet: 2, in1: '301P,302P,303P', inFirst: 500, inEvery: 3000 });
    const samples: string[] = [];
    let queued = 0;
    for (let t = 0; t < 60_000; t += dt) {
      // A controller that only acts on 300 ms boundaries, so every dt sees the same commands.
      if (t % 300 === 0) {
        if (r.bits.X0 || r.bits.X1) r.outputs = { Y0: false };
        else if (queued < 3 && r.bits.X3 && !r.outputs.Y0) {
          r.cmd = { D0: 1, D1: 10 };
          r.outputs = { Y0: true };
          queued++;
        }
        samples.push(
          [0, 1].map((i) => `${String(r.m[`v${i}S`])}@${String(r.m[`v${i}Pos`])}/${String(r.m[`v${i}Pk`])}`).join(' '),
        );
      }
      tick(r, dt);
    }
    return samples;
  }

  it('drives identically at 10, 50 and 60 ms', () => {
    const at50 = trace(50);
    expect(trace(10)).toEqual(at50);
    expect(trace(60)).toEqual(at50);
    expect(at50.some((s) => s.includes('drive'))).toBe(true);
  });
});

describe('distribution: the mailbox', () => {
  it('holds ACK until the request drops, then lets it go', () => {
    const r = rig({ locs: '1,10,61', in1: '301P', inFirst: 100 });
    runFor(r, 500);
    r.cmd = { D0: 1, D1: 10 };
    r.outputs = { Y0: true };
    tick(r);
    expect(r.bits.X0).toBe(true);
    runFor(r, 500);
    expect(r.bits.X0).toBe(true);
    r.outputs = { Y0: false };
    tick(r);
    expect(r.bits.X0).toBe(false);
  });

  it('refuses an order it cannot understand, and nothing else', () => {
    const r = rig({ locs: '1,10,61' });
    for (const [from, to] of [
      [1, 1],
      [11, 10],
      [1, 33],
      [61, 10],
      [0, 70],
    ]) {
      r.cmd = { D0: from, D1: to };
      r.outputs = { Y0: true };
      tick(r);
      expect(r.bits.X1, `${from} to ${to}`).toBe(true);
      expect(r.bits.X0).toBe(false);
      r.outputs = { Y0: false };
      tick(r);
      expect(r.bits.X1).toBe(false);
    }
  });

  it('does not answer at all while every vehicle is busy', () => {
    const r = rig({ locs: '1,10,61', in1: '301P,302P', inFirst: 100, inEvery: 100 });
    runFor(r, 500);
    dispatch(r, 1, 10);
    r.cmd = { D0: 1, D1: 10 };
    r.outputs = { Y0: true };
    runFor(r, 1000);
    expect(r.bits.X0).toBe(false);
    expect(r.bits.X1).toBe(false);
    expect(r.regs.D7).toBe(0);
  });
});

describe('distribution: a pallet through the hub', () => {
  it('goes dock, QA, truck with one vehicle, and the vehicle parks where it finished', () => {
    const r = rig({ locs: '1,10,61', in1: '305P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.bits.X6 === true);
    expect(r.bits.X7).toBe(true);
    expect(r.regs.D5).toBe(305);
    dispatch(r, 10, 61);
    runUntil(r, (x) => x.m.shipped === 1);
    runUntil(r, (x) => x.m.v0S === 'park');
    expect(r.m.v0Pk).toBe(50_000);
    noFault(r);
    expect(r.m.received).toBe(1);
  });

  it('keeps QA shut until the check is done, and reveals nothing before', () => {
    const r = rig({ locs: '1,10,61', in1: '305F', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.bits.X5 === true);
    expect(r.bits.X6).toBe(false);
    expect(r.regs.D5).toBe(0);
    runFor(r, QA_MS + 100);
    expect(r.bits.X6).toBe(true);
    expect(r.bits.X7).toBe(false);
  });

  it('waits holding a pallet the destination cannot take, then stalls', () => {
    const r = rig({ locs: '1,2,10,61', in1: '301P', in2: '302P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true && x.bits.X4 === true);
    dispatch(r, 1, 10);
    dispatch(r, 2, 10);
    runUntil(r, (x) => x.m.jam === true, STALL_MS + 60_000);
    expect(r.m.stalled).toBe(true);
    expect(String(r.m.jamReason)).toContain('waiting to set down at QA');
  });
});

describe('distribution: the rules a pallet is held to', () => {
  it('sends nothing past QA unchecked', () => {
    const r = rig({ locs: '1,10,61', in1: '301P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 61);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('without going through QA');
  });

  it('quarantines what fails, and only that', () => {
    const r = rig({ locs: '1,10,11,61', in1: '301F', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.bits.X6 === true);
    dispatch(r, 10, 61);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('failed QA');
  });

  it('faults a vehicle sent to an empty dock', () => {
    const r = rig({ locs: '1,10,61' });
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('nothing was there');
  });

  it('buries nothing in a drive-in lane', () => {
    const r = rig({ locs: '1,10,41,61', c41: '305pn0', in1: '306P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.bits.X6 === true);
    dispatch(r, 10, 41);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('buried');
  });

  it('lets an older lot of the same product go in front of a newer one', () => {
    const r = rig({ locs: '1,10,41,61', c41: '306pn0', in1: '305P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.bits.X6 === true);
    dispatch(r, 10, 41);
    runUntil(r, (x) => x.regs.D41 === 2);
    noFault(r);
  });

  it('ships the oldest lot first', () => {
    const r = rig({ locs: '1,10,31,32,61', c31: '307pn0', c32: '305pn0' });
    dispatch(r, 31, 61);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('the oldest lot ships first');
  });

  it('counts an older lot a vehicle is already fetching as leaving first', () => {
    // Two vehicles, the older lot's pick ordered first but further away: the
    // newer one is lifted first, and nothing old is left behind for it.
    const r = rig({ locs: '10,41,42,61,62', fleet: 2, c41: '404pn0', c42: '403pn0' });
    dispatch(r, 42, 61);
    dispatch(r, 41, 62);
    runUntil(r, (x) => x.m.shipped === 2);
    noFault(r);
  });

  it('checks the shipping notice against the pallet', () => {
    const r = rig({ locs: '10,31,61', asn: true, c31: '305pn0,306pn0' });
    dispatch(r, 31, 61, 305);
    runUntil(r, (x) => x.m.shipped === 1);
    dispatch(r, 31, 61, 305);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('said 305');
  });
});

describe('distribution: the wrapper and its labeler', () => {
  it('holds a pallet at the labeler until it has the right label', () => {
    const r = rig({ locs: '10,31,50,51,61,62', routes: '61,62,61,62', c31: '402pn0' });
    dispatch(r, 31, 50);
    runUntil(r, (x) => x.bits.X11 === true);
    r.cmd = { ...r.cmd, D2: 62 };
    r.outputs = { Y1: true };
    tick(r);
    r.outputs = {};
    runUntil(r, (x) => x.bits.X12 === true);
    dispatch(r, 51, 62);
    runUntil(r, (x) => x.m.shipped === 1);
    noFault(r);
  });

  it('faults a label for the wrong dock', () => {
    const r = rig({ locs: '10,31,50,51,61,62', routes: '61,62,61,62', c31: '402pn0' });
    dispatch(r, 31, 50);
    runUntil(r, (x) => x.bits.X11 === true);
    r.cmd = { ...r.cmd, D2: 61 };
    r.outputs = { Y1: true };
    tick(r);
    expect(String(r.m.jamReason)).toContain('it ships from OUT2');
  });

  it('refuses an unlabeled pallet at a dock', () => {
    const r = rig({ locs: '10,31,50,51,61', c31: '402pn0' });
    dispatch(r, 31, 61);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('without a label');
  });
});

describe('distribution: ripening rooms', () => {
  it('ripens a closed room, and spoils a room opened mid-cycle', () => {
    const r = rig({ locs: '10,21,31,61', c21: '101pg0,102pg0' });
    r.outputs = { Y4: true };
    tick(r);
    expect(r.m.r1Run).toBe(true);
    runFor(r, RIPEN_MS);
    expect(r.bits.X17).toBe(true);
    expect(parsePallet(String(r.m.c21).split(',')[0]).ripe).toBe('r');

    const s = rig({ locs: '10,21,31,61', c21: '101pg0' });
    s.outputs = { Y4: true };
    tick(s);
    s.outputs = { Y2: true };
    tick(s);
    expect(String(s.m.jamReason)).toContain('spoiled');
  });

  it('will not start with the door open, and closes on no vehicle', () => {
    const r = rig({ locs: '10,21,31,61', c21: '101pg0' });
    r.outputs = { Y2: true };
    runFor(r, DOOR_MS + 100);
    expect(r.bits.X15).toBe(true);
    r.outputs = { Y2: true, Y4: true };
    tick(r);
    expect(String(r.m.jamReason)).toContain('started with its door open');
  });

  it('keeps one product to a batch', () => {
    const r = rig({ locs: '1,10,21,61', c21: '101pg0', c10: '201pg0' });
    r.outputs = { Y2: true };
    runFor(r, DOOR_MS + 100);
    dispatch(r, 10, 21);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('one product per batch');
  });
});

describe('distribution: traffic', () => {
  it('never lets two vehicles closer than a vehicle length on the loop', () => {
    const r = rig({
      locs: '1,2,10,11,31,61',
      fleet: 3,
      in1: '301P,302P,303P,304P',
      in2: '401F,402P,403P',
      inFirst: 100,
      inEvery: 2000,
    });
    let minGap = Infinity;
    let mostDriving = 0;
    // The reservations any correct program needs: QA only reports a pallet once
    // it is on the table, so without these a second order heads for QA, or a
    // second vehicle is sent to collect a pallet somebody already has.
    let toQa = false;
    let fromQa = false;
    let wasOnQa = false;
    for (let t = 0; t < 250_000; t += 50) {
      if (r.bits.X5 && !wasOnQa) toQa = false;
      if (!r.bits.X5 && wasOnQa) fromQa = false;
      wasOnQa = r.bits.X5 === true;
      if (r.bits.X0 || r.bits.X1) r.outputs = { Y0: false };
      else if (!r.outputs.Y0) {
        r.cmd = {};
        if (r.bits.X6 && !fromQa) {
          r.cmd = { D0: 10, D1: r.bits.X7 ? 61 : 11 };
          fromQa = true;
        } else if (!toQa && !r.bits.X5 && (r.bits.X3 || r.bits.X4)) {
          r.cmd = { D0: r.bits.X3 ? 1 : 2, D1: 10 };
          toQa = true;
        }
        if (r.cmd.D0) r.outputs = { Y0: true };
      }
      tick(r);
      const on = [0, 1, 2].filter((i) => r.m[`v${i}S`] === 'drive').map((i) => Number(r.m[`v${i}Pos`]));
      mostDriving = Math.max(mostDriving, on.length);
      for (const a of on) {
        for (const b of on) {
          if (a === b) continue;
          const d = (((b - a) % LOOP_MM) + LOOP_MM) % LOOP_MM;
          minGap = Math.min(minGap, d);
        }
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(VEHICLE_MM);
    expect(mostDriving).toBeGreaterThanOrEqual(2);
    expect(r.m.jamReason).toBe('');
    // Everything that arrived went through QA and on to the truck or quarantine.
    expect(Number(r.m.received)).toBe(7);
    expect(Number(r.m.shipped)).toBe(6);
    expect(Number(r.m.quarantined)).toBe(1);
  });
});

describe('distribution: the stocktake download', () => {
  it('publishes seeded lanes once, on the priming step only', () => {
    const r = rig({ locs: '10,31,41,61', c31: '305pn0,306pn0', c41: '407pn0', stocktake: 'D200:31,D300:41' });
    expect(r.regs.D200).toBe(2);
    expect(r.regs.D201).toBe(305);
    expect(r.regs.D202).toBe(306);
    expect(r.regs.D300).toBe(1);
    expect(r.regs.D301).toBe(407);
    tick(r);
    expect(r.regs.D200).toBeUndefined();
    expect(EXIT_MS).toBeGreaterThan(0);
  });
});

describe('distribution: trucks and their orders', () => {
  it('feeds a docked truck\'s order line by line, in drop order', () => {
    const r = rig({ locs: '10,31,61', trucks61: '34', c31: '305pn0,405pn0' });
    runUntil(r, (x) => x.bits.X13 === true);
    expect(r.bits.X21).toBe(true);
    expect([r.regs.D8, r.regs.D9]).toEqual([61, 3]);
    r.outputs = { Y6: true };
    tick(r);
    r.outputs = {};
    tick(r);
    expect([r.regs.D8, r.regs.D9]).toEqual([61, 4]);
  });

  it('says how long the order of a docked truck is, and counts the trucks that leave loaded', () => {
    const r = rig({ locs: '10,31,61', trucks61: '3', c31: '305pn0' });
    expect(r.regs.D15).toBe(0);
    runUntil(r, (x) => x.bits.X13 === true);
    expect(r.regs.D15).toBe(1);
    dispatch(r, 31, 61);
    runUntil(r, (x) => x.bits.X13 === false);
    expect(r.regs.D15).toBe(0);
    expect(r.m.trucksOut).toBe(1);
  });

  it('fills the trailer last stop first, then sends it away', () => {
    const r = rig({ locs: '10,31,32,61', trucks61: '34', c31: '405pn0', c32: '305pn0' });
    runUntil(r, (x) => x.bits.X13 === true);
    dispatch(r, 31, 61);
    runUntil(r, (x) => x.regs.D61 === 1);
    dispatch(r, 32, 61);
    runUntil(r, (x) => x.bits.X13 === false);
    noFault(r);
    expect(r.m.shipped).toBe(2);
  });

  it('faults a trailer loaded in drop order', () => {
    const r = rig({ locs: '10,31,61', trucks61: '34', c31: '305pn0' });
    runUntil(r, (x) => x.bits.X13 === true);
    dispatch(r, 31, 61);
    runUntil(r, (x) => x.m.jam === true);
    expect(String(r.m.jamReason)).toContain('last stop first');
  });
});

describe('distribution: batteries', () => {
  it('runs a vehicle flat on the loop', () => {
    const r = rig({ locs: '1,10,61,70', battery: true, v0Batt: 5, in1: '301P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    runUntil(r, (x) => x.m.jam === true);
    expect(r.m.flat).toBe(true);
  });

  it('charges the idle vehicle with the lowest battery, and leaves it parked there', () => {
    const r = rig({ locs: '1,10,61,70', battery: true, fleet: 2, v0Batt: 900, v1Batt: 300 });
    expect(r.regs.D82).toBe(30);
    dispatch(r, 0, 70);
    runUntil(r, (x) => x.m.v1S === 'charge');
    expect(r.m.v0S).toBe('park');
    runUntil(r, (x) => x.m.v1S === 'park');
    expect(r.m.v1Pk).toBe(46_000);
    expect(r.regs.D82).toBe(100);
    noFault(r);
  });

  it('queues a charge for a busy vehicle until its job is done, and says so on X26', () => {
    const r = rig({ locs: '1,10,61,70', battery: true, fleet: 2, v0Batt: 900, v1Batt: 300, in1: '301P', inFirst: 100 });
    runUntil(r, (x) => x.bits.X3 === true);
    dispatch(r, 1, 10);
    expect(r.m.v1Leg).toBe('src');
    dispatch(r, 0, 70);
    expect(r.bits.X26).toBe(true);
    expect(r.m.v1ChgNext).toBe(true);
    expect(r.m.v0Leg).toBe('');
    runUntil(r, (x) => x.m.v1S === 'charge');
    // It finished the job first: the pallet is on QA.
    expect(r.m.c10).not.toBe('');
    runUntil(r, (x) => x.bits.X26 === false);
    expect(r.regs.D82).toBe(100);
    noFault(r);
  });
});

describe('distribution: outbound calls', () => {
  it('calls for one product at a time, is claimed on acceptance, and faults the wrong promise', () => {
    const r = rig({ locs: '10,31,32,61', asn: true, fleet: 2, calls61: '3,4', c31: '305pn0', c32: '306pn0' });
    tick(r);
    expect(r.regs.D13).toBe(3);
    dispatch(r, 31, 61, 305);
    expect(r.regs.D13).toBe(0);
    expect(r.m.shipped).toBe(0);
    runUntil(r, (x) => x.regs.D13 === 4);
    dispatch(r, 32, 61, 306);
    expect(String(r.m.jamReason)).toContain('calling for Potatoes and was promised 306');
  });
});
