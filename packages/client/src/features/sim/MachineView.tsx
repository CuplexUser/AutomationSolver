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
          <StatusTag tag={drillTag(m)} />
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
          <StatusTag tag={packTag(m)} />
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
          <StatusTag tag={elevatorTag(m)} />
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
          <StatusTag tag={pickPlaceTag(m)} />
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

// --- Status tag ---------------------------------------------------------------

/**
 * The status tags used to be single characters (⚠ ⚙ ⏵ 📦 …). Most of those live
 * outside the coverage of the mono stack, so they came out as tofu boxes on
 * Windows. They are drawn as inline SVG instead: same weight everywhere, and
 * they take the tag's colour.
 */
type TagIcon =
  | 'warn'
  | 'gear'
  | 'check'
  | 'right'
  | 'left'
  | 'up'
  | 'down'
  | 'block'
  | 'bar'
  | 'swing'
  | 'gripClosed'
  | 'gripOpen'
  | 'box';

const TAG_ICONS: Record<TagIcon, { d: string; fill?: boolean; evenodd?: boolean }> = {
  // Solid mark with the bar and dot punched out (evenodd), rather than a 1px
  // outline: at 11px an outlined triangle with a hairline inside it just reads
  // as a grey lozenge.
  warn: {
    d: 'M8 1.2 15.4 14.8H0.6ZM7.1 5.8h1.8v4.1H7.1ZM7.1 11.3h1.8v1.8H7.1Z',
    fill: true,
    evenodd: true,
  },
  gear: {
    d:
      'M8 4.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 1 0 0-6.6M8 1.4v2.1M8 12.5v2.1M1.4 8h2.1M12.5 8h2.1' +
      'M3.3 3.3l1.5 1.5M11.2 11.2l1.5 1.5M12.7 3.3l-1.5 1.5M4.8 11.2l-1.5 1.5',
  },
  check: { d: 'M2.6 8.4 6.4 12.4 13.4 3.9' },
  right: { d: 'M4.2 2.4 12.6 8 4.2 13.6Z', fill: true },
  left: { d: 'M11.8 2.4 3.4 8l8.4 5.6Z', fill: true },
  up: { d: 'M8 2.6 14 12.6H2Z', fill: true },
  down: { d: 'M8 13.4 2 3.4h12Z', fill: true },
  block: { d: 'M8 1.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 1 0 0-12.8M3.5 12.5 12.5 3.5' },
  bar: { d: 'M6 2h4v12H6Z', fill: true },
  swing: { d: 'M13.2 8A5.2 5.2 0 1 1 8 2.8M5.6 1.1 9 2.8 5.6 4.5Z' },
  gripClosed: { d: 'M4.8 3h2.1v10H4.8ZM9.1 3h2.1v10H9.1Z', fill: true },
  gripOpen: { d: 'M1.9 3H4v10H1.9ZM12 3h2.1v10H12Z', fill: true },
  box: { d: 'M2.2 5.4h11.6v8.4H2.2ZM2.2 5.4 4.4 2.2h7.2l2.2 3.2M8 5.4v8.4' },
};

function TagIconSvg({ name }: { name: TagIcon }) {
  const icon = TAG_ICONS[name];
  return (
    <svg className="mv-tag-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={icon.d}
        fill={icon.fill ? 'currentColor' : 'none'}
        fillRule={icon.evenodd ? 'evenodd' : undefined}
        stroke={icon.fill ? 'none' : 'currentColor'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface MachineTag {
  text: string;
  icon?: TagIcon;
  /** Renders in the fault colour and, with `tip`, explains itself on hover. */
  warn?: boolean;
  tip?: string;
}

function StatusTag({ tag }: { tag: MachineTag }) {
  return (
    <span
      className={`mv-tag${tag.warn ? ' warn' : ''}`}
      data-tip={tag.tip}
      // Focusable so the explanation is reachable without a mouse; aria-label
      // carries it for screen readers, which never see the ::after bubble.
      tabIndex={tag.tip ? 0 : undefined}
      aria-label={tag.tip ? `${tag.text}. ${tag.tip}` : undefined}
    >
      {tag.icon && <TagIconSvg name={tag.icon} />}
      {tag.text}
    </span>
  );
}

/**
 * A jam latches and freezes the machine, so the tag is often the only clue that
 * anything happened at all. The process model records which interlock broke;
 * surface it on hover rather than making the player guess.
 */
function jamTag(m: MachineState): MachineTag {
  const reason = typeof m.jamReason === 'string' ? m.jamReason : '';
  return {
    text: 'jammed',
    icon: 'warn',
    warn: true,
    // The interlock trips on the same scan the fault happens, before the machine
    // has moved a millimetre, which is why the scene simply stops dead instead of
    // playing out the crash. Say so, or the frozen picture reads as a bug.
    tip: `${reason ? `Jammed: ${reason}.` : 'Jammed.'} The interlock trips on the spot, so nothing moves after it. Press Reset to clear the fault.`,
  };
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

function drillTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  const pushing = numOf(m.push) > 0 && numOf(m.push) < 1;
  if (pushing) {
    return numOf(m.gate) > 0.5
      ? { text: 'rejecting', icon: 'left' }
      : { text: 'ejecting', icon: 'right' };
  }
  if (boolOf(m.done)) return { text: 'cycle done', icon: 'check' };
  if (numOf(m.drill) >= 1) return { text: 'dwelling', icon: 'gear' };
  if (boolOf(m.spinning)) {
    return { text: numOf(m.drill) > 0 ? 'drilling' : 'spindle up', icon: 'gear' };
  }
  if (numOf(m.clamp) > 0) return { text: 'clamping' };
  if (m.part === 'steel') return { text: 'metal blank', icon: 'block' };
  if (m.part === 'none') return { text: 'waiting for stock' };
  return { text: 'idle' };
}

function spindleValue(speed: number): string {
  if (speed >= 1) return 'RUN';
  return speed > 0 ? 'SPIN-UP' : 'OFF';
}

function stockValue(m: MachineState): string {
  if (m.part === 'steel') return 'STEEL';
  if (m.part === 'alu') return boolOf(m.drilled) ? 'ALU OK' : 'ALU';
  return '—';
}

// --- Packaging ---------------------------------------------------------------

function packTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  const anyPush =
    numOf(m.push2) > 0.01 || numOf(m.push4) > 0.01 || numOf(m.push16a) > 0.01 || numOf(m.push16b) > 0.01;
  if (numOf(m.lift) > 0.01) return { text: 'flipping', icon: 'up' };
  if (anyPush) return { text: 'pushing', icon: 'right' };
  // The retaining bracket rests forward — pulled back is the notable state.
  if (numOf(m.backstop) <= 0.01) return { text: 'bracket back', icon: 'bar' };
  return { text: 'idle' };
}

// --- Elevator ----------------------------------------------------------------

function elevatorTag(m: MachineState): MachineTag {
  const dir = numOf(m.dir);
  if (dir > 0) return { text: 'up', icon: 'up' };
  if (dir < 0) return { text: 'down', icon: 'down' };
  return { text: 'idle' };
}

// --- Pick & place --------------------------------------------------------------

function pickPlaceTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  if (numOf(m.dir) !== 0) return { text: 'swinging', icon: 'swing' };
  if (numOf(m.reach) > 0.01 && numOf(m.reach) < 1) return { text: 'reaching', icon: 'right' };
  if (numOf(m.grip) > 0.01 && numOf(m.grip) < 1) {
    return boolOf(m.carrying)
      ? { text: 'gripping', icon: 'gripClosed' }
      : { text: 'releasing', icon: 'gripOpen' };
  }
  if (boolOf(m.carrying)) return { text: 'carrying', icon: 'box' };
  return { text: 'idle' };
}
