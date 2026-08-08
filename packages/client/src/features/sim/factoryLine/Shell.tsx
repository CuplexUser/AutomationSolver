import { memo } from 'react';
import { AISLE, FLOOR, GLASS, SERVICE_Y, WALL_H } from './plant';
import { FloorMark, type LineTextures } from './textures';
import { ServiceRun } from './props';

/**
 * The building: slab, two walls, the aisle down the middle, and the services.
 *
 * Two walls only, the north and the west. Boxing the plant in on all four sides
 * would put a wall between the camera and the machine at every orbit angle the
 * player is likely to want, and the low presets all look roughly inward.
 *
 * There is deliberately no roof and there are deliberately no trusses. The old
 * plant shipped with a run of them overhead and, from the plant view, they
 * striped the entire floor with hard shadows — the plant was read through a set
 * of bars. Overhead structure is exactly the thing a top-down camera cannot
 * afford, so the only thing up there is the service run, and it casts nothing.
 */
export const Shell = memo(function Shell({ tex }: { tex: LineTextures }) {
  const w = FLOOR.x1 - FLOOR.x0;
  const d = FLOOR.z1 - FLOOR.z0;
  const mx = (FLOOR.x0 + FLOOR.x1) / 2;
  const mz = (FLOOR.z0 + FLOOR.z1) / 2;
  const aisleZ = (AISLE.z0 + AISLE.z1) / 2;
  const aisleD = AISLE.z1 - AISLE.z0;

  return (
    <group>
      {/* Slab */}
      <mesh position={[mx, 0, mz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={tex.concrete} roughness={0.96} metalness={0} />
      </mesh>

      {/* The walkway: the one place you can see both halves of the line at once,
          and therefore the most useful camera position in the building. */}
      <FloorMark
        tex={tex.walkway}
        x={mx}
        z={aisleZ}
        w={w - 2}
        d={aisleD}
        repeat={[Math.round((w - 2) / 3.2), 1]}
      />

      {/* North wall, behind row A */}
      <mesh position={[mx, WALL_H / 2, FLOOR.z0]} receiveShadow>
        <planeGeometry args={[w, WALL_H]} />
        <meshStandardMaterial color="#2c343f" roughness={0.9} metalness={0.05} />
      </mesh>
      {/* West wall, behind the yard */}
      <mesh
        position={[FLOOR.x0, WALL_H / 2, mz]}
        rotation={[0, Math.PI / 2, 0]}
        receiveShadow
      >
        <planeGeometry args={[d, WALL_H]} />
        <meshStandardMaterial color="#262d37" roughness={0.9} metalness={0.05} />
      </mesh>

      {/* Clerestory glazing and the eaves beam under it. The two together are
          what make a flat plane read as the wall of a shed rather than as the
          edge of the world. */}
      <mesh position={[mx, WALL_H - 1.2, FLOOR.z0 + 0.05]}>
        <planeGeometry args={[w - 1.5, 1.7]} />
        <meshStandardMaterial {...GLASS} emissive="#7ba0bd" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[mx, WALL_H - 2.3, FLOOR.z0 + 0.12]} castShadow={false}>
        <boxGeometry args={[w, 0.36, 0.26]} />
        <meshStandardMaterial color="#46525f" metalness={0.4} roughness={0.7} />
      </mesh>

      {/* Stanchions flat against the wall, so they cast nothing onto the floor
          the player is trying to read. */}
      {Array.from({ length: 11 }, (_, i) => {
        const x = FLOOR.x0 + 2.5 + (i * (w - 5)) / 10;
        return (
          <mesh key={x} position={[x, WALL_H / 2, FLOOR.z0 + 0.15]} castShadow={false}>
            <boxGeometry args={[0.28, WALL_H, 0.28]} />
            <meshStandardMaterial color="#3a4550" metalness={0.35} roughness={0.75} />
          </mesh>
        );
      })}

      {/* Services: one run the length of the aisle, dropping to each cell. */}
      <ServiceRun
        from={[FLOOR.x0 + 2, aisleZ - 1.4]}
        to={[FLOOR.x1 - 2, aisleZ - 1.4]}
        y={SERVICE_Y}
        drops={[
          [-21, aisleZ - 1.4],
          [-6, aisleZ - 1.4],
          [7.5, aisleZ - 1.4],
          [19, aisleZ - 1.4],
        ]}
      />
      <ServiceRun
        from={[FLOOR.x0 + 2, aisleZ + 1.4]}
        to={[FLOOR.x1 - 2, aisleZ + 1.4]}
        y={SERVICE_Y}
        drops={[
          [-12, aisleZ + 1.4],
          [-1, aisleZ + 1.4],
          [15, aisleZ + 1.4],
        ]}
      />
    </group>
  );
});
