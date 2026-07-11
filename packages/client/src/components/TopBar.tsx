import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
      <nav className="topnav">
        <Link to="/puzzles">Puzzles</Link>
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
