/**
 * Where everything on the excavator line stands, and what it is made of.
 *
 * The floor plan from `docs/FACTORY-LINE-DESIGN.md`, in one place, because a
 * cell file that carried its own copy of its own footprint would drift from the
 * markings painted under it the first time either moved.
 *
 * One scene unit is one metre. The floor is 55 x 38 and an excavator is about
 * 4 m of it.
 *
 * ## Footprints are the contract
 *
 * A cell may be re-modelled inside its box without moving anything else. That is
 * what lets procedural geometry be swapped for a Blender GLB later, one cell at
 * a time, instead of all at once — so nothing outside this file should ever work
 * out where a cell is by adding to where its neighbour is.
 */

// --- The building -------------------------------------------------------------

export const FLOOR = { x0: -28, x1: 27, z0: -19, z1: 19 };
export const WALL_H = 8.4;

/** The walkway down the middle, and the only place you can see both rows at once. */
export const AISLE = { z0: -4, z1: 0 };

/** Overhead pipe and cable tray. High enough to clear the portal's beam. */
export const SERVICE_Y = 5.9;

// --- Cell footprints ----------------------------------------------------------

export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const cx = (b: Box): number => (b.x0 + b.x1) / 2;
export const cz = (b: Box): number => (b.z0 + b.z1) / 2;
export const bw = (b: Box): number => b.x1 - b.x0;
export const bd = (b: Box): number => b.z1 - b.z0;

/** Row A: make and finish, west to east along the north wall. */
export const WELD: Box = { x0: -27, x1: -15, z0: -18, z1: -6 };
export const STORE: Box = { x0: -13, x1: 1, z0: -18, z1: -6 };
export const BOOTH: Box = { x0: 3, x1: 12, z0: -18, z1: -6 };
export const OVEN: Box = { x0: 14, x1: 24, z0: -18, z1: -6 };

/** Row B: build, prove and ship, east to west along the south wall. */
export const ASSEMBLY: Box = { x0: 7, x1: 24, z0: 3, z1: 15 };
export const TEST: Box = { x0: -6, x1: 4, z0: 3, z1: 15 };
export const DOCK: Box = { x0: -17, x1: -8, z0: 3, z1: 15 };
export const YARD: Box = { x0: -27, x1: -19, z0: 3, z1: 15 };

export const CELLS = { WELD, STORE, BOOTH, OVEN, ASSEMBLY, TEST, DOCK, YARD } as const;

// --- Anchors ------------------------------------------------------------------
// Where one thing hands over to the next. Everything that moves reads these.

export const ANCHOR = {
  weldFixture: [-21, 0, -12] as const,
  weldOutfeed: [-15, 0, -5] as const,
  storeLoader: [-6, 0, -5] as const,
  storePick: [-4, 0, -8] as const,
  boothSkid: [6, 0, -8] as const,
  ovenIn: [14, 0, -10] as const,
  ovenOut: [24, 0, -8] as const,
  sort: [26, 0, 3] as const,
  jig: [13, 0, 6] as const,
  assyRelease: [7, 0, 11] as const,
  testPad: [-1, 0, 11] as const,
  truckBay: [-14, 0, 13] as const,
};

// --- The conveyor -------------------------------------------------------------

/** Roller bed geometry: the top of the rollers is what a part rides on. */
export const CONV = { width: 1.5, deckY: 0.62, railY: 0.74 };

/** The rack store's four gravity lanes, and the portal rail that spans them. */
export const STORE_LANE_X = [-11, -8, -5, -2] as const;
export const STORE_LANE_Z = { back: -17, front: -9.5 };
export const PORTAL = { z: -8, x0: -4, x1: 7, beamY: 5.0 };

/** Painted lanes into the jig: frames on one rail, booms on the other. */
export const PAINT_LANE_Z = { frame: 5, boom: 7.5 };

/**
 * One straight run of conveyor, in the order a part travels it.
 *
 * `zones` is how many zone boundaries fall along the run, which is what the
 * tick marks and the accumulating parts are drawn against. Kept as data rather
 * than as geometry so the spine can be re-laid without touching a mesh.
 */
export interface ConveyorRun {
  id: string;
  from: [number, number];
  to: [number, number];
  zones: number;
}

export const SPINE: ConveyorRun[] = [
  // Weld outfeed east to the store's loader. Z1 Z2 Z3.
  { id: 'A', from: [-15, -5], to: [-6, -5], zones: 3 },
  // Booth to oven: a short internal transfer, not a zone the program drives.
  { id: 'BO', from: [12, -10], to: [14, -10], zones: 0 },
  // Oven discharge, then south down the east wall to the sort. Z4 Z5 Z6 Z7.
  { id: 'B', from: [24, -8], to: [26, -8], zones: 1 },
  { id: 'C', from: [26, -8], to: [26, 3], zones: 3 },
  // The two painted lanes, running west into the jig. Z8 Z9.
  { id: 'F', from: [26, 5], to: [13, 5], zones: 1 },
  { id: 'M', from: [26, 7.5], to: [13, 7.5], zones: 1 },
  // Assembly out, through test, on to the dock and the yard. Z10 Z11 Z12.
  { id: 'D', from: [7, 11], to: [-19, 11], zones: 3 },
];

/** The corner pieces that turn the spine, drawn as quarter beds. */
export const SPINE_TURNS: Array<{ at: [number, number]; from: number; to: number }> = [
  { at: [26, -8], from: 90, to: 180 },
  { at: [26, 3], from: 0, to: 270 },
];

// --- Materials ----------------------------------------------------------------

/**
 * The colour language, and the reason the plant is readable at a glance.
 *
 * Orange is anything that moves under power. Blue-grey is static structure.
 * Yellow and black is hazard, white is marking, charcoal is floor. Nothing else
 * gets a strong colour, so the eye reads *motion* before it reads geometry.
 */
export const POWER = { color: '#e8621a', metalness: 0.42, roughness: 0.48 };
export const POWER_DIM = { color: '#b34a12', metalness: 0.4, roughness: 0.55 };
export const STRUCTURE = { color: '#5f6b7a', metalness: 0.35, roughness: 0.6 };
export const STEEL = { color: '#8b95a3', metalness: 0.76, roughness: 0.42 };
export const DARK_STEEL = { color: '#3f4a57', metalness: 0.68, roughness: 0.54 };
export const MACHINE = { color: '#4c5764', metalness: 0.3, roughness: 0.62 };
export const RUBBER = { color: '#20252b', metalness: 0.08, roughness: 0.93 };
export const MESH_GUARD = { color: '#7d8996', metalness: 0.5, roughness: 0.6 };
export const GLASS = { color: '#8fb4cf', metalness: 0.1, roughness: 0.25 };

/** The four drums on the paint shop wall, numbered as they are on the floor. */
export const DRUM_COLORS = ['#e8e8e8', '#22b8cf', '#e64980', '#fcc419'] as const;

/** How a part looks at each point in the shop. */
export const FINISH = {
  bare: { color: '#767f8b', metalness: 0.72, roughness: 0.46 },
  blasted: { color: '#a3aab1', metalness: 0.3, roughness: 0.88 },
  painted: { color: '#f0b429', metalness: 0.28, roughness: 0.42 },
  defect: { color: '#8a7748', metalness: 0.08, roughness: 0.95 },
} as const;
export type Finish = keyof typeof FINISH;

/**
 * The paint an order color actually comes out as.
 *
 * The colors are the drums', because they are the same paint: the whole point of
 * the color puzzle is that a part carries its machine's color from the booth all
 * the way to the jig, so the drum on the wall, the part on the lane and the
 * machine in the yard have to be visibly the same yellow.
 */
export function orderPaint(color: number): { color: string; metalness: number; roughness: number } {
  const c = DRUM_COLORS[color - 1];
  return c ? { color: c, metalness: 0.28, roughness: 0.42 } : FINISH.blasted;
}

// --- Reading the machine state ------------------------------------------------

export const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
export const strOf = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f);
export const boolOf = (v: unknown): boolean => v === true;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
