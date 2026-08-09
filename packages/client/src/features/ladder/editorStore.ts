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
  type VarDecl,
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
}));

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
