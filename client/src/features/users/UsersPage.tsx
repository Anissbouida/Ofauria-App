import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usersApi, rolesApi, governanceApi, type SecurityPolicy as SecurityPolicyValues, type AccessChangeKind, type AccessChangeRow } from '../../api/users.api';
import RolesPanel from './RolesPanel';
import ControlsPanel, { DelegationsPanel } from './ControlsPanel';
import RoleActionMatrix from './RoleActionMatrix';
import UsersOverview, { needsSecurityAction } from './UsersOverview';
import AccountDrawer from './AccountDrawer';
import NewUserWizard, { InvitationSentModal } from './NewUserWizard';
import type { InvitationResult } from '../../api/users.api';
import { LoginsView } from '../settings/AuditLogTab';
import { ModuleShell, ModulePage, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { usePermissions } from '../../context/PermissionsContext';
import './users.css';
import AccessReviewTab, { AccessReviewModal } from './AccessReviewPanel';
import { storesApi } from '../../api/stores.api';
import {
  Plus, Pencil, KeyRound, Settings2, Lock, Users, UserCheck, UserX,
  ShieldCheck, Scale, ScanSearch, LogOut,
  LayoutDashboard, ArrowRightLeft, History, ListChecks, ClipboardCheck, Smartphone, Mail,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu } from '../../components/ui/RowMenu';
import { HrHeaderSlot } from '../employees/ui';
import { FilterChips } from '../sales/ListTemplate';
import {
  Toolbar, SearchBar, DataPanel, FormFooter, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, SectionHeader, Alert,
} from '../../components/ds';
import { useAuth } from '../../context/AuthContext';
import {
  MfaPolicyModal, securityMenuItems, useAccountActions, formatLastLogin, formatDateTime,
  errorMessage, fullName,
} from './AccountSecurity';
import '../employees/employees.css';
import '../sales/sales.css';
import { ROLE_LABELS } from '@ofauria/shared';
import '../settings/settings.css';

type UserRow = Record<string, any>;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type UsersView = 'overview' | 'accounts' | 'review' | 'delegations' | 'journal' | 'matrix' | 'roles' | 'controls' | 'security' | 'approvals';

const LEADS: Record<UsersView, string> = {
  overview: 'Comptes, droits et sécurité de votre société.',
  accounts: 'Personnes qui se connectent à Kalum, leurs rôles et leur sécurité.',
  review: 'Contrôle périodique des droits accordés à chaque compte.',
  delegations: 'Rôles confiés pour une période à un autre compte.',
  journal: 'Connexions, échecs, verrouillages et actions de sécurité sur les comptes.',
  matrix: 'Permissions détaillées de chaque rôle, action par action.',
  roles: 'Ce que chaque fonction peut voir et faire dans Kalum.',
  controls: 'Séparation des tâches, plafonds d\'approbation, délégations et contrôle des droits.',
  security: 'Règles de connexion valables pour tous les comptes.',
  approvals: '',
};

/**
 * Module Utilisateurs (refonte 2026-11, lot 1) : coquille commune à rubriques — Tableau de bord,
 * Opérations (comptes, revue, délégations), Rapports (journal des connexions, droits par rôle),
 * Paramétrage (rôles, contrôles internes, sécurité, circuits d'approbation).
 */
export default function UsersPage() {
  const { hasModule } = usePermissions();
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data: users = [] } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: violations = [] } = useQuery({ queryKey: ['sod-violations'], queryFn: governanceApi.sodViolations, retry: false });
  const todoCount = users.filter(needsSecurityAction).length;

  const views: ModuleView<UsersView>[] = [
    { key: 'overview', label: "Vue d'ensemble", icon: LayoutDashboard, section: 'dashboard' },
    { key: 'accounts', label: 'Comptes', icon: Users, section: 'operations', badge: todoCount },
    { key: 'review', label: 'Revue des accès', icon: ScanSearch, section: 'operations' },
    { key: 'delegations', label: 'Délégations', icon: ArrowRightLeft, section: 'operations' },
    { key: 'journal', label: 'Journal des connexions', icon: History, section: 'reports' },
    { key: 'matrix', label: 'Droits par rôle', icon: ListChecks, section: 'reports' },
    { key: 'roles', label: 'Rôles', icon: ShieldCheck, section: 'setup' },
    { key: 'controls', label: 'Contrôles internes', icon: Scale, section: 'setup', badge: violations.length },
    { key: 'security', label: 'Sécurité et connexions', icon: Lock, section: 'setup' },
    { key: 'approvals', label: "Circuits d'approbation", icon: ClipboardCheck, section: 'setup', href: '/settings?page=approvals', external: true, hidden: !hasModule('settings') },
  ];
  const { current, select } = useModuleView(views);
  // Ancienne adresse ?tab=governance : Contrôles internes.
  useEffect(() => {
    if (params.get('tab') === 'governance') { const n = new URLSearchParams(params); n.set('tab', 'controls'); setParams(n, { replace: true }); }
  }, [params, setParams]);

  const navigate = useNavigate();
  // Création : fenêtre ; un compte existant s'ouvre en page (fiche, lot 2).
  const [editing, setEditing] = useState<'new' | null>(null);
  const openRecord = (u: UserRow) => navigate(`/users/${u.id}`);
  const [preview, setPreview] = useState<UserRow | null>(null);
  const [reviewUser, setReviewUser] = useState<UserRow | null>(null);
  // Emplacement des actions de l'écran actif (ex. « Nouveau rôle »), à droite du fil d'Ariane.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const view = current?.key ?? 'overview';

  return (
    <HrHeaderSlot.Provider value={headerSlot}>
      <ModuleShell title="Utilisateurs" views={views} current={current} onSelect={select} flush
        actions={(
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div ref={setHeaderSlot} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} />
            {(view === 'overview' || view === 'accounts') && (
              <button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={13} aria-hidden="true" /> Nouvel utilisateur
              </button>
            )}
          </div>
        )}>
        <ModulePage title={current?.label} summary={current ? LEADS[current.key] : undefined}>
          <div className="odoo-scope usr-module" style={{ background: 'transparent' }}>
            {view === 'overview' && <UsersOverview onOpenAccount={setPreview} onGo={select} />}
            {view === 'accounts' && <AccountsTab onEdit={openRecord} onPreview={setPreview} onReview={setReviewUser} />}
            {view === 'review' && <AccessReviewTab />}
            {view === 'delegations' && <DelegationsPanel />}
            {view === 'journal' && <LoginsView users={users} />}
            {view === 'matrix' && <RoleActionMatrix roles={roles} />}
            {view === 'roles' && <RolesPanel />}
            {view === 'controls' && <ControlsPanel />}
            {view === 'security' && <SecurityPolicy roles={roles} />}
          </div>
        </ModulePage>
      </ModuleShell>

      {preview && (
        <AccountDrawer user={preview} selfId={me?.id} onClose={() => setPreview(null)}
          onOpen={u => { setPreview(null); openRecord(u); }} onReview={u => setReviewUser(u)} />
      )}
      {reviewUser && <AccessReviewModal userId={reviewUser.id as string} name={fullName(reviewUser)} onClose={() => setReviewUser(null)} />}
      {editing && <NewUserWizard onClose={() => setEditing(null)} onOpen={u => { setEditing(null); openRecord(u); }} />}
    </HrHeaderSlot.Provider>
  );
}

/* ============ SÉCURITÉ ET CONNEXIONS ============ */

const DAYS = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;
const IDLE_LABELS: Record<number, string> = { 15: '15 minutes', 60: '1 heure', 480: '8 heures', 1440: '24 heures' };

/**
 * Règles de connexion valables pour tous les comptes (refonte Utilisateurs, lot 8, mig 708) :
 * double authentification par rôle et délai pour la configurer, mot de passe et verrouillage,
 * code PIN, déconnexion après inactivité. Valeurs par défaut = celles fixées jusqu'ici dans le code.
 */
function SecurityPolicy({ roles }: { roles: { code: string; label: string; user_count: number }[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: mfa } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });
  const { data: loaded, isError, error, refetch } = useQuery({ queryKey: ['security-policy'], queryFn: usersApi.securityPolicy, retry: false });
  const [draft, setDraft] = useState<SecurityPolicyValues | null>(null);
  useEffect(() => { if (loaded) setDraft(loaded.policy); }, [loaded]);
  const required = (mfa?.requiredRoles ?? []).filter(c => roles.some(r => r.code === c));
  const label = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const save = useMutation({
    mutationFn: (p: SecurityPolicyValues) => usersApi.setSecurityPolicy(p),
    onSuccess: () => { notify.success('Politique de sécurité enregistrée'); queryClient.invalidateQueries({ queryKey: ['security-policy'] }); },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  if (isError) return <ErrorState error={error} title="La politique de sécurité n'a pas pu être chargée" onRetry={() => void refetch()} />;
  if (!loaded || !draft) return <LoadingState />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.policy);
  const set = <K extends keyof SecurityPolicyValues>(k: K, v: number) => setDraft(d => (d ? { ...d, [k]: v } : d));
  const range = (k: keyof SecurityPolicyValues) => loaded.limits[k] as { min: number; max: number };
  const list = (k: keyof SecurityPolicyValues) => loaded.limits[k] as number[];
  const num = (k: keyof SecurityPolicyValues, unit: string, aria: string) => {
    const r = range(k);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input type="number" className="ds-input sm" style={{ width: 76 }} min={r.min} max={r.max} value={draft[k]} aria-label={aria}
          onChange={e => set(k, Number(e.target.value))} />
        <span style={{ color: 'var(--ds-muted)' }}>{unit}</span>
      </span>
    );
  };
  const outOfRange = (['passwordMinLength', 'lockoutThreshold', 'lockoutMinutes'] as const)
    .some(k => !Number.isInteger(draft[k]) || draft[k] < range(k).min || draft[k] > range(k).max);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Double authentification">
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setOpen(true)}>Modifier les rôles</button>
        </SectionHeader>
        <DataPanel label="Double authentification">
          <div className="usr-row">
            <div><b>Rôles qui doivent l'utiliser</b><p>S'ajoute à l'exigence posée compte par compte, depuis la fiche du compte.</p></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {required.length ? required.map(c => <span key={c} className="kl-tag b">{label(c)}</span>) : <span style={{ color: 'var(--ds-muted)' }}>Aucun rôle</span>}
            </div>
          </div>
          <div className="usr-row">
            <div><b>Délai pour la configurer</b><p>Compté depuis la première connexion où elle est exigée. Après ce délai, la connexion passe directement par la configuration.</p></div>
            <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Délai pour configurer la double authentification" value={draft.mfaGraceDays} onChange={e => set('mfaGraceDays', Number(e.target.value))}>
              {list('mfaGraceDays').map(n => <option key={n} value={n}>{n ? DAYS(n) : 'Dès la prochaine connexion'}</option>)}
            </select>
          </div>
          {!required.includes('admin') && (
            <div style={{ padding: '0 20px 16px' }}><Alert tone="warning">Le rôle Administrateur n'exige pas la double authentification.</Alert></div>
          )}
        </DataPanel>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Mot de passe et verrouillage" />
        <DataPanel label="Mot de passe et verrouillage">
          <div className="usr-row">
            <div><b>Longueur minimale du mot de passe</b><p>Avec majuscule, minuscule, chiffre et caractère spécial. Un mot de passe plus court est à changer à la prochaine connexion.</p></div>
            {num('passwordMinLength', 'caractères', 'Longueur minimale du mot de passe')}
          </div>
          <div className="usr-row">
            <div><b>Renouvellement</b><p>Passé ce délai, la personne choisit un nouveau mot de passe à sa connexion.</p></div>
            <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Renouvellement du mot de passe" value={draft.passwordMaxAgeDays} onChange={e => set('passwordMaxAgeDays', Number(e.target.value))}>
              {list('passwordMaxAgeDays').map(n => <option key={n} value={n}>{n ? `Tous les ${n} jours` : 'Jamais'}</option>)}
            </select>
          </div>
          <div className="usr-row">
            <div><b>Verrouillage après des échecs</b><p>Mot de passe ou code PIN. Le compte se déverrouille seul après la durée choisie, ou depuis sa fiche.</p></div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {num('lockoutThreshold', 'échecs, pendant', 'Nombre d\'échecs avant verrouillage')}
              {num('lockoutMinutes', 'min', 'Durée du verrouillage en minutes')}
            </span>
          </div>
          <div className="usr-row">
            <div><b>Code PIN de caisse</b><p>Pour la connexion rapide sur les postes partagés. Les codes plus courts sont signalés « à renouveler ».</p></div>
            <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Longueur minimale du code PIN" value={draft.pinMinLength} onChange={e => set('pinMinLength', Number(e.target.value))}>
              {list('pinMinLength').map(n => <option key={n} value={n}>{n} chiffres minimum</option>)}
            </select>
          </div>
        </DataPanel>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Sessions et inscription" />
        <DataPanel label="Sessions et inscription">
          <div className="usr-row">
            <div><b>Déconnexion après inactivité</b><p>Un avertissement s'affiche deux minutes avant. Les sessions ouvertes se voient dans la fiche de chaque compte.</p></div>
            <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Déconnexion après inactivité" value={draft.idleMinutes} onChange={e => set('idleMinutes', Number(e.target.value))}>
              {list('idleMinutes').map(n => <option key={n} value={n}>{IDLE_LABELS[n] ?? `${n} minutes`}</option>)}
            </select>
          </div>
          <div className="usr-row">
            <div><b>Compte dormant</b><p>Sans connexion depuis ce délai, le compte est signalé dans la vue d'ensemble et dans la revue des accès.</p></div>
            <select className="ds-input sm" style={{ width: 'auto' }} aria-label="Compte dormant après" value={draft.dormantDays} onChange={e => set('dormantDays', Number(e.target.value))}>
              {list('dormantDays').map(n => <option key={n} value={n}>Après {n} jours</option>)}
            </select>
          </div>
          <div className="usr-row">
            <div><b>Inscription libre</b><p>Un compte se crée seulement depuis Utilisateurs, par une personne qui en a le droit.</p></div>
            <span className="kl-tag x">Désactivée</span>
          </div>
        </DataPanel>
      </section>

      <FormFooter dirty={dirty} busy={save.isPending} disabled={!dirty || outOfRange}
        onCancel={() => setDraft(loaded.policy)} onSubmit={() => save.mutate(draft)} />
      <SensitiveChanges />
      {open && <MfaPolicyModal onClose={() => setOpen(false)} />}
    </div>
  );
}

const ACCESS_KINDS: { key: AccessChangeKind; label: string }[] = [
  { key: 'grant_admin', label: 'Attribuer le rôle Administrateur' },
  { key: 'grant_mfa_role', label: 'Attribuer un rôle à double authentification exigée' },
  { key: 'role_rights', label: 'Modifier les droits d\'un rôle' },
  { key: 'mfa_role_removed', label: 'Retirer la double authentification d\'un rôle' },
];
const CHANGE_STATUS: Record<AccessChangeRow['status'], { tone: 'todo' | 'done' | 'cancelled' | 'blocked'; label: string }> = {
  pending: { tone: 'todo', label: 'En attente' }, applied: { tone: 'done', label: 'Appliqué' },
  rejected: { tone: 'cancelled', label: 'Refusé' }, failed: { tone: 'blocked', label: 'Échec' },
};

/**
 * Comptes et changements sensibles (refonte Utilisateurs, lot 10) : administration déléguée
 * (expliquée, réglée par les droits des rôles) et changements soumis à l'approbation d'un second
 * administrateur, avec les demandes récentes.
 */
function SensitiveChanges() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isError, error, refetch } = useQuery({ queryKey: ['access-approvals'], queryFn: usersApi.accessApprovals, retry: false });
  const [kinds, setKinds] = useState<AccessChangeKind[] | null>(null);
  useEffect(() => { if (data) setKinds(data.kinds); }, [data]);
  const save = useMutation({
    mutationFn: (k: AccessChangeKind[]) => usersApi.setAccessApprovals(k),
    onSuccess: () => { notify.success('Changements soumis à approbation enregistrés'); queryClient.invalidateQueries({ queryKey: ['access-approvals'] }); },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  if (isError) return <ErrorState error={error} title="Les changements sensibles n'ont pas pu être chargés" onRetry={() => void refetch()} />;
  if (!data || !kinds) return <LoadingState />;
  const single = data.activeAdmins < 2;
  const dirty = JSON.stringify([...kinds].sort()) !== JSON.stringify([...data.kinds].sort());
  const toggle = (k: AccessChangeKind) => setKinds(c => (c ?? []).includes(k) ? (c ?? []).filter(x => x !== k) : [...(c ?? []), k]);
  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <SectionHeader title="Comptes et changements sensibles" />
      <DataPanel label="Comptes et changements sensibles">
        <div className="usr-row">
          <div><b>Qui peut gérer des comptes</b><p>Donnez les droits « Utilisateurs » (consulter, créer, modifier) à un rôle depuis sa fiche. Ses titulaires gèrent les comptes de leurs établissements, sans attribuer le rôle Administrateur ni modifier un administrateur ou un autre gestionnaire.</p></div>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/users?tab=roles')}>Rôles</button>
        </div>
        <div className="usr-row" style={{ alignItems: 'flex-start' }}>
          <div><b>Changements soumis à approbation</b><p>Mis en attente, puis appliqués quand un autre administrateur les approuve (circuit « Changement d'accès sensible », relance après 48 h).</p></div>
          <div style={{ display: 'grid', gap: 6 }}>
            {ACCESS_KINDS.map(k => (
              <label key={k.key} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14, color: single ? 'var(--ds-muted)' : undefined }}>
                <input type="checkbox" disabled={single} checked={kinds.includes(k.key)} onChange={() => toggle(k.key)} /> {k.label}
              </label>
            ))}
          </div>
        </div>
        {single && (
          <div style={{ padding: '0 20px 16px' }}>
            <Alert tone="info">Il faut au moins deux administrateurs actifs : personne ne peut approuver sa propre demande. Votre société en a {data.activeAdmins}.</Alert>
          </div>
        )}
      </DataPanel>
      {!single && <FormFooter dirty={dirty} busy={save.isPending} disabled={!dirty} onCancel={() => setKinds(data.kinds)} onSubmit={() => save.mutate(kinds)} />}
      {data.changes.length > 0 && (
        <DataPanel label="Demandes de changement">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Changement</th><th>Statut</th><th>Demandé par</th><th>Le</th><th>Décidé par</th><th className="ds-actions"><span className="sr-only">Ouvrir</span></th></tr></thead>
            <tbody>
              {data.changes.map(c => (
                <tr key={c.id}>
                  <td className="ds-strong">{c.label}{c.error && <div style={{ fontSize: 12, color: 'var(--ds-danger)' }}>{c.error}</div>}</td>
                  <td><StatusTag tone={CHANGE_STATUS[c.status].tone} label={CHANGE_STATUS[c.status].label} /></td>
                  <td>{c.requested_by_name ?? '—'}</td>
                  <td>{formatDateTime(c.requested_at)}</td>
                  <td>{c.decided_by_name ?? '—'}</td>
                  <td className="ds-actions">{c.status === 'pending' && <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate('/approvals')}>Approbations</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </section>
  );
}


/* ============ COMPTES ============ */

function useRoleLabel() {
  // Rôles éditables (mig 330) ; repli sur les libellés fixes si la liste n'est pas disponible.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const label = (code: string) => roles.find(r => r.code === code)?.label ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
  return { roles, label };
}

type Situation = 'active' | 'todo' | 'invited' | 'never' | 'inactive' | 'all';
type SecurityFilter = '' | 'mfa_on' | 'mfa_todo' | 'mfa_off' | 'locked' | 'pwd' | 'pin';
const SECURITY_FILTERS: { key: SecurityFilter; label: string }[] = [
  { key: '', label: 'Toute sécurité' },
  { key: 'mfa_on', label: 'Double auth. activée' },
  { key: 'mfa_todo', label: 'Double auth. à configurer' },
  { key: 'mfa_off', label: 'Double auth. non exigée' },
  { key: 'locked', label: 'Verrouillés' },
  { key: 'pwd', label: 'Mot de passe à changer' },
  { key: 'pin', label: 'PIN à renouveler' },
];
const matchSecurity = (u: UserRow, f: SecurityFilter) =>
  f === '' ? true
  : f === 'mfa_on' ? !!u.mfaEnabled
  : f === 'mfa_todo' ? !!u.mfaRequired && !u.mfaEnabled
  : f === 'mfa_off' ? !u.mfaRequired && !u.mfaEnabled
  : f === 'locked' ? !!u.lockedUntil
  : f === 'pwd' ? !!u.mustChangePassword
  : !!u.pinWeak;
const matchSituation = (u: UserRow, s: Situation) =>
  s === 'all' ? true
  : s === 'inactive' ? !u.isActive
  : !u.isActive ? false
  : s === 'todo' ? needsSecurityAction(u)
  : s === 'invited' ? !!u.invitationExpiresAt
  : s === 'never' ? !u.lastLoginAt && !u.invitationExpiresAt
  : true;

/** Signaux de sécurité d'une ligne : icône colorée + texte (jamais la couleur seule). */
function SecuritySignals({ u }: { u: UserRow }) {
  const line = (tone: 'ok' | 'todo' | 'none', Icon: typeof Lock, text: string) => (
    <span className={`usr-sig ${tone}`}><Icon size={13} aria-hidden="true" /> {text}</span>
  );
  return (
    <div className="usr-sigs">
      {u.mfaEnabled ? line('ok', Smartphone, '2FA activée')
        : u.mfaRequired ? line('todo', Smartphone, '2FA à configurer')
        : line('none', Smartphone, '2FA non exigée')}
      {!u.hasPin ? line('none', KeyRound, 'Sans PIN') : u.pinWeak ? line('todo', KeyRound, 'PIN à renouveler') : line('ok', KeyRound, 'PIN défini')}
      {u.mustChangePassword && line('todo', KeyRound, 'Mot de passe à changer')}
    </div>
  );
}

const initials = (u: UserRow) => (`${(u.firstName as string)?.[0] ?? ''}${(u.lastName as string)?.[0] ?? ''}` || (u.email as string)?.[0] || '?').toUpperCase();

function AccountsTab({ onEdit, onPreview, onReview }: {
  onEdit: (u: UserRow) => void; onPreview: (u: UserRow) => void; onReview: (u: UserRow) => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const selfId = me?.id;
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [security, setSecurity] = useState<SecurityFilter>('');
  const [situation, setSituation] = useState<Situation>('active');
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { run } = useAccountActions();

  const { data: users = [], isLoading, isError, error, refetch } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { roles, label: roleLabel } = useRoleLabel();
  const storeName = (id: unknown) => stores.find(s => s.id === id)?.name as string | undefined;
  // Lot 7 : établissements du compte (le défaut en tête).
  const storesOf = (u: UserRow): string[] => (Array.isArray(u.storeIds) ? u.storeIds : (u.storeId ? [u.storeId] : []));
  // Rôles multiples (mig 335) : repli sur le rôle principal si la liste est absente.
  const rolesOf = (u: UserRow): string[] => (Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []));

  const count = (s: Situation) => users.filter(u => matchSituation(u, s)).length;

  const shown = useMemo(() => {
    const n = normalize(q.trim());
    return users.filter(u =>
      matchSituation(u, situation)
      && (!roleFilter || rolesOf(u).includes(roleFilter))
      && (!storeFilter || (storeFilter === '-' ? !storesOf(u).length : storesOf(u).includes(storeFilter)))
      && matchSecurity(u, security)
      && (!n || normalize(`${u.firstName} ${u.lastName} ${u.email} ${rolesOf(u).map(roleLabel).join(' ')} ${storesOf(u).map(id => storeName(id) ?? '').join(' ')}`).includes(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, q, roleFilter, storeFilter, situation, security, roles, stores]);

  const roleOptions = [...new Set(users.flatMap(rolesOf))].sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));

  // Sélection multiple : limitée aux comptes affichés (un filtre qui masque une ligne la retire).
  const chosen = shown.filter(u => selected.has(u.id as string));
  const allChosen = shown.length > 0 && chosen.length === shown.length;
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(shown.map(u => u.id as string)));

  const bulk = async (label: string, targets: UserRow[], call: (u: UserRow) => Promise<unknown>, ask?: { title: string; message: string; danger?: boolean }) => {
    if (!targets.length) { notify.warning('Aucun compte sélectionné n\'est concerné'); return; }
    if (ask && !(await confirm(ask.message, { title: ask.title, confirmLabel: label, danger: ask.danger }))) return;
    setBulkBusy(true);
    const res = await Promise.allSettled(targets.map(call));
    setBulkBusy(false);
    queryClient.invalidateQueries({ queryKey: ['users'] });
    const ko = res.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    const ok = res.length - ko.length;
    if (ok) notify.success(`${label} : ${ok} compte${ok > 1 ? 's' : ''}`);
    if (ko.length) notify.error(`${ko.length} refusé${ko.length > 1 ? 's' : ''} : ${errorMessage(ko[0].reason, 'action refusée')}`);
    setSelected(new Set());
  };
  const others = chosen.filter(u => u.id !== selfId);
  // Invitation (re)envoyée : le lien s'affiche, pour le transmettre si l'e-mail ne part pas.
  const [sent, setSent] = useState<{ result: InvitationResult; email: string } | null>(null);
  const resend = async (u: UserRow) => {
    try { setSent({ result: await usersApi.invite(u.id), email: u.email }); queryClient.invalidateQueries({ queryKey: ['users'] }); }
    catch (err) { notify.error(errorMessage(err, 'Invitation refusée')); }
  };

  const filtered = !!q || !!roleFilter || !!storeFilter || !!security || situation !== 'active';
  const resetFilters = () => { setQ(''); setRoleFilter(''); setStoreFilter(''); setSecurity(''); setSituation('active'); };

  return (
    <>
      <FilterChips label="Situation" value={situation} onChange={k => setSituation(k as Situation)}
        chips={[
          { key: 'active', label: 'Actifs', count: count('active') },
          { key: 'todo', label: 'À traiter', count: count('todo') },
          { key: 'invited', label: 'Invitations en attente', count: count('invited') },
          { key: 'never', label: 'Jamais connectés', count: count('never') },
          { key: 'inactive', label: 'Désactivés', count: count('inactive') },
          { key: 'all', label: 'Tous', count: users.length },
        ]} />
      <Toolbar>
        <SearchBar value={q} onChange={setQ} placeholder="Rechercher un nom, un e-mail, un rôle…" />
        <select className="odoo-filter-dropdown" style={{ width: 'auto' }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filtrer par rôle">
          <option value="">Tous les rôles</option>
          {roleOptions.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select className="odoo-filter-dropdown" style={{ width: 'auto' }} value={storeFilter} onChange={e => setStoreFilter(e.target.value)} aria-label="Filtrer par établissement">
          <option value="">Tous les établissements</option>
          {stores.map(s => <option key={s.id as string} value={s.id as string}>{s.name as string}</option>)}
          <option value="-">Sans établissement</option>
        </select>
        <select className="odoo-filter-dropdown" style={{ width: 'auto' }} value={security} onChange={e => setSecurity(e.target.value as SecurityFilter)} aria-label="Filtrer par sécurité">
          {SECURITY_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </Toolbar>

      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => void refetch()} />
        : !users.length ? <EmptyState icon={Users} title="Aucun utilisateur" text="Les comptes de connexion apparaîtront ici." />
        : !shown.length ? <NoResultState text="Aucun compte ne correspond aux filtres." onReset={filtered ? resetFilters : undefined} />
        : (
        <DataPanel label="Comptes" footer={<TableFooter note={`${shown.length} compte${shown.length > 1 ? 's' : ''} affiché${shown.length > 1 ? 's' : ''} · ${users.length} au total`} />}
          bulk={chosen.length > 0 && (
            <div className="ds-bulk" role="region" aria-label="Actions sur la sélection">
              <strong>{chosen.length} compte{chosen.length > 1 ? 's' : ''} sélectionné{chosen.length > 1 ? 's' : ''}</strong>
              <span className="ds-grow" />
              {chosen.some(u => u.isActive) && <>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={bulkBusy} onClick={() => void bulk('Double authentification exigée', chosen.filter(u => u.isActive && !u.mfaRequired && !u.mfaEnabled), u => usersApi.setMfaRequired(u.id, true),
                  { title: 'Exiger la double authentification ?', message: 'Les comptes sélectionnés devront configurer une application d\'authentification à leur prochaine connexion.' })}>
                  <ShieldCheck size={13} aria-hidden="true" /> Exiger la double authentification
                </button>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={bulkBusy} onClick={() => void bulk('Changement de mot de passe imposé', chosen.filter(u => u.isActive && !u.mustChangePassword), u => usersApi.setMustChangePassword(u.id, true),
                  { title: 'Imposer un nouveau mot de passe ?', message: 'Les comptes sélectionnés devront choisir un nouveau mot de passe à leur prochaine connexion.' })}>
                  <KeyRound size={13} aria-hidden="true" /> Imposer un mot de passe
                </button>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={bulkBusy} onClick={() => void bulk('Sessions fermées', others.filter(u => u.isActive), u => usersApi.revokeSessions(u.id),
                  { title: 'Fermer les sessions ?', message: 'Les comptes sélectionnés seront déconnectés de tous leurs appareils.' })}>
                  <LogOut size={13} aria-hidden="true" /> Fermer les sessions
                </button>
              </>}
              {chosen.some(u => !u.isActive) && (
                <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={bulkBusy} onClick={() => void bulk('Comptes réactivés', chosen.filter(u => !u.isActive), u => usersApi.update(u.id, { isActive: true }))}>
                  <UserCheck size={13} aria-hidden="true" /> Réactiver
                </button>
              )}
              {others.some(u => u.isActive) && (
                <button type="button" className="ds-btn-danger ds-btn-sm" disabled={bulkBusy} onClick={() => void bulk('Comptes désactivés', others.filter(u => u.isActive), u => usersApi.update(u.id, { isActive: false }),
                  { title: 'Désactiver les comptes ?', message: 'Les comptes sélectionnés ne pourront plus se connecter ; leur historique est conservé. Votre propre compte n\'est jamais désactivé.', danger: true })}>
                  <UserX size={13} aria-hidden="true" /> Désactiver
                </button>
              )}
              <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => setSelected(new Set())}>Annuler la sélection</button>
            </div>
          )}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={allChosen} onChange={toggleAll} aria-label="Tout sélectionner" /></th>
                <th>Utilisateur</th><th>Rôles et établissement</th><th>Sécurité</th><th title="Dernière connexion réussie">Dernière connexion</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(u => {
                const store = storeName(u.storeId);
                const storeNames = [store, ...storesOf(u).filter(id => id !== u.storeId).map(id => storeName(id))].filter(Boolean) as string[];
                const name = fullName(u) || (u.email as string);
                return (
                  <tr key={u.id} id={`user-row-${u.id}`} className={`ds-clickable${selected.has(u.id) ? ' ds-selected' : ''}`} onClick={() => onPreview(u)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Sélectionner ${name}`} />
                    </td>
                    <td>
                      <div className="usr-who">
                        <span className={`usr-av${u.isActive ? '' : ' off'}`} aria-hidden="true">{initials(u)}</span>
                        <div>
                          <b>{name}{u.id === selfId && <span className="kl-tag b" style={{ marginLeft: 6 }}>Vous</span>}</b>
                          <small>{u.email}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {rolesOf(u).map(rc => (
                          <span key={rc} className={`kl-tag ${rc === u.role ? 'b' : 'x'}`} title={rc === u.role ? 'Rôle principal' : undefined}>{roleLabel(rc)}</span>
                        ))}
                      </div>
                      <small className="usr-sub" title={storeNames.length > 1 ? storeNames.join(', ') : undefined}>{storeNames.length ? `${storeNames[0]}${storeNames.length > 1 ? ` +${storeNames.length - 1}` : ''}` : (u.role === 'admin' ? 'Tous les établissements' : 'Sans établissement')}</small>
                    </td>
                    <td><SecuritySignals u={u} /></td>
                    <td style={{ color: u.lastLoginAt ? undefined : 'var(--ds-muted)' }} title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
                      {u.lastLoginAt ? formatLastLogin(u.lastLoginAt) : 'Jamais'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!u.isActive ? <StatusTag tone="cancelled" label="Désactivé" />
                        : u.lockedUntil ? <StatusTag tone="blocked" label="Verrouillé" icon={Lock} title={`Jusqu'à ${formatDateTime(u.lockedUntil)}`} />
                        : u.invitationExpiresAt ? (new Date(u.invitationExpiresAt).getTime() < Date.now()
                          ? <StatusTag tone="late" label="Invitation expirée" icon={Mail} />
                          : <StatusTag tone="todo" label="Invité" icon={Mail} title={`Lien valable jusqu'au ${formatDateTime(u.invitationExpiresAt)}`} />)
                        : <StatusTag tone="done" label="Actif" />}
                    </td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {u.isActive
                        ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onEdit(u)} aria-label={`Ouvrir la fiche de ${name}`}>Ouvrir</button>
                        : <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void run('activate', u)} disabled={u.id === selfId}>Réactiver</button>}
                      <RowMenu label={`Autres actions pour ${name}`} items={[
                        { label: 'Ouvrir la fiche', icon: Pencil, onSelect: () => onEdit(u) },
                        { label: 'Voir ses droits', icon: ScanSearch, onSelect: () => onReview(u) },
                        { label: 'Exceptions individuelles', icon: Settings2, onSelect: () => navigate(`/users/${u.id}?tab=rights`) },
                        ...(u.isActive && (u.invitationExpiresAt || !u.lastLoginAt) ? [{ label: u.invitationExpiresAt ? 'Renvoyer l\'invitation' : 'Envoyer une invitation', icon: Mail, onSelect: () => void resend(u) }] : []),
                        ...securityMenuItems(u, (a, x) => void run(a, x), selfId).map((it, i) => (i === 0 ? { ...it, separator: true } : it)),
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {sent && <InvitationSentModal result={sent.result} email={sent.email} onClose={() => setSent(null)} />}
    </>
  );
}
