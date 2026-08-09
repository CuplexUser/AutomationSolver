import type { PuzzleSpec } from '../types.js';
import { directControl } from './01-direct-control.js';
import { sealIn } from './02-seal-in.js';
import { eStop } from './03-estop.js';
import { delayedStart } from './04-delayed-start.js';
import { batchCounter } from './05-batch-counter.js';
import { conveyorStop } from './06-conveyor-stop.js';
import { drillStation } from './07-drill-station.js';
import { elevatorAutoReturn } from './08-elevator.js';
import { elevatorDispatch } from './09-elevator-dispatch.js';
import { elevatorDoors } from './10-elevator-doors.js';
import { elevatorFull } from './11-elevator-full.js';
import { cabinetLamp } from './12-cabinet-lamp.js';
import { cabinetDol } from './13-cabinet-dol.js';
import { cabinetReversing } from './14-cabinet-reversing.js';
import { cabinetIndication } from './15-cabinet-indication.js';
import { cabinetReversingProtected } from './16-cabinet-reversing-protected.js';
import { runOnTimer } from './17-run-on-timer.js';
import { flasher } from './18-flasher.js';
import { twoHandPress } from './19-two-hand-press.js';
import { cabinetTwoStation } from './20-cabinet-two-station.js';
import { packBasics } from './21-pack-basics.js';
import { packGroup } from './22-pack-group.js';
import { packLift } from './23-pack-lift.js';
import { packFull } from './24-pack-full.js';
import { pickPlaceCycle } from './25-pick-place-cycle.js';
import { pickPlaceTray } from './26-pick-place-tray.js';
import { pickPlaceSupply } from './27-pick-place-supply.js';
import { pickPlaceFull } from './28-pick-place-full.js';
import { drillClampFeed } from './29-drill-clamp-feed.js';
import { drillSpindle } from './30-drill-spindle.js';
import { drillProduction } from './31-drill-production.js';
import { tankLevelReadout } from './32-tank-level-readout.js';
import { tankTwoPosition } from './33-tank-two-position.js';
import { tankPControl } from './34-tank-p-control.js';
import { tankPid } from './35-tank-pid.js';
import { tankAuto } from './36-tank-auto.js';
import { axisJog } from './37-axis-jog.js';
import { axisProfile } from './38-axis-profile.js';
import { axisLoaded } from './39-axis-loaded.js';
import { axisCrane } from './40-axis-crane.js';
import { asrsDrive } from './41-asrs-drive.js';
import { asrsPutAway } from './42-asrs-put-away.js';
import { asrsRetrieval } from './43-asrs-retrieval.js';
import { asrsTwoLines } from './44-asrs-two-lines.js';
import { asrsReplenish } from './45-asrs-replenish.js';
import { asrsDualCycle } from './46-asrs-dual-cycle.js';
import { factorySupervisor } from './47-factory-supervisor.js';
import { factoryWeld } from './48-factory-weld.js';
import { factoryConveyor } from './49-factory-conveyor.js';
import { factoryHandling } from './50-factory-handling.js';
import { factoryPaint } from './51-factory-paint.js';
import { factoryAssembly } from './52-factory-assembly.js';
import { factoryLineCapstone } from './53-factory-line.js';

/**
 * The excavator line's plant definition, ahead of the puzzles that use it.
 *
 * Re-exported by name rather than with `export *` because `factory-line-plant`
 * also exports a rung-building kit under names (`build`, `no`, `nc`) that would
 * be a poor thing to put in the package's top-level namespace.
 *
 * These are content, not puzzles: nothing here appears in `PUZZLES` until a
 * spec declares `processId: 'factory-line'`. The client's dev preview drives the
 * line from them so the scene can be looked at before that spec exists.
 */
export {
  LINE_DEVICES,
  LINE_INSTRUCTIONS,
  LINE_OWNS,
  SUP_PROGRAM,
} from './factory-line-plant.js';
export {
  ASSEMBLY_PLAIN,
  ASSEMBLY_TUNED,
  CONV_PLAIN,
  CONV_TUNED,
  PAINT_PLAIN,
  PAINT_TUNED,
  STORE_PLAIN,
  STORE_TUNED,
  TEST_PLAIN,
  TEST_TUNED,
  WELD_PLAIN,
  WELD_TUNED,
} from './factory-line-programs.js';

export const PUZZLES: PuzzleSpec[] = [
  directControl,
  sealIn,
  eStop,
  delayedStart,
  batchCounter,
  runOnTimer,
  flasher,
  conveyorStop,
  twoHandPress,
  elevatorAutoReturn,
  elevatorDispatch,
  elevatorDoors,
  elevatorFull,
  cabinetLamp,
  cabinetDol,
  cabinetTwoStation,
  cabinetReversing,
  cabinetIndication,
  cabinetReversingProtected,
  packBasics,
  packGroup,
  packLift,
  packFull,
  pickPlaceCycle,
  pickPlaceTray,
  pickPlaceSupply,
  pickPlaceFull,
  drillClampFeed,
  drillStation,
  drillSpindle,
  drillProduction,
  tankLevelReadout,
  tankTwoPosition,
  tankPControl,
  tankPid,
  tankAuto,
  axisJog,
  axisProfile,
  axisLoaded,
  axisCrane,
  asrsDrive,
  asrsPutAway,
  asrsRetrieval,
  asrsTwoLines,
  asrsReplenish,
  asrsDualCycle,
  factorySupervisor,
  factoryWeld,
  factoryConveyor,
  factoryHandling,
  factoryPaint,
  factoryAssembly,
  factoryLineCapstone,
].sort((a, b) => a.order - b.order);

export function getPuzzle(slug: string): PuzzleSpec | undefined {
  return PUZZLES.find((p) => p.slug === slug);
}

export function puzzleSlugs(): string[] {
  return PUZZLES.map((p) => p.slug);
}
