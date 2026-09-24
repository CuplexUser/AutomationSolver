import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DEPOT_BAYS,
  DOOR_MS,
  MAX_FLEET,
  TRUCK_GAP_MS,
  WRAP_MS,
  ZONE_MS,
  builtLocations,
  parsePallet,
  type MachineState,
} from '@automationsolver/shared';
import { enableShadows } from '../MachineCanvas';
import {
  BAY_M,
  DEPOT_NAMES,
  HALL,
  NORTH_BACK_Z,
  NORTH_DOCK_Z,
  NORTH_STEP_X,
  TRUCK_M,
  WALL_H,
  WEST_WALL_X,
  YARD,
  aisleLines,
  aisleSurfaces,
  apron,
  bayFrameAt,
  laneArrows,
  routeAhead,
  signText,
  stationBays,
  stationYaw,
  stationsFor,
  vehiclePose,
  wallSegments,
  type FloorRect,
  type StationDef,
} from './layout';

/**
 * The hub, built once from the kit (`dc-kit.glb`) and posed every frame from the
 * plant's state.
 *
 * Nothing here keeps a clock of its own except the beacons' flash: vehicles,
 * doors, trucks, the turntable, every pallet and every planned route are drawn
 * from `machine`, so a replay draws exactly what the live run drew. The kit's
 * roots are cloned by name and put where `layout.ts` says the plant has them.
 *
 * The look is a cold store's, not the excavator plant's: a grey epoxy floor,
 * blue markings, pale grey insulated panels and a cool light, with the
 * forklifts the one warm color on the floor. Every location's code is painted
 * on the floor in front of it, so no label can hang in front of another.
 *
 * Pallets are drawn from the plant's **true** tokens, not from anything the
 * player's program believes. A lane the program thinks holds tomatoes and that
 * actually holds potatoes looks like potatoes, which is the point.
 */

const num = (m: MachineState, k: string, d = 0): number => (typeof m[k] === 'number' ? (m[k] as number) : d);
const str = (m: MachineState, k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '');
const list = (s: string): string[] => (s === '' ? [] : s.split(','));

/** Label stripe colors: the dock a pallet was labeled for. */
const DOCK_COLOR: Record<number, string> = { 1: '#2563eb', 2: '#ea580c' };

/** Each vehicle's own color: its roof panel and the route it is driving. */
export const VEHICLE_COLORS = ['#2563eb', '#16a34a', '#a21caf'];

/**
 * The floor's palette: a mid-grey epoxy slab with darker drive lanes, so the
 * markings, the pallets and every shadow read against it. Nothing on the floor is
 * pure white; under the hall's key light a near-white surface simply blows out.
 */
const FLOOR = {
  slab: '#9aa3ab',
  yard: '#474d55',
  aisle: '#828c96',
  edge: '#1d56b8',
  dash: '#c3cad1',
  arrow: '#2f6fd8',
  apron: '#a7b8ca',
  bay: '#18a07e',
  plate: '#1d4ed8',
  plateText: '#e4e9ee',
};

// --- lamps ------------------------------------------------------------------------

interface Lamp {
  mat: THREE.MeshStandardMaterial;
  off: string;
}

/** Gives a lens its own material, so each station's lamp lights on its own. */
function lamp(obj: THREE.Object3D | undefined, off: string): Lamp | undefined {
  const mesh = obj as THREE.Mesh | undefined;
  const base = mesh?.material as THREE.MeshStandardMaterial | undefined;
  if (!mesh || !base) return undefined;
  const mat = base.clone();
  mesh.material = mat;
  return { mat, off };
}

function light(l: Lamp | undefined, color: string | null): void {
  if (!l) return;
  l.mat.color.set(color ?? l.off);
  l.mat.emissive.set(color ?? l.off);
  l.mat.emissiveIntensity = color ? 1.3 : 0.15;
}

// --- static batching ---------------------------------------------------------------------

/**
 * Bakes meshes that never move into one mesh per material.
 *
 * The hall's paint, walls and columns were two hundred of the scene's four
 * hundred draw calls, and every frame draws the scene three times (the shadow
 * map, the occlusion pass's normals and the image itself). None of it moves, so
 * each material's pieces are transformed into place once and drawn as one.
 * `parts` must not be parented yet: their own transforms are the placement.
 */
function mergeByMaterial(parts: THREE.Object3D[], cast: boolean): THREE.Object3D[] {
  const buckets = new Map<THREE.Material, { geo: THREE.BufferGeometry; src: THREE.Mesh }[]>();
  for (const part of parts) {
    part.updateMatrixWorld(true);
    part.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const list = buckets.get(mesh.material) ?? [];
      list.push({ geo, src: mesh });
      buckets.set(mesh.material, list);
    });
  }
  const out: THREE.Object3D[] = [];
  for (const [material, items] of buckets) {
    // Only the attributes every piece has, all indexed or none, or the merge refuses.
    const names = Object.keys(items[0].geo.attributes).filter((n) => items.every((i) => i.geo.getAttribute(n)));
    const indexed = items.every((i) => i.geo.index);
    const geos = items.map(({ geo }) => {
      const g = indexed || !geo.index ? geo : geo.toNonIndexed();
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
      return g;
    });
    const merged = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    if (merged && geos.length > 1) for (const g of geos) g.dispose();
    // Already in place, so a bucket that would not merge is drawn piece by piece.
    for (const geo of merged ? [merged] : geos) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.userData.own = true;
      out.push(mesh);
    }
    // The plant's own source pieces are spent; the kit's are shared with the cached model.
    for (const { src } of items) if (src.userData.own) src.geometry.dispose();
  }
  return out;
}

// --- floor paint ------------------------------------------------------------------------

/**
 * Floor paint sits on the slab in layers a centimeter apart and pushed toward the
 * camera in the depth buffer as well: two coplanar surfaces flicker, and a few
 * millimeters is not enough apart at the distance the whole floor is seen from.
 */
const LAYER = { yard: 0, aisle: 0.01, apron: 0.012, line: 0.02, plate: 0.024 } as const;

function paint(color: string, layer: number, rough = 0.5): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1 - layer * 100;
  m.polygonOffsetUnits = -1 - layer * 100;
  return m;
}

function floorRect(r: FloorRect, material: THREE.Material, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(r.x, y, r.z);
  mesh.receiveShadow = true;
  mesh.userData.own = true;
  return mesh;
}

/**
 * A location's code painted on the floor: white on a blue plate, reading the
 * right way up from the south, where the camera starts. Painted into a canvas
 * rather than set in a font file, the way the other plant scenes do it.
 */
function floorPlate(text: string, maxW: number, owned: THREE.Material[]): THREE.Mesh {
  const h = 0.42;
  const w = Math.min(maxW, Math.max(0.7, 0.19 * text.length + 0.2));
  const px = 256;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((px * w) / h);
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = FLOOR.plate;
    ctx.beginPath();
    ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 36);
    ctx.fill();
    ctx.fillStyle = FLOOR.plateText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 150;
    ctx.font = `bold ${size}px "JetBrains Mono", ui-monospace, monospace`;
    while (size > 40 && ctx.measureText(text).width > canvas.width - 50) {
      size -= 6;
      ctx.font = `bold ${size}px "JetBrains Mono", ui-monospace, monospace`;
    }
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = paint('#e6e9ec', LAYER.plate, 0.6);
  mat.map = tex;
  mat.transparent = true;
  owned.push(mat);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.own = true;
  return mesh;
}

/** The slab, the yard, the aisles and their markings, every apron and its code, and the parking bays. */
function buildFloor(group: THREE.Group, stations: StationDef[], owned: THREE.Material[]): void {
  const slab = new THREE.MeshStandardMaterial({ color: FLOOR.slab, roughness: 0.42, metalness: 0.05 });
  const yard = paint(FLOOR.yard, LAYER.yard, 0.9);
  const aisle = paint(FLOOR.aisle, LAYER.aisle, 0.4);
  const edge = paint(FLOOR.edge, LAYER.line, 0.45);
  const dash = paint(FLOOR.dash, LAYER.line, 0.5);
  const arrow = paint(FLOOR.arrow, LAYER.line, 0.45);
  const apronMat = paint(FLOOR.apron, LAYER.apron, 0.4);
  const bayLine = paint(FLOOR.bay, LAYER.line, 0.5);
  owned.push(slab, yard, aisle, edge, dash, arrow, apronMat, bayLine);

  // Every flat piece of paint, merged per material at the end; the plates keep
  // their own meshes, since each carries its own painted texture.
  const flat: THREE.Object3D[] = [];
  const [hx0, hx1] = HALL.x;
  const [hz0, hz1] = HALL.z;
  flat.push(floorRect({ x: (hx0 + hx1) / 2, z: (hz0 + hz1) / 2, w: hx1 - hx0, d: hz1 - hz0 }, slab, 0));
  flat.push(
    floorRect(
      { x: (YARD.x[0] + YARD.x[1]) / 2, z: (YARD.z[0] + YARD.z[1]) / 2, w: YARD.x[1] - YARD.x[0], d: YARD.z[1] - YARD.z[0] },
      yard,
      -0.01,
    ),
  );

  for (const r of aisleSurfaces()) flat.push(floorRect(r, aisle, LAYER.aisle));
  const lines = aisleLines();
  for (const r of lines.edges) flat.push(floorRect(r, edge, LAYER.line));
  for (const r of lines.dashes) flat.push(floorRect(r, dash, LAYER.line));

  const shape = new THREE.Shape();
  shape.moveTo(0.32, 0);
  shape.lineTo(-0.22, 0.26);
  shape.lineTo(-0.08, 0);
  shape.lineTo(-0.22, -0.26);
  shape.closePath();
  const chevron = new THREE.ShapeGeometry(shape);
  for (const a of laneArrows()) {
    const mesh = new THREE.Mesh(chevron, arrow);
    mesh.rotation.x = -Math.PI / 2;
    // Plan headings turn toward +z (south); a shape's +x turned by -heading about the floor's normal.
    mesh.rotation.z = -a.heading;
    mesh.position.set(a.x, LAYER.line, a.z);
    flat.push(mesh);
  }

  // Aprons, and each location's code painted on its own.
  for (const b of stationBays(stations)) {
    const a = apron(b.bay, b.width - 0.1, b.depth);
    flat.push(floorRect(a.rect, apronMat, LAYER.apron));
    // Codes read along x. An apron too narrow that way (a bay off a north-south
    // aisle) gets its code on the floor just beyond the station instead.
    const fits = a.rect.w >= 1.0;
    const plate = floorPlate(signText(b.code), fits ? a.rect.w - 0.08 : 1.8, owned);
    const at = fits ? { x: a.center[0], z: a.center[1] } : bayFrameAt(b.bay, b.reach + 0.6);
    plate.position.set(at.x, LAYER.plate, at.z);
    group.add(plate);
  }

  // Parking bays: an outline each, open to the aisle, and its name beyond it.
  DEPOT_BAYS.forEach((bay, i) => {
    const f = bayFrameAt(bay, BAY_M + 0.1);
    const across = Math.abs(f.dir[0]) > 0.5;
    const bw = 1.1;
    const bd = 1.8;
    const sides: FloorRect[] = across
      ? [
          { x: f.x, z: f.z - bw / 2, w: bd, d: 0.06 },
          { x: f.x, z: f.z + bw / 2, w: bd, d: 0.06 },
          { x: f.x + (f.dir[0] * bd) / 2, z: f.z, w: 0.06, d: bw },
        ]
      : [
          { x: f.x - bw / 2, z: f.z, w: 0.06, d: bd },
          { x: f.x + bw / 2, z: f.z, w: 0.06, d: bd },
          { x: f.x, z: f.z + (f.dir[1] * bd) / 2, w: bw, d: 0.06 },
        ];
    for (const r of sides) flat.push(floorRect(r, bayLine, LAYER.line));
    const tag = bayFrameAt(bay, BAY_M + 1.55);
    const plate = floorPlate(DEPOT_NAMES[i], 0.8, owned);
    plate.position.set(tag.x, LAYER.plate, tag.z);
    group.add(plate);
  });
  for (const m of mergeByMaterial(flat, false)) group.add(m);
  chevron.dispose();
}

// --- pallets ------------------------------------------------------------------------

type LoadName =
  | 'Load_Bananas'
  | 'Load_BananasGreen'
  | 'Load_Avocados'
  | 'Load_AvocadosGreen'
  | 'Load_Tomatoes'
  | 'Load_Potatoes';

function loadFor(token: string): LoadName {
  const p = parsePallet(token);
  switch (p.product) {
    case 1:
      return p.ripe === 'g' ? 'Load_BananasGreen' : 'Load_Bananas';
    case 2:
      return p.ripe === 'g' ? 'Load_AvocadosGreen' : 'Load_Avocados';
    case 3:
      return 'Load_Tomatoes';
    default:
      return 'Load_Potatoes';
  }
}

/** A template root from the kit, copied and put back at its own origin. */
function cloneRoot(kit: THREE.Object3D, name: string): THREE.Object3D {
  const src = kit.getObjectByName(name);
  const copy = src ? src.clone(true) : new THREE.Group();
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  enableShadows(copy);
  return copy;
}

/** One pallet and whatever might be on it, each piece made the first time it is needed. */
class Stack {
  readonly group = new THREE.Group();
  private readonly loads = new Map<LoadName, THREE.Object3D>();
  private wrap?: THREE.Object3D;
  private label?: THREE.Object3D;
  private stripe?: THREE.MeshStandardMaterial;
  private token = '';
  private wrapped = false;

  constructor(private readonly kit: THREE.Object3D) {
    this.group.add(cloneRoot(kit, 'Pallet'));
  }

  show(token: string, wrapped: boolean): void {
    if (token === this.token && wrapped === this.wrapped) return;
    this.token = token;
    this.wrapped = wrapped;
    const want = loadFor(token);
    if (!this.loads.has(want)) {
      const load = cloneRoot(this.kit, want);
      this.loads.set(want, load);
      this.group.add(load);
    }
    for (const [name, obj] of this.loads) obj.visible = name === want;
    const labelFor = parsePallet(token).label;
    if (wrapped || labelFor > 0) {
      if (!this.wrap) {
        this.wrap = cloneRoot(this.kit, 'LoadWrap');
        this.group.add(this.wrap);
      }
      this.wrap.visible = true;
    } else if (this.wrap) {
      this.wrap.visible = false;
    }
    if (labelFor > 0) {
      if (!this.label) {
        this.label = cloneRoot(this.kit, 'LoadLabel');
        const mesh = this.label.getObjectByName('LoadLabelStripe') as THREE.Mesh | undefined;
        if (mesh) {
          this.stripe = (mesh.material as THREE.MeshStandardMaterial).clone();
          mesh.material = this.stripe;
        }
        this.group.add(this.label);
      }
      this.label.visible = true;
      this.stripe?.color.set(DOCK_COLOR[labelFor] ?? '#6b7280');
    } else if (this.label) {
      this.label.visible = false;
    }
  }
}

/**
 * Pallets handed out afresh every frame: `place` parents the next free stack to a
 * slot, and `end` hides whatever was not asked for. Stacks are reused, never
 * rebuilt, so a pallet moving from a lane to a fork costs one reparent.
 */
class PalletPool {
  private readonly stacks: Stack[] = [];
  private used = 0;

  constructor(private readonly kit: THREE.Object3D) {}

  begin(): void {
    this.used = 0;
  }

  place(anchor: THREE.Object3D | undefined, token: string, wrapped = false): void {
    if (!anchor || token === '') return;
    let stack = this.stacks[this.used];
    if (!stack) {
      stack = new Stack(this.kit);
      this.stacks.push(stack);
    }
    this.used++;
    if (stack.group.parent !== anchor) anchor.add(stack.group);
    stack.group.visible = true;
    stack.show(token, wrapped);
  }

  end(): void {
    for (let i = this.used; i < this.stacks.length; i++) this.stacks[i].group.visible = false;
  }
}

// --- the plant ------------------------------------------------------------------------

interface Station {
  def: StationDef;
  root: THREE.Object3D;
  slots: (THREE.Object3D | undefined)[];
  lamps: Record<string, Lamp | undefined>;
  parts: Record<string, THREE.Object3D | undefined>;
  truck?: THREE.Object3D;
  truckBase?: THREE.Vector3;
}

interface Vehicle {
  root: THREE.Object3D;
  forks?: THREE.Object3D;
  anchor?: THREE.Object3D;
  beacon?: Lamp;
  path: THREE.Line;
  positions: Float32Array;
}

export interface HubPlant {
  group: THREE.Group;
  stations: StationDef[];
  /**
   * Draws `m`. With `blend`, the vehicles are drawn `f` of the way toward where
   * they are in `next`, so a replay played faster than the scan rate still glides.
   */
  pose: (m: MachineState, dt: number, blend?: { next: MachineState; f: number }) => void;
  dispose: () => void;
}

/** How far a truck drives off across the yard before it is out of sight. */
const TRUCK_LEAVES_M = 18;
/** Most points a planned route is drawn with. */
const PATH_POINTS = 256;

/**
 * The two walls the camera looks toward, with the dock doors a puzzle built cut
 * into them: west for the trucks, and north for the goods-in doors, stepping back
 * behind QA to clear quarantine and the rooms. East and south stay open so the
 * floor can be seen; columns along the walls say the hall carries on.
 */
function buildWalls(group: THREE.Group, kit: THREE.Object3D, stations: StationDef[]): void {
  const parts: THREE.Object3D[] = [];
  const panel = (at: [number, number], yaw: number, width: number) => {
    const p = cloneRoot(kit, 'WallPanel');
    p.scale.set(width / 3, WALL_H / 7, 1);
    p.position.set(at[0], 0, at[1]);
    p.rotation.y = yaw;
    parts.push(p);
  };
  const run = (from: number, to: number, openings: [number, number][], place: (mid: number, w: number) => void) => {
    for (const [a, b] of wallSegments(from, to, openings)) {
      const n = Math.max(1, Math.round((b - a) / 3));
      const w = (b - a) / n;
      for (let i = 0; i < n; i++) place(a + w * (i + 0.5), w);
    }
  };
  // West: panels face east into the hall. Outbound docks are 2.9 m wide.
  const west = stations.filter((s) => s.loc.kind === 'dock-out').map((s): [number, number] => [s.frame.z - 1.45, s.frame.z + 1.45]);
  run(NORTH_DOCK_Z, HALL.z[1], west, (z, w) => panel([WEST_WALL_X, z], Math.PI / 2, w));
  // North, flush with the goods-in doors (1.9 m wide) as far as the step.
  const north = stations.filter((s) => s.loc.kind === 'dock-in').map((s): [number, number] => [s.frame.x - 0.95, s.frame.x + 0.95]);
  run(WEST_WALL_X, NORTH_STEP_X, north, (x, w) => panel([x, NORTH_DOCK_Z], 0, w));
  // The step back, and the north wall behind quarantine and the rooms.
  run(NORTH_BACK_Z, NORTH_DOCK_Z, [], (z, w) => panel([NORTH_STEP_X, z], -Math.PI / 2, w));
  run(NORTH_STEP_X, HALL.x[1], [], (x, w) => panel([x, NORTH_BACK_Z], 0, w));

  for (let x = NORTH_STEP_X + 3; x <= HALL.x[1]; x += 6) {
    const c = cloneRoot(kit, 'Column');
    c.position.set(x, 0, NORTH_BACK_Z + 0.3);
    parts.push(c);
  }
  for (let z = 12; z <= HALL.z[1]; z += 6) {
    const c = cloneRoot(kit, 'Column');
    c.position.set(WEST_WALL_X + 0.3, 0, z);
    parts.push(c);
  }
  for (const m of mergeByMaterial(parts, true)) group.add(m);
}

function buildStation(kit: THREE.Object3D, def: StationDef, group: THREE.Group): Station {
  const root = cloneRoot(kit, def.asset);
  root.position.set(def.frame.x, 0, def.frame.z);
  root.rotation.y = stationYaw(def.frame.dir);
  group.add(root);
  const find = (name: string) => root.getObjectByName(name) ?? undefined;
  const st: Station = {
    def,
    root,
    slots: def.slots.map((n) => find(n)),
    lamps: {},
    parts: {},
  };
  switch (def.loc.kind) {
    case 'qa':
      st.lamps.pass = lamp(find('QaLampPass'), '#0a2a14');
      st.lamps.busy = lamp(find('QaLampBusy'), '#3a2a00');
      st.lamps.fail = lamp(find('QaLampFail'), '#3a0a0a');
      break;
    case 'room': {
      st.lamps.room = lamp(find('RoomLamp'), '#0a2a14');
      st.parts.door = find('RoomDoor');
      // The roof comes off, so the batch inside can be seen from above.
      const roof = find('RoomRoof');
      if (roof) roof.visible = false;
      break;
    }
    case 'dock-in':
      st.parts.shutter = find('DockInShutter');
      break;
    case 'dock-out': {
      st.parts.shutter = find('DockOutShutter');
      st.lamps.red = lamp(find('DockOutLampRed'), '#3a0a0a');
      st.lamps.green = lamp(find('DockOutLampGreen'), '#0a2a14');
      // The truck backs onto the wall's outer face, facing the same way as the dock.
      const truck = cloneRoot(kit, 'Truck');
      const base = new THREE.Vector3(
        def.frame.x + def.frame.dir[0] * TRUCK_M,
        0,
        def.frame.z + def.frame.dir[1] * TRUCK_M,
      );
      truck.position.copy(base);
      truck.rotation.y = stationYaw(def.frame.dir);
      // Roof off, as for the rooms: the order the trailer is loaded in is the capstone's lesson.
      const roof = truck.getObjectByName('TruckRoof');
      if (roof) roof.visible = false;
      group.add(truck);
      st.truck = truck;
      st.truckBase = base;
      st.slots = def.slots.map((n) => truck.getObjectByName(n) ?? undefined);
      break;
    }
    case 'wrap-in':
      st.parts.table = find('WrapTurntable');
      st.parts.carriage = find('WrapCarriage');
      st.lamps.labeler = lamp(find('LabelerLamp'), '#3a2a00');
      break;
    case 'charger':
      st.lamps.charger = lamp(find('ChargerLamp'), '#0a1e3a');
      break;
    default:
      break;
  }
  return st;
}

export function buildHubPlant(kit: THREE.Object3D, locs: string, fleet: number): HubPlant {
  const group = new THREE.Group();
  const owned: THREE.Material[] = [];
  const built = builtLocations({ locs });
  const defs = stationsFor(built);

  buildFloor(group, defs, owned);
  buildWalls(group, kit, defs);
  const stations = defs.map((d) => buildStation(kit, d, group));

  const vehicles: Vehicle[] = [];
  for (let i = 0; i < Math.min(MAX_FLEET, Math.max(1, fleet)); i++) {
    const root = cloneRoot(kit, 'AGV');
    group.add(root);
    // Each vehicle's roof panel in its own color, the color its route is drawn in.
    const top = root.getObjectByName('AgvTopPanel') as THREE.Mesh | undefined;
    if (top) {
      const m = (top.material as THREE.MeshStandardMaterial).clone();
      m.color.set(VEHICLE_COLORS[i]);
      top.material = m;
      owned.push(m);
    }
    const positions = new Float32Array(PATH_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const pathMat = new THREE.LineBasicMaterial({ color: VEHICLE_COLORS[i], transparent: true, opacity: 0.85 });
    owned.push(pathMat);
    const path = new THREE.Line(geo, pathMat);
    path.frustumCulled = false;
    path.userData.own = true;
    group.add(path);
    vehicles.push({
      root,
      forks: root.getObjectByName('AgvForks') ?? undefined,
      anchor: root.getObjectByName('AgvPalletAnchor') ?? undefined,
      beacon: lamp(root.getObjectByName('AgvBeacon') ?? undefined, '#3a2a00'),
      path,
      positions,
    });
  }

  const pool = new PalletPool(kit);
  let flash = 0;

  const pose = (m: MachineState, dt: number, blend?: { next: MachineState; f: number }) => {
    // Clamped, for the same reason as the camera's: a frame after an idle spell.
    flash = (flash + Math.min(dt, 0.1)) % 0.8;
    const blink = flash < 0.4;
    pool.begin();

    vehicles.forEach((v, i) => {
      const p = vehiclePose(m, i);
      v.root.visible = p.visible;
      v.path.visible = p.visible;
      if (!p.visible) return;
      let { x, z, yaw, lift } = p;
      if (blend && blend.f > 0) {
        const q = vehiclePose(blend.next, i);
        // Only a glide within one scan's travel; a jump (a vehicle appearing) stays a jump.
        if (q.visible && Math.hypot(q.x - x, q.z - z) < 0.5) {
          const f = blend.f;
          x += (q.x - x) * f;
          z += (q.z - z) * f;
          lift += (q.lift - lift) * f;
          yaw += Math.atan2(Math.sin(q.yaw - yaw), Math.cos(q.yaw - yaw)) * f;
        }
      }
      v.root.position.set(x, 0, z);
      v.root.rotation.y = yaw;
      if (v.forks) v.forks.position.y = lift;
      light(
        v.beacon,
        p.mode === 'charging' ? '#3b82f6' : p.mode === 'stuck' ? (blink ? '#ef4444' : null) : p.mode === 'moving' && blink ? '#f59e0b' : null,
      );
      pool.place(v.anchor, str(m, `v${i}Load`));
      // The route the fleet manager planned, from here to the bay it is going to.
      const pts = routeAhead(m, i);
      const n = Math.min(PATH_POINTS, pts.length);
      for (let k = 0; k < n; k++) {
        v.positions[k * 3] = pts[k][0];
        v.positions[k * 3 + 1] = 0.06;
        v.positions[k * 3 + 2] = pts[k][1];
      }
      const geo = v.path.geometry;
      geo.setDrawRange(0, n);
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    });

    for (const st of stations) {
      const code = st.def.code;
      const items = list(str(m, `c${code}`));
      switch (st.def.loc.kind) {
        case 'qa': {
          pool.place(st.slots[0], items[0] ?? '');
          const qa = items.length > 0 ? parsePallet(items[0]).qa : '';
          light(st.lamps.busy, qa === 'P' || qa === 'F' ? '#f59e0b' : null);
          light(st.lamps.pass, qa === 'p' ? '#22c55e' : null);
          light(st.lamps.fail, qa === 'f' ? '#ef4444' : null);
          break;
        }
        case 'room': {
          const r = code === 21 ? 1 : 2;
          items.forEach((t, k) => pool.place(st.slots[k], t));
          // Scale in three's Y is the curtain's height: 1 shut, a sliver open.
          if (st.parts.door) st.parts.door.scale.y = Math.max(0.04, 1 - num(m, `r${r}Door`) / DOOR_MS);
          const running = m[`r${r}Run`] === true;
          const ripe = m[`r${r}Done`] === true && items.length > 0;
          light(st.lamps.room, running ? '#f59e0b' : ripe ? '#22c55e' : null);
          break;
        }
        case 'dock-in': {
          items.forEach((t, k) => pool.place(st.slots[k], t));
          const more = str(m, `in${code}`) !== '' || items.length > 0;
          if (st.parts.shutter) st.parts.shutter.scale.y = more ? 0.04 : 1;
          break;
        }
        case 'dock-out': {
          const state = str(m, `t${code}`);
          const here = state === 'docked' || state === 'open';
          // A truck leaves over the first half of the yard turnaround and the next
          // backs in over the second; the first truck of the day only arrives.
          let away = 0;
          let shown = here;
          if (state === 'away') {
            const t = num(m, `t${code}T`);
            const leaving = t > TRUCK_GAP_MS / 2 && str(m, `o${code}`) !== '';
            away = leaving
              ? ((TRUCK_GAP_MS - t) / (TRUCK_GAP_MS / 2)) * TRUCK_LEAVES_M
              : (t / (TRUCK_GAP_MS / 2)) * TRUCK_LEAVES_M;
            shown = leaving || t <= TRUCK_GAP_MS / 2;
          }
          if (st.truck && st.truckBase) {
            st.truck.visible = shown;
            st.truck.position.set(
              st.truckBase.x + st.def.frame.dir[0] * away,
              0,
              st.truckBase.z + st.def.frame.dir[1] * away,
            );
          }
          if (here || (state === 'away' && away < TRUCK_LEAVES_M)) {
            // The dock keeps its last four; a longer order shows its last four at their own slots.
            const loaded = state === 'open' ? items.length : num(m, `k${code}`);
            const first = Math.max(0, loaded - items.length);
            items.forEach((t, k) => pool.place(st.slots[first + k], t, true));
          }
          if (st.parts.shutter) st.parts.shutter.scale.y = here ? 0.04 : 1;
          light(st.lamps.green, here ? '#22c55e' : null);
          light(st.lamps.red, here ? null : '#ef4444');
          break;
        }
        case 'wrap-in': {
          for (let k = 0; k <= 5; k++) pool.place(st.slots[k], str(m, `w${k}`), k >= 4);
          const wrapping = str(m, 'w3') !== '' && num(m, 'wt3') < WRAP_MS;
          const phase = wrapping ? num(m, 'wt3') / WRAP_MS : 0;
          if (st.parts.table) st.parts.table.rotation.y = phase * Math.PI * 6;
          if (st.parts.carriage) st.parts.carriage.position.y = 0.6 + (0.8 * (1 - Math.cos(phase * Math.PI * 2))) / 2;
          const atLabeler = str(m, 'w4') !== '' && num(m, 'wt4') >= ZONE_MS && parsePallet(str(m, 'w4')).label === 0;
          light(st.lamps.labeler, atLabeler ? '#f59e0b' : null);
          break;
        }
        case 'charger': {
          const charging = vehicles.some((_, i) => str(m, `v${i}S`) === 'charge');
          light(st.lamps.charger, charging ? '#3b82f6' : null);
          break;
        }
        default:
          // Lanes, rooms and quarantine list their pallets in slot order already:
          // a flow lane front first, a drive-in lane and a room from the back.
          items.forEach((t, k) => pool.place(st.slots[k], t));
      }
    }
    pool.end();
  };

  const dispose = () => {
    // Only what this scene made: the kit's clones share their geometry with the cached model.
    group.traverse((obj) => {
      if (obj.userData.own) (obj as THREE.Mesh).geometry.dispose();
    });
    for (const m of owned) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  };

  return { group, stations: defs, pose, dispose };
}
