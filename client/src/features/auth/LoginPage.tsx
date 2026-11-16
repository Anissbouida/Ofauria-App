import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { notify } from '../../components/ui/InlineNotification';
import { ArrowLeft, Delete, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { authApi } from '../../api/auth.api';

/** G0-06 : un PIN antérieur compte 4 chiffres, un PIN récent 6 à 10. */
const PIN_MIN = 4;
const PIN_MAX = 10;
type PinUser = { id: string; firstName: string; lastInitial: string };

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
  const [showPassword, setShowPassword] = useState(false);

  const loginWithPinRef = useRef(loginWithPin);
  loginWithPinRef.current = loginWithPin;

  // G0-06 : on choisit d'abord son nom (tuile), puis on saisit son PIN. Le
  // serveur ne compare alors qu'un seul hachage.
  const [pinUsers, setPinUsers] = useState<PinUser[] | null>(null);
  const [selected, setSelected] = useState<PinUser | null>(null);
  const selectedRef = useRef<PinUser | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    if (mode !== 'pin') return;
    authApi.pinUsers().then(setPinUsers).catch(() => setPinUsers([]));
  }, [mode]);

  const handlePinSubmit = useCallback(async (pinCode: string) => {
    const who = selectedRef.current;
    if (!who || pinCode.length < PIN_MIN) return;
    setLoading(true);
    setError('');
    try {
      await loginWithPinRef.current(who.id, pinCode);
      // login success — no notification needed
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const serverMsg = axiosErr?.response?.data?.error?.message;
      setError(serverMsg || axiosErr?.message || 'Code PIN incorrect');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, []);

  // La longueur du PIN n'est plus fixe (4 chiffres pour un PIN antérieur, 6 à 10
  // sinon) : la saisie se valide par « Valider » ou Entrée, plus automatiquement.
  const handleDigit = useCallback((digit: string) => {
    if (loading || !selectedRef.current) return;
    setError('');
    setPin(prev => (prev.length < PIN_MAX ? prev + digit : prev));
  }, [loading]);

  const handleBackspace = () => { if (!loading) { setPin(prev => prev.slice(0, -1)); setError(''); } };
  const handleClear = () => { if (!loading) { setPin(''); setError(''); } };
  const backToTiles = () => { if (!loading) { setSelected(null); setPin(''); setError(''); } };

  const handleDigitRef = useRef(handleDigit);
  handleDigitRef.current = handleDigit;
  const pinRef = useRef(pin);
  pinRef.current = pin;

  // Keyboard support — only in PIN mode
  useEffect(() => {
    if (mode !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigitRef.current(e.key);
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Enter') handlePinSubmit(pinRef.current);
      else if (e.key === 'Escape') { if (pinRef.current) handleClear(); else backToTiles(); }
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
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; code?: string; message?: string };
      const status = axiosErr?.response?.status;
      const serverMsg = axiosErr?.response?.data?.error?.message;
      if (!axiosErr?.response) {
        notify.error('Serveur injoignable — vérifie que le backend tourne (port 3001)');
      } else if (status === 401 || status === 400) {
        notify.error(serverMsg || 'Email ou mot de passe incorrect');
      } else {
        notify.error(serverMsg || `Erreur serveur (${status})`);
      }
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
                className="input" placeholder="vous@entreprise.ma" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10" placeholder="••••••••" required />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
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

      {!selected ? (
        // ── Étape 1 : choisir son nom ──
        <div className="flex flex-col items-center w-full max-w-2xl">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={20} className="text-gray-400" />
            <span className="text-gray-500">Qui se connecte ?</span>
          </div>
          {pinUsers === null ? (
            <div className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Chargement…</div>
          ) : pinUsers.length === 0 ? (
            <div className="text-sm text-center" style={{ color: 'var(--theme-text-muted)' }}>
              Aucun compte n'a de code PIN. Utilisez la connexion administrateur.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full">
              {pinUsers.map(u => (
                <button key={u.id} type="button" onClick={() => { setSelected(u); setPin(''); setError(''); }}
                  className="rounded-2xl shadow p-4 flex flex-col items-center gap-2 transition-all active:scale-95 hover:shadow-md"
                  style={{ backgroundColor: 'var(--theme-bg-card)' }}>
                  <span className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold"
                    style={{ backgroundColor: 'var(--theme-accent)' }}>
                    {(u.firstName[0] ?? '?').toUpperCase()}{u.lastInitial}
                  </span>
                  <span className="text-sm font-medium text-gray-800 text-center leading-tight">
                    {u.firstName}{u.lastInitial ? ` ${u.lastInitial}.` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          <a href="/login?mode=email"
            className="mt-8 text-sm text-gray-400 hover:text-gray-600 flex items-center gap-2 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer no-underline">
            <Mail size={14} /> Connexion administrateur
          </a>
        </div>
      ) : (
      // ── Étape 2 : saisir son PIN ──
      <div className="flex flex-col items-center">
        <button type="button" onClick={backToTiles} disabled={loading}
          className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={14} /> Changer de personne
        </button>
        <div className="flex items-center gap-2 mb-4">
          <Lock size={20} className="text-gray-400" />
          <span className="text-gray-500">
            <strong className="text-gray-800">{selected.firstName}{selected.lastInitial ? ` ${selected.lastInitial}.` : ''}</strong> — entrez votre code PIN
          </span>
        </div>

        <div className="flex gap-3 mb-6 h-5 items-center" aria-label={`${pin.length} chiffre(s) saisi(s)`}>
          {pin.length === 0
            ? <span className="text-sm text-gray-300">• • • •</span>
            : Array.from({ length: pin.length }, (_, i) => (
              <div key={i} className={`w-4 h-4 rounded-full ${error ? 'bg-red-500' : ''}`}
                style={!error ? { backgroundColor: 'var(--theme-accent)' } : undefined} />
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
          <button type="button" onClick={() => handlePinSubmit(pin)} disabled={loading || pin.length < PIN_MIN}
            className="btn-primary w-full py-3 mt-4 disabled:opacity-50">
            {loading ? 'Vérification…' : 'Valider'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
