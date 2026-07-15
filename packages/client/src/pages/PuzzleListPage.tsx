import { Link, useParams } from 'react-router-dom';
import {
  CATEGORY_ORDER,
  CATEGORY_TITLES,
  CATEGORY_BLURBS,
  type PuzzleCategory,
} from '@automationsolver/shared';
import { usePuzzles } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import type { PuzzleListItem } from '../api/client';

function isCategory(value: string | undefined): value is PuzzleCategory {
  return value != null && (CATEGORY_ORDER as readonly string[]).includes(value);
}

export function PuzzleListPage() {
  const { data, isLoading, isError } = usePuzzles();
  const { user } = useAuth();
  const { category } = useParams();
  const active: PuzzleCategory | 'all' = isCategory(category) ? category : 'all';

  const puzzles = data?.puzzles ?? [];
  const byCat = (cat: PuzzleCategory) => puzzles.filter((p) => p.category === cat);
  const shownCats = active === 'all' ? CATEGORY_ORDER : [active];

  return (
    <div className="list-page">
      <header className="list-head">
        <div>
          <span className="eyebrow">Work Orders</span>
          <h1>Choose a circuit to commission</h1>
        </div>
        {!user && <p className="list-note">Sign in to save your solutions and track progress.</p>}
      </header>

      {/* Category navigation — jump to a single track or view them all. */}
      <nav className="cat-nav" aria-label="Puzzle categories">
        <CatPill to="/puzzles" label="All" count={puzzles.length} active={active === 'all'} />
        {CATEGORY_ORDER.map((cat) => {
          const list = byCat(cat);
          if (list.length === 0) return null;
          const solved = list.filter((p) => p.status === 'solved').length;
          return (
            <CatPill
              key={cat}
              to={`/puzzles/category/${cat}`}
              label={CATEGORY_TITLES[cat]}
              count={list.length}
              solved={solved}
              active={active === cat}
            />
          );
        })}
      </nav>

      {isLoading && <p className="muted">Loading puzzles…</p>}
      {isError && <p className="auth-error">Could not load puzzles. Is the server running?</p>}

      {shownCats.map((cat) => {
        const list = byCat(cat);
        if (list.length === 0) return null;
        const solved = list.filter((p) => p.status === 'solved').length;
        return (
          <section key={cat} id={cat} className="puzzle-category">
            <div className="category-head">
              <div className="category-head-titles">
                <h2 className="eyebrow">{CATEGORY_TITLES[cat]}</h2>
                <p className="category-blurb">{CATEGORY_BLURBS[cat]}</p>
              </div>
              <span className="category-count">
                {solved}/{list.length} solved
              </span>
            </div>
            <div className="puzzle-grid">
              {list.map((p) => (
                <PuzzleCard key={p.slug} puzzle={p} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CatPill({
  to,
  label,
  count,
  solved,
  active,
}: {
  to: string;
  label: string;
  count: number;
  solved?: number;
  active: boolean;
}) {
  const complete = solved != null && solved === count && count > 0;
  return (
    <Link to={to} className={`cat-pill${active ? ' active' : ''}${complete ? ' complete' : ''}`}>
      <span className="cat-pill-label">{label}</span>
      <span className="cat-pill-count">{solved != null ? `${solved}/${count}` : count}</span>
    </Link>
  );
}

function PuzzleCard({ puzzle }: { puzzle: PuzzleListItem }) {
  const solved = puzzle.status === 'solved';
  const inProgress = puzzle.status === 'in_progress';
  const accent = solved ? 'solved' : puzzle.locked ? 'locked' : 'open';

  const body = (
    <>
      <div className="pc-top">
        <span className="pc-num">#{String(puzzle.order).padStart(2, '0')}</span>
        {puzzle.locked ? (
          <span className="status-lamp locked" title="Locked">
            🔒
          </span>
        ) : (
          <span
            className={`status-lamp${solved ? ' solved' : inProgress ? ' progress' : ''}`}
            title={puzzle.status}
          />
        )}
      </div>
      <h3 className="pc-title">{puzzle.title}</h3>
      <p className="pc-summary">{puzzle.locked ? 'Locked' : puzzle.summary}</p>
      <div className="pc-foot">
        <span className={`tag tag-${puzzle.difficulty}`}>{puzzle.difficulty}</span>
        {solved && <span className="pc-solved">SOLVED · {puzzle.bestScore}%</span>}
        {!solved && inProgress && !puzzle.locked && <span className="pc-progress">IN PROGRESS</span>}
      </div>
    </>
  );

  if (puzzle.locked) {
    return (
      <div
        className={`puzzle-card panel locked accent-${accent}`}
        title={puzzle.requiresTitle ? `Solve "${puzzle.requiresTitle}" first` : 'Locked'}
        aria-disabled="true"
      >
        {body}
      </div>
    );
  }

  return (
    <Link to={`/puzzles/${puzzle.slug}`} className={`puzzle-card panel accent-${accent}`}>
      {body}
    </Link>
  );
}
