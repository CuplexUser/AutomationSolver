import * as THREE from 'three';
import { SECTION_FOCUS, resolveFocusEye } from './camera';

/**
 * Dev-only scene tooling, mounted only on `/dev/line`. See
 * `docs/FACTORY-LINE-DESIGN.md` §6 "How this was found": every camera and
 * placement bug fixed there was found by walking `window.__plantScene` from a
 * throwaway Playwright script and doing arithmetic on the dump. This file is
 * that script's checked-in half — the dumping — with the arithmetic living in
 * `tests/scene-audit.spec.ts`, which calls it through `window.__plantAudit`.
 */

/**
 * What one mesh in the plant *is*, in the terms `plant.ts` describes it in.
 *
 * There is no other way to answer "what is that thing crossing the rack?" from
 * a screenshot. The scene is thousands of anonymous boxes generated from a
 * hundred constants, and matching one to a line of source by eye is guesswork
 * that has been wrong more often than right. A click gives its world position,
 * its geometry and the arguments it was built with, which names it uniquely.
 */
export function describeMesh(o: THREE.Object3D): string {
  const p = new THREE.Vector3();
  o.getWorldPosition(p);
  const at = `[${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]`;
  const mesh = o as THREE.Mesh;
  const g = mesh.geometry as THREE.BufferGeometry & { parameters?: Record<string, unknown> };
  const kind = g?.type ?? o.type;
  const args = g?.parameters
    ? Object.entries(g.parameters)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k} ${(v as number).toFixed(2)}`)
        .join(', ')
    : '';
  const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
  const color = mat?.color ? ` color #${mat.color.getHexString()}` : '';
  return `${kind} at ${at}${args ? ` (${args})` : ''}${color}`;
}

/** One mesh's world-space axis-aligned bounding box. */
export interface MeshBox {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Every mesh in the scene, as a world AABB.
 *
 * `Box3.setFromObject` on a leaf mesh is exactly the world bounds of its
 * geometry — degenerate (zero-thickness) for a flat panel like a wall or a
 * decal, which is fine for the outside-the-building check and simply never
 * trips the floating check, since nothing can be "under" a box with no volume.
 */
export function dumpMeshBoxes(scene: THREE.Scene): MeshBox[] {
  const out: MeshBox[] = [];
  const box = new THREE.Box3();
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    out.push({
      name: describeMesh(o),
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    });
  });
  return out;
}

/** Where one section camera preset's eye lands, at one viewport aspect. */
export interface CameraEye {
  preset: string;
  aspect: number;
  eye: [number, number, number];
  target: [number, number, number];
}

/**
 * Every station preset's resolved eye position, at a spread of viewport
 * aspects — the 1.1 to 2.6 range `docs/FACTORY-LINE-DESIGN.md` §6 says the
 * presets were solved against.
 *
 * `SUP` is excluded: it is `PLANT_FOCUS`, the one preset the design's own
 * "eye height 1.4 to 3.4 m" rule explicitly exempts ("for every preset but
 * the overview").
 */
export function dumpCameraEyes(aspects: number[], fovDeg = 34): CameraEye[] {
  const out: CameraEye[] = [];
  for (const [preset, focus] of Object.entries(SECTION_FOCUS)) {
    if (preset === 'SUP') continue;
    for (const aspect of aspects) {
      const { position, target } = resolveFocusEye(focus, aspect, fovDeg);
      out.push({ preset, aspect, eye: position, target });
    }
  }
  return out;
}

export interface SceneAudit {
  meshes: MeshBox[];
  cameras: CameraEye[];
}

const ASPECTS = [1.1, 1.33, 1.6, 1.78, 2.6];

/** The one function `tests/scene-audit.spec.ts` calls, via `window.__plantAudit`. */
export function auditScene(scene: THREE.Scene): SceneAudit {
  return { meshes: dumpMeshBoxes(scene), cameras: dumpCameraEyes(ASPECTS) };
}

interface AuditWindow {
  __plantScene?: THREE.Scene;
  __plantAudit?: () => SceneAudit;
}

/** Hands the live scene, and a snapshot function, to the page. Dev only. */
export function installSceneAudit(scene: THREE.Scene): () => void {
  const w = window as unknown as AuditWindow;
  w.__plantScene = scene;
  w.__plantAudit = () => auditScene(scene);
  return () => {
    delete w.__plantScene;
    delete w.__plantAudit;
  };
}
