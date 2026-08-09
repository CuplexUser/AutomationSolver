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
 *
 * ## Rule 1 was stated and not enforced, and every preset broke it
 *
 * The eye is not authored, it is *derived*: `dist` comes from the live viewport
 * and the eye is then `center + dist * dir`, so the elevation in a preset is a
 * bearing rather than a height. With `halfWidth` at 7.6 to 9.5 m the standoff
 * came out at 15 to 26 m, and 15 m at 16 degrees is 4.5 m of lift — so all seven
 * station presets stood between 5.0 and 10.9 m up, and four of them stood
 * outside the building looking in through a backface-culled wall.
 *
 * That put every eye level with or above the overhead services, which is what
 * the reported bug was: the aisle service run is at 5.82 to 6.27 m, and the old
 * `PAINT` preset put the lens 0.1 to 0.5 m from it, looking along its length.
 * More than half the frame was pipe.
 *
 * Three things fix it, and the first is the one that matters:
 *
 * - **`maxEyeY` exists.** There has always been a floor (`minEyeY`, so a low
 *   preset cannot sink into the slab) and never a ceiling, so the rule the
 *   docblock states was a comment rather than a constraint. Clamping the eye
 *   down leaves the xz standoff alone, so the framing width is untouched and
 *   only the elevation flattens — exactly what `minEyeY` already does at the
 *   other end.
 * - **The shots came in.** `halfWidth` is 6.5 to 7.0 and every preset carries a
 *   real `maxDistance`, because the building is 38 m deep with a 9 m aisle down
 *   the middle: a 15 m standoff has nowhere to stand that is not inside a cell.
 * - **The bearings moved off the walls.** Every eye is now on open floor, at
 *   least 2.6 m from a service drop, and no sight-line rises above 3.4 m — which
 *   is below the booth roof at 4.6, the portal beam at 4.79 and the services at
 *   5.82, so nothing overhead can cross a shot at any viewport aspect.
 *
 * The numbers below were solved against the plant's own footprints rather than
 * eyeballed, and checked at aspect ratios from 1.1 to 2.6. The booth is the
 * fussy one: it is a closed box whose only opening is the south glazing
 * (x 3.5 to 11.5, y 1.2 to 4.2), so its bearing is constrained by having to
 * reach the skid *through* that hole and not through a solid corner.
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
  /**
   * Ceiling over the eye, so a wide panel cannot lift a designed close-up into
   * the roof structure.
   *
   * The counterpart to `minEyeY` and the reason the docblock's rule 1 is now a
   * constraint instead of a hope. Distance is derived from the viewport, so
   * without this the eye height is whatever `dist * sin(elevation)` happens to
   * come to — which is how every station preset ended up above the services.
   */
  maxEyeY?: number;
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
  // From the open floor south-west of the bay, looking north-north-east up the
  // shop at the fixture, with the Z1-Z3 run crossing low in the near field.
  WELD: {
    center: [ANCHOR.weldFixture[0], 1.7, ANCHOR.weldFixture[2]],
    halfWidth: 6.5,
    halfHeight: 4.0,
    dir: dirFrom(350, 10),
    maxDistance: 15,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'Weld bay',
  },
  // The one preset with no bay of its own: framed at the sort looking back west
  // along the outfeed run, which is where a queue reads as a queue.
  CONV: {
    center: [24, 1.4, 2],
    halfWidth: 7.0,
    halfHeight: 4.6,
    dir: dirFrom(260, 14),
    maxDistance: 16,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'The spine, from the sort',
  },
  // From the aisle's west end, looking north-east along the four lanes rather
  // than square at them, so the rack reads as depth instead of as a wall.
  STORE: {
    center: [-6, 2.0, -13],
    halfWidth: 6.5,
    halfHeight: 4.2,
    dir: dirFrom(310, 12),
    maxDistance: 14,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'Rack store',
  },
  // Square down the rail from the store end, so the gantry travels across the
  // frame rather than toward the lens.
  PORTAL: {
    center: [(PORTAL.x0 + PORTAL.x1) / 2, 2.6, PORTAL.z],
    halfWidth: 6.5,
    halfHeight: 3.8,
    dir: dirFrom(290, 8),
    maxDistance: 14,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'Portal robot',
  },
  // The booth is a closed box with one opening, the south glazing, so this
  // bearing is not a taste decision: from the south-east the sight-line reaches
  // the skid through the glass with the gun and the drum bank behind it. The old
  // preset stood 0.1 m from the aisle service run and shot half a frame of pipe.
  PAINT: {
    center: [ANCHOR.boothSkid[0] + 0.6, 1.8, ANCHOR.boothSkid[2]],
    halfWidth: 7.0,
    halfHeight: 4.0,
    dir: dirFrom(35, 8),
    maxDistance: 12,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'Spray booth',
  },
  // From the aisle looking south-west into the jig, with the two painted lanes
  // running away from the lens.
  ASSY: {
    center: [ANCHOR.jig[0] + 2, 1.7, ANCHOR.jig[2] + 1],
    halfWidth: 6.5,
    halfHeight: 4.2,
    dir: dirFrom(240, 10),
    maxDistance: 15,
    minEyeY: 1.6,
    maxEyeY: 3.4,
    label: 'Final assembly',
  },
  // From the aisle looking south-east down the outfeed run, so the test pad, the
  // dock and the yard beyond it are all in one shot.
  TEST: {
    center: [-6, 1.6, 11],
    halfWidth: 6.5,
    halfHeight: 4.2,
    dir: dirFrom(140, 12),
    maxDistance: 15,
    minEyeY: 1.6,
    maxEyeY: 3.4,
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
    // Ceiling before floor, so a preset carrying both cannot be pushed through
    // its own roof by a narrow panel: the floor is the one that has to win.
    if (focus.maxEyeY != null) position.y = Math.min(position.y, focus.maxEyeY);
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
