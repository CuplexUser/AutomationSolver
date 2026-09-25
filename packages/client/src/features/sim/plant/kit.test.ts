import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kitTree } from '../distribution/testKit';
import { node, plantTemplate, splitOut, type PlantAssetName } from './kit';

const MODEL = 'plant-kit.glb';

/** The GLB's JSON chunk, for what the node tree does not carry (material names). */
function gltfJson(): { materials: { name?: string }[] } {
  const buf = readFileSync(new URL(`../../../../public/models/${MODEL}`, import.meta.url));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

/** Every pivot and anchor a scene poses or reads, under the root it belongs to. */
const NAMED: Array<[PlantAssetName, string[]]> = [
  ['WeldPositioner', ['PositionerTable', 'PositionerClamp0', 'PositionerClamp1', 'PositionerSeat']],
  ['WeldGantry', ['GantryHead', 'GantryTorchTip']],
  ['WeldFixture', ['FixtureJaw0', 'FixtureJaw1']],
  ['WeldGantryCompact', ['CompactHead', 'CompactTorchTip']],
  ['PortalCarriage', ['PortalStage', 'PortalHead', 'PortalCups', 'PortalHold']],
  ['SprayReciprocator', ['GunCarriage', 'GunNozzle']],
  ['CureOven', ['OvenElement0', 'OvenElement1']],
  ['EngineHoist', ['HoistTrolley', 'HoistHook', 'HoistChain']],
  ['ServiceDrop', ['ServiceRiser']],
  ['FenceGate', ['GateLeaf']],
  ['Lorry', ['LorryBody', 'LorrySlot0', 'LorrySlot5']],
];

describe('plant kit', () => {
  it('has every root and pivot the scenes look up, where they look', () => {
    const tree = kitTree(MODEL);
    for (const [root, names] of NAMED) {
      const r = tree.getObjectByName(root);
      expect(r, root).toBeDefined();
      for (const n of names) expect(r?.getObjectByName(n), `${root}/${n}`).toBeDefined();
    }
  });

  it('names every material the client drives, and none called Paint', () => {
    const names = gltfJson().materials.map((m) => m.name);
    for (const n of ['Element', 'Oven Glow', 'Lamp Red', 'Lamp Amber', 'Lamp Green', 'Eye Lens', 'Pump Lamp', 'Screen',
      'Fence Mesh', 'Drum Band', 'Vest']) {
      expect(names, n).toContain(n);
    }
    // `Paint` is the excavator kit's recolor hook; the plant must not share it.
    expect(names).not.toContain('Paint');
  });

  it('keeps pivots through the bake, at the root with its transform cleared', () => {
    const t = plantTemplate(kitTree(MODEL), 'PortalCarriage');
    expect(t.position.lengthSq()).toBe(0);
    // Blender Z up arrives as three's Y: the head hangs 4.5 m up with the axis raised.
    expect(node(t, 'PortalHead').position.y).toBeCloseTo(4.5, 3);
    expect(node(t, 'PortalHead').parent?.name).toBe('PortalStage');
  });

  it('splits a moving part out of its static body', () => {
    const t = plantTemplate(kitTree(MODEL), 'WeldGantry').clone(true);
    const live = splitOut(t, ['GantryHead']);
    expect(live.getObjectByName('GantryHead')).toBeDefined();
    expect(t.getObjectByName('GantryHead')).toBeUndefined();
  });
});
