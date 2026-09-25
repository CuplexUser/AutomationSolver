import { useLayoutEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { DRACO_DECODER_PATH } from '../MachineCanvas';
import { KitMachine, KitPart, kitTemplates, paintMaterial, type BoomPose, type KitPaint } from './kit';

/** Base-relative, so a Pages or sub-path deploy finds it. */
export const EXCAVATOR_KIT_URL = `${import.meta.env.BASE_URL}models/excavator-kit.glb`;

function useTemplates() {
  const { scene } = useGLTF(EXCAVATOR_KIT_URL, DRACO_DECODER_PATH);
  return kitTemplates(scene);
}

/** A loose frame or a folded boom, in whatever paint it has. */
export function ExcavatorPart({ kind, paint, scale = 1 }: { kind: 'f' | 'b'; paint: KitPaint; scale?: number }) {
  const t = useTemplates();
  const part = useMemo(() => new KitPart(t, kind), [t, kind]);
  useLayoutEffect(() => {
    part.paint(paintMaterial(paint));
  }, [part, paint]);
  return <primitive object={part.group} scale={scale} />;
}

/**
 * A whole machine, at whatever stage of its build it has reached. Each fitting is
 * a 0..1 progress, because watching one go on is the assembly jig's whole
 * subject; `arm` poses the boom, stick and bucket off the kit's rest stance.
 */
export function ExcavatorMachine({
  paint,
  boomPaint,
  engine = 1,
  cab = 1,
  boom = 1,
  arm,
  scale = 1,
}: {
  paint: KitPaint;
  /** The boom's own paint, which on a mis-married machine is not the frame's. */
  boomPaint?: KitPaint;
  engine?: number;
  cab?: number;
  boom?: number;
  arm?: BoomPose;
  scale?: number;
}) {
  const t = useTemplates();
  const machine = useMemo(() => new KitMachine(t), [t]);
  useLayoutEffect(() => {
    machine.paint(paintMaterial(paint), paintMaterial(boomPaint ?? paint));
  }, [machine, paint, boomPaint]);
  const lift = arm?.lift ?? 0;
  const stick = arm?.stick ?? 0;
  const bucket = arm?.bucket ?? 0;
  useLayoutEffect(() => {
    machine.pose({ engine, cab, boom, arm: { lift, stick, bucket } });
  }, [machine, engine, cab, boom, lift, stick, bucket]);
  return <primitive object={machine.group} scale={scale} />;
}

useGLTF.preload(EXCAVATOR_KIT_URL, DRACO_DECODER_PATH);
