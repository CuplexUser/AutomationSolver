import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { TRACK_ORDER, TRACK_TITLES } from '@automationsolver/shared';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

/**
 * The list pages are the only ones the track nav belongs on.
 *
 * A play screen already has its own nav down the side and no room to spare —
 * the plant workspace least of all, where the 3D floor is the page. So the top
 * bar carries the site menu where it is a menu and stays out of the way where
 * the player is working.
 */
function isListRoute(pathname: string): boolean {
  return (
    pathname === '/puzzles' ||
    pathname.startsWith('/puzzles/track/') ||
    pathname.startsWith('/puzzles/category/')
  );
}

export function TopBar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showTracks = isListRoute(pathname);

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden>
          ⏚
        </span>
        <span className="brand-text">
          AUTOMATION<span className="brand-accent">SOLVER</span>
        </span>
      </Link>

      {/* The tracks live in the middle of the bar, in the space the brand and
          the account links were leaving empty. Twelve categories used to sit in
          a pill row on the page and wrap onto two lines; five tracks fit here. */}
      {showTracks && (
        <nav className="track-nav" aria-label="Puzzle tracks">
          <NavLink to="/puzzles" end className="track-link">
            All
          </NavLink>
          {TRACK_ORDER.map((track) => (
            <NavLink key={track} to={`/puzzles/track/${track}`} className="track-link">
              {TRACK_TITLES[track]}
            </NavLink>
          ))}
        </nav>
      )}

      <nav className="topnav">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          {theme === 'light' ? '☾' : '☀'}
        </button>
        {/* Redundant with the track nav's own All, and the point of that nav is
            to spend the bar's space on fewer things, not more. */}
        {!showTracks && <Link to="/puzzles">Puzzles</Link>}
        {user ? (
          <>
            <Link to="/settings">Settings</Link>
            <span className="topnav-user">{user.displayName}</span>
            <button
              className="btn btn-ghost sm"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary sm">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
