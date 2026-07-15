import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PuzzleSpec } from '@automationsolver/shared';
import { usePuzzles, type useSubmit } from '../../api/queries';

export function BriefColumn({
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
  /** Omit to hide the per-scenario Replay button (cabinet puzzles, for now). */
  onReplay?: (scenarioName: string) => void;
}) {
  const registers = spec.kind === 'ladder' ? spec.registers : undefined;
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

        {registers && registers.length > 0 && (
          <>
            <span className="eyebrow io-subhead">Working Registers</span>
            <table className="io-table">
              <tbody>
                {registers.map((r) => (
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

      <ResultsCard slug={spec.slug} result={result} pending={pending} user={user} onReplay={onReplay} />
    </aside>
  );
}

/**
 * Link to the next open puzzle, so finishing one doesn't require a trip back
 * to the list. "Next" = the next unlocked puzzle after this one in order
 * (submitting refetches the list, so the puzzle a solve unlocks is included);
 * if the player is at the end, fall back to any open unsolved puzzle.
 */
function NextPuzzleNav({ slug, onlyIfSolved }: { slug: string; onlyIfSolved?: boolean }) {
  const { data } = usePuzzles();
  const list = data?.puzzles ?? [];
  const i = list.findIndex((p) => p.slug === slug);
  if (i < 0) return null;
  if (onlyIfSolved && list[i].status !== 'solved') return null;
  const next =
    list.slice(i + 1).find((p) => !p.locked) ??
    list.find((p) => !p.locked && p.slug !== slug && p.status !== 'solved');
  return (
    <div className="next-nav">
      {onlyIfSolved && <span className="muted sm">✔ Solved</span>}
      {next ? (
        <Link to={`/puzzles/${next.slug}`} className="btn btn-primary sm">
          Next: {next.title} →
        </Link>
      ) : (
        <span className="muted sm">All work orders complete 🎉</span>
      )}
      <Link to="/puzzles" className="inline-link">
        All puzzles
      </Link>
    </div>
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
  slug,
  result,
  pending,
  user,
  onReplay,
}: {
  slug: string;
  result: ReturnType<typeof useSubmit>['data'];
  pending: boolean;
  user: boolean;
  onReplay?: (scenarioName: string) => void;
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
        <p className="muted sm">Build your solution, run it to test, then submit for grading.</p>
        {/* Returning to an already-solved puzzle still offers the next one. */}
        <NextPuzzleNav slug={slug} onlyIfSolved />
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
      {grade.solved && (
        <>
          <p className="solved-banner">✔ Solved — all scenarios pass</p>
          <NextPuzzleNav slug={slug} />
        </>
      )}
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
                  {onReplay && (
                    <button className="btn btn-ghost sm" onClick={() => onReplay(s.name)}>
                      ▶ Replay
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
