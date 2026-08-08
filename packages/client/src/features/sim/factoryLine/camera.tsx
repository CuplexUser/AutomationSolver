import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ANCHOR, PORTAL } from './plant';

/**
 * Where the camera stands for each part of the line.
 *
 * The old plant's four presets all sat at about 26 degrees facing roughly +z, so
 * cutting between them read as a slideshow of the same photograph. Three rules
 * fix that, and they are the difference between a reference photo of a shop
 * floor and a product render of a machine:
 *
 * 1. **Eye height 1.4 to 3.4 m** for everything but the overview. A camera at
 *    human height makes a 4 m machine feel like a 4 m machine; a camera at 20 m
 *    makes it a diagram.
 * 2. **Something in the near field** — fence mesh, a conveyor rail, the drum
 *    bank. With no atmospherics, depth comes from occlusion, and a shot framed
 *    on nothing but its own machine has none.
 * 3. **No two neighbouring presets share a facing**, so flying between sections
 *    feels like walking through a building rather than cutting between stills.
 */

export interface Focus {
  center: [number, number, number];
  halfWidth: number;
  halfHeight: number;
  /** Unit-ish direction from the target toward the camera. */
  dir: [number, number, number];
  /**
   * Clamp, so a wide panel cannot quietly turn a designed close-up back into
   * the overview shot we already have.
   */
  maxDistance?: number;
  /** Floor under the eye, so a low preset never sinks into the slab. */
  minEyeY?: number;
  /** What the shot is about, for the caption strip. */
  label?: string;
}

/**
 * Build a direction from a compass bearing and an elevation.
 *
 * Azimuth is degrees clockwise from +z, which is the direction the overview
 * looks from, so the numbers in the design read as bearings rather than as
 * vector components nobody can picture.
 */
function dirFrom(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(el);
  return [Math.sin(az) * c, Math.sin(el), Math.cos(az) * c];
}

export const PLANT_TARGET: [number, number, number] = [0, 3, -2];
export const START_POS: [number, number, number] = [-22, 26, 34];

export const PLANT_FOCUS: Focus = {
  center: PLANT_TARGET,
  halfWidth: 30,
  halfHeight: 20,
  dir: dirFrom(210, 34),
  label: 'The whole line',
};

/**
 * Keyed by POU id, so a section's window frames its own bay.
 *
 * `CONV` has no bay of its own — it is the whole spine — so it is framed at the
 * sort, looking back down the run. That is the one spot where a queue backing up
 * is visible as a queue rather than as a part that has not arrived.
 */
export const SECTION_FOCUS: Record<string, Focus> = {
  WELD: {
    center: [ANCHOR.weldFixture[0], 1.6, ANCHOR.weldFixture[2]],
    halfWidth: 7.6,
    halfHeight: 4.6,
    dir: dirFrom(145, 14),
    maxDistance: 26,
    minEyeY: 1.4,
    label: 'Weld bay',
  },
  CONV: {
    center: [24, 1.2, 3],
    halfWidth: 9.5,
    halfHeight: 5.4,
    dir: dirFrom(250, 20),
    maxDistance: 32,
    minEyeY: 1.4,
    label: 'The spine, from the sort',
  },
  STORE: {
    center: [-6, 2.4, -14],
    halfWidth: 8.4,
    halfHeight: 5.2,
    dir: dirFrom(100, 18),
    maxDistance: 28,
    minEyeY: 1.6,
    label: 'Rack store',
  },
  PORTAL: {
    center: [(PORTAL.x0 + PORTAL.x1) / 2, 3.4, PORTAL.z],
    halfWidth: 7.2,
    halfHeight: 4.4,
    dir: dirFrom(190, 8),
    maxDistance: 24,
    minEyeY: 1.5,
    label: 'Portal robot',
  },
  PAINT: {
    center: [7.5, 1.8, -8],
    halfWidth: 8.0,
    halfHeight: 4.8,
    dir: dirFrom(300, 16),
    maxDistance: 26,
    minEyeY: 1.4,
    label: 'Spray booth',
  },
  ASSY: {
    center: [ANCHOR.jig[0] + 2, 1.6, ANCHOR.jig[2] + 1],
    halfWidth: 8.6,
    halfHeight: 5.0,
    dir: dirFrom(20, 12),
    maxDistance: 28,
    minEyeY: 1.4,
    label: 'Final assembly',
  },
  TEST: {
    center: [-11, 1.5, 10],
    halfWidth: 9.2,
    halfHeight: 5.2,
    dir: dirFrom(340, 22),
    maxDistance: 30,
    minEyeY: 1.5,
    label: 'Test and dock',
  },
};

/** The supervisor owns no bay, so it gets the whole plant. */
SECTION_FOCUS.SUP = PLANT_FOCUS;

const FLY_MS = 800;

/**
 * Flies the camera to the focused bay.
 *
 * Distance is derived from the live viewport rather than baked into a position,
 * for the same reason `MachineCanvas`'s `FitCamera` does it: a fixed camera
 * frames whatever aspect ratio it was tuned at, and this panel is resizable by
 * design. `maxDistance` is then what keeps a designed close-up close on a wide
 * one, and `minEyeY` is what stops a low preset burying the lens in the slab.
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
    let dist = Math.max(focus.halfWidth / hTan, focus.halfHeight / vTan);
    if (focus.maxDistance != null) dist = Math.min(dist, focus.maxDistance);
    const target = new THREE.Vector3(...focus.center);
    const dir = new THREE.Vector3(...focus.dir).normalize();
    const position = target.clone().addScaledVector(dir, dist);
    if (focus.minEyeY != null) position.y = Math.max(position.y, focus.minEyeY);
    return { target, position };
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
