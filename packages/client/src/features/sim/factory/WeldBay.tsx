import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_LIMITS, type MachineState } from '@automationsolver/shared';
import { LoosePart } from './Excavator';
import { StackLight } from './indicators';
import {
  boolOf,
  clamp01,
  DARK_STEEL,
  GUARD,
  MACHINE_PAINT,
  numOf,
  ROW_A,
  strOf,
  WELD_X,
} from './plant';

/** The fixture, the gantry it hangs under, and the safety screens around it. */
const WeldShell = memo(function WeldShell() {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} receiveShadow castShadow>
        <boxGeometry args={[5.4, 0.4, 4.2]} />
        <meshStandardMaterial color="#2f3641" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Gantry: two legs and a rail the torch head runs along. */}
      {[-2.3, 2.3].map((x) => (
        <mesh key={x} position={[x, 1.9, -1.7]} castShadow>
          <boxGeometry args={[0.22, 3.6, 0.22]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      ))}
      <mesh position={[0, 3.6, -1.7]} castShadow>
        <boxGeometry args={[5.0, 0.3, 0.34]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* Cable chain along the rail, so the torch head is visibly fed. */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-2.0 + i * 0.5, 3.86, -1.7]} castShadow={false}>
          <boxGeometry args={[0.34, 0.16, 0.2]} />
          <meshStandardMaterial color="#2f3945" metalness={0.3} roughness={0.8} />
        </mesh>
      ))}

      {/* Fume extraction, kept deliberately small and set back over the rail
          rather than centred over the fixture. Sized to look right in isolation
          it became a grey pyramid parked on top of the one thing the bay is for.
          Nothing overhead in this scene casts a shadow, for the same reason the
          building has no trusses. */}
      <mesh position={[0, 4.55, -1.5]} rotation={[0, Math.PI / 4, 0]} castShadow={false}>
        <cylinderGeometry args={[0.32, 0.95, 0.6, 4]} />
        <meshStandardMaterial color="#5d6874" metalness={0.45} roughness={0.65} />
      </mesh>
      <mesh position={[0, 5.15, -2.1]} rotation={[Math.PI / 3, 0, 0]} castShadow={false}>
        <cylinderGeometry args={[0.24, 0.24, 2.2, 12]} />
        <meshStandardMaterial color="#68737f" metalness={0.5} roughness={0.6} />
      </mesh>

      {/* Weld screens: hung curtains on a frame, not floating slabs. The frame
          is what makes a translucent quad read as a screen. */}
      {[-2.5, 2.5].map((x) => (
        <group key={x} position={[x, 0, 0.4]}>
          {[-1.7, 1.7].map((z) => (
            <mesh key={z} position={[0, 1.35, z]} castShadow>
              <boxGeometry args={[0.1, 2.7, 0.1]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
          ))}
          <mesh position={[0, 2.66, 0]} castShadow>
            <boxGeometry args={[0.12, 0.12, 3.5]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
          <mesh position={[0, 1.42, 0]}>
            <boxGeometry args={[0.05, 2.3, 3.3]} />
            <meshStandardMaterial
              color="#c2410c"
              transparent
              opacity={0.34}
              roughness={0.5}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

interface WeldRefs {
  torch: THREE.Group | null;
  flare: THREE.Mesh | null;
  light: THREE.PointLight | null;
  sparks: THREE.Group | null;
}

export function WeldBay({ machine, torchOn }: { machine: MachineState; torchOn: boolean }) {
  const refs = useRef<WeldRefs>({ torch: null, flare: null, light: null, sparks: null });
  const part = strOf(machine.weldPart);
  const clamp = clamp01(numOf(machine.weldClamp));
  const seam = clamp01(numOf(machine.weldSeam));
  const arcing = torchOn && part !== '' && clamp >= 1;

  useFrame((state) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // The head tracks the seam it is laying, which is what makes weld progress
    // a thing you can see rather than a number ticking somewhere.
    if (r.torch) r.torch.position.x = -1.5 + seam * 3.0;
    if (r.flare) {
      r.flare.visible = arcing;
      // Arc flicker: cosmetic only, so a free-running clock is fine here the way
      // it is for the drill's spindle.
      const f = 0.9 + Math.sin(t * 47) * 0.1 + Math.sin(t * 23) * 0.06;
      r.flare.scale.setScalar(arcing ? f : 0.001);
    }
    if (r.light) r.light.intensity = arcing ? 5 + Math.sin(t * 39) * 2.2 : 0;
    if (r.sparks) {
      r.sparks.visible = arcing;
      if (arcing) {
        r.sparks.children.forEach((s, i) => {
          const phase = (t * 2.4 + i * 0.37) % 1;
          const a = i * 1.9;
          s.position.set(
            Math.cos(a) * phase * 0.85,
            0.35 - phase * phase * 1.1,
            Math.sin(a) * phase * 0.7,
          );
          s.scale.setScalar(1 - phase);
        });
      }
    }
  });

  return (
    <group position={[WELD_X, 0, ROW_A]}>
      <WeldShell />

      {/* The fixture jaws close on the blank across its width as the clamp
          makes, leaving the length of the part clear for the torch to run. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[0, 0, side * (1.75 - clamp * 0.42)]}>
          <mesh position={[0, 0.75, 0]} castShadow>
            <boxGeometry args={[2.6, 0.7, 0.34]} />
            <meshStandardMaterial {...GUARD} />
          </mesh>
          {/* Gussets and the ram behind them: a jaw is a fabrication, and a
              plain bar reads as a yellow box floating over a table. */}
          {[-0.95, 0, 0.95].map((x) => (
            <mesh key={x} position={[x, 0.44, side * 0.22]} castShadow>
              <boxGeometry args={[0.22, 0.44, 0.5]} />
              <meshStandardMaterial {...GUARD} />
            </mesh>
          ))}
          <mesh position={[0, 0.75, side * 0.62]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.11, 0.11, 0.9, 12]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        </group>
      ))}

      {/* What is in the fixture. Laid along the bay's x, which is the axis the
          gantry rail runs on, so the seam and the torch travel agree. */}
      {part !== '' && (
        <group position={[0, 0.4, 0]}>
          <LoosePart code={part} finish="bare" />
        </group>
      )}

      {/* Torch head on the rail, with its arc, its light and its sparks. */}
      <group
        ref={(g) => {
          refs.current.torch = g;
        }}
        position={[0, 0, -1.7]}
      >
        <mesh position={[0, 3.15, 0]} castShadow>
          <boxGeometry args={[0.5, 0.6, 0.5]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
        <mesh position={[0, 2.3, 0.5]} rotation={[0.5, 0, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.11, 1.5, 12]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <group position={[0, 1.62, 1.06]}>
          <mesh
            ref={(m) => {
              refs.current.flare = m;
            }}
          >
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshBasicMaterial color="#e8f4ff" />
          </mesh>
          <pointLight
            ref={(l) => {
              refs.current.light = l;
            }}
            color="#bcd8ff"
            distance={9}
            decay={2}
            intensity={0}
          />
          <group
            ref={(g) => {
              refs.current.sparks = g;
            }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <mesh key={i}>
                <sphereGeometry args={[0.035, 5, 5]} />
                <meshBasicMaterial color="#ffb24d" />
              </mesh>
            ))}
          </group>
        </group>
      </group>

      <StackLight
        position={[2.6, 0, -1.9]}
        green={part !== '' && !boolOf(machine.jam)}
        amber={strOf(machine.bufWp).length >= FACTORY_LIMITS.WP_CAP}
        red={boolOf(machine.jam) || boolOf(machine.blocked)}
      />
    </group>
  );
}
