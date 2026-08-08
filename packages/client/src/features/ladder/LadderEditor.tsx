import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMPARE_OPS,
  DEFAULT_POU_ID,
  formatValueOperand,
  isValueOperand,
  isWordInstruction,
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
import { PinIcon } from '../../components/PinIcon';
import {
  CellFields,
  chipTarget,
  fieldsFor,
  PidTuning,
  slotAccepts,
  slotsFor,
  type FieldSlot,
} from './CellFields';
import { CELL_H, CELL_W } from './CellView';
import { pouRungs, useEditor } from './editorStore';
import { RungView } from './RungView';

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

/** "D0 ÷ K4 into D10" — the selected word instruction, spelled out in the hint. */
function wordSummary(el: LadderElement): string {
  const a = el.operands?.[0] || '?';
  const b = el.operands?.[1] || '?';
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
  /** Which POU this editor edits. Single-program puzzles pass `DEFAULT_POU_ID`. */
  pouId?: string;
  allowedInstructions: ElementType[];
  devices: PuzzleDevice[];
  registers?: PuzzleRegister[];
  evalResults: RungEvalResult[];
  running: boolean;
  /**
   * Whether this editor owns the keyboard.
   *
   * With one editor on screen it always does. In the workspace layout several
   * POU windows are open at once, and a single global keydown listener per
   * editor would have one keystroke placing a contact in all of them.
   */
  focused?: boolean;
  /** A section the puzzle ships pre-written: shown, highlighted, never edited. */
  readOnly?: boolean;
  /**
   * Rendered inside a floating workspace window.
   *
   * The window's body does not scroll — the ladder inside it does — so the
   * toolbar rides *inside* the scroller here. That is what makes the pin mean
   * the same thing it means in the play column: pinned it stays at the top of
   * the program, unpinned it scrolls away with it.
   */
  windowed?: boolean;
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
  pouId = DEFAULT_POU_ID,
  allowedInstructions,
  devices,
  registers = [],
  evalResults,
  running,
  focused = true,
  readOnly = false,
  windowed = false,
}: Props) {
  const {
    project,
    selected: rawSelected,
    select,
    placeSelected,
    patchSelected,
    setCell,
    toggleVlink,
    addRung: addRungTo,
    insertRung: insertRungIn,
    moveRung: moveRungIn,
    removeRung: removeRungIn,
    addRow: addRowIn,
    addCol: addColIn,
  } = useEditor();

  // Everything below this line thinks in one POU's rungs, exactly as it did
  // when there was only ever one program. The store keeps an untouched POU's
  // rung array identical across edits, so this memo only recomputes when *this*
  // section actually changed.
  const rungs = pouRungs(project, pouId);
  const program = useMemo<LadderProgram>(() => ({ rungs }), [rungs]);
  const selected = rawSelected?.pou === pouId ? rawSelected : null;
  const addRung = useCallback(() => addRungTo(pouId), [addRungTo, pouId]);
  const insertRung = useCallback((i: number) => insertRungIn(pouId, i), [insertRungIn, pouId]);
  const moveRung = useCallback(
    (i: number, d: -1 | 1) => moveRungIn(pouId, i, d),
    [moveRungIn, pouId],
  );
  const removeRung = useCallback((i: number) => removeRungIn(pouId, i), [removeRungIn, pouId]);
  const addRow = useCallback((i: number) => addRowIn(pouId, i), [addRowIn, pouId]);
  const addCol = useCallback((i: number) => addColIn(pouId, i), [addColIn, pouId]);
  const [address, setAddress] = useState('X0');
  const [preset, setPreset] = useState(10);
  // Word-instruction operands, primed for the next placement and retyped in
  // place while a word element is selected — exactly how Address/Preset behave.
  const [opA, setOpA] = useState('D0');
  const [opB, setOpB] = useState('K0');
  const [cmpOp, setCmpOp] = useState<CompareOp>('>=');
  const [mathOp, setMathOp] = useState<MathOp>('add');
  const [tuning, setTuning] = useState<PidParams>(DEFAULT_PID);
  // The instruction whose fields the toolbar is showing: whatever is selected,
  // falling back to the last thing placed so the fields stay put after a
  // placement instead of snapping back to a generic Address box.
  const [lastPlaced, setLastPlaced] = useState<ElementType | null>(null);
  // Which field the device chips fill. Follows the caret, so clicking into a
  // MOV's Source and then clicking D20 fills Source rather than the destination.
  const [focusSlot, setFocusSlot] = useState<FieldSlot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const operandRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const zoomKey = `ladder.zoom:${puzzleSlug}`;
  const [zoom, setZoom] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(zoomKey) : null;
    return saved ? clampZoom(Number(saved)) : 1;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(zoomKey, String(zoom));
  }, [zoomKey, zoom]);

  // Two independent, user-toggleable ways to reach the selected cell's fields
  // without scrolling back to the top of a long program: pin the whole toolbar,
  // and/or float a small echo of the same fields in the corner. Global (not
  // per-puzzle) since they're editor preferences. So is the instruction rack:
  // once the keys are in the fingers, folding it away is two more rungs of
  // ladder on screen, and it should stay folded.
  const [stickyPalette, setStickyPalette] = usePersistedBool('ladder.stickyPalette', true);
  const [floatingEditor, setFloatingEditor] = usePersistedBool('ladder.floatingEditor', false);
  const [paletteOpen, setPaletteOpen] = usePersistedBool('ladder.paletteOpen', true);

  /** Scale the ladder so the whole program fills the visible area — big on a short program. */
  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { w, h } = naturalSize(program);
    // In a window the toolbar is inside the scrollport, and while it is pinned
    // it covers the top of it — so that height is not the program's to fill.
    const chrome = windowed && stickyPalette ? (paletteRef.current?.offsetHeight ?? 0) : 0;
    const availW = el.clientWidth - 24;
    const availH = el.clientHeight - chrome - 24;
    setZoom(clampZoom(Math.min(availW / w, availH / h)));
  }, [program, windowed, stickyPalette]);

  const allowed = new Set<ElementType>([...allowedInstructions, 'hwire']);
  // A pre-written section is as locked as a running one: it is shown so the
  // player can read the handshake it publishes, not so they can change it.
  const editable = !running && !readOnly;
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
      select(pos === null ? null : { pou: pouId, ...pos });
      // The caret is no longer in whatever box it was in for the *previous*
      // cell, so the chips stop aiming there. Without this, filling a MOV's
      // Source and then moving on leaves every later chip landing in Source.
      setFocusSlot(null);
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
    [program, select, pouId],
  );

  const changeAddress = (v: string) => {
    setAddress(v);
    setNote(null);
    if (!retypeDevice) return;
    // Retyping is held to the same rule as placing: the address has to be one
    // this element can legally act on, so a MOV's destination only ever takes a
    // D and a timer only ever a T.
    if (slotAccepts('device', fields, selectedEl?.type ?? null, v)) {
      patchSelected({ device: v.trim().toUpperCase() });
    }
  };

  const changePreset = (v: number) => {
    setPreset(v);
    if (retypePreset) patchSelected({ preset: v });
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
    setNote(null);
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

  /**
   * A click on a device chip, routed to the field that can take it.
   *
   * Chips used to write the Address box whatever was selected, which is how a
   * PID ends up with `X0` as its output register — a value that block can never
   * legally write. Now the address decides where it lands, and a chip with
   * nowhere to go is disabled rather than silently wrong.
   */
  const applyChip = (addr: string) => {
    const slot = chipTarget(addr, fields, activeType, focusSlot);
    if (slot === 'device') changeAddress(addr);
    else if (slot === 'a') changeOperand(0, addr);
    else if (slot === 'b') changeOperand(1, addr);
  };

  const fieldHandlers = {
    onOperand: changeOperand,
    onOperandBlur: normalizeOperand,
    onAddress: changeAddress,
    onPreset: changePreset,
    onOp: changeOp,
    onFocusSlot: setFocusSlot,
  };

  // Where the chips are aiming: the field the caret is in, else the one the
  // instruction is "about". Ringed in the toolbar so the aim is never a guess.
  const slots = slotsFor(fields);
  const chipSlot: FieldSlot | null =
    focusSlot && slots.includes(focusSlot)
      ? focusSlot
      : slots.includes('device')
        ? 'device'
        : (slots[0] ?? null);

  const chips = [...devices.map((d) => ({ address: d.address, label: d.label })), ...registers].map(
    (d) => {
      const slot = chipTarget(d.address, fields, activeType, focusSlot);
      const into =
        slot === 'device' ? fields.address : slot ? fields.operands?.[slot === 'a' ? 0 : 1] : null;
      return { ...d, slot, into };
    },
  );

  /** The operand/op/tuning payload a word instruction is placed with. */
  const wordPayload = useCallback(
    (type: ElementType): Partial<LadderElement> => {
      const norm = (raw: string): string => {
        const ref = parseValueOperand(raw);
        return ref ? formatValueOperand(ref) : raw.trim().toUpperCase();
      };
      // An operand the box can't parse is stored empty rather than as a literal
      // string, so the block shows a "?" for it and the validator can say what
      // is missing instead of what is malformed.
      const a = isValueOperand(opA) ? norm(opA) : '';
      const b = isValueOperand(opB) ? norm(opB) : '';
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

  /**
   * Put an instruction in the selected cell — always, even half-addressed.
   *
   * Placing used to be refused whenever the Address box held something the
   * instruction could not act on, which made MOV, MATH and PID the only
   * instructions you had to fill in a field *before* you could lay one down.
   * Every other one places first and gets retyped after, so these do too: what
   * doesn't fit is dropped rather than stored (a PID never inherits `X0` as its
   * output), the block draws the gap as `?`, and the toolbar says which field
   * still wants a value with the caret already in it.
   */
  const place = useCallback(
    (meta: InstrMeta) => {
      if (!selected) return;
      const cfg = fieldsFor(meta.type);
      const addr = address.trim().toUpperCase();
      const fits = slotAccepts('device', cfg, meta.type, addr);

      setLastPlaced(meta.type);
      placeSelected(
        meta.type,
        cfg.address && fits ? addr : '',
        cfg.preset ? preset : undefined,
        meta.word ? wordPayload(meta.type) : undefined,
      );

      // Name the first field left blank and aim the chips (and, where there is
      // one box to aim at, the caret) there — filling it in is the next
      // keystroke rather than a hunt.
      const blankOperand = slotsFor(cfg).find(
        (s) => s !== 'device' && !isValueOperand(s === 'a' ? opA : opB),
      );
      if (cfg.address && !fits) {
        setNote(
          cfg.writesRegister
            ? `${meta.label} placed. Its ${cfg.address} is a data register — pick a D address.`
            : `${meta.label} placed. Give it an address.`,
        );
        setFocusSlot('device');
        addressRef.current?.focus();
        addressRef.current?.select();
      } else if (blankOperand) {
        const label = cfg.operands?.[blankOperand === 'a' ? 0 : 1] ?? 'operand';
        setNote(`${meta.label} placed. ${label} takes a register (D10) or a constant (K500).`);
        setFocusSlot(blankOperand);
        if (blankOperand === 'a') {
          operandRef.current?.focus();
          operandRef.current?.select();
        }
      } else {
        setNote(null);
        // Nothing left blank: the block starts aimed at the field it is "about"
        // rather than inheriting the aim of the one placed before it.
        setFocusSlot(null);
      }
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
    // Several POU windows can be open at once, each with this listener. Only the
    // focused one may act, or one press of C lands a contact in every section.
    if (!focused) return;
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
        toggleVlink(pouId, selected.rung, selected.row, selected.col);
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
    focused,
    editable,
    pouId,
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

  // The toolbar as one value, because a floating window renders it *inside*
  // the ladder scroller rather than above it — see the return below.
  const toolbar = (
    <div ref={paletteRef} className={`palette panel${stickyPalette ? ' palette-pinned' : ''}`}>
      {/* One row, not four: fields, chips, prefs and zoom share it and wrap
          only when they must. Every row of chrome here is a row of ladder the
          player doesn't get. */}
      <div className="palette-row">
        <div className="palette-fields">
          <button
            className="icon-btn palette-fold"
            onClick={() => setPaletteOpen(!paletteOpen)}
            title={paletteOpen ? 'Hide the instruction buttons' : 'Show the instruction buttons'}
            aria-expanded={paletteOpen}
          >
            {paletteOpen ? '▾' : '▸'}
          </button>
          {/* Only the fields the active instruction actually uses, in the
              order it reads: operands, then operator, then destination. */}
          <CellFields
            fields={fields}
            values={{ opA, opB, address, preset, cmpOp, mathOp }}
            handlers={fieldHandlers}
            editable={editable}
            target={chipSlot}
            addressRef={addressRef}
            operandRef={operandRef}
          />
          {/* Chips fill whichever field can take the address they carry. */}
          <div className="dev-quick">
            {chips.map((d) => (
              <button
                key={d.address}
                className={`dev-chip dev-${d.address[0]}`}
                onClick={() => applyChip(d.address)}
                disabled={!editable || !d.slot}
                title={d.slot ? `${d.label} → ${d.into}` : `${d.label} — no field here takes a ${d.address[0]} address`}
              >
                {d.address}
              </button>
            ))}
          </div>
          <div className="palette-controls">
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
            <div className="editor-prefs" role="group" aria-label="Editor preferences">
              <button
                className={`icon-btn pref-btn pin-toggle${stickyPalette ? ' on' : ''}`}
                onClick={() => setStickyPalette(!stickyPalette)}
                aria-pressed={stickyPalette}
                aria-label="Pin the toolbar"
                title={
                  stickyPalette
                    ? 'Pinned — the toolbar stays put however far you scroll'
                    : 'Unpinned — the toolbar scrolls away with the program'
                }
              >
                <PinIcon pinned={stickyPalette} />
              </button>
              <button
                className={`icon-btn pref-btn${floatingEditor ? ' on' : ''}`}
                onClick={() => setFloatingEditor(!floatingEditor)}
                aria-pressed={floatingEditor}
                aria-label="Floating cell editor"
                title="Echo the selected cell's fields in a floating corner editor"
              >
                ⬓
              </button>
            </div>
          </div>
        </div>
        {/* Tuning is only meaningful with a loop block in hand, so it appears
            with one and stays out of the way otherwise. */}
        {activeType === 'pid' && (
          <PidTuning
            tuning={tuning}
            onChange={changeTuning}
            editable={editable}
            editing={selectedEl?.type === 'pid'}
          />
        )}
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
            ) : note ? (
              <p className="palette-hint note">{note}</p>
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
  );

  return (
    <div className="ladder-editor">
      {!windowed && toolbar}

      <div className="ladder-scroll inset" ref={scrollRef}>
        {windowed && toolbar}
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
              onToggleVlink={(row, col) => toggleVlink(pouId, i, row, col)}
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

      {/* The corner echo shows the *same* fields as the toolbar, so a MOV's
          source or a compare's operator can be retyped from down here too — it
          used to offer Address and Preset K alone, which are the two fields a
          word instruction does not have. */}
      {floatingEditor && (
        <div className="cell-float-anchor">
          <div className="cell-float panel">
            <CellFields
              fields={fields}
              values={{ opA, opB, address, preset, cmpOp, mathOp }}
              handlers={fieldHandlers}
              editable={editable}
              target={chipSlot}
              dense
            />
          </div>
        </div>
      )}
    </div>
  );
}
