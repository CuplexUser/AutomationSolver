import { useEffect, useRef, useState } from 'react';
import type { Pt } from './useWiringGestures';

export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

const K_MIN = 1;
const K_MAX = 6;
const IDENTITY: ViewTransform = { k: 1, x: 0, y: 0 };

/** Zoom toward `p` (in outer svg/viewBox coordinates) by factor `f`. */
function zoomAt(t: ViewTransform, f: number, p: Pt): ViewTransform {
  const k = Math.min(K_MAX, Math.max(K_MIN, t.k * f));
  if (k === 1) return IDENTITY; // snap back to the fitted view
  return { k, x: p.x - ((p.x - t.x) * k) / t.k, y: p.y - ((p.y - t.y) * k) / t.k };
}

/**
 * Wheel-zoom (toward the cursor) and drag-to-pan for a cabinet view. The view
 * wraps its content in `<g transform={transformOf(t)}>`; wiring gestures keep
 * working because their hit tests are screen-based and their cursor math reads
 * the inner group's CTM.
 */
export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>) {
  const [t, setT] = useState<ViewTransform>(IDENTITY);
  const panRef = useRef<{ clientX: number; clientY: number; t0: ViewTransform } | null>(null);

  // Wheel needs a non-passive listener: React's synthetic onWheel can't
  // preventDefault, and the page would scroll while zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      setT((cur) => zoomAt(cur, Math.exp(-e.deltaY * 0.0015), p));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef]);

  useEffect(() => {
    const onUp = () => {
      panRef.current = null;
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  /** Start panning unless the press begins a wiring or UI gesture. */
  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (t.k === 1) return;
    const el = e.target as Element;
    if (el.closest('[data-terminal], .cab-wire-hit, .cab-wire-delete, .cab-zoom')) return;
    panRef.current = { clientX: e.clientX, clientY: e.clientY, t0: t };
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const inv = svg.getScreenCTM()?.inverse();
    if (!inv) return;
    // Uniform scale: client-pixel deltas map to viewBox units via the CTM.
    setT({
      k: pan.t0.k,
      x: pan.t0.x + (e.clientX - pan.clientX) * inv.a,
      y: pan.t0.y + (e.clientY - pan.clientY) * inv.a,
    });
  };

  const zoomStep = (f: number) => {
    const vb = svgRef.current?.viewBox.baseVal;
    if (!vb) return;
    setT((cur) => zoomAt(cur, f, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 }));
  };

  return {
    t,
    transform: `translate(${t.x} ${t.y}) scale(${t.k})`,
    onSvgPointerDown,
    onSvgPointerMove,
    zoomIn: () => zoomStep(1.4),
    zoomOut: () => zoomStep(1 / 1.4),
    reset: () => setT(IDENTITY),
  };
}

export type PanZoom = ReturnType<typeof usePanZoom>;

/** Corner buttons: + / − / fit. Rendered in outer (untransformed) coords. */
export function ZoomControls({ pz, x, y }: { pz: PanZoom; x: number; y: number }) {
  const btn = (dy: number, glyph: string, title: string, onClick: () => void) => (
    <g
      transform={`translate(0, ${dy})`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <rect x={-11} y={-11} width={22} height={22} rx={5} />
      <text y={4.5}>{glyph}</text>
      <title>{title}</title>
    </g>
  );
  return (
    <g className="cab-zoom" transform={`translate(${x}, ${y})`}>
      {btn(0, '+', 'Zoom in (or mouse wheel)', pz.zoomIn)}
      {btn(26, '−', 'Zoom out', pz.zoomOut)}
      {btn(52, '⌂', 'Fit view', pz.reset)}
    </g>
  );
}
