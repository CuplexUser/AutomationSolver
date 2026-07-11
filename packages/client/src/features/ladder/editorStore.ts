import { create } from 'zustand';
import {
  emptyProgram,
  makeEmptyRung,
  type ElementType,
  type LadderElement,
  type LadderProgram,
  type Rung,
} from '@automationsolver/shared';

export interface CellPos {
  rung: number;
  row: number;
  col: number;
}

interface EditorState {
  program: LadderProgram;
  selected: CellPos | null;
  dirty: boolean;
  init: (program: LadderProgram | null) => void;
  markClean: () => void;
  select: (pos: CellPos | null) => void;
  setCell: (pos: CellPos, element: LadderElement | null) => void;
  placeSelected: (type: ElementType, device: string, preset?: number) => void;
  /** Patch the device/preset of the already-placed element in the selected cell. */
  patchSelected: (patch: Partial<Pick<LadderElement, 'device' | 'preset'>>) => void;
  toggleVlink: (rung: number, row: number, col: number) => void;
  addRung: () => void;
  removeRung: (index: number) => void;
  addRow: (index: number) => void;
  addCol: (index: number) => void;
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

function updateRung(program: LadderProgram, index: number, fn: (r: Rung) => Rung): LadderProgram {
  return { rungs: program.rungs.map((r, i) => (i === index ? fn(cloneRung(r)) : r)) };
}

export const useEditor = create<EditorState>((set, get) => ({
  program: emptyProgram(),
  selected: null,
  dirty: false,

  init: (program) => set({ program: program ?? emptyProgram(), selected: null, dirty: false }),
  markClean: () => set({ dirty: false }),
  select: (pos) => set({ selected: pos }),

  setCell: (pos, element) =>
    set((s) => ({
      program: updateRung(s.program, pos.rung, (r) => {
        r.cells[pos.row][pos.col] = element;
        return r;
      }),
      dirty: true,
    })),

  placeSelected: (type, device, preset) => {
    const sel = get().selected;
    if (!sel) return;
    const element: LadderElement = { type, device, ...(preset != null ? { preset } : {}) };
    get().setCell(sel, element);
  },

  patchSelected: (patch) =>
    set((s) => {
      const sel = s.selected;
      if (!sel) return s;
      const cur = s.program.rungs[sel.rung]?.cells[sel.row]?.[sel.col];
      if (!cur) return s;
      return {
        program: updateRung(s.program, sel.rung, (r) => {
          r.cells[sel.row][sel.col] = { ...r.cells[sel.row][sel.col]!, ...patch };
          return r;
        }),
        dirty: true,
      };
    }),

  toggleVlink: (rung, row, col) =>
    set((s) => ({
      program: updateRung(s.program, rung, (r) => {
        const idx = r.vlinks.findIndex((v) => v.row === row && v.col === col);
        if (idx >= 0) r.vlinks.splice(idx, 1);
        else r.vlinks.push({ row, col });
        return r;
      }),
      dirty: true,
    })),

  addRung: () =>
    set((s) => ({
      program: { rungs: [...s.program.rungs, makeEmptyRung(nextRungId(), 3, 8)] },
      dirty: true,
    })),

  removeRung: (index) =>
    set((s) => {
      if (s.program.rungs.length <= 1) return s;
      return {
        program: { rungs: s.program.rungs.filter((_, i) => i !== index) },
        selected: null,
        dirty: true,
      };
    }),

  addRow: (index) =>
    set((s) => ({
      program: updateRung(s.program, index, (r) => {
        if (r.rows >= 6) return r;
        r.rows += 1;
        r.cells.push(Array.from({ length: r.cols }, () => null));
        return r;
      }),
      dirty: true,
    })),

  addCol: (index) =>
    set((s) => ({
      program: updateRung(s.program, index, (r) => {
        if (r.cols >= 12) return r;
        r.cols += 1;
        for (const row of r.cells) row.push(null);
        return r;
      }),
      dirty: true,
    })),
}));
