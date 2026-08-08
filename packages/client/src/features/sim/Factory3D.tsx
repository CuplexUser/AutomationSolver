import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_LIMITS, FACTORY_SECTIONS, type MachineState } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

/**
 * The excavator plant: four bays, two part streams, one floor.
 *
 * Every other scene in the game shows a machine. This one has to show a *line*,
 * and the thing a player needs to read off it is not any single mechanism but
 * the flow: how much is queued where, which of the two part types the line is
 * short of, and which station is the one that stopped. So the buffers are drawn
 * as real parts on real rails rather than as counters, and the two painted lanes
 * run side by side into final assembly, where a lane that is empty while the
 * other is full is the whole failure mode in one picture.
 *
 * The same excavator is visible at every stage of its own build — a bare
 * weldment in the fixture, a yellow shell coming out of the oven, a machine
 * growing an engine and a cab and a boom in the jig, and finally something that
 * moves under its own hydraulics on the test pad. That progression is why this
 * is built procedurally rather than imported: a station needs to turn parts on
 * and off and recolor them, which is a node-toggling chore in a glTF and a plain
 * function of machine state here.
 *
 * Layout is a U, because a straight line 40 units long frames badly and a real
 * plant does not build one either:
 *
 *   z = -6   WELD ->  weld buffer  ->  BOOTH  ->  OVEN
 *                                                   |  painted buffers, two lanes
 *   z = +7   YARD <-  TEST  <-  test queue  <-  ASSEMBLY
 *
 * Perf follows `Warehouse3D`'s discipline: the sim re-renders this twenty times
 * a second, so everything that does not move sits behind a `memo` with scalar
 * props, and only the parts whose state actually changed are reconciled.
 */

// --- Plant layout -------------------------------------------------------------
// One scene unit is one metre. An excavator is about 4 m of it.

/** Row A (weld and paint) and row B (assembly, test, yard) centre lines. */
const ROW_A = -6;
const ROW_B = 7;

const WELD_X = -10.5;
/** Weld buffer rail: three cross-loaded stands between weld and the booth. */
const WP_SLOT_X = [-6.6, -4.2, -1.8] as const;
const BOOTH_X = 1.6;
const OVEN_X = 6.2;

/** The painted buffers run across the plant, which is what merges the streams. */
const PA_LANE_X = { f: 9.4, b: 12.2 } as const;
const PA_SLOT_Z = [-5.0, -1.4, 2.2] as const;

const ASSY_X = 9.0;
/** Finished machines waiting for the test bay. */
const AT_SLOT_X = [4.8, 1.9] as const;
const TEST_X = -2.0;
/** Dispatch yard: three columns of two, parked nose-in. */
const YARD_COL_X = [-7.6, -10.6, -13.6] as const;
const YARD_ROW_Z = [5.4, 9.1] as const;

const FLOOR = { x0: -17, x1: 15.5, z0: -10.5, z1: 12.5 };

const COUNTS_FULL = 4000;

// --- Materials ----------------------------------------------------------------

const STEEL = { color: '#8b95a3', metalness: 0.78, roughness: 0.42 };
const DARK_STEEL = { color: '#4b5563', metalness: 0.7, roughness: 0.5 };
const MACHINE_PAINT = { color: '#5f6b7a', metalness: 0.35, roughness: 0.55 };
/** Guard rails and safety fencing, in the yellow every shop floor uses. */
const GUARD = { color: '#e0a11b', metalness: 0.25, roughness: 0.6 };
const RUBBER = { color: '#22272d', metalness: 0.1, roughness: 0.92 };

/**
 * How a part looks at each point in the shop. `bare` is a raw weldment straight
 * off the fixture, `blasted` is grit-blasted and matte, `painted` is the
 * finish, and `defect` is what comes out of an oven that drifted out of band —
 * dull and patchy, so a scrapped part is recognisable before the counter moves.
 */
const FINISH = {
  bare: { color: '#767f8b', metalness: 0.72, roughness: 0.46 },
  blasted: { color: '#a3aab1', metalness: 0.3, roughness: 0.88 },
  painted: { color: '#f0b429', metalness: 0.28, roughness: 0.42 },
  defect: { color: '#8a7748', metalness: 0.08, roughness: 0.95 },
} as const;
type Finish = keyof typeof FINISH;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const strOf = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- Painted signage and floor -------------------------------------------------

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

interface Textures {
  concrete: THREE.CanvasTexture;
  lane: THREE.CanvasTexture;
  signs: Record<string, THREE.CanvasTexture>;
}

const SIGN_TEXT = ['WELD', 'PAINT', 'ASSEMBLY', 'TEST', 'YARD'] as const;

function buildTextures(): Textures {
  return {
    concrete: concreteTexture(),
    lane: laneTexture(),
    signs: Object.fromEntries(
      SIGN_TEXT.map((t) => [t, signTexture(t, '#1b212b', '#e8b53a')]),
    ) as Record<string, THREE.CanvasTexture>,
  };
}

/** One painted lane segment. `length` is along the local +x the chevrons point. */
const Lane = memo(function Lane({
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
const BaySign = memo(function BaySign({
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

// --- The excavator, in the pieces the line builds it from -----------------------

/**
 * Undercarriage: tracks, car body and slew ring. This is the "frame" the weld
 * shop makes, the part the paint shop hangs on the frames lane, and the thing
 * that has to be in the jig before an engine can be lowered onto it.
 */
const ExcavatorFrame = memo(function ExcavatorFrame({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group>
      {[-0.86, 0.86].map((z) => (
        <group key={z} position={[0, 0.36, z]}>
          {/* Track belt, drawn as a slab with a roller at each end. */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[3.1, 0.66, 0.58]} />
            <meshStandardMaterial {...RUBBER} />
          </mesh>
          {[-1.55, 1.55].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.33, 0.33, 0.58, 20]} />
              <meshStandardMaterial {...RUBBER} />
            </mesh>
          ))}
          {/* Track frame: the welded steel the belt runs on. */}
          <mesh position={[0, 0.16, 0]} castShadow>
            <boxGeometry args={[3.5, 0.3, 0.4]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        </group>
      ))}
      {/* Car body between the tracks, and the slew ring on top of it. */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.34, 1.6]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.78, 0.86, 0.2, 28]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    </group>
  );
});

/**
 * Boom, stick and bucket as one weldment — the second part stream, and the
 * reason a shop that only welds frames ships nothing.
 *
 * The angles are arguments because the same geometry is a dead lump on a stand
 * in the paint shop and a working arm on the test pad.
 */
const ExcavatorBoom = memo(function ExcavatorBoom({
  finish,
  boom = 0.55,
  stick = -1.45,
  bucket = -0.9,
}: {
  finish: Finish;
  boom?: number;
  stick?: number;
  bucket?: number;
}) {
  const mat = FINISH[finish];
  return (
    <group rotation={[0, 0, boom]}>
      {/* Main boom: a box section that tapers toward the knuckle. */}
      <mesh position={[1.15, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.42, 0.36]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Lift ram, slung underneath. */}
      <mesh position={[0.8, -0.34, 0.28]} rotation={[0, 0, Math.PI / 2 + 0.16]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 1.5, 12]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Knuckle plate where the stick pins on. */}
      <mesh position={[2.35, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.42, 14]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <group position={[2.35, 0.05, 0]} rotation={[0, 0, stick]}>
        <mesh position={[0.85, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.34, 0.3]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        {/* Bucket ram along the top of the stick. */}
        <mesh position={[0.75, 0.3, 0]} rotation={[0, 0, Math.PI / 2 - 0.1]} castShadow>
          <cylinderGeometry args={[0.075, 0.075, 1.3, 10]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <group position={[1.72, 0, 0]} rotation={[0, 0, bucket]}>
          {/* Bucket: a back plate, a floor and five teeth. */}
          <mesh position={[0.26, -0.18, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.52, 0.86]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          {[-0.32, -0.16, 0, 0.16, 0.32].map((z) => (
            <mesh key={z} position={[0.62, -0.34, z]} rotation={[0, 0, -Math.PI / 2]} castShadow>
              <coneGeometry args={[0.055, 0.22, 6]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
});

/** Engine house and counterweight — the "engine" step in the assembly jig. */
const ExcavatorHouse = memo(function ExcavatorHouse({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group>
      <mesh position={[-0.45, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.92, 1.68]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Counterweight: cast, unpainted, and noticeably darker. */}
      <mesh position={[-1.62, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 1.0, 1.6]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Exhaust stack, so the house has a silhouette from above. */}
      <mesh position={[-0.2, 1.12, -0.52]} castShadow>
        <cylinderGeometry args={[0.08, 0.09, 0.42, 12]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Walkway handrail along the top of the house: the one detail that makes
          the read of scale correct, because a rail is always about a metre. */}
      <group position={[-0.45, 1.08, 0]}>
        {[-0.8, 0.8].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.42, 0]} castShadow={false}>
              <boxGeometry args={[1.9, 0.05, 0.05]} />
              <meshStandardMaterial {...GUARD} />
            </mesh>
            {[-0.85, 0, 0.85].map((x) => (
              <mesh key={x} position={[x, 0.21, 0]} castShadow={false}>
                <boxGeometry args={[0.05, 0.42, 0.05]} />
                <meshStandardMaterial {...GUARD} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* Access steps up the side, under the cab door. */}
      {[0, 1].map((i) => (
        <mesh key={i} position={[0.35 - i * 0.02, 0.06 + i * 0.28, 0.92]} castShadow>
          <boxGeometry args={[0.5, 0.06, 0.26]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
    </group>
  );
});

/** Operator cab, glazed on three sides. */
const ExcavatorCab = memo(function ExcavatorCab({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group position={[0.62, 0.62, 0.44]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.98, 1.18, 0.94]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Glazing, inset a hair so it never z-fights the shell it sits in. */}
      <mesh position={[0.5, 0.12, 0]}>
        <boxGeometry args={[0.02, 0.78, 0.8]} />
        <meshPhysicalMaterial
          color="#9fd4ea"
          transparent
          opacity={0.42}
          roughness={0.08}
          metalness={0}
          clearcoat={0.7}
        />
      </mesh>
      <mesh position={[0, 0.12, 0.48]}>
        <boxGeometry args={[0.82, 0.78, 0.02]} />
        <meshPhysicalMaterial
          color="#9fd4ea"
          transparent
          opacity={0.42}
          roughness={0.08}
          metalness={0}
        />
      </mesh>
    </group>
  );
});

/**
 * The whole machine, at whatever stage of completion it has reached.
 *
 * Each fitting is a 0..1 progress rather than a flag, because the assembly jig's
 * whole subject is watching one go on: the engine descends from the gantry, the
 * cab lands on the deck, the boom swings down onto its pin.
 */
function Excavator({
  finish,
  engine = 1,
  cab = 1,
  boomFit = 1,
  boomAngle = 0.55,
  stickAngle = -1.45,
  bucketAngle = -0.9,
}: {
  finish: Finish;
  /** 0..1 fittings. Below 1 the part is still on its way down. */
  engine?: number;
  cab?: number;
  boomFit?: number;
  boomAngle?: number;
  stickAngle?: number;
  bucketAngle?: number;
}) {
  return (
    <group>
      <ExcavatorFrame finish={finish} />
      {engine > 0 && (
        <group position={[0, 1.05 + (1 - engine) * 2.6, 0]}>
          <ExcavatorHouse finish={finish} />
        </group>
      )}
      {cab > 0 && (
        <group position={[0, 1.05 + (1 - cab) * 3.0, 0]}>
          <ExcavatorCab finish={finish} />
        </group>
      )}
      {boomFit > 0 && (
        // Un-pinned, the boom hangs from the gantry above and behind its pivot,
        // rotated back — so "pinning" is visibly the arm coming down onto the eye.
        <group position={[1.05, 1.35 + (1 - boomFit) * 1.9, 0]} rotation={[0, 0, (1 - boomFit) * 0.7]}>
          <ExcavatorBoom
            finish={finish}
            boom={boomAngle}
            stick={stickAngle}
            bucket={bucketAngle}
          />
        </group>
      )}
    </group>
  );
}

/** A part in transit, drawn as whichever of the two things it is. */
function LoosePart({ code, finish }: { code: string; finish: Finish }) {
  if (code === 'b') {
    // A loose boom lies folded on a stand rather than standing up in the air.
    return (
      <group position={[-1.2, 0.72, 0]}>
        <ExcavatorBoom finish={finish} boom={0.06} stick={-0.18} bucket={-0.35} />
      </group>
    );
  }
  return <ExcavatorFrame finish={finish} />;
}

/** The trestle a loose part sits on between stations. */
const PartStand = memo(function PartStand({ w = 2.4, d = 1.9 }: { w?: number; d?: number }) {
  return (
    <group>
      {/* Mid steel deck with yellow edge rails. An empty stand still has to read
          as an empty *space in the queue* rather than as floor, but painting the
          whole deck yellow put six bright slabs across the plant view and they
          out-shouted the four bays. Trim carries it; area does not. */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial color="#5c6673" metalness={0.5} roughness={0.6} />
      </mesh>
      {[-d / 2 + 0.3, d / 2 - 0.3].map((z) => (
        <mesh key={z} position={[0, 0.36, z]} castShadow>
          <boxGeometry args={[w - 0.2, 0.1, 0.16]} />
          <meshStandardMaterial {...GUARD} />
        </mesh>
      ))}
      {[
        [-w / 2 + 0.16, -d / 2 + 0.16],
        [w / 2 - 0.16, -d / 2 + 0.16],
        [-w / 2 + 0.16, d / 2 - 0.16],
        [w / 2 - 0.16, d / 2 - 0.16],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.11, z]} castShadow>
          <boxGeometry args={[0.13, 0.22, 0.13]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
    </group>
  );
});

// --- Readable analog: a wall gauge with its acceptance band marked ---------------

/**
 * A bar gauge with the good band painted on it.
 *
 * The paint booth's two analog values both have a *window* rather than a
 * target, and a window is the one thing a bare number on an HMI does not say.
 * Drawing the band on the scale means "too cold" and "too much film" are things
 * the player sees rather than things they work out.
 */
const GaugeBody = memo(function GaugeBody({
  bandLo,
  bandHi,
  h,
}: {
  bandLo: number;
  bandHi: number;
  h: number;
}) {
  const bandH = (bandHi - bandLo) * h;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[0.34, h, 0.1]} />
        <meshStandardMaterial color="#1b2029" roughness={0.8} metalness={0.2} />
      </mesh>
      <mesh position={[0, bandLo * h + bandH / 2, 0.055]}>
        <planeGeometry args={[0.34, bandH]} />
        <meshStandardMaterial color="#1f7a4d" emissive="#166534" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
});

function BarGauge({
  position,
  value,
  bandLo,
  bandHi,
  h = 1.6,
  rotY = 0,
}: {
  position: [number, number, number];
  /** 0..1 of full scale. */
  value: number;
  bandLo: number;
  bandHi: number;
  h?: number;
  rotY?: number;
}) {
  const v = clamp01(value);
  const inBand = v >= bandLo && v <= bandHi;
  const fill = Math.max(0.001, v * h);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <GaugeBody bandLo={bandLo} bandHi={bandHi} h={h} />
      <mesh position={[0, fill / 2, 0.07]}>
        <boxGeometry args={[0.16, fill, 0.04]} />
        <meshStandardMaterial
          color={inBand ? '#4ade80' : '#f87171'}
          emissive={inBand ? '#22c55e' : '#dc2626'}
          emissiveIntensity={0.9}
        />
      </mesh>
    </group>
  );
}

/** A stack light, which is how a real bay says what it is doing from 30 m away. */
function StackLight({
  position,
  green,
  amber,
  red,
}: {
  position: [number, number, number];
  green: boolean;
  amber: boolean;
  red: boolean;
}) {
  const lamps: Array<[string, boolean]> = [
    ['#ef4444', red],
    ['#f59e0b', amber],
    ['#22c55e', green],
  ];
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.8, 10]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {lamps.map(([color, on], i) => (
        <mesh key={color} position={[0, 2.02 + i * 0.26, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.24, 14]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={on ? 1.6 : 0.04}
            roughness={0.4}
            transparent
            opacity={on ? 1 : 0.5}
          />
        </mesh>
      ))}
    </group>
  );
}

// --- Weld bay -------------------------------------------------------------------

/** The fixture, the gantry it hangs under, and the safety screens around it. */
const WeldShell = memo(function WeldShell() {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} receiveShadow castShadow>
        <boxGeometry args={[5.4, 0.4, 4.2]} />
        <meshStandardMaterial color="#2f3641" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Gantry: two legs and a rail the torch head runs along. */}
      {[-2.3, 2.3].map((x) => (
        <mesh key={x} position={[x, 1.9, -1.7]} castShadow>
          <boxGeometry args={[0.22, 3.6, 0.22]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      ))}
      <mesh position={[0, 3.6, -1.7]} castShadow>
        <boxGeometry args={[5.0, 0.3, 0.34]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* Cable chain along the rail, so the torch head is visibly fed. */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-2.0 + i * 0.5, 3.86, -1.7]} castShadow={false}>
          <boxGeometry args={[0.34, 0.16, 0.2]} />
          <meshStandardMaterial color="#2f3945" metalness={0.3} roughness={0.8} />
        </mesh>
      ))}

      {/* Fume extraction, kept deliberately small and set back over the rail
          rather than centred over the fixture. Sized to look right in isolation
          it became a grey pyramid parked on top of the one thing the bay is for.
          Nothing overhead in this scene casts a shadow, for the same reason the
          building has no trusses. */}
      <mesh position={[0, 4.55, -1.5]} rotation={[0, Math.PI / 4, 0]} castShadow={false}>
        <cylinderGeometry args={[0.32, 0.95, 0.6, 4]} />
        <meshStandardMaterial color="#5d6874" metalness={0.45} roughness={0.65} />
      </mesh>
      <mesh position={[0, 5.15, -2.1]} rotation={[Math.PI / 3, 0, 0]} castShadow={false}>
        <cylinderGeometry args={[0.24, 0.24, 2.2, 12]} />
        <meshStandardMaterial color="#68737f" metalness={0.5} roughness={0.6} />
      </mesh>

      {/* Weld screens: hung curtains on a frame, not floating slabs. The frame
          is what makes a translucent quad read as a screen. */}
      {[-2.5, 2.5].map((x) => (
        <group key={x} position={[x, 0, 0.4]}>
          {[-1.7, 1.7].map((z) => (
            <mesh key={z} position={[0, 1.35, z]} castShadow>
              <boxGeometry args={[0.1, 2.7, 0.1]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
          ))}
          <mesh position={[0, 2.66, 0]} castShadow>
            <boxGeometry args={[0.12, 0.12, 3.5]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[0, 1.42, 0]}>
            <boxGeometry args={[0.05, 2.3, 3.3]} />
            <meshStandardMaterial
              color="#c2410c"
              transparent
              opacity={0.34}
              roughness={0.5}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

interface WeldRefs {
  torch: THREE.Group | null;
  flare: THREE.Mesh | null;
  light: THREE.PointLight | null;
  sparks: THREE.Group | null;
}

function WeldBay({ machine, torchOn }: { machine: MachineState; torchOn: boolean }) {
  const refs = useRef<WeldRefs>({ torch: null, flare: null, light: null, sparks: null });
  const part = strOf(machine.weldPart);
  const clamp = clamp01(numOf(machine.weldClamp));
  const seam = clamp01(numOf(machine.weldSeam));
  const arcing = torchOn && part !== '' && clamp >= 1;

  useFrame((state) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // The head tracks the seam it is laying, which is what makes weld progress
    // a thing you can see rather than a number ticking somewhere.
    if (r.torch) r.torch.position.x = -1.5 + seam * 3.0;
    if (r.flare) {
      r.flare.visible = arcing;
      // Arc flicker: cosmetic only, so a free-running clock is fine here the way
      // it is for the drill's spindle.
      const f = 0.9 + Math.sin(t * 47) * 0.1 + Math.sin(t * 23) * 0.06;
      r.flare.scale.setScalar(arcing ? f : 0.001);
    }
    if (r.light) r.light.intensity = arcing ? 5 + Math.sin(t * 39) * 2.2 : 0;
    if (r.sparks) {
      r.sparks.visible = arcing;
      if (arcing) {
        r.sparks.children.forEach((s, i) => {
          const phase = (t * 2.4 + i * 0.37) % 1;
          const a = i * 1.9;
          s.position.set(
            Math.cos(a) * phase * 0.85,
            0.35 - phase * phase * 1.1,
            Math.sin(a) * phase * 0.7,
          );
          s.scale.setScalar(1 - phase);
        });
      }
    }
  });

  return (
    <group position={[WELD_X, 0, ROW_A]}>
      <WeldShell />

      {/* The fixture jaws close on the blank across its width as the clamp
          makes, leaving the length of the part clear for the torch to run. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[0, 0, side * (1.75 - clamp * 0.42)]}>
          <mesh position={[0, 0.75, 0]} castShadow>
            <boxGeometry args={[2.6, 0.7, 0.34]} />
            <meshStandardMaterial {...GUARD} />
          </mesh>
          {/* Gussets and the ram behind them: a jaw is a fabrication, and a
              plain bar reads as a yellow box floating over a table. */}
          {[-0.95, 0, 0.95].map((x) => (
            <mesh key={x} position={[x, 0.44, side * 0.22]} castShadow>
              <boxGeometry args={[0.22, 0.44, 0.5]} />
              <meshStandardMaterial {...GUARD} />
            </mesh>
          ))}
          <mesh position={[0, 0.75, side * 0.62]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 0.9, 12]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      ))}

      {/* What is in the fixture. Laid along the bay's x, which is the axis the
          gantry rail runs on, so the seam and the torch travel agree. */}
      {part !== '' && (
        <group position={[0, 0.4, 0]}>
          <LoosePart code={part} finish="bare" />
        </group>
      )}

      {/* Torch head on the rail, with its arc, its light and its sparks. */}
      <group
        ref={(g) => {
          refs.current.torch = g;
        }}
        position={[0, 0, -1.7]}
      >
        <mesh position={[0, 3.15, 0]} castShadow>
          <boxGeometry args={[0.5, 0.6, 0.5]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
        <mesh position={[0, 2.3, 0.5]} rotation={[0.5, 0, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.11, 1.5, 12]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <group position={[0, 1.62, 1.06]}>
          <mesh
            ref={(m) => {
              refs.current.flare = m;
            }}
          >
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#e8f4ff" />
          </mesh>
          <pointLight
            ref={(l) => {
              refs.current.light = l;
            }}
            color="#bcd8ff"
            distance={9}
            decay={2}
            intensity={0}
          />
          <group
            ref={(g) => {
              refs.current.sparks = g;
            }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <mesh key={i}>
                <sphereGeometry args={[0.035, 5, 5]} />
                <meshBasicMaterial color="#ffb24d" />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      <StackLight
        position={[2.6, 0, -1.9]}
        green={part !== '' && !boolOf(machine.jam)}
        amber={strOf(machine.bufWp).length >= FACTORY_LIMITS.WP_CAP}
        red={boolOf(machine.jam) || boolOf(machine.blocked)}
      />
    </group>
  );
}

// --- Paint bay --------------------------------------------------------------------

/** Booth enclosure and cure oven: two chambers on one heater duct. */
const PaintShell = memo(function PaintShell() {
  return (
    <group>
      {/* Spray booth: glazed so the part inside stays visible. */}
      <group position={[BOOTH_X, 0, 0]}>
        <mesh position={[0, 1.7, 0]}>
          <boxGeometry args={[4.0, 3.4, 3.6]} />
          <meshPhysicalMaterial
            color="#cfe0ee"
            transparent
            opacity={0.15}
            depthWrite={false}
            roughness={0.1}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Frame members, so the glass reads as a booth and not as a haze. */}
        {[-2.0, 2.0].map((x) =>
          [-1.8, 1.8].map((z) => (
            <mesh key={`${x},${z}`} position={[x, 1.7, z]} castShadow>
              <boxGeometry args={[0.12, 3.4, 0.12]} />
              <meshStandardMaterial {...MACHINE_PAINT} />
            </mesh>
          )),
        )}
        {/* Roof: a rail around the edge and a plenum along the back only. A
            solid lid is what the first version had, and from the plant camera
            it hid the entire booth interior — the one thing the booth is for. */}
        {[-1.9, 1.9].map((z) => (
          <mesh key={z} position={[0, 3.45, z]} castShadow>
            <boxGeometry args={[4.3, 0.2, 0.24]} />
            <meshStandardMaterial {...MACHINE_PAINT} />
          </mesh>
        ))}
        {[-2.05, 2.05].map((x) => (
          <mesh key={x} position={[x, 3.45, 0]} castShadow>
            <boxGeometry args={[0.2, 0.2, 3.8]} />
            <meshStandardMaterial {...MACHINE_PAINT} />
          </mesh>
        ))}
        <mesh position={[0, 3.32, -1.3]} castShadow>
          <boxGeometry args={[3.9, 0.5, 0.9]} />
          <meshStandardMaterial color="#6b7684" metalness={0.45} roughness={0.6} />
        </mesh>
        {/* Filter cassettes in the plenum face, seen from the front. */}
        {[-1.2, 0, 1.2].map((x) => (
          <mesh key={x} position={[x, 3.32, -0.86]}>
            <planeGeometry args={[1.1, 0.34]} />
            <meshStandardMaterial color="#b9a06a" roughness={0.95} metalness={0} />
          </mesh>
        ))}
      </group>

      {/* Cure oven: solid, insulated, with a viewing slot. */}
      <group position={[OVEN_X, 0, 0]}>
        <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[4.2, 3.2, 3.6]} />
          <meshStandardMaterial color="#59636f" metalness={0.4} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.9, 1.82]}>
          <planeGeometry args={[2.4, 0.5]} />
          <meshStandardMaterial color="#1b2029" roughness={0.4} metalness={0.3} />
        </mesh>
      </group>

      {/* Heater duct linking the two, and the extract stack above the booth. */}
      <mesh position={[(BOOTH_X + OVEN_X) / 2, 2.9, -1.4]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, OVEN_X - BOOTH_X, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[BOOTH_X, 4.4, -1.4]} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 1.9, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      {/* Cowl on the stack, so it does not read as a white disc from above. */}
      <mesh position={[BOOTH_X, 5.42, -1.4]} castShadow>
        <coneGeometry args={[0.55, 0.42, 16]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
    </group>
  );
});

interface PaintRefs {
  part: THREE.Group | null;
  gun: THREE.Group | null;
  fan: THREE.Mesh | null;
  fanMat: THREE.MeshStandardMaterial | null;
  glow: THREE.PointLight | null;
  ovenMat: THREE.MeshStandardMaterial | null;
}

function PaintBay({
  machine,
  spraying,
}: {
  machine: MachineState;
  spraying: boolean;
}) {
  const refs = useRef<PaintRefs>({
    part: null,
    gun: null,
    fan: null,
    fanMat: null,
    glow: null,
    ovenMat: null,
  });

  const stage = strOf(machine.paintStage, 'idle');
  const code = strOf(machine.paintPart);
  const temp = numOf(machine.boothTempM) / 100;
  const film = numOf(machine.filmM) / 100;
  const defect = boolOf(machine.paintDefect);
  const inBand = temp >= FACTORY_LIMITS.CURE_MIN && temp <= FACTORY_LIMITS.CURE_MAX;

  // Where the part stands, and what it looks like there. Blast leaves it matte
  // grey; the yellow arrives as film builds, so the finish is literally the
  // integral the program is controlling.
  const targetX = stage === 'cure' ? OVEN_X : BOOTH_X;
  const filmFrac = clamp01(film / FACTORY_LIMITS.FILM_MAX);
  const finish: Finish =
    defect && stage === 'cure'
      ? 'defect'
      : filmFrac > 0.25
        ? 'painted'
        : stage === 'idle'
          ? 'bare'
          : 'blasted';

  useFrame((state, dt) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // Ease the part between chambers instead of teleporting it: the model moves
    // it in one sub-step, but a machine you can watch has to travel.
    if (r.part) {
      const cur = r.part.position.x;
      r.part.position.x = cur + (targetX - cur) * Math.min(1, dt * 4);
      r.part.visible = stage !== 'idle';
    }
    // The gun sweeps the part while it is actually spraying.
    if (r.gun) {
      r.gun.visible = stage === 'spray';
      r.gun.position.z = Math.sin(t * 2.4) * 1.15;
    }
    if (r.fan) {
      r.fan.visible = spraying && stage === 'spray';
      r.fan.position.z = Math.sin(t * 2.4) * 1.15;
    }
    // Paint only sticks inside the cure band, so the fan is drawn thin and pale
    // when the booth is out of it: overspray that is not going to stay on.
    if (r.fanMat) r.fanMat.opacity = inBand ? 0.42 : 0.16;
    // The oven glows with its own temperature, red-hot out of band and amber in.
    const heat = clamp01(temp / COUNTS_FULL);
    if (r.glow) r.glow.intensity = stage === 'cure' ? 2 + heat * 6 : heat * 2.5;
    if (r.ovenMat) {
      r.ovenMat.emissiveIntensity = 0.15 + heat * 1.5;
      r.ovenMat.emissive.set(
        inBand ? '#f59e0b' : temp > FACTORY_LIMITS.CURE_MAX ? '#ef4444' : '#3b82f6',
      );
    }
  });

  return (
    <group position={[0, 0, ROW_A]}>
      <PaintShell />

      {/* Viewing-slot glow: the oven's own temperature, straight off the model. */}
      <mesh position={[OVEN_X, 1.9, 1.83]}>
        <planeGeometry args={[2.2, 0.36]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.ovenMat = m;
          }}
          color="#2a2118"
          emissive="#f59e0b"
          emissiveIntensity={0.2}
        />
      </mesh>
      <pointLight
        ref={(l) => {
          refs.current.glow = l;
        }}
        position={[OVEN_X, 1.6, 0]}
        color="#ffb257"
        distance={7}
        decay={2}
        intensity={0}
      />

      {/* The part being worked, travelling between the two chambers. */}
      <group
        ref={(g) => {
          refs.current.part = g;
        }}
        position={[BOOTH_X, 0.4, 0]}
      >
        {/* The skid the part rides through both chambers on. */}
        <mesh position={[0, -0.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.4, 0.16, 2.2]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <LoosePart code={code} finish={finish} />
      </group>

      {/* Spray gun on its reciprocator, and the fan it lays down. */}
      <group
        ref={(g) => {
          refs.current.gun = g;
        }}
        position={[BOOTH_X - 1.5, 2.0, 0]}
      >
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.3, 0.5]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      </group>
      <mesh
        ref={(m) => {
          refs.current.fan = m;
        }}
        position={[BOOTH_X - 0.85, 2.0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <coneGeometry args={[0.5, 1.3, 14, 1, true]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.fanMat = m;
          }}
          color="#f0b429"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* The two gauges the station is actually programmed against, on the
          booth's front frame where the camera preset puts them in shot. */}
      <BarGauge
        position={[BOOTH_X + 1.45, 0.9, 1.92]}
        value={temp / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.CURE_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.CURE_MAX / COUNTS_FULL}
      />
      <BarGauge
        position={[BOOTH_X + 2.0, 0.9, 1.92]}
        value={film / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.FILM_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.FILM_MAX / COUNTS_FULL}
      />

      {/* Scrap skip: the parts this station spoiled, where they can be counted. */}
      <group position={[OVEN_X + 0.4, 0, -3.2]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 1.0, 1.6]} />
          <meshStandardMaterial color="#7c2d12" metalness={0.3} roughness={0.7} />
        </mesh>
        {Array.from({ length: Math.min(4, numOf(machine.scrapped)) }, (_, i) => (
          <mesh key={i} position={[-0.7 + i * 0.45, 1.05 + (i % 2) * 0.12, 0]} castShadow>
            <boxGeometry args={[0.4, 0.22, 0.9]} />
            <meshStandardMaterial {...FINISH.defect} />
          </mesh>
        ))}
      </group>

      <StackLight
        position={[BOOTH_X - 2.6, 0, -2.1]}
        green={stage !== 'idle' && !defect}
        amber={stage === 'cure'}
        red={defect || boolOf(machine.blocked)}
      />
    </group>
  );
}

// --- Assembly bay -------------------------------------------------------------------

/** The jig, and the gantry that lowers everything onto it. */
const AssemblyShell = memo(function AssemblyShell() {
  return (
    <group>
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <boxGeometry args={[6.4, 0.32, 5.0]} />
        <meshStandardMaterial color="#2f3641" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Jig stands the frame is landed between. */}
      {[-1.9, 1.9].map((x) => (
        <mesh key={x} position={[x, 0.5, 0]} castShadow>
          <boxGeometry args={[0.4, 0.6, 3.2]} />
          <meshStandardMaterial {...GUARD} />
        </mesh>
      ))}
      {/* Overhead gantry, spanning across the bay. */}
      {[-2.9, 2.9].map((x) => (
        <mesh key={x} position={[x, 2.6, -2.2]} castShadow>
          <boxGeometry args={[0.24, 5.2, 0.24]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      ))}
      <mesh position={[0, 5.1, -2.2]} castShadow>
        <boxGeometry args={[6.2, 0.34, 0.4]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* Cross-travel beam over the jig, which is what the hoist runs on. */}
      <mesh position={[0, 4.7, 0]} castShadow>
        <boxGeometry args={[0.5, 0.34, 4.6]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* A rail of parts bins down the side of the bay: engines, cabs, and the
          fasteners that go with them. It costs nothing and it is the difference
          between an assembly bay and two posts on a slab. */}
      {[-2.2, -1.0, 0.2].map((x) => (
        <group key={x} position={[x, 0, 2.3]}>
          <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.0, 0.84, 0.9]} />
            <meshStandardMaterial color="#3f6b8f" metalness={0.3} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.88, 0]} castShadow>
            <boxGeometry args={[1.06, 0.08, 0.96]} />
            <meshStandardMaterial {...GUARD} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

/** The hoist block and its two falls of chain, following whatever it carries. */
function Hoist({ y, visible }: { y: number; visible: boolean }) {
  const drop = Math.max(0.05, 4.55 - y);
  return (
    <group visible={visible}>
      <mesh position={[0, 4.55, 0]} castShadow>
        <boxGeometry args={[0.6, 0.42, 0.6]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[0, 4.55 - drop / 2, z]}>
          <cylinderGeometry args={[0.035, 0.035, drop, 6]} />
          <meshStandardMaterial color="#2b323b" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, y, 0]} castShadow>
        <boxGeometry args={[0.9, 0.14, 1.2]} />
        <meshStandardMaterial {...GUARD} />
      </mesh>
    </group>
  );
}

function AssemblyBay({ machine }: { machine: MachineState }) {
  const hasFrame = boolOf(machine.assyHasFrame);
  const hasBoom = boolOf(machine.assyHasBoom);
  const engine = clamp01(numOf(machine.assyEngine));
  const cab = clamp01(numOf(machine.assyCab));
  const boom = clamp01(numOf(machine.assyBoom));
  const starving = numOf(machine.assyStarveMs) > 3000;

  return (
    <group position={[ASSY_X, 0, ROW_B]}>
      <AssemblyShell />

      {/* The machine under construction. Only the frame is ever "in" the jig;
          everything else arrives as a fitting the player watches go on. */}
      {hasFrame && (
        <group position={[0, 0.8, 0]} rotation={[0, Math.PI, 0]}>
          <Excavator
            finish="painted"
            engine={engine}
            cab={cab}
            boomFit={hasBoom ? boom : 0}
            boomAngle={0.45}
            stickAngle={-1.5}
            bucketAngle={-0.7}
          />
        </group>
      )}

      {/* Whatever the gantry is lowering right now, on the end of its chains.
          The fittings used to descend out of thin air; a hoist block above them
          is what turns a floating box into a lift. */}
      {hasFrame && engine < 1 && <Hoist y={2.0 + (1 - engine) * 2.6} visible />}
      {hasFrame && engine >= 1 && cab < 1 && <Hoist y={2.2 + (1 - cab) * 3.0} visible />}

      {/* A boom that has been called but not yet pinned waits on its own stand,
          which is what makes "we have a boom and no frame" a visible state. */}
      {hasBoom && boom < 1 && (
        <group position={[0.4, 0, 2.4]}>
          <PartStand w={3.4} d={2.0} />
          <group position={[0, 0.34, 0]}>
            <LoosePart code="b" finish="painted" />
          </group>
        </group>
      )}

      <StackLight
        position={[-3.1, 0, -2.4]}
        green={hasFrame && hasBoom}
        amber={starving}
        red={boolOf(machine.starved) || boolOf(machine.jam)}
      />
    </group>
  );
}

// --- Test bay and yard --------------------------------------------------------------

const TestShell = memo(function TestShell() {
  return (
    <group>
      <mesh position={[0, 0.09, 0]} receiveShadow>
        <boxGeometry args={[6.0, 0.18, 4.6]} />
        <meshStandardMaterial color="#333b46" roughness={0.92} metalness={0.05} />
      </mesh>
      {/* Hydraulic power pack and its accumulator bottles. */}
      <group position={[-2.4, 0, -1.9]}>
        <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 1.2, 1.0]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0.55, 1.5, z]} castShadow>
            <cylinderGeometry args={[0.17, 0.17, 0.7, 14]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

interface TestRefs {
  needle: THREE.Group | null;
  machine: THREE.Group | null;
}

function TestBay({ machine }: { machine: MachineState }) {
  const refs = useRef<TestRefs>({ needle: null, machine: null });
  const here = boolOf(machine.testPart);
  const pump = clamp01(numOf(machine.testPump));
  const cycle = clamp01(numOf(machine.testCycle));
  const dispatch = clamp01(numOf(machine.testDispatch));

  // The function test is the payoff of the whole line: the machine works its own
  // boom. Angles are a pure function of `testCycle`, so a replay scrub shows the
  // arm exactly where the live run had it.
  const sweep = Math.sin(cycle * Math.PI * 4);
  const boomAngle = 0.42 + sweep * 0.3;
  const stickAngle = -1.45 - sweep * 0.42;
  const bucketAngle = -0.8 + sweep * 0.75;

  useFrame(() => {
    const r = refs.current;
    if (r.needle) r.needle.rotation.z = Math.PI * 0.75 - pump * Math.PI * 1.5;
    // Dispatch drives it off the pad toward the yard, which is -x on this row.
    if (r.machine) r.machine.position.x = -dispatch * 5.5;
  });

  return (
    <group position={[TEST_X, 0, ROW_B]}>
      <TestShell />

      {/* Pressure gauge on the power pack: the interlock the bay is famous for. */}
      <group position={[-2.4, 1.35, -1.35]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.07, 22]} />
          <meshStandardMaterial color="#e7ecf2" roughness={0.5} metalness={0.2} />
        </mesh>
        <group
          ref={(g) => {
            refs.current.needle = g;
          }}
          position={[0, 0, 0.06]}
        >
          <mesh position={[0.1, 0, 0]}>
            <boxGeometry args={[0.22, 0.03, 0.01]} />
            <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.5} />
          </mesh>
        </group>
      </group>

      {here && (
        <group
          ref={(g) => {
            refs.current.machine = g;
          }}
        >
          <group position={[0, 0.18, 0]} rotation={[0, Math.PI, 0]}>
            <Excavator
              finish="painted"
              boomAngle={boomAngle}
              stickAngle={stickAngle}
              bucketAngle={bucketAngle}
            />
          </group>
        </group>
      )}

      <StackLight
        position={[2.9, 0, -2.1]}
        green={cycle >= 1}
        amber={here && pump < 1}
        red={boolOf(machine.jam) || boolOf(machine.blocked)}
      />
    </group>
  );
}

/** Finished machines, parked nose-in. Six spaces, and filling them stops the line. */
function Yard({ count }: { count: number }) {
  const spaces = YARD_ROW_Z.flatMap((z) => YARD_COL_X.map((x) => [x, z] as const));
  return (
    <group>
      {/* Painted bays, drawn whether or not anything is standing in them, so the
          yard reads as "4 of 6" rather than as a random scatter of machines. */}
      {spaces.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.014, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.5, 4.0]} />
          <meshStandardMaterial color="#3a424e" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      {spaces.slice(0, Math.max(0, Math.min(spaces.length, Math.round(count)))).map(([x, z]) => (
        <group key={`m${x},${z}`} position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
          <Excavator finish="painted" boomAngle={0.3} stickAngle={-1.8} bucketAngle={-0.4} />
        </group>
      ))}
      {/* Mesh fence along the far side, and two light masts. The yard is where
          the plant's output accumulates, so it should look like somewhere a
          machine gets handed over rather than like more shop floor. */}
      <group position={[FLOOR.x0 + 1.1, 0, YARD_ROW_Z[1] - 1.4]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.1, 0]}>
          <planeGeometry args={[10.5, 2.2]} />
          <meshStandardMaterial
            color="#7d8794"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            roughness={0.8}
            metalness={0.3}
          />
        </mesh>
        {[-5.2, -2.6, 0, 2.6, 5.2].map((x) => (
          <mesh key={x} position={[x, 1.1, 0]} castShadow>
            <boxGeometry args={[0.11, 2.2, 0.11]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        ))}
      </group>
      {[YARD_COL_X[0] + 1.4, YARD_COL_X[2] - 1.2].map((x) => (
        <group key={x} position={[x, 0, YARD_ROW_Z[1] + 2.2]}>
          <mesh position={[0, 3.0, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.16, 6.0, 10]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[0, 6.02, 0.26]} rotation={[0.9, 0, 0]} castShadow={false}>
            <boxGeometry args={[0.8, 0.12, 0.34]} />
            <meshStandardMaterial color="#8f9aa6" emissive="#fde68a" emissiveIntensity={0.12} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// --- Buffers -----------------------------------------------------------------------

/** The weld buffer: a queue whose contents and order are both readable. */
function WeldBuffer({ queue }: { queue: string }) {
  return (
    <group position={[0, 0, ROW_A]}>
      {WP_SLOT_X.map((x, i) => (
        // Cross-loaded, the way a buffer rail between two stations really is:
        // the parts sit square to the flow so three of them fit in 5 m of aisle.
        <group key={x} position={[x, 0, 2.4]} rotation={[0, Math.PI / 2, 0]}>
          <PartStand w={3.4} d={2.0} />
          {queue[i] !== undefined && (
            <group position={[0, 0.34, 0]}>
              <LoosePart code={queue[i]} finish="bare" />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * The painted buffers, two lanes running across the plant into final assembly.
 *
 * This is the picture the whole category is about. One lane full and the other
 * empty *is* the wrong-mix failure, standing there in the middle of the floor
 * several seconds before the starve latch trips.
 */
function PaintedBuffers({ frames, booms }: { frames: number; booms: number }) {
  const lane = (x: number, count: number, code: string) => (
    <group position={[x, 0, 0]}>
      {PA_SLOT_Z.map((z, i) => (
        // These lanes run in z, so the parts lie nose-to-tail along them.
        <group key={z} position={[0, 0, z]} rotation={[0, Math.PI / 2, 0]}>
          <PartStand w={3.4} d={2.0} />
          {i < count && (
            <group position={[0, 0.34, 0]}>
              <LoosePart code={code} finish="painted" />
            </group>
          )}
        </group>
      ))}
    </group>
  );
  return (
    <>
      {lane(PA_LANE_X.f, frames, 'f')}
      {lane(PA_LANE_X.b, booms, 'b')}
    </>
  );
}

/** Finished machines waiting for the test bay. */
function TestQueue({ count }: { count: number }) {
  return (
    <group position={[0, 0, ROW_B]}>
      {AT_SLOT_X.map((x, i) => (
        <group key={x} position={[x, 0, 0]}>
          {i < count && (
            <group rotation={[0, Math.PI, 0]}>
              <Excavator finish="painted" boomAngle={0.3} stickAngle={-1.8} bucketAngle={-0.4} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

// --- Building ------------------------------------------------------------------------

const Building = memo(function Building({ tex }: { tex: Textures }) {
  const w = FLOOR.x1 - FLOOR.x0;
  const d = FLOOR.z1 - FLOOR.z0;
  const cx = (FLOOR.x0 + FLOOR.x1) / 2;
  const cz = (FLOOR.z0 + FLOOR.z1) / 2;
  const WALL_H = 7.2;
  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.concrete} roughness={0.96} metalness={0} />
      </mesh>

      {/* Two walls only: the far one and the left one. Boxing the plant in on
          all four sides would put a wall between the camera and the machine at
          every orbit angle the player is likely to want.

          There is deliberately no roof and there are deliberately no trusses.
          The first version had a run of them overhead, and from the plant view
          they striped the entire floor with hard shadows — the plant was read
          through a set of bars. Overhead structure is exactly the thing a
          top-down camera cannot afford. */}
      <mesh position={[cx, WALL_H / 2, FLOOR.z0]} receiveShadow>
        <planeGeometry args={[w, WALL_H]} />
        <meshStandardMaterial color="#333c48" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[FLOOR.x0, WALL_H / 2, cz]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[d, WALL_H]} />
        <meshStandardMaterial color="#2c343f" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* A band of clerestory glazing high up, and the eaves beam under it. The
          two together are what make a flat plane read as the wall of a shed
          rather than as the edge of the world. */}
      <mesh position={[cx, WALL_H - 1.1, FLOOR.z0 + 0.05]}>
        <planeGeometry args={[w - 1, 1.5]} />
        <meshStandardMaterial
          color="#8fb4cf"
          emissive="#7ba0bd"
          emissiveIntensity={0.55}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[cx, WALL_H - 2.1, FLOOR.z0 + 0.12]} castShadow={false}>
        <boxGeometry args={[w, 0.34, 0.24]} />
        <meshStandardMaterial color="#4b5563" metalness={0.4} roughness={0.7} />
      </mesh>
      {/* Stanchions down the back wall, flat against it so they cast nothing
          onto the floor the player is trying to read. */}
      {Array.from({ length: 8 }, (_, i) => {
        const x = FLOOR.x0 + 2 + (i * (w - 4)) / 7;
        return (
          <mesh key={x} position={[x, WALL_H / 2, FLOOR.z0 + 0.14]} castShadow={false}>
            <boxGeometry args={[0.26, WALL_H, 0.26]} />
            <meshStandardMaterial color="#414b58" metalness={0.35} roughness={0.75} />
          </mesh>
        );
      })}
    </group>
  );
});

// --- Camera ----------------------------------------------------------------------------

interface Focus {
  center: [number, number, number];
  halfWidth: number;
  halfHeight: number;
  /** Unit-ish direction from the target toward the camera. */
  dir: [number, number, number];
}

/** Direction only — `SectionCamera` derives the distance from the viewport. */
const PLANT_TARGET: [number, number, number] = [-0.6, 1.0, 0.5];
const START_POS: [number, number, number] = [1.2, 22, 26];

const PLANT_FOCUS: Focus = {
  center: PLANT_TARGET,
  halfWidth: 17,
  halfHeight: 11.5,
  dir: [0.05, 0.74, 0.67],
};

/**
 * Where the camera sits for each section.
 *
 * Row A is at the back of the floor and row B at the front, so a bay's preset
 * puts the camera *between* the rows rather than behind them — otherwise
 * focusing the weld bay frames the back of the test bay.
 */
const SECTION_FOCUS: Record<string, Focus> = {
  [FACTORY_SECTIONS.weld]: {
    // Wide enough to hold the fixture, the gantry and the buffer rail it feeds:
    // a bay framed to its own footprint crops its gantry and tells you nothing
    // about what it is connected to.
    center: [WELD_X + 1.4, 1.6, ROW_A + 0.4],
    halfWidth: 7.4,
    halfHeight: 4.6,
    dir: [-0.2, 0.46, 0.86],
  },
  [FACTORY_SECTIONS.paint]: {
    center: [(BOOTH_X + OVEN_X) / 2, 1.9, ROW_A],
    halfWidth: 8.2,
    halfHeight: 5.0,
    dir: [0.04, 0.44, 0.9],
  },
  [FACTORY_SECTIONS.assembly]: {
    center: [ASSY_X - 0.6, 1.8, ROW_B - 0.4],
    halfWidth: 7.6,
    halfHeight: 4.8,
    dir: [0.3, 0.44, 0.85],
  },
  [FACTORY_SECTIONS.test]: {
    center: [TEST_X - 1.6, 1.4, ROW_B],
    halfWidth: 8.6,
    halfHeight: 4.6,
    dir: [-0.18, 0.42, 0.89],
  },
};

const FLY_MS = 750;

/**
 * Flies the camera to the focused bay.
 *
 * Distance is derived from the live viewport rather than baked into a position,
 * for the same reason `MachineCanvas`'s `FitCamera` does it: a fixed camera
 * frames whatever aspect ratio it was tuned at, and this panel is resizable by
 * design. `MachineCanvas` is given no `fitExtent` here so that this is the only
 * thing touching the camera — two authorities would fight on every resize.
 */
function SectionCamera({ focus }: { focus: Focus }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  const anim = useRef({
    t: 1,
    fromPos: new THREE.Vector3(),
    fromTgt: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toTgt: new THREE.Vector3(),
  });

  const goal = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vTan = Math.tan((cam.fov * Math.PI) / 360);
    const hTan = vTan * (width / height || 1.6);
    const dist = Math.max(focus.halfWidth / hTan, focus.halfHeight / vTan);
    const target = new THREE.Vector3(...focus.center);
    const dir = new THREE.Vector3(...focus.dir).normalize();
    return { target, position: target.clone().addScaledVector(dir, dist) };
  }, [camera, focus, width, height]);

  // Retargeting from wherever the camera currently is, rather than from a fixed
  // start, is what lets this re-run harmlessly: `controls` resolves a frame
  // after mount, and the repeat is then a fly from here to the same place.
  useEffect(() => {
    const a = anim.current;
    a.fromPos.copy(camera.position);
    a.fromTgt.copy(controls?.target ?? new THREE.Vector3(...PLANT_TARGET));
    a.toPos.copy(goal.position);
    a.toTgt.copy(goal.target);
    a.t = 0;
  }, [goal, camera, controls]);

  useFrame((_state, dt) => {
    const a = anim.current;
    if (a.t >= 1) return;
    a.t = Math.min(1, a.t + (dt * 1000) / FLY_MS);
    // Smoothstep, so the move eases out of the old frame and into the new one
    // instead of jerking to a halt on arrival.
    const e = a.t * a.t * (3 - 2 * a.t);
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    if (controls) {
      controls.target.lerpVectors(a.fromTgt, a.toTgt, e);
    } else {
      camera.lookAt(a.toTgt);
    }
  });

  return null;
}

// --- The plant --------------------------------------------------------------------------

/**
 * The bare plant, with no canvas around it — so the composed view and any future
 * standalone bay view can both mount the same geometry.
 */
export function FactoryRig({
  machine,
  outputs,
  section,
}: {
  machine: MachineState;
  /** The live coil image, for the things a state snapshot cannot tell apart
      (a torch that is *striking* rather than a seam that merely stopped). */
  outputs: Record<string, boolean>;
  section?: string;
}) {
  const tex = useMemo(() => buildTextures(), []);
  useEffect(
    () => () => {
      tex.concrete.dispose();
      tex.lane.dispose();
      Object.values(tex.signs).forEach((t) => t.dispose());
    },
    [tex],
  );

  const focus = (section && SECTION_FOCUS[section]) || PLANT_FOCUS;

  return (
    <group>
      <SectionCamera focus={focus} />
      {/* A plant floor is lit from a hundred fittings, not from one sun. Without
          this lift the shop reads as a night scene and the dark parts on the
          buffer rails disappear into the slab. */}
      <ambientLight intensity={0.5} />
      <Building tex={tex} />

      {/* Flow lanes: +x along row A, across at the buffers, -x along row B. */}
      <Lane tex={tex.lane} x={-4.0} z={ROW_A + 2.4} length={13.0} />
      <Lane
        tex={tex.lane}
        x={(PA_LANE_X.f + PA_LANE_X.b) / 2}
        z={-1.4}
        length={10.5}
        width={4.4}
        rotY={Math.PI / 2}
      />
      <Lane tex={tex.lane} x={2.0} z={ROW_B} length={16.0} rotY={Math.PI} />

      {/* Every sign faces +z and stands *behind* its bay. Row B's used to be
          rotated to face the other way, which put them between the camera and
          the machine and rendered every one of them mirrored. */}
      <BaySign tex={tex.signs.WELD} x={WELD_X} z={ROW_A - 2.6} y={4.4} />
      <BaySign tex={tex.signs.PAINT} x={(BOOTH_X + OVEN_X) / 2} z={ROW_A - 2.8} y={4.6} />
      <BaySign tex={tex.signs.ASSEMBLY} x={ASSY_X} z={ROW_B - 3.6} y={4.4} />
      <BaySign tex={tex.signs.TEST} x={TEST_X} z={ROW_B - 3.4} y={4.0} />
      {/* The yard sign sits close in against its own bays: any further back and
          it stands directly in the weld bay's camera preset. */}
      <BaySign tex={tex.signs.YARD} x={YARD_COL_X[1]} z={YARD_ROW_Z[0] - 1.0} y={4.0} />

      <WeldBay machine={machine} torchOn={outputs.Y3 === true} />
      <WeldBuffer queue={strOf(machine.bufWp)} />
      <PaintBay machine={machine} spraying={outputs.Y8 === true} />
      <PaintedBuffers frames={numOf(machine.bufPaFrames)} booms={numOf(machine.bufPaBooms)} />
      <AssemblyBay machine={machine} />
      <TestQueue count={numOf(machine.bufAt)} />
      <TestBay machine={machine} />
      <Yard count={numOf(machine.yard)} />
    </group>
  );
}

export function Factory3D({
  machine,
  outputs,
  section,
  height = 300,
}: {
  machine: MachineState;
  outputs: Record<string, boolean>;
  section?: string;
  height?: number | string;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={START_POS}
      fov={34}
      target={PLANT_TARGET}
      minDistance={4}
      maxDistance={80}
      polarRange={[0.25, 1.35]}
      panBounds={{ x: [-16, 15], y: [-1, 8], z: [-10, 12] }}
      // The floor is 32 x 23; the single-machine default of 16 would drop half
      // the plant out of the shadow map and stop its shadows at a line.
      shadowExtent={22}
      interactive
    >
      <FactoryRig machine={machine} outputs={outputs} section={section} />
    </MachineCanvas>
  );
}
