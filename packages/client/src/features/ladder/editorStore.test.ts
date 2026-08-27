import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POU_ID, makeEmptyRung, type LadderElement } from '@automationsolver/shared';
import { markKey, selectedCells, useEditor, type CellPos } from './editorStore';

/**
 * The store is where every structural rung edit lives, and its index arithmetic
 * is the kind that fails *quietly*: `evaluateRung` skips an out-of-range vlink
 * rather than throwing (`sim/rungSolver.ts`), so a bad remap shows up as a
 * branch that stopped conducting three puzzles later. Hence unit tests on the
 * remaps rather than on the rendering.
 */

const P = DEFAULT_POU_ID;
const at = (rung: number, row: number, col: number): CellPos => ({ pou: P, rung, row, col });
const contact = (device: string): LadderElement => ({ type: 'contact-no', device });
// A compare stores `device: ''` — it addresses nothing — which is exactly why
// "has this field" cannot be decided by looking for the key.
const compareEl = (): LadderElement => ({
  type: 'compare',
  device: '',
  operands: ['D0', 'K1'],
  op: '>=',
});
/** The field predicate the editor passes down, inlined for the store tests. */
const applies = (el: LadderElement, field: string): boolean => {
  if (field === 'device') return el.type !== 'compare' && el.type !== 'hwire';
  if (field === 'preset') return el.type === 'timer' || el.type === 'counter';
  return true;
};

/** Load one rung of the given size and drop `A B C ...` across its top row. */
function load(rows: number, cols: number, filled = cols) {
  useEditor.getState().init({ rungs: [makeEmptyRung('r1', rows, cols)] });
  for (let c = 0; c < filled; c++) {
    useEditor.getState().setCell(at(0, 0, c), contact(String.fromCodePoint(65 + c)));
  }
}

const rung = () => useEditor.getState().project.pous[0].rungs[0];
/** The top row as a compact string, `.` for an empty cell. */
const topRow = () =>
  rung()
    .cells[0].map((c) => c?.device ?? '.')
    .join('');
const links = () =>
  rung()
    .vlinks.map((v) => `${v.row}:${v.col}`)
    .sort()
    .join(' ');

beforeEach(() => {
  useEditor.getState().init(null);
});

describe('insertCol', () => {
  it('opens a gap and shifts the rest of the row right', () => {
    load(2, 5);
    useEditor.getState().insertCol(P, 0, 2);
    expect(topRow()).toBe('AB.CDE');
    expect(rung().cols).toBe(6);
    expect(rung().cells[0]).toHaveLength(6);
  });

  it('carries vlinks at or past the insertion point with their column', () => {
    load(2, 4);
    // Boundaries 1 and 3; 1 sits before the insert at 2 and must not move.
    useEditor.getState().toggleVlink(P, 0, 0, 1);
    useEditor.getState().toggleVlink(P, 0, 0, 3);
    useEditor.getState().insertCol(P, 0, 2);
    expect(links()).toBe('0:1 0:4');
  });

  it('keeps the selection on the cell it was on, not on the new blank', () => {
    load(2, 4);
    useEditor.getState().select(at(0, 0, 1));
    useEditor.getState().insertCol(P, 0, 1);
    // 'B' moved from column 1 to column 2, and the caret went with it.
    expect(useEditor.getState().selected).toEqual(at(0, 0, 2));
    expect(rung().cells[0][2]?.device).toBe('B');
  });

  it('refuses past the column cap rather than dropping the last column', () => {
    load(2, 12);
    useEditor.getState().insertCol(P, 0, 0);
    expect(rung().cols).toBe(12);
    expect(topRow()).toBe('ABCDEFGHIJKL');
  });
});

describe('removeCol', () => {
  it('closes the gap and pulls the rest of the row left', () => {
    load(2, 5);
    useEditor.getState().removeCol(P, 0, 2);
    expect(topRow()).toBe('ABDE');
    expect(rung().cols).toBe(4);
  });

  it('pulls back vlinks past the deleted column', () => {
    load(2, 5);
    useEditor.getState().toggleVlink(P, 0, 0, 1);
    useEditor.getState().toggleVlink(P, 0, 0, 4);
    useEditor.getState().removeCol(P, 0, 2);
    expect(links()).toBe('0:1 0:3');
  });

  it('dedupes links that collapse onto the same boundary', () => {
    load(2, 5);
    // Both boundaries of column 2. Deleting it merges them into one.
    useEditor.getState().toggleVlink(P, 0, 0, 2);
    useEditor.getState().toggleVlink(P, 0, 0, 3);
    useEditor.getState().removeCol(P, 0, 2);
    expect(links()).toBe('0:2');
    // A duplicate would survive `toggleVlink`'s single splice and make the
    // handle look dead; prove one click still clears it.
    useEditor.getState().toggleVlink(P, 0, 0, 2);
    expect(links()).toBe('');
  });

  it('refuses to empty a rung of its last column', () => {
    load(1, 1);
    useEditor.getState().removeCol(P, 0, 0);
    expect(rung().cols).toBe(1);
  });
});

describe('removeRow', () => {
  it('drops the row and the links that lose an endpoint to it', () => {
    load(3, 3);
    useEditor.getState().toggleVlink(P, 0, 0, 1); // rows 0-1: row 1 goes, so this goes
    useEditor.getState().toggleVlink(P, 0, 1, 2); // rows 1-2: same
    useEditor.getState().removeRow(P, 0, 1);
    expect(rung().rows).toBe(2);
    expect(rung().cells).toHaveLength(2);
    expect(links()).toBe('');
  });

  it('pulls links below the deleted row up one', () => {
    load(4, 3);
    useEditor.getState().toggleVlink(P, 0, 2, 1); // rows 2-3
    useEditor.getState().removeRow(P, 0, 0);
    expect(links()).toBe('1:1');
  });

  it('refuses to empty a rung of its last row', () => {
    load(1, 3);
    useEditor.getState().removeRow(P, 0, 0);
    expect(rung().rows).toBe(1);
  });
});

describe('moveColTo', () => {
  it('travels more than one column, unlike the adjacent swap', () => {
    load(1, 5);
    useEditor.getState().moveColTo(P, 0, 0, 3);
    expect(topRow()).toBe('BCDAE');
  });

  it('travels leftward too', () => {
    load(1, 5);
    useEditor.getState().moveColTo(P, 0, 4, 1);
    expect(topRow()).toBe('AEBCD');
  });

  it('carries the selection with the column it moved', () => {
    load(1, 5);
    useEditor.getState().select(at(0, 0, 0));
    useEditor.getState().moveColTo(P, 0, 0, 3);
    expect(useEditor.getState().selected).toEqual(at(0, 0, 3));
  });

  it('shifts a selection the moved column displaced', () => {
    load(1, 5);
    useEditor.getState().select(at(0, 0, 2));
    useEditor.getState().moveColTo(P, 0, 0, 3);
    // 'C' slid from column 2 to column 1 to make room.
    expect(useEditor.getState().selected).toEqual(at(0, 0, 1));
    expect(rung().cells[0][1]?.device).toBe('C');
  });

  it('leaves branches on the boundary they were drawn on', () => {
    load(2, 4);
    useEditor.getState().toggleVlink(P, 0, 0, 2);
    useEditor.getState().moveColTo(P, 0, 0, 3);
    expect(links()).toBe('0:2');
  });
});

describe('undo / redo', () => {
  it('steps a structural edit back exactly', () => {
    load(2, 4);
    const before = topRow();
    useEditor.getState().insertCol(P, 0, 1);
    expect(topRow()).not.toBe(before);
    useEditor.getState().undo();
    expect(topRow()).toBe(before);
    expect(rung().cols).toBe(4);
  });

  it('restores the selection alongside the edit', () => {
    load(2, 4);
    useEditor.getState().select(at(0, 0, 1));
    useEditor.getState().insertCol(P, 0, 1);
    expect(useEditor.getState().selected).toEqual(at(0, 0, 2));
    useEditor.getState().undo();
    expect(useEditor.getState().selected).toEqual(at(0, 0, 1));
  });

  it('redoes what it undid', () => {
    load(2, 4);
    useEditor.getState().insertCol(P, 0, 1);
    const after = topRow();
    useEditor.getState().undo();
    useEditor.getState().redo();
    expect(topRow()).toBe(after);
  });

  it('drops the redo stack once a new edit lands', () => {
    load(2, 4);
    useEditor.getState().insertCol(P, 0, 1);
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);
    useEditor.getState().setCell(at(0, 1, 0), contact('Z'));
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('spends no history entry on an action that changed nothing', () => {
    load(2, 12);
    const depth = useEditor.getState().past.length;
    useEditor.getState().insertCol(P, 0, 0); // at the cap: a no-op
    useEditor.getState().addCol(P, 0); // likewise
    expect(useEditor.getState().past).toHaveLength(depth);
  });

  it('collapses a burst of retyping into one entry', () => {
    load(1, 3);
    useEditor.getState().select(at(0, 0, 0));
    const depth = useEditor.getState().past.length;
    for (const device of ['D1', 'D10', 'D101']) {
      useEditor.getState().patchSelected({ device });
    }
    expect(useEditor.getState().past).toHaveLength(depth + 1);
    useEditor.getState().undo();
    expect(rung().cells[0][0]?.device).toBe('A');
  });

  it('does not carry across a load', () => {
    load(2, 4);
    expect(useEditor.getState().past.length).toBeGreaterThan(0);
    useEditor.getState().init(null);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('is a no-op at the ends of the stacks', () => {
    load(1, 3);
    const state = () => topRow();
    while (useEditor.getState().past.length > 0) useEditor.getState().undo();
    const empty = state();
    useEditor.getState().undo();
    expect(state()).toBe(empty);
  });
});

describe('multi-cell selection', () => {
  const marks = (...keys: string[]) => useEditor.getState().setMarks(P, keys);

  it('collapses to the anchor on a plain select', () => {
    load(2, 4);
    marks(markKey(0, 0, 0), markKey(0, 0, 1));
    expect(useEditor.getState().marks).not.toBeNull();
    useEditor.getState().select(at(0, 1, 0));
    expect(useEditor.getState().marks).toBeNull();
  });

  it('treats a single mark as no multi-selection at all', () => {
    load(2, 4);
    marks(markKey(0, 0, 0));
    expect(useEditor.getState().marks).toBeNull();
  });

  it('reports the anchor alone when nothing is marked', () => {
    load(2, 4);
    useEditor.getState().select(at(0, 0, 2));
    expect(selectedCells(useEditor.getState())).toEqual([at(0, 0, 2)]);
  });

  it('reports marked cells in grid order', () => {
    load(2, 4);
    marks(markKey(0, 1, 3), markKey(0, 0, 1), markKey(0, 0, 0));
    expect(selectedCells(useEditor.getState())).toEqual([at(0, 0, 0), at(0, 0, 1), at(0, 1, 3)]);
  });
});

describe('clearCells', () => {
  it('clears the lot as a single undo step', () => {
    load(1, 4);
    const depth = useEditor.getState().past.length;
    useEditor.getState().clearCells([at(0, 0, 1), at(0, 0, 2)]);
    expect(topRow()).toBe('A..D');
    expect(useEditor.getState().past).toHaveLength(depth + 1);
    useEditor.getState().undo();
    expect(topRow()).toBe('ABCD');
  });
});

describe('patchCells', () => {
  it('writes the field to every cell that has it', () => {
    load(1, 3);
    useEditor.getState().patchCells([at(0, 0, 0), at(0, 0, 2)], { device: 'X7' }, applies);
    expect(topRow()).toBe('X7BX7');
  });

  it('skips cells with no such field rather than inventing one', () => {
    load(1, 3);
    // A compare carries operands and an op, but never a `device`.
    useEditor.getState().setCell(at(0, 0, 1), compareEl());
    useEditor.getState().patchCells([at(0, 0, 0), at(0, 0, 1)], { device: 'X7' }, applies);
    expect(rung().cells[0][1]?.device).toBe('');
    expect(rung().cells[0][0]?.device).toBe('X7');
  });

  it('spends no history entry when nothing was applicable', () => {
    load(1, 3);
    useEditor.getState().setCell(at(0, 0, 0), compareEl());
    const depth = useEditor.getState().past.length;
    useEditor.getState().patchCells([at(0, 0, 0)], { preset: 5 }, applies);
    expect(useEditor.getState().past).toHaveLength(depth);
  });
});

describe('copy and paste', () => {
  it('round-trips a run of cells to another row', () => {
    load(2, 4);
    useEditor.getState().copyCells([at(0, 0, 0), at(0, 0, 1)]);
    useEditor.getState().pasteAt(at(0, 1, 2));
    expect(rung().cells[1].map((c) => c?.device ?? '.').join('')).toBe('..AB');
  });

  it('keeps the gaps inside an L-shaped pick', () => {
    load(2, 4);
    useEditor.getState().setCell(at(0, 1, 1), contact('Q'));
    useEditor.getState().copyCells([at(0, 0, 0), at(0, 1, 1)]);
    const clip = useEditor.getState().clipboard!;
    expect(clip.rows).toBe(2);
    expect(clip.cols).toBe(2);
    expect(clip.cells[0][1]).toBeNull();
    expect(clip.cells[1][0]).toBeNull();
  });

  it('clips at the rung edge instead of widening the rung', () => {
    load(2, 4);
    useEditor.getState().copyCells([at(0, 0, 0), at(0, 0, 1)]);
    useEditor.getState().pasteAt(at(0, 1, 3));
    expect(rung().cols).toBe(4);
    expect(rung().cells[1].map((c) => c?.device ?? '.').join('')).toBe('...A');
  });

  it('leaves the selection on what was pasted', () => {
    load(2, 4);
    useEditor.getState().copyCells([at(0, 0, 0), at(0, 0, 1)]);
    useEditor.getState().pasteAt(at(0, 1, 0));
    expect(useEditor.getState().selected).toEqual(at(0, 1, 0));
    expect([...useEditor.getState().marks!.keys].sort()).toEqual([markKey(0, 1, 0), markKey(0, 1, 1)]);
  });
});

describe('moveCells', () => {
  it('moves a block and leaves blanks behind', () => {
    load(1, 5);
    useEditor.getState().moveCells([at(0, 0, 0), at(0, 0, 1)], { rung: 0, row: 0, col: 3 }, 'move');
    expect(topRow()).toBe('..CAB');
  });

  it('handles an overlapping move without eating a cell', () => {
    load(1, 5);
    // A one-column shift: B's destination is A's source, so a naive
    // write-then-clear loop would blank what it just wrote.
    useEditor.getState().moveCells([at(0, 0, 0), at(0, 0, 1)], { rung: 0, row: 0, col: 1 }, 'move');
    expect(topRow()).toBe('.ABDE');
  });

  it('copies without clearing the source', () => {
    load(2, 5);
    useEditor.getState().moveCells([at(0, 0, 0)], { rung: 0, row: 1, col: 0 }, 'copy');
    expect(topRow()).toBe('ABCDE');
    expect(rung().cells[1][0]?.device).toBe('A');
  });

  it('refuses outright when any cell would land off the grid', () => {
    load(1, 5);
    useEditor.getState().moveCells([at(0, 0, 3), at(0, 0, 4)], { rung: 0, row: 0, col: 1 }, 'move');
    expect(topRow()).toBe('ABCDE');
  });

  it('takes the anchor with it', () => {
    load(1, 5);
    useEditor.getState().select(at(0, 0, 1));
    useEditor.getState().moveCells([at(0, 0, 0), at(0, 0, 1)], { rung: 0, row: 0, col: 2 }, 'move');
    expect(useEditor.getState().selected).toEqual(at(0, 0, 3));
  });

  it('is one undo step however many cells moved', () => {
    load(1, 5);
    const depth = useEditor.getState().past.length;
    useEditor.getState().moveCells([at(0, 0, 0), at(0, 0, 1)], { rung: 0, row: 0, col: 3 }, 'move');
    expect(useEditor.getState().past).toHaveLength(depth + 1);
    useEditor.getState().undo();
    expect(topRow()).toBe('ABCDE');
  });
});
