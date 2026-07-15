import { useEffect, useRef, useState } from 'react';
import type { CabinetPuzzleSpec, WiringDoc } from '@automationsolver/shared';
import { useCreateSlot, useUpdateSlot } from '../../api/queries';
import { ResizeHandle, usePersistedWidth } from '../layout/Resizable';
import { HmiPanel } from '../sim/HmiPanel';
import { SlotsPanel } from '../slots/SlotsPanel';
import { useActiveSlot } from '../slots/useActiveSlot';
import { BriefColumn } from '../../pages/play/BriefColumn';
import type { PlayProps } from '../../pages/play/LadderPlay';
import { CabinetEditor } from './CabinetEditor';
import { useCabinet } from './cabinetStore';
import { useCabinetSim, type CabinetRunner } from './useCabinetSim';

export function CabinetPlay({ spec, user, submit }: PlayProps<CabinetPuzzleSpec>) {
  const { wiring, init, dirty, markClean, clearAll } = useCabinet();
  const activeSlot = useActiveSlot(spec);
  const updateSlot = useUpdateSlot(spec.slug);
  const createSlot = useCreateSlot(spec.slug);
  const loadedSlotRef = useRef<number | null | 'never'>('never');

  // Load the active slot's wiring into the editor once it's resolved, and again
  // whenever the player switches slots (but not on every unrelated re-render).
  useEffect(() => {
    if (!activeSlot.ready) return;
    if (loadedSlotRef.current === activeSlot.activeId) return;
    loadedSlotRef.current = activeSlot.activeId;
    // Slots for a cabinet slug always hold wiring docs.
    init(activeSlot.activeProgram as WiringDoc | null);
  }, [activeSlot.ready, activeSlot.activeId, activeSlot.activeProgram, init]);

  const saveCurrent = () => {
    if (activeSlot.activeId != null) {
      updateSlot.mutate({ id: activeSlot.activeId, program: wiring }, { onSuccess: markClean });
    } else {
      createSlot.mutate(
        { program: wiring },
        {
          onSuccess: (slot) => {
            activeSlot.setActive(slot.id);
            markClean();
          },
        },
      );
    }
  };

  const runner = useCabinetSim(wiring, spec);
  const result = submit.data;

  const brief = usePersistedWidth('play.briefW', 330, 200, 720);
  const hmi = usePersistedWidth('play.hmiW', 360, 240, 860);
  const [briefOpen, setBriefOpen] = useState(true);
  const [hmiOpen, setHmiOpen] = useState(true);
  const [slotsOpen, setSlotsOpen] = useState(false);

  if (!activeSlot.ready) return <p className="muted pad">Loading puzzle…</p>;

  return (
    <div className="play">
      {briefOpen && (
        <>
          <BriefColumn
            spec={spec}
            width={brief.width}
            result={result}
            pending={submit.isPending}
            user={!!user}
          />
          <ResizeHandle
            onResize={brief.nudge}
            dir={1}
            onCollapse={() => setBriefOpen(false)}
            label="Resize the work order panel"
          />
        </>
      )}

      <main className="play-main">
        <div className="play-actions">
          <div className="pa-left">
            <button
              className="pane-toggle"
              onClick={() => setBriefOpen((v) => !v)}
              aria-pressed={briefOpen}
              title={briefOpen ? 'Hide the work order' : 'Show the work order'}
            >
              {briefOpen ? '◧' : '▤'} Brief
            </button>
            <button
              className="pane-toggle"
              onClick={() => setHmiOpen((v) => !v)}
              aria-pressed={hmiOpen}
              title={hmiOpen ? 'Hide the operator panel' : 'Show the operator panel'}
            >
              {hmiOpen ? '◨' : '▤'} Panel
            </button>
            <span className="muted sm">
              {wiring.wires.length} wire{wiring.wires.length === 1 ? '' : 's'}
              {spec.maxWires != null ? ` / ${spec.maxWires}` : ''}
            </span>
            {dirty ? <span className="dirty-dot">● unsaved</span> : <span className="muted sm">saved</span>}
          </div>
          <div className="pa-right">
            <button
              className="btn btn-ghost"
              disabled={runner.running || wiring.wires.length === 0}
              onClick={clearAll}
              title="Remove all wires"
            >
              Clear
            </button>
            <button
              className="btn btn-ghost"
              disabled={!user}
              onClick={() => setSlotsOpen((v) => !v)}
              aria-pressed={slotsOpen}
              title={user ? 'Manage save slots' : 'Sign in to save'}
            >
              💾 Slots{activeSlot.slots.length > 0 ? ` (${activeSlot.slots.length})` : ''}
            </button>
            <button
              className="btn btn-ghost"
              disabled={!user || updateSlot.isPending || createSlot.isPending}
              onClick={saveCurrent}
              title={user ? 'Save to the active slot' : 'Sign in to save'}
            >
              {updateSlot.isPending || createSlot.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn btn-primary"
              disabled={!user || submit.isPending || runner.running}
              onClick={() => submit.mutate(wiring, { onSuccess: markClean })}
              title={user ? 'Submit for grading' : 'Sign in to submit'}
            >
              {submit.isPending ? 'Grading…' : 'Submit'}
            </button>
          </div>
        </div>

        {slotsOpen && (
          <SlotsPanel
            spec={spec}
            slots={activeSlot.slots}
            activeId={activeSlot.activeId}
            program={wiring}
            onSelect={(id) => activeSlot.setActive(id)}
            onClose={() => setSlotsOpen(false)}
          />
        )}

        <CabinetEditor
          spec={spec}
          result={runner.result}
          running={runner.running}
          inputs={runner.inputs}
          setInput={runner.setInput}
        />
      </main>

      {hmiOpen && (
        <>
          <ResizeHandle
            onResize={hmi.nudge}
            dir={-1}
            onCollapse={() => setHmiOpen(false)}
            label="Resize the operator panel"
          />
          <aside className="play-hmi" style={{ width: hmi.width }}>
            <HmiPanel
              devices={spec.devices}
              runner={runner}
              machineSlot={<CabinetStatus runner={runner} />}
            />
          </aside>
        </>
      )}
    </div>
  );
}

/** Compact electrical status readout: motor state, trips, faults. */
function CabinetStatus({ runner }: { runner: CabinetRunner }) {
  const res = runner.result;
  if (!res) {
    return (
      <div className="machine-view panel">
        <div className="mv-head">
          <span className="eyebrow">Cabinet</span>
          <span className="mv-tag">de-energized</span>
        </div>
      </div>
    );
  }
  const motorEntries = Object.entries(res.motors);
  return (
    <div className="machine-view panel">
      <div className="mv-head">
        <span className="eyebrow">Cabinet</span>
        <span className="mv-tag">{res.shorted ? '⚡ SHORT' : res.unstable ? '≋ unstable' : 'energized'}</span>
      </div>
      <div className="mv-readout">
        {motorEntries.map(([id, m]) => (
          <span key={id} className={`mv-stat${m.running ? ' on' : ''}`}>
            <span className="mv-stat-label">{id}</span>
            <span className="mv-stat-value">
              {m.running ? (m.direction === 'fwd' ? 'FWD' : 'REV') : 'STOP'}
            </span>
          </span>
        ))}
      </div>
      {res.faults.length > 0 && (
        <ul className="cab-faults">
          {res.faults.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
