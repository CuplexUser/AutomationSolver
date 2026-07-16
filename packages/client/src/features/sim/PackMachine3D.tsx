import type { ReactNode } from 'react';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Procedural packing-machine scene — no glTF asset. Every part is a box driven
 * straight off the `packaging` process's machine state, boxes included: lane
 * positions, per-section counts and the carry flags fully determine where every
 * box is, so the scene is a pure function of MachineState re-rendered per scan.
 *
 * Layout (top view, +x right, +z toward the camera):
 *   infeed belt along x (two lanes, z ±0.5) → 2-pack plate shoves pairs +x up
 *   onto the raised deck (section 2) → 4-pack plate shoves the 4-pack -z onto
 *   the flipper → flip lands it in section 3 (grid at z<-3.3) → 16-pack-1
 *   shoves the 16-pack +x into section 4 against the back-stop → 16-pack-2
 *   ships it +z down the out-feed to the finished station.
 */

const BOX_W = 0.78;
const BOX_H = 0.62;

// Lane geometry: position 0..1 along the infeed, 1 = at the end stop.
const laneX = (p: number) => -8.6 + 5.2 * p;
const LANE_Z = { A: 0.5, B: -0.5 } as const;

// 2-pack plate: rest just behind the boxes at the stop, stroking +x.
const plate2X = (v: number) => -3.85 + v * 1.44;
// 4-pack plate: rest south of section 2, stroking -z onto the flipper.
const plate4Z = (v: number) => 1.15 - v * 2.65;
// 16-pack-1 plate: rest west of section 3, stroking +x into section 4.
const plate16aX = (v: number) => -2.95 + v * 4.5;
// 16-pack-2 plate: rest north of section 4, stroking +z onto the out-feed.
const plate16bZ = (v: number) => -6.85 + v * 5.9;

// Section grids. Section 2 pairs: newest at SEC2_X[0], stepped deeper to [1].
const SEC2_X = [-1.9, -1.05] as const;
const SEC3_COLS = [-2.35, -1.5, -0.65, 0.2] as const;
const SEC_ROWS = [-3.7, -4.55, -5.4, -6.25] as const;
const SHIP_TRAVEL = 5.9;

const BELT_Y = 0.55; // box center resting on a belt
const DECK_Y = 0.67; // box center resting on the raised deck

function Box({ position, rotation }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={[BOX_W, BOX_H, BOX_W]} />
      <meshStandardMaterial color="#e0b64b" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

function Steel({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#6b7280" metalness={0.85} roughness={0.35} />
    </mesh>
  );
}

function GuardWall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#9a3838" metalness={0.3} roughness={0.6} />
    </mesh>
  );
}

function Plate({
  position,
  size,
  color,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.5} />
    </mesh>
  );
}

function Rod({
  from,
  to,
  axis,
  y,
  x,
  z,
}: {
  from: number;
  to: number;
  axis: 'x' | 'z';
  y: number;
  x?: number;
  z?: number;
}) {
  const len = Math.max(0.05, Math.abs(to - from));
  const mid = (from + to) / 2;
  const pos: [number, number, number] = axis === 'x' ? [mid, y, z ?? 0] : [x ?? 0, y, mid];
  const size: [number, number, number] = axis === 'x' ? [len, 0.13, 0.13] : [0.13, 0.13, len];
  return (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#d1d5db" metalness={0.95} roughness={0.2} />
    </mesh>
  );
}

/** The lift is a flipper: it tips its load over the wall into section 3. */
function Flipper({ value, children }: { value: number; children: ReactNode }) {
  return (
    <group position={[-1.475, 0.42, -3.05]} rotation={[-value * 2.35, 0, 0]}>
      {/* platform plate, hinged at the group origin, reaching toward +z */}
      <mesh position={[0, 0, 0.875]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.12, 1.75]} />
        <meshStandardMaterial color="#a78bfa" metalness={0.3} roughness={0.5} />
      </mesh>
      {children}
    </group>
  );
}

function PackMachineScene({ machine }: { machine: MachineState }) {
  const push2 = clamp01(numOf(machine.push2));
  const push4 = clamp01(numOf(machine.push4));
  const lift = clamp01(numOf(machine.lift));
  const push16a = clamp01(numOf(machine.push16a));
  const push16b = clamp01(numOf(machine.push16b));
  const backstop = clamp01(numOf(machine.backstop));
  const jam = machine.jam === true;

  const p2x = plate2X(push2);
  const p4z = plate4Z(push4);
  const p16ax = plate16aX(push16a);
  const p16bz = plate16bZ(push16b);

  const boxes: { key: string; pos: [number, number, number] }[] = [];
  // Infeed lanes: lead + follower box per lane, plus a pair riding the plate.
  const lanes = [
    { id: 'A', z: LANE_Z.A, lead: numOf(machine.laneA1), next: numOf(machine.laneA2), carry: machine.carryA === true },
    { id: 'B', z: LANE_Z.B, lead: numOf(machine.laneB1), next: numOf(machine.laneB2), carry: machine.carryB === true },
  ];
  for (const lane of lanes) {
    boxes.push({ key: `lane${lane.id}1`, pos: [laneX(lane.lead), BELT_Y, lane.z] });
    boxes.push({ key: `lane${lane.id}2`, pos: [laneX(lane.next), BELT_Y, lane.z] });
    if (lane.carry) {
      // riding the 2-pack plate up the step onto the deck
      boxes.push({ key: `carry${lane.id}`, pos: [p2x + 0.51, BELT_Y + push2 * (DECK_Y - BELT_Y), lane.z] });
    }
  }
  // Section 2: pairs staged in two steps (newest nearest the belt).
  const sec2 = numOf(machine.sec2);
  for (let pair = 0; pair < Math.min(2, Math.floor(sec2 / 2)); pair++) {
    boxes.push({ key: `s2p${pair}a`, pos: [SEC2_X[pair], DECK_Y, LANE_Z.A] });
    boxes.push({ key: `s2p${pair}b`, pos: [SEC2_X[pair], DECK_Y, LANE_Z.B] });
  }
  // 4-pack riding the 4-pack plate toward the flipper.
  const carry4 = Math.min(4, numOf(machine.carry4));
  for (let i = 0; i < carry4; i++) {
    boxes.push({
      key: `c4${i}`,
      pos: [SEC2_X[i % 2], DECK_Y + push4 * 0.12, p4z - 0.51 - 0.85 * Math.floor(i / 2)],
    });
  }
  // Section 3 grid, also used (x-shifted) for the pack riding 16-pack-1.
  const sec3 = Math.min(16, numOf(machine.sec3));
  for (let i = 0; i < sec3; i++) {
    boxes.push({ key: `s3${i}`, pos: [SEC3_COLS[i % 4], DECK_Y, SEC_ROWS[Math.floor(i / 4)]] });
  }
  const carry16a = Math.min(16, numOf(machine.carry16a));
  for (let i = 0; i < carry16a; i++) {
    boxes.push({
      key: `c16a${i}`,
      pos: [SEC3_COLS[i % 4] + push16a * 4.5, DECK_Y, SEC_ROWS[Math.floor(i / 4)]],
    });
  }
  // Section 4 grid, and the pack riding 16-pack-2 down to the out-feed.
  const sec4 = Math.min(16, numOf(machine.sec4));
  for (let i = 0; i < sec4; i++) {
    boxes.push({ key: `s4${i}`, pos: [SEC3_COLS[i % 4] + 4.5, DECK_Y, SEC_ROWS[Math.floor(i / 4)]] });
  }
  const carry16b = Math.min(16, numOf(machine.carry16b));
  for (let i = 0; i < carry16b; i++) {
    boxes.push({
      key: `c16b${i}`,
      pos: [
        SEC3_COLS[i % 4] + 4.5,
        DECK_Y - push16b * (DECK_Y - BELT_Y),
        SEC_ROWS[Math.floor(i / 4)] + push16b * SHIP_TRAVEL,
      ],
    });
  }
  // Finished station: the last shipped 16-pack rests at the out-feed's end.
  if (numOf(machine.finished) > 0) {
    for (let i = 0; i < 16; i++) {
      boxes.push({
        key: `fin${i}`,
        pos: [SEC3_COLS[i % 4] + 4.5, BELT_Y, SEC_ROWS[Math.floor(i / 4)] + SHIP_TRAVEL],
      });
    }
  }
  // Load riding the flipper (local coordinates inside the rotating group).
  const liftLoad = Math.min(4, numOf(machine.liftLoad));
  const liftBoxes: { key: string; pos: [number, number, number] }[] = [];
  for (let i = 0; i < liftLoad; i++) {
    liftBoxes.push({ key: `lift${i}`, pos: [i % 2 === 0 ? -0.425 : 0.425, 0.43, Math.floor(i / 2) === 0 ? 1.3 : 0.45] });
  }

  return (
    <group>
      {/* base slab */}
      <mesh position={[0.2, -0.11, -1.2]} receiveShadow>
        <boxGeometry args={[20, 0.2, 16]} />
        <meshStandardMaterial color="#2c3138" metalness={0.2} roughness={0.85} />
      </mesh>

      {/* infeed belt with two lanes */}
      <mesh position={[-6.85, 0.13, 0]} receiveShadow>
        <boxGeometry args={[8.3, 0.22, 2.3]} />
        <meshStandardMaterial color="#20252b" roughness={0.9} metalness={0.05} />
      </mesh>
      {[1.24, -1.24].map((z) => (
        <Steel key={`rail${z}`} position={[-6.85, 0.3, z]} size={[8.3, 0.16, 0.1]} />
      ))}
      <GuardWall position={[-7.5, 0.46, 0]} size={[7.0, 0.5, 0.07]} />

      {/* raised decks: section 2 + flipper (west), sections 3/4 (north) */}
      <mesh position={[-1.725, 0.21, -0.8]} receiveShadow>
        <boxGeometry args={[2.75, 0.3, 5.1]} />
        <meshStandardMaterial color="#4a5158" metalness={0.4} roughness={0.65} />
      </mesh>
      <mesh position={[1.2, 0.21, -5.375]} receiveShadow>
        <boxGeometry args={[8.6, 0.3, 4.05]} />
        <meshStandardMaterial color="#4a5158" metalness={0.4} roughness={0.65} />
      </mesh>

      {/* out-feed belt to the finished station */}
      <mesh position={[3.425, 0.13, 1.15]} receiveShadow>
        <boxGeometry args={[2.95, 0.22, 8.9]} />
        <meshStandardMaterial color="#20252b" roughness={0.9} metalness={0.05} />
      </mesh>
      {[1.85, 5.0].map((x) => (
        <Steel key={`orail${x}`} position={[x, 0.3, 1.15]} size={[0.1, 0.16, 8.9]} />
      ))}

      {/* guard walls: flip-over wall, section 3 back wall, section 4 end stop */}
      <GuardWall position={[-1.475, 0.66, -3.18]} size={[2.5, 0.6, 0.08]} />
      <GuardWall position={[-1.075, 0.76, -6.72]} size={[4.1, 0.8, 0.08]} />
      <GuardWall position={[5.35, 0.76, -5.1]} size={[0.08, 0.8, 3.3]} />

      {/* 2-pack pusher on its gantry over the belt end */}
      {[1.7, -1.7].map((z) => (
        <Steel key={`post${z}`} position={[-3.45, 1.15, z]} size={[0.16, 2.3, 0.16]} />
      ))}
      <Steel position={[-3.45, 2.36, 0]} size={[0.2, 0.18, 3.56]} />
      <Steel position={[-4.45, 1.75, 0]} size={[1.1, 0.5, 0.5]} />
      <Rod from={-3.9} to={p2x} axis="x" y={1.75} z={0} />
      <mesh position={[p2x, 1.22, 0]} castShadow>
        <boxGeometry args={[0.13, 1.1, 0.13]} />
        <meshStandardMaterial color="#d1d5db" metalness={0.95} roughness={0.2} />
      </mesh>
      <Plate position={[p2x, 0.74, 0]} size={[0.12, 0.95, 2.15]} color="#38bdf8" />

      {/* 4-pack pusher across the deck onto the flipper */}
      <Steel position={[-1.475, 0.84, 2.1]} size={[0.9, 0.5, 1.0]} />
      <Rod from={1.6} to={p4z} axis="z" y={0.84} x={-1.475} />
      <Plate position={[-1.475, 0.84, p4z]} size={[2.35, 0.95, 0.12]} color="#f59e0b" />

      <Flipper value={lift}>
        {liftBoxes.map((b) => (
          <Box key={b.key} position={b.pos} />
        ))}
      </Flipper>

      {/* 16-pack pusher 1: section 3 → section 4 */}
      <Steel position={[-4.5, 0.84, -4.975]} size={[1.0, 0.5, 0.9]} />
      <Rod from={-3.95} to={p16ax} axis="x" y={0.84} z={-4.975} />
      <Plate position={[p16ax, 0.84, -4.975]} size={[0.12, 0.95, 3.5]} color="#22c55e" />

      {/* back-stop: rises to guard section 4's open side, sinks to release */}
      <Plate position={[3.425, -0.15 + backstop * 0.75, -3.25]} size={[3.6, 0.8, 0.12]} color="#fb923c" />
      <Steel position={[5.55, 0.5, -3.25]} size={[0.16, 1.0, 0.16]} />

      {/* 16-pack pusher 2: ships the pack down the out-feed */}
      <Steel position={[3.425, 0.84, -7.85]} size={[1.0, 0.5, 0.9]} />
      <Rod from={-7.35} to={p16bz} axis="z" y={0.84} x={3.425} />
      <Plate position={[3.425, 0.84, p16bz]} size={[3.6, 0.95, 0.12]} color="#f472b6" />

      {/* jam beacon on the gantry beam */}
      <mesh position={[-3.45, 2.62, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.35, 16]} />
        <meshStandardMaterial
          color={jam ? '#ef4444' : '#57606a'}
          emissive={jam ? '#ef4444' : '#000000'}
          emissiveIntensity={jam ? 1.4 : 0}
        />
      </mesh>

      {boxes.map((b) => (
        <Box key={b.key} position={b.pos} />
      ))}
    </group>
  );
}

export function PackMachine3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[9.5, 10.5, 12.5]}
      target={[-0.5, 0.3, -1.2]}
      minDistance={8}
      maxDistance={32}
    >
      <PackMachineScene machine={machine} />
    </MachineCanvas>
  );
}
