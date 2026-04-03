import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi } from '../api/auth.api';
import type { User, LoginRequest } from '@ofauria/shared';

interface AuthContextType {
  user: User | null;
  login: (data: LoginRequest) => Promise<void>;
  loginWithPin: (pinCode: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  };

  const loginWithPin = async (pinCode: string) => {
    const result = await authApi.pinLogin(pinCode);
    localStorage.setItem('ofauria_token', result.token);
    localStorage.setItem('ofauria_user', JSON.stringify(result.user));
    setUser(result.user as User);
  };

  const logout = () => {
    localStorage.removeItem('ofauria_token');
    localStorage.removeItem('ofauria_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, loginWithPin, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
