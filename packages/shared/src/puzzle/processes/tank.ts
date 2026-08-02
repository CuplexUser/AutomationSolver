import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * Level-controlled vessel: the first plant in the game with a *continuous*
 * state, and therefore the first one whose correctness is a question of how
 * well a value is held rather than which coil came on.
 *
 * ## Fixed-point, always
 *
 * Every quantity here is an integer. Level is carried in milli-counts
 * (`0..400_000`, i.e. counts x100) so a scan's worth of flow is still a whole
 * number, and integration runs on a fixed `SUB_MS` sub-step with an accumulator
 * rather than on the caller's `dt`. Between them those two choices mean the
 * plant produces the identical trajectory whatever cadence it is stepped at, so
 * live play and the server's grade are the same run down to the last count —
 * the same guarantee the boolean models get from exact-multiple timings, but
 * one that an integrator cannot get that way.
 *
 * ## I/O convention (fixed across every tank puzzle)
 *
 *   D0   level transmitter, raw 0..4000 counts (4000 = 100 % full)
 *   D1   discharge flow meter, raw 0..4000 counts
 *   D20  supply valve command, raw 0..4000 counts (4000 = wide open)
 *   X0   run/standby selector      X1  low-level float      X2  high-level float
 *   Y0   discharge pump            Y1  high-level alarm     Y2  low-level alarm
 *
 * The transmitter reads *raw counts*, not percent, because that is what an A/D
 * card actually gives you: scaling it is the first puzzle's lesson rather than
 * something the plant does as a favor.
 *
 * ## Dynamics
 *
 * Inflow is proportional to valve opening; outflow is proportional to level (a
 * laminar restriction), plus a fixed draw when the discharge pump runs. The
 * constants are chosen so that at rest `level counts == valve counts` — 50 %
 * valve holds 50 % level — which makes both authoring and reading the trend
 * obvious, and leaves P control with a visible, load-dependent droop:
 *
 *     err = (SV - bias) / (1 + Kp)
 *
 * so Kp=4 with no bias sits 20 % of setpoint low, and the offset *moves* when
 * the pump loads the tank. That is the whole argument for integral action, and
 * the player watches it happen on the trend rather than being told.
 */

/** Integration sub-step. `dt` is consumed in whole multiples of this. */
const SUB_MS = 10;

/** Level scale: milli-counts full scale (4000 counts x 100). */
const LEVEL_FULL = 400_000;
/** Raw counts full scale, for both the transmitter and the valve command. */
const COUNTS_FULL = 4000;

/**
 * Inflow per sub-step = valve / FILL_DIV; outflow = level / DRAIN_DIV.
 *
 * `DRAIN_DIV x SUB_MS` is the vessel's time constant, so 400 makes it 4 s: slow
 * enough that a loop visibly has to work for it, fast enough that a player
 * watching the live trend sees a whole step response inside twenty seconds.
 *
 * `FILL_DIV` is then pinned at `DRAIN_DIV / 100` by the choice that makes the
 * whole category easy to author and to read: at rest, level counts equal valve
 * counts. 50 % open holds 50 % full.
 */
const FILL_DIV = 4;
const DRAIN_DIV = 400;
/** Extra draw per sub-step while the discharge pump runs: a 25 % load step. */
const PUMP_DRAW = 250;
/** Largest plausible outflow per sub-step (full vessel plus pump), for scaling the flow meter. */
const FLOW_FULL_PER_SUB = LEVEL_FULL / DRAIN_DIV + PUMP_DRAW;

/** Float switch trip points, in counts. */
const LOW_TRIP = 400; // 10 %
const HIGH_TRIP = 3600; // 90 %
/** Above this the vessel is overflowing — a fault every scenario asserts stays false. */
const OVERFLOW_TRIP = 3960; // 99 %
/** Running the discharge pump this dry damages it. */
const DRY_TRIP = 40; // 1 %

const has = (devices: PuzzleDevice[], address: string): boolean =>
  devices.some((d) => d.address === address);

const num = (state: MachineState, key: string, fallback: number): number =>
  typeof state[key] === 'number' ? (state[key] as number) : fallback;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const tank: ProcessModel = {
  id: 'tank',

  init: (devices: PuzzleDevice[]): MachineState => ({
    // Start at a quarter full: high enough that the discharge pump is not
    // instantly dry, low enough that a filling loop has somewhere to go.
    levelMilli: LEVEL_FULL / 4,
    level: COUNTS_FULL / 4,
    valve: 0,
    outflow: 0,
    pumping: false,
    // Feature detect, elevator5-door style: puzzles that never wire the pump do
    // not get a dry-run fault they could not have avoided.
    hasPump: has(devices, 'Y0'),
    overflow: false,
    dryRun: false,
    jam: false,
    jamReason: '',
    /** Carry-over sub-step time, so an odd dt never loses or gains flow. */
    subAcc: 0,
  }),

  step: ({ outputs, registers, machine, dtMs }: ProcessStepCtx): ProcessResult => {
    const m: MachineState = { ...machine };

    const jammed = m.jam === true;
    const valve = jammed ? 0 : clamp(Math.trunc(registers.D20 ?? 0), 0, COUNTS_FULL);
    const pumping = m.hasPump === true && outputs.Y0 === true && !jammed;

    let level = num(m, 'levelMilli', 0);
    let outflowMilli = 0;
    let subSteps = 0;

    // Integrate on whole sub-steps only; the remainder is carried, so stepping
    // 50ms once and 10ms five times give bit-identical results.
    let budget = num(m, 'subAcc', 0) + dtMs;
    while (budget >= SUB_MS) {
      budget -= SUB_MS;
      subSteps++;
      if (jammed) continue;
      const inflow = Math.trunc(valve / FILL_DIV);
      const drain = Math.trunc(level / DRAIN_DIV) + (pumping ? PUMP_DRAW : 0);
      // The pump cannot pull what is not there.
      const out = Math.min(drain, level);
      outflowMilli += out;
      level = clamp(level + inflow - out, 0, LEVEL_FULL);
    }
    m.subAcc = budget;
    m.levelMilli = level;

    const counts = Math.trunc(level / 100);
    m.level = counts;
    m.valve = valve;
    m.pumping = pumping;

    // Discharge flow, reported back as its own raw transmitter: the mean rate
    // over the sub-steps just run, normalized against a full vessel discharging
    // through the pump. A dt too short to advance a sub-step holds the last
    // reading rather than reporting a spurious zero.
    if (subSteps > 0) {
      const perSub = outflowMilli / subSteps;
      m.outflow = jammed
        ? 0
        : clamp(Math.trunc((perSub * COUNTS_FULL) / FLOW_FULL_PER_SUB), 0, COUNTS_FULL);
    }
    const flowCounts = num(m, 'outflow', 0);

    if (!jammed) {
      if (counts >= OVERFLOW_TRIP) {
        m.jam = true;
        m.overflow = true;
        m.jamReason = 'the vessel overflowed';
      } else if (pumping && counts <= DRY_TRIP) {
        m.jam = true;
        m.dryRun = true;
        m.jamReason = 'the discharge pump ran dry';
      }
    }

    return {
      machine: m,
      derivedInputs: {
        X1: counts <= LOW_TRIP,
        X2: counts >= HIGH_TRIP,
      },
      derivedRegisters: {
        D0: counts,
        D1: flowCounts,
      },
    };
  },
};
