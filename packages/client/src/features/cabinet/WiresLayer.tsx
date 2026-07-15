import type { SupplyPotential, TerminalId, Wire } from '@automationsolver/shared';
import { useCabinet } from './cabinetStore';
import type { Pt } from './useWiringGestures';

/** IEC-ish conductor colors keyed by potential, plus unpowered insulation. */
export type WirePalette = Record<SupplyPotential | 'floating', string>;

/** Tuned for the light-grey mounting plate of the panel view. */
export const PANEL_PALETTE: WirePalette = {
  L1: '#a3611f', // brown
  L2: '#31363e', // black
  L3: '#8b939d', // grey
  N: '#2f6fe4', // blue
  PE: '#6f9a12', // green-yellow
  floating: '#4b525c',
};

/** Darker inks for the white diagram paper of the schematic view. */
export const SHEET_PALETTE: WirePalette = {
  L1: '#8a5a2b',
  L2: '#23272d',
  L3: '#6e7781',
  N: '#2563eb',
  PE: '#557a1f',
  floating: '#a29c8a',
};

export interface WireGeometry {
  /** SVG path for the wire between resolved endpoints. */
  path: (a: Pt, b: Pt, w: Wire, idx: number) => string;
  /** Anchor point for the ✕ delete control of a selected wire. */
  anchor: (a: Pt, b: Pt, w: Wire, idx: number) => Pt;
}

/** The classic sagging-harness bezier from the original editor. */
export function bezierSag(a: Pt, b: Pt): number {
  return Math.min(46, Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) / 3));
}
export function bezierPath(a: Pt, b: Pt): string {
  const sag = bezierSag(a, b);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`;
}
export function bezierAnchor(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + bezierSag(a, b) * 0.75 };
}

/** Polyline with rounded corners (quadratic fillets), for duct-routed wires. */
export function roundedPath(pts: Pt[], r = 7): string {
  const p: Pt[] = [];
  for (const pt of pts) {
    const last = p[p.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.5) p.push(pt);
  }
  if (p.length < 2) return '';
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1];
    const cur = p[i];
    const next = p[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const inPt = {
      x: cur.x - ((cur.x - prev.x) / inLen) * rr,
      y: cur.y - ((cur.y - prev.y) / inLen) * rr,
    };
    const outPt = {
      x: cur.x + ((next.x - cur.x) / outLen) * rr,
      y: cur.y + ((next.y - cur.y) / outLen) * rr,
    };
    d += ` L ${inPt.x} ${inPt.y} Q ${cur.x} ${cur.y} ${outPt.x} ${outPt.y}`;
  }
  d += ` L ${p[p.length - 1].x} ${p[p.length - 1].y}`;
  return d;
}

/**
 * All wires of the document plus the pending rubber band. The view supplies
 * terminal positions and geometry; selection/removal comes from the store.
 * Render this UNDER the component symbols (wires dive behind bodies) and put
 * a separate WireDeleteControl on top of everything.
 */
export function WiresLayer({
  running,
  palette,
  potentialOf,
  posOf,
  geometry,
  pendingFrom,
  cursor,
}: {
  running: boolean;
  palette: WirePalette;
  potentialOf: (t: TerminalId) => SupplyPotential | null;
  posOf: ReadonlyMap<TerminalId, Pt>;
  geometry: WireGeometry;
  pendingFrom: Pt | null;
  cursor: Pt | null;
}) {
  const { wiring, selectedWire, selectWire, removeWire } = useCabinet();
  return (
    <g>
      {wiring.wires.map((w, idx) => {
        const a = posOf.get(w.from);
        const b = posOf.get(w.to);
        if (!a || !b) return null;
        const d = geometry.path(a, b, w, idx);
        const selected = w.id === selectedWire;
        const energized = potentialOf(w.from) != null || potentialOf(w.to) != null;
        const p = potentialOf(w.from) ?? potentialOf(w.to);
        return (
          <g key={w.id}>
            <path
              d={d}
              className={`cab-wire${selected ? ' selected' : ''}${energized ? ' energized' : ''}`}
              stroke={p ? palette[p] : palette.floating}
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

      {pendingFrom && cursor && (
        <line className="cab-pending" x1={pendingFrom.x} y1={pendingFrom.y} x2={cursor.x} y2={cursor.y} />
      )}
    </g>
  );
}

/**
 * Delete control for the selected wire — rendered as the topmost layer so it
 * never hides under a component body (short wires between adjacent terminals
 * of one component would otherwise be irremovable).
 */
export function WireDeleteControl({
  running,
  posOf,
  geometry,
}: {
  running: boolean;
  posOf: ReadonlyMap<TerminalId, Pt>;
  geometry: WireGeometry;
}) {
  const { wiring, selectedWire, removeWire } = useCabinet();
  const w = !running && selectedWire ? wiring.wires.find((x) => x.id === selectedWire) : undefined;
  if (!w) return null;
  const a = posOf.get(w.from);
  const b = posOf.get(w.to);
  if (!a || !b) return null;
  const at = geometry.anchor(a, b, w, wiring.wires.indexOf(w));
  return (
    <g
      className="cab-wire-delete"
      transform={`translate(${at.x}, ${at.y})`}
      onClick={(e) => {
        e.stopPropagation();
        removeWire(w.id);
      }}
    >
      <circle r="9" />
      <text dy="3.5">✕</text>
    </g>
  );
}

/** One clickable terminal: colored dot + generous hit circle + optional label. */
export function TerminalDot({
  id,
  x,
  y,
  r = 4.5,
  color,
  selected,
  onPointerDown,
  label,
  labelAt,
  labelClass = 'cab-term-label',
}: {
  id: TerminalId;
  x: number;
  y: number;
  r?: number;
  color: string;
  selected: boolean;
  onPointerDown: (t: TerminalId, e: React.PointerEvent) => void;
  label?: string;
  /** Label offset relative to the dot; text-anchor comes from labelClass. */
  labelAt?: Pt;
  labelClass?: string;
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r={r} className={`cab-terminal${selected ? ' selected' : ''}`} fill={color} />
      <circle
        r="10"
        className="cab-terminal-hit"
        data-terminal={id}
        onPointerDown={(e) => onPointerDown(id, e)}
      >
        <title>{id}</title>
      </circle>
      {label != null && labelAt && (
        <text x={labelAt.x} y={labelAt.y} className={labelClass}>
          {label}
        </text>
      )}
    </g>
  );
}
