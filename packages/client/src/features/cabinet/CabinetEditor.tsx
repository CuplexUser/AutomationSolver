import { useCallback, useEffect, useRef, useState } from 'react';
import {
  terminalId,
  terminalsOf,
  type CabinetComponent,
  type CabinetPuzzleSpec,
  type CabinetSimResult,
  type SupplyPotential,
  type TerminalId,
  type Wire,
} from '@automationsolver/shared';
import { useCabinet } from './cabinetStore';

/** IEC-ish conductor colors, tuned for the dark panel background. */
const POTENTIAL_COLORS: Record<SupplyPotential, string> = {
  L1: '#b07642', // brown
  L2: '#5b6472', // "black"
  L3: '#a8b0ba', // grey
  N: '#4a86ff', // blue
  PE: '#8db600', // green-yellow
};
const FLOATING_COLOR = '#3d4450';

interface TerminalPos {
  id: TerminalId;
  x: number;
  y: number;
  name: string;
  topRow: boolean;
  single: boolean; // single-column component: labels go beside, not above/below
}

function terminalPositions(c: CabinetComponent): TerminalPos[] {
  const defs = terminalsOf(c.type);
  const single = defs.every((t) => t.dx === 0);
  return defs.map((t) => ({
    id: terminalId(c.id, t.name),
    x: c.x + t.dx,
    y: c.y + t.dy,
    name: t.name,
    topRow: t.dy === 0,
    single,
  }));
}

export function CabinetEditor({
  spec,
  result,
  running,
}: {
  spec: CabinetPuzzleSpec;
  result: CabinetSimResult | null;
  running: boolean;
}) {
  const { wiring, selectedTerminal, selectedWire, selectTerminal, selectWire, addWire, removeWire } =
    useCabinet();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // Drag state for the current pointer gesture; `moved` distinguishes a drag
  // from a plain click (a click keeps the pending wire for click-click wiring).
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const components = spec.cabinet.components;
  const terminals = components.flatMap(terminalPositions);
  const posOf = new Map(terminals.map((t) => [t.id, t]));

  const potentialOf = useCallback(
    (t: TerminalId): SupplyPotential | null => result?.terminalPotentials[t] ?? null,
    [result],
  );
  const colorOf = (t: TerminalId): string => {
    const p = potentialOf(t);
    return p ? POTENTIAL_COLORS[p] : FLOATING_COLOR;
  };
  const wireColor = (w: Wire): string => {
    const p = potentialOf(w.from) ?? potentialOf(w.to);
    return p ? POTENTIAL_COLORS[p] : FLOATING_COLOR;
  };

  // Panel extents — labels render to the right of a component's origin, so
  // include their approximate width or they clip at the viewBox edge.
  const xs = terminals.map((t) => t.x);
  const ys = terminals.map((t) => t.y);
  const labelRights = components.map((c) => c.x + 20 + `${c.id} · ${c.label}`.length * 6.5);
  const minX = Math.min(...xs) - 48;
  const minY = Math.min(...ys) - 48;
  const maxX = Math.max(...xs, ...labelRights) + 48;
  const maxY = Math.max(...ys) + 72;

  const toSvgPoint = (e: React.MouseEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };

  // Wiring gestures: press a terminal and drag to another to run a wire
  // (release completes it). A plain click keeps the pending wire attached to
  // the cursor, so click-then-click also works.
  const onTerminalPointerDown = (t: TerminalId, e: React.PointerEvent) => {
    if (running) return;
    e.stopPropagation();
    if (selectedTerminal != null && selectedTerminal !== t) {
      addWire(selectedTerminal, t); // second click of click-click wiring
      dragRef.current = null;
      return;
    }
    selectTerminal(t);
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  // Pointer-up anywhere ends the gesture: on a terminal it completes the wire,
  // elsewhere a drag cancels while a plain click keeps the pending wire.
  useEffect(() => {
    if (selectedTerminal == null) return;
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const t = target instanceof Element ? target.getAttribute('data-terminal') : null;
      if (t && t !== selectedTerminal) addWire(selectedTerminal, t);
      else if (drag?.moved) selectTerminal(null);
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [selectedTerminal, addWire, selectTerminal]);

  // Delete/Backspace removes the selected wire; Escape cancels the pending wire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectTerminal(null);
        selectWire(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWire && !running) {
        removeWire(selectedWire);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedWire, running, removeWire, selectTerminal, selectWire]);

  const pendingFrom = selectedTerminal ? posOf.get(selectedTerminal) : undefined;

  // Delete control for the selected wire — rendered as the topmost layer so it
  // never hides under a component body (short wires between adjacent terminals
  // of one component would otherwise be irremovable).
  const selWire = !running && selectedWire ? wiring.wires.find((x) => x.id === selectedWire) : undefined;
  const selA = selWire ? posOf.get(selWire.from) : undefined;
  const selB = selWire ? posOf.get(selWire.to) : undefined;

  return (
    <div className="cabinet-editor panel">
      <svg
        ref={svgRef}
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        className="cabinet-svg"
        onPointerMove={(e) => {
          if (!pendingFrom) return;
          setCursor(toSvgPoint(e));
          const drag = dragRef.current;
          if (drag && !drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) {
            drag.moved = true;
          }
        }}
        onClick={(e) => {
          // Clicking bare panel clears selections.
          if (e.target === e.currentTarget) {
            selectTerminal(null);
            selectWire(null);
          }
        }}
      >
        {/* Wires under components' terminals */}
        {wiring.wires.map((w) => {
          const a = posOf.get(w.from);
          const b = posOf.get(w.to);
          if (!a || !b) return null;
          const sag = Math.min(46, Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) / 3));
          const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`;
          const selected = w.id === selectedWire;
          const energized = potentialOf(w.from) != null || potentialOf(w.to) != null;
          return (
            <g key={w.id}>
              <path
                d={d}
                className={`cab-wire${selected ? ' selected' : ''}${energized ? ' energized' : ''}`}
                stroke={wireColor(w)}
              />
              {/* fat invisible hit target; double-click removes the wire */}
              <path
                d={d}
                className="cab-wire-hit"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!running) selectWire(selected ? null : w.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!running) removeWire(w.id);
                }}
              />
            </g>
          );
        })}

        {/* Pending wire rubber band */}
        {pendingFrom && cursor && (
          <line
            className="cab-pending"
            x1={pendingFrom.x}
            y1={pendingFrom.y}
            x2={cursor.x}
            y2={cursor.y}
          />
        )}

        {components.map((c) => (
          <ComponentSymbol
            key={c.id}
            component={c}
            result={result}
            selectedTerminal={selectedTerminal}
            colorOf={colorOf}
            onTerminalPointerDown={onTerminalPointerDown}
          />
        ))}

        {selWire && selA && selB && (
          <g
            className="cab-wire-delete"
            transform={`translate(${(selA.x + selB.x) / 2}, ${(selA.y + selB.y) / 2 + Math.min(46, Math.max(24, Math.hypot(selB.x - selA.x, selB.y - selA.y) / 3)) * 0.75})`}
            onClick={(e) => {
              e.stopPropagation();
              removeWire(selWire.id);
            }}
          >
            <circle r="9" />
            <text dy="3.5">✕</text>
          </g>
        )}
      </svg>
      <p className="cabinet-help muted sm">
        {running
          ? 'Sim running — use the operator panel. Stop to edit wiring.'
          : selectedTerminal
            ? `Wiring from ${selectedTerminal} — drop on a second terminal (Esc to cancel).`
            : 'Drag from terminal to terminal to run a wire. Double-click a wire to remove it.'}
      </p>
    </div>
  );
}

function ComponentSymbol({
  component: c,
  result,
  selectedTerminal,
  colorOf,
  onTerminalPointerDown,
}: {
  component: CabinetComponent;
  result: CabinetSimResult | null;
  selectedTerminal: TerminalId | null;
  colorOf: (t: TerminalId) => string;
  onTerminalPointerDown: (t: TerminalId, e: React.PointerEvent) => void;
}) {
  const terms = terminalPositions(c);
  const xs = terms.map((t) => t.x);
  const ys = terms.map((t) => t.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const energized = result?.energized[c.id] === true;
  const motor = result?.motors[c.id];

  return (
    <g className={`cab-comp cab-${c.type}${energized ? ' energized' : ''}`}>
      {/* Body */}
      {c.type === 'lamp' ? (
        <circle cx={left} cy={(top + bottom) / 2} r="13" className="cab-body" />
      ) : c.type === 'motor3' ? (
        <g>
          <circle cx={(left + right - 32) / 2} cy={bottom + 42} r="24" className="cab-body" />
          <text x={(left + right - 32) / 2} y={bottom + 46} className="cab-glyph">
            M3~
          </text>
          {motor?.running && (
            <text x={(left + right - 32) / 2} y={bottom + 78} className="cab-motor-dir">
              {motor.direction === 'fwd' ? '⟳ FWD' : '⟲ REV'}
            </text>
          )}
        </g>
      ) : c.type === 'button-no' || c.type === 'button-nc' ? (
        <g>
          <rect
            x={left - 26}
            y={top + 10}
            width="20"
            height={bottom - top - 20}
            rx="4"
            className="cab-body"
          />
          <text x={left - 16} y={(top + bottom) / 2 + 3} className="cab-glyph sm">
            {c.type === 'button-no' ? 'NO' : 'NC'}
          </text>
        </g>
      ) : (
        <rect
          x={left - 14}
          y={c.type === 'supply3ph' ? top - 30 : top + 12}
          width={right - left + 28}
          height={c.type === 'supply3ph' ? 22 : bottom - top - 24}
          rx="4"
          className="cab-body"
        />
      )}

      {/* Component label */}
      <text
        x={c.type === 'lamp' || c.type === 'button-no' || c.type === 'button-nc' ? left + 16 : left - 14}
        y={c.type === 'supply3ph' ? top - 38 : top - 14}
        className="cab-label"
      >
        {c.id} · {c.label}
      </text>

      {/* Terminals */}
      {terms.map((t) => (
        <g key={t.id} transform={`translate(${t.x}, ${t.y})`}>
          <circle
            r="4.5"
            className={`cab-terminal${selectedTerminal === t.id ? ' selected' : ''}`}
            fill={colorOf(t.id)}
          />
          <circle
            r="10"
            className="cab-terminal-hit"
            data-terminal={t.id}
            onPointerDown={(e) => onTerminalPointerDown(t.id, e)}
          >
            <title>{t.id}</title>
          </circle>
          <text
            x={t.single ? 10 : 0}
            y={t.single ? 4 : t.topRow ? -9 : 17}
            className={`cab-term-label${t.single ? ' side' : ''}`}
          >
            {t.name}
          </text>
        </g>
      ))}
    </g>
  );
}
