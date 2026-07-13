import { Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, type OrbitControlsChangeEvent } from '@react-three/drei';
import * as THREE from 'three';

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
        shadows={false}
        onCreated={({ camera }) => camera.lookAt(...target)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1.6} />
        <directionalLight position={[-6, 4, -4]} intensity={0.4} />
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
