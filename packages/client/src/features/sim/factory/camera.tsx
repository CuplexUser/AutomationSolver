import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_SECTIONS } from '@automationsolver/shared';
import { ASSY_X, BOOTH_X, OVEN_X, ROW_A, ROW_B, TEST_X, WELD_X } from './plant';

export interface Focus {
  center: [number, number, number];
  halfWidth: number;
  halfHeight: number;
  /** Unit-ish direction from the target toward the camera. */
  dir: [number, number, number];
}

/** Direction only — `SectionCamera` derives the distance from the viewport. */
export const PLANT_TARGET: [number, number, number] = [-0.6, 1.0, 0.5];
export const START_POS: [number, number, number] = [1.2, 22, 26];

export const PLANT_FOCUS: Focus = {
  center: PLANT_TARGET,
  halfWidth: 17,
  halfHeight: 11.5,
  dir: [0.05, 0.74, 0.67],
};

/**
 * Where the camera sits for each section.
 *
 * Row A is at the back of the floor and row B at the front, so a bay's preset
 * puts the camera *between* the rows rather than behind them — otherwise
 * focusing the weld bay frames the back of the test bay.
 */
export const SECTION_FOCUS: Record<string, Focus> = {
  [FACTORY_SECTIONS.weld]: {
    // Wide enough to hold the fixture, the gantry and the buffer rail it feeds:
    // a bay framed to its own footprint crops its gantry and tells you nothing
    // about what it is connected to.
    center: [WELD_X + 1.4, 1.6, ROW_A + 0.4],
    halfWidth: 7.4,
    halfHeight: 4.6,
    dir: [-0.2, 0.46, 0.86],
  },
  [FACTORY_SECTIONS.paint]: {
    center: [(BOOTH_X + OVEN_X) / 2, 1.9, ROW_A],
    halfWidth: 8.2,
    halfHeight: 5.0,
    dir: [0.04, 0.44, 0.9],
  },
  [FACTORY_SECTIONS.assembly]: {
    center: [ASSY_X - 0.6, 1.8, ROW_B - 0.4],
    halfWidth: 7.6,
    halfHeight: 4.8,
    dir: [0.3, 0.44, 0.85],
  },
  [FACTORY_SECTIONS.test]: {
    center: [TEST_X - 1.6, 1.4, ROW_B],
    halfWidth: 8.6,
    halfHeight: 4.6,
    dir: [-0.18, 0.42, 0.89],
  },
};

const FLY_MS = 750;

/**
 * Flies the camera to the focused bay.
 *
 * Distance is derived from the live viewport rather than baked into a position,
 * for the same reason `MachineCanvas`'s `FitCamera` does it: a fixed camera
 * frames whatever aspect ratio it was tuned at, and this panel is resizable by
 * design. `MachineCanvas` is given no `fitExtent` here so that this is the only
 * thing touching the camera — two authorities would fight on every resize.
 */
export function SectionCamera({ focus }: { focus: Focus }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  const anim = useRef({
    t: 1,
    fromPos: new THREE.Vector3(),
    fromTgt: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toTgt: new THREE.Vector3(),
  });

  const goal = useMemo(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const vTan = Math.tan((cam.fov * Math.PI) / 360);
    const hTan = vTan * (width / height || 1.6);
    const dist = Math.max(focus.halfWidth / hTan, focus.halfHeight / vTan);
    const target = new THREE.Vector3(...focus.center);
    const dir = new THREE.Vector3(...focus.dir).normalize();
    return { target, position: target.clone().addScaledVector(dir, dist) };
  }, [camera, focus, width, height]);

  // Retargeting from wherever the camera currently is, rather than from a fixed
  // start, is what lets this re-run harmlessly: `controls` resolves a frame
  // after mount, and the repeat is then a fly from here to the same place.
  useEffect(() => {
    const a = anim.current;
    a.fromPos.copy(camera.position);
    a.fromTgt.copy(controls?.target ?? new THREE.Vector3(...PLANT_TARGET));
    a.toPos.copy(goal.position);
    a.toTgt.copy(goal.target);
    a.t = 0;
  }, [goal, camera, controls]);

  useFrame((_state, dt) => {
    const a = anim.current;
    if (a.t >= 1) return;
    a.t = Math.min(1, a.t + (dt * 1000) / FLY_MS);
    // Smoothstep, so the move eases out of the old frame and into the new one
    // instead of jerking to a halt on arrival.
    const e = a.t * a.t * (3 - 2 * a.t);
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    if (controls) {
      controls.target.lerpVectors(a.fromTgt, a.toTgt, e);
    } else {
      camera.lookAt(a.toTgt);
    }
  });

  return null;
}
