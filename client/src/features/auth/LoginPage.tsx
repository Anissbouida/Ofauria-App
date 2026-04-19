import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { notify } from '../../components/ui/InlineNotification';
import { Delete, Lock, Mail } from 'lucide-react';

export default function LoginPage() {
  const { user, loginWithPin, login } = useAuth();
  const { settings } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'email' ? 'email' : 'pin';
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Email form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginWithPinRef = useRef(loginWithPin);
  loginWithPinRef.current = loginWithPin;

  const handlePinSubmit = useCallback(async (pinCode: string) => {
    setLoading(true);
    setError('');
    try {
      await loginWithPinRef.current(pinCode);
      // login success — no notification needed
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const serverMsg = axiosErr?.response?.data?.error?.message;
      console.error('PIN login error:', err, 'Server message:', serverMsg);
      setError(serverMsg || axiosErr?.message || 'Code PIN incorrect');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDigit = useCallback((digit: string) => {
    if (loading) return;
    setError('');
    setPin(prev => {
      const next = prev + digit;
      if (next.length >= 4) {
        setTimeout(() => handlePinSubmit(next), 200);
      }
      return next.length <= 6 ? next : prev;
    });
  }, [handlePinSubmit, loading]);

  const handleBackspace = () => { if (!loading) { setPin(prev => prev.slice(0, -1)); setError(''); } };
  const handleClear = () => { if (!loading) { setPin(''); setError(''); } };

  const handleDigitRef = useRef(handleDigit);
  handleDigitRef.current = handleDigit;

  // Keyboard support — only in PIN mode
  useEffect(() => {
    if (mode !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigitRef.current(e.key);
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Escape') handleClear();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login({ email, password });
      // login success — no notification needed
    } catch {
      notify.error('Email ou mot de passe incorrect');
    } finally {
      setLoading(false);
    }
  };

  if (user) return <Navigate to="/" replace />;

  // ═══════ EMAIL MODE ═══════
  if (mode === 'email') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--theme-bg-page)' }}>
        <div className="rounded-2xl shadow-xl w-full max-w-md p-8" style={{ backgroundColor: 'var(--theme-bg-card)' }}>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold" style={{ color: 'var(--theme-accent)' }}>{settings.companyName}</h1>
            <p className="mt-1" style={{ color: 'var(--theme-text-muted)' }}>{settings.subtitle}</p>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input" placeholder="admin@ofauria.com" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="input" placeholder="••••••••" required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="text-center mt-6">
            <button type="button" onClick={() => setSearchParams({})}
              className="text-sm font-medium flex items-center gap-2 mx-auto"
              style={{ color: 'var(--theme-accent)' }}>
              <Lock size={14} /> Connexion par code PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════ PIN MODE ═══════
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--theme-bg-page)' }}>
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold" style={{ color: 'var(--theme-accent)' }}>{settings.companyName}</h1>
        <p className="mt-1" style={{ color: 'var(--theme-text-muted)' }}>{settings.subtitle}</p>
      </div>

      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={20} className="text-gray-400" />
          <span className="text-gray-500">Entrez votre code PIN</span>
        </div>

        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}
              className={`w-5 h-5 rounded-full transition-all duration-150 ${
                i < pin.length
                  ? error ? 'bg-red-500 scale-125' : 'scale-125'
                  : 'border-2 border-gray-300'
              }`}
              style={i < pin.length && !error ? { backgroundColor: 'var(--theme-accent)' } : undefined} />
          ))}
        </div>

        {error && <div className="text-red-500 text-sm font-medium mb-4">{error}</div>}
        {loading && <div className="text-sm font-medium mb-4" style={{ color: 'var(--theme-accent)' }}>Verification...</div>}

        <div className="rounded-2xl shadow-lg p-5 w-full max-w-xs" style={{ backgroundColor: 'var(--theme-bg-card)' }}>
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" onClick={() => handleDigit(digit)} disabled={loading}
                className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
                {digit}
              </button>
            ))}
            <button type="button" onClick={handleClear} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-red-50 text-sm font-medium text-gray-500 transition-all active:scale-95">
              Effacer
            </button>
            <button type="button" onClick={() => handleDigit('0')} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
              0
            </button>
            <button type="button" onClick={handleBackspace} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-all active:scale-95">
              <Delete size={22} />
            </button>
          </div>
        </div>

        {/* Lien direct — pas de state React, change l'URL */}
        <a href="/login?mode=email"
          className="mt-8 text-sm text-gray-400 hover:text-gray-600 flex items-center gap-2 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer no-underline">
          <Mail size={14} /> Connexion administrateur
        </a>
      </div>
    </div>
  );
}
