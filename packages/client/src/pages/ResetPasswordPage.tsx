import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      await refresh();
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
        <span className="eyebrow">Reset password</span>
        <h2>Choose a new password</h2>

        {!token ? (
          <p className="auth-error">This link is missing its token. Request a new one below.</p>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <label className="auth-field">
              <span>New password</span>
              <input
                className="field"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="auth-field">
              <span>Confirm new password</span>
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
            {error && <p className="auth-error">{error}</p>}
            <button className="btn btn-primary full" type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Set new password'}
            </button>
          </form>
        )}

        <Link className="link-btn" to="/forgot-password">
          Request a new link
        </Link>
      </div>
    </div>
  );
}
