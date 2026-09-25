import * as THREE from 'three';
import { mergeMeshes } from '../batch';
import { enableShadows } from '../MachineCanvas';

/**
 * The plant kit (`plant-kit.glb`): every cell and prop of the excavator plant
 * that is not the excavator itself.
 *
 * Built by `D:\Code\Blender\Automation-excavator-plant-assets.build.py`, whose
 * docstring is the contract: one root per asset, its front facing +Z here, and
 * the moving parts as named nodes the scenes pose. An asset is a few hundred
 * small parts in Blender, so each moving part's meshes are baked once into one
 * mesh per material, in that part's own frame. A clone of the bake shares its
 * geometry and materials, which is also what lets `StaticBatch` fold the static
 * ones into the rest of the scene.
 */

/** Nodes whose subtree moves (or is stretched) as one, so the bake keeps them as nodes. */
export const PLANT_PIVOTS = new Set([
  'PositionerTable',
  'PositionerClamp0',
  'PositionerClamp1',
  'GantryHead',
  'CompactHead',
  'FixtureJaw0',
  'FixtureJaw1',
  'PortalStage',
  'PortalHead',
  'PortalCups',
  'GunCarriage',
  'HoistTrolley',
  'HoistHook',
  'HoistChain',
  'GateLeaf',
  'ServiceRiser',
  'OvenElement0',
  'OvenElement1',
]);

/** Every root the scenes look up. */
export type PlantAssetName =
  | 'WeldPositioner'
  | 'WeldGantry'
  | 'TipStand'
  | 'BlankRack'
  | 'WeldFixture'
  | 'WeldGantryCompact'
  | 'WeldScreen'
  | 'GravityLane'
  | 'PartStand'
  | 'PortalFrame'
  | 'PortalCarriage'
  | 'SprayBooth'
  | 'SprayReciprocator'
  | 'BoothSkid'
  | 'PaintDrum'
  | 'CatchPot'
  | 'CureOven'
  | 'OvenRack'
  | 'PaintBoothCompact'
  | 'CureOvenCompact'
  | 'HeaterDuct'
  | 'ExtractStack'
  | 'ConveyorModule'
  | 'ConveyorTurn'
  | 'PhotoEye'
  | 'AssemblyJig'
  | 'EngineHoist'
  | 'MakeUpBench'
  | 'PartsBin'
  | 'PowerPack'
  | 'TestConsole'
  | 'TestPlatform'
  | 'DockFace'
  | 'Lorry'
  | 'ScrapSkip'
  | 'YardMast'
  | 'FencePanel'
  | 'FencePost'
  | 'FenceGate'
  | 'StackLight'
  | 'HmiPost'
  | 'Cabinet'
  | 'Figure'
  | 'ServiceTray'
  | 'ServiceDrop';

const templates = new WeakMap<THREE.Object3D, Map<string, THREE.Object3D>>();

/** The baked template for one root of `kit`, made once per loaded scene. Clone it to draw it. */
export function plantTemplate(kit: THREE.Object3D, name: PlantAssetName): THREE.Object3D {
  let byName = templates.get(kit);
  if (!byName) {
    byName = new Map();
    templates.set(kit, byName);
  }
  let t = byName.get(name);
  if (!t) {
    const src = kit.getObjectByName(name);
    t = src ? src.clone(true) : new THREE.Group();
    t.position.set(0, 0, 0);
    t.rotation.set(0, 0, 0);
    t.scale.set(1, 1, 1);
    t.updateMatrixWorld(true);
    bake(t);
    enableShadows(t);
    byName.set(name, t);
  }
  return t;
}

/** Replaces each pivot's meshes with one per material, in the pivot's own frame. */
function bake(tree: THREE.Object3D): void {
  const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
  tree.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let p: THREE.Object3D | null = mesh.parent;
    while (p && p !== tree && !PLANT_PIVOTS.has(p.name)) p = p.parent;
    const pivot = p ?? tree;
    const list = groups.get(pivot) ?? [];
    list.push(mesh);
    groups.set(pivot, list);
  });
  for (const [pivot, meshes] of groups) {
    const toLocal = pivot.matrixWorld.clone().invert();
    // A node tree rebuilt for a test carries empty meshes; there is nothing to bake.
    const pieces = meshes
      .filter((m) => m.geometry.getAttribute('position'))
      .map((mesh) => ({ mesh, matrix: toLocal.clone().multiply(mesh.matrixWorld) }));
    for (const m of meshes) m.removeFromParent();
    for (const out of mergeMeshes(pieces, (m) => m.material)) {
      out.name = (out.material as THREE.Material).name;
      pivot.add(out);
    }
  }
  // Emptied groups (a multi-material mesh arrives as a group of primitives) are dropped.
  const empties: THREE.Object3D[] = [];
  tree.traverse((o) => {
    if (o !== tree && !(o as THREE.Mesh).isMesh && o.children.length === 0 && !o.name) empties.push(o);
  });
  for (const e of empties) e.removeFromParent();
}

/** A pivot or anchor by name. Throws on a missing one: a rename in the build script must not fail silently. */
export function node(root: THREE.Object3D, name: string): THREE.Object3D {
  const n = root.getObjectByName(name);
  if (!n) throw new Error(`plant kit: no node ${name} under ${root.name}`);
  return n;
}

/** The meshes drawn in material `name`, anywhere under `root`. */
export function meshesIn(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).name === name) out.push(mesh);
  });
  return out;
}

/**
 * Gives every mesh in material `name` under `root` one material of its own
 * (shared between them), shaped by `make` from the kit's. For a lamp that
 * lights, a band that takes a color, a screen that takes a texture.
 */
export function ownMaterial<M extends THREE.Material>(
  root: THREE.Object3D,
  name: string,
  make: (kit: THREE.MeshStandardMaterial) => M,
): M | null {
  const meshes = meshesIn(root, name);
  if (meshes.length === 0) return null;
  const m = make(meshes[0].material as THREE.MeshStandardMaterial);
  for (const mesh of meshes) mesh.material = m;
  return m;
}

/**
 * Moves what the scene animates out of `root` into a group of its own, keeping
 * where it is: the meshes directly under the root drawn in any material in
 * `names`, and the pivots named in it. The static rest of an asset can then be
 * batched while only its lamps and moving parts stay live.
 */
export function splitOut(root: THREE.Object3D, names: string[]): THREE.Group {
  const live = new THREE.Group();
  // A copy, since moving a child out changes the list being walked.
  for (const child of root.children.slice()) {
    const mesh = child as THREE.Mesh;
    const hit = mesh.isMesh ? names.includes((mesh.material as THREE.Material).name) : names.includes(child.name);
    if (hit) live.add(child);
  }
  return live;
}
