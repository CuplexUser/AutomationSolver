import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineState } from '@automationsolver/shared';
import { MachineCanvas } from './MachineCanvas';

/**
 * The buffer vessel, built procedurally rather than from a glTF.
 *
 * Every other machine in the game is a hero model out of Blender because its
 * interest is in linkages and shapes. This one's whole subject is a *number*
 * moving, and a cylinder of liquid whose height is that number says it better
 * than geometry would. Following the precedent `PackMachine3D` set, the scene is
 * deliberately swappable for a `.glb` later without any puzzle change.
 *
 * Same contract as the other scenes: nothing animates on its own. Level, valve
 * opening and the inlet stream are pure functions of `machine.*` each frame, and
 * the one exception is the pump impeller's spin, which follows `machine.pumping`
 * the way the drill's bit follows `machine.spinning`.
 */

const COUNTS_FULL = 4000;

// Vessel geometry, in scene units.
const R = 1.15;
const WALL_H = 3.4;
const FLOOR_Y = 0.55;
const LIQUID_R = R - 0.06;
const LIQUID_MAX = WALL_H - 0.12;
/**
 * How far the bright surface disc floats above the liquid cylinder's top cap.
 * Coplanar with it they z-fight and the surface strobes; this is the smallest
 * lift that is unambiguous at this depth range and still invisible edge-on.
 */
const SURFACE_LIFT = 0.012;

/** Float switch trip heights, matching the process model's 10 % / 90 %. */
const LOW_FRAC = 0.1;
const HIGH_FRAC = 0.9;

const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
const boolOf = (v: unknown): boolean => v === true;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const STEEL = { color: '#9aa4b0', metalness: 0.85, roughness: 0.38 };
const DARK_STEEL = { color: '#5d6874', metalness: 0.8, roughness: 0.45 };
const TRIM = { color: '#c2603a', metalness: 0.3, roughness: 0.55 };

function Vessel() {
  return (
    <group>
      {/*
        Shell: plain blended glass, deliberately *not* `transmission`.
        three renders opaque -> transmissive -> transparent, and the transmission
        render target contains only the first two, so a transmissive shell both
        omits everything transparent behind it from its refraction *and* (writing
        depth first) depth-culls it outright. The liquid column simply vanished.
        A transparent shell with depthWrite off sorts behind-to-front correctly
        against the opaque liquid, costs one less full-scene pass, and looks the
        same at this opacity.
      */}
      <mesh position={[0, FLOOR_Y + WALL_H / 2, 0]}>
        <cylinderGeometry args={[R, R, WALL_H, 48, 1, true]} />
        <meshPhysicalMaterial
          color="#cfe3f2"
          transparent
          opacity={0.16}
          depthWrite={false}
          roughness={0.08}
          metalness={0}
          clearcoat={0.6}
          clearcoatRoughness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Dished ends and the rings that stiffen them. */}
      <mesh position={[0, FLOOR_Y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[R, R * 0.94, 0.16, 48]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <mesh position={[0, FLOOR_Y + WALL_H, 0]} castShadow>
        <cylinderGeometry args={[R * 0.94, R, 0.16, 48]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[0.02, WALL_H - 0.02].map((y) => (
        <mesh key={y} position={[0, FLOOR_Y + y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[R, 0.045, 10, 48]} />
          <meshStandardMaterial {...TRIM} />
        </mesh>
      ))}
      {/* Legs. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * (R - 0.18), FLOOR_Y / 2, Math.sin(a) * (R - 0.18)]}
            castShadow
          >
            <boxGeometry args={[0.13, FLOOR_Y, 0.13]} />
            <meshStandardMaterial {...DARK_STEEL} />
          </mesh>
        );
      })}
      {/* Floor pad. */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[7, 0.04, 5]} />
        <meshStandardMaterial color="#39414c" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

/** The two float-switch trip lines, so the alarms have somewhere visible to happen. */
function TripRings() {
  return (
    <>
      {[
        { frac: LOW_FRAC, color: '#fbbf24' },
        { frac: HIGH_FRAC, color: '#f87171' },
      ].map(({ frac, color }) => (
        <mesh
          key={frac}
          position={[0, FLOOR_Y + 0.06 + LIQUID_MAX * frac, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[R + 0.01, 0.018, 8, 48]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
      ))}
    </>
  );
}

interface Refs {
  liquid: THREE.Mesh | null;
  liquidMat: THREE.MeshStandardMaterial | null;
  surface: THREE.Mesh | null;
  stream: THREE.Mesh | null;
  valveStem: THREE.Mesh | null;
  valveMat: THREE.MeshStandardMaterial | null;
  impeller: THREE.Mesh | null;
}

function Scene({ machine }: { machine: MachineState }) {
  const refs = useRef<Refs>({
    liquid: null,
    liquidMat: null,
    surface: null,
    stream: null,
    valveStem: null,
    valveMat: null,
    impeller: null,
  });

  const liquidColor = useMemo(() => new THREE.Color('#2f7fd4'), []);
  const faultColor = useMemo(() => new THREE.Color('#d4442f'), []);

  // Driving the three.js objects imperatively each frame is the standard r3f
  // pattern, and it keeps the React tree from re-rendering on every tick.
  useFrame((_state, dt) => {
    const r = refs.current;
    const level = clamp01(numOf(machine.level) / COUNTS_FULL);
    const valve = clamp01(numOf(machine.valve) / COUNTS_FULL);
    const faulted = boolOf(machine.jam);

    // Liquid column: a unit cylinder scaled and re-seated so it grows upward
    // from the vessel floor rather than from its own middle.
    const h = Math.max(0.0001, LIQUID_MAX * level);
    if (r.liquid) {
      r.liquid.scale.y = h;
      r.liquid.position.y = FLOOR_Y + 0.06 + h / 2;
      r.liquid.visible = level > 0.001;
    }
    if (r.surface) {
      r.surface.position.y = FLOOR_Y + 0.06 + h + SURFACE_LIFT;
      r.surface.visible = level > 0.001;
    }
    if (r.liquidMat) {
      r.liquidMat.color.copy(faulted ? faultColor : liquidColor);
    }

    // Inlet stream: a falling column from the nozzle to the surface. Its radius
    // is the valve opening, which is what makes a modulating valve legible at a
    // glance in a way a number on a gauge is not.
    if (r.stream) {
      const nozzleY = FLOOR_Y + WALL_H - 0.1;
      const surfaceY = FLOOR_Y + 0.06 + h;
      const drop = Math.max(0.02, nozzleY - surfaceY);
      r.stream.visible = valve > 0.005;
      r.stream.scale.set(Math.max(0.15, valve), drop, Math.max(0.15, valve));
      r.stream.position.y = surfaceY + drop / 2;
    }

    // Valve actuator: the stem rises as it opens, and the body lights with it.
    if (r.valveStem) r.valveStem.position.y = FLOOR_Y + WALL_H + 0.62 + valve * 0.16;
    if (r.valveMat) r.valveMat.emissiveIntensity = 0.15 + valve * 0.85;

    if (r.impeller && boolOf(machine.pumping)) r.impeller.rotation.x += 9 * dt;
  });

  return (
    <group position={[0, -1.9, 0]}>
      <Vessel />
      <TripRings />

      {/*
        Liquid: unit-height cylinder, scaled every frame. Opaque on purpose —
        it is the one thing in this scene the player has to be able to read at a
        glance, so it goes in the opaque pass where nothing can sort it away.
      */}
      <mesh
        ref={(m) => {
          refs.current.liquid = m;
        }}
        position={[0, FLOOR_Y, 0]}
      >
        <cylinderGeometry args={[LIQUID_R, LIQUID_R, 1, 40]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.liquidMat = m;
          }}
          color="#2f7fd4"
          roughness={0.22}
          metalness={0.05}
          emissive="#123b66"
          emissiveIntensity={0.6}
        />
      </mesh>
      {/* A brighter disc riding on top, so the surface reads as a surface. */}
      <mesh
        ref={(m) => {
          refs.current.surface = m;
        }}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {/* Fractionally inset as well as lifted, so the rim never fights the
            cylinder wall from a low camera angle. */}
        <circleGeometry args={[LIQUID_R - 0.006, 40]} />
        <meshStandardMaterial
          color="#7fc4ff"
          roughness={0.15}
          emissive="#2b6ea8"
          emissiveIntensity={0.5}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Inlet: header pipe (along X), valve body and actuator, then a down-leg. */}
      <mesh
        position={[-1.9, FLOOR_Y + WALL_H + 0.45, 0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.11, 0.11, 2.4, 20]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[-0.72, FLOOR_Y + WALL_H + 0.45, 0]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.valveMat = m;
          }}
          color="#3f9d6c"
          emissive="#3f9d6c"
          emissiveIntensity={0.2}
          metalness={0.4}
          roughness={0.4}
        />
      </mesh>
      <mesh
        ref={(m) => {
          refs.current.valveStem = m;
        }}
        position={[-0.72, FLOOR_Y + WALL_H + 0.62, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.16, 0.16, 0.18, 16]} />
        <meshStandardMaterial {...TRIM} />
      </mesh>
      <mesh position={[-0.3, FLOOR_Y + WALL_H + 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.5, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>

      {/* The falling stream: unit cylinder, scaled by valve opening and drop. */}
      <mesh
        ref={(m) => {
          refs.current.stream = m;
        }}
        position={[-0.3, 0, 0]}
      >
        <cylinderGeometry args={[0.09, 0.09, 1, 12]} />
        {/* Opaque for the same reason as the liquid: two transparent surfaces at
            nearly the same depth sort against each other and flicker. */}
        <meshStandardMaterial
          color="#8ed0ff"
          roughness={0.1}
          emissive="#8ed0ff"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* Discharge: bottom nozzle, run to the pump, and the pump itself. */}
      <mesh position={[0, FLOOR_Y - 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.4, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[0.75, 0.22, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 1.5, 16]} />
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <group position={[1.55, 0.22, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.46, 24]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <mesh
          ref={(m) => {
            refs.current.impeller = m;
          }}
          position={[0.26, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <boxGeometry args={[0.05, 0.42, 0.42]} />
          <meshStandardMaterial color="#c2603a" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

export function TankVessel3D({ machine, height = 300 }: { machine: MachineState; height?: number }) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={[5.2, 2.4, 6.4]}
      fov={34}
      target={[0, 0, 0]}
      minDistance={5}
      maxDistance={14}
      polarRange={[0.5, 1.35]}
      interactive
    >
      <Scene machine={machine} />
    </MachineCanvas>
  );
}
