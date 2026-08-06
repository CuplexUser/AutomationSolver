import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { GOODS_IN_QUEUE, WAREHOUSE_SLOTS, slotRegister } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

/**
 * Aisle 1 of the automated warehouse, built procedurally rather than from a
 * glTF — the `TankVessel3D` precedent, for the same reason.
 *
 * What a player needs to read off this picture is *where the stock is*: which
 * slot holds which material, which slots are free, and where the crane stands
 * relative to both. So the racking carries the WMS register name on every slot
 * placard, and a material is told apart by the shape of its unit load as well as
 * by its color — plate is not drums, and neither is a pallet of sacks. Color
 * alone would put the whole reading on one channel.
 *
 * Everything here is a pure function of the `warehouse` process's machine state,
 * re-derived on each render. Nothing animates on its own, so replay scrubbing
 * shows exactly what the live run showed.
 *
 * The plant is far more geometry than the other procedural scene, and the sim
 * re-renders it 20 times a second, so anything that does not move is behind a
 * `memo` with scalar props. Only the crane, the lamps and the pallets that
 * actually changed are reconciled on a tick.
 */

/** Meters between aisle positions, and the two carriage heights. */
const SPAN = 2.1;
const POS_MAX = 5;
const LEVEL_Y = [0, 0.95, 2.45] as const;

/** Rack face: how far the slot centers sit from the crane's center line. */
const RACK_Z = 1.55;
/** Half the rack's depth — the uprights stand at `RACK_Z` +/- this. */
const RACK_HALF_D = 0.5;

/**
 * Pallet geometry, measured from the load's center (which is what `levelY`
 * returns, and where a slot's contents are drawn).
 */
const PALLET_W = 1.2;
const PALLET_D = 1.0;
const LOAD_H = 0.5;
const DECK_H = 0.13;
/** Underside of the pallet, relative to the load center: what a beam holds up. */
const PALLET_BASE = -LOAD_H / 2 - DECK_H;

const BEAM_H = 0.12;
const UPRIGHT_W = 0.13;
const RACK_TOP = 3.45;

/**
 * Twin mast: the load rides *between* the columns, as on a real stacker crane.
 * The top rail sits just clear of the rack, the way it does on a real machine —
 * carried higher it opens a band of empty air across the middle of the picture.
 */
const MAST_X = 0.88;
const MAST_TOP = 3.95;
const TOP_RAIL_Y = 4.15;
const RAIL_TOP = 0.22;

/** Pitch of the pallets queued on a station's roller deck. */
const QUEUE_PITCH = 1.16;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;

/**
 * One color per material code, so a slot's contents are legible at a glance and
 * a mis-delivery is visible as a wrong-colored pallet arriving at a station.
 * Index 0 is "empty" and never drawn.
 */
const MATERIAL_COLOR = ['#334155', '#38bdf8', '#fbbf24', '#4ade80', '#c084fc'] as const;

const STEEL = { color: '#8b95a3', metalness: 0.8, roughness: 0.42 };
const DARK_STEEL = { color: '#4b5563', metalness: 0.7, roughness: 0.5 };
/**
 * The crane's structure. Deliberately less metallic than `STEEL`: a mast column
 * is a thin box, and at high metalness it mirrors the environment so evenly
 * that it reads as glass rather than as the heaviest thing in the aisle.
 */
const CRANE_PAINT = { color: '#6b7686', metalness: 0.35, roughness: 0.55 };
/** Classic racking livery: blue uprights, orange beams. */
const UPRIGHT_PAINT = { color: '#1d4ed8', metalness: 0.3, roughness: 0.6 };
const BEAM_PAINT = { color: '#ea7317', metalness: 0.3, roughness: 0.58 };
const TIMBER = { color: '#b07a3c', roughness: 0.85, metalness: 0 };

const posX = (p: number) => p * SPAN;
const levelY = (l: number) => LEVEL_Y[1] + (l - 1) * (LEVEL_Y[2] - LEVEL_Y[1]);
/** Top of the beam pair — and of a station's roller deck — at a given level. */
const deckY = (l: number) => levelY(l) + PALLET_BASE;
/** Where a station's roller deck starts and ends, in z. */
const stationNear = RACK_Z - 0.62;
const stationFar = (capacity: number) => RACK_Z + (capacity - 1) * QUEUE_PITCH + 0.62;

/**
 * `code` 0 draws nothing. `NEUTRAL` draws a shrink-wrapped load in slate: a
 * pallet already accepted onto a line's conveyor, whose material the machine
 * stops tracking once the line has taken it.
 */
const NEUTRAL = -1;

// --- Canvas signage ---------------------------------------------------------

/**
 * Text in a 3D scene normally means a font file; drei's `<Text>` would fetch one
 * from a CDN, which both the offline build and the base-relative deploy rule
 * forbid. Painting the label into a canvas costs one texture and no request.
 */
function signTexture(text: string, bg: string, fg: string, wide = false): THREE.CanvasTexture {
  const w = wide ? 512 : 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = fg;
    ctx.font = `bold ${wide ? 62 : 72}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Deterministic speckle, so the floor looks poured rather than painted. */
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
    ctx.fillStyle = '#3b4250';
    ctx.fillRect(0, 0, size, size);
    const rand = mulberry32(0x5eed);
    for (let i = 0; i < 2200; i += 1) {
      const v = rand();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.075)';
      ctx.fillRect(rand() * size, rand() * size, 1 + v * 2, 1 + v * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 5);
  return tex;
}

/** Profiled steel cladding for the far wall: vertical ribs, one draw call. */
function claddingTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Deliberately dim: the wall is depth, not subject. Lit any brighter it
    // competes with the racking for the eye.
    const grad = ctx.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, '#232a34');
    grad.addColorStop(0.45, '#2e3743');
    grad.addColorStop(0.55, '#37414e');
    grad.addColorStop(1, '#1e242d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 1);
  return tex;
}

interface Textures {
  concrete: THREE.CanvasTexture;
  cladding: THREE.CanvasTexture;
  /** Keyed by the sign's text, since the text is what makes each one different. */
  signs: Record<string, THREE.CanvasTexture>;
}

function useTextures(): Textures {
  const textures = useMemo<Textures>(() => {
    const signs: Record<string, THREE.CanvasTexture> = {};
    // Light plate, dark text — the way a real location placard is printed, and
    // the only way a label this small stays readable when it falls into shade.
    for (const slot of WAREHOUSE_SLOTS) {
      const reg = slotRegister(slot.bay, slot.level);
      signs[reg] = signTexture(reg, '#e8edf4', '#0f172a');
    }
    for (const name of ['LINE A', 'LINE B', 'GOODS IN']) {
      signs[name] = signTexture(name, '#facc15', '#1c1917', true);
    }
    return { concrete: concreteTexture(), cladding: claddingTexture(), signs };
  }, []);

  useEffect(
    () => () => {
      textures.concrete.dispose();
      textures.cladding.dispose();
      for (const tex of Object.values(textures.signs)) tex.dispose();
    },
    [textures],
  );

  return textures;
}

function Sign({
  map,
  position,
  width,
  height = 0.3,
}: {
  map?: THREE.Texture;
  position: [number, number, number];
  width: number;
  height?: number;
}) {
  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={map} roughness={0.65} metalness={0.05} />
    </mesh>
  );
}

// --- Unit loads -------------------------------------------------------------

/**
 * The load on a pallet, shaped by what it is made of.
 *
 * Steel comes as banded plate, brass as drums, nylon as sacks and alloy as a
 * bundle of bar. It costs a handful of boxes, and it means a mis-delivery is
 * visible from across the room and not only to a player who has memorized which
 * color is which.
 */
function Load({ code }: { code: number }) {
  const color = code === NEUTRAL ? '#94a3b8' : (MATERIAL_COLOR[code] ?? MATERIAL_COLOR[0]);
  const mat = { color, roughness: 0.55, metalness: code === 1 || code === 4 ? 0.55 : 0.12 };

  if (code === 1) {
    // Plate: two banded stacks, low and heavy.
    return (
      <group>
        {[-0.13, 0.13].map((dy) => (
          <mesh key={dy} position={[0, dy, 0]} castShadow receiveShadow>
            <boxGeometry args={[PALLET_W - 0.08, 0.22, PALLET_D - 0.1]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        ))}
        {[-0.3, 0.3].map((dx) => (
          <mesh key={dx} position={[dx, 0, 0]}>
            <boxGeometry args={[0.05, 0.52, PALLET_D - 0.06]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
      </group>
    );
  }

  if (code === 2) {
    // Drums, four to a pallet.
    return (
      <group>
        {[
          [-0.26, -0.24],
          [0.26, -0.24],
          [-0.26, 0.24],
          [0.26, 0.24],
        ].map(([dx, dz]) => (
          <mesh key={`${dx},${dz}`} position={[dx, 0, dz]} castShadow receiveShadow>
            <cylinderGeometry args={[0.24, 0.24, LOAD_H, 16]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        ))}
      </group>
    );
  }

  if (code === 3) {
    // Sacks: slumped, so the silhouette is unmistakably soft goods.
    return (
      <group>
        {[
          [-0.28, -0.2, 0.1],
          [0.28, -0.2, -0.12],
          [0, 0.16, 0.05],
        ].map(([dx, dz, rot], i) => (
          <mesh
            key={i}
            position={[dx, i === 2 ? 0.12 : -0.1, dz]}
            rotation={[0, rot, 0]}
            scale={[1, 0.55, 1]}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[0.34, 14, 10]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        ))}
      </group>
    );
  }

  if (code === 4) {
    // Bar stock, run the length of the pallet.
    return (
      <group>
        {[
          [-0.1, -0.3],
          [-0.1, -0.1],
          [-0.1, 0.1],
          [-0.1, 0.3],
          [0.08, -0.2],
          [0.08, 0],
          [0.08, 0.2],
        ].map(([dy, dz]) => (
          <mesh
            key={`${dy},${dz}`}
            position={[0, dy, dz]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.1, 0.1, PALLET_W - 0.06, 10]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        ))}
      </group>
    );
  }

  // NEUTRAL, and any unknown code: a plain wrapped unit load.
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[PALLET_W - 0.1, LOAD_H, PALLET_D - 0.1]} />
      <meshStandardMaterial {...mat} transparent opacity={0.92} />
    </mesh>
  );
}

/**
 * A stringer pallet: three top boards, three blocks and a bottom board.
 *
 * Scalar position rather than a tuple so the memo actually holds — a fresh
 * `[x, y, z]` array every render would defeat it, and eight of these sit
 * perfectly still while the crane works.
 */
const Pallet = memo(function Pallet({
  code,
  x,
  y,
  z,
}: {
  code: number;
  x: number;
  y: number;
  z: number;
}) {
  if (code === 0) return null;
  const deckTop = -LOAD_H / 2;
  return (
    <group position={[x, y, z]}>
      <Load code={code} />
      {[-0.42, 0, 0.42].map((dz) => (
        <mesh key={dz} position={[0, deckTop - 0.02, dz]} castShadow receiveShadow>
          <boxGeometry args={[PALLET_W, 0.035, 0.22]} />
          <meshStandardMaterial {...TIMBER} />
        </mesh>
      ))}
      {[-0.44, 0, 0.44].map((dx) => (
        <mesh key={dx} position={[dx, deckTop - 0.075, 0]} castShadow>
          <boxGeometry args={[0.19, 0.08, PALLET_D]} />
          <meshStandardMaterial color="#8f6330" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, deckTop - 0.115, 0]} castShadow>
        <boxGeometry args={[PALLET_W, 0.03, PALLET_D]} />
        <meshStandardMaterial {...TIMBER} />
      </mesh>
    </group>
  );
});

// --- Racking ----------------------------------------------------------------

/** A brace bar between two points in the frame's y-z plane. */
function Brace({
  x,
  y0,
  y1,
  z0,
  z1,
}: {
  x: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}) {
  const dy = y1 - y0;
  const dz = z1 - z0;
  return (
    <mesh
      position={[x, (y0 + y1) / 2, (z0 + z1) / 2]}
      rotation={[Math.atan2(dz, dy), 0, 0]}
      castShadow
    >
      <boxGeometry args={[0.055, Math.hypot(dy, dz), 0.055]} />
      <meshStandardMaterial {...UPRIGHT_PAINT} />
    </mesh>
  );
}

/** One upright frame: two posts, lattice bracing and a bolted foot plate. */
function RackFrame({ x }: { x: number }) {
  const zf = RACK_Z - RACK_HALF_D;
  const zb = RACK_Z + RACK_HALF_D;
  return (
    <group>
      {[zf, zb].map((z) => (
        <group key={z}>
          <mesh position={[x, RACK_TOP / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[UPRIGHT_W, RACK_TOP, UPRIGHT_W]} />
            <meshStandardMaterial {...UPRIGHT_PAINT} />
          </mesh>
          <mesh position={[x, 0.02, z]} receiveShadow>
            <boxGeometry args={[0.3, 0.04, 0.26]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const y0 = 0.25 + i * 0.62;
        const flip = i % 2 === 0;
        return (
          <Brace
            key={i}
            x={x}
            y0={y0}
            y1={y0 + 0.62}
            z0={flip ? zf : zb}
            z1={flip ? zb : zf}
          />
        );
      })}
      {[0.25, 3.35].map((y) => (
        <mesh key={y} position={[x, y, RACK_Z]}>
          <boxGeometry args={[0.055, 0.055, RACK_HALF_D * 2]} />
          <meshStandardMaterial {...UPRIGHT_PAINT} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Beams and deck slats for one bay at one level, with the slot's WMS register
 * on a placard under the front beam — the same `D1xx`/`D2xx` the program reads,
 * so a player can map register to shelf without counting.
 */
function Bay({ bay, level, sign }: { bay: number; level: number; sign?: THREE.Texture }) {
  const x = posX(bay);
  const y = deckY(level) - BEAM_H / 2;
  const zf = RACK_Z - RACK_HALF_D;
  const zb = RACK_Z + RACK_HALF_D;
  return (
    <group>
      {[zf, zb].map((z) => (
        <mesh key={z} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[SPAN - UPRIGHT_W, BEAM_H, 0.08]} />
          <meshStandardMaterial {...BEAM_PAINT} />
        </mesh>
      ))}
      {/* Slats at the x offsets the fork tines pass between, never through. */}
      {[-0.62, 0, 0.62].map((dx) => (
        <mesh key={dx} position={[x + dx, y + BEAM_H / 2 - 0.012, RACK_Z]} receiveShadow>
          <boxGeometry args={[0.2, 0.025, RACK_HALF_D * 2]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.6} />
        </mesh>
      ))}
      <Sign map={sign} position={[x - 0.55, y - 0.2, zf - 0.05]} width={0.72} height={0.27} />
    </group>
  );
}

// --- Stations ---------------------------------------------------------------

/**
 * The fixed half of a pick-and-deposit station: a roller conveyor running away
 * from the aisle at +z, on legs. The upper deck straddles the lower one on a
 * wider frame rather than standing its legs through it.
 */
const StationFrame = memo(function StationFrame({
  x,
  level,
  capacity,
  sign,
}: {
  x: number;
  level: number;
  capacity: number;
  sign?: THREE.Texture;
}) {
  const deck = deckY(level);
  const zFar = stationFar(capacity);
  const zMid = (stationNear + zFar) / 2;
  const len = zFar - stationNear;
  const rollers = Math.round(len / 0.26);
  const legX = level > 1 ? 0.92 : 0.72;
  const legZ = [stationNear + 0.25, zFar - 0.25];

  return (
    <group>
      {[-0.72, 0.72].map((dx) => (
        <mesh key={dx} position={[x + dx, deck - 0.11, zMid]} castShadow receiveShadow>
          <boxGeometry args={[0.09, 0.22, len]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
      {Array.from({ length: rollers }, (_, i) => stationNear + 0.13 + i * (len / rollers)).map(
        (z) => (
          <mesh key={z} position={[x, deck - 0.06, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.06, 0.06, 1.36, 10]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
        ),
      )}
      {legZ.flatMap((z) =>
        [-1, 1].map((side) => (
          <mesh key={`${z},${side}`} position={[x + side * legX, (deck - 0.22) / 2, z]} castShadow>
            <boxGeometry args={[0.09, deck - 0.22, 0.09]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        )),
      )}
      {level > 1 &&
        legZ.map((z) => (
          <mesh key={`tie${z}`} position={[x, deck - 0.26, z]} castShadow>
            <boxGeometry args={[legX * 2, 0.09, 0.09]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        ))}

      {/* Drive motor on the outboard end, and the transfer photo-eye. */}
      <mesh position={[x + 0.86, deck - 0.16, zFar - 0.45]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 0.28, 14]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[x + 0.86, deck + 0.14, RACK_Z]} castShadow>
        <boxGeometry args={[0.09, 0.14, 0.1]} />
        <meshStandardMaterial color="#0f172a" roughness={0.7} />
      </mesh>

      {/* Lamp post. The lamp itself moves with the demand, so it lives outside. */}
      <mesh position={[x - 0.86, deck + 0.16, stationNear + 0.2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.62, 8]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>

      <mesh position={[x, deck + 0.62, zFar + 0.01]}>
        <boxGeometry args={[1.31, 0.37, 0.03]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <Sign map={sign} position={[x, deck + 0.62, zFar - 0.02]} width={1.25} height={0.31} />
    </group>
  );
});

/**
 * The material this line is asking for next, on the lamp beside its deck: the
 * demand register made visible, so "which one do they want" is answerable from
 * the picture as well as from `D10`/`D11`. Red when the line has stopped.
 */
function StationLamp({
  x,
  level,
  call,
  fault,
}: {
  x: number;
  level: number;
  call: number;
  fault: boolean;
}) {
  const color = fault ? '#ef4444' : call > 0 ? (MATERIAL_COLOR[call] ?? '#94a3b8') : '#64748b';
  return (
    <mesh position={[x - 0.86, deckY(level) + 0.5, stationNear + 0.2]}>
      <sphereGeometry args={[0.1, 14, 10]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={call > 0 || fault ? 0.9 : 0.15}
      />
    </mesh>
  );
}

// --- The fixed plant --------------------------------------------------------

/**
 * Everything that never moves: slab, building, runway, racking. Memoized on the
 * texture set alone, so a sim tick never touches it.
 */
const Plant = memo(function Plant({ tex }: { tex: Textures }) {
  const mid = posX(POS_MAX / 2);
  const railLen = SPAN * POS_MAX + 2.4;
  return (
    <group>
      {/* Slab, painted aisle edges, and the building wall beyond. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[mid, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 16]} />
        <meshStandardMaterial map={tex.concrete} roughness={0.95} metalness={0} />
      </mesh>
      {[-1.05, RACK_Z - RACK_HALF_D - 0.35].map((z) => (
        <mesh key={z} position={[mid, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[railLen + 0.2, 0.1]} />
          <meshStandardMaterial color="#facc15" roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[mid, 3.6, -5.2]} receiveShadow>
        <planeGeometry args={[30, 7.2]} />
        <meshStandardMaterial map={tex.cladding} roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh position={[mid, 0.3, -5.16]}>
        <boxGeometry args={[30, 0.6, 0.08]} />
        <meshStandardMaterial color="#151b23" roughness={0.9} />
      </mesh>

      {/* Travel rail on its sleeper plate, and the top guide rail. */}
      <mesh position={[mid, RAIL_TOP - 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[railLen, 0.1, 0.18]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[mid, 0.06, 0]} receiveShadow>
        <boxGeometry args={[railLen, 0.12, 0.62]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[mid, TOP_RAIL_Y + 0.12, 0]} castShadow>
        <boxGeometry args={[railLen, 0.2, 0.3]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[0.5, 2.5, 4.5].map((p) => (
        <group key={p}>
          <mesh position={[posX(p), TOP_RAIL_Y + 0.12, (RACK_Z - RACK_HALF_D) / 2]} castShadow>
            <boxGeometry args={[0.12, 0.12, RACK_Z - RACK_HALF_D]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh
            position={[posX(p), (RACK_TOP + TOP_RAIL_Y + 0.12) / 2, RACK_Z - RACK_HALF_D]}
            castShadow
          >
            <boxGeometry args={[0.12, TOP_RAIL_Y + 0.12 - RACK_TOP, 0.12]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      ))}

      {/* Racking: five upright frames carrying eight beamed slots. */}
      {[0.5, 1.5, 2.5, 3.5, 4.5].map((p) => (
        <RackFrame key={p} x={posX(p)} />
      ))}
      {WAREHOUSE_SLOTS.map((s) => (
        <Bay
          key={s.key}
          bay={s.bay}
          level={s.level}
          sign={tex.signs[slotRegister(s.bay, s.level)]}
        />
      ))}

      {/* Aisle-end guarding, so the runway reads as ending somewhere. */}
      {[-1.25, posX(POS_MAX) + 1.25].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[0.1, 0.9, 1.1]} />
            <meshStandardMaterial color="#a16207" metalness={0.2} roughness={0.75} />
          </mesh>
          <mesh position={[0, RAIL_TOP + 0.1, 0]} castShadow>
            <boxGeometry args={[0.22, 0.3, 0.4]} />
            <meshStandardMaterial color="#ef4444" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

// --- Crane ------------------------------------------------------------------

function Crane({
  pos,
  level,
  fork,
  carrying,
  loadCode,
  beacon,
}: {
  pos: number;
  level: number;
  fork: number;
  carrying: boolean;
  loadCode: number;
  beacon: string;
}) {
  const y = levelY(level);
  const loadZ = fork * RACK_Z;
  const chainTop = MAST_TOP - 0.18;
  const chainLen = Math.max(0.05, chainTop - (y + 0.42));

  return (
    <group position={[posX(pos), 0, 0]}>
      {/* Bogie on the floor rail, with its wheels and travel drive. */}
      <mesh position={[0, RAIL_TOP + 0.19, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.34, 0.72]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[-0.78, 0.78].map((dx) => (
        <mesh key={dx} position={[dx, RAIL_TOP, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.2, 16]} />
          <meshStandardMaterial color="#2b3240" metalness={0.6} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[1.1, RAIL_TOP + 0.28, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.19, 0.19, 0.44, 16]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.5} />
      </mesh>

      {/* Twin mast: the fork works between the columns. */}
      {[-MAST_X, MAST_X].map((dx) => (
        <mesh key={dx} position={[dx, (RAIL_TOP + 0.36 + MAST_TOP) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.2, MAST_TOP - RAIL_TOP - 0.36, 0.36]} />
          <meshStandardMaterial {...CRANE_PAINT} />
        </mesh>
      ))}
      <mesh position={[0, MAST_TOP + 0.1, 0]} castShadow>
        <boxGeometry args={[MAST_X * 2 + 0.2, 0.2, 0.4]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Guide rollers straddling the top rail, vertical axis, as on a real
          top-guided crane. */}
      {[-0.2, 0.2].map((dz) => (
        <mesh key={dz} position={[0, TOP_RAIL_Y + 0.08, dz]}>
          <cylinderGeometry args={[0.07, 0.07, 0.3, 12]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.5} />
        </mesh>
      ))}
      {/* Hoist chains, paying out as the carriage drops. */}
      {[-0.72, 0.72].map((dx) => (
        <mesh key={dx} position={[dx, chainTop - chainLen / 2, -0.12]}>
          <cylinderGeometry args={[0.022, 0.022, chainLen, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {/* Status beacon, mounted clear of the rail: the one thing on the crane
          that says how it is doing. */}
      <mesh position={[0, MAST_TOP + 0.19, 0.38]}>
        <cylinderGeometry args={[0.03, 0.03, 0.12, 8]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[0, MAST_TOP + 0.36, 0.38]}>
        <cylinderGeometry args={[0.1, 0.1, 0.26, 12]} />
        <meshStandardMaterial color={beacon} emissive={beacon} emissiveIntensity={0.85} />
      </mesh>

      {/* Carriage on the mast, and the three-stage telescopic fork on it. */}
      <group position={[0, y, 0]}>
        {[-0.74, 0.74].map((dx) => (
          <mesh key={dx} position={[dx, 0.06, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.14, 0.84, 0.42]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        ))}
        <mesh position={[0, 0.42, -0.24]} castShadow>
          <boxGeometry args={[1.62, 0.16, 0.16]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        {[-0.82, 0.82].flatMap((dx) =>
          [-0.3, 0.3].map((dy) => (
            <mesh key={`${dx},${dy}`} position={[dx, dy, 0.2]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.07, 0.07, 0.08, 10]} />
              <meshStandardMaterial color="#f59e0b" roughness={0.5} />
            </mesh>
          )),
        )}

        <mesh position={[0, PALLET_BASE - 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.1, 1.1]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        {/* Middle stage: half the stroke, and short enough in z that it stops
            clear of the rack's front beam instead of driving through it. */}
        <mesh position={[0, PALLET_BASE - 0.11, loadZ * 0.38]} castShadow>
          <boxGeometry args={[1.34, 0.09, 0.8]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        {[-0.34, 0.34].map((dx) => (
          <mesh key={dx} position={[dx, PALLET_BASE - 0.04, loadZ]} castShadow>
            <boxGeometry args={[0.19, 0.07, 1.16]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.3} />
          </mesh>
        ))}
        {/* The carried pallet rides the tines, so a full stroke lands it exactly
            where the slot draws its own — the transfer reads as continuous. */}
        {carrying && <Pallet code={loadCode} x={0} y={0} z={loadZ} />}
      </group>
    </group>
  );
}

// --- Scene ------------------------------------------------------------------

function Scene({ machine }: { machine: MachineState }) {
  const tex = useTextures();

  const pos = numOf(machine.pos);
  const level = numOf(machine.level, 1);
  const fork = numOf(machine.fork);
  const faulted = boolOf(machine.jam) || boolOf(machine.starved) || boolOf(machine.blocked);
  const moving = numOf(machine.dir) !== 0 || numOf(machine.liftDir) !== 0 || fork > 0.001;
  const beacon = faulted ? '#ef4444' : moving ? '#f59e0b' : '#22c55e';

  const hasLineA = typeof machine.bufferA === 'number';
  const hasLineB = typeof machine.bufferB === 'number';
  const hasGoodsIn = typeof machine.goodsWaiting === 'number';

  // The infeed conveyors hold pallets the line has accepted but not eaten yet.
  // The machine stops tracking what they were made of at that point, so they are
  // drawn wrapped and neutral rather than pretending to a code nothing holds.
  const goodsTaken = numOf(machine.goodsTaken);
  const goodsCodes = Array.from({ length: numOf(machine.goodsWaiting) }, (_, i) =>
    Number(GOODS_IN_QUEUE[(goodsTaken + i) % GOODS_IN_QUEUE.length]),
  );
  const queue = (x: number, lvl: number, codes: number[]) =>
    codes.map((code, i) => (
      <Pallet key={i} code={code} x={x} y={levelY(lvl)} z={RACK_Z + i * QUEUE_PITCH} />
    ));
  const wrapped = (n: number): number[] => Array.from({ length: Math.max(0, n) }, () => NEUTRAL);

  return (
    <group position={[-posX(POS_MAX / 2), -1.7, 0]}>
      <Plant tex={tex} />

      {/* Aisle position sensors: the crane's own encoder, made visible. */}
      {Array.from({ length: POS_MAX + 1 }, (_, p) => {
        const here = Math.abs(pos - p) < 0.02;
        return (
          <group key={p} position={[posX(p), 0, 0.52]}>
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.07, 0.32, 0.07]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
            <mesh position={[0, 0.36, 0]}>
              <boxGeometry args={[0.16, 0.1, 0.05]} />
              <meshStandardMaterial
                color={here ? '#facc15' : '#334155'}
                emissive={here ? '#facc15' : '#000000'}
                emissiveIntensity={0.9}
              />
            </mesh>
          </group>
        );
      })}

      {WAREHOUSE_SLOTS.map((s) => (
        <Pallet
          key={s.key}
          code={numOf(machine[s.key])}
          x={posX(s.bay)}
          y={levelY(s.level)}
          z={RACK_Z}
        />
      ))}

      {hasLineA && (
        <>
          <StationFrame x={posX(0)} level={1} capacity={2} sign={tex.signs['LINE A']} />
          <StationLamp
            x={posX(0)}
            level={1}
            call={numOf(machine.demandA)}
            fault={boolOf(machine.starved)}
          />
          {queue(posX(0), 1, wrapped(numOf(machine.bufferA)))}
        </>
      )}
      {hasLineB && (
        <>
          <StationFrame x={posX(POS_MAX)} level={1} capacity={2} sign={tex.signs['LINE B']} />
          <StationLamp
            x={posX(POS_MAX)}
            level={1}
            call={numOf(machine.demandB)}
            fault={boolOf(machine.starved)}
          />
          {queue(posX(POS_MAX), 1, wrapped(numOf(machine.bufferB)))}
        </>
      )}
      {hasGoodsIn && (
        <>
          <StationFrame x={posX(0)} level={2} capacity={2} sign={tex.signs['GOODS IN']} />
          <StationLamp
            x={posX(0)}
            level={2}
            call={numOf(machine.goodsCode)}
            fault={boolOf(machine.blocked)}
          />
          {queue(posX(0), 2, goodsCodes)}
        </>
      )}

      <Crane
        pos={pos}
        level={level}
        fork={fork}
        carrying={boolOf(machine.carrying)}
        loadCode={numOf(machine.loadCode)}
        beacon={beacon}
      />
    </group>
  );
}

export function Warehouse3D({
  machine,
  height = 300,
}: {
  machine: MachineState;
  height?: number;
}) {
  return (
    <MachineCanvas
      height={height}
      // Direction only: `fitExtent` sets the distance from the live viewport, so
      // the whole aisle is in frame whatever shape the panel is.
      cameraPosition={[2.2, 5.2, 12]}
      fov={34}
      target={[0, 0.55, 0]}
      fitExtent={{ halfWidth: 6.9, halfHeight: 2.4 }}
      minDistance={5}
      maxDistance={40}
      polarRange={[0.45, 1.4]}
      panBounds={{ x: [-4.5, 4.5], y: [-0.6, 2.6], z: [-2, 2] }}
      interactive
    >
      <Scene machine={machine} />
    </MachineCanvas>
  );
}
