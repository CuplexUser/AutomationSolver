import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useThree, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { materialSignature, mergeMeshes, type BatchPiece } from "./batch";

interface Registry {
  add: (g: THREE.Group) => void;
  remove: (g: THREE.Group) => void;
}

const BatchContext = createContext<Registry | null>(null);
/** Inside a `<Static>` already: a nested one is baked by its ancestor, so it registers nothing. */
const InStatic = createContext(false);

/**
 * Draws every `<Static>` subtree below it as a handful of merged meshes.
 *
 * A procedural scene written in JSX builds one material per mesh, so nothing is
 * shared and every fence post is its own draw call. The batch waits for the
 * static parts to mount, bakes their meshes into one mesh per look (see
 * `materialSignature`), and hides the originals. The originals stay in the
 * scene, invisible: the dev scene audit and click-to-identify read them, and a
 * `<Static>` that remounts simply triggers a rebuild.
 *
 * Only for things that never change after mount. A lamp that changes color or a
 * part that moves must stay outside `<Static>`, or it freezes in the batch.
 */
export function StaticBatch({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const baked = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const members = useRef(new Set<THREE.Group>());
  const [version, setVersion] = useState(0);
  const registry = useMemo<Registry>(
    () => ({
      add: (g) => {
        members.current.add(g);
        setVersion((v) => v + 1);
      },
      remove: (g) => {
        members.current.delete(g);
        g.visible = true;
        setVersion((v) => v + 1);
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const host = root.current;
    const out = baked.current;
    // Version 0 is the render before any member registered; the first real build follows it.
    if (version === 0 || !host || !out || members.current.size === 0) return;
    host.updateWorldMatrix(true, true);
    const toLocal = host.matrixWorld.clone().invert();
    const pieces: BatchPiece[] = [];
    for (const g of members.current) {
      g.visible = true;
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible) return;
        pieces.push({
          mesh,
          matrix: toLocal.clone().multiply(mesh.matrixWorld),
        });
      });
      g.visible = false;
    }
    const merged = mergeMeshes(pieces, materialSignature);
    for (const m of merged) {
      m.userData.batched = true;
      // Picking goes to the hidden originals, which know what they are.
      m.raycast = () => {};
      out.add(m);
    }
    invalidate();
    return () => {
      for (const m of merged) {
        out.remove(m);
        m.geometry.dispose();
      }
    };
  }, [version, invalidate]);

  return (
    <BatchContext.Provider value={registry}>
      <group ref={root}>
        {children}
        <group ref={baked} />
      </group>
    </BatchContext.Provider>
  );
}

/** Marks a subtree as never changing after mount, for the nearest `StaticBatch` to bake. */
export function Static({
  children,
  ...props
}: ThreeElements["group"] & { children?: ReactNode }) {
  const registry = useContext(BatchContext);
  const nested = useContext(InStatic);
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = ref.current;
    if (!registry || nested || !g) return;
    registry.add(g);
    return () => registry.remove(g);
  }, [registry, nested]);
  return (
    <InStatic.Provider value={true}>
      <group ref={ref} {...props}>
        {children}
      </group>
    </InStatic.Provider>
  );
}

/** A component whose whole output is static, wrapped so its call sites need not change. */
export function staticPart<P extends object>(
  Component: ComponentType<P>,
): ComponentType<P> {
  function StaticPart(props: P) {
    return (
      <Static>
        <Component {...props} />
      </Static>
    );
  }
  StaticPart.displayName = `Static(${Component.displayName ?? Component.name})`;
  return StaticPart;
}
