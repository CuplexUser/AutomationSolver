import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { LINE_LIMITS, LINE_ZONES, type MachineState } from '@automationsolver/shared';
import { MachineCanvas } from '../MachineCanvas';
import {
  PLANT_FOCUS,
  PLANT_TARGET,
  SECTION_FOCUS,
  SectionCamera,
  START_POS,
} from './camera';
import {
  CONV,
  FINISH,
  MACHINE,
  SPINE,
  SPINE_TURNS,
  numOf,
  orderPaint,
  strOf,
} from './plant';
import { Conveyor, Part, PhotoEye } from './props';
import { AssemblyCell, DockCell, TestCell, YardCell } from './rowB';
import { BoothCell, OvenCell, PortalCell, StoreCell, WeldCell } from './rowA';
import { Shell } from './Shell';
import { buildLineTextures, disposeLineTextures } from './textures';
import { describeMesh, installSceneAudit } from './audit';

/**
 * The excavator line: eight cells, one spine, one floor.
 *
 * The tutorial plant (`Factory3D`) shows four bays with counters between them.
 * This one has to show a *line*, and the thing a player reads off it is the
 * flow: where the queue is, which of the two streams is short, and which station
 * is the one that stopped. So every buffer on this floor is drawn as real parts
 * in a real place — parts standing in the rack, parts accumulating against a
 * zone boundary, machines parked in numbered yard bays — and the numbers in the
 * header are the summary rather than the picture.
 *
 * This file is the plan of the floor and nothing else: which cell stands where,
 * what runs between them, and which camera each section gets. The cells are
 * `rowA.tsx` and `rowB.tsx`, the building is `Shell.tsx`, and everything they
 * share is `plant.ts` and its neighbours.
 *
 * Perf follows `Warehouse3D`'s discipline: the sim re-renders this twenty times
 * a second, so everything static sits behind a `memo` with scalar props and only
 * the cells whose state actually changed are reconciled.
 */

/**
 * Dev only: hand the live scene, and an audit snapshot function, to the page.
 *
 * Mounted only on `/dev/line`. See `audit.ts` for what gets exposed and why —
 * this component is just the hook into React's render/unmount lifecycle that
 * `installSceneAudit` needs to attach and detach it.
 */
function SceneProbe() {
  const scene = useThree((s) => s.scene);
  useEffect(() => installSceneAudit(scene), [scene]);
  return null;
}

/** The bare plant, with no canvas around it. */
export function FactoryLineRig({
  machine,
  outputs,
  section,
  onIdentify,
}: {
  machine: MachineState;
  /** The live coil image, for what a state snapshot cannot tell apart — a torch
      that is *striking* rather than a seam that merely stopped. */
  outputs: Record<string, boolean>;
  section?: string;
  /** Dev only: report whatever mesh was clicked. See `describeMesh`. */
  onIdentify?: (what: string) => void;
}) {
  const tex = useMemo(() => buildLineTextures(), []);
  useEffect(() => () => disposeLineTextures(tex), [tex]);

  const focus = (section && SECTION_FOCUS[section]) || PLANT_FOCUS;

  return (
    <group
      onClick={
        onIdentify
          ? (e) => {
              // `onClick` rather than `onPointerDown`, or every orbit-drag would
              // report whatever the drag happened to start on. `stopPropagation`
              // keeps it to the nearest hit: a click through a plant otherwise
              // returns everything behind it too, and the front one is what was
              // actually pointed at.
              e.stopPropagation();
              onIdentify(describeMesh(e.object));
            }
          : undefined
      }
    >
      <SectionCamera focus={focus} />
      {onIdentify && <SceneProbe />}
      {/* A plant floor is lit from a hundred fittings, not from one sun. Without
          the lift the shop reads as a night scene and the bare parts on the rack
          disappear into the slab. */}
      <ambientLight intensity={0.55} />
      <Shell tex={tex} />

      {/* The spine. Zone boundaries are drawn on it, and the parts queueing
          against them are drawn by the stations that own them. */}
      {SPINE.map((run) => (
        <Conveyor key={run.id} tex={tex} run={run} />
      ))}
      {/* Corner decks, tucked just under the runs they join rather than level
          with them: two decks at one height flicker where they overlap. */}
      {SPINE_TURNS.map((t) => (
        <mesh
          key={`${t.at[0]},${t.at[1]}`}
          position={[t.at[0], CONV.deckY - 0.03, t.at[1]]}
          receiveShadow
        >
          <boxGeometry args={[CONV.width, 0.05, CONV.width]} />
          <meshStandardMaterial {...MACHINE} />
        </mesh>
      ))}
      <Spine machine={machine} />

      {/* Row A: make and finish. */}
      <WeldCell tex={tex} machine={machine} torch={outputs.Y3 === true} />
      <StoreCell tex={tex} machine={machine} />
      <PortalCell machine={machine} />
      <BoothCell
        tex={tex}
        machine={machine}
        spraying={outputs.Y14 === true}
        purging={outputs.Y16 === true}
      />
      <OvenCell tex={tex} machine={machine} racks={LINE_LIMITS.OVEN_RACKS} />

      {/* Row B: build, prove and ship. */}
      <AssemblyCell tex={tex} machine={machine} />
      <TestCell tex={tex} machine={machine} queue={numOf(machine.bufAt)} />
      <DockCell tex={tex} machine={machine} cap={LINE_LIMITS.TRUCK_CAP} />
      <YardCell tex={tex} count={numOf(machine.yard)} cap={LINE_LIMITS.YARD_CAP} />
    </group>
  );
}

/**
 * The spine, live: a photo-eye at every zone and whatever is standing on it.
 *
 * This is the one part of the scene that is worth watching rather than merely
 * looking at. A backed-up line is a row of eyes coming on one after another
 * *backwards* down the run toward the weld bay, and no readout says where the
 * constraint is as directly as that does.
 *
 * The map from a zone to a place on the floor lives here rather than in the
 * process, because it is a fact about the building. The zone list comes from
 * `shared`, so a zone the plant adds cannot go undrawn.
 */
function Spine({ machine }: { machine: MachineState }) {
  return (
    <group>
      {ZONE_SPOTS.map(({ key, x, z, kind, rotY }, i) => {
        const held = strOf(machine[key]);
        const zone = LINE_ZONES[i];
        return (
          <group key={key}>
            <PhotoEye x={x} z={z + CONV.width / 2 + 0.14} on={held !== ''} />
            {tokensOf(zone.key, held).map((token, k) => (
              <Part
                key={k}
                // A lane holds three, queued back from its discharge end.
                x={x - k * 2.9 * (kind === 'lane' ? 1 : 0)}
                z={z}
                kind={token.kind}
                finish={token.color > 0 ? orderPaint(token.color) : FINISH.bare}
                rotY={rotY}
                scale={0.7}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}

/**
 * What one zone is holding, as parts that can be drawn.
 *
 * The three token widths the plant uses are a real distinction and not an
 * encoding quirk: upstream of the booth a part has no color yet, downstream it
 * carries one, and past the jig it is a machine rather than either kind of part.
 */
function tokensOf(key: string, held: string): Array<{ kind: 'f' | 'b'; color: number }> {
  if (key === 'laneF' || key === 'laneB') {
    const kind = key === 'laneF' ? 'f' : 'b';
    return [...held].map((c) => ({ kind, color: Number(c) }));
  }
  if (key.startsWith('z') && held.length >= 2) {
    const out: Array<{ kind: 'f' | 'b'; color: number }> = [];
    for (let i = 0; i < held.length; i += 2) {
      out.push({ kind: held[i] === 'b' ? 'b' : 'f', color: Number(held[i + 1]) });
    }
    return out;
  }
  // A machine on the outfeed side is drawn as its frame, which is the part of it
  // a conveyor is actually carrying.
  return held === '' ? [] : [{ kind: held === 'b' ? 'b' : 'f', color: 0 }];
}

/**
 * Where each zone stands on the floor, in the order `LINE_ZONES` lists them.
 *
 * Derived from the runs in `plant.ts` rather than written out, so a run that
 * moves takes its zones with it — but pinned to the zone list's own order, so a
 * mismatch between the twelve the plant simulates and the twelve the building
 * has is a compile error rather than a part drawn in the wrong bay.
 */
const ZONE_SPOTS: Array<{
  key: string;
  x: number;
  z: number;
  kind: 'zone' | 'lane';
  rotY: number;
}> = (() => {
  const spots: Array<{ x: number; z: number; rotY: number }> = [];
  for (const run of SPINE) {
    const dx = run.to[0] - run.from[0];
    const dz = run.to[1] - run.from[1];
    const rotY = Math.atan2(dx, dz) + Math.PI / 2;
    for (let i = 1; i <= run.zones; i += 1) {
      const t = i / (run.zones + 1);
      spots.push({ x: run.from[0] + t * dx, z: run.from[1] + t * dz, rotY });
    }
  }
  return LINE_ZONES.map((z, i) => ({
    key: z.key,
    x: spots[i]?.x ?? 0,
    z: spots[i]?.z ?? 0,
    kind: z.cap > 1 ? ('lane' as const) : ('zone' as const),
    rotY: spots[i]?.rotY ?? 0,
  }));
})();

export function FactoryLine3D({
  machine,
  outputs,
  section,
  height = 300,
  onIdentify,
}: {
  machine: MachineState;
  outputs: Record<string, boolean>;
  section?: string;
  height?: number | string;
  /** Dev only: report whatever mesh was clicked. See `describeMesh`. */
  onIdentify?: (what: string) => void;
}) {
  return (
    <MachineCanvas
      height={height}
      cameraPosition={START_POS}
      fov={34}
      target={PLANT_TARGET}
      minDistance={4}
      maxDistance={110}
      polarRange={[0.18, 1.42]}
      panBounds={{ x: [-28, 27], y: [-1, 10], z: [-19, 19] }}
      // The floor is 55 x 38. At the tutorial plant's 22 the shadow map would
      // cover barely a third of it and every shadow would stop at a line.
      shadowExtent={38}
      interactive
    >
      <FactoryLineRig
        machine={machine}
        outputs={outputs}
        section={section}
        onIdentify={onIdentify}
      />
    </MachineCanvas>
  );
}
