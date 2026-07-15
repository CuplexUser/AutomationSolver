import { useRef } from 'react';
import {
  schematicPartsOf,
  terminalId,
  SCH_SPAN,
  type CabinetComponent,
  type CabinetPuzzleSpec,
  type CabinetSimResult,
  type SchematicPartDef,
  type SupplyPotential,
  type TerminalId,
} from '@automationsolver/shared';
import { usePanZoom, ZoomControls } from './usePanZoom';
import { useWiringGestures, type Pt } from './useWiringGestures';
import {
  SHEET_PALETTE,
  TerminalDot,
  WireDeleteControl,
  WiresLayer,
  type WireGeometry,
} from './WiresLayer';

interface PlacedPart {
  comp: CabinetComponent;
  def: SchematicPartDef;
  x: number;
  y: number;
  terms: { id: TerminalId; name: string; x: number; y: number; dx: number; dy: number }[];
}

/** Wires run orthogonally on the sheet: down, across at mid-height, down. */
const geometry: WireGeometry = {
  path: (a, b) => {
    if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) {
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    }
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y}`;
  },
  anchor: (a, b) => ({ x: (a.x + b.x) / 2, y: Math.abs(a.x - b.x) < 0.5 ? (a.y + b.y) / 2 : (a.y + b.y) / 2 }),
};

/**
 * The electrical-diagram view: one component drawn as distributed IEC parts
 * (coil, contacts, 3-pole mains) on white drawing paper. Same WiringDoc, same
 * gestures as the panel view.
 */
export function SchematicView({
  spec,
  result,
  running,
}: {
  spec: CabinetPuzzleSpec;
  result: CabinetSimResult | null;
  running: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const g = useWiringGestures(running, sceneRef);
  const pz = usePanZoom(svgRef);
  const components = spec.cabinet.components;

  const parts: PlacedPart[] = spec.cabinet.schematic.flatMap((pl) => {
    const comp = components.find((c) => c.id === pl.componentId);
    const def = comp && schematicPartsOf(comp.type).find((p) => p.key === pl.part);
    if (!comp || !def) return []; // shared tests guarantee this never happens
    return [
      {
        comp,
        def,
        x: pl.x,
        y: pl.y,
        terms: def.terminals.map((t) => ({
          id: terminalId(comp.id, t.name),
          name: t.name,
          x: pl.x + t.dx,
          y: pl.y + t.dy,
          dx: t.dx,
          dy: t.dy,
        })),
      },
    ];
  });

  const allTerms = parts.flatMap((p) => p.terms);
  const posOf = new Map<TerminalId, Pt>(allTerms.map((t) => [t.id, { x: t.x, y: t.y }]));

  const potentialOf = (t: TerminalId): SupplyPotential | null => result?.terminalPotentials[t] ?? null;
  const colorOf = (t: TerminalId): string => {
    const p = potentialOf(t);
    return p ? SHEET_PALETTE[p] : SHEET_PALETTE.floating;
  };

  // Sheet extents from the authored placements; rails span the full sheet.
  const xs = allTerms.map((t) => t.x);
  const ys = allTerms.map((t) => t.y);
  const sheetL = Math.min(...xs) - 84;
  const sheetT = Math.min(...ys) - 44;
  const sheetR = Math.max(...xs) + 64;
  const sheetB = Math.max(...ys) + SCH_SPAN + 44;
  const railL = sheetL + 40;
  const railR = sheetR - 42; // stop short of the zoom controls

  const pendingFrom = g.selectedTerminal ? (posOf.get(g.selectedTerminal) ?? null) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`${sheetL - 10} ${sheetT - 10} ${sheetR - sheetL + 20} ${sheetB - sheetT + 20}`}
      className="cabinet-svg sch-view"
      onPointerDown={pz.onSvgPointerDown}
      onPointerMove={(e) => {
        pz.onSvgPointerMove(e);
        g.onSvgPointerMove(e);
      }}
      onClick={g.onSvgClick}
    >
      <defs>
        <pattern id="sch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 H 0 V 24" fill="none" stroke="#e8e3d3" strokeWidth="0.6" />
        </pattern>
      </defs>

      <g ref={sceneRef} transform={pz.transform}>
      {/* Drawing sheet */}
      <rect
        x={sheetL}
        y={sheetT}
        width={sheetR - sheetL}
        height={sheetB - sheetT}
        className="sch-paper"
        onClick={g.clearSelection}
      />
      <rect
        x={sheetL}
        y={sheetT}
        width={sheetR - sheetL}
        height={sheetB - sheetT}
        fill="url(#sch-grid)"
        pointerEvents="none"
      />
      <rect
        x={sheetL + 6}
        y={sheetT + 6}
        width={sheetR - sheetL - 12}
        height={sheetB - sheetT - 12}
        className="sch-frame"
        pointerEvents="none"
      />
      {/* Title block, bottom-right like a real drawing */}
      <g className="cab-deco sch-title">
        <rect x={sheetR - 172} y={sheetB - 34} width={166} height={28} />
        <text x={sheetR - 164} y={sheetB - 21}>{spec.title}</text>
        <text x={sheetR - 164} y={sheetB - 11} className="sch-dim">
          circuit diagram · IEC 60617 · sheet 1/1
        </text>
      </g>

      {/* Supply rails first (under everything) */}
      {parts
        .filter((p) => p.def.symbol === 'rails')
        .map((p) => (
          <g key={`${p.comp.id}.${p.def.key}`} className="cab-deco">
            {p.terms.map((t) => (
              <g key={t.id}>
                <line
                  x1={railL}
                  y1={t.y}
                  x2={railR}
                  y2={t.y}
                  stroke={SHEET_PALETTE[t.name as SupplyPotential] ?? SHEET_PALETTE.floating}
                  strokeWidth={2}
                  strokeDasharray={t.name === 'PE' ? '10 4' : undefined}
                />
                <text x={railL - 6} y={t.y + 3} className="sch-rail-label">
                  {t.name}
                </text>
              </g>
            ))}
          </g>
        ))}

      <WiresLayer
        running={running}
        palette={SHEET_PALETTE}
        potentialOf={potentialOf}
        posOf={posOf}
        geometry={geometry}
        pendingFrom={pendingFrom}
        cursor={g.cursor}
      />

      {parts.map((p) => (
        <SchematicPart
          key={`${p.comp.id}.${p.def.key}`}
          part={p}
          energized={result?.energized[p.comp.id] === true}
          colorOf={colorOf}
          selectedTerminal={g.selectedTerminal}
          onTerminalPointerDown={g.onTerminalPointerDown}
        />
      ))}

      <WireDeleteControl running={running} posOf={posOf} geometry={geometry} />
      </g>

      <ZoomControls pz={pz} x={sheetR - 4} y={sheetT + 8} />
    </svg>
  );
}

function SchematicPart({
  part: p,
  energized,
  colorOf,
  selectedTerminal,
  onTerminalPointerDown,
}: {
  part: PlacedPart;
  energized: boolean;
  colorOf: (t: TerminalId) => string;
  selectedTerminal: TerminalId | null;
  onTerminalPointerDown: (t: TerminalId, e: React.PointerEvent) => void;
}) {
  const { def, x, y, comp } = p;
  const live = energized && (def.symbol === 'coil' || def.symbol === 'lamp' || def.symbol === 'motor3');

  return (
    <g className={`sch-part${live ? ' energized' : ''}`}>
      <g transform={`translate(${x}, ${y})`} className="cab-deco">
        <SymbolShape def={def} />
        {def.symbol !== 'rails' && def.symbol !== 'motor3' && (
          <text x={-14} y={SCH_SPAN / 2 + 4} className="sch-ref">
            -{comp.id}
          </text>
        )}
        {def.symbol === 'motor3' && (
          <text x={62} y={72} className="sch-ref">
            -{comp.id}
          </text>
        )}
      </g>
      {p.terms.map((t) => (
        <TerminalDot
          key={t.id}
          id={t.id}
          x={t.x}
          y={t.y}
          r={3.5}
          color={colorOf(t.id)}
          selected={selectedTerminal === t.id}
          onPointerDown={onTerminalPointerDown}
          label={def.symbol === 'rails' ? undefined : t.name}
          labelAt={
            def.symbol === 'motor3'
              ? { x: 0, y: -8 }
              : { x: 6, y: t.dy === 0 ? -3 : 11 }
          }
          labelClass={`cab-term-label sch-term${def.symbol === 'motor3' ? '' : ' side'}`}
        />
      ))}
    </g>
  );
}

/** Pure IEC 60617 line work, drawn in local part coordinates. */
function SymbolShape({ def }: { def: SchematicPartDef }) {
  switch (def.symbol) {
    case 'rails':
      return null; // drawn by the view (needs sheet width)
    case 'contact-no':
      return <path className="sch-ink" d="M 0 0 V 15 M 0 48 V 33 M 0 33 L -9 16" />;
    case 'contact-nc':
      return <path className="sch-ink" d="M 0 0 V 15 M 0 15 H -9 M 0 48 V 33 M 0 33 L -9 13" />;
    case 'coil':
      return (
        <g>
          <path className="sch-ink" d="M 0 0 V 16 M 0 48 V 32" />
          <rect className="sch-ink sch-coil" x={-11} y={16} width={22} height={16} />
        </g>
      );
    case 'lamp':
      return (
        <g>
          <path className="sch-ink" d="M 0 0 V 15 M 0 48 V 33" />
          <circle className="sch-ink sch-lens" cx={0} cy={24} r={9} />
          <path className="sch-ink" d="M -6.4 17.6 L 6.4 30.4 M 6.4 17.6 L -6.4 30.4" />
        </g>
      );
    case 'main3':
      return (
        <g>
          {[0, 28, 56].map((dx) => (
            <path key={dx} className="sch-ink" d={`M ${dx} 0 V 15 M ${dx} 48 V 33 M ${dx} 33 L ${dx - 9} 16`} />
          ))}
          {/* mechanical linkage between the three poles */}
          <path className="sch-ink sch-link" d="M -12 24 H 60" />
        </g>
      );
    case 'thermal3':
      return (
        <g>
          {[0, 28, 56].map((dx) => (
            <path
              key={dx}
              className="sch-ink"
              d={`M ${dx} 0 V 14 M ${dx} 14 H ${dx + 6} V 24 H ${dx - 6} V 34 H ${dx} M ${dx} 34 V 48`}
            />
          ))}
        </g>
      );
    case 'motor3':
      return (
        <g>
          <path className="sch-ink" d="M 0 0 V 24 L 12.4 50.4 M 28 0 V 44 M 56 0 V 24 L 43.6 50.4" />
          {/* PE lead to earth */}
          <path className="sch-ink" d="M 84 0 V 20 M 76 20 H 92 M 79 25 H 89 M 82 30 H 86" />
          <circle className="sch-ink sch-motor" cx={28} cy={66} r={22} />
          <text x={28} y={64} className="sch-glyph">
            M
          </text>
          <text x={28} y={76} className="sch-glyph sm">
            3~
          </text>
        </g>
      );
  }
}
