import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSaveSettings, useSettings } from '../api/queries';
import { useAuth } from '../auth/AuthContext';

export function SettingsPage() {
  const { user } = useAuth();
  const { data } = useSettings();
  const save = useSaveSettings();
  const [displayNameHint] = useState(user?.displayName ?? '');
  const [confirmSubmit, setConfirmSubmit] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      setConfirmSubmit(data.settings.confirmSubmit !== false);
    }
  }, [data]);

  if (!user) {
    return (
      <div className="pad">
        <p className="muted">
          <Link to="/login" className="inline-link">
            Sign in
          </Link>{' '}
          to manage your settings.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <span className="eyebrow">Preferences</span>
      <h1>Settings</h1>
      <div className="settings-card panel">
        <div className="setting-row">
          <div>
            <strong>Signed in as</strong>
            <p className="muted sm">
              {displayNameHint} · {user.email ?? 'OAuth account'}
            </p>
          </div>
        </div>
        <label className="setting-row toggle-row">
          <div>
            <strong>Confirm before submitting</strong>
            <p className="muted sm">Ask for confirmation before grading a solution.</p>
          </div>
          <input
            type="checkbox"
            checked={confirmSubmit}
            onChange={(e) => setConfirmSubmit(e.target.checked)}
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { confirmSubmit },
              { onSuccess: () => setSaved(true) },
            )
          }
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="saved-tick">Saved ✓</span>}
      </div>
    </div>
  );
}
