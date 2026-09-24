import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, DRACO_DECODER_PATH } from './MachineCanvas';
import { SectionCamera } from './factory/camera';
import { PLANT_FOCUS, sectionFocus } from './distribution/layout';
import { buildHubPlant } from './distribution/plant';

/**
 * The Cold Chain Hub: a floor of two-way aisles, the automated forklifts that
 * drive them and everything they serve, from the goods-in doors to the trucks.
 *
 * One view for every puzzle in the category. Each one builds only some of the
 * hub (`plantConfig.locs`), so the scene builds the same subset and stands every
 * station where the plant has it: the floor plan lives in the plant, and the
 * scene reads it (`distribution/layout.ts`). The kit is a Blender file of
 * separate assets, cloned here per station, per vehicle and per pallet
 * (`distribution/plant.ts`).
 *
 * In the single-program puzzles it is a panel over the whole floor; in the plant
 * workspace it fills the page and flies to the section being edited.
 */

// Base-relative, so the deployed build finds it under whatever path it is served from.
const MODEL_URL = `${import.meta.env.BASE_URL}models/dc-kit.glb`;

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);

function HubScene({ machine, section }: { machine: MachineState; section?: string }) {
  const { scene: kit } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);
  // What the puzzle built and how many vehicles it runs never change within a
  // run, so the static plant is built once per puzzle, not per scan.
  const locs = strOf(machine.locs);
  const fleet = numOf(machine.fleet, 1);
  const plant = useMemo(() => buildHubPlant(kit, locs, fleet), [kit, locs, fleet]);
  useEffect(() => () => plant.dispose(), [plant]);

  const focus = useMemo(
    () => (section ? sectionFocus(section, plant.stations) : undefined) ?? PLANT_FOCUS,
    [section, plant],
  );

  // The glTF clones are external-system state: posing them imperatively every
  // frame is the standard r3f pattern, and keeps the React tree out of the loop.
  useFrame((_state, dt) => plant.pose(machine, dt));

  return (
    <group>
      <SectionCamera focus={focus} />
      <primitive object={plant.group} />
    </group>
  );
}

export function Distribution3D({
  machine,
  section,
  height = 300,
}: {
  machine: MachineState;
  section?: string;
  height?: number | string;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[12, 30, 28]}
      fov={34}
      target={PLANT_FOCUS.center}
      minDistance={4}
      maxDistance={110}
      polarRange={[0.2, 1.3]}
      panBounds={{ x: [-18, 30], y: [-1, 6], z: [-7, 19] }}
      // The floor and the truck yard together are about 50 x 26 m.
      shadowExtent={30}
      mood="coldStore"
      background="#232b33"
      // Meters: about a pallet's gap to the floor and a rack beam's depth.
      ao={{ radius: 1.2 }}
      interactive
    >
      <HubScene machine={machine} section={section} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
