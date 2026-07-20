import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/client';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authApi.forgotPassword(email);
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card panel">
        <span className="eyebrow">Reset password</span>
        <h2>Forgot your password?</h2>

        {sent ? (
          <p className="auth-success">
            If an account exists for that email, we&apos;ve sent a reset link. Check your inbox.
          </p>
        ) : (
          <form onSubmit={submit} className="auth-form">
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
            <button className="btn btn-primary full" type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Send reset link'}
            </button>
          </form>
        )}

        <Link className="link-btn" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
