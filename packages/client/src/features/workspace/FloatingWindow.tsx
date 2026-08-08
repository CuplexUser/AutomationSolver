import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

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
  children: ReactNode;
}

const MIN_W = 320;
const MIN_H = 180;
/** Keep at least this much of the title bar reachable, whatever the drag did. */
const KEEP_VISIBLE = 80;
const TITLEBAR_H = 34;

type DragMode = 'move' | 'resize';

function clampBox(box: WindowBox, vw: number, vh: number): WindowBox {
  const w = Math.max(MIN_W, Math.min(box.w, vw));
  const h = Math.max(MIN_H, Math.min(box.h, vh));
  return {
    w,
    h,
    // A window can hang off the right and bottom, but never so far that its
    // title bar (the only way to drag it back) leaves the viewport.
    x: Math.max(KEEP_VISIBLE - w, Math.min(box.x, vw - KEEP_VISIBLE)),
    y: Math.max(0, Math.min(box.y, vh - TITLEBAR_H)),
  };
}

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
  children,
}: Props) {
  const [box, setBox] = useState<WindowBox>(() => loadBox(storageKey, initial));
  const [maximized, setMaximized] = useState(false);
  const drag = useRef<{ mode: DragMode; startX: number; startY: number; from: WindowBox } | null>(
    null,
  );

  // Persist the box, but not the maximized pose — a window remembers the size
  // the player chose, not the moment they flung it full-screen.
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify(box));
  }, [storageKey, box]);

  // A window sized for a wide monitor must not be stranded off-screen on a
  // narrow one, so re-clamp whenever the viewport changes.
  useEffect(() => {
    const onResize = () =>
      setBox((b) => clampBox(b, globalThis.innerWidth, globalThis.innerHeight));
    globalThis.addEventListener('resize', onResize);
    onResize();
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);

  const startDrag = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      if (maximized) return;
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
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const next =
      d.mode === 'move'
        ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
        : { ...d.from, w: d.from.w + dx, h: d.from.h + dy };
    setBox(clampBox(next, globalThis.innerWidth, globalThis.innerHeight));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const style: React.CSSProperties = maximized
    ? { inset: '8px', width: 'auto', height: 'auto', zIndex: z }
    : { left: box.x, top: box.y, width: box.w, height: box.h, zIndex: z };

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
        onDoubleClick={() => setMaximized((v) => !v)}
      >
        <span className="fw-title">{title}</span>
        {subtitle && <span className="fw-sub">{subtitle}</span>}
        <span className="fw-spacer" />
        {badge}
        <button
          className="fw-btn"
          onClick={() => setMaximized((v) => !v)}
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore window' : 'Maximize window'}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button className="fw-btn fw-close" onClick={onClose} title="Close" aria-label="Close window">
          ✕
        </button>
      </header>

      <div className="fw-body">{children}</div>

      {!maximized && (
        <div
          className="fw-grip"
          onPointerDown={startDrag('resize')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="separator"
          aria-label={`Resize ${title}`}
        />
      )}
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
