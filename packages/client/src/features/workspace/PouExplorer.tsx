import type { LadderProject, PouSlot, TaskDef } from '@automationsolver/shared';

/**
 * The program tree: tasks, and the sections each one calls, in scan order.
 *
 * This is the only place the *schedule* is visible, and the schedule is content
 * — a supervisor listed after its stations acts on last scan's state, and a
 * section parked in the slow task reacts a fifth of a second late. So the rail
 * shows call order explicitly (numbered, not merely stacked) and says each
 * task's rate on its header rather than leaving both to the briefing.
 */
export function PouExplorer({
  project,
  slots,
  focusedPou,
  openPous,
  onOpen,
}: {
  project: LadderProject;
  slots: PouSlot[];
  focusedPou: string | null;
  /** Which sections currently have a window up. */
  openPous: readonly string[];
  onOpen: (pouId: string) => void;
}) {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const rungCount = (id: string) => project.pous.find((p) => p.id === id)?.rungs.length ?? 0;
  const ordered = [...project.tasks].sort((a, b) => a.priority - b.priority);

  return (
    <nav className="pou-explorer" aria-label="Program tree">
      <span className="eyebrow">Program</span>
      {ordered.map((task) => (
        <div key={task.id} className="pe-task">
          <div className="pe-task-head">
            <span className="pe-task-name">{task.name}</span>
            <span className="pe-task-rate">{taskRate(task)}</span>
          </div>
          <ol className="pe-pous">
            {task.pous.map((pouId, i) => {
              const slot = slotById.get(pouId);
              const open = openPous.includes(pouId);
              return (
                <li key={pouId}>
                  <button
                    className={`pe-pou${focusedPou === pouId ? ' focused' : ''}${open ? ' open' : ''}`}
                    onClick={() => onOpen(pouId)}
                    title={
                      slot?.editable === false
                        ? `${slot.title} — ships working, read only`
                        : `Open ${slot?.title ?? pouId}`
                    }
                  >
                    <span className="pe-order">{i + 1}</span>
                    <span className="pe-names">
                      <span className="pe-name">{slot?.name ?? pouId}</span>
                      <span className="pe-title">{slot?.title ?? ''}</span>
                    </span>
                    <span className="pe-meta">
                      {slot && !slot.editable && <span className="pe-lock" title="Read only">🔒</span>}
                      <span className="pe-rungs">{rungCount(pouId)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {/* A section no task calls never runs, which is invisible on the plant and
          obvious here. The validator warns too, but by then it is a submission. */}
      {project.pous
        .filter((pou) => !project.tasks.some((t) => t.pous.includes(pou.id)))
        .map((pou) => (
          <button key={pou.id} className="pe-pou orphan" onClick={() => onOpen(pou.id)}>
            <span className="pe-order">—</span>
            <span className="pe-names">
              <span className="pe-name">{pou.name}</span>
              <span className="pe-title">in no task, never runs</span>
            </span>
          </button>
        ))}
    </nav>
  );
}

function taskRate(task: TaskDef): string {
  if (task.intervalMs === undefined) return 'every scan';
  return task.intervalMs >= 1000 ? `${task.intervalMs / 1000} s` : `${task.intervalMs} ms`;
}
