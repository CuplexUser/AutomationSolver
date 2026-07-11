import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LadderProgram, PuzzleSpec } from '@automationsolver/shared';
import { usePuzzle, useSaveDraft, useSubmit } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useEditor } from '../features/ladder/editorStore';
import { LadderEditor } from '../features/ladder/LadderEditor';
import { HmiPanel } from '../features/sim/HmiPanel';
import { useSimRunner } from '../features/sim/useSimRunner';

export function PuzzlePlayPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, isError } = usePuzzle(slug);
  const { user } = useAuth();
  const { program, init, dirty, markClean } = useEditor();
  const saveDraft = useSaveDraft(slug);
  const submit = useSubmit(slug);

  // Load the saved (or empty) program into the editor when the puzzle arrives.
  useEffect(() => {
    if (data) init(data.savedProgram);
  }, [data, init]);

  if (isLoading) return <p className="muted pad">Loading puzzle…</p>;
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
  return <PlayInner key={spec.slug} spec={spec} program={program} {...{ user, saveDraft, submit, dirty, markClean }} />;
}

type PlayInnerProps = {
  spec: PuzzleSpec;
  program: LadderProgram;
  user: ReturnType<typeof useAuth>['user'];
  saveDraft: ReturnType<typeof useSaveDraft>;
  submit: ReturnType<typeof useSubmit>;
  dirty: boolean;
  markClean: () => void;
};

function PlayInner({ spec, program, user, saveDraft, submit, dirty, markClean }: PlayInnerProps) {
  const runner = useSimRunner(program, spec);
  const result = submit.data;

  return (
    <div className="play">
      <aside className="play-brief">
        <div className="brief-card panel">
          <span className="eyebrow">Work Order · {spec.difficulty}</span>
          <h2>{spec.title}</h2>
          <pre className="briefing">{spec.briefing}</pre>
          {spec.hints && spec.hints.length > 0 && (
            <details className="hints">
              <summary>Hints</summary>
              <ul>
                {spec.hints.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </details>
          )}
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

        <ResultsCard result={result} pending={submit.isPending} user={!!user} />
      </aside>

      <main className="play-main">
        <div className="play-actions">
          <div className="pa-left">
            {dirty ? <span className="dirty-dot">● unsaved</span> : <span className="muted sm">saved</span>}
          </div>
          <div className="pa-right">
            <button
              className="btn btn-ghost"
              disabled={!user || saveDraft.isPending}
              onClick={() => saveDraft.mutate(program, { onSuccess: markClean })}
              title={user ? 'Save draft' : 'Sign in to save'}
            >
              {saveDraft.isPending ? 'Saving…' : 'Save draft'}
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

        <LadderEditor
          allowedInstructions={spec.allowedInstructions}
          devices={spec.devices}
          registers={spec.registers}
          evalResults={runner.evalResults}
          running={runner.running}
        />
      </main>

      <aside className="play-hmi">
        <HmiPanel spec={spec} runner={runner} />
      </aside>
    </div>
  );
}

function ResultsCard({
  result,
  pending,
  user,
}: {
  result: ReturnType<typeof useSubmit>['data'];
  pending: boolean;
  user: boolean;
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
                <ul className="step-fails">
                  {s.steps
                    .filter((st) => !st.passed)
                    .map((st, j) => (
                      <li key={j}>
                        {st.label}: {st.failures.join('; ')}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
