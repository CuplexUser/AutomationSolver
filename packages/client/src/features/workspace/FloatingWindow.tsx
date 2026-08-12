import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PinIcon } from '../../components/PinIcon';

/** A window's box in viewport pixels. */
export interface WindowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  /** Stable per puzzle — the key its geometry is remembered under. */
  id: string;
  storageKey: string;
  title: string;
  /** Small dimmed line after the title, e.g. the task a POU runs in. */
  subtitle?: string;
  /** Right-aligned chip in the title bar, e.g. READ ONLY or a rung count. */
  badge?: ReactNode;
  initial: WindowBox;
  focused: boolean;
  z: number;
  onFocus: () => void;
  onClose: () => void;
  /** Collapsed to a tab in the strip — the window itself draws nothing while this is true. */
  minimized?: boolean;
  onMinimize?: () => void;
  children: ReactNode;
}

const MIN_W = 320;
const MIN_H = 180;
/** Keep at least this much of the title bar reachable, whatever the drag did. */
const KEEP_VISIBLE = 80;
const TITLEBAR_H = 34;

/** The eight grab points of the frame, named as compass directions. */
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Edge = (typeof EDGES)[number];
type DragMode = 'move' | Edge;

const EDGE_NAME: Record<Edge, string> = {
  n: 'top edge',
  s: 'bottom edge',
  e: 'right edge',
  w: 'left edge',
  ne: 'top right corner',
  nw: 'top left corner',
  se: 'bottom right corner',
  sw: 'bottom left corner',
};

/**
 * `.float-win` is `position: fixed`, so `box.y` is a viewport pixel — but the
 * app's sticky top bar (`z-index: 3000`, well above any window) sits in that
 * same viewport space and would happily eat a title bar dragged or resized
 * up into it, with no way to grab the window back. Measured rather than a
 * second hardcoded constant next to the CSS, since the bar's height is padding
 * plus its content, not a fixed number this file controls.
 */
function topbarHeight(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
}

/**
 * Apply a drag to one edge or corner.
 *
 * North and west move the box's origin as well as its size, and the delta has
 * to be clamped *before* the origin moves: clamping the width afterwards (which
 * is all `clampBox` can do) would leave a window at its minimum sliding sideways
 * for as long as the pointer kept going.
 */
function resizeBox(from: WindowBox, edge: Edge, dx: number, dy: number, minY: number): WindowBox {
  const box = { ...from };
  if (edge.includes('e')) box.w = from.w + dx;
  if (edge.includes('s')) box.h = from.h + dy;
  if (edge.includes('w')) {
    const d = Math.min(dx, from.w - MIN_W);
    box.x = from.x + d;
    box.w = from.w - d;
  }
  if (edge.includes('n')) {
    // Never past the top bar, or the title bar goes under the app's.
    const d = Math.max(minY - from.y, Math.min(dy, from.h - MIN_H));
    box.y = from.y + d;
    box.h = from.h - d;
  }
  return box;
}

function clampBox(box: WindowBox, vw: number, vh: number, minY: number): WindowBox {
  const w = Math.max(MIN_W, Math.min(box.w, vw));
  const h = Math.max(MIN_H, Math.min(box.h, vh));
  return {
    w,
    h,
    // A window can hang off the right and bottom, but never so far that its
    // title bar (the only way to drag it back) leaves the viewport.
    x: Math.max(KEEP_VISIBLE - w, Math.min(box.x, vw - KEEP_VISIBLE)),
    y: Math.max(minY, Math.min(box.y, vh - TITLEBAR_H)),
  };
}

/** Windows sit in one band, the always-on-top ones in a band above it. */
const ONTOP_BAND = 1000;

function loadBox(key: string, fallback: WindowBox): WindowBox {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<WindowBox>;
    if (
      typeof saved.x !== 'number' ||
      typeof saved.y !== 'number' ||
      typeof saved.w !== 'number' ||
      typeof saved.h !== 'number'
    ) {
      return fallback;
    }
    return saved as WindowBox;
  } catch {
    // A corrupt entry is not worth a broken workspace; fall back to the default.
    return fallback;
  }
}

/**
 * A draggable, resizable panel floating over the workspace.
 *
 * Pointer capture (the pattern `features/layout/Resizable.tsx` already uses)
 * rather than window-level listeners: the drag keeps tracking when the pointer
 * outruns the header, and it cannot be lost to whatever it passes over — which
 * on this page is a WebGL canvas that would otherwise swallow the move events.
 */
export function FloatingWindow({
  storageKey,
  title,
  subtitle,
  badge,
  initial,
  focused,
  z,
  onFocus,
  onClose,
  minimized = false,
  onMinimize,
  children,
}: Props) {
  const [box, setBox] = useState<WindowBox>(() => loadBox(storageKey, initial));
  const [maximized, setMaximized] = useState(false);
  // Not persisted, and neither is `maximized`: a window remembers the size and
  // place the player chose, never a pose. Reopening the desk with a window
  // already forced over everything else is the sort of state nobody asked for
  // and everybody then has to undo.
  const [onTop, setOnTop] = useState(false);
  const drag = useRef<{ mode: DragMode; startX: number; startY: number; from: WindowBox } | null>(
    null,
  );

  // Persist the box, but not the maximized pose — a window remembers the size
  // the player chose, not the moment they flung it full-screen.
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(box));
  }, [storageKey, box]);

  // A window sized for a wide monitor must not be stranded off-screen on a
  // narrow one, so re-clamp whenever the viewport changes. Also runs once on
  // mount, which is what pulls a window saved (by an older build, or a since
  // resized bar) behind the top bar back into reach.
  useEffect(() => {
    const onResize = () =>
      setBox((b) => clampBox(b, globalThis.innerWidth, globalThis.innerHeight, topbarHeight()));
    globalThis.addEventListener('resize', onResize);
    onResize();
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  const startDrag = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      if (maximized) return;
      // A press on a title-bar button is not the start of a drag. It has to bail
      // out *before* the capture: a captured pointer retargets the click to the
      // capture element, so grabbing the bar here swallowed every button press
      // in it — which is why none of the window controls did anything.
      if ((e.target as Element).closest('button')) return;
      e.preventDefault();
      onFocus();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      drag.current = { mode, startX: e.clientX, startY: e.clientY, from: box };
    },
    [box, maximized, onFocus],
  );

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const minY = topbarHeight();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const next =
      d.mode === 'move'
        ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
        : resizeBox(d.from, d.mode, dx, dy, minY);
    setBox(clampBox(next, globalThis.innerWidth, globalThis.innerHeight, minY));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  // Maximized geometry is CSS (`position: absolute` inside the workspace), not
  // inline pixels: filling the viewport put the title bar — and with it the only
  // way back out — underneath the app's top bar.
  const style: React.CSSProperties = maximized
    ? { zIndex: (onTop ? ONTOP_BAND : 0) + z }
    : {
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        zIndex: (onTop ? ONTOP_BAND : 0) + z,
      };

  // Collapsed to a tab in `WindowTabStrip` — box/maximized/onTop stay live in
  // state so restoring puts the window back exactly where it was, but nothing
  // here draws while minimized.
  if (minimized) return null;

  return (
    <section
      className={`float-win${focused ? ' focused' : ''}${maximized ? ' maximized' : ''}`}
      style={style}
      // Any click anywhere in the window takes focus — which is what hands it
      // the keyboard, so it has to be the whole surface and not just the bar.
      onPointerDownCapture={onFocus}
      aria-label={title}
    >
      <header
        className="fw-bar"
        onPointerDown={startDrag('move')}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('button')) return;
          setMaximized((v) => !v);
        }}
      >
        <span className="fw-title">{title}</span>
        {subtitle && <span className="fw-sub">{subtitle}</span>}
        <span className="fw-spacer" />
        {badge}
        <button
          className={`fw-btn pin-toggle${onTop ? ' on' : ''}`}
          onClick={() => setOnTop((v) => !v)}
          aria-pressed={onTop}
          title={onTop ? 'On top of every window — click to release' : 'Keep on top of other windows'}
          aria-label="Keep window on top"
        >
          <PinIcon pinned={onTop} />
        </button>
        {onMinimize && (
          <button className="fw-btn" onClick={onMinimize} title="Minimize to a tab" aria-label="Minimize window">
            −
          </button>
        )}
        <button
          className="fw-btn"
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? 'Restore (or double-click the title bar)' : 'Maximize (or double-click the title bar)'}
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button className="fw-btn fw-close" onClick={onClose} title="Close" aria-label="Close window">
          ✕
        </button>
      </header>

      <div className="fw-body">{children}</div>

      {/* Every edge and every corner, the way a window resizes anywhere else.
          The bottom-right one keeps the drawn grip: it is the habitual one, and
          the only visible clue that the frame can be grabbed at all. */}
      {!maximized &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className={`fw-edge fw-${edge}`}
            onPointerDown={startDrag(edge)}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="separator"
            aria-label={`Resize ${title} — ${EDGE_NAME[edge]}`}
          />
        ))}
    </section>
  );
}

/**
 * Lay windows out in a cascade from the top-left of the workspace, so opening
 * four sections at once gives four readable windows rather than one stack.
 */
export function cascadeBox(index: number, w = 620, h = 420): WindowBox {
  const step = 34;
  return { x: 96 + index * step, y: 72 + index * step, w, h };
}

export interface MinimizedTab {
  id: string;
  title: string;
  onRestore: () => void;
}

/**
 * One tab per minimized window, along the bottom of the workspace.
 *
 * A window's own title bar is the only way to reach it once minimized, so the
 * tab carries the same title — a bare id would ask the player to remember
 * what they collapsed. Renders nothing when there is nothing collapsed,
 * rather than an empty strip claiming a row of screen for no reason.
 */
export function WindowTabStrip({ tabs }: { tabs: MinimizedTab[] }) {
  if (tabs.length === 0) return null;
  return (
    <div className="win-tabstrip" role="tablist" aria-label="Minimized windows">
      {tabs.map((t) => (
        <button key={t.id} className="win-tab" onClick={t.onRestore} title={`Restore ${t.title}`}>
          {t.title}
        </button>
      ))}
    </div>
  );
}
