import { memo } from 'react';
import { type MachineState } from '@automationsolver/shared';
import { Excavator, LoosePart, PartStand } from './Excavator';
import { StackLight } from './indicators';
import { ASSY_X, boolOf, clamp01, DARK_STEEL, GUARD, MACHINE_PAINT, numOf, ROW_B } from './plant';

/** The jig, and the gantry that lowers everything onto it. */
const AssemblyShell = memo(function AssemblyShell() {
  return (
    <group>
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <boxGeometry args={[6.4, 0.32, 5.0]} />
        <meshStandardMaterial color="#2f3641" roughness={0.9} metalness={0.1} />
      </mesh>
      {/* Jig stands the frame is landed between. */}
      {[-1.9, 1.9].map((x) => (
        <mesh key={x} position={[x, 0.5, 0]} castShadow>
          <boxGeometry args={[0.4, 0.6, 3.2]} />
          <meshStandardMaterial {...GUARD} />
        </mesh>
      ))}
      {/* Overhead gantry, spanning across the bay. */}
      {[-2.9, 2.9].map((x) => (
        <mesh key={x} position={[x, 2.6, -2.2]} castShadow>
          <boxGeometry args={[0.24, 5.2, 0.24]} />
          <meshStandardMaterial {...MACHINE_PAINT} />
        </mesh>
      ))}
      <mesh position={[0, 5.1, -2.2]} castShadow>
        <boxGeometry args={[6.2, 0.34, 0.4]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* Cross-travel beam over the jig, which is what the hoist runs on. */}
      <mesh position={[0, 4.7, 0]} castShadow>
        <boxGeometry args={[0.5, 0.34, 4.6]} />
        <meshStandardMaterial {...MACHINE_PAINT} />
      </mesh>
      {/* A rail of parts bins down the side of the bay: engines, cabs, and the
          fasteners that go with them. It costs nothing and it is the difference
          between an assembly bay and two posts on a slab. */}
      {[-2.2, -1.0, 0.2].map((x) => (
        <group key={x} position={[x, 0, 2.3]}>
          <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.0, 0.84, 0.9]} />
            <meshStandardMaterial color="#3f6b8f" metalness={0.3} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.88, 0]} castShadow>
            <boxGeometry args={[1.06, 0.08, 0.96]} />
            <meshStandardMaterial {...GUARD} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

/** The hoist block and its two falls of chain, following whatever it carries. */
function Hoist({ y, visible }: { y: number; visible: boolean }) {
  const drop = Math.max(0.05, 4.55 - y);
  return (
    <group visible={visible}>
      <mesh position={[0, 4.55, 0]} castShadow>
        <boxGeometry args={[0.6, 0.42, 0.6]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {[-0.42, 0.42].map((z) => (
        <mesh key={z} position={[0, 4.55 - drop / 2, z]}>
          <cylinderGeometry args={[0.035, 0.035, drop, 6]} />
          <meshStandardMaterial color="#2b323b" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, y, 0]} castShadow>
        <boxGeometry args={[0.9, 0.14, 1.2]} />
        <meshStandardMaterial {...GUARD} />
      </mesh>
    </group>
  );
}

export function AssemblyBay({ machine }: { machine: MachineState }) {
  const hasFrame = boolOf(machine.assyHasFrame);
  const hasBoom = boolOf(machine.assyHasBoom);
  const engine = clamp01(numOf(machine.assyEngine));
  const cab = clamp01(numOf(machine.assyCab));
  const boom = clamp01(numOf(machine.assyBoom));
  const starving = numOf(machine.assyStarveMs) > 3000;

  return (
    <group position={[ASSY_X, 0, ROW_B]}>
      <AssemblyShell />

      {/* The machine under construction. Only the frame is ever "in" the jig;
          everything else arrives as a fitting the player watches go on. */}
      {hasFrame && (
        <group position={[0, 0.8, 0]} rotation={[0, Math.PI, 0]}>
          <Excavator
            finish="painted"
            engine={engine}
            cab={cab}
            boomFit={hasBoom ? boom : 0}
            boomAngle={0.45}
            stickAngle={-1.5}
            bucketAngle={-0.7}
          />
        </group>
      )}

      {/* Whatever the gantry is lowering right now, on the end of its chains.
          The fittings used to descend out of thin air; a hoist block above them
          is what turns a floating box into a lift. */}
      {hasFrame && engine < 1 && <Hoist y={2.0 + (1 - engine) * 2.6} visible />}
      {hasFrame && engine >= 1 && cab < 1 && <Hoist y={2.2 + (1 - cab) * 3.0} visible />}

      {/* A boom that has been called but not yet pinned waits on its own stand,
          which is what makes "we have a boom and no frame" a visible state. */}
      {hasBoom && boom < 1 && (
        <group position={[0.4, 0, 2.4]}>
          <PartStand w={3.4} d={2.0} />
          <group position={[0, 0.34, 0]}>
            <LoosePart code="b" finish="painted" />
          </group>
        </group>
      )}

      <StackLight
        position={[-3.1, 0, -2.4]}
        green={hasFrame && hasBoom}
        amber={starving}
        red={boolOf(machine.starved) || boolOf(machine.jam)}
      />
    </group>
  );
}
