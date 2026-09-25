import { memo, useLayoutEffect } from 'react';
import { type MachineState } from '@automationsolver/shared';
import { node } from '../plant/kit';
import { StaticPiece, usePlantClone } from '../plant/PlantAsset';
import { Excavator, LoosePart, PartStand } from './Excavator';
import { StackLight } from './indicators';
import { ASSY_X, boolOf, clamp01, numOf, ROW_B } from './plant';

/** The jig's top, where this plant's frame stands. */
const JIG_TOP = 0.8;
/** The hook's slings reach this far below it, to the load; it parks here, and can rise no higher than this. */
const SLINGS = 0.9;
const HOOK_PARKED = 3.9;
const HOOK_TOP = 4.2;
/** Where the kit's hoist chain hangs from, and the hook block's height over the hook. */
const CHAIN_FROM = 4.47;
const HOOK_BLOCK = 0.06;

/** The jig, stretched to this bay's platform, and a rail of parts bins down its side. */
const AssemblyShell = memo(function AssemblyShell() {
  return (
    <group>
      <StaticPiece name="AssemblyJig" scale={[6.4 / 5.2, JIG_TOP / 0.6, 4.4 / 3.4]} />
      {/* Engines, cabs, and the fasteners that go with them. It costs nothing and
          it is the difference between an assembly bay and two posts on a slab. */}
      {[-2.6, -1.4, 1.4].map((x) => (
        <StaticPiece key={x} name="PartsBin" x={x} z={2.9} />
      ))}
    </group>
  );
});

export function AssemblyBay({ machine }: { machine: MachineState }) {
  const hasFrame = boolOf(machine.assyHasFrame);
  const hasBoom = boolOf(machine.assyHasBoom);
  const engine = clamp01(numOf(machine.assyEngine));
  const cab = clamp01(numOf(machine.assyCab));
  const boom = clamp01(numOf(machine.assyBoom));
  const starving = numOf(machine.assyStarveMs) > 3000;

  // Whatever the hoist is lowering right now hangs on its slings: the house, then the cab.
  const load = hasFrame && engine < 1 ? 2.0 + (1 - engine) * 2.6 : hasFrame && cab < 1 ? 2.2 + (1 - cab) * 3.0 : null;
  const hookY = load === null ? HOOK_PARKED : Math.min(HOOK_TOP, load + SLINGS);
  const hoist = usePlantClone('EngineHoist');
  useLayoutEffect(() => {
    node(hoist, 'HoistHook').position.y = hookY;
    node(hoist, 'HoistChain').scale.y = Math.max(0.05, CHAIN_FROM - hookY - HOOK_BLOCK);
  }, [hoist, hookY]);

  return (
    <group position={[ASSY_X, 0, ROW_B]}>
      <AssemblyShell />

      {/* The machine under construction. Only the frame is ever "in" the jig;
          everything else arrives as a fitting the player watches go on. */}
      {hasFrame && (
        <group position={[0, JIG_TOP, 0]} rotation={[0, Math.PI, 0]}>
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

      {/* The portal hoist over the jig. The fittings used to descend out of thin
          air; a hook above them is what turns a floating box into a lift. */}
      <primitive object={hoist} />

      {/* A boom that has been called but not yet pinned waits on its own stand,
          which is what makes "we have a boom and no frame" a visible state. */}
      {hasBoom && boom < 1 && (
        <group position={[0.4, 0, 4.0]}>
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
