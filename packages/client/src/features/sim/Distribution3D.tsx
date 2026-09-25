import { useCallback, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, DRACO_DECODER_PATH } from './MachineCanvas';
import { focusPose, SectionCamera } from './factory/camera';
import { PLANT_FOCUS, sectionFocus } from './distribution/layout';
import { buildHubPlant } from './distribution/plant';
import { HUB_INTRO } from './distribution/intro';
import { shiftAt } from './intro/cinema';
import { IntroDirector, type IntroGoal } from './intro/IntroDirector';
import { IntroOverlay } from './intro/IntroOverlay';
import { useIntro, type IntroRun } from './intro/useIntro';

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
 *
 * The first time a player opens it, a fly-in shows the whole hub running on a
 * solved capstone before settling on their puzzle (`distribution/intro.ts`).
 *
 * It renders on demand: the scene only changes when the machine does, the camera
 * moves or a flight is under way, so an idle view costs nothing while the player
 * edits their program.
 */

// Base-relative, so the deployed build finds it under whatever path it is served from.
const MODEL_URL = `${import.meta.env.BASE_URL}models/dc-kit.glb`;

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);

// --- the scene ------------------------------------------------------------------------------

function HubScene({ machine, section, intro }: { machine: MachineState; section?: string; intro?: IntroRun }) {
  const { scene: kit } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);
  const invalidate = useThree((s) => s.invalidate);
  // What the puzzle built and how many vehicles it runs never change within a
  // run, so the static plant is built once per puzzle, not per scan. The fly-in
  // builds what its recording ran instead: the whole hub.
  const showcase = intro?.frames[0];
  const locs = strOf((showcase ?? machine).locs);
  const fleet = numOf((showcase ?? machine).fleet, 1);
  const plant = useMemo(() => buildHubPlant(kit, locs, fleet), [kit, locs, fleet]);
  useEffect(() => () => plant.dispose(), [plant]);

  const focus = useMemo(
    () => (section ? sectionFocus(section, plant.stations) : undefined) ?? PLANT_FOCUS,
    [section, plant],
  );

  // Rendering on demand: a new scan, or a new plant, is a new picture.
  useEffect(() => invalidate(), [machine, plant, invalidate]);

  const goal = useCallback<IntroGoal>((camera, w, h) => focusPose(camera, focus, w, h), [focus]);
  const frames = intro?.frames;
  const dtMs = intro?.dt ?? 50;
  const onTick = useCallback(
    (t: number, dt: number) => {
      if (!frames) return;
      const { m, next, f } = shiftAt(frames, dtMs, t, HUB_INTRO.speed);
      plant.pose(m, dt, { next, f });
    },
    [frames, dtMs, plant],
  );

  // The glTF clones are external-system state: posing them imperatively every
  // frame is the standard r3f pattern, and keeps the React tree out of the loop.
  useFrame((_state, dt) => {
    if (!intro) plant.pose(machine, dt);
  });

  return (
    <group>
      <SectionCamera focus={focus} hold={!!intro} />
      {intro && (
        <IntroDirector
          key={intro.run}
          shots={HUB_INTRO.shots}
          duration={HUB_INTRO.duration}
          goal={goal}
          onTick={onTick}
          onStart={intro.onStart}
          onCaption={intro.onCaption}
          onFadeOut={intro.onFadeOut}
        />
      )}
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
  const { phase, caption, intro, onSkip, onReplay } = useIntro(HUB_INTRO);

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
      frameloop="demand"
      interactive
      overlay={<IntroOverlay script={HUB_INTRO} phase={phase} caption={caption} onSkip={onSkip} onReplay={onReplay} />}
    >
      <HubScene machine={machine} section={section} intro={intro} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
