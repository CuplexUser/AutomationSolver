import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_LIMITS, type MachineState } from '@automationsolver/shared';
import { node } from '../plant/kit';
import { SplitPiece, StaticPiece, usePlantSplit } from '../plant/PlantAsset';
import { LoosePart } from './Excavator';
import { StackLight } from './indicators';
import {
  boolOf,
  clamp01,
  numOf,
  ROW_A,
  strOf,
  WELD_X,
} from './plant';

/** The fixture's jaws, and the gantry head, are what move; the rest is batched. */
const FIXTURE_LIVE = ['FixtureJaw0', 'FixtureJaw1'] as const;
const GANTRY_LIVE = ['CompactHead'] as const;
/** The jaws stand this far either side of the middle when open, and close this far. */
const JAW_OPEN = 1.75;
const JAW_TRAVEL = 0.42;

interface WeldRefs {
  torch: THREE.Group | null;
  flare: THREE.Mesh | null;
  light: THREE.PointLight | null;
  sparks: THREE.Group | null;
  /** The kit gantry's head, and its torch tip in the head's frame. */
  head?: THREE.Object3D;
  tip: THREE.Vector3;
}

export function WeldBay({ machine, torchOn }: { machine: MachineState; torchOn: boolean }) {
  const refs = useRef<WeldRefs>({ torch: null, flare: null, light: null, sparks: null, tip: new THREE.Vector3() });
  const part = strOf(machine.weldPart);
  const clamp = clamp01(numOf(machine.weldClamp));
  const seam = clamp01(numOf(machine.weldSeam));
  const arcing = torchOn && part !== '' && clamp >= 1;

  const fixture = usePlantSplit('WeldFixture', FIXTURE_LIVE);
  useLayoutEffect(() => {
    node(fixture.live, 'FixtureJaw0').position.z = -(JAW_OPEN - clamp * JAW_TRAVEL);
    node(fixture.live, 'FixtureJaw1').position.z = JAW_OPEN - clamp * JAW_TRAVEL;
  }, [fixture, clamp]);
  const gantry = usePlantSplit('WeldGantryCompact', GANTRY_LIVE);
  useLayoutEffect(() => {
    const head = node(gantry.live, 'CompactHead');
    refs.current.head = head;
    refs.current.tip = node(head, 'CompactTorchTip').position.clone();
  }, [gantry]);

  useFrame((state) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // The head tracks the seam it is laying, which is what makes weld progress
    // a thing you can see rather than a number ticking somewhere.
    if (r.head) {
      r.head.position.x = -1.5 + seam * 3.0;
      if (r.torch) r.torch.position.copy(r.head.position).add(r.tip);
    }
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
    // The canvas renders on demand; the arc keeps flickering by asking for the next frame.
    if (arcing) state.invalidate();
  });

  return (
    <group position={[WELD_X, 0, ROW_A]}>
      {/* The fixture and its jaws, the rail gantry behind it, and the weld
          screens either side, clear of the table (the kit's, turned to run along the bay's depth). */}
      <SplitPiece body={fixture.body} live={fixture.live} />
      <SplitPiece body={gantry.body} live={gantry.live} />
      {[-2.95, 2.95].map((x) => (
        <StaticPiece key={x} name="WeldScreen" x={x} z={0.4} rotY={Math.PI / 2} />
      ))}

      {/* What is in the fixture. Laid along the bay's x, which is the axis the
          gantry rail runs on, so the seam and the torch travel agree. */}
      {part !== '' && (
        <group position={[0, 0.4, 0]}>
          <LoosePart code={part} finish="bare" />
        </group>
      )}

      {/* The arc, its light and its sparks, carried at the kit torch's tip. */}
      <group
        ref={(g) => {
          refs.current.torch = g;
        }}
      >
        <group>
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
