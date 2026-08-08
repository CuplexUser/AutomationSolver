import { memo } from 'react';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import {
  ANCHOR,
  ASSEMBLY,
  DARK_STEEL,
  DOCK,
  FINISH,
  GLASS,
  MACHINE,
  POWER,
  RUBBER,
  STEEL,
  STRUCTURE,
  TEST,
  YARD,
  boolOf,
  bw,
  clamp01,
  cx,
  cz,
  numOf,
  orderPaint,
  strOf,
} from './plant';
import { Cabinet, CellGuard, Figure, HmiPost, MachineBody, StackLight } from './props';
import { BaySign, FloorMark, FloorText, HazardBand, type LineTextures } from './textures';

/**
 * Row B: assembly, test, dock, yard — everything that turns two parts into a
 * machine and gets it off the site, east to west along the south side.
 *
 * Row A is about parts and row B is about machines, and the scene says so: from
 * the jig onward nothing is a frame or a boom any more, and the yard is the only
 * place on the floor where the plant's output is a countable pile.
 */

// --- Final assembly -----------------------------------------------------------

/**
 * The jig: a machine growing on a stand under an engine hoist.
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

  return (
    <group>
      <CellGuard tex={tex.mesh} box={ASSEMBLY} open="north" />
      <BaySign tex={tex.signs.ASSEMBLY} x={cx(ASSEMBLY)} z={ASSEMBLY.z1 - 0.6} y={5.0} rotY={Math.PI} />
      <FloorText tex={tex.tags.ASSEMBLY} x={ASSEMBLY.x0 + 3} z={ASSEMBLY.z0 - 0.9} w={4.6} />

      {/* Jig stand, taped, with the machine standing on it. */}
      <mesh position={[jx, 0.3, jz]} castShadow receiveShadow>
        <boxGeometry args={[5.2, 0.6, 3.4]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      <HazardBand tex={tex.hazard} x={jx} z={jz} w={5.2} d={3.4} y={0.3} h={0.3} />
      {frame > 0 && (
        <group position={[jx, 0.6, jz]}>
          <MachineBody
            mat={orderPaint(frame)}
            engine={engine}
            cab={cab}
            boom={boomColor > 0 ? pin : 0}
            boomMat={boomColor > 0 ? orderPaint(boomColor) : undefined}
          />
        </group>
      )}

      {/* Engine hoist: a monorail over the jig with the block hanging where the
          house is on its way down from. */}
      {[-2.6, 2.6].map((dz) => (
        <mesh key={dz} position={[jx + 1.2, 2.6, jz + dz]} castShadow>
          <boxGeometry args={[0.28, 5.2, 0.28]} />
          <meshStandardMaterial {...STRUCTURE} />
        </mesh>
      ))}
      <mesh position={[jx + 1.2, 5.2, jz]} castShadow>
        <boxGeometry args={[0.34, 0.34, 6.0]} />
        <meshStandardMaterial {...STRUCTURE} />
      </mesh>
      <group position={[jx, 0, jz]}>
        <mesh position={[0, 4.9, 0]} castShadow>
          <boxGeometry args={[0.8, 0.4, 0.7]} />
          <meshStandardMaterial {...POWER} />
        </mesh>
        <mesh position={[0, 3.9 + engine * 0.6, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.8, 6]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      </group>

      {/* Boom make-up bench beside the jig: where a boom is pinned up before it
          goes on. Its own progress, because it can run while the engine drops. */}
      <group position={[jx - 4.6, 0, jz + 2.4]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.4, 0.9, 1.5]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        {prep > 0 && (
          <mesh position={[0, 1.05, 0]} rotation={[0, 0, prep * 0.12]} castShadow>
            <boxGeometry args={[2.8, 0.3, 0.3]} />
            <meshStandardMaterial {...(boomColor > 0 ? orderPaint(boomColor) : FINISH.blasted)} />
          </mesh>
        )}
      </group>

      {/* Two fitters, which is what a jig this size actually takes. */}
      <Figure x={jx - 3.2} z={jz - 0.4} rotY={1.3} />
      <Figure x={jx + 0.6} z={jz + 2.6} rotY={-2.4} vest="#facc15" />

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
  const pump = clamp01(numOf(m.testPump));
  const cycle = clamp01(numOf(m.testCycle));
  const away = clamp01(numOf(m.testDispatch));
  // The boom sweeps once through the function test, which is the whole picture:
  // a machine that never lifts is a machine nobody proved.
  const swing = onPad ? Math.sin(cycle * Math.PI * 2) * 0.5 + 0.5 : 0;

  return (
    <group>
      <BaySign tex={tex.signs.TEST} x={cx(TEST)} z={TEST.z1 - 0.6} y={4.6} rotY={Math.PI} />
      <FloorText tex={tex.tags.TEST} x={TEST.x0 + 2.4} z={TEST.z0 - 0.9} w={4.2} />

      {/* The pad itself, outlined on the slab rather than raised: a machine has
          to drive on and off it. */}
      <FloorMark tex={tex.hazard} x={px} z={pz} w={6.4} d={4.4} repeat={[11, 1]} opacity={0.55} />
      {onPad && (
        <group position={[px + away * 8, 0, pz]}>
          <MachineBody mat={FINISH.painted} swing={swing} />
        </group>
      )}

      {/* Power pack, and the hose running from it to the pad. */}
      <group position={[TEST.x0 + 1.4, 0, pz - 2.6]}>
        <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.9, 1.5, 1.2]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
        <mesh position={[0, 1.62, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.24, 14]} />
          <meshStandardMaterial
            color={pump > 0 ? '#e8621a' : '#4a545f'}
            emissive="#e8621a"
            emissiveIntensity={pump > 0 ? 0.9 : 0}
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>
        <mesh position={[1.4, 0.24, 1.0]} rotation={[0, -0.6, 0]}>
          <boxGeometry args={[3.2, 0.12, 0.12]} />
          <meshStandardMaterial {...RUBBER} />
        </mesh>
      </group>

      {/* Approach queue: machines standing off the pad waiting their turn. */}
      {Array.from({ length: Math.min(3, queue) }, (_, i) => (
        <group key={i} position={[px + 5.4 + i * 4.2, 0, pz]}>
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
 * The dock: a levelled bay, and a lorry that is either there or is not.
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

      {/* The bay: a raised dock face with a hazard nose, and the apron in front. */}
      <mesh position={[tx, 0.55, DOCK.z1 - 1.0]} castShadow receiveShadow>
        <boxGeometry args={[7.0, 1.1, 2.0]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      <HazardBand tex={tex.hazard} x={tx} z={DOCK.z1 - 1.0} w={7.0} d={2.0} y={0.92} h={0.3} />
      <FloorMark tex={tex.walkway} x={tx} z={tz - 1.6} w={7.0} d={2.2} repeat={[3, 1]} />

      {here && (
        <group position={[tx + offset, 0, tz]}>
          {/* Trailer deck and its load, then the cab in front of it. */}
          <mesh position={[0, 1.24, 0]} castShadow receiveShadow>
            <boxGeometry args={[9.0, 0.28, 2.7]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          {Array.from({ length: Math.min(cap, Math.round(load)) }, (_, i) => (
            <mesh key={i} position={[-3.6 + i * 1.4, 1.72, 0]} castShadow>
              <boxGeometry args={[1.2, 0.68, 2.0]} />
              <meshStandardMaterial {...FINISH.painted} />
            </mesh>
          ))}
          <mesh position={[5.4, 1.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.4, 2.2, 2.5]} />
            <meshStandardMaterial color="#c8ccd1" metalness={0.4} roughness={0.4} />
          </mesh>
          <mesh position={[6.55, 2.1, 0]}>
            <boxGeometry args={[0.08, 0.8, 2.0]} />
            <meshStandardMaterial {...GLASS} />
          </mesh>
          {[-3.2, -1.8, 4.9].map((wx) =>
            [-1.3, 1.3].map((wz) => (
              <mesh
                key={`${wx},${wz}`}
                position={[wx, 0.52, wz]}
                rotation={[Math.PI / 2, 0, 0]}
                castShadow
              >
                <cylinderGeometry args={[0.52, 0.52, 0.34, 16]} />
                <meshStandardMaterial {...RUBBER} />
              </mesh>
            )),
          )}
        </group>
      )}

      <Figure x={tx + 4.4} z={tz - 2.4} rotY={-0.9} vest="#f97316" />
      <StackLight
        position={[DOCK.x1 - 0.6, 0, DOCK.z1 - 1.4]}
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
            <FloorMark
              tex={tex.hazard}
              x={bx}
              z={bz}
              w={3.6}
              d={2.6}
              repeat={[7, 1]}
              opacity={0.35}
            />
            <FloorText tex={tex.yardBays[i]} x={bx} z={bz + 1.6} w={2.2} />
            {i < count && (
              <group position={[bx, 0, bz]} rotation={[0, Math.PI / 2, 0]} scale={0.9}>
                <MachineBody mat={FINISH.painted} />
              </group>
            )}
          </group>
        );
      })}
      {/* The yard is outside, so it gets a fence rather than a machine guard. */}
      <mesh position={[YARD.x0 - 0.4, 1.4, cz(YARD)]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[YARD.z1 - YARD.z0 + 2, 2.8]} />
        <meshStandardMaterial
          color="#5d6773"
          transparent
          opacity={0.35}
          side={THREE.DoubleSide}
          roughness={0.8}
        />
      </mesh>
    </group>
  );
});
