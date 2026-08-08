import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { type MachineState } from '@automationsolver/shared';
import { Excavator } from './Excavator';
import { StackLight } from './indicators';
import {
  boolOf,
  clamp01,
  DARK_STEEL,
  FLOOR,
  MACHINE_PAINT,
  numOf,
  ROW_B,
  STEEL,
  TEST_X,
  YARD_COL_X,
  YARD_ROW_Z,
} from './plant';

const TestShell = memo(function TestShell() {
  return (
    <group>
      <mesh position={[0, 0.09, 0]} receiveShadow>
        <boxGeometry args={[6.0, 0.18, 4.6]} />
        <meshStandardMaterial color="#333b46" roughness={0.92} metalness={0.05} />
      </mesh>
      {/* Hydraulic power pack and its accumulator bottles. */}
      <group position={[-2.4, 0, -1.9]}>
        <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 1.2, 1.0]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
        {[-0.35, 0.35].map((z) => (
          <mesh key={z} position={[0.55, 1.5, z]} castShadow>
            <cylinderGeometry args={[0.17, 0.17, 0.7, 14]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

interface TestRefs {
  needle: THREE.Group | null;
  machine: THREE.Group | null;
}

export function TestBay({ machine }: { machine: MachineState }) {
  const refs = useRef<TestRefs>({ needle: null, machine: null });
  const here = boolOf(machine.testPart);
  const pump = clamp01(numOf(machine.testPump));
  const cycle = clamp01(numOf(machine.testCycle));
  const dispatch = clamp01(numOf(machine.testDispatch));

  // The function test is the payoff of the whole line: the machine works its own
  // boom. Angles are a pure function of `testCycle`, so a replay scrub shows the
  // arm exactly where the live run had it.
  const sweep = Math.sin(cycle * Math.PI * 4);
  const boomAngle = 0.42 + sweep * 0.3;
  const stickAngle = -1.45 - sweep * 0.42;
  const bucketAngle = -0.8 + sweep * 0.75;

  useFrame(() => {
    const r = refs.current;
    if (r.needle) r.needle.rotation.z = Math.PI * 0.75 - pump * Math.PI * 1.5;
    // Dispatch drives it off the pad toward the yard, which is -x on this row.
    if (r.machine) r.machine.position.x = -dispatch * 5.5;
  });

  return (
    <group position={[TEST_X, 0, ROW_B]}>
      <TestShell />

      {/* Pressure gauge on the power pack: the interlock the bay is famous for. */}
      <group position={[-2.4, 1.35, -1.35]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.07, 22]} />
          <meshStandardMaterial color="#e7ecf2" roughness={0.5} metalness={0.2} />
        </mesh>
        <group
          ref={(g) => {
            refs.current.needle = g;
          }}
          position={[0, 0, 0.06]}
        >
          <mesh position={[0.1, 0, 0]}>
            <boxGeometry args={[0.22, 0.03, 0.01]} />
            <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.5} />
          </mesh>
        </group>
      </group>

      {here && (
        <group
          ref={(g) => {
            refs.current.machine = g;
          }}
        >
          <group position={[0, 0.18, 0]} rotation={[0, Math.PI, 0]}>
            <Excavator
              finish="painted"
              boomAngle={boomAngle}
              stickAngle={stickAngle}
              bucketAngle={bucketAngle}
            />
          </group>
        </group>
      )}

      <StackLight
        position={[2.9, 0, -2.1]}
        green={cycle >= 1}
        amber={here && pump < 1}
        red={boolOf(machine.jam) || boolOf(machine.blocked)}
      />
    </group>
  );
}

/** Finished machines, parked nose-in. Six spaces, and filling them stops the line. */
export function Yard({ count }: { count: number }) {
  const spaces = YARD_ROW_Z.flatMap((z) => YARD_COL_X.map((x) => [x, z] as const));
  return (
    <group>
      {/* Painted bays, drawn whether or not anything is standing in them, so the
          yard reads as "4 of 6" rather than as a random scatter of machines. */}
      {spaces.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.014, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.5, 4.0]} />
          <meshStandardMaterial color="#3a424e" roughness={0.95} metalness={0} />
        </mesh>
      ))}
      {spaces.slice(0, Math.max(0, Math.min(spaces.length, Math.round(count)))).map(([x, z]) => (
        <group key={`m${x},${z}`} position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
          <Excavator finish="painted" boomAngle={0.3} stickAngle={-1.8} bucketAngle={-0.4} />
        </group>
      ))}
      {/* Mesh fence along the far side, and two light masts. The yard is where
          the plant's output accumulates, so it should look like somewhere a
          machine gets handed over rather than like more shop floor. */}
      <group position={[FLOOR.x0 + 1.1, 0, YARD_ROW_Z[1] - 1.4]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.1, 0]}>
          <planeGeometry args={[10.5, 2.2]} />
          <meshStandardMaterial
            color="#7d8794"
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            roughness={0.8}
            metalness={0.3}
          />
        </mesh>
        {[-5.2, -2.6, 0, 2.6, 5.2].map((x) => (
          <mesh key={x} position={[x, 1.1, 0]} castShadow>
            <boxGeometry args={[0.11, 2.2, 0.11]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        ))}
      </group>
      {[YARD_COL_X[0] + 1.4, YARD_COL_X[2] - 1.2].map((x) => (
        <group key={x} position={[x, 0, YARD_ROW_Z[1] + 2.2]}>
          <mesh position={[0, 3.0, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.16, 6.0, 10]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[0, 6.02, 0.26]} rotation={[0.9, 0, 0]} castShadow={false}>
            <boxGeometry args={[0.8, 0.12, 0.34]} />
            <meshStandardMaterial color="#8f9aa6" emissive="#fde68a" emissiveIntensity={0.12} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
