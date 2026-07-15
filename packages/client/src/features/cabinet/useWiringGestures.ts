import { useEffect, useRef, useState } from 'react';
import type { TerminalId } from '@automationsolver/shared';
import { useCabinet } from './cabinetStore';

export interface Pt {
  x: number;
  y: number;
}

/**
 * Shared wiring interaction for both cabinet views: press a terminal and drag
 * to another to run a wire (release completes it); a plain click keeps the
 * pending wire attached to the cursor, so click-then-click also works.
 *
 * View contract: every terminal hit shape carries `data-terminal` (the
 * pointer-up hit test reads it via elementFromPoint), and the view attaches
 * `onSvgPointerMove`/`onSvgClick` to its root svg.
 */
export function useWiringGestures(
  running: boolean,
  // Ref to the element whose coordinate space wires live in — the pan/zoomed
  // inner <g>, so cursor math stays correct at any zoom. The view owns the ref
  // and passes it in (returning a ref from the hook would make
  // react-hooks/refs treat the whole result as a ref value).
  sceneRef: React.RefObject<SVGGraphicsElement | null>,
) {
  const { selectedTerminal, selectedWire, selectTerminal, selectWire, addWire, removeWire } =
    useCabinet();
  const [cursor, setCursor] = useState<Pt | null>(null);
  // Drag state for the current pointer gesture; `moved` distinguishes a drag
  // from a plain click (a click keeps the pending wire for click-click wiring).
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const onTerminalPointerDown = (t: TerminalId, e: React.PointerEvent) => {
    if (running) return;
    e.stopPropagation();
    if (selectedTerminal != null && selectedTerminal !== t) {
      addWire(selectedTerminal, t); // second click of click-click wiring
      dragRef.current = null;
      return;
    }
    selectTerminal(t);
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  // Pointer-up anywhere ends the gesture: on a terminal it completes the wire,
  // elsewhere a drag cancels while a plain click keeps the pending wire.
  useEffect(() => {
    if (selectedTerminal == null) return;
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const t = target instanceof Element ? target.getAttribute('data-terminal') : null;
      if (t && t !== selectedTerminal) addWire(selectedTerminal, t);
      else if (drag?.moved) selectTerminal(null);
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [selectedTerminal, addWire, selectTerminal]);

  // Delete/Backspace removes the selected wire; Escape cancels the pending wire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectTerminal(null);
        selectWire(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWire && !running) {
        removeWire(selectedWire);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedWire, running, removeWire, selectTerminal, selectWire]);

  const onSvgPointerMove = (e: React.MouseEvent) => {
    if (selectedTerminal == null) return;
    const ctm = sceneRef.current?.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      setCursor({ x: pt.x, y: pt.y });
    }
    const drag = dragRef.current;
    if (drag && !drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) {
      drag.moved = true;
    }
  };

  const clearSelection = () => {
    selectTerminal(null);
    selectWire(null);
  };

  // Clicking bare svg (outside any scenery) clears selections; scenery
  // backgrounds attach `clearSelection` themselves.
  const onSvgClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) clearSelection();
  };

  return {
    cursor,
    selectedTerminal,
    selectedWire,
    onTerminalPointerDown,
    onSvgPointerMove,
    onSvgClick,
    clearSelection,
  };
}

export type WiringGestures = ReturnType<typeof useWiringGestures>;
