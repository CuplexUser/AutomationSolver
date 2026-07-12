import { useEffect, useState } from 'react';
import type {
  ElementType,
  PuzzleDevice,
  PuzzleRegister,
  RungEvalResult,
} from '@automationsolver/shared';
import { useEditor } from './editorStore';
import { RungView } from './RungView';

const ADDRESS_RE = /^[XYMTC]\d{1,4}$/i;

interface InstrMeta {
  type: ElementType;
  label: string;
  glyph: string;
  needsPreset?: boolean;
  needsDevice?: boolean;
}

const INSTRUCTIONS: InstrMeta[] = [
  { type: 'contact-no', label: 'NO Contact', glyph: '┤ ├', needsDevice: true },
  { type: 'contact-nc', label: 'NC Contact', glyph: '┤/├', needsDevice: true },
  { type: 'contact-rising', label: 'Rising Edge', glyph: '┤↑├', needsDevice: true },
  { type: 'contact-falling', label: 'Falling Edge', glyph: '┤↓├', needsDevice: true },
  { type: 'coil-out', label: 'Output Coil', glyph: '( )', needsDevice: true },
  { type: 'coil-set', label: 'Set', glyph: '(S)', needsDevice: true },
  { type: 'coil-reset', label: 'Reset', glyph: '(R)', needsDevice: true },
  { type: 'timer', label: 'Timer', glyph: 'T', needsPreset: true, needsDevice: true },
  { type: 'counter', label: 'Counter', glyph: 'C', needsPreset: true, needsDevice: true },
  { type: 'hwire', label: 'Wire', glyph: '──', needsDevice: false },
];

interface Props {
  allowedInstructions: ElementType[];
  devices: PuzzleDevice[];
  registers?: PuzzleRegister[];
  evalResults: RungEvalResult[];
  running: boolean;
}

const DEVICE_TYPES = new Set(INSTRUCTIONS.filter((i) => i.needsDevice).map((i) => i.type));
const PRESET_TYPES = new Set(INSTRUCTIONS.filter((i) => i.needsPreset).map((i) => i.type));

const clampZoom = (z: number) => Math.min(1.4, Math.max(0.6, Math.round(z * 10) / 10));

export function LadderEditor({
  allowedInstructions,
  devices,
  registers = [],
  evalResults,
  running,
}: Props) {
  const { program, selected, select, placeSelected, patchSelected, setCell, toggleVlink, addRung, removeRung, addRow, addCol } =
    useEditor();
  const [address, setAddress] = useState('X0');
  const [preset, setPreset] = useState(10);
  const [zoom, setZoom] = useState(1);

  const allowed = new Set<ElementType>([...allowedInstructions, 'hwire']);
  const editable = !running;

  const selectedEl = selected
    ? program.rungs[selected.rung]?.cells[selected.row]?.[selected.col] ?? null
    : null;
  // Editing an already-placed device-bearing element? Then the Address/Preset
  // fields retype that element in place instead of only priming the next placement.
  const retypeDevice = editable && !!selectedEl && DEVICE_TYPES.has(selectedEl.type);
  const retypePreset = editable && !!selectedEl && PRESET_TYPES.has(selectedEl.type);

  // When a filled cell is selected, load its values into the palette inputs.
  useEffect(() => {
    if (!selected) return;
    const el = program.rungs[selected.rung]?.cells[selected.row]?.[selected.col];
    if (el) {
      if (el.device) setAddress(el.device);
      if (el.preset != null) setPreset(el.preset);
    }
  }, [selected, program]);

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

  const useAddress = (addr: string) => {
    setAddress(addr);
    if (retypeDevice) patchSelected({ device: addr });
  };

  const place = (meta: InstrMeta) => {
    if (!selected) return;
    if (meta.needsDevice && !ADDRESS_RE.test(address.trim())) return;
    placeSelected(
      meta.type,
      meta.needsDevice ? address.trim().toUpperCase() : '',
      meta.needsPreset ? preset : undefined,
    );
  };

  return (
    <div className="ladder-editor">
      <div className="palette panel">
        <div className="palette-row">
          <span className="eyebrow">Address</span>
          <input
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
                onClick={() => useAddress(d.address)}
                disabled={!editable}
                title={d.label}
              >
                {d.address}
              </button>
            ))}
          </div>
          <div className="zoom-ctl" role="group" aria-label="Ladder zoom">
            <button className="icon-btn" onClick={() => setZoom((z) => clampZoom(z - 0.1))} title="Zoom out">
              −
            </button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" onClick={() => setZoom((z) => clampZoom(z + 0.1))} title="Zoom in">
              +
            </button>
          </div>
        </div>
        <div className="palette-instr">
          {INSTRUCTIONS.filter((i) => allowed.has(i.type)).map((meta) => (
            <button
              key={meta.type}
              className="instr-btn"
              disabled={!editable || !selected}
              onClick={() => place(meta)}
              title={meta.label}
            >
              <span className="instr-glyph">{meta.glyph}</span>
              <span className="instr-label">{meta.label}</span>
            </button>
          ))}
          <button
            className="instr-btn danger"
            disabled={!editable || !selected}
            onClick={() => selected && setCell(selected, null)}
            title="Clear cell"
          >
            <span className="instr-glyph">⌫</span>
            <span className="instr-label">Clear</span>
          </button>
        </div>
        {!selected && editable && <p className="palette-hint">Select a cell on the ladder, then choose an instruction.</p>}
        {retypeDevice && (
          <p className="palette-hint">
            Editing <span className="mono">{selectedEl!.device || '—'}</span> — change the Address to
            retype this element in place, or pick another instruction to replace it.
          </p>
        )}
        {running && <p className="palette-hint live">Simulation running — stop to edit.</p>}
      </div>

      <div className="ladder-scroll inset">
        {/* Scaling the canvas (rather than the scroller) keeps the scrollable area
            correct at any zoom — the compensating width undoes the transform. */}
        <div
          className="ladder-canvas"
          style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}
        >
          {program.rungs.map((rung, i) => (
            <RungView
              key={rung.id}
              rung={rung}
              index={i}
              running={running}
              editable={editable}
              evalResult={evalResults[i]}
              selected={selected?.rung === i ? { row: selected.row, col: selected.col } : null}
              onSelectCell={(row, col) => select({ rung: i, row, col })}
              onToggleVlink={(row, col) => toggleVlink(i, row, col)}
              onAddRow={() => addRow(i)}
              onAddCol={() => addCol(i)}
              onDelete={() => removeRung(i)}
            />
          ))}
          {editable && (
            <button className="btn btn-ghost add-rung" onClick={addRung}>
              + Add Rung
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
