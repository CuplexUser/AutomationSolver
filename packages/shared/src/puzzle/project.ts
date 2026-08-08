import { parseAddress } from '../ladder/address.js';
import {
  isProject,
  makeEmptyRung,
  toProject,
  type LadderProject,
  type Pou,
  type ProgramDoc,
  type TaskDef,
} from '../ladder/types.js';
import type { LadderPuzzleSpec, PouSlot } from './types.js';

/**
 * Building a runnable project out of a puzzle's sections and a player's answer.
 *
 * A multi-POU submission only carries the sections the player was given; the
 * rest ship with the puzzle. Merging the two has to happen in exactly one place
 * or the client's live run and the server's grade are answering different
 * questions — the same reason `validateProgram` and `gradeProgram` both live
 * here rather than one on each side of the wire.
 */

/** True when this puzzle is programmed in sections rather than one rung list. */
export function isMultiPou(spec: LadderPuzzleSpec): boolean {
  return Array.isArray(spec.pous) && spec.pous.length > 0;
}

/** The sections the player writes; the rest are read-only fixtures. */
export function editableSlots(spec: LadderPuzzleSpec): PouSlot[] {
  return (spec.pous ?? []).filter((slot) => slot.editable);
}

/**
 * The project a fresh multi-POU puzzle opens with: every section present, the
 * provided ones filled in and the editable ones an empty rung apiece.
 *
 * Unless an editable section ships a `program` of its own, in which case that is
 * where the player starts. A capstone that hands over a whole plant cannot ask
 * for five programs from a blank page — and does not want to: the interesting
 * question there is not "can you write a line" but "here is a line that works,
 * now make it earn more", and the answer to that begins by reading the code
 * somebody else left you. `assembleProject` still takes an editable section from
 * the submission, so a player who changes nothing submits exactly this.
 */
export function initialProject(spec: LadderPuzzleSpec): LadderProject {
  const pous: Pou[] = (spec.pous ?? []).map((slot) => ({
    id: slot.id,
    name: slot.name,
    rungs: slot.program ?? [makeEmptyRung(`${slot.id}-r1`)],
  }));
  return { pous, tasks: (spec.tasks ?? []).map((task) => ({ ...task })) };
}

/**
 * Merge a submission over the puzzle's own sections into a runnable project.
 *
 * A section the player does not own is always taken from the spec, whatever the
 * submission claims — otherwise a hand-written payload could rewrite the
 * fixtures it is being graded against. Tasks come from the spec too, unless the
 * puzzle hands over the schedule (`taskAssignment: 'player'`), which is the one
 * case where the arrangement itself is the answer.
 */
export function assembleProject(spec: LadderPuzzleSpec, submitted: ProgramDoc): LadderProject {
  if (!isMultiPou(spec)) return toProject(submitted);

  const sent = isProject(submitted) ? submitted : undefined;
  const sentById = new Map((sent?.pous ?? []).map((pou) => [pou.id, pou]));

  const pous: Pou[] = (spec.pous ?? []).map((slot) => {
    const answer = slot.editable ? sentById.get(slot.id) : undefined;
    return {
      id: slot.id,
      name: slot.name,
      rungs: answer?.rungs ?? slot.program ?? [],
    };
  });

  const tasks: TaskDef[] =
    spec.taskAssignment === 'player' && sent?.tasks?.length
      ? sent.tasks.map((task) => ({ ...task }))
      : (spec.tasks ?? []).map((task) => ({ ...task }));

  return { pous, tasks };
}

// --- Device ownership ---------------------------------------------------------

/** An inclusive span of one device family, e.g. `M120-M139`. */
export interface DeviceRange {
  kind: string;
  from: number;
  to: number;
}

const RANGE_RE = /^([XYMTCD])(\d{1,4})(?:\s*-\s*(?:[XYMTCD])?(\d{1,4}))?$/;

/**
 * Parse `M120-M139`, `M120-139` or a bare `M16`.
 *
 * Returns null for anything malformed rather than throwing: an ownership list is
 * puzzle content, and a typo in it should surface as a validation message about
 * the puzzle, not as a crash in the middle of grading.
 */
export function parseDeviceRange(text: string): DeviceRange | null {
  const m = RANGE_RE.exec(text.trim().toUpperCase());
  if (!m) return null;
  const from = Number.parseInt(m[2], 10);
  const to = m[3] === undefined ? from : Number.parseInt(m[3], 10);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return { kind: m[1], from, to };
}

export function parseDeviceRanges(list: readonly string[]): DeviceRange[] {
  const out: DeviceRange[] = [];
  for (const text of list) {
    const range = parseDeviceRange(text);
    if (range) out.push(range);
  }
  return out;
}

/** Is `address` inside any of these ranges? */
export function inDeviceRanges(address: string, ranges: readonly DeviceRange[]): boolean {
  const ref = parseAddress(address);
  if (!ref) return false;
  return ranges.some((r) => r.kind === ref.kind && ref.index >= r.from && ref.index <= r.to);
}

/** `M120-M139` back out of a parsed range, for a validation message. */
export function formatDeviceRange(range: DeviceRange): string {
  return range.from === range.to
    ? `${range.kind}${range.from}`
    : `${range.kind}${range.from}-${range.kind}${range.to}`;
}
