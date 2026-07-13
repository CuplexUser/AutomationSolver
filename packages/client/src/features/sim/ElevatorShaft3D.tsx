import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

const MODEL_URL = '/models/elevator-shaft.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Rest-pose coordinates read from the exported glb (see elevator-shaft.glb node
// transforms) — floor thresholds land exactly on these Y values because the
// Blender-side floor spacing (2.5 units) was authored to divide evenly, so the
// same constant drives both the model's geometry and this mapping.
const FLOOR_SPACING = 2.5;
const CAR_HEIGHT = 1.9;
const SHAFT_TOP_Y = 12.9; // ceiling — HoistCable's far end
const HOIST_CABLE_BASE_LEN = 11.0; // rest-pose length (ceiling to car-top at floor 1)
const DOOR_CLOSED_X = 0.375; // DoorLeftLeaf.x is -this, DoorRightLeaf.x is +this
const DOOR_OPEN_SLIDE = 0.73; // additional slide distance at door = 1

const floorY = (floor: number) => (floor - 1) * FLOOR_SPACING;

interface DriveRefs {
  car?: THREE.Object3D;
  doorLeft?: THREE.Object3D;
  doorRight?: THREE.Object3D;
  cable?: THREE.Object3D;
  arrivalLights: (THREE.Mesh | undefined)[]; // index 0 unused, 1..5 = floors 1..5
}

function ElevatorShaftScene({
  machine,
  floorCount,
  hasDoor,
}: {
  machine: MachineState;
  floorCount: number;
  hasDoor: boolean;
}) {
  const { scene } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);

  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    const arrivalLights: (THREE.Mesh | undefined)[] = [undefined];
    for (let n = 1; n <= 5; n++) {
      arrivalLights.push(scene.getObjectByName(`ArrivalLight_${n}`) as THREE.Mesh | undefined);
    }
    // useGLTF caches one scene object shared by every elevator puzzle, so
    // visibility must be set both ways — hiding only the excess floors would
    // leave floors 4-5 hidden after visiting the 3-floor puzzle.
    for (let n = 1; n <= 5; n++) {
      for (const prefix of ['FloorSlab', 'ArrivalLight', 'FrameRing', 'FloorPlaque', 'FloorDigit', 'CallButtonKnob', 'BuildingFloor', 'ShaftBracket']) {
        const obj = scene.getObjectByName(`${prefix}_${n}`);
        if (obj) obj.visible = n <= floorCount;
      }
    }
    // One parapet per served-floor count caps the backdrop at the right height.
    for (const n of [3, 5]) {
      const parapet = scene.getObjectByName(`BuildingParapet_${n}`);
      if (parapet) parapet.visible = n === floorCount;
    }
    return {
      car: scene.getObjectByName('Car') ?? undefined,
      doorLeft: scene.getObjectByName('DoorLeftLeaf') ?? undefined,
      doorRight: scene.getObjectByName('DoorRightLeaf') ?? undefined,
      cable: scene.getObjectByName('HoistCable') ?? undefined,
      arrivalLights,
    };
  }, [scene, floorCount]);

  /* eslint-disable react-hooks/immutability -- driving the loaded glTF scene graph imperatively is the standard r3f pattern */
  useFrame(() => {
    const pos = Math.min(floorCount, Math.max(1, numOf(machine.pos, 1)));
    const door = hasDoor ? clamp01(numOf(machine.door, 0)) : 0;
    const r = refs;

    const carY = floorY(pos);
    if (r.car) r.car.position.y = carY;

    if (r.doorLeft) r.doorLeft.position.x = -(DOOR_CLOSED_X + door * DOOR_OPEN_SLIDE);
    if (r.doorRight) r.doorRight.position.x = DOOR_CLOSED_X + door * DOOR_OPEN_SLIDE;

    if (r.cable) {
      const carTop = carY + CAR_HEIGHT;
      const len = SHAFT_TOP_Y - carTop;
      r.cable.scale.y = Math.max(0.02, len / HOIST_CABLE_BASE_LEN);
      r.cable.position.y = (SHAFT_TOP_Y + carTop) / 2;
    }

    const eps = 0.03;
    for (let n = 1; n <= floorCount; n++) {
      const mesh = r.arrivalLights[n];
      const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
      if (!mat) continue;
      const at = Math.abs(pos - n) < eps;
      // Dark albedo even when lit — a bright albedo would pick up scene lighting
      // on top of the emissive glow (see DrillStation3D's stack-light comment).
      mat.emissiveIntensity = at ? 1.2 : 0.2;
      mat.color.set(at ? '#2a1010' : '#0f0808');
      mat.emissive.set(at ? '#ff3020' : '#3a0a0a');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function ElevatorShaft3D({
  machine,
  floorCount,
  hasDoor,
  height = 300,
}: {
  machine: MachineState;
  floorCount: number;
  hasDoor: boolean;
  height?: number;
}) {
  // Frame from just below the floor-1 rest position up through one floor's headroom
  // above the top served floor (not the physical ceiling at SHAFT_TOP_Y, which sits
  // well above floor 5 and would leave the puzzle's real content too small on screen).
  // distance = visibleHeight * 1.15(margin) / (2*tan(17.5deg)) for the 35deg vertical FOV.
  const topMargin = floorY(floorCount) + 3;
  const bottomMargin = -0.5;
  const visibleHeight = topMargin - bottomMargin;
  const distance = visibleHeight * 1.82;
  const targetY = (topMargin + bottomMargin) / 2;
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[0, targetY, distance]}
      target={[0, targetY, 0]}
      interactive={false}
      zoomable
      polarAngle={Math.PI / 2}
      minDistance={distance * 0.45}
      maxDistance={distance * 1.4}
      panBounds={{ x: [-1.5, 1.5], y: [bottomMargin, topMargin] }}
    >
      <ElevatorShaftScene machine={machine} floorCount={floorCount} hasDoor={hasDoor} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
