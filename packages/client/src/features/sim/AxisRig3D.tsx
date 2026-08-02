import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

/**
 * The traverse rig, built procedurally for the same reason `TankVessel3D` is:
 * its whole subject is a number moving along a line, and a carriage whose x *is*
 * that number says it better than a hero model would. One scene serves the whole
 * motion ramp, growing forks and a hoist rope by feature detection off the
 * machine state, exactly as the process model grows its interlocks.
 *
 * Nothing animates on its own. Position, speed, fork opening, hook height and
 * rope angle are pure functions of `machine.*` every frame.
 */

const COUNTS_FULL = 4000;

// Rail geometry, in scene units. The rail spans RAIL_X either side of centre.
const RAIL_X = 4.2;
const RAIL_Y = 2.5;
const CARRIAGE_W = 0.9;

/** Where the two work stations sit, in counts (must match the process model). */
const PICK_POS = 400;
const DROP_POS = 3400;

/** How far the hook drops at full hoist travel. */
const HOOK_DROP = 1.9;
/** Sway counts to radians. 500 counts is a visibly alarming swing. */
const SWAY_RAD = 0.0007;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Counts along the stroke to a scene x. */
const xOf = (counts: number): number => -RAIL_X + (clamp01(counts / COUNTS_FULL) * RAIL_X * 2);

const STEEL = { color: '#9aa4b0', metalness: 0.85, roughness: 0.38 };
const DARK_STEEL = { color: '#5d6874', metalness: 0.8, roughness: 0.45 };
const TRIM = { color: '#c2603a', metalness: 0.3, roughness: 0.55 };

/** Rail, end stops, gantry legs and the floor the whole thing stands on. */
function Structure() {
  return (
    <group>
      {/* The rail itself. */}
      <mesh position={[0, RAIL_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.09, RAIL_X * 2 + 0.6, 20]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      {/* A box beam under it, so the rail reads as carried rather than floating. */}
      <mesh position={[0, RAIL_Y + 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[RAIL_X * 2 + 0.6, 0.26, 0.34]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* End stops: the hard limits the carriage must never arrive at quickly. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (RAIL_X + 0.22), RAIL_Y, 0]} castShadow>
          <boxGeometry args={[0.18, 0.44, 0.44]} />
          <meshStandardMaterial {...TRIM} />
        </mesh>
      ))}
      {/* Gantry legs. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (RAIL_X + 0.1), RAIL_Y / 2, 0]} castShadow>
          <boxGeometry args={[0.22, RAIL_Y, 0.22]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[RAIL_X * 2 + 2, 0.04, 3.4]} />
        <meshStandardMaterial color="#39414c" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * The two work stations. The pick station is a plain pedestal; the drop station
 * is a rack, and its upright is the thing a loaded carriage hits if it overshoots
 * — so it is drawn where the process model's rack face actually is.
 */
function Stations() {
  return (
    <group>
      <mesh position={[xOf(PICK_POS), 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial color="#4b5563" metalness={0.3} roughness={0.7} />
      </mesh>
      <mesh position={[xOf(DROP_POS), 0.35, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial color="#4b5563" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Rack upright just past the drop station. */}
      <mesh position={[xOf(DROP_POS) + 0.55, 0.95, 0]} castShadow>
        <boxGeometry args={[0.12, 1.9, 0.8]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      {/* Station marks painted on the floor. */}
      {[PICK_POS, DROP_POS].map((p) => (
        <mesh key={p} position={[xOf(p), 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.6, 32]} />
          <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

interface Refs {
  carriage: THREE.Group | null;
  forkL: THREE.Mesh | null;
  forkR: THREE.Mesh | null;
  rope: THREE.Group | null;
  ropeMesh: THREE.Mesh | null;
  hook: THREE.Group | null;
  pallet: THREE.Mesh | null;
  palletMat: THREE.MeshStandardMaterial | null;
  placedPallet: THREE.Mesh | null;
  waitingPallet: THREE.Mesh | null;
}

function Scene({ machine }: { machine: MachineState }) {
  const refs = useRef<Refs>({
    carriage: null,
    forkL: null,
    forkR: null,
    rope: null,
    ropeMesh: null,
    hook: null,
    pallet: null,
    palletMat: null,
    placedPallet: null,
    waitingPallet: null,
  });

  // Feature detection, mirroring the process model's own: a puzzle with no
  // forks has no `forks` key, and the rig simply does not grow them.
  const hasForks = typeof machine.forks === 'number';
  const hasHoist = typeof machine.hoist === 'number';

  const loadColor = useMemo(() => new THREE.Color('#c2905a'), []);
  const faultColor = useMemo(() => new THREE.Color('#d4442f'), []);

  useFrame(() => {
    const r = refs.current;
    const pos = numOf(machine.pos);
    const faulted = boolOf(machine.jam);

    if (r.carriage) r.carriage.position.x = xOf(pos);

    // Forks: the two prongs slide together as the command closes them.
    const open = 1 - clamp01(numOf(machine.forks));
    const gap = 0.16 + open * 0.22;
    if (r.forkL) {
      r.forkL.position.x = -gap;
      r.forkL.visible = hasForks;
    }
    if (r.forkR) {
      r.forkR.position.x = gap;
      r.forkR.visible = hasForks;
    }

    // Hoist: the rope pays out and the load hangs at the bottom of it. The rope
    // is a unit cylinder scaled and re-seated so it grows downward from the
    // carriage, the same trick the tank's liquid column uses.
    const drop = hasHoist ? 0.28 + (clamp01(numOf(machine.hoist) / COUNTS_FULL) * HOOK_DROP) : 0.28;
    if (r.ropeMesh) {
      r.ropeMesh.scale.y = drop;
      r.ropeMesh.position.y = -drop / 2;
    }
    if (r.hook) r.hook.position.y = -drop;
    // Sway pivots the whole rope about where it leaves the carriage.
    if (r.rope) r.rope.rotation.z = hasHoist ? numOf(machine.sway) * SWAY_RAD : 0;

    const carrying = boolOf(machine.loaded);
    if (r.pallet) r.pallet.visible = hasForks && carrying;
    if (r.palletMat) r.palletMat.color.copy(faulted ? faultColor : loadColor);
    // The infeed is bottomless in the process model, so a fresh pallet is always
    // waiting unless this one is already on the forks.
    if (r.waitingPallet) r.waitingPallet.visible = hasForks && !carrying;
    // Whatever has already been put away sits on the rack.
    if (r.placedPallet) r.placedPallet.visible = hasForks && numOf(machine.placed) > 0;
  });

  return (
    <group position={[0, -1.4, 0]}>
      <Structure />
      <Stations />

      {/* Pallet waiting at the pick station, unless it is on the forks. */}
      <mesh
        ref={(m) => {
          refs.current.waitingPallet = m;
        }}
        position={[xOf(PICK_POS), 0.82, 0]}
        castShadow
      >
        <boxGeometry args={[0.5, 0.24, 0.5]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.85} metalness={0} />
      </mesh>
      <mesh
        ref={(m) => {
          refs.current.placedPallet = m;
        }}
        position={[xOf(DROP_POS), 0.82, 0]}
        castShadow
      >
        <boxGeometry args={[0.5, 0.24, 0.5]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.85} metalness={0} />
      </mesh>

      <group
        ref={(g) => {
          refs.current.carriage = g;
        }}
        position={[xOf(PICK_POS), RAIL_Y, 0]}
      >
        {/* Trolley body straddling the rail. */}
        <mesh castShadow>
          <boxGeometry args={[CARRIAGE_W, 0.42, 0.6]} />
          <meshStandardMaterial color="#6b7683" metalness={0.7} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.26, 0]} castShadow>
          <boxGeometry args={[CARRIAGE_W * 0.6, 0.14, 0.5]} />
          <meshStandardMaterial {...TRIM} />
        </mesh>

        {/* Rope and everything hanging off it, pivoted at the trolley. */}
        <group
          ref={(g) => {
            refs.current.rope = g;
          }}
          position={[0, -0.2, 0]}
        >
          <mesh
            ref={(m) => {
              refs.current.ropeMesh = m;
            }}
          >
            <cylinderGeometry args={[0.025, 0.025, 1, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.5} />
          </mesh>
          <group
            ref={(g) => {
              refs.current.hook = g;
            }}
          >
            <mesh castShadow>
              <boxGeometry args={[0.42, 0.14, 0.42]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
            {/* Fork prongs. */}
            <mesh
              ref={(m) => {
                refs.current.forkL = m;
              }}
              position={[-0.24, -0.12, 0]}
              castShadow
            >
              <boxGeometry args={[0.08, 0.12, 0.52]} />
              <meshStandardMaterial {...STEEL} />
            </mesh>
            <mesh
              ref={(m) => {
                refs.current.forkR = m;
              }}
              position={[0.24, -0.12, 0]}
              castShadow
            >
              <boxGeometry args={[0.08, 0.12, 0.52]} />
              <meshStandardMaterial {...STEEL} />
            </mesh>
            {/* The pallet, once the forks have it. */}
            <mesh
              ref={(m) => {
                refs.current.pallet = m;
              }}
              position={[0, -0.3, 0]}
              castShadow
            >
              <boxGeometry args={[0.5, 0.24, 0.5]} />
              <meshStandardMaterial
                ref={(m) => {
                  refs.current.palletMat = m;
                }}
                color="#c2905a"
                roughness={0.85}
                metalness={0}
              />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

const VIEW_TARGET: [number, number, number] = [0, 0.5, 0];
/** Which way the camera sits from the target. Only the direction matters. */
const VIEW_DIR: [number, number, number] = [-1.5, 2.1, 6.8];
/**
 * How far out the view opens, which is *not* the same thing as `minDistance`.
 * OrbitControls clamps the initial camera into its zoom range on the first
 * update, so a `cameraPosition` written closer than `minDistance` silently
 * opens hard against the near stop rather than where it was put.
 */
const VIEW_DISTANCE = 12;

/** Place a camera `distance` from `target`, along the direction `dir` points. */
function orbitPos(
  target: [number, number, number],
  dir: [number, number, number],
  distance: number,
): [number, number, number] {
  const k = distance / Math.hypot(...dir);
  return [target[0] + dir[0] * k, target[1] + dir[1] * k, target[2] + dir[2] * k];
}

export function AxisRig3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={orbitPos(VIEW_TARGET, VIEW_DIR, VIEW_DISTANCE)}
      fov={45}
      target={VIEW_TARGET}
      minDistance={10}
      maxDistance={20}
      polarRange={[0.5, 1.4]}
      interactive
    >
      <Scene machine={machine} />
    </MachineCanvas>
  );
}
