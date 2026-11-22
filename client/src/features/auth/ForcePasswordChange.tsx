import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../api/auth.api';
import { apiErrorMessage } from '../../api/errors';

/**
 * G0-06 — changement de mot de passe imposé. Affiché à la place de toute
 * l'application tant que le compte porte « mot de passe à changer » (mot de passe
 * antérieur à la politique : 12 caractères, majuscule, minuscule, chiffre,
 * caractère spécial).
 */
const RULES: [string, (p: string) => boolean][] = [
  ['12 caractères au moins', p => p.length >= 12],
  ['une majuscule', p => /[A-Z]/.test(p)],
  ['une minuscule', p => /[a-z]/.test(p)],
  ['un chiffre', p => /[0-9]/.test(p)],
  ['un caractère spécial', p => /[^A-Za-z0-9]/.test(p)],
];

export default function ForcePasswordChange() {
  const { user, logout, passwordChanged } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const rulesOk = RULES.every(([, test]) => test(next));
  const canSave = !!current && rulesOk && next === confirm && next !== current && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const r = await authApi.changePassword(current, next);
      passwordChanged(r.token);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="kl-ds min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
      <form onSubmit={submit} className="rounded-2xl shadow-xl w-full max-w-md p-8 space-y-4" style={{ backgroundColor: 'var(--ds-card)' }}>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--ds-accent)' }}>
            <KeyRound size={20} aria-hidden="true" /> Changez votre mot de passe
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--ds-muted)' }}>
            {user?.firstName ? `${user.firstName}, votre` : 'Votre'} mot de passe actuel ne respecte plus les règles de sécurité.
            Choisissez-en un nouveau pour continuer.
          </p>
        </div>

        <div>
          <label htmlFor="fpc-current" className="block text-sm font-medium mb-1" style={{ color: 'var(--ds-ink)' }}>Mot de passe actuel</label>
          <input id="fpc-current" type="password" className="input" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="fpc-next" className="block text-sm font-medium mb-1" style={{ color: 'var(--ds-ink)' }}>Nouveau mot de passe</label>
          <input id="fpc-next" type="password" className="input" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required />
          <ul className="mt-2 text-xs space-y-0.5">
            {RULES.map(([label, test]) => {
              const ok = test(next);
              return <li key={label} style={{ color: ok ? 'var(--ds-success)' : 'var(--ds-muted)' }}>{ok ? '✓' : '○'} {label}</li>;
            })}
          </ul>
        </div>
        <div>
          <label htmlFor="fpc-confirm" className="block text-sm font-medium mb-1" style={{ color: 'var(--ds-ink)' }}>Confirmez le nouveau mot de passe</label>
          <input id="fpc-confirm" type="password" className="input" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          {confirm && confirm !== next && <p role="alert" className="mt-1 text-xs font-semibold" style={{ color: 'var(--ds-danger)' }}>Les deux saisies sont différentes.</p>}
          {next && next === current && <p role="alert" className="mt-1 text-xs font-semibold" style={{ color: 'var(--ds-danger)' }}>Le nouveau mot de passe doit être différent de l'actuel.</p>}
        </div>

        {error && <p className="text-sm font-semibold" style={{ color: 'var(--ds-danger)' }} role="alert">{error}</p>}

        <button type="submit" disabled={!canSave} aria-busy={saving || undefined} className="btn-primary w-full py-3">
          {saving ? 'Enregistrement…' : 'Changer le mot de passe'}
        </button>
        <button type="button" onClick={logout} className="w-full text-sm flex items-center justify-center gap-2" style={{ color: 'var(--ds-body)' }}>
          <LogOut size={14} aria-hidden="true" /> Se déconnecter
        </button>
      </form>
    </div>
  );
}
