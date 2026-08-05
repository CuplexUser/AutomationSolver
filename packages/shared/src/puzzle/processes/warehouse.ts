import type { PuzzleDevice } from '../types.js';
import type { MachineState, ProcessModel, ProcessStepCtx, ProcessResult } from './index.js';

/**
 * Automated warehouse: one stacker crane in one aisle, a rack of 4 bays x 2
 * levels, and two production lines that both want feeding from it.
 *
 * Every machine before this one runs a sequence. This one runs a *schedule*, and
 * that is the whole category. Three things demand the crane at once - line A,
 * line B and the goods-in conveyor - there is exactly one crane, and the cost of
 * serving any of them depends on where the crane happens to be standing. A
 * program that merely works is not enough here: a line that waits too long stops,
 * and a stopped line is a failed run, not a slow one.
 *
 * ## The aisle
 *
 * Six positions on one rail, addressed 0..5, and two levels:
 *
 *   position 0, level 1   LINE A infeed conveyor
 *   position 0, level 2   GOODS IN conveyor
 *   positions 1..4        rack bays, level 1 = pick face, level 2 = reserve
 *   position 5, level 1   LINE B infeed conveyor
 *
 * The two lines sit at opposite ends deliberately. Distance from line A is the
 * bay number; distance from line B is `5 - bay`. So the nearest slot holding a
 * given material is a *different slot* depending on which line asked for it, and
 * that fact is what the category is built on.
 *
 * ## Chaotic storage
 *
 * Materials are not assigned to bays. The WMS scatters them and publishes where
 * everything is, one register per slot (`D101..D104` pick face, `D201..D204`
 * reserve, 0 = empty). A material therefore lives in several slots at once, put
 * away wherever there was room, so "which slot" is a search-and-minimize rather
 * than a lookup - and the answer moves as stock is drawn down and replaced.
 *
 * ## Getting there
 *
 * The crane is driven, not commanded: `Y0`/`Y1` traverse, `Y2`/`Y3` lift, and the
 * program stops itself on the position sensors the way `elevator5` stops on its
 * floors. Travel and lift run at the same time, exactly as a real crane's do, so
 * a move costs `max(bays x TRAVEL_MS, levels x LIFT_MS)`.
 *
 * `D0`/`D1` report the same sensor chain as a *number* - the last position
 * sensor the crane passed - because a sensor edge is what you stop on but
 * arithmetic is what you choose a slot with. Latched rather than rounded, so
 * `[= D0 D50]` means "arrived" instead of "more than half way there", which is
 * what collapses driving to any station into one small block of rungs and leaves
 * the budget for the scheduling. End stops are mechanical and simply hold the
 * crane, `elevator5`-style; there is nothing to learn from being punished for
 * one scan of overtravel.
 *
 * ## What trips it
 *
 * Moving with the fork out wrecks the mast, and running the fork out anywhere but
 * lined up with a slot wrecks the fork - those two are the signature interlocks.
 * After that the faults are all logistics: pushing a pallet into an occupied slot,
 * onto a full infeed conveyor, or into a line that asked for something else.
 * Every one latches `jam` with a spoken reason, the packaging precedent.
 *
 * Two failures beside `jam`, because they are the ones the schedule causes rather
 * than the moves: `starved` (a line's consume tick found its buffer empty) and
 * `blocked` (goods-in backed up because nothing was put away). Both latch and
 * both are asserted the same way a jam is, so the grader needed no changes.
 */

/** Travel time per aisle position, and lift time per level. */
const TRAVEL_MS = 800;
const LIFT_MS = 600;
/** Fork stroke out and back. The transfer happens when the out-stroke lands. */
const FORK_OUT_MS = 600;
const FORK_IN_MS = 500;

/** How close counts as lined up with a slot. `elevator5`'s window, for its reasons. */
const EPS = 0.02;
/**
 * Travel fractions are floats, and 12 additions of 1/12 do not land on 1. Snap
 * anything already inside a thousandth of a whole position onto it, so a crane
 * that runs a hundred moves is in exactly the same place as one that ran one.
 * Pure arithmetic, so it stays identical on every platform.
 */
const SNAP = 0.001;

const POS_A = 0;
const POS_B = 5;
const BAY_MIN = 1;
const BAY_MAX = 4;
const LEVEL_MIN = 1;
const LEVEL_MAX = 2;

/** Pallets an infeed conveyor holds, and pallets the goods-in conveyor holds. */
const BUFFER_MAX = 2;
const GOODS_MAX = 2;
/**
 * Pallets already standing on each infeed conveyor at power-up.
 *
 * One, not two, and the difference matters. A conveyor that starts full has no
 * room until the line has eaten something, so a crane that sensibly went and
 * fetched the first pallet early would arrive to find nowhere to put it - which
 * would punish the anticipation this category is trying to teach. One pallet
 * leaves room for exactly one delivery in hand, and one consume period of slack
 * before the line is in trouble.
 */
const BUFFER_START = 1;

/**
 * How often a running line consumes a pallet, and how often another turns up at
 * goods-in.
 *
 * These two are the category's difficulty dial, and the ratio between them
 * matters more than either number. Two lines eating one pallet every
 * `CONSUME_MS` need one arriving every `CONSUME_MS / 2` to stand still; set
 * goods-in any slower than that and the rack drains no matter how well the crane
 * is driven, which would be a puzzle about arithmetic nobody can see rather than
 * about scheduling. `GOODS_IN_MS` sits a little the *other* side of balance, so
 * eight slots of stock last a long shift and not forever.
 *
 * Against the crane's cycle time, that leaves one line and the inbound flow at
 * roughly two thirds of the machine, and both lines and the inbound flow at
 * something like nine tenths of it - only reachable if trips stop running empty
 * in one direction. Putting a pallet away and collecting the next order on the
 * same trip is a real warehouse's dual-command cycle, and it is where the
 * capstone's margin comes from.
 */
export const CONSUME_MS = 20_500;
export const GOODS_IN_MS = 10_250;

/**
 * What each line asks for, in order, and what turns up at goods-in, in order.
 *
 * Deterministic sequences in the `DRILL_STOCK` tradition, and exported because
 * the machine view reads them to color the pallets waiting in the queue. A line's
 * demand register always names the material for the *next* pallet it will accept,
 * so a program has to re-read it every cycle rather than cache it once.
 */
export const LINE_A_RECIPE = [2, 1, 3, 1, 2, 4, 1, 3] as const;
export const LINE_B_RECIPE = [1, 3, 4, 2, 1, 3, 2, 1] as const;
export const GOODS_IN_QUEUE = [1, 3, 2, 1, 4, 3, 1, 2] as const;

/**
 * Player-facing material names, indexed by code. Code 0 is an empty slot.
 * The view colors pallets from this, and the briefings name them.
 */
export const WAREHOUSE_MATERIALS = ['', 'Steel', 'Brass', 'Nylon', 'Alloy'] as const;

/**
 * Where the stock starts.
 *
 * Two racks, feature-detected below. The full one gives every one of the eight
 * slots a pallet, which is what the two retrieval puzzles want; the goods-in one
 * leaves two slots empty so there is somewhere to put an arriving pallet.
 *
 * Neither is symmetric, and that is the point. Steel sits in three bays, alloy in
 * one, and the rest in two apiece, so the number of candidate slots - and whether
 * there is a choice at all - varies from request to request. A program that
 * guesses "line A takes the low bay" is right until the low bay runs out.
 */
const RACK_FULL: Readonly<Record<string, number>> = {
  slot11: 1, slot12: 2,
  slot21: 3, slot22: 1,
  slot31: 2, slot32: 4,
  slot41: 1, slot42: 3,
};
const RACK_WITH_ROOM: Readonly<Record<string, number>> = {
  slot11: 1, slot12: 2,
  slot21: 3, slot22: 0,
  slot31: 2, slot32: 4,
  slot41: 0, slot42: 3,
};

export const WAREHOUSE_SLOTS: readonly { bay: number; level: number; key: string }[] = [
  { bay: 1, level: 1, key: 'slot11' },
  { bay: 1, level: 2, key: 'slot12' },
  { bay: 2, level: 1, key: 'slot21' },
  { bay: 2, level: 2, key: 'slot22' },
  { bay: 3, level: 1, key: 'slot31' },
  { bay: 3, level: 2, key: 'slot32' },
  { bay: 4, level: 1, key: 'slot41' },
  { bay: 4, level: 2, key: 'slot42' },
];

/** WMS register for a slot: D101..D104 pick face, D201..D204 reserve. */
export function slotRegister(bay: number, level: number): string {
  return `D${level}0${bay}`;
}

const has = (devices: PuzzleDevice[], address: string): boolean =>
  devices.some((d) => d.address === address);

const num = (state: MachineState, key: string, fallback = 0): number =>
  typeof state[key] === 'number' ? (state[key] as number) : fallback;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Fold a value onto a whole number once it is close enough to be one. */
const snap = (v: number): number => {
  const whole = Math.round(v);
  return Math.abs(v - whole) < SNAP ? whole : v;
};

/** Lined up with a station: both axes sitting on whole numbers. */
const linedUp = (pos: number, level: number): boolean =>
  Math.abs(pos - Math.round(pos)) <= EPS && Math.abs(level - Math.round(level)) <= EPS;

export const warehouse: ProcessModel = {
  id: 'warehouse',

  init: (devices: PuzzleDevice[]): MachineState => {
    const hasLineA = has(devices, 'X10');
    const hasLineB = has(devices, 'X11');
    const hasGoodsIn = has(devices, 'X12');

    const base: MachineState = {
      // Parked at the aisle head, level 1, fork home: where a crane waits.
      pos: POS_A,
      level: LEVEL_MIN,
      fork: 0,
      dir: 0,
      liftDir: 0,
      carrying: false,
      loadCode: 0,
      // Retrievals and put-aways completed, for the readout and for par.
      retrieved: 0,
      storedAway: 0,
      jam: false,
      jamReason: '',
    };
    Object.assign(base, hasGoodsIn ? RACK_WITH_ROOM : RACK_FULL);

    if (hasLineA) {
      Object.assign(base, {
        hasLineA: true,
        bufferA: BUFFER_START,
        deliveredA: 0,
        consumedA: 0,
        tickA: 0,
        demandA: LINE_A_RECIPE[0],
      });
    }
    if (hasLineB) {
      Object.assign(base, {
        hasLineB: true,
        bufferB: BUFFER_START,
        deliveredB: 0,
        consumedB: 0,
        tickB: 0,
        demandB: LINE_B_RECIPE[0],
      });
    }
    if (hasLineA || hasLineB) base.starved = false;
    if (hasGoodsIn) {
      Object.assign(base, {
        hasGoodsIn: true,
        // A pallet is already waiting: the first puzzle has exactly this one and
        // no more, and the later ones start with the conveyor primed.
        goodsWaiting: 1,
        goodsTaken: 0,
        goodsT: 0,
        // Only a puzzle that also runs a line gets a *flow* of inbound pallets.
        // The first one is a single scripted put-away and must stay that way.
        hasInflow: hasLineA || hasLineB,
        blocked: false,
      });
    }
    return base;
  },

  step: ({ outputs, inputs, machine, dtMs }: ProcessStepCtx): ProcessResult => {
    const m: MachineState = { ...machine };
    const hasLineA = m.hasLineA === true;
    const hasLineB = m.hasLineB === true;
    const hasGoodsIn = m.hasGoodsIn === true;
    const hasInflow = m.hasInflow === true;

    let jam = m.jam === true;
    let jamReason = typeof m.jamReason === 'string' ? m.jamReason : '';
    const trip = (reason: string): void => {
      if (!jam) jamReason = reason;
      jam = true;
    };
    // A jam freezes the machine solid, the packaging/drill precedent: the fault
    // is the end of the run, not something to keep driving through.
    const dt = jam ? 0 : dtMs;

    const prevPos = num(m, 'pos');
    const prevLevel = num(m, 'level', LEVEL_MIN);
    const prevFork = num(m, 'fork');

    // --- interlock: nothing moves with the fork out ---------------------------
    const fwd = outputs.Y0 === true;
    const rev = outputs.Y1 === true;
    const up = outputs.Y2 === true;
    const down = outputs.Y3 === true;
    const forkCmd = outputs.Y4 === true;
    const anyMove = fwd !== rev || up !== down;
    if (!jam && anyMove && prevFork > EPS) {
      trip('the crane drove off down the aisle with its fork still out in a slot');
    }

    // --- travel and lift ------------------------------------------------------
    // Both axes run together, the way a stacker crane's do. Commanding both
    // directions at once is a wiring mistake rather than a crash, so the axis
    // simply stands still - elevator5's up-and-down interlock.
    const move = jam ? 0 : dt;
    let pos = prevPos;
    let dir = 0;
    if (fwd !== rev) {
      pos = clamp(prevPos + (fwd ? 1 : -1) * (move / TRAVEL_MS), POS_A, POS_B);
      dir = fwd ? 1 : -1;
    }
    let level = prevLevel;
    let liftDir = 0;
    if (up !== down) {
      level = clamp(prevLevel + (up ? 1 : -1) * (move / LIFT_MS), LEVEL_MIN, LEVEL_MAX);
      liftDir = up ? 1 : -1;
    }
    pos = snap(pos);
    level = snap(level);

    // --- fork -----------------------------------------------------------------
    const fork = forkCmd
      ? Math.min(1, prevFork + move / FORK_OUT_MS)
      : Math.max(0, prevFork - move / FORK_IN_MS);

    // Leaving home is the moment the fork commits to a slot, so that is where
    // being lined up is checked - not at the end of the stroke, by which time
    // the fork would already be through the rack upright.
    if (!jam && prevFork <= EPS && fork > EPS && !linedUp(pos, level)) {
      trip('the fork was run out while the crane was still between slots');
    }

    const bay = Math.round(pos);
    const lvl = Math.round(level);
    const onStation = linedUp(pos, level);

    // The encoder registers are the *sensor chain's* output, not a rounded-off
    // analogue reading: `D0` holds the number of the last position sensor the
    // crane actually passed, and only changes when one makes. That is what makes
    // `[= D0 D50]` mean "arrived" rather than "more than half way there", and it
    // is what lets one small rung block drive both axes to any station.
    let lastBay = num(m, 'lastBay', POS_A);
    let lastLevel = num(m, 'lastLevel', LEVEL_MIN);
    if (Math.abs(pos - bay) <= EPS) lastBay = bay;
    if (Math.abs(level - lvl) <= EPS) lastLevel = lvl;
    let carrying = m.carrying === true;
    let loadCode = num(m, 'loadCode');
    let retrieved = num(m, 'retrieved');
    let storedAway = num(m, 'storedAway');
    let deliveredA = num(m, 'deliveredA');
    let deliveredB = num(m, 'deliveredB');
    let bufferA = num(m, 'bufferA');
    let bufferB = num(m, 'bufferB');
    let goodsWaiting = num(m, 'goodsWaiting');
    let goodsTaken = num(m, 'goodsTaken');

    const isRack = bay >= BAY_MIN && bay <= BAY_MAX;
    const isLineA = hasLineA && bay === POS_A && lvl === 1;
    const isLineB = hasLineB && bay === POS_B && lvl === 1;
    const isGoodsIn = hasGoodsIn && bay === POS_A && lvl === 2;
    const key = isRack ? `slot${bay}${lvl}` : '';

    // The transfer lands when the out-stroke completes, the pickPlace contract:
    // the stroke takes time, and the pallet changes hands at the end of it.
    const strokeLands = prevFork < 1 && fork >= 1;
    if (strokeLands && !jam) {
      if (carrying) {
        if (isRack) {
          if (num(m, key) !== 0) {
            trip(`the pallet was pushed into bay ${bay} level ${lvl}, which already had one in it`);
          } else {
            m[key] = loadCode;
            carrying = false;
            loadCode = 0;
            storedAway += 1;
          }
        } else if (isLineA || isLineB) {
          const line = isLineA ? 'A' : 'B';
          const buffer = isLineA ? bufferA : bufferB;
          const demand = num(m, isLineA ? 'demandA' : 'demandB');
          if (buffer >= BUFFER_MAX) {
            trip(`the pallet was set down on line ${line}'s infeed conveyor, which was already full`);
          } else if (loadCode !== demand) {
            trip(
              `line ${line} was called for material ${demand} and was handed material ${loadCode}`,
            );
          } else {
            if (isLineA) {
              deliveredA += 1;
              bufferA += 1;
            } else {
              deliveredB += 1;
              bufferB += 1;
            }
            carrying = false;
            loadCode = 0;
            retrieved += 1;
          }
        } else if (isGoodsIn) {
          trip('a pallet was pushed back onto the goods-in conveyor, which only runs inwards');
        } else {
          trip('the pallet was pushed off the end of the aisle, where there is no slot at all');
        }
      } else {
        // Coming up empty is not a fault. It is a wasted trip, which is its own
        // punishment: the whole point of the WMS table is not needing to guess.
        if (isRack && num(m, key) !== 0) {
          loadCode = num(m, key);
          m[key] = 0;
          carrying = true;
        } else if (isGoodsIn && goodsWaiting > 0) {
          loadCode = GOODS_IN_QUEUE[goodsTaken % GOODS_IN_QUEUE.length];
          goodsWaiting -= 1;
          goodsTaken += 1;
          carrying = true;
        }
      }
    }

    // --- the production lines -------------------------------------------------
    // Each line eats a pallet on a clock while it is running. The buffer is the
    // only slack the crane gets, and running one dry stops the line: the honest
    // consequence of an unfair schedule, and the reason this is graded as a
    // latch rather than as a rule about taking turns.
    let starved = m.starved === true;

    // The buffer is a count of pallets standing on the conveyor, not a running
    // difference: each line starts with a full one, which is all the slack the
    // crane gets before the first delivery has to land.
    let consumedA = num(m, 'consumedA');
    let tickA = num(m, 'tickA');
    if (hasLineA && inputs.X4 === true && !jam) {
      tickA += dt;
      while (tickA >= CONSUME_MS) {
        tickA -= CONSUME_MS;
        if (bufferA <= 0) starved = true;
        else {
          bufferA -= 1;
          consumedA += 1;
        }
      }
    }

    let consumedB = num(m, 'consumedB');
    let tickB = num(m, 'tickB');
    if (hasLineB && inputs.X5 === true && !jam) {
      tickB += dt;
      while (tickB >= CONSUME_MS) {
        tickB -= CONSUME_MS;
        if (bufferB <= 0) starved = true;
        else {
          bufferB -= 1;
          consumedB += 1;
        }
      }
    }

    // --- goods in -------------------------------------------------------------
    // The inbound conveyor holds two pallets. A third arriving with nowhere to go
    // backs the conveyor up and stops goods-in, which is a failed run for the
    // same reason a starved line is: the schedule, not the moves.
    let blocked = m.blocked === true;
    let goodsT = num(m, 'goodsT');
    if (hasInflow && !jam) {
      goodsT += dt;
      while (goodsT >= GOODS_IN_MS) {
        goodsT -= GOODS_IN_MS;
        if (goodsWaiting >= GOODS_MAX) blocked = true;
        else goodsWaiting += 1;
      }
    }

    // --- state out ------------------------------------------------------------
    m.pos = pos;
    m.level = level;
    m.lastBay = lastBay;
    m.lastLevel = lastLevel;
    m.fork = fork;
    m.dir = dir;
    m.liftDir = liftDir;
    m.carrying = carrying;
    m.loadCode = loadCode;
    m.retrieved = retrieved;
    m.storedAway = storedAway;
    m.jam = jam;
    m.jamReason = jamReason;

    const derivedInputs: Record<string, boolean> = {
      // Aisle position sensors, one per station, elevator5's floor sensors.
      X20: Math.abs(pos - 0) <= EPS,
      X21: Math.abs(pos - 1) <= EPS,
      X22: Math.abs(pos - 2) <= EPS,
      X23: Math.abs(pos - 3) <= EPS,
      X24: Math.abs(pos - 4) <= EPS,
      X25: Math.abs(pos - 5) <= EPS,
      X26: Math.abs(level - 1) <= EPS,
      X27: Math.abs(level - 2) <= EPS,
      X28: fork <= EPS,
      X29: fork >= 1 - EPS,
      X3: carrying,
      // The photo-eye on the fork carriage: is there a pallet in front of me
      // right now. A confirmation of the WMS table, never a substitute for it -
      // you only get to read it once you have already driven there.
      X13: !onStation ? false : isRack ? num(m, key) !== 0 : isGoodsIn ? goodsWaiting > 0 : false,
    };
    const derivedRegisters: Record<string, number> = {
      D0: lastBay,
      D1: lastLevel,
      D13: loadCode,
    };
    for (const slot of WAREHOUSE_SLOTS) {
      derivedRegisters[slotRegister(slot.bay, slot.level)] = num(m, slot.key);
    }

    if (hasLineA) {
      const demandA = LINE_A_RECIPE[deliveredA % LINE_A_RECIPE.length];
      m.bufferA = bufferA;
      m.deliveredA = deliveredA;
      m.consumedA = consumedA;
      m.tickA = tickA;
      m.demandA = demandA;
      derivedInputs.X10 = inputs.X4 === true && bufferA < BUFFER_MAX;
      derivedRegisters.D10 = demandA;
    }
    if (hasLineB) {
      const demandB = LINE_B_RECIPE[deliveredB % LINE_B_RECIPE.length];
      m.bufferB = bufferB;
      m.deliveredB = deliveredB;
      m.consumedB = consumedB;
      m.tickB = tickB;
      m.demandB = demandB;
      derivedInputs.X11 = inputs.X5 === true && bufferB < BUFFER_MAX;
      derivedRegisters.D11 = demandB;
    }
    if (hasLineA || hasLineB) m.starved = starved;
    if (hasGoodsIn) {
      const goodsCode = goodsWaiting > 0 ? GOODS_IN_QUEUE[goodsTaken % GOODS_IN_QUEUE.length] : 0;
      m.goodsWaiting = goodsWaiting;
      m.goodsTaken = goodsTaken;
      m.goodsT = goodsT;
      m.goodsCode = goodsCode;
      m.blocked = blocked;
      derivedInputs.X12 = goodsWaiting > 0;
      derivedRegisters.D12 = goodsCode;
    }

    return { machine: m, derivedInputs, derivedRegisters };
  },
};
