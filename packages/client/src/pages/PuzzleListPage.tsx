import { Link } from 'react-router-dom';
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

      <div className="puzzle-grid">
        {data?.puzzles.map((p) => (
          <PuzzleCard key={p.slug} puzzle={p} />
        ))}
      </div>
    </div>
  );
}

function PuzzleCard({ puzzle }: { puzzle: PuzzleListItem }) {
  const solved = puzzle.status === 'solved';
  const inProgress = puzzle.status === 'in_progress';
  return (
    <Link to={`/puzzles/${puzzle.slug}`} className="puzzle-card panel">
      <div className="pc-top">
        <span className="pc-num">#{String(puzzle.order).padStart(2, '0')}</span>
        <span
          className={`status-lamp${solved ? ' solved' : inProgress ? ' progress' : ''}`}
          title={puzzle.status}
        />
      </div>
      <h3 className="pc-title">{puzzle.title}</h3>
      <p className="pc-summary">{puzzle.summary}</p>
      <div className="pc-foot">
        <span className={`tag tag-${puzzle.difficulty}`}>{puzzle.difficulty}</span>
        {solved && <span className="pc-solved">SOLVED · {puzzle.bestScore}%</span>}
        {inProgress && <span className="pc-progress">IN PROGRESS</span>}
      </div>
    </Link>
  );
}
