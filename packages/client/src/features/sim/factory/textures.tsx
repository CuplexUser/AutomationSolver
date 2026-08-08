import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { DARK_STEEL } from './plant';

/**
 * Everything the plant paints into a canvas rather than fetching: the slab, the
 * flow lanes and the bay signs, plus the two components that hang them in the
 * scene.
 */

/**
 * Text in a 3D scene normally means a font file, and drei's `<Text>` would fetch
 * one from a CDN — which both the offline build and the base-relative deploy
 * rule forbid. Painting into a canvas costs one texture and no request.
 * (The same trick `Warehouse3D` uses for its rack placards.)
 */
function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = fg;
    ctx.font = 'bold 62px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#4b5462';
    ctx.fillRect(0, 0, size, size);
    const rand = mulberry32(0xfac7);
    for (let i = 0; i < 2600; i += 1) {
      const v = rand();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(rand() * size, rand() * size, 1 + v * 2, 1 + v * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 8);
  return tex;
}

/**
 * A painted transfer lane: two edge stripes with chevrons between them.
 *
 * The U-shaped floor plan means the line doubles back on itself, and without
 * something saying which way the parts go, a plant read from above is just four
 * machines in a room. The chevrons are the cheapest possible answer, they are
 * what a real floor uses, and they cost one texture.
 */
function laneTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#414a58';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, 0, w, 9);
    ctx.fillRect(0, h - 9, w, 9);
    // One chevron per tile, pointing along +u.
    ctx.strokeStyle = '#b8931f';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(38, 34);
    ctx.lineTo(90, h / 2);
    ctx.lineTo(38, h - 34);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export interface Textures {
  concrete: THREE.CanvasTexture;
  lane: THREE.CanvasTexture;
  signs: Record<string, THREE.CanvasTexture>;
}

const SIGN_TEXT = ['WELD', 'PAINT', 'ASSEMBLY', 'TEST', 'YARD'] as const;

export function buildTextures(): Textures {
  return {
    concrete: concreteTexture(),
    lane: laneTexture(),
    signs: Object.fromEntries(
      SIGN_TEXT.map((t) => [t, signTexture(t, '#1b212b', '#e8b53a')]),
    ) as Record<string, THREE.CanvasTexture>,
  };
}

export function disposeTextures(tex: Textures): void {
  tex.concrete.dispose();
  tex.lane.dispose();
  Object.values(tex.signs).forEach((t) => t.dispose());
}

/** One painted lane segment. `length` is along the local +x the chevrons point. */
export const Lane = memo(function Lane({
  tex,
  x,
  z,
  length,
  width = 2.9,
  rotY = 0,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  length: number;
  width?: number;
  rotY?: number;
}) {
  // A shared texture cannot carry a per-lane repeat, so each lane clones it.
  const own = useMemo(() => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(length / 2.6)), 1);
    return t;
  }, [tex, length]);
  useEffect(() => () => own.dispose(), [own]);
  return (
    <mesh position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, -rotY]} receiveShadow>
      <planeGeometry args={[length, width]} />
      <meshStandardMaterial map={own} roughness={0.95} metalness={0} />
    </mesh>
  );
});

/** Bay sign on a pair of posts, so each station names itself from any angle. */
export const BaySign = memo(function BaySign({
  tex,
  x,
  z,
  y = 3.5,
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
      {[-1.5, 1.5].map((dx) => (
        <mesh key={dx} position={[dx, y / 2, 0]} castShadow>
          <boxGeometry args={[0.09, y, 0.09]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
      <mesh position={[0, y, 0]}>
        <planeGeometry args={[3.2, 0.8]} />
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.7} metalness={0.1} />
      </mesh>
    </group>
  );
});
