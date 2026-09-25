import { memo } from 'react';
import { isOutput, type RungEvalResult, type Rung } from '@automationsolver/shared';
import { CellView, CELL_H, CELL_W, WIRE_Y } from './CellView';

/** How the rung should paint the drag in progress, if one is over it. */
export interface RungDrag {
  /** Cells being carried, drawn as holes at their old positions. */
  lifted: ReadonlySet<string>;
  /** Cells the drop would fill. */
  targets: ReadonlySet<string>;
  /** Boundary a column drop would land on, in [0, cols]. Null when not a column drag. */
  colDrop: number | null;
}

interface Props {
  rung: Rung;
  index: number;
  /** Owning POU, so a drag can tell one section's cells from another's. */
  pouId: string;
  selected: { row: number; col: number } | null;
  /** `row:col` keys of the rest of a multi-cell selection. */
  marked?: ReadonlySet<string>;
  drag?: RungDrag;
  evalResult?: RungEvalResult;
  running: boolean;
  editable: boolean;
  onSelectCell: (row: number, col: number, e: React.MouseEvent) => void;
  onCellPointerDown?: (row: number, col: number, e: React.PointerEvent) => void;
  onCellDoubleClick?: (row: number, col: number) => void;
  onCellContextMenu?: (row: number, col: number, e: React.MouseEvent) => void;
  onToggleVlink: (row: number, col: number) => void;
  onAddRow: () => void;
  onAddCol: () => void;
  /** Drop the last branch row / the last column — the inverses of the two above. */
  onRemoveRow: () => void;
  onRemoveCol: () => void;
  canAddRow: boolean;
  canAddCol: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onInsertBelow: () => void;
  onDelete: () => void;
}

function RungViewImpl({
  rung,
  index,
  pouId,
  selected,
  marked,
  drag,
  evalResult,
  running,
  editable,
  onSelectCell,
  onCellPointerDown,
  onCellDoubleClick,
  onCellContextMenu,
  onToggleVlink,
  onAddRow,
  onAddCol,
  onRemoveRow,
  onRemoveCol,
  canAddRow,
  canAddCol,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onInsertBelow,
  onDelete,
}: Props) {
  const nodeCols = rung.cols + 1;
  const nodeId = (row: number, col: number) => row * nodeCols + col;
  const energized = evalResult?.energizedNodes;
  const live = evalResult?.liveCells;
  const width = rung.cols * CELL_W;
  const height = rung.rows * CELL_H;

  const outputLive = (row: number, col: number) =>
    evalResult?.outputs.find((o) => o.row === row && o.col === col)?.energized ?? false;

  return (
    <div className="rung">
      <div className="rung-head">
        <span className="rung-num">{String(index + 1).padStart(2, '0')}</span>
        {editable && (
          <div className="rung-tools">
            {/* Each grow button has its shrink beside it. Disabled rather than
                absent at the limits, so a rung that will not grow says so
                instead of swallowing the click. */}
            <button
              className="icon-btn"
              title={canAddRow ? 'Add branch row (Shift ↓)' : 'This rung is at the branch-row limit'}
              disabled={!canAddRow}
              onClick={onAddRow}
            >
              +row
            </button>
            <button
              className="icon-btn"
              title="Remove the last branch row"
              disabled={rung.rows <= 1}
              onClick={onRemoveRow}
            >
              −row
            </button>
            <button
              className="icon-btn"
              title={canAddCol ? 'Add column (Shift →)' : 'This rung is at the column limit'}
              disabled={!canAddCol}
              onClick={onAddCol}
            >
              +col
            </button>
            <button
              className="icon-btn"
              title="Remove the last column"
              disabled={rung.cols <= 1}
              onClick={onRemoveCol}
            >
              −col
            </button>
            <button className="icon-btn" title="Move rung up" disabled={!canMoveUp} onClick={onMoveUp}>
              ▲
            </button>
            <button className="icon-btn" title="Move rung down" disabled={!canMoveDown} onClick={onMoveDown}>
              ▼
            </button>
            <button className="icon-btn" title="Insert a new rung below" onClick={onInsertBelow}>
              +rung
            </button>
            <button className="icon-btn danger" title="Delete rung" onClick={onDelete}>
              ✕
            </button>
          </div>
        )}
      </div>
      <div className="rung-body">
        <div className={`rail rail-left${running ? ' live' : ''}`} style={{ height }} />
        <div className="grid-wrap" style={{ width, height, position: 'relative' }}>
          {/* Where an Alt-drag would drop the column. Absolutely positioned,
              like the branch handles below — nothing here may sit in the grid's
              normal flow, or it displaces the cells out from under them. */}
          {drag?.colDrop != null && (
            <div className="col-drop" style={{ left: drag.colDrop * CELL_W, height }} />
          )}
          <div
            className="cell-grid"
            style={{
              gridTemplateColumns: `repeat(${rung.cols}, ${CELL_W}px)`,
              gridTemplateRows: `repeat(${rung.rows}, ${CELL_H}px)`,
            }}
          >
            {rung.cells.map((row, r) =>
              row.map((cell, c) => {
                const leftLive = energized?.has(nodeId(r, c)) ?? false;
                const rightLive = energized?.has(nodeId(r, c + 1)) ?? false;
                // An output lights from the rung solver's verdict on it; a
                // contact from whether it actually conducted. MOV/MATH/PID were
                // being asked the contact question, which they can never answer
                // yes to, so a firing block looked dead.
                let symbolLive = false;
                if (cell) {
                  symbolLive = isOutput(cell.type)
                    ? outputLive(r, c)
                    : (live?.has(`${r}:${c}`) ?? false);
                }
                const key = `${r}:${c}`;
                return (
                  <CellView
                    key={key}
                    element={cell}
                    cellId={`${pouId}|${index}|${r}|${c}`}
                    selected={selected?.row === r && selected?.col === c}
                    marked={marked?.has(key)}
                    lifted={drag?.lifted.has(key)}
                    dropTarget={drag?.targets.has(key)}
                    leftLive={leftLive}
                    rightLive={rightLive}
                    symbolLive={symbolLive}
                    onClick={(e) => onSelectCell(r, c, e)}
                    onPointerDown={
                      onCellPointerDown ? (e) => onCellPointerDown(r, c, e) : undefined
                    }
                    onDoubleClick={onCellDoubleClick ? () => onCellDoubleClick(r, c) : undefined}
                    onContextMenu={onCellContextMenu ? (e) => onCellContextMenu(r, c, e) : undefined}
                  />
                );
              }),
            )}
          </div>

          {/* vertical-link handles between adjacent rows at each node column.
              Always rendered so active links stay visible while running; only
              interactive while editing. */}
          {Array.from({ length: rung.rows - 1 }).flatMap((_, r) =>
            Array.from({ length: nodeCols }).map((__, c) => {
              const active = rung.vlinks.some((v) => v.row === r && v.col === c);
              const bothLive =
                (energized?.has(nodeId(r, c)) ?? false) && (energized?.has(nodeId(r + 1, c)) ?? false);
              return (
                <button
                  key={`v${r}:${c}`}
                  className={`vlink${active ? ' active' : ''}${active && bothLive ? ' live' : ''}`}
                  style={{ left: c * CELL_W - 6, top: r * CELL_H + WIRE_Y, height: CELL_H }}
                  title="Toggle vertical link"
                  disabled={!editable}
                  onClick={() => onToggleVlink(r, c)}
                />
              );
            }),
          )}
        </div>
        <div className="rail rail-right" style={{ height }} />
      </div>
    </div>
  );
}

function sameSet(a?: ReadonlySet<string | number>, b?: ReadonlySet<string | number>): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

/** Same highlighting, whatever object it arrived in: the engine hands out a fresh result every scan. */
function sameEval(a?: RungEvalResult, b?: RungEvalResult): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.outputs.length !== b.outputs.length) return false;
  for (let i = 0; i < a.outputs.length; i++) {
    const x = a.outputs[i];
    const y = b.outputs[i];
    if (x.row !== y.row || x.col !== y.col || x.energized !== y.energized) return false;
  }
  return sameSet(a.energizedNodes, b.energizedNodes) && sameSet(a.liveCells, b.liveCells);
}

/**
 * A rung redraws only when something it draws changed. While the sim runs, the
 * editor re-renders every scan, and redrawing every rung of seven open sections
 * each time was the heaviest thing on the page. The handlers are stable (the
 * editor routes them through a ref), so comparing everything else is enough.
 */
export const RungView = memo(RungViewImpl, (a, b) => {
  for (const key of Object.keys(b) as (keyof Props)[]) {
    if (key === 'evalResult' || key === 'marked' || key === 'selected' || key === 'drag') continue;
    if (a[key] !== b[key]) return false;
  }
  return (
    sameEval(a.evalResult, b.evalResult) &&
    sameSet(a.marked, b.marked) &&
    a.selected?.row === b.selected?.row &&
    a.selected?.col === b.selected?.col &&
    a.drag === b.drag
  );
});
