import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { DRILL_STOCK, type MachineState } from '@automationsolver/shared';
import { MachineCanvas, enableShadows, DRACO_DECODER_PATH } from './MachineCanvas';

const MODEL_URL = '/models/drill-station.glb';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Every coordinate below is in the glb's own units: the station is modelled at
// roughly 1 m across and its exported root scales x10, so these numbers stay in
// the model's local space while the scene ends up the same size as the other
// machines. Rest poses were read off the exported node transforms; travel
// distances were measured against the fixture, cylinder and belt geometry.
const HEAD_Y = { retracted: 0.41, extended: 0.325 };
const HOLD_X = { open: 0.382, closed: 0.36 };
const PUSH_Z = { home: -0.314, ejected: -0.194 };
const SPIN_SPEED = 26; // rad/s

// Infeed roller conveyor. The queue indexes forward by exactly one part each
// time a finished part leaves the machine — a conveyor that ran continuously
// would keep pushing parts into a station that isn't asking for them. Positions
// wrap over INFEED_SPAN so the queue never runs dry. The rollers turn at the
// matching surface speed (radius 0.014); their axis runs along Z and a part on
// top travels +X, which is a *negative* turn about that axis.
const INFEED_SPEED = 0.055; // units/s while indexing
const INFEED_ROLLER_TURN = -1 / 0.014; // radians of roller per unit of queue travel
const INFEED_START_X = -0.62;
const INFEED_SPAN = 0.48;
const INFEED_PITCH = 0.08;
const INFEED_VISIBLE = { from: -0.615, to: -0.16 }; // hidden off the roller bed / inside the chute

// Outfeed belt. The belt surface itself is not animated — the drilled part
// gliding along it is what reads as transport. Fast enough that the part has
// normally left the far end (and been hidden) before the next cycle recycles it.
const BELT_SPEED = 0.38; // units/s
const BELT_EXIT_Z = 0.5; // past the far drum — the part is done travelling

// The bore: BlockBody has a real (boolean-cut) blind hole, and BlockPlug is a
// separate cylinder of the same material filling it. At drill = 0 the plug fills
// the hole flush with the top face, reading as solid material; as the bit
// plunges in, the plug's top edge recedes toward the hole's floor, revealing the
// real cavity underneath — the part itself never moves or changes shape. Both
// values are in Block's local space.
const HOLE_DEPTH = 0.028;
const HOLE_BOTTOM_Y = -0.007;

// The mechanism: HOLD (cylinder 1) presses the part along X against the fixed
// StationStop. PUSH (cylinder 2) sits 90 degrees away on Z and, once ejecting is
// commanded (Y4), shoves the part off the fixture onto the outfeed belt; an
// "Eject Extended" sensor (X4) stops it once the part is clear, and the puzzles
// that wire X11 also see the rod back home. Fresh parts arrive from
// the opposite direction, sliding out of the gravity chute onto the fixture — so
// they travel in X and Y while the eject travels in Z. A part that has just been
// ejected is a *different* part from the one that drops in for the next cycle,
// so a small stage machine (not just a continuous lerp) keeps the ejected part
// from sliding back onto the fixture when the push rod itself retracts.
const BLOCK_REST = { x: 0.27, y: 0.061, z: -0.2 };
const BLOCK_CHUTE = { x: 0.195, y: 0.112 }; // sitting on the feed tray at the chute mouth
const BLOCK_EJECT_Z = -0.08; // landing point on the outfeed belt

// A blank lands outboard of the work position and the clamp carries it the last
// 18mm onto the station stop. That travel is the whole point of the layout: the
// stop is where the drill is centred and where the METAL PART prox looks through
// the stop's window, so "clamped in position" and "measured" are one event. An
// unclamped blank (steel, which is never clamped) simply never gets there.
const BLOCK_RECEIVE_X = 0.288;
/** Fraction of the clamp stroke spent closing the gap before the pad bites. */
const CLAMP_CONTACT = 0.22;

// The feed is a slide then a drop rather than one diagonal: the part rides the
// feed tray clear across the fixed StationStop first, and only falls the last
// 50 mm onto the fixture once it is past it. A straight lerp would cut the
// corner through both the stop and the retracted drill bit.
const DROP_RATE = 1 / 0.5; // seconds for a fresh part to reach the fixture
const SLIDE_FRACTION = 0.55; // of that, the share spent sliding before the drop

// The reject diverter (Y6): a blade on the belt's near frame, driven by a rotary
// actuator, that swings across the belt to sort blanks into the scrap chute.
// RejectGate is an empty at the blade's pivot, so the whole assembly is one
// rotation about Y — parked (0) it lies along the frame clear of the belt, fully
// swung it spans the belt width.
const GATE_SWING = 0.85; // radians, parked to fully across
// The blade's stroke, matching DRILL_GATE_MS in the drill process model. The
// machine state only advances one sim scan (60 ms) at a time, so a 250 ms stroke
// read straight onto the rotation steps across the belt in four visible jumps —
// and dropping `holdOpen` onto a coil that fell long ago snaps it shut in a
// single frame. The blade is driven toward its target at this speed instead, so
// it moves continuously at frame rate and still tracks the real actuator.
const GATE_STROKE_MS = 250;
// Where the blade meets the belt. It sits downstream of the station (blanks land
// at BLOCK_EJECT_Z) because the material is read at the fixture, before the
// program decides to clamp: sense at the station, sort further along.
const DIVERT_Z = 0.08;

// A diverted blank rides to the blade, then runs off it in +X: across the belt,
// down the chute's slope, then off its lip into the bin. Following the chute
// rather than falling on a single parabola is what keeps the blank from sinking
// through the belt's far rail on its way out.
const REJECT_DRIFT = 0.85; // units/s sideways once the blade turns it
const CHUTE_X = { from: 0.341, to: 0.512 }; // where the chute starts and its lip
const CHUTE_END_Y = 0.025; // part center height at the lip (chute floor + half a blank)
const REJECT_FALL = 1.6; // units/s² off the lip
const REJECT_FLOOR_Y = 0; // swallowed once it is well down inside the bin

// The canonical reject rungs drop Y6 the instant the eject stroke completes
// (same coil that resets the stage relay), well before a diverted blank has
// actually crossed the belt — the coil is a routing decision made once at the
// fixture, not a live "blade is in the way" signal. Read literally, the blade
// would swing shut again while the blank was still traveling toward it. So
// the 3D view holds the blade visually open for as long as a rejected blank
// is still resolving (riding the belt, crossing it, or down the chute),
// independent of the coil having already dropped.

// Hardened steel stock the station cannot drill, versus the machinable blanks it
// can. Only the material differs — the blank geometry is identical, which is
// exactly why the machine needs an inductive sensor to tell them apart. These
// values are the glb's own `steel` material (base color converted from its linear
// factors to sRGB, metallicFactor defaulting to 1) so a steel blank matches the
// structural steel already in the scene; fully metallic reads correctly here
// because MachineCanvas lights with a RoomEnvironment IBL, not lights alone.
const STEEL_COLOR = new THREE.Color('#9599a0');
const STEEL_METALNESS = 1;
const STEEL_ROUGHNESS = 0.49;

/** How many blanks the infeed queue holds before its positions wrap. */
const INFEED_SLOTS = Math.round(INFEED_SPAN / INFEED_PITCH);

type StockLook = { color: THREE.Color; metalness: number; roughness: number };

/** Paints one blank as hardened steel or leaves it as the glb's own stock. */
function paintStock(mat: THREE.MeshStandardMaterial, steel: boolean, base: StockLook): void {
  mat.color.copy(steel ? STEEL_COLOR : base.color);
  mat.metalness = steel ? STEEL_METALNESS : base.metalness;
  mat.roughness = steel ? STEEL_ROUGHNESS : base.roughness;
}

type BlockStage = 'fixture' | 'ejected' | 'dropping';
interface BlockAnim {
  stage: BlockStage;
  drop: number; // 0 = at the chute mouth, 1 = landed on the fixture
  // Deepest the bit has reached into the current part. The hole this drives (via
  // BlockPlug below) must persist once drilled rather than re-filling as the bit
  // retracts, so this tracks a running max instead of the live feed.
  maxFeed: number;
  carry: number; // how far the ejected part has ridden down the outfeed belt
  divert: number; // how far a rejected blank has been pushed off the belt in +X
  // 0 = still where it landed, 1 = carried onto the stop by the clamp. A running
  // max, because releasing the clamp does not send the blank back outboard.
  shifted: number;
  /** Blade angle actually on screen, 0..1, chasing the commanded one smoothly. */
  gateShown: number;
  // Captured when the part leaves, because the machine state that produced them
  // (the diverter, the material sensor) has already moved on to the next blank.
  rejected: boolean;
  steel: boolean;
  infeed: number; // distance the infeed queue has travelled so far
  infeedTarget: number; // where it is indexing to — one more pitch per part shipped
}

interface DriveRefs {
  holdRod?: THREE.Object3D;
  pushRod?: THREE.Object3D;
  block?: THREE.Object3D;
  spindleHead?: THREE.Object3D;
  bit?: THREE.Object3D;
  blockPlug?: THREE.Object3D;
  /** Pivot empty carrying the diverter blade and its hub. */
  rejectGate?: THREE.Object3D;
  stackRed?: THREE.Mesh;
  stackGreen?: THREE.Mesh;
  rollers: THREE.Object3D[];
  infeed: THREE.Object3D[];
  /** Own clones of the work piece's materials, so re-tinting can't leak. */
  stockMats: THREE.MeshStandardMaterial[];
  stockBase?: StockLook;
  /** One own material per queued blank, so each can show its own stock. */
  infeedMats: (THREE.MeshStandardMaterial | undefined)[];
}

/**
 * How far a diverted blank has dropped below belt height by the time it has
 * drifted out to `x`: flat while it is still crossing the belt, down the
 * chute's slope, then an accelerating fall off the lip into the scrap bin.
 */
function rejectDrop(x: number): number {
  if (x <= CHUTE_X.from) return 0;
  const onChute = BLOCK_REST.y - CHUTE_END_Y;
  if (x <= CHUTE_X.to) {
    return onChute * ((x - CHUTE_X.from) / (CHUTE_X.to - CHUTE_X.from));
  }
  const fell = (x - CHUTE_X.to) / REJECT_DRIFT; // seconds since it left the lip
  return onChute + REJECT_FALL * fell * fell;
}

/**
 * Gives a mesh its own copy of its material so it can be tinted in isolation.
 *
 * Idempotent, because the memo that calls this can run more than once for the
 * same scene (React deliberately double-invokes memo factories in dev). Cloning
 * afresh every time would leave the mesh wearing the *last* clone while the refs
 * kept an earlier one, and every repaint after that would land on a material
 * nothing renders -- the blank stays its unpainted color forever.
 */
function ownMaterial(obj: THREE.Object3D | undefined): THREE.MeshStandardMaterial | undefined {
  const mesh = obj as THREE.Mesh | undefined;
  const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
  if (!mesh || !mat) return undefined;
  if (mat.userData.blankOwner === true) return mat;
  const copy = mat.clone();
  copy.userData = { ...copy.userData, blankOwner: true };
  mesh.material = copy;
  return copy;
}

/** Collects `Name_0`, `Name_1`, ... until the first gap. */
function series(scene: THREE.Object3D, prefix: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  for (let i = 0; ; i++) {
    const obj = scene.getObjectByName(`${prefix}${i}`);
    if (!obj) return found;
    found.push(obj);
  }
}

function DrillStationScene({ machine }: { machine: MachineState }) {
  const { scene: cached } = useGLTF(MODEL_URL, DRACO_DECODER_PATH);
  // useGLTF hands out one cached scene per URL, and this scene repaints the work
  // piece's material every frame. Painting the cached scene leaves those
  // materials however the last visit ended, so the next mount reads a steel-gray
  // material as its "unpainted" base and every blank -- queue included -- comes
  // out the same gray. Cloning per instance keeps the cache pristine; geometries
  // and the source materials are still shared, so the clone is cheap.
  const scene = useMemo(() => cached.clone(true), [cached]);
  const refs = useMemo<DriveRefs>(() => {
    enableShadows(scene);
    const stockMats = [
      ownMaterial(scene.getObjectByName('BlockBody') ?? undefined),
      ownMaterial(scene.getObjectByName('BlockPlug') ?? undefined),
    ].filter((m): m is THREE.MeshStandardMaterial => m != null);
    const first = stockMats[0];
    const infeed = series(scene, 'InfeedPart_');
    return {
      stockMats,
      stockBase: first
        ? { color: first.color.clone(), metalness: first.metalness, roughness: first.roughness }
        : undefined,
      infeedMats: infeed.map((part) => ownMaterial(part)),
      holdRod: scene.getObjectByName('HoldRod') ?? undefined,
      pushRod: scene.getObjectByName('PushRod') ?? undefined,
      block: scene.getObjectByName('Block') ?? undefined,
      spindleHead: scene.getObjectByName('SpindleHead') ?? undefined,
      bit: scene.getObjectByName('Bit') ?? undefined,
      blockPlug: scene.getObjectByName('BlockPlug') ?? undefined,
      rejectGate: scene.getObjectByName('RejectGate') ?? undefined,
      stackRed: scene.getObjectByName('StackLightRed') as THREE.Mesh | undefined,
      stackGreen: scene.getObjectByName('StackLightGreen') as THREE.Mesh | undefined,
      rollers: series(scene, 'Roller_'),
      infeed,
    };
  }, [scene]);

  const anim = useRef<BlockAnim>({
    stage: 'fixture',
    drop: 1,
    maxFeed: 0,
    carry: 0,
    divert: 0,
    shifted: 0,
    gateShown: 0,
    rejected: false,
    steel: false,
    infeed: 0,
    infeedTarget: 0,
  });

  // The loaded glTF scene graph and the block-stage tracker are both external-
  // system state (three.js's own object tree, and a plain animation clock) —
  // driving them imperatively every frame here is the standard r3f pattern and
  // avoids re-rendering the React tree on every tick.
  /* eslint-disable react-hooks/immutability */
  useFrame((_state, dt) => {
    const clamp = clamp01(numOf(machine.clamp));
    const feed = clamp01(numOf(machine.drill));
    const push = clamp01(numOf(machine.push));
    const spinning = boolOf(machine.spinning);
    const warning = boolOf(machine.warning);
    const done = boolOf(machine.done);
    const gate = clamp01(numOf(machine.gate));
    // Puzzles that model real stock report the fixture's contents; the simpler
    // ones don't, and fall back to the done-lamp heuristic below.
    const stock = typeof machine.part === 'string' ? machine.part : undefined;
    // Only the X6 puzzles run a mixed batch; elsewhere every blank is aluminum
    // and the queue must stay uniform rather than inventing steel.
    const mixed = boolOf(machine.mixedStock);
    const r = refs;
    const a = anim.current;

    // Part stage machine: a part that's already ejected is not the same part that
    // will drop in for the next cycle, so we track discrete stages rather than a
    // single continuous lerp (see the comment on BLOCK_REST above). machine.push
    // is a real, player-controlled (Y4/X4) signal, so the rod itself is driven
    // straight off it; only the part's own Z needs a stage so it doesn't slide
    // back when the rod retracts after a full eject.
    if (a.stage === 'fixture' && push >= 1) {
      a.stage = 'ejected';
      a.carry = 0;
      a.divert = 0;
      // Read the coil, not the blade's travel: the process routes the blank on
      // Y6 itself, so anything else can show a part riding the belt that the
      // machine has already counted as scrap.
      a.rejected = boolOf(machine.gateOpen);
      a.infeedTarget += INFEED_PITCH; // a part consumed, so index the queue up by one
    }
    // A fresh blank is on its way: the stock-aware puzzles say so outright, the
    // rest infer it from the cycle-done lamp clearing.
    const freshPart = stock != null ? stock !== 'none' : !done;
    // There is only one work-piece mesh, so a blank still travelling to the
    // scrap bin has to finish before it can be reused for the next one —
    // otherwise a reject snaps back to the chute mouth in mid air.
    const rejectClear =
      !a.rejected || rejectDrop(BLOCK_REST.x + a.divert) >= BLOCK_REST.y - REJECT_FLOOR_Y;
    if (a.stage === 'ejected' && freshPart && rejectClear) {
      a.stage = 'dropping';
      a.drop = 0;
      a.maxFeed = 0; // a fresh part arrives undrilled
      a.shifted = 0; // and lands outboard, waiting to be carried in
    }
    // Read the material only once the blank on screen is the one the fixture is
    // reporting: while a part is riding away the machine has already moved on to
    // the next blank, and picking that up early would repaint the departing one.
    // Checked *after* the hand-over above so the fresh blank is right on the very
    // first frame it appears, rather than wearing its predecessor's color for one.
    if (a.stage !== 'ejected' && stock != null) a.steel = stock === 'steel';
    a.maxFeed = Math.max(a.maxFeed, feed);
    a.shifted = Math.max(a.shifted, clamp01((clamp - CLAMP_CONTACT) / (1 - CLAMP_CONTACT)));
    if (a.stage === 'dropping') {
      a.drop = Math.min(1, a.drop + DROP_RATE * dt);
      if (a.drop >= 1) a.stage = 'fixture';
    }
    if (a.stage === 'ejected') {
      // Everything rides the belt off the fixture; a reject only leaves it once
      // it reaches the blade, which sits further down the line.
      if (a.rejected && BLOCK_EJECT_Z + a.carry >= DIVERT_Z) a.divert += REJECT_DRIFT * dt;
      else a.carry += BELT_SPEED * dt;
    }
    if (a.infeed < a.infeedTarget) {
      a.infeed = Math.min(a.infeedTarget, a.infeed + INFEED_SPEED * dt);
    }
    // 0 = at the fixture stop, 1 = fully ejected — frozen at 1 once the part has
    // actually left, and tracking the live rod otherwise, arriving blanks
    // included. A blank the program rejects on sight (steel: Y4 comes up on the
    // same scan METAL PART reads) is pushed out while the view is still playing
    // its slide onto the fixture, so pinning an arriving blank in place ran the
    // rod straight through it and then snapped the blank out when the slide
    // finished. During a normal arrival the rod is home and this is 0 anyway.
    const blockPushProgress = a.stage === 'ejected' ? 1 : push;

    // Both cylinders are authored with their rods running deep into the barrel,
    // so the stroke is a plain translation — no stretching needed to keep the rod
    // through its end cap.
    if (r.holdRod) r.holdRod.position.x = HOLD_X.open + (HOLD_X.closed - HOLD_X.open) * clamp;
    if (r.pushRod) r.pushRod.position.z = PUSH_Z.home + (PUSH_Z.ejected - PUSH_Z.home) * push;

    if (r.block) {
      const slide = clamp01(a.drop / SLIDE_FRACTION);
      const fall = clamp01((a.drop - SLIDE_FRACTION) / (1 - SLIDE_FRACTION));
      const ejectZ = BLOCK_REST.z + (BLOCK_EJECT_Z - BLOCK_REST.z) * blockPushProgress;
      // The belt ride only applies to the part that is actually on the belt —
      // leaving it in once a fresh part has dropped would park that part a whole
      // belt-length downstream (and past BELT_EXIT_Z, so invisible).
      const beltRide = a.stage === 'ejected' ? a.carry : 0;
      // A diverted blank turns off the belt at the blade and runs down the scrap
      // chute. `slide`/`fall` are both 1 by then, so these are offsets from the
      // fixture's rest pose.
      const scrapping = a.stage === 'ejected' && a.rejected;
      const driftX = scrapping ? a.divert : 0;
      // Where the blank sits across the fixture: outboard on arrival, on the
      // stop once the clamp has carried it in.
      const stationX = BLOCK_RECEIVE_X + (BLOCK_REST.x - BLOCK_RECEIVE_X) * a.shifted;
      const baseX = BLOCK_CHUTE.x + (stationX - BLOCK_CHUTE.x) * slide + driftX;
      const dropY = scrapping ? rejectDrop(baseX) : 0;
      r.block.position.x = baseX;
      r.block.position.y = BLOCK_CHUTE.y + (BLOCK_REST.y - BLOCK_CHUTE.y) * fall - dropY;
      r.block.position.z = ejectZ + beltRide;
      // Once it has ridden off the far end of the belt (or dropped past its edge
      // into the scrap bin) the part is gone; hiding it there is also what keeps
      // the jump back up to the chute out of sight.
      r.block.visible =
        r.block.position.z < BELT_EXIT_Z && r.block.position.y > REJECT_FLOOR_Y;
    }

    // Hardened stock reads as steel: same blank, different material.
    if (r.stockBase) {
      for (const mat of r.stockMats) paintStock(mat, a.steel, r.stockBase);
    }

    // Infeed queue. Both the parts and the rollers are driven straight off the
    // travelled distance, so they simply stand still between index moves.
    for (const roller of r.rollers) roller.rotation.z = a.infeed * INFEED_ROLLER_TURN;
    r.infeed.forEach((part, i) => {
      const traveled = i * INFEED_PITCH + a.infeed;
      const x = INFEED_START_X + (traveled % INFEED_SPAN);
      part.position.x = x;
      part.visible = x > INFEED_VISIBLE.from && x < INFEED_VISIBLE.to;
      // Which blank of the run this one is. The queue is a ring of INFEED_SLOTS
      // meshes, so a mesh becomes a *new* blank each time it wraps: counting the
      // wraps gives a number that only ever increases, and only changes at the
      // far end of the bed where the mesh is hidden. Deriving it from the same
      // travel that positions the mesh (rather than from machine.fedIndex) is
      // what keeps a blank from changing color halfway down the queue.
      const mat = r.infeedMats[i];
      if (mat && r.stockBase) {
        const nth =
          INFEED_SLOTS - 1 - i + INFEED_SLOTS * Math.floor(traveled / INFEED_SPAN);
        const steel = mixed && DRILL_STOCK[nth % DRILL_STOCK.length] === 'steel';
        paintStock(mat, steel, r.stockBase);
      }
    });

    // The diverter tracks its own travel (machine.gate, a real 250ms stroke), so
    // opening Y6 is visible on the panel the instant it is commanded rather than
    // only when the next blank happens to leave. But the coil itself drops the
    // instant the eject stroke completes — before a blank ejected early in that
    // stroke has actually crossed the belt — so hold the blade visually open
    // for as long as a rejected blank is still resolving, regardless of where
    // the coil has already gone.
    const holdOpen = a.stage === 'ejected' && a.rejected && !rejectClear;
    const gateTarget = holdOpen ? 1 : gate;
    const gateStep = (dt * 1000) / GATE_STROKE_MS;
    a.gateShown =
      a.gateShown < gateTarget
        ? Math.min(gateTarget, a.gateShown + gateStep)
        : Math.max(gateTarget, a.gateShown - gateStep);
    if (r.rejectGate) r.rejectGate.rotation.y = GATE_SWING * a.gateShown;

    if (r.spindleHead) {
      r.spindleHead.position.y = HEAD_Y.retracted + (HEAD_Y.extended - HEAD_Y.retracted) * feed;
    }
    if (r.bit && spinning) r.bit.rotation.y += SPIN_SPEED * dt;

    if (r.blockPlug) {
      // Driven by maxFeed (not the live feed) so the hole stays drilled once
      // made, instead of visually re-filling as the bit retracts afterward.
      const remaining = Math.max(0.02, 1 - a.maxFeed);
      r.blockPlug.scale.y = remaining;
      r.blockPlug.position.y = HOLE_BOTTOM_Y + (HOLE_DEPTH * remaining) / 2;
    }

    const mat = (obj: THREE.Mesh | undefined) =>
      obj?.material as THREE.MeshStandardMaterial | undefined;
    const redMat = mat(r.stackRed);
    if (redMat) {
      redMat.emissiveIntensity = warning ? 1.3 : 0.2;
      redMat.color.set(warning ? '#ff2020' : '#3a0a0a');
      redMat.emissive.set(warning ? '#ff2020' : '#3a0a0a');
    }
    const greenMat = mat(r.stackGreen);
    if (greenMat) {
      // Keep the albedo dark even when lit — a bright albedo picks up diffuse/
      // specular reflection from the scene lights on top of the emissive glow,
      // and #37d67a's blue component clipped both G and B channels to white
      // under that combined light. Driving the glow through emissive alone
      // (with a blue-free hue) avoids that clipping.
      greenMat.emissiveIntensity = done ? 1.1 : 0.2;
      greenMat.color.set(done ? '#0c3a1c' : '#0a2410');
      greenMat.emissive.set(done ? '#00c040' : '#0a2410');
    }
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={scene} />;
}

export function DrillStation3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[14, 11, 14]}
      fov={26}
      target={[0.4, 1.6, -0.4]}
      minDistance={12}
      maxDistance={34}
      // The station spreads out along X (infeed rollers, fixture, outfeed belt
      // and scrap chute), so a zoomed-in view has to be able to travel to the
      // end being watched rather than only orbiting the fixture.
      panBounds={{ x: [-1, 9], y: [0, 5], z: [-3, 3] }}
    >
      <DrillStationScene machine={machine} />
    </MachineCanvas>
  );
}

useGLTF.preload(MODEL_URL, DRACO_DECODER_PATH);
