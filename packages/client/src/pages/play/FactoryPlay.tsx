import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assembleProject,
  initialProject,
  type LadderProject,
  type LadderPuzzleSpec,
  type PouSlot,
} from '@automationsolver/shared';
import { useCreateSlot, useUpdateSlot } from '../../api/queries';
import { LadderEditor } from '../../features/ladder/LadderEditor';
import { useEditor } from '../../features/ladder/editorStore';
import { HmiPanel } from '../../features/sim/HmiPanel';
import { MachineView } from '../../features/sim/MachineView';
import { ReplayBar } from '../../features/sim/ReplayBar';
import { useReplay } from '../../features/sim/useReplay';
import { useSimRunner } from '../../features/sim/useSimRunner';
import { useActiveSlot } from '../../features/slots/useActiveSlot';
import { cascadeBox, FloatingWindow } from '../../features/workspace/FloatingWindow';
import { PinnableSidebar } from '../../features/workspace/PinnableSidebar';
import { PouExplorer } from '../../features/workspace/PouExplorer';
import { useWindows } from '../../features/workspace/useWindows';
import { BriefColumn } from './BriefColumn';
import { PuzzleTopNav } from './PuzzleTopNav';
import type { PlayProps } from './LadderPlay';

/** Window id for the operator panel, which floats like any section does. */
const HMI_WINDOW = '__hmi';

/**
 * The plant workspace.
 *
 * A station fits in three columns; a plant does not. Here the machine *is* the
 * page — it fills the workspace, and can be the only thing on screen — while
 * the programs float above it in windows the player opens for the section they
 * are working on, and the work order collapses to a tab down the edge.
 *
 * Chosen by `PuzzlePlayPage` when the puzzle declares `pous`; every
 * single-program puzzle keeps `LadderPlay` exactly as it was.
 */
export function FactoryPlay({ spec, user, submit }: PlayProps<LadderPuzzleSpec>) {
  const { project, init, dirty, markClean, focusedPou, focusPou } = useEditor();
  const activeSlot = useActiveSlot(spec);
  const updateSlot = useUpdateSlot(spec.slug);
  const createSlot = useCreateSlot(spec.slug);
  const loadedSlotRef = useRef<number | null | 'never'>('never');

  const slots: PouSlot[] = useMemo(() => spec.pous ?? [], [spec.pous]);
  const windows = useWindows();
  const [section, setSection] = useState<string | null>(null);

  // Load the active slot once resolved, and again on a slot switch. A slot that
  // predates a section being added holds only the POUs it knew about, so the
  // spec's own project is the floor the saved one is merged onto.
  useEffect(() => {
    if (!activeSlot.ready) return;
    if (loadedSlotRef.current === activeSlot.activeId) return;
    loadedSlotRef.current = activeSlot.activeId;
    const saved = activeSlot.activeProgram as LadderProject | null;
    init(saved ? assembleProject(spec, saved) : initialProject(spec));
  }, [activeSlot.ready, activeSlot.activeId, activeSlot.activeProgram, init, spec]);

  const saveCurrent = () => {
    if (activeSlot.activeId != null) {
      updateSlot.mutate({ id: activeSlot.activeId, program: project }, { onSuccess: markClean });
    } else {
      createSlot.mutate(
        { program: project },
        {
          onSuccess: (slot) => {
            activeSlot.setActive(slot.id);
            markClean();
          },
        },
      );
    }
  };

  const runner = useSimRunner(project, spec);
  const replay = useReplay();
  const activeRunner = replay.runner ?? runner;

  if (!activeSlot.ready) return <p className="muted pad">Loading plant…</p>;

  const openSection = (pouId: string) => {
    focusPou(pouId);
    windows.show(pouId);
  };

  return (
    <div className="workspace">
      <div className="ws-rail">
        <PuzzleTopNav spec={spec} />
        <PouExplorer
          project={project}
          slots={slots}
          focusedPou={windows.focused}
          openPous={windows.open}
          onOpen={openSection}
        />
        <div className="ws-rail-actions">
          <button
            className={`pane-toggle${windows.isOpen(HMI_WINDOW) ? ' on' : ''}`}
            onClick={() => windows.toggle(HMI_WINDOW)}
            aria-pressed={windows.isOpen(HMI_WINDOW)}
          >
            Operator panel
          </button>
          <button
            className="pane-toggle"
            onClick={windows.closeAll}
            disabled={windows.open.length === 0}
            title="Close every window and watch the plant on its own"
          >
            Clear the desk
          </button>
          {dirty ? <span className="dirty-dot">● unsaved</span> : <span className="muted sm">saved</span>}
          <button
            className="btn btn-ghost"
            disabled={!user || updateSlot.isPending || createSlot.isPending}
            onClick={saveCurrent}
          >
            {updateSlot.isPending || createSlot.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            className="btn btn-primary"
            disabled={!user || submit.isPending || runner.running}
            onClick={() => submit.mutate(project, { onSuccess: markClean })}
          >
            {submit.isPending ? 'Grading…' : 'Submit'}
          </button>
        </div>
      </div>

      {/* The plant fills whatever the rail and a pinned sidebar leave. With no
          windows open and the brief collapsed, it is the whole page. */}
      <main className="ws-stage">
        <SectionSwitcher slots={slots} active={section} onPick={setSection} />
        <ReplayBar replay={replay} demoCaption={spec.demo?.caption} />
        <div className="ws-machine">
          <MachineView spec={spec} runner={activeRunner} section={section ?? undefined} />
        </div>
      </main>

      {windows.open
        .filter((id) => id !== HMI_WINDOW)
        .map((pouId) => {
          const slot = slots.find((s) => s.id === pouId);
          const index = slots.findIndex((s) => s.id === pouId);
          return (
            <FloatingWindow
              key={pouId}
              id={pouId}
              storageKey={`ws.win.${spec.slug}.${pouId}`}
              title={slot?.name ?? pouId}
              subtitle={slot?.title}
              badge={
                slot && !slot.editable ? <span className="fw-badge">READ ONLY</span> : undefined
              }
              initial={cascadeBox(Math.max(0, index))}
              focused={windows.focused === pouId}
              z={10 + windows.depth(pouId)}
              onFocus={() => {
                windows.focus(pouId);
                focusPou(pouId);
              }}
              onClose={() => windows.close(pouId)}
            >
              <LadderEditor
                puzzleSlug={`${spec.slug}:${pouId}`}
                pouId={pouId}
                allowedInstructions={spec.allowedInstructions}
                devices={spec.devices}
                registers={spec.registers}
                // Only this section's results, so editing one window does not
                // re-render the other three on every scan.
                evalResults={activeRunner.evalResults[pouId] ?? []}
                running={activeRunner.running}
                focused={windows.focused === pouId}
                readOnly={slot?.editable === false}
              />
            </FloatingWindow>
          );
        })}

      {windows.isOpen(HMI_WINDOW) && (
        <FloatingWindow
          id={HMI_WINDOW}
          storageKey={`ws.win.${spec.slug}.hmi`}
          title="Operator panel"
          initial={{ x: 120, y: 120, w: 420, h: 460 }}
          focused={windows.focused === HMI_WINDOW}
          z={10 + windows.depth(HMI_WINDOW)}
          onFocus={() => windows.focus(HMI_WINDOW)}
          onClose={() => windows.close(HMI_WINDOW)}
        >
          <HmiPanel devices={spec.devices} runner={activeRunner} />
        </FloatingWindow>
      )}

      <PinnableSidebar title="Work Order" storageKey="ws.brief.pinned">
        <BriefColumn
          spec={spec}
          width={0}
          result={submit.data}
          pending={submit.isPending}
          user={!!user}
          runner={activeRunner}
          // The section brief, when the focused window has one — a plant manual
          // read one station at a time is a manual; read whole it is a wall.
          sectionBrief={slots.find((s) => s.id === focusedPou)?.brief}
          onReplay={(scenarioName) => {
            if (submit.variables) {
              replay.start(spec, submit.variables as LadderProject, scenarioName);
            }
          }}
          onDemo={() => {
            runner.stop();
            replay.startDemo(spec);
          }}
        />
      </PinnableSidebar>
    </div>
  );
}

/** Whole plant, or one bay. Drives the 3D camera rather than swapping scenes. */
function SectionSwitcher({
  slots,
  active,
  onPick,
}: {
  slots: PouSlot[];
  active: string | null;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className="ws-sections" role="group" aria-label="Plant view">
      <button className={`ws-section${active === null ? ' on' : ''}`} onClick={() => onPick(null)}>
        Whole plant
      </button>
      {slots
        .filter((s) => s.title)
        .map((s) => (
          <button
            key={s.id}
            className={`ws-section${active === s.id ? ' on' : ''}`}
            onClick={() => onPick(s.id)}
          >
            {s.title}
          </button>
        ))}
    </div>
  );
}
