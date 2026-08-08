import { memo } from 'react';
import { FLOOR } from './plant';
import type { Textures } from './textures';

export const Building = memo(function Building({ tex }: { tex: Textures }) {
  const w = FLOOR.x1 - FLOOR.x0;
  const d = FLOOR.z1 - FLOOR.z0;
  const cx = (FLOOR.x0 + FLOOR.x1) / 2;
  const cz = (FLOOR.z0 + FLOOR.z1) / 2;
  const WALL_H = 7.2;
  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.concrete} roughness={0.96} metalness={0} />
      </mesh>

      {/* Two walls only: the far one and the left one. Boxing the plant in on
          all four sides would put a wall between the camera and the machine at
          every orbit angle the player is likely to want.

          There is deliberately no roof and there are deliberately no trusses.
          The first version had a run of them overhead, and from the plant view
          they striped the entire floor with hard shadows — the plant was read
          through a set of bars. Overhead structure is exactly the thing a
          top-down camera cannot afford. */}
      <mesh position={[cx, WALL_H / 2, FLOOR.z0]} receiveShadow>
        <planeGeometry args={[w, WALL_H]} />
        <meshStandardMaterial color="#333c48" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[FLOOR.x0, WALL_H / 2, cz]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[d, WALL_H]} />
        <meshStandardMaterial color="#2c343f" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* A band of clerestory glazing high up, and the eaves beam under it. The
          two together are what make a flat plane read as the wall of a shed
          rather than as the edge of the world. */}
      <mesh position={[cx, WALL_H - 1.1, FLOOR.z0 + 0.05]}>
        <planeGeometry args={[w - 1, 1.5]} />
        <meshStandardMaterial
          color="#8fb4cf"
          emissive="#7ba0bd"
          emissiveIntensity={0.55}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[cx, WALL_H - 2.1, FLOOR.z0 + 0.12]} castShadow={false}>
        <boxGeometry args={[w, 0.34, 0.24]} />
        <meshStandardMaterial color="#4b5563" metalness={0.4} roughness={0.7} />
      </mesh>
      {/* Stanchions down the back wall, flat against it so they cast nothing
          onto the floor the player is trying to read. */}
      {Array.from({ length: 8 }, (_, i) => {
        const x = FLOOR.x0 + 2 + (i * (w - 4)) / 7;
        return (
          <mesh key={x} position={[x, WALL_H / 2, FLOOR.z0 + 0.14]} castShadow={false}>
            <boxGeometry args={[0.26, WALL_H, 0.26]} />
            <meshStandardMaterial color="#414b58" metalness={0.35} roughness={0.75} />
          </mesh>
        );
      })}
    </group>
  );
});
