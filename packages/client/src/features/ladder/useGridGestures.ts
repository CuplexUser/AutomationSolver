import { useCallback, useEffect, useRef, useState } from 'react';
import { markKey, type CellPos } from './editorStore';
import type { RungDrag } from './RungView';

/** A cell address as the DOM carries it, on `data-cell`. */
interface GridAddr {
  pou: string;
  rung: number;
  row: number;
  col: number;
}

/** Pointer travel, in CSS pixels, before a press becomes a drag rather than a click. */
const DRAG_SLOP = 4;

/**
 * The cell under a viewport point.
 *
 * Hit-tested through the DOM rather than computed from cell geometry: the grid
 * sits inside a scroller under a `transform: scale(...)`, and several rungs of
 * different widths stack inside it, so arithmetic here would be re-deriving
 * placement the browser has already done — and getting it wrong at every zoom
 * level but 100%.
 */
function cellAt(x: number, y: number): GridAddr | null {
  const hit = document.elementFromPoint(x, y);
  const raw = hit instanceof Element ? hit.closest('[data-cell]')?.getAttribute('data-cell') : null;
  if (!raw) return null;
  const [pou, rung, row, col] = raw.split('|');
  return { pou, rung: Number(rung), row: Number(row), col: Number(col) };
}

/** A press that has not yet travelled far enough to mean anything. */
type Pending =
  | { kind: 'cell'; origin: GridAddr; loaded: boolean; x: number; y: number }
  | { kind: 'column'; rung: number; from: number; x: number; y: number };

/**
 * Alt is the column modifier throughout the editor — Alt+← and Alt+→ already
 * nudge a column past its neighbor — so Alt+drag reading as "take the whole
 * column" costs no new vocabulary. It also needs no handle on the rung: a strip
 * of grips above every rung is chrome the program then has to be read around,
 * and anything sitting in the grid's normal flow displaces the cells out from
 * under the absolutely-positioned branch handles.
 */
const isColumnDrag = (e: { altKey: boolean }) => e.altKey;

/** A gesture in flight. */
type Active =
  | { kind: 'marquee'; rung: number; anchor: GridAddr; head: GridAddr }
  | { kind: 'move'; cells: CellPos[]; origin: GridAddr; head: GridAddr; copy: boolean }
  | { kind: 'column'; rung: number; from: number; to: number };

interface Options {
  pouId: string;
  editable: boolean;
  /** Everything currently selected. */
  selection: CellPos[];
  select: (pos: CellPos) => void;
  setMarks: (pou: string, keys: Iterable<string>) => void;
  moveCells: (
    positions: CellPos[],
    delta: { rung: number; row: number; col: number },
    mode: 'move' | 'copy',
  ) => void;
  moveColTo: (rung: number, from: number, to: number) => void;
}

/**
 * Direct manipulation on the rung grid: drag a block (or a whole selection) to
 * another cell, drag a column along the rung, or sweep out a rectangle of cells
 * to act on together.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, because a cell is an
 * SVG-bearing `<button>` and native DnD's drag image and drop targeting are
 * unreliable over SVG. Nothing commits until pointerup, so a gesture abandoned
 * off the grid simply does not happen.
 */
export function useGridGestures({
  pouId,
  editable,
  selection,
  select,
  setMarks,
  moveCells,
  moveColTo,
}: Options) {
  const pending = useRef<Pending | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  /** Set when a gesture actually ran, so the click that follows is ignored. */
  const dragged = useRef(false);

  const stop = useCallback(() => {
    pending.current = null;
    setActive(null);
  }, []);

  // One window-level pair for the whole gesture: listening on the cell would
  // lose the drag the moment the pointer left it, which is every drag.
  //
  // `active` is a dependency rather than a ref read during render, so the
  // listeners are re-registered whenever the gesture advances. That costs an
  // add/remove pair per *change of the cell under the pointer* — not per
  // pointermove, since a move over the same cell sets no state — which is far
  // cheaper than it looks and leaves one source of truth instead of two that
  // can disagree mid-drag.
  useEffect(() => {
    if (!editable) return;

    const onMove = (e: PointerEvent) => {
      const copy = e.ctrlKey || e.metaKey;
      const start = pending.current;

      if (start && !active) {
        if (Math.abs(e.clientX - start.x) < DRAG_SLOP && Math.abs(e.clientY - start.y) < DRAG_SLOP) {
          return;
        }
        dragged.current = true;
        if (start.kind === 'column') {
          setActive({ kind: 'column', rung: start.rung, from: start.from, to: start.from });
        } else if (start.loaded) {
          // Dragging something that is already part of a multi-cell selection
          // takes the whole selection; dragging anything else takes just it,
          // and selects it on the way so the toolbar follows the block.
          const inSelection = selection.some(
            (c) => c.rung === start.origin.rung && c.row === start.origin.row && c.col === start.origin.col,
          );
          const cells: CellPos[] =
            inSelection && selection.length > 1 ? selection : [{ ...start.origin }];
          if (!inSelection) select({ ...start.origin });
          setActive({ kind: 'move', cells, origin: start.origin, head: start.origin, copy });
        } else {
          // An empty cell is dead space, so a press there is free to mean
          // "sweep out a rectangle" without stealing a gesture from anything.
          select({ ...start.origin });
          setActive({ kind: 'marquee', rung: start.origin.rung, anchor: start.origin, head: start.origin });
        }
      }

      const now = active;
      if (!now) return;
      e.preventDefault();
      const over = cellAt(e.clientX, e.clientY);

      if (now.kind === 'column') {
        if (over && over.pou === pouId && over.rung === now.rung && over.col !== now.to) {
          setActive({ ...now, to: over.col });
        }
        return;
      }
      if (now.kind === 'move') {
        if (over && over.pou === pouId && (over.row !== now.head.row || over.col !== now.head.col || over.rung !== now.head.rung)) {
          setActive({ ...now, head: over, copy });
        } else if (copy !== now.copy) {
          setActive({ ...now, copy });
        }
        return;
      }
      // Marquee. Confined to the rung it started in: a rectangle spanning rungs
      // of different widths has no single meaning, and every bulk action here
      // is a statement about one rung's shape.
      if (over && over.pou === pouId && over.rung === now.rung) {
        if (over.row !== now.head.row || over.col !== now.head.col) setActive({ ...now, head: over });
      }
    };

    const onUp = () => {
      const now = active;
      if (now?.kind === 'column') {
        moveColTo(now.rung, now.from, now.to);
      } else if (now?.kind === 'move') {
        moveCells(
          now.cells,
          {
            rung: now.head.rung - now.origin.rung,
            row: now.head.row - now.origin.row,
            col: now.head.col - now.origin.col,
          },
          now.copy ? 'copy' : 'move',
        );
      } else if (now?.kind === 'marquee') {
        setMarks(pouId, rectKeys(now.rung, now.anchor, now.head));
      }
      stop();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [active, editable, pouId, selection, select, setMarks, moveCells, moveColTo, stop]);

  // Live-paint the marquee through the real selection, so the cells light up
  // exactly as they will be once the button comes up — no second highlight
  // style that could disagree with the thing it is previewing.
  useEffect(() => {
    if (active?.kind !== 'marquee') return;
    setMarks(pouId, rectKeys(active.rung, active.anchor, active.head));
  }, [active, pouId, setMarks]);

  const onCellPointerDown = useCallback(
    (rung: number, row: number, col: number, loaded: boolean, e: React.PointerEvent) => {
      if (!editable || e.button !== 0) return;
      // Cleared here rather than when the click is consumed: a drag that ends
      // over a *different* cell fires its click on the grid rather than on any
      // cell, so nothing would consume the flag and it would swallow the next
      // real click instead.
      dragged.current = false;
      pending.current = isColumnDrag(e)
        ? { kind: 'column', rung, from: col, x: e.clientX, y: e.clientY }
        : {
            kind: 'cell',
            origin: { pou: pouId, rung, row, col },
            loaded,
            x: e.clientX,
            y: e.clientY,
          };
    },
    [editable, pouId],
  );

  /** True for the click the browser sends after a drag, which is not a click. */
  const consumeClick = useCallback(() => dragged.current, []);

  /** How this rung should paint whatever gesture is in flight over it. */
  const dragFor = useCallback(
    (rungIndex: number): RungDrag | undefined => {
      if (!active) return undefined;
      if (active.kind === 'column') {
        return active.rung === rungIndex
          ? { lifted: EMPTY, targets: EMPTY, colDrop: active.to }
          : undefined;
      }
      if (active.kind !== 'move') return undefined;
      const lifted = new Set<string>();
      const targets = new Set<string>();
      const d = {
        rung: active.head.rung - active.origin.rung,
        row: active.head.row - active.origin.row,
        col: active.head.col - active.origin.col,
      };
      for (const c of active.cells) {
        if (!active.copy && c.rung === rungIndex) lifted.add(`${c.row}:${c.col}`);
        if (c.rung + d.rung === rungIndex) targets.add(`${c.row + d.row}:${c.col + d.col}`);
      }
      return lifted.size || targets.size ? { lifted, targets, colDrop: null } : undefined;
    },
    [active],
  );

  return { onCellPointerDown, consumeClick, dragFor, dragging: active !== null };
}

const EMPTY: ReadonlySet<string> = new Set();

/** Every cell key in the rectangle spanned by two corners. */
function rectKeys(rung: number, a: GridAddr, b: GridAddr): string[] {
  const keys: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      keys.push(markKey(rung, r, c));
    }
  }
  return keys;
}
