import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Minus } from 'lucide-react';
import { authApi } from '../../api/auth.api';
import { useSettings } from '../../context/SettingsContext';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Page publique du lien d'invitation (refonte Utilisateurs, lot 3) : la personne invitée choisit
 * son mot de passe (même politique qu'un nouveau compte), puis se connecte.
 */
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: '12 caractères au moins', test: p => p.length >= 12 },
  { label: 'Une majuscule', test: p => /[A-Z]/.test(p) },
  { label: 'Une minuscule', test: p => /[a-z]/.test(p) },
  { label: 'Un chiffre', test: p => /[0-9]/.test(p) },
  { label: 'Un caractère spécial', test: p => /[^A-Za-z0-9]/.test(p) },
];

export default function AcceptInvitationPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { data, isLoading, isError } = useQuery({ queryKey: ['invitation', token], queryFn: () => authApi.invitation(token), retry: false });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const allOk = RULES.every(r => r.test(password));
  const same = password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allOk || !same) return;
    setBusy(true);
    try {
      await authApi.acceptInvitation(token, password);
      notify.success('Mot de passe enregistré : connectez-vous avec votre e-mail');
      navigate('/login', { replace: true });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Le mot de passe n\'a pas pu être enregistré');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kl-ds odoo-scope min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--ds-bg)' }}>
      <div className="rounded-2xl shadow-xl w-full max-w-md p-8" style={{ backgroundColor: 'var(--ds-card)', display: 'grid', gap: 16 }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ds-accent)', margin: 0 }}>{settings.companyName || 'Kalum'}</h1>
          <p className="text-sm" style={{ color: 'var(--ds-muted)', margin: '4px 0 0' }}>Bienvenue dans Kalum</p>
        </div>
        {isLoading ? <p style={{ color: 'var(--ds-muted)' }}>Vérification du lien…</p>
          : isError || !data ? <div className="ds-alert danger">Le lien n'a pas pu être vérifié. Réessayez dans un instant.</div>
          : data.status !== 'valid' ? (
            <>
              <div className="ds-alert warning">{data.message}</div>
              <button type="button" className="odoo-btn-secondary" onClick={() => navigate('/login')}>Aller à la connexion</button>
            </>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--ds-body)' }}>
                Bonjour {data.firstName}, choisissez le mot de passe de votre compte <strong>{data.email}</strong>.
              </p>
              <div className="ds-field">
                <label htmlFor="inv-pwd">Mot de passe</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="inv-pwd" className="ds-input" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} />
                  <button type="button" className="ds-icon-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2, fontSize: 13 }} aria-label="Règles du mot de passe">
                {RULES.map(r => {
                  const ok = r.test(password);
                  return (
                    <li key={r.label} style={{ display: 'flex', gap: 6, alignItems: 'center', color: ok ? 'var(--ds-success)' : 'var(--ds-muted)' }}>
                      {ok ? <Check size={13} aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />} {r.label}
                    </li>
                  );
                })}
              </ul>
              <div className="ds-field">
                <label htmlFor="inv-confirm">Confirmer le mot de passe</label>
                <input id="inv-confirm" className="ds-input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
                {confirm && !same && <span className="ds-field-hint" role="alert" style={{ color: 'var(--ds-danger)' }}>Les deux mots de passe diffèrent</span>}
              </div>
              <button type="submit" className="odoo-btn-primary" disabled={busy || !allOk || !same || !confirm}>
                {busy ? 'Enregistrement…' : 'Enregistrer et me connecter'}
              </button>
              {data.expiresAt && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>
                  Lien valable jusqu'au {new Date(data.expiresAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.
                </p>
              )}
            </form>
          )}
      </div>
    </div>
  );
}
