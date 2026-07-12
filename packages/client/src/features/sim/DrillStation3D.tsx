import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';

const MODEL_URL = '/models/drill-station.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Rest-pose coordinates read from the exported glb (see drill-station.glb node
// transforms) plus hand-picked travel ranges/targets measured against the
// block/rod geometry — kept here rather than re-derived from the scene graph
// each frame so the drive logic reads as plain arithmetic.
const PART_TOP = 0.95;
const HEAD_Y = { retracted: 3.4, extended: 2.15 };
const BIT_TIP_LOCAL_Y = -2.1; // Bit's local offset within SpindleHead, at the bit's tip
const SPIN_SPEED = 22; // rad/s
const ROLLER_SPIN_SPEED = 10; // rad/s, while the block is being pushed out

// The mechanism: HOLD (cylinder 1) presses the block, from the X axis, against
// a FIXED wall. PUSH (cylinder 2) sits 90 degrees away on the Z axis (three.js
// space — this is the model's Y/depth axis in Blender) and, once the cycle is
// done, extends to shove the block off the platform onto the roller band. The
// feed conveyor enters from the opposite end of that same Z axis. A block that
// has just been ejected is a *different* block from the one that drops in for
// the next cycle, so a small stage machine (not just a continuous lerp) avoids
// the ejected block sliding back onto the platform when the push rod itself
// retracts for the next cycle.
const BLOCK_HALF_WIDTH = 0.725; // measured from BlockWallXNeg/XPos geometry
const BLOCK_HALF_DEPTH = 0.825; // measured from BlockWallYNeg/YPos geometry
const BLOCK_STOP_X = -1; // rest X, matches Block's authored translation — never changes now
const BLOCK_REST_Y = 0.475; // platform height (Block's authored translation.y)
const BLOCK_CHUTE_Y = 2.75; // height up on the incline feed conveyor
const BLOCK_STOP_Z = 0; // rest depth (platform), matches Block's authored translation
const BLOCK_EJECT_Z = -2.0; // resting on the roller band
const BLOCK_CHUTE_Z = 3.9; // depth offset back at the top of the feed incline

const HOLD_ROD_BASE_LEN = 1.0;
const HOLD_BODY_FACE_X = -3.2; // ActuatorBodyL's right face
const HOLD_RETRACTED_TIP_X = -3.0; // short stub, clamp = 0
const HOLD_TOUCH_TIP_X = BLOCK_STOP_X - BLOCK_HALF_WIDTH; // touches the block, clamp = 1

const PUSH_ROD_BASE_LEN = 1.0;
const PUSH_BODY_FACE_Z = 2.0; // PushBody's face nearest the platform
const PUSH_STOP_TIP_Z = BLOCK_STOP_Z + BLOCK_HALF_DEPTH; // touches the block, push = 0
const PUSH_EJECTED_TIP_Z = BLOCK_EJECT_Z + BLOCK_HALF_DEPTH; // fully shoved out, push = 1

const PUSH_RATE = 1 / 0.5; // seconds for a full eject stroke
const DROP_RATE = 1 / 0.35; // seconds for a fresh block to drop into place

type BlockStage = 'platform' | 'ejecting' | 'ejected' | 'dropping';
interface BlockAnim {
  stage: BlockStage;
  push: number; // 0 = at the platform/stop, 1 = fully ejected onto the roller band
  drop: number; // 0 = up on the feed incline, 1 = landed on the platform
}

interface DriveRefs {
  holdRod?: THREE.Object3D;
  pushRod?: THREE.Object3D;
  block?: THREE.Object3D;
  spindleHead?: THREE.Object3D;
  bit?: THREE.Object3D;
  blockFloor?: THREE.Mesh;
  stackRed?: THREE.Mesh;
  stackGreen?: THREE.Mesh;
  rollers: THREE.Object3D[];
}

function DrillStationScene({ machine }: { machine: MachineState }) {
  const { scene } = useGLTF(MODEL_URL);
  const refs = useMemo<DriveRefs>(() => {
    const rollers: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) {
      const roller = scene.getObjectByName(`Roller_${i}`);
      if (roller) rollers.push(roller);
    }
    return {
      holdRod: scene.getObjectByName('HoldRod') ?? undefined,
      pushRod: scene.getObjectByName('PushRod') ?? undefined,
      block: scene.getObjectByName('Block') ?? undefined,
      spindleHead: scene.getObjectByName('SpindleHead') ?? undefined,
      bit: scene.getObjectByName('Bit') ?? undefined,
      blockFloor: scene.getObjectByName('BlockFloor') as THREE.Mesh | undefined,
      stackRed: scene.getObjectByName('StackLightRed') as THREE.Mesh | undefined,
      stackGreen: scene.getObjectByName('StackLightGreen') as THREE.Mesh | undefined,
      rollers,
    };
  }, [scene]);

  const anim = useRef<BlockAnim>({ stage: 'platform', push: 0, drop: 1 });

  // The loaded glTF scene graph and the block-stage tracker are both external-
  // system state (three.js's own object tree, and a plain animation clock) —
  // driving them imperatively every frame here is the standard r3f pattern and
  // avoids re-rendering the React tree on every tick.
  /* eslint-disable react-hooks/immutability */
  useFrame((_state, dt) => {
    const clamp = clamp01(numOf(machine.clamp));
    const feed = clamp01(numOf(machine.drill));
    const spinning = boolOf(machine.spinning);
    const warning = boolOf(machine.warning);
    const done = boolOf(machine.done);
    const r = refs;
    const a = anim.current;

    // Block stage machine: a block that's already ejected is not the same block
    // that will drop in for the next cycle, so we track discrete stages rather
    // than a single continuous lerp (see comment on BLOCK_HALF_WIDTH above).
    if (a.stage === 'platform' && done) a.stage = 'ejecting';
    if (a.stage === 'ejecting') {
      a.push = Math.min(1, a.push + PUSH_RATE * dt);
      if (a.push >= 1) a.stage = 'ejected';
    }
    if (a.stage === 'ejected' && !done) {
      a.stage = 'dropping';
      a.push = 0;
      a.drop = 0;
    }
    if (a.stage === 'dropping') {
      a.drop = Math.min(1, a.drop + DROP_RATE * dt);
      if (a.drop >= 1) a.stage = 'platform';
    }

    if (r.holdRod) {
      const tipX = HOLD_RETRACTED_TIP_X + (HOLD_TOUCH_TIP_X - HOLD_RETRACTED_TIP_X) * clamp;
      r.holdRod.position.x = (HOLD_BODY_FACE_X + tipX) / 2;
      r.holdRod.scale.x = Math.max(0.05, tipX - HOLD_BODY_FACE_X) / HOLD_ROD_BASE_LEN;
    }
    if (r.pushRod) {
      const tipZ = PUSH_STOP_TIP_Z + (PUSH_EJECTED_TIP_Z - PUSH_STOP_TIP_Z) * a.push;
      r.pushRod.position.z = (PUSH_BODY_FACE_Z + tipZ) / 2;
      r.pushRod.scale.z = Math.max(0.05, PUSH_BODY_FACE_Z - tipZ) / PUSH_ROD_BASE_LEN;
    }
    if (r.block) {
      r.block.position.y = BLOCK_CHUTE_Y + (BLOCK_REST_Y - BLOCK_CHUTE_Y) * a.drop;
      const stopOrEjectZ = BLOCK_STOP_Z + (BLOCK_EJECT_Z - BLOCK_STOP_Z) * a.push;
      r.block.position.z = BLOCK_CHUTE_Z + (stopOrEjectZ - BLOCK_CHUTE_Z) * a.drop;
    }
    for (const roller of r.rollers) {
      if (a.stage === 'ejecting') roller.rotation.x += ROLLER_SPIN_SPEED * dt;
    }

    let bitTip = PART_TOP;
    if (r.spindleHead) {
      const headY = HEAD_Y.retracted + (HEAD_Y.extended - HEAD_Y.retracted) * feed;
      r.spindleHead.position.y = headY;
      bitTip = clamp01((headY + BIT_TIP_LOCAL_Y) / PART_TOP) * PART_TOP;
    }
    if (r.bit && spinning) r.bit.rotation.y += SPIN_SPEED * dt;

    if (r.blockFloor) {
      // BlockFloor is centered on Block's own origin (which sits at the block's
      // vertical mid-height), so its local Y must offset by -PART_TOP/2 to keep
      // the floor's *base* fixed while the top shrinks down as the bore deepens.
      const floorH = Math.max(0.02, Math.min(PART_TOP, bitTip));
      r.blockFloor.scale.y = floorH / PART_TOP;
      r.blockFloor.position.y = floorH / 2 - PART_TOP / 2;
    }

    const mat = (obj: THREE.Mesh | undefined) =>
      obj?.material as THREE.MeshStandardMaterial | undefined;
    const redMat = mat(r.stackRed);
    if (redMat) {
      redMat.emissiveIntensity = warning ? 4 : 0.25;
      redMat.emissive.set(warning ? '#ff3030' : '#3a0a0a');
    }
    const greenMat = mat(r.stackGreen);
    if (greenMat) {
      greenMat.emissiveIntensity = done ? 4 : 0.25;
      greenMat.emissive.set(done ? '#30ff70' : '#0a2410');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function DrillStation3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <div className="machine3d" style={{ height }}>
      <Canvas camera={{ position: [8, 5.5, 9], fov: 35 }} shadows={false}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1.6} />
        <directionalLight position={[-6, 4, -4]} intensity={0.4} />
        <Suspense fallback={null}>
          <DrillStationScene machine={machine} />
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          minPolarAngle={0.75}
          maxPolarAngle={0.75}
          minDistance={7}
          maxDistance={22}
          target={[0, 2, 0]}
        />
      </Canvas>
      <span className="machine3d-hint">drag to rotate · scroll to zoom</span>
    </div>
  );
}

useGLTF.preload(MODEL_URL);
