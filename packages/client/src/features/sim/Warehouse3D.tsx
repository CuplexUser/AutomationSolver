import type { MachineState } from '@automationsolver/shared';
import { GOODS_IN_QUEUE, WAREHOUSE_SLOTS } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

/**
 * Aisle 1 of the automated warehouse, built procedurally rather than from a
 * glTF — the `TankVessel3D` precedent, for the same reason.
 *
 * A rack is a grid of boxes on a grid of steelwork, and what a player needs to
 * read off it is *where the stock is*: which slot holds which material, which
 * slots are free, and where the crane is standing relative to both. Geometry
 * adds nothing to that; color and position are the whole picture. The scene
 * stays swappable for a hero model later without touching puzzle logic.
 *
 * Everything here is a pure function of the `warehouse` process's machine state,
 * re-derived on each render. Nothing animates on its own, so replay scrubbing
 * shows exactly what the live run showed.
 */

/** Meters between aisle positions, and the two carriage heights. */
const SPAN = 2.1;
const LEVEL_Y = [0, 0.95, 2.45] as const;
/** Rack face: how far the slots sit from the crane's center line. */
const RACK_Z = 1.55;
const SLOT_W = 1.5;
const SLOT_H = 1.15;

const PALLET = [1.15, 0.5, 0.95] as const;
const FORK_REACH = 1.25;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;

/**
 * One color per material code, so a slot's contents are legible at a glance and
 * a mis-delivery is visible as a wrong-colored pallet arriving at a station.
 * Index 0 is "empty" and never drawn.
 */
const MATERIAL_COLOR = ['#334155', '#38bdf8', '#fbbf24', '#4ade80', '#c084fc'] as const;

const STEEL = { color: '#8b95a3', metalness: 0.8, roughness: 0.42 };
const DARK_STEEL = { color: '#4b5563', metalness: 0.7, roughness: 0.5 };
const RACK_STEEL = { color: '#d97706', metalness: 0.35, roughness: 0.62 };

const posX = (p: number) => p * SPAN;
const levelY = (l: number) => LEVEL_Y[1] + (l - 1) * (LEVEL_Y[2] - LEVEL_Y[1]);

/**
 * `code` 0 draws nothing. `NEUTRAL` draws the box in slate: a pallet already
 * accepted onto a line's conveyor, whose material the machine stops tracking
 * once the line has taken it.
 */
const NEUTRAL = -1;

function Pallet({
  code,
  position,
}: {
  code: number;
  position: [number, number, number];
}) {
  if (code === 0) return null;
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[PALLET[0], PALLET[1], PALLET[2]]} />
        <meshStandardMaterial
          color={code === NEUTRAL ? MATERIAL_COLOR[0] : (MATERIAL_COLOR[code] ?? MATERIAL_COLOR[0])}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>
      {/* The stringers underneath, so a pallet reads as a pallet and not a slab. */}
      <mesh position={[0, -PALLET[1] / 2 - 0.07, 0]} castShadow>
        <boxGeometry args={[PALLET[0] * 0.98, 0.14, PALLET[2] * 0.98]} />
        <meshStandardMaterial color="#a16207" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** The rack: uprights either side of each bay, and a beam under each level. */
function Rack() {
  return (
    <group>
      {[0.5, 1.5, 2.5, 3.5, 4.5].map((p) => (
        <mesh key={p} position={[posX(p), 1.75, RACK_Z]} castShadow receiveShadow>
          <boxGeometry args={[0.13, 3.5, 0.13]} />
          <meshStandardMaterial {...RACK_STEEL} />
        </mesh>
      ))}
      {[1, 2].map((l) => (
        <mesh
          key={l}
          position={[posX(2.5), levelY(l) - PALLET[1] / 2 - 0.2, RACK_Z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[SPAN * 4 + 0.13, 0.1, 0.9]} />
          <meshStandardMaterial {...RACK_STEEL} />
        </mesh>
      ))}
      {/* Slot outlines, so an empty slot reads as a place rather than a gap. */}
      {WAREHOUSE_SLOTS.map((s) => (
        <mesh key={s.key} position={[posX(s.bay), levelY(s.level) + 0.1, RACK_Z + 0.42]}>
          <boxGeometry args={[SLOT_W, SLOT_H, 0.02]} />
          <meshStandardMaterial color="#1e293b" transparent opacity={0.16} />
        </mesh>
      ))}
    </group>
  );
}

/** A pick-and-deposit conveyor with however many pallets are standing on it. */
function Station({
  x,
  y,
  label,
  codes,
}: {
  x: number;
  y: number;
  label: string;
  codes: number[];
}) {
  return (
    <group position={[x, y, RACK_Z]}>
      <mesh position={[0, -PALLET[1] / 2 - 0.16, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.75, 0.18, 1.15]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Rollers, purely to say "this is a conveyor, not a shelf". */}
      {[-0.6, -0.3, 0, 0.3, 0.6].map((dz) => (
        <mesh key={dz} position={[0, -PALLET[1] / 2 - 0.04, dz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.055, 0.055, 1.7, 10]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
      ))}
      {codes.map((code, i) => (
        <Pallet key={`${label}${i}`} code={code} position={[0, 0, -0.42 + i * 0.44]} />
      ))}
    </group>
  );
}

function Scene({ machine }: { machine: MachineState }) {
  const pos = numOf(machine.pos);
  const level = numOf(machine.level, 1);
  const fork = numOf(machine.fork);
  const carrying = boolOf(machine.carrying);
  const loadCode = numOf(machine.loadCode);

  const craneX = posX(pos);
  const carriageY = levelY(level);
  const forkZ = fork * FORK_REACH;

  const hasLineA = typeof machine.bufferA === 'number';
  const hasLineB = typeof machine.bufferB === 'number';
  const hasGoodsIn = typeof machine.goodsWaiting === 'number';

  // The infeed conveyors hold pallets the line has accepted but not eaten yet.
  // The machine stops tracking what they were made of at that point, so they are
  // drawn neutral rather than pretending to a code nothing is holding.
  const bufferCodes = (n: number): number[] =>
    Array.from({ length: Math.max(0, n) }, () => NEUTRAL);
  const goodsTaken = numOf(machine.goodsTaken);
  const goodsCodes = Array.from({ length: numOf(machine.goodsWaiting) }, (_, i) =>
    Number(GOODS_IN_QUEUE[(goodsTaken + i) % GOODS_IN_QUEUE.length]),
  );

  return (
    <group position={[-posX(2.5), -1.1, -0.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[posX(2.5), 0, 0.4]} receiveShadow>
        <planeGeometry args={[16, 9]} />
        <meshStandardMaterial color="#273244" roughness={0.95} />
      </mesh>

      {/* The runway the crane rides on, and the position sensors along it. */}
      <mesh position={[posX(2.5), 0.09, 0]} castShadow receiveShadow>
        <boxGeometry args={[SPAN * 5 + 1.6, 0.18, 0.5]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((p) => (
        <mesh key={p} position={[posX(p), 0.21, -0.34]}>
          <boxGeometry args={[0.1, 0.08, 0.12]} />
          <meshStandardMaterial
            color={Math.abs(pos - p) < 0.02 ? '#facc15' : '#1f2937'}
            emissive={Math.abs(pos - p) < 0.02 ? '#facc15' : '#000000'}
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}

      <Rack />
      {WAREHOUSE_SLOTS.map((s) => (
        <Pallet
          key={s.key}
          code={numOf(machine[s.key])}
          position={[posX(s.bay), levelY(s.level), RACK_Z]}
        />
      ))}

      {hasLineA && (
        <Station x={posX(0)} y={levelY(1)} label="A" codes={bufferCodes(numOf(machine.bufferA))} />
      )}
      {hasLineB && (
        <Station x={posX(5)} y={levelY(1)} label="B" codes={bufferCodes(numOf(machine.bufferB))} />
      )}
      {hasGoodsIn && <Station x={posX(0)} y={levelY(2)} label="G" codes={goodsCodes} />}

      {/* The crane: mast on the runway, carriage on the mast, fork on the
          carriage. Each one is positioned straight from the machine state. */}
      <group position={[craneX, 0, 0]}>
        <mesh position={[0, 1.95, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.28, 3.9, 0.28]} />
          <meshStandardMaterial {...STEEL} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.3, 0.6]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <mesh position={[0, 3.95, 0]} castShadow>
          <boxGeometry args={[0.8, 0.16, 0.5]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>

        <group position={[0, carriageY, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.95, 0.72, 0.5]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          {/* Telescopic fork: two tines reaching towards the rack face. */}
          <group position={[0, -0.18, forkZ]}>
            {[-0.32, 0.32].map((dx) => (
              <mesh key={dx} position={[dx, 0, 0.62]} castShadow>
                <boxGeometry args={[0.16, 0.1, 1.5]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.3} />
              </mesh>
            ))}
            {carrying && (
              <Pallet code={loadCode} position={[0, PALLET[1] / 2 + 0.05, 0.62]} />
            )}
          </group>
        </group>
      </group>
    </group>
  );
}

export function Warehouse3D({
  machine,
  height = 300,
}: {
  machine: MachineState;
  height?: number;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[1.5, 4.6, 11.5]}
      fov={38}
      target={[0, 0.6, 0]}
      minDistance={7}
      maxDistance={22}
      polarRange={[0.55, 1.35]}
      interactive
    >
      <Scene machine={machine} />
    </MachineCanvas>
  );
}
