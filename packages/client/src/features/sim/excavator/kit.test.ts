import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kitTree } from '../distribution/testKit';
import { KIT_ANCHORS, KIT_ROOTS, KitMachine, kitTemplates } from './kit';

const MODEL = 'excavator-kit.glb';

/** The GLB's JSON chunk, for what the node tree does not carry (material names). */
function gltfJson(): { materials: { name?: string }[] } {
  const buf = readFileSync(new URL(`../../../../public/models/${MODEL}`, import.meta.url));
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

describe('excavator kit', () => {
  it('has every root, anchor and pivot the scenes look up by name', () => {
    const tree = kitTree(MODEL);
    for (const name of [...Object.values(KIT_ROOTS), ...KIT_ANCHORS, 'BoomLift', 'BoomStick', 'BoomBucket']) {
      expect(tree.getObjectByName(name), name).toBeDefined();
    }
    // Anchors belong to the root that carries them, and the pivots nest in order.
    expect(tree.getObjectByName('FrameSlew')?.parent?.name).toBe(KIT_ROOTS.frame);
    expect(tree.getObjectByName('HouseCab')?.parent?.name).toBe(KIT_ROOTS.house);
    expect(tree.getObjectByName('HouseBoomFoot')?.parent?.name).toBe(KIT_ROOTS.house);
    expect(tree.getObjectByName('BoomStick')?.parent?.name).toBe('BoomLift');
    expect(tree.getObjectByName('BoomBucket')?.parent?.name).toBe('BoomStick');
  });

  it('paints through the one material the client replaces', () => {
    const names = gltfJson().materials.map((m) => m.name);
    expect(names).toContain('Paint');
  });

  it('stands the house on the slew ring, low on the tracks, and seats cab and boom on it', () => {
    const t = kitTemplates(kitTree(MODEL));
    // Blender Z up arrives as three's Y: the slew top is 0.6 m off the ground.
    expect(t.slew.y).toBeCloseTo(0.6, 3);
    expect(t.cabSeat.y).toBeGreaterThan(0);
    // The cab sits on the machine's left, which the exporter turns into three's -Z.
    expect(t.cabSeat.z).toBeLessThan(0);
    expect(t.boomFoot.x).toBeGreaterThan(0);

    const m = new KitMachine(t);
    m.pose({ engine: 1, cab: 1, boom: 1 });
    const [, house, cab, boom] = m.group.children;
    expect(house.position.y).toBeCloseTo(t.slew.y, 5);
    expect(cab.position.y).toBeCloseTo(t.slew.y + t.cabSeat.y, 5);
    expect(boom.rotation.z).toBe(0);
    // Half fitted, each piece still hangs above its seat, and an unfitted one is not drawn.
    m.pose({ engine: 0.5, cab: 0, boom: 0.5 });
    expect(house.position.y).toBeGreaterThan(t.slew.y);
    expect(cab.visible).toBe(false);
    expect(boom.rotation.z).toBeGreaterThan(0);
  });
});
