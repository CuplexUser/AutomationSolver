import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Procedural packaging-machine scene — no glTF asset. Every part is a box or a
 * cylinder driven straight off the `packaging` process's machine state (each
 * actuator's 0..1 extension), which is exactly why this machine is authored in
 * code rather than Blender: the moving parts ARE primitives, and each one maps
 * to a ref we lerp here instead of a load-bearing glTF node name.
 */

// Cross-pushers: a fixed body on one side of the conveyor whose rod extends
// toward the belt (z = 0) as its machine value goes 0 → 1.
interface Pusher {
  key: string;
  x: number;
  z: number; // body center z; sign of (0 - z) is the extend direction
  travel: number;
  width: number;
  color: string;
}
const PUSHERS: Pusher[] = [
  { key: 'push4', x: -3.6, z: -2.5, travel: 1.7, width: 0.95, color: '#f59e0b' },
  { key: 'push2', x: -1.6, z: -2.5, travel: 1.7, width: 0.7, color: '#38bdf8' },
  { key: 'backstop', x: 0.4, z: -2.1, travel: 0.85, width: 1.3, color: '#fb923c' },
  { key: 'push16a', x: 2.1, z: 2.5, travel: 1.7, width: 1.0, color: '#22c55e' },
  { key: 'push16b', x: 4.1, z: 2.5, travel: 1.7, width: 1.0, color: '#a78bfa' },
];

const BODY_DEPTH = 0.8;
const DECK_Y = 0;
const ACT_Y = 0.62;

function PusherActuator({ pusher, getValue }: { pusher: Pusher; getValue: () => number }) {
  const rod = useRef<THREE.Mesh>(null);
  const plate = useRef<THREE.Mesh>(null);
  const dir = Math.sign(0 - pusher.z) || 1; // toward the conveyor centerline
  const faceZ = pusher.z + dir * (BODY_DEPTH / 2);

  // Driving three.js objects imperatively each frame is the standard r3f pattern.
  useFrame(() => {
    const v = clamp01(getValue());
    const len = 0.18 + v * pusher.travel;
    if (rod.current) {
      rod.current.scale.z = len;
      rod.current.position.z = faceZ + dir * (len / 2);
    }
    if (plate.current) plate.current.position.z = faceZ + dir * len;
  });

  return (
    <group>
      {/* cylinder body */}
      <mesh position={[pusher.x, ACT_Y, pusher.z]} castShadow receiveShadow>
        <boxGeometry args={[pusher.width, 0.5, BODY_DEPTH]} />
        <meshStandardMaterial color="#6b7280" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* piston rod (scaled along z) — base geometry 1 deep */}
      <mesh ref={rod} position={[pusher.x, ACT_Y, faceZ]} castShadow>
        <boxGeometry args={[0.16, 0.16, 1]} />
        <meshStandardMaterial color="#d1d5db" metalness={0.95} roughness={0.2} />
      </mesh>
      {/* pusher plate at the rod tip */}
      <mesh ref={plate} position={[pusher.x, ACT_Y, faceZ]} castShadow receiveShadow>
        <boxGeometry args={[pusher.width, 0.6, 0.12]} />
        <meshStandardMaterial color={pusher.color} metalness={0.3} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Lift({ getValue }: { getValue: () => number }) {
  const platform = useRef<THREE.Mesh>(null);
  const LIFT_X = -5.4;
  const DOWN_Y = 0.35;
  const UP_Y = 1.5;

  // See PusherActuator — imperative per-frame drive is the standard r3f pattern.
  useFrame(() => {
    const v = clamp01(getValue());
    if (platform.current) platform.current.position.y = DOWN_Y + (UP_Y - DOWN_Y) * v;
  });

  return (
    <group position={[LIFT_X, 0, 0]}>
      {/* guide posts */}
      {[-0.6, 0.6].map((z) => (
        <mesh key={z} position={[0, 0.9, z]} castShadow receiveShadow>
          <boxGeometry args={[0.14, 1.8, 0.14]} />
          <meshStandardMaterial color="#8a9a7a" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
      <mesh ref={platform} position={[0, DOWN_Y, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.2, 1.5]} />
        <meshStandardMaterial color="#a78bfa" metalness={0.25} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Carton({ position, size = [0.9, 0.7, 1.0] }: { position: [number, number, number]; size?: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#c9a56a" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

function PackMachineScene({ machine }: { machine: MachineState }) {
  return (
    <group>
      {/* base deck */}
      <mesh position={[0, DECK_Y - 0.15, 0]} receiveShadow>
        <boxGeometry args={[14, 0.3, 7]} />
        <meshStandardMaterial color="#3a4048" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* conveyor belt down the centerline */}
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <boxGeometry args={[13, 0.12, 1.6]} />
        <meshStandardMaterial color="#20252b" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* belt side rails */}
      {[-0.9, 0.9].map((z) => (
        <mesh key={z} position={[0, 0.28, z]} castShadow receiveShadow>
          <boxGeometry args={[13, 0.18, 0.1]} />
          <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}

      <Carton position={[-5.4, 0.6, 0]} />
      <Carton position={[5.2, 0.62, 0]} size={[1.0, 0.75, 1.2]} />
      <Carton position={[6.4, 0.62, 0]} size={[1.0, 0.75, 1.2]} />

      <Lift getValue={() => numOf(machine.lift)} />
      {PUSHERS.map((p) => (
        <PusherActuator key={p.key} pusher={p} getValue={() => numOf(machine[p.key])} />
      ))}
    </group>
  );
}

export function PackMachine3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[6.5, 7, 10]}
      target={[0, 0.6, 0]}
      minDistance={8}
      maxDistance={26}
    >
      <PackMachineScene machine={machine} />
    </MachineCanvas>
  );
}
