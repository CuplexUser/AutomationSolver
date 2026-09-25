import { memo, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type * as THREE from 'three';
import { DRACO_DECODER_PATH } from '../MachineCanvas';
import { Static, staticPart } from '../StaticBatch';
import { plantTemplate, splitOut, type PlantAssetName } from './kit';

/** Base-relative, so a Pages or sub-path deploy finds it. */
export const PLANT_KIT_URL = `${import.meta.env.BASE_URL}models/plant-kit.glb`;

/**
 * Readies a fresh clone before it is drawn: gives it a material of its own, a
 * texture, a stretch. Pass a function defined once at module level (and an
 * `arg` that is a primitive or a stable object), since both are memo keys.
 */
export type Prepare<A> = (obj: THREE.Object3D, arg: A) => void;

function copyOf<A>(scene: THREE.Object3D, name: PlantAssetName, prepare?: Prepare<A>, arg?: A): THREE.Object3D {
  const obj = plantTemplate(scene, name).clone(true);
  prepare?.(obj, arg as A);
  return obj;
}

/** A fresh copy of one kit asset, sharing the bake's geometry and materials. */
export function usePlantClone<A = undefined>(name: PlantAssetName, prepare?: Prepare<A>, arg?: A): THREE.Object3D {
  const { scene } = useGLTF(PLANT_KIT_URL, DRACO_DECODER_PATH);
  return useMemo(() => copyOf(scene, name, prepare, arg), [scene, name, prepare, arg]);
}

/**
 * A copy split in two: `body`, which never changes and can be batched, and
 * `live`, the pivots and the meshes in the materials named, which the scene
 * poses, lights or tints. Pass `live` as a module-level constant.
 */
export function usePlantSplit<A = undefined>(
  name: PlantAssetName,
  live: readonly string[],
  prepare?: Prepare<A>,
  arg?: A,
): { body: THREE.Object3D; live: THREE.Object3D } {
  const { scene } = useGLTF(PLANT_KIT_URL, DRACO_DECODER_PATH);
  return useMemo(() => {
    const body = copyOf(scene, name, prepare, arg);
    return { body, live: splitOut(body, [...live]) };
  }, [scene, name, live, prepare, arg]);
}

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  /** Turn about the vertical, radians. */
  rotY?: number;
  scale?: number | [number, number, number];
}

export interface PieceProps<A = undefined> extends Placement {
  name: PlantAssetName;
  prepare?: Prepare<A>;
  arg?: A;
}

/** One kit asset, set down where it goes. Live: for anything the scene poses or lights. */
export function PlantPiece<A = undefined>({ name, prepare, arg, x = 0, y = 0, z = 0, rotY = 0, scale = 1 }: PieceProps<A>) {
  const obj = usePlantClone(name, prepare, arg);
  return <primitive object={obj} position={[x, y, z]} rotation={[0, rotY, 0]} scale={scale} />;
}

/** One kit asset that never changes after mount, baked into the scene's static batch. */
export const StaticPiece = memo(staticPart(PlantPiece)) as typeof PlantPiece;

/** A split asset set down: its body batched, its live meshes drawn on their own. */
export function SplitPiece({
  body,
  live,
  x = 0,
  y = 0,
  z = 0,
  rotY = 0,
  scale = 1,
}: Placement & { body: THREE.Object3D; live: THREE.Object3D }) {
  return (
    <group position={[x, y, z]} rotation={[0, rotY, 0]} scale={scale}>
      <Static>
        <primitive object={body} />
      </Static>
      <primitive object={live} />
    </group>
  );
}

useGLTF.preload(PLANT_KIT_URL, DRACO_DECODER_PATH);
