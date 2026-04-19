import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { authApi } from '../api/auth.api';
import { queryClient } from '../App';
import { useSettings } from './SettingsContext';
import type { User, LoginRequest } from '@ofauria/shared';

// Inactivity timeout configuration (in minutes)
const INACTIVITY_TIMEOUT = 15; // Auto-logout after 15 minutes of inactivity
const WARNING_BEFORE = 2; // Show warning 2 minutes before auto-logout

interface AuthContextType {
  user: User | null;
  login: (data: LoginRequest) => Promise<void>;
  loginWithPin: (pinCode: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  timeoutWarning: boolean;
  extendSession: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { refreshSettings } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeoutWarning, setTimeoutWarning] = useState(false);

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
  }, []);

  const performLogout = useCallback(() => {
    clearTimers();
    setTimeoutWarning(false);
    localStorage.removeItem('ofauria_token');
    localStorage.removeItem('ofauria_user');
    setUser(null);
    queryClient.clear();
  }, [clearTimers]);

  const startTimers = useCallback(() => {
    clearTimers();
    lastActivityRef.current = Date.now();
    setTimeoutWarning(false);

    const warningDelay = (INACTIVITY_TIMEOUT - WARNING_BEFORE) * 60 * 1000;
    const logoutDelay = INACTIVITY_TIMEOUT * 60 * 1000;

    warningTimerRef.current = setTimeout(() => {
      setTimeoutWarning(true);
    }, warningDelay);

    logoutTimerRef.current = setTimeout(() => {
      performLogout();
    }, logoutDelay);
  }, [clearTimers, performLogout]);

  const resetActivity = useCallback(() => {
    if (!user) return;
    // Only reset if warning is not showing (avoid accidental extend)
    if (!timeoutWarning) {
      startTimers();
    }
  }, [user, timeoutWarning, startTimers]);

  const extendSession = useCallback(() => {
    setTimeoutWarning(false);
    startTimers();
  }, [startTimers]);

  // Track user activity events
  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const handleActivity = () => {
      // Throttle: only reset if at least 30 seconds since last reset
      if (Date.now() - lastActivityRef.current > 30000) {
        resetActivity();
      }
    };

    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    startTimers();

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity));
      clearTimers();
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const token = localStorage.getItem('ofauria_token');
    if (token) {
      authApi.me()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem('ofauria_token');
          localStorage.removeItem('ofauria_user');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (data: LoginRequest) => {
    const result = await authApi.login(data);
    localStorage.setItem('ofauria_token', result.token);
    localStorage.setItem('ofauria_user', JSON.stringify(result.user));
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
  };

  const loginWithPin = async (pinCode: string) => {
    const result = await authApi.pinLogin(pinCode);
    localStorage.setItem('ofauria_token', result.token);
    localStorage.setItem('ofauria_user', JSON.stringify(result.user));
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
  };

  const logout = () => {
    performLogout();
  };

  return (
    <AuthContext.Provider value={{ user, login, loginWithPin, logout, isLoading, timeoutWarning, extendSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
