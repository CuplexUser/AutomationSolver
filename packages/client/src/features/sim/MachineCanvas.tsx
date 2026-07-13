import { Suspense, useEffect, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, type OrbitControlsChangeEvent } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Pass as the second argument of every useGLTF/useGLTF.preload call. Points
 * drei's DRACOLoader at the decoder served by the local-draco-decoder plugin
 * in vite.config.ts instead of its default Google-CDN URL.
 */
export const DRACO_DECODER_PATH = '/draco/';

/**
 * Marks every opaque mesh under `root` as a shadow caster/receiver — glTF
 * meshes default to neither. Transparent surfaces (the shaft glass) are left
 * out: three's shadow maps are binary, so glass would cast a solid shadow.
 * Call once from the scene component's setup memo.
 */
export function enableShadows(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const transparent = (mesh.material as THREE.Material | undefined)?.transparent === true;
    mesh.castShadow = !transparent;
    mesh.receiveShadow = !transparent;
  });
}

/**
 * Image-based lighting from three's procedural RoomEnvironment (no HDR asset
 * to download). Without an environment map, metallic PBR materials have
 * nothing to reflect and render as flat dark shapes.
 */
function SceneEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    /* eslint-disable react-hooks/immutability -- syncing the three.js scene with React is the standard r3f pattern */
    scene.environment = envTex;
    // Kept low so the shadow-casting key light dominates and surfaces shade
    // directionally instead of being evenly washed by the environment.
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      /* eslint-enable react-hooks/immutability */
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Scene-space box the view center is confined to while panning. */
export interface PanBounds {
  x: [min: number, max: number];
  y: [min: number, max: number];
}

// Structural type for the OrbitControls instance delivered by its change
// event — avoids depending on three-stdlib (a transitive dep) for the class.
interface ControlsLike {
  target: { x: number; y: number };
  object: { position: { x: number; y: number } };
}

const clamp = (v: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, v));

/**
 * Shared Canvas/lighting/OrbitControls rig for the puzzle-specific 3D machine
 * scenes (drill station, elevator shaft, ...). Locks polar angle so dragging
 * only rotates azimuth and scrolling only zooms — the same drag-to-rotate,
 * scroll-to-zoom contract the original per-scene setups each defined inline.
 */
export function MachineCanvas({
  height = 300,
  cameraPosition,
  fov = 35,
  target,
  minDistance,
  maxDistance,
  polarAngle = 0.75,
  interactive = true,
  zoomable = false,
  panBounds,
  children,
}: {
  height?: number;
  cameraPosition: [number, number, number];
  fov?: number;
  target: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
  polarAngle?: number;
  /** Full drag-to-rotate + scroll-to-zoom (the drill station's contract). */
  interactive?: boolean;
  /** Fixed camera angle, but scroll still zooms — ignored when `interactive`. */
  zoomable?: boolean;
  /**
   * Enables screen-plane panning, keeping the view center inside these
   * scene-space bounds so the model can never be dragged out of the viewport.
   * When not `interactive`, left-drag pans.
   */
  panBounds?: PanBounds;
  children: ReactNode;
}) {
  const showControls = interactive || zoomable || !!panBounds;

  // Clamp the pan target and shift the camera by the same delta so the view
  // direction is preserved — clamping only the target would tilt the camera.
  const clampPan = (event?: OrbitControlsChangeEvent) => {
    if (!panBounds || !event) return;
    const controls = event.target as unknown as ControlsLike;
    const dx = clamp(controls.target.x, panBounds.x) - controls.target.x;
    const dy = clamp(controls.target.y, panBounds.y) - controls.target.y;
    if (dx === 0 && dy === 0) return;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.object.position.x += dx;
    controls.object.position.y += dy;
  };

  const hint = [
    interactive ? 'drag to rotate' : panBounds ? 'drag to pan' : null,
    interactive && panBounds ? 'right-drag to pan' : null,
    interactive || zoomable ? 'scroll to zoom' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="machine3d" style={{ height }}>
      <Canvas
        camera={{ position: cameraPosition, fov }}
        shadows
        // Khronos "PBR Neutral" tone mapping: compresses highlights without
        // the saturation push ACES gives strong albedos like the terracotta.
        gl={{ toneMapping: THREE.NeutralToneMapping }}
        onCreated={({ camera }) => camera.lookAt(...target)}
      >
        <SceneEnvironment />
        {/* Sky/ground hemisphere instead of flat ambient, plus one shadow-casting
            key light — the raking sun is what gives walls their nuance. */}
        <hemisphereLight color="#dbe8ff" groundColor="#8a7a6a" intensity={0.5} />
        <directionalLight
          position={[10, 16, 9]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-16}
          shadow-camera-right={16}
          shadow-camera-top={16}
          shadow-camera-bottom={-16}
          shadow-camera-near={0.5}
          shadow-camera-far={60}
          shadow-normalBias={0.04}
        />
        <directionalLight position={[-6, 4, -4]} intensity={0.25} />
        <Suspense fallback={null}>{children}</Suspense>
        {showControls && (
          <OrbitControls
            makeDefault
            enablePan={!!panBounds}
            screenSpacePanning
            enableRotate={interactive}
            enableZoom={interactive || zoomable}
            minPolarAngle={polarAngle}
            maxPolarAngle={polarAngle}
            minDistance={minDistance}
            maxDistance={maxDistance}
            target={target}
            mouseButtons={
              !interactive && panBounds
                ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
                : undefined
            }
            onChange={clampPan}
          />
        )}
      </Canvas>
      {hint && <span className="machine3d-hint">{hint}</span>}
    </div>
  );
}
