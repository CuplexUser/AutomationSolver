import { addressKind } from '../ladder/address.js';
import type { DeviceKind, LadderProject } from '../ladder/types.js';
import type { SymbolOrigin } from './symbols.js';
import { deviceSymbol } from './symbols.js';
import { isAnalog, type LadderPuzzleSpec } from './types.js';

/**
 * One entry in the symbol picker: a name, where it came from, and what it is.
 *
 * Built here rather than inside the editor so the editor keeps taking a plain
 * list. It has never needed to know what a puzzle spec is, and a picker is a
 * poor reason to teach it.
 */
export interface SymbolChoice {
  name: string;
  address: string;
  /** `plant` reads off the device list; the other two are declarations. */
  origin: Exclude<SymbolOrigin, 'literal'>;
  kind: DeviceKind;
  /** The device's label, or the variable's comment: whatever explains the name. */
  detail?: string;
  /** A field input, which a program may read but never drive. */
  readOnly?: boolean;
}

/**
 * Every name in scope for one POU, in the order a picker should offer them.
 *
 * Locals first, then globals, then the plant. That is resolution order, and a
 * list ordered any other way would put the name that wins at the bottom.
 */
export function symbolChoicesFor(
  spec: LadderPuzzleSpec,
  project: LadderProject,
  pouId: string,
): SymbolChoice[] {
  if ((spec.symbols ?? 'off') === 'off') return [];

  const out: SymbolChoice[] = [];
  const seen = new Set<string>();
  const push = (choice: SymbolChoice): void => {
    const key = choice.name.trim().toLowerCase();
    // A local shadows a global of the same name, so whichever we meet first is
    // the one that would actually resolve — and the only one worth offering.
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    out.push(choice);
  };

  const pou = project.pous.find((p) => p.id === pouId);
  for (const decl of pou?.vars ?? []) {
    push({
      name: decl.name,
      address: decl.address,
      origin: 'local',
      kind: addressKind(decl.address) ?? 'M',
      detail: decl.comment,
    });
  }
  for (const decl of project.globals ?? []) {
    push({
      name: decl.name,
      address: decl.address,
      origin: 'global',
      kind: addressKind(decl.address) ?? 'M',
      detail: decl.comment,
    });
  }
  for (const device of spec.devices) {
    push({
      name: deviceSymbol(device),
      address: device.address,
      origin: 'plant',
      kind: addressKind(device.address) ?? 'X',
      detail: device.label,
      readOnly: device.io === 'input' && !isAnalog(device),
    });
  }
  return out;
}

/**
 * Rank the choices against what has been typed so far.
 *
 * A prefix match beats a match in the middle, because that is what typing three
 * letters of a name you already know is asking for. Everything else keeps the
 * order it came in, which is resolution order.
 */
export function filterChoices(choices: SymbolChoice[], query: string): SymbolChoice[] {
  const q = query.trim().toLowerCase();
  if (q === '') return choices;
  const prefix: SymbolChoice[] = [];
  const contains: SymbolChoice[] = [];
  for (const choice of choices) {
    const name = choice.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(choice);
    else if (name.includes(q) || choice.address.toLowerCase().startsWith(q)) contains.push(choice);
  }
  return [...prefix, ...contains];
}
