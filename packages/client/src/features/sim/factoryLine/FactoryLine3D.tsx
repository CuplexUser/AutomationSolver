import { useEffect, useMemo } from 'react';
import { LINE_LIMITS, type MachineState } from '@automationsolver/shared';
import { MachineCanvas } from '../MachineCanvas';
import {
  PLANT_FOCUS,
  PLANT_TARGET,
  SECTION_FOCUS,
  SectionCamera,
  START_POS,
} from './camera';
import {
  ANCHOR,
  CONV,
  MACHINE,
  PAINT_LANE_Z,
  SPINE,
  SPINE_TURNS,
  numOf,
  orderPaint,
  strOf,
} from './plant';
import { Conveyor, Part, PhotoEye } from './props';
import { AssemblyCell, DockCell, TestCell, YardCell } from './rowB';
import { BoothCell, OvenCell, PortalCell, StoreCell, WeldCell } from './rowA';
import { Shell } from './Shell';
import { buildLineTextures, disposeLineTextures } from './textures';

/**
 * The excavator line: eight cells, one spine, one floor.
 *
 * The tutorial plant (`Factory3D`) shows four bays with counters between them.
 * This one has to show a *line*, and the thing a player reads off it is the
 * flow: where the queue is, which of the two streams is short, and which station
 * is the one that stopped. So every buffer on this floor is drawn as real parts
 * in a real place — parts standing in the rack, parts accumulating against a
 * zone boundary, machines parked in numbered yard bays — and the numbers in the
 * header are the summary rather than the picture.
 *
 * This file is the plan of the floor and nothing else: which cell stands where,
 * what runs between them, and which camera each section gets. The cells are
 * `rowA.tsx` and `rowB.tsx`, the building is `Shell.tsx`, and everything they
 * share is `plant.ts` and its neighbours.
 *
 * Perf follows `Warehouse3D`'s discipline: the sim re-renders this twenty times
 * a second, so everything static sits behind a `memo` with scalar props and only
 * the cells whose state actually changed are reconciled.
 */

/** The bare plant, with no canvas around it. */
export function FactoryLineRig({
  machine,
  outputs,
  section,
}: {
  machine: MachineState;
  /** The live coil image, for what a state snapshot cannot tell apart — a torch
      that is *striking* rather than a seam that merely stopped. */
  outputs: Record<string, boolean>;
  section?: string;
}) {
  const tex = useMemo(() => buildLineTextures(), []);
  useEffect(() => () => disposeLineTextures(tex), [tex]);

  const focus = (section && SECTION_FOCUS[section]) || PLANT_FOCUS;
  const laneF = strOf(machine.laneF);
  const laneB = strOf(machine.laneB);

  return (
    <group>
      <SectionCamera focus={focus} />
      {/* A plant floor is lit from a hundred fittings, not from one sun. Without
          the lift the shop reads as a night scene and the bare parts on the rack
          disappear into the slab. */}
      <ambientLight intensity={0.55} />
      <Shell tex={tex} />

      {/* The spine. Zone boundaries are drawn on it, and the parts queueing
          against them are drawn by the stations that own them. */}
      {SPINE.map((run) => (
        <Conveyor key={run.id} tex={tex} run={run} />
      ))}
      {SPINE_TURNS.map((t) => (
        <mesh key={`${t.at[0]},${t.at[1]}`} position={[t.at[0], CONV.deckY, t.at[1]]} receiveShadow>
          <boxGeometry args={[CONV.width, 0.05, CONV.width]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
      ))}
      <SpinePhotoEyes />

      {/* Row A: make and finish. */}
      <WeldCell tex={tex} machine={machine} torch={outputs.Y3 === true} />
      <StoreCell tex={tex} machine={machine} />
      <PortalCell machine={machine} />
      <BoothCell
        tex={tex}
        machine={machine}
        spraying={outputs.Y14 === true}
        purging={outputs.Y16 === true}
      />
      <OvenCell tex={tex} machine={machine} racks={LINE_LIMITS.OVEN_RACKS} />

      {/* The two painted lanes, running west into the jig. A lane that is empty
          while the other is full is the whole failure mode in one picture. */}
      <PaintedLane parts={laneF} kind="f" z={PAINT_LANE_Z.frame} />
      <PaintedLane parts={laneB} kind="b" z={PAINT_LANE_Z.boom} />

      {/* Row B: build, prove and ship. */}
      <AssemblyCell tex={tex} machine={machine} />
      <TestCell tex={tex} machine={machine} queue={numOf(machine.bufAt)} />
      <DockCell tex={tex} machine={machine} cap={LINE_LIMITS.TRUCK_CAP} />
      <YardCell tex={tex} count={numOf(machine.yard)} cap={LINE_LIMITS.YARD_CAP} />
    </group>
  );
}

/**
 * One painted part per character in the lane string, queued back from the jig.
 *
 * The characters are color digits and the front of the string is the front of
 * the lane, so the part nearest final assembly is the one that goes on next —
 * which is exactly the fact the color puzzle turns on.
 */
function PaintedLane({ parts, kind, z }: { parts: string; kind: 'f' | 'b'; z: number }) {
  const head = ANCHOR.jig[0] + 0.6;
  return (
    <group>
      {[...parts].map((c, i) => (
        <Part
          key={i}
          x={head + i * 2.9}
          z={z}
          kind={kind}
          finish={orderPaint(Number(c))}
          scale={0.7}
        />
      ))}
    </group>
  );
}

/**
 * A photo-eye at every zone boundary on the spine.
 *
 * Static, and deliberately so for now: the eyes are what the accumulation logic
 * *will* read once the conveyor is a program section rather than a transfer the
 * plant does for free, and standing them up front means the floor a player
 * learns is the floor they later have to drive.
 */
function SpinePhotoEyes() {
  const eyes: Array<[number, number]> = [];
  for (const run of SPINE) {
    for (let i = 1; i <= run.zones; i += 1) {
      const t = i / (run.zones + 1);
      eyes.push([
        run.from[0] + t * (run.to[0] - run.from[0]),
        run.from[1] + t * (run.to[1] - run.from[1]),
      ]);
    }
  }
  return (
    <group>
      {eyes.map(([x, z]) => (
        <PhotoEye key={`${x},${z}`} x={x + CONV.width / 2 + 0.12} z={z} />
      ))}
    </group>
  );
}

export function FactoryLine3D({
  machine,
  outputs,
  section,
  height = 300,
}: {
  machine: MachineState;
  outputs: Record<string, boolean>;
  section?: string;
  height?: number | string;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={START_POS}
      fov={34}
      target={PLANT_TARGET}
      minDistance={4}
      maxDistance={110}
      polarRange={[0.18, 1.42]}
      panBounds={{ x: [-28, 27], y: [-1, 10], z: [-19, 19] }}
      // The floor is 55 x 38. At the tutorial plant's 22 the shadow map would
      // cover barely a third of it and every shadow would stop at a line.
      shadowExtent={38}
      interactive
    >
      <FactoryLineRig machine={machine} outputs={outputs} section={section} />
    </MachineCanvas>
  );
}
