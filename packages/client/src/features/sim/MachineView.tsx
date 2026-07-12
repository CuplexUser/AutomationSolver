import type { MachineState, PuzzleSpec } from '@automationsolver/shared';
import { Machine3D, type Box3 } from './Machine3D';
import type { SimRunner } from './useSimRunner';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Puzzle-specific machine visualization. Falls back to nothing when a puzzle has
 * no bespoke scene (the I/O widgets alone tell the story for the simple ones).
 */
export function MachineView({ spec, runner }: { spec: PuzzleSpec; runner: SimRunner }) {
  if (spec.processId === 'drill') {
    const m = runner.machine;
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Drill Station</span>
          <span className="mv-tag">{drillTag(m)}</span>
        </div>
        <Machine3D boxes={drillBoxes(m)} height={300} />
        <div className="mv-readout">
          <Readout label="Clamp" value={pct(numOf(m.clamp))} on={numOf(m.clamp) >= 1} />
          <Readout label="Feed" value={pct(numOf(m.drill))} on={numOf(m.drill) >= 1} />
          <Readout label="Spindle" value={boolOf(m.spinning) ? 'RUN' : 'OFF'} on={boolOf(m.spinning)} />
        </div>
      </div>
    );
  }
  if (spec.processId === 'elevator') {
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Elevator Shaft</span>
          <span className="mv-tag">{elevatorTag(runner.machine)}</span>
        </div>
        <ElevatorShaft machine={runner.machine} />
      </div>
    );
  }
  return null;
}

function Readout({ label, value, on }: { label: string; value: string; on: boolean }) {
  return (
    <span className={`mv-stat${on ? ' on' : ''}`}>
      <span className="mv-stat-label">{label}</span>
      <span className="mv-stat-value">{value}</span>
    </span>
  );
}

// --- Drill station ----------------------------------------------------------

const STEEL = '#aeb4bf';
const STEEL_DARK = '#7e8592';
const BED = '#5c6373';
const CAST = '#cdd2da';
const PART = '#a97c4d';
const DARK = '#272b33';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function drillTag(m: MachineState): string {
  if (boolOf(m.done)) return '✔ cycle done';
  if (boolOf(m.spinning)) return '⚙ drilling';
  if (numOf(m.clamp) > 0) return 'clamping';
  return 'idle';
}

/**
 * The scene is built from non-intersecting axis-aligned boxes so the renderer can
 * order them exactly. The bore is modelled as four slabs around a square hole plus a
 * floor slab that thins out as the bit sinks — that way you actually see the hole
 * being cut instead of a bit disappearing into a solid block.
 */
function drillBoxes(m: MachineState): Box3[] {
  const clamp = clamp01(numOf(m.clamp));
  const feed = clamp01(numOf(m.drill));
  const spinning = boolOf(m.spinning);
  const warning = boolOf(m.warning);
  const done = boolOf(m.done);

  const partTop = 0.9;
  const headBottom = 3.6 - 2.4 * feed; // spindle travel
  const chuckBottom = headBottom - 0.35;
  const bitTip = headBottom - 1.55;
  const bore = clamp01((partTop - bitTip) / partTop); // how deep the hole is cut
  const floorH = Math.max(0.02, partTop * (1 - bore));

  const leftJaw = -3.4 + clamp * 1.9; // closes onto the part edge at x = -1
  const rightJaw = 2.9 - clamp * 1.9;

  return [
    // --- bed + feet
    { x: -5, y: -0.5, z: -4, w: 10, h: 0.5, d: 8, color: BED },
    { x: -4.6, y: -1.1, z: -3.6, w: 0.7, h: 0.6, d: 0.7, color: DARK },
    { x: 3.9, y: -1.1, z: -3.6, w: 0.7, h: 0.6, d: 0.7, color: DARK },
    { x: -4.6, y: -1.1, z: 2.9, w: 0.7, h: 0.6, d: 0.7, color: DARK },
    { x: 3.9, y: -1.1, z: 2.9, w: 0.7, h: 0.6, d: 0.7, color: DARK },
    // --- guide rail the jaws slide along
    { x: -4, y: 0, z: -1.1, w: 8, h: 0.12, d: 0.25, color: STEEL_DARK },
    { x: -4, y: 0, z: 0.85, w: 8, h: 0.12, d: 0.25, color: STEEL_DARK },

    // --- workpiece: four slabs around a square bore, plus a thinning floor
    { x: -1, y: 0, z: -1, w: 0.7, h: partTop, d: 2, color: PART },
    { x: 0.3, y: 0, z: -1, w: 0.7, h: partTop, d: 2, color: PART },
    { x: -0.3, y: 0, z: -1, w: 0.6, h: partTop, d: 0.7, color: PART },
    { x: -0.3, y: 0, z: 0.3, w: 0.6, h: partTop, d: 0.7, color: PART },
    { x: -0.3, y: 0, z: -0.3, w: 0.6, h: floorH, d: 0.6, color: bore > 0 ? '#6b4f31' : PART },

    // --- clamp jaws
    { x: leftJaw, y: 0.12, z: -0.9, w: 0.5, h: 0.75, d: 1.8, color: clamp >= 1 ? '#d8dde4' : STEEL },
    { x: rightJaw, y: 0.12, z: -0.9, w: 0.5, h: 0.75, d: 1.8, color: clamp >= 1 ? '#d8dde4' : STEEL },
    { x: leftJaw - 0.9, y: 0.3, z: -0.4, w: 0.9, h: 0.35, d: 0.8, color: STEEL_DARK },
    { x: rightJaw + 0.5, y: 0.3, z: -0.4, w: 0.9, h: 0.35, d: 0.8, color: STEEL_DARK },

    // --- gantry: column, two arm segments reaching over the part
    { x: 3.6, y: 0, z: -3.2, w: 1.2, h: 5.6, d: 1.2, color: CAST },
    { x: 3.6, y: 5.6, z: -2.6, w: 1.2, h: 1.2, d: 2, color: CAST },
    { x: -0.9, y: 5.6, z: -0.6, w: 5.7, h: 1.2, d: 1.2, color: CAST },
    // vertical slideway the spindle rides on
    { x: 0.9, y: 1.2, z: -0.25, w: 0.3, h: 4.4, d: 0.5, color: STEEL_DARK },

    // --- spindle head, chuck, bit
    { x: -0.9, y: headBottom, z: -0.9, w: 1.8, h: 1.8, d: 1.8, color: spinning ? '#a78bfa' : DARK, glow: spinning },
    { x: -0.7, y: headBottom + 1.8, z: -0.7, w: 1.4, h: 0.2, d: 1.4, color: STEEL_DARK },
    { x: -0.35, y: chuckBottom, z: -0.35, w: 0.7, h: 0.35, d: 0.7, color: STEEL },
    { x: -0.15, y: bitTip, z: -0.15, w: 0.3, h: chuckBottom - bitTip, d: 0.3, color: '#c8ccd4' },

    // --- warning beacon (front left)
    { x: -4.7, y: 0, z: 2.6, w: 0.4, h: 1.8, d: 0.4, color: '#3a3f4a' },
    {
      x: -4.85,
      y: 1.8,
      z: 2.45,
      w: 0.7,
      h: 0.7,
      d: 0.7,
      color: warning ? '#ffb020' : '#5a4a2a',
      glow: warning,
    },
    // --- cycle-done lamp (front right)
    {
      x: 4,
      y: 0,
      z: 2.6,
      w: 0.7,
      h: 0.7,
      d: 0.7,
      color: done ? '#22c55e' : '#25402e',
      glow: done,
    },
  ];
}

// --- Elevator: a 2D shaft with the car at a continuous position -------------

function elevatorTag(m: MachineState): string {
  const dir = numOf(m.dir);
  return dir > 0 ? '▲ up' : dir < 0 ? '▼ down' : 'idle';
}

function ElevatorShaft({ machine }: { machine: MachineState }) {
  const pos = Math.min(3, Math.max(1, numOf(machine.pos, 1)));
  const dir = numOf(machine.dir);
  const floors = [3, 2, 1];
  const H = 300;
  const top = 20;
  const bottom = H - 30;
  const span = bottom - top;
  // pos 1 -> bottom, pos 3 -> top
  const carY = bottom - ((pos - 1) / 2) * span - 46;

  return (
    <svg viewBox={`0 0 220 ${H}`} width="100%" height={H} role="img" aria-label="Elevator shaft">
      <rect x={20} y={top - 6} width={180} height={span + 40} rx={6} fill="#1b1e26" stroke="#2c3240" />
      {floors.map((f) => {
        const y = bottom - ((f - 1) / 2) * span;
        return (
          <g key={f}>
            <line x1={24} y1={y} x2={196} y2={y} stroke="#2c3240" strokeWidth={1} />
            <text x={30} y={y - 6} fill="#7d8494" fontSize={11} fontFamily="var(--font-mono)">
              F{f}
            </text>
            <circle cx={186} cy={y - 8} r={4} fill={Math.abs(pos - f) < 0.05 ? '#37d67a' : '#3a4150'} />
          </g>
        );
      })}
      <line x1={78} y1={top} x2={78} y2={bottom} stroke="#2c3240" strokeWidth={1} />
      <line x1={150} y1={top} x2={150} y2={bottom} stroke="#2c3240" strokeWidth={1} />
      <g transform={`translate(0 ${carY})`}>
        <rect x={72} y={0} width={84} height={46} rx={4} fill="#3a4150" stroke="#59617a" />
        <rect x={78} y={6} width={34} height={34} rx={2} fill="#20242e" />
        <rect x={116} y={6} width={34} height={34} rx={2} fill="#20242e" />
        {dir !== 0 && (
          <text x={114} y={30} textAnchor="middle" fill="#ffb020" fontSize={16}>
            {dir > 0 ? '▲' : '▼'}
          </text>
        )}
      </g>
    </svg>
  );
}
