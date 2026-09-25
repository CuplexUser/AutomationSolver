import { memo, useLayoutEffect } from 'react';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { meshesIn, node } from '../plant/kit';
import { SplitPiece, StaticPiece, usePlantClone, usePlantSplit } from '../plant/PlantAsset';
import {
  ANCHOR,
  BOOTH,
  CONV,
  DRUM_COLORS,
  FINISH,
  OVEN,
  PORTAL,
  STORE,
  STORE_GUARD,
  STORE_LANE_X,
  STORE_LANE_Z,
  WELD,
  boolOf,
  bw,
  clamp01,
  cx,
  cz,
  numOf,
  orderPaint,
  strOf,
} from './plant';
import { Cabinet, CellGuard, Drum, HmiPost, PartBody, StackLight } from './props';
import { BaySign, FloorText, HazardBand, type LineTextures } from './textures';

/**
 * Row A: weld, store, portal, booth, oven — everything that makes a part and
 * finishes it, west to east along the north wall.
 *
 * Each cell draws only inside its own footprint from `plant.ts` and reads only
 * `MachineState`. Nothing here works out where it is by adding to where its
 * neighbour is, which is what makes a cell re-modellable on its own later. The
 * machinery is the plant kit's (`plant/kit.ts`); what moves is posed here.
 */

/**
 * A loose part waiting somewhere, in whatever state the line has left it.
 *
 * `color` is the order color it was sprayed, or 0 for a part that has not
 * reached the booth yet. Bare steel and painted steel look nothing alike, and on
 * a line where the whole game is keeping two streams married that difference is
 * doing real work in every shot.
 */
function LoosePart({ code, color }: { code: string; color: number }) {
  const mat = color > 0 ? orderPaint(color) : FINISH.bare;
  return <PartBody kind={code === 'b' ? 'b' : 'f'} mat={mat} scale={0.72} />;
}

// --- Weld ---------------------------------------------------------------------

const POSITIONER_LIVE = ['PositionerTable', 'PositionerClamp0', 'PositionerClamp1'] as const;
const GANTRY_LIVE = ['GantryHead'] as const;
/** How far the kit's torch tip stands in front of the gantry beam, toward the aisle. */
const TORCH_REACH = 0.48;
/** Height of the torch tip over the floor, with the head on the beam. */
const TORCH_TIP_Y = 1.95;
/** How far a clamp arm lifts when open, radians. */
const CLAMP_OPEN = 1.1;

/**
 * The weld cell: a two-axis positioner under a torch gantry, and a tip station.
 *
 * The three things a player has to be able to see from the aisle are all
 * mechanisms rather than numbers: the clamp closing, the table turning between
 * the two passes a frame needs, and the torch off at the tip stand — which is
 * the one that costs three seconds and the one nobody schedules.
 */
export const WeldCell = memo(function WeldCell({
  tex,
  machine: m,
  torch,
}: {
  tex: LineTextures;
  machine: MachineState;
  /** The live coil, so a struck arc is distinguishable from a stalled seam. */
  torch: boolean;
}) {
  const [fx, , fz] = ANCHOR.weldFixture;
  const part = strOf(m.weldPart);
  const clamp = clamp01(numOf(m.weldClamp));
  const rotate = clamp01(numOf(m.weldRotate));
  const pass = numOf(m.weldPass);
  const changing = numOf(m.tipChange) > 0;

  // The table turns a half turn between the two passes, and the rotate progress
  // is what is actually turning during it.
  const table = (pass >= 1 ? Math.PI : 0) + rotate * Math.PI;
  // Off at the stand for a tip change, over the work otherwise.
  const headX = changing ? 3.6 : 0;
  const arcing = torch && part !== '' && !changing;

  const positioner = usePlantSplit('WeldPositioner', POSITIONER_LIVE);
  useLayoutEffect(() => {
    node(positioner.live, 'PositionerTable').rotation.y = table;
    // Closed in the file; opening lifts each arm away from the work.
    node(positioner.live, 'PositionerClamp0').rotation.x = -(1 - clamp) * CLAMP_OPEN;
    node(positioner.live, 'PositionerClamp1').rotation.x = (1 - clamp) * CLAMP_OPEN;
  }, [positioner, table, clamp]);

  const gantry = usePlantSplit('WeldGantry', GANTRY_LIVE);
  useLayoutEffect(() => {
    node(gantry.live, 'GantryHead').position.x = headX;
  }, [gantry, headX]);

  return (
    <group>
      <CellGuard tex={tex.mesh} box={WELD} open="south" />
      <BaySign tex={tex.signs.WELD} x={cx(WELD)} z={WELD.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.WELD} x={cx(WELD) - 3} z={WELD.z1 + 0.9} w={4.2} />

      <SplitPiece body={positioner.body} live={positioner.live} x={fx} z={fz} />
      {part !== '' && (
        <group position={[fx, 0.8, fz]} rotation={[0, table, 0]}>
          <LoosePart code={part} color={0} />
        </group>
      )}
      <HazardBand tex={tex.hazard} x={fx} z={fz} w={3.6} d={3.6} y={0.14} h={0.28} />

      {/* Torch gantry along the cell, its head over the work or off at the tip stand. */}
      <SplitPiece body={gantry.body} live={gantry.live} x={fx} z={fz} />
      {arcing && (
        <group position={[fx + headX, TORCH_TIP_Y, fz + TORCH_REACH]}>
          {/* The arc: a hot point and the light it throws. Welding is the one
              thing on this floor a person notices from the far end. */}
          <mesh>
            <sphereGeometry args={[0.16, 10, 8]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <pointLight color="#cfe4ff" intensity={22} distance={9} />
        </group>
      )}

      {/* Tip stand, and the rack of blanks the cell is fed from. */}
      <StaticPiece name="TipStand" x={fx + 3.6} z={fz + TORCH_REACH} />
      <StaticPiece name="BlankRack" x={WELD.x0 + 1.4} z={fz} />

      <Cabinet x={WELD.x1 - 1.4} z={WELD.z1 - 1.2} rotY={Math.PI} />
      <HmiPost tex={tex.hmi} x={WELD.x1 - 2.8} z={WELD.z1 - 1.2} rotY={Math.PI} />
      <StackLight
        position={[WELD.x1 - 0.6, 0, WELD.z1 - 1.2]}
        green={arcing || clamp > 0}
        amber={part === '' && !changing}
        red={boolOf(m.jam) || boolOf(m.fault)}
      />
    </group>
  );
});

// --- Rack store ---------------------------------------------------------------

/**
 * A gravity lane's geometry, which is the same for all four.
 *
 * The deck falls `LANE_DROP` over its length, front lower than back, because
 * that is the entire mechanism: nothing drives a gravity lane, the parts run
 * down it. The kit's `GravityLane` is built to these numbers; everything that
 * stands on a lane reads its height off them.
 */
const LANE_HIGH = 1.95;
const LANE_LOW = 1.55;
const LANE_DROP = LANE_HIGH - LANE_LOW;
const LANE_RUN = STORE_LANE_Z.front - STORE_LANE_Z.back;
/** Roller tops above the uprights' nominal heights. */
const LANE_DECK = 0.05;
/** Where the deck surface sits, in world y, at a point along the lane. */
const laneDeckY = (z: number): number =>
  LANE_LOW + LANE_DECK + ((STORE_LANE_Z.front - z) / LANE_RUN) * LANE_DROP;

/**
 * Four gravity lanes, loaded from the back and picked from the front.
 *
 * Drawn as what it is rather than as four counters, because the mix *is* the
 * puzzle: a store holding three booms and one frame is a store that is about to
 * starve the jig, and that has to be one glance rather than one subtraction.
 */
export const StoreCell = memo(function StoreCell({
  tex,
  machine: m,
}: {
  tex: LineTextures;
  machine: MachineState;
}) {
  const lanes = STORE_LANE_X.map((_, i) => strOf(m[`lane${i}`]));
  const outPart = strOf(m.storeOut);

  return (
    <group>
      <CellGuard tex={tex.mesh} box={STORE_GUARD} open="south" />
      <BaySign tex={tex.signs['RACK STORE']} x={cx(STORE)} z={STORE.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.STORE} x={STORE.x0 + 2.6} z={STORE.z1 + 0.9} w={4.2} />

      {STORE_LANE_X.map((lx, i) => (
        <group key={lx}>
          <StaticPiece name="GravityLane" x={lx} z={STORE_LANE_Z.front} />
          {/* Contents, front of the lane first — which is the order they leave,
              and each one standing *on* the deck at its own point down the
              slope. The pitch is a part's depth, not its length: a part lies
              across the lane, so nose to tail is 1.0 m. Parts on a gravity lane
              rest against each other. */}
          {[...lanes[i]].map((code, k) => {
            const lz = STORE_LANE_Z.front - 0.8 - k * 1.0;
            return (
              <group key={k} position={[lx, laneDeckY(lz), lz]}>
                <LoosePart code={code} color={0} />
              </group>
            );
          })}
          <FloorText tex={tex.drumNums[i]} x={lx} z={STORE_LANE_Z.front + 0.9} w={0.9} />
        </group>
      ))}

      {/* The infeed stand, and the pick stand under the portal. Whatever is
          standing on the infeed is drawn by the spine, because the infeed *is*
          Z3 of it — the store and the conveyor are two names for one roller. */}
      <StaticPiece name="PartStand" x={ANCHOR.storeLoader[0]} z={ANCHOR.storeLoader[2]} />
      <StaticPiece name="PartStand" x={ANCHOR.storePick[0]} z={ANCHOR.storePick[2]} />
      {outPart !== '' && (
        <group position={[ANCHOR.storePick[0], CONV.deckY, ANCHOR.storePick[2]]}>
          <LoosePart code={outPart} color={0} />
        </group>
      )}

      <Cabinet x={STORE.x0 + 0.9} z={STORE.z1 - 1.2} rotY={Math.PI} />
      <StackLight
        position={[STORE.x0 + 2.1, 0, STORE.z1 - 1.2]}
        green={numOf(m.storeLoad) > 0 || numOf(m.storePick) > 0}
        amber={lanes.every((l) => l === '')}
        red={boolOf(m.blocked)}
      />
    </group>
  );
});

// --- Portal robot -------------------------------------------------------------

/**
 * The portal's two end frames: the west one clear of the store's pick stand, the
 * east one just outside the booth's east wall, so the girders pass over the booth
 * roof rather than a leg coming up through it. The kit's span is built to match.
 */
const PORTAL_WEST = PORTAL.x0 - 1.6;
const PORTAL_EAST = BOOTH.x1 + 0.4;

/** The kit head's height with the Z axis fully up, and how far each of its two stages drops. */
const HEAD_UP = 4.5;
const STAGE_DROP = 1.65;

/**
 * The portal: twin girders on two end frames, a carriage, a telescoping Z axis
 * and a vacuum head.
 *
 * It spans the gap between the store and the booth, which is exactly the gap the
 * program has to close itself — so it is the one mechanism on the line drawn out
 * in the open, with nothing fenced round it and nothing in front of it.
 */
export const PortalCell = memo(function PortalCell({ machine: m }: { machine: MachineState }) {
  const at = clamp01(numOf(m.portalAt));
  const lift = clamp01(numOf(m.portalLift));
  const grip = clamp01(numOf(m.portalGrip));
  const held = strOf(m.portalPart);
  const x = PORTAL.x0 + at * (PORTAL.x1 - PORTAL.x0);
  // Fully lowered puts the head just above a part on a stand.
  const headY = HEAD_UP - lift * 2 * STAGE_DROP;

  const carriage = usePlantClone('PortalCarriage');
  useLayoutEffect(() => {
    node(carriage, 'PortalStage').position.y = -lift * STAGE_DROP;
    node(carriage, 'PortalHead').position.y = HEAD_UP - lift * STAGE_DROP;
    // The cups pull up against the plate when the vacuum is on.
    node(carriage, 'PortalCups').position.y = -0.08 + grip * 0.05;
  }, [carriage, lift, grip]);

  return (
    <group>
      <StaticPiece name="PortalFrame" x={(PORTAL_WEST + PORTAL_EAST) / 2} z={PORTAL.z} />
      <primitive object={carriage} position={[x, 0, PORTAL.z]} />
      {held !== '' && (
        <group position={[x, headY - 0.4, PORTAL.z]}>
          <LoosePart code={held} color={0} />
        </group>
      )}
    </group>
  );
});

// --- Spray booth --------------------------------------------------------------

/** Where the gun's fan starts, from the reciprocator's mast. */
const NOZZLE_X = 1.48;
const NOZZLE_Y = 2.1;

/**
 * The booth: an enclosure glazed toward the aisle, a skid, and the gun.
 *
 * Glazed rather than solid on the south face for one reason — a booth you cannot
 * see into is a black box with a number on it, and the whole of the paint puzzle
 * (blast, warm, spray to film, purge on a color change) happens inside. The
 * kit's booth is slotted in its west wall and roof for the portal's head, and
 * has the doorway to the oven in its east wall.
 */
export const BoothCell = memo(function BoothCell({
  tex,
  machine: m,
  spraying,
  purging,
}: {
  tex: LineTextures;
  machine: MachineState;
  spraying: boolean;
  purging: boolean;
}) {
  const [sx, , sz] = ANCHOR.boothSkid;
  const part = strOf(m.boothPart);
  const stage = strOf(m.boothStage, 'idle');
  const gunColor = Math.round(numOf(m.gunColor, 1));
  const fan = purging ? '#cfd6dd' : DRUM_COLORS[gunColor - 1];

  return (
    <group>
      <BaySign tex={tex.signs.PAINT} x={cx(BOOTH)} z={BOOTH.z0 + 0.6} y={5.4} />
      <FloorText tex={tex.tags.BOOTH} x={BOOTH.x0 + 2.2} z={BOOTH.z1 + 0.9} w={4.2} />

      <StaticPiece name="SprayBooth" x={cx(BOOTH)} z={cz(BOOTH)} />

      {/* Skid and the part standing on it. */}
      <StaticPiece name="BoothSkid" x={sx} z={sz} />
      {part !== '' && (
        <group position={[sx, 0.6, sz]}>
          <LoosePart code={part} color={stage === 'spray' || stage === 'cure' ? gunColor : 0} />
        </group>
      )}

      {/* Gun on its reciprocator, and the fan when it is open: apex at the nozzle,
          widening toward the part. */}
      <StaticPiece name="SprayReciprocator" x={sx - 1.9} z={sz} />
      {(spraying || purging) && (
        <mesh position={[sx - 1.9 + NOZZLE_X + 0.65, NOZZLE_Y, sz]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.55, 1.3, 14, 1, true]} />
          <meshStandardMaterial
            color={fan}
            transparent
            opacity={0.4}
            emissive={fan}
            emissiveIntensity={0.35}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* The drum bank against the booth's north wall, one per order color. */}
      {DRUM_COLORS.map((c, i) => (
        <Drum key={c} x={BOOTH.x0 + 1.1 + i * 0.85} z={BOOTH.z0 + 1.4} color={c} />
      ))}
      {/* Purge catch pot, in the alley between the booth and the oven. */}
      <StaticPiece name="CatchPot" x={BOOTH.x1 + 1.0} z={BOOTH.z0 + 1.4} />

      <HmiPost tex={tex.hmi} x={BOOTH.x1 - 1.0} z={BOOTH.z1 + 0.9} rotY={Math.PI} />
      <StackLight
        position={[BOOTH.x0 + 0.6, 0, BOOTH.z1 + 0.9]}
        green={stage === 'spray' || stage === 'cure'}
        amber={purging || stage === 'blast'}
        red={boolOf(m.blocked)}
      />
    </group>
  );
});

// --- Cure oven ----------------------------------------------------------------

const OVEN_LIVE = ['OvenElement0', 'OvenElement1'] as const;

/** Each element bank gets a material of its own, so one rack's cure does not light the other's. */
function ownElements(obj: THREE.Object3D): void {
  for (const bank of OVEN_LIVE) {
    const pivot = obj.getObjectByName(bank);
    if (!pivot) continue;
    const meshes = meshesIn(pivot, 'Element');
    if (meshes.length === 0) continue;
    const mat = (meshes[0].material as THREE.MeshStandardMaterial).clone();
    mat.emissive.set('#ff7a2f');
    for (const mesh of meshes) mesh.material = mat;
  }
}

/**
 * The oven: a tunnel with two rack positions, running east back to the spine.
 *
 * Cure is the one process on the line with no mechanism to watch, so the racks
 * glow: the elements over a part under cure brighten as it cures, and a part
 * that has over-baked comes out the brown the `defect` finish already names.
 */
export const OvenCell = memo(function OvenCell({
  tex,
  machine: m,
  racks,
}: {
  tex: LineTextures;
  machine: MachineState;
  racks: number;
}) {
  const w = bw(OVEN);
  const rackAt = (i: number): number => OVEN.x0 + 2.6 + (i * (w - 5.2)) / Math.max(1, racks - 1);
  const rack = Array.from({ length: racks }, (_, i) => ({
    code: strOf(m[`ovenPart${i}`]),
    color: Math.round(numOf(m[`ovenColor${i}`])),
    bad: boolOf(m[`ovenBad${i}`]),
    cure: clamp01(numOf(m[`ovenCure${i}`])),
  }));
  const anyCuring = rack.some((r) => r.code !== '');
  const glow = rack.map((r) => (r.code !== '' ? 0.5 + r.cure * 1.6 : 0.05)).join(',');

  const oven = usePlantSplit('CureOven', OVEN_LIVE, ownElements);
  useLayoutEffect(() => {
    glow.split(',').forEach((g, i) => {
      const bank = oven.live.getObjectByName(OVEN_LIVE[i] ?? '');
      if (!bank) return;
      for (const mesh of meshesIn(bank, 'Element')) (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = Number(g);
    });
  }, [oven, glow]);

  return (
    <group>
      <BaySign tex={tex.signs['CURE OVEN']} x={cx(OVEN)} z={OVEN.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.OVEN} x={OVEN.x0 + 2.2} z={OVEN.z1 + 0.9} w={4.2} />

      {/* Tunnel, open at both ends so a part is visible going in and out. */}
      <SplitPiece body={oven.body} live={oven.live} x={cx(OVEN)} z={ANCHOR.ovenIn[2]} />
      {anyCuring && (
        <pointLight position={[cx(OVEN), 1.7, ANCHOR.ovenIn[2]]} color="#ff8a3d" intensity={26} distance={9} />
      )}

      {/* Rack carts under the element banks. */}
      {rack.map((r, i) => (
        <group key={i} position={[rackAt(i), 0, ANCHOR.ovenIn[2]]}>
          <StaticPiece name="OvenRack" />
          {r.code !== '' && (
            <group position={[0, 0.6, 0]}>
              <LoosePart code={r.code} color={r.bad ? 0 : r.color} />
            </group>
          )}
        </group>
      ))}

      <Cabinet x={OVEN.x1 - 0.9} z={OVEN.z1 + 0.9} rotY={Math.PI} />
      <StackLight
        position={[OVEN.x1 + 0.4, 0, OVEN.z1 + 0.9]}
        green={anyCuring}
        amber={!anyCuring}
        red={boolOf(m.blocked)}
      />
    </group>
  );
});

