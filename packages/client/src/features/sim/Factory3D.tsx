import { useEffect, useMemo } from 'react';
import { type MachineState } from '@automationsolver/shared';
import { AssemblyBay } from './factory/AssemblyBay';
import { Building } from './factory/Building';
import { WeldBuffer, PaintedBuffers, TestQueue } from './factory/buffers';
import { PLANT_FOCUS, PLANT_TARGET, SECTION_FOCUS, SectionCamera, START_POS } from './factory/camera';
import { PaintBay } from './factory/PaintBay';
import {
  ASSY_X,
  BOOTH_X,
  numOf,
  OVEN_X,
  PA_LANE_X,
  ROW_A,
  ROW_B,
  strOf,
  TEST_X,
  WELD_X,
  YARD_COL_X,
  YARD_ROW_Z,
} from './factory/plant';
import { TestBay, Yard } from './factory/TestBay';
import { BaySign, buildTextures, disposeTextures, Lane } from './factory/textures';
import { WeldBay } from './factory/WeldBay';
import { MachineCanvas } from './MachineCanvas';

/**
 * The excavator plant: four bays, two part streams, one floor.
 *
 * Every other scene in the game shows a machine. This one has to show a *line*,
 * and the thing a player needs to read off it is not any single mechanism but
 * the flow: how much is queued where, which of the two part types the line is
 * short of, and which station is the one that stopped. So the buffers are drawn
 * as real parts on real rails rather than as counters, and the two painted lanes
 * run side by side into final assembly, where a lane that is empty while the
 * other is full is the whole failure mode in one picture.
 *
 * Layout is a U, because a straight line 40 units long frames badly and a real
 * plant does not build one either:
 *
 *   z = -6   WELD ->  weld buffer  ->  BOOTH  ->  OVEN
 *                                                   |  painted buffers, two lanes
 *   z = +7   YARD <-  TEST  <-  test queue  <-  ASSEMBLY
 *
 * This file is the plan of the floor and nothing else — where each bay stands,
 * which lane runs between them, and which sign hangs over what. The bays
 * themselves are one file each under `factory/`, and everything they share (the
 * layout constants, the materials, the excavator, the instruments) lives in
 * `factory/plant.ts` and its neighbours.
 *
 * Perf follows `Warehouse3D`'s discipline: the sim re-renders this twenty times
 * a second, so everything that does not move sits behind a `memo` with scalar
 * props, and only the parts whose state actually changed are reconciled.
 */

/**
 * The bare plant, with no canvas around it — so the composed view and any future
 * standalone bay view can both mount the same geometry.
 */
export function FactoryRig({
  machine,
  outputs,
  section,
}: {
  machine: MachineState;
  /** The live coil image, for the things a state snapshot cannot tell apart
      (a torch that is *striking* rather than a seam that merely stopped). */
  outputs: Record<string, boolean>;
  section?: string;
}) {
  const tex = useMemo(() => buildTextures(), []);
  useEffect(() => () => disposeTextures(tex), [tex]);

  const focus = (section && SECTION_FOCUS[section]) || PLANT_FOCUS;

  return (
    <group>
      <SectionCamera focus={focus} />
      {/* A plant floor is lit from a hundred fittings, not from one sun. Without
          this lift the shop reads as a night scene and the dark parts on the
          buffer rails disappear into the slab. */}
      <ambientLight intensity={0.5} />
      <Building tex={tex} />

      {/* Flow lanes: +x along row A, across at the buffers, -x along row B. */}
      <Lane tex={tex.lane} x={-4.0} z={ROW_A + 2.4} length={13.0} />
      <Lane
        tex={tex.lane}
        x={(PA_LANE_X.f + PA_LANE_X.b) / 2}
        z={-1.4}
        length={10.5}
        width={4.4}
        rotY={Math.PI / 2}
      />
      <Lane tex={tex.lane} x={2.0} z={ROW_B} length={16.0} rotY={Math.PI} />

      {/* Every sign faces +z and stands *behind* its bay. Row B's used to be
          rotated to face the other way, which put them between the camera and
          the machine and rendered every one of them mirrored. */}
      <BaySign tex={tex.signs.WELD} x={WELD_X} z={ROW_A - 2.6} y={4.4} />
      <BaySign tex={tex.signs.PAINT} x={(BOOTH_X + OVEN_X) / 2} z={ROW_A - 2.8} y={4.6} />
      <BaySign tex={tex.signs.ASSEMBLY} x={ASSY_X} z={ROW_B - 3.6} y={4.4} />
      <BaySign tex={tex.signs.TEST} x={TEST_X} z={ROW_B - 3.4} y={4.0} />
      {/* The yard sign sits close in against its own bays: any further back and
          it stands directly in the weld bay's camera preset. */}
      <BaySign tex={tex.signs.YARD} x={YARD_COL_X[1]} z={YARD_ROW_Z[0] - 1.0} y={4.0} />

      <WeldBay machine={machine} torchOn={outputs.Y3 === true} />
      <WeldBuffer queue={strOf(machine.bufWp)} />
      <PaintBay machine={machine} spraying={outputs.Y8 === true} />
      <PaintedBuffers frames={numOf(machine.bufPaFrames)} booms={numOf(machine.bufPaBooms)} />
      <AssemblyBay machine={machine} />
      <TestQueue count={numOf(machine.bufAt)} />
      <TestBay machine={machine} />
      <Yard count={numOf(machine.yard)} />
    </group>
  );
}

export function Factory3D({
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
      maxDistance={80}
      polarRange={[0.25, 1.35]}
      panBounds={{ x: [-16, 15], y: [-1, 8], z: [-10, 12] }}
      // The floor is 32 x 23; the single-machine default of 16 would drop half
      // the plant out of the shadow map and stop its shadows at a line.
      shadowExtent={22}
      interactive
    >
      <FactoryRig machine={machine} outputs={outputs} section={section} />
    </MachineCanvas>
  );
}
