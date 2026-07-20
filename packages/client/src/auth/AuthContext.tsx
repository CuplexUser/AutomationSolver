import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authApi, type PublicUser } from '../api/client';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  };

  // Bootstrap the session from the server once on mount — the setState happens after
  // the request resolves, not synchronously during the effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      login: async (email, password) => {
        const { user } = await authApi.login(email, password);
        setUser(user);
      },
      register: (email, password, displayName) => authApi.register(email, password, displayName),
      updateProfile: async (displayName) => {
        const { user } = await authApi.updateProfile(displayName);
        setUser(user);
      },
      logout: async () => {
        await authApi.logout();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
