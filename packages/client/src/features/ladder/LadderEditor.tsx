import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COMPARE_OPS,
  formatValueOperand,
  isValueOperand,
  isWordInstruction,
  MATH_OPS,
  MATH_MNEMONIC,
  MATH_SYMBOL,
  parseValueOperand,
  type CompareOp,
  type ElementType,
  type LadderElement,
  type LadderProgram,
  type MathOp,
  type PidParams,
  type PuzzleDevice,
  type PuzzleRegister,
  type RungEvalResult,
} from '@automationsolver/shared';
import { CELL_H, CELL_W } from './CellView';
import { useEditor } from './editorStore';
import { RungView } from './RungView';

const ADDRESS_RE = /^[XYMTCD]\d{1,4}$/i;

interface InstrMeta {
  type: ElementType;
  label: string;
  glyph: string;
  /** Single-key shortcut that places this instruction in the selected cell. */
  key: string;
  needsPreset?: boolean;
  needsDevice?: boolean;
  /** Takes word operands (A/B) rather than only a bit address. */
  word?: boolean;
}

// Every shortcut is a letter from the instruction's own name, and the three the
// editor itself has claimed (A add rung, I insert rung, B branch) are avoided.
const INSTRUCTIONS: InstrMeta[] = [
  { type: 'contact-no', label: 'NO Contact', glyph: '┤ ├', key: 'c', needsDevice: true },
  { type: 'contact-nc', label: 'NC Contact', glyph: '┤/├', key: 'x', needsDevice: true },
  { type: 'contact-rising', label: 'Rising Edge', glyph: '┤↑├', key: 'p', needsDevice: true },
  { type: 'contact-falling', label: 'Falling Edge', glyph: '┤↓├', key: 'n', needsDevice: true },
  { type: 'compare', label: 'Compare', glyph: '┤>├', key: 'e', word: true },
  { type: 'coil-out', label: 'Output Coil', glyph: '( )', key: 'o', needsDevice: true },
  { type: 'coil-set', label: 'Set', glyph: '(S)', key: 's', needsDevice: true },
  { type: 'coil-reset', label: 'Reset', glyph: '(R)', key: 'r', needsDevice: true },
  { type: 'timer', label: 'Timer', glyph: 'T', key: 't', needsPreset: true, needsDevice: true },
  { type: 'counter', label: 'Counter', glyph: 'C', key: 'k', needsPreset: true, needsDevice: true },
  { type: 'mov', label: 'Move', glyph: 'MOV', key: 'm', needsDevice: true, word: true },
  { type: 'math', label: 'Math', glyph: '+−×÷', key: 'h', needsDevice: true, word: true },
  { type: 'pid', label: 'PID Loop', glyph: 'PID', key: 'd', needsDevice: true, word: true },
  { type: 'hwire', label: 'Wire', glyph: '──', key: 'w', needsDevice: false },
];

/** Default tuning a freshly placed PID block starts from, then gets edited. */
const DEFAULT_PID: PidParams = {
  kp: 300,
  ti: 4000,
  td: 0,
  sampleMs: 100,
  outMin: 0,
  outMax: 4000,
};

/**
 * Which fields an instruction actually uses, and what to call them.
 *
 * The toolbar shows *only* these. Leaving every field on screen for every
 * instruction was actively misleading: a Preset K box beside a DIV block reads
 * as though it were part of the division, and an operator dropdown beside a MOV
 * reads as though a move could compare something. Naming them per instruction
 * does the rest of the work — a MOV's two boxes say "Source" and "Dest" rather
 * than "A" and "Address".
 */
interface FieldConfig {
  /** Label for the device field, or absent when the instruction addresses nothing. */
  address?: string;
  /** True when the device field is a destination register rather than a bit. */
  writesRegister?: boolean;
  preset?: boolean;
  /** Labels for the word operands, in order. */
  operands?: string[];
  op?: 'compare' | 'math';
}

function fieldsFor(type: ElementType | null): FieldConfig {
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

/** A word instruction's destination has to be a data register, never a bit. */
const REGISTER_RE = /^D\d{1,4}$/i;

/** "D0 ÷ K4 into D10" — the selected word instruction, spelled out in the hint. */
function wordSummary(el: LadderElement): string {
  const [a = '?', b = '?'] = el.operands ?? [];
  switch (el.type) {
    case 'compare':
      return `${a} ${el.op ?? '='} ${b}`;
    case 'mov':
      return `${a} into ${el.device}`;
    case 'math':
      return `${a} ${MATH_SYMBOL[(el.op as MathOp) ?? 'add']} ${b} into ${el.device}`;
    case 'pid':
      return `PID, setpoint ${a}, measured ${b}, output ${el.device}`;
    default:
      return el.device;
  }
}

interface Props {
  /** Used to remember this puzzle's zoom — a 2-rung tutorial wants a different one from an 8-rung sequence. */
  puzzleSlug: string;
  allowedInstructions: ElementType[];
  devices: PuzzleDevice[];
  registers?: PuzzleRegister[];
  evalResults: RungEvalResult[];
  running: boolean;
}

const DEVICE_TYPES = new Set(INSTRUCTIONS.filter((i) => i.needsDevice).map((i) => i.type));
const PRESET_TYPES = new Set(INSTRUCTIONS.filter((i) => i.needsPreset).map((i) => i.type));

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 20) / 20));

const RAIL_PX = 14; // both power rails
const RUNG_CHROME_PX = 18; // rung header + the gap below it
const ADD_RUNG_PX = 46;

/** The un-zoomed pixel size of the whole ladder, derived from the program itself. */
function naturalSize(program: LadderProgram): { w: number; h: number } {
  let w = 0;
  let h = ADD_RUNG_PX;
  for (const rung of program.rungs) {
    w = Math.max(w, rung.cols * CELL_W + RAIL_PX);
    h += rung.rows * CELL_H + RUNG_CHROME_PX;
  }
  return { w: Math.max(w, 1), h: Math.max(h, 1) };
}

/** A boolean editor preference, persisted across sessions and shared by every puzzle. */
function usePersistedBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return saved === null ? initial : saved === '1';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value ? '1' : '0');
  }, [key, value]);
  return [value, setValue];
}

/** Don't hijack keys while the user is typing into a field. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function LadderEditor({
  puzzleSlug,
  allowedInstructions,
  devices,
  registers = [],
  evalResults,
  running,
}: Props) {
  const {
    program,
    selected,
    select,
    placeSelected,
    patchSelected,
    setCell,
    toggleVlink,
    addRung,
    insertRung,
    moveRung,
    removeRung,
    addRow,
    addCol,
  } = useEditor();
  const [address, setAddress] = useState('X0');
  const [preset, setPreset] = useState(10);
  // Word-instruction operands, primed for the next placement and retyped in
  // place while a word element is selected — exactly how Address/Preset behave.
  const [opA, setOpA] = useState('D0');
  const [opB, setOpB] = useState('K0');
  const [cmpOp, setCmpOp] = useState<CompareOp>('>=');
  const [mathOp, setMathOp] = useState<MathOp>('add');
  const [tuning, setTuning] = useState<PidParams>(DEFAULT_PID);
  const [paletteOpen, setPaletteOpen] = useState(true);
  // The instruction whose fields the toolbar is showing: whatever is selected,
  // falling back to the last thing placed so the fields stay put after a
  // placement instead of snapping back to a generic Address box.
  const [lastPlaced, setLastPlaced] = useState<ElementType | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const operandRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const zoomKey = `ladder.zoom:${puzzleSlug}`;
  const [zoom, setZoom] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(zoomKey) : null;
    return saved ? clampZoom(Number(saved)) : 1;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(zoomKey, String(zoom));
  }, [zoomKey, zoom]);

  // Two independent, user-toggleable ways to reach Address/Preset K without
  // scrolling back to the top of a long program: pin the whole toolbar, and/or
  // float a small echo of the same fields in the corner. Global (not per-puzzle)
  // since they're editor preferences, not something a specific puzzle needs.
  const [stickyPalette, setStickyPalette] = usePersistedBool('ladder.stickyPalette', true);
  const [floatingEditor, setFloatingEditor] = usePersistedBool('ladder.floatingEditor', false);

  /** Scale the ladder so the whole program fills the visible area — big on a short program. */
  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { w, h } = naturalSize(program);
    const availW = el.clientWidth - 24;
    const availH = el.clientHeight - 24;
    setZoom(clampZoom(Math.min(availW / w, availH / h)));
  }, [program]);

  const allowed = new Set<ElementType>([...allowedInstructions, 'hwire']);
  const editable = !running;
  const palette = INSTRUCTIONS.filter((i) => allowed.has(i.type));

  const selectedEl = selected ? (program.rungs[selected.rung]?.cells[selected.row]?.[selected.col] ?? null) : null;
  // Editing an already-placed device-bearing element? Then the Address/Preset
  // fields retype that element in place instead of only priming the next placement.
  const retypeDevice = editable && !!selectedEl && DEVICE_TYPES.has(selectedEl.type);
  const retypePreset = editable && !!selectedEl && PRESET_TYPES.has(selectedEl.type);
  const retypeWord = editable && !!selectedEl && isWordInstruction(selectedEl.type);
  const activeType = selectedEl?.type ?? lastPlaced;
  const fields = fieldsFor(activeType);

  /** Select a cell and load whatever it holds into the palette inputs. */
  const selectCell = useCallback(
    (pos: { rung: number; row: number; col: number } | null) => {
      select(pos);
      if (!pos) return;
      const el = program.rungs[pos.rung]?.cells[pos.row]?.[pos.col];
      if (el?.device) setAddress(el.device);
      if (el?.preset != null) setPreset(el.preset);
      if (el?.operands?.[0] != null) setOpA(el.operands[0]);
      if (el?.operands?.[1] != null) setOpB(el.operands[1]);
      if (el?.type === 'compare' && el.op) setCmpOp(el.op as CompareOp);
      if (el?.type === 'math' && el.op) setMathOp(el.op as MathOp);
      if (el?.pid) setTuning(el.pid);
    },
    [program, select],
  );

  const changeAddress = (v: string) => {
    setAddress(v);
    setPlaceError(null);
    if (!retypeDevice) return;
    // Retyping a word block's destination is held to the same rule placing one
    // is: it writes a register, so only a D address takes effect.
    const re = fieldsFor(selectedEl?.type ?? null).writesRegister ? REGISTER_RE : ADDRESS_RE;
    if (re.test(v.trim())) patchSelected({ device: v.trim().toUpperCase() });
  };

  const changePreset = (v: number) => {
    setPreset(v);
    if (retypePreset) patchSelected({ preset: v });
  };

  const applyAddress = (addr: string) => {
    setAddress(addr);
    if (retypeDevice) patchSelected({ device: addr });
  };

  /**
   * Retype one operand of the selected word element, once it parses.
   *
   * Normalized on the way in, so a bare `10` is stored and shown as `K10`. The
   * distinction between a constant and a register is the whole grammar of these
   * instructions, and a naked number hides it.
   */
  const changeOperand = (index: 0 | 1, v: string) => {
    if (index === 0) setOpA(v);
    else setOpB(v);
    setPlaceError(null);
    const ref = parseValueOperand(v);
    if (!retypeWord || !ref) return;
    const next = [...(selectedEl?.operands ?? [])];
    next[index] = formatValueOperand(ref);
    patchSelected({ operands: next });
  };

  /** Normalize the operand boxes on blur, so what is shown is what is stored. */
  const normalizeOperand = (index: 0 | 1) => {
    const raw = index === 0 ? opA : opB;
    const ref = parseValueOperand(raw);
    if (!ref) return;
    const text = formatValueOperand(ref);
    if (index === 0) setOpA(text);
    else setOpB(text);
  };

  const changeOp = (op: CompareOp | MathOp) => {
    if (COMPARE_OPS.includes(op as CompareOp)) setCmpOp(op as CompareOp);
    else setMathOp(op as MathOp);
    if (retypeWord) patchSelected({ op });
  };

  const changeTuning = (patch: Partial<PidParams>) => {
    const next = { ...tuning, ...patch };
    setTuning(next);
    if (retypeWord && selectedEl?.type === 'pid') patchSelected({ pid: next });
  };

  /** The operand/op/tuning payload a word instruction is placed with. */
  const wordPayload = useCallback(
    (type: ElementType): Partial<LadderElement> => {
      const norm = (raw: string): string => {
        const ref = parseValueOperand(raw);
        return ref ? formatValueOperand(ref) : raw.trim().toUpperCase();
      };
      const a = norm(opA);
      const b = norm(opB);
      switch (type) {
        case 'compare':
          return { operands: [a, b], op: cmpOp };
        case 'mov':
          return { operands: [a] };
        case 'math':
          return { operands: [a, b], op: mathOp };
        case 'pid':
          return { operands: [a, b], pid: tuning };
        default:
          return {};
      }
    },
    [opA, opB, cmpOp, mathOp, tuning],
  );

  const place = useCallback(
    (meta: InstrMeta) => {
      if (!selected) return;
      const cfg = fieldsFor(meta.type);
      const addr = address.trim();

      // A word instruction writes a *register*. Without this check the leftover
      // Address value silently becomes the destination, so a DIV placed after a
      // contact would quietly try to write its result into X0.
      if (cfg.address) {
        const re = cfg.writesRegister ? REGISTER_RE : ADDRESS_RE;
        if (!re.test(addr)) {
          setPlaceError(
            cfg.writesRegister
              ? `${meta.label} writes a data register. Put a D address (like D10) in ${cfg.address}.`
              : `${meta.label} needs a device address in ${cfg.address}.`,
          );
          addressRef.current?.focus();
          addressRef.current?.select();
          return;
        }
      }
      // Same for the operands: a half-typed one would land as a literal string
      // and only surface as a validation error at submit time.
      for (const [i, label] of (cfg.operands ?? []).entries()) {
        if (!isValueOperand(i === 0 ? opA : opB)) {
          setPlaceError(`${label} must be a register (D10) or a constant (K500).`);
          operandRef.current?.focus();
          operandRef.current?.select();
          return;
        }
      }

      setPlaceError(null);
      setLastPlaced(meta.type);
      placeSelected(
        meta.type,
        cfg.address ? addr.toUpperCase() : '',
        cfg.preset ? preset : undefined,
        meta.word ? wordPayload(meta.type) : undefined,
      );
    },
    [selected, address, preset, placeSelected, wordPayload, opA, opB],
  );

  /** Move the selection, wrapping across rungs at the top and bottom edges. */
  const moveSelection = useCallback(
    (dRow: number, dCol: number) => {
      if (!program.rungs.length) return;
      if (!selected) {
        selectCell({ rung: 0, row: 0, col: 0 });
        return;
      }
      let { rung, row, col } = selected;
      const cur = program.rungs[rung];
      if (!cur) return;
      col = Math.min(Math.max(col + dCol, 0), cur.cols - 1);
      row += dRow;
      if (row < 0) {
        if (rung > 0) {
          rung -= 1;
          row = program.rungs[rung].rows - 1;
        } else {
          row = 0;
        }
      } else if (row > cur.rows - 1) {
        if (rung < program.rungs.length - 1) {
          rung += 1;
          row = 0;
        } else {
          row = cur.rows - 1;
        }
      }
      col = Math.min(col, program.rungs[rung].cols - 1);
      selectCell({ rung, row, col });
    },
    [program, selected, selectCell],
  );

  // Keyboard shortcuts. The palette is a fallback for discovery — this is the fast path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Zoom works even while the sim is running, and even from inside a field.
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom((z) => clampZoom(z + 0.1));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom((z) => clampZoom(z - 0.1));
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(1);
        } else if (editable && selected && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          moveRung(selected.rung, e.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }
      if (!editable || isTypingTarget(e.target) || e.altKey) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-1, 0);
          return;
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey && selected) addRow(selected.rung);
          else moveSelection(1, 0);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection(0, -1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey && selected) addCol(selected.rung);
          else moveSelection(0, 1);
          return;
        case 'Delete':
        case 'Backspace':
          if (selected) {
            e.preventDefault();
            setCell(selected, null);
          }
          return;
        case 'Enter':
          e.preventDefault();
          addressRef.current?.select();
          return;
        case 'Escape':
          selectCell(null);
          return;
      }

      const k = e.key.toLowerCase();
      if (k === 'b' && selected) {
        e.preventDefault();
        toggleVlink(selected.rung, selected.row, selected.col);
        return;
      }
      if (k === 'a') {
        e.preventDefault();
        addRung();
        return;
      }
      if (k === 'i') {
        e.preventDefault();
        insertRung(selected ? selected.rung + 1 : program.rungs.length);
        return;
      }
      const meta = palette.find((i) => i.key === k);
      if (meta && selected) {
        e.preventDefault();
        place(meta);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    editable,
    selected,
    palette,
    place,
    moveSelection,
    setCell,
    selectCell,
    toggleVlink,
    addRung,
    insertRung,
    moveRung,
    addRow,
    addCol,
    program.rungs.length,
  ]);

  return (
    <div className="ladder-editor">
      <div className={`palette panel${stickyPalette ? ' palette-pinned' : ''}`}>
        <div className="palette-row">
          <div className="palette-fields">
            <button
              className="icon-btn palette-fold"
              onClick={() => setPaletteOpen((v) => !v)}
              title={paletteOpen ? 'Collapse the palette' : 'Expand the palette'}
              aria-expanded={paletteOpen}
            >
              {paletteOpen ? '▾' : '▸'}
            </button>
            {/* Only the fields the active instruction actually uses, in the
                order it reads: operands, then operator, then destination. */}
            {fields.operands?.[0] && (
              <>
                <span className="eyebrow">{fields.operands[0]}</span>
                <input
                  ref={operandRef}
                  className="field mono compact operand"
                  value={opA}
                  onChange={(e) => changeOperand(0, e.target.value)}
                  onBlur={() => normalizeOperand(0)}
                  disabled={!editable}
                  aria-label={fields.operands[0]}
                  title="A register (D10) or a constant (K500)"
                />
              </>
            )}
            {fields.op && (
              <>
                <span className="eyebrow">Op</span>
                <select
                  className="field mono compact op-select"
                  value={fields.op === 'math' ? mathOp : cmpOp}
                  onChange={(e) => changeOp(e.target.value as CompareOp | MathOp)}
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
              </>
            )}
            {fields.operands?.[1] && (
              <>
                <span className="eyebrow">{fields.operands[1]}</span>
                <input
                  className="field mono compact operand"
                  value={opB}
                  onChange={(e) => changeOperand(1, e.target.value)}
                  onBlur={() => normalizeOperand(1)}
                  disabled={!editable}
                  aria-label={fields.operands[1]}
                  title="A register (D10) or a constant (K500)"
                />
              </>
            )}
            {fields.address && (
              <>
                <span className="eyebrow">{fields.writesRegister ? `→ ${fields.address}` : fields.address}</span>
                <input
                  ref={addressRef}
                  className="field mono compact"
                  value={address}
                  onChange={(e) => changeAddress(e.target.value)}
                  disabled={!editable}
                  aria-label={fields.address}
                  title={fields.writesRegister ? 'The data register this block writes' : undefined}
                />
              </>
            )}
            {fields.preset && (
              <>
                <span className="eyebrow">Preset K</span>
                <input
                  className="field mono compact preset"
                  type="number"
                  min={1}
                  value={preset}
                  onChange={(e) => changePreset(Math.max(1, Number(e.target.value)))}
                  disabled={!editable}
                  aria-label="Timer/counter preset"
                />
              </>
            )}
          </div>
          <div className="palette-controls">
            <div className="editor-prefs" role="group" aria-label="Editor preferences">
              <label className="pref-toggle" title="Keep this toolbar pinned to the top while scrolling a long program">
                <input type="checkbox" checked={stickyPalette} onChange={(e) => setStickyPalette(e.target.checked)} />
                Pin toolbar
              </label>
              <label
                className="pref-toggle"
                title="Show a floating Address/Preset K editor in the corner, so you can retype a cell without scrolling"
              >
                <input type="checkbox" checked={floatingEditor} onChange={(e) => setFloatingEditor(e.target.checked)} />
                Floating editor
              </label>
            </div>
            <div className="zoom-ctl" role="group" aria-label="Ladder zoom">
              <button className="icon-btn" onClick={() => setZoom((z) => clampZoom(z - 0.1))} title="Zoom out (Ctrl −)">
                −
              </button>
              <span className="zoom-val">{Math.round(zoom * 100)}%</span>
              <button className="icon-btn" onClick={() => setZoom((z) => clampZoom(z + 0.1))} title="Zoom in (Ctrl +)">
                +
              </button>
              <button className="icon-btn" onClick={fitZoom} title="Fit the program to the window">
                Fit
              </button>
              <button className="icon-btn" onClick={() => setZoom(1)} title="Reset zoom (Ctrl 0)">
                100%
              </button>
            </div>
          </div>
          {/* Tuning is only meaningful with a loop block in hand, so it appears
              with one and stays out of the way otherwise. */}
          {activeType === 'pid' && (
            <div className="pid-tuning" role="group" aria-label="PID tuning">
              <span className="eyebrow">
                {selectedEl?.type === 'pid' ? 'Tuning this loop' : 'Tuning for the next loop'}
              </span>
              <label>
                Kp
                <input
                  className="field mono compact preset"
                  type="number"
                  min={0}
                  step={10}
                  value={tuning.kp}
                  onChange={(e) => changeTuning({ kp: Math.max(0, Number(e.target.value)) })}
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
                  onChange={(e) => changeTuning({ ti: Math.max(0, Number(e.target.value)) })}
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
                  onChange={(e) => changeTuning({ td: Math.max(0, Number(e.target.value)) })}
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
                  onChange={(e) => changeTuning({ outMin: Number(e.target.value) })}
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
                  onChange={(e) => changeTuning({ outMax: Number(e.target.value) })}
                  disabled={!editable}
                  title="Highest value the block will command"
                />
              </label>
            </div>
          )}
          <div className="dev-quick">
            {[...devices.map((d) => ({ address: d.address, label: d.label })), ...registers].map((d) => (
              <button
                key={d.address}
                className={`dev-chip dev-${d.address[0]}`}
                onClick={() => applyAddress(d.address)}
                disabled={!editable}
                title={d.label}
              >
                {d.address}
              </button>
            ))}
          </div>
        </div>

        {paletteOpen && (
          <>
            <div className="palette-instr">
              {palette.map((meta) => (
                <button
                  key={meta.type}
                  className="instr-btn"
                  disabled={!editable || !selected}
                  onClick={() => place(meta)}
                  title={`${meta.label} — key: ${meta.key.toUpperCase()}`}
                >
                  <span className="instr-glyph">{meta.glyph}</span>
                  <span className="instr-label">{meta.label}</span>
                  <span className="instr-key">{meta.key.toUpperCase()}</span>
                </button>
              ))}
              <button
                className="instr-btn danger"
                disabled={!editable || !selected}
                onClick={() => selected && setCell(selected, null)}
                title="Clear cell — key: Delete"
              >
                <span className="instr-glyph">⌫</span>
                <span className="instr-label">Clear</span>
                <span className="instr-key">DEL</span>
              </button>
            </div>

            <div className="palette-foot">
              {running ? (
                <p className="palette-hint live">Simulation running — stop to edit.</p>
              ) : placeError ? (
                <p className="palette-hint error">{placeError}</p>
              ) : retypeWord && selectedEl ? (
                <p className="palette-hint">
                  Editing <span className="mono">{wordSummary(selectedEl)}</span>. Operands take a
                  register like <span className="mono">D10</span> or a constant like{' '}
                  <span className="mono">K500</span>.
                </p>
              ) : retypeDevice ? (
                <p className="palette-hint">
                  Editing <span className="mono">{selectedEl?.device || '—'}</span> — change the Address to retype it in
                  place, or press another instruction key to replace it.
                </p>
              ) : (
                <p className="palette-hint">Select a cell (or use the arrow keys), then press an instruction key.</p>
              )}
              <details className="shortcuts">
                <summary>Shortcuts</summary>
                <dl>
                  <div>
                    <dt>← ↑ → ↓</dt>
                    <dd>move the selected cell (wraps between rungs)</dd>
                  </div>
                  <div>
                    <dt>{palette.map((i) => i.key.toUpperCase()).join(' · ')}</dt>
                    <dd>place {palette.map((i) => i.label).join(', ').toLowerCase()}</dd>
                  </div>
                  <div>
                    <dt>Del</dt>
                    <dd>clear the cell</dd>
                  </div>
                  <div>
                    <dt>B</dt>
                    <dd>toggle a branch (vertical link) at the cell&apos;s left node</dd>
                  </div>
                  <div>
                    <dt>A</dt>
                    <dd>add a rung at the end</dd>
                  </div>
                  <div>
                    <dt>I</dt>
                    <dd>insert a rung after the selected one</dd>
                  </div>
                  <div>
                    <dt>Ctrl + ↑ / ↓</dt>
                    <dd>move the selected rung up / down</dd>
                  </div>
                  <div>
                    <dt>Shift + → / ↓</dt>
                    <dd>add a column / a branch row to this rung</dd>
                  </div>
                  <div>
                    <dt>Enter</dt>
                    <dd>jump to the address field</dd>
                  </div>
                  <div>
                    <dt>Esc</dt>
                    <dd>deselect</dd>
                  </div>
                  <div>
                    <dt>Ctrl + / − / 0</dt>
                    <dd>zoom in / out / reset — or press Fit to size the program to the window</dd>
                  </div>
                </dl>
              </details>
            </div>
          </>
        )}
      </div>

      <div className="ladder-scroll inset" ref={scrollRef}>
        {/* Scaling the canvas (rather than the scroller) keeps the scrollable area
            correct at any zoom — the compensating width undoes the transform. */}
        <div className="ladder-canvas" style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}>
          {program.rungs.map((rung, i) => (
            <RungView
              key={rung.id}
              rung={rung}
              index={i}
              running={running}
              editable={editable}
              evalResult={evalResults[i]}
              selected={selected?.rung === i ? { row: selected.row, col: selected.col } : null}
              onSelectCell={(row, col) => selectCell({ rung: i, row, col })}
              onToggleVlink={(row, col) => toggleVlink(i, row, col)}
              onAddRow={() => addRow(i)}
              onAddCol={() => addCol(i)}
              onMoveUp={() => moveRung(i, -1)}
              onMoveDown={() => moveRung(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < program.rungs.length - 1}
              onInsertBelow={() => insertRung(i + 1)}
              onDelete={() => removeRung(i)}
            />
          ))}
          {editable && (
            <button className="btn btn-ghost add-rung" onClick={addRung}>
              + Add Rung <span className="instr-key">A</span>
            </button>
          )}
        </div>
      </div>

      {floatingEditor && (
        <div className="cell-float-anchor">
          <div className="cell-float panel">
            <span className="eyebrow">Addr</span>
            <input
              className="field mono compact"
              value={address}
              onChange={(e) => changeAddress(e.target.value)}
              disabled={!editable}
              aria-label="Device address (floating editor)"
            />
            <span className="eyebrow">K</span>
            <input
              className="field mono compact preset"
              type="number"
              min={1}
              value={preset}
              onChange={(e) => changePreset(Math.max(1, Number(e.target.value)))}
              disabled={!editable}
              aria-label="Timer/counter preset (floating editor)"
            />
          </div>
        </div>
      )}
    </div>
  );
}
