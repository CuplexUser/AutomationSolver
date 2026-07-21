import { parseAddress } from '../ladder/address.js';
import type { LadderElement, LadderProgram } from '../ladder/types.js';
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

export interface SimSnapshot {
  bits: Record<string, boolean>;
  timers: Record<string, { elapsed: number; preset: number; done: boolean }>;
  counters: Record<string, { count: number; preset: number; done: boolean }>;
}

/**
 * Deterministic ladder scan engine. Advances only by explicit dt so the client
 * animation and the server grader produce identical traces from the same inputs.
 */
export class SimEngine {
  program: LadderProgram;
  private bits = new Map<string, boolean>();
  private prevBits = new Map<string, boolean>();
  private timers = new Map<string, TimerState>();
  private counters = new Map<string, CounterState>();
  /** Per-rung evaluation from the most recent scan (for UI highlighting). */
  lastRungResults: RungEvalResult[] = [];

  constructor(program: LadderProgram) {
    this.program = program;
  }

  reset(): void {
    this.bits.clear();
    this.prevBits.clear();
    this.timers.clear();
    this.counters.clear();
    this.lastRungResults = [];
  }

  setProgram(program: LadderProgram): void {
    this.program = program;
    this.lastRungResults = [];
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

  private conducts(el: LadderElement): boolean {
    const cur = this.bits.get(el.device) === true;
    const prev = this.prevBits.get(el.device) === true;
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
    }
  }

  private currentDt = 0;

  /** Run one scan cycle over the whole program, advancing time by dtMs. */
  scan(dtMs: number): void {
    this.currentDt = dtMs;
    // Edge contacts compare live bits against `prevBits`, the image captured at
    // the end of the previous scan (so an input changed just before this scan is
    // seen as an edge exactly once).
    this.lastRungResults = [];
    for (const rung of this.program.rungs) {
      const result = evaluateRung(rung, (el) => this.conducts(el));
      for (const out of result.outputs) {
        this.applyOutput(out.element, out.energized);
      }
      this.lastRungResults.push(result);
    }
    // Snapshot final image for next scan's edge detection.
    this.prevBits = new Map(this.bits);
  }

  snapshot(): SimSnapshot {
    const bits: Record<string, boolean> = {};
    for (const [k, v] of this.bits) bits[k] = v;
    const timers: Record<string, { elapsed: number; preset: number; done: boolean }> = {};
    for (const [k, v] of this.timers) timers[k] = { elapsed: v.elapsed, preset: v.preset, done: this.getBit(k) };
    const counters: Record<string, { count: number; preset: number; done: boolean }> = {};
    for (const [k, v] of this.counters) counters[k] = { count: v.count, preset: v.preset, done: this.getBit(k) };
    return { bits, timers, counters };
  }
}
