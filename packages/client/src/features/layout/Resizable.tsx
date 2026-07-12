import { useCallback, useEffect, useRef, useState } from 'react';

/** A width persisted to localStorage, clamped to [min, max]. */
export function usePersistedWidth(key: string, initial: number, min: number, max: number) {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);
  const [w, setW] = useState(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return v ? clamp(Number(v)) : initial;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(w));
  }, [key, w]);
  const nudge = useCallback((dx: number) => setW((cur) => clamp(cur + dx)), [clamp]);
  const reset = useCallback(() => setW(initial), [initial]);
  return { width: w, nudge, reset };
}

interface HandleProps {
  onResize: (dx: number) => void;
  /** +1 when dragging right grows the panel left of the divider; -1 when it grows the panel right of it. */
  dir?: 1 | -1;
  /** Double-click / Escape-style collapse of the adjacent panel. */
  onCollapse?: () => void;
  label?: string;
}

const KEY_STEP = 24;

/**
 * A draggable vertical divider. Also responds to arrow keys when focused and to a
 * double-click, which collapses the panel it borders.
 */
export function ResizeHandle({ onResize, dir = 1, onCollapse, label = 'Resize panel' }: HandleProps) {
  const last = useRef<number | null>(null);

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · double-click to collapse"
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        last.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (last.current == null) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        onResize(dx * dir);
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onDoubleClick={() => onCollapse?.()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onResize(-KEY_STEP * dir);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(KEY_STEP * dir);
        }
      }}
    >
      <span className="resize-grip" />
    </div>
  );
}
