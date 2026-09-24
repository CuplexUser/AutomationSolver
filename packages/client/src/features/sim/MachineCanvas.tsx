import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, type OrbitControlsChangeEvent } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { useSettings } from '../../api/queries';

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
function SceneEnvironment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    /* eslint-disable react-hooks/immutability -- syncing the three.js scene with React is the standard r3f pattern */
    scene.environment = envTex;
    // Kept low so the shadow-casting key light dominates and surfaces shade
    // directionally instead of being evenly washed by the environment.
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      /* eslint-enable react-hooks/immutability */
      envTex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

/**
 * How a scene's ambient occlusion is tuned. `radius` is in scene units and is
 * the reach of the darkening: about the gap between a pallet and the floor it
 * stands on, so it has to follow the scene's scale.
 */
export interface AoSettings {
  radius: number;
  /** 0..1, how much of the occlusion is blended over the lit image. */
  intensity?: number;
}

/**
 * The most of the view's height the occlusion may reach across. A world-space
 * radius that suits the whole floor covers a huge patch of screen once the
 * camera is close, and GTAO's cost grows with the pixels each sample strides
 * over, so zooming in used to slow the frame right down. Capping it as a share
 * of the view keeps the cost flat at any distance and the look the same from
 * the default one.
 */
const AO_MAX_VIEW_SHARE = 0.045;

/**
 * Ground-truth ambient occlusion (three's `GTAOPass`): the soft darkening where
 * a pallet meets the floor, under a rack beam or along a wall's foot, which
 * direct light and a shadow map cannot give. Pure three.js, no extra package.
 *
 * It takes over rendering: a `useFrame` at priority 1 turns off r3f's own
 * render, and the composer draws the scene into a multisampled target, adds the
 * occlusion, then `OutputPass` applies the renderer's tone mapping and sRGB
 * conversion (a render target gets neither, so without it the image goes flat).
 *
 * The occlusion itself is computed at half resolution: it is a soft, low-detail
 * signal, the denoiser blurs it anyway, and it is by far the costliest pass, so
 * a quarter of the pixels is most of the frame time back for no visible change.
 */
function AmbientOcclusion({ radius, intensity = 1 }: AoSettings) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  const { composer, gtao } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
    return { composer, gtao };
  }, [gl, scene, camera]);

  useEffect(() => {
    gtao.updateGtaoMaterial({ distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 16 });
    // The denoiser's reach is in (half-resolution) pixels; this smooths the
    // sampling noise without smearing the occlusion across an edge.
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    // eslint-disable-next-line react-hooks/immutability -- a three.js pass, not React state
    gtao.blendIntensity = intensity;
  }, [gtao, intensity]);

  useEffect(() => {
    const ratio = gl.getPixelRatio();
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    // After the composer, which sizes every pass to the full canvas.
    gtao.setSize(Math.ceil((width * ratio) / 2), Math.ceil((height * ratio) / 2));
  }, [composer, gtao, gl, width, height]);

  useEffect(() => () => composer.dispose(), [composer]);

  const focus = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const controls = state.controls as unknown as { target?: THREE.Vector3 } | null;
    const dist = cam.position.distanceTo(controls?.target ?? focus);
    const viewH = 2 * dist * Math.tan(((cam.fov ?? 35) * Math.PI) / 360);
    gtao.updateGtaoMaterial({ radius: Math.min(radius, viewH * AO_MAX_VIEW_SHARE) });
    composer.render(dt);
  }, 1);
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

/**
 * How a scene is lit. `workshop` is the warm raking light every machine scene
 * was tuned under; `coldStore` is a refrigerated hall under high-bay lamps:
 * a cool key from high over the north-east corner that throws real shadows
 * across the floor, little bounce light, and a dim hall fading into the haze,
 * so the pale panels read against something instead of washing into it.
 */
export type Mood = 'workshop' | 'coldStore';

const MOODS = {
  workshop: {
    sky: '#dbe8ff', ground: '#8a7a6a', hemi: 0.5,
    key: '#ffffff', keyI: 2.2, keyAt: [10, 16, 9],
    fill: 0.25, fillAt: [-6, 4, -4],
    env: 0.45, shadowMap: 2048,
  },
  coldStore: {
    sky: '#b8c7d6', ground: '#39424c', hemi: 0.32,
    key: '#e8f0f8', keyI: 2.9, keyAt: [16, 22, -10],
    fill: 0.14, fillAt: [-10, 6, 14],
    env: 0.28, shadowMap: 3072,
  },
} as const;

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
  mood = 'workshop',
  background,
  ao,
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
  /** The light the scene is shown under. */
  mood?: Mood;
  /** A solid background color, with a haze of the same color toward the far distance. */
  background?: string;
  /**
   * Ambient occlusion for this scene, tuned to its scale. Drawn only while the
   * player's "Realistic 3D rendering" setting is on, which it is by default.
   */
  ao?: AoSettings;
  children: ReactNode;
}) {
  const look = MOODS[mood];
  // Default on: a guest, or a player who never saved settings, gets it too.
  const { data: settings } = useSettings();
  const realistic = settings?.settings.realisticRendering !== false;
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
        // r3f's default allows 2x; on a high-DPI screen that is four times the
        // pixels of 1x for every pass, and a big plant view cannot afford it.
        dpr={[1, 1.5]}
        shadows
        // Khronos "PBR Neutral" tone mapping: compresses highlights without
        // the saturation push ACES gives strong albedos like the terracotta.
        gl={{ toneMapping: THREE.NeutralToneMapping }}
        onCreated={({ camera }) => camera.lookAt(...target)}
      >
        <SceneEnvironment intensity={look.env} />
        {background && <color attach="background" args={[background]} />}
        {background && <fog attach="fog" args={[background, 60, 150]} />}
        {fitExtent && <FitCamera extent={fitExtent} target={target} />}
        {/* Sky/ground hemisphere instead of flat ambient, plus one shadow-casting
            key light — the raking sun is what gives walls their nuance. */}
        <hemisphereLight color={look.sky} groundColor={look.ground} intensity={look.hemi} />
        <directionalLight
          position={look.keyAt}
          color={look.key}
          intensity={look.keyI}
          castShadow
          shadow-mapSize={[look.shadowMap, look.shadowMap]}
          shadow-camera-left={-shadowExtent}
          shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent}
          shadow-camera-bottom={-shadowExtent}
          shadow-camera-near={0.5}
          shadow-camera-far={shadowExtent * 4 + 20}
          shadow-normalBias={0.04}
        />
        <directionalLight position={look.fillAt} intensity={look.fill} />
        <Suspense fallback={null}>{children}</Suspense>
        {ao && realistic && <AmbientOcclusion {...ao} />}
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
