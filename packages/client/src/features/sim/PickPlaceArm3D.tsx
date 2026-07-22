import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

const MODEL_URL = '/models/pick-place-arm.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Pick & Place scene driven off the Blender-authored pick-place-arm.glb
 * (D:\Code\Claude\Design\PickPlaceArm.blend — node names are load-bearing).
 * `SwingPivot` carries the boom + rail + `ReachCarriage` hierarchy so a
 * single Y rotation swings the whole arm; `ReachCarriage` slides along local
 * Y for reach; the two finger nodes slide along local X for grip. Every
 * other named node (parts, beacon) is a pure visibility/material toggle —
 * their rest positions are already baked into the glTF transforms.
 *
 * Coordinates: Blender is Z-up, glTF is Y-up — a Blender point (x, y, z)
 * lands at (x, z, -y) here, so a Blender local-Z reach animation becomes a
 * local-Y move, and a Blender Z-axis swing rotation becomes a Y-axis
 * rotation with the same sign (both are the up axis, preserved 1:1 by the
 * exporter's axis remap).
 */

// Carriage travel so the grasp point (fingertips/CarriedPart, which sit below
// the carriage's own origin) lands low on a resting part — near its base for a
// visibly deeper, more convincing "reached all the way down" pose, but still
// inside the part's own body and above the pad/pin beneath it. NOT simply
// pivot-height-minus-pad-height, which ignores the fingertip offset entirely
// and drives the gripper through the tray and into the floor (the original
// bug). Must match the identical REACH_DROP formula in the Blender build
// script (source of the glb's rail length), not be derived independently here.
const REACH_DROP = 0.78;
const ANGLE_STEP = THREE.MathUtils.degToRad(25);
const SLOT_COUNT = 4;
// The carried/tray part is 0.3 wide (half-width 0.15) and the finger pad is
// 0.09 wide (half-width 0.045), so a closed offset below ~0.195 drives the
// pad's inner face past the part's surface — the original 0.08 buried the
// fingertips almost to the part's center. Closed = pads just touch the part's
// sides; open = pads clear it by a comfortable margin while swinging past.
const FINGER_OPEN_X = 0.34; // rest (fully open) local X baked into the glb
const FINGER_CLOSED_X = 0.195;

interface DriveRefs {
  pivot?: THREE.Object3D;
  reach?: THREE.Object3D;
  fingerL?: THREE.Object3D;
  fingerR?: THREE.Object3D;
  padL?: THREE.Object3D;
  padR?: THREE.Object3D;
  carriedPart?: THREE.Object3D;
  infeedPart?: THREE.Object3D;
  traySlots: (THREE.Object3D | undefined)[];
  beacon?: THREE.Mesh;
}

function PickPlaceArmScene({ machine }: { machine: MachineState }) {
  const { scene } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);

  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    return {
      pivot: scene.getObjectByName('SwingPivot') ?? undefined,
      reach: scene.getObjectByName('ReachCarriage') ?? undefined,
      fingerL: scene.getObjectByName('GripperFingerL') ?? undefined,
      fingerR: scene.getObjectByName('GripperFingerR') ?? undefined,
      padL: scene.getObjectByName('GripperPadL') ?? undefined,
      padR: scene.getObjectByName('GripperPadR') ?? undefined,
      carriedPart: scene.getObjectByName('CarriedPart') ?? undefined,
      infeedPart: scene.getObjectByName('InfeedPart') ?? undefined,
      traySlots: Array.from({ length: SLOT_COUNT }, (_, i) =>
        scene.getObjectByName(`TraySlotPart_${i}`),
      ),
      beacon: scene.getObjectByName('ReadyBeacon') as THREE.Mesh | undefined,
    };
  }, [scene]);

  /* eslint-disable react-hooks/immutability -- driving the loaded glTF scene graph imperatively is the standard r3f pattern */
  useFrame(() => {
    const r = refs;
    const station = numOf(machine.station);
    const reach = clamp01(numOf(machine.reach));
    const grip = clamp01(numOf(machine.grip));
    const carrying = boolOf(machine.carrying);
    const jam = boolOf(machine.jam);
    const infeedPart = boolOf(machine.infeedPart);

    if (r.pivot) r.pivot.rotation.y = station * ANGLE_STEP;
    if (r.reach) r.reach.position.y = -REACH_DROP * reach;

    const fingerX = FINGER_OPEN_X - (FINGER_OPEN_X - FINGER_CLOSED_X) * grip;
    if (r.fingerL) r.fingerL.position.x = -fingerX;
    if (r.fingerR) r.fingerR.position.x = fingerX;
    if (r.padL) r.padL.position.x = -fingerX;
    if (r.padR) r.padR.position.x = fingerX;

    if (r.carriedPart) r.carriedPart.visible = carrying;
    if (r.infeedPart) r.infeedPart.visible = infeedPart && !carrying;
    r.traySlots.forEach((node, i) => {
      if (node) node.visible = machine[`slot${i + 1}`] === true;
    });

    const mat = r.beacon?.material as THREE.MeshStandardMaterial | undefined;
    if (mat) {
      mat.emissiveIntensity = jam ? 1.4 : 0.15;
      mat.color.set(jam ? '#2a1010' : '#1a0d0d');
      mat.emissive.set(jam ? '#ff3020' : '#3a0a0a');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function PickPlaceArm3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[6.6, 6.2, 8.2]}
      target={[1.2, 1, 1.2]}
      minDistance={5}
      maxDistance={18}
      panBounds={{ x: [-4, 5], y: [0, 3], z: [-2, 7] }}
    >
      <PickPlaceArmScene machine={machine} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
