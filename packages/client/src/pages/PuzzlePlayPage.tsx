import { lazy, Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { usePuzzle, useSubmit } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { LadderPlay } from './play/LadderPlay';

// Lazy so the cabinet editor/sim ships in its own chunk, fetched only when a
// cabinet puzzle is opened (same pattern as the 3D scenes in MachineView).
const CabinetPlay = lazy(() =>
  import('../features/cabinet/CabinetPlay').then((m) => ({ default: m.CabinetPlay })),
);

export function PuzzlePlayPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, isError, error } = usePuzzle(slug);
  const { user } = useAuth();
  const submit = useSubmit(slug);

  // The mutation instance is created once per PuzzlePlayPage mount and survives
  // client-side navigation to a different puzzle slug (e.g. via the "Next" link),
  // so its stale `data` (and solved banner) would otherwise bleed into a fresh,
  // unsubmitted puzzle. Clear it whenever the slug changes.
  const { reset } = submit;
  useEffect(() => {
    reset();
  }, [slug, reset]);

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
  if (spec.kind === 'cabinet') {
    return (
      <Suspense fallback={<p className="muted pad">Loading cabinet…</p>}>
        <CabinetPlay key={spec.slug} spec={spec} user={user} submit={submit} previousPuzzle={data.previousPuzzle} />
      </Suspense>
    );
  }
  return (
    <LadderPlay key={spec.slug} spec={spec} user={user} submit={submit} previousPuzzle={data.previousPuzzle} />
  );
}
