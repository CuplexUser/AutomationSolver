import {
  layoutTerminals,
  terminalId,
  type CabinetComponent,
  type CabinetLayout,
  type SupplyPotential,
  type TerminalId,
  type WiringDoc,
} from './types.js';

/**
 * Deterministic solver for a wired control cabinet.
 *
 * Electrical model (deliberately simple, and documented here because scenario
 * authors must rely on it):
 *
 * - Terminals joined by player wires or by closed internal contacts form NETS
 *   (disjoint-set union, same pattern as sim/rungSolver.ts). Loads — contactor
 *   coils, lamps, motor windings — never join nets; they are observed *across*
 *   two nets.
 * - Each net carries at most one supply potential (L1/L2/L3/N/PE). A net that
 *   touches two distinct supply potentials is a SHORT CIRCUIT: the main
 *   breaker "trips" — every potential is cleared for that solve, so everything
 *   de-energizes (no partial energization) and a fault string is reported.
 * - A coil or lamp is energized when its two terminals span two distinct
 *   non-PE potentials.
 * - Contactor coils are the sequential state. step() re-solves with the coil
 *   snapshot from the previous solve and iterates to a fixpoint (seal-in
 *   circuits converge in 1-2 iterations). A solve that keeps oscillating
 *   (contact chatter, e.g. a coil shorting its own supply) stops after
 *   MAX_SOLVE_ITERATIONS, forces every coil off and reports an "unstable"
 *   fault — the deterministic equivalent of the control fuse blowing.
 * - A 3-phase motor runs when U/V/W see three distinct phases. Direction comes
 *   from permutation parity: an even permutation of (L1,L2,L3) is 'fwd', an
 *   odd one (two phases swapped) is 'rev'. One or two phases only = the motor
 *   does not run and a single-phasing fault is reported.
 */

export const MAX_SOLVE_ITERATIONS = 8;

export interface MotorReading {
  running: boolean;
  direction: 'fwd' | 'rev' | 'none';
  singlePhased: boolean;
}

export interface CabinetSimResult {
  /** Terminals grouped by net, deterministic order. */
  nets: TerminalId[][];
  /** Potential per net (parallel to `nets`); null = floating or breaker-tripped. */
  netPotentials: (SupplyPotential | null)[];
  /** Potential seen by each terminal (null = floating / tripped). */
  terminalPotentials: Record<TerminalId, SupplyPotential | null>;
  /** Coil/lamp energization per component id. */
  energized: Record<string, boolean>;
  motors: Record<string, MotorReading>;
  /** True if any iteration of this step saw a short circuit. */
  shorted: boolean;
  /** True if the solve did not converge (contact chatter). */
  unstable: boolean;
  /** Human-readable fault strings (shorts, instability). */
  faults: string[];
  /** HMI view: one bit per component, keyed by hmiAddress ?? id. */
  bits: Record<string, boolean>;
}

class DSU {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** Internally conducting terminal pairs for a component in a given state. */
function conductionPairs(
  c: CabinetComponent,
  state: { coilOn: boolean; tripped: boolean; pressed: boolean },
): [string, string][] {
  switch (c.type) {
    case 'contactor':
      return state.coilOn
        ? [
            ['1', '2'],
            ['3', '4'],
            ['5', '6'],
            ['13', '14'],
          ]
        : [['21', '22']];
    case 'overload':
      return state.tripped
        ? [['97', '98']]
        : [
            ['1', '2'],
            ['3', '4'],
            ['5', '6'],
            ['95', '96'],
          ];
    case 'button-no':
      return state.pressed ? [['13', '14']] : [];
    case 'button-nc':
      return state.pressed ? [] : [['21', '22']];
    default:
      return [];
  }
}

interface SolveOutcome {
  rootOf: Map<TerminalId, number>;
  potentialOfRoot: Map<number, SupplyPotential | null>;
  coilOn: Map<string, boolean>;
  shorted: boolean;
  shortFaults: string[];
}

export class CabinetSim {
  private readonly layout: CabinetLayout;
  private readonly wiring: WiringDoc;
  private readonly terminals: TerminalId[];
  private readonly tIndex: Map<TerminalId, number>;
  private inputs: Record<string, boolean> = {};
  /** Sequential state: contactor coil energization carried across steps. */
  private coilState: Map<string, boolean> = new Map();
  private lastResult: CabinetSimResult;

  constructor(layout: CabinetLayout, wiring: WiringDoc) {
    this.layout = layout;
    this.wiring = wiring;
    this.terminals = layoutTerminals(layout);
    this.tIndex = new Map(this.terminals.map((t, i) => [t, i]));
    this.lastResult = this.emptyResult();
    this.reset();
  }

  reset(): void {
    this.inputs = {};
    this.coilState = new Map(
      this.layout.components.filter((c) => c.type === 'contactor').map((c) => [c.id, false]),
    );
    this.lastResult = this.emptyResult();
  }

  setInputs(partial: Record<string, boolean>): void {
    Object.assign(this.inputs, partial);
  }

  getBit(address: string): boolean {
    return this.lastResult.bits[address] === true;
  }

  get result(): CabinetSimResult {
    return this.lastResult;
  }

  /** Flattened machine-state view for scenario expectMachine assertions. */
  get machine(): Record<string, string | number | boolean> {
    const m: Record<string, string | number | boolean> = {
      shorted: this.lastResult.shorted,
      unstable: this.lastResult.unstable,
    };
    for (const [id, reading] of Object.entries(this.lastResult.motors)) {
      m[`${id}_running`] = reading.running;
      m[`${id}_direction`] = reading.direction;
    }
    for (const c of this.layout.components) {
      if (c.type === 'overload') m[`${c.id}_tripped`] = this.isTripped(c);
    }
    return m;
  }

  /**
   * Advance one scan. dt is accepted for engine-shape parity with SimEngine
   * (the cabinet has no time-dependent elements yet).
   */
  step(_dtMs: number): CabinetSimResult {
    let coils = new Map(this.coilState);
    let outcome = this.solveOnce(coils);
    let shorted = outcome.shorted;
    const shortFaults = new Set<string>(outcome.shortFaults);

    let converged = mapsEqual(outcome.coilOn, coils);
    for (let i = 0; !converged && i < MAX_SOLVE_ITERATIONS; i++) {
      coils = outcome.coilOn;
      outcome = this.solveOnce(coils);
      shorted = shorted || outcome.shorted;
      for (const f of outcome.shortFaults) shortFaults.add(f);
      converged = mapsEqual(outcome.coilOn, coils);
    }
    const unstable = !converged;

    if (unstable) {
      // Chatter: the control fuse blows — every coil forced off, one final solve.
      coils = new Map([...coils.keys()].map((k) => [k, false]));
      outcome = this.solveOnce(coils);
    }

    // In the unstable case the coils stay forced off, whatever the last solve
    // says they "would" do — that is the whole point of blowing the fuse.
    const finalCoils = unstable ? coils : outcome.coilOn;
    this.coilState = finalCoils;
    this.lastResult = this.buildResult(outcome, finalCoils, shorted, unstable, [...shortFaults]);
    return this.lastResult;
  }

  // ---------------------------------------------------------------- internals

  private isTripped(c: CabinetComponent): boolean {
    return c.hmiAddress != null && this.inputs[c.hmiAddress] === true;
  }

  private isPressed(c: CabinetComponent): boolean {
    return c.hmiAddress != null && this.inputs[c.hmiAddress] === true;
  }

  private solveOnce(coils: Map<string, boolean>): SolveOutcome {
    const dsu = new DSU(this.terminals.length);
    const idx = (t: TerminalId): number | undefined => this.tIndex.get(t);

    for (const w of this.wiring.wires) {
      const a = idx(w.from);
      const b = idx(w.to);
      // Unknown endpoints are validation errors; the solver just ignores them.
      if (a != null && b != null) dsu.union(a, b);
    }
    for (const c of this.layout.components) {
      const pairs = conductionPairs(c, {
        coilOn: coils.get(c.id) === true,
        tripped: this.isTripped(c),
        pressed: this.isPressed(c),
      });
      for (const [ta, tb] of pairs) {
        dsu.union(idx(terminalId(c.id, ta))!, idx(terminalId(c.id, tb))!);
      }
    }

    // Supply potentials per net.
    const potsOfRoot = new Map<number, Set<SupplyPotential>>();
    for (const c of this.layout.components) {
      if (c.type !== 'supply3ph') continue;
      for (const name of ['L1', 'L2', 'L3', 'N', 'PE'] as const) {
        const root = dsu.find(idx(terminalId(c.id, name))!);
        let set = potsOfRoot.get(root);
        if (!set) potsOfRoot.set(root, (set = new Set()));
        set.add(name);
      }
    }

    const shortFaults: string[] = [];
    for (const pots of potsOfRoot.values()) {
      if (pots.size > 1) shortFaults.push(`Short circuit: ${[...pots].join(' – ')} connected together`);
    }
    const shorted = shortFaults.length > 0;

    // Breaker-trip semantics: any short clears every potential.
    const potentialOfRoot = new Map<number, SupplyPotential | null>();
    if (!shorted) {
      for (const [root, pots] of potsOfRoot) potentialOfRoot.set(root, [...pots][0]);
    }

    const rootOf = new Map<TerminalId, number>();
    for (const t of this.terminals) rootOf.set(t, dsu.find(this.tIndex.get(t)!));

    const potAt = (t: TerminalId): SupplyPotential | null => potentialOfRoot.get(rootOf.get(t)!) ?? null;
    const energizes = (a: TerminalId, b: TerminalId): boolean => {
      const pa = potAt(a);
      const pb = potAt(b);
      return pa != null && pb != null && pa !== pb && pa !== 'PE' && pb !== 'PE';
    };

    const coilOn = new Map<string, boolean>();
    for (const c of this.layout.components) {
      if (c.type !== 'contactor') continue;
      coilOn.set(c.id, energizes(terminalId(c.id, 'A1'), terminalId(c.id, 'A2')));
    }

    return { rootOf, potentialOfRoot, coilOn, shorted, shortFaults };
  }

  private buildResult(
    outcome: SolveOutcome,
    finalCoils: Map<string, boolean>,
    shorted: boolean,
    unstable: boolean,
    shortFaults: string[],
  ): CabinetSimResult {
    const { rootOf, potentialOfRoot } = outcome;
    const potAt = (t: TerminalId): SupplyPotential | null => potentialOfRoot.get(rootOf.get(t)!) ?? null;
    const energizes = (a: TerminalId, b: TerminalId): boolean => {
      const pa = potAt(a);
      const pb = potAt(b);
      return pa != null && pb != null && pa !== pb && pa !== 'PE' && pb !== 'PE';
    };

    const netsByRoot = new Map<number, TerminalId[]>();
    for (const t of this.terminals) {
      const root = rootOf.get(t)!;
      let list = netsByRoot.get(root);
      if (!list) netsByRoot.set(root, (list = []));
      list.push(t);
    }
    const nets = [...netsByRoot.values()];
    const netPotentials = [...netsByRoot.keys()].map((root) => potentialOfRoot.get(root) ?? null);
    const terminalPotentials: Record<TerminalId, SupplyPotential | null> = {};
    for (const t of this.terminals) terminalPotentials[t] = potAt(t);

    const energized: Record<string, boolean> = {};
    const motors: Record<string, MotorReading> = {};
    const bits: Record<string, boolean> = {};
    const faults = [...shortFaults];
    if (unstable) faults.push('Unstable circuit: contacts chatter (control fuse blown)');

    for (const c of this.layout.components) {
      const addr = c.hmiAddress ?? c.id;
      switch (c.type) {
        case 'contactor': {
          const on = finalCoils.get(c.id) === true;
          energized[c.id] = on;
          bits[addr] = on;
          break;
        }
        case 'lamp': {
          const on = energizes(terminalId(c.id, 'X1'), terminalId(c.id, 'X2'));
          energized[c.id] = on;
          bits[addr] = on;
          break;
        }
        case 'motor3': {
          const reading = readMotor(potAt(terminalId(c.id, 'U')), potAt(terminalId(c.id, 'V')), potAt(terminalId(c.id, 'W')));
          motors[c.id] = reading;
          bits[addr] = reading.running;
          if (reading.singlePhased) faults.push(`${c.id} single-phased: fewer than 3 distinct phases`);
          break;
        }
        case 'button-no':
        case 'button-nc':
          bits[addr] = this.isPressed(c);
          break;
        case 'overload':
          bits[addr] = this.isTripped(c);
          break;
        case 'supply3ph':
          break;
      }
    }

    return { nets, netPotentials, terminalPotentials, energized, motors, shorted, unstable, faults, bits };
  }

  private emptyResult(): CabinetSimResult {
    return {
      nets: [],
      netPotentials: [],
      terminalPotentials: {},
      energized: {},
      motors: {},
      shorted: false,
      unstable: false,
      faults: [],
      bits: {},
    };
  }
}

function mapsEqual(a: Map<string, boolean>, b: Map<string, boolean>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const PHASES: readonly SupplyPotential[] = ['L1', 'L2', 'L3'];

function readMotor(
  u: SupplyPotential | null,
  v: SupplyPotential | null,
  w: SupplyPotential | null,
): MotorReading {
  const seq = [u, v, w];
  const phaseCount = new Set(seq.filter((p) => p != null && PHASES.includes(p))).size;
  if (phaseCount === 3) {
    // Permutation parity of (U,V,W) vs (L1,L2,L3): even = fwd, odd = rev.
    const perm = seq.map((p) => PHASES.indexOf(p!));
    const inversions =
      (perm[0] > perm[1] ? 1 : 0) + (perm[0] > perm[2] ? 1 : 0) + (perm[1] > perm[2] ? 1 : 0);
    return { running: true, direction: inversions % 2 === 0 ? 'fwd' : 'rev', singlePhased: false };
  }
  return { running: false, direction: 'none', singlePhased: phaseCount > 0 };
}
