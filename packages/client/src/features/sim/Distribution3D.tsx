import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas, DRACO_DECODER_PATH } from './MachineCanvas';
import { SectionCamera } from './factory/camera';
import { PLANT_FOCUS, sectionFocus } from './distribution/layout';
import { buildHubPlant } from './distribution/plant';
import { decodeShift, type RecordedShift } from './distribution/intro';
import { FADE_OUT_S, IntroDirector } from './distribution/IntroDirector';
import { IntroOverlay, type IntroPhase } from './distribution/IntroOverlay';

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
const SHIFT_URL = `${import.meta.env.BASE_URL}intro/dc-hub-shift.json`;

const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);

// --- the fly-in's recording and whether this viewer has seen it ---------------------------

interface Shift {
  frames: MachineState[];
  dt: number;
}

let shiftLoad: Promise<Shift> | undefined;
function loadShift(): Promise<Shift> {
  shiftLoad ??= fetch(SHIFT_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`intro recording: ${r.status}`);
      return r.json() as Promise<RecordedShift>;
    })
    .then((rec) => ({ frames: decodeShift(rec), dt: rec.dt }));
  // A failed load may be retried by the replay button.
  shiftLoad.catch(() => (shiftLoad = undefined));
  return shiftLoad;
}

// Per viewer and per browser, which is all "the first time" needs to mean here.
const SEEN_KEY = 'coldChain.introSeen';
function seenIntro(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
/** A player who asked their system for less motion gets the fly-in only by pressing replay. */
function autoplayIntro(): boolean {
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return !calm && !seenIntro();
}
function markIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage blocked: the intro plays again next time, which is harmless.
  }
}

// --- the scene ------------------------------------------------------------------------------

interface IntroRun {
  frames: MachineState[];
  dt: number;
  run: number;
  onStart: () => void;
  onCaption: (shot: number) => void;
  onFadeOut: () => void;
}

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
          plant={plant}
          frames={intro.frames}
          dtMs={intro.dt}
          end={focus}
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
  const [phase, setPhase] = useState<IntroPhase>(() => (autoplayIntro() ? 'loading' : 'off'));
  const [caption, setCaption] = useState(-1);
  const [shift, setShift] = useState<Shift | null>(null);
  const [run, setRun] = useState(0);

  // Fetch the recording when an intro is asked for; give up quietly if it cannot be had.
  useEffect(() => {
    if (phase !== 'loading' || shift) return;
    let live = true;
    loadShift().then(
      (s) => live && setShift(s),
      () => live && setPhase('off'),
    );
    return () => {
      live = false;
    };
  }, [phase, shift]);

  // The fade to black, then the puzzle's own floor fading up, then nothing.
  useEffect(() => {
    if (phase !== 'out' && phase !== 'reveal') return;
    const next = phase === 'out' ? 'reveal' : 'off';
    const id = setTimeout(() => setPhase(next), (phase === 'out' ? FADE_OUT_S : 0.9) * 1000);
    return () => clearTimeout(id);
  }, [phase]);

  const onStart = useCallback(() => {
    markIntroSeen();
    setPhase('playing');
  }, []);
  const onFadeOut = useCallback(() => setPhase((p) => (p === 'playing' ? 'out' : p)), []);
  const onSkip = useCallback(() => setPhase((p) => (p === 'playing' || p === 'loading' ? 'out' : p)), []);
  const onReplay = useCallback(() => {
    setCaption(-1);
    setRun((r) => r + 1);
    setPhase('loading');
  }, []);

  // The showcase hub is on screen from the first frame to the bottom of the fade.
  const intro: IntroRun | undefined =
    shift && (phase === 'loading' || phase === 'playing' || phase === 'out')
      ? { frames: shift.frames, dt: shift.dt, run, onStart, onCaption: setCaption, onFadeOut }
      : undefined;

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
      overlay={<IntroOverlay phase={phase} caption={caption} onSkip={onSkip} onReplay={onReplay} />}
    >
      <HubScene machine={machine} section={section} intro={intro} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
