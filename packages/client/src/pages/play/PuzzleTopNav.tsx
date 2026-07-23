import { Link } from 'react-router-dom';
import { CATEGORY_TITLES, type PuzzleSpec } from '@automationsolver/shared';
import { usePuzzles } from '../../api/queries';

/**
 * Persistent nav row above the play toolbar: back to this puzzle's category
 * (so the list filter survives the round trip) and on to the next puzzle in
 * that category, if it's unlocked. Kept out of the scrollable brief column so
 * it's reachable without scrolling past a long briefing.
 */
export function PuzzleTopNav({ spec }: { spec: PuzzleSpec }) {
  const { data } = usePuzzles();
  const inCategory = (data?.puzzles ?? []).filter((p) => p.category === spec.category);
  const i = inCategory.findIndex((p) => p.slug === spec.slug);
  const next = i >= 0 ? inCategory[i + 1] : undefined;

  return (
    <nav className="play-nav" aria-label="Puzzle navigation">
      <Link to={`/puzzles/category/${spec.category}`} className="play-nav-back">
        ← {CATEGORY_TITLES[spec.category]}
      </Link>
      {next && !next.locked && (
        <Link to={`/puzzles/${next.slug}`} className="play-nav-next">
          Next: {next.title} →
        </Link>
      )}
    </nav>
  );
}
