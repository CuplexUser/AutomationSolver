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

export const PUZZLES: PuzzleSpec[] = [
  directControl,
  sealIn,
  eStop,
  delayedStart,
  batchCounter,
  conveyorStop,
  drillStation,
  elevatorAutoReturn,
  elevatorDispatch,
  elevatorDoors,
  elevatorFull,
  cabinetLamp,
  cabinetDol,
  cabinetReversing,
  cabinetIndication,
  cabinetReversingProtected,
].sort((a, b) => a.order - b.order);

export function getPuzzle(slug: string): PuzzleSpec | undefined {
  return PUZZLES.find((p) => p.slug === slug);
}

export function puzzleSlugs(): string[] {
  return PUZZLES.map((p) => p.slug);
}
