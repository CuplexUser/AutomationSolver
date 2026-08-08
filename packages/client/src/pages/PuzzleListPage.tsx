import { Link, useParams } from 'react-router';
import {
  CATEGORY_ORDER,
  CATEGORY_TITLES,
  CATEGORY_BLURBS,
  CATEGORY_TRACK,
  TRACK_ORDER,
  TRACK_TITLES,
  TRACK_BLURBS,
  categoriesInTrack,
  type PuzzleCategory,
  type PuzzleTrack,
} from '@automationsolver/shared';
import { usePuzzles } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import type { PuzzleListItem } from '../api/client';

function isCategory(value: string | undefined): value is PuzzleCategory {
  return value != null && (CATEGORY_ORDER as readonly string[]).includes(value);
}

function isTrack(value: string | undefined): value is PuzzleTrack {
  return value != null && (TRACK_ORDER as readonly string[]).includes(value);
}

/**
 * The work-order list, navigated in two levels.
 *
 * Tracks are in the top bar; the pill row here is *within* the current track,
 * so it holds at most five pills and never wraps. Categories are still the unit
 * of progression and still the thing a section header names — the track is
 * navigation only, and on the All view it is a rule across the page rather than
 * anything the player has to choose.
 */
export function PuzzleListPage() {
  const { data, isLoading, isError } = usePuzzles();
  const { user } = useAuth();
  const params = useParams();

  const activeCat: PuzzleCategory | null = isCategory(params.category) ? params.category : null;
  const activeTrack: PuzzleTrack | null = isTrack(params.track)
    ? params.track
    : activeCat
      ? CATEGORY_TRACK[activeCat]
      : null;

  const puzzles = data?.puzzles ?? [];
  const byCat = (cat: PuzzleCategory) => puzzles.filter((p) => p.category === cat);
  const countIn = (cats: readonly PuzzleCategory[]) =>
    cats.reduce((n, c) => n + byCat(c).length, 0);
  const solvedIn = (cats: readonly PuzzleCategory[]) =>
    cats.reduce((n, c) => n + byCat(c).filter((p) => p.status === 'solved').length, 0);

  // Which sections to draw, grouped under the track they belong to.
  const shownTracks: PuzzleTrack[] = activeTrack ? [activeTrack] : [...TRACK_ORDER];
  const catsFor = (track: PuzzleTrack) =>
    activeCat ? [activeCat] : categoriesInTrack(track).filter((c) => byCat(c).length > 0);

  const siblings = activeTrack ? categoriesInTrack(activeTrack).filter((c) => byCat(c).length > 0) : [];

  return (
    <div className="list-page">
      <header className="list-head">
        <div>
          <span className="eyebrow">Work Orders</span>
          <h1>{activeTrack ? TRACK_TITLES[activeTrack] : 'Choose a circuit to commission'}</h1>
          {activeTrack && <p className="list-lede">{TRACK_BLURBS[activeTrack]}</p>}
        </div>
        {!user && <p className="list-note">Sign in to save your solutions and track progress.</p>}
      </header>

      {/* Within-track navigation. On the All view the top bar is the only nav
          needed, so this row is simply absent rather than repeating itself. */}
      {activeTrack && siblings.length > 1 && (
        <nav className="cat-nav" aria-label="Categories in this track">
          <CatPill
            to={`/puzzles/track/${activeTrack}`}
            label="All"
            count={countIn(siblings)}
            solved={solvedIn(siblings)}
            active={activeCat === null}
          />
          {siblings.map((cat) => {
            const list = byCat(cat);
            return (
              <CatPill
                key={cat}
                to={`/puzzles/category/${cat}`}
                label={CATEGORY_TITLES[cat]}
                count={list.length}
                solved={list.filter((p) => p.status === 'solved').length}
                active={activeCat === cat}
              />
            );
          })}
        </nav>
      )}

      {isLoading && <p className="muted">Loading puzzles…</p>}
      {isError && <p className="auth-error">Could not load puzzles. Is the server running?</p>}

      {shownTracks.map((track) => {
        const cats = catsFor(track);
        if (cats.length === 0) return null;
        return (
          <div key={track} className="track-group">
            {/* The rule is only worth drawing where several tracks are on the
                page at once; inside one, its title is already the heading. */}
            {!activeTrack && (
              <div className="track-rule">
                <span className="track-rule-name">{TRACK_TITLES[track]}</span>
                <span className="track-rule-line" aria-hidden />
                <span className="track-rule-count">
                  {solvedIn(cats)}/{countIn(cats)}
                </span>
              </div>
            )}
            {cats.map((cat) => {
              const list = byCat(cat);
              const solved = list.filter((p) => p.status === 'solved').length;
              return (
                <section key={cat} id={cat} className="puzzle-category">
                  <div className="category-head">
                    {/* A track with one category in it has already said all of
                        this in the page heading and its lede. Repeating the
                        name and the blurb two lines apart just reads as a bug. */}
                    {cats.length === 1 && activeTrack ? (
                      <span />
                    ) : (
                      <div className="category-head-titles">
                        <h2 className="eyebrow">{CATEGORY_TITLES[cat]}</h2>
                        <p className="category-blurb">{CATEGORY_BLURBS[cat]}</p>
                      </div>
                    )}
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
