import { useCallback, useState } from 'react';

/**
 * Which floating windows are open, and which one is on top.
 *
 * Geometry lives in the window itself (each persists its own box); this hook
 * only owns membership, stacking and focus — the three things a window cannot
 * decide about itself. Focus matters beyond appearance here: the ladder editor
 * binds a global keydown listener, so exactly one open POU window may own the
 * keyboard or a single press of `C` places a contact in every section at once.
 */
export interface WindowStack {
  open: string[];
  /** Topmost / keyboard-owning window, or null when the workspace itself has focus. */
  focused: string | null;
  isOpen: (id: string) => boolean;
  /** Open (or raise, if already open) a window. */
  show: (id: string) => void;
  close: (id: string) => void;
  toggle: (id: string) => void;
  focus: (id: string) => void;
  closeAll: () => void;
  /** Stacking order, lowest first — the index is the window's z-position. */
  depth: (id: string) => number;
  /** Collapsed to a tab rather than closed — still `open`, but not drawn as a window. */
  isMinimized: (id: string) => boolean;
  minimize: (id: string) => void;
  /** Un-collapse and raise/focus it, the same as opening it fresh. */
  restore: (id: string) => void;
}

export function useWindows(initial: string[] = []): WindowStack {
  // The array *is* the z-order: last is topmost. Small enough that splicing is
  // cheaper to read than a map of indices that has to be kept consistent.
  const [open, setOpen] = useState<string[]>(initial);
  const [focused, setFocused] = useState<string | null>(initial.at(-1) ?? null);
  // Membership only — geometry (and everything else about *how* a minimized
  // window would redraw) stays owned by the window itself, same as always.
  const [minimized, setMinimized] = useState<ReadonlySet<string>>(new Set());

  const raise = useCallback((ids: string[], id: string) => [...ids.filter((x) => x !== id), id], []);
  const unminimize = useCallback((id: string) => {
    setMinimized((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  const show = useCallback(
    (id: string) => {
      setOpen((ids) => raise(ids, id));
      setFocused(id);
      unminimize(id);
    },
    [raise, unminimize],
  );

  const close = useCallback((id: string) => {
    setOpen((ids) => {
      const next = ids.filter((x) => x !== id);
      // Focus falls to whatever is now on top, so the keyboard is never left
      // pointing at a window that is no longer there.
      setFocused(next.at(-1) ?? null);
      return next;
    });
    unminimize(id);
  }, [unminimize]);

  const toggle = useCallback(
    (id: string) => {
      setOpen((ids) => {
        if (ids.includes(id)) {
          const next = ids.filter((x) => x !== id);
          setFocused(next.at(-1) ?? null);
          return next;
        }
        setFocused(id);
        return [...ids, id];
      });
      unminimize(id);
    },
    [unminimize],
  );

  const focus = useCallback(
    (id: string) => {
      setOpen((ids) => (ids.includes(id) ? raise(ids, id) : ids));
      setFocused(id);
    },
    [raise],
  );

  const closeAll = useCallback(() => {
    setOpen([]);
    setFocused(null);
    setMinimized(new Set());
  }, []);

  const minimize = useCallback((id: string) => {
    setMinimized((s) => new Set(s).add(id));
    // A minimized window is not drawn, so it cannot hold the keyboard either.
    setFocused((f) => (f === id ? null : f));
  }, []);

  const restore = useCallback(
    (id: string) => {
      unminimize(id);
      setOpen((ids) => raise(ids, id));
      setFocused(id);
    },
    [raise, unminimize],
  );

  return {
    open,
    focused,
    isOpen: (id) => open.includes(id),
    show,
    close,
    toggle,
    focus,
    closeAll,
    isMinimized: (id) => minimized.has(id),
    minimize,
    restore,
    depth: (id) => open.indexOf(id),
  };
}
