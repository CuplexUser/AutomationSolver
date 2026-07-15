import { useState } from 'react';
import type { CabinetPuzzleSpec, CabinetSimResult } from '@automationsolver/shared';
import { useCabinet } from './cabinetStore';
import { PanelView } from './PanelView';
import { SchematicView } from './SchematicView';

type CabinetViewKind = 'schematic' | 'panel';
const VIEW_KEY = 'as-cabinet-view';

/**
 * Shell around the two renderings of the same WiringDoc: the IEC circuit
 * diagram and the illustrated cabinet panel. Both are fully editable with the
 * same gestures; the tab choice persists across sessions.
 */
export function CabinetEditor({
  spec,
  result,
  running,
  inputs,
  setInput,
}: {
  spec: CabinetPuzzleSpec;
  result: CabinetSimResult | null;
  running: boolean;
  inputs: Record<string, boolean>;
  setInput: (address: string, value: boolean) => void;
}) {
  const [view, setView] = useState<CabinetViewKind>(() =>
    localStorage.getItem(VIEW_KEY) === 'schematic' ? 'schematic' : 'panel',
  );
  const selectedTerminal = useCabinet((s) => s.selectedTerminal);

  const pick = (v: CabinetViewKind) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  return (
    <div className="cabinet-editor panel">
      <div className="cab-tabs" role="tablist" aria-label="Cabinet view">
        <button
          role="tab"
          aria-selected={view === 'schematic'}
          className={view === 'schematic' ? 'active' : ''}
          onClick={() => pick('schematic')}
        >
          ⚡ Schematic
        </button>
        <button
          role="tab"
          aria-selected={view === 'panel'}
          className={view === 'panel' ? 'active' : ''}
          onClick={() => pick('panel')}
        >
          🔧 Panel
        </button>
      </div>

      {view === 'schematic' ? (
        <SchematicView spec={spec} result={result} running={running} />
      ) : (
        <PanelView spec={spec} result={result} running={running} inputs={inputs} setInput={setInput} />
      )}

      <p className="cabinet-help muted sm">
        {running
          ? 'Sim running — press the door buttons or use the operator panel. Stop to edit wiring.'
          : selectedTerminal
            ? `Wiring from ${selectedTerminal} — drop on a second terminal (Esc to cancel).`
            : 'Drag from terminal to terminal to run a wire. Double-click a wire to remove it. Both views edit the same wiring.'}
      </p>
    </div>
  );
}
