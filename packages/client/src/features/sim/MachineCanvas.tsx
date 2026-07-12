import { Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

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
  children,
}: {
  height?: number;
  cameraPosition: [number, number, number];
  fov?: number;
  target: [number, number, number];
  minDistance: number;
  maxDistance: number;
  polarAngle?: number;
  children: ReactNode;
}) {
  return (
    <div className="machine3d" style={{ height }}>
      <Canvas camera={{ position: cameraPosition, fov }} shadows={false}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1.6} />
        <directionalLight position={[-6, 4, -4]} intensity={0.4} />
        <Suspense fallback={null}>{children}</Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          minPolarAngle={polarAngle}
          maxPolarAngle={polarAngle}
          minDistance={minDistance}
          maxDistance={maxDistance}
          target={target}
        />
      </Canvas>
      <span className="machine3d-hint">drag to rotate · scroll to zoom</span>
    </div>
  );
}
