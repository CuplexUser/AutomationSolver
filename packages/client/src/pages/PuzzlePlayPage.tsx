import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PuzzleSpec } from '@automationsolver/shared';
import { ApiError } from '../api/client';
import { useCreateSlot, usePuzzle, useSubmit, useUpdateSlot } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useEditor } from '../features/ladder/editorStore';
import { LadderEditor } from '../features/ladder/LadderEditor';
import { ResizeHandle, usePersistedWidth } from '../features/layout/Resizable';
import { HmiPanel } from '../features/sim/HmiPanel';
import { ReplayBar } from '../features/sim/ReplayBar';
import { TraceStrip } from '../features/sim/TraceStrip';
import { useReplay } from '../features/sim/useReplay';
import { useSimRunner } from '../features/sim/useSimRunner';
import { SlotsPanel } from '../features/slots/SlotsPanel';
import { useActiveSlot } from '../features/slots/useActiveSlot';

export function PuzzlePlayPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, isError, error } = usePuzzle(slug);
  const { user } = useAuth();
  const submit = useSubmit(slug);

  if (isLoading) return <p className="muted pad">Loading puzzle…</p>;

  if (error instanceof ApiError && error.status === 403 && error.body.error === 'locked') {
    const requiresTitle = error.body.requiresTitle as string | undefined;
    return (
      <div className="pad">
        <p className="auth-error">
          🔒 Locked{requiresTitle ? ` — solve "${requiresTitle}" first.` : '.'}
        </p>
        <Link to="/puzzles" className="btn btn-ghost">
          Back to puzzles
        </Link>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="pad">
        <p className="auth-error">Puzzle not found.</p>
        <Link to="/puzzles" className="btn btn-ghost">
          Back to puzzles
        </Link>
      </div>
    );
  }

  const spec = data.puzzle;
  return <PlayInner key={spec.slug} spec={spec} user={user} submit={submit} />;
}

type PlayInnerProps = {
  spec: PuzzleSpec;
  user: ReturnType<typeof useAuth>['user'];
  submit: ReturnType<typeof useSubmit>;
};

function PlayInner({ spec, user, submit }: PlayInnerProps) {
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
    init(activeSlot.activeProgram);
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
  const [traceOpen, setTraceOpen] = useState(true);
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
            onReplay={(scenarioName) => {
              if (submit.variables) replay.start(spec, submit.variables, scenarioName);
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
            <HmiPanel spec={spec} runner={activeRunner} />
          </aside>
        </>
      )}
    </div>
  );
}

function BriefColumn({
  spec,
  width,
  result,
  pending,
  user,
  onReplay,
}: {
  spec: PuzzleSpec;
  width: number;
  result: ReturnType<typeof useSubmit>['data'];
  pending: boolean;
  user: boolean;
  onReplay: (scenarioName: string) => void;
}) {
  return (
    <aside className="play-brief" style={{ width }}>
      <div className="brief-card panel">
        <span className="eyebrow">Work Order · {spec.difficulty}</span>
        <h2>{spec.title}</h2>
        <pre className="briefing">{spec.briefing}</pre>
        {spec.hints && spec.hints.length > 0 && <HintsPanel slug={spec.slug} hints={spec.hints} />}
      </div>

      <div className="io-card panel">
        <span className="eyebrow">Terminal Assignment</span>
        <table className="io-table">
          <tbody>
            {spec.devices.map((d) => (
              <tr key={d.address}>
                <td>
                  <span className={`dev-chip dev-${d.address[0]}`}>{d.address}</span>
                </td>
                <td className="io-name">{d.label}</td>
                <td className="io-kind">{d.io === 'input' ? 'IN' : 'OUT'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {spec.registers && spec.registers.length > 0 && (
          <>
            <span className="eyebrow io-subhead">Working Registers</span>
            <table className="io-table">
              <tbody>
                {spec.registers.map((r) => (
                  <tr key={r.address}>
                    <td>
                      <span className={`dev-chip dev-${r.address[0]}`}>{r.address}</span>
                    </td>
                    <td className="io-name">
                      {r.label}
                      {r.note && <span className="io-note"> · {r.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <ResultsCard result={result} pending={pending} user={user} onReplay={onReplay} />
    </aside>
  );
}

/** Reveals hints one at a time; the reveal count is remembered per puzzle. */
function HintsPanel({ slug, hints }: { slug: string; hints: string[] }) {
  const key = `hints.${slug}`;
  const [revealed, setRevealed] = useState(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return v ? Math.min(hints.length, Math.max(0, Number(v))) : 0;
  });

  const reveal = () => {
    const next = Math.min(hints.length, revealed + 1);
    setRevealed(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(next));
  };

  return (
    <div className="hints">
      <span className="eyebrow">Hints</span>
      {revealed > 0 && (
        <ul>
          {hints.slice(0, revealed).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      {revealed < hints.length && (
        <button className="btn btn-ghost sm hint-reveal" onClick={reveal}>
          Show hint {revealed + 1} of {hints.length}
        </button>
      )}
    </div>
  );
}

function ResultsCard({
  result,
  pending,
  user,
  onReplay,
}: {
  result: ReturnType<typeof useSubmit>['data'];
  pending: boolean;
  user: boolean;
  onReplay: (scenarioName: string) => void;
}) {
  if (!user) {
    return (
      <div className="results-card panel">
        <span className="eyebrow">Grading</span>
        <p className="muted sm">
          <Link to="/login" className="inline-link">
            Sign in
          </Link>{' '}
          to submit and grade your solution.
        </p>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="results-card panel">
        <span className="eyebrow">Grading</span>
        <p className="muted sm">Running test scenarios…</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="results-card panel">
        <span className="eyebrow">Grading</span>
        <p className="muted sm">Build your ladder, run it to test, then submit for grading.</p>
      </div>
    );
  }

  if (!result.validation.valid) {
    return (
      <div className="results-card panel invalid">
        <span className="eyebrow">Validation failed</span>
        <ul className="fail-list">
          {result.validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const grade = result.grade!;
  return (
    <div className={`results-card panel${grade.solved ? ' solved' : ''}`}>
      <div className="results-head">
        <span className="eyebrow">Grading</span>
        <span className={`score${grade.solved ? ' ok' : ''}`}>{grade.score}%</span>
      </div>
      {grade.solved && <p className="solved-banner">✔ Solved — all scenarios pass</p>}
      <ul className="scenario-list">
        {grade.scenarios.map((s, i) => (
          <li key={i} className={s.passed ? 'pass' : 'fail'}>
            <span className="scenario-mark">{s.passed ? '✔' : '✕'}</span>
            <div>
              <span className="scenario-name">{s.name}</span>
              {!s.passed && (
                <>
                  <ul className="step-fails">
                    {s.steps
                      .filter((st) => !st.passed)
                      .map((st, j) => (
                        <li key={j}>
                          {st.label}: {st.failures.join('; ')}
                        </li>
                      ))}
                  </ul>
                  <button className="btn btn-ghost sm" onClick={() => onReplay(s.name)}>
                    ▶ Replay
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
