/**
 * Where everything in the plant stands, and what it is made of.
 *
 * Split out of `Factory3D` so the four bays can each be read on their own: a bay
 * file that carried its own copy of `ROW_A` would drift from the lane painted
 * under it the first time either moved.
 */

// --- Plant layout -------------------------------------------------------------
// One scene unit is one metre. An excavator is about 4 m of it.

/** Row A (weld and paint) and row B (assembly, test, yard) centre lines. */
export const ROW_A = -6;
export const ROW_B = 7;

export const WELD_X = -10.5;
/** Weld buffer rail: three cross-loaded stands between weld and the booth. */
export const WP_SLOT_X = [-6.6, -4.2, -1.8] as const;
export const BOOTH_X = 1.6;
export const OVEN_X = 6.2;

/** The painted buffers run across the plant, which is what merges the streams. */
export const PA_LANE_X = { f: 9.4, b: 12.2 } as const;
export const PA_SLOT_Z = [-5.0, -1.4, 2.2] as const;

export const ASSY_X = 9.0;
/** Finished machines waiting for the test bay. */
export const AT_SLOT_X = [4.8, 1.9] as const;
export const TEST_X = -2.0;
/** Dispatch yard: three columns of two, parked nose-in. */
export const YARD_COL_X = [-7.6, -10.6, -13.6] as const;
export const YARD_ROW_Z = [5.4, 9.1] as const;

export const FLOOR = { x0: -17, x1: 15.5, z0: -10.5, z1: 12.5 };

export const COUNTS_FULL = 4000;

// --- Materials ----------------------------------------------------------------

export const STEEL = { color: '#8b95a3', metalness: 0.78, roughness: 0.42 };
export const DARK_STEEL = { color: '#4b5563', metalness: 0.7, roughness: 0.5 };
export const MACHINE_PAINT = { color: '#5f6b7a', metalness: 0.35, roughness: 0.55 };
/** Guard rails and safety fencing, in the yellow every shop floor uses. */
export const GUARD = { color: '#e0a11b', metalness: 0.25, roughness: 0.6 };
export const RUBBER = { color: '#22272d', metalness: 0.1, roughness: 0.92 };

/**
 * How a part looks at each point in the shop. `bare` is a raw weldment straight
 * off the fixture, `blasted` is grit-blasted and matte, `painted` is the
 * finish, and `defect` is what comes out of an oven that drifted out of band —
 * dull and patchy, so a scrapped part is recognizable before the counter moves.
 */
export const FINISH = {
  bare: { color: '#767f8b', metalness: 0.72, roughness: 0.46 },
  blasted: { color: '#a3aab1', metalness: 0.3, roughness: 0.88 },
  painted: { color: '#f0b429', metalness: 0.28, roughness: 0.42 },
  defect: { color: '#8a7748', metalness: 0.08, roughness: 0.95 },
} as const;
export type Finish = keyof typeof FINISH;

// --- Reading the machine state ------------------------------------------------
// `MachineState` is an untyped bag, so every bay narrows what it pulls out of it.

export const numOf = (v: unknown, f = 0): number => (typeof v === 'number' ? v : f);
export const strOf = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f);
export const boolOf = (v: unknown): boolean => v === true;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
