import { memo } from 'react';
import { clamp01, DARK_STEEL } from './plant';

/** Readable analog: a wall gauge with its acceptance band marked, and a stack light. */

/**
 * A bar gauge with the good band painted on it.
 *
 * The paint booth's two analog values both have a *window* rather than a
 * target, and a window is the one thing a bare number on an HMI does not say.
 * Drawing the band on the scale means "too cold" and "too much film" are things
 * the player sees rather than things they work out.
 */
const GaugeBody = memo(function GaugeBody({
  bandLo,
  bandHi,
  h,
}: {
  bandLo: number;
  bandHi: number;
  h: number;
}) {
  const bandH = (bandHi - bandLo) * h;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[0.34, h, 0.1]} />
        <meshStandardMaterial color="#1b2029" roughness={0.8} metalness={0.2} />
      </mesh>
      <mesh position={[0, bandLo * h + bandH / 2, 0.055]}>
        <planeGeometry args={[0.34, bandH]} />
        <meshStandardMaterial color="#1f7a4d" emissive="#166534" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
});

export function BarGauge({
  position,
  value,
  bandLo,
  bandHi,
  h = 1.6,
  rotY = 0,
}: {
  position: [number, number, number];
  /** 0..1 of full scale. */
  value: number;
  bandLo: number;
  bandHi: number;
  h?: number;
  rotY?: number;
}) {
  const v = clamp01(value);
  const inBand = v >= bandLo && v <= bandHi;
  const fill = Math.max(0.001, v * h);
  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <GaugeBody bandLo={bandLo} bandHi={bandHi} h={h} />
      <mesh position={[0, fill / 2, 0.07]}>
        <boxGeometry args={[0.16, fill, 0.04]} />
        <meshStandardMaterial
          color={inBand ? '#4ade80' : '#f87171'}
          emissive={inBand ? '#22c55e' : '#dc2626'}
          emissiveIntensity={0.9}
        />
      </mesh>
    </group>
  );
}

/** A stack light, which is how a real bay says what it is doing from 30 m away. */
export function StackLight({
  position,
  green,
  amber,
  red,
}: {
  position: [number, number, number];
  green: boolean;
  amber: boolean;
  red: boolean;
}) {
  const lamps: Array<[string, boolean]> = [
    ['#ef4444', red],
    ['#f59e0b', amber],
    ['#22c55e', green],
  ];
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.8, 10]} />
        <meshStandardMaterial {...DARK_STEEL} />
      </mesh>
      {lamps.map(([color, on], i) => (
        <mesh key={color} position={[0, 2.02 + i * 0.26, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.24, 14]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={on ? 1.6 : 0.04}
            roughness={0.4}
            transparent
            opacity={on ? 1 : 0.5}
          />
        </mesh>
      ))}
    </group>
  );
}
