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
            setConfirmPassword('');
          }}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
