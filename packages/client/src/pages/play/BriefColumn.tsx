import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TIMER_BASE_MS, type PuzzleSpec, type SimSnapshot } from '@automationsolver/shared';
import { usePuzzles, type useSubmit } from '../../api/queries';

/** Live sim state for lighting up the terminal/register tables; omit for a static (non-running) view. */
export interface LiveRegisterState {
  bits: Record<string, boolean>;
  timers?: SimSnapshot['timers'];
  counters?: SimSnapshot['counters'];
}

export function BriefColumn({
  spec,
  width,
  result,
  pending,
  user,
  runner,
  onReplay,
}: {
  spec: PuzzleSpec;
  width: number;
  result: ReturnType<typeof useSubmit>['data'];
  pending: boolean;
  user: boolean;
  /** Live bits/timers/counters to light up the tables below; omitted where there's nothing running (e.g. cabinet puzzles). */
  runner?: LiveRegisterState;
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
            {spec.devices.map((d) => {
              const on = runner?.bits[d.address] === true;
              return (
                <tr key={d.address}>
                  <td>
                    <span className={`dev-chip dev-${d.address[0]}${on ? ' on' : ''}`}>{d.address}</span>
                  </td>
                  <td className="io-name">{d.label}</td>
                  <td className="io-kind">{d.io === 'input' ? 'IN' : 'OUT'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {registers && registers.length > 0 && (
          <>
            <span className="eyebrow io-subhead">Working Registers</span>
            <table className="io-table">
              <tbody>
                {registers.map((r) => (
                  <RegisterRow key={r.address} register={r} runner={runner} />
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

function RegisterRow({
  register: r,
  runner,
}: {
  register: { address: string; label: string; note?: string };
  runner?: LiveRegisterState;
}) {
  const kind = r.address[0];
  const on = runner?.bits[r.address] === true;
  const t = kind === 'T' ? runner?.timers?.[r.address] : undefined;
  const c = kind === 'C' ? runner?.counters?.[r.address] : undefined;
  return (
    <tr key={r.address}>
      <td>
        <span className={`dev-chip dev-${kind}${on ? ' on' : ''}`}>{r.address}</span>
      </td>
      <td className="io-name">
        {r.label}
        {r.note && <span className="io-note"> · {r.note}</span>}
      </td>
      <td className="io-value">
        {t && (
          <MiniProgress
            value={t.elapsed}
            max={t.preset * TIMER_BASE_MS}
            done={t.done}
            text={`${(t.elapsed / 1000).toFixed(1)}s / ${((t.preset * TIMER_BASE_MS) / 1000).toFixed(1)}s`}
          />
        )}
        {c && <MiniProgress value={c.count} max={c.preset} done={c.done} text={`${c.count} / ${c.preset}`} />}
      </td>
    </tr>
  );
}

/** Compact fill bar with the value overlaid, used for timer elapsed/preset and counter count/preset. */
function MiniProgress({ value, max, done, text }: { value: number; max: number; done: boolean; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`mini-bar${done ? ' done' : ''}`} title={text}>
      <div className="mini-bar-fill" style={{ width: `${pct}%` }} />
      <span className="mini-bar-text">{text}</span>
    </div>
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
