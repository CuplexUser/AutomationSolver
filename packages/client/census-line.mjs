// Temporary: counts what the factory-line scene draws. Deleted after use.
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5199';
const browser = await chromium.launch({ channel: 'msedge', headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(BASE + '/dev/line');
await page.waitForFunction(() => window.__plantScene, null, { timeout: 30000 });
await page.waitForTimeout(3000);

const snap = () =>
  page.evaluate(() => {
    const out = {};
    window.__plantScene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      let vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      out[o.uuid] = { m: o.matrixWorld.elements.map((v) => v.toFixed(3)).join(','), vis };
    });
    return out;
  });

const a = await snap();
await page.waitForTimeout(15000);
const b = await snap();

const census = await page.evaluate(
  ({ a, b }) => {
    const sig = (m) => {
      if (!m) return 'none';
      const c = (x) => (x && x.getHexString ? x.getHexString() : '');
      return [
        m.type, c(m.color), c(m.emissive), m.emissiveIntensity?.toFixed?.(2), m.roughness?.toFixed?.(2),
        m.metalness?.toFixed?.(2), m.map?.uuid ?? '', m.transparent, m.opacity?.toFixed?.(2), m.side,
        m.polygonOffset, m.polygonOffsetFactor, m.depthWrite, m.toneMapped, m.wireframe, m.vertexColors,
      ].join('|');
    };
    let meshes = 0, visible = 0, cast = 0, stable = 0, stableCast = 0, instanced = 0;
    const mats = new Set();
    const stableSigs = new Map();
    const matsInst = new Set();
    window.__plantScene.traverse((o) => {
      if (!o.isMesh) return;
      meshes += 1;
      if (o.isInstancedMesh) instanced += 1;
      let vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      visible += 1;
      if (o.castShadow) cast += 1;
      const s = sig(o.material);
      mats.add(s);
      matsInst.add(o.material.uuid);
      const A = a[o.uuid];
      const B = b[o.uuid];
      if (A && B && A.m === B.m && A.vis && B.vis) {
        stable += 1;
        if (o.castShadow) stableCast += 1;
        stableSigs.set(s, (stableSigs.get(s) ?? 0) + 1);
      }
    });
    return {
      meshes, visible, instanced, cast, stable, stableCast,
      materialInstances: matsInst.size,
      distinctMaterialSigs: mats.size,
      stableSigBuckets: stableSigs.size,
    };
  },
  { a, b },
);
console.log(JSON.stringify(census, null, 1));
await browser.close();
