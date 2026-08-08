import { create } from 'zustand';
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
} from '@automationsolver/shared';

export interface CellPos {
  /** Which POU the cell is in. Single-program puzzles use `DEFAULT_POU_ID`. */
  pou: string;
  rung: number;
  row: number;
  col: number;
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
  dirty: boolean;
  /** Load either program shape. A flat one is wrapped as the single `main` POU. */
  init: (doc: ProgramDoc | null) => void;
  markClean: () => void;
  focusPou: (pou: string) => void;
  select: (pos: CellPos | null) => void;
  setCell: (pos: CellPos, element: LadderElement | null) => void;
  placeSelected: (
    type: ElementType,
    device: string,
    preset?: number,
    /** Word-instruction extras: operands, sub-operator, PID tuning. */
    word?: Partial<LadderElement>,
  ) => void;
  /** Patch the already-placed element in the selected cell, in place. */
  patchSelected: (
    patch: Partial<Pick<LadderElement, 'device' | 'preset' | 'operands' | 'op' | 'pid'>>,
  ) => void;
  toggleVlink: (pou: string, rung: number, row: number, col: number) => void;
  addRung: (pou: string) => void;
  insertRung: (pou: string, index: number) => void;
  moveRung: (pou: string, index: number, direction: -1 | 1) => void;
  removeRung: (pou: string, index: number) => void;
  addRow: (pou: string, index: number) => void;
  addCol: (pou: string, index: number) => void;
}

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

function rungsOf(project: LadderProject, pouId: string): Rung[] {
  return project.pous.find((p) => p.id === pouId)?.rungs ?? [];
}

export const useEditor = create<EditorState>((set, get) => ({
  project: toProject(emptyProgram()),
  focusedPou: DEFAULT_POU_ID,
  selected: null,
  dirty: false,

  init: (doc) => {
    const project = toProject(doc ?? emptyProgram());
    set({
      project,
      focusedPou: project.pous[0]?.id ?? DEFAULT_POU_ID,
      selected: null,
      dirty: false,
    });
  },
  markClean: () => set({ dirty: false }),
  focusPou: (pou) => set({ focusedPou: pou }),
  select: (pos) => set({ selected: pos }),

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

  patchSelected: (patch) =>
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
    set((s) => ({
      project: updateRung(s.project, pou, index, (r) => {
        if (r.rows >= 6) return r;
        r.rows += 1;
        r.cells.push(Array.from({ length: r.cols }, () => null));
        return r;
      }),
      dirty: true,
    })),

  addCol: (pou, index) =>
    set((s) => ({
      project: updateRung(s.project, pou, index, (r) => {
        if (r.cols >= 12) return r;
        r.cols += 1;
        for (const row of r.cells) row.push(null);
        return r;
      }),
      dirty: true,
    })),
}));

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
