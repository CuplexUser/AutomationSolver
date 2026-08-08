import { Excavator, LoosePart, PartStand } from './Excavator';
import { AT_SLOT_X, PA_LANE_X, PA_SLOT_Z, ROW_A, ROW_B, WP_SLOT_X } from './plant';

/**
 * What is standing between the bays.
 *
 * The buffers are drawn as real parts on real rails rather than as counters,
 * because the thing a player needs to read off a line is the flow: how much is
 * queued where, and which of the two part types the line is short of.
 */

/** The weld buffer: a queue whose contents and order are both readable. */
export function WeldBuffer({ queue }: { queue: string }) {
  return (
    <group position={[0, 0, ROW_A]}>
      {WP_SLOT_X.map((x, i) => (
        // Cross-loaded, the way a buffer rail between two stations really is:
        // the parts sit square to the flow so three of them fit in 5 m of aisle.
        <group key={x} position={[x, 0, 2.4]} rotation={[0, Math.PI / 2, 0]}>
          <PartStand w={3.4} d={2.0} />
          {queue[i] !== undefined && (
            <group position={[0, 0.34, 0]}>
              <LoosePart code={queue[i]} finish="bare" />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * The painted buffers, two lanes running across the plant into final assembly.
 *
 * This is the picture the whole category is about. One lane full and the other
 * empty *is* the wrong-mix failure, standing there in the middle of the floor
 * several seconds before the starve latch trips.
 */
export function PaintedBuffers({ frames, booms }: { frames: number; booms: number }) {
  const lane = (x: number, count: number, code: string) => (
    <group position={[x, 0, 0]}>
      {PA_SLOT_Z.map((z, i) => (
        // These lanes run in z, so the parts lie nose-to-tail along them.
        <group key={z} position={[0, 0, z]} rotation={[0, Math.PI / 2, 0]}>
          <PartStand w={3.4} d={2.0} />
          {i < count && (
            <group position={[0, 0.34, 0]}>
              <LoosePart code={code} finish="painted" />
            </group>
          )}
        </group>
      ))}
    </group>
  );
  return (
    <>
      {lane(PA_LANE_X.f, frames, 'f')}
      {lane(PA_LANE_X.b, booms, 'b')}
    </>
  );
}

/** Finished machines waiting for the test bay. */
export function TestQueue({ count }: { count: number }) {
  return (
    <group position={[0, 0, ROW_B]}>
      {AT_SLOT_X.map((x, i) => (
        <group key={x} position={[x, 0, 0]}>
          {i < count && (
            <group rotation={[0, Math.PI, 0]}>
              <Excavator finish="painted" boomAngle={0.3} stickAngle={-1.8} bucketAngle={-0.4} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}
