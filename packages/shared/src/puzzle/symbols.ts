import { parseAddress } from '../ladder/address.js';
import {
  isWordInstruction,
  VAR_KIND_DEVICE,
  type LadderElement,
  type LadderProject,
  type Pou,
  type ProgramDoc,
  type Rung,
  type VarDecl,
  type VarKind,
} from '../ladder/types.js';
import { assembleProject, parseDeviceRange, playerPouIds, type DeviceRange } from './project.js';
import type { LadderPuzzleSpec, MemoryPools, PuzzleDevice } from './types.js';

/**
 * The symbol table: names over addresses, and the one pass that flattens them.
 *
 * A program is still a list of addresses by the time the engine sees it. This
 * module is the layer above that — locals private to a POU, globals shared
 * between them, and the plant's own sensors and actuators — resolved in exactly
 * one place, `resolveProject`, on the way from a submission to a `SimEngine`.
 *
 *   assembleProject(spec, submission) -> resolveProject(spec, project) -> SimEngine
 *
 * The engine, the rung solver and the scan cycle never learn that variables
 * exist, which is the same arrangement `toProject` used to put POUs over
 * `LadderProgram` without touching it. Resolution's last step is the literal
 * address itself, so an undeclared `M40` still *is* `M40` and every puzzle
 * written before symbols existed resolves to precisely the bytes it always did.
 *
 * ## Why locals are not just a naming convenience
 *
 * Names are scoped; memory is not. Every declaration in a project takes a
 * distinct address, locals included, because the engine holds one flat image —
 * two POUs whose locals landed on the same M would share one bit while reading
 * as though each had its own. That is the exact bug scoping exists to prevent
 * (a portal robot's step latch and a rack's room flag both on `M41`, invisible
 * until the rack filled), so the allocator is not permitted to recreate it.
 */

/** Where a resolved name came from, for error messages that can explain themselves. */
export type SymbolOrigin = 'local' | 'global' | 'plant' | 'literal';

export interface Resolution {
  address: string;
  origin: SymbolOrigin;
}

/** Names are matched case-insensitively, the way every real PLC tool matches them. */
const key = (name: string): string => name.trim().toLowerCase();

/** A name that would be ambiguous with the literal-address fallback. */
const LOOKS_LIKE_ADDRESS = /^[XYMTCD]\d{1,4}$/i;

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

export function isValidVarName(name: string): boolean {
  return NAME_RE.test(name.trim()) && !LOOKS_LIKE_ADDRESS.test(name.trim());
}

/**
 * Turn a device label into an identifier: `Frame Blank Ready` -> `FrameBlankReady`.
 *
 * Derived rather than authored so the 46 puzzles that predate symbols needed no
 * edits to gain one. A device may still set `symbol` explicitly where the
 * derived form would collide or read badly.
 */
export function deriveSymbol(label: string): string {
  const parts = label.split(/[^A-Za-z0-9]+/).filter((p) => p !== '');
  const joined = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (joined === '') return '';
  // An identifier cannot open with a digit, and `Lane 1 Count` is a real label.
  return /^\d/.test(joined) ? `_${joined}` : joined;
}

export function deviceSymbol(device: PuzzleDevice): string {
  return device.symbol?.trim() || deriveSymbol(device.label);
}

/** Plant symbols: the puzzle's actual sensors and actuators, and nothing else. */
export function plantSymbols(spec: LadderPuzzleSpec): Map<string, PuzzleDevice> {
  const table = new Map<string, PuzzleDevice>();
  for (const device of spec.devices) {
    const symbol = deviceSymbol(device);
    if (symbol !== '') table.set(key(symbol), device);
  }
  return table;
}

// --- The table ----------------------------------------------------------------

export interface SymbolTable {
  globals: Map<string, VarDecl>;
  /** POU id -> that POU's locals. */
  locals: Map<string, Map<string, VarDecl>>;
  plant: Map<string, PuzzleDevice>;
}

export function buildSymbolTable(spec: LadderPuzzleSpec, project: LadderProject): SymbolTable {
  const globals = new Map<string, VarDecl>();
  for (const decl of project.globals ?? []) globals.set(key(decl.name), decl);

  const locals = new Map<string, Map<string, VarDecl>>();
  for (const pou of project.pous) {
    const own = new Map<string, VarDecl>();
    for (const decl of pou.vars ?? []) own.set(key(decl.name), decl);
    locals.set(pou.id, own);
  }

  return { globals, locals, plant: plantSymbols(spec) };
}

/**
 * One name, in one POU: local, then global, then plant, then the address itself.
 *
 * Returns null only when the name is neither declared anywhere in scope nor a
 * well-formed address, which is the "you have not declared this" case.
 */
export function resolveName(
  name: string,
  pouId: string,
  table: SymbolTable,
): Resolution | null {
  const k = key(name);
  if (k === '') return null;

  const local = table.locals.get(pouId)?.get(k);
  if (local) return { address: local.address, origin: 'local' };

  const global = table.globals.get(k);
  if (global) return { address: global.address, origin: 'global' };

  const device = table.plant.get(k);
  if (device) return { address: device.address, origin: 'plant' };

  const trimmed = name.trim().toUpperCase();
  if (parseAddress(trimmed)) return { address: trimmed, origin: 'literal' };
  return null;
}

// --- Resolving a project ------------------------------------------------------

export interface ResolveIssue {
  pouId: string;
  pouName: string;
  rungIndex: number;
  row: number;
  col: number;
  name: string;
  reason: 'undeclared' | 'bare-address';
}

export interface ResolveResult {
  /** The project the engine runs: every name rewritten to an address. */
  project: LadderProject;
  issues: ResolveIssue[];
}

/** A word operand that is a constant (`K500`, `-20`) is a number, not a name. */
const CONSTANT_RE = /^K?-?\d{1,5}$/i;

const isConstant = (operand: string): boolean => CONSTANT_RE.test(operand.trim());

/**
 * Rewrite every name in the project to the address it resolves to.
 *
 * `symbols: 'off'` returns the project untouched without walking a single rung,
 * which is the fast path 46 puzzles take and the reason none of them pay for
 * this. `strictPous` names the POUs a bare address is an error in — player-owned
 * sections under `symbols: 'required'` — because a fixture the puzzle ships is
 * content rather than an answer.
 */
export function resolveProject(
  spec: LadderPuzzleSpec,
  project: LadderProject,
  strictPous?: ReadonlySet<string>,
): ResolveResult {
  const mode = spec.symbols ?? 'off';
  if (mode === 'off') return { project, issues: [] };

  const table = buildSymbolTable(spec, project);
  const issues: ResolveIssue[] = [];

  const pous = project.pous.map((pou): Pou => {
    const strict = mode === 'required' && strictPous?.has(pou.id) === true;

    const resolveOne = (
      raw: string,
      rungIndex: number,
      row: number,
      col: number,
    ): string => {
      const hit = resolveName(raw, pou.id, table);
      if (!hit) {
        issues.push({
          pouId: pou.id,
          pouName: pou.name,
          rungIndex,
          row,
          col,
          name: raw,
          reason: 'undeclared',
        });
        return raw;
      }
      if (strict && hit.origin === 'literal') {
        issues.push({
          pouId: pou.id,
          pouName: pou.name,
          rungIndex,
          row,
          col,
          name: raw,
          reason: 'bare-address',
        });
      }
      return hit.address;
    };

    const rungs = pou.rungs.map((rung, rungIndex): Rung => {
      let touched = false;
      const cells = rung.cells.map((cellRow, row) =>
        cellRow.map((el, col): LadderElement | null => {
          if (!el) return null;
          let next = el;

          // `compare` is the one element with no device at all; a wire has none
          // worth resolving either.
          if (el.type !== 'compare' && el.type !== 'hwire' && el.device.trim() !== '') {
            const address = resolveOne(el.device, rungIndex, row, col);
            if (address !== el.device) next = { ...next, device: address };
          }

          if (isWordInstruction(el.type) && el.operands && el.operands.length > 0) {
            let changed = false;
            const operands = el.operands.map((operand) => {
              if (operand.trim() === '' || isConstant(operand)) return operand;
              const address = resolveOne(operand, rungIndex, row, col);
              if (address !== operand) changed = true;
              return address;
            });
            if (changed) next = { ...next, operands };
          }

          if (next !== el) touched = true;
          return next;
        }),
      );
      return touched ? { ...rung, cells } : rung;
    });

    return rungs.some((r, i) => r !== pou.rungs[i]) ? { ...pou, rungs } : pou;
  });

  return { project: { ...project, pous }, issues };
}

/**
 * A submission, ready to run: assembled over the puzzle's sections and resolved.
 *
 * The single entry point for anything that builds a `SimEngine` — the grader,
 * the client's live scan, the demo player. Two of those doing assembly and
 * resolution slightly differently is exactly how the client and the server stop
 * agreeing, so neither is allowed to do it by hand.
 *
 * Note this is the *runnable* shape, not the editable one: the editor keeps the
 * player's names, because names are what they typed and what they must go on
 * seeing.
 */
export function runnableProject(spec: LadderPuzzleSpec, submitted: ProgramDoc): LadderProject {
  const assembled = assembleProject(spec, submitted);
  return resolveProject(spec, assembled, playerPouIds(spec, assembled)).project;
}

// --- Allocation ---------------------------------------------------------------

const POOL_FIELD: Record<VarKind, keyof MemoryPools> = {
  bool: 'bool',
  int: 'int',
  timer: 'timer',
  counter: 'counter',
};

export function poolFor(spec: LadderPuzzleSpec, kind: VarKind): DeviceRange | null {
  const text = spec.memoryPools?.[POOL_FIELD[kind]];
  if (!text) return null;
  const range = parseDeviceRange(text);
  if (!range || range.kind !== VAR_KIND_DEVICE[kind]) return null;
  return range;
}

/** Every address already spoken for: declarations anywhere, plus the plant's own. */
export function takenAddresses(spec: LadderPuzzleSpec, project: LadderProject): Set<string> {
  const taken = new Set<string>();
  for (const decl of project.globals ?? []) taken.add(decl.address.toUpperCase());
  for (const pou of project.pous) {
    for (const decl of pou.vars ?? []) taken.add(decl.address.toUpperCase());
  }
  for (const device of spec.devices) taken.add(device.address.toUpperCase());
  return taken;
}

/**
 * The lowest free index in `kind`'s pool.
 *
 * Allocation happens here, once, when a variable is declared — never at assemble
 * or grade time. The address is then written into the declaration and saved, so
 * renaming and reordering cost nothing and there is no allocator whose output
 * the client and the server could disagree about.
 */
export function allocateAddress(
  spec: LadderPuzzleSpec,
  project: LadderProject,
  kind: VarKind,
): string | null {
  const pool = poolFor(spec, kind);
  if (!pool) return null;
  const taken = takenAddresses(spec, project);
  for (let i = pool.from; i <= pool.to; i++) {
    const address = `${pool.kind}${i}`;
    if (!taken.has(address)) return address;
  }
  return null;
}

// --- Validating declarations --------------------------------------------------

/**
 * Hold a submitted declaration set to the three rules.
 *
 * A submission is not obliged to have come from our editor, so none of this can
 * be left to the client:
 *
 *  1. every address lies inside its kind's declared pool;
 *  2. no two declarations anywhere in the project share an address, because
 *     names are scoped and memory is not;
 *  3. no declaration points at a plant device.
 *
 * Rule 3 is the security one. Without it a payload could declare
 * `{ name: 'Torch', address: 'Y3' }` as a local and drive the weld torch from a
 * section with no business doing so.
 */
export function validateDeclarations(
  spec: LadderPuzzleSpec,
  project: LadderProject,
  errors: string[],
): void {
  if ((spec.symbols ?? 'off') === 'off') return;

  const plantAddresses = new Set(spec.devices.map((d) => d.address.toUpperCase()));
  const byAddress = new Map<string, string>();

  const check = (decl: VarDecl, scope: string, fixedOk: boolean): void => {
    const where = `${scope} variable "${decl.name}"`;

    if (!isValidVarName(decl.name)) {
      errors.push(
        `${where}: not a usable name. Use a letter or underscore first, then letters, digits ` +
          `or underscores, and never something that reads as an address like M40.`,
      );
    }

    const ref = parseAddress(decl.address);
    if (!ref) {
      errors.push(`${where}: "${decl.address}" is not a device address`);
      return;
    }
    const address = decl.address.toUpperCase();

    if (plantAddresses.has(address)) {
      errors.push(
        `${where}: ${address} is a plant device. Sensors and actuators are named by the ` +
          `puzzle — declare working storage instead, and drive the plant by its own name.`,
      );
      return;
    }

    const want = VAR_KIND_DEVICE[decl.kind];
    if (ref.kind !== want) {
      errors.push(`${where}: a ${decl.kind} lives in ${want}, not ${ref.kind}`);
      return;
    }

    // A fixture's own declarations are placed by the puzzle, outside the pool it
    // hands the player, so they are exempt from the pool rule and only from it.
    if (!fixedOk || decl.fixed !== true) {
      const pool = poolFor(spec, decl.kind);
      if (pool && (ref.index < pool.from || ref.index > pool.to)) {
        errors.push(
          `${where}: ${address} is outside the ${decl.kind} pool ` +
            `(${pool.kind}${pool.from}-${pool.kind}${pool.to})`,
        );
      }
    }

    const clash = byAddress.get(address);
    if (clash !== undefined) {
      errors.push(
        `${where}: ${address} is already used by ${clash}. Two names on one address are one ` +
          `bit wearing two hats, which is the collision scoping exists to prevent.`,
      );
    } else {
      byAddress.set(address, where);
    }
  };

  for (const decl of project.globals ?? []) check(decl, 'Global', true);
  for (const pou of project.pous) {
    for (const decl of pou.vars ?? []) check(decl, pou.name, true);
  }
}
