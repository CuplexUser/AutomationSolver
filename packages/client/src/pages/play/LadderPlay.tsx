import { useEffect, useRef, useState } from 'react';
import type { LadderProgram, LadderPuzzleSpec } from '@automationsolver/shared';
import { useCreateSlot, useSubmit, useUpdateSlot } from '../../api/queries';
import type { useAuth } from '../../auth/AuthContext';
import { useEditor } from '../../features/ladder/editorStore';
import { LadderEditor } from '../../features/ladder/LadderEditor';
import { ResizeHandle, usePersistedWidth } from '../../features/layout/Resizable';
import { HmiPanel } from '../../features/sim/HmiPanel';
import { MachineView } from '../../features/sim/MachineView';
import { ReplayBar } from '../../features/sim/ReplayBar';
import { TraceStrip } from '../../features/sim/TraceStrip';
import { useReplay } from '../../features/sim/useReplay';
import { useSimRunner } from '../../features/sim/useSimRunner';
import { SlotsPanel } from '../../features/slots/SlotsPanel';
import { useActiveSlot } from '../../features/slots/useActiveSlot';
import { BriefColumn } from './BriefColumn';
import { PuzzleTopNav } from './PuzzleTopNav';

export type PlayProps<S> = {
  spec: S;
  user: ReturnType<typeof useAuth>['user'];
  submit: ReturnType<typeof useSubmit>;
};

export function LadderPlay({ spec, user, submit }: PlayProps<LadderPuzzleSpec>) {
  const { program, init, dirty, markClean } = useEditor();
  const activeSlot = useActiveSlot(spec);
  const updateSlot = useUpdateSlot(spec.slug);
  const createSlot = useCreateSlot(spec.slug);
  const loadedSlotRef = useRef<number | null | 'never'>('never');

  // Load the active slot's program into the editor once it's resolved, and again
  // whenever the player switches slots (but not on every unrelated re-render).
  useEffect(() => {
    if (!activeSlot.ready) return;
    if (loadedSlotRef.current === activeSlot.activeId) return;
    loadedSlotRef.current = activeSlot.activeId;
    // Slots for a ladder slug always hold ladder programs.
    init(activeSlot.activeProgram as LadderProgram | null);
  }, [activeSlot.ready, activeSlot.activeId, activeSlot.activeProgram, init]);

  const saveCurrent = () => {
    if (activeSlot.activeId != null) {
      updateSlot.mutate({ id: activeSlot.activeId, program }, { onSuccess: markClean });
    } else {
      createSlot.mutate(
        { program },
        {
          onSuccess: (slot) => {
            activeSlot.setActive(slot.id);
            markClean();
          },
        },
      );
    }
  };

  const runner = useSimRunner(program, spec);
  const replay = useReplay();
  const activeRunner = replay.runner ?? runner;
  const result = submit.data;

  const brief = usePersistedWidth('play.briefW', 330, 200, 720);
  const hmi = usePersistedWidth('play.hmiW', 360, 240, 860);
  const [briefOpen, setBriefOpen] = useState(true);
  const [hmiOpen, setHmiOpen] = useState(true);
  const [traceOpen, setTraceOpen] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);

  // Don't render the (interactive) editor until the active slot has resolved —
  // otherwise a player who starts editing immediately can have their first
  // few edits clobbered when the slot-load effect above catches up.
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
            runner={activeRunner}
            onReplay={(scenarioName) => {
              if (submit.variables) replay.start(spec, submit.variables as LadderProgram, scenarioName);
            }}
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
        <PuzzleTopNav spec={spec} />
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
            <button
              className="pane-toggle"
              onClick={() => setTraceOpen((v) => !v)}
              aria-pressed={traceOpen}
              title={traceOpen ? 'Hide the trace strip' : 'Show the trace strip'}
            >
              {traceOpen ? '▽' : '▷'} Trace
            </button>
            {dirty ? <span className="dirty-dot">● unsaved</span> : <span className="muted sm">saved</span>}
          </div>
          <div className="pa-right">
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
              onClick={() => submit.mutate(program, { onSuccess: markClean })}
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
            program={program}
            onSelect={(id) => activeSlot.setActive(id)}
            onClose={() => setSlotsOpen(false)}
          />
        )}

        <ReplayBar replay={replay} />

        <LadderEditor
          puzzleSlug={spec.slug}
          allowedInstructions={spec.allowedInstructions}
          devices={spec.devices}
          registers={spec.registers}
          evalResults={activeRunner.evalResults}
          running={activeRunner.running}
        />

        {traceOpen && (
          <TraceStrip
            history={activeRunner.history}
            devices={spec.devices}
            registers={spec.registers}
            cursor={replay.trace ? replay.index : undefined}
            onScrub={replay.trace ? replay.seek : undefined}
          />
        )}
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
              runner={activeRunner}
              machineSlot={<MachineView spec={spec} runner={activeRunner} />}
            />
          </aside>
        </>
      )}
    </div>
  );
}
