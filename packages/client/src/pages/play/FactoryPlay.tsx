import { useEffect, useMemo, useRef, useState } from 'react';
import {
  symbolChoicesFor,
  assembleProject,
  FACTORY_SECTIONS,
  initialProject,
  missingDeclarations,
  type LadderProject,
  type LadderPuzzleSpec,
  type MissingDeclaration,
  type PouSlot,
} from '@automationsolver/shared';
import { DeskIcon, PanelIcon, SaveIcon, SubmitIcon } from '../../components/icons';
import { useCreateSlot, useUpdateSlot } from '../../api/queries';
import { LadderEditor } from '../../features/ladder/LadderEditor';
import { GLOBAL_SCOPE, useEditor, varsIn } from '../../features/ladder/editorStore';
import { VariablesPanel } from '../../features/ladder/VariablesPanel';
import { HmiPanel } from '../../features/sim/HmiPanel';
import { MachineView } from '../../features/sim/MachineView';
import { ReplayBar } from '../../features/sim/ReplayBar';
import { useReplay, type ReplayController } from '../../features/sim/useReplay';
import { useSimRunner } from '../../features/sim/useSimRunner';
import { useActiveSlot } from '../../features/slots/useActiveSlot';
import {
  cascadeBox,
  FloatingWindow,
  WindowTabStrip,
  type MinimizedTab,
} from '../../features/workspace/FloatingWindow';
import { PinnableSidebar } from '../../features/workspace/PinnableSidebar';
import { PouExplorer } from '../../features/workspace/PouExplorer';
import { useWindows } from '../../features/workspace/useWindows';
import { BriefColumn } from './BriefColumn';
import { PuzzleTopNav } from './PuzzleTopNav';
import type { PlayProps } from './LadderPlay';

/** Window id for the operator panel, which floats like any section does. */
const HMI_WINDOW = '__hmi';
/** Window id for the project's globals table — the interface between sections. */
const GLOBALS_WINDOW = '__globals';
/** Windows that are not a POU, and so must not be handed a ladder editor. */
const TOOL_WINDOWS = new Set<string>([HMI_WINDOW, GLOBALS_WINDOW]);

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
  // Which sections have their locals table pulled out under the ladder. A
  // declaration list is reference material, not a mode, so it opens as a drawer
  // inside the window rather than replacing the program the player is reading.
  const [localsOpen, setLocalsOpen] = useState<readonly string[]>([]);
  const toggleLocals = (pouId: string) =>
    setLocalsOpen((ids) => (ids.includes(pouId) ? ids.filter((id) => id !== pouId) : [...ids, pouId]));

  // A puzzle written in raw addresses has nothing to declare: resolution never
  // runs, so a name the player typed here would reach the engine as a name and
  // match nothing. The whole affordance is hidden rather than shown broken.
  const declares = (spec.symbols ?? 'off') !== 'off';

  // Names the program already uses and nothing declares. Computed as the player
  // types rather than waiting for a submission, because the answer is a
  // declaration they were going to write anyway and the editor knows both the
  // name and the kind.
  const missing = useMemo(
    () => (declares ? missingDeclarations(spec, project) : []),
    [declares, spec, project],
  );
  // The globals table offers each name once, whichever section wanted it: a
  // global is exactly the case where more than one does.
  const missingGlobal = useMemo(() => {
    const byName = new Map<string, MissingDeclaration>();
    for (const miss of missing) if (!byName.has(miss.name)) byName.set(miss.name, miss);
    return [...byName.values()];
  }, [missing]);

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

  // One tab per minimized window, whatever kind it is — a bare id would ask
  // the player to remember what they collapsed, so it carries the same title
  // the window's own bar would have shown.
  const windowTitle = (id: string): string => {
    if (id === HMI_WINDOW) return 'Operator panel';
    if (id === GLOBALS_WINDOW) return 'Globals';
    return project.pous.find((p) => p.id === id)?.name ?? slots.find((s) => s.id === id)?.name ?? id;
  };
  const minimizedTabs: MinimizedTab[] = windows.open
    .filter((id) => windows.isMinimized(id))
    .map((id) => ({
      id,
      title: windowTitle(id),
      onRestore: () => {
        windows.restore(id);
        if (!TOOL_WINDOWS.has(id)) focusPou(id);
      },
    }));

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
          authoring={spec.pouAuthoring === 'player'}
          maxPous={spec.maxPous}
          globals={
            declares
              ? {
                  open: windows.isOpen(GLOBALS_WINDOW),
                  onOpen: () => windows.toggle(GLOBALS_WINDOW),
                }
              : undefined
          }
        />
        {/* Three jobs, not five buttons: the tool that opens the plant's own
            controls, the quiet housekeeping one, and the pair that commits
            work. They are weighted in that order. */}
        <div className="ws-rail-actions">
          <button
            className={`rail-tool${windows.isOpen(HMI_WINDOW) ? ' on' : ''}`}
            onClick={() => windows.toggle(HMI_WINDOW)}
            aria-pressed={windows.isOpen(HMI_WINDOW)}
            title="The plant's pushbuttons, lamps and analog readouts"
          >
            <PanelIcon size={16} />
            <span>Operator panel</span>
          </button>
          <button
            className="rail-quiet"
            onClick={windows.closeAll}
            disabled={windows.open.length === 0}
            title="Close every window and watch the plant on its own"
          >
            <DeskIcon size={14} />
            <span>Clear the desk</span>
          </button>
          <div className="rail-status">
            {dirty ? <span className="dirty-dot">● unsaved</span> : <span className="muted sm">saved</span>}
          </div>
          <button
            className="btn btn-ghost rail-act"
            disabled={!user || updateSlot.isPending || createSlot.isPending}
            onClick={saveCurrent}
          >
            <SaveIcon size={14} />
            {updateSlot.isPending || createSlot.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            className="btn btn-primary rail-act"
            disabled={!user || submit.isPending || runner.running}
            onClick={() => submit.mutate(project, { onSuccess: markClean })}
          >
            <SubmitIcon size={15} />
            {submit.isPending ? 'Grading…' : 'Submit'}
          </button>
        </div>
      </div>

      {/* The plant fills whatever the rail and a pinned sidebar leave. With no
          windows open and the brief collapsed, it is the whole page. */}
      <main className="ws-stage">
        <div className="ws-stage-bar">
          <SectionSwitcher slots={slots} active={section} onPick={setSection} />
          {/* The same two commands the operator panel carries, on the same
              runner — the plant is watchable with every window closed, so
              starting it must not require opening one. A demonstration owns the
              machine while it plays, so the only command left is to end it. */}
          {replay.demo ? (
            <div className="ws-run">
              <button
                className="run-btn stop"
                onClick={replay.close}
                title="End the demonstration and take the plant back"
                aria-label="End the demonstration"
              >
                ■
              </button>
            </div>
          ) : (
            <div className="ws-run" role="group" aria-label="Simulation">
              <button
                className={`run-btn${activeRunner.running ? ' on' : ''}`}
                onClick={activeRunner.start}
                disabled={activeRunner.running}
                title="Run the simulation"
                aria-label="Run the simulation"
              >
                ▶
              </button>
              <button
                className="run-btn stop"
                onClick={activeRunner.stop}
                disabled={!activeRunner.running}
                title="Stop the simulation"
                aria-label="Stop the simulation"
              >
                ■
              </button>
            </div>
          )}
        </div>
        {/* A looping demonstration gets a caption, not a transport. There is
            nothing to scrub to and nothing to pause for: it is the plant
            running, and the point is to watch it long enough to see the shape
            of a cycle. Graded replays keep the full bar. */}
        {replay.demo && replay.looping ? (
          <DemoStrip replay={replay} caption={spec.demo?.caption} />
        ) : (
          <ReplayBar replay={replay} demoCaption={spec.demo?.caption} />
        )}
        <div className="ws-machine">
          <MachineView spec={spec} runner={activeRunner} section={section ?? undefined} />
        </div>
      </main>

      {windows.open
        .filter((id) => !TOOL_WINDOWS.has(id))
        .map((pouId) => {
          const slot = slots.find((s) => s.id === pouId);
          const index = slots.findIndex((s) => s.id === pouId);
          const readOnly = slot?.editable === false;
          const showLocals = declares && localsOpen.includes(pouId);
          // A program the player made has no slot, so its title is the name they
          // gave it — and follows them renaming it.
          const name = project.pous.find((p) => p.id === pouId)?.name ?? slot?.name ?? pouId;
          const undeclared = readOnly ? [] : missing.filter((m) => m.pouId === pouId);
          return (
            <FloatingWindow
              key={pouId}
              id={pouId}
              storageKey={`ws.win.${spec.slug}.${pouId}`}
              title={name}
              subtitle={slot?.title}
              badge={
                <>
                  {readOnly && <span className="fw-badge">READ ONLY</span>}
                  {declares && (
                    <button
                      className={`fw-badge fw-badge-btn${showLocals ? ' on' : ''}${undeclared.length > 0 ? ' warn' : ''}`}
                      onClick={() => toggleLocals(pouId)}
                      aria-pressed={showLocals}
                      title={
                        undeclared.length > 0
                          ? `${undeclared.length} name${undeclared.length === 1 ? '' : 's'} used here and declared nowhere — open to fix`
                          : `Names private to ${name} — no other section can see them`
                      }
                    >
                      VAR {varsIn(project, pouId).length}
                      {undeclared.length > 0 && <span className="fw-badge-alert">!</span>}
                    </button>
                  )}
                </>
              }
              initial={cascadeBox(Math.max(0, index))}
              focused={windows.focused === pouId}
              z={10 + windows.depth(pouId)}
              onFocus={() => {
                windows.focus(pouId);
                focusPou(pouId);
              }}
              onClose={() => windows.close(pouId)}
              minimized={windows.isMinimized(pouId)}
              onMinimize={() => windows.minimize(pouId)}
            >
              <div className="pou-body">
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
                  readOnly={readOnly}
                  windowed
                  // Resolution order is per-POU, so each window offers the names
                  // that section can actually see: its own locals first, then the
                  // globals, then the plant.
                  symbols={symbolChoicesFor(spec, project, pouId)}
                />
                {/* The locals drawer sits under the program it belongs to, so a
                    declaration and the rung that reads it are on screen at once.
                    A pre-written section's table is shown and not edited: it is
                    the handshake the player is coding against. */}
                {showLocals && (
                  <div className="pou-locals inset">
                    <VariablesPanel
                      spec={spec}
                      scope={pouId}
                      title={`${name} locals`}
                      readOnly={readOnly}
                      suggestions={undeclared}
                    />
                  </div>
                )}
              </div>
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
          minimized={windows.isMinimized(HMI_WINDOW)}
          onMinimize={() => windows.minimize(HMI_WINDOW)}
        >
          <HmiPanel devices={spec.devices} runner={activeRunner} />
        </FloatingWindow>
      )}

      {declares && windows.isOpen(GLOBALS_WINDOW) && (
        <FloatingWindow
          id={GLOBALS_WINDOW}
          storageKey={`ws.win.${spec.slug}.globals`}
          title="Globals"
          subtitle="visible to every section"
          initial={{ x: 180, y: 150, w: 520, h: 320 }}
          focused={windows.focused === GLOBALS_WINDOW}
          z={10 + windows.depth(GLOBALS_WINDOW)}
          onFocus={() => windows.focus(GLOBALS_WINDOW)}
          onClose={() => windows.close(GLOBALS_WINDOW)}
          minimized={windows.isMinimized(GLOBALS_WINDOW)}
          onMinimize={() => windows.minimize(GLOBALS_WINDOW)}
        >
          <VariablesPanel
            spec={spec}
            scope={GLOBAL_SCOPE}
            title="Globals"
            suggestions={missingGlobal}
          />
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

      <WindowTabStrip tabs={minimizedTabs} />
    </div>
  );
}

/**
 * A running demonstration, announced but not driveable.
 *
 * One line saying what is on screen and one saying which part of the cycle the
 * plant is in — no scrub, no pause. The player is studying a line, and a
 * transport bar under it is an invitation to poke at the playhead instead.
 */
function DemoStrip({ replay, caption }: { replay: ReplayController; caption?: string }) {
  const { trace, index, currentStep } = replay;
  if (!trace) return null;
  const tMs = trace.samples[index]?.tMs ?? 0;
  return (
    <div className="demo-strip panel">
      <span className="eyebrow demo-live">● Demonstration</span>
      <div className="demo-lines">
        {caption && <p className="sm">{caption}</p>}
        {currentStep && <p className="muted sm">{currentStep.label}</p>}
      </div>
      <span className="demo-clock mono">{(tMs / 1000).toFixed(0)}s</span>
    </div>
  );
}

/**
 * Whole plant, or one bay. Drives the 3D camera rather than swapping scenes.
 *
 * Only sections the scene can actually frame get a chip. The supervisor's
 * "bay" is the whole floor, so its chip did exactly what "Whole plant" does —
 * two buttons for one view, which reads as one of them being broken.
 */
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
        .filter((s) => s.title && s.id !== FACTORY_SECTIONS.supervisor)
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
