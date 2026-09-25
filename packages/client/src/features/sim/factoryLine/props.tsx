import { memo, useLayoutEffect } from 'react';
import { staticPart } from '../StaticBatch';
import { ExcavatorMachine, ExcavatorPart } from '../excavator/KitExcavator';
import { meshesIn, node, ownMaterial } from '../plant/kit';
import { SplitPiece, StaticPiece, usePlantSplit } from '../plant/PlantAsset';
import * as THREE from 'three';
import { CONV, MESH_GUARD, RUBBER, SPINE_TURNS, type Box, type ConveyorRun } from './plant';
import type { LineTextures } from './textures';

/**
 * The kit every cell on the line is dressed with.
 *
 * Almost all of the readability in the reference plant comes from a small
 * vocabulary applied everywhere rather than from any one machine being
 * detailed: fencing you cannot walk through, tape on everything that can hurt
 * you, a lit screen at every cell and a stack light saying what that cell is
 * doing. Each is a plant kit asset (`plant/kit.ts`); building them once and
 * using them eight times is also what keeps the cell files short enough to read.
 */

// --- Guarding -----------------------------------------------------------------

/** One woven mesh material per texture, shared by every panel that uses it. */
const fenceMaterials = new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();

function fenceMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  let m = fenceMaterials.get(tex);
  if (!m) {
    const t = tex.clone();
    t.needsUpdate = true;
    // A 2.0 x 2.0 m panel at the weave's 0.42 m pitch.
    t.repeat.set(5, 5);
    m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, ...MESH_GUARD });
    fenceMaterials.set(tex, m);
  }
  return m;
}

function weave(obj: THREE.Object3D, tex: THREE.Texture): void {
  for (const mesh of meshesIn(obj, 'Fence Mesh')) mesh.material = fenceMaterial(tex);
}

/**
 * A run of woven mesh fence panels on posts.
 *
 * Doubles as the cameras' near-field occluder, which is not a side effect but
 * half the reason the low presets read as depth rather than as flat elevation.
 * The kit's panel is 2 m; a run takes as many as fit and stretches them to meet.
 */
export const FenceRun = memo(
  staticPart(function FenceRun({
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
    // this run is built along local **x** (the kit's panel spans its x), while
    // `Conveyor` and `ServiceRun` build along local z. A rotation about Y maps
    // local +x to `(cos, 0, -sin)`, so aligning it with `(dx, dz)` is this, and
    // borrowing the neighbours' formula turns every fence 90 degrees about its own
    // centre. It did once: the weld bay's west guard was drawn straight through
    // the positioner, and everything reported as colliding was this one line.
    const angle = Math.atan2(-dz, dx);
    const panels = Math.max(1, Math.round(len / 2));
    const pitch = len / panels;
    const sy = height / 2.2;
    return (
      <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
        {Array.from({ length: panels }, (_, i) => (
          <StaticPiece
            key={i}
            name="FencePanel"
            prepare={weave}
            arg={tex}
            x={-len / 2 + (i + 0.5) * pitch}
            scale={[pitch / 2, sy, 1]}
          />
        ))}
        {Array.from({ length: panels + 1 }, (_, i) => (
          <StaticPiece key={`p${i}`} name="FencePost" x={-len / 2 + i * pitch} scale={[1, sy, 1]} />
        ))}
      </group>
    );
  }),
);

/** Fence three sides of a cell, leaving the aisle side open to the camera. */
export const CellGuard = memo(
  staticPart(function CellGuard({
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
  }),
);

// --- Conveyor -----------------------------------------------------------------

/** The kit's zone module is 1.5 m long; a run takes as many as fit and stretches them to meet. */
const MODULE_LEN = 1.5;

/** Whether a spine turn sits at this point, so a run stops short of the corner piece. */
const atTurn = (p: [number, number]): boolean => SPINE_TURNS.some((t) => t.at[0] === p[0] && t.at[1] === p[1]);

/**
 * One straight run of zoned roller conveyor, built from the kit's modules.
 *
 * The zone ticks are drawn as bright stubs across the deck rather than as
 * anything structural: a zone boundary is a decision the program makes, not a
 * thing bolted to the frame, and the player needs to see where those decisions
 * fall when a queue starts backing up against them.
 */
export const Conveyor = memo(
  staticPart(function Conveyor({ run }: { tex: LineTextures; run: ConveyorRun }) {
    const dx = run.to[0] - run.from[0];
    const dz = run.to[1] - run.from[1];
    const full = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    // Local z runs from `from` (-full / 2) to `to` (+full / 2); a corner piece owns the last half width.
    const z0 = -full / 2 + (atTurn(run.from) ? CONV.width / 2 : 0);
    const z1 = full / 2 - (atTurn(run.to) ? CONV.width / 2 : 0) - (run.stopShort ?? 0);
    const len = z1 - z0;
    const modules = Math.max(1, Math.round(len / MODULE_LEN));
    const pitch = len / modules;

    return (
      <group position={[(run.from[0] + run.to[0]) / 2, 0, (run.from[1] + run.to[1]) / 2]} rotation={[0, angle, 0]}>
        {Array.from({ length: modules }, (_, i) => (
          <StaticPiece key={i} name="ConveyorModule" z={z0 + (i + 0.5) * pitch} scale={[1, 1, pitch / MODULE_LEN]} />
        ))}
        {/* Zone boundaries: where accumulation actually happens. */}
        {Array.from({ length: Math.max(0, run.zones - 1) }, (_, i) => {
          const t = (i + 1) / run.zones;
          return (
            <mesh key={i} position={[0, CONV.deckY + 0.012, -full / 2 + t * full]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[CONV.width - 0.1, 0.09]} />
              <meshStandardMaterial color="#e8621a" emissive="#e8621a" emissiveIntensity={0.5} />
            </mesh>
          );
        })}
      </group>
    );
  }),
);

/** The right-angle transfers where the spine turns a corner. */
export const ConveyorTurns = memo(function ConveyorTurns() {
  return (
    <>
      {SPINE_TURNS.map((t) => (
        <StaticPiece key={`${t.at[0]},${t.at[1]}`} name="ConveyorTurn" x={t.at[0]} z={t.at[1]} />
      ))}
    </>
  );
});

const EYE_LIVE = ['Eye Lens'] as const;

/** The indicator gets a material of its own, so one eye lighting does not light them all. */
function ownEye(obj: THREE.Object3D): void {
  ownMaterial(obj, 'Eye Lens', (m) => m.clone());
}

/** A photo-eye on its post: one per zone, and the thing the program reads. It looks across the belt, north. */
export const PhotoEye = memo(function PhotoEye({ x, z, on = false }: { x: number; z: number; on?: boolean }) {
  const { body, live } = usePlantSplit('PhotoEye', EYE_LIVE, ownEye);
  useLayoutEffect(() => {
    for (const mesh of meshesIn(live, 'Eye Lens')) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.color.set(on ? '#ff5a3c' : '#5c2418');
      m.emissive.set(on ? '#ff5a3c' : '#000000');
      m.emissiveIntensity = on ? 2 : 0;
    }
  }, [live, on]);
  return <SplitPiece body={body} live={live} x={x} z={z} />;
});

// --- Cell furniture -----------------------------------------------------------

const LAMPS = { red: 'Lamp Red', amber: 'Lamp Amber', green: 'Lamp Green' } as const;
const LAMP_LIVE = Object.values(LAMPS);

function ownLamps(obj: THREE.Object3D): void {
  for (const name of LAMP_LIVE) ownMaterial(obj, name, (m) => m.clone());
}

/**
 * A stack light, which is how a real bay says what it is doing from 30 m away.
 *
 * Reading the whole plant from the overview shot without a single label is the
 * point: a player who has learned that amber means blocked can see the
 * constraint move as they change the program. Red on top, as on a real one.
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
  const { body, live } = usePlantSplit('StackLight', LAMP_LIVE, ownLamps);
  useLayoutEffect(() => {
    const on = { [LAMPS.red]: red, [LAMPS.amber]: amber, [LAMPS.green]: green };
    for (const name of LAMP_LIVE) {
      for (const mesh of meshesIn(live, name)) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        // The kit's color is the lit one; an unlit lamp is the same lens, dark.
        const lit = (m.userData.lit as THREE.Color | undefined) ?? m.color.clone();
        m.userData.lit = lit;
        m.color.copy(lit).multiplyScalar(on[name] ? 1 : 0.28);
        m.emissive.copy(lit);
        m.emissiveIntensity = on[name] ? 1.7 : 0;
      }
    }
  }, [live, red, amber, green]);
  return <SplitPiece body={body} live={live} x={position[0]} y={position[1]} z={position[2]} />;
});

/** One lit screen material per texture. */
const screens = new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();

function screenOn(obj: THREE.Object3D, tex: THREE.Texture): void {
  let m = screens.get(tex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, emissive: '#2ea8c4', emissiveIntensity: 0.7 });
    screens.set(tex, m);
  }
  for (const mesh of meshesIn(obj, 'Screen')) mesh.material = m;
}

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
  return <StaticPiece name="HmiPost" prepare={screenOn} arg={tex} x={x} z={z} rotY={rotY} />;
});

/** A cell's control cabinet: where the stack light and the HMI hang off. Its doors face +z unturned. */
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
  return <StaticPiece name="Cabinet" x={x} z={z} rotY={rotY} scale={[w / 1.1, h / 2.0, d / 0.55]} />;
});

/** One material per color, for the parts of a kit asset recolored per instance. */
const tints = new Map<string, THREE.MeshStandardMaterial>();

function tinted(base: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
  const key = `${base.name}|${color}`;
  let m = tints.get(key);
  if (!m) {
    m = base.clone();
    m.color.set(color);
    tints.set(key, m);
  }
  return m;
}

function vestIn(obj: THREE.Object3D, color: string): void {
  for (const mesh of meshesIn(obj, 'Vest')) mesh.material = tinted(mesh.material as THREE.MeshStandardMaterial, color);
}

function bandIn(obj: THREE.Object3D, color: string): void {
  for (const mesh of meshesIn(obj, 'Drum Band')) mesh.material = tinted(mesh.material as THREE.MeshStandardMaterial, color);
}

/**
 * A person, for scale, facing +z unturned.
 *
 * Nothing else in the scene establishes that an excavator is 4 m tall as
 * cheaply, and a plant with nobody in it reads as a model of a plant.
 */
export const Figure = memo(function Figure({
  x,
  y = 0,
  z,
  rotY = 0,
  vest = '#f97316',
}: {
  x: number;
  /** What the figure stands on, when that is not the floor. */
  y?: number;
  z: number;
  rotY?: number;
  vest?: string;
}) {
  return <StaticPiece name="Figure" prepare={vestIn} arg={vest} x={x} y={y} z={z} rotY={rotY} />;
});

/** A paint drum, with its order color round it. */
export const Drum = memo(function Drum({ x, z, color }: { x: number; z: number; color: string }) {
  return <StaticPiece name="PaintDrum" prepare={bandIn} arg={color} x={x} z={z} />;
});

/** Overhead services cast no shadow; see `ServiceRun`. */
function noShadow(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    o.castShadow = false;
  });
}

function riserTo(obj: THREE.Object3D, y: number): void {
  noShadow(obj);
  node(obj, 'ServiceRiser').scale.y = y;
}

/**
 * Overhead pipe and cable tray, from the kit's 2 m module.
 *
 * Explicitly casts no shadow. `Building.tsx` in the old plant learned this the
 * hard way: a run of trusses striped the entire floor with hard bars and the
 * plant was read through them. Overhead structure is exactly the thing a
 * top-down camera cannot afford.
 */
export const ServiceRun = memo(
  staticPart(function ServiceRun({
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
    const modules = Math.max(1, Math.round(len / 2));
    const pitch = len / modules;
    return (
      <group>
        <group position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
          {Array.from({ length: modules }, (_, i) => (
            <StaticPiece
              key={i}
              name="ServiceTray"
              prepare={noShadow}
              z={-len / 2 + (i + 0.5) * pitch}
              scale={[1, 1, pitch / 2]}
            />
          ))}
        </group>
        {/* Risers go all the way to the slab and end in a disconnect: seven
            orange posts hanging in the air over the walkway is the single most
            visible way to say "this is a model" rather than "this is a building". */}
        {drops.map(([dxp, dzp], i) => (
          <StaticPiece key={i} name="ServiceDrop" prepare={riserTo} arg={y} x={dxp} z={dzp} />
        ))}
      </group>
    );
  }),
);

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
  // The kit's frame, or its boom folded for transport (`excavator/kit.ts`).
  return <ExcavatorPart kind={kind} paint={mat} scale={scale} />;
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
  return (
    <ExcavatorMachine
      paint={mat}
      boomPaint={boomMat}
      engine={engine}
      cab={cab}
      boom={boom}
      arm={{ lift: swing * 0.5, stick: -swing * 0.4 }}
    />
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
