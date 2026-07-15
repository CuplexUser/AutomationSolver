/**
 * Schematic (electrical-diagram) representation of cabinet components.
 *
 * A real IEC schematic draws one physical device as distributed *parts*: a
 * contactor appears as a coil in the control circuit, a 3-pole main contact in
 * the power circuit, and aux contacts wherever they are used. Each part carries
 * a subset of the component's terminals; puzzles author where each part sits on
 * the diagram sheet (`CabinetLayout.schematic`). Wiring is still terminal to
 * terminal — the same `WiringDoc` renders on both the panel and the diagram.
 *
 * Every terminal of a component type appears in exactly one part (enforced by
 * schematic.test.ts), so any wire the player can draw on the panel has a home
 * on the diagram too.
 */

import { terminalsOf, type CabinetComponentType, type CabinetLayout } from './types.js';

export type SchematicSymbol =
  | 'rails' // supply: horizontal L1/L2/L3/N/PE rails
  | 'coil' // contactor coil A1-A2
  | 'contact-no' // single NO contact (button or aux)
  | 'contact-nc' // single NC contact (button or aux)
  | 'main3' // 3-pole main contacts with mechanical linkage
  | 'thermal3' // 3-pole thermal overload elements
  | 'lamp'
  | 'motor3';

export interface SchematicTerminal {
  name: string;
  /** Offset from the part's placement origin; current flows top→bottom. */
  dx: number;
  dy: number;
}

export interface SchematicPartDef {
  /** Part key, unique within the component type (e.g. 'coil', 'aux13'). */
  key: string;
  symbol: SchematicSymbol;
  terminals: readonly SchematicTerminal[];
}

/** Vertical span of a two-terminal symbol (contact, coil, lamp). */
export const SCH_SPAN = 48;
/** Horizontal pitch between poles of a 3-pole symbol. */
export const SCH_POLE = 28;
/** Vertical pitch between supply rails. */
export const SCH_RAIL = 22;

const pair = (a: string, b: string): SchematicTerminal[] => [
  { name: a, dx: 0, dy: 0 },
  { name: b, dx: 0, dy: SCH_SPAN },
];

const poles3 = (names: readonly string[]): SchematicTerminal[] =>
  names.map((name, i) => ({
    name,
    dx: Math.floor(i / 2) * SCH_POLE,
    dy: i % 2 === 0 ? 0 : SCH_SPAN,
  }));

const PARTS: Record<CabinetComponentType, readonly SchematicPartDef[]> = {
  // Split so authors can draw phase rails at the top of the sheet and N/PE
  // rails at the bottom, the way control-circuit diagrams are actually read.
  supply3ph: [
    {
      key: 'phases',
      symbol: 'rails',
      // Taps are staggered horizontally so wires leaving adjacent rails
      // don't overlap when they drop straight down.
      terminals: ['L1', 'L2', 'L3'].map((name, i) => ({ name, dx: i * 18, dy: i * SCH_RAIL })),
    },
    {
      key: 'npe',
      symbol: 'rails',
      terminals: ['N', 'PE'].map((name, i) => ({ name, dx: i * 18, dy: i * SCH_RAIL })),
    },
  ],
  contactor: [
    { key: 'main', symbol: 'main3', terminals: poles3(['1', '2', '3', '4', '5', '6']) },
    { key: 'coil', symbol: 'coil', terminals: pair('A1', 'A2') },
    { key: 'aux13', symbol: 'contact-no', terminals: pair('13', '14') },
    { key: 'aux21', symbol: 'contact-nc', terminals: pair('21', '22') },
  ],
  overload: [
    { key: 'main', symbol: 'thermal3', terminals: poles3(['1', '2', '3', '4', '5', '6']) },
    { key: 'aux95', symbol: 'contact-nc', terminals: pair('95', '96') },
    { key: 'aux97', symbol: 'contact-no', terminals: pair('97', '98') },
  ],
  'button-no': [{ key: 'contact', symbol: 'contact-no', terminals: pair('13', '14') }],
  'button-nc': [{ key: 'contact', symbol: 'contact-nc', terminals: pair('21', '22') }],
  lamp: [{ key: 'lamp', symbol: 'lamp', terminals: pair('X1', 'X2') }],
  motor3: [
    {
      key: 'motor',
      symbol: 'motor3',
      terminals: [
        { name: 'U', dx: 0, dy: 0 },
        { name: 'V', dx: SCH_POLE, dy: 0 },
        { name: 'W', dx: SCH_POLE * 2, dy: 0 },
        { name: 'PE', dx: SCH_POLE * 3, dy: 0 },
      ],
    },
  ],
};

export function schematicPartsOf(type: CabinetComponentType): readonly SchematicPartDef[] {
  return PARTS[type];
}

/** Authored position of one component part on the diagram sheet. */
export interface SchematicPlacement {
  componentId: string;
  part: string;
  x: number;
  y: number;
}

/**
 * Placements a layout must have for every terminal to be reachable on the
 * diagram: one per (component, part). Used by tests and available to authors.
 */
export function requiredPlacements(layout: CabinetLayout): { componentId: string; part: string }[] {
  const out: { componentId: string; part: string }[] = [];
  for (const c of layout.components) {
    for (const p of schematicPartsOf(c.type)) out.push({ componentId: c.id, part: p.key });
  }
  return out;
}

/**
 * Verifies each terminal of each component type belongs to exactly one part.
 * Returns human-readable problems; empty = consistent.
 */
export function schematicRegistryProblems(): string[] {
  const problems: string[] = [];
  const types = Object.keys(PARTS) as CabinetComponentType[];
  for (const type of types) {
    const fromParts = PARTS[type].flatMap((p) => p.terminals.map((t) => t.name));
    const expected = terminalsOf(type).map((t) => t.name);
    const seen = new Set<string>();
    for (const name of fromParts) {
      if (seen.has(name)) problems.push(`${type}: terminal ${name} appears in more than one part`);
      seen.add(name);
    }
    for (const name of expected) {
      if (!seen.has(name)) problems.push(`${type}: terminal ${name} missing from schematic parts`);
    }
    for (const name of fromParts) {
      if (!expected.includes(name)) problems.push(`${type}: unknown terminal ${name} in schematic parts`);
    }
  }
  return problems;
}
