import { create, type StateCreator } from 'zustand';
import {
  DEFAULT_POU_ID,
  emptyProgram,
  isProject,
  makeEmptyRung,
  toProgram,
  toProject,
  type ElementType,
  type LadderElement,
  type LadderProject,
  type ProgramDoc,
  type Rung,
  type VarDecl,
  type VLink,
} from '@automationsolver/shared';

export interface CellPos {
  /** Which POU the cell is in. Single-program puzzles use `DEFAULT_POU_ID`. */
  pou: string;
  rung: number;
  row: number;
  col: number;
}

/**
 * More than one cell under the same command.
 *
 * The anchor stays `selected` — the toolbar, the field row and every keystroke
 * that places an instruction read that and only that, exactly as they did when
 * one cell was all there was. `marks` is the *additional* truth: when it is
 * set it holds the whole selection, anchor included, and the handful of actions
 * that can act on many cells at once consult `selectedCells()` instead.
 *
 * Keys are `rung:row:col` strings rather than objects so membership is a Set
 * lookup during a drag, when the test runs once per cell per pointer move.
 */
export interface Marks {
  pou: string;
  keys: Set<string>;
}

/** The key `marks` stores a cell under. */
export const markKey = (rung: number, row: number, col: number) => `${rung}:${row}:${col}`;

function parseMark(pou: string, key: string): CellPos {
  const [rung, row, col] = key.split(':').map(Number);
  return { pou, rung, row, col };
}

/**
 * Every cell the next bulk action applies to — the marked set if there is one,
 * else the anchor alone, else nothing. Sorted so a copy reads in grid order.
 */
export function selectedCells(s: {
  selected: CellPos | null;
  marks: Marks | null;
}): CellPos[] {
  if (s.marks && s.marks.keys.size > 0) {
    return [...s.marks.keys]
      .map((k) => parseMark(s.marks!.pou, k))
      .sort((a, b) => a.rung - b.rung || a.row - b.row || a.col - b.col);
  }
  return s.selected ? [s.selected] : [];
}

/** The element fields an in-place edit may rewrite. Never `type`: replacing
 * an instruction is a placement, not a patch. */
export type PatchableFields = Partial<
  Pick<LadderElement, 'device' | 'preset' | 'operands' | 'op' | 'pid'>
>;

/** A lifted rectangle of cells, waiting to be pasted. */
export interface Clipboard {
  rows: number;
  cols: number;
  cells: (LadderElement | null)[][];
}

/**
 * The editor always holds a `LadderProject`, even for the 40-odd puzzles that
 * are one flat rung list — those are simply a project with the single POU
 * `main`, and `program` hands that back in the shape their save slots have
 * always held. One internal model means the grid editor, the shortcuts and the
 * undo-shaped actions below did not have to be written twice.
 */
interface EditorState {
  project: LadderProject;
  /** The POU that keystrokes and the toolbar act on. */
  focusedPou: string;
  selected: CellPos | null;
  /** The rest of a multi-cell selection. Null whenever one cell is selected. */
  marks: Marks | null;
  clipboard: Clipboard | null;
  dirty: boolean;
  /** Snapshots to step back to, oldest first. See `undoable` below. */
  past: Snapshot[];
  /** Snapshots undone but not yet superseded, nearest first. */
  future: Snapshot[];
  undo: () => void;
  redo: () => void;
  /** Load either program shape. A flat one is wrapped as the single `main` POU. */
  init: (doc: ProgramDoc | null) => void;
  markClean: () => void;
  focusPou: (pou: string) => void;
  select: (pos: CellPos | null) => void;
  /** Replace the marked set. An empty list clears it back to the anchor alone. */
  setMarks: (pou: string, keys: Iterable<string>) => void;
  setCell: (pos: CellPos, element: LadderElement | null) => void;
  /** Clear several cells as one edit, so one Ctrl+Z takes the lot back. */
  clearCells: (positions: CellPos[]) => void;
  /**
   * Apply one field change to every cell that *uses* that field.
   *
   * A contact has no preset and a compare has no destination, so a bulk retype
   * has to skip rather than write a field the element has no use for. Note that
   * "has no use for" is not "does not carry": a compare stores `device: ''`, so
   * a plain `key in element` test would happily give it a destination. Which
   * fields an instruction really uses is `fieldsFor`'s answer over in
   * `CellFields`, and `applies` is how the caller passes it down — the store
   * has never known one instruction from another and should not start.
   */
  patchCells: (
    positions: CellPos[],
    patch: PatchableFields,
    applies: (element: LadderElement, field: keyof PatchableFields) => boolean,
  ) => void;
  /** Lift the bounding rectangle of `positions` into the clipboard. */
  copyCells: (positions: CellPos[]) => void;
  /** Drop the clipboard with its top-left at `pos`, clipped to the rung. */
  pasteAt: (pos: CellPos) => void;
  /**
   * Translate every cell in `positions` by a delta, as one edit. Refuses
   * outright if any destination lands outside its rung — a partial move that
   * silently drops half a selection off the edge is worse than no move.
   */
  moveCells: (
    positions: CellPos[],
    delta: { rung: number; row: number; col: number },
    mode: 'move' | 'copy',
  ) => void;
  placeSelected: (
    type: ElementType,
    device: string,
    preset?: number,
    /** Word-instruction extras: operands, sub-operator, PID tuning. */
    word?: Partial<LadderElement>,
  ) => void;
  /** Patch the already-placed element in the selected cell, in place. */
  patchSelected: (patch: PatchableFields) => void;
  toggleVlink: (pou: string, rung: number, row: number, col: number) => void;
  addRung: (pou: string) => void;
  insertRung: (pou: string, index: number) => void;
  moveRung: (pou: string, index: number, direction: -1 | 1) => void;
  removeRung: (pou: string, index: number) => void;
  addRow: (pou: string, index: number) => void;
  addCol: (pou: string, index: number) => void;
  /** Open a blank column at `col` in the given rung, shifting it and everything
   * after it right — so a new series element can be dropped in the gap instead
   * of retyping the whole rest of the rung one column over. */
  insertCol: (pou: string, rungIndex: number, col: number) => void;
  /** Close a column up, pulling the rest of the rung left. The inverse of
   * `insertCol`, and the reason a mis-insert is no longer permanent. */
  removeCol: (pou: string, rungIndex: number, col: number) => void;
  /** Drop a branch row, with the links that lose an endpoint to it. */
  removeRow: (pou: string, rungIndex: number, row: number) => void;
  /** Swap two adjacent columns in a rung, cells and branches both. */
  moveCol: (pou: string, rungIndex: number, col: number, direction: -1 | 1) => void;
  /** Swap two adjacent rows in a rung, cells and branches both. */
  moveRow: (pou: string, rungIndex: number, row: number, direction: -1 | 1) => void;
  /** Lift a column out and drop it in at `to`, however far away — the drag
   * gesture's mutation, where `moveCol` is the one-step keyboard nudge. */
  moveColTo: (pou: string, rungIndex: number, from: number, to: number) => void;

  /**
   * Declarations. `scope` is a POU id for a local, or `GLOBAL_SCOPE` for one
   * every program can see.
   *
   * The address arrives already allocated rather than being worked out here: the
   * allocator needs the puzzle's pools and its device list, and the store has
   * never known what a puzzle is. Keeping it that way means the allocation the
   * player sees is the one that gets saved, which is the whole point of placing
   * a variable once and writing it down.
   */
  addVar: (scope: string, decl: VarDecl) => void;
  removeVar: (scope: string, name: string) => void;
  patchVar: (scope: string, name: string, patch: Partial<Omit<VarDecl, 'address'>>) => void;

  addPou: (id: string, name: string) => void;
  renamePou: (id: string, name: string) => void;
  removePou: (id: string) => void;
  movePou: (id: string, direction: -1 | 1) => void;
}

/** Scope key for the project's globals, which is not any POU's id. */
export const GLOBAL_SCOPE = '@globals';

/** What an undo restores. The selection travels with the edit, or stepping back
 * over an insert leaves the caret pointing at a cell that has since moved. */
interface Snapshot {
  project: LadderProject;
  selected: CellPos | null;
  marks: Marks | null;
}

const HISTORY_LIMIT = 100;
/** Two edits carrying the same coalesce hint this close together are one entry. */
const COALESCE_MS = 600;

/**
 * Set by an action immediately before its `set`, naming what is being edited.
 * Consecutive edits with the same hint inside `COALESCE_MS` collapse into a
 * single history entry — without it, typing `D101` into an address field costs
 * four presses of Ctrl+Z to take back, one per character.
 *
 * A module-level baton rather than a parameter because the middleware wraps
 * `set` and never sees which action called it.
 */
let coalesceHint: string | null = null;

/**
 * Records a snapshot before anything changes `project`.
 *
 * Wrapping `set` rather than editing twenty action bodies means a mutation
 * added later is undoable by default instead of by remembering to be. Snapshots
 * are whole-project references, which is cheap only because `updateRung` clones
 * just the rung it touches and leaves every other POU's array identity intact —
 * a hundred entries share almost all of their structure.
 */
/** Everything the actions themselves define — the history fields are the
 * middleware's to supply, so the creator below must not be asked for them. */
type EditorCore = Omit<EditorState, 'past' | 'future' | 'undo' | 'redo'>;

const undoable =
  (config: StateCreator<EditorState, [], [], EditorCore>): StateCreator<EditorState> =>
  (set, get, api) => {
    let lastHint: string | null = null;
    let lastAt = 0;

    const record: typeof set = (partial, replace) => {
      const prev = get();
      const next = (typeof partial === 'function' ? partial(prev) : partial) as Partial<EditorState>;
      const hint = coalesceHint;
      coalesceHint = null;

      // A no-op action (`removeRung` at one rung, `addCol` at the cap) returns
      // the state unchanged, and must not spend a history entry saying so. Note
      // what that asks of the actions: `updateRung` rebuilds the project object
      // whatever its callback does, so an action that can decline has to decline
      // *before* calling it, not from inside the callback.
      if (!next || !('project' in next) || next.project === prev.project) {
        set(next as EditorState, replace as false);
        return;
      }

      const now = Date.now();
      const merge = hint != null && hint === lastHint && now - lastAt < COALESCE_MS;
      lastHint = hint;
      lastAt = now;

      set(
        {
          ...next,
          // `init` clears the stacks explicitly, and that wins: loading a
          // different program must not be undoable back into the last one.
          past:
            'past' in next
              ? next.past
              : merge
                ? prev.past
                : [
                    ...prev.past,
                    { project: prev.project, selected: prev.selected, marks: prev.marks },
                  ].slice(-HISTORY_LIMIT),
          future: 'future' in next ? next.future : [],
        } as EditorState,
        replace as false,
      );
    };

    const step = (from: 'past' | 'future') => () => {
      const s = get();
      const stack = s[from];
      const entry = from === 'past' ? stack.at(-1) : stack[0];
      if (!entry) return;
      const rest = from === 'past' ? stack.slice(0, -1) : stack.slice(1);
      const here: Snapshot = { project: s.project, selected: s.selected, marks: s.marks };
      const other = from === 'past' ? s.future : s.past;
      set({
        project: entry.project,
        selected: entry.selected,
        marks: entry.marks,
        past: from === 'past' ? rest : [...other, here].slice(-HISTORY_LIMIT),
        future: from === 'past' ? [here, ...other].slice(0, HISTORY_LIMIT) : rest,
        // Deliberately not "dirty only if we stepped back past the save point":
        // that needs a clean marker the stacks do not carry, and claiming a
        // document is saved when it is not is the expensive way to be wrong.
        dirty: true,
      });
      lastHint = null;
    };

    return {
      ...config(record, get, api as never),
      past: [],
      future: [],
      undo: step('past'),
      redo: step('future'),
    };
  };

/**
 * Grid caps. Stricter than the server's transport schema (16 x 12 in
 * `server/src/validation.ts`) on purpose: past this a rung stops fitting on a
 * screen and stops reading as one thought. They are named here because three
 * actions and the editor's own "that did nothing" notice all need the number.
 */
export const MAX_COLS = 12;
export const MAX_ROWS = 6;

/** Remap the caret's column, but only when it is in the rung being reshaped. */
function shiftCol(
  sel: CellPos | null,
  pou: string,
  rungIndex: number,
  fn: (col: number) => number,
): CellPos | null {
  if (!sel || sel.pou !== pou || sel.rung !== rungIndex) return sel;
  return { ...sel, col: Math.max(0, fn(sel.col)) };
}

/** The row-wise twin of `shiftCol`. */
function shiftRow(
  sel: CellPos | null,
  pou: string,
  rungIndex: number,
  fn: (row: number) => number,
): CellPos | null {
  if (!sel || sel.pou !== pou || sel.rung !== rungIndex) return sel;
  return { ...sel, row: Math.max(0, fn(sel.row)) };
}

const cellKey = (c: CellPos) => `${c.pou}:${c.rung}:${c.row}:${c.col}`;

const sameCell = (a: CellPos, b: CellPos | null): boolean =>
  !!b && a.pou === b.pou && a.rung === b.rung && a.row === b.row && a.col === b.col;

let rungCounter = 0;
const nextRungId = () => `r${Date.now().toString(36)}${(rungCounter++).toString(36)}`;

function cloneRung(r: Rung): Rung {
  return {
    ...r,
    cells: r.cells.map((row) => row.map((c) => (c ? { ...c } : null))),
    vlinks: r.vlinks.map((v) => ({ ...v })),
  };
}

/** Replace one rung of one POU, leaving every other POU's array identity intact. */
function updateRung(
  project: LadderProject,
  pouId: string,
  index: number,
  fn: (r: Rung) => Rung,
): LadderProject {
  return {
    ...project,
    pous: project.pous.map((pou) =>
      pou.id === pouId
        ? { ...pou, rungs: pou.rungs.map((r, i) => (i === index ? fn(cloneRung(r)) : r)) }
        : pou,
    ),
  };
}

/** Replace one POU's whole rung list. */
function updateRungs(
  project: LadderProject,
  pouId: string,
  fn: (rungs: Rung[]) => Rung[],
): LadderProject {
  return {
    ...project,
    pous: project.pous.map((pou) => (pou.id === pouId ? { ...pou, rungs: fn(pou.rungs) } : pou)),
  };
}

/**
 * Drop duplicate links.
 *
 * Closing a column merges the boundaries either side of it, so two links that
 * were distinct can land on the same one. `evaluateRung` does not care — a
 * union is idempotent — but `toggleVlink` splices the first match only, so a
 * survivor would make the branch handle look dead to the click that should
 * clear it.
 */
function dedupeLinks(vlinks: VLink[]): VLink[] {
  const seen = new Set<string>();
  return vlinks.filter((v) => {
    const key = `${v.row}:${v.col}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rungsOf(project: LadderProject, pouId: string): Rung[] {
  return project.pous.find((p) => p.id === pouId)?.rungs ?? [];
}

const createEditor: StateCreator<EditorState, [], [], EditorCore> = (set, get) => ({
  project: toProject(emptyProgram()),
  focusedPou: DEFAULT_POU_ID,
  selected: null,
  marks: null,
  clipboard: null,
  dirty: false,

  init: (doc) => {
    const project = toProject(doc ?? emptyProgram());
    set({
      project,
      focusedPou: project.pous[0]?.id ?? DEFAULT_POU_ID,
      selected: null,
      marks: null,
      dirty: false,
      past: [],
      future: [],
    });
  },
  markClean: () => set({ dirty: false }),
  focusPou: (pou) => set({ focusedPou: pou }),
  // A plain click collapses a multi-selection: the modifier gestures are what
  // build one up, so anything else has to be a way back out of it.
  select: (pos) => set({ selected: pos, marks: null }),
  setMarks: (pou, keys) => {
    const set_ = new Set(keys);
    set({ marks: set_.size > 1 ? { pou, keys: set_ } : null });
  },

  setCell: (pos, element) =>
    set((s) => ({
      project: updateRung(s.project, pos.pou, pos.rung, (r) => {
        r.cells[pos.row][pos.col] = element;
        return r;
      }),
      dirty: true,
    })),

  placeSelected: (type, device, preset, word) => {
    const sel = get().selected;
    if (!sel) return;
    const element: LadderElement = {
      type,
      device,
      ...(preset != null ? { preset } : {}),
      ...word,
    };
    get().setCell(sel, element);
  },

  patchSelected: (patch) => {
    const sel = get().selected;
    if (sel) coalesceHint = `patch:${sel.pou}:${sel.rung}:${sel.row}:${sel.col}`;
    set((s) => {
      const sel = s.selected;
      if (!sel) return s;
      const cur = rungsOf(s.project, sel.pou)[sel.rung]?.cells[sel.row]?.[sel.col];
      if (!cur) return s;
      return {
        project: updateRung(s.project, sel.pou, sel.rung, (r) => {
          r.cells[sel.row][sel.col] = { ...r.cells[sel.row][sel.col]!, ...patch };
          return r;
        }),
        dirty: true,
      };
    });
  },

  clearCells: (positions) =>
    set((s) => {
      if (positions.length === 0) return s;
      let project = s.project;
      for (const pos of positions) {
        project = updateRung(project, pos.pou, pos.rung, (r) => {
          if (r.cells[pos.row]?.[pos.col] !== undefined) r.cells[pos.row][pos.col] = null;
          return r;
        });
      }
      return { project, dirty: true };
    }),

  patchCells: (positions, patch, applies) => {
    // Same baton as `patchSelected`: retyping one field across three contacts
    // is one edit, not one per keystroke per cell.
    if (positions.length > 0) coalesceHint = `patch:${positions.map(cellKey).join(',')}`;
    set((s) => {
      let project = s.project;
      let touched = false;
      for (const pos of positions) {
        const cur = rungsOf(project, pos.pou)[pos.rung]?.cells[pos.row]?.[pos.col];
        if (!cur) continue;
        const applicable = Object.fromEntries(
          Object.entries(patch).filter(([k]) => applies(cur, k as keyof PatchableFields)),
        ) as typeof patch;
        if (Object.keys(applicable).length === 0) continue;
        touched = true;
        project = updateRung(project, pos.pou, pos.rung, (r) => {
          r.cells[pos.row][pos.col] = { ...r.cells[pos.row][pos.col]!, ...applicable };
          return r;
        });
      }
      return touched ? { project, dirty: true } : s;
    });
  },

  copyCells: (positions) =>
    set((s) => {
      if (positions.length === 0) return s;
      // The bounding box, not the sparse set: pasting has to preserve the gaps
      // between the cells that were picked, or an L-shaped pick comes back as a
      // row. Cells inside the box that were not picked paste as blanks.
      const r0 = Math.min(...positions.map((p) => p.row));
      const c0 = Math.min(...positions.map((p) => p.col));
      const rows = Math.max(...positions.map((p) => p.row)) - r0 + 1;
      const cols = Math.max(...positions.map((p) => p.col)) - c0 + 1;
      const cells: (LadderElement | null)[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => null),
      );
      for (const pos of positions) {
        const el = rungsOf(s.project, pos.pou)[pos.rung]?.cells[pos.row]?.[pos.col];
        cells[pos.row - r0][pos.col - c0] = el ? { ...el } : null;
      }
      return { clipboard: { rows, cols, cells } };
    }),

  pasteAt: (pos) =>
    set((s) => {
      const clip = s.clipboard;
      const rung = rungsOf(s.project, pos.pou)[pos.rung];
      if (!clip || !rung) return s;
      const marks = new Set<string>();
      const project = updateRung(s.project, pos.pou, pos.rung, (r) => {
        for (let dr = 0; dr < clip.rows; dr++) {
          for (let dc = 0; dc < clip.cols; dc++) {
            const row = pos.row + dr;
            const col = pos.col + dc;
            // Clipped, not grown: pasting must not silently widen a rung the
            // player sized on purpose.
            if (row >= r.rows || col >= r.cols) continue;
            const el = clip.cells[dr][dc];
            r.cells[row][col] = el ? { ...el } : null;
            marks.add(markKey(pos.rung, row, col));
          }
        }
        return r;
      });
      return {
        project,
        // Land on what was pasted, so it can be moved or retyped straight away.
        selected: pos,
        marks: marks.size > 1 ? { pou: pos.pou, keys: marks } : null,
        dirty: true,
      };
    }),

  moveCells: (positions, delta, mode) =>
    set((s) => {
      if (positions.length === 0 || (delta.rung === 0 && delta.row === 0 && delta.col === 0)) {
        return s;
      }
      const lifted = positions.map((pos) => ({
        from: pos,
        to: {
          pou: pos.pou,
          rung: pos.rung + delta.rung,
          row: pos.row + delta.row,
          col: pos.col + delta.col,
        },
        element: rungsOf(s.project, pos.pou)[pos.rung]?.cells[pos.row]?.[pos.col] ?? null,
      }));
      for (const { to } of lifted) {
        const rung = rungsOf(s.project, to.pou)[to.rung];
        if (!rung || to.row < 0 || to.row >= rung.rows || to.col < 0 || to.col >= rung.cols) {
          return s;
        }
      }

      let project = s.project;
      // Clear every source before writing any destination: the two sets overlap
      // whenever the move is shorter than the selection is wide, and writing as
      // we go would let a destination be cleared again by a later source.
      if (mode === 'move') {
        for (const { from } of lifted) {
          project = updateRung(project, from.pou, from.rung, (r) => {
            r.cells[from.row][from.col] = null;
            return r;
          });
        }
      }
      const marks = new Set<string>();
      for (const { to, element } of lifted) {
        project = updateRung(project, to.pou, to.rung, (r) => {
          r.cells[to.row][to.col] = element ? { ...element } : null;
          return r;
        });
        marks.add(markKey(to.rung, to.row, to.col));
      }

      const anchor = lifted.find((l) => sameCell(l.from, s.selected))?.to ?? lifted[0].to;
      return {
        project,
        selected: anchor,
        marks: marks.size > 1 ? { pou: anchor.pou, keys: marks } : null,
        dirty: true,
      };
    }),

  toggleVlink: (pou, rung, row, col) =>
    set((s) => ({
      project: updateRung(s.project, pou, rung, (r) => {
        const idx = r.vlinks.findIndex((v) => v.row === row && v.col === col);
        if (idx >= 0) r.vlinks.splice(idx, 1);
        else r.vlinks.push({ row, col });
        return r;
      }),
      dirty: true,
    })),

  addRung: (pou) =>
    set((s) => ({
      project: updateRungs(s.project, pou, (rungs) => [...rungs, makeEmptyRung(nextRungId(), 3, 8)]),
      dirty: true,
    })),

  insertRung: (pou, index) =>
    set((s) => {
      const project = updateRungs(s.project, pou, (rungs) => {
        const next = [...rungs];
        next.splice(index, 0, makeEmptyRung(nextRungId(), 3, 8));
        return next;
      });
      let selected = s.selected;
      if (selected && selected.pou === pou && selected.rung >= index) {
        selected = { ...selected, rung: selected.rung + 1 };
      }
      return { project, selected, dirty: true };
    }),

  moveRung: (pou, index, direction) =>
    set((s) => {
      const target = index + direction;
      const count = rungsOf(s.project, pou).length;
      if (target < 0 || target >= count) return s;
      const project = updateRungs(s.project, pou, (rungs) => {
        const next = [...rungs];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      let selected = s.selected;
      if (selected && selected.pou === pou) {
        if (selected.rung === index) selected = { ...selected, rung: target };
        else if (selected.rung === target) selected = { ...selected, rung: index };
      }
      return { project, selected, dirty: true };
    }),

  removeRung: (pou, index) =>
    set((s) => {
      if (rungsOf(s.project, pou).length <= 1) return s;
      return {
        project: updateRungs(s.project, pou, (rungs) => rungs.filter((_, i) => i !== index)),
        selected: null,
        dirty: true,
      };
    }),

  addRow: (pou, index) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[index];
      if (!rung || rung.rows >= MAX_ROWS) return s;
      return {
        project: updateRung(s.project, pou, index, (r) => {
          r.rows += 1;
          r.cells.push(Array.from({ length: r.cols }, () => null));
          return r;
        }),
        dirty: true,
      };
    }),

  addCol: (pou, index) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[index];
      if (!rung || rung.cols >= MAX_COLS) return s;
      return {
        project: updateRung(s.project, pou, index, (r) => {
          r.cols += 1;
          for (const row of r.cells) row.push(null);
          return r;
        }),
        dirty: true,
      };
    }),

  insertCol: (pou, rungIndex, col) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung || rung.cols >= MAX_COLS) return s;
      return {
        project: updateRung(s.project, pou, rungIndex, (r) => {
          r.cols += 1;
          for (const row of r.cells) row.splice(col, 0, null);
          // A vlink's `col` is a node boundary in [0, cols]; one at or past the
          // insertion point moves with the column it used to sit in front of, or
          // the branch it drew would silently jump to whatever slid into its place.
          r.vlinks = r.vlinks.map((v) => (v.col >= col ? { ...v, col: v.col + 1 } : v));
          return r;
        }),
        // The caret follows its cell rightward. Leaving it put would land it on
        // the blank that just opened, so the next keystroke would fill the gap
        // rather than edit the element the player was looking at.
        selected: shiftCol(s.selected, pou, rungIndex, (c) => (c >= col ? c + 1 : c)),
        dirty: true,
      };
    }),

  removeCol: (pou, rungIndex, col) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung || rung.cols <= 1 || col < 0 || col >= rung.cols) return s;
      return {
        project: updateRung(s.project, pou, rungIndex, (r) => {
          r.cols -= 1;
          for (const row of r.cells) row.splice(col, 1);
          // Mirror of the insert: boundaries *past* the closed column pull back
          // one. The one at `col` itself stays — it is now the boundary in
          // front of whatever slid left into the gap — which is what can leave
          // two links on one boundary, hence the dedupe.
          r.vlinks = dedupeLinks(r.vlinks.map((v) => (v.col > col ? { ...v, col: v.col - 1 } : v)));
          return r;
        }),
        selected: shiftCol(s.selected, pou, rungIndex, (c) =>
          Math.min(c > col ? c - 1 : c, rung.cols - 2),
        ),
        dirty: true,
      };
    }),

  removeRow: (pou, rungIndex, row) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung || rung.rows <= 1 || row < 0 || row >= rung.rows) return s;
      return {
        project: updateRung(s.project, pou, rungIndex, (r) => {
          r.rows -= 1;
          r.cells.splice(row, 1);
          // A link joins rows `row` and `row + 1`, so deleting row R strands
          // both the link at R and the one at R-1. Dropping them is the honest
          // reading: the pair each described no longer exists. Links below
          // close up with the rows.
          r.vlinks = dedupeLinks(
            r.vlinks
              .filter((v) => v.row !== row && v.row !== row - 1)
              .map((v) => (v.row > row ? { ...v, row: v.row - 1 } : v)),
          );
          return r;
        }),
        selected: shiftRow(s.selected, pou, rungIndex, (r) =>
          Math.min(r > row ? r - 1 : r, rung.rows - 2),
        ),
        dirty: true,
      };
    }),

  moveCol: (pou, rungIndex, col, direction) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung) return s;
      const target = col + direction;
      if (target < 0 || target >= rung.cols) return s;
      let selected = s.selected;
      if (selected && selected.pou === pou && selected.rung === rungIndex) {
        if (selected.col === col) selected = { ...selected, col: target };
        else if (selected.col === target) selected = { ...selected, col };
      }
      return {
        // Cell contents swap; vlinks are left alone. A vlink's `col` names a
        // node boundary, not an element, so it stays exactly where it was
        // drawn — the two swapped columns slide past the branch wire rather
        // than dragging it along.
        project: updateRung(s.project, pou, rungIndex, (r) => {
          for (const row of r.cells) [row[col], row[target]] = [row[target], row[col]];
          return r;
        }),
        selected,
        dirty: true,
      };
    }),

  moveRow: (pou, rungIndex, row, direction) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung) return s;
      const target = row + direction;
      if (target < 0 || target >= rung.rows) return s;
      let selected = s.selected;
      if (selected && selected.pou === pou && selected.rung === rungIndex) {
        if (selected.row === row) selected = { ...selected, row: target };
        else if (selected.row === target) selected = { ...selected, row };
      }
      return {
        // Same reasoning as moveCol: a vlink's `row` names a boundary between
        // two row positions, so swapping what those positions hold needs no
        // change to it.
        project: updateRung(s.project, pou, rungIndex, (r) => {
          [r.cells[row], r.cells[target]] = [r.cells[target], r.cells[row]];
          return r;
        }),
        selected,
        dirty: true,
      };
    }),

  moveColTo: (pou, rungIndex, from, to) =>
    set((s) => {
      const rung = rungsOf(s.project, pou)[rungIndex];
      if (!rung || from === to) return s;
      if (from < 0 || from >= rung.cols || to < 0 || to >= rung.cols) return s;
      return {
        // Splice out, splice in — a rotation, not a swap, so the columns
        // between `from` and `to` all slide one place to make room. Branches
        // stay on the boundaries they were drawn on, exactly as they do for
        // `moveCol`: a vlink's `col` names a node, not an element.
        project: updateRung(s.project, pou, rungIndex, (r) => {
          for (const row of r.cells) row.splice(to, 0, ...row.splice(from, 1));
          return r;
        }),
        selected: shiftCol(s.selected, pou, rungIndex, (c) => {
          if (c === from) return to;
          if (from < to) return c > from && c <= to ? c - 1 : c;
          return c >= to && c < from ? c + 1 : c;
        }),
        dirty: true,
      };
    }),

  addVar: (scope, decl) =>
    set((s) => ({ project: updateVars(s.project, scope, (v) => [...v, decl]), dirty: true })),

  removeVar: (scope, name) =>
    set((s) => ({
      project: updateVars(s.project, scope, (vars) =>
        // A shipped declaration is the puzzle's, not the player's: it is what a
        // fixture publishes and what the player is graded against reading.
        vars.filter((v) => v.fixed === true || !sameName(v.name, name)),
      ),
      dirty: true,
    })),

  patchVar: (scope, name, patch) =>
    set((s) => ({
      project: updateVars(s.project, scope, (vars) =>
        vars.map((v) => (sameName(v.name, name) && v.fixed !== true ? { ...v, ...patch } : v)),
      ),
      dirty: true,
    })),

  addPou: (id, name) =>
    set((s) => {
      if (s.project.pous.some((p) => p.id === id)) return s;
      return {
        project: {
          ...s.project,
          pous: [...s.project.pous, { id, name, rungs: [makeEmptyRung(nextRungId())] }],
          // A program in no task never runs, and a player who just made one
          // means to run it. Joining the first task is the answer they would
          // give if asked, so it is not worth asking.
          tasks: s.project.tasks.map((t, i) => (i === 0 ? { ...t, pous: [...t.pous, id] } : t)),
        },
        focusedPou: id,
        dirty: true,
      };
    }),

  renamePou: (id, name) =>
    set((s) => ({
      project: {
        ...s.project,
        pous: s.project.pous.map((p) => (p.id === id ? { ...p, name } : p)),
      },
      dirty: true,
    })),

  removePou: (id) =>
    set((s) => {
      const project = {
        ...s.project,
        pous: s.project.pous.filter((p) => p.id !== id),
        tasks: s.project.tasks.map((t) => ({ ...t, pous: t.pous.filter((p) => p !== id) })),
      };
      return {
        project,
        focusedPou: s.focusedPou === id ? (project.pous[0]?.id ?? DEFAULT_POU_ID) : s.focusedPou,
        selected: s.selected?.pou === id ? null : s.selected,
        dirty: true,
      };
    }),

  movePou: (id, direction) =>
    set((s) => {
      const index = s.project.pous.findIndex((p) => p.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= s.project.pous.length) return s;
      const pous = [...s.project.pous];
      const otherId = pous[target].id;
      [pous[index], pous[target]] = [pous[target], pous[index]];
      // Scan order is the *task's* list, not this one. Swapping only here would
      // reorder the tree and change nothing the engine does, which is the worst
      // of both — so the same swap is applied wherever the pair shares a task.
      const tasks = s.project.tasks.map((task) => {
        const a = task.pous.indexOf(id);
        const b = task.pous.indexOf(otherId);
        if (a < 0 || b < 0) return task;
        const next = [...task.pous];
        [next[a], next[b]] = [next[b], next[a]];
        return { ...task, pous: next };
      });
      return { project: { ...s.project, pous, tasks }, dirty: true };
    }),
});

export const useEditor = create<EditorState>()(undoable(createEditor));

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Rewrite one scope's declaration list, leaving every other scope's identity alone. */
function updateVars(
  project: LadderProject,
  scope: string,
  fn: (vars: VarDecl[]) => VarDecl[],
): LadderProject {
  if (scope === GLOBAL_SCOPE) {
    return { ...project, globals: fn(project.globals ?? []) };
  }
  return {
    ...project,
    pous: project.pous.map((pou) => (pou.id === scope ? { ...pou, vars: fn(pou.vars ?? []) } : pou)),
  };
}

/** One scope's declarations, for a panel that renders a single table. */
export function varsIn(project: LadderProject, scope: string): VarDecl[] {
  if (scope === GLOBAL_SCOPE) return project.globals ?? [];
  return project.pous.find((p) => p.id === scope)?.vars ?? [];
}

/**
 * The document to save for this puzzle.
 *
 * A single-program puzzle flattens back to `{ rungs }` — the shape its slots
 * already hold and its server schema already accepts — so nothing about the
 * project model reaches the wire until a puzzle actually has sections.
 */
export function documentToSave(project: LadderProject, multiPou: boolean): ProgramDoc {
  return multiPou ? project : toProgram(project);
}

/** The rungs of one POU, for a view that renders a single section. */
export function pouRungs(project: LadderProject, pouId: string): Rung[] {
  return rungsOf(project, pouId);
}

export { isProject };
