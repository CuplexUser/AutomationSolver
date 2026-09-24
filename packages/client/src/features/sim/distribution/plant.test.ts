import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { buildHubPlant } from './plant';

/**
 * The scene against the real kit's node tree.
 *
 * The GLB's JSON chunk holds every node's name and transform; only the mesh data
 * is Draco-compressed. Rebuilding the tree with empty meshes gives the plant the
 * exact hierarchy it gets in the browser, so these tests catch a renamed slot, a
 * wrong parent or a pallet in the wrong place without a GPU or a decoder.
 */
function kitTree(): THREE.Group {
  const buf = readFileSync(new URL('../../../../public/models/dc-kit.glb', import.meta.url));
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

// The signs paint into a canvas; Node has none, and an empty image is all a texture needs here.
const realDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
});

const LOCS = '1,2,10,11,21,22,31,32,41,42,43,61,62,70';

function visibleStacks(group: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((o) => {
    // A stack is the group holding a Pallet clone.
    if (o.children.some((c) => c.name === 'Pallet') && o.visible) out.push(o);
  });
  return out;
}

const worldOf = (o: THREE.Object3D): THREE.Vector3 => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};

describe('the hub scene, built from the kit', () => {
  const machine: MachineState = {
    locs: LOCS,
    fleet: 3,
    // Two tomato pallets in F1, front first.
    c31: '301pn0,302pn0',
    // Vehicle 1 in QA's pocket carrying a potato pallet; vehicle 2 driving; vehicle 3 parked.
    v0S: 'hold',
    v0Pk: 5500,
    v0Load: '404pn0',
    v1S: 'drive',
    v1Pos: 20_000,
    v2S: 'park',
    v2Pk: 32_500,
    // A truck at OUT1 with one pallet on it.
    t61: 'docked',
    k61: 1,
    c61: '303pn0',
    r1Door: 0,
  };

  it('builds without a missing name and poses a state without throwing', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    expect(() => plant.pose(machine, 0.05)).not.toThrow();
    // Two in F1, one on the forks, one on the truck.
    expect(visibleStacks(plant.group)).toHaveLength(4);
  });

  it('stands F1\'s front pallet on the lane\'s front slot, as tomatoes', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    plant.pose(machine, 0.05);
    const slot = plant.group.getObjectsByProperty('name', 'FlowLaneSlot0').find((s) => {
      const p = worldOf(s);
      return Math.abs(p.x - 10) < 0.01;
    });
    expect(slot).toBeDefined();
    const stack = slot!.children.find((c) => c.children.some((k) => k.name === 'Pallet'));
    expect(stack?.visible).toBe(true);
    const shown = stack!.children.filter((c) => c.visible && c.name.startsWith('Load_')).map((c) => c.name);
    expect(shown).toEqual(['Load_Tomatoes']);
    // The pick end is a pocket short of the south leg (z 8), on the lane's bed.
    const p = worldOf(slot!);
    expect(p.z).toBeGreaterThan(6);
    expect(p.z).toBeLessThan(7);
  });

  it('carries a pallet on the forks of the vehicle that has one', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    plant.pose(machine, 0.05);
    const anchors = plant.group.getObjectsByProperty('name', 'AgvPalletAnchor');
    const loaded = anchors.filter((a) => a.children.some((c) => c.visible));
    expect(loaded).toHaveLength(1);
    // In QA's pocket, north of the north leg.
    expect(worldOf(loaded[0]).z).toBeLessThan(-1);
  });

  it('lifts the truck roof off, so the load order can be seen', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    const roofs = plant.group.getObjectsByProperty('name', 'TruckRoof');
    expect(roofs.length).toBe(2);
    expect(roofs.every((r) => !r.visible)).toBe(true);
  });
});
