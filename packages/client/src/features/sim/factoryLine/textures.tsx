import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Everything the plant paints into a canvas rather than fetching.
 *
 * Text in a 3D scene normally means a font file, and drei's `<Text>` would fetch
 * one from a CDN — which both the offline build and the base-relative deploy
 * rule forbid. Painting into a canvas costs one texture and no request.
 *
 * The vocabulary here is most of what makes the reference plant readable: hazard
 * chevron on everything that can hurt you, white markings on the floor telling
 * you where to walk and where not to stand, and a stencilled tag on every
 * machine. None of it is detail for its own sake — a shop floor is a place that
 * has been *labelled*, and a plant without any of that reads as furniture on a
 * slab.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** Deterministic speckle, so the slab looks poured rather than painted. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function concreteTexture(): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size, size);
  if (ctx) {
    ctx.fillStyle = '#333b45';
    ctx.fillRect(0, 0, size, size);
    const rand = mulberry32(0xfac7);
    for (let i = 0; i < 2800; i += 1) {
      const v = rand();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      ctx.fillRect(rand() * size, rand() * size, 1 + v * 2, 1 + v * 2);
    }
    // Saw cuts, on the 5 m grid a real slab is poured in.
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.stroke();
  }
  return finish(c, 11, 7.6);
}

/**
 * Hazard chevron, the yellow-and-black every machine edge in the reference wears.
 *
 * Drawn as one tile of diagonal bars and repeated along whatever it is wrapped
 * around, which is exactly how the real tape comes off the roll.
 */
function hazardTexture(): THREE.CanvasTexture {
  const size = 64;
  const [c, ctx] = canvas(size, size);
  if (ctx) {
    ctx.fillStyle = '#f2c318';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#17191c';
    ctx.lineWidth = 17;
    ctx.beginPath();
    for (let i = -2; i < 4; i += 1) {
      ctx.moveTo(i * size * 0.5 - size * 0.5, size * 1.5);
      ctx.lineTo(i * size * 0.5 + size * 0.5, -size * 0.5);
    }
    ctx.stroke();
  }
  return finish(c);
}

/**
 * A pedestrian walkway: solid edge lines with a dashed centre.
 *
 * The aisle is the one place in the building you can see both halves of the line
 * at once, and painting it is what makes it read as somewhere to stand rather
 * than as a gap between machines.
 */
function walkwayTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  if (ctx) {
    ctx.fillStyle = '#2b323b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e6ebf0';
    ctx.fillRect(0, 4, w, 5);
    ctx.fillRect(0, h - 9, w, 5);
    ctx.fillStyle = 'rgba(230,235,240,0.55)';
    ctx.fillRect(10, h / 2 - 2, 44, 4);
  }
  return finish(c);
}

/** A conveyor deck: rollers across the run, seen from above. */
function rollerTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 64;
  const [c, ctx] = canvas(w, h);
  if (ctx) {
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i += 1) {
      const y = i * 16;
      const g = ctx.createLinearGradient(0, y, 0, y + 14);
      g.addColorStop(0, '#8d97a3');
      g.addColorStop(0.45, '#b9c2cc');
      g.addColorStop(1, '#6d7783');
      ctx.fillStyle = g;
      ctx.fillRect(0, y + 1, w, 13);
    }
  }
  return finish(c);
}

/** Woven mesh, for the guard fencing. Transparent where the holes are. */
function meshTexture(): THREE.CanvasTexture {
  const size = 64;
  const [c, ctx] = canvas(size, size);
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(190,201,212,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
      const p = i * 16;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Stencilled text on the floor or a machine flank: tag numbers, bay names. */
function stencilTexture(text: string, opts: { fg?: string; size?: number } = {}): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.fg ?? 'rgba(226,233,240,0.82)';
    ctx.font = `700 ${opts.size ?? 84}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '10px';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A bay sign: the plate that names a cell from across the shop. */
function signTexture(text: string): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  if (ctx) {
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e8b53a';
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#e8b53a';
    ctx.font = 'bold 60px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '6px';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** An HMI screen face: the cyan-lit panel every cell in the reference carries. */
function hmiTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 96;
  const [c, ctx] = canvas(w, h);
  if (ctx) {
    ctx.fillStyle = '#0a1a22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7fe3f5';
    ctx.fillRect(8, 8, 60, 6);
    ctx.fillStyle = 'rgba(127,227,245,0.5)';
    for (let i = 0; i < 5; i += 1) ctx.fillRect(8, 24 + i * 11, 40 + ((i * 29) % 60), 5);
    ctx.fillStyle = '#37d67a';
    ctx.fillRect(w - 26, 8, 16, 16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const CELL_TAGS = {
  WELD: 'WLD-1010',
  STORE: 'STR-2010',
  BOOTH: 'PNT-4020',
  OVEN: 'PNT-4040',
  ASSEMBLY: 'ASY-5010',
  TEST: 'TST-6010',
  DOCK: 'DSP-6030',
  YARD: 'DSP-6050',
} as const;

const SIGN_TEXT = [
  'WELD',
  'RACK STORE',
  'PAINT',
  'CURE OVEN',
  'ASSEMBLY',
  'TEST',
  'DOCK',
  'YARD',
] as const;

export interface LineTextures {
  concrete: THREE.CanvasTexture;
  hazard: THREE.CanvasTexture;
  walkway: THREE.CanvasTexture;
  roller: THREE.CanvasTexture;
  mesh: THREE.CanvasTexture;
  hmi: THREE.CanvasTexture;
  signs: Record<string, THREE.CanvasTexture>;
  tags: Record<string, THREE.CanvasTexture>;
  yardBays: THREE.CanvasTexture[];
  drumNums: THREE.CanvasTexture[];
}

export function buildLineTextures(): LineTextures {
  return {
    concrete: concreteTexture(),
    hazard: hazardTexture(),
    walkway: walkwayTexture(),
    roller: rollerTexture(),
    mesh: meshTexture(),
    hmi: hmiTexture(),
    signs: Object.fromEntries(SIGN_TEXT.map((t) => [t, signTexture(t)])),
    tags: Object.fromEntries(
      Object.entries(CELL_TAGS).map(([k, v]) => [k, stencilTexture(v, { size: 62 })]),
    ),
    yardBays: [1, 2, 3, 4, 5, 6].map((n) => stencilTexture(`YARD ${n}`, { size: 58 })),
    drumNums: [1, 2, 3, 4].map((n) => stencilTexture(String(n), { size: 96 })),
  };
}

export function disposeLineTextures(t: LineTextures): void {
  t.concrete.dispose();
  t.hazard.dispose();
  t.walkway.dispose();
  t.roller.dispose();
  t.mesh.dispose();
  t.hmi.dispose();
  for (const s of Object.values(t.signs)) s.dispose();
  for (const s of Object.values(t.tags)) s.dispose();
  for (const s of t.yardBays) s.dispose();
  for (const s of t.drumNums) s.dispose();
}

/**
 * A band of hazard tape wrapped round the base of something.
 *
 * Four faces rather than a box so the chevrons run *along* each side instead of
 * being stretched across the ends, which is what a wrap looks like and what a
 * stretched box does not.
 */
export const HazardBand = memo(function HazardBand({
  tex,
  x,
  z,
  w,
  d,
  y = 0.18,
  h = 0.36,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  w: number;
  d: number;
  y?: number;
  h?: number;
}) {
  const faces: Array<{ pos: [number, number, number]; rot: number; len: number }> = [
    { pos: [x, y, z + d / 2], rot: 0, len: w },
    { pos: [x, y, z - d / 2], rot: Math.PI, len: w },
    { pos: [x + w / 2, y, z], rot: Math.PI / 2, len: d },
    { pos: [x - w / 2, y, z], rot: -Math.PI / 2, len: d },
  ];
  return (
    <group>
      {faces.map((f, i) => (
        <HazardFace key={i} tex={tex} pos={f.pos} rot={f.rot} len={f.len} h={h} />
      ))}
    </group>
  );
});

function HazardFace({
  tex,
  pos,
  rot,
  len,
  h,
}: {
  tex: THREE.CanvasTexture;
  pos: [number, number, number];
  rot: number;
  len: number;
  h: number;
}) {
  // A shared texture cannot carry a per-face repeat, so each face clones it.
  const own = useMemo(() => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(len / 0.55)), 1);
    return t;
  }, [tex, len]);
  useEffect(() => () => own.dispose(), [own]);
  return (
    <mesh position={pos} rotation={[0, rot, 0]}>
      <planeGeometry args={[len, h]} />
      <meshStandardMaterial map={own} roughness={0.75} metalness={0.05} />
    </mesh>
  );
}

/** A painted marking laid flat on the slab: walkway, keep-clear, bay outline. */
export const FloorMark = memo(function FloorMark({
  tex,
  x,
  z,
  w,
  d,
  rotY = 0,
  repeat,
  opacity = 1,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  w: number;
  d: number;
  rotY?: number;
  repeat?: [number, number];
  opacity?: number;
}) {
  const own = useMemo(() => {
    const t = tex.clone();
    t.needsUpdate = true;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  }, [tex, repeat]);
  useEffect(() => () => own.dispose(), [own]);
  return (
    <mesh position={[x, 0.014, z]} rotation={[-Math.PI / 2, 0, rotY]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial
        map={own}
        roughness={0.94}
        metalness={0}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
});

/** Stencilled text lying on the floor, e.g. a cell's tag beside its door. */
export const FloorText = memo(function FloorText({
  tex,
  x,
  z,
  w = 3.6,
  rotY = 0,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  w?: number;
  rotY?: number;
}) {
  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, rotY]}>
      <planeGeometry args={[w, w / 4]} />
      <meshStandardMaterial map={tex} transparent roughness={0.95} metalness={0} />
    </mesh>
  );
});

/** A bay sign on two posts, so a cell names itself from across the floor. */
export const BaySign = memo(function BaySign({
  tex,
  x,
  z,
  y = 4.6,
  rotY = 0,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  y?: number;
  rotY?: number;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      {[-1.7, 1.7].map((dx) => (
        <mesh key={dx} position={[dx, y / 2, 0]} castShadow>
          <boxGeometry args={[0.09, y, 0.09]} />
          <meshStandardMaterial color="#3f4a57" metalness={0.6} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[0, y, 0]}>
        <planeGeometry args={[3.6, 0.9]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.7} metalness={0.1} />
      </mesh>
    </group>
  );
});
