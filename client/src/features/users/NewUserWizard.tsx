import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Mail, ShieldCheck, TriangleAlert, Wand2 } from 'lucide-react';
import { usersApi, rolesApi, type InvitationResult } from '../../api/users.api';
import { storesApi } from '../../api/stores.api';
import { StoresField } from './StoresField';
import { Modal, FormField, Alert } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { errorMessage, generatePassword, type UserRow } from './AccountSecurity';
import { ORIGIN } from './roleAccess';

/**
 * Création d'un compte en cinq étapes, sans numéro (refonte Utilisateurs, lot 3) : identité et
 * premier accès (invitation par e-mail ou mot de passe provisoire), rôles, périmètre, sécurité,
 * vérification des conflits de séparation des tâches. Écran final : lien ou mot de passe à
 * transmettre quand l'e-mail ne part pas.
 */
type Step = 'identity' | 'roles' | 'scope' | 'security' | 'review';
const STEPS: { key: Step; label: string; lead: string }[] = [
  { key: 'identity', label: 'Identité', lead: 'Qui est la personne et comment elle se connecte la première fois.' },
  { key: 'roles', label: 'Rôles', lead: 'Un ou plusieurs rôles ; le droit le plus large l\'emporte.' },
  { key: 'scope', label: 'Périmètre', lead: 'L\'établissement sur lequel la portée « Son établissement » se lit.' },
  { key: 'security', label: 'Sécurité', lead: 'Double authentification et code PIN de caisse.' },
  { key: 'review', label: 'Vérification', lead: 'Contrôle avant création du compte.' },
];
const strongPasswordOk = (p: string) => p.length >= 12 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

type Created = { user: UserRow; invitation: InvitationResult | null; password: string | null };

export default function NewUserWizard({ onClose, onOpen }: { onClose: () => void; onOpen: (u: UserRow) => void }) {
  const queryClient = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: employees = [] } = useQuery<Array<{ id: string; name: string; user_id: string | null }>>({ queryKey: ['employees-link'], queryFn: usersApi.employeesForLink });
  const { data: mfaPolicy } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });

  const [step, setStep] = useState<Step>('identity');
  const [visited, setVisited] = useState<Set<Step>>(new Set(['identity']));
  const [f, setF] = useState({
    firstName: '', lastName: '', email: '', employeeId: '',
    access: 'invite' as 'invite' | 'password', password: generatePassword(),
    roles: [] as string[], primary: '', storeId: '', storeIds: [] as string[], mfaRequired: false, pin: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const [created, setCreated] = useState<Created | null>(null);

  const choices = roles.filter(r => r.is_active && r.available !== false);
  const label = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const requiredByRole = f.roles.some(c => mfaPolicy?.requiredRoles?.includes(c));
  const { data: sod } = useQuery({
    queryKey: ['sod-check', [...f.roles].sort().join(',')], queryFn: () => usersApi.sodCheck(f.roles),
    enabled: step === 'review' && f.roles.length > 1, retry: false,
  });
  const violations = f.roles.length > 1 ? sod?.violations ?? [] : [];
  const blocked = sod?.mode === 'enforce' && violations.length > 0;

  const invalid: Record<Step, string | null> = useMemo(() => ({
    identity: !f.firstName.trim() || !f.lastName.trim() ? 'Prénom et nom requis'
      : !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'E-mail invalide'
      : f.access === 'password' && !strongPasswordOk(f.password) ? 'Mot de passe : 12 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial' : null,
    roles: f.roles.length === 0 ? 'Choisissez au moins un rôle' : null,
    scope: null,
    security: f.pin && !/^\d{6,10}$/.test(f.pin) ? 'Code PIN : 6 à 10 chiffres' : null,
    review: blocked ? 'Conflit de séparation des tâches : la création serait refusée (mode Bloquer)' : null,
  }), [f, blocked]);

  const idx = STEPS.findIndex(s => s.key === step);
  const go = (s: Step) => { setStep(s); setVisited(v => new Set(v).add(s)); };
  const toggleRole = (code: string) => setF(x => {
    const has = x.roles.includes(code);
    const next = has ? x.roles.filter(c => c !== code) : [...x.roles, code];
    return { ...x, roles: next, primary: next.includes(x.primary) ? x.primary : (next[0] ?? '') };
  });

  const create = useMutation({
    mutationFn: () => usersApi.create({
      firstName: f.firstName.trim(), lastName: f.lastName.trim(), email: f.email.trim(),
      roles: f.roles, primaryRole: f.primary || f.roles[0], storeId: f.storeId || null, storeIds: f.storeIds,
      employeeId: f.employeeId || null, mfaRequired: f.mfaRequired,
      ...(f.access === 'invite' ? { invite: true } : { password: f.password, mustChangePassword: true }),
      ...(f.pin ? { pinCode: f.pin } : {}),
    }),
    onSuccess: (u: UserRow) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setCreated({ user: u, invitation: (u.invitation as InvitationResult | null) ?? null, password: f.access === 'password' ? f.password : null });
    },
    onError: err => notify.error(errorMessage(err, 'Création refusée')),
  });

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); notify.success(`${what} copié`); }
    catch { notify.error('Copie impossible : sélectionnez le texte à la main'); }
  };

  if (created) {
    const link = created.invitation ? `${window.location.origin}${created.invitation.path}` : '';
    return (
      <Modal title="Compte créé" subtitle={`${f.firstName} ${f.lastName} · ${f.email}`} onClose={onClose} width={640}
        footer={<>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
          <button type="button" className="odoo-btn-primary" onClick={() => onOpen(created.user)}>Ouvrir la fiche</button>
        </>}>
        {created.invitation ? (
          <>
            {created.invitation.emailQueued
              ? <Alert tone="success" icon={Mail}>Invitation envoyée à {f.email}. Le lien est valable 72 heures.</Alert>
              : <Alert tone="warning" icon={Mail}>L'envoi d'e-mails n'est pas configuré : transmettez vous-même ce lien à la personne. Il est valable 72 heures.</Alert>}
            <FormField label="Lien d'invitation" htmlFor="inv-link" hint="Ne le transmettez qu'à la personne concernée : il permet de choisir le mot de passe du compte.">
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="inv-link" className="ds-input" readOnly value={link} onFocus={e => e.currentTarget.select()} />
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void copy(link, 'Lien')}><Copy size={13} aria-hidden="true" /> Copier</button>
              </div>
            </FormField>
          </>
        ) : (
          <>
            <Alert tone="info" icon={KeyRound}>Mot de passe provisoire, à changer à la première connexion.</Alert>
            <FormField label="Mot de passe provisoire" htmlFor="tmp-pwd">
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="tmp-pwd" className="ds-input" readOnly value={created.password ?? ''} onFocus={e => e.currentTarget.select()} />
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void copy(created.password ?? '', 'Mot de passe')}><Copy size={13} aria-hidden="true" /> Copier</button>
              </div>
            </FormField>
          </>
        )}
      </Modal>
    );
  }

  const current = STEPS[idx];
  return (
    <Modal title="Nouvel utilisateur" subtitle={current.lead} onClose={onClose} width={860} locked={create.isPending}
      footer={(
        <div className="ds-form-foot">
          <span className="ds-grow" style={{ color: 'var(--ds-muted)', fontSize: 13 }}>{invalid[step] ?? ''}</span>
          <button type="button" className="odoo-btn-secondary" onClick={() => (idx === 0 ? onClose() : go(STEPS[idx - 1].key))}>{idx === 0 ? 'Annuler' : 'Précédent'}</button>
          {step === 'review'
            ? <button type="button" className="odoo-btn-primary" disabled={!!invalid.identity || !!invalid.roles || !!invalid.security || !!invalid.review || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Création…' : f.access === 'invite' ? 'Créer et inviter' : 'Créer le compte'}
              </button>
            : <button type="button" className="odoo-btn-primary" disabled={!!invalid[step]} onClick={() => go(STEPS[idx + 1].key)}>Suivant</button>}
        </div>
      )}>
      <nav className="usr-steps" aria-label="Étapes de la création">
        {STEPS.map((s, i) => {
          const done = i < idx && visited.has(s.key) && !invalid[s.key];
          const reachable = i <= idx || STEPS.slice(0, i).every(p => !invalid[p.key]);
          return (
            <button key={s.key} type="button" className={`${s.key === step ? 'on' : ''}${done ? ' done' : ''}`} aria-current={s.key === step ? 'step' : undefined}
              disabled={!reachable} onClick={() => go(s.key)}>
              {done && <Check size={13} aria-hidden="true" />}{s.label}
            </button>
          );
        })}
      </nav>

      {step === 'identity' && (
        <>
          <div className="ds-form-grid">
            <FormField label="Prénom" htmlFor="nu-first" required><input id="nu-first" className="ds-input" autoFocus value={f.firstName} onChange={e => set('firstName', e.target.value)} /></FormField>
            <FormField label="Nom" htmlFor="nu-last" required><input id="nu-last" className="ds-input" value={f.lastName} onChange={e => set('lastName', e.target.value)} /></FormField>
            <FormField label="E-mail de connexion" htmlFor="nu-mail" required><input id="nu-mail" type="email" className="ds-input" value={f.email} onChange={e => set('email', e.target.value)} /></FormField>
            <FormField label="Fiche salarié" htmlFor="nu-emp" hint="Ouvre l'espace employé à ce compte.">
              <select id="nu-emp" className="ds-input" value={f.employeeId} onChange={e => set('employeeId', e.target.value)}>
                <option value="">Aucune</option>
                {employees.filter(e => !e.user_id).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </FormField>
          </div>
          <fieldset className="ds-fieldset"><legend>Premier accès</legend>
            <div className="usr-cards">
              <button type="button" className={`usr-card${f.access === 'invite' ? ' on' : ''}`} aria-pressed={f.access === 'invite'} onClick={() => set('access', 'invite')}>
                <b><Mail size={15} aria-hidden="true" /> Envoyer une invitation</b>
                <small>La personne choisit son mot de passe par un lien valable 72 h. Si l'envoi d'e-mails n'est pas configuré, vous pourrez copier le lien.</small>
              </button>
              <button type="button" className={`usr-card${f.access === 'password' ? ' on' : ''}`} aria-pressed={f.access === 'password'} onClick={() => set('access', 'password')}>
                <b><KeyRound size={15} aria-hidden="true" /> Mot de passe provisoire</b>
                <small>À transmettre vous-même ; à changer à la première connexion.</small>
              </button>
            </div>
            {f.access === 'password' && (
              <FormField label="Mot de passe provisoire" htmlFor="nu-pwd" hint="12 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial.">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="nu-pwd" className="ds-input" value={f.password} onChange={e => set('password', e.target.value)} autoComplete="new-password" />
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => set('password', generatePassword())}><Wand2 size={13} aria-hidden="true" /> Générer</button>
                </div>
              </FormField>
            )}
          </fieldset>
        </>
      )}

      {step === 'roles' && (
        <div className="usr-cards">
          {choices.map(r => {
            const on = f.roles.includes(r.code);
            return (
              <button key={r.code} type="button" className={`usr-card${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleRole(r.code)}>
                <b>{r.label}{on && <Check size={15} aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--ds-accent)' }} />}</b>
                <small>{r.code === 'admin' ? 'Tous les modules' : `${r.module_count} module${r.module_count > 1 ? 's' : ''}`}{r.description ? ` · ${r.description}` : ''}</small>
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span className={`kl-tag ${ORIGIN[r.origin ?? (r.is_system ? 'system' : 'custom')].tag}`}>{ORIGIN[r.origin ?? (r.is_system ? 'system' : 'custom')].label}</span>
                  {on && f.primary === r.code && <span className="kl-tag b">Principal</span>}
                  {mfaPolicy?.requiredRoles?.includes(r.code) && <span className="kl-tag o">2FA exigée</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {step === 'roles' && f.roles.length > 1 && (
        <FormField label="Rôle principal" htmlFor="nu-primary" hint="Fixe la page d'accueil et le contrôle des écrans.">
          <select id="nu-primary" className="ds-input" value={f.primary} onChange={e => set('primary', e.target.value)}>
            {f.roles.map(c => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </FormField>
      )}

      {step === 'scope' && (
        <div className="ds-form-grid">
          <FormField label="Établissements" hint="Celui par défaut est ouvert à la connexion ; la personne passe aux autres depuis la barre du haut. Aucun coché : compte qui travaille sur tous les établissements (direction).">
            <StoresField idPrefix="nu-store" stores={stores.map(s => ({ id: s.id as string, name: s.name as string }))}
              ids={f.storeIds} defaultId={f.storeId} onChange={(ids, def) => setF(x => ({ ...x, storeIds: ids, storeId: def }))} />
          </FormField>
        </div>
      )}

      {step === 'security' && (
        <div style={{ display: 'grid', gap: 4 }}>
          <div className="usr-row" style={{ padding: '0 0 14px' }}>
            <div><b>Double authentification</b><p>{requiredByRole ? 'Déjà exigée par un des rôles choisis.' : 'Non exigée par les rôles choisis.'}</p></div>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={f.mfaRequired || requiredByRole} disabled={requiredByRole} onChange={e => set('mfaRequired', e.target.checked)} /> Exiger pour ce compte
            </label>
          </div>
          <div className="usr-row" style={{ padding: '14px 0 0' }}>
            <div><b>Code PIN de caisse</b><p>Utile seulement sur les postes partagés (caisse, pesée).</p></div>
            <input className="ds-input" style={{ width: 160 }} inputMode="numeric" placeholder="6 chiffres au moins" aria-label="Code PIN" value={f.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
      )}

      {step === 'review' && (
        <>
          {f.roles.length < 2 || (sod && violations.length === 0)
            ? <Alert tone="success" icon={ShieldCheck}>Aucun conflit de séparation des tâches avec les rôles choisis.</Alert>
            : !sod ? <Alert tone="info">Vérification des conflits…</Alert>
            : <Alert tone={blocked ? 'danger' : 'warning'} icon={TriangleAlert}>
                {violations.map(v => v.label).join(' ; ')}{blocked ? ' — la création sera refusée (mode Bloquer).' : ' — signalé, non bloqué (mode Observer).'}
              </Alert>}
          <dl className="usr-kv">
            <dt>Compte</dt><dd>{f.firstName} {f.lastName} · {f.email}</dd>
            <dt>Premier accès</dt><dd>{f.access === 'invite' ? 'Invitation par e-mail, valable 72 h' : 'Mot de passe provisoire, à changer à la première connexion'}</dd>
            <dt>Rôles</dt><dd>{f.roles.map(c => `${label(c)}${c === f.primary ? ' (principal)' : ''}`).join(', ')}</dd>
            <dt>Établissements</dt><dd>{f.storeIds.length ? f.storeIds.map(id => `${stores.find(s => s.id === id)?.name as string ?? id}${id === f.storeId && f.storeIds.length > 1 ? ' (par défaut)' : ''}`).join(', ') : 'Aucun'}</dd>
            <dt>Sécurité</dt><dd>{f.mfaRequired || requiredByRole ? '2FA exigée' : '2FA non exigée'} · {f.pin ? 'code PIN défini' : 'sans code PIN'}</dd>
            <dt>Fiche salarié</dt><dd>{employees.find(e => e.id === f.employeeId)?.name ?? 'Aucune'}</dd>
          </dl>
        </>
      )}
    </Modal>
  );
}

/** Lien d'invitation (renvoi depuis Comptes ou la fiche) : e-mail parti, ou lien à transmettre soi-même. */
export function InvitationSentModal({ result, email, onClose }: { result: InvitationResult; email: string; onClose: () => void }) {
  const link = `${window.location.origin}${result.path}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); notify.success('Lien copié'); }
    catch { notify.error('Copie impossible : sélectionnez le lien à la main'); }
  };
  return (
    <Modal title="Invitation envoyée" subtitle={email} onClose={onClose} width={600}
      footer={<button type="button" className="odoo-btn-primary" onClick={onClose}>Fermer</button>}>
      {result.emailQueued
        ? <Alert tone="success" icon={Mail}>Invitation envoyée à {email}. Le lien précédent ne fonctionne plus ; le nouveau est valable 72 heures.</Alert>
        : <Alert tone="warning" icon={Mail}>L'envoi d'e-mails n'est pas configuré : transmettez vous-même ce lien. Il est valable 72 heures ; le lien précédent ne fonctionne plus.</Alert>}
      <FormField label="Lien d'invitation" htmlFor="resend-link" hint="Ne le transmettez qu'à la personne concernée.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="resend-link" className="ds-input" readOnly value={link} onFocus={e => e.currentTarget.select()} />
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void copy()}><Copy size={13} aria-hidden="true" /> Copier</button>
        </div>
      </FormField>
    </Modal>
  );
}
