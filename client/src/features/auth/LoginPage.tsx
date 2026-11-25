import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { serverUrl } from '../../api/client';
import { useSettings } from '../../context/SettingsContext';
import { notify } from '../../components/ui/InlineNotification';
import { ArrowLeft, Delete, Eye, EyeOff, Fingerprint, Lock, Mail } from 'lucide-react';
import { authApi, passkeyCancelled, passkeysSupported } from '../../api/auth.api';
import { useT } from '../../i18n';
import { LanguageSelect } from '../../components/layout/LanguageSwitcher';

/** G0-06 : un PIN antérieur compte 4 chiffres, un PIN récent 6 à 10. */
const PIN_MIN = 4;
const PIN_MAX = 10;
type PinUser = { id: string; firstName: string; lastInitial: string };

export default function LoginPage() {
  const { user, loginWithPin, login, verifyMfa, loginWithPasskey } = useAuth();
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  // Poste de confiance (mig 702) : coché par défaut, à décocher sur un poste partagé.
  const [rememberDevice, setRememberDevice] = useState(true);
  const [trustedDeviceDays, setTrustedDeviceDays] = useState(14);
  // Passkeys (mig 705) : seconds facteurs du compte ; inconnus au retour d'une connexion d'entreprise.
  const [mfaMethods, setMfaMethods] = useState<{ totp: boolean; passkey: boolean }>({ totp: true, passkey: true });
  const canPasskey = passkeysSupported();
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  /** Après une connexion par mot de passe : AppLayout propose d'ajouter une passkey s'il n'y en a aucune. */
  const suggestPasskey = () => { if (canPasskey) { try { sessionStorage.setItem('kalum_passkey_suggest', '1'); } catch { /* rien */ } } };
  /** Connexion par passkey : sans mfaToken = sans mot de passe, avec = second facteur. */
  const passkeySignIn = async (token?: string) => {
    setPasskeyBusy(true);
    try { await loginWithPasskey(token, !!token && rememberDevice && trustedDeviceDays > 0); }
    catch (err: unknown) {
      if (passkeyCancelled(err)) return;
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || tRef.current('auth.passkeyFailed'));
      if (token && /expirée/.test(msg ?? '')) { setMfaToken(null); setMfaCode(''); }
    } finally { setPasskeyBusy(false); }
  };
  // G6-02 : fournisseurs d'entreprise configurés ; retour de connexion (?mfa= / ?sso_error=).
  const [ssoProviders, setSsoProviders] = useState<{ provider: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/auth/oidc/providers').then(r => setSsoProviders(r.data.data ?? [])).catch(() => setSsoProviders([]));
    const params = new URLSearchParams(window.location.search);
    const mfa = params.get('mfa');
    if (mfa) setMfaToken(mfa);
    const err = params.get('sso_error');
    if (err) notify.error(tRef.current(err === 'compte_inconnu' ? 'auth.ssoUnknownAccount' : 'auth.ssoFailed'));
  }, []);
  const { settings } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'email' ? 'email' : 'pin';
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Constat 121 : retour ici après une session expirée (api/client.ts) — on le dit, et l'on
  // précise si la dernière modification n'a pas été enregistrée. Lu une seule fois.
  const [expired] = useState<'read' | 'write' | null>(() => {
    try {
      const v = sessionStorage.getItem('kalum_session_expired');
      return v === 'write' || v === 'read' ? v : null;
    } catch { return null; }
  });
  // Effacée après coup (pas dans l'initialiseur, que React rejoue deux fois en mode strict).
  useEffect(() => { try { sessionStorage.removeItem('kalum_session_expired'); } catch { /* rien */ } }, []);

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
      setError(serverMsg || axiosErr?.message || tRef.current('auth.pinIncorrect'));
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
      const r = await login({ email, password });
      // G6-01 : second facteur exigé → étape du code.
      // Connecté directement (sans second facteur ou poste mémorisé) : proposer une passkey.
      if (!r?.mfaToken) suggestPasskey();
      if (r?.mfaToken) {
        setMfaToken(r.mfaToken);
        if (typeof r.trustedDeviceDays === 'number') setTrustedDeviceDays(r.trustedDeviceDays);
        if (r.methods) setMfaMethods(r.methods);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; code?: string; message?: string };
      const status = axiosErr?.response?.status;
      const serverMsg = axiosErr?.response?.data?.error?.message;
      if (!axiosErr?.response) {
        notify.error(t('auth.serverUnreachable'));
      } else if (status === 401 || status === 400) {
        notify.error(serverMsg || t('auth.badCredentials'));
      } else {
        notify.error(serverMsg || t('common.error.server', { status: status ?? '' }));
      }
    } finally {
      setLoading(false);
    }
  };

  if (user) return <Navigate to="/" replace />;

  // ═══════ G6-01 : SECOND FACTEUR ═══════
  if (mfaToken) {
    const showPasskey = canPasskey && mfaMethods.passkey;
    const submitCode = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      try {
        await verifyMfa(mfaToken, mfaCode.trim(), rememberDevice && trustedDeviceDays > 0);
        // Connecté par code : proposer une fois d'ajouter une passkey (AppLayout).
        suggestPasskey();
      }
      catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
        notify.error(msg || t('auth.invalidCode'));
        if (/expirée/.test(msg ?? '')) { setMfaToken(null); setMfaCode(''); }
      } finally { setLoading(false); }
    };
    return (
      <div className="kl-ds min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
        <div className="rounded-2xl shadow-xl w-full max-w-md p-8" style={{ backgroundColor: 'var(--ds-card)' }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--ds-accent)' }}>{t('auth.mfaTitle')}</h1>
          <p className="text-sm mb-4" style={{ color: 'var(--ds-muted)' }}>{t(showPasskey && !mfaMethods.totp ? 'auth.mfaHelpPasskey' : showPasskey ? 'auth.mfaHelpBoth' : 'auth.mfaHelp')}</p>
          <form onSubmit={submitCode} className="space-y-4">
            {showPasskey && (
              <button type="button" className="btn-primary w-full py-3 flex items-center justify-center gap-2" disabled={passkeyBusy || loading}
                autoFocus onClick={() => void passkeySignIn(mfaToken)}>
                <Fingerprint size={18} /> {passkeyBusy ? t('auth.verifying') : t('auth.usePasskey')}
              </button>
            )}
            {showPasskey && mfaMethods.totp && (
              <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ds-muted)' }}>
                <span className="flex-1 border-t" /> {t('auth.orEnterCode')} <span className="flex-1 border-t" />
              </div>
            )}
            {mfaMethods.totp && (
              <input className="input" autoFocus={!showPasskey} autoComplete="one-time-code" inputMode="text" maxLength={12} placeholder="123456"
                aria-label={t('auth.mfaCodeLabel')} dir="ltr" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
            )}
            {trustedDeviceDays > 0 && (
              <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--ds-ink, inherit)' }}>
                <input type="checkbox" className="mt-0.5" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
                <span>
                  {t('auth.mfaRemember', { days: trustedDeviceDays })}
                  <span className="block text-xs" style={{ color: 'var(--ds-muted)' }}>{t('auth.mfaRememberHint')}</span>
                </span>
              </label>
            )}
            {mfaMethods.totp && (
              <button type="submit" disabled={loading || mfaCode.trim().length < 6} className={`${showPasskey ? 'btn-secondary' : 'btn-primary'} w-full py-3`}>{loading ? t('auth.verifying') : t('common.validate')}</button>
            )}
            <button type="button" className="text-sm w-full" style={{ color: 'var(--ds-accent)' }} onClick={() => { setMfaToken(null); setMfaCode(''); }}>{t('common.back')}</button>
          </form>
        </div>
      </div>
    );
  }

  // ═══════ EMAIL MODE ═══════
  if (mode === 'email') {
    return (
      <div className="kl-ds relative min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
        <LanguageSelect className="absolute top-4 end-4" />
        <div className="rounded-2xl shadow-xl w-full max-w-md p-8" style={{ backgroundColor: 'var(--ds-card)' }}>
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold" style={{ color: 'var(--ds-accent)' }}>{settings.companyName}</h1>
            <p className="mt-1" style={{ color: 'var(--ds-muted)' }}>{settings.subtitle}</p>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium mb-1" style={{ color: 'var(--ds-ink)' }}>{t('auth.email')}</label>
              <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input" dir="ltr" placeholder={t('auth.emailPlaceholder')} required />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium mb-1" style={{ color: 'var(--ds-ink)' }}>{t('auth.password')}</label>
              <div className="relative">
                <input id="login-password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input pe-10" dir="ltr" placeholder="••••••••" required />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="absolute inset-y-0 end-0 flex items-center pe-3" style={{ color: 'var(--ds-muted)' }}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} aria-busy={loading || undefined} className="btn-primary w-full py-3">
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </button>
          </form>

          {/* Passkeys (mig 705) : connexion sans mot de passe, Face ID / Touch ID / Windows Hello. */}
          {canPasskey && (
            <>
              <div className="flex items-center gap-3 text-xs my-4" style={{ color: 'var(--ds-muted)' }}>
                <span className="flex-1 border-t" /> {t('auth.or')} <span className="flex-1 border-t" />
              </div>
              <button type="button" className="btn-secondary w-full py-3 flex items-center justify-center gap-2" disabled={passkeyBusy || loading}
                onClick={() => void passkeySignIn()}>
                <Fingerprint size={18} /> {passkeyBusy ? t('auth.verifying') : t('auth.signInWithPasskey')}
              </button>
              <p className="text-xs text-center mt-2" style={{ color: 'var(--ds-muted)' }}>{t('auth.passkeyFirstTime')}</p>
            </>
          )}

          {/* G6-02 : connexion d'entreprise (fournisseurs configurés seulement). */}
          {ssoProviders.length > 0 && (
            <div className="mt-4 space-y-2">
              {ssoProviders.map(p => (
                <a key={p.provider} href={serverUrl(`/api/v1/auth/oidc/${p.provider}/start`)} className="btn-secondary w-full py-2 block text-center">
                  {t('auth.continueWith', { provider: p.label })}
                </a>
              ))}
            </div>
          )}

          <div className="text-center mt-6">
            <button type="button" onClick={() => setSearchParams({})}
              className="text-sm font-medium flex items-center gap-2 mx-auto"
              style={{ color: 'var(--ds-accent)' }}>
              <Lock size={14} /> {t('auth.pinLogin')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════ PIN MODE ═══════
  return (
    <div className="kl-ds relative min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
      <LanguageSelect className="absolute top-4 end-4" />
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold" style={{ color: 'var(--ds-accent)' }}>{settings.companyName}</h1>
        <p className="mt-1" style={{ color: 'var(--ds-muted)' }}>{settings.subtitle}</p>
      </div>

      {expired && (
        <div role="alert" className="mb-6 max-w-xl text-center text-sm rounded-md px-4 py-3"
          style={{ background: 'var(--ds-warning-bg)', border: '1px solid var(--ds-warning)', color: 'var(--ds-warning)' }}>
          <strong>Votre session a expiré.</strong>{' '}
          {expired === 'write'
            ? 'Votre dernière modification n\'a pas été enregistrée : reconnectez-vous, puis refaites-la.'
            : 'Reconnectez-vous pour continuer.'}
        </div>
      )}

      {!selected ? (
        // ── Étape 1 : choisir son nom ──
        <div className="flex flex-col items-center w-full max-w-2xl">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={20} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
            <span style={{ color: 'var(--ds-body)' }}>{t('auth.whoIsLoggingIn')}</span>
          </div>
          {pinUsers === null ? (
            <div role="status" className="text-sm" style={{ color: 'var(--ds-muted)' }}>{t('common.loading')}</div>
          ) : pinUsers.length === 0 ? (
            <div className="text-sm text-center" style={{ color: 'var(--ds-muted)' }}>
              {t('auth.noPinAccounts')}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 w-full">
              {pinUsers.map(u => (
                <button key={u.id} type="button" onClick={() => { setSelected(u); setPin(''); setError(''); }}
                  className="rounded-2xl shadow p-4 flex flex-col items-center gap-2 transition-all active:scale-95 hover:shadow-md"
                  style={{ backgroundColor: 'var(--ds-card)' }}>
                  <span className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold"
                    style={{ backgroundColor: 'var(--ds-accent)' }}>
                    {(u.firstName[0] ?? '?').toUpperCase()}{u.lastInitial}
                  </span>
                  <span className="text-sm font-medium text-gray-800 text-center leading-tight">
                    <bdi>{u.firstName}{u.lastInitial ? ` ${u.lastInitial}.` : ''}</bdi>
                  </span>
                </button>
              ))}
            </div>
          )}
          <a href="/login?mode=email"
            className="mt-8 text-sm flex items-center gap-2 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer no-underline">
            <Mail size={14} /> {t('auth.adminLogin')}
          </a>
        </div>
      ) : (
      // ── Étape 2 : saisir son PIN ──
      <div className="flex flex-col items-center">
        <button type="button" onClick={backToTiles} disabled={loading}
          className="mb-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={14} className="rtl:-scale-x-100" /> {t('auth.changePerson')}
        </button>
        <div className="flex items-center gap-2 mb-4">
          <Lock size={20} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
          <span style={{ color: 'var(--ds-body)' }}>
            <strong className="text-gray-800"><bdi>{selected.firstName}{selected.lastInitial ? ` ${selected.lastInitial}.` : ''}</bdi></strong> — {t('auth.enterPin')}
          </span>
        </div>

        <div className="flex gap-3 mb-6 h-5 items-center" dir="ltr" aria-label={t('auth.digitsEntered', { count: pin.length })}>
          {pin.length === 0
            ? <span className="text-sm text-gray-300">• • • •</span>
            : Array.from({ length: pin.length }, (_, i) => (
              <div key={i} className="w-4 h-4 rounded-full"
                style={{ backgroundColor: error ? 'var(--ds-danger)' : 'var(--ds-accent)' }} />
            ))}
        </div>

        {error && <div role="alert" className="text-sm font-semibold mb-4" style={{ color: 'var(--ds-danger)' }}>{error}</div>}
        {loading && <div role="status" className="text-sm font-medium mb-4" style={{ color: 'var(--ds-accent)' }}>{t('auth.verifying')}</div>}

        <div className="rounded-2xl shadow-lg p-5 w-full max-w-xs" style={{ backgroundColor: 'var(--ds-card)' }}>
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" onClick={() => handleDigit(digit)} disabled={loading}
                className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
                {digit}
              </button>
            ))}
            <button type="button" onClick={handleClear} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-red-50 text-sm font-medium text-gray-500 transition-all active:scale-95">
              {t('auth.clear')}
            </button>
            <button type="button" onClick={() => handleDigit('0')} disabled={loading}
              className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-2xl font-semibold text-gray-800 transition-all active:scale-95 disabled:opacity-50">
              0
            </button>
            <button type="button" onClick={handleBackspace} disabled={loading} aria-label="Effacer le dernier chiffre"
              className="h-16 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-500 transition-all active:scale-95">
              <Delete size={22} aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={() => handlePinSubmit(pin)} disabled={loading || pin.length < PIN_MIN}
            className="btn-primary w-full py-3 mt-4 disabled:opacity-50">
            {loading ? t('auth.verifying') : t('common.validate')}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
