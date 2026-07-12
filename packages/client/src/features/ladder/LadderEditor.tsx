import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType, LadderProgram, PuzzleDevice, PuzzleRegister, RungEvalResult } from '@automationsolver/shared';
import { CELL_H, CELL_W } from './CellView';
import { useEditor } from './editorStore';
import { RungView } from './RungView';

const ADDRESS_RE = /^[XYMTC]\d{1,4}$/i;

interface InstrMeta {
  type: ElementType;
  label: string;
  glyph: string;
  /** Single-key shortcut that places this instruction in the selected cell. */
  key: string;
  needsPreset?: boolean;
  needsDevice?: boolean;
}

const INSTRUCTIONS: InstrMeta[] = [
  { type: 'contact-no', label: 'NO Contact', glyph: '┤ ├', key: 'c', needsDevice: true },
  { type: 'contact-nc', label: 'NC Contact', glyph: '┤/├', key: 'x', needsDevice: true },
  { type: 'contact-rising', label: 'Rising Edge', glyph: '┤↑├', key: 'p', needsDevice: true },
  { type: 'contact-falling', label: 'Falling Edge', glyph: '┤↓├', key: 'n', needsDevice: true },
  { type: 'coil-out', label: 'Output Coil', glyph: '( )', key: 'o', needsDevice: true },
  { type: 'coil-set', label: 'Set', glyph: '(S)', key: 's', needsDevice: true },
  { type: 'coil-reset', label: 'Reset', glyph: '(R)', key: 'r', needsDevice: true },
  { type: 'timer', label: 'Timer', glyph: 'T', key: 't', needsPreset: true, needsDevice: true },
  { type: 'counter', label: 'Counter', glyph: 'C', key: 'k', needsPreset: true, needsDevice: true },
  { type: 'hwire', label: 'Wire', glyph: '──', key: 'w', needsDevice: false },
];

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
    removeRung,
    addRow,
    addCol,
  } = useEditor();
  const [address, setAddress] = useState('X0');
  const [preset, setPreset] = useState(10);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const addressRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const zoomKey = `ladder.zoom:${puzzleSlug}`;
  const [zoom, setZoom] = useState(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(zoomKey) : null;
    return saved ? clampZoom(Number(saved)) : 1;
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(zoomKey, String(zoom));
  }, [zoomKey, zoom]);

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

  /** Select a cell and load whatever it holds into the palette inputs. */
  const selectCell = useCallback(
    (pos: { rung: number; row: number; col: number } | null) => {
      select(pos);
      if (!pos) return;
      const el = program.rungs[pos.rung]?.cells[pos.row]?.[pos.col];
      if (el?.device) setAddress(el.device);
      if (el?.preset != null) setPreset(el.preset);
    },
    [program, select],
  );

  const changeAddress = (v: string) => {
    setAddress(v);
    if (retypeDevice && ADDRESS_RE.test(v.trim())) {
      patchSelected({ device: v.trim().toUpperCase() });
    }
  };

  const changePreset = (v: number) => {
    setPreset(v);
    if (retypePreset) patchSelected({ preset: v });
  };

  const applyAddress = (addr: string) => {
    setAddress(addr);
    if (retypeDevice) patchSelected({ device: addr });
  };

  const place = useCallback(
    (meta: InstrMeta) => {
      if (!selected) return;
      if (meta.needsDevice && !ADDRESS_RE.test(address.trim())) {
        addressRef.current?.focus();
        return;
      }
      placeSelected(meta.type, meta.needsDevice ? address.trim().toUpperCase() : '', meta.needsPreset ? preset : undefined);
    },
    [selected, address, preset, placeSelected],
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
      const meta = palette.find((i) => i.key === k);
      if (meta && selected) {
        e.preventDefault();
        place(meta);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, selected, palette, place, moveSelection, setCell, selectCell, toggleVlink, addRung, addRow, addCol]);

  return (
    <div className="ladder-editor">
      <div className="palette panel">
        <div className="palette-row">
          <button
            className="icon-btn palette-fold"
            onClick={() => setPaletteOpen((v) => !v)}
            title={paletteOpen ? 'Collapse the palette' : 'Expand the palette'}
            aria-expanded={paletteOpen}
          >
            {paletteOpen ? '▾' : '▸'}
          </button>
          <span className="eyebrow">Address</span>
          <input
            ref={addressRef}
            className="field mono compact"
            value={address}
            onChange={(e) => changeAddress(e.target.value)}
            disabled={!editable}
            aria-label="Device address"
          />
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
                    <dd>add a rung</dd>
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
    </div>
  );
}
