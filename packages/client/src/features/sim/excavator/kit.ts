import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { enableShadows } from '../MachineCanvas';

/**
 * The excavator kit (`excavator-kit.glb`), made ready to pose.
 *
 * The kit is built by `D:\Code\Blender\Automation-excavator-plant-assets.build.py`,
 * whose docstring is the contract: four roots (frame, house, cab, boom), anchor
 * empties where one sits on another, and three pivots on the boom. It is about
 * two hundred parts, which would be two hundred draw calls a machine, so each
 * pivot's parts are baked once into at most four meshes: the machine's paint
 * (recolored per machine), one trim mesh carrying every dark part's color in
 * its vertices, chrome and glass. A whole machine is then about a dozen draws.
 */

export const KIT_ROOTS = {
  frame: 'ExcavatorFrame',
  house: 'ExcavatorHouse',
  cab: 'ExcavatorCab',
  boom: 'ExcavatorBoom',
} as const;

/** Nodes whose subtree moves as one: each root, and the boom's three pivots. */
const PIVOTS = new Set<string>([...Object.values(KIT_ROOTS), 'BoomLift', 'BoomStick', 'BoomBucket']);

/** Empties the client reads positions from. */
export const KIT_ANCHORS = ['FrameSlew', 'HouseCab', 'HouseBoomFoot'] as const;

export interface KitTemplates {
  frame: THREE.Object3D;
  house: THREE.Object3D;
  cab: THREE.Object3D;
  boom: THREE.Object3D;
  /** Anchor positions, each in its own root's frame. */
  slew: THREE.Vector3;
  cabSeat: THREE.Vector3;
  boomFoot: THREE.Vector3;
}

const TRIM = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.55 });

/** The kit's own material names, as the class a baked mesh belongs to. */
function classOf(material: THREE.Material): 'paint' | 'chrome' | 'glass' | 'trim' {
  if (material.name === 'Paint') return 'paint';
  if (material.name === 'Chrome') return 'chrome';
  if (material.name === 'Glass') return 'glass';
  return 'trim';
}

const cache = new WeakMap<THREE.Object3D, KitTemplates>();

/** Templates for `kit`, baked once per loaded scene. */
export function kitTemplates(kit: THREE.Object3D): KitTemplates {
  const hit = cache.get(kit);
  if (hit) return hit;
  const root = (name: string): THREE.Object3D => {
    const src = kit.getObjectByName(name);
    const copy = src ? src.clone(true) : new THREE.Group();
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.updateMatrixWorld(true);
    bake(copy);
    enableShadows(copy);
    return copy;
  };
  const frame = root(KIT_ROOTS.frame);
  const house = root(KIT_ROOTS.house);
  const anchor = (tree: THREE.Object3D, name: string): THREE.Vector3 =>
    tree.getObjectByName(name)?.position.clone() ?? new THREE.Vector3();
  const t: KitTemplates = {
    frame,
    house,
    cab: root(KIT_ROOTS.cab),
    boom: root(KIT_ROOTS.boom),
    slew: anchor(frame, 'FrameSlew'),
    cabSeat: anchor(house, 'HouseCab'),
    boomFoot: anchor(house, 'HouseBoomFoot'),
  };
  cache.set(kit, t);
  return t;
}

/** Replaces every pivot's meshes with at most four baked ones, in the pivot's own frame. */
function bake(tree: THREE.Object3D): void {
  const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
  tree.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let p: THREE.Object3D | null = mesh.parent;
    while (p && !PIVOTS.has(p.name) && p !== tree) p = p.parent;
    const pivot = p ?? tree;
    const list = groups.get(pivot) ?? [];
    list.push(mesh);
    groups.set(pivot, list);
  });
  for (const [pivot, meshes] of groups) {
    const toLocal = pivot.matrixWorld.clone().invert();
    const buckets = new Map<string, { geos: THREE.BufferGeometry[]; material: THREE.Material }>();
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const kind = classOf(material);
      mesh.removeFromParent();
      // A node tree rebuilt for a test carries empty meshes; there is nothing to bake.
      if (!mesh.geometry.getAttribute('position')) continue;
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geo.applyMatrix4(toLocal.clone().multiply(mesh.matrixWorld));
      for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal') geo.deleteAttribute(n);
      if (kind === 'trim') {
        const count = geo.getAttribute('position').count;
        const colors = new Float32Array(count * 3);
        const c = material.color ?? new THREE.Color('#3a3f45');
        for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      const b = buckets.get(kind) ?? { geos: [], material: kind === 'trim' ? TRIM : material };
      b.geos.push(geo);
      buckets.set(kind, b);
    }
    for (const [kind, { geos, material }] of buckets) {
      const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      if (!merged) continue;
      const out = new THREE.Mesh(merged, material);
      out.name = `${pivot.name}:${kind}`;
      if (kind === 'paint') out.userData.paint = true;
      pivot.add(out);
    }
  }
}

/** A paint as the scenes describe one. */
export interface KitPaint {
  color: string;
  metalness: number;
  roughness: number;
}

const paints = new Map<string, THREE.MeshStandardMaterial>();

/** One shared material per paint, so a hundred parts in one color are one material. */
export function paintMaterial(p: KitPaint): THREE.MeshStandardMaterial {
  const key = `${p.color}|${p.metalness}|${p.roughness}`;
  let m = paints.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness });
    paints.set(key, m);
  }
  return m;
}

function repaint(tree: THREE.Object3D, material: THREE.Material): void {
  tree.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.paint) mesh.material = material;
  });
}

/** Boom angles as offsets from the kit's rest stance, in radians; positive raises / opens. */
export interface BoomPose {
  lift?: number;
  stick?: number;
  bucket?: number;
}

function poseBoom(boom: THREE.Object3D, pose: BoomPose): void {
  const lift = boom.getObjectByName('BoomLift');
  const stick = boom.getObjectByName('BoomStick');
  const bucket = boom.getObjectByName('BoomBucket');
  if (lift) lift.rotation.z = pose.lift ?? 0;
  if (stick) stick.rotation.z = pose.stick ?? 0;
  if (bucket) bucket.rotation.z = pose.bucket ?? 0;
}

/**
 * A boom folded for transport: stick tucked back under the arm, bucket curled
 * against it. The fold was searched for in Blender as the one with the least
 * depth; folded upright it still stood 1.34 m, over the paint booth's roof, so
 * a loose boom travels lying on its side, the way a real boom weldment ships.
 */
export const FOLDED: BoomPose = { lift: -0.35, stick: -2.3, bucket: 1.75 };

/**
 * A loose boom is drawn a little under the machine's scale, so that it is the
 * 2.9 m long part the lanes, racks and conveyor zones were laid out for rather
 * than the 3.4 m the folded kit measures, and two in a row do not overlap.
 */
const LOOSE_BOOM_SCALE = 0.86;

/** One loose part: a frame, or a folded boom set down on its lowest point. */
export class KitPart {
  readonly group = new THREE.Group();
  private readonly body: THREE.Object3D;

  constructor(t: KitTemplates, kind: 'f' | 'b') {
    this.body = (kind === 'b' ? t.boom : t.frame).clone(true);
    if (kind === 'b') {
      poseBoom(this.body, FOLDED);
      // On its side, then stood on its lowest point and centered, like a part on a deck.
      this.body.rotation.x = Math.PI / 2;
      this.body.scale.setScalar(LOOSE_BOOM_SCALE);
      this.body.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.body);
      const c = box.getCenter(new THREE.Vector3());
      this.body.position.set(-c.x, -box.min.y, -c.z);
    }
    this.group.add(this.body);
  }

  paint(material: THREE.Material): void {
    repaint(this.body, material);
  }
}

/** How far each piece stands over its seat, per unit of fitting left to do. */
const DROP = { house: 2.6, cab: 3.0, boom: 1.9 } as const;

export interface MachinePose {
  /** 0..1 fittings. Below 1 the piece is still on its way down; at 0 it is not there. */
  engine?: number;
  cab?: number;
  boom?: number;
  /** The boom's own angles, over and above the pinning swing. */
  arm?: BoomPose;
}

/** A whole machine, at whatever stage of its build it has reached. */
export class KitMachine {
  readonly group = new THREE.Group();
  private readonly frame: THREE.Object3D;
  private readonly house: THREE.Object3D;
  private readonly cab: THREE.Object3D;
  private readonly boom: THREE.Object3D;

  constructor(private readonly t: KitTemplates) {
    this.frame = t.frame.clone(true);
    this.house = t.house.clone(true);
    this.cab = t.cab.clone(true);
    this.boom = t.boom.clone(true);
    this.group.add(this.frame, this.house, this.cab, this.boom);
  }

  paint(body: THREE.Material, boom: THREE.Material = body): void {
    repaint(this.frame, body);
    repaint(this.house, body);
    repaint(this.cab, body);
    repaint(this.boom, boom);
  }

  pose(p: MachinePose): void {
    const { slew, cabSeat, boomFoot } = this.t;
    const engine = p.engine ?? 1;
    const cab = p.cab ?? 1;
    const boom = p.boom ?? 1;
    this.house.visible = engine > 0;
    this.house.position.set(slew.x, slew.y + (1 - engine) * DROP.house, slew.z);
    this.cab.visible = cab > 0;
    this.cab.position.set(slew.x + cabSeat.x, slew.y + cabSeat.y + (1 - cab) * DROP.cab, slew.z + cabSeat.z);
    this.boom.visible = boom > 0;
    // Un-pinned, the boom hangs above and tilted back, so pinning reads as the arm coming down onto its eye.
    this.boom.position.set(slew.x + boomFoot.x, slew.y + boomFoot.y + (1 - boom) * DROP.boom, slew.z + boomFoot.z);
    this.boom.rotation.z = (1 - boom) * 0.7;
    poseBoom(this.boom, p.arm ?? {});
  }
}
