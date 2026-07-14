import { Link } from 'react-router-dom';
import { CATEGORY_ORDER, CATEGORY_TITLES } from '@automationsolver/shared';
import { usePuzzles } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import type { PuzzleListItem } from '../api/client';

export function PuzzleListPage() {
  const { data, isLoading, isError } = usePuzzles();
  const { user } = useAuth();

  return (
    <div className="list-page">
      <header className="list-head">
        <div>
          <span className="eyebrow">Work Orders</span>
          <h1>Choose a circuit to commission</h1>
        </div>
        {!user && <p className="list-note">Sign in to save your solutions and track progress.</p>}
      </header>

      {isLoading && <p className="muted">Loading puzzles…</p>}
      {isError && <p className="auth-error">Could not load puzzles. Is the server running?</p>}

      {CATEGORY_ORDER.map((cat) => {
        const puzzles = data?.puzzles.filter((p) => p.category === cat) ?? [];
        if (puzzles.length === 0) return null;
        const solved = puzzles.filter((p) => p.status === 'solved').length;
        return (
          <section key={cat} className="puzzle-category">
            <div className="category-head">
              <h2 className="eyebrow">{CATEGORY_TITLES[cat]}</h2>
              <span className="category-count">
                {solved}/{puzzles.length} solved
              </span>
            </div>
            <div className="puzzle-grid">
              {puzzles.map((p) => (
                <PuzzleCard key={p.slug} puzzle={p} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
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
