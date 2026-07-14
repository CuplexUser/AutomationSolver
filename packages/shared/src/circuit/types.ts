/**
 * Control-cabinet wiring domain.
 *
 * A cabinet puzzle fixes a set of components on a panel; the player only adds
 * wires between component terminals. Terminal ids are `${componentId}.${name}`
 * (IEC-style terminal numbering, e.g. "K1.A1", "F1.96", "PS.L1").
 *
 * NOTE: terminal names are a persistence API — saved solution slots embed
 * TerminalIds — so the names in TERMINALS below are frozen once shipped.
 */

/** `${componentId}.${terminalName}` */
export type TerminalId = string;

export type SupplyPotential = 'L1' | 'L2' | 'L3' | 'N' | 'PE';

export type CabinetComponentType =
  | 'supply3ph' // incoming supply: L1 L2 L3 N PE
  | 'contactor' // coil A1/A2, mains 1-2 3-4 5-6, aux NO 13-14, aux NC 21-22
  | 'overload' // thermal overload: mains 1-2 3-4 5-6, aux NC 95-96, aux NO 97-98
  | 'button-no' // pushbutton, normally open: 13-14
  | 'button-nc' // pushbutton, normally closed: 21-22
  | 'lamp' // indicator lamp: X1-X2
  | 'motor3'; // 3-phase motor: U V W PE

export interface CabinetComponent {
  id: string; // 'K1', 'S1', 'F1', 'H1', 'M1', 'PS'
  type: CabinetComponentType;
  label: string;
  /**
   * Links the component to a PuzzleDevice address (usually === id).
   * Buttons read this bit as "actuated"; overloads read it as "trip forced";
   * contactors/lamps/motors report their state on it.
   */
  hmiAddress?: string;
  /** Fixed position on the SVG panel. */
  x: number;
  y: number;
}

export interface CabinetLayout {
  components: CabinetComponent[];
}

export interface Wire {
  id: string;
  from: TerminalId;
  to: TerminalId;
}

/** The player's "program" for a cabinet puzzle. */
export interface WiringDoc {
  wires: Wire[];
}

export type TerminalRole = 'source' | 'neutral' | 'pe' | 'coil' | 'contact' | 'load';

export interface TerminalDef {
  name: string;
  /** Offset from the component origin on the panel. */
  dx: number;
  dy: number;
  role: TerminalRole;
}

const TERMINALS: Record<CabinetComponentType, readonly TerminalDef[]> = {
  supply3ph: [
    { name: 'L1', dx: 0, dy: 0, role: 'source' },
    { name: 'L2', dx: 32, dy: 0, role: 'source' },
    { name: 'L3', dx: 64, dy: 0, role: 'source' },
    { name: 'N', dx: 96, dy: 0, role: 'neutral' },
    { name: 'PE', dx: 128, dy: 0, role: 'pe' },
  ],
  contactor: [
    { name: 'A1', dx: 0, dy: 0, role: 'coil' },
    { name: 'A2', dx: 0, dy: 64, role: 'coil' },
    { name: '1', dx: 40, dy: 0, role: 'contact' },
    { name: '2', dx: 40, dy: 64, role: 'contact' },
    { name: '3', dx: 72, dy: 0, role: 'contact' },
    { name: '4', dx: 72, dy: 64, role: 'contact' },
    { name: '5', dx: 104, dy: 0, role: 'contact' },
    { name: '6', dx: 104, dy: 64, role: 'contact' },
    { name: '13', dx: 144, dy: 0, role: 'contact' },
    { name: '14', dx: 144, dy: 64, role: 'contact' },
    { name: '21', dx: 176, dy: 0, role: 'contact' },
    { name: '22', dx: 176, dy: 64, role: 'contact' },
  ],
  overload: [
    { name: '1', dx: 0, dy: 0, role: 'contact' },
    { name: '2', dx: 0, dy: 64, role: 'contact' },
    { name: '3', dx: 32, dy: 0, role: 'contact' },
    { name: '4', dx: 32, dy: 64, role: 'contact' },
    { name: '5', dx: 64, dy: 0, role: 'contact' },
    { name: '6', dx: 64, dy: 64, role: 'contact' },
    { name: '95', dx: 104, dy: 0, role: 'contact' },
    { name: '96', dx: 104, dy: 64, role: 'contact' },
    { name: '97', dx: 136, dy: 0, role: 'contact' },
    { name: '98', dx: 136, dy: 64, role: 'contact' },
  ],
  'button-no': [
    { name: '13', dx: 0, dy: 0, role: 'contact' },
    { name: '14', dx: 0, dy: 48, role: 'contact' },
  ],
  'button-nc': [
    { name: '21', dx: 0, dy: 0, role: 'contact' },
    { name: '22', dx: 0, dy: 48, role: 'contact' },
  ],
  lamp: [
    { name: 'X1', dx: 0, dy: 0, role: 'load' },
    { name: 'X2', dx: 0, dy: 48, role: 'load' },
  ],
  motor3: [
    { name: 'U', dx: 0, dy: 0, role: 'load' },
    { name: 'V', dx: 32, dy: 0, role: 'load' },
    { name: 'W', dx: 64, dy: 0, role: 'load' },
    { name: 'PE', dx: 96, dy: 0, role: 'pe' },
  ],
};

export function terminalsOf(type: CabinetComponentType): readonly TerminalDef[] {
  return TERMINALS[type];
}

export function terminalId(componentId: string, terminalName: string): TerminalId {
  return `${componentId}.${terminalName}`;
}

/** All terminal ids of a layout, in deterministic (layout, terminal) order. */
export function layoutTerminals(layout: CabinetLayout): TerminalId[] {
  const out: TerminalId[] = [];
  for (const c of layout.components) {
    for (const t of terminalsOf(c.type)) out.push(terminalId(c.id, t.name));
  }
  return out;
}
