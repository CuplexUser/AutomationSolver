import { lazy, Suspense } from 'react';
import type { MachineState, PuzzleSpec } from '@automationsolver/shared';
import type { SimRunner } from './useSimRunner';

// Lazy so three.js + react-three-fiber + drei (the bulk of the bundle) stay in
// a separate chunk that is only fetched when a puzzle actually has a 3D scene.
const DrillStation3D = lazy(() =>
  import('./DrillStation3D').then((m) => ({ default: m.DrillStation3D })),
);
const ElevatorShaft3D = lazy(() =>
  import('./ElevatorShaft3D').then((m) => ({ default: m.ElevatorShaft3D })),
);

/** Reserves the scene's footprint while its chunk downloads (no layout shift). */
const sceneFallback = <div className="machine3d" style={{ height: 300 }} />;

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
        <Suspense fallback={sceneFallback}>
          <DrillStation3D machine={m} height={300} />
        </Suspense>
        <div className="mv-readout">
          <Readout label="Clamp" value={pct(numOf(m.clamp))} on={numOf(m.clamp) >= 1} />
          <Readout label="Feed" value={pct(numOf(m.drill))} on={numOf(m.drill) >= 1} />
          <Readout label="Spindle" value={boolOf(m.spinning) ? 'RUN' : 'OFF'} on={boolOf(m.spinning)} />
          <Readout label="Eject" value={pct(numOf(m.push))} on={numOf(m.push) >= 1} />
        </div>
      </div>
    );
  }
  if (spec.processId === 'elevator' || spec.processId === 'elevator5') {
    const m = runner.machine;
    const floorCount = spec.processId === 'elevator' ? 3 : 5;
    const hasDoor = spec.devices.some((d) => d.address === 'Y2');
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Elevator Shaft</span>
          <span className="mv-tag">{elevatorTag(m)}</span>
        </div>
        <Suspense fallback={sceneFallback}>
          <ElevatorShaft3D machine={m} floorCount={floorCount} hasDoor={hasDoor} height={300} />
        </Suspense>
        <div className="mv-readout">
          <Readout label="Position" value={`F${Math.round(numOf(m.pos, 1))}`} on={numOf(m.dir) !== 0} />
          <Readout
            label="Direction"
            value={numOf(m.dir) > 0 ? 'UP' : numOf(m.dir) < 0 ? 'DOWN' : 'IDLE'}
            on={numOf(m.dir) !== 0}
          />
          {hasDoor && (
            <Readout
              label="Door"
              value={numOf(m.door) >= 1 ? 'OPEN' : numOf(m.door) <= 0 ? 'CLOSED' : pct(numOf(m.door))}
              on={numOf(m.door) > 0}
            />
          )}
        </div>
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
  if (numOf(m.push) > 0 && numOf(m.push) < 1) return '⏵ ejecting';
  if (boolOf(m.done)) return '✔ cycle done';
  if (boolOf(m.spinning)) return '⚙ drilling';
  if (numOf(m.clamp) > 0) return 'clamping';
  return 'idle';
}

// --- Elevator ----------------------------------------------------------------

function elevatorTag(m: MachineState): string {
  const dir = numOf(m.dir);
  return dir > 0 ? '▲ up' : dir < 0 ? '▼ down' : 'idle';
}
