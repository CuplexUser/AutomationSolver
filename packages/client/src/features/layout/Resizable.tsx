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
  return { width: w, nudge };
}

/**
 * A draggable vertical divider. `dir` is +1 when dragging right should grow the
 * panel to the divider's left, -1 when it should grow the panel to its right.
 */
export function ResizeHandle({ onResize, dir = 1 }: { onResize: (dx: number) => void; dir?: 1 | -1 }) {
  const last = useRef<number | null>(null);
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
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
    >
      <span className="resize-grip" />
    </div>
  );
}
