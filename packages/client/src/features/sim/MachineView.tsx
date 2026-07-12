import type { MachineState, PuzzleSpec } from '@automationsolver/shared';
import { Machine3D, type Box3 } from './Machine3D';
import type { SimRunner } from './useSimRunner';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;

/**
 * Puzzle-specific machine visualization. Falls back to nothing when a puzzle has
 * no bespoke scene (the I/O widgets alone tell the story for the simple ones).
 */
export function MachineView({ spec, runner }: { spec: PuzzleSpec; runner: SimRunner }) {
  if (spec.processId === 'drill') {
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Drill Station</span>
          <span className="mv-tag">3D · live</span>
        </div>
        <Machine3D boxes={drillBoxes(runner.machine)} spinning={runner.running} height={280} />
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

// --- Drill station: build the 3D box model from machine state ---------------

const STEEL = '#aeb4bf';
const DARK = '#22262f';

function drillBoxes(m: MachineState): Box3[] {
  const clamp = numOf(m.clamp);
  const drill = numOf(m.drill);
  const spinning = boolOf(m.spinning);
  const warning = boolOf(m.warning);
  const done = boolOf(m.done);

  const headBottom = 3.2 - 1.7 * drill; // spindle descends as it drills
  const boxes: Box3[] = [
    // base plate
    { x: -5, y: -0.4, z: -4, w: 10, h: 0.4, d: 8, color: '#6b7180' },
    // part on the table
    { x: -1, y: 0, z: -1, w: 2, h: 0.9, d: 2, color: done ? '#7c5a34' : '#8a6a44' },
    // gantry column (rear right) + arm reaching over the part
    { x: 3, y: 0, z: -2.6, w: 1.3, h: 6.2, d: 1.3, color: '#cdd2da' },
    { x: -0.7, y: 5, z: -2.4, w: 4, h: 1.1, d: 1.1, color: '#d6dae1' },
    // drill motor head (glows purple while spinning)
    { x: -1, y: headBottom, z: -0.9, w: 2, h: 1.9, d: 1.9, color: spinning ? '#a78bfa' : DARK, glow: spinning },
    // drill bit
    { x: -0.2, y: headBottom - 1.1, z: -0.15, w: 0.4, h: 1.2, d: 0.4, color: '#9aa0ac' },
    // clamp jaws slide inward as the part is clamped
    { x: -4.2 + clamp * 1.9, y: 0.1, z: -0.7, w: 1.6, h: 0.8, d: 1.4, color: STEEL },
    { x: 2.6 - clamp * 1.9, y: 0.1, z: -0.7, w: 1.6, h: 0.8, d: 1.4, color: STEEL },
    // warning beacon tower (front left)
    { x: -4.4, y: 0, z: 2.4, w: 0.5, h: 1.6, d: 0.5, color: '#3a3f4a' },
    {
      x: -4.55,
      y: 1.6,
      z: 2.25,
      w: 0.8,
      h: 0.8,
      d: 0.8,
      color: warning ? '#ffb020' : '#5a4a2a',
      glow: warning,
    },
    // done lamp (front right)
    {
      x: 3.9,
      y: 0.1,
      z: 2.4,
      w: 0.7,
      h: 0.7,
      d: 0.7,
      color: done ? '#22c55e' : '#264a2f',
      glow: done,
    },
  ];
  return boxes;
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
      {/* building face */}
      <rect x={20} y={top - 6} width={180} height={span + 40} rx={6} fill="#1b1e26" stroke="#2c3240" />
      {/* floor lines + labels */}
      {floors.map((f) => {
        const y = bottom - ((f - 1) / 2) * span;
        return (
          <g key={f}>
            <line x1={24} y1={y} x2={196} y2={y} stroke="#2c3240" strokeWidth={1} />
            <text x={30} y={y - 6} fill="#7d8494" fontSize={11} fontFamily="var(--font-mono)">
              F{f}
            </text>
            <circle
              cx={186}
              cy={y - 8}
              r={4}
              fill={Math.abs(pos - f) < 0.05 ? '#37d67a' : '#3a4150'}
            />
          </g>
        );
      })}
      {/* shaft rails */}
      <line x1={78} y1={top} x2={78} y2={bottom} stroke="#2c3240" strokeWidth={1} />
      <line x1={150} y1={top} x2={150} y2={bottom} stroke="#2c3240" strokeWidth={1} />
      {/* car */}
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
