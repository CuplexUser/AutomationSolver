import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * Traverse axis on a variable-frequency drive: the second continuous plant, and
 * the first where the *rate of change* is the thing the player commands.
 *
 * The tank taught holding a value. This one teaches getting somewhere: the
 * program asks for a speed, the drive ramps toward it at whatever rate its
 * parameters currently say, and position is the integral of what comes out. Two
 * consequences follow, and they are the whole category:
 *
 *   1. A speed reference is not a position. Stopping somewhere means seeing the
 *      target coming and slowing down before it, because the ramp keeps running
 *      after the coil drops.
 *   2. The ramp rates are **drive parameters**, not constants. They live in D40
 *      and D41 and the program writes them, the way a technician writes P.0.10
 *      and P.0.11 on a real inverter. Which means they can be *changed while the
 *      machine runs* — and a machine that carries a load some of the time has to.
 *
 * ## Fixed-point, always
 *
 * Same contract as the tank, for the same reason: integers only, integrated on a
 * fixed `SUB_MS` sub-step with a carried remainder, so the trajectory is
 * identical at any `dt` and the client's live run and the server's grade agree
 * count for count. Position and velocity are carried in milli-counts.
 *
 * ## I/O convention (fixed across every axis puzzle)
 *
 *   D0   position transmitter, 0..4000 counts (0 = home end, 4000 = far end)
 *   D1   actual speed, SIGNED, -4000..4000 counts (negative = reverse)
 *   D2   hoist position, 0..4000 counts, 0 = hook fully up      (crane only)
 *   D3   load sway AMPLITUDE, 0..~1000 counts                   (crane only)
 *   D20  traverse speed reference, 0..4000 counts (direction comes from Y0/Y1)
 *   D21  hoist speed reference, 0..4000 counts                  (crane only)
 *   D40  acceleration parameter, counts of speed per second
 *   D41  deceleration parameter, counts of speed per second
 *   X10  AT HOME limit      X11  AT END limit    (overtravel, every puzzle)
 *   X12  AT PICK STATION    X13  AT DROP STATION (proximity, every puzzle)
 *   X14  LOAD ON FORKS                                          (loaded only)
 *   X15  HOOK UP            X16  HOOK DOWN       X17 SWAY OK     (crane only)
 *   Y0   run forward        Y1   run reverse
 *   Y2   hoist up           Y3   hoist down                     (crane only)
 *   Y4   forks close                                            (loaded only)
 *
 * Everything past the traverse is feature-detected off the puzzle's own device
 * list, elevator5-door style, so one model serves the whole ramp.
 *
 * ## What trips it
 *
 * The drive delivers torque, and torque is what a ramp rate costs. Asking for
 * more acceleration than the motor can give trips it on overcurrent; asking for
 * more *deceleration* than the forks can hold shifts the load off them. Both
 * limits are far lower with a pallet on board than without, which is exactly why
 * the parameters have to be swapped in flight rather than set once at power-up.
 */

/** Integration sub-step. `dt` is consumed in whole multiples of this. */
const SUB_MS = 10;

/** Raw counts full scale, for the position transmitter and both references. */
const COUNTS_FULL = 4000;
/** Traverse stroke and hoist travel, in milli-counts. */
const POS_FULL = 4_000_000;
const HOIST_FULL = 4_000_000;

/**
 * Position advance per sub-step = velMilli / TRAVERSE_DIV.
 *
 * 800 puts full speed at 500 counts/s, so the carriage crosses its whole stroke
 * in eight seconds. That gearing is chosen against the ramp rates below rather
 * than for its own sake: it makes the distance a *loaded* carriage needs to slow
 * down in about a quarter of the stroke, so "start braking much earlier with a
 * pallet on" is a real constraint the player has room to get wrong, instead of
 * one that either fits trivially or cannot fit at all.
 */
const TRAVERSE_DIV = 800;
/** Hoist advance per sub-step = ref x SUB_MS / HOIST_DIV. */
const HOIST_DIV = 4;

/**
 * How far from each hard stop the overtravel limit switch sits, in counts.
 *
 * 200 rather than something tight, for the reason limit switches are placed
 * where they are on a real machine: far enough back that a carriage jogging at
 * a sensible speed can still ramp to a stop inside the remaining travel. A
 * switch with no overtravel behind it is not a limit switch, it is a witness.
 */
const HOME_WINDOW = 200;
const END_WINDOW = 200;
const HOIST_WINDOW = 40;

/**
 * The two work stations, and how close counts as being at one.
 *
 * They sit *inside* the stroke, not at the end stops, so arriving is something
 * the program has to judge from the transmitter rather than something a limit
 * switch does for it. The end limits stay what they are on a real machine:
 * overtravel, and hitting one at speed is a crash, not a stop.
 */
const PICK_POS = 400;
const DROP_POS = 3400;
const STATION_WINDOW = 60;

/**
 * Speed thresholds, in *reference* counts (0..4000), not counts of travel per
 * second — they are compared against the drive's own speed, which is what both
 * the program and D1 see. Full reference is 500 counts of travel a second, so
 * CRASH_SPEED of 400 is about 50 counts a second: a nudge, not an impact.
 */
const STOPPED_SPEED = 20;
const CRASH_SPEED = 400;

/**
 * Drive limits, in counts of speed per second.
 *
 * The empty numbers are generous enough that the first puzzle only has to stay
 * inside them; the loaded ones are half as much, which is the fact `axis-loaded`
 * is built on — half the ramp rate is twice the stopping distance.
 */
const ACCEL_MAX_EMPTY = 2000;
const DECEL_MAX_EMPTY = 2500;
const ACCEL_MAX_LOADED = 1000;
const DECEL_MAX_LOADED = 1200;

/** Fork open/close stroke. Pick and place land at the end of it, pickPlace-style. */
const FORK_MS = 300;

/**
 * Sway, as a plain pendulum in fixed point.
 *
 * `SWAY_SPRING` sets the period: 987 gives sway'' = -9.87 x sway, i.e. omega
 * ~3.14 rad/s, a two-second swing — slow enough to see and slow enough that a
 * ramp lasting about that long cancels its own excitation, which is real
 * input-shaping behaviour and a genuinely nice thing to discover. `SWAY_DAMP`
 * is the per-sub-step decay (993 -> about 1.4 s), and `SWAY_PUSH` is how hard a
 * change in trolley speed yanks the rope.
 */
const SWAY_SPRING = 987;
const SWAY_DAMP = 993;
const SWAY_PUSH = 2;
/**
 * omega x 1000, in milli-radians per second — sqrt(9.87) = 3.142.
 *
 * Used to turn the pendulum's *state* into its *amplitude*: a swinging load
 * passes through vertical four times a second, so the instantaneous angle is
 * exactly the wrong thing to interlock against — it reads zero twice per swing
 * at the moment the load is moving fastest. Amplitude is `sqrt(x^2 + (v/omega)^2)`,
 * the swing's turning point, and that is what a sway meter actually reports.
 */
const SWAY_OMEGA = 3142;
/** Reported sway amplitude at or under this reads as settled on X17. */
const SWAY_OK = 60;
/** Lowering the hook while it swings worse than this catches the rack. */
const SWAY_LIMIT = 150;

const has = (devices: PuzzleDevice[], address: string): boolean =>
  devices.some((d) => d.address === address);

const num = (state: MachineState, key: string, fallback = 0): number =>
  typeof state[key] === 'number' ? (state[key] as number) : fallback;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const axis: ProcessModel = {
  id: 'axis',

  init: (devices: PuzzleDevice[]): MachineState => {
    const base: MachineState = {
      // Parked at the pick station, not against the home stop: every cycle in
      // this category starts by picking something up, and a machine that begins
      // outside its own first station just adds a move nobody learns from.
      posMilli: PICK_POS * 1000,
      velMilli: 0,
      pos: PICK_POS,
      vel: 0,
      accel: 0,
      decel: 0,
      subAcc: 0,
      jam: false,
      jamReason: '',
    };
    // Feature detect off the device list, so a puzzle that never wires the
    // forks cannot be failed by a load-handling interlock it has no way to see.
    if (has(devices, 'Y4')) {
      Object.assign(base, { hasForks: true, forks: 0, loaded: false, placed: 0 });
    }
    if (has(devices, 'Y2')) {
      Object.assign(base, {
        hasHoist: true,
        hoistMilli: 0,
        hoist: 0,
        swayMilli: 0,
        swayVel: 0,
        sway: 0,
      });
    }
    return base;
  },

  step: ({ outputs, registers, machine, dtMs }: ProcessStepCtx): ProcessResult => {
    const m: MachineState = { ...machine };
    const hasForks = m.hasForks === true;
    const hasHoist = m.hasHoist === true;

    let jam = m.jam === true;
    let jamReason = typeof m.jamReason === 'string' ? m.jamReason : '';
    const trip = (reason: string): void => {
      if (!jam) jamReason = reason;
      jam = true;
    };

    const accelParam = Math.max(0, Math.trunc(registers.D40 ?? 0));
    const decelParam = Math.max(0, Math.trunc(registers.D41 ?? 0));
    const speedRef = clamp(Math.trunc(registers.D20 ?? 0), 0, COUNTS_FULL);
    const hoistRef = hasHoist ? clamp(Math.trunc(registers.D21 ?? 0), 0, COUNTS_FULL) : 0;

    const fwd = outputs.Y0 === true;
    const rev = outputs.Y1 === true;
    const loaded = m.loaded === true;

    // Commanding both directions at once is a wiring mistake, not a crash: the
    // drive simply has no direction to run in, exactly like the elevator's
    // up-and-down interlock. It ramps to a stop.
    const running = fwd !== rev;
    const targetMilli = jam || !running ? 0 : (fwd ? speedRef : -speedRef) * 1000;

    // A drive with no ramp times in it is not commissioned. Real inverters
    // refuse to start; so does this one, rather than silently never moving.
    if (!jam && running && (accelParam <= 0 || decelParam <= 0)) {
      trip('the drive was started before its acceleration and deceleration parameters were loaded');
    }

    const accelMax = loaded ? ACCEL_MAX_LOADED : ACCEL_MAX_EMPTY;
    const decelMax = loaded ? DECEL_MAX_LOADED : DECEL_MAX_EMPTY;
    // Ramp rates, converted to milli-counts of speed per sub-step. A parameter
    // in counts/s times SUB_MS lands exactly on that, which is the reason the
    // parameter is a rate rather than a time.
    const accelStep = accelParam * SUB_MS;
    const decelStep = decelParam * SUB_MS;

    let posMilli = num(m, 'posMilli');
    let velMilli = num(m, 'velMilli');
    let hoistMilli = num(m, 'hoistMilli');
    let swayMilli = num(m, 'swayMilli');
    let swayVel = num(m, 'swayVel');

    let budget = num(m, 'subAcc') + dtMs;
    while (budget >= SUB_MS) {
      budget -= SUB_MS;
      if (jam) continue;

      // --- traverse ramp ----------------------------------------------------
      const before = velMilli;
      if (velMilli !== targetMilli) {
        // Braking is anything that reduces speed toward zero, including the
        // first half of a reversal — the drive cannot cross zero going the
        // wrong way, it has to stop first. (`Math.sign(0)` is 0, so standing
        // still and being asked to move always reads as accelerating.)
        const braking =
          Math.sign(targetMilli) === Math.sign(velMilli)
            ? Math.abs(targetMilli) < Math.abs(velMilli)
            : velMilli !== 0;
        const rate = braking ? decelStep : accelStep;
        if (!braking) {
          if (accelParam > accelMax) {
            trip(
              loaded
                ? 'the drive tripped on overcurrent accelerating a loaded carriage too hard'
                : 'the drive tripped on overcurrent, accelerating harder than the motor can pull',
            );
          }
        } else if (loaded && decelParam > decelMax) {
          trip('the load slid off the forks, because the carriage braked harder than they can hold');
        } else if (!loaded && decelParam > decelMax) {
          trip('the drive tripped on its braking resistor, decelerating harder than it can dump');
        }
        const gap = targetMilli - velMilli;
        const move = Math.sign(gap) * Math.min(Math.abs(gap), rate);
        let next = velMilli + move;
        // Never sail through zero inside one sub-step while braking: stop at
        // zero and let the next sub-step accelerate the other way, so the two
        // ramp rates always apply to the phase they belong to.
        if (velMilli > 0 && next < 0) next = 0;
        if (velMilli < 0 && next > 0) next = 0;
        velMilli = next;
      }
      const dVel = velMilli - before;

      // --- position ---------------------------------------------------------
      posMilli += Math.trunc(velMilli / TRAVERSE_DIV);
      if (posMilli <= 0 && velMilli < 0) {
        if (velMilli < -CRASH_SPEED * 1000) {
          trip('the carriage was driven into the home end stop at speed');
        }
        posMilli = 0;
        velMilli = 0;
      } else if (posMilli >= POS_FULL && velMilli > 0) {
        if (velMilli > CRASH_SPEED * 1000) {
          trip('the carriage was driven into the far end stop at speed');
        }
        posMilli = POS_FULL;
        velMilli = 0;
      }

      // --- hoist ------------------------------------------------------------
      if (hasHoist) {
        const up = outputs.Y2 === true;
        const down = outputs.Y3 === true;
        if (up !== down) {
          const move = Math.trunc((hoistRef * SUB_MS) / HOIST_DIV);
          hoistMilli = clamp(hoistMilli + (down ? move : -move), 0, HOIST_FULL);
        }

        // --- sway ---------------------------------------------------------
        // Gravity pulls the load back under the trolley; the trolley changing
        // speed throws it out again; the rope takes the energy back out slowly.
        swayVel -= Math.trunc((swayMilli * SWAY_SPRING) / 10_000);
        swayVel -= dVel * SWAY_PUSH;
        swayVel = Math.trunc((swayVel * SWAY_DAMP) / 1000);
        swayMilli += Math.trunc(swayVel / 100);
      }
    }
    m.subAcc = budget;

    const pos = Math.trunc(posMilli / 1000);
    const vel = Math.trunc(velMilli / 1000);
    const hoist = Math.trunc(hoistMilli / 1000);
    const sway = Math.trunc(swayMilli / 1000);
    // The swing's turning point, not where it happens to be right now. `sqrt` is
    // the one transcendental that is exactly specified by IEEE-754, so it stays
    // bit-identical on every platform the way the rest of this file does.
    const swayAmp = Math.trunc(
      Math.sqrt(swayMilli * swayMilli + ((swayVel * 1000) / SWAY_OMEGA) ** 2) / 1000,
    );

    // --- forks --------------------------------------------------------------
    // Travel and transfer are the pickPlace gripper's contract exactly: the
    // stroke takes time, and the load changes hands when it completes.
    let placed = num(m, 'placed');
    let carrying = loaded;
    let forks = num(m, 'forks');
    if (hasForks) {
      const prevForks = forks;
      const move = jam ? 0 : dtMs;
      forks =
        outputs.Y4 === true && !jam
          ? Math.min(1, prevForks + move / FORK_MS)
          : Math.max(0, prevForks - move / FORK_MS);

      const atPick = Math.abs(pos - PICK_POS) <= STATION_WINDOW;
      const atDrop = Math.abs(pos - DROP_POS) <= STATION_WINDOW;
      const hookDown = !hasHoist || hoist >= COUNTS_FULL - HOIST_WINDOW;
      const closing = prevForks < 1 && forks >= 1;
      const opening = prevForks > 0 && forks <= 0;

      if ((closing || opening) && Math.abs(vel) > STOPPED_SPEED) {
        trip('the forks were operated with the carriage still moving');
      } else if (closing && !carrying && atPick && hookDown) {
        carrying = true;
      } else if (opening && carrying) {
        if (!hookDown) {
          trip('the forks let go with the hook still raised, dropping the load');
        } else if (atDrop) {
          carrying = false;
          placed += 1;
        } else if (atPick) {
          // Putting it straight back where it came from is clumsy, not a crash.
          carrying = false;
        } else {
          trip('the load was set down between stations, off the end of the forks');
        }
      }
    }

    // Past the drop station is rack structure, not more rail. An empty carriage
    // may run the whole stroke; a loaded one may not, and that is what makes the
    // slow-down distance a load-dependent number rather than a constant. Getting
    // the two ramp parameters right and leaving the distance alone is the
    // mistake this catches: the drive is perfectly happy, and the pallet still
    // goes into the rack face.
    if (hasForks && !jam && carrying && pos > DROP_POS + STATION_WINDOW) {
      trip('the loaded carriage ran past the drop station into the rack face');
    }

    // Lowering a swinging load into a rack is how a crane wrecks one.
    if (hasHoist && !jam && outputs.Y3 === true && swayAmp > SWAY_LIMIT) {
      trip('the hook came down while the load was still swinging, and it caught the rack');
    }

    m.posMilli = posMilli;
    m.velMilli = velMilli;
    m.pos = pos;
    m.vel = vel;
    m.accel = accelParam;
    m.decel = decelParam;
    m.running = running && !jam;
    m.jam = jam;
    m.jamReason = jamReason;

    const derivedInputs: Record<string, boolean> = {
      X10: pos <= HOME_WINDOW,
      X11: pos >= COUNTS_FULL - END_WINDOW,
      X12: Math.abs(pos - PICK_POS) <= STATION_WINDOW,
      X13: Math.abs(pos - DROP_POS) <= STATION_WINDOW,
    };
    const derivedRegisters: Record<string, number> = { D0: pos, D1: vel };

    if (hasForks) {
      m.forks = forks;
      m.loaded = carrying;
      m.placed = placed;
      derivedInputs.X14 = carrying;
    }
    if (hasHoist) {
      m.hoistMilli = hoistMilli;
      m.hoist = hoist;
      m.swayMilli = swayMilli;
      m.swayVel = swayVel;
      // The instantaneous angle drives the 3D rope; the amplitude is what the
      // program is given, because it is the only one of the two you can make a
      // decision from.
      m.sway = sway;
      m.swayAmp = swayAmp;
      derivedInputs.X15 = hoist <= HOIST_WINDOW;
      derivedInputs.X16 = hoist >= COUNTS_FULL - HOIST_WINDOW;
      derivedInputs.X17 = swayAmp <= SWAY_OK;
      derivedRegisters.D2 = hoist;
      derivedRegisters.D3 = swayAmp;
    }

    return { machine: m, derivedInputs, derivedRegisters };
  },
};
