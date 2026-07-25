import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

const MODEL_URL = '/models/drill-station.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Every coordinate below is in the glb's own units: the station is modelled at
// roughly 1 m across and its exported root scales x10, so these numbers stay in
// the model's local space while the scene ends up the same size as the other
// machines. Rest poses were read off the exported node transforms; travel
// distances were measured against the fixture, cylinder and belt geometry.
const HEAD_Y = { retracted: 0.41, extended: 0.325 };
const HOLD_X = { open: 0.382, closed: 0.36 };
const PUSH_Z = { home: -0.314, ejected: -0.194 };
const SPIN_SPEED = 26; // rad/s

// Infeed roller conveyor. The queue indexes forward by exactly one part each
// time a finished part leaves the machine — a conveyor that ran continuously
// would keep pushing parts into a station that isn't asking for them. Positions
// wrap over INFEED_SPAN so the queue never runs dry. The rollers turn at the
// matching surface speed (radius 0.014); their axis runs along Z and a part on
// top travels +X, which is a *negative* turn about that axis.
const INFEED_SPEED = 0.055; // units/s while indexing
const INFEED_ROLLER_TURN = -1 / 0.014; // radians of roller per unit of queue travel
const INFEED_START_X = -0.62;
const INFEED_SPAN = 0.48;
const INFEED_PITCH = 0.08;
const INFEED_VISIBLE = { from: -0.615, to: -0.16 }; // hidden off the roller bed / inside the chute

// Outfeed belt. The belt surface itself is not animated — the drilled part
// gliding along it is what reads as transport. Fast enough that the part has
// normally left the far end (and been hidden) before the next cycle recycles it.
const BELT_SPEED = 0.38; // units/s
const BELT_EXIT_Z = 0.5; // past the far drum — the part is done travelling

// The bore: BlockBody has a real (boolean-cut) blind hole, and BlockPlug is a
// separate cylinder of the same material filling it. At drill = 0 the plug fills
// the hole flush with the top face, reading as solid material; as the bit
// plunges in, the plug's top edge recedes toward the hole's floor, revealing the
// real cavity underneath — the part itself never moves or changes shape. Both
// values are in Block's local space.
const HOLE_DEPTH = 0.028;
const HOLE_BOTTOM_Y = -0.007;

// The mechanism: HOLD (cylinder 1) presses the part along X against the fixed
// StationStop. PUSH (cylinder 2) sits 90 degrees away on Z and, once ejecting is
// commanded (Y4), shoves the part off the fixture onto the outfeed belt; an
// "Ejected" sensor (X4) stops it once the part is clear. Fresh parts arrive from
// the opposite direction, sliding out of the gravity chute onto the fixture — so
// they travel in X and Y while the eject travels in Z. A part that has just been
// ejected is a *different* part from the one that drops in for the next cycle,
// so a small stage machine (not just a continuous lerp) keeps the ejected part
// from sliding back onto the fixture when the push rod itself retracts.
const BLOCK_REST = { x: 0.27, y: 0.061, z: -0.2 };
const BLOCK_CHUTE = { x: 0.195, y: 0.112 }; // sitting on the feed tray at the chute mouth
const BLOCK_EJECT_Z = -0.08; // landing point on the outfeed belt

// The feed is a slide then a drop rather than one diagonal: the part rides the
// feed tray clear across the fixed StationStop first, and only falls the last
// 50 mm onto the fixture once it is past it. A straight lerp would cut the
// corner through both the stop and the retracted drill bit.
const DROP_RATE = 1 / 0.5; // seconds for a fresh part to reach the fixture
const SLIDE_FRACTION = 0.55; // of that, the share spent sliding before the drop

type BlockStage = 'fixture' | 'ejected' | 'dropping';
interface BlockAnim {
  stage: BlockStage;
  drop: number; // 0 = at the chute mouth, 1 = landed on the fixture
  // Deepest the bit has reached into the current part. The hole this drives (via
  // BlockPlug below) must persist once drilled rather than re-filling as the bit
  // retracts, so this tracks a running max instead of the live feed.
  maxFeed: number;
  carry: number; // how far the ejected part has ridden down the outfeed belt
  infeed: number; // distance the infeed queue has travelled so far
  infeedTarget: number; // where it is indexing to — one more pitch per part shipped
}

interface DriveRefs {
  holdRod?: THREE.Object3D;
  pushRod?: THREE.Object3D;
  block?: THREE.Object3D;
  spindleHead?: THREE.Object3D;
  bit?: THREE.Object3D;
  blockPlug?: THREE.Object3D;
  stackRed?: THREE.Mesh;
  stackGreen?: THREE.Mesh;
  rollers: THREE.Object3D[];
  infeed: THREE.Object3D[];
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

function DrillStationScene({ machine }: { machine: MachineState }) {
  const { scene } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);
  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    return {
      holdRod: scene.getObjectByName('HoldRod') ?? undefined,
      pushRod: scene.getObjectByName('PushRod') ?? undefined,
      block: scene.getObjectByName('Block') ?? undefined,
      spindleHead: scene.getObjectByName('SpindleHead') ?? undefined,
      bit: scene.getObjectByName('Bit') ?? undefined,
      blockPlug: scene.getObjectByName('BlockPlug') ?? undefined,
      stackRed: scene.getObjectByName('StackLightRed') as THREE.Mesh | undefined,
      stackGreen: scene.getObjectByName('StackLightGreen') as THREE.Mesh | undefined,
      rollers: series(scene, 'Roller_'),
      infeed: series(scene, 'InfeedPart_'),
    };
  }, [scene]);

  const anim = useRef<BlockAnim>({
    stage: 'fixture',
    drop: 1,
    maxFeed: 0,
    carry: 0,
    infeed: 0,
    infeedTarget: 0,
  });

  // The loaded glTF scene graph and the block-stage tracker are both external-
  // system state (three.js's own object tree, and a plain animation clock) —
  // driving them imperatively every frame here is the standard r3f pattern and
  // avoids re-rendering the React tree on every tick.
  /* eslint-disable react-hooks/immutability */
  useFrame((_state, dt) => {
    const clamp = clamp01(numOf(machine.clamp));
    const feed = clamp01(numOf(machine.drill));
    const push = clamp01(numOf(machine.push));
    const spinning = boolOf(machine.spinning);
    const warning = boolOf(machine.warning);
    const done = boolOf(machine.done);
    const r = refs;
    const a = anim.current;

    // Part stage machine: a part that's already ejected is not the same part that
    // will drop in for the next cycle, so we track discrete stages rather than a
    // single continuous lerp (see the comment on BLOCK_REST above). machine.push
    // is a real, player-controlled (Y4/X4) signal, so the rod itself is driven
    // straight off it; only the part's own Z needs a stage so it doesn't slide
    // back when the rod retracts after a full eject.
    if (a.stage === 'fixture' && push >= 1) {
      a.stage = 'ejected';
      a.carry = 0;
      a.infeedTarget += INFEED_PITCH; // a part shipped, so index the queue up by one
    }
    if (a.stage === 'ejected' && !done) {
      a.stage = 'dropping';
      a.drop = 0;
      a.maxFeed = 0; // a fresh part arrives undrilled
    }
    a.maxFeed = Math.max(a.maxFeed, feed);
    if (a.stage === 'dropping') {
      a.drop = Math.min(1, a.drop + DROP_RATE * dt);
      if (a.drop >= 1) a.stage = 'fixture';
    }
    if (a.stage === 'ejected') a.carry += BELT_SPEED * dt;
    if (a.infeed < a.infeedTarget) {
      a.infeed = Math.min(a.infeedTarget, a.infeed + INFEED_SPEED * dt);
    }
    // 0 = at the fixture stop, 1 = fully ejected — frozen at 1 once the part has
    // actually left, 0 once a fresh one is dropping onto the empty fixture, and
    // tracking the live rod otherwise.
    const blockPushProgress = a.stage === 'ejected' ? 1 : a.stage === 'dropping' ? 0 : push;

    // Both cylinders are authored with their rods running deep into the barrel,
    // so the stroke is a plain translation — no stretching needed to keep the rod
    // through its end cap.
    if (r.holdRod) r.holdRod.position.x = HOLD_X.open + (HOLD_X.closed - HOLD_X.open) * clamp;
    if (r.pushRod) r.pushRod.position.z = PUSH_Z.home + (PUSH_Z.ejected - PUSH_Z.home) * push;

    if (r.block) {
      const slide = clamp01(a.drop / SLIDE_FRACTION);
      const fall = clamp01((a.drop - SLIDE_FRACTION) / (1 - SLIDE_FRACTION));
      const ejectZ = BLOCK_REST.z + (BLOCK_EJECT_Z - BLOCK_REST.z) * blockPushProgress;
      // The belt ride only applies to the part that is actually on the belt —
      // leaving it in once a fresh part has dropped would park that part a whole
      // belt-length downstream (and past BELT_EXIT_Z, so invisible).
      const beltRide = a.stage === 'ejected' ? a.carry : 0;
      r.block.position.x = BLOCK_CHUTE.x + (BLOCK_REST.x - BLOCK_CHUTE.x) * slide;
      r.block.position.y = BLOCK_CHUTE.y + (BLOCK_REST.y - BLOCK_CHUTE.y) * fall;
      r.block.position.z = ejectZ + beltRide;
      // Once it has ridden off the far end of the belt the part is gone; hiding
      // it there is also what keeps the jump back up to the chute out of sight.
      r.block.visible = r.block.position.z < BELT_EXIT_Z;
    }

    // Infeed queue. Both the parts and the rollers are driven straight off the
    // travelled distance, so they simply stand still between index moves.
    for (const roller of r.rollers) roller.rotation.z = a.infeed * INFEED_ROLLER_TURN;
    r.infeed.forEach((part, i) => {
      const x = INFEED_START_X + ((i * INFEED_PITCH + a.infeed) % INFEED_SPAN);
      part.position.x = x;
      part.visible = x > INFEED_VISIBLE.from && x < INFEED_VISIBLE.to;
    });

    if (r.spindleHead) {
      r.spindleHead.position.y = HEAD_Y.retracted + (HEAD_Y.extended - HEAD_Y.retracted) * feed;
    }
    if (r.bit && spinning) r.bit.rotation.y += SPIN_SPEED * dt;

    if (r.blockPlug) {
      // Driven by maxFeed (not the live feed) so the hole stays drilled once
      // made, instead of visually re-filling as the bit retracts afterward.
      const remaining = Math.max(0.02, 1 - a.maxFeed);
      r.blockPlug.scale.y = remaining;
      r.blockPlug.position.y = HOLE_BOTTOM_Y + (HOLE_DEPTH * remaining) / 2;
    }

    const mat = (obj: THREE.Mesh | undefined) =>
      obj?.material as THREE.MeshStandardMaterial | undefined;
    const redMat = mat(r.stackRed);
    if (redMat) {
      redMat.emissiveIntensity = warning ? 1.3 : 0.2;
      redMat.color.set(warning ? '#ff2020' : '#3a0a0a');
      redMat.emissive.set(warning ? '#ff2020' : '#3a0a0a');
    }
    const greenMat = mat(r.stackGreen);
    if (greenMat) {
      // Keep the albedo dark even when lit — a bright albedo picks up diffuse/
      // specular reflection from the scene lights on top of the emissive glow,
      // and #37d67a's blue component clipped both G and B channels to white
      // under that combined light. Driving the glow through emissive alone
      // (with a blue-free hue) avoids that clipping.
      greenMat.emissiveIntensity = done ? 1.1 : 0.2;
      greenMat.color.set(done ? '#0c3a1c' : '#0a2410');
      greenMat.emissive.set(done ? '#00c040' : '#0a2410');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function DrillStation3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[14, 11, 14]}
      fov={26}
      target={[0.4, 1.6, -0.4]}
      minDistance={12}
      maxDistance={34}
    >
      <DrillStationScene machine={machine} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
