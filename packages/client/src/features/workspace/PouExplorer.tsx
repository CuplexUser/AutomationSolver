import { useState } from 'react';
import type { LadderProject, PouSlot, TaskDef } from '@automationsolver/shared';
import { TagIcon } from '../../components/icons';
import { useEditor } from '../ladder/editorStore';

/**
 * The program tree: tasks, and the sections each one calls, in scan order.
 *
 * This is the only place the *schedule* is visible, and the schedule is content
 * — a supervisor listed after its stations acts on last scan's state, and a
 * section parked in the slow task reacts a fifth of a second late. So the rail
 * shows call order explicitly (numbered, not merely stacked) and says each
 * task's rate on its header rather than leaving both to the briefing.
 *
 * Under `pouAuthoring: 'player'` it is also where programs are made. The
 * puzzle's own slots stay pinned — they cannot be renamed, moved or deleted,
 * because a fixture is content and `assembleProject` would take it from the spec
 * whatever this tree said — and everything the player added sits after them,
 * where it is added, reordered and removed.
 */

/** POU names follow the same shape as variable names: an identifier a PLC would take. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;

/**
 * A stable id derived from the name, uniquified against everything already taken.
 *
 * Derived once at creation and then left alone: the id is what a task calls and
 * what a saved slot stores, so a later rename must not move it.
 */
function makeId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toUpperCase()
      .replaceAll(/[^A-Z0-9_]+/g, '_')
      .replaceAll(/^_+|_+$/g, '') || 'POU';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}

export function PouExplorer({
  project,
  slots,
  focusedPou,
  openPous,
  onOpen,
  authoring = false,
  maxPous,
  globals,
}: {
  project: LadderProject;
  slots: PouSlot[];
  focusedPou: string | null;
  /** Which sections currently have a window up. */
  openPous: readonly string[];
  onOpen: (pouId: string) => void;
  /** The puzzle hands over authoring (`pouAuthoring: 'player'`). */
  authoring?: boolean;
  maxPous?: number;
  /** Omitted on a puzzle written in raw addresses, which has no globals to show. */
  globals?: { open: boolean; onOpen: () => void };
}) {
  const addPou = useEditor((s) => s.addPou);
  const renamePou = useEditor((s) => s.renamePou);
  const removePou = useEditor((s) => s.removePou);
  const movePou = useEditor((s) => s.movePou);

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const rungCount = (id: string) => project.pous.find((p) => p.id === id)?.rungs.length ?? 0;
  const ordered = [...project.tasks].sort((a, b) => a.priority - b.priority);

  // The player's own programs, in project order. `assembleProject` appends them
  // after the puzzle's slots in exactly this order, so this list is also the
  // order they will be called in — which is what makes moving one meaningful.
  const mine = authoring ? project.pous.filter((p) => !slotById.has(p.id)).map((p) => p.id) : [];
  const canAdd = authoring && (maxPous === undefined || project.pous.length < maxPous);

  return (
    <nav className="pou-explorer" aria-label="Program tree">
      <span className="eyebrow">Program</span>
      {/* The project's own declarations, above the schedule that runs it. This
          is the level globals live at — they belong to no section — and it is
          the one place a player already looks to see how the program is put
          together, which is why it is here and not down among the actions. */}
      {globals && (
        <button
          className={`pe-globals${globals.open ? ' open' : ''}`}
          onClick={globals.onOpen}
          title="Names every section can see — how one program tells the others what it is doing"
        >
          <TagIcon size={13} />
          <span className="pe-name">Globals</span>
          <span className="pe-rungs">{project.globals?.length ?? 0}</span>
        </button>
      )}
      {ordered.map((task) => (
        <div key={task.id} className="pe-task">
          <div className="pe-task-head">
            <span className="pe-task-name">{task.name}</span>
            <span className="pe-task-rate">{taskRate(task)}</span>
          </div>
          <ol className="pe-pous">
            {task.pous.map((pouId, i) => {
              const slot = slotById.get(pouId);
              const rank = mine.indexOf(pouId);
              return (
                <PouRow
                  key={pouId}
                  pouId={pouId}
                  order={i + 1}
                  name={project.pous.find((p) => p.id === pouId)?.name ?? slot?.name ?? pouId}
                  title={slot?.title ?? ''}
                  rungs={rungCount(pouId)}
                  locked={slot?.editable === false}
                  focused={focusedPou === pouId}
                  open={openPous.includes(pouId)}
                  onOpen={() => onOpen(pouId)}
                  // Only a program the player made is theirs to edit here, and
                  // only against another of their own: a slot's place in the
                  // task comes from the spec and moving past it would be a
                  // reorder the grader does not perform.
                  mine={rank >= 0}
                  canMoveUp={rank > 0}
                  canMoveDown={rank >= 0 && rank < mine.length - 1}
                  onMove={(d) => movePou(pouId, d)}
                  onRename={(name) => renamePou(pouId, name)}
                  onRemove={() => removePou(pouId)}
                  takenNames={project.pous.filter((p) => p.id !== pouId).map((p) => p.name)}
                />
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

      {authoring && (
        <AddPou
          disabled={!canAdd}
          limit={maxPous}
          count={project.pous.length}
          takenNames={project.pous.map((p) => p.name)}
          onAdd={(name) => addPou(makeId(name, new Set(project.pous.map((p) => p.id))), name)}
        />
      )}
    </nav>
  );
}

interface RowProps {
  pouId: string;
  order: number;
  name: string;
  title: string;
  rungs: number;
  locked: boolean;
  focused: boolean;
  open: boolean;
  onOpen: () => void;
  mine: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  takenNames: string[];
}

/**
 * One program in the tree.
 *
 * The row's controls are siblings of the open-button rather than children of it:
 * a button inside a button is not a thing, and the whole row has always been the
 * click target that opens the section.
 */
function PouRow({
  pouId,
  order,
  name,
  title,
  rungs,
  locked,
  focused,
  open,
  onOpen,
  mine,
  canMoveUp,
  canMoveDown,
  onMove,
  onRename,
  onRemove,
  takenNames,
}: RowProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    const next = draft.trim();
    const clash = takenNames.some((n) => n.trim().toLowerCase() === next.toLowerCase());
    if (NAME_RE.test(next) && !clash) onRename(next);
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <li className="pe-row">
        <input
          className="field mono compact pe-rename"
          value={draft}
          autoFocus
          spellCheck={false}
          aria-label={`Rename ${name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setDraft(null);
          }}
        />
      </li>
    );
  }

  return (
    <li className="pe-row">
      <button
        className={`pe-pou${focused ? ' focused' : ''}${open ? ' open' : ''}`}
        onClick={onOpen}
        title={locked ? `${title} — ships working, read only` : `Open ${title || pouId}`}
      >
        <span className="pe-order">{order}</span>
        <span className="pe-names">
          <span className="pe-name">{name}</span>
          <span className="pe-title">{title}</span>
        </span>
        <span className="pe-meta">
          {locked && <span className="pe-lock" title="Read only">🔒</span>}
          <span className="pe-rungs">{rungs}</span>
        </span>
      </button>
      {mine && (
        <span className="pe-tools">
          <button
            className="pe-tool"
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            title={`Call ${name} earlier in the scan`}
            aria-label={`Move ${name} up`}
          >
            ▲
          </button>
          <button
            className="pe-tool"
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            title={`Call ${name} later in the scan`}
            aria-label={`Move ${name} down`}
          >
            ▼
          </button>
          <button
            className="pe-tool"
            onClick={() => setDraft(name)}
            title={`Rename ${name}`}
            aria-label={`Rename ${name}`}
          >
            ✎
          </button>
          <button
            className="pe-tool danger"
            onClick={onRemove}
            title={`Delete ${name} and its ${rungs} rung${rungs === 1 ? '' : 's'}`}
            aria-label={`Delete ${name}`}
          >
            ✕
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * Making a program.
 *
 * Asks for a name and nothing else. The id is derived from it and never shown:
 * it exists so a task and a save slot have something stable to point at, and a
 * player who had to invent one would be inventing the wrong thing.
 */
function AddPou({
  disabled,
  limit,
  count,
  takenNames,
  onAdd,
}: {
  disabled: boolean;
  limit?: number;
  count: number;
  takenNames: string[];
  onAdd: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const clash = takenNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase());
  const ok = NAME_RE.test(trimmed) && !clash;

  const submit = (): void => {
    if (!ok || disabled) return;
    onAdd(trimmed);
    setDraft('');
  };

  return (
    <div className="pe-add">
      <input
        className="field mono compact"
        value={draft}
        placeholder="NEW_PROGRAM"
        aria-label="Name for a new program"
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="btn small" onClick={submit} disabled={!ok || disabled}>
        Add
      </button>
      {disabled ? (
        <p className="pe-add-note">
          {limit} programs is the limit for this puzzle. Delete one to make another.
        </p>
      ) : (
        limit !== undefined && (
          <p className="pe-add-note">
            {count} of {limit} programs.
          </p>
        )
      )}
      {trimmed !== '' && !ok && (
        <p className="pe-add-note bad">
          {clash
            ? `${trimmed} is already the name of a program.`
            : 'Start with a letter or underscore, then letters, digits or underscores.'}
        </p>
      )}
    </div>
  );
}

function taskRate(task: TaskDef): string {
  if (task.intervalMs === undefined) return 'every scan';
  return task.intervalMs >= 1000 ? `${task.intervalMs / 1000} s` : `${task.intervalMs} ms`;
}
