import { parseAddress } from '../ladder/address.js';
import {
  allowedDeviceKinds,
  COMPARE_OPS,
  isConducting,
  isOutput,
  isWordInstruction,
  MATH_OPS,
  type CompareOp,
  type ElementType,
  type LadderElement,
  type LadderProject,
  type MathOp,
  type Pou,
  type ProgramDoc,
} from '../ladder/types.js';
import { isValueOperand } from '../ladder/value.js';
import { GRADE_DT } from './grade.js';
import {
  assembleProject,
  formatDeviceRange,
  inDeviceRanges,
  isMultiPou,
  parseDeviceRanges,
  playerPouIds,
} from './project.js';
import { resolveProject, validateDeclarations, type ResolveIssue } from './symbols.js';
import type { LadderPuzzleSpec, PouSlot } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Non-blocking advice: the program still grades, but something looks wrong. */
  warnings: string[];
}

/** How many word operands each instruction takes. */
const OPERAND_COUNT: Partial<Record<ElementType, number>> = {
  compare: 2,
  mov: 1,
  math: 2,
  pid: 2,
};

const OPERAND_ROLE: Partial<Record<ElementType, string[]>> = {
  compare: ['left', 'right'],
  mov: ['source'],
  math: ['first', 'second'],
  pid: ['setpoint', 'process value'],
};

/**
 * Word instructions carry their sources in `operands` rather than in `device`,
 * so they need a shape check the bit instructions never did: the right number of
 * operands, each one a register or a constant.
 */
function checkWordOperands(el: LadderElement, where: string, errors: string[]): void {
  const want = OPERAND_COUNT[el.type] ?? 0;
  const roles = OPERAND_ROLE[el.type] ?? [];
  const got = el.operands ?? [];
  for (let i = 0; i < want; i++) {
    const raw = got[i];
    if (raw === undefined || raw.trim() === '') {
      errors.push(`${where}: ${el.type} needs a ${roles[i] ?? `operand ${i + 1}`}`);
    } else if (!isValueOperand(raw)) {
      errors.push(`${where}: "${raw}" is not a register or a constant (expected D0-D9999 or K123)`);
    }
  }

  if (el.type === 'compare' && !COMPARE_OPS.includes(el.op as CompareOp)) {
    errors.push(`${where}: compare needs one of ${COMPARE_OPS.join(' ')}`);
  }
  if (el.type === 'math' && !MATH_OPS.includes(el.op as MathOp)) {
    errors.push(`${where}: math needs one of ${MATH_OPS.join(' ')}`);
  }
  if (el.type === 'pid') {
    const p = el.pid;
    if (!p) {
      errors.push(`${where}: PID block has no tuning`);
    } else {
      if (p.kp <= 0) errors.push(`${where}: PID needs a gain greater than 0`);
      if (p.sampleMs <= 0) errors.push(`${where}: PID needs a sample time greater than 0`);
      if (p.outMax <= p.outMin) errors.push(`${where}: PID output range is empty`);
      if (p.ti < 0 || p.td < 0) errors.push(`${where}: PID times cannot be negative`);
    }
  }
}

function checkElement(
  el: LadderElement,
  where: string,
  errors: string[],
  unresolved = false,
): void {
  if (el.type === 'hwire') return;

  // A cell whose name did not resolve has already been reported as undeclared.
  // Letting the address check fire too would answer one mistake with two errors,
  // the second of them about an address the player never wrote.
  if (unresolved) return;

  if (isWordInstruction(el.type)) checkWordOperands(el, where, errors);
  // A compare acts on nothing — both sides are operands — so it is the one
  // element with no `device` to check.
  if (el.type === 'compare') return;

  const ref = parseAddress(el.device);
  if (!ref) {
    // The editor lets a block be placed before it is addressed, so an empty
    // device is the ordinary "not finished yet" case, not a corrupt program.
    errors.push(
      el.device.trim() === ''
        ? `${where}: ${el.type} has no device address yet`
        : `${where}: invalid device address "${el.device}"`,
    );
    return;
  }
  const kinds = allowedDeviceKinds(el.type);
  if (!kinds.has(ref.kind)) {
    errors.push(`${where}: ${el.type} cannot reference ${ref.kind} device (${el.device})`);
  }
  if ((el.type === 'timer' || el.type === 'counter') && (!el.preset || el.preset <= 0)) {
    errors.push(`${where}: ${el.type} ${el.device} needs a preset greater than 0`);
  }
}

/**
 * Output roles where the last write of the scan wins, so driving one device
 * from two rungs silently discards the earlier one. SET/RST are deliberately
 * exempt: latching a bit in one rung and clearing it in another is the normal
 * idiom, not a mistake.
 *
 * MOV and the math blocks are exempt for the same reason: they only write when
 * their rung conducts, so two rungs moving different values into one register is
 * how you *select* a value (one accel figure loaded, another unloaded), not a
 * double-coil bug. A second PID driving the same output is, though.
 */
const LAST_WRITER_WINS = new Set<ElementType>(['coil-out', 'timer', 'counter', 'pid']);

/**
 * Classic "double coil" check. A device is counted once per rung however many
 * cells reference it, so this only reports the cross-rung case.
 *
 * Run across the whole project rather than one rung list: two *sections* driving
 * one coil is the same last-writer-wins bug, and on a plant split into POUs it
 * is the easiest one in the game to write by accident — which is why the message
 * names the section as well as the rung once there is more than one.
 */
function duplicateOutputWarnings(project: LadderProject, multi: boolean): string[] {
  const sitesByDevice = new Map<string, string[]>();
  for (const pou of project.pous) {
    pou.rungs.forEach((rung, ri) => {
      const seen = new Set<string>();
      for (const row of rung.cells) {
        for (const el of row) {
          // A block placed but not yet addressed isn't a double coil; the
          // per-element check already asks it for an address.
          if (!el || !el.device || !LAST_WRITER_WINS.has(el.type) || seen.has(el.device)) continue;
          seen.add(el.device);
          const site = multi ? `${pou.name} rung ${ri + 1}` : `${ri + 1}`;
          const sites = sitesByDevice.get(el.device);
          if (sites) sites.push(site);
          else sitesByDevice.set(el.device, [site]);
        }
      }
    });
  }

  const warnings: string[] = [];
  for (const [device, sites] of sitesByDevice) {
    if (sites.length < 2) continue;
    warnings.push(
      `${device} is driven from ${multi ? '' : 'rungs '}${sites.join(', ')} — only the last one ` +
        `takes effect each scan. Merge them into one rung (parallel rows joined by vertical ` +
        `links), or use SET/RST.`,
    );
  }
  return warnings;
}

/**
 * Every device an editable section writes must be one it owns.
 *
 * The device space is flat, so this is the only thing standing between a
 * sectioned program and section 3 quietly latching section 2's step relay. The
 * interface bits a section publishes are part of what it owns; everything it
 * only *reads* — its neighbours' handshakes, the plant run bit — is not, and
 * that asymmetry is the point.
 */
function checkWriteScope(pou: Pou, slot: PouSlot, errors: string[]): void {
  if (!slot.owns || slot.owns.length === 0) return;
  const ranges = parseDeviceRanges(slot.owns);
  if (ranges.length === 0) return;
  const reported = new Set<string>();

  pou.rungs.forEach((rung, ri) => {
    rung.cells.forEach((row, r) => {
      row.forEach((el, c) => {
        if (!el || !isOutput(el.type) || !el.device || reported.has(el.device)) return;
        if (inDeviceRanges(el.device, ranges)) return;
        reported.add(el.device);
        errors.push(
          `${slot.name} rung ${ri + 1} @ r${r}c${c}: ${slot.name} may not write ${el.device}. ` +
            `It owns ${ranges.map(formatDeviceRange).join(', ')} — read another section's ` +
            `devices, but let that section drive them.`,
        );
      });
    });
  });
}

/** A name that resolved to nothing, or a bare address where one is not allowed. */
function symbolErrors(issues: readonly ResolveIssue[], multi: boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of issues) {
    const dedupe = `${i.pouId}:${i.name}:${i.reason}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const where = `${multi ? `${i.pouName} ` : ''}rung ${i.rungIndex + 1} @ r${i.row}c${i.col}`;
    out.push(
      i.reason === 'undeclared'
        ? `${where}: "${i.name}" is not declared here. Add it to this program's variables, or ` +
          `to the globals if another program needs to see it too.`
        : `${where}: this puzzle is written in variables, so refer to ${i.name} by name. ` +
          `Declare one for it rather than addressing the device directly.`,
    );
  }
  return out;
}

/**
 * Which plant actuators the player's own code may drive.
 *
 * Replaces per-section `owns` once the player names their own POUs, because a
 * fence keyed on a section name has nothing to attach to. Only *plant* devices
 * are held to it: working storage is what scoping already protects, and a rule
 * that also caught a program writing its own relay would be unusable.
 */
function checkWritableOutputs(
  spec: LadderPuzzleSpec,
  project: LadderProject,
  players: ReadonlySet<string>,
  errors: string[],
): void {
  const byAddress = new Map(spec.devices.map((d) => [d.address.toUpperCase(), d]));
  const ranges = spec.writableOutputs ? parseDeviceRanges(spec.writableOutputs) : null;
  const reported = new Set<string>();

  for (const pou of project.pous) {
    if (!players.has(pou.id)) continue;
    pou.rungs.forEach((rung, ri) => {
      rung.cells.forEach((row, r) => {
        row.forEach((el, c) => {
          if (!el || !isOutput(el.type) || !el.device) return;
          const device = byAddress.get(el.device.toUpperCase());
          if (!device) return; // working storage: scoping's job, not this one
          const site = `${pou.id}:${el.device}`;
          if (reported.has(site)) return;

          const where = `${pou.name} rung ${ri + 1} @ r${r}c${c}`;
          if (device.io === 'input') {
            reported.add(site);
            errors.push(
              `${where}: ${device.label} (${el.device}) is a field input. The plant drives it; ` +
                `a program can only read it.`,
            );
            return;
          }
          if (ranges && ranges.length > 0 && !inDeviceRanges(el.device, ranges)) {
            reported.add(site);
            errors.push(
              `${where}: this puzzle does not hand over ${device.label} (${el.device}). ` +
                `It may drive ${ranges.map(formatDeviceRange).join(', ')}.`,
            );
          }
        });
      });
    });
  }
}

/**
 * The task set: does every task call POUs that exist, is every POU called, and
 * does every interval land on the scan grid?
 *
 * That last one is not pedantry. A period that is not a whole number of scans
 * fires on whichever scan the accumulated remainder happens to cross it, and
 * client and server would have to agree about a rounding to agree about the run.
 */
function checkTasks(project: LadderProject, errors: string[], warnings: string[]): void {
  const known = new Set(project.pous.map((p) => p.id));
  const nameOf = new Map(project.pous.map((p) => [p.id, p.name]));
  const called = new Map<string, string[]>();

  for (const task of project.tasks) {
    if (task.intervalMs !== undefined) {
      if (!Number.isInteger(task.intervalMs) || task.intervalMs <= 0) {
        errors.push(`Task ${task.name}: interval must be a whole number of milliseconds`);
      } else if (task.intervalMs % GRADE_DT !== 0) {
        errors.push(
          `Task ${task.name}: a ${task.intervalMs} ms interval does not land on the ${GRADE_DT} ms ` +
            `scan. Use a multiple of ${GRADE_DT}.`,
        );
      }
    }
    for (const pouId of task.pous) {
      if (!known.has(pouId)) {
        errors.push(`Task ${task.name} calls ${pouId}, which is not a program in this project`);
        continue;
      }
      const tasks = called.get(pouId);
      if (tasks) tasks.push(task.name);
      else called.set(pouId, [task.name]);
    }
  }

  for (const [pouId, tasks] of called) {
    if (tasks.length > 1) {
      errors.push(
        `${nameOf.get(pouId) ?? pouId} is called from ${tasks.join(' and ')} — a program runs in ` +
          `one task, or its timers advance twice a scan.`,
      );
    }
  }
  for (const pou of project.pous) {
    if (!called.has(pou.id)) {
      warnings.push(`${pou.name} is not called from any task, so none of its rungs ever run.`);
    }
  }
}

/** One POU's rungs, held to the instruction allow-list, addressing and presets. */
function checkPou(
  pou: Pou,
  allowed: ReadonlySet<ElementType>,
  prefix: string,
  maxRungs: number | undefined,
  errors: string[],
  unresolved?: ReadonlySet<string>,
): void {
  if (maxRungs != null && pou.rungs.length > maxRungs) {
    errors.push(
      prefix === ''
        ? `Program uses ${pou.rungs.length} rungs but the limit is ${maxRungs}`
        : `${pou.name} uses ${pou.rungs.length} rungs but the limit is ${maxRungs}`,
    );
  }

  pou.rungs.forEach((rung, ri) => {
    let hasOutput = false;
    rung.cells.forEach((row, r) => {
      row.forEach((el, c) => {
        if (!el) return;
        const where = `${prefix}rung ${ri + 1} @ r${r}c${c}`;
        if (!isConducting(el.type) && !isOutput(el.type)) {
          errors.push(`${where}: unknown element type`);
          return;
        }
        if (!allowed.has(el.type)) {
          errors.push(`${where}: instruction ${el.type} is not allowed in this puzzle`);
        }
        if (isOutput(el.type)) hasOutput = true;
        checkElement(el, where, errors, unresolved?.has(`${pou.id}|${ri}|${r}|${c}`) === true);
      });
    });
    if (!hasOutput) errors.push(`${prefix}rung ${ri + 1} has no output/coil`);
  });
}

/**
 * Structural check, ahead of grading: instructions the puzzle allows, addresses
 * the elements can legally act on, presets, word-operand shape, and — once a
 * puzzle is written in sections — the task set and each section's device
 * ownership.
 *
 * Takes either program shape. A flat rung list is wrapped as the single POU
 * `main`, and reports against it read exactly as they always have (`rung 3 @
 * r1c2`, no section prefix) — the messages are player-facing, and a puzzle with
 * one program should not start talking about which one.
 */
export function validateProgram(spec: LadderPuzzleSpec, doc: ProgramDoc): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = new Set<ElementType>(spec.allowedInstructions);
  allowed.add('hwire'); // wires are always permitted

  const multi = isMultiPou(spec);
  const assembled = assembleProject(spec, doc);
  const slotById = new Map((spec.pous ?? []).map((slot) => [slot.id, slot]));

  // Declarations are checked before they are used, on the shape the player sent:
  // a variable pointing somewhere it may not is not a fact about any rung.
  validateDeclarations(spec, assembled, errors);

  // Everything downstream works in addresses, so resolution happens here and
  // once. Under `symbols: 'off'` this returns the project untouched without
  // walking a rung, which is the path every puzzle written before symbols takes.
  const players = playerPouIds(spec, assembled);
  const { project, issues } = resolveProject(spec, assembled, players);
  errors.push(...symbolErrors(issues, multi));
  const unresolved = new Set(
    issues
      .filter((i) => i.reason === 'undeclared')
      .map((i) => `${i.pouId}|${i.rungIndex}|${i.row}|${i.col}`),
  );

  for (const pou of project.pous) {
    const slot = slotById.get(pou.id);
    // A section the puzzle ships pre-written is a fixture, not an answer: hold
    // it to the same structural rules (an authoring bug should surface), but
    // only an editable one can break the ownership rule, since it is the only
    // one the player can have written.
    checkPou(
      pou,
      allowed,
      multi ? `${pou.name} ` : '',
      slot?.maxRungs ?? (multi ? undefined : spec.maxRungs),
      errors,
      unresolved,
    );
    if (slot?.editable) checkWriteScope(pou, slot, errors);
  }

  if (multi) {
    checkTasks(project, errors, warnings);
    if (spec.maxPous != null && project.pous.length > spec.maxPous) {
      errors.push(`This project has ${project.pous.length} programs but the limit is ${spec.maxPous}`);
    }
  }
  checkWritableOutputs(spec, project, players, errors);

  warnings.push(...duplicateOutputWarnings(project, multi));

  return { valid: errors.length === 0, errors, warnings };
}
