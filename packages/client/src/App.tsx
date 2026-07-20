import { Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { PuzzleListPage } from './pages/PuzzleListPage';
import { PuzzlePlayPage } from './pages/PuzzlePlayPage';
import { SettingsPage } from './pages/SettingsPage';

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
          <Route path="/puzzles/category/:category" element={<PuzzleListPage />} />
          <Route path="/puzzles/:slug" element={<PuzzlePlayPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </div>
    </div>
  );
}
