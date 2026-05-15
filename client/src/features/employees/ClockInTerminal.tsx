import { useState, useEffect, useCallback, useRef } from 'react';
import { Delete, Clock, LogIn, LogOut } from 'lucide-react';
import { kioskApi } from '../../api/employees.api';
import { useSettings } from '../../context/SettingsContext';

type Feedback = {
  kind: 'in' | 'out';
  name: string;
  time: string;
} | null;

export default function ClockInTerminal() {
  const { settings } = useSettings();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [now, setNow] = useState(new Date());

  // storeId du kiosque : pris dans l'URL (?store=UUID). Sans ca, le serveur
  // matchera le PIN sur l'ensemble des employes — moins precis si meme PIN
  // utilise sur plusieurs sites.
  const storeId = new URLSearchParams(window.location.search).get('store') || undefined;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const submitPin = useCallback(async (pinCode: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await kioskApi.clock(pinCode, { storeId, terminal: 'kiosque-web' });
      setFeedback({
        kind: res.action === 'check_in' ? 'in' : 'out',
        name: `${res.employee.firstName} ${res.employee.lastName}`,
        time: res.record.check_in && res.action === 'check_in'
          ? res.record.check_in
          : res.record.check_out || '',
      });
      setPin('');
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setError(axiosErr?.response?.data?.error?.message || 'PIN inconnu');
      setPin('');
      setTimeout(() => setError(''), 3000);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const handleDigit = useCallback((d: string) => {
    if (loading) return;
    setError('');
    setPin(prev => {
      const next = prev + d;
      if (next.length >= 4) {
        setTimeout(() => submitPin(next), 150);
      }
      return next.length <= 6 ? next : prev;
    });
  }, [loading, submitPin]);

  const handleBackspace = () => { if (!loading) { setPin(p => p.slice(0, -1)); setError(''); } };
  const handleClear = () => { if (!loading) { setPin(''); setError(''); } };

  const handleDigitRef = useRef(handleDigit);
  handleDigitRef.current = handleDigit;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigitRef.current(e.key);
      else if (e.key === 'Backspace') handleBackspace();
      else if (e.key === 'Escape') handleClear();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--theme-bg-page)' }}>
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold" style={{ color: 'var(--theme-accent)' }}>{settings.companyName}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--theme-text-muted)' }}>Badgeuse</p>
      </div>

      <div className="text-center mb-8">
        <div className="text-6xl font-mono font-bold" style={{ color: 'var(--theme-text)' }}>
          {hh}:{mm}<span className="text-3xl" style={{ color: 'var(--theme-text-muted)' }}>:{ss}</span>
        </div>
        <div className="text-sm mt-1 capitalize" style={{ color: 'var(--theme-text-muted)' }}>{dateStr}</div>
      </div>

      {feedback ? (
        <div className={`rounded-2xl shadow-lg p-6 w-full max-w-md text-center ${feedback.kind === 'in' ? 'bg-green-50 border-2 border-green-300' : 'bg-blue-50 border-2 border-blue-300'}`}>
          <div className="flex items-center justify-center gap-3 mb-2">
            {feedback.kind === 'in' ? <LogIn className="text-green-600" size={32} /> : <LogOut className="text-blue-600" size={32} />}
            <span className={`text-xl font-bold ${feedback.kind === 'in' ? 'text-green-700' : 'text-blue-700'}`}>
              {feedback.kind === 'in' ? 'Bonjour' : 'Au revoir'}
            </span>
          </div>
          <div className="text-2xl font-semibold text-gray-800">{feedback.name}</div>
          <div className="text-sm text-gray-600 mt-2">
            {feedback.kind === 'in' ? 'Arrivee' : 'Depart'} pointe a {feedback.time?.slice(0, 5)}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={20} className="text-gray-400" />
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
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" onClick={() => handleDigit(d)} disabled={loading}
                  className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
                  {d}
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
        </div>
      )}
    </div>
  );
}
