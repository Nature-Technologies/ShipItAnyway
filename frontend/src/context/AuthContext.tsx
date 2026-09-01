import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

const TOKEN_KEY = 'wt_token';
const EMAIL_KEY = 'wt_email';

interface AuthContextType {
  token: string | null;
  email: string | null;
  canCreateProject: boolean;
  isSuperadmin: boolean;
  canManageTeams: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState<string | null>(() => localStorage.getItem(EMAIL_KEY));
  const [canCreateProject, setCanCreateProject] = useState(false);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [canManageTeams, setCanManageTeams] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const requestId = api.interceptors.request.use((config) => {
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    const responseId = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error?.response?.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EMAIL_KEY);
          setToken(null);
          setEmail(null);
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.request.eject(requestId);
      api.interceptors.response.eject(responseId);
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      if (!token) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const { data } = await api.get<{ userId: string; email: string; canCreateProject: boolean; isSuperadmin: boolean; canManageTeams: boolean }>('/auth/me');
        if (!cancelled && data.email && data.email !== email) {
          localStorage.setItem(EMAIL_KEY, data.email);
          setEmail(data.email);
        }
        if (!cancelled) {
          setCanCreateProject(Boolean(data.canCreateProject));
          setIsSuperadmin(Boolean(data.isSuperadmin));
          setCanManageTeams(Boolean(data.canManageTeams));
        }
      } catch (err) {
        // Only a real auth failure (401) invalidates the session. Transient errors
        // — rate limits (429), 5xx, network blips — must NOT wipe the token, or a
        // request burst (e.g. duplicating a signed-in tab) logs the user out of every
        // tab via shared localStorage and blocks re-login while the window is open.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EMAIL_KEY);
          if (!cancelled) {
            setToken(null);
            setEmail(null);
            setCanCreateProject(false);
            setIsSuperadmin(false);
            setCanManageTeams(false);
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void validateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (nextEmail: string, password: string) => {
    const { data } = await api.post<{ token: string; email: string; canCreateProject: boolean; isSuperadmin: boolean; canManageTeams: boolean }>('/auth/login', {
      email: nextEmail,
      password
    });

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EMAIL_KEY, data.email);
    setToken(data.token);
    setEmail(data.email);
    setCanCreateProject(Boolean(data.canCreateProject));
    setIsSuperadmin(Boolean(data.isSuperadmin));
    setCanManageTeams(Boolean(data.canManageTeams));
    setReady(true);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken(null);
    setEmail(null);
    setCanCreateProject(false);
    setIsSuperadmin(false);
    setCanManageTeams(false);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post('/auth/change-password', { currentPassword, newPassword });
  };

  const value = useMemo<AuthContextType>(() => ({
    token,
    email,
    canCreateProject,
    isSuperadmin,
    canManageTeams,
    ready,
    login,
    logout,
    changePassword
  }), [token, email, canCreateProject, isSuperadmin, canManageTeams, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
