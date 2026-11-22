import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, ShieldOff, ShieldAlert, Unlock, LogOut, KeyRound, Trash2, UserCheck, UserX, Check, Smartphone, Lock,
} from 'lucide-react';
import { usersApi, rolesApi } from '../../api/users.api';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import type { RowMenuItem } from '../../components/ui/RowMenu';
import { SubmitButton, LoadingPanel } from '../employees/ui';
import { Modal, ErrorState } from '../../components/ds';
import { ROLE_LABELS } from '@ofauria/shared';

/**
 * Sécurité des comptes (mig 617) : double authentification exigée ou réinitialisée,
 * verrouillage, sessions, mot de passe imposé, désactivation et suppression définitive.
 * Une seule source d'actions sert le menu de la liste, la fiche et la politique par rôle.
 */

export type UserRow = Record<string, any>;

export function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export const fullName = (u: UserRow) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();

const DT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = 86_400_000;

/** « Aujourd'hui 14:05 », « Hier 09:12 », « Il y a 5 j », puis la date. */
export function formatLastLogin(at: string | null | undefined): string {
  if (!at) return 'Jamais';
  const d = new Date(at);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  if (diff <= 0) return `Aujourd'hui ${hm}`;
  if (diff === 1) return `Hier ${hm}`;
  if (diff < 30) return `Il y a ${diff} j`;
  return d.toLocaleDateString('fr-FR');
}
export const formatDateTime = (at: string | null | undefined) => (at ? DT.format(new Date(at)) : '—');

/** Mot de passe provisoire conforme à la politique (12+ caractères, 4 familles). */
export function generatePassword(length = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?-+'];
  const all = sets.join('');
  const rnd = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = sets.map(s => s[rnd(s.length)]);
  while (chars.length < length) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/** État de la double authentification d'un compte. */
export function MfaTag({ u }: { u: UserRow }) {
  if (u.mfaEnabled) return <StatusTag tone="done" label="Activée" icon={ShieldCheck} />;
  if (u.mfaRequired) {
    return <StatusTag tone="todo" label="À configurer" icon={ShieldAlert}
      title={u.mfaRequiredByRole ? 'Exigée par le rôle : configurée à la prochaine connexion' : 'Exigée pour ce compte : configurée à la prochaine connexion'} />;
  }
  return <span style={{ color: 'var(--ds-muted)', fontSize: 13 }}>Non exigée</span>;
}

export type AccountAction =
  | 'mfaRequire' | 'mfaUnrequire' | 'mfaReset' | 'unlock' | 'revoke'
  | 'mustChange' | 'mustChangeOff' | 'deactivate' | 'activate' | 'delete';

interface ActionSpec {
  call: (u: UserRow) => Promise<unknown>;
  done: string;
  confirm?: (u: UserRow) => { message: string; title: string; label: string; danger?: boolean };
}

const ACTIONS: Record<AccountAction, ActionSpec> = {
  mfaRequire: {
    call: u => usersApi.setMfaRequired(u.id, true), done: 'Double authentification exigée',
    confirm: u => ({ title: 'Exiger la double authentification ?', label: 'Exiger',
      message: `${fullName(u)} devra configurer une application d'authentification (Google Authenticator, Microsoft Authenticator…) à sa prochaine connexion, avant tout autre écran.` }),
  },
  mfaUnrequire: { call: u => usersApi.setMfaRequired(u.id, false), done: 'Double authentification plus exigée pour ce compte' },
  mfaReset: {
    call: u => usersApi.resetMfa(u.id), done: 'Double authentification réinitialisée',
    confirm: u => ({ title: 'Réinitialiser la double authentification ?', label: 'Réinitialiser', danger: true,
      message: `À faire si ${fullName(u)} a perdu son téléphone ou supprimé l'application. Son secret et ses codes de secours sont effacés et ses sessions fermées.${u.mfaRequired ? ' Elle reste exigée : elle sera reconfigurée à la prochaine connexion.' : ''}` }),
  },
  unlock: { call: u => usersApi.unlock(u.id), done: 'Compte déverrouillé' },
  revoke: {
    call: u => usersApi.revokeSessions(u.id), done: 'Sessions fermées',
    confirm: u => ({ title: 'Fermer toutes les sessions ?', label: 'Fermer les sessions',
      message: `${fullName(u)} sera déconnecté de tous ses appareils (caisse, ordinateur, téléphone) et devra se reconnecter.` }),
  },
  mustChange: {
    call: u => usersApi.setMustChangePassword(u.id, true), done: 'Changement de mot de passe imposé',
    confirm: u => ({ title: 'Imposer un nouveau mot de passe ?', label: 'Imposer',
      message: `À sa prochaine connexion, ${fullName(u)} devra choisir un nouveau mot de passe avant d'accéder à l'application.` }),
  },
  mustChangeOff: { call: u => usersApi.setMustChangePassword(u.id, false), done: 'Changement de mot de passe levé' },
  deactivate: {
    call: u => usersApi.update(u.id, { isActive: false }), done: 'Compte désactivé',
    confirm: u => ({ title: 'Désactiver le compte ?', label: 'Désactiver', danger: true,
      message: `${fullName(u)} ne pourra plus se connecter (mot de passe ni code PIN) et ses sessions sont fermées. Son historique est conservé ; le compte se réactive à tout moment.` }),
  },
  activate: { call: u => usersApi.update(u.id, { isActive: true }), done: 'Compte réactivé' },
  delete: {
    call: u => usersApi.removePermanently(u.id), done: 'Compte supprimé définitivement',
    confirm: u => ({ title: 'Supprimer définitivement ?', label: 'Supprimer définitivement', danger: true,
      message: `Le compte de ${fullName(u)} (${u.email}) sera effacé. Possible seulement s'il n'a jamais servi (aucune opération enregistrée) ; sinon, désactivez-le. Cette action est irréversible.` }),
  },
};

/** Exécute une action de sécurité (avec confirmation si besoin). Rend true en cas de succès. */
export function useAccountActions() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [pending, setPending] = useState<AccountAction | null>(null);
  const run = async (action: AccountAction, u: UserRow): Promise<boolean> => {
    const spec = ACTIONS[action];
    const c = spec.confirm?.(u);
    if (c && !(await confirm(c.message, { title: c.title, confirmLabel: c.label, danger: c.danger }))) return false;
    setPending(action);
    try {
      await spec.call(u);
      notify.success(spec.done);
      return true;
    } catch (err) {
      notify.error(errorMessage(err, 'Action refusée'));
      return false;
    } finally {
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  };
  return { run, pending };
}

/** Actions de sécurité du menu « ⋯ » d'une ligne de compte. */
export function securityMenuItems(u: UserRow, run: (a: AccountAction, u: UserRow) => void, selfId?: string): RowMenuItem[] {
  const self = u.id === selfId;
  const items: (RowMenuItem | false)[] = [
    !u.mfaRequired && !u.mfaEnabled && { label: 'Exiger la double authentification', icon: ShieldCheck, onSelect: () => run('mfaRequire', u) },
    !!u.mfaRequiredForUser && { label: 'Ne plus exiger la double authentification', icon: ShieldOff, onSelect: () => run('mfaUnrequire', u) },
    // Jamais sa propre 2FA (un autre administrateur, ou /auth/mfa/disable avec mot de passe + code).
    !self && !!u.mfaEnabled && { label: 'Réinitialiser la double authentification', icon: Smartphone, onSelect: () => run('mfaReset', u) },
    !!u.lockedUntil && { label: 'Déverrouiller', icon: Unlock, onSelect: () => run('unlock', u) },
    u.mustChangePassword
      ? { label: 'Lever le changement de mot de passe', icon: KeyRound, onSelect: () => run('mustChangeOff', u) }
      : { label: 'Imposer un nouveau mot de passe', icon: KeyRound, onSelect: () => run('mustChange', u) },
    !self && !!u.isActive && { label: 'Fermer toutes les sessions', icon: LogOut, onSelect: () => run('revoke', u) },
    !self && (u.isActive
      ? { label: 'Désactiver le compte', icon: UserX, danger: true, onSelect: () => run('deactivate', u) }
      : { label: 'Réactiver le compte', icon: UserCheck, onSelect: () => run('activate', u) }),
    !self && { label: 'Supprimer définitivement', icon: Trash2, danger: true, onSelect: () => run('delete', u) },
  ];
  return items.filter(Boolean) as RowMenuItem[];
}

/* ============ FICHE : SECTION SÉCURITÉ ============ */

function Row({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--ds-sep)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--ds-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>{children}</div>
      </div>
      {actions && <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div>}
    </div>
  );
}


/**
 * Section « Sécurité du compte » de la fiche : lit l'état à jour dans la liste (cache
 * ['users']) pour refléter chaque action sans rouvrir la fiche.
 */
export function SecuritySection({ userId, selfId, onDeleted }: { userId: string; selfId?: string; onDeleted: () => void }) {
  const { data: users = [] } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { run, pending } = useAccountActions();
  const u = users.find(x => x.id === userId);
  if (!u) return null;
  const self = u.id === selfId;
  const busy = !!pending;

  return (
    <div>
      <h3 className="ds-subhead" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 2px' }}>
        <Lock size={14} aria-hidden="true" /> Sécurité du compte
      </h3>
      <Row title="Double authentification"
        actions={<>
          {u.mfaRequiredForUser
            ? <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('mfaUnrequire', u)}><ShieldOff size={13} /> Ne plus exiger</button>
            : !u.mfaRequiredByRole && <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('mfaRequire', u)}><ShieldCheck size={13} /> Exiger</button>}
          {u.mfaEnabled && !self && (
            <button type="button" className="ds-btn-danger ds-btn-sm" disabled={busy} onClick={() => void run('mfaReset', u)}><Smartphone size={13} /> Réinitialiser</button>
          )}
        </>}>
        <MfaTag u={u} />
        <span>
          {u.mfaRequiredByRole ? 'Exigée par le rôle (bouton « Double authentification » de la liste).'
            : u.mfaRequiredForUser ? 'Exigée pour ce compte.'
            : u.mfaEnabled ? 'Activée par l\'utilisateur.' : 'Code à 6 chiffres d\'une application, en plus du mot de passe.'}
          {self && u.mfaEnabled && ' Votre propre double authentification ne se réinitialise pas ici : demandez-le à un autre administrateur.'}
        </span>
      </Row>
      <Row title="Connexion"
        actions={u.lockedUntil && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('unlock', u)}><Unlock size={13} /> Déverrouiller</button>
        )}>
        {u.lockedUntil
          ? <><StatusTag tone="blocked" label="Verrouillé" /> jusqu'à {formatDateTime(u.lockedUntil)} après {u.failedLoginCount} échecs</>
          : <>Dernière connexion : {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'jamais'}{u.failedLoginCount > 0 && ` · ${u.failedLoginCount} échec${u.failedLoginCount > 1 ? 's' : ''} récent${u.failedLoginCount > 1 ? 's' : ''}`}</>}
      </Row>
      <Row title="Mot de passe"
        actions={u.mustChangePassword
          ? <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('mustChangeOff', u)}>Lever</button>
          : <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('mustChange', u)}><KeyRound size={13} /> Imposer un nouveau</button>}>
        {u.mustChangePassword ? <StatusTag tone="todo" label="À changer à la prochaine connexion" /> : 'À jour. Pour le remplacer vous-même, saisissez un nouveau mot de passe plus haut.'}
      </Row>
      {!self && (
        <Row title="Sessions ouvertes"
          actions={<button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy || !u.isActive} onClick={() => void run('revoke', u)}><LogOut size={13} /> Tout fermer</button>}>
          Déconnecte le compte de tous ses appareils.
        </Row>
      )}
      {!self && (
        <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--ds-sep)', borderRadius: 10, display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Désactivation et suppression</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {u.isActive
              ? <button type="button" className="ds-btn-danger ds-btn-sm" disabled={busy} onClick={() => void run('deactivate', u)}><UserX size={13} /> Désactiver le compte</button>
              : <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => void run('activate', u)}><UserCheck size={13} /> Réactiver le compte</button>}
            <button type="button" className="ds-btn-danger ds-btn-sm" disabled={busy}
              onClick={async () => { if (await run('delete', u)) onDeleted(); }}>
              <Trash2 size={13} /> Supprimer définitivement
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>
            La suppression n'est possible que pour un compte qui n'a jamais servi (créé par erreur). Un compte utilisé se désactive : son historique reste traçable.
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ POLITIQUE PAR RÔLE ============ */

export function MfaPolicyModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: policy, isLoading, isError, error, refetch } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const [selected, setSelected] = useState<string[] | null>(null);
  // Codes de la politique absents des rôles de la base (ex. rôle par défaut jamais créé) :
  // ni affichés ni renvoyés, sinon l'enregistrement serait refusé (« Rôle inconnu »).
  const known = (codes: string[]) => (roles.length ? codes.filter(c => roles.some(r => r.code === c)) : codes);
  const current = known(selected ?? policy?.requiredRoles ?? []);
  const save = useMutation({
    mutationFn: () => usersApi.setMfaPolicy(current),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mfa-policy'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notify.success('Politique de double authentification enregistrée');
      onClose();
    },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const choices: (readonly [string, string, number | undefined])[] = roles.length
    ? roles.filter(r => r.is_active || current.includes(r.code)).map(r => [r.code, r.label, r.user_count] as const)
    : Object.entries(ROLE_LABELS).map(([c, l]) => [c, l as string, undefined] as const);
  const toggle = (code: string) => setSelected(current.includes(code) ? current.filter(c => c !== code) : [...current, code]);

  return (
    <Modal subtitle="Utilisateurs" title="Double authentification" width={560} onClose={onClose} locked={save.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={isLoading} onClick={() => save.mutate()}><Check size={13} /> Enregistrer</SubmitButton>
      </>}>
      <StatusBanner tone="info" icon={ShieldCheck} title="Rôles qui doivent l'activer">
        Un compte qui porte l'un de ces rôles doit configurer une application d'authentification à sa prochaine connexion, avant tout autre écran.
        Vous pouvez aussi l'exiger compte par compte depuis la fiche utilisateur.
      </StatusBanner>
      {isError ? <ErrorState bare error={error} title="La politique n'a pas pu être chargée" onRetry={() => void refetch()} /> : isLoading ? <LoadingPanel /> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {choices.map(([code, label, count]) => {
            const on = current.includes(code);
            return (
              <button key={code} type="button" className="odoo-filter-chip" aria-pressed={on} onClick={() => toggle(code)}
                style={{ background: on ? 'var(--ds-tint)' : 'var(--ds-card)', color: 'var(--ds-ink)', fontWeight: on ? 600 : undefined, borderColor: on ? 'var(--ds-accent)' : 'var(--ds-line)', padding: '0.25rem 0.625rem', fontSize: 12 }}>
                {on && <Check size={11} />} {label}{!!count && <span style={{ opacity: 0.75 }}> · {count}</span>}
              </button>
            );
          })}
        </div>
      )}
      {!current.includes('admin') && !isLoading && (
        <StatusBanner tone="warning" icon={ShieldAlert} title="Administrateur non protégé">
          Il est recommandé d'exiger la double authentification pour les administrateurs.
        </StatusBanner>
      )}
    </Modal>
  );
}
