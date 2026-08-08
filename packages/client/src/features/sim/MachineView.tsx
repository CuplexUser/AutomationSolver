import { lazy, Suspense } from 'react';
import {
  FACTORY_LIMITS,
  LINE_LIMITS,
  type LadderPuzzleSpec,
  type MachineState,
} from '@automationsolver/shared';
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
const TankVessel3D = lazy(() =>
  import('./TankVessel3D').then((m) => ({ default: m.TankVessel3D })),
);
const AxisRig3D = lazy(() => import('./AxisRig3D').then((m) => ({ default: m.AxisRig3D })));
const Warehouse3D = lazy(() => import('./Warehouse3D').then((m) => ({ default: m.Warehouse3D })));
const Factory3D = lazy(() => import('./Factory3D').then((m) => ({ default: m.Factory3D })));
const FactoryLine3D = lazy(() =>
  import('./factoryLine/FactoryLine3D').then((m) => ({ default: m.FactoryLine3D })),
);

/** Reserves the scene's footprint while its chunk downloads (no layout shift). */
const sceneFallback = <div className="machine3d" style={{ height: 300 }} />;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const strOf = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Raw counts as the percent of full scale they stand for: "62% (2480)". */
const counts = (v: number) => `${Math.round((v / 4000) * 100)}% (${Math.round(v)})`;
/** The same, keeping the sign, for a drive that runs both ways. */
const signedCounts = (v: number) => `${v > 0 ? '+' : ''}${counts(v)}`;
const inBand = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
/** How many of one part code a buffer string holds. */
const countOf = (s: string, code: string) => [...s].filter((c) => c === code).length;

/**
 * Puzzle-specific machine visualization. Falls back to nothing when a puzzle has
 * no bespoke scene (the I/O widgets alone tell the story for the simple ones).
 *
 * `section` is the plant workspace asking for one bay rather than the whole
 * factory. Single-machine scenes ignore it — there is nothing to zoom into.
 */
export function MachineView({
  spec,
  runner,
  section,
}: {
  spec: LadderPuzzleSpec;
  runner: SimRunner;
  /** POU id of the bay to frame, or undefined for the whole plant. */
  section?: string;
}) {
  if (spec.processId === 'factory') {
    const m = runner.machine;
    const temp = Math.round(numOf(m.boothTempM) / 100);
    const film = Math.round(numOf(m.filmM) / 100);
    return (
      // No panel chrome and no readout strip: in the plant workspace the scene
      // *is* the page, and the numbers below would eat the floor it needs.
      <div className="machine-view plant">
        <div className="mv-head floating">
          <span className="eyebrow">Excavator Plant</span>
          <StatusTag tag={factoryTag(m)} />
          <span className="mv-flow">
            <Flow label="Weld" value={`${strOf(m.bufWp).length}/${FACTORY_LIMITS.WP_CAP}`} on={strOf(m.bufWp).length > 0} />
            <Flow
              label="Painted F/B"
              value={`${numOf(m.bufPaFrames)} / ${numOf(m.bufPaBooms)}`}
              // A lane at zero while the other has stock is the wrong mix, and
              // it is worth shouting about before the starve latch trips.
              on={numOf(m.bufPaFrames) > 0 && numOf(m.bufPaBooms) > 0}
              warn={
                (numOf(m.bufPaFrames) === 0) !== (numOf(m.bufPaBooms) === 0) &&
                numOf(m.bufPaFrames) + numOf(m.bufPaBooms) > 0
              }
            />
            <Flow label="Booth" value={counts(temp)} on={temp >= FACTORY_LIMITS.CURE_MIN && temp <= FACTORY_LIMITS.CURE_MAX} />
            <Flow label="Film" value={counts(film)} on={film >= FACTORY_LIMITS.FILM_MIN && film <= FACTORY_LIMITS.FILM_MAX} />
            <Flow label="Test" value={`${numOf(m.bufAt)}/${FACTORY_LIMITS.AT_CAP}`} on={numOf(m.bufAt) > 0} />
            <Flow label="Shipped" value={`${numOf(m.shipped)}`} on={numOf(m.shipped) > 0} />
            {numOf(m.scrapped) > 0 && <Flow label="Scrap" value={`${numOf(m.scrapped)}`} on warn />}
          </span>
        </div>
        <Suspense fallback={<div className="machine3d" style={{ height: '100%' }} />}>
          <Factory3D machine={m} outputs={runner.bits} section={section} height="100%" />
        </Suspense>
      </div>
    );
  }
  if (spec.processId === 'factory-line') {
    const m = runner.machine;
    const temp = Math.round(numOf(m.boothTempM) / 100);
    const film = Math.round(numOf(m.filmM) / 100);
    const laneF = strOf(m.laneF);
    const laneB = strOf(m.laneB);
    const stored = Array.from({ length: LINE_LIMITS.STORE_LANES }, (_, i) =>
      strOf(m[`lane${i}`]),
    ).join('');
    return (
      // Same contract as the tutorial plant: no panel chrome and no readout
      // strip, because in the plant workspace the scene *is* the page.
      <div className="machine-view plant">
        <div className="mv-head floating">
          <span className="eyebrow">Excavator Line</span>
          <StatusTag tag={lineTag(m)} />
          <span className="mv-flow">
            <Flow
              label="Store F/B"
              value={`${countOf(stored, 'f')} / ${countOf(stored, 'b')}`}
              on={stored.length > 0}
              // A store holding only one kind is a store about to starve the jig,
              // and it is worth saying before the starve latch trips.
              warn={stored.length > 0 && (countOf(stored, 'f') === 0 || countOf(stored, 'b') === 0)}
            />
            <Flow label="Booth" value={counts(temp)} on={inBand(temp, LINE_LIMITS.CURE_MIN, LINE_LIMITS.CURE_MAX)} />
            <Flow label="Film" value={counts(film)} on={film > 0} />
            <Flow
              label="Painted F/B"
              value={`${laneF.length} / ${laneB.length}`}
              on={laneF.length > 0 && laneB.length > 0}
              warn={(laneF.length === 0) !== (laneB.length === 0) && laneF.length + laneB.length > 0}
            />
            <Flow label="Test" value={`${numOf(m.bufAt)}/${LINE_LIMITS.AT_CAP}`} on={numOf(m.bufAt) > 0} />
            <Flow
              label="Yard"
              value={`${numOf(m.yard)}/${LINE_LIMITS.YARD_CAP}`}
              on={numOf(m.yard) > 0}
              warn={numOf(m.yard) >= LINE_LIMITS.YARD_CAP}
            />
            <Flow label="Shipped" value={`${numOf(m.shipped)}`} on={numOf(m.shipped) > 0} />
            {numOf(m.scrapped) > 0 && <Flow label="Scrap" value={`${numOf(m.scrapped)}`} on warn />}
          </span>
        </div>
        <Suspense fallback={<div className="machine3d" style={{ height: '100%' }} />}>
          <FactoryLine3D machine={m} outputs={runner.bits} section={section} height="100%" />
        </Suspense>
      </div>
    );
  }
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
  if (spec.processId === 'tank') {
    const m = runner.machine;
    const hasPump = spec.devices.some((d) => d.address === 'Y0');
    const level = numOf(m.level);
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Buffer Vessel</span>
          <StatusTag tag={tankTag(m)} />
        </div>
        <Suspense fallback={sceneFallback}>
          <TankVessel3D machine={m} height={300} />
        </Suspense>
        <div className="mv-readout">
          {/* Counts are what the program sees; percent is what a person reads. */}
          <Readout label="Level" value={counts(level)} on={level > 0} />
          <Readout label="Valve" value={counts(numOf(m.valve))} on={numOf(m.valve) > 0} />
          {hasPump && (
            <Readout label="Discharge" value={counts(numOf(m.outflow))} on={boolOf(m.pumping)} />
          )}
        </div>
      </div>
    );
  }
  if (spec.processId === 'axis') {
    const m = runner.machine;
    const hasForks = typeof m.forks === 'number';
    const hasHoist = typeof m.hoist === 'number';
    const vel = numOf(m.vel);
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Transfer Carriage</span>
          <StatusTag tag={axisTag(m)} />
        </div>
        <Suspense fallback={sceneFallback}>
          <AxisRig3D machine={m} height={300} />
        </Suspense>
        <div className="mv-readout">
          <Readout label="Position" value={counts(numOf(m.pos))} on={numOf(m.pos) > 0} />
          {/* Speed is signed, so it says direction as well as magnitude. */}
          <Readout label="Speed" value={signedCounts(vel)} on={vel !== 0} />
          {/* The ramp parameters are the puzzle, so they belong on the panel. */}
          <Readout label="Ramp" value={`${numOf(m.accel)} / ${numOf(m.decel)}`} on={numOf(m.accel) > 0} />
          {hasForks && (
            <Readout label="Load" value={boolOf(m.loaded) ? 'ON FORKS' : '—'} on={boolOf(m.loaded)} />
          )}
          {hasHoist && <Readout label="Hook" value={counts(numOf(m.hoist))} on={numOf(m.hoist) > 0} />}
          {hasHoist && (
            <Readout label="Sway" value={`${numOf(m.swayAmp)}`} on={numOf(m.swayAmp) > 60} />
          )}
          {hasForks && <Readout label="Put away" value={`${numOf(m.placed)}`} on={numOf(m.placed) > 0} />}
        </div>
      </div>
    );
  }
  if (spec.processId === 'warehouse') {
    const m = runner.machine;
    const hasLineA = typeof m.bufferA === 'number';
    const hasLineB = typeof m.bufferB === 'number';
    const hasGoodsIn = typeof m.goodsWaiting === 'number';
    const slots = [11, 12, 21, 22, 31, 32, 41, 42];
    const filled = slots.filter((k) => numOf(m[`slot${k}`]) > 0).length;
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Aisle Crane</span>
          <StatusTag tag={warehouseTag(m)} />
        </div>
        <Suspense fallback={sceneFallback}>
          <Warehouse3D machine={m} height={300} />
        </Suspense>
        <div className="mv-readout">
          {/* The crane's own coordinate, in the same numbers the program uses. */}
          <Readout
            label="At"
            value={`${numOf(m.pos).toFixed(1)} / L${Math.round(numOf(m.level, 1))}`}
            on={numOf(m.dir) !== 0 || numOf(m.liftDir) !== 0}
          />
          <Readout label="Fork" value={pct(numOf(m.fork))} on={numOf(m.fork) > 0} />
          <Readout
            label="Carrying"
            value={boolOf(m.carrying) ? materialName(numOf(m.loadCode)) : '—'}
            on={boolOf(m.carrying)}
          />
          <Readout label="Rack" value={`${filled}/8`} on={filled > 0} />
          {hasLineA && (
            <Readout
              label="Line A"
              value={`${numOf(m.bufferA)} · ${numOf(m.deliveredA)} out`}
              on={numOf(m.bufferA) > 0}
            />
          )}
          {hasLineB && (
            <Readout
              label="Line B"
              value={`${numOf(m.bufferB)} · ${numOf(m.deliveredB)} out`}
              on={numOf(m.bufferB) > 0}
            />
          )}
          {hasGoodsIn && (
            <Readout
              label="Goods in"
              value={`${numOf(m.goodsWaiting)}/2 · ${numOf(m.storedAway)} away`}
              on={numOf(m.goodsWaiting) > 0}
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

/**
 * A readout sized for the plant's floating header rather than for a panel's
 * readout strip. Same idea as `Readout`, but it can also go amber: on a line,
 * "two in the buffer" is fine and "two frames and no booms" is not, and only
 * one of those is a number you can read off a count.
 */
function Flow({
  label,
  value,
  on,
  warn,
}: {
  label: string;
  value: string;
  on: boolean;
  warn?: boolean;
}) {
  return (
    <span className={`mv-flow-stat${on ? ' on' : ''}${warn ? ' warn' : ''}`}>
      <span className="mv-stat-label">{label}</span>
      <span className="mv-stat-value">{value}</span>
    </span>
  );
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

// --- Buffer vessel -----------------------------------------------------------

function tankTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  const level = numOf(m.level);
  const valve = numOf(m.valve);
  if (level >= 3600) return { text: 'high level', icon: 'warn', warn: true };
  if (level <= 400) return { text: 'low level', icon: 'warn', warn: true };
  if (valve >= 3960) return { text: 'valve wide open', icon: 'up' };
  if (valve > 0) return { text: 'filling', icon: 'up' };
  if (boolOf(m.pumping)) return { text: 'discharging', icon: 'down' };
  return { text: 'idle' };
}

// --- Traverse axis ------------------------------------------------------------

function axisTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  const vel = numOf(m.vel);
  if (typeof m.hoist === 'number') {
    if (numOf(m.swayAmp) > 60 && vel === 0) return { text: 'swinging', icon: 'swing', warn: false };
    if (numOf(m.hoist) > 0 && numOf(m.hoist) < 4000) return { text: 'hoisting', icon: 'up' };
  }
  if (vel > 0) return { text: 'traversing', icon: 'right' };
  if (vel < 0) return { text: 'returning', icon: 'left' };
  if (boolOf(m.loaded)) return { text: 'loaded', icon: 'box' };
  return { text: 'idle' };
}

// --- Automated warehouse --------------------------------------------------------

const WAREHOUSE_MATERIAL_NAMES = ['—', 'Steel', 'Brass', 'Nylon', 'Alloy'];

function materialName(code: number): string {
  return WAREHOUSE_MATERIAL_NAMES[code] ?? `#${code}`;
}

/**
 * A starved line and a blocked goods-in are latches like `jam`, but they are not
 * crashes: the crane is still driveable and the picture is still moving, so they
 * need saying out loud or the run just looks like it is going fine.
 */
function warehouseTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  if (m.starved === true) {
    return {
      text: 'line stopped',
      icon: 'warn',
      warn: true,
      tip: 'A production line ran its infeed conveyor empty and stopped. The crane is still working, but the run has already failed.',
    };
  }
  if (m.blocked === true) {
    return {
      text: 'goods in blocked',
      icon: 'warn',
      warn: true,
      tip: 'A pallet arrived at goods in with nowhere to go, so the inbound conveyor stopped. The run has already failed.',
    };
  }
  if (numOf(m.fork) > 0.01) {
    return boolOf(m.carrying) ? { text: 'depositing', icon: 'right' } : { text: 'collecting', icon: 'right' };
  }
  if (numOf(m.dir) > 0) return { text: 'travelling', icon: 'right' };
  if (numOf(m.dir) < 0) return { text: 'returning', icon: 'left' };
  if (numOf(m.liftDir) > 0) return { text: 'hoisting', icon: 'up' };
  if (numOf(m.liftDir) < 0) return { text: 'lowering', icon: 'down' };
  if (boolOf(m.carrying)) return { text: 'loaded', icon: 'box' };
  return { text: 'idle' };
}

// --- Excavator plant ------------------------------------------------------------

/**
 * Three ways a line stops, and only one of them is a crash.
 *
 * `blocked` and `starved` leave every mechanism perfectly healthy, so unlike a
 * jam there is nothing in the picture that looks wrong — which is exactly why
 * they have to be said out loud, and why each one names the section that has
 * the problem rather than just the plant.
 */
function factoryTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  if (m.starved === true) {
    return {
      text: 'assembly starved',
      icon: 'warn',
      warn: true,
      tip: 'Final assembly is holding half a machine and the other part type never arrived. The line built the wrong mix: it needs one frame and one boom, not two of whichever is quicker. The run has already failed.',
    };
  }
  if (m.blocked === true) {
    const reason = typeof m.jamReason === 'string' ? m.jamReason : '';
    return {
      text: 'line blocked',
      icon: 'block',
      warn: true,
      tip: `${reason ? `${reason[0].toUpperCase()}${reason.slice(1)}.` : 'A buffer overran.'} Every buffer's full bit is a sensor the program can read, so this is a section that pushed without looking. The run has already failed.`,
    };
  }
  const stage = typeof m.paintStage === 'string' ? m.paintStage : 'idle';
  if (stage === 'cure') return { text: 'curing', icon: 'gear' };
  if (stage === 'spray') return { text: 'spraying', icon: 'gear' };
  if (numOf(m.testCycle) > 0 && numOf(m.testCycle) < 1) return { text: 'function test', icon: 'gear' };
  if (numOf(m.testDispatch) > 0) return { text: 'dispatching', icon: 'right' };
  if (numOf(m.weldSeam) > 0 && numOf(m.weldSeam) < 1) return { text: 'welding', icon: 'gear' };
  if (numOf(m.assyStarveMs) > 3000) {
    return {
      text: 'assembly waiting',
      icon: 'warn',
      tip: 'A part is in the jig and its partner has not come out of paint. Still recoverable, but the starve timer is running.',
    };
  }
  if (numOf(m.shipped) > 0) return { text: 'running', icon: 'check' };
  return { text: 'idle' };
}

// --- Excavator line -------------------------------------------------------------

/**
 * The line has more ways to stop than the tutorial plant, and more of them look
 * fine in the picture.
 *
 * A jam is a crash. Starved and blocked leave every mechanism healthy, so they
 * have to be said out loud. And a truck that has not been called is not a fault
 * at all — it is a decision the player has not made yet, which is why it gets a
 * plain tag rather than a warning.
 */
function lineTag(m: MachineState): MachineTag {
  if (m.jam === true) return jamTag(m);
  if (m.starved === true) {
    return {
      text: 'assembly starved',
      icon: 'warn',
      warn: true,
      tip: 'Final assembly is holding half a machine and its partner never arrived. The line built the wrong mix: it needs one frame and one boom, not two of whichever is quicker. The run has already failed.',
    };
  }
  if (m.blocked === true) {
    const reason = typeof m.jamReason === 'string' ? m.jamReason : '';
    return {
      text: 'line blocked',
      icon: 'block',
      warn: true,
      tip: `${reason ? `${reason[0].toUpperCase()}${reason.slice(1)}.` : 'A buffer overran.'} Every buffer's full bit is a sensor the program can read, so this is a section that pushed without looking. The run has already failed.`,
    };
  }
  if (numOf(m.tipChange) > 0) return { text: 'changing tip', icon: 'gear' };
  if (numOf(m.purge) > 0) return { text: 'purging gun', icon: 'gear' };
  const stage = strOf(m.boothStage, 'idle');
  if (stage === 'spray') return { text: 'spraying', icon: 'gear' };
  if (numOf(m.portalAt) > 0 && numOf(m.portalAt) < 1) {
    return { text: 'portal travelling', icon: 'right' };
  }
  if (numOf(m.testCycle) > 0 && numOf(m.testCycle) < 1) return { text: 'function test', icon: 'gear' };
  if (numOf(m.weldSeam) > 0 && numOf(m.weldSeam) < 1) return { text: 'welding', icon: 'gear' };
  if (numOf(m.assyStarveMs) > 3000) {
    return {
      text: 'assembly waiting',
      icon: 'warn',
      tip: 'A part is in the jig and its partner has not come out of paint. Still recoverable, but the starve timer is running.',
    };
  }
  if (numOf(m.yard) >= LINE_LIMITS.YARD_CAP) {
    return {
      text: 'yard full',
      icon: 'block',
      warn: false,
      tip: 'The yard is full, so test cannot dispatch and the line will back up behind it. Call a lorry.',
    };
  }
  if (numOf(m.shipped) > 0) return { text: 'running', icon: 'check' };
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
