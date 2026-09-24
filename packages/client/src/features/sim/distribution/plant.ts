import * as THREE from 'three';
import {
  DEPOT_STOPS,
  DOOR_MS,
  LOOP_CORNERS,
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
  HALL,
  NORTH_DOCK_Z,
  NORTH_STEP_X,
  TRUCK_M,
  VEHICLE_POCKET_M,
  WALL_H,
  YARD,
  pocketFrame,
  signText,
  stationYaw,
  stationsFor,
  vehiclePose,
  wallSegments,
  type StationDef,
} from './layout';

/**
 * The hub, built once from the kit (`dc-kit.glb`) and posed every frame from the
 * plant's state.
 *
 * Nothing here keeps a clock of its own except the beacons' flash: vehicles,
 * doors, trucks, the turntable and every pallet are placed from `machine`, so a
 * replay draws exactly what the live run drew. The kit's roots are cloned by
 * name and put where `layout.ts` says the plant has them.
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

// --- signs ------------------------------------------------------------------------

/**
 * A location's name and code over it, the numbers a program uses. Painted into a
 * canvas rather than set in a font file, the way the other plant scenes do it.
 */
function sign(text: string): THREE.Sprite {
  const w = 512;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 64px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.9, 0.475, 1);
  return sprite;
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
}

export interface HubPlant {
  group: THREE.Group;
  stations: StationDef[];
  pose: (m: MachineState, dt: number) => void;
  dispose: () => void;
}

function mat(color: string, rough = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

/** A flat rectangle on the floor, centered on (x, z), a hair above the slab so it never flickers. */
function floorRect(w: number, d: number, x: number, z: number, material: THREE.Material, y = 0.004): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

/** The slab, the yard, and the loop painted on the floor with its direction of travel. */
function buildFloor(group: THREE.Group, owned: THREE.Material[]): void {
  const slab = mat('#59616b');
  const yard = mat('#2f343b');
  const lane = mat('#434a54');
  const edge = mat('#e5b913', 0.6);
  const arrow = mat('#cbd5e1', 0.6);
  owned.push(slab, yard, lane, edge, arrow);

  const [hx0, hx1] = HALL.x;
  const [hz0, hz1] = HALL.z;
  group.add(floorRect(hx1 - hx0, hz1 - hz0, (hx0 + hx1) / 2, (hz0 + hz1) / 2, slab, 0));
  group.add(floorRect(YARD.x[1] - YARD.x[0], YARD.z[1] - YARD.z[0], (YARD.x[0] + YARD.x[1]) / 2, (YARD.z[0] + YARD.z[1]) / 2, yard, 0));

  // The loop: four legs, 1.3 m wide, yellow edges, a chevron every four meters.
  const W = 1.3;
  const corners = LOOP_CORNERS.map(([x, y]) => [x / 1000, y / 1000] as [number, number]);
  for (let i = 0; i < corners.length; i++) {
    const [x0, z0] = corners[i];
    const [x1, z1] = corners[(i + 1) % corners.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const horizontal = z0 === z1;
    const w = horizontal ? len + W : W;
    const d = horizontal ? W : len + W;
    group.add(floorRect(w, d, (x0 + x1) / 2, (z0 + z1) / 2, lane, 0.003));
    for (const side of [-1, 1]) {
      const off = (side * W) / 2;
      group.add(
        floorRect(
          horizontal ? len + W : 0.06,
          horizontal ? 0.06 : len + W,
          (x0 + x1) / 2 + (horizontal ? 0 : off),
          (z0 + z1) / 2 + (horizontal ? off : 0),
          edge,
          0.005,
        ),
      );
    }
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const shape = new THREE.Shape();
    shape.moveTo(0.35, 0);
    shape.lineTo(-0.25, 0.3);
    shape.lineTo(-0.1, 0);
    shape.lineTo(-0.25, -0.3);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    for (let s = 2; s < len - 1; s += 4) {
      const chevron = new THREE.Mesh(geo, arrow);
      chevron.rotation.x = -Math.PI / 2;
      chevron.rotation.z = Math.atan2(-dz, dx);
      chevron.position.set(x0 + dx * s, 0.006, z0 + dz * s);
      group.add(chevron);
    }
  }

  // Parking bays south of the loop: one outline per vehicle.
  for (const stop of DEPOT_STOPS) {
    const f = pocketFrame(stop, 'out', VEHICLE_POCKET_M);
    const bw = 1.05;
    const bd = 1.8;
    for (const [w, d, ox, oz] of [
      [bw, 0.06, 0, -bd / 2],
      [bw, 0.06, 0, bd / 2],
      [0.06, bd, -bw / 2, 0],
      [0.06, bd, bw / 2, 0],
    ] as [number, number, number, number][]) {
      group.add(floorRect(w, d, f.x + ox, f.z + oz, edge, 0.005));
    }
  }
}

/**
 * The two walls the camera looks toward, with the dock doors a puzzle built cut
 * into them: west for the trucks, north for the goods-in doors and, stepped back
 * behind the rooms, the rest of the north side. East and south stay open so the
 * floor can be seen; a row of columns says the hall carries on.
 */
function buildWalls(group: THREE.Group, kit: THREE.Object3D, stations: StationDef[]): void {
  const panel = (at: [number, number], yaw: number, width: number) => {
    const p = cloneRoot(kit, 'WallPanel');
    p.scale.set(width / 3, WALL_H / 7, 1);
    p.position.set(at[0], 0, at[1]);
    p.rotation.y = yaw;
    group.add(p);
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
  const wx = HALL.x[0] + 0.25;
  run(NORTH_DOCK_Z, HALL.z[1], west, (z, w) => panel([wx, z], Math.PI / 2, w));
  // North, flush with the goods-in doors (1.9 m wide) as far as the step.
  const north = stations.filter((s) => s.loc.kind === 'dock-in').map((s): [number, number] => [s.frame.x - 0.95, s.frame.x + 0.95]);
  run(HALL.x[0], NORTH_STEP_X, north, (x, w) => panel([x, NORTH_DOCK_Z], 0, w));
  // The step back, and the north wall behind the rooms.
  run(HALL.z[0], NORTH_DOCK_Z, [], (z, w) => panel([NORTH_STEP_X, z], -Math.PI / 2, w));
  run(NORTH_STEP_X, HALL.x[1], [], (x, w) => panel([x, HALL.z[0]], 0, w));

  for (let x = NORTH_STEP_X + 6; x <= HALL.x[1]; x += 6) {
    const c = cloneRoot(kit, 'Column');
    c.position.set(x, 0, HALL.z[0] + 0.2);
    group.add(c);
  }
  for (let z = HALL.z[0] + 6; z <= HALL.z[1]; z += 6) {
    const c = cloneRoot(kit, 'Column');
    c.position.set(HALL.x[1], 0, z);
    group.add(c);
  }
  for (let x = HALL.x[0] + 6; x < HALL.x[1]; x += 6) {
    const c = cloneRoot(kit, 'Column');
    c.position.set(x, 0, HALL.z[1]);
    group.add(c);
  }
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
  const s = sign(signText(def.code));
  // Over the station's front edge for most, over the middle of a long lane or room.
  const inset = def.loc.kind === 'dock-out' ? -0.6 : Math.min(def.depth / 2, 1.2);
  s.position.set(def.frame.x + def.frame.dir[0] * inset, 3.4, def.frame.z + def.frame.dir[1] * inset);
  group.add(s);
  return st;
}

export function buildHubPlant(kit: THREE.Object3D, locs: string, fleet: number): HubPlant {
  const group = new THREE.Group();
  const owned: THREE.Material[] = [];
  const built = builtLocations({ locs });
  const defs = stationsFor(built);

  buildFloor(group, owned);
  buildWalls(group, kit, defs);
  const stations = defs.map((d) => buildStation(kit, d, group));

  const vehicles: Vehicle[] = [];
  for (let i = 0; i < Math.min(MAX_FLEET, Math.max(1, fleet)); i++) {
    const root = cloneRoot(kit, 'AGV');
    group.add(root);
    vehicles.push({
      root,
      forks: root.getObjectByName('AgvForks') ?? undefined,
      anchor: root.getObjectByName('AgvPalletAnchor') ?? undefined,
      beacon: lamp(root.getObjectByName('AgvBeacon') ?? undefined, '#3a2a00'),
    });
  }

  const pool = new PalletPool(kit);
  let flash = 0;

  const pose = (m: MachineState, dt: number) => {
    flash = (flash + dt) % 0.8;
    const blink = flash < 0.4;
    pool.begin();

    vehicles.forEach((v, i) => {
      const p = vehiclePose(m, i);
      v.root.visible = p.visible;
      if (!p.visible) return;
      v.root.position.set(p.x, 0, p.z);
      v.root.rotation.y = p.yaw;
      if (v.forks) v.forks.position.y = p.lift;
      light(
        v.beacon,
        p.mode === 'charging' ? '#3b82f6' : p.mode === 'stuck' ? (blink ? '#ef4444' : null) : p.mode === 'moving' && blink ? '#f59e0b' : null,
      );
      pool.place(v.anchor, str(m, `v${i}Load`));
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
            away = leaving ? ((TRUCK_GAP_MS - t) / (TRUCK_GAP_MS / 2)) * 14 : (t / (TRUCK_GAP_MS / 2)) * 14;
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
          if (here || (state === 'away' && away < 14)) {
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
          if (st.parts.carriage) st.parts.carriage.position.y = 0.6 + 0.8 * (1 - Math.cos(phase * Math.PI * 2)) / 2;
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
    group.traverse((obj) => {
      if ((obj as THREE.Sprite).isSprite) {
        const s = obj as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
      }
    });
    for (const m of owned) m.dispose();
  };

  return { group, stations: defs, pose, dispose };
}
