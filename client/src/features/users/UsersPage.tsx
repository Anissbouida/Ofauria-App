import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usersApi, rolesApi, governanceApi } from '../../api/users.api';
import RolesPanel from './RolesPanel';
import { SodSection, ApprovalLimitsSection, DelegationsSection } from './GovernancePanel';
import RoleActionMatrix from './RoleActionMatrix';
import UsersOverview, { needsSecurityAction } from './UsersOverview';
import AccountDrawer from './AccountDrawer';
import { LoginsView } from '../settings/AuditLogTab';
import { SecurityModePanel } from './RolesPanel';
import { ModuleShell, ModulePage, useModuleView, type ModuleView } from '../../components/layout/ModuleShell';
import { usePermissions } from '../../context/PermissionsContext';
import './users.css';
import AccessReviewTab, { AccessReviewModal } from './AccessReviewPanel';
import { storesApi } from '../../api/stores.api';
import {
  Plus, Pencil, KeyRound, Settings2, Check, Lock, Users, UserCheck, UserX,
  ShieldCheck, RotateCcw, Scale, ScanSearch, Wand2, Copy, LogOut,
  LayoutDashboard, ArrowRightLeft, History, ListChecks, ClipboardCheck, Smartphone,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { RowMenu } from '../../components/ui/RowMenu';
import { Field, SubmitButton, HrHeaderSlot } from '../employees/ui';
import { FilterChips } from '../sales/ListTemplate';
import {
  Modal, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, SectionHeader, Alert,
} from '../../components/ds';
import { useAuth } from '../../context/AuthContext';
import {
  MfaPolicyModal, SecuritySection, securityMenuItems, useAccountActions, formatLastLogin, formatDateTime,
  generatePassword, errorMessage, fullName,
} from './AccountSecurity';
import '../employees/employees.css';
import '../sales/sales.css';
import * as shared from '@ofauria/shared';
import {
  ROLE_LABELS, MODULE_LABELS, APP_MODULES, DEFAULT_ROLE_MODULES, SETTINGS_SECTION_LABELS,
  MODULE_VERBS, BUSINESS_VERB_LABELS, DATA_SCOPES, DATA_SCOPE_LABELS,
} from '@ofauria/shared';
import type { AppModule, UserPermission, SettingsSection, BusinessVerb } from '@ofauria/shared';
import '../settings/settings.css';

type UserRow = Record<string, any>;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Politique de mot de passe d'un nouveau compte (identique au serveur, auth.validator). */
const strongPasswordOk = (p: string) => p.length >= 12 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

type UsersView = 'overview' | 'accounts' | 'review' | 'delegations' | 'journal' | 'matrix' | 'roles' | 'controls' | 'security' | 'approvals';

const LEADS: Record<UsersView, string> = {
  overview: 'Comptes, droits et sécurité de votre société.',
  accounts: 'Personnes qui se connectent à Kalum, leurs rôles et leur sécurité.',
  review: 'Contrôle périodique des droits accordés à chaque compte.',
  delegations: 'Rôles confiés pour une période à un autre compte.',
  journal: 'Connexions, échecs, verrouillages et actions de sécurité sur les comptes.',
  matrix: 'Permissions détaillées de chaque rôle, action par action.',
  roles: 'Ce que chaque fonction peut voir et faire dans Kalum.',
  controls: 'Séparation des tâches, plafonds d\'approbation et contrôle des droits.',
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
            {view === 'delegations' && <DelegationsSection />}
            {view === 'journal' && <LoginsView users={users} />}
            {view === 'matrix' && <RoleActionMatrix roles={roles} />}
            {view === 'roles' && <RolesPanel />}
            {view === 'controls' && (
              <div style={{ display: 'grid', gap: 28 }}>
                <SodSection />
                <ApprovalLimitsSection />
                <section style={{ display: 'grid', gap: 12 }}>
                  <SectionHeader title="Contrôle des droits" note="Écrans et actions utilisés sans le droit nécessaire" />
                  <SecurityModePanel />
                </section>
              </div>
            )}
            {view === 'security' && <SecurityPolicy roles={roles} />}
          </div>
        </ModulePage>
      </ModuleShell>

      {preview && (
        <AccountDrawer user={preview} selfId={me?.id} onClose={() => setPreview(null)}
          onOpen={u => { setPreview(null); openRecord(u); }} onReview={u => setReviewUser(u)} />
      )}
      {reviewUser && <AccessReviewModal userId={reviewUser.id as string} name={fullName(reviewUser)} onClose={() => setReviewUser(null)} />}
      {editing && <UserFormModal user={null} onClose={() => setEditing(null)} />}
    </HrHeaderSlot.Provider>
  );
}

/* ============ SÉCURITÉ ET CONNEXIONS ============ */

/**
 * Règles de connexion. La double authentification par rôle se règle ici ; les autres valeurs
 * sont celles appliquées aujourd'hui par le serveur, affichées pour information.
 */
function SecurityPolicy({ roles }: { roles: { code: string; label: string; user_count: number }[] }) {
  const [open, setOpen] = useState(false);
  const { data: policy } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });
  const required = (policy?.requiredRoles ?? []).filter(c => roles.some(r => r.code === c));
  const label = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Double authentification">
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setOpen(true)}>Modifier</button>
        </SectionHeader>
        <DataPanel label="Double authentification">
          <div className="usr-row">
            <div><b>Rôles qui doivent l'utiliser</b><p>S'ajoute à l'exigence posée compte par compte, depuis la fiche du compte.</p></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {required.length ? required.map(c => <span key={c} className="kl-tag b">{label(c)}</span>) : <span style={{ color: 'var(--ds-muted)' }}>Aucun rôle</span>}
            </div>
          </div>
          {!required.includes('admin') && (
            <div style={{ padding: '0 20px 16px' }}><Alert tone="warning">Le rôle Administrateur n'exige pas la double authentification.</Alert></div>
          )}
        </DataPanel>
      </section>
      <section style={{ display: 'grid', gap: 12 }}>
        <SectionHeader title="Mot de passe et verrouillage" note="Valeurs appliquées par le serveur" />
        <DataPanel label="Mot de passe et verrouillage">
          <div className="usr-row"><div><b>Mot de passe</b><p>Pour un nouveau compte ou un mot de passe défini par un administrateur.</p></div><span>12 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial</span></div>
          <div className="usr-row"><div><b>Verrouillage</b><p>Le compte se déverrouille seul à la fin du délai, ou depuis sa fiche.</p></div><span>Après 5 échecs, pendant 15 minutes</span></div>
          <div className="usr-row"><div><b>Code PIN de caisse</b><p>Les codes plus courts sont signalés « à renouveler ».</p></div><span>6 à 10 chiffres</span></div>
        </DataPanel>
      </section>
      {open && <MfaPolicyModal onClose={() => setOpen(false)} />}
    </div>
  );
}


/* ============ COMPTES ============ */

function useRoleLabel() {
  // Rôles éditables (mig 330) ; repli sur les libellés fixes si la liste n'est pas disponible.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const label = (code: string) => roles.find(r => r.code === code)?.label ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
  return { roles, label };
}

type Situation = 'active' | 'todo' | 'never' | 'inactive' | 'all';
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
  : s === 'never' ? !u.lastLoginAt
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
  const [permUser, setPermUser] = useState<UserRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { run } = useAccountActions();

  const { data: users = [], isLoading, isError, error, refetch } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { roles, label: roleLabel } = useRoleLabel();
  const storeName = (id: unknown) => stores.find(s => s.id === id)?.name as string | undefined;
  // Rôles multiples (mig 335) : repli sur le rôle principal si la liste est absente.
  const rolesOf = (u: UserRow): string[] => (Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []));

  const count = (s: Situation) => users.filter(u => matchSituation(u, s)).length;

  const shown = useMemo(() => {
    const n = normalize(q.trim());
    return users.filter(u =>
      matchSituation(u, situation)
      && (!roleFilter || rolesOf(u).includes(roleFilter))
      && (!storeFilter || (storeFilter === '-' ? !u.storeId : u.storeId === storeFilter))
      && matchSecurity(u, security)
      && (!n || normalize(`${u.firstName} ${u.lastName} ${u.email} ${rolesOf(u).map(roleLabel).join(' ')} ${storeName(u.storeId) ?? ''}`).includes(n)));
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

  const filtered = !!q || !!roleFilter || !!storeFilter || !!security || situation !== 'active';
  const resetFilters = () => { setQ(''); setRoleFilter(''); setStoreFilter(''); setSecurity(''); setSituation('active'); };

  return (
    <>
      <FilterChips label="Situation" value={situation} onChange={k => setSituation(k as Situation)}
        chips={[
          { key: 'active', label: 'Actifs', count: count('active') },
          { key: 'todo', label: 'À traiter', count: count('todo') },
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
                      <small className="usr-sub">{store ?? (u.role === 'admin' ? 'Tous les établissements' : 'Sans établissement')}</small>
                    </td>
                    <td><SecuritySignals u={u} /></td>
                    <td style={{ color: u.lastLoginAt ? undefined : 'var(--ds-muted)' }} title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
                      {u.lastLoginAt ? formatLastLogin(u.lastLoginAt) : 'Jamais'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!u.isActive ? <StatusTag tone="cancelled" label="Désactivé" />
                        : u.lockedUntil ? <StatusTag tone="blocked" label="Verrouillé" icon={Lock} title={`Jusqu'à ${formatDateTime(u.lockedUntil)}`} />
                        : <StatusTag tone="done" label="Actif" />}
                    </td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {u.isActive
                        ? <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => onEdit(u)} aria-label={`Ouvrir la fiche de ${name}`}>Ouvrir</button>
                        : <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => void run('activate', u)} disabled={u.id === selfId}>Réactiver</button>}
                      <RowMenu label={`Autres actions pour ${name}`} items={[
                        { label: 'Ouvrir la fiche', icon: Pencil, onSelect: () => onEdit(u) },
                        { label: 'Voir ses droits', icon: ScanSearch, onSelect: () => onReview(u) },
                        { label: 'Droits propres', icon: Settings2, onSelect: () => setPermUser(u) },
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

      {permUser && <PermissionsModal user={permUser} roleLabel={roleLabel(permUser.role)} onClose={() => setPermUser(null)} />}
    </>
  );
}


/* ============ FICHE UTILISATEUR ============ */

function UserFormModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const { roles, label: roleLabelOf } = useRoleLabel();
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  // Lien espace employé : fiches salariées disponibles. currentLink = celle déjà
  // reliée à ce compte ; effEmployeeId reflète le lien actuel tant que l'admin
  // n'a pas touché au champ (évite d'écraser le lien avant chargement de la liste).
  const { data: employees = [], isFetched: empFetched } = useQuery<Array<{ id: string; name: string; user_id: string | null }>>({
    queryKey: ['employees-link'], queryFn: usersApi.employeesForLink,
  });
  const currentLink = employees.find(e => e.user_id === (user?.id as string))?.id ?? '';
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const effEmployeeId = employeeId === null ? currentLink : employeeId;
  const initialRoles = (Array.isArray(user?.roles) && (user!.roles as string[]).length
    ? (user!.roles as string[]) : (user?.role ? [user.role as string] : ['cashier']));
  const [form, setForm] = useState({
    firstName: (user?.firstName as string) ?? '', lastName: (user?.lastName as string) ?? '', email: (user?.email as string) ?? '',
    password: '', pinCode: '', storeId: (user?.storeId as string) ?? '',
  });
  const [roleCodes, setRoleCodes] = useState<string[]>(initialRoles);
  const [primaryRole, setPrimaryRole] = useState<string>((user?.role as string) || initialRoles[0]);
  const [removePin, setRemovePin] = useState(false);
  // Création : mot de passe provisoire à changer (par défaut) et double authentification exigée.
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const generate = () => { set('password', generatePassword()); setShowPassword(true); };
  const copyPassword = async () => {
    try { await navigator.clipboard.writeText(form.password); notify.success('Mot de passe copié'); }
    catch { notify.error('Copie impossible : sélectionnez le mot de passe à la main'); }
  };

  // G0-06 : tout nouveau PIN compte 6 à 10 chiffres.
  const pinInvalid = !!form.pinCode && !/^\d{6,10}$/.test(form.pinCode);
  // Même politique que pour un nouveau compte (serveur : auth.validator) ; vide = inchangé en modification.
  const passwordInvalid = (!user || !!form.password) && !strongPasswordOk(form.password);
  const invalid = !form.firstName.trim() || !form.lastName.trim() || !/^\S+@\S+\.\S+$/.test(form.email) || pinInvalid || passwordInvalid || roleCodes.length === 0;

  const save = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
        roles: roleCodes, primaryRole, storeId: form.storeId || null,
      };
      // N'envoyer le lien fiche que si la liste est chargée (sinon on risquerait de le vider).
      if (empFetched) data.employeeId = effEmployeeId || null;
      if (form.password) data.password = form.password;
      if (!user) { data.mustChangePassword = mustChangePassword; data.mfaRequired = mfaRequired; }
      // PIN vide : inchangé en modification (l'ancien formulaire l'effaçait), absent à la création.
      if (form.pinCode) data.pinCode = form.pinCode;
      else if (removePin) data.pinCode = null;
      return user ? usersApi.update(user.id as string, data) : usersApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notify.success(user ? 'Utilisateur mis à jour' : 'Utilisateur créé');
      onClose();
    },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  // Changement de rôle principal : le serveur efface les droits propres du compte (ils
  // remplacent ceux du rôle) et ferme ses sessions. On le dit avant d'enregistrer.
  const submit = async () => {
    const oldPrimary = user?.role as string | undefined;
    if (user && oldPrimary && primaryRole !== oldPrimary) {
      const own = await usersApi.getPermissions(user.id as string).catch(() => []);
      const hasOwn = Array.isArray(own) && own.length > 0;
      const ok = await confirm(
        `Le rôle principal passe de « ${roleLabelOf(oldPrimary)} » à « ${roleLabelOf(primaryRole)} ». La page d'accueil et le contrôle des écrans suivront le nouveau rôle.`
        + (hasOwn ? ' Les droits propres de ce compte seront effacés : ceux de ses rôles s\'appliqueront.' : '')
        + ' Ses sessions ouvertes seront fermées.',
        { title: 'Changer le rôle principal ?', confirmLabel: 'Changer le rôle principal' },
      );
      if (!ok) return;
    }
    save.mutate();
  };

  const roleChoices = roles.length
    ? roles.filter(r => (r.is_active && r.available !== false) || roleCodes.includes(r.code)).map(r => [r.code, r.label] as const)
    : Object.entries(ROLE_LABELS);
  const toggleRole = (code: string) => {
    const next = roleCodes.includes(code) ? roleCodes.filter(c => c !== code) : [...roleCodes, code];
    setRoleCodes(next);
    if (!next.includes(primaryRole)) setPrimaryRole(next[0] ?? '');
  };

  return (
    <Modal subtitle="Utilisateurs" title={user ? `${user.firstName} ${user.lastName}` : 'Nouvel utilisateur'}
      aside={user && <StatusTag tone={user.isActive ? 'done' : 'cancelled'} label={user.isActive ? 'Actif' : 'Désactivé'} />}
      width={620} onClose={onClose} locked={save.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={save.isPending}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={invalid} onClick={() => void submit()}>
          {user ? 'Enregistrer' : 'Créer le compte'}
        </SubmitButton>
      </>}>
      <div className="ds-form-grid">
        <Field label="Prénom" required><input id="user-first-name" className="ds-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} autoFocus /></Field>
        <Field label="Nom" required><input id="user-last-name" className="ds-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></Field>
      </div>
      <Field label="E-mail" required hint="Identifiant de connexion administrateur">
        <input id="user-email" type="email" className="ds-input" value={form.email} onChange={e => set('email', e.target.value)} />
      </Field>
      <div className="ds-form-grid">
        <Field label={user ? 'Nouveau mot de passe' : 'Mot de passe'} required={!user} hint={form.password && passwordInvalid ? '12 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial' : user ? 'Vide = inchangé' : (mustChangePassword ? 'Provisoire : à changer à la 1re connexion' : '12 caractères au moins, avec majuscule, minuscule, chiffre et caractère spécial')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="user-password" type={showPassword ? 'text' : 'password'} className="ds-input" aria-invalid={!!(form.password && passwordInvalid) || undefined} autoComplete="new-password"
              style={showPassword ? { fontFamily: 'ui-monospace, monospace' } : undefined}
              value={form.password} onChange={e => set('password', e.target.value)} placeholder={user ? '••••••••' : ''} />
            <button type="button" className="odoo-btn-secondary" style={{ height: 40 }} onClick={generate} title="Générer un mot de passe sûr" aria-label="Générer un mot de passe sûr">
              <Wand2 size={13} />
            </button>
            {form.password && showPassword && (
              <button type="button" className="odoo-btn-secondary" style={{ height: 40 }} onClick={() => void copyPassword()} title="Copier" aria-label="Copier le mot de passe">
                <Copy size={13} />
              </button>
            )}
          </div>
        </Field>
        <Field label="Code PIN" hint={user ? (user.hasPin ? (removePin ? 'Sera retiré à l\'enregistrement' : (user.pinWeak ? 'À renouveler (6 chiffres au moins) ; vide = inchangé' : 'Défini ; vide = inchangé')) : 'Non défini ; 6 à 10 chiffres') : '6 à 10 chiffres, connexion en caisse'}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="user-pin" inputMode="numeric" maxLength={10} className="ds-input" aria-invalid={!!(pinInvalid) || undefined}
              style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em' }} autoComplete="off" disabled={removePin}
              value={form.pinCode} onChange={e => set('pinCode', e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            {user?.hasPin && (
              <button type="button" className={removePin ? 'odoo-btn-secondary' : 'ds-btn-danger'} style={{ whiteSpace: 'nowrap', height: 40 }}
                onClick={() => { setRemovePin(!removePin); set('pinCode', ''); }}>
                {removePin ? 'Garder' : 'Retirer'}
              </button>
            )}
          </div>
        </Field>
      </div>
      <Field label="Rôles" required hint="Plusieurs rôles cumulent leurs droits (le plus permissif gagne). Droits par défaut : onglet Rôles et contrôle.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {roleChoices.map(([code, label]) => {
            const on = roleCodes.includes(code);
            return (
              <button key={code} type="button" className="odoo-filter-chip" aria-pressed={on} onClick={() => toggleRole(code)}
                style={{ background: on ? 'var(--ds-tint)' : 'var(--ds-card)', color: 'var(--ds-ink)', fontWeight: on ? 600 : undefined, borderColor: on ? 'var(--ds-accent)' : 'var(--ds-line)', padding: '0.25rem 0.625rem', fontSize: 12 }}>
                {on && <Check size={11} />} {label}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="ds-form-grid">
        <Field label="Rôle principal" hint="Fixe le périmètre technique (écrans, filtres) du compte">
          <select id="user-primary-role" className="ds-input" value={primaryRole} onChange={e => setPrimaryRole(e.target.value)} disabled={roleCodes.length <= 1}>
            {roleCodes.map(code => {
              const label = roleChoices.find(([c]) => c === code)?.[1] ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
              return <option key={code} value={code}>{label}</option>;
            })}
          </select>
        </Field>
        <Field label="Établissement" hint="Boutique ou site de rattachement">
          <select id="user-store" className="ds-input" value={form.storeId} onChange={e => set('storeId', e.target.value)}>
            <option value="">Aucun</option>
            {stores.map(s => <option key={s.id as string} value={s.id as string}>{s.name as string}{s.city ? ` (${s.city})` : ''}</option>)}
          </select>
        </Field>
      </div>
      {!user && (
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input id="user-must-change" type="checkbox" checked={mustChangePassword} onChange={e => setMustChangePassword(e.target.checked)} />
            <span><strong>Changer le mot de passe à la première connexion</strong><br />
              <span style={{ color: 'var(--ds-muted)' }}>Vous communiquez un mot de passe provisoire ; l'utilisateur choisit le sien en arrivant.</span></span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
            <input id="user-mfa-required" type="checkbox" checked={mfaRequired} onChange={e => setMfaRequired(e.target.checked)} />
            <span><strong>Exiger la double authentification</strong><br />
              <span style={{ color: 'var(--ds-muted)' }}>Application d'authentification à configurer dès la première connexion (en plus des rôles qui l'imposent).</span></span>
          </label>
        </div>
      )}
      <Field label="Fiche salarié" hint="Relie ce compte à sa fiche pour l'espace employé (heures, bulletins, congés). Aucune = pas d'espace employé.">
        <select id="user-employee" className="ds-input" value={effEmployeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Aucune</option>
          {employees.map(e => {
            const linkedElsewhere = !!e.user_id && e.user_id !== (user?.id as string);
            return <option key={e.id} value={e.id} disabled={linkedElsewhere}>{e.name}{linkedElsewhere ? ' (déjà lié à un compte)' : ''}</option>;
          })}
        </select>
      </Field>
      {user && <SecuritySection userId={user.id as string} selfId={me?.id} onDeleted={onClose} />}
    </Modal>
  );
}

/* ============ DROITS PROPRES ============ */

interface PermState {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Verbes métier accordés (mig 335). */
  verbs: string[];
  /** Portée des données (mig 335). */
  scope: string;
  config: Record<string, any>;
}

// Les alias historiques (economat, inventory, pesage, warehouse) ne sont pas proposes :
// un seul droit « Stock » les remplace, les anciens droits restent lus par hasModule.
// Constantes absentes de certaines versions de shared (fusion Stock).
const LEGACY = (shared as unknown as { LEGACY_MODULE_KEYS?: ReadonlySet<string> }).LEGACY_MODULE_KEYS ?? new Set<string>();
const ALIASES = (shared as unknown as { MODULE_ALIASES?: Partial<Record<string, string[]>> }).MODULE_ALIASES ?? {};
const ALL_MODULES = (Object.values(APP_MODULES) as AppModule[]).filter(m => !LEGACY.has(m));
const ACTIONS = [['canView', 'Voir'], ['canCreate', 'Créer'], ['canEdit', 'Modifier'], ['canDelete', 'Supprimer']] as const;

// Sections du module Parametres (config.sections) : vide = toutes les sections.
const SETTINGS_SECTION_KEYS = Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[];

export function PermissionsModal({ user, roleLabel, onClose }: { user: UserRow; roleLabel: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const userId = user.id as string;
  const userRole = user.role as string;
  const userName = `${user.firstName} ${user.lastName}`;

  const { data: existingPerms, isLoading, isError: permsError, error: permsErr, refetch: refetchPerms } = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => usersApi.getPermissions(userId),
  });


  const [perms, setPerms] = useState<Record<AppModule, PermState> | null>(null);
  const [initialized, setInitialized] = useState(false);
  // Droits du role (mig 330) : point de depart quand l'utilisateur n'a pas de droits propres.
  const { data: rolePerms, isFetched: rolePermsFetched } = useQuery({
    queryKey: ['role-permissions', userRole],
    queryFn: () => rolesApi.permissions(userRole),
    retry: false,
  });
  const hasCustomPerms = ((existingPerms as UserPermission[] | undefined) ?? []).length > 0;

  // Initialize from existing or defaults
  if (!initialized && existingPerms !== undefined && !isLoading && rolePermsFetched) {
    const defaultModules = DEFAULT_ROLE_MODULES[userRole] || [];
    const existingList = existingPerms as UserPermission[];
    const state: Record<string, PermState> = {};

    for (const mod of ALL_MODULES) {
      // Un droit enregistre sous une ancienne cle (economat, pesage...) vaut pour le
      // module canonique ; a la sauvegarde il sera reecrit sous la nouvelle cle.
      const keys: string[] = [mod, ...(ALIASES[mod] ?? [])];
      const existing = existingList.find(p => keys.includes(p.module));
      if (existing) {
        const cfg = (existing.config || {}) as Record<string, any>;
        state[mod] = {
          canView: existing.canView,
          canCreate: existing.canCreate,
          canEdit: existing.canEdit,
          canDelete: existing.canDelete,
          verbs: (cfg.verbs as string[]) ?? [],
          scope: (cfg.scope as string) ?? 'store',
          config: cfg,
        };
      } else if (hasCustomPerms) {
        // Custom permissions exist but this module is not in the list → no access
        state[mod] = { canView: false, canCreate: false, canEdit: false, canDelete: false, verbs: [], scope: 'store', config: {} };
      } else {
        // No custom permissions at all → fall back to the role's rights
        const fromRole = rolePerms?.find(p => p.module === mod);
        const roleCfg = (fromRole?.config as Record<string, any>) || {};
        const hasAccess = rolePerms ? !!fromRole?.canView : defaultModules.includes(mod);
        state[mod] = {
          canView: hasAccess,
          canCreate: rolePerms ? !!fromRole?.canCreate : hasAccess,
          canEdit: rolePerms ? !!fromRole?.canEdit : hasAccess,
          canDelete: rolePerms ? !!fromRole?.canDelete : false,
          verbs: (fromRole?.verbs as string[]) ?? (roleCfg.verbs as string[]) ?? [],
          scope: (fromRole?.scope as string) ?? (roleCfg.scope as string) ?? 'store',
          config: roleCfg,
        };
      }
    }
    setPerms(state as Record<AppModule, PermState>);
    setInitialized(true);
  }

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['user-permissions', userId] });
    notify.success(message);
    onClose();
  };
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!perms) return Promise.resolve();
      const permissions = ALL_MODULES
        .filter(mod => perms[mod].canView || perms[mod].canCreate || perms[mod].canEdit || perms[mod].canDelete)
        .map(mod => ({ module: mod, ...perms[mod] }));
      return usersApi.setPermissions(userId, permissions);
    },
    onSuccess: () => done('Droits enregistrés'),
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  // Sans droits propres, l'utilisateur suit à nouveau les droits de son rôle.
  const resetMutation = useMutation({
    mutationFn: () => usersApi.setPermissions(userId, []),
    onSuccess: () => done('L\'utilisateur suit les droits de son rôle'),
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const resetToRole = async () => {
    if (await confirm(`Les droits propres de ${userName} seront supprimés : il retrouvera ceux du rôle « ${roleLabel} ».`,
      { title: 'Revenir aux droits du rôle ?', confirmLabel: 'Revenir aux droits du rôle' })) resetMutation.mutate();
  };

  const toggleModule = (mod: AppModule, field: keyof Omit<PermState, 'config'>) => {
    if (!perms) return;
    const next = { ...perms };
    next[mod] = { ...next[mod], [field]: !next[mod][field] };
    // If unchecking canView, uncheck everything
    if (field === 'canView' && !next[mod].canView) {
      next[mod].canCreate = false;
      next[mod].canEdit = false;
      next[mod].canDelete = false;
      next[mod].verbs = [];
    }
    // If checking create/edit/delete, ensure canView is on
    if (field !== 'canView' && next[mod][field]) next[mod].canView = true;
    setPerms(next);
  };

  const setConfig = (mod: AppModule, config: Record<string, any>) => {
    if (!perms) return;
    setPerms({ ...perms, [mod]: { ...perms[mod], config: { ...perms[mod].config, ...config } } });
  };
  const setScope = (mod: AppModule, scope: string) => {
    if (!perms) return;
    setPerms({ ...perms, [mod]: { ...perms[mod], scope } });
  };
  const toggleVerb = (mod: AppModule, verb: BusinessVerb) => {
    if (!perms) return;
    const cur = perms[mod].verbs ?? [];
    const verbs = cur.includes(verb) ? cur.filter(v => v !== verb) : [...cur, verb];
    setPerms({ ...perms, [mod]: { ...perms[mod], verbs } });
  };
  const verbsFor = (mod: AppModule) => (MODULE_VERBS[mod] ?? []) as BusinessVerb[];
  const toggleSettingsSection = (section: SettingsSection) => {
    const current = (perms?.settings.config.sections as SettingsSection[]) || [];
    setConfig('settings', { sections: current.includes(section) ? current.filter(s => s !== section) : [...current, section] });
  };

  if (userRole === 'admin') {
    return (
      <Modal subtitle="Droits" title={userName} width={480} onClose={onClose}
        footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
        <StatusBanner tone="neutral" icon={Lock} title="Administrateur">L'administrateur a accès à tous les modules ; ses droits ne se règlent pas.</StatusBanner>
      </Modal>
    );
  }

  const chip = (selected: boolean): React.CSSProperties => ({
    background: selected ? 'var(--ds-tint)' : 'var(--ds-card)', color: 'var(--ds-ink)', fontWeight: selected ? 600 : undefined,
    borderColor: selected ? 'var(--ds-accent)' : 'var(--ds-line)', padding: '0.25rem 0.625rem', fontSize: 12,
  });

  return (
    <Modal subtitle="Droits" title={userName} width={760} onClose={onClose}
      aside={<span className={`odoo-tag ${hasCustomPerms ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{hasCustomPerms ? 'Droits propres' : `Droits du rôle ${roleLabel}`}</span>}
      footer={<>
        {hasCustomPerms && (
          <button type="button" className="odoo-btn-secondary" style={{ marginRight: 'auto' }} disabled={resetMutation.isPending} onClick={() => void resetToRole()}>
            <RotateCcw size={13} aria-hidden="true" /> Revenir aux droits du rôle
          </button>
        )}
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <SubmitButton pending={saveMutation.isPending} disabled={!perms} onClick={() => saveMutation.mutate()}>
          Enregistrer les droits
        </SubmitButton>
      </>}>
      <StatusBanner tone="info" icon={ShieldCheck} title={hasCustomPerms ? 'Cet utilisateur a des droits propres' : `Point de départ : les droits du rôle « ${roleLabel} »`}>
        {hasCustomPerms
          ? 'Ils remplacent ceux de son rôle tant qu\'ils existent.'
          : 'Enregistrer crée des droits propres à cet utilisateur, qui remplacent alors ceux du rôle.'}
      </StatusBanner>
      {permsError ? <ErrorState bare error={permsErr} title="Les droits n'ont pas pu être chargés" onRetry={() => void refetchPerms()} /> : isLoading || !perms ? <LoadingState bare /> : (
        <DataPanel label="Droits par module">
          <table className="odoo-table">
            <thead><tr><th>Module</th>{ACTIONS.map(([, l]) => <th key={l} style={{ textAlign: 'center', width: 84 }}>{l}</th>)}</tr></thead>
            <tbody>
              {/* « Utilisateurs » reste reserve a l'administrateur (routes /users en dur). */}
              {ALL_MODULES.filter(m => m !== 'users').map(mod => {
                const p = perms[mod];
                const sections = (p.config.sections as string[]) || [];
                return [
                  <tr key={mod} style={{ opacity: p.canView ? 1 : 0.65 }}>
                    <td className={p.canView ? 'ds-strong' : undefined}>{MODULE_LABELS[mod] ?? mod}</td>
                    {ACTIONS.map(([f, l]) => (
                      <td key={f} style={{ textAlign: 'center' }}>
                        <input type="checkbox" id={`up-${mod}-${f}`} aria-label={`${l} ${MODULE_LABELS[mod] ?? mod}`}
                          checked={p[f]} onChange={() => toggleModule(mod, f)} />
                      </td>
                    ))}
                  </tr>,
                  p.canView && (
                    <tr key={`${mod}-scope`}>
                      <td colSpan={5} style={{ background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))' }}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 16 }}>
                          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                            <span style={{ fontWeight: 600 }}>Portée des données</span>
                            <select className="ds-input sm" style={{ width: 'auto' }}
                              value={p.scope || 'store'} onChange={e => setScope(mod, e.target.value)}>
                              {DATA_SCOPES.map(s => <option key={s} value={s}>{DATA_SCOPE_LABELS[s]}</option>)}
                            </select>
                          </label>
                          {verbsFor(mod).length > 0 && (
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>Actions métier</span>
                              {verbsFor(mod).map(v => {
                                const on = (p.verbs || []).includes(v);
                                return (
                                  <button key={v} type="button" className="odoo-filter-chip" style={chip(on)}
                                    aria-pressed={on} onClick={() => toggleVerb(mod, v)}>
                                    {on && <Check size={11} />} {BUSINESS_VERB_LABELS[v]}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                  mod === 'settings' && p.canView && (
                    <tr key={`${mod}-sections`}>
                      <td colSpan={5} style={{ background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))' }}>
                        <div style={{ display: 'grid', gap: 6, paddingLeft: 16 }}>
                          <span style={{ fontSize: 12, fontWeight: 600 }}>
                            Sections autorisées {!sections.length && <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>— toutes (aucune restriction)</span>}
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {SETTINGS_SECTION_KEYS.map(sec => (
                              <button key={sec} type="button" className="odoo-filter-chip" style={chip(sections.includes(sec))}
                                aria-pressed={sections.includes(sec)} onClick={() => toggleSettingsSection(sec)}>
                                {sections.includes(sec) && <Check size={11} />} {SETTINGS_SECTION_LABELS[sec]}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </DataPanel>
      )}
    </Modal>
  );
}
