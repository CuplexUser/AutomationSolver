import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';

// Explicit user choice; absent = follow the OS preference.
const STORAGE_KEY = 'as-theme';

function getStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function subscribeSystemTheme(onChange: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: light)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Theme | null>(getStoredTheme);
  const system = useSyncExternalStore(subscribeSystemTheme, getSystemTheme);
  const theme = stored ?? system;

  // Sync the resolved theme to the document (index.html sets it pre-paint;
  // this keeps it current across toggles and OS preference changes).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#dde3ea' : '#0f141b');
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = (getStoredTheme() ?? getSystemTheme()) === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, next);
    setStored(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
