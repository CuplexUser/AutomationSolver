import { memo, useLayoutEffect } from 'react';
import type * as THREE from 'three';
import { LINE_LIMITS, type MachineState } from '@automationsolver/shared';
import { meshesIn, node, ownMaterial } from '../plant/kit';
import { SplitPiece, StaticPiece, PlantPiece, usePlantClone, usePlantSplit } from '../plant/PlantAsset';
import {
  ANCHOR,
  ASSEMBLY,
  CONV,
  DOCK,
  FINISH,
  FLOOR,
  MACHINE_ON_LINE,
  MACHINE_ZONE_X,
  TEST,
  YARD,
  boolOf,
  bw,
  clamp01,
  cx,
  numOf,
  orderPaint,
  strOf,
} from './plant';
import { Cabinet, CellGuard, FenceRun, Figure, HmiPost, MachineBody, StackLight } from './props';
import { BaySign, FloorMark, FloorText, type LineTextures } from './textures';

/**
 * Row B: assembly, test, dock, yard — everything that turns two parts into a
 * machine and gets it off the site, east to west along the south side.
 *
 * Row A is about parts and row B is about machines, and the scene says so: from
 * the jig onward nothing is a frame or a boom any more, and the yard is the only
 * place on the floor where the plant's output is a countable pile.
 */

// --- Final assembly -----------------------------------------------------------

/** The jig's seat, where a machine's tracks stand. */
const JIG_TOP = 0.6;
/** The top of a machine's counterweight over its tracks' underside, fitted. */
const HOUSE_TOP = 1.26;
/** How far the house hangs above its seat per unit of fitting left (the kit's DROP). */
const HOUSE_DROP = 2.6;
/** The hook's slings reach this far below it, to the house. */
const SLINGS = 0.9;
/** The hook parked up, and the highest it can be pulled under the hoist. */
const HOOK_PARKED = 3.9;
const HOOK_TOP = 4.2;
/** Where the kit's hoist chain hangs from, and the hook block's height over the hook. */
const CHAIN_FROM = 4.47;
const HOOK_BLOCK = 0.06;

/**
 * The jig: a machine growing on a stand under a portal hoist.
 *
 * The frame and the boom carry their own colors, and the jig draws them
 * separately on purpose — a machine wearing two colors is the mis-marry the
 * whole color puzzle is about, and it should be visible from the far end of the
 * building rather than only in a scenario failure message.
 */
export const AssemblyCell = memo(function AssemblyCell({
  tex,
  machine: m,
}: {
  tex: LineTextures;
  machine: MachineState;
}) {
  const [jx, , jz] = ANCHOR.jig;
  const frame = Math.round(numOf(m.assyFrame));
  const boomColor = Math.round(numOf(m.assyBoom));
  const engine = clamp01(numOf(m.assyEngine));
  const cab = clamp01(numOf(m.assyCab));
  const pin = clamp01(numOf(m.assyPin));
  const prep = clamp01(numOf(m.assyPrep));
  const starving = numOf(m.assyStarveMs) > 3000;

  // The hook carries the house down onto the frame, then goes back up.
  const lowering = frame > 0 && engine > 0 && engine < 1;
  const hookY = lowering
    ? Math.min(HOOK_TOP, JIG_TOP + HOUSE_TOP + SLINGS + (1 - engine) * HOUSE_DROP)
    : HOOK_PARKED;

  const hoist = usePlantClone('EngineHoist');
  useLayoutEffect(() => {
    node(hoist, 'HoistHook').position.y = hookY;
    node(hoist, 'HoistChain').scale.y = Math.max(0.05, CHAIN_FROM - hookY - HOOK_BLOCK);
  }, [hoist, hookY]);

  return (
    <group>
      <CellGuard tex={tex.mesh} box={ASSEMBLY} open="north" />
      <BaySign tex={tex.signs.ASSEMBLY} x={cx(ASSEMBLY)} z={ASSEMBLY.z1 - 0.6} y={5.0} rotY={Math.PI} />
      <FloorText tex={tex.tags.ASSEMBLY} x={ASSEMBLY.x0 + 3} z={ASSEMBLY.z0 - 0.9} w={4.6} />

      <StaticPiece name="AssemblyJig" x={jx} z={jz} />
      {frame > 0 && (
        <group position={[jx, JIG_TOP, jz]}>
          <MachineBody
            mat={orderPaint(frame)}
            engine={engine}
            cab={cab}
            boom={boomColor > 0 ? pin : 0}
            boomMat={boomColor > 0 ? orderPaint(boomColor) : undefined}
          />
        </group>
      )}
      <primitive object={hoist} position={[jx, 0, jz]} />

      {/* Boom make-up bench beside the jig: where a boom is pinned up before it
          goes on. Its own progress, because it can run while the engine drops. */}
      <group position={[jx - 4.6, 0, jz + 2.4]}>
        <StaticPiece name="MakeUpBench" />
        {prep > 0 && (
          <mesh position={[0, 1.05, 0]} rotation={[0, 0, prep * 0.12]} castShadow>
            <boxGeometry args={[2.8, 0.3, 0.3]} />
            <meshStandardMaterial {...(boomColor > 0 ? orderPaint(boomColor) : FINISH.blasted)} />
          </mesh>
        )}
      </group>
      <StaticPiece name="PartsBin" x={jx - 2.0} z={jz + 3.2} />
      <StaticPiece name="PartsBin" x={jx - 0.8} z={jz + 3.2} />

      {/* Two fitters, which is what a jig this size actually takes. */}
      <Figure x={jx - 3.2} z={jz - 0.4} rotY={1.3} />
      <Figure x={jx + 1.0} z={jz + 2.6} rotY={-2.4} vest="#facc15" />

      <Cabinet x={ASSEMBLY.x1 - 1.0} z={ASSEMBLY.z0 + 1.2} />
      <HmiPost tex={tex.hmi} x={ASSEMBLY.x1 - 2.4} z={ASSEMBLY.z0 + 1.2} />
      <StackLight
        position={[ASSEMBLY.x1 - 0.4, 0, ASSEMBLY.z0 + 1.2]}
        green={engine > 0 || cab > 0 || pin > 0}
        amber={starving}
        red={boolOf(m.starved)}
      />
    </group>
  );
});

// --- Test bay -----------------------------------------------------------------

const PUMP_LIVE = ['Pump Lamp'] as const;

function ownPump(obj: THREE.Object3D): void {
  ownMaterial(obj, 'Pump Lamp', (m) => m.clone());
}

/**
 * The test pad: a hydraulic power pack, a pit and a machine working its boom.
 *
 * The only station on the line whose output is a *decision* rather than a part,
 * so it is drawn as a bay a machine is driven onto and driven off. The queue
 * standing behind it is Z10 and Z11, which the spine draws — because a test bay
 * that is never the constraint and a test bay that always is look identical
 * unless you can see the queue.
 */
export const TestCell = memo(function TestCell({
  tex,
  machine: m,
}: {
  tex: LineTextures;
  machine: MachineState;
}) {
  const [px, , pz] = ANCHOR.testPad;
  const onPad = boolOf(m.testPart);
  const pump = clamp01(numOf(m.testPump)) > 0;
  const cycle = clamp01(numOf(m.testCycle));
  const away = clamp01(numOf(m.testDispatch));
  // The boom sweeps once through the function test, which is the whole picture:
  // a machine that never lifts is a machine nobody proved.
  const swing = onPad ? Math.sin(cycle * Math.PI * 2) * 0.5 + 0.5 : 0;

  const pack = usePlantSplit('PowerPack', PUMP_LIVE, ownPump);
  useLayoutEffect(() => {
    for (const mesh of meshesIn(pack.live, 'Pump Lamp')) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(pump ? '#e8621a' : '#4a545f');
      mat.emissive.set('#e8621a');
      mat.emissiveIntensity = pump ? 0.9 : 0;
    }
  }, [pack, pump]);

  return (
    <group>
      <BaySign tex={tex.signs.TEST} x={cx(TEST)} z={TEST.z1 - 0.6} y={4.6} rotY={Math.PI} />
      <FloorText tex={tex.tags.TEST} x={TEST.x0 + 2.4} z={TEST.z0 - 0.9} w={4.2} />

      {/* The pad itself, outlined on the slab rather than raised: a machine has
          to drive on and off it. */}
      <FloorMark tex={tex.hazard} x={px} z={pz} w={6.4} d={4.4} repeat={[11, 1]} opacity={0.55} />
      {onPad && (
        // The spine passes straight through this bay, so a machine here stands on
        // the deck, and dispatch drives it on west to Z12, where the spine takes
        // it over. The queue behind it is the spine's to draw.
        <group position={[px + away * (MACHINE_ZONE_X.z12 - px), CONV.deckY, pz]} rotation={[0, Math.PI, 0]}>
          <MachineBody mat={FINISH.painted} swing={swing} scale={MACHINE_ON_LINE} />
        </group>
      )}

      {/* Power pack, its hoses running east toward the pad. */}
      <SplitPiece body={pack.body} live={pack.live} x={TEST.x0 + 1.4} z={pz - 2.6} />

      <Figure x={px - 2.6} z={pz - 1.8} rotY={0.6} vest="#22d3ee" />
      <Cabinet x={TEST.x1 - 0.9} z={TEST.z0 + 1.2} />
      <StackLight
        position={[TEST.x1 - 2.2, 0, TEST.z0 + 1.2]}
        green={cycle > 0}
        amber={onPad && cycle <= 0}
        red={boolOf(m.jam)}
      />
    </group>
  );
});

// --- Dock ---------------------------------------------------------------------

/** The load port on the building line behind the dock, and the platform inside it. */
const PORT_Z = FLOOR.z1;
const PLATFORM_Z = PORT_Z - 1.05;
/** The south edge of the spine's run D, where the walkway to the platform starts. */
const CONV_EDGE = ANCHOR.testPad[2] + CONV.width / 2 + 0.2;
/**
 * Where the lorry's deck middle stands when it is backed onto the port: its tail
 * (4.5 m behind the middle) against the shelter, cab out toward the road.
 */
const PARKED_Z = PORT_Z + 0.35 + 4.5;
/** How far out the lorry starts reversing in from, and how far it drives off. */
const ROAD_IN = 18;
const ROAD_OUT = 24;
/** The apron outside the port: long enough for the lorry to arrive and leave on. */
const APRON = { w: 10, d: 34 };
const PORT_LIVE = ['Lamp Red', 'Lamp Green'] as const;

function ownSignal(obj: THREE.Object3D): void {
  for (const name of PORT_LIVE) ownMaterial(obj, name, (mat) => mat.clone());
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The dock: a raised platform inside a load port in the building line, and a
 * lorry that backs up to the port from the road, loads, and drives off.
 *
 * Calling the lorry is a scheduling decision with a cost on both sides — send it
 * early and it stands at the dock doing nothing, send it late and the yard backs
 * up — so the lorry is drawn *arriving* and *leaving*, on the process's own
 * clocks, and never anywhere but the road and the port: it does not enter the
 * plant. The port's signal shows red while it loads and green while it moves.
 */
export const DockCell = memo(function DockCell({
  tex,
  machine: m,
  cap,
}: {
  tex: LineTextures;
  machine: MachineState;
  /** How many machines fill a lorry, so the deck can show how full it is. */
  cap: number;
}) {
  const [tx] = ANCHOR.truckBay;
  const state = strOf(m.truckState, 'away');
  const t = numOf(m.truckT);
  const load = numOf(m.truckLoad);
  const here = state === 'coming' || state === 'docked' || state === 'leaving';
  // Reversing in over the arrival time, then away forwards over the clearing time.
  const offset =
    state === 'coming'
      ? (1 - easeInOut(clamp01(t / LINE_LIMITS.TRUCK_ARRIVE_MS))) * ROAD_IN
      : state === 'leaving'
        ? easeInOut(clamp01(t / LINE_LIMITS.TRUCK_CLEAR_MS)) * ROAD_OUT
        : 0;

  const port = usePlantSplit('DockDoor', PORT_LIVE, ownSignal);
  useLayoutEffect(() => {
    const lit = { 'Lamp Red': state === 'docked', 'Lamp Green': state === 'coming' || state === 'leaving' };
    for (const name of PORT_LIVE) {
      for (const mesh of meshesIn(port.live, name)) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = lit[name] ? 1.6 : 0;
      }
    }
  }, [port, state]);

  return (
    <group>
      <BaySign tex={tex.signs.DOCK} x={cx(DOCK)} z={DOCK.z1 - 0.6} y={4.4} rotY={Math.PI} />
      <FloorText tex={tex.tags.DOCK} x={DOCK.x0 + 2.2} z={DOCK.z0 - 0.9} w={4.2} />

      {/* The platform against the port, and the walkway machines are driven up to it on. */}
      <StaticPiece name="DockFace" x={tx} z={PLATFORM_Z} />
      <FloorMark tex={tex.walkway} x={tx} z={(PLATFORM_Z - 1 + CONV_EDGE) / 2} w={7.0} d={PLATFORM_Z - 1 - CONV_EDGE} repeat={[3, 1]} />
      <SplitPiece body={port.body} live={port.live} x={tx} z={PORT_Z} />

      {/* The apron outside, which the lorry arrives and leaves on. */}
      <mesh position={[tx, 0, PORT_Z + APRON.d / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[APRON.w, APRON.d]} />
        <meshStandardMaterial color="#2b2f35" roughness={0.95} metalness={0} />
      </mesh>

      {here && (
        // Built with its cab toward +x; turned so the cab faces the road and the tail the port.
        <group position={[tx, 0, PARKED_Z + offset]} rotation={[0, -Math.PI / 2, 0]}>
          <PlantPiece name="Lorry" />
          {/* Crated machines on the deck, clear of it rather than on it. */}
          {Array.from({ length: Math.min(cap, Math.round(load)) }, (_, i) => (
            <mesh key={i} position={[-3.6 + i * 1.4, 1.75, 0]} castShadow>
              <boxGeometry args={[1.2, 0.68, 2.0]} />
              <meshStandardMaterial {...FINISH.painted} />
            </mesh>
          ))}
        </group>
      )}

      {/* A loader up on the dock, and the bay's light beside the platform. */}
      <Figure x={tx + 2.0} y={1.1} z={PLATFORM_Z - 0.3} rotY={0} vest="#f97316" />
      <StackLight
        position={[tx + 4.1, 0, PLATFORM_Z]}
        green={state === 'docked'}
        amber={state === 'coming' || state === 'leaving'}
        red={false}
      />
    </group>
  );
});

// --- Yard ---------------------------------------------------------------------

/**
 * The yard: numbered bays outside the west wall, and the plant's only backlog.
 *
 * A full yard is what stops the test bay dispatching, so it is not decoration:
 * six machines parked here means the next one has nowhere to go, and the player
 * needs to be able to count them without opening a readout.
 */
export const YardCell = memo(function YardCell({
  tex,
  count,
  cap,
}: {
  tex: LineTextures;
  count: number;
  cap: number;
}) {
  const w = bw(YARD);
  const rows = Math.ceil(cap / 2);
  return (
    <group>
      <BaySign tex={tex.signs.YARD} x={cx(YARD)} z={YARD.z0 - 0.8} y={4.2} />
      {/* Numbered bays, filled front to back. */}
      {Array.from({ length: cap }, (_, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx = YARD.x0 + 2.0 + col * (w - 4.0);
        const bz = YARD.z0 + 1.8 + (row * (YARD.z1 - YARD.z0 - 3.6)) / Math.max(1, rows - 1);
        return (
          <group key={i}>
            <FloorMark tex={tex.hazard} x={bx} z={bz} w={3.6} d={2.6} repeat={[7, 1]} opacity={0.35} />
            <FloorText tex={tex.yardBays[i]} x={bx} z={bz + 1.6} w={2.2} />
            {i < count && (
              <group position={[bx, 0, bz]} rotation={[0, Math.PI / 2, 0]} scale={0.9}>
                <MachineBody mat={FINISH.painted} />
              </group>
            )}
          </group>
        );
      })}
      {/* The yard is outside, so it gets a perimeter fence and a floodlight. */}
      <FenceRun tex={tex.mesh} from={[YARD.x0 - 0.4, YARD.z0 - 1]} to={[YARD.x0 - 0.4, YARD.z1 + 1]} height={2.8} />
      <StaticPiece name="YardMast" x={YARD.x0 + 0.4} z={YARD.z1 - 0.2} rotY={(3 * Math.PI) / 4} />
    </group>
  );
});
