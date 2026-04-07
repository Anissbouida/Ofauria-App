import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import toast from 'react-hot-toast';
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
      toast.success('Bienvenue !');
    } catch {
      setError('Code PIN incorrect');
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
      toast.success('Bienvenue !');
    } catch {
      toast.error('Email ou mot de passe incorrect');
    } finally {
      setLoading(false);
    }
  };

  if (user) return <Navigate to="/" replace />;

  // ═══════ EMAIL MODE ═══════
  if (mode === 'email') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold" style={{ color: settings.primaryColor }}>{settings.companyName}</h1>
            <p className="text-gray-500 mt-1">{settings.subtitle}</p>
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
              className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-2 mx-auto">
              <Lock size={14} /> Connexion par code PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════ PIN MODE ═══════
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold" style={{ color: settings.primaryColor }}>{settings.companyName}</h1>
        <p className="text-gray-500 mt-1">{settings.subtitle}</p>
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
                  ? error ? 'bg-red-500 scale-125' : 'bg-primary-600 scale-125'
                  : 'border-2 border-gray-300'
              }`} />
          ))}
        </div>

        {error && <div className="text-red-500 text-sm font-medium mb-4">{error}</div>}
        {loading && <div className="text-primary-600 text-sm font-medium mb-4">Verification...</div>}

        <div className="bg-white rounded-2xl shadow-lg p-5 w-full max-w-xs">
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" onClick={() => handleDigit(digit)} disabled={loading}
                className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-primary-100 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
                {digit}
              </button>
            ))}
            <button type="button" onClick={handleClear} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-red-50 text-sm font-medium text-gray-500 transition-all active:scale-95">
              Effacer
            </button>
            <button type="button" onClick={() => handleDigit('0')} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-primary-100 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
              0
            </button>
            <button type="button" onClick={handleBackspace} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-amber-50 flex items-center justify-center text-gray-500 transition-all active:scale-95">
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
