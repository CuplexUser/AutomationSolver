import { useCallback, useEffect, useRef, useState } from 'react';

/** An axis-aligned box in model space (min corner + size). */
export interface Box3 {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  /** Draw with an energized glow. */
  glow?: boolean;
  /** Draw semi-transparent (e.g. a bore in a part). */
  opacity?: number;
}

interface Props {
  boxes: Box3[];
  height?: number;
}

const PITCH = 0.58; // camera tilt (radians), fixed
const DEFAULT_SCALE = 30; // px per model unit
const MIN_SCALE = 14;
const MAX_SCALE = 70;

type Vec3 = [number, number, number];
type Axis = 0 | 1 | 2;

/**
 * The six faces of a box, named by the axis they are perpendicular to and which side
 * of the box they sit on. Both the geometry and the outward normal are derived from
 * (axis, side), so they cannot drift apart — hand-written corner lists and normals can,
 * and when they do the back-face culler hides exactly the faces it should be drawing.
 */
const FACES: { axis: Axis; side: 1 | -1; shade: number }[] = [
  { axis: 1, side: 1, shade: 1.0 }, // top
  { axis: 1, side: -1, shade: 0.45 }, // bottom
  { axis: 2, side: 1, shade: 0.82 }, // front (+z)
  { axis: 2, side: -1, shade: 0.66 }, // back (-z)
  { axis: 0, side: 1, shade: 0.7 }, // right (+x)
  { axis: 0, side: -1, shade: 0.6 }, // left (-x)
];

const lo = (b: Box3): Vec3 => [b.x, b.y, b.z];
const hi = (b: Box3): Vec3 => [b.x + b.w, b.y + b.h, b.z + b.d];

/** The four corners of one face, wound so the quad never self-intersects. */
function faceCorners(b: Box3, axis: Axis, side: 1 | -1): Vec3[] {
  const l = lo(b);
  const h = hi(b);
  const fixed = side > 0 ? h[axis] : l[axis];
  const u = ((axis + 1) % 3) as Axis;
  const v = ((axis + 2) % 3) as Axis;
  const at = (uu: number, vv: number): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    p[axis] = fixed;
    p[u] = uu;
    p[v] = vv;
    return p;
  };
  return [at(l[u], l[v]), at(h[u], l[v]), at(h[u], h[v]), at(l[u], h[v])];
}

function normalOf(axis: Axis, side: 1 | -1): Vec3 {
  const n: Vec3 = [0, 0, 0];
  n[axis] = side;
  return n;
}

/**
 * View direction: points from the scene toward the camera. A point's depth is its dot
 * product with this vector — larger means nearer.
 */
function viewDir(yaw: number): Vec3 {
  const cp = Math.cos(PITCH);
  return [-Math.sin(yaw) * cp, Math.sin(PITCH), Math.cos(yaw) * cp];
}

/** Rotate about the vertical axis by yaw, tilt by the fixed pitch, project orthographically. */
function project(p: Vec3, yaw: number, scale: number): { sx: number; sy: number } {
  const [x, y, z] = p;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = x * cy + z * sy;
  const rz = -x * sy + z * cy;
  const py = y * Math.cos(PITCH) - rz * Math.sin(PITCH);
  return { sx: rx * scale, sy: -py * scale };
}

function shadeColor(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * factor);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/**
 * Painter's-algorithm ordering for non-intersecting axis-aligned boxes.
 *
 * Sorting by centroid depth is wrong for a scene with one big flat box (the machine
 * bed): the bed's centroid can be nearer than a small part standing on it but behind it
 * in z, so the bed paints over the part. Instead, if two boxes are separated along any
 * world axis, the plane between them is a separating plane and the box on the camera's
 * side of it can never be occluded by the other. That test is exact. Boxes that overlap
 * on every axis (they interpenetrate) fall back to centroid depth.
 */
function order(boxes: Box3[], yaw: number): number[] {
  const g = viewDir(yaw);
  const centerDepth = (b: Box3) =>
    (b.x + b.w / 2) * g[0] + (b.y + b.h / 2) * g[1] + (b.z + b.d / 2) * g[2];

  /** < 0 when a must be painted before b (a is behind b). */
  const cmp = (a: Box3, b: Box3): number => {
    const aLo = lo(a);
    const aHi = hi(a);
    const bLo = lo(b);
    const bHi = hi(b);
    for (let ax = 0; ax < 3; ax++) {
      if (g[ax] === 0) continue;
      if (aHi[ax] <= bLo[ax]) return g[ax] > 0 ? -1 : 1;
      if (bHi[ax] <= aLo[ax]) return g[ax] > 0 ? 1 : -1;
    }
    return centerDepth(a) - centerDepth(b);
  };

  // Insertion sort: the comparator is a partial order, so this keeps the conclusive
  // comparisons and leaves ambiguous pairs in their original order.
  const idx = boxes.map((_, i) => i);
  for (let i = 1; i < idx.length; i++) {
    const cur = idx[i];
    let j = i - 1;
    while (j >= 0 && cmp(boxes[idx[j]], boxes[cur]) > 0) {
      idx[j + 1] = idx[j];
      j--;
    }
    idx[j + 1] = cur;
  }
  return idx;
}

export function Machine3D({ boxes, height = 300 }: Props) {
  const [yaw, setYaw] = useState(-0.7);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const drag = useRef<{ x: number; startYaw: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  }, []);

  // React attaches onWheel passively, so preventDefault there is ignored and the HMI
  // column scrolls instead. Bind it ourselves.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const g = viewDir(yaw);
  const faces = order(boxes, yaw).flatMap((bi) => {
    const box = boxes[bi];
    return FACES.filter((f) => {
      const n = normalOf(f.axis, f.side);
      return n[0] * g[0] + n[1] * g[1] + n[2] * g[2] > 0; // cull faces pointing away
    }).map((f) => ({
      key: `${bi}:${f.axis}${f.side}`,
      points: faceCorners(box, f.axis, f.side)
        .map((c) => project(c, yaw, scale))
        .map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`)
        .join(' '),
      fill: box.glow ? box.color : shadeColor(box.color, f.shade),
      opacity: box.opacity,
      glow: box.glow,
    }));
  });

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, startYaw: yaw };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setYaw(drag.current.startYaw + (e.clientX - drag.current.x) * 0.008);
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="machine3d"
      ref={hostRef}
      style={{ height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg viewBox="-240 -230 480 380" width="100%" height="100%" role="img" aria-label="Machine view">
        <defs>
          <filter id="m3d-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {faces.map((f) => (
          <polygon
            key={f.key}
            points={f.points}
            fill={f.fill}
            fillOpacity={f.opacity}
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={0.6}
            strokeLinejoin="round"
            filter={f.glow ? 'url(#m3d-glow)' : undefined}
          />
        ))}
      </svg>

      <div className="machine3d-zoom">
        <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
          −
        </button>
        <button className="icon-btn" onClick={() => setScale(DEFAULT_SCALE)} title="Reset zoom">
          ⌂
        </button>
        <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
      </div>
      <span className="machine3d-hint">drag to rotate · scroll to zoom</span>
    </div>
  );
}
