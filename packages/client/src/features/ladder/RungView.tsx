import type { RungEvalResult, Rung } from '@automationsolver/shared';
import { CellView, CELL_H, CELL_W, WIRE_Y } from './CellView';

interface Props {
  rung: Rung;
  index: number;
  selected: { row: number; col: number } | null;
  evalResult?: RungEvalResult;
  running: boolean;
  editable: boolean;
  onSelectCell: (row: number, col: number) => void;
  onToggleVlink: (row: number, col: number) => void;
  onAddRow: () => void;
  onAddCol: () => void;
  onDelete: () => void;
}

export function RungView({
  rung,
  index,
  selected,
  evalResult,
  running,
  editable,
  onSelectCell,
  onToggleVlink,
  onAddRow,
  onAddCol,
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
            <button className="icon-btn" title="Add branch row" onClick={onAddRow}>
              +row
            </button>
            <button className="icon-btn" title="Add column" onClick={onAddCol}>
              +col
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
                let symbolLive = false;
                if (cell) {
                  if (cell.type.startsWith('coil') || cell.type === 'timer' || cell.type === 'counter') {
                    symbolLive = outputLive(r, c);
                  } else {
                    symbolLive = live?.has(`${r}:${c}`) ?? false;
                  }
                }
                return (
                  <CellView
                    key={`${r}:${c}`}
                    element={cell}
                    selected={selected?.row === r && selected?.col === c}
                    leftLive={leftLive}
                    rightLive={rightLive}
                    symbolLive={symbolLive}
                    onClick={() => onSelectCell(r, c)}
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
