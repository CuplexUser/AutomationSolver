import { memo } from 'react';
import { DARK_STEEL, FINISH, GUARD, RUBBER, type Finish } from './plant';

/**
 * The excavator, in the pieces the line builds it from.
 *
 * The same machine is visible at every stage of its own build — a bare weldment
 * in the fixture, a yellow shell coming out of the oven, a machine growing an
 * engine and a cab and a boom in the jig, and finally something that moves under
 * its own hydraulics on the test pad. That progression is why this is built
 * procedurally rather than imported: a station needs to turn parts on and off
 * and recolor them, which is a node-toggling chore in a glTF and a plain
 * function of machine state here.
 */

/**
 * Undercarriage: tracks, car body and slew ring. This is the "frame" the weld
 * shop makes, the part the paint shop hangs on the frames lane, and the thing
 * that has to be in the jig before an engine can be lowered onto it.
 */
export const ExcavatorFrame = memo(function ExcavatorFrame({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group>
      {[-0.86, 0.86].map((z) => (
        <group key={z} position={[0, 0.36, z]}>
          {/* Track belt, drawn as a slab with a roller at each end. */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[3.1, 0.66, 0.58]} />
            <meshStandardMaterial {...RUBBER} />
          </mesh>
          {[-1.55, 1.55].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.33, 0.33, 0.58, 20]} />
              <meshStandardMaterial {...RUBBER} />
            </mesh>
          ))}
          {/* Track frame: the welded steel the belt runs on. */}
          <mesh position={[0, 0.16, 0]} castShadow>
            <boxGeometry args={[3.5, 0.3, 0.4]} />
            <meshStandardMaterial {...mat} />
          </mesh>
        </group>
      ))}
      {/* Car body between the tracks, and the slew ring on top of it. */}
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.34, 1.6]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.78, 0.86, 0.2, 28]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    </group>
  );
});

/**
 * Boom, stick and bucket as one weldment — the second part stream, and the
 * reason a shop that only welds frames ships nothing.
 *
 * The angles are arguments because the same geometry is a dead lump on a stand
 * in the paint shop and a working arm on the test pad.
 */
export const ExcavatorBoom = memo(function ExcavatorBoom({
  finish,
  boom = 0.55,
  stick = -1.45,
  bucket = -0.9,
}: {
  finish: Finish;
  boom?: number;
  stick?: number;
  bucket?: number;
}) {
  const mat = FINISH[finish];
  return (
    <group rotation={[0, 0, boom]}>
      {/* Main boom: a box section that tapers toward the knuckle. */}
      <mesh position={[1.15, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.42, 0.36]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Lift ram, slung underneath. */}
      <mesh position={[0.8, -0.34, 0.28]} rotation={[0, 0, Math.PI / 2 + 0.16]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 1.5, 12]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Knuckle plate where the stick pins on. */}
      <mesh position={[2.35, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.42, 14]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      <group position={[2.35, 0.05, 0]} rotation={[0, 0, stick]}>
        <mesh position={[0.85, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.34, 0.3]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        {/* Bucket ram along the top of the stick. */}
        <mesh position={[0.75, 0.3, 0]} rotation={[0, 0, Math.PI / 2 - 0.1]} castShadow>
          <cylinderGeometry args={[0.075, 0.075, 1.3, 10]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
        <group position={[1.72, 0, 0]} rotation={[0, 0, bucket]}>
          {/* Bucket: a back plate, a floor and five teeth. */}
          <mesh position={[0.26, -0.18, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.62, 0.52, 0.86]} />
            <meshStandardMaterial {...mat} />
          </mesh>
          {[-0.32, -0.16, 0, 0.16, 0.32].map((z) => (
            <mesh key={z} position={[0.62, -0.34, z]} rotation={[0, 0, -Math.PI / 2]} castShadow>
              <coneGeometry args={[0.055, 0.22, 6]} />
              <meshStandardMaterial {...DARK_STEEL} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
});

/** Engine house and counterweight — the "engine" step in the assembly jig. */
export const ExcavatorHouse = memo(function ExcavatorHouse({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group>
      <mesh position={[-0.45, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.1, 0.92, 1.68]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Counterweight: cast, unpainted, and noticeably darker. */}
      <mesh position={[-1.62, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 1.0, 1.6]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Exhaust stack, so the house has a silhouette from above. */}
      <mesh position={[-0.2, 1.12, -0.52]} castShadow>
        <cylinderGeometry args={[0.08, 0.09, 0.42, 12]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {/* Walkway handrail along the top of the house: the one detail that makes
          the read of scale correct, because a rail is always about a metre. */}
      <group position={[-0.45, 1.08, 0]}>
        {[-0.8, 0.8].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 0.42, 0]} castShadow={false}>
              <boxGeometry args={[1.9, 0.05, 0.05]} />
              <meshStandardMaterial {...GUARD} />
            </mesh>
            {[-0.85, 0, 0.85].map((x) => (
              <mesh key={x} position={[x, 0.21, 0]} castShadow={false}>
                <boxGeometry args={[0.05, 0.42, 0.05]} />
                <meshStandardMaterial {...GUARD} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {/* Access steps up the side, under the cab door. */}
      {[0, 1].map((i) => (
        <mesh key={i} position={[0.35 - i * 0.02, 0.06 + i * 0.28, 0.92]} castShadow>
          <boxGeometry args={[0.5, 0.06, 0.26]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
    </group>
  );
});

/** Operator cab, glazed on three sides. */
export const ExcavatorCab = memo(function ExcavatorCab({ finish }: { finish: Finish }) {
  const mat = FINISH[finish];
  return (
    <group position={[0.62, 0.62, 0.44]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.98, 1.18, 0.94]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      {/* Glazing, inset a hair so it never z-fights the shell it sits in. */}
      <mesh position={[0.5, 0.12, 0]}>
        <boxGeometry args={[0.02, 0.78, 0.8]} />
        <meshPhysicalMaterial
          color="#9fd4ea"
          transparent
          opacity={0.42}
          roughness={0.08}
          metalness={0}
          clearcoat={0.7}
        />
      </mesh>
      <mesh position={[0, 0.12, 0.48]}>
        <boxGeometry args={[0.82, 0.78, 0.02]} />
        <meshPhysicalMaterial
          color="#9fd4ea"
          transparent
          opacity={0.42}
          roughness={0.08}
          metalness={0}
        />
      </mesh>
    </group>
  );
});

/**
 * The whole machine, at whatever stage of completion it has reached.
 *
 * Each fitting is a 0..1 progress rather than a flag, because the assembly jig's
 * whole subject is watching one go on: the engine descends from the gantry, the
 * cab lands on the deck, the boom swings down onto its pin.
 */
export function Excavator({
  finish,
  engine = 1,
  cab = 1,
  boomFit = 1,
  boomAngle = 0.55,
  stickAngle = -1.45,
  bucketAngle = -0.9,
}: {
  finish: Finish;
  /** 0..1 fittings. Below 1 the part is still on its way down. */
  engine?: number;
  cab?: number;
  boomFit?: number;
  boomAngle?: number;
  stickAngle?: number;
  bucketAngle?: number;
}) {
  return (
    <group>
      <ExcavatorFrame finish={finish} />
      {engine > 0 && (
        <group position={[0, 1.05 + (1 - engine) * 2.6, 0]}>
          <ExcavatorHouse finish={finish} />
        </group>
      )}
      {cab > 0 && (
        <group position={[0, 1.05 + (1 - cab) * 3.0, 0]}>
          <ExcavatorCab finish={finish} />
        </group>
      )}
      {boomFit > 0 && (
        // Un-pinned, the boom hangs from the gantry above and behind its pivot,
        // rotated back — so "pinning" is visibly the arm coming down onto the eye.
        <group position={[1.05, 1.35 + (1 - boomFit) * 1.9, 0]} rotation={[0, 0, (1 - boomFit) * 0.7]}>
          <ExcavatorBoom
            finish={finish}
            boom={boomAngle}
            stick={stickAngle}
            bucket={bucketAngle}
          />
        </group>
      )}
    </group>
  );
}

/** A part in transit, drawn as whichever of the two things it is. */
export function LoosePart({ code, finish }: { code: string; finish: Finish }) {
  if (code === 'b') {
    // A loose boom lies folded on a stand rather than standing up in the air.
    return (
      <group position={[-1.2, 0.72, 0]}>
        <ExcavatorBoom finish={finish} boom={0.06} stick={-0.18} bucket={-0.35} />
      </group>
    );
  }
  return <ExcavatorFrame finish={finish} />;
}

/** The trestle a loose part sits on between stations. */
export const PartStand = memo(function PartStand({ w = 2.4, d = 1.9 }: { w?: number; d?: number }) {
  return (
    <group>
      {/* Mid steel deck with yellow edge rails. An empty stand still has to read
          as an empty *space in the queue* rather than as floor, but painting the
          whole deck yellow put six bright slabs across the plant view and they
          out-shouted the four bays. Trim carries it; area does not. */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.12, d]} />
        <meshStandardMaterial color="#5c6673" metalness={0.5} roughness={0.6} />
      </mesh>
      {[-d / 2 + 0.3, d / 2 - 0.3].map((z) => (
        <mesh key={z} position={[0, 0.36, z]} castShadow>
          <boxGeometry args={[w - 0.2, 0.1, 0.16]} />
          <meshStandardMaterial {...GUARD} />
        </mesh>
      ))}
      {[
        [-w / 2 + 0.16, -d / 2 + 0.16],
        [w / 2 - 0.16, -d / 2 + 0.16],
        [-w / 2 + 0.16, d / 2 - 0.16],
        [w / 2 - 0.16, d / 2 - 0.16],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.11, z]} castShadow>
          <boxGeometry args={[0.13, 0.22, 0.13]} />
          <meshStandardMaterial {...DARK_STEEL} />
        </mesh>
      ))}
    </group>
  );
});
