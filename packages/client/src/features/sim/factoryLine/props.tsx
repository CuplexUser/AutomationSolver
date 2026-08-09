import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  CONV,
  DARK_STEEL,
  MACHINE,
  MESH_GUARD,
  POWER,
  RUBBER,
  STEEL,
  STRUCTURE,
  type Box,
  type ConveyorRun,
} from './plant';
import type { LineTextures } from './textures';

/**
 * The kit every cell on the line is dressed with.
 *
 * Almost all of the readability in the reference plant comes from a small
 * vocabulary applied everywhere rather than from any one machine being
 * detailed: fencing you cannot walk through, tape on everything that can hurt
 * you, a lit screen at every cell and a stack light saying what that cell is
 * doing. Building these once and using them eight times is also what keeps the
 * cell files short enough to read.
 */

// --- Guarding -----------------------------------------------------------------

/**
 * A run of woven mesh fence panels on posts.
 *
 * Doubles as the cameras' near-field occluder, which is not a side effect but
 * half the reason the low presets read as depth rather than as flat elevation.
 */
export const FenceRun = memo(function FenceRun({
  tex,
  from,
  to,
  height = 2.2,
}: {
  tex: THREE.CanvasTexture;
  from: [number, number];
  to: [number, number];
  height?: number;
}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  // `atan2(-dz, dx)` and *not* the `atan2(dx, dz)` its neighbours use, because
  // this run is built along local **x** — the panel is `planeGeometry(len,
  // height)`, and the posts and the top rail are both spaced along x — while
  // `Conveyor` and `ServiceRun` build along local z. A rotation about Y maps
  // local +x to `(cos, 0, -sin)`, so aligning it with `(dx, dz)` is this, and
  // borrowing the neighbours' formula turns every fence 90 degrees about its own
  // centre. It did: the weld bay's west guard was drawn across z = -12 straight
  // through the positioner, its north guard reached 5 m past the building wall,
  // and the store's ran lengthwise through the rack. Everything reported as
  // colliding or as sticking outside the plant was this one line.
  const angle = Math.atan2(-dz, dx);
  const posts = Math.max(2, Math.round(len / 2.5) + 1);

  const own = useMemo(() => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(len / 0.42)), Math.max(1, Math.round(height / 0.42)));
    return t;
  }, [tex, len, height]);
  useEffect(() => () => own.dispose(), [own]);

  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[len, height]} />
        <meshStandardMaterial
          map={own}
          transparent
          alphaTest={0.35}
          side={THREE.DoubleSide}
          {...MESH_GUARD}
        />
      </mesh>
      {Array.from({ length: posts }, (_, i) => (
        <mesh
          key={i}
          position={[-len / 2 + (i * len) / (posts - 1), height / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.08, height, 0.08]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      ))}
      {/* Top rail, which is what stops a fence reading as a floating net. */}
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[len, 0.07, 0.07]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
    </group>
  );
});

/** Fence three sides of a cell, leaving the aisle side open to the camera. */
export const CellGuard = memo(function CellGuard({
  tex,
  box,
  open = 'south',
}: {
  tex: LineTextures['mesh'];
  box: Box;
  /** Which side is left unfenced, so a preset can see in. */
  open?: 'north' | 'south';
}) {
  const { x0, x1, z0, z1 } = box;
  const runs: Array<[[number, number], [number, number]]> = [
    [[x0, z0], [x1, z0]],
    [[x0, z1], [x1, z1]],
    [[x0, z0], [x0, z1]],
    [[x1, z0], [x1, z1]],
  ];
  const drop = open === 'south' ? 1 : 0;
  return (
    <group>
      {runs.map((r, i) => (i === drop ? null : <FenceRun key={i} tex={tex} from={r[0]} to={r[1]} />))}
    </group>
  );
});

// --- Conveyor -----------------------------------------------------------------

/**
 * One straight run of zoned roller conveyor.
 *
 * The zone ticks are drawn as bright stubs across the deck rather than as
 * anything structural: a zone boundary is a decision the program makes, not a
 * thing bolted to the frame, and the player needs to see where those decisions
 * fall when a queue starts backing up against them.
 */
export const Conveyor = memo(function Conveyor({
  tex,
  run,
}: {
  tex: LineTextures;
  run: ConveyorRun;
}) {
  const dx = run.to[0] - run.from[0];
  const dz = run.to[1] - run.from[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const cxm = (run.from[0] + run.to[0]) / 2;
  const czm = (run.from[1] + run.to[1]) / 2;

  const deck = useMemo(() => {
    const t = tex.roller.clone();
    t.needsUpdate = true;
    t.rotation = Math.PI / 2;
    t.center.set(0.5, 0.5);
    t.repeat.set(1, Math.max(1, Math.round(len / 0.9)));
    return t;
  }, [tex.roller, len]);
  useEffect(() => () => deck.dispose(), [deck]);

  const legs = Math.max(2, Math.round(len / 3) + 1);

  return (
    <group position={[cxm, 0, czm]} rotation={[0, angle, 0]}>
      {/* Roller deck */}
      <mesh position={[0, CONV.deckY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[CONV.width, len]} />
        <meshStandardMaterial map={deck} roughness={0.5} metalness={0.55} />
      </mesh>
      {/* Side rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * CONV.width) / 2, CONV.railY, 0]} castShadow>
          <boxGeometry args={[0.09, 0.2, len]} />
          <meshStandardMaterial {...STRUCTURE} />
        </mesh>
      ))}
      {/* Frame skirt, so the deck does not float */}
      <mesh position={[0, CONV.deckY - 0.16, 0]}>
        <boxGeometry args={[CONV.width - 0.02, 0.16, len]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      {/* Legs */}
      {Array.from({ length: legs }, (_, i) => (
        <mesh key={i} position={[0, (CONV.deckY - 0.24) / 2, -len / 2 + (i * len) / (legs - 1)]}>
          <boxGeometry args={[CONV.width * 0.7, CONV.deckY - 0.24, 0.09]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
      {/* Zone boundaries: where accumulation actually happens. */}
      {Array.from({ length: Math.max(0, run.zones - 1) }, (_, i) => {
        const t = (i + 1) / run.zones;
        return (
          <mesh
            key={i}
            position={[0, CONV.deckY + 0.012, -len / 2 + t * len]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[CONV.width, 0.09]} />
            <meshStandardMaterial color="#e8621a" emissive="#e8621a" emissiveIntensity={0.5} />
          </mesh>
        );
      })}
    </group>
  );
});

/** A photo-eye on its bracket: one per zone, and the thing the program reads. */
export const PhotoEye = memo(function PhotoEye({
  x,
  z,
  on = false,
}: {
  x: number;
  z: number;
  on?: boolean;
}) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, CONV.deckY + 0.18, 0]} castShadow>
        <boxGeometry args={[0.12, 0.36, 0.1]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[0, CONV.deckY + 0.3, 0.06]}>
        <sphereGeometry args={[0.045, 10, 8]} />
        <meshStandardMaterial
          color={on ? '#ff5a3c' : '#5c2418'}
          emissive={on ? '#ff5a3c' : '#000000'}
          emissiveIntensity={on ? 2 : 0}
        />
      </mesh>
    </group>
  );
});

// --- Cell furniture -----------------------------------------------------------

/**
 * A stack light, which is how a real bay says what it is doing from 30 m away.
 *
 * Reading the whole plant from the overview shot without a single label is the
 * point: a player who has learned that amber means blocked can see the
 * constraint move as they change the program.
 */
export const StackLight = memo(function StackLight({
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
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2.2, 10]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {lamps.map(([color, on], i) => (
        <mesh key={color} position={[0, 2.42 + i * 0.26, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.24, 14]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={on ? 1.7 : 0.04}
            roughness={0.4}
            transparent
            opacity={on ? 1 : 0.5}
          />
        </mesh>
      ))}
    </group>
  );
});

/**
 * The lit screen on a stalk at every cell.
 *
 * The in-world version of the IO list, and the thing that gives a low camera
 * something bright to hold in the mid-field. A shop floor at night is mostly
 * dark shapes and a handful of screens.
 */
export const HmiPost = memo(function HmiPost({
  tex,
  x,
  z,
  rotY = 0,
}: {
  tex: THREE.CanvasTexture;
  x: number;
  z: number;
  rotY?: number;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 1.24, 8]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[0, 1.38, 0]} rotation={[-0.32, 0, 0]} castShadow>
        <boxGeometry args={[0.56, 0.42, 0.07]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      <mesh position={[0, 1.395, 0.043]} rotation={[-0.32, 0, 0]}>
        <planeGeometry args={[0.46, 0.32]} />
        <meshStandardMaterial map={tex} emissive="#2ea8c4" emissiveIntensity={0.7} />
      </mesh>
    </group>
  );
});

/** A cell's control cabinet: where the stack light and the HMI hang off. */
export const Cabinet = memo(function Cabinet({
  x,
  z,
  rotY = 0,
  w = 1.1,
  h = 2.0,
  d = 0.55,
}: {
  x: number;
  z: number;
  rotY?: number;
  w?: number;
  h?: number;
  d?: number;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      {/* Door seam and handle, which is all it takes to stop a box being a box. */}
      <mesh position={[0, h / 2, d / 2 + 0.005]}>
        <planeGeometry args={[w - 0.1, h - 0.14]} />
        <meshStandardMaterial color="#42505f" roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh position={[w / 2 - 0.16, h / 2, d / 2 + 0.03]}>
        <boxGeometry args={[0.05, 0.22, 0.05]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
    </group>
  );
});

/**
 * A person, for scale.
 *
 * Three boxes and a sphere. Nothing else in the scene establishes that an
 * excavator is 4 m tall as cheaply, and a plant with nobody in it reads as a
 * model of a plant.
 */
export const Figure = memo(function Figure({
  x,
  z,
  rotY = 0,
  vest = '#f97316',
}: {
  x: number;
  z: number;
  rotY?: number;
  vest?: string;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.34, 0.84, 0.24]} />
        <meshStandardMaterial color="#2c3542" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.12, 0]} castShadow>
        <boxGeometry args={[0.42, 0.58, 0.28]} />
        <meshStandardMaterial color={vest} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.54, 0]} castShadow>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color="#c9a58b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.64, 0]} castShadow>
        <sphereGeometry args={[0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f5f5f5" roughness={0.5} />
      </mesh>
    </group>
  );
});

/** A paint drum on the wall, with a colour band round it. */
export const Drum = memo(function Drum({
  x,
  z,
  color,
}: {
  x: number;
  z: number;
  color: string;
}) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.29, 0.29, 0.88, 18]} />
        <meshStandardMaterial color="#22262c" metalness={0.5} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.2, 18]} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.89, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 18]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
    </group>
  );
});

/**
 * Overhead pipe and cable tray.
 *
 * Explicitly casts no shadow. `Building.tsx` in the old plant learned this the
 * hard way: a run of trusses striped the entire floor with hard bars and the
 * plant was read through them. Overhead structure is exactly the thing a
 * top-down camera cannot afford.
 */
export const ServiceRun = memo(function ServiceRun({
  from,
  to,
  y,
  drops = [],
}: {
  from: [number, number];
  to: [number, number];
  y: number;
  /** Where a riser comes down to a cell, as a point along the run. */
  drops?: Array<[number, number]>;
}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  return (
    <group>
      <group position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
        <mesh castShadow={false}>
          <boxGeometry args={[0.34, 0.16, len]} />
          <meshStandardMaterial {...POWER} />
        </mesh>
        {/* The pipe runs *along* the tray, so the cylinder is laid down on the
            mesh — a rotation on the geometry is silently ignored. */}
        <mesh position={[0, 0.26, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow={false}>
          <cylinderGeometry args={[0.11, 0.11, len, 10]} />
          <meshStandardMaterial color="#c2560f" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
      {/* Risers, which go all the way to the slab. They used to stop 2.4 m up —
          seven orange posts hanging in the air over the walkway with nothing
          under them, which is the single most visible way to say "this is a
          model" rather than "this is a building". A drop lands on something, so
          each one now runs to the floor and ends in a disconnect. */}
      {drops.map(([dxp, dzp], i) => (
        <group key={i} position={[dxp, 0, dzp]}>
          <mesh position={[0, y / 2, 0]} castShadow={false}>
            <boxGeometry args={[0.18, y, 0.18]} />
            <meshStandardMaterial {...POWER} />
          </mesh>
          <mesh position={[0, 1.35, 0.12]} castShadow>
            <boxGeometry args={[0.34, 0.46, 0.2]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

/** A material, in the shape `<meshStandardMaterial {...mat} />` wants. */
export interface PartMat {
  color: string;
  metalness: number;
  roughness: number;
}

/**
 * A part, drawn at the origin in whatever color it has been painted.
 *
 * The plant's own excavator components (`factory/Excavator.tsx`) take a *finish
 * name*, which was enough when every painted machine on the floor was the same
 * yellow. This line builds to an order book and both halves of a machine carry
 * its color, so a part has to be drawn in a color chosen at run time — which
 * means the material comes in as a prop and the geometry is kept to the two
 * silhouettes that have to be told apart across a shop floor.
 */
export const PartBody = memo(function PartBody({
  kind,
  mat,
  scale = 1,
}: {
  kind: 'f' | 'b';
  mat: PartMat;
  scale?: number;
}) {
  if (kind === 'b') {
    // A boom lies folded: a long arm, a shorter stick and a bucket.
    return (
      <group scale={scale}>
        <mesh position={[-0.35, 0.2, 0]} rotation={[0, 0, 0.06]} castShadow receiveShadow>
          <boxGeometry args={[2.1, 0.34, 0.3]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[1.05, 0.28, 0]} rotation={[0, 0, -0.18]} castShadow>
          <boxGeometry args={[1.4, 0.26, 0.26]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[1.75, 0.24, 0]} castShadow>
          <boxGeometry args={[0.42, 0.4, 0.46]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      </group>
    );
  }
  // A frame is an undercarriage: two tracks, a car body and a slew ring.
  return (
    <group scale={scale}>
      {[-0.62, 0.62].map((z) => (
        <mesh key={z} position={[0, 0.24, z]} castShadow receiveShadow>
          <boxGeometry args={[2.3, 0.48, 0.44]} />
          <meshStandardMaterial {...RUBBER} />
        </mesh>
      ))}
      <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.34, 1.3]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, 0.76, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.62, 0.16, 20]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    </group>
  );
});

/**
 * A whole machine, at whatever stage of its build it has reached.
 *
 * Each fitting is a 0..1 progress rather than a flag, because the jig's whole
 * subject is watching one go on: the engine comes down off the gantry, the cab
 * lands on the deck, the boom swings onto its pin. A machine drawn only when it
 * is finished would make the one interesting cell on the line a still life.
 */
export const MachineBody = memo(function MachineBody({
  mat,
  engine = 1,
  cab = 1,
  boom = 1,
  boomMat,
  swing = 0,
}: {
  mat: PartMat;
  engine?: number;
  cab?: number;
  boom?: number;
  /** The boom's own color, which on a mis-married machine is not the frame's. */
  boomMat?: PartMat;
  /** Boom lift, 0 parked to 1 raised — the test bay's one moving picture. */
  swing?: number;
}) {
  const bm = boomMat ?? mat;
  return (
    <group>
      <PartBody kind="f" mat={mat} />
      {engine > 0 && (
        // Above 0 and below 1 the house is still on its way down off the hoist.
        <group position={[0, 0.76 + (1 - engine) * 2.6, 0]}>
          <mesh position={[-0.35, 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.7, 0.84, 1.5]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          <mesh position={[-1.15, 0.5, 0]} castShadow>
            <boxGeometry args={[0.3, 0.6, 1.2]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      )}
      {cab > 0 && (
        <group position={[0.45, 0.76 + (1 - cab) * 3.0, 0.42]}>
          <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.86, 1.2, 0.8]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          <mesh position={[0.44, 0.72, 0]}>
            <boxGeometry args={[0.04, 0.72, 0.66]} />
            <meshStandardMaterial color="#9fc4dc" metalness={0.2} roughness={0.15} />
          </mesh>
        </group>
      )}
      {boom > 0 && (
        // Un-pinned, the boom hangs back and above its eye, so pinning reads as
        // the arm coming down onto the machine rather than as a part appearing.
        <group
          position={[0.9, 1.0 + (1 - boom) * 1.9, 0]}
          rotation={[0, 0, (1 - boom) * 0.7 + swing * 0.5]}
        >
          <mesh position={[0.95, 0.5, 0]} rotation={[0, 0, 0.55]} castShadow>
            <boxGeometry args={[2.3, 0.32, 0.3]} />
            <meshStandardMaterial {...bm} />
          </mesh>
          <mesh position={[2.15, 0.35, 0]} rotation={[0, 0, -0.95 - swing * 0.4]} castShadow>
            <boxGeometry args={[1.5, 0.26, 0.26]} />
            <meshStandardMaterial {...bm} />
          </mesh>
          <mesh position={[2.75, -0.35, 0]} castShadow>
            <boxGeometry args={[0.46, 0.44, 0.5]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      )}
    </group>
  );
});

/** A part riding the line, at a point on a deck. */
export const Part = memo(function Part({
  x,
  z,
  y = CONV.deckY,
  kind,
  finish,
  rotY = 0,
  scale = 1,
}: {
  x: number;
  z: number;
  y?: number;
  kind: 'f' | 'b';
  finish: PartMat;
  rotY?: number;
  scale?: number;
}) {
  return (
    <group position={[x, y, z]} rotation={[0, rotY, 0]}>
      <PartBody kind={kind} mat={finish} scale={scale} />
    </group>
  );
});

export { RUBBER };
