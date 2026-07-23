import { useMemo, useRef } from 'react';
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
 * The rig is a real articulated arm: `SwingPivot` (base yaw) carries
 * `ShoulderPivot` → `ElbowPivot` → `ReachCarriage` (the wrist). Reach is a
 * two-link IK move — shoulder and elbow pitch about local X so the wrist
 * descends a vertical line over the current pad, and the carriage
 * counter-pitches so the gripper always hangs plumb. `WristJoint` (child of
 * `ReachCarriage`, wraps the gripper mesh nodes) gets a small cosmetic roll
 * while gripping; the two finger nodes slide along local X for grip.
 * `JamLamp`/`TrayFullLamp` are the two segments of the mast's stack light
 * (material mutated red/green). `ConveyorPart` rides the conveyor belt to
 * the infeed pad whenever a fresh part is due, so parts don't just pop into
 * existence. Every other named node (tray parts) is a pure visibility
 * toggle — rest positions are already baked into the glTF transforms.
 *
 * Coordinates: Blender is Z-up, glTF is Y-up — a Blender point (x, y, z)
 * lands at (x, z, -y) here. Both the swing (up-axis) and the pitch (X-axis)
 * rotations survive the exporter's axis remap with identical signed values,
 * so Blender-verified joint angles drive rotation.y / rotation.x directly.
 */

// Two-link reach IK. Link geometry is the glb's authored joint translations
// (shoulder at height SHOULDER_H, elbow at (horizontal 1.422, up 1.311) from
// the shoulder, wrist at (1.657, -0.381) from the elbow). REST_E1/REST_E2 are
// each link's rest-pose elevation angle, so at reach=0 the solver returns
// exactly q1 = q2 = 0 and the arm sits in its authored rest pose. The wrist
// descends the vertical line at the pad radius (WRIST_RADIUS from the swing
// axis), from WRIST_REST_Y down to WRIST_GRASP_Y at full reach.
const SHOULDER_H = 0.9755344 + 0.394;
const L1 = Math.hypot(1.422, 1.311); // shoulder → elbow
const L2 = Math.hypot(1.657, 0.381); // elbow → wrist
const REST_E1 = Math.atan2(1.311, 1.422);
const REST_E2 = Math.atan2(-0.381, 1.657);
const WRIST_RADIUS = 1.422 + 1.657;
const WRIST_REST_Y = SHOULDER_H + 1.311 - 0.381;
// Full-reach wrist height: the grasp point (fingertips/CarriedPart) hangs
// 0.82 below the wrist and must land just above a resting part's base
// (center 0.31, half-height 0.15, +0.06 in-body margin) => 0.22 + 0.82.
// Deep enough to read as a real grab, still clear of the pad's locating pin.
const WRIST_GRASP_Y = 1.04;
const ANGLE_STEP = THREE.MathUtils.degToRad(25);
const SLOT_COUNT = 4;
const ARRIVAL_MS = 900;
const WRIST_ROLL_MAX = THREE.MathUtils.degToRad(12);
// The carried/tray part is 0.3 wide (half-width 0.15) and the finger pad is
// 0.09 wide (half-width 0.045), so a closed offset below ~0.195 drives the
// pad's inner face past the part's surface — the original 0.08 buried the
// fingertips almost to the part's center. Closed = pads just touch the part's
// sides; open = pads clear it by a comfortable margin while swinging past.
const FINGER_OPEN_X = 0.34; // rest (fully open) local X baked into the glb
const FINGER_CLOSED_X = 0.195;

interface DriveRefs {
  pivot?: THREE.Object3D;
  shoulder?: THREE.Object3D;
  elbow?: THREE.Object3D;
  reach?: THREE.Object3D;
  wristJoint?: THREE.Object3D;
  fingerL?: THREE.Object3D;
  fingerR?: THREE.Object3D;
  padL?: THREE.Object3D;
  padR?: THREE.Object3D;
  carriedPart?: THREE.Object3D;
  infeedPart?: THREE.Object3D;
  traySlots: (THREE.Object3D | undefined)[];
  jamLamp?: THREE.Mesh;
  trayFullLamp?: THREE.Mesh;
  conveyorPart?: THREE.Object3D;
  conveyorOrigin?: THREE.Vector3;
}

function PickPlaceArmScene({ machine, trayFull }: { machine: MachineState; trayFull: boolean }) {
  const { scene } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);

  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    const conveyorPart = scene.getObjectByName('ConveyorPart') ?? undefined;
    return {
      pivot: scene.getObjectByName('SwingPivot') ?? undefined,
      shoulder: scene.getObjectByName('ShoulderPivot') ?? undefined,
      elbow: scene.getObjectByName('ElbowPivot') ?? undefined,
      reach: scene.getObjectByName('ReachCarriage') ?? undefined,
      wristJoint: scene.getObjectByName('WristJoint') ?? undefined,
      fingerL: scene.getObjectByName('GripperFingerL') ?? undefined,
      fingerR: scene.getObjectByName('GripperFingerR') ?? undefined,
      padL: scene.getObjectByName('GripperPadL') ?? undefined,
      padR: scene.getObjectByName('GripperPadR') ?? undefined,
      carriedPart: scene.getObjectByName('CarriedPart') ?? undefined,
      infeedPart: scene.getObjectByName('InfeedPart') ?? undefined,
      traySlots: Array.from({ length: SLOT_COUNT }, (_, i) =>
        scene.getObjectByName(`TraySlotPart_${i}`),
      ),
      jamLamp: scene.getObjectByName('JamLamp') as THREE.Mesh | undefined,
      trayFullLamp: scene.getObjectByName('TrayFullLamp') as THREE.Mesh | undefined,
      conveyorPart,
      conveyorOrigin: conveyorPart?.position.clone(),
    };
  }, [scene]);

  // Cosmetic-only: tracks a fresh-part slide-in along the conveyor so parts
  // don't just pop into existence at the infeed. Starts "already arrived" so
  // the very first part on load doesn't play the animation.
  const arrival = useRef({ t: ARRIVAL_MS, wasWant: true });

  /* eslint-disable react-hooks/immutability -- driving the loaded glTF scene graph imperatively is the standard r3f pattern */
  useFrame((_state, delta) => {
    const r = refs;
    const station = numOf(machine.station);
    const reach = clamp01(numOf(machine.reach));
    const grip = clamp01(numOf(machine.grip));
    const carrying = boolOf(machine.carrying);
    const jam = boolOf(machine.jam);
    const infeedPart = boolOf(machine.infeedPart);

    if (r.pivot) r.pivot.rotation.y = station * ANGLE_STEP;
    if (r.shoulder && r.elbow && r.reach) {
      // Elbow-up planar IK toward (WRIST_RADIUS, wy), then counter-pitch the
      // wrist by the summed joint angles so the gripper stays vertical.
      const wy = WRIST_REST_Y + (WRIST_GRASP_Y - WRIST_REST_Y) * reach;
      const dz = wy - SHOULDER_H;
      const d = Math.hypot(WRIST_RADIUS, dz);
      const cosG = (d * d + L1 * L1 - L2 * L2) / (2 * d * L1);
      const gamma = Math.acos(Math.min(1, Math.max(-1, cosG)));
      const phi = Math.atan2(dz, WRIST_RADIUS) + gamma;
      const q1 = REST_E1 - phi;
      const elbowY = SHOULDER_H + L1 * Math.sin(phi);
      const elbowR = L1 * Math.cos(phi);
      const psi = Math.atan2(wy - elbowY, WRIST_RADIUS - elbowR);
      const q2 = REST_E2 - psi - q1;
      r.shoulder.rotation.x = q1;
      r.elbow.rotation.x = q2;
      r.reach.rotation.x = -(q1 + q2);
    }
    if (r.wristJoint) r.wristJoint.rotation.y = grip * WRIST_ROLL_MAX;

    const fingerX = FINGER_OPEN_X - (FINGER_OPEN_X - FINGER_CLOSED_X) * grip;
    if (r.fingerL) r.fingerL.position.x = -fingerX;
    if (r.fingerR) r.fingerR.position.x = fingerX;
    if (r.padL) r.padL.position.x = -fingerX;
    if (r.padR) r.padR.position.x = fingerX;

    if (r.carriedPart) r.carriedPart.visible = carrying;
    r.traySlots.forEach((node, i) => {
      if (node) node.visible = machine[`slot${i + 1}`] === true;
    });

    const wantPart = infeedPart && !carrying;
    const a = arrival.current;
    if (wantPart && !a.wasWant) a.t = 0;
    a.wasWant = wantPart;
    if (wantPart) a.t = Math.min(ARRIVAL_MS, a.t + delta * 1000);
    const arriving = wantPart && a.t < ARRIVAL_MS;

    if (r.conveyorPart) r.conveyorPart.visible = arriving;
    if (arriving && r.conveyorPart && r.conveyorOrigin && r.infeedPart) {
      const t = a.t / ARRIVAL_MS;
      const eased = t * t * (3 - 2 * t);
      r.conveyorPart.position.lerpVectors(r.conveyorOrigin, r.infeedPart.position, eased);
    }
    if (r.infeedPart) r.infeedPart.visible = wantPart && !arriving;

    const jamMat = r.jamLamp?.material as THREE.MeshStandardMaterial | undefined;
    if (jamMat) {
      jamMat.emissiveIntensity = jam ? 1.4 : 0.15;
      jamMat.color.set(jam ? '#2a1010' : '#1a0d0d');
      jamMat.emissive.set(jam ? '#ff3020' : '#3a0a0a');
    }
    const trayMat = r.trayFullLamp?.material as THREE.MeshStandardMaterial | undefined;
    if (trayMat) {
      trayMat.emissiveIntensity = trayFull ? 1.4 : 0.15;
      trayMat.color.set(trayFull ? '#0f3a18' : '#0a1a0d');
      trayMat.emissive.set(trayFull ? '#25ff55' : '#0a3a12');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function PickPlaceArm3D({
  machine,
  trayFull = false,
  height = 300,
}: {
  machine: MachineState;
  trayFull?: boolean;
  height?: number;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[6.6, 6.2, 8.2]}
      target={[1.2, 1, 1.2]}
      minDistance={5}
      maxDistance={18}
      panBounds={{ x: [-4, 5], y: [0, 3], z: [-2, 7] }}
    >
      <PickPlaceArmScene machine={machine} trayFull={trayFull} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
