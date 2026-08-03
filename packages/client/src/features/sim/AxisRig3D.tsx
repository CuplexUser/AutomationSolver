import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

/**
 * The transfer carriage: a portal gantry with a traversing trolley, a rope
 * hoist and a pair of fork arms that close across the aisle onto a pallet.
 *
 * Every number below is the model's own, and the model's numbers came from the
 * process model (`processes/axis.ts`) rather than the other way round — the
 * blend is dimensioned so that 0..4000 counts of stroke *is* the runway between
 * the buffers, so `xOf()` here is a straight mapping rather than a fudge factor.
 * Nothing animates on its own: position, wheel rotation, rope payout, sway
 * angle, fork opening and every lamp are pure functions of `machine.*`.
 *
 * The glb is authored at real scale (a 12.5 m girder over a 9.9 m stroke) and
 * exported Y-up, so Blender's Z became three's Y and a Blender rotation about Y
 * became a three rotation about Z, negated. That is the only coordinate wrinkle
 * in the file, and it is why the drum, the wheels and the sway all carry a
 * minus sign.
 */

const MODEL_URL = '/models/transfer-carriage.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const COUNTS_FULL = 4000;
/** Where the two work stations sit, in counts (must match the process model). */
const PICK_POS = 400;
const DROP_POS = 3400;
const STATION_WINDOW = 60;

/** Half the stroke, in model units: the buffers meet at exactly +/-HALF_X. */
const HALF_X = 4.95;
/** Counts along the stroke to a model x. */
const xOf = (counts: number): number => -HALF_X + clamp01(counts / COUNTS_FULL) * HALF_X * 2;

// --- hoist ----------------------------------------------------------------
/** Height the falls leave the drum, and the top of the rope sockets below. */
const ROPE_TOP = 3.56;
const SOCKET_TOP = 0.14;
/** Rope block height at full hoist (4000 counts) and the travel above it. */
const BLOCK_DOWN = 2.1325;
const HOIST_TRAVEL = 1.14;
const BLOCK_UP = BLOCK_DOWN + HOIST_TRAVEL;
const DRUM_R = 0.185;
const WHEEL_R = 0.13;

/** 1000 counts of sway is half a metre of swing at the trolley. */
const SWAY_PER_COUNT = 0.0005;
/**
 * How far below the rope block the swinging mass sits — the fork carriage, the
 * arms and whatever is on them. Added to the rope to get the pendulum length,
 * because with the hook right up under the drum the bare rope is a few
 * centimetres and the load would appear to cartwheel rather than lean.
 */
const LOAD_CG_BELOW_BLOCK = 1.45;

// --- fork arms ------------------------------------------------------------
// The arms close ACROSS the aisle, on a head turned 90 degrees, so these are
// local x on that head. Open, the tips clear the pallet; shut, the tines are
// home in its fork pockets.
const FORK_OPEN_X = 1.01;
const FORK_SHUT_X = 0.58;
/** Positioner rod: where it leaves its gland, and where it lands on the shank. */
const ROD_ANCHOR_X = 0.398;
const ROD_TIP_INSET = 0.075;

// --- festoon --------------------------------------------------------------
// Cable carriers spread evenly between the trolley's tow arm and the fixed
// anchor at the far end, which is what a real festoon does on its own; the
// straight spans between them are unit boxes scaled to bridge each gap.
const FEST_ANCHOR_X = 12.5 / 2 - 0.22;
const FEST_CARRIERS = 7;
const FEST_TOW_DX = 0.34;

/** Beacon flash period while the drive is running, in seconds. */
const BEACON_PERIOD = 0.9;

interface Lamp {
  mat: THREE.MeshStandardMaterial;
  on: string;
  off: string;
  lit: number;
}

interface Refs {
  trolley?: THREE.Object3D;
  wheels: THREE.Object3D[];
  drum?: THREE.Object3D;
  swing?: THREE.Object3D;
  ropes: THREE.Object3D[];
  block?: THREE.Object3D;
  forkL?: THREE.Object3D;
  forkR?: THREE.Object3D;
  rods: THREE.Object3D[];
  carriers: THREE.Object3D[];
  spans: THREE.Object3D[];
  carried?: THREE.Object3D;
  waiting?: THREE.Object3D;
  placed?: THREE.Object3D;
  lamps: Partial<Record<'green' | 'red' | 'pick' | 'drop' | 'beacon', Lamp>>;
}

/** Collects `Name_0`, `Name_1`, ... until the first gap. */
function series(scene: THREE.Object3D, prefix: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  for (let i = 0; ; i++) {
    const obj = scene.getObjectByName(`${prefix}${i}`);
    if (!obj) return found;
    found.push(obj);
  }
}

/**
 * Gives a lens its own copy of its material so it can be lit in isolation.
 *
 * Idempotent for the same reason the drill station's is: the memo that calls
 * this can run more than once for one scene (React deliberately double-invokes
 * memo factories in dev), and cloning afresh each time would leave the mesh
 * wearing a material the refs no longer point at.
 */
function lamp(obj: THREE.Object3D | undefined, on: string, off: string): Lamp | undefined {
  const mesh = obj as THREE.Mesh | undefined;
  const base = mesh?.material as THREE.MeshStandardMaterial | undefined;
  if (!mesh || !base) return undefined;
  const mat =
    base.userData.lampOwner === true
      ? base
      : (() => {
          const copy = base.clone();
          copy.userData = { ...copy.userData, lampOwner: true };
          mesh.material = copy;
          return copy;
        })();
  return { mat, on, off, lit: 0 };
}

/** Drives one lens between its dark and lit colors. */
function light(l: Lamp | undefined, on: boolean): void {
  if (!l) return;
  l.mat.color.set(on ? l.on : l.off);
  l.mat.emissive.set(on ? l.on : l.off);
  l.mat.emissiveIntensity = on ? 1.2 : 0.15;
}

function TransferCarriageScene({ machine }: { machine: MachineState }) {
  const { scene: cached } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);
  // useGLTF hands out one cached scene per URL and this scene both poses nodes
  // and repaints lamp materials every frame. Cloning per instance keeps the
  // cache pristine; geometries and untouched materials are still shared.
  const scene = useMemo(() => cached.clone(true), [cached]);

  const refs = useMemo<Refs>(() => {
    enableShadows(scene);
    const find = (name: string) => scene.getObjectByName(name) ?? undefined;
    return {
      trolley: find('Trolley'),
      wheels: series(scene, 'TrolleyWheel_'),
      drum: find('HoistDrum'),
      swing: find('RopeSwing'),
      ropes: [find('RopeA'), find('RopeB')].filter((o): o is THREE.Object3D => o != null),
      block: find('HoistBlock'),
      forkL: find('ForkL'),
      forkR: find('ForkR'),
      rods: [find('PosRod_L'), find('PosRod_R')].filter((o): o is THREE.Object3D => o != null),
      carriers: series(scene, 'FestoonCarrier_'),
      spans: series(scene, 'FestoonSpan_'),
      carried: find('PalletCarried'),
      waiting: find('PalletWaiting'),
      placed: find('PalletPlaced'),
      lamps: {
        green: lamp(find('StackLightGreen'), '#00c040', '#0a2410'),
        red: lamp(find('StackLightRed'), '#ff2020', '#3a0a0a'),
        pick: lamp(find('ProxLedPick'), '#ffb020', '#3a2408'),
        drop: lamp(find('ProxLedDrop'), '#ffb020', '#3a2408'),
        beacon: lamp(find('TrolleyBeacon'), '#ffb020', '#3a2408'),
      },
    };
  }, [scene]);

  /** Beacon phase. A flashing lamp is the clearest "this is moving" cue there
      is at this canvas size, and it is the one thing on the rig that needs a
      clock of its own rather than a machine value. */
  const beacon = useRef(0);

  // The loaded glTF scene graph is external-system state — posing it
  // imperatively every frame is the standard r3f pattern and avoids
  // re-rendering the React tree on every sim tick.
  /* eslint-disable react-hooks/immutability */
  useFrame((_state, dt) => {
    const r = refs;
    const pos = numOf(machine.pos);
    const jam = boolOf(machine.jam);
    const running = boolOf(machine.running);
    // Feature detection mirrors the process model's own: a puzzle that never
    // wires the hoist or the forks reports neither, and the rig simply parks
    // them rather than inventing motion.
    const hasForks = boolOf(machine.hasForks);
    const hasHoist = boolOf(machine.hasHoist);

    const tx = xOf(pos);
    if (r.trolley) r.trolley.position.x = tx;
    // Wheels roll rather than skid: one turn per 2*pi*r of runway.
    for (const w of r.wheels) w.rotation.z = -tx / WHEEL_R;

    // Hoist. The rope is a unit cylinder scaled to the gap between the drum and
    // the block, so the block's height and the rope's length are one number.
    const hoist01 = hasHoist ? clamp01(numOf(machine.hoist) / COUNTS_FULL) : 0;
    const blockY = BLOCK_UP - hoist01 * HOIST_TRAVEL;
    const ropeLen = Math.max(0.02, ROPE_TOP - (blockY + SOCKET_TOP));
    if (r.block) r.block.position.y = blockY - ROPE_TOP;
    for (const rope of r.ropes) rope.scale.y = ropeLen;
    // The drum turns by exactly the rope it has let out.
    if (r.drum) r.drum.rotation.z = -ropeLen / DRUM_R;

    // Sway swings the whole fall about where the rope leaves the drum. This is
    // the instantaneous angle (`machine.sway`), not the amplitude the program
    // interlocks against — the load is what it is, whatever the meter reports.
    if (r.swing) {
      const lateral = hasHoist ? numOf(machine.sway) * SWAY_PER_COUNT : 0;
      const ratio = lateral / (ropeLen + LOAD_CG_BELOW_BLOCK);
      r.swing.rotation.z = Math.asin(Math.max(-0.5, Math.min(0.5, ratio)));
    }

    const forks = hasForks ? clamp01(numOf(machine.forks)) : 0;
    const fx = FORK_OPEN_X - forks * (FORK_OPEN_X - FORK_SHUT_X);
    if (r.forkL) r.forkL.position.x = -fx;
    if (r.forkR) r.forkR.position.x = fx;
    const rod = Math.max(0.01, fx - ROD_TIP_INSET - ROD_ANCHOR_X);
    for (const p of r.rods) p.scale.x = rod;

    // Festoon: carriers spread evenly between the trolley and the fixed end,
    // and each span bridges one gap.
    const tow = tx + FEST_TOW_DX;
    let from = tow;
    for (let i = 0; i <= FEST_CARRIERS; i++) {
      const to =
        i === FEST_CARRIERS
          ? FEST_ANCHOR_X
          : tow + ((FEST_ANCHOR_X - tow) * (i + 1)) / (FEST_CARRIERS + 1);
      const carrier = r.carriers[i];
      if (carrier) carrier.position.x = to;
      const span = r.spans[i];
      if (span) {
        span.position.x = from;
        span.scale.x = Math.max(0.02, to - from);
      }
      from = to;
    }

    const carrying = hasForks && boolOf(machine.loaded);
    if (r.carried) r.carried.visible = carrying;
    // The infeed is bottomless in the process model, so a fresh pallet is
    // always waiting unless this one is already on the forks.
    if (r.waiting) r.waiting.visible = hasForks && !carrying;
    if (r.placed) r.placed.visible = hasForks && numOf(machine.placed) > 0;

    // Lamps. Green is the machine's own "healthy" light and red is the fault,
    // exactly as on the drill station; the two station lamps are X12 and X13,
    // read off the same window the process model uses.
    light(r.lamps.green, !jam);
    light(r.lamps.red, jam);
    light(r.lamps.pick, Math.abs(pos - PICK_POS) <= STATION_WINDOW);
    light(r.lamps.drop, Math.abs(pos - DROP_POS) <= STATION_WINDOW);
    beacon.current = running || jam ? (beacon.current + dt) % BEACON_PERIOD : 0;
    light(r.lamps.beacon, beacon.current < BEACON_PERIOD / 2);
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function AxisRig3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      // Three quarters on, and low: the whole subject is a carriage travelling
      // along a line, which an overhead view flattens away. Framed to hold all
      // 12.5 m of girder across a panel-width canvas.
      cameraPosition={[6.4, 5.6, 13.1]}
      fov={28}
      target={[0, 2.2, 0]}
      minDistance={8}
      maxDistance={40}
      polarRange={[0.35, 1.45]}
      // The machine is twelve metres of runway with two stations at opposite
      // ends of it, so a zoomed-in view has to be able to travel to the end
      // being watched rather than only orbiting the middle.
      panBounds={{ x: [-7, 7], y: [0.5, 6], z: [-4, 4] }}
    >
      <TransferCarriageScene machine={machine} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
