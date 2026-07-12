import type { MachineState, PuzzleSpec } from '@automationsolver/shared';
import { DrillStation3D } from './DrillStation3D';
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
        <DrillStation3D machine={m} height={300} />
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

function drillTag(m: MachineState): string {
  if (boolOf(m.done)) return '✔ cycle done';
  if (boolOf(m.spinning)) return '⚙ drilling';
  if (numOf(m.clamp) > 0) return 'clamping';
  return 'idle';
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
