import {
  allowedDeviceKinds,
  COMPARE_OPS,
  formatValueOperand,
  MATH_MNEMONIC,
  MATH_OPS,
  parseAddress,
  parseValueOperand,
  type CompareOp,
  type DeviceKind,
  type ElementType,
  type MathOp,
  type PidParams,
  type SymbolChoice,
} from '@automationsolver/shared';
import { SymbolField } from './SymbolField';

/**
 * Which fields an instruction actually uses, and what to call them.
 *
 * The editor shows *only* these. Leaving every field on screen for every
 * instruction was actively misleading: a Preset K box beside a DIV block reads
 * as though it were part of the division, and an operator dropdown beside a MOV
 * reads as though a move could compare something. Naming them per instruction
 * does the rest of the work — a MOV's two boxes say "Source" and "Dest" rather
 * than "A" and "Address".
 */
export interface FieldConfig {
  /** Label for the device field, or absent when the instruction addresses nothing. */
  address?: string;
  /** True when the device field is a destination register rather than a bit. */
  writesRegister?: boolean;
  preset?: boolean;
  /** Labels for the word operands, in order. */
  operands?: string[];
  op?: 'compare' | 'math';
}

export function fieldsFor(type: ElementType | null): FieldConfig {
  switch (type) {
    case 'timer':
    case 'counter':
      return { address: 'Address', preset: true };
    case 'compare':
      return { operands: ['A', 'B'], op: 'compare' };
    case 'mov':
      return { operands: ['Source'], address: 'Dest', writesRegister: true };
    case 'math':
      return { operands: ['A', 'B'], op: 'math', address: 'Dest', writesRegister: true };
    case 'pid':
      return { operands: ['Setpoint', 'Measured'], address: 'Output', writesRegister: true };
    case 'hwire':
      return {};
    default:
      return { address: 'Address' };
  }
}

/** One editable box in the field bar. A device chip lands in exactly one of these. */
export type FieldSlot = 'a' | 'b' | 'device';

/** The slots this instruction actually shows, left to right. */
export function slotsFor(fields: FieldConfig): FieldSlot[] {
  const slots: FieldSlot[] = [];
  if (fields.operands?.[0]) slots.push('a');
  if (fields.operands?.[1]) slots.push('b');
  if (fields.address) slots.push('device');
  return slots;
}

/**
 * What kind of device an address box actually holds: a literal address's own
 * kind, or — under `symbols` — a declared name's kind. The picker's `commit()`
 * fills the box with the *name* (`ArcAtA`, not `M20`), because that's what a
 * declared variable is for; without this, `parseAddress` alone sees a string
 * it can't parse and every check below it fails silently.
 */
function resolveDeviceKind(address: string, choices: readonly SymbolChoice[]): DeviceKind | null {
  const ref = parseAddress(address);
  if (ref) return ref.kind;
  const name = address.trim().toLowerCase();
  if (name === '') return null;
  return choices.find((c) => c.name.toLowerCase() === name)?.kind ?? null;
}

/** Can this address be typed into this slot? Word operands only ever take a D. */
export function slotAccepts(
  slot: FieldSlot,
  fields: FieldConfig,
  type: ElementType | null,
  address: string,
  choices: readonly SymbolChoice[] = [],
): boolean {
  const kind = resolveDeviceKind(address, choices);
  if (!kind) return false;
  if (slot !== 'device') return kind === 'D';
  if (fields.writesRegister) return kind === 'D';
  return type ? allowedDeviceKinds(type).has(kind) : false;
}

/**
 * The value to actually store for a device box: a literal address uppercased
 * (as always), but a symbol name kept in the case the player chose or typed —
 * resolution matches names case-insensitively, but reading `ARCATA` back off a
 * placed element instead of `ArcAtA` would defeat the point of naming it.
 */
export function normalizeDeviceValue(v: string): string {
  const trimmed = v.trim();
  return parseAddress(trimmed.toUpperCase()) ? trimmed.toUpperCase() : trimmed;
}

/**
 * The value to store for a word operand box, or null if it fits nowhere: a
 * literal `D10`/`K500` (normalized the way it always was), or a declared name
 * for a D register. Word operands never take a bit, so only `kind === 'D'`
 * names apply here, unlike a device box which checks against the instruction.
 */
export function normalizeOperandValue(v: string, choices: readonly SymbolChoice[] = []): string | null {
  const ref = parseValueOperand(v);
  if (ref) return formatValueOperand(ref);
  const name = v.trim();
  if (name === '') return null;
  const match = choices.find((c) => c.kind === 'D' && c.name.toLowerCase() === name.toLowerCase());
  return match ? name : null;
}

/**
 * Where a click on a device chip goes.
 *
 * The slot the player last put a caret in, if it can take the address — so
 * clicking into a MOV's Source box and then clicking `D20` fills Source, not the
 * destination. Otherwise the destination, then the operands left to right: with
 * no other signal, a chip means "this is the thing the block acts on", which is
 * how the chips read before word instructions existed.
 */
export function chipTarget(
  address: string,
  fields: FieldConfig,
  type: ElementType | null,
  focus: FieldSlot | null,
): FieldSlot | null {
  const slots = slotsFor(fields);
  const takes = (s: FieldSlot) => slots.includes(s) && slotAccepts(s, fields, type, address);
  if (focus && takes(focus)) return focus;
  if (takes('device')) return 'device';
  return slots.find(takes) ?? null;
}

/** Compact labels for the corner echo, where "Setpoint" would not fit. */
const SHORT_LABEL: Record<string, string> = {
  Address: 'Addr',
  Source: 'Src',
  Setpoint: 'SV',
  Measured: 'PV',
  Dest: '→',
  Output: '→',
};

export interface FieldValues {
  opA: string;
  opB: string;
  address: string;
  preset: number;
  cmpOp: CompareOp;
  mathOp: MathOp;
}

export interface FieldHandlers {
  onOperand: (index: 0 | 1, value: string) => void;
  onOperandBlur: (index: 0 | 1) => void;
  onAddress: (value: string) => void;
  onPreset: (value: number) => void;
  onOp: (op: CompareOp | MathOp) => void;
  onFocusSlot: (slot: FieldSlot) => void;
}

interface Props {
  fields: FieldConfig;
  values: FieldValues;
  handlers: FieldHandlers;
  editable: boolean;
  /** The slot a device chip would fill right now, ringed so the aim is visible. */
  target: FieldSlot | null;
  /** Shorten the labels — the corner echo has no room for "Setpoint". */
  dense?: boolean;
  addressRef?: React.Ref<HTMLInputElement>;
  operandRef?: React.Ref<HTMLInputElement>;
  /**
   * Names in scope for this POU, or empty on a puzzle written in addresses.
   *
   * Empty is the default and means the boxes stay the plain inputs 46 puzzles
   * have always had — no picker, no list, nothing to dismiss.
   */
  symbols?: SymbolChoice[];
}

/**
 * The boxes that name what the selected (or next-placed) instruction acts on.
 *
 * One component, two mounts: the toolbar and the floating corner echo. They used
 * to be written out separately, which is why the echo still offered Address and
 * Preset K long after MOV and PID arrived with operands of their own.
 */
export function CellFields({
  fields,
  values,
  handlers,
  editable,
  target,
  dense = false,
  addressRef,
  operandRef,
  symbols = [],
}: Props) {
  const label = (text: string) => (dense ? (SHORT_LABEL[text] ?? text) : text);
  const slotClass = (slot: FieldSlot) => `cf-slot${target === slot ? ' is-target' : ''}`;
  // A word operand reads a register or a constant, so offering it a bit would
  // only ever be offering it a mistake.
  const wordSymbols = symbols.filter((c) => c.kind === 'D');

  return (
    <>
      {fields.operands?.[0] && (
        <span className={slotClass('a')}>
          <span className="eyebrow">{label(fields.operands[0])}</span>
          <SymbolField
            inputRef={operandRef}
            className="field mono compact operand"
            value={values.opA}
            onChange={(v) => handlers.onOperand(0, v)}
            onFocus={() => handlers.onFocusSlot('a')}
            onBlur={() => handlers.onOperandBlur(0)}
            choices={wordSymbols}
            disabled={!editable}
            ariaLabel={fields.operands[0]}
            title="A register (D10) or a constant (K500)"
          />
        </span>
      )}
      {fields.op && (
        <span className="cf-slot">
          <span className="eyebrow">Op</span>
          <select
            className="field mono compact op-select"
            value={fields.op === 'math' ? values.mathOp : values.cmpOp}
            onChange={(e) => handlers.onOp(e.target.value as CompareOp | MathOp)}
            disabled={!editable}
            aria-label={fields.op === 'math' ? 'Arithmetic operator' : 'Comparison'}
          >
            {fields.op === 'math'
              ? MATH_OPS.map((o) => (
                  <option key={o} value={o}>
                    {MATH_MNEMONIC[o]}
                  </option>
                ))
              : COMPARE_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
          </select>
        </span>
      )}
      {fields.operands?.[1] && (
        <span className={slotClass('b')}>
          <span className="eyebrow">{label(fields.operands[1])}</span>
          <SymbolField
            className="field mono compact operand"
            value={values.opB}
            onChange={(v) => handlers.onOperand(1, v)}
            onFocus={() => handlers.onFocusSlot('b')}
            onBlur={() => handlers.onOperandBlur(1)}
            choices={wordSymbols}
            disabled={!editable}
            ariaLabel={fields.operands[1]}
            title="A register (D10) or a constant (K500)"
          />
        </span>
      )}
      {fields.address && (
        <span className={slotClass('device')}>
          <span className="eyebrow">
            {fields.writesRegister && !dense ? `→ ${fields.address}` : label(fields.address)}
          </span>
          <SymbolField
            inputRef={addressRef}
            className="field mono compact"
            value={values.address}
            onChange={handlers.onAddress}
            onFocus={() => handlers.onFocusSlot('device')}
            choices={fields.writesRegister ? wordSymbols : symbols}
            disabled={!editable}
            ariaLabel={fields.address}
            title={fields.writesRegister ? 'The data register this block writes' : undefined}
          />
        </span>
      )}
      {fields.preset && (
        <span className="cf-slot">
          <span className="eyebrow">{dense ? 'K' : 'Preset K'}</span>
          <input
            className="field mono compact preset"
            type="number"
            min={1}
            value={values.preset}
            onChange={(e) => handlers.onPreset(Math.max(1, Number(e.target.value)))}
            disabled={!editable}
            aria-label="Timer/counter preset"
          />
        </span>
      )}
    </>
  );
}

/**
 * PID tuning: five small numbers that only matter with a loop block in hand, so
 * they appear with one and stay out of the way otherwise.
 */
export function PidTuning({
  tuning,
  onChange,
  editable,
  editing,
}: {
  tuning: PidParams;
  onChange: (patch: Partial<PidParams>) => void;
  editable: boolean;
  /** True when a placed block is selected, rather than priming the next one. */
  editing: boolean;
}) {
  return (
    <div className="pid-tuning" role="group" aria-label="PID tuning">
      <span className="eyebrow">{editing ? 'Tuning this loop' : 'Tuning for the next loop'}</span>
      <label>
        Kp
        <input
          className="field mono compact preset"
          type="number"
          min={0}
          step={10}
          value={tuning.kp}
          onChange={(e) => onChange({ kp: Math.max(0, Number(e.target.value)) })}
          disabled={!editable}
          title="Gain in hundredths: 250 is a gain of 2.50"
        />
      </label>
      <label>
        Ti ms
        <input
          className="field mono compact preset"
          type="number"
          min={0}
          step={100}
          value={tuning.ti}
          onChange={(e) => onChange({ ti: Math.max(0, Number(e.target.value)) })}
          disabled={!editable}
          title="Integral time in ms. 0 turns the term off, leaving a P controller"
        />
      </label>
      <label>
        Td ms
        <input
          className="field mono compact preset"
          type="number"
          min={0}
          step={100}
          value={tuning.td}
          onChange={(e) => onChange({ td: Math.max(0, Number(e.target.value)) })}
          disabled={!editable}
          title="Derivative time in ms. 0 turns the term off"
        />
      </label>
      <label>
        Out
        <input
          className="field mono compact preset"
          type="number"
          value={tuning.outMin}
          onChange={(e) => onChange({ outMin: Number(e.target.value) })}
          disabled={!editable}
          title="Lowest value the block will command"
        />
      </label>
      <label>
        to
        <input
          className="field mono compact preset"
          type="number"
          value={tuning.outMax}
          onChange={(e) => onChange({ outMax: Number(e.target.value) })}
          disabled={!editable}
          title="Highest value the block will command"
        />
      </label>
    </div>
  );
}
