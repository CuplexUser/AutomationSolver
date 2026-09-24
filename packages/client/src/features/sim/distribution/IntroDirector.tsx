import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { focusPose, type Focus } from '../factory/camera';
import type { HubPlant } from './plant';
import { captionAt, INTRO_S, pathParam, SHOTS, shiftAt } from './intro';

/** How long before the end the picture starts fading to black for the handover. */
export const FADE_OUT_S = 0.7;

/**
 * Flies the camera through the fly-in and plays the recorded shift under it.
 *
 * It owns the camera while it runs: the orbit controls are switched off and
 * `SectionCamera` is held, and the last point of the path is the pose
 * `SectionCamera` would fly to itself, so letting go is seamless. Position and
 * target each run along a centripetal Catmull-Rom curve through the shots, which
 * passes through every shot exactly and turns through them without a corner.
 *
 * It reports only on change (its first frame, a new caption, the fade), so React
 * re-renders a handful of times per intro, not sixty times a second. The fade's
 * end is the parent's to time; this keeps flying under the black until then.
 */
export function IntroDirector({
  plant,
  frames,
  dtMs,
  end,
  onStart,
  onCaption,
  onFadeOut,
}: {
  plant: HubPlant;
  frames: readonly MachineState[];
  dtMs: number;
  /** The view the intro hands over to. */
  end: Focus;
  onStart: () => void;
  onCaption: (shot: number) => void;
  onFadeOut: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean; target: THREE.Vector3; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  // Read once, at the start: a path rebuilt mid-flight on a resize would jump.
  const path = useMemo(() => {
    const goal = focusPose(camera, end, width, height);
    const pos = [...SHOTS.map((s) => new THREE.Vector3(...s.pos)), goal.position];
    const tgt = [...SHOTS.map((s) => new THREE.Vector3(...s.target)), goal.target];
    return {
      pos: new THREE.CatmullRomCurve3(pos, false, 'centripetal'),
      tgt: new THREE.CatmullRomCurve3(tgt, false, 'centripetal'),
      times: [...SHOTS.map((s) => s.at), INTRO_S],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately frozen for the run
  }, []);

  const run = useRef({ t: 0, caption: -2, fading: false, done: false });
  const look = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => onStart(), [onStart]);

  // The orbit controls are three.js state, not React's: handing the camera over is the r3f pattern.
  useEffect(() => {
    /* eslint-disable react-hooks/immutability -- switching an external controls object off and back on */
    if (controls) controls.enabled = false;
    invalidate();
    return () => {
      if (controls) controls.enabled = true;
      /* eslint-enable react-hooks/immutability */
    };
  }, [controls, invalidate]);

  useFrame((_state, dt) => {
    const r = run.current;
    if (r.done) return;
    // Clamped, so a stalled frame (a tab switch) slows the flight instead of skipping a shot.
    r.t += Math.min(dt, 0.05);
    const t = Math.min(r.t, INTRO_S);

    const u = pathParam(t, path.times);
    path.pos.getPoint(u, camera.position);
    path.tgt.getPoint(u, look);
    if (controls) controls.target.copy(look);
    camera.lookAt(look);

    const { m, next, f } = shiftAt(frames, dtMs, t);
    plant.pose(m, dt, { next, f });

    const cap = captionAt(t);
    if (cap !== r.caption) {
      r.caption = cap;
      onCaption(cap);
    }
    if (!r.fading && t >= INTRO_S - FADE_OUT_S) {
      r.fading = true;
      onFadeOut();
    }
    if (r.t >= INTRO_S) {
      r.done = true;
      return;
    }
    invalidate();
  });

  return null;
}
