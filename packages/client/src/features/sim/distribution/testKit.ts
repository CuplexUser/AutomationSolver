import { readFileSync } from 'node:fs';
import { afterAll, beforeAll } from 'vitest';
import * as THREE from 'three';

/**
 * The scene against the real kit's node tree.
 *
 * The GLB's JSON chunk holds every node's name and transform; only the mesh data
 * is Draco-compressed. Rebuilding the tree with empty meshes gives the plant the
 * exact hierarchy it gets in the browser, so these tests catch a renamed slot, a
 * wrong parent or a pallet in the wrong place without a GPU or a decoder.
 */
export function kitTree(model = 'dc-kit.glb'): THREE.Group {
  const buf = readFileSync(new URL(`../../../../public/models/${model}`, import.meta.url));
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: {
      name?: string;
      children?: number[];
      mesh?: number;
      translation?: number[];
      rotation?: number[];
      scale?: number[];
    }[];
    scenes: { nodes: number[] }[];
  };
  const make = (i: number): THREE.Object3D => {
    const n = gltf.nodes[i];
    const obj = n.mesh !== undefined ? new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()) : new THREE.Object3D();
    obj.name = n.name ?? '';
    if (n.translation) obj.position.fromArray(n.translation);
    if (n.rotation) obj.quaternion.fromArray(n.rotation);
    if (n.scale) obj.scale.fromArray(n.scale);
    for (const c of n.children ?? []) obj.add(make(c));
    return obj;
  };
  const root = new THREE.Group();
  for (const i of gltf.scenes[0].nodes) root.add(make(i));
  return root;
}

/**
 * Call at a test file's top level. The floor codes paint into a canvas; Node has
 * none, and an empty image is all a texture needs here.
 */
export function stubCanvas(): void {
  const realDocument = (globalThis as { document?: unknown }).document;
  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    };
  });
  afterAll(() => {
    (globalThis as { document?: unknown }).document = realDocument;
  });
}

