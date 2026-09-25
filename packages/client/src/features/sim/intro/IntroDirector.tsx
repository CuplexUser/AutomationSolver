import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { captionAt, pathParam, type Shot } from './cinema';

/** How long before the end the picture starts fading to black for the handover. */
export const FADE_OUT_S = 0.7;

/** Where the fly-in hands over: the pose the view's own section camera would fly to. */
export type IntroGoal = (
  camera: THREE.Camera,
  width: number,
  height: number,
) => { position: THREE.Vector3; target: THREE.Vector3 };

/**
 * Flies the camera through the fly-in and tells the scene the time under it.
 *
 * It owns the camera while it runs: the orbit controls are switched off and the
 * view's section camera is held, and the last point of the path is the pose that
 * camera would fly to itself (`goal`), so letting go is seamless. Position and
 * target each run along a centripetal Catmull-Rom curve through the shots, which
 * passes through every shot exactly and turns through them without a corner.
 *
 * The recorded run is the scene's to draw: `onTick` is handed the time into the
 * intro every frame, and the scene picks its scan (`shiftAt`). It reports only on
 * change (its first frame, a new caption, the fade), so React re-renders a
 * handful of times per intro, not sixty times a second. The fade's end is the
 * parent's to time; this keeps flying under the black until then.
 */
export function IntroDirector({
  shots,
  duration,
  goal,
  onTick,
  onStart,
  onCaption,
  onFadeOut,
}: {
  shots: readonly Shot[];
  duration: number;
  goal: IntroGoal;
  onTick: (t: number, dt: number) => void;
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
    const end = goal(camera, width, height);
    const pos = [...shots.map((s) => new THREE.Vector3(...s.pos)), end.position];
    const tgt = [...shots.map((s) => new THREE.Vector3(...s.target)), end.target];
    return {
      pos: new THREE.CatmullRomCurve3(pos, false, 'centripetal'),
      tgt: new THREE.CatmullRomCurve3(tgt, false, 'centripetal'),
      times: [...shots.map((s) => s.at), duration],
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
    const t = Math.min(r.t, duration);

    const u = pathParam(t, path.times);
    path.pos.getPoint(u, camera.position);
    path.tgt.getPoint(u, look);
    if (controls) controls.target.copy(look);
    camera.lookAt(look);

    onTick(t, dt);

    const cap = captionAt(t, shots);
    if (cap !== r.caption) {
      r.caption = cap;
      onCaption(cap);
    }
    if (!r.fading && t >= duration - FADE_OUT_S) {
      r.fading = true;
      onFadeOut();
    }
    if (r.t >= duration) {
      r.done = true;
      return;
    }
    invalidate();
  });

  return null;
}
