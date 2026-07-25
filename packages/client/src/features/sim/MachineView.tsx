import { lazy, Suspense } from 'react';
import type { LadderPuzzleSpec, MachineState } from '@automationsolver/shared';
import type { SimRunner } from './useSimRunner';

// Lazy so three.js + react-three-fiber + drei (the bulk of the bundle) stay in
// a separate chunk that is only fetched when a puzzle actually has a 3D scene.
const DrillStation3D = lazy(() =>
  import('./DrillStation3D').then((m) => ({ default: m.DrillStation3D })),
);
const ElevatorShaft3D = lazy(() =>
  import('./ElevatorShaft3D').then((m) => ({ default: m.ElevatorShaft3D })),
);
const PackMachine3D = lazy(() =>
  import('./PackMachine3D').then((m) => ({ default: m.PackMachine3D })),
);
const PickPlaceArm3D = lazy(() =>
  import('./PickPlaceArm3D').then((m) => ({ default: m.PickPlaceArm3D })),
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
export function MachineView({ spec, runner }: { spec: LadderPuzzleSpec; runner: SimRunner }) {
  if (spec.processId === 'drill') {
    const m = runner.machine;
    // Same feature detection the process model does: the readout grows with the
    // machine the puzzle actually wires.
    const hasSpindle = spec.devices.some((d) => d.address === 'Y5');
    const hasStock = typeof m.part === 'string';
    const hasGate = spec.devices.some((d) => d.address === 'Y6');
    const speed = numOf(m.speed);
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
          <Readout
            label="Spindle"
            value={hasSpindle ? spindleValue(speed) : boolOf(m.spinning) ? 'RUN' : 'OFF'}
            on={hasSpindle ? speed >= 1 : boolOf(m.spinning)}
          />
          {hasStock && <Readout label="Stock" value={stockValue(m)} on={m.part === 'steel'} />}
          <Readout label="Eject" value={pct(numOf(m.push))} on={numOf(m.push) >= 1} />
          {hasStock && <Readout label="Drilled" value={`${numOf(m.good)}`} on={numOf(m.good) > 0} />}
          {hasGate && <Readout label="Rejected" value={`${numOf(m.scrap)}`} on={numOf(m.scrap) > 0} />}
          {numOf(m.bad) > 0 && <Readout label="Faults" value={`${numOf(m.bad)}`} on />}
        </div>
      </div>
    );
  }
  if (spec.processId === 'packaging') {
    const m = runner.machine;
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Packaging Machine</span>
          <span className="mv-tag">{packTag(m)}</span>
        </div>
        <Suspense fallback={sceneFallback}>
          <PackMachine3D machine={m} height={300} />
        </Suspense>
        <div className="mv-readout">
          <Readout label="Sec 2" value={`${numOf(m.sec2)}/4`} on={numOf(m.sec2) > 0} />
          <Readout
            label="Lift"
            value={numOf(m.liftLoad) > 0 ? `${numOf(m.liftLoad)} ▲` : '—'}
            on={numOf(m.liftLoad) > 0}
          />
          <Readout label="Sec 3" value={`${numOf(m.sec3)}/16`} on={numOf(m.sec3) > 0} />
          <Readout label="Sec 4" value={`${numOf(m.sec4)}/16`} on={numOf(m.sec4) > 0} />
          <Readout label="Shipped" value={`${numOf(m.finished)}`} on={numOf(m.finished) > 0} />
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
  if (spec.processId === 'pickPlace') {
    const m = runner.machine;
    const slotCount = [1, 2, 3, 4].filter((k) => spec.devices.some((d) => d.address === `X${k}`)).length;
    const occupied = [1, 2, 3, 4].slice(0, slotCount).filter((k) => m[`slot${k}`] === true).length;
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Pick &amp; Place Arm</span>
          <span className="mv-tag">{pickPlaceTag(m)}</span>
        </div>
        <Suspense fallback={sceneFallback}>
          {/* The mast's green segment is the player's own Tray Full lamp output. */}
          <PickPlaceArm3D machine={m} trayFull={runner.bits['Y4'] === true} height={300} />
        </Suspense>
        <div className="mv-readout">
          <Readout label="Station" value={`${numOf(m.station).toFixed(1)}`} on={numOf(m.dir) !== 0} />
          <Readout label="Reach" value={pct(numOf(m.reach))} on={numOf(m.reach) >= 1} />
          <Readout label="Grip" value={pct(numOf(m.grip))} on={numOf(m.grip) >= 1} />
          <Readout label="Carrying" value={boolOf(m.carrying) ? 'YES' : 'no'} on={boolOf(m.carrying)} />
          <Readout label="Tray" value={`${occupied}/${slotCount}`} on={occupied >= slotCount && slotCount > 0} />
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
  if (m.jam === true) return '⚠ jammed';
  const pushing = numOf(m.push) > 0 && numOf(m.push) < 1;
  if (pushing) return numOf(m.gate) > 0.5 ? '⏴ rejecting' : '⏵ ejecting';
  if (boolOf(m.done)) return '✔ cycle done';
  if (numOf(m.drill) >= 1) return '⚙ dwelling';
  if (boolOf(m.spinning)) return numOf(m.drill) > 0 ? '⚙ drilling' : '⚙ spindle up';
  if (numOf(m.clamp) > 0) return 'clamping';
  if (m.part === 'steel') return '⛔ metal blank';
  if (m.part === 'none') return 'waiting for stock';
  return 'idle';
}

function spindleValue(speed: number): string {
  if (speed >= 1) return 'RUN';
  return speed > 0 ? 'SPIN-UP' : 'OFF';
}

function stockValue(m: MachineState): string {
  if (m.part === 'steel') return 'STEEL';
  if (m.part === 'alu') return boolOf(m.drilled) ? 'ALU ✔' : 'ALU';
  return '—';
}

// --- Packaging ---------------------------------------------------------------

function packTag(m: MachineState): string {
  if (m.jam === true) return '⚠ jammed';
  const anyPush =
    numOf(m.push2) > 0.01 || numOf(m.push4) > 0.01 || numOf(m.push16a) > 0.01 || numOf(m.push16b) > 0.01;
  if (numOf(m.lift) > 0.01) return '⇡ flipping';
  if (anyPush) return '⏵ pushing';
  // The retaining bracket rests forward — pulled back is the notable state.
  if (numOf(m.backstop) <= 0.01) return '▮ bracket back';
  return 'idle';
}

// --- Elevator ----------------------------------------------------------------

function elevatorTag(m: MachineState): string {
  const dir = numOf(m.dir);
  return dir > 0 ? '▲ up' : dir < 0 ? '▼ down' : 'idle';
}

// --- Pick & place --------------------------------------------------------------

function pickPlaceTag(m: MachineState): string {
  if (m.jam === true) return '⚠ jammed';
  if (numOf(m.dir) !== 0) return '⟳ swinging';
  if (numOf(m.reach) > 0.01 && numOf(m.reach) < 1) return '⏵ reaching';
  if (numOf(m.grip) > 0.01 && numOf(m.grip) < 1) return boolOf(m.carrying) ? '✊ gripping' : '✋ releasing';
  if (boolOf(m.carrying)) return '📦 carrying';
  return 'idle';
}
