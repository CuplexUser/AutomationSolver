import { useEffect, useRef, useState } from 'react';

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
}

interface Props {
  boxes: Box3[];
  /** Gently orbit on its own (e.g. while the machine is running). */
  spinning?: boolean;
  height?: number;
}

const PITCH = 0.62; // camera tilt (radians), fixed isometric-ish angle
const SCALE = 26; // px per model unit

// Face definitions as corner indices, with a brightness factor for cheap shading.
const FACES: { idx: [number, number, number, number]; shade: number }[] = [
  { idx: [4, 5, 6, 7], shade: 1.0 }, // top
  { idx: [0, 1, 5, 4], shade: 0.82 }, // front (+z)
  { idx: [1, 2, 6, 5], shade: 0.7 }, // right (+x)
  { idx: [3, 0, 4, 7], shade: 0.6 }, // left (-x)
  { idx: [2, 3, 7, 6], shade: 0.66 }, // back (-z)
  { idx: [0, 3, 2, 1], shade: 0.45 }, // bottom
];

function corners(b: Box3): [number, number, number][] {
  const { x, y, z, w, h, d } = b;
  return [
    [x, y, z],
    [x + w, y, z],
    [x + w, y, z + d],
    [x, y, z + d],
    [x, y + h, z],
    [x + w, y + h, z],
    [x + w, y + h, z + d],
    [x, y + h, z + d],
  ];
}

/** Rotate about the vertical (y) axis by yaw, tilt by fixed pitch, project. */
function project(p: [number, number, number], yaw: number): { sx: number; sy: number; depth: number } {
  const [x, y, z] = p;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = x * cy + z * sy;
  const rz = -x * sy + z * cy;
  const cp = Math.cos(PITCH);
  const sp = Math.sin(PITCH);
  const py = y * cp - rz * sp;
  const pz = y * sp + rz * cp;
  return { sx: rx * SCALE, sy: -py * SCALE, depth: pz };
}

function shadeColor(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

export function Machine3D({ boxes, spinning = false, height = 300 }: Props) {
  const [yaw, setYaw] = useState(-0.7);
  const drag = useRef<{ x: number; startYaw: number } | null>(null);

  // Idle orbit while running (unless the user is dragging).
  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (!drag.current) setYaw((y) => y + dt * 0.00025);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, startYaw: yaw };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setYaw(drag.current.startYaw + (e.clientX - drag.current.x) * 0.01);
  };
  const onUp = () => {
    drag.current = null;
  };

  // Collect every face, project, sort far→near (painter's algorithm).
  const polys = boxes
    .flatMap((box) => {
      const pts = corners(box).map((c) => project(c, yaw));
      return FACES.map((f) => {
        const quad = f.idx.map((i) => pts[i]);
        const depth = quad.reduce((s, p) => s + p.depth, 0) / 4;
        return {
          points: quad.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' '),
          fill: box.glow ? box.color : shadeColor(box.color, f.shade),
          glow: box.glow,
          depth,
        };
      });
    })
    .sort((a, b) => a.depth - b.depth);

  return (
    <div
      className={`machine3d${spinning ? ' running' : ''}`}
      style={{ height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg viewBox="-230 -210 460 360" width="100%" height="100%" role="img" aria-label="Machine view">
        <defs>
          <filter id="m3d-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {polys.map((p, i) => (
          <polygon
            key={i}
            points={p.points}
            fill={p.fill}
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={0.5}
            strokeLinejoin="round"
            filter={p.glow ? 'url(#m3d-glow)' : undefined}
          />
        ))}
      </svg>
      <span className="machine3d-hint">drag to rotate</span>
    </div>
  );
}
