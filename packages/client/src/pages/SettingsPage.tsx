import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSaveSettings, useSettings } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { ApiError, authApi } from '../api/client';

export function SettingsPage() {
  const { user, updateProfile } = useAuth();
  const { data } = useSettings();
  const save = useSaveSettings();
  const [confirmSubmit, setConfirmSubmit] = useState(true);
  const [devUnlockAll, setDevUnlockAll] = useState(false);
  const [enableImportExport, setEnableImportExport] = useState(false);
  const [saved, setSaved] = useState(false);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Hydrate the form once the saved settings arrive from the server.
  useEffect(() => {
    if (data?.settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirmSubmit(data.settings.confirmSubmit !== false);
      setDevUnlockAll(data.settings.devUnlockAll === true);
      setEnableImportExport(data.settings.enableImportExport === true);
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

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileBusy(true);
    try {
      await updateProfile(displayName.trim());
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword !== confirmNewPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordBusy(true);
    try {
      await authApi.changePassword(newPassword, user.hasPassword ? currentPassword : undefined);
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="settings-page">
      <span className="eyebrow">Preferences</span>
      <h1>Settings</h1>
      <div className="settings-card panel">
        <p className="muted sm">{user.email ?? 'OAuth account'}</p>
        <form onSubmit={saveProfile} className="auth-field">
          <span>Display name</span>
          <input
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={60}
          />
          {profileError && <p className="auth-error">{profileError}</p>}
          <div className="setting-row">
            <button className="btn btn-primary" type="submit" disabled={profileBusy}>
              {profileBusy ? 'Saving…' : 'Save name'}
            </button>
            {profileSaved && <span className="saved-tick">Saved ✓</span>}
          </div>
        </form>
      </div>

      <div className="settings-card panel">
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
        <label className="setting-row toggle-row">
          <div>
            <strong>Enable solution export/import</strong>
            <p className="muted sm">
              Adds buttons to download the current program as JSON, or import one from a file.
            </p>
          </div>
          <input
            type="checkbox"
            checked={enableImportExport}
            onChange={(e) => setEnableImportExport(e.target.checked)}
          />
        </label>
        {import.meta.env.DEV && (
          <label className="setting-row toggle-row">
            <div>
              <strong>Developer mode: unlock all puzzles</strong>
              <p className="muted sm">Bypasses progression gating. Only works in dev — no effect in production.</p>
            </div>
            <input
              type="checkbox"
              checked={devUnlockAll}
              onChange={(e) => setDevUnlockAll(e.target.checked)}
            />
          </label>
        )}
        <button
          className="btn btn-primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { ...data?.settings, confirmSubmit, devUnlockAll, enableImportExport },
              { onSuccess: () => setSaved(true) },
            )
          }
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="saved-tick">Saved ✓</span>}
      </div>

      {user.email && (
        <div className="settings-card panel">
          <strong>{user.hasPassword ? 'Change password' : 'Set a password'}</strong>
          <form onSubmit={changePassword} className="auth-field">
            {user.hasPassword && (
              <>
                <span>Current password</span>
                <input
                  className="field"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </>
            )}
            <span>New password</span>
            <input
              className="field"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <span>Confirm new password</span>
            <input
              className="field"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            {passwordError && <p className="auth-error">{passwordError}</p>}
            <div className="setting-row">
              <button className="btn btn-primary" type="submit" disabled={passwordBusy}>
                {passwordBusy ? 'Saving…' : user.hasPassword ? 'Update password' : 'Set password'}
              </button>
              {passwordSaved && <span className="saved-tick">Saved ✓</span>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
