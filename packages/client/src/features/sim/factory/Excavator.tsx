import { memo } from 'react';
import { ExcavatorMachine, ExcavatorPart } from '../excavator/KitExcavator';
import { StaticPiece } from '../plant/PlantAsset';
import { FINISH, type Finish } from './plant';

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

/** The deck height a loose part stands at between this plant's stations. */
const STAND_TOP = 0.34;

/** The trestle a loose part sits on between stations: the plant kit's, sized to the queue it is in. */
export const PartStand = memo(function PartStand({ w = 2.4, d = 1.9 }: { w?: number; d?: number }) {
  return <StaticPiece name="PartStand" scale={[w / 2.2, STAND_TOP / 0.6, d / 1.9]} />;
});
