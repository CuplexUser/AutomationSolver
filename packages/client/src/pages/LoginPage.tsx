import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState({ google: false, github: false });

  useEffect(() => {
    authApi.providers().then(setProviders).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) navigate('/puzzles');
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName || undefined);
      navigate('/puzzles');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card panel">
        <span className="eyebrow">{mode === 'login' ? 'Sign in' : 'Create account'}</span>
        <h2>{mode === 'login' ? 'Back to the bench' : 'Join the bench'}</h2>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label className="auth-field">
              <span>Display name</span>
              <input
                className="field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
                autoComplete="nickname"
              />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input
              className="field"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              className="field"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button className="btn btn-primary full" type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {(providers.google || providers.github) && (
          <>
            <div className="auth-divider">
              <span>or continue with</span>
            </div>
            <div className="oauth-row">
              {providers.google && (
                <a className="btn btn-ghost full" href="/api/auth/google">
                  Google
                </a>
              )}
              {providers.github && (
                <a className="btn btn-ghost full" href="/api/auth/github">
                  GitHub
                </a>
              )}
            </div>
          </>
        )}

        <button
          className="link-btn"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
