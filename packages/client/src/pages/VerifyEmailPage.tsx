import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const attemptedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (attemptedTokenRef.current === token) return;
    attemptedTokenRef.current = token;
    // No cancelled-on-cleanup guard here: attemptedTokenRef already ensures this
    // fires at most once per token, including across StrictMode's dev-only
    // double-invoke of this effect. A cancelled flag would instead do the
    // opposite of what it's for — the ref blocks the second (StrictMode) call
    // from ever firing, so its cleanup marking the first call "cancelled" would
    // permanently discard the one real response for this single-use token.
    authApi
      .verifyEmail(token)
      .then(async () => {
        await refresh();
        setStatus('success');
        navigate('/puzzles');
      })
      .catch((err) => {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : 'Something went wrong');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per token; navigate/refresh identity churn must not re-trigger a (single-use) verify call
  }, [token]);

  const missingToken = !token;

  return (
    <div className="auth-wrap">
      <div className="auth-card panel">
        <span className="eyebrow">Verify email</span>
        <h2>Confirming your account</h2>

        {missingToken && <p className="auth-error">This link is missing its token.</p>}
        {!missingToken && status === 'pending' && <p>Verifying…</p>}
        {!missingToken && status === 'success' && <p className="auth-success">Email verified — signing you in…</p>}
        {!missingToken && status === 'error' && <p className="auth-error">{error}</p>}

        <Link className="link-btn" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
