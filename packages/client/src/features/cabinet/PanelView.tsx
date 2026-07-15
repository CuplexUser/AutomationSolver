import { useRef } from 'react';
import {
  terminalId,
  terminalsOf,
  type CabinetComponent,
  type CabinetComponentType,
  type CabinetPuzzleSpec,
  type CabinetSimResult,
  type MotorReading,
  type SupplyPotential,
  type TerminalId,
} from '@automationsolver/shared';
import { usePanZoom, ZoomControls } from './usePanZoom';
import { useWiringGestures, type Pt } from './useWiringGestures';
import {
  PANEL_PALETTE,
  TerminalDot,
  WireDeleteControl,
  WiresLayer,
  bezierAnchor,
  bezierPath,
  bezierSag,
  roundedPath,
  type WireGeometry,
} from './WiresLayer';

const RAIL_TYPES: readonly CabinetComponentType[] = ['supply3ph', 'contactor', 'overload'];
const DOOR_TYPES: readonly CabinetComponentType[] = ['button-no', 'button-nc', 'lamp'];

type Zone = 'rail' | 'door' | 'motor';
const zoneOf = (t: CabinetComponentType): Zone =>
  RAIL_TYPES.includes(t) ? 'rail' : DOOR_TYPES.includes(t) ? 'door' : 'motor';

interface TermMeta {
  comp: CabinetComponent;
  zone: Zone;
  topRow: boolean;
}

/**
 * The illustrated-realistic cabinet: grey enclosure with a mounting plate,
 * DIN rails, slotted wire ducts, door-mounted operators and a motor below.
 * Panel-to-panel wires route orthogonally through the ducts; wires to the
 * door or the motor hang as a loose harness (bezier).
 */
export function PanelView({
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

  const railComps = components.filter((c) => zoneOf(c.type) === 'rail');
  const doorComps = components.filter((c) => zoneOf(c.type) === 'door');
  const motorComps = components.filter((c) => zoneOf(c.type) === 'motor');

  // Terminal positions use the same panel offsets as the wiring model.
  const posOf = new Map<TerminalId, Pt>();
  const metaOf = new Map<TerminalId, TermMeta>();
  for (const c of components) {
    for (const t of terminalsOf(c.type)) {
      const id = terminalId(c.id, t.name);
      posOf.set(id, { x: c.x + t.dx, y: c.y + t.dy });
      metaOf.set(id, { comp: c, zone: zoneOf(c.type), topRow: t.dy === 0 });
    }
  }

  // ---- Scenery geometry, derived from component positions --------------
  const railTermXs = railComps.flatMap((c) => terminalsOf(c.type).map((t) => c.x + t.dx));
  const rows = [...new Set(railComps.map((c) => c.y))].sort((a, b) => a - b);

  const plateL = Math.min(...railComps.map((c) => c.x)) - 62;
  const plateR = Math.max(...railTermXs) + 46;
  const plateT = rows[0] - 62;
  const plateB = rows[rows.length - 1] + 64 + 60;
  const enclL = plateL - 13;
  const enclR = plateR + 13;
  const enclT = plateT - 13;
  const enclB = plateB + 13;

  // Duct levels: one above each rail row, one below; merge near-coincident
  // levels (the band between two rows serves both).
  const rawLevels = rows.flatMap((y) => [y - 30, y + 86]).sort((a, b) => a - b);
  const ducts: number[] = [];
  for (const lv of rawLevels) {
    const last = ducts[ducts.length - 1];
    if (last !== undefined && lv - last < 44) ducts[ducts.length - 1] = (last + lv) / 2;
    else ducts.push(lv);
  }
  const spineX = plateL + 24;
  const ductFor = (m: TermMeta): number => {
    const raw = m.topRow ? m.comp.y - 30 : m.comp.y + 86;
    let best = ducts[0];
    for (const d of ducts) if (Math.abs(d - raw) < Math.abs(best - raw)) best = d;
    return best;
  };

  // Door strip (only when door devices exist)
  const strip = doorComps.length
    ? {
        l: Math.min(...doorComps.map((c) => c.x)) - 62,
        r: Math.max(...doorComps.map((c) => c.x)) + 26,
        t: Math.min(...doorComps.map((c) => c.y)) - 52,
        b: Math.max(...doorComps.map((c) => c.y)) + 48 + 52,
      }
    : null;

  // ---- Wire routing -----------------------------------------------------
  const laneOf = (idx: number) => ((idx % 7) - 3) * 2.6;
  const spineLaneOf = (idx: number) => spineX + ((idx % 5) - 2) * 3.2;
  const bottomDuct = ducts[ducts.length - 1];
  /**
   * Duct run from a rail terminal to the spine, then a loose harness to the
   * door. The harness levels out at the terminal's escape line and enters it
   * vertically past the end of its contact block, so on multi-column door
   * strips the run crosses other columns in the gaps between rows instead of
   * disappearing behind their blocks.
   */
  const railToDoor = (railPt: Pt, railM: TermMeta, doorPt: Pt, doorM: TermMeta, idx: number): string => {
    const d = ductFor(railM) + laneOf(idx);
    const sx = spineLaneOf(idx);
    const esc = doorEscape(doorPt, doorM, idx);
    const into = doorM.topRow ? 6 : -6;
    const run = roundedPath([railPt, { x: railPt.x, y: d }, { x: sx, y: d }], 8);
    return (
      `${run} C ${sx - 60} ${d}, ${doorPt.x + 110} ${esc}, ${doorPt.x + 8} ${esc}` +
      ` Q ${doorPt.x} ${esc} ${doorPt.x} ${esc + into} L ${doorPt.x} ${doorPt.y}`
    );
  };

  /**
   * Rail terminal to the motor: through the ducts (via the spine when the
   * terminal's own duct isn't the bottom one), then a straight drop out of
   * the cabinet into the top-facing motor terminal.
   */
  const railToMotorPts = (railPt: Pt, railM: TermMeta, motorPt: Pt, idx: number): Pt[] => {
    const lane = laneOf(idx);
    const da = ductFor(railM);
    if (da === bottomDuct) {
      return [railPt, { x: railPt.x, y: da + lane }, { x: motorPt.x, y: da + lane }, motorPt];
    }
    const sx = spineLaneOf(idx);
    return [
      railPt,
      { x: railPt.x, y: da + lane },
      { x: sx, y: da + lane },
      { x: sx, y: bottomDuct + lane },
      { x: motorPt.x, y: bottomDuct + lane },
      motorPt,
    ];
  };
  const railToMotorAnchor = (railPt: Pt, railM: TermMeta, motorPt: Pt, idx: number): Pt => {
    const da = ductFor(railM);
    if (da === bottomDuct) return { x: (railPt.x + motorPt.x) / 2, y: da + laneOf(idx) };
    return { x: spineLaneOf(idx), y: (da + bottomDuct) / 2 };
  };

  // Door-to-door wires: facing terminals in the gap between two contact
  // blocks connect straight; anything else loops around the right side of
  // the blocks instead of sagging behind them.
  const doorFacing = (a: Pt, ma: TermMeta, b: Pt, mb: TermMeta): boolean => {
    const [top, bot] = a.y <= b.y ? [ma, mb] : [mb, ma];
    return Math.abs(a.x - b.x) < 1 && !top.topRow && bot.topRow;
  };
  // Escape line: just past the end of the contact block, staggered per wire
  // so parallel runs between door columns don't sit on top of each other.
  const doorEscape = (p: Pt, m: TermMeta, idx: number) => {
    const off = 13 + (idx % 3) * 4;
    return m.topRow ? p.y - off : p.y + off;
  };
  const doorLaneX = (a: Pt, b: Pt, idx: number) => Math.max(a.x, b.x) + 18 + (idx % 3) * 2.5;

  /** Hanging harness with entry direction per end (-1 enters from above). */
  const harness = (a: Pt, dirA: number, b: Pt, dirB: number): string => {
    const sag = bezierSag(a, b);
    return `M ${a.x} ${a.y} C ${a.x} ${a.y + sag * dirA}, ${b.x} ${b.y + sag * dirB}, ${b.x} ${b.y}`;
  };

  const geometry: WireGeometry = {
    path: (a, b, w, idx) => {
      const [ma, mb] = [metaOf.get(w.from), metaOf.get(w.to)];
      if (!ma || !mb) return bezierPath(a, b);
      if (ma.zone === 'rail' && mb.zone === 'door') return railToDoor(a, ma, b, mb, idx);
      if (ma.zone === 'door' && mb.zone === 'rail') return railToDoor(b, mb, a, ma, idx);
      if (ma.zone === 'rail' && mb.zone === 'motor') return roundedPath(railToMotorPts(a, ma, b, idx), 8);
      if (ma.zone === 'motor' && mb.zone === 'rail') return roundedPath(railToMotorPts(b, mb, a, idx), 8);
      if (ma.zone === 'door' && mb.zone === 'door') {
        if (doorFacing(a, ma, b, mb)) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
        const lx = doorLaneX(a, b, idx);
        const ea = doorEscape(a, ma, idx);
        const eb = doorEscape(b, mb, idx);
        return roundedPath([a, { x: a.x, y: ea }, { x: lx, y: ea }, { x: lx, y: eb }, { x: b.x, y: eb }, b], 8);
      }
      if (ma.zone === 'motor' || mb.zone === 'motor') {
        return harness(a, ma.zone === 'motor' ? -1 : 1, b, mb.zone === 'motor' ? -1 : 1);
      }
      const da = ductFor(ma);
      const db = ductFor(mb);
      const lane = laneOf(idx);
      if (da === db) {
        return roundedPath([a, { x: a.x, y: da + lane }, { x: b.x, y: da + lane }, b], 8);
      }
      const sx = spineLaneOf(idx);
      return roundedPath(
        [
          a,
          { x: a.x, y: da + lane },
          { x: sx, y: da + lane },
          { x: sx, y: db + lane },
          { x: b.x, y: db + lane },
          b,
        ],
        8,
      );
    },
    anchor: (a, b, w, idx) => {
      const [ma, mb] = [metaOf.get(w.from), metaOf.get(w.to)];
      if (!ma || !mb) return bezierAnchor(a, b);
      const doorSide = ma.zone === 'door' ? a : mb.zone === 'door' ? b : null;
      const railSide = ma.zone === 'rail' ? { m: ma, p: a } : mb.zone === 'rail' ? { m: mb, p: b } : null;
      if (doorSide && railSide) {
        const d = ductFor(railSide.m) + laneOf(idx);
        const esc = doorEscape(doorSide, ma.zone === 'door' ? ma : mb, idx);
        return { x: (spineLaneOf(idx) + doorSide.x) / 2 + 20, y: (d + esc) / 2 };
      }
      if (ma.zone === 'rail' && mb.zone === 'motor') return railToMotorAnchor(a, ma, b, idx);
      if (ma.zone === 'motor' && mb.zone === 'rail') return railToMotorAnchor(b, mb, a, idx);
      if (ma.zone === 'door' && mb.zone === 'door') {
        if (doorFacing(a, ma, b, mb)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return { x: doorLaneX(a, b, idx), y: (doorEscape(a, ma, idx) + doorEscape(b, mb, idx)) / 2 };
      }
      if (ma.zone === 'motor' || mb.zone === 'motor') {
        const dirs = (ma.zone === 'motor' ? -1 : 1) + (mb.zone === 'motor' ? -1 : 1);
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + bezierSag(a, b) * 0.375 * dirs };
      }
      const da = ductFor(ma);
      const db = ductFor(mb);
      if (da === db) return { x: (a.x + b.x) / 2, y: da + laneOf(idx) };
      return { x: spineLaneOf(idx), y: (da + db) / 2 };
    },
  };

  const potentialOf = (t: TerminalId): SupplyPotential | null => result?.terminalPotentials[t] ?? null;
  const colorOf = (t: TerminalId): string => {
    const p = potentialOf(t);
    return p ? PANEL_PALETTE[p] : PANEL_PALETTE.floating;
  };

  // ---- View extents -------------------------------------------------------
  const motorBottoms = motorComps.map((c) => c.y + 112);
  const minX = Math.min(enclL, strip?.l ?? enclL, ...motorComps.map((c) => c.x - 52)) - 14;
  const maxX = Math.max(enclR, ...motorComps.map((c) => c.x + 150)) + 14;
  const minY = Math.min(enclT, strip?.t ?? enclT) - 12;
  const maxY = Math.max(enclB, strip?.b ?? enclB, ...motorBottoms) + 14;

  const pendingFrom = g.selectedTerminal ? (posOf.get(g.selectedTerminal) ?? null) : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="cabinet-svg pnl-view"
      onPointerDown={pz.onSvgPointerDown}
      onPointerMove={(e) => {
        pz.onSvgPointerMove(e);
        g.onSvgPointerMove(e);
      }}
      onClick={g.onSvgClick}
    >
      <PanelDefs />

      <g ref={sceneRef} transform={pz.transform}>
      {/* Enclosure + mounting plate */}
      <rect x={enclL} y={enclT} width={enclR - enclL} height={enclB - enclT} rx={6} className="pnl-encl" onClick={g.clearSelection} />
      <rect x={plateL} y={plateT} width={plateR - plateL} height={plateB - plateT} rx={2} className="pnl-plate" onClick={g.clearSelection} />
      <g className="cab-deco">
        {[
          { x: enclL + 8, y: enclT + 8 },
          { x: enclR - 8, y: enclT + 8 },
          { x: enclL + 8, y: enclB - 8 },
          { x: enclR - 8, y: enclB - 8 },
        ].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.2} className="pnl-screw" />
        ))}
      </g>

      {/* DIN rails behind each device row */}
      <g className="cab-deco">
        {rows.map((y) => (
          <g key={y}>
            <rect x={plateL + 8} y={y + 22} width={plateR - plateL - 16} height={20} fill="url(#pnl-rail)" stroke="#878d92" strokeWidth={0.8} />
            <line x1={plateL + 8} y1={y + 26} x2={plateR - 8} y2={y + 26} stroke="#f2f4f5" strokeWidth={1} />
            <line x1={plateL + 8} y1={y + 39} x2={plateR - 8} y2={y + 39} stroke="#70767c" strokeWidth={1} />
          </g>
        ))}
      </g>

      {/* Wire ducts: horizontal bands + the vertical spine on the left */}
      <g className="cab-deco">
        {ducts.map((y) => (
          <Duct key={y} x={plateL + 40} y={y - 11} w={plateR - plateL - 56} h={22} horizontal />
        ))}
        <Duct x={spineX - 11} y={ducts[0] - 11} w={22} h={ducts[ducts.length - 1] - ducts[0] + 22} />
      </g>

      {/* Door strip with operators */}
      {strip && (
        <>
          <rect x={strip.l} y={strip.t} width={strip.r - strip.l} height={strip.b - strip.t} rx={5} className="pnl-door" onClick={g.clearSelection} />
          <g className="cab-deco">
            <circle cx={strip.l + 9} cy={strip.t + 10} r={2.6} className="pnl-screw" />
            <circle cx={strip.l + 9} cy={strip.b - 10} r={2.6} className="pnl-screw" />
            <text x={(strip.l + strip.r) / 2} y={strip.t + 16} className="pnl-plate-label">
              OPERATOR
            </text>
          </g>
        </>
      )}

      <WiresLayer
        running={running}
        palette={PANEL_PALETTE}
        potentialOf={potentialOf}
        posOf={posOf}
        geometry={geometry}
        pendingFrom={pendingFrom}
        cursor={g.cursor}
      />

      {components.map((c) => (
        <PanelDevice
          key={c.id}
          c={c}
          result={result}
          enclTop={enclT}
          estop={spec.devices.some((d) => d.address === c.hmiAddress && d.widget === 'estop')}
        />
      ))}

      {/* Terminals above device bodies */}
      {components.map((c) =>
        terminalsOf(c.type).map((t) => {
          const id = terminalId(c.id, t.name);
          const single = terminalsOf(c.type).every((x) => x.dx === 0);
          return (
            <g key={id}>
              <g className="cab-deco" transform={`translate(${c.x + t.dx}, ${c.y + t.dy})`}>
                <circle r={6.5} className="pnl-screwterm" />
                <line x1={-3.4} y1={0} x2={3.4} y2={0} className="pnl-screwslot" transform="rotate(35)" />
              </g>
              <TerminalDot
                id={id}
                x={c.x + t.dx}
                y={c.y + t.dy}
                r={3.4}
                color={colorOf(id)}
                selected={g.selectedTerminal === id}
                onPointerDown={g.onTerminalPointerDown}
                label={t.name}
                labelAt={single && zoneOf(c.type) === 'door' ? { x: 10, y: 4 } : { x: 0, y: t.dy === 0 ? -11 : 19 }}
                labelClass={`cab-term-label pnl-term${single && zoneOf(c.type) === 'door' ? ' side' : ''}`}
              />
            </g>
          );
        }),
      )}

      <WireDeleteControl running={running} posOf={posOf} geometry={geometry} />
      </g>

      <ZoomControls pz={pz} x={maxX - 26} y={minY + 26} />
    </svg>
  );
}

/* ------------------------------- scenery ------------------------------- */

function PanelDefs() {
  return (
    <defs>
      <linearGradient id="pnl-rail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#eceef0" />
        <stop offset="0.5" stopColor="#b6bcc1" />
        <stop offset="1" stopColor="#dcdfe2" />
      </linearGradient>
      <linearGradient id="pnl-devbody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d3d7db" />
        <stop offset="1" stopColor="#aab0b6" />
      </linearGradient>
      <linearGradient id="pnl-devface" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#41474e" />
        <stop offset="1" stopColor="#23272c" />
      </linearGradient>
      <linearGradient id="pnl-motor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a6e84" />
        <stop offset="0.5" stopColor="#33566c" />
        <stop offset="1" stopColor="#274357" />
      </linearGradient>
    </defs>
  );
}

/** Open slotted wiring duct (the grey finger trunking of real panels). */
function Duct({ x, y, w, h, horizontal = false }: { x: number; y: number; w: number; h: number; horizontal?: boolean }) {
  const slots: React.ReactNode[] = [];
  if (horizontal) {
    for (let sx = x + 8; sx < x + w - 6; sx += 13) {
      slots.push(<rect key={sx} x={sx} y={y - 2.5} width={6} height={5} rx={1.5} className="pnl-duct-slot" />);
      slots.push(<rect key={sx + 0.1} x={sx} y={y + h - 2.5} width={6} height={5} rx={1.5} className="pnl-duct-slot" />);
    }
  } else {
    for (let sy = y + 8; sy < y + h - 6; sy += 13) {
      slots.push(<rect key={sy} x={x - 2.5} y={sy} width={5} height={6} rx={1.5} className="pnl-duct-slot" />);
      slots.push(<rect key={sy + 0.1} x={x + w - 2.5} y={sy} width={5} height={6} rx={1.5} className="pnl-duct-slot" />);
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2} className="pnl-duct" />
      {slots}
    </g>
  );
}

/* ------------------------------- devices ------------------------------- */

function PanelDevice({ c, result, enclTop, estop }: { c: CabinetComponent; result: CabinetSimResult | null; enclTop: number; estop: boolean }) {
  const energized = result?.energized[c.id] === true;
  switch (c.type) {
    case 'contactor':
      return <RailDevice c={c} energized={energized} left={-20} width={216} dial={false} />;
    case 'overload':
      return <RailDevice c={c} energized={energized} left={-16} width={168} dial />;
    case 'supply3ph':
      return <SupplyBlock c={c} enclTop={enclTop} />;
    case 'button-no':
    case 'button-nc':
      return <DoorButton c={c} nc={c.type === 'button-nc'} estop={estop} />;
    case 'lamp':
      return <DoorLamp c={c} energized={energized} />;
    case 'motor3':
      return <Motor c={c} motor={result?.motors[c.id] ?? null} />;
  }
}

/** Shared housing for contactor / overload relay. */
function RailDevice({ c, energized, left, width, dial }: { c: CabinetComponent; energized: boolean; left: number; width: number; dial: boolean }) {
  return (
    <g className={`cab-deco pnl-dev${energized ? ' energized' : ''}`} transform={`translate(${c.x}, ${c.y})`}>
      <rect x={left} y={-12} width={width} height={88} rx={3} fill="url(#pnl-devbody)" className="pnl-dev-body" />
      <rect x={left} y={-12} width={width} height={18} fill="rgba(15,20,25,0.10)" />
      <rect x={left} y={58} width={width} height={18} fill="rgba(15,20,25,0.10)" />
      <rect x={left + 6} y={12} width={width - 12} height={40} rx={2} fill="url(#pnl-devface)" />
      <text x={left + 16} y={30} className="pnl-dev-id">
        {c.id}
      </text>
      <text x={left + 16} y={43} className="pnl-dev-sub">
        {c.label}
      </text>
      {dial ? (
        <g transform={`translate(${left + width - 26}, 32)`}>
          <circle r={9} fill="#e8eaec" stroke="#70767c" strokeWidth={1} />
          <line x1={0} y1={0} x2={5.5} y2={-4} stroke="#2563eb" strokeWidth={2} strokeLinecap="round" />
          <circle r={1.8} fill="#2563eb" />
        </g>
      ) : (
        <rect x={left + width - 34} y={22} width={18} height={20} rx={2} className={`pnl-flag${energized ? ' on' : ''}`} />
      )}
    </g>
  );
}

function SupplyBlock({ c, enclTop }: { c: CabinetComponent; enclTop: number }) {
  const stripe: Record<string, string> = {
    L1: '#8a5a2b',
    L2: '#23272d',
    L3: '#8b939d',
    N: '#2f6fe4',
    PE: '#6f9a12',
  };
  const terms = terminalsOf(c.type);
  return (
    <g className="cab-deco" transform={`translate(${c.x}, ${c.y})`}>
      {/* incoming supply cable from the gland plate at the top */}
      <path d={`M 64 ${enclTop - c.y + 4} C 64 ${enclTop - c.y + 30}, 64 -34, 64 -14`} className="pnl-cable" />
      <rect x={-18} y={-12} width={164} height={54} rx={3} fill="url(#pnl-devbody)" className="pnl-dev-body" />
      {terms.map((t) => (
        <g key={t.name} transform={`translate(${t.dx}, 0)`}>
          <rect x={-13} y={-12} width={26} height={54} fill="none" stroke="rgba(40,46,52,0.25)" strokeWidth={0.8} />
          <rect x={-9} y={-9} width={18} height={5} rx={1} fill={stripe[t.name]} />
        </g>
      ))}
      <rect x={-18} y={26} width={164} height={16} rx={2} fill="url(#pnl-devface)" />
      <text x={64} y={37} className="pnl-dev-sub center">
        {c.label} · 3~ 50 Hz
      </text>
    </g>
  );
}

function DoorButton({ c, nc, estop }: { c: CabinetComponent; nc: boolean; estop: boolean }) {
  const cx = c.x - 40;
  const cy = c.y + 24;
  return (
    <g className="cab-deco" transform={`translate(${cx}, ${cy})`}>
      {/* wire stub from operator to its contact block */}
      <line x1={14} y1={0} x2={30} y2={0} stroke="#8f959b" strokeWidth={3} />
      {estop ? (
        <>
          {/* yellow backing disc + red mushroom head */}
          <circle r={16.5} fill="#e8c11c" stroke="#a68a10" strokeWidth={1.2} />
          <circle r={11} fill="#c93131" stroke="#8f1f1f" strokeWidth={1.2} />
          <circle r={11} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} transform="translate(-1,-1.5)" opacity={0.6} />
          <circle r={7} fill="none" stroke="#8f1f1f" strokeWidth={1} opacity={0.7} />
        </>
      ) : (
        <>
          <circle r={15} className="pnl-bezel" />
          <circle r={nc ? 11 : 9.5} fill={nc ? '#c93131' : '#2c9540'} stroke={nc ? '#8f1f1f' : '#1d6b2d'} strokeWidth={1.2} />
          <circle r={nc ? 11 : 9.5} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1} transform="translate(-1,-1.5)" opacity={0.6} />
          <text y={3.5} className="pnl-btn-glyph">
            {nc ? 'O' : 'I'}
          </text>
        </>
      )}
      <text y={30} className="pnl-plate-label">
        {c.label}
      </text>
      {/* contact block behind the door, carrying the terminals */}
      <rect x={30} y={-30} width={22} height={60} rx={2} fill="url(#pnl-devbody)" stroke="#878d92" strokeWidth={0.8} />
      <text x={41} y={2.5} className="pnl-dev-sub center xs">
        {nc ? 'NC' : 'NO'}
      </text>
    </g>
  );
}

function DoorLamp({ c, energized }: { c: CabinetComponent; energized: boolean }) {
  const cx = c.x - 40;
  const cy = c.y + 24;
  return (
    <g className={`cab-deco${energized ? ' energized' : ''}`} transform={`translate(${cx}, ${cy})`}>
      <line x1={14} y1={0} x2={30} y2={0} stroke="#8f959b" strokeWidth={3} />
      <circle r={14} className="pnl-bezel" />
      <circle r={9} className={`pnl-lens${energized ? ' on' : ''}`} />
      <text y={30} className="pnl-plate-label">
        {c.label}
      </text>
      <rect x={30} y={-30} width={22} height={60} rx={2} fill="url(#pnl-devbody)" stroke="#878d92" strokeWidth={0.8} />
    </g>
  );
}

function Motor({ c, motor }: { c: CabinetComponent; motor: MotorReading | null }) {
  const running = motor?.running === true;
  const spin = running && motor && motor.direction !== 'none' ? motor.direction : null;
  return (
    <g className={`cab-deco pnl-motorg${running ? ' running' : ''}`} transform={`translate(${c.x}, ${c.y})`}>
      {/* floor pad */}
      <rect x={-46} y={94} width={190} height={7} rx={2} fill="rgba(60,66,72,0.45)" />
      {/* feet */}
      <rect x={-24} y={84} width={26} height={12} rx={2} fill="#3b4650" />
      <rect x={94} y={84} width={26} height={12} rx={2} fill="#3b4650" />
      {/* body with cooling fins */}
      <rect x={-34} y={14} width={164} height={74} rx={12} fill="url(#pnl-motor)" stroke="#1d3242" strokeWidth={1.2} />
      {[-22, -10, 2, 14, 26, 38, 50, 62, 74, 86, 102].map((fx) => (
        <line key={fx} x1={fx} y1={18} x2={fx} y2={84} stroke="rgba(12,28,40,0.35)" strokeWidth={2} />
      ))}
      {/* shaft */}
      <rect x={-48} y={46} width={14} height={9} rx={2} fill="#b6bcc1" stroke="#70767c" strokeWidth={0.8} />
      {/* fan shroud with spinning cue */}
      <circle cx={130} cy={51} r={22} fill="#3b5a6e" stroke="#1d3242" strokeWidth={1.2} />
      <g transform="translate(130, 51)">
        {/* nested so the CSS spin transform doesn't clobber the positioning */}
        <g className={`pnl-fan${spin ? ` ${spin}` : ''}`}>
          {[0, 45, 90, 135].map((a) => (
            <line key={a} x1={-16} y1={0} x2={16} y2={0} transform={`rotate(${a})`} stroke="#a9c3d2" strokeWidth={2.4} strokeLinecap="round" />
          ))}
          <circle r={4} fill="#a9c3d2" />
        </g>
      </g>
      {/* terminal box on top */}
      <rect x={-14} y={-14} width={124} height={30} rx={3} fill="url(#pnl-devbody)" stroke="#70767c" strokeWidth={1} />
      <text x={48} y={34} className="pnl-dev-id center">
        {c.id}
      </text>
      {running && (
        <text x={48} y={116} className="cab-motor-dir">
          {motor?.direction === 'fwd' ? '⟳ FWD' : '⟲ REV'}
        </text>
      )}
    </g>
  );
}
