import { memo, useLayoutEffect } from 'react';
import type * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { meshesIn, node, ownMaterial } from '../plant/kit';
import { SplitPiece, StaticPiece, PlantPiece, usePlantClone, usePlantSplit } from '../plant/PlantAsset';
import {
  ANCHOR,
  ASSEMBLY,
  CONV,
  DOCK,
  FINISH,
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
 * so it is drawn as a bay a machine is driven onto and driven off, with a queue
 * standing behind it — because a test bay that is never the constraint and a
 * test bay that always is look identical unless you can see the queue.
 */
export const TestCell = memo(function TestCell({
  tex,
  machine: m,
  queue,
}: {
  tex: LineTextures;
  machine: MachineState;
  /** How many machines are waiting on the approach. */
  queue: number;
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
        // The dispatch run rides the spine, which passes straight through this
        // bay, so a machine here stands on the deck rather than on the slab.
        <group position={[px + away * 8, CONV.deckY, pz]}>
          <MachineBody mat={FINISH.painted} swing={swing} />
        </group>
      )}

      {/* Power pack, its hoses running east toward the pad. */}
      <SplitPiece body={pack.body} live={pack.live} x={TEST.x0 + 1.4} z={pz - 2.6} />

      {/* Approach queue: machines standing off the pad waiting their turn. */}
      {Array.from({ length: Math.min(3, queue) }, (_, i) => (
        <group key={i} position={[px + 5.4 + i * 4.2, CONV.deckY, pz]}>
          <MachineBody mat={FINISH.painted} />
        </group>
      ))}

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

/**
 * Where the dock platform stands: its working edge against the docked lorry's
 * side, and not under it. The lorry is 2.68 m across its stake pockets.
 */
const DOCK_FACE_Z = ANCHOR.truckBay[2] + 1.34 + 1.0;

/**
 * The dock: a raised platform, and a lorry that is either there or is not.
 *
 * Calling the lorry is a scheduling decision with a cost on both sides — send it
 * early and it stands at the dock doing nothing, send it late and the yard backs
 * up — so the truck has to be visibly *arriving* and *leaving* rather than
 * blinking into place, and `truckState` is drawn as a position on the approach.
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
  const [tx, , tz] = ANCHOR.truckBay;
  const state = strOf(m.truckState, 'away');
  const load = numOf(m.truckLoad);
  // Off to the west when away, at the bay when docked, sliding through between.
  const offset =
    state === 'at' ? 0 : state === 'arriving' ? -6 : state === 'leaving' ? 9 : -16;
  const here = state !== 'away';

  return (
    <group>
      <BaySign tex={tex.signs.DOCK} x={cx(DOCK)} z={DOCK.z1 - 0.6} y={4.4} rotY={Math.PI} />
      <FloorText tex={tex.tags.DOCK} x={DOCK.x0 + 2.2} z={DOCK.z0 - 0.9} w={4.2} />

      {/* The platform, its edge and bumpers toward the lorry, and the apron in front. */}
      <StaticPiece name="DockFace" x={tx} z={DOCK_FACE_Z} rotY={Math.PI} />
      <FloorMark tex={tex.walkway} x={tx} z={tz - 1.6} w={7.0} d={2.2} repeat={[3, 1]} />

      {here && (
        <group position={[tx + offset, 0, tz]}>
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

      {/* A loader up on the dock, and the bay's light beside it. */}
      <Figure x={tx + 2.0} y={1.1} z={DOCK_FACE_Z + 0.3} rotY={Math.PI} vest="#f97316" />
      <StackLight
        position={[DOCK.x1 - 0.6, 0, DOCK_FACE_Z]}
        green={state === 'at'}
        amber={state === 'arriving' || state === 'leaving'}
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
