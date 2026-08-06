import { useState } from 'react';
import { Link } from 'react-router';
import {
  CORRECTNESS_WEIGHT,
  TIMER_BASE_MS,
  isAnalog,
  scaleCounts,
  type PuzzleDevice,
  type PuzzleSpec,
  type SimSnapshot,
} from '@automationsolver/shared';
import { usePuzzles, type useSubmit } from '../../api/queries';

/** Live sim state for lighting up the terminal/register tables; omit for a static (non-running) view. */
export interface LiveRegisterState {
  bits: Record<string, boolean>;
  timers?: SimSnapshot['timers'];
  counters?: SimSnapshot['counters'];
  /** Word devices, by address. A D address absent here reads as 0, same as the CPU. */
  registers?: Record<string, number>;
}

export function BriefColumn({
  spec,
  width,
  result,
  pending,
  user,
  runner,
  onReplay,
  onDemo,
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
  /** Play the puzzle's shipped demonstration. Omit where there is none. */
  onDemo?: () => void;
}) {
  const registers = spec.kind === 'ladder' ? spec.registers : undefined;
  const demo = spec.kind === 'ladder' ? spec.demo : undefined;
  const hasAnalog = spec.devices.some(isAnalog);
  return (
    <aside className="play-brief" style={{ width }}>
      <div className="brief-card panel">
        <span className="eyebrow">Work Order · {spec.difficulty}</span>
        <h2>{spec.title}</h2>
        {/* Above the briefing, not below it: the point of a demonstration is to
            know what the machine is before reading three screens about it. */}
        {demo && onDemo && (
          <button className="btn btn-ghost demo-watch" onClick={onDemo}>
            ▶ Watch the machine run
            <span className="demo-caption">{demo.caption}</span>
          </button>
        )}
        <Briefing text={spec.briefing} />
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
                  {/* A word device has no lamp to light, so the number *is* its
                      state — without it the row says nothing while the sim runs.
                      The column only exists on puzzles that have one, so boolean
                      puzzles keep their full width for the device name. */}
                  {hasAnalog && (
                    <td className="io-value io-value-word">
                      {isAnalog(d) && runner && (
                        <WordValue value={runner.registers?.[d.address] ?? 0} device={d} />
                      )}
                    </td>
                  )}
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

interface BriefingListItem {
  text: string;
  sub: string[];
}
type BriefingBody =
  | { type: 'p'; text: string }
  | { type: 'ol'; items: BriefingListItem[] }
  | { type: 'ul'; items: string[] };
interface BriefingBlock {
  heading?: string;
  body?: BriefingBody;
}

const HEADING_MARKER = /^\s*##\s+(.*)$/;
const TOP_MARKER = /^\s*\d+\.\s+(.*)$/;
const SUB_MARKER = /^\s*[a-z]\.\s+(.*)$/;
const BULLET_MARKER = /^\s*-\s+(.*)$/;

/**
 * Puzzle briefings are authored as an instruction manual: hard-wrapped source lines
 * (for readable diffs), blank lines between blocks, and each block optionally opening
 * with a "## Section title" line. Rendering that verbatim in a <pre> double-wraps against
 * the panel's actual width, so instead reflow every block to the panel's real width and
 * give each construct real markup:
 *
 *   "## Title"  section heading (may stand alone or head the block below it)
 *   "1. step"   numbered procedure, with optional "a. " sub-steps nested under a step
 *   "- item"    bullet list (equipment, interlocks, acceptance criteria)
 *   anything else  a paragraph
 *
 * Continuation lines of a list item are indented and simply fold into the item above.
 */
function parseBriefingBlocks(text: string): BriefingBlock[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): BriefingBlock => {
      const lines = block.split('\n');
      const head = HEADING_MARKER.exec(lines[0]);
      const heading = head ? head[1].trim() : undefined;
      const rest = head ? lines.slice(1) : lines;
      return { heading, body: parseBriefingBody(rest) };
    });
}

function parseBriefingBody(lines: string[]): BriefingBody | undefined {
  if (lines.length === 0) return undefined;
  if (TOP_MARKER.test(lines[0])) {
    const items: BriefingListItem[] = [];
    for (const line of lines) {
      const top = TOP_MARKER.exec(line);
      const sub = top ? null : SUB_MARKER.exec(line);
      if (top) {
        items.push({ text: top[1], sub: [] });
      } else if (sub && items.length > 0) {
        items[items.length - 1].sub.push(sub[1]);
      } else if (items.length > 0) {
        const last = items[items.length - 1];
        const target = last.sub.length > 0 ? last.sub : null;
        const text = line.trim();
        if (target) target[target.length - 1] += ' ' + text;
        else last.text += ' ' + text;
      }
    }
    return { type: 'ol', items };
  }
  if (BULLET_MARKER.test(lines[0])) {
    const items: string[] = [];
    for (const line of lines) {
      const bullet = BULLET_MARKER.exec(line);
      if (bullet) items.push(bullet[1]);
      else if (items.length > 0) items[items.length - 1] += ' ' + line.trim();
    }
    return { type: 'ul', items };
  }
  return { type: 'p', text: lines.join(' ').replace(/\s+/g, ' ').trim() };
}

function Briefing({ text }: { text: string }) {
  const blocks = parseBriefingBlocks(text);
  return (
    <div className="briefing">
      {blocks.map((block, i) => (
        <section key={i}>
          {block.heading && <h4 className="briefing-head">{block.heading}</h4>}
          {block.body && <BriefingBodyView body={block.body} />}
        </section>
      ))}
    </div>
  );
}

function BriefingBodyView({ body }: { body: BriefingBody }) {
  if (body.type === 'p') return <p>{body.text}</p>;
  if (body.type === 'ul')
    return (
      <ul>
        {body.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  return (
    <ol>
      {body.items.map((item, i) => (
        <li key={i}>
          {item.text}
          {item.sub.length > 0 && (
            <ol type="a">
              {item.sub.map((s, j) => (
                <li key={j}>{s}</li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
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
  // A working D register is scratch space the player chose the meaning of, so
  // there is no range to scale it by — show the raw word, which is exactly what
  // the program is reading.
  const word = kind === 'D' && runner ? (runner.registers?.[r.address] ?? 0) : undefined;
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
        {word !== undefined && (
          <span className={`word-value${word !== 0 ? ' on' : ''}`}>{word}</span>
        )}
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

/**
 * A wired analog point's live word.
 *
 * Raw counts lead, because counts are what the program is actually handed and
 * what every rung in the solution is written against; the engineering value
 * follows in smaller type as the human's reading of the same number.
 */
function WordValue({ value, device }: { value: number; device: PuzzleDevice }) {
  const range = device.range;
  const eng = range ? scaleCounts(value, range) : undefined;
  return (
    <span className="word-value on" title={device.label}>
      {value}
      {eng !== undefined && range && (
        <span className="word-eng">
          {eng.toFixed(range.decimals ?? 1)} {range.units}
        </span>
      )}
    </span>
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

/** Simulated ms as a short "12.4 s" for the throughput readout. */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
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
    // A fresh, unsubmitted puzzle gets no card at all — an empty "Grading" panel
    // reads as if something was graded. Returning to an already-solved puzzle is
    // the one exception: it still offers the next one.
    return <NextPuzzleNav slug={slug} onlyIfSolved />;
  }

  // Warnings never block grading, so they ride alongside whichever card shows.
  const warnings = result.validation.warnings ?? [];
  const warningList = warnings.length > 0 && (
    <div className="validation-warnings">
      <span className="eyebrow">Warnings</span>
      <ul className="warn-list">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );

  if (!result.validation.valid) {
    return (
      <div className="results-card panel invalid">
        <span className="eyebrow">Validation failed</span>
        <ul className="fail-list">
          {result.validation.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        {warningList}
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
      {warningList}
      {grade.solved && (
        <>
          <p className="solved-banner">✔ Solved — all scenarios pass</p>
          {/* Correctness is the pass; the rest of the score is cycle time, so a
              working but leisurely program has to be told why it is short of
              100 and not left guessing at a hidden check. */}
          {grade.efficiency !== undefined && grade.efficiency < 1 && (
            <p className="throughput-note">
              Behaviour is worth {CORRECTNESS_WEIGHT} points and you have all of them. The last{' '}
              {100 - CORRECTNESS_WEIGHT} are cycle time: this program runs the machine correctly
              but slower than the line target below.
            </p>
          )}
          <NextPuzzleNav slug={slug} />
        </>
      )}
      <ul className="scenario-list">
        {grade.scenarios.map((s, i) => (
          <li key={i} className={s.passed ? 'pass' : 'fail'}>
            <span className="scenario-mark">{s.passed ? '✔' : '✕'}</span>
            <div>
              <span className="scenario-name">{s.name}</span>
              {s.passed && s.parMs !== undefined && (
                <p className={`scenario-timing${s.elapsedMs <= s.parMs ? ' ok' : ''}`}>
                  Cycle {secs(s.elapsedMs)} · target {secs(s.parMs)}
                  {s.elapsedMs > s.parMs && ` · ${secs(s.elapsedMs - s.parMs)} of slack to trim`}
                </p>
              )}
              {!s.passed && (
                <>
                  {/* Every check, not just the broken ones: a run that gets
                      nine steps in and trips on the tenth reads as "everything
                      worked" unless the nine are on screen too. */}
                  <p className="scenario-progress">
                    {s.steps.filter((st) => st.passed).length} of {s.steps.length} checks passed
                  </p>
                  <ol className="step-checks">
                    {s.steps.map((st, j) => (
                      <li key={j} className={st.passed ? 'pass' : 'fail'}>
                        <span className="step-check-mark">{st.passed ? '✔' : '✕'}</span>
                        <div>
                          <span className="step-check-label">{st.label}</span>
                          {st.failures.length > 0 && (
                            <ul className="step-fail-reasons">
                              {st.failures.map((f, k) => (
                                <li key={k}>{f}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {onReplay && (
                    <button className="btn btn-ghost sm" onClick={() => onReplay(s.name)}>
                      ▶ Replay this run
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
