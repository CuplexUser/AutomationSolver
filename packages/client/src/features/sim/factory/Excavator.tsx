import { memo } from 'react';
import { ExcavatorMachine, ExcavatorPart } from '../excavator/KitExcavator';
import { DARK_STEEL, FINISH, GUARD, type Finish } from './plant';

/**
 * The excavator, from the kit (`excavator/kit.ts`), at the tutorial plant's scale.
 *
 * The same machine is visible at every stage of its own build — a bare weldment
 * in the fixture, a painted shell coming out of the oven, a machine growing an
 * engine and a cab and a boom in the jig, and finally something that works its
 * arm on the test pad. The kit is posed rather than rebuilt for each of those,
 * so this file only maps the plant's finishes and angles onto it.
 */

/** The tutorial floor is laid out for a larger machine than the line's conveyor carries. */
const PLANT_SCALE = 1.3;

/** The kit's rest stance, in the angles this plant's callers were written against. */
const REST = { boom: 0.55, stick: -1.45, bucket: -0.9 } as const;

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
  boomAngle = REST.boom,
  stickAngle = REST.stick,
  bucketAngle = REST.bucket,
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
    <ExcavatorMachine
      paint={FINISH[finish]}
      engine={engine}
      cab={cab}
      boom={boomFit}
      arm={{ lift: boomAngle - REST.boom, stick: stickAngle - REST.stick, bucket: bucketAngle - REST.bucket }}
      scale={PLANT_SCALE}
    />
  );
}

/** A part in transit, drawn as whichever of the two things it is: a frame, or a boom folded for the stand. */
export function LoosePart({ code, finish }: { code: string; finish: Finish }) {
  return <ExcavatorPart kind={code === 'b' ? 'b' : 'f'} paint={FINISH[finish]} scale={PLANT_SCALE} />;
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
