import { memo, useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FACTORY_LIMITS, type MachineState } from '@automationsolver/shared';
import { meshesIn, node, ownMaterial } from '../plant/kit';
import { PlantPiece, SplitPiece, StaticPiece, usePlantSplit } from '../plant/PlantAsset';
import { LoosePart } from './Excavator';
import { BarGauge, StackLight } from './indicators';
import {
  BOOTH_X,
  boolOf,
  clamp01,
  COUNTS_FULL,
  FINISH,
  numOf,
  OVEN_X,
  ROW_A,
  strOf,
  type Finish,
} from './plant';

/** Booth enclosure and cure oven: two chambers on one heater duct, with the extract stack over the booth. */
const PaintShell = memo(function PaintShell() {
  return (
    <group>
      <StaticPiece name="PaintBoothCompact" x={BOOTH_X} />
      <StaticPiece name="HeaterDuct" x={(BOOTH_X + OVEN_X) / 2} y={2.9} z={-1.4} scale={[OVEN_X - BOOTH_X, 1, 1]} />
      <StaticPiece name="ExtractStack" x={BOOTH_X} y={3.45} z={-1.4} />
      <StaticPiece name="ScrapSkip" x={OVEN_X + 0.4} z={-3.2} />
    </group>
  );
});

/** The oven's viewing slot glows with its temperature; the reciprocator's carriage strokes. */
const OVEN_LIVE = ['Oven Glow'] as const;
const GUN_LIVE = ['GunCarriage'] as const;
/** Where the reciprocator's mast stands in the booth, from its middle. */
const MAST_X = -1.9;
/** The kit gun's nozzle, from the mast; and the middle and half-height of its stroke. */
const NOZZLE_X = 1.48;
const STROKE_MID = 1.6;
const STROKE = 0.6;
/** The kit's reciprocator is built for the line's 4.6 m booth; this one is 3.4 m. */
const RECIP_SCALE = 0.75;

function ownGlow(obj: THREE.Object3D): void {
  ownMaterial(obj, 'Oven Glow', (m) => {
    const glow = m.clone();
    glow.emissive.set('#f59e0b');
    glow.emissiveIntensity = 0.2;
    return glow;
  });
}

interface PaintRefs {
  part: THREE.Group | null;
  fan: THREE.Mesh | null;
  fanMat: THREE.MeshStandardMaterial | null;
  glow: THREE.PointLight | null;
  ovenMat: THREE.MeshStandardMaterial | null;
  carriage?: THREE.Object3D;
}

export function PaintBay({
  machine,
  spraying,
}: {
  machine: MachineState;
  spraying: boolean;
}) {
  const refs = useRef<PaintRefs>({
    part: null,
    fan: null,
    fanMat: null,
    glow: null,
    ovenMat: null,
  });

  const oven = usePlantSplit('CureOvenCompact', OVEN_LIVE, ownGlow);
  const gun = usePlantSplit('SprayReciprocator', GUN_LIVE);
  useLayoutEffect(() => {
    refs.current.ovenMat = (meshesIn(oven.live, 'Oven Glow')[0]?.material as THREE.MeshStandardMaterial) ?? null;
    refs.current.carriage = node(gun.live, 'GunCarriage');
  }, [oven, gun]);

  const stage = strOf(machine.paintStage, 'idle');
  const code = strOf(machine.paintPart);
  const temp = numOf(machine.boothTempM) / 100;
  const film = numOf(machine.filmM) / 100;
  const defect = boolOf(machine.paintDefect);
  const inBand = temp >= FACTORY_LIMITS.CURE_MIN && temp <= FACTORY_LIMITS.CURE_MAX;

  // Where the part stands, and what it looks like there. Blast leaves it matte
  // grey; the yellow arrives as film builds, so the finish is literally the
  // integral the program is controlling.
  const targetX = stage === 'cure' ? OVEN_X : BOOTH_X;
  const filmFrac = clamp01(film / FACTORY_LIMITS.FILM_MAX);
  const finish: Finish =
    defect && stage === 'cure'
      ? 'defect'
      : filmFrac > 0.25
        ? 'painted'
        : stage === 'idle'
          ? 'bare'
          : 'blasted';

  useFrame((state, dt) => {
    const r = refs.current;
    const t = state.clock.elapsedTime;
    // Ease the part between chambers instead of teleporting it: the model moves
    // it in one sub-step, but a machine you can watch has to travel.
    if (r.part) {
      const cur = r.part.position.x;
      r.part.position.x = cur + (targetX - cur) * Math.min(1, dt * 4);
      r.part.visible = stage !== 'idle';
    }
    // The gun strokes up and down the part while it is actually spraying, and parks mid-stroke otherwise.
    const gunY = stage === 'spray' ? STROKE_MID + Math.sin(t * 2.4) * STROKE : STROKE_MID;
    if (r.carriage) r.carriage.position.y = gunY / RECIP_SCALE;
    if (r.fan) {
      r.fan.visible = spraying && stage === 'spray';
      r.fan.position.y = gunY;
    }
    // Paint only sticks inside the cure band, so the fan is drawn thin and pale
    // when the booth is out of it: overspray that is not going to stay on.
    if (r.fanMat) r.fanMat.opacity = inBand ? 0.42 : 0.16;
    // The oven glows with its own temperature, red-hot out of band and amber in.
    const heat = clamp01(temp / COUNTS_FULL);
    if (r.glow) r.glow.intensity = stage === 'cure' ? 2 + heat * 6 : heat * 2.5;
    if (r.ovenMat) {
      r.ovenMat.emissiveIntensity = 0.15 + heat * 1.5;
      r.ovenMat.emissive.set(
        inBand ? '#f59e0b' : temp > FACTORY_LIMITS.CURE_MAX ? '#ef4444' : '#3b82f6',
      );
    }
    // On demand: keep drawing while the gun sweeps or the part is still travelling.
    const easing = r.part !== null && r.part !== undefined && Math.abs(targetX - r.part.position.x) > 0.002;
    if (stage === 'spray' || easing) state.invalidate();
  });

  return (
    <group position={[0, 0, ROW_A]}>
      <PaintShell />

      {/* The oven, its viewing slot glowing with its own temperature, straight off the model. */}
      <SplitPiece body={oven.body} live={oven.live} x={OVEN_X} />
      <pointLight
        ref={(l) => {
          refs.current.glow = l;
        }}
        position={[OVEN_X, 1.6, 0]}
        color="#ffb257"
        distance={7}
        decay={2}
        intensity={0}
      />

      {/* The part being worked, travelling between the two chambers. */}
      <group
        ref={(g) => {
          refs.current.part = g;
        }}
        position={[BOOTH_X, 0.4, 0]}
      >
        {/* The skid the part rides through both chambers on. */}
        <PlantPiece name="BoothSkid" y={-0.4} scale={[1.1, 0.4 / 0.6, 0.92]} />
        <LoosePart code={code} finish={finish} />
      </group>

      {/* Spray gun on its reciprocator, and the fan it lays down: apex at the nozzle. */}
      <SplitPiece body={gun.body} live={gun.live} x={BOOTH_X + MAST_X} scale={[1, RECIP_SCALE, 1]} />
      <mesh
        ref={(m) => {
          refs.current.fan = m;
        }}
        position={[BOOTH_X + MAST_X + NOZZLE_X + 0.65, STROKE_MID, 0]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <coneGeometry args={[0.5, 1.3, 14, 1, true]} />
        <meshStandardMaterial
          ref={(m) => {
            refs.current.fanMat = m;
          }}
          color="#f0b429"
          transparent
          opacity={0.35}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* The two gauges the station is actually programmed against, on the
          booth's front frame where the camera preset puts them in shot. */}
      <BarGauge
        position={[BOOTH_X + 1.45, 0.9, 1.92]}
        value={temp / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.CURE_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.CURE_MAX / COUNTS_FULL}
      />
      <BarGauge
        position={[BOOTH_X + 2.0, 0.9, 1.92]}
        value={film / COUNTS_FULL}
        bandLo={FACTORY_LIMITS.FILM_MIN / COUNTS_FULL}
        bandHi={FACTORY_LIMITS.FILM_MAX / COUNTS_FULL}
      />

      {/* Scrap skip (in the shell): the parts this station spoiled, lying in it where they can be counted. */}
      <group position={[OVEN_X + 0.4, 0, -3.2]}>
        {Array.from({ length: Math.min(4, numOf(machine.scrapped)) }, (_, i) => (
          <mesh key={i} position={[-0.6 + i * 0.4, 0.3 + (i % 2) * 0.12, 0]} castShadow>
            <boxGeometry args={[0.4, 0.22, 0.9]} />
            <meshStandardMaterial {...FINISH.defect} />
          </mesh>
        ))}
      </group>

      <StackLight
        position={[BOOTH_X - 2.6, 0, -2.1]}
        green={stage !== 'idle' && !defect}
        amber={stage === 'cure'}
        red={defect || boolOf(machine.blocked)}
      />
    </group>
  );
}
