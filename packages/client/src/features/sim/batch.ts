import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** One mesh to bake, and the transform that puts it where it belongs in the batch's space. */
export interface BatchPiece {
  mesh: THREE.Mesh;
  matrix: THREE.Matrix4;
}

/**
 * Bakes meshes that never move into one mesh per bucket.
 *
 * A procedural plant is hundreds of small boxes, and every one of them is a draw
 * call in every pass (the shadow map, the occlusion pass's normals and the image
 * itself). Pieces that share a bucket are transformed into place once and drawn
 * as one. `keyOf` decides what may share: the Cold Chain kit's clones share
 * material instances, so it keys on the instance; a JSX scene builds a material
 * per mesh, so it keys on what the material looks like (`materialSignature`).
 *
 * Each merged mesh takes its bucket's first material, shadow flags and render
 * order, so a key has to separate anything those differ on. The sources are
 * left alone; disposing them is the caller's business.
 */
export function mergeMeshes(
  pieces: BatchPiece[],
  keyOf: (mesh: THREE.Mesh) => unknown,
): THREE.Mesh[] {
  const buckets = new Map<
    unknown,
    { geo: THREE.BufferGeometry; src: THREE.Mesh }[]
  >();
  for (const { mesh, matrix } of pieces) {
    if (Array.isArray(mesh.material)) continue;
    const geo = mesh.geometry.clone().applyMatrix4(matrix);
    // A mirroring transform turns every triangle inside out, and a one-sided
    // material would then draw the back of the piece. Put the winding back.
    if (matrix.determinant() < 0) flipWinding(geo);
    const key = keyOf(mesh);
    const list = buckets.get(key) ?? [];
    list.push({ geo, src: mesh });
    buckets.set(key, list);
  }
  const out: THREE.Mesh[] = [];
  for (const items of buckets.values()) {
    // Only the attributes every piece has, all indexed or none, or the merge refuses.
    const names = Object.keys(items[0].geo.attributes).filter((n) =>
      items.every((i) => i.geo.getAttribute(n)),
    );
    const indexed = items.every((i) => i.geo.index);
    const geos = items.map(({ geo }) => {
      const g = indexed || !geo.index ? geo : geo.toNonIndexed();
      for (const n of Object.keys(g.attributes))
        if (!names.includes(n)) g.deleteAttribute(n);
      return g;
    });
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (merged && geos.length > 1) for (const g of geos) g.dispose();
    const first = items[0].src;
    // Already in place, so a bucket that would not merge is drawn piece by piece.
    for (const geo of merged ? [merged] : geos) {
      const mesh = new THREE.Mesh(geo, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      out.push(mesh);
    }
  }
  return out;
}

function flipWinding(geo: THREE.BufferGeometry): void {
  const index = geo.index;
  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    for (let i = 0; i + 2 < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.getComponent(i + 1, k);
        a.setComponent(i + 1, k, a.getComponent(i + 2, k));
        a.setComponent(i + 2, k, t);
      }
    }
    a.needsUpdate = true;
  }
}

const MAP_SLOTS = [
  "map",
  "emissiveMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "alphaMap",
  "aoMap",
] as const;
const SCALARS = [
  "type",
  "emissiveIntensity",
  "roughness",
  "metalness",
  "opacity",
  "transparent",
  "alphaTest",
  "side",
  "depthWrite",
  "depthTest",
  "polygonOffset",
  "polygonOffsetFactor",
  "polygonOffsetUnits",
  "flatShading",
  "vertexColors",
  "toneMapped",
  "fog",
  "wireframe",
  "blending",
] as const;

/**
 * What a mesh looks like, as a key: two meshes with equal signatures can be
 * drawn with either one's material. Includes the mesh's shadow flags and render
 * order, which the merged mesh inherits from its bucket.
 */
export function materialSignature(mesh: THREE.Mesh): string {
  const m = mesh.material as THREE.Material & Record<string, unknown>;
  const parts: unknown[] = [
    mesh.castShadow,
    mesh.receiveShadow,
    mesh.renderOrder,
  ];
  for (const k of SCALARS) parts.push(m[k]);
  for (const k of ["color", "emissive"] as const) {
    const c = m[k] as THREE.Color | undefined;
    parts.push(c?.getHexString?.());
  }
  for (const k of MAP_SLOTS)
    parts.push((m[k] as THREE.Texture | null | undefined)?.uuid);
  return parts.join("|");
}
