import { memo } from 'react';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import {
  ANCHOR,
  BOOTH,
  CONV,
  DARK_STEEL,
  DRUM_COLORS,
  FINISH,
  GLASS,
  MACHINE,
  OVEN,
  POWER,
  POWER_DIM,
  PORTAL,
  STEEL,
  STORE,
  STORE_LANE_X,
  STORE_LANE_Z,
  STRUCTURE,
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
 * neighbour is, which is what makes a cell re-modellable on its own later.
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
  const worn = numOf(m.tipPasses) >= 6;

  // The table turns a half turn between the two passes, and the rotate progress
  // is what is actually turning during it.
  const table = (pass >= 1 ? Math.PI : 0) + rotate * Math.PI;
  // Off at the stand for a tip change, over the work otherwise.
  const torchX = changing ? fx + 3.6 : fx;
  const arcing = torch && part !== '' && !changing;

  return (
    <group>
      <CellGuard tex={tex.mesh} box={WELD} open="south" />
      <BaySign tex={tex.signs.WELD} x={cx(WELD)} z={WELD.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.WELD} x={cx(WELD) - 3} z={WELD.z1 + 0.9} w={4.2} />

      {/* Positioner: a turntable on a plinth, wrapped in tape. */}
      <group position={[fx, 0, fz]}>
        <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.5, 1.7, 0.7, 24]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
        <mesh position={[0, 0.74, 0]} rotation={[0, table, 0]} castShadow>
          <cylinderGeometry args={[1.6, 1.6, 0.12, 24]} />
          <meshStandardMaterial {...POWER_DIM} />
        </mesh>
        {part !== '' && (
          <group position={[0, 0.8, 0]} rotation={[0, table, 0]}>
            <LoosePart code={part} color={0} />
          </group>
        )}
        {/* Two clamp arms swinging in over the work. */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[0, 1.35, s * (1.5 - clamp * 0.6)]}
            rotation={[s * clamp * 0.5, 0, 0]}
            castShadow
          >
            <boxGeometry args={[1.6, 0.14, 0.24]} />
            <meshStandardMaterial {...POWER} />
          </mesh>
        ))}
      </group>
      <HazardBand tex={tex.hazard} x={fx} z={fz} w={3.6} d={3.6} y={0.14} h={0.28} />

      {/* Torch gantry across the cell, and the head hanging off it. */}
      {[-3.2, 3.2].map((dz) => (
        <mesh key={dz} position={[fx - 0.2, 2.1, fz + dz]} castShadow>
          <boxGeometry args={[0.26, 4.2, 0.26]} />
          <meshStandardMaterial {...STRUCTURE} />
        </mesh>
      ))}
      <mesh position={[fx - 0.2, 4.2, fz]} castShadow>
        <boxGeometry args={[0.34, 0.3, 7.0]} />
        <meshStandardMaterial {...STRUCTURE} />
      </mesh>
      <group position={[torchX, 0, fz]}>
        <mesh position={[0, 3.3, 0]} castShadow>
          <boxGeometry args={[0.5, 1.5, 0.5]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
        <mesh position={[0, 2.35, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.11, 0.7, 10]} />
          <meshStandardMaterial {...(worn ? POWER_DIM : STEEL)} />
        </mesh>
        {arcing && (
          <>
            {/* The arc: a hot point and the light it throws. Welding is the one
                thing on this floor a person notices from the far end. */}
            <mesh position={[0, 1.95, 0]}>
              <sphereGeometry args={[0.16, 10, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <pointLight position={[0, 1.9, 0]} color="#cfe4ff" intensity={22} distance={9} />
          </>
        )}
      </group>

      {/* Tip stand, and the rack of blanks the cell is fed from. */}
      <mesh position={[fx + 3.6, 0.55, fz]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 1.1, 0.8]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <BlankRack x={WELD.x0 + 1.4} z={fz} />

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

/** The steel the cell is fed from: plate on trestles, in the order it is used. */
const BlankRack = memo(function BlankRack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[-2.2, 0, 2.2].map((dz) => (
        <group key={dz} position={[0, 0, dz]}>
          <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 0.14, 1.5]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[0, 0.62, 0]} castShadow>
            <boxGeometry args={[1.3, 0.26, 1.2]} />
            <meshStandardMaterial color="#6b7482" metalness={0.7} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

// --- Rack store ---------------------------------------------------------------

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
  const depth = STORE_LANE_Z.front - STORE_LANE_Z.back;

  return (
    <group>
      <CellGuard tex={tex.mesh} box={STORE} open="south" />
      <BaySign tex={tex.signs['RACK STORE']} x={cx(STORE)} z={STORE.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.STORE} x={STORE.x0 + 2.6} z={STORE.z1 + 0.9} w={4.2} />

      {STORE_LANE_X.map((lx, i) => (
        <group key={lx}>
          {/* The lane: an inclined roller bed between two uprights. */}
          {[STORE_LANE_Z.back, STORE_LANE_Z.front].map((lz, k) => (
            <mesh key={lz} position={[lx, (k === 0 ? 2.3 : 1.5) / 2, lz]} castShadow>
              <boxGeometry args={[0.14, k === 0 ? 2.3 : 1.5, 0.14]} />
              <meshStandardMaterial {...STRUCTURE} />
            </mesh>
          ))}
          <mesh
            position={[lx, 1.9, (STORE_LANE_Z.back + STORE_LANE_Z.front) / 2]}
            rotation={[Math.atan2(0.8, depth), 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[2.2, 0.1, Math.hypot(depth, 0.8)]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          {/* Contents, front of the lane first — which is the order they leave. */}
          {[...lanes[i]].map((code, k) => {
            const t = k / 2.2;
            return (
              <group
                key={k}
                position={[
                  lx,
                  1.98 + t * 0.8,
                  STORE_LANE_Z.front - 0.9 - t * (depth - 1.8),
                ]}
              >
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
      <PartStand x={ANCHOR.storeLoader[0]} z={ANCHOR.storeLoader[2]} />
      <PartStand x={ANCHOR.storePick[0]} z={ANCHOR.storePick[2]} />
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

/**
 * A trestle a loose part waits on between two mechanisms.
 *
 * Its deck stops a hair short of the conveyor's. A stand is normally put exactly
 * at conveyor height, which is right on a real floor and wrong in a renderer:
 * the two decks are then the same plane and flicker against each other wherever
 * they overlap, which at both ends of the spine is a lot of them.
 */
const STAND_H = CONV.deckY - 0.02;

const PartStand = memo(function PartStand({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, STAND_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, STAND_H, 1.9]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
    </group>
  );
});

// --- Portal robot -------------------------------------------------------------

/**
 * The portal: a carriage on a rail, a mast that drops and a vacuum head.
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
  const span = PORTAL.x1 - PORTAL.x0 + 4;
  // Fully lowered puts the head just above a part on a stand.
  const headY = PORTAL.beamY - 0.5 - lift * (PORTAL.beamY - 1.7);

  return (
    <group>
      {/* Two legs and the rail they carry. */}
      {[PORTAL.x0 - 1.6, PORTAL.x1 + 1.6].map((lx) => (
        <mesh key={lx} position={[lx, PORTAL.beamY / 2, PORTAL.z]} castShadow>
          <boxGeometry args={[0.34, PORTAL.beamY, 0.34]} />
          <meshStandardMaterial {...STRUCTURE} />
        </mesh>
      ))}
      <mesh position={[(PORTAL.x0 + PORTAL.x1) / 2, PORTAL.beamY, PORTAL.z]} castShadow>
        <boxGeometry args={[span, 0.42, 0.42]} />
        <meshStandardMaterial {...POWER} />
      </mesh>

      <group position={[x, 0, PORTAL.z]}>
        <mesh position={[0, PORTAL.beamY - 0.34, 0]} castShadow>
          <boxGeometry args={[1.1, 0.42, 0.9]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
        {/* Mast, drawn from the carriage down to the head so it telescopes. */}
        <mesh position={[0, (PORTAL.beamY - 0.5 + headY) / 2, 0]} castShadow>
          <boxGeometry args={[0.26, Math.max(0.2, PORTAL.beamY - 0.5 - headY), 0.26]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0, headY, 0]} castShadow>
          <boxGeometry args={[1.5, 0.22, 1.0]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        {/* Four suction cups. They pull up against the plate when the vacuum is on. */}
        {[-0.55, 0.55].map((dx) =>
          [-0.32, 0.32].map((dz) => (
            <mesh key={`${dx},${dz}`} position={[dx, headY - 0.18 + grip * 0.05, dz]}>
              <cylinderGeometry args={[0.13, 0.15, 0.16, 12]} />
              <meshStandardMaterial color={grip > 0.5 ? '#1d2228' : '#39404a'} roughness={0.9} />
            </mesh>
          )),
        )}
        {held !== '' && (
          <group position={[0, headY - 0.4, 0]}>
            <LoosePart code={held} color={0} />
          </group>
        )}
      </group>
    </group>
  );
});

// --- Spray booth --------------------------------------------------------------

/**
 * The booth: an enclosure with a glazed wall on the aisle, a skid, and the gun.
 *
 * Glazed rather than solid on the south face for one reason — a booth you cannot
 * see into is a black box with a number on it, and the whole of the paint puzzle
 * (blast, warm, spray to film, purge on a color change) happens inside.
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
  const w = bw(BOOTH);
  const h = 4.6;
  const purge = clamp01(numOf(m.purge));

  return (
    <group>
      <BaySign tex={tex.signs.PAINT} x={cx(BOOTH)} z={BOOTH.z0 + 0.6} y={5.4} />
      <FloorText tex={tex.tags.BOOTH} x={BOOTH.x0 + 2.2} z={BOOTH.z1 + 0.9} w={4.2} />

      {/* Enclosure: three solid walls, a roof, and glazing toward the aisle. */}
      <group position={[cx(BOOTH), 0, cz(BOOTH)]}>
        <mesh position={[0, h / 2, BOOTH.z0 - cz(BOOTH)]} receiveShadow>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color="#e6e8ea" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
        {/* Side walls, each with a doorway punched through it for the transfer
            that passes that way — the portal sets a part down on the west side
            and the oven takes it off the east. A wall drawn solid across a
            conveyor puts the belt half inside it, which both reads as a mistake
            and flickers where the two surfaces meet. */}
        {[-1, 1].map((s) => (
          <group key={s} position={[(s * w) / 2, 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
            {doorPanels(BOOTH.z0 - cz(BOOTH), BOOTH.z1 - cz(BOOTH), h).map((panel, i) => (
              <mesh
                key={i}
                position={[panel.at, panel.y, 0]}
                receiveShadow
              >
                <planeGeometry args={[panel.len, panel.h]} />
                <meshStandardMaterial color="#dfe2e5" roughness={0.85} side={THREE.DoubleSide} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w, BOOTH.z1 - BOOTH.z0]} />
          <meshStandardMaterial color="#cdd2d7" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* Glazed wall, and the frame that stops it reading as a hole. */}
        <mesh position={[0, h / 2 + 0.4, BOOTH.z1 - cz(BOOTH)]}>
          <planeGeometry args={[w - 1.0, h - 1.6]} />
          <meshStandardMaterial {...GLASS} transparent opacity={0.22} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.5, BOOTH.z1 - cz(BOOTH)]}>
          <planeGeometry args={[w, 1.0]} />
          <meshStandardMaterial color="#dfe2e5" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
        {/* Extract stack through the roof: a paint shop's silhouette. */}
        <mesh position={[w / 2 - 1.2, h + 1.3, -1.5]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 2.6, 14]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      </group>

      {/* Skid and the part standing on it. */}
      <mesh position={[sx, 0.3, sz]} castShadow receiveShadow>
        <boxGeometry args={[3.0, 0.6, 2.4]} />
        <meshStandardMaterial {...MACHINE} />
      </mesh>
      {part !== '' && (
        <group position={[sx, 0.6, sz]}>
          <LoosePart code={part} color={stage === 'spray' || stage === 'cure' ? gunColor : 0} />
        </group>
      )}

      {/* Gun on a reciprocator arm, and the fan when it is open. */}
      <group position={[sx - 1.9, 0, sz]}>
        <mesh position={[0, 2.4, 0]} castShadow>
          <boxGeometry args={[0.22, 3.2, 0.22]} />
          <meshStandardMaterial {...STRUCTURE} />
        </mesh>
        <mesh position={[0.45, 2.1, 0]} castShadow>
          <boxGeometry args={[0.9, 0.22, 0.22]} />
          <meshStandardMaterial {...POWER} />
        </mesh>
        {(spraying || purging) && (
          <mesh position={[1.5, 2.1, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.55, 1.3, 14, 1, true]} />
            <meshStandardMaterial
              color={purging ? '#cfd6dd' : DRUM_COLORS[gunColor - 1]}
              transparent
              opacity={0.4}
              emissive={purging ? '#cfd6dd' : DRUM_COLORS[gunColor - 1]}
              emissiveIntensity={0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
      </group>

      {/* The drum bank on the north wall, one per order color, numbered. */}
      {DRUM_COLORS.map((c, i) => (
        <Drum key={c} x={BOOTH.x0 + 1.1 + i * 0.85} z={BOOTH.z0 - 1.4} color={c} />
      ))}
      {/* Purge catch pot, which fills while the gun is being cleared. */}
      <mesh position={[BOOTH.x1 + 1.0, 0.3 + purge * 0.02, BOOTH.z0 - 1.4]} castShadow>
        <cylinderGeometry args={[0.32, 0.32, 0.6, 14]} />
        <meshStandardMaterial color={purge > 0 ? '#7c8590' : '#3a4149'} roughness={0.8} />
      </mesh>

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

/**
 * A wall with a doorway in it, as three panels: before, after and over.
 *
 * The opening is centered on the transfer line at `ANCHOR.ovenIn`'s z, wide and
 * tall enough for a part on a conveyor to go through, because that is exactly
 * what goes through it.
 */
const DOOR = { w: 3.0, h: 2.6 };

function doorPanels(
  from: number,
  to: number,
  wallH: number,
): Array<{ at: number; y: number; len: number; h: number }> {
  const at = ANCHOR.ovenIn[2] - cz(BOOTH);
  const d0 = at - DOOR.w / 2;
  const d1 = at + DOOR.w / 2;
  return [
    { at: (from + d0) / 2, y: wallH / 2, len: d0 - from, h: wallH },
    { at: (d1 + to) / 2, y: wallH / 2, len: to - d1, h: wallH },
    { at, y: DOOR.h + (wallH - DOOR.h) / 2, len: DOOR.w, h: wallH - DOOR.h },
  ];
}

// --- Cure oven ----------------------------------------------------------------

/**
 * The oven: a tunnel with two rack positions, running east back to the spine.
 *
 * Cure is the one process on the line with no mechanism to watch, so the racks
 * glow: a part under cure is lit from inside the tunnel, and a part that has
 * over-baked comes out the brown the `defect` finish already names.
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
  const h = 3.4;
  const w = bw(OVEN);
  const anyCuring = Array.from({ length: racks }).some((_, i) => strOf(m[`ovenPart${i}`]) !== '');

  return (
    <group>
      <BaySign tex={tex.signs['CURE OVEN']} x={cx(OVEN)} z={OVEN.z0 + 0.6} y={4.8} />
      <FloorText tex={tex.tags.OVEN} x={OVEN.x0 + 2.2} z={OVEN.z1 + 0.9} w={4.2} />

      {/* Tunnel shell, open at both ends so a part is visible going in and out. */}
      <group position={[cx(OVEN), 0, ANCHOR.ovenIn[2]]}>
        <mesh position={[0, h + 0.2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.4, 3.4]} />
          <meshStandardMaterial color="#b9bfc6" roughness={0.8} metalness={0.2} />
        </mesh>
        {[-1.7, 1.7].map((dz) => (
          <mesh key={dz} position={[0, h / 2, dz]} castShadow receiveShadow>
            <boxGeometry args={[w, h, 0.2]} />
            <meshStandardMaterial color="#c6ccd2" roughness={0.8} metalness={0.2} />
          </mesh>
        ))}
        {anyCuring && (
          <pointLight position={[0, 1.7, 0]} color="#ff8a3d" intensity={26} distance={9} />
        )}
      </group>

      {/* Rack positions inside the tunnel. */}
      {Array.from({ length: racks }, (_, i) => {
        const rx = OVEN.x0 + 2.6 + (i * (w - 5.2)) / Math.max(1, racks - 1);
        const code = strOf(m[`ovenPart${i}`]);
        const color = Math.round(numOf(m[`ovenColor${i}`]));
        const bad = boolOf(m[`ovenBad${i}`]);
        const cure = clamp01(numOf(m[`ovenCure${i}`]));
        return (
          <group key={i} position={[rx, 0, ANCHOR.ovenIn[2]]}>
            <mesh position={[0, 0.3, 0]} receiveShadow>
              <boxGeometry args={[2.4, 0.6, 2.0]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
            {code !== '' && (
              <group position={[0, 0.6, 0]}>
                <LoosePart code={code} color={bad ? 0 : color} />
              </group>
            )}
            {/* Element bar overhead, brighter the further through the cure. */}
            <mesh position={[0, 2.6, 0]}>
              <boxGeometry args={[2.0, 0.09, 0.09]} />
              <meshStandardMaterial
                color="#ff7a2f"
                emissive="#ff7a2f"
                emissiveIntensity={code !== '' ? 0.5 + cure * 1.6 : 0.05}
              />
            </mesh>
          </group>
        );
      })}

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
