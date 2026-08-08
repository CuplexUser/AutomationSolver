import { parseAddress } from '../ladder/address.js';
import {
  saturate16,
  tasksInScanOrder,
  toProject,
  type CompareOp,
  type LadderElement,
  type LadderProject,
  type MathOp,
  type PidParams,
  type Pou,
  type ProgramDoc,
  type TaskDef,
} from '../ladder/types.js';
import { parseValueOperand, readValue, type ValueRef } from '../ladder/value.js';
import { evaluateRung, type RungEvalResult } from './rungSolver.js';

/** Timer preset base: K units of 100ms (FX standard, K10 = 1.0s). */
export const TIMER_BASE_MS = 100;

interface TimerState {
  elapsed: number;
  preset: number;
}
interface CounterState {
  count: number;
  prevInput: boolean;
  preset: number;
}
/**
 * Per-block PID state, keyed by destination register (one loop per MV).
 *
 * `iAcc` is deliberately *not* a 16-bit register: it accumulates err x ms, which
 * a D register would saturate in a couple of seconds. Keeping it wide inside the
 * block is what lets the block carry hundredths-of-a-gain precision that a
 * hand-built P controller cannot.
 */
interface PidState {
  iAcc: number;
  prevPv: number;
  sinceSample: number;
  out: number;
  primed: boolean;
}

export interface SimSnapshot {
  bits: Record<string, boolean>;
  registers: Record<string, number>;
  timers: Record<string, { elapsed: number; preset: number; done: boolean }>;
  counters: Record<string, { count: number; preset: number; done: boolean }>;
}

/**
 * Deterministic ladder scan engine. Advances only by explicit dt so the client
 * animation and the server grader produce identical traces from the same inputs.
 */
export class SimEngine {
  project: LadderProject;
  private bits = new Map<string, boolean>();
  /**
   * Previous-scan input image, one per task.
   *
   * Edge contacts compare against the image captured at the end of the task's
   * own last execution, so a task running every 200 ms sees an edge that lasted
   * one 50 ms scan exactly once, on its next execution — rather than missing it
   * because a faster task already consumed it. For a single-task program (every
   * puzzle before the factory) there is one image snapshotted at the end of
   * every scan, which is precisely the behaviour this replaced.
   */
  private prevBits = new Map<string, Map<string, boolean>>();
  private registers = new Map<string, number>();
  private timers = new Map<string, TimerState>();
  private counters = new Map<string, CounterState>();
  private pids = new Map<string, PidState>();
  /** Simulated time, for deciding which periodic tasks are due. */
  private tMs = 0;
  /** Absolute simulated ms each periodic task is next due to run at. */
  private taskDue = new Map<string, number>();
  /**
   * Rung evaluation from each POU's most recent execution, keyed by POU id (for
   * UI highlighting). A POU whose task did not run this scan keeps its previous
   * results, so a slow task's windows hold their picture instead of flickering
   * dark between executions.
   */
  lastResults: Record<string, RungEvalResult[]> = {};
  /** POU lookup for the task loop; rebuilt only when the program changes. */
  private pouById = new Map<string, Pou>();

  constructor(program: ProgramDoc) {
    this.project = toProject(program);
    this.indexPous();
  }

  private indexPous(): void {
    this.pouById = new Map(this.project.pous.map((pou) => [pou.id, pou]));
  }

  reset(): void {
    this.bits.clear();
    this.prevBits.clear();
    this.registers.clear();
    this.timers.clear();
    this.counters.clear();
    this.pids.clear();
    this.tMs = 0;
    this.taskDue.clear();
    this.lastResults = {};
  }

  setProgram(program: ProgramDoc): void {
    this.project = toProject(program);
    this.indexPous();
    this.lastResults = {};
  }

  /** Rung results for one POU; empty before its first execution. */
  resultsFor(pouId: string): RungEvalResult[] {
    return this.lastResults[pouId] ?? [];
  }

  getBit(address: string): boolean {
    return this.bits.get(address) === true;
  }

  /** Set an input bit (typically an X device driven by the HMI / process). */
  setInput(address: string, value: boolean): void {
    this.bits.set(address, value);
  }

  setInputs(values: Record<string, boolean>): void {
    for (const [addr, val] of Object.entries(values)) this.bits.set(addr, val);
  }

  /** Read a data register. Never-written registers read as 0, like a real PLC. */
  getRegister(address: string): number {
    return this.registers.get(address) ?? 0;
  }

  /** Write a data register, saturating into 16 bits. */
  setRegister(address: string, value: number): void {
    this.registers.set(address, saturate16(value));
  }

  /** Set analog inputs (registers the process model drives from the field). */
  setRegisters(values: Record<string, number>): void {
    for (const [addr, val] of Object.entries(values)) this.setRegister(addr, val);
  }

  /** Resolve operand `i` of an element: a register read or a literal. */
  private operand(el: LadderElement, i: number): number {
    const raw = el.operands?.[i];
    if (raw === undefined) return 0;
    const ref: ValueRef | null = parseValueOperand(raw);
    return ref === null ? 0 : readValue(ref, this.registers);
  }

  private compare(op: CompareOp, a: number, b: number): boolean {
    switch (op) {
      case '=':
        return a === b;
      case '<>':
        return a !== b;
      case '>':
        return a > b;
      case '<':
        return a < b;
      case '>=':
        return a >= b;
      case '<=':
        return a <= b;
    }
  }

  private conducts(el: LadderElement): boolean {
    if (el.type === 'compare') {
      return this.compare((el.op as CompareOp) ?? '=', this.operand(el, 0), this.operand(el, 1));
    }
    const cur = this.bits.get(el.device) === true;
    const prev = this.currentPrev?.get(el.device) === true;
    switch (el.type) {
      case 'contact-no':
        return cur;
      case 'contact-nc':
        return !cur;
      case 'contact-rising':
        return cur && !prev;
      case 'contact-falling':
        return !cur && prev;
      case 'hwire':
        return true;
      default:
        return false;
    }
  }

  /**
   * Integer arithmetic, evaluated at full JS-number precision and only then
   * saturated on the store. So `MUL D0 K1000` overflows the *destination*
   * (saturating at 32767) rather than silently wrapping mid-expression, and the
   * fix a player reaches for — divide before you multiply — is the same one a
   * real 16-bit PLC forces.
   *
   * Division by zero leaves the destination unchanged rather than writing 0: a
   * control loop dividing by a measured value should freeze on a bad reading,
   * not slam its output to nothing.
   */
  private math(op: MathOp, a: number, b: number, dest: string): void {
    switch (op) {
      case 'add':
        this.setRegister(dest, a + b);
        return;
      case 'sub':
        this.setRegister(dest, a - b);
        return;
      case 'mul':
        this.setRegister(dest, a * b);
        return;
      case 'div':
        if (b === 0) return;
        this.setRegister(dest, Math.trunc(a / b));
    }
  }

  /**
   * One PID block. Runs on its own `sampleMs` rather than every scan (both
   * authentic and what decouples loop tuning from scan rate), holds its output
   * between samples, and clears its state whenever the rung drops so a
   * de-energized loop cannot wind up while it is effectively in manual.
   */
  private runPid(el: LadderElement, energized: boolean): void {
    const p: PidParams = el.pid ?? {
      kp: 0,
      ti: 0,
      td: 0,
      sampleMs: 100,
      outMin: 0,
      outMax: 0,
    };
    const key = el.device;
    const pv = this.operand(el, 1);
    const state = this.pids.get(key) ?? {
      iAcc: 0,
      prevPv: pv,
      sinceSample: 0,
      out: 0,
      primed: false,
    };

    if (!energized) {
      this.pids.set(key, { iAcc: 0, prevPv: pv, sinceSample: 0, out: state.out, primed: false });
      return;
    }

    const sv = this.operand(el, 0);
    const sampleMs = Math.max(1, p.sampleMs);
    state.sinceSample += this.currentDt;
    if (!state.primed || state.sinceSample >= sampleMs) {
      const err = p.reverse === true ? pv - sv : sv - pv;

      const iAccBefore = state.iAcc;
      if (p.ti > 0) state.iAcc += err * sampleMs;
      else state.iAcc = 0;

      const pTerm = Math.trunc((p.kp * err) / 100);
      const iTerm = p.ti > 0 ? Math.trunc((p.kp * state.iAcc) / (100 * p.ti)) : 0;
      const dTerm =
        p.td > 0 && state.primed
          ? Math.trunc((p.kp * p.td * (state.prevPv - pv)) / (100 * sampleMs))
          : 0;

      const raw = pTerm + iTerm + dTerm;
      // Conditional integration: if the output is against a limit, this sample's
      // integral contribution is rolled back instead of accumulating into a
      // wind-up the loop would have to unwind before it could ever come back.
      if (raw > p.outMax || raw < p.outMin) state.iAcc = iAccBefore;

      state.out = raw > p.outMax ? p.outMax : raw < p.outMin ? p.outMin : raw;
      state.prevPv = pv;
      state.sinceSample = 0;
      state.primed = true;
    }

    this.pids.set(key, state);
    this.setRegister(key, state.out);
  }

  private applyOutput(el: LadderElement, energized: boolean): void {
    switch (el.type) {
      case 'coil-out':
        this.bits.set(el.device, energized);
        return;
      case 'coil-set':
        if (energized) this.bits.set(el.device, true);
        return;
      case 'coil-reset':
        if (energized) {
          this.bits.set(el.device, false);
          const ref = parseAddress(el.device);
          if (ref?.kind === 'D') this.registers.set(el.device, 0);
          if (ref?.kind === 'T') {
            const t = this.timers.get(el.device);
            this.timers.set(el.device, { elapsed: 0, preset: t?.preset ?? 0 });
          }
          if (ref?.kind === 'C') {
            const c = this.counters.get(el.device);
            if (c) c.count = 0;
            else this.counters.set(el.device, { count: 0, prevInput: false, preset: 0 });
          }
        }
        return;
      case 'timer': {
        const preset = el.preset ?? 0;
        const t = this.timers.get(el.device) ?? { elapsed: 0, preset };
        if (energized) t.elapsed += this.currentDt;
        else t.elapsed = 0;
        t.preset = preset;
        this.timers.set(el.device, t);
        const done = t.elapsed >= preset * TIMER_BASE_MS;
        this.bits.set(el.device, done);
        return;
      }
      case 'counter': {
        const preset = el.preset ?? 0;
        const c = this.counters.get(el.device) ?? { count: 0, prevInput: false, preset };
        if (energized && !c.prevInput) c.count += 1;
        c.prevInput = energized;
        c.preset = preset;
        this.counters.set(el.device, c);
        const done = c.count >= preset;
        this.bits.set(el.device, done);
        return;
      }
      case 'mov':
        if (energized) this.setRegister(el.device, this.operand(el, 0));
        return;
      case 'math':
        if (energized) {
          this.math(
            (el.op as MathOp) ?? 'add',
            this.operand(el, 0),
            this.operand(el, 1),
            el.device,
          );
        }
        return;
      case 'pid':
        this.runPid(el, energized);
    }
  }

  private currentDt = 0;
  /** Input image the running task's edge contacts compare against. */
  private currentPrev: Map<string, boolean> | undefined;

  /** Every POU of one task, in call order, at the task's own dt. */
  private runTask(task: TaskDef, taskDt: number): void {
    // Timers, counters and PID sample clocks inside a task advance by the
    // task's period, not by the scan's: a K10 timer on a 200 ms task still
    // finishes in 1.0 s, having been asked five times rather than twenty.
    this.currentDt = taskDt;
    this.currentPrev = this.prevBits.get(task.id) ?? new Map();

    for (const pouId of task.pous) {
      const pou = this.pouById.get(pouId);
      if (!pou) continue;
      const results: RungEvalResult[] = [];
      for (const rung of pou.rungs) {
        const result = evaluateRung(rung, (el) => this.conducts(el));
        for (const out of result.outputs) {
          this.applyOutput(out.element, out.energized);
        }
        results.push(result);
      }
      this.lastResults[pouId] = results;
    }

    // Snapshot this task's image for its *next* execution's edge detection.
    this.prevBits.set(task.id, new Map(this.bits));
    this.currentPrev = undefined;
  }

  /**
   * Run one scan, advancing time by dtMs.
   *
   * Tasks run in scan order (priority, then declaration). A task with no
   * interval runs every scan; a periodic one runs when simulated time reaches
   * its next due point, which advances by exact multiples of its interval so it
   * can never drift off the scan grid — the property that lets the client's live
   * run and the server's grade agree on which scan a slow task fired.
   */
  scan(dtMs: number): void {
    for (const task of tasksInScanOrder(this.project)) {
      if (task.intervalMs === undefined) {
        this.runTask(task, dtMs);
        continue;
      }
      // Due at t=0, so a periodic task gets its first execution on the first
      // scan rather than leaving the plant dark for a whole period.
      const due = this.taskDue.get(task.id) ?? 0;
      if (this.tMs < due) continue;
      this.taskDue.set(task.id, due + task.intervalMs);
      this.runTask(task, task.intervalMs);
    }
    this.tMs += dtMs;
  }

  snapshot(): SimSnapshot {
    const bits: Record<string, boolean> = {};
    for (const [k, v] of this.bits) bits[k] = v;
    const registers: Record<string, number> = {};
    for (const [k, v] of this.registers) registers[k] = v;
    const timers: Record<string, { elapsed: number; preset: number; done: boolean }> = {};
    for (const [k, v] of this.timers) timers[k] = { elapsed: v.elapsed, preset: v.preset, done: this.getBit(k) };
    const counters: Record<string, { count: number; preset: number; done: boolean }> = {};
    for (const [k, v] of this.counters) counters[k] = { count: v.count, preset: v.preset, done: this.getBit(k) };
    return { bits, registers, timers, counters };
  }
}
