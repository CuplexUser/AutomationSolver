import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

const MODEL_URL = '/models/pack-machine.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Packing-machine scene driven off the Blender-authored pack-machine.glb
 * (D:\Code\Claude\Design\PackMachine.blend — node names are load-bearing).
 * The glb carries one node per moving part: five *Carriage empties (the pusher
 * plates with their rods and L-gates), the FlipperPivot hinge, and a full set
 * of carton nodes whose visibility/positions are a pure function of the
 * `packaging` process's MachineState, re-derived every frame.
 *
 * Coordinates: Blender is Z-up, glTF is Y-up — a Blender point (x, y, z) lands
 * at (x, z, -y) here. All constants below are in glTF space but quote their
 * Blender-side origins (see the export script's FILE_Y / SEC4_Y tables).
 */

// Infeed lanes: position 0..1 along the belt (1 = at the end stop, x = -0.05);
// negative = not yet on the belt. Lane rows sit at z 0.45 (near) / 1.0 (far).
const laneX = (p: number) => -8.75 + 8.7 * p;
const LANE_Z = { A: 0.45, B: 1.0 } as const;
const BELT_Y = 1.15; // flat-carton center height on belt and section decks

// Actuator strokes, in scene units along the glTF axis each carriage moves on.
const PUSH2_TRAVEL = 1.3; // +z: belt lanes → section 2 file entry
const PUSH4_TRAVEL = 1.35; // +x: section 2 file → flipper tray
const PUSH16A_TRAVEL = 3.1; // +z: section 3 → section 4
const PUSH16B_TRAVEL = 2.75; // +x: section 4 → out-feed belt
const FLIP_RAD = 2.0; // flipper tips ~115° over the wall

// Section 2 file slots (Blender FILE_Y negated) shared by Sec3 rows too.
const FILE_Z = [1.75, 2.25, 2.75, 3.25] as const;
const SEC4_Z = [4.85, 5.35, 5.85, 6.35] as const;
const SEC3_COL_X = (c: number) => 2.1 + 0.3 * c;
const UP_Y = 1.5; // on-end carton center height

// Mothåll (Y5): the counter-hold plate's rest pose in the glb sits flush with
// a 2-column stack (Blender x 2.61); the client positions it absolutely —
// forward = flush against the current stack, back = parked east of the
// 16-pack-1 plate's sweep.
const MOTHALL_REST_X = 2.61;
const MOTHALL_BACK_X = 3.66;
const mothallForwardX = (cols: number) => 1.95 + 0.3 * Math.max(cols, 1) + 0.06;

// Out-feed transit: the shipped block enters the belt at x 4.85 (per column
// +0.3c) and rides to the finished station at 12.7; ShipBox rest is at 8.6.
const shipOffsetX = (ship: number) => 7.85 * ship - 3.75;

interface DriveRefs {
  push2?: THREE.Object3D;
  push4?: THREE.Object3D;
  push16a?: THREE.Object3D;
  push16b?: THREE.Object3D;
  mothall?: THREE.Object3D;
  flipper?: THREE.Object3D;
  beltBoxes: { node?: THREE.Object3D; lane: 'A' | 'B'; key: string }[];
  carryA?: THREE.Object3D;
  carryB?: THREE.Object3D;
  sec2: (THREE.Object3D | undefined)[];
  carry4: (THREE.Object3D | undefined)[];
  lift: (THREE.Object3D | undefined)[];
  sec3: (THREE.Object3D | undefined)[][]; // [col][row]
  sec4: (THREE.Object3D | undefined)[][];
  ship: (THREE.Object3D | undefined)[][];
  done: (THREE.Object3D | undefined)[][];
  beacon?: THREE.Mesh;
}

function PackMachineScene({ machine }: { machine: MachineState }) {
  const { scene } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);

  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    const grid = (prefix: string) =>
      Array.from({ length: 4 }, (_, c) =>
        Array.from({ length: 4 }, (_, r) => scene.getObjectByName(`${prefix}_${c}_${r}`)),
      );
    return {
      push2: scene.getObjectByName('Push2Carriage') ?? undefined,
      push4: scene.getObjectByName('Push4Carriage') ?? undefined,
      push16a: scene.getObjectByName('Push16aCarriage') ?? undefined,
      push16b: scene.getObjectByName('Push16bCarriage') ?? undefined,
      mothall: scene.getObjectByName('MothallCarriage') ?? undefined,
      flipper: scene.getObjectByName('FlipperPivot') ?? undefined,
      beltBoxes: [
        { node: scene.getObjectByName('BeltBoxA1'), lane: 'A', key: 'laneA1' },
        { node: scene.getObjectByName('BeltBoxA2'), lane: 'A', key: 'laneA2' },
        { node: scene.getObjectByName('BeltBoxB1'), lane: 'B', key: 'laneB1' },
        { node: scene.getObjectByName('BeltBoxB2'), lane: 'B', key: 'laneB2' },
      ],
      carryA: scene.getObjectByName('CarryBoxA') ?? undefined,
      carryB: scene.getObjectByName('CarryBoxB') ?? undefined,
      sec2: Array.from({ length: 4 }, (_, i) => scene.getObjectByName(`Sec2Box_${i}`)),
      carry4: Array.from({ length: 4 }, (_, i) => scene.getObjectByName(`Carry4Box_${i}`)),
      lift: Array.from({ length: 4 }, (_, i) => scene.getObjectByName(`LiftBox${i}`)),
      sec3: grid('Sec3Box'),
      sec4: grid('Sec4Box'),
      ship: grid('ShipBox'),
      done: grid('DoneBox'),
      beacon: scene.getObjectByName('JamBeacon') as THREE.Mesh | undefined,
    };
  }, [scene]);

  /* eslint-disable react-hooks/immutability -- driving the loaded glTF scene graph imperatively is the standard r3f pattern */
  useFrame(() => {
    const r = refs;
    const push2 = clamp01(numOf(machine.push2));
    const push4 = clamp01(numOf(machine.push4));
    const lift = clamp01(numOf(machine.lift));
    const push16a = clamp01(numOf(machine.push16a));
    const push16b = clamp01(numOf(machine.push16b));
    const backstop = clamp01(numOf(machine.backstop));
    const sec2 = numOf(machine.sec2);
    const sec3 = numOf(machine.sec3);
    const sec4 = numOf(machine.sec4);
    const carry4 = numOf(machine.carry4);
    const carry16a = numOf(machine.carry16a);
    const carry16b = numOf(machine.carry16b);
    const liftLoad = numOf(machine.liftLoad);
    const ship = numOf(machine.ship, 1);
    const finished = numOf(machine.finished);
    const carrying = machine.carryA === true || machine.carryB === true;
    const jam = machine.jam === true;

    // -- actuators -----------------------------------------------------------
    if (r.push2) r.push2.position.set(0, 0, PUSH2_TRAVEL * push2);
    if (r.push4) r.push4.position.set(PUSH4_TRAVEL * push4, 0, 0);
    if (r.push16a) r.push16a.position.set(0, 0, PUSH16A_TRAVEL * push16a);
    if (r.push16b) r.push16b.position.set(PUSH16B_TRAVEL * push16b, 0, 0);
    if (r.flipper) r.flipper.rotation.set(0, 0, -FLIP_RAD * lift);
    if (r.mothall) {
      // Forward presses flush against however many columns stand in section 3
      // (leaving one column's landing gap when it is empty); back parks it
      // clear of the 16-pack-1 plate's sweep.
      const cols = Math.ceil((carry16a > 0 ? 0 : sec3) / 4);
      const fwdX = mothallForwardX(cols);
      const x = MOTHALL_BACK_X + (fwdX - MOTHALL_BACK_X) * backstop;
      r.mothall.position.set(x - MOTHALL_REST_X, 0, 0);
    }

    // -- infeed lanes --------------------------------------------------------
    for (const { node, lane, key } of r.beltBoxes) {
      if (!node) continue;
      const p = numOf(machine[key], -1);
      node.visible = p >= 0;
      node.position.set(laneX(p), BELT_Y, LANE_Z[lane]);
    }
    if (r.carryA) r.carryA.visible = machine.carryA === true;
    if (r.carryB) r.carryB.visible = machine.carryB === true;

    // -- section 2 file (second stroke shoves the staged pair deeper) --------
    const shove = carrying ? clamp01((push2 - 0.62) / 0.38) : 0;
    r.sec2.forEach((node, i) => {
      if (!node) return;
      node.visible = i < sec2;
      node.position.set(-0.05, BELT_Y, FILE_Z[i] + shove);
    });
    r.carry4.forEach((node, i) => {
      if (node) node.visible = i < carry4;
    });
    r.lift.forEach((node, i) => {
      if (node) node.visible = i < liftLoad;
    });

    // -- section 3 stack (doubles as the block riding 16-pack-1) -------------
    const sec3Count = carry16a > 0 ? carry16a : sec3;
    const sec3Off = carry16a > 0 ? PUSH16A_TRAVEL * push16a : 0;
    r.sec3.forEach((col, c) => {
      col.forEach((node, row) => {
        if (!node) return;
        node.visible = c < Math.ceil(sec3Count / 4);
        node.position.set(SEC3_COL_X(c), UP_Y, FILE_Z[row] + sec3Off);
      });
    });

    // -- section 4 block (doubles as the block riding 16-pack-2) -------------
    const sec4Count = carry16b > 0 ? carry16b : sec4;
    const sec4Off = carry16b > 0 ? PUSH16B_TRAVEL * push16b : 0;
    r.sec4.forEach((col, c) => {
      col.forEach((node, row) => {
        if (!node) return;
        node.visible = c < Math.ceil(sec4Count / 4);
        node.position.set(SEC3_COL_X(c) + sec4Off, UP_Y, SEC4_Z[row]);
      });
    });

    // -- out-feed transit and finished station -------------------------------
    r.ship.forEach((col, c) => {
      col.forEach((node) => {
        if (!node) return;
        node.visible = ship < 1;
        node.position.x = 8.6 + 0.3 * c + shipOffsetX(ship);
      });
    });
    r.done.forEach((col) => {
      col.forEach((node) => {
        if (node) node.visible = finished > 0 && ship >= 1;
      });
    });

    // -- jam beacon ----------------------------------------------------------
    const mat = r.beacon?.material as THREE.MeshStandardMaterial | undefined;
    if (mat) {
      // Dark albedo even when lit, so the emissive glow dominates (see
      // ElevatorShaft3D's arrival-light comment).
      mat.emissiveIntensity = jam ? 1.4 : 0.15;
      mat.color.set(jam ? '#2a1010' : '#1a0d0d');
      mat.emissive.set(jam ? '#ff3020' : '#3a0a0a');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function PackMachine3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[11, 15, 17]}
      target={[2.3, 0.6, 2.0]}
      minDistance={9}
      maxDistance={45}
    >
      <PackMachineScene machine={machine} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
