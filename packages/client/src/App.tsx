import { Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
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
