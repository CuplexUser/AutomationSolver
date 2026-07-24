import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);
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
    setNotice(null);
    setUnverifiedEmail(null);
    setResendSent(false);
    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        navigate('/puzzles');
      } else {
        const { message } = await register(email, password, displayName || undefined);
        setNotice(message);
        setMode('login');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.body.code === 'EMAIL_NOT_VERIFIED') setUnverifiedEmail(email);
      } else {
        setError('Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!unverifiedEmail) return;
    setBusy(true);
    try {
      await authApi.resendVerification(unverifiedEmail);
      setResendSent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card panel">
        <span className="eyebrow">{mode === 'login' ? 'Sign in' : 'Create account'}</span>
        <h2>{mode === 'login' ? 'Back to the bench' : 'Join the bench'}</h2>

        {notice && <p className="auth-success">{notice}</p>}

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
          {mode === 'register' && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                className="field"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          )}

          {error && <p className="auth-error">{error}</p>}
          {unverifiedEmail && resendSent && (
            <p className="auth-success">Verification email sent — check your inbox.</p>
          )}
          {unverifiedEmail && !resendSent && (
            <button type="button" className="link-btn" onClick={resendVerification} disabled={busy}>
              Resend verification email
            </button>
          )}

          {mode === 'login' && error && (
            <Link className="link-btn" to="/forgot-password">
              Forgot password?
            </Link>
          )}

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
                <a className="btn btn-ghost full oauth-btn" href="/api/auth/google">
                  <GoogleIcon />
                  Google
                </a>
              )}
              {providers.github && (
                <a className="btn btn-ghost full oauth-btn" href="/api/auth/github">
                  <GitHubIcon />
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
            setConfirmPassword('');
          }}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="oauth-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.7c-.18-.54-.28-1.11-.28-1.7s.1-1.16.28-1.7V4.96H.96A8.996 8.996 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="oauth-icon" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}
