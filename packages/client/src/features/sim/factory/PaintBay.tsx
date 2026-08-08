import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_LIMITS, type MachineState } from '@automationsolver/shared';
import { LoosePart } from './Excavator';
import { BarGauge, StackLight } from './indicators';
import {
  BOOTH_X,
  boolOf,
  clamp01,
  COUNTS_FULL,
  DARK_STEEL,
  FINISH,
  MACHINE_PAINT,
  numOf,
  OVEN_X,
  ROW_A,
  STEEL,
  strOf,
  type Finish,
} from './plant';

/** Booth enclosure and cure oven: two chambers on one heater duct. */
const PaintShell = memo(function PaintShell() {
  return (
    <group>
      {/* Spray booth: glazed so the part inside stays visible.

          The glass is a box, and a box has a bottom. Sat flat on the slab that
          face was coplanar with the floor and, being double-sided, drawn — so
          the booth's whole floor area shimmered in bands wherever the depth
          buffer could not separate the two. It starts a few centimetres up
          instead, which is also where a real booth's glazing starts. */}
      <group position={[BOOTH_X, 0, 0]}>
        <mesh position={[0, 1.74, 0]}>
          <boxGeometry args={[4.0, 3.32, 3.6]} />
          <meshPhysicalMaterial
            color="#cfe0ee"
            transparent
            opacity={0.15}
            depthWrite={false}
            roughness={0.1}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Frame members, so the glass reads as a booth and not as a haze. */}
        {[-2.0, 2.0].map((x) =>
          [-1.8, 1.8].map((z) => (
            <mesh key={`${x},${z}`} position={[x, 1.7, z]} castShadow>
              <boxGeometry args={[0.12, 3.4, 0.12]} />
              <meshStandardMaterial {...MACHINE_PAINT} />
            </mesh>
          )),
        )}
        {/* Roof: a rail around the edge and a plenum along the back only. A
            solid lid is what the first version had, and from the plant camera
            it hid the entire booth interior — the one thing the booth is for. */}
        {[-1.9, 1.9].map((z) => (
          <mesh key={z} position={[0, 3.45, z]} castShadow>
            <boxGeometry args={[4.3, 0.2, 0.24]} />
            <meshStandardMaterial {...MACHINE_PAINT} />
          </mesh>
        ))}
        {[-2.05, 2.05].map((x) => (
          <mesh key={x} position={[x, 3.45, 0]} castShadow>
            <boxGeometry args={[0.2, 0.2, 3.8]} />
            <meshStandardMaterial {...MACHINE_PAINT} />
          </mesh>
        ))}
        <mesh position={[0, 3.32, -1.3]} castShadow>
          <boxGeometry args={[3.9, 0.5, 0.9]} />
          <meshStandardMaterial color="#6b7684" metalness={0.45} roughness={0.6} />
        </mesh>
        {/* Filter cassettes in the plenum face, seen from the front. */}
        {[-1.2, 0, 1.2].map((x) => (
          <mesh key={x} position={[x, 3.32, -0.86]}>
            <planeGeometry args={[1.1, 0.34]} />
            <meshStandardMaterial color="#b9a06a" roughness={0.95} metalness={0} />
          </mesh>
        ))}
      </group>

      {/* Cure oven: solid, insulated, with a viewing slot. */}
      <group position={[OVEN_X, 0, 0]}>
        <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[4.2, 3.2, 3.6]} />
          <meshStandardMaterial color="#59636f" metalness={0.4} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.9, 1.82]}>
          <planeGeometry args={[2.4, 0.5]} />
          <meshStandardMaterial color="#1b2029" roughness={0.4} metalness={0.3} />
        </mesh>
      </group>

      {/* Heater duct linking the two, and the extract stack above the booth. */}
      <mesh position={[(BOOTH_X + OVEN_X) / 2, 2.9, -1.4]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, OVEN_X - BOOTH_X, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[BOOTH_X, 4.4, -1.4]} castShadow>
        <cylinderGeometry args={[0.34, 0.34, 1.9, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      {/* Cowl on the stack, so it does not read as a white disc from above. */}
      <mesh position={[BOOTH_X, 5.42, -1.4]} castShadow>
        <coneGeometry args={[0.55, 0.42, 16]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
    </group>
  );
});

interface PaintRefs {
  part: THREE.Group | null;
  gun: THREE.Group | null;
  fan: THREE.Mesh | null;
  fanMat: THREE.MeshStandardMaterial | null;
  glow: THREE.PointLight | null;
  ovenMat: THREE.MeshStandardMaterial | null;
}

export function PaintBay({
  machine,
  spraying,
}: {
  machine: MachineState;
  spraying: boolean;
}) {
  const refs = useRef<PaintRefs>({
    part: null,
    gun: null,
    fan: null,
    fanMat: null,
    glow: null,
    ovenMat: null,
  });

  const stage = strOf(machine.paintStage, 'idle');
  const code = strOf(machine.paintPart);
  const temp = numOf(machine.boothTempM) / 100;
  const film = numOf(machine.filmM) / 100;
  const defect = boolOf(machine.paintDefect);
  const inBand = temp >= FACTORY_LIMITS.CURE_MIN && temp <= FACTORY_LIMITS.CURE_MAX;

  // Where the part stands, and what it looks like there. Blast leaves it matte
  // grey; the yellow arrives as film builds, so the finish is literally the
  // integral the program is controlling.
  const targetX = stage === 'cure' ? OVEN_X : BOOTH_X;
  const filmFrac = clamp01(film / FACTORY_LIMITS.FILM_MAX);
  const finish: Finish =
    defect && stage === 'cure'
      ? 'defect'
      : filmFrac > 0.25
        ? 'painted'
        : stage === 'idle'
          ? 'bare'
          : 'blasted';

  useFrame((state, dt) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // Ease the part between chambers instead of teleporting it: the model moves
    // it in one sub-step, but a machine you can watch has to travel.
    if (r.part) {
      const cur = r.part.position.x;
      r.part.position.x = cur + (targetX - cur) * Math.min(1, dt * 4);
      r.part.visible = stage !== 'idle';
    }
    // The gun sweeps the part while it is actually spraying.
    if (r.gun) {
      r.gun.visible = stage === 'spray';
      r.gun.position.z = Math.sin(t * 2.4) * 1.15;
    }
    if (r.fan) {
      r.fan.visible = spraying && stage === 'spray';
      r.fan.position.z = Math.sin(t * 2.4) * 1.15;
    }
    // Paint only sticks inside the cure band, so the fan is drawn thin and pale
    // when the booth is out of it: overspray that is not going to stay on.
    if (r.fanMat) r.fanMat.opacity = inBand ? 0.42 : 0.16;
    // The oven glows with its own temperature, red-hot out of band and amber in.
    const heat = clamp01(temp / COUNTS_FULL);
    if (r.glow) r.glow.intensity = stage === 'cure' ? 2 + heat * 6 : heat * 2.5;
    if (r.ovenMat) {
      r.ovenMat.emissiveIntensity = 0.15 + heat * 1.5;
      r.ovenMat.emissive.set(
        inBand ? '#f59e0b' : temp > FACTORY_LIMITS.CURE_MAX ? '#ef4444' : '#3b82f6',
      );
    }
  });

  return (
    <group position={[0, 0, ROW_A]}>
      <PaintShell />

      {/* Viewing-slot glow: the oven's own temperature, straight off the model. */}
      <mesh position={[OVEN_X, 1.9, 1.83]}>
        <planeGeometry args={[2.2, 0.36]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.ovenMat = m;
          }}
          color="#2a2118"
          emissive="#f59e0b"
          emissiveIntensity={0.2}
        />
      </mesh>
      <pointLight
        ref={(l) => {
          refs.current.glow = l;
        }}
        position={[OVEN_X, 1.6, 0]}
        color="#ffb257"
        distance={7}
        decay={2}
        intensity={0}
      />

      {/* The part being worked, travelling between the two chambers. */}
      <group
        ref={(g) => {
          refs.current.part = g;
        }}
        position={[BOOTH_X, 0.4, 0]}
      >
        {/* The skid the part rides through both chambers on. */}
        <mesh position={[0, -0.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.4, 0.16, 2.2]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <LoosePart code={code} finish={finish} />
      </group>

      {/* Spray gun on its reciprocator, and the fan it lays down. */}
      <group
        ref={(g) => {
          refs.current.gun = g;
        }}
        position={[BOOTH_X - 1.5, 2.0, 0]}
      >
        <mesh castShadow>
          <boxGeometry args={[0.3, 0.3, 0.5]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      </group>
      <mesh
        ref={(m) => {
          refs.current.fan = m;
        }}
        position={[BOOTH_X - 0.85, 2.0, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <coneGeometry args={[0.5, 1.3, 14, 1, true]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.fanMat = m;
          }}
          color="#f0b429"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* The two gauges the station is actually programmed against, on the
          booth's front frame where the camera preset puts them in shot. */}
      <BarGauge
        position={[BOOTH_X + 1.45, 0.9, 1.92]}
        value={temp / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.CURE_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.CURE_MAX / COUNTS_FULL}
      />
      <BarGauge
        position={[BOOTH_X + 2.0, 0.9, 1.92]}
        value={film / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.FILM_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.FILM_MAX / COUNTS_FULL}
      />

      {/* Scrap skip: the parts this station spoiled, where they can be counted. */}
      <group position={[OVEN_X + 0.4, 0, -3.2]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 1.0, 1.6]} />
          <meshStandardMaterial color="#7c2d12" metalness={0.3} roughness={0.7} />
        </mesh>
        {Array.from({ length: Math.min(4, numOf(machine.scrapped)) }, (_, i) => (
          <mesh key={i} position={[-0.7 + i * 0.45, 1.05 + (i % 2) * 0.12, 0]} castShadow>
            <boxGeometry args={[0.4, 0.22, 0.9]} />
            <meshStandardMaterial {...FINISH.defect} />
          </mesh>
        ))}
      </group>

      <StackLight
        position={[BOOTH_X - 2.6, 0, -2.1]}
        green={stage !== 'idle' && !defect}
        amber={stage === 'cure'}
        red={defect || boolOf(machine.blocked)}
      />
    </group>
  );
}
