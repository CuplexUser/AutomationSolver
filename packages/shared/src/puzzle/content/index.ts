import type { PuzzleSpec } from '../types.js';
import { directControl } from './01-direct-control.js';
import { sealIn } from './02-seal-in.js';
import { eStop } from './03-estop.js';
import { delayedStart } from './04-delayed-start.js';
import { batchCounter } from './05-batch-counter.js';
import { conveyorStop } from './06-conveyor-stop.js';
import { drillStation } from './07-drill-station.js';
import { elevatorAutoReturn } from './08-elevator.js';

export const PUZZLES: PuzzleSpec[] = [
  directControl,
  sealIn,
  eStop,
  delayedStart,
  batchCounter,
  conveyorStop,
  drillStation,
  elevatorAutoReturn,
].sort((a, b) => a.order - b.order);

export function getPuzzle(slug: string): PuzzleSpec | undefined {
  return PUZZLES.find((p) => p.slug === slug);
}

export function puzzleSlugs(): string[] {
  return PUZZLES.map((p) => p.slug);
}
