import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { authApi } from '../api/auth.api';
import { queryClient } from '../App';
import { useSettings } from './SettingsContext';
import { probeSession } from './sessionProbe';
import type { User, LoginRequest } from '@ofauria/shared';

// Inactivity timeout configuration (in minutes)
const INACTIVITY_TIMEOUT = 15; // Auto-logout after 15 minutes of inactivity
const WARNING_BEFORE = 2; // Show warning 2 minutes before auto-logout

interface AuthContextType {
  user: User | null;
  /** G6-01 : rend { mfaToken } quand un second facteur est exigé. */
  login: (data: LoginRequest) => Promise<{ mfaToken?: string; trustedDeviceDays?: number; methods?: { totp: boolean; passkey: boolean } }>;
  /** Passkey (mig 705) : sans mfaToken = connexion sans mot de passe, avec = second facteur. */
  loginWithPasskey: (mfaToken?: string, rememberDevice?: boolean) => Promise<void>;
  /** rememberDevice : poste de confiance, code non redemandé pendant N jours (mig 702). */
  verifyMfa: (mfaToken: string, code: string, rememberDevice?: boolean) => Promise<void>;
  mfaConfigured: () => void;
  loginWithPin: (userId: string, pinCode: string) => Promise<void>;
  /** G0-06 : le mot de passe vient d'être changé, l'obligation est levée. */
  passwordChanged: (token?: string) => void;
  logout: () => void;
  isLoading: boolean;
  timeoutWarning: boolean;
  extendSession: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Build mobile (Capacitor) : le WebView est sur https://localhost et l'API sur
// un autre domaine (Cloud Run). Le cookie d'auth SameSite=Strict est rejete
// par Chrome dans ce cas cross-site. On stocke alors le token en localStorage
// et on s'appuie sur le fallback Bearer de client.ts. Sur web (proxy Vite),
// VITE_API_URL est absent -> cookie HttpOnly comme avant.
const IS_MOBILE_BUILD = !!import.meta.env.VITE_API_URL;

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
    // OWASP A02-5 : plus de token en localStorage. Cookie HttpOnly efface
    // cote serveur via /auth/logout. On garde seulement les donnees user
    // hydratees en memoire — clear silencieux des residus legacy.
    localStorage.removeItem('ofauria_token');
    localStorage.removeItem('ofauria_user');
    // Fire-and-forget : on appelle /auth/logout pour revoquer + clear cookie.
    // Si echec reseau, le cookie expirera naturellement.
    authApi.logout?.().catch(() => undefined);
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
    // OWASP A02-5 : on ne peut plus lire le token JS (HttpOnly), on tente
    // directement /auth/me. Le cookie est envoye automatiquement via
    // withCredentials. Si 401, l'utilisateur n'est pas connecte. Une erreur reseau ou
    // serveur (API en redemarrage, deploiement) est reessayee : elle ne dit rien de la
    // session et renvoyait a tort vers l'ecran de connexion (scenario 1, constat 56).
    let cancelled = false;
    probeSession(() => authApi.me() as Promise<User>)
      .then((me) => {
        if (cancelled) return;
        if (me) { setUser(me); return; }
        // Nettoie les residus legacy potentiels.
        localStorage.removeItem('ofauria_token');
        localStorage.removeItem('ofauria_user');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = async (data: LoginRequest) => {
    // Le backend pose le cookie HttpOnly. On garde le user en memoire,
    // pas de token stocke cote client.
    const result = await authApi.login(data);
    const mfa = result as unknown as { mfaRequired?: boolean; mfaToken?: string; trustedDeviceDays?: number; methods?: { totp: boolean; passkey: boolean } };
    if (mfa.mfaRequired) return { mfaToken: mfa.mfaToken, trustedDeviceDays: mfa.trustedDeviceDays, methods: mfa.methods };
    if (IS_MOBILE_BUILD && result.token) {
      localStorage.setItem('ofauria_token', result.token);
    }
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
    return {};
  };

  const verifyMfa = async (mfaToken: string, code: string, rememberDevice = false) => {
    const result = await authApi.verifyMfa(mfaToken, code, rememberDevice);
    if (IS_MOBILE_BUILD && result.token) localStorage.setItem('ofauria_token', result.token);
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
  };
  const loginWithPasskey = async (mfaToken?: string, rememberDevice = false) => {
    const result = await authApi.loginWithPasskey(mfaToken, rememberDevice);
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
  };
  const mfaConfigured = () => setUser(u => (u ? { ...u, mfaSetupRequired: false } as User : u));

  const loginWithPin = async (userId: string, pinCode: string) => {
    const result = await authApi.pinLogin(userId, pinCode);
    if (IS_MOBILE_BUILD && result.token) {
      localStorage.setItem('ofauria_token', result.token);
    }
    setUser(result.user as User);
    queryClient.clear();
    refreshSettings();
  };

  const logout = () => {
    performLogout();
  };

  const passwordChanged = (token?: string) => {
    if (IS_MOBILE_BUILD && token) localStorage.setItem('ofauria_token', token);
    setUser(u => (u ? { ...u, mustChangePassword: false } : u));
  };

  return (
    <AuthContext.Provider value={{ user, login, verifyMfa, loginWithPasskey, mfaConfigured, loginWithPin, passwordChanged, logout, isLoading, timeoutWarning, extendSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
