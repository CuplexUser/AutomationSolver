import { expect, test, type Page } from '@playwright/test';
import { FLOOR, WALL_H } from '../src/features/sim/factoryLine/plant';
import type { CameraEye, MeshBox, SceneAudit } from '../src/features/sim/factoryLine/audit';

/**
 * The scene audit from `docs/FACTORY-LINE-DESIGN.md` §6 "How this was found",
 * made repeatable.
 *
 * Every camera and placement bug that section describes was found once, by
 * hand, walking `window.__plantScene` from a throwaway Playwright script and
 * doing arithmetic on the dump. `audit.ts`'s `window.__plantAudit()` is that
 * dump, checked in; these three checks are the arithmetic that found the
 * outside-the-building meshes, the misframed cameras and the guard-crossing
 * shots. Floating geometry and coplanar faces are deliberately not here — see
 * the note at the bottom of this file.
 */

async function loadAudit(page: Page): Promise<SceneAudit> {
  await page.goto('/dev/line');
  await page.locator('.machine3d canvas').waitFor({ state: 'visible', timeout: 15000 });
  // The plant's textures and 439 meshes build after the canvas exists; without
  // this the first audit call races the scene and comes back near-empty.
  await page.waitForTimeout(2000);
  return page.evaluate(() => (window as unknown as { __plantAudit: () => SceneAudit }).__plantAudit());
}

const EPS = 0.05;

function outsideFloor(m: MeshBox): boolean {
  const [x0, y0, z0] = m.min;
  const [x1, y1, z1] = m.max;
  return (
    x0 < FLOOR.x0 - EPS ||
    x1 > FLOOR.x1 + EPS ||
    z0 < FLOOR.z0 - EPS ||
    z1 > FLOOR.z1 + EPS ||
    y0 < -EPS ||
    y1 > WALL_H + EPS
  );
}

test('the plant scene stays inside the building', async ({ page }) => {
  const audit = await loadAudit(page);
  const violations = audit.meshes.filter(outsideFloor);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

/** `docs/FACTORY-LINE-DESIGN.md` §6, rule 1: every preset but the overview. */
const MIN_EYE_Y = 1.4;
const MAX_EYE_Y = 3.4;

function badEye(c: CameraEye): string | null {
  const [x, y, z] = c.eye;
  if (x < FLOOR.x0 - EPS || x > FLOOR.x1 + EPS || z < FLOOR.z0 - EPS || z > FLOOR.z1 + EPS) {
    return 'stands outside the building';
  }
  if (y < MIN_EYE_Y - EPS || y > MAX_EYE_Y + EPS) {
    return `eye height ${y.toFixed(2)} m is outside ${MIN_EYE_Y}-${MAX_EYE_Y} m`;
  }
  return null;
}

test('every station camera stands on open floor at human height', async ({ page }) => {
  const audit = await loadAudit(page);
  const violations = audit.cameras
    .map((c) => ({ preset: c.preset, aspect: c.aspect, eye: c.eye, reason: badEye(c) }))
    .filter((v) => v.reason);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

/**
 * Ray-vs-AABB by the slab method. Returns the entry distance along `dir`
 * (which must be a unit vector), or `null` if the ray misses the box.
 */
function rayBoxT(origin: [number, number, number], dir: [number, number, number], m: MeshBox): number | null {
  let tMin = 0;
  let tMax = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const inv = 1 / dir[i];
    let t0 = (m.min[i] - origin[i]) * inv;
    let t1 = (m.max[i] - origin[i]) * inv;
    if (inv < 0) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMax < tMin) return null;
  }
  return tMin;
}

const meshSize = (m: MeshBox): number =>
  Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);

/**
 * Ignore anything smaller than this: rule 2 *wants* something in the near
 * field (a fence post, a bollard, a drum), so a small prop crossing the exact
 * eye-target line is the shot working as designed, not a blocked one. What it
 * forbids is a wall or a fence panel — multi-metre things — in the way, which
 * is what actually happened at the store and the portal.
 */
const SIGHTLINE_MIN_SIZE = 1.0;
/** Ignore hits right at the lens (camera-rig clutter, if any ever exists). */
const EYE_MARGIN = 1.5;
/** Ignore hits on the subject itself — the whole point of aiming at it. */
const TARGET_MARGIN = 3.0;

function firstBlocker(c: CameraEye, meshes: MeshBox[]): string | null {
  const [ex, ey, ez] = c.eye;
  const [tx, ty, tz] = c.target;
  const d: [number, number, number] = [tx - ex, ty - ey, tz - ez];
  const dist = Math.hypot(...d);
  const dir: [number, number, number] = [d[0] / dist, d[1] / dist, d[2] / dist];
  for (const m of meshes) {
    if (meshSize(m) < SIGHTLINE_MIN_SIZE) continue;
    const t = rayBoxT(c.eye, dir, m);
    if (t == null || t < EYE_MARGIN || t > dist - TARGET_MARGIN) continue;
    return m.name;
  }
  return null;
}

test('no station camera shoots its subject through a wall or a fence', async ({ page }) => {
  const audit = await loadAudit(page);
  const violations = audit.cameras
    .map((c) => ({ preset: c.preset, aspect: c.aspect, blocker: firstBlocker(c, audit.meshes) }))
    .filter((v) => v.blocker);
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
});

/**
 * Floating geometry and coplanar faces are the other two checks
 * `FACTORY-LINE-DESIGN.md` §6 names, and they are deliberately not automated
 * here. Both were tried against the real 439-mesh dump while building this
 * file:
 *
 * - A "nothing supports this AABB from below" floating check flagged 22
 *   meshes, and every one was a legitimate wall- or ceiling-mounted fixture
 *   (the eaves beam, service-run drops, bay signage, the assembly hoist rail)
 *   that has no floor support by design because it hangs from a wall or a
 *   ceiling run, not because it is a bug. Telling those apart from an actual
 *   floating prop needs knowing what a mesh is *attached to*, which nothing
 *   in the scene currently records.
 * - Coplanar-face detection has the same problem the other direction: most
 *   legitimate meshes share a y with something else on purpose (a shelf's
 *   contents, two conveyor decks at the same height), so "shares a y" is not
 *   yet a distinguishing signal.
 *
 * Both are worth revisiting if the scene ever gains that metadata; until
 * then a check that cries wolf on every wall fixture is worse than no check.
 */
