import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, AUTH_EVENT, getToken, setToken } from './api';
import type { AuthUser } from './types';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const me = await api.me();
        if (alive) setUser(me);
      } catch {
        if (alive) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (alive) setReady(true);
      }
    };

    load();
    const onUnauthorized = () => setUser(null);
    window.addEventListener(AUTH_EVENT, onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener(AUTH_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(async (loginValue: string, password: string) => {
    const result = await api.login(loginValue, password);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
