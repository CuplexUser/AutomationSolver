import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BAY, type MachineState } from '@automationsolver/shared';
import { buildHubPlant } from './plant';
import { kitTree, stubCanvas } from './testKit';

stubCanvas();

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
    // Vehicle 1 in QA's bay carrying a potato pallet; vehicle 2 driving; vehicle 3 parked.
    v0S: 'hold',
    v0Pk: BAY.QA,
    v0Load: '404pn0',
    v1S: 'drive',
    v1E: 0,
    v1Pos: 6000,
    v1Leg: 'src',
    v1From: 21,
    v1Rt: '0.14.2',
    v1Ri: 0,
    v2S: 'park',
    v2Pk: BAY.P3,
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
      return Math.abs(p.x - 4.4) < 0.01;
    });
    expect(slot).toBeDefined();
    const stack = slot!.children.find((c) => c.children.some((k) => k.name === 'Pallet'));
    expect(stack?.visible).toBe(true);
    const shown = stack!.children.filter((c) => c.visible && c.name.startsWith('Load_')).map((c) => c.name);
    expect(shown).toEqual(['Load_Tomatoes']);
    // The pick end is a station front short of the south aisle (z 10.1), on the lane's bed.
    const p = worldOf(slot!);
    expect(p.z).toBeGreaterThan(7);
    expect(p.z).toBeLessThan(8);
  });

  it('carries a pallet on the forks of the vehicle that has one', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    plant.pose(machine, 0.05);
    const anchors = plant.group.getObjectsByProperty('name', 'AgvPalletAnchor');
    const loaded = anchors.filter((a) => a.children.some((c) => c.visible));
    expect(loaded).toHaveLength(1);
    // In QA's bay, north of the north aisle.
    expect(worldOf(loaded[0]).z).toBeLessThan(-1.4);
  });

  it('draws the route a driving vehicle is following, and none for the others', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    plant.pose(machine, 0.05);
    const lines = plant.group.children.filter((c) => (c as THREE.Line).isLine) as THREE.Line[];
    expect(lines.map((l) => l.geometry.drawRange.count > 1)).toEqual([false, true, false]);
  });

  it('lifts the truck roof off, so the load order can be seen', () => {
    const plant = buildHubPlant(kitTree(), LOCS, 3);
    const roofs = plant.group.getObjectsByProperty('name', 'TruckRoof');
    expect(roofs.length).toBe(2);
    expect(roofs.every((r) => !r.visible)).toBe(true);
  });
});
