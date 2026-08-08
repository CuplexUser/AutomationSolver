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

/**
 * The half-size of the scene, in scene units, that the camera must show.
 *
 * A fixed `cameraPosition` frames whatever the panel's aspect ratio happened to
 * be when it was tuned, so a wide machine gets cropped the moment the layout is
 * narrower than that. Giving the extent instead lets the distance be *derived*
 * from the live viewport: the scene is always fully in frame, at any panel size.
 */
export interface FitExtent {
  halfWidth: number;
  halfHeight: number;
}

/**
 * Dollies the camera along its current view direction until `extent` fits.
 *
 * Distance only, and only ever *outward* — the direction is read back from
 * wherever the player has orbited to, and a re-fit on resize pushes the camera
 * back until the scene fits again without undoing a zoom they chose. Pulling in
 * to the ideal distance would fight every drag of the workspace divider.
 */
function FitCamera({ extent, target }: { extent: FitExtent; target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const [tx, ty, tz] = target;
  const { halfWidth, halfHeight } = extent;

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera || width === 0 || height === 0) return;
    const vTan = Math.tan((cam.fov * Math.PI) / 360);
    const hTan = vTan * (width / height);
    const dist = Math.max(halfWidth / hTan, halfHeight / vTan);
    const focus = new THREE.Vector3(tx, ty, tz);
    const dir = cam.position.clone().sub(focus);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    if (dir.length() >= dist) return;
    cam.position.copy(focus).addScaledVector(dir.normalize(), dist);
  }, [camera, width, height, halfWidth, halfHeight, tx, ty, tz]);

  return null;
}

/** Scene-space box the view center is confined to while panning. */
export interface PanBounds {
  x: [min: number, max: number];
  y: [min: number, max: number];
  /** Optional depth clamp — useful when rotation is enabled, since screen-plane
      panning then moves the target in world z too. */
  z?: [min: number, max: number];
}

// Structural type for the OrbitControls instance delivered by its change
// event — avoids depending on three-stdlib (a transitive dep) for the class.
interface ControlsLike {
  target: { x: number; y: number; z: number };
  object: { position: { x: number; y: number; z: number } };
}

const clamp = (v: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, v));

/**
 * Shared Canvas/lighting/OrbitControls rig for the puzzle-specific 3D machine
 * scenes (drill station, elevator shaft, ...). By default the polar angle is
 * locked so dragging only rotates azimuth and scrolling only zooms — the same
 * drag-to-rotate, scroll-to-zoom contract the original per-scene setups each
 * defined inline; pass `polarRange` to let the drag tilt the elevation too.
 */
export function MachineCanvas({
  height = 300,
  cameraPosition,
  fov = 35,
  target,
  minDistance,
  maxDistance,
  polarAngle = 0.75,
  polarRange,
  interactive = true,
  zoomable = false,
  panBounds,
  fitExtent,
  shadowExtent = 16,
  children,
}: {
  /** A CSS length: the single-machine panels want a fixed 300, the plant
      workspace wants to fill whatever the floating windows leave it. */
  height?: number | string;
  cameraPosition: [number, number, number];
  fov?: number;
  target: [number, number, number];
  minDistance?: number;
  maxDistance?: number;
  polarAngle?: number;
  /** Frees the viewing elevation: drag tilts between these polar angles
      (radians from vertical) instead of being locked to `polarAngle`. */
  polarRange?: [min: number, max: number];
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
  /**
   * Frames the scene from the live viewport instead of trusting
   * `cameraPosition`'s distance. Keep `maxDistance` above the widest fit this
   * can ask for, or OrbitControls will pull the camera back in and re-crop.
   */
  fitExtent?: FitExtent;
  /**
   * Half-size of the shadow camera's box. The default frames a single machine;
   * a whole plant floor needs it widened, or half the scene falls outside the
   * map and its shadows simply stop at a line across the floor.
   */
  shadowExtent?: number;
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
    const dz = panBounds.z ? clamp(controls.target.z, panBounds.z) - controls.target.z : 0;
    if (dx === 0 && dy === 0 && dz === 0) return;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.target.z += dz;
    controls.object.position.x += dx;
    controls.object.position.y += dy;
    controls.object.position.z += dz;
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
        {fitExtent && <FitCamera extent={fitExtent} target={target} />}
        {/* Sky/ground hemisphere instead of flat ambient, plus one shadow-casting
            key light — the raking sun is what gives walls their nuance. */}
        <hemisphereLight color="#dbe8ff" groundColor="#8a7a6a" intensity={0.5} />
        <directionalLight
          position={[10, 16, 9]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowExtent}
          shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent}
          shadow-camera-bottom={-shadowExtent}
          shadow-camera-near={0.5}
          shadow-camera-far={shadowExtent * 4 + 20}
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
            minPolarAngle={polarRange ? polarRange[0] : polarAngle}
            maxPolarAngle={polarRange ? polarRange[1] : polarAngle}
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
