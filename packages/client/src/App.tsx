import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { TopBar } from './components/TopBar';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { PuzzleListPage } from './pages/PuzzleListPage';
import { PuzzlePlayPage } from './pages/PuzzlePlayPage';
import { SettingsPage } from './pages/SettingsPage';

/**
 * A dev door onto a scene that has no puzzle pointing at it yet.
 *
 * Both halves of this matter. `lazy` keeps three.js out of the entry chunk — a
 * static import of a page that mounts `MachineCanvas` pulls the whole renderer
 * into `index.js` and undoes every other scene's code splitting. And putting
 * `import.meta.env.DEV` in front of the `import()` rather than only in front of
 * the `<Route>` is what stops the chunk being emitted at all in production:
 * the flag folds to `false` and the dynamic import goes with it.
 */
const LinePreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/LinePreviewPage').then((m) => ({ default: m.LinePreviewPage })))
  : null;

export function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/puzzles" element={<PuzzleListPage />} />
          {/* Both sit before `/puzzles/:slug`; React Router ranks by specificity
              rather than by order, so the two-segment paths are never read as a
              slug either way, but keeping them together reads better. */}
          <Route path="/puzzles/track/:track" element={<PuzzleListPage />} />
          <Route path="/puzzles/category/:category" element={<PuzzleListPage />} />
          <Route path="/puzzles/:slug" element={<PuzzlePlayPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {LinePreviewPage && (
            <Route
              path="/dev/line"
              element={
                <Suspense fallback={null}>
                  <LinePreviewPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </div>
    </div>
  );
}
