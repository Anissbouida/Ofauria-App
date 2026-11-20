import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { usersApi, rolesApi } from '../../api/users.api';
import { categoriesApi } from '../../api/categories.api';
import RolesPanel from './RolesPanel';
import GovernancePanel from './GovernancePanel';
import AccessReviewTab, { AccessReviewModal } from './AccessReviewPanel';
import { storesApi } from '../../api/stores.api';
import {
  Plus, Pencil, KeyRound, Settings2, Check, MapPin, Lock, Users, UserCheck, UserX,
  ShieldCheck, ShieldAlert, Loader2, RotateCcw, Scale, ScanSearch, Wand2, Copy, LogOut, X,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { RowMenu } from '../../components/ui/RowMenu';
import { HrModal, Field, SubmitButton, LoadingPanel, Segmented } from '../employees/ui';
import SalesPageShell from '../sales/SalesPageShell';
import { ListToolbar, FilterChips, ListPanel, ListEmpty } from '../sales/ListTemplate';
import { useAuth } from '../../context/AuthContext';
import {
  MfaTag, MfaPolicyModal, SecuritySection, securityMenuItems, useAccountActions, formatLastLogin, formatDateTime,
  generatePassword, errorMessage, fullName,
} from './AccountSecurity';
import '../employees/employees.css';
import '../sales/sales.css';
import * as shared from '@ofauria/shared';
import {
  ROLE_LABELS, MODULE_LABELS, APP_MODULES, DEFAULT_ROLE_MODULES, SETTINGS_SECTION_LABELS,
  MODULE_VERBS, BUSINESS_VERB_LABELS, DATA_SCOPES, DATA_SCOPE_LABELS,
} from '@ofauria/shared';
import type { AppModule, UserPermission, SettingsSection, DataScope, BusinessVerb } from '@ofauria/shared';
import '../settings/settings.css';

/**
 * Utilisateurs : comptes (connexion, PIN, rôle, établissement, droits propres) et
 * rôles. Design Ventes : barre fil d'Ariane, grand titre, contrôle segmenté des vues,
 * tuiles, recherche et pastilles, tableau en carte, fenêtres en feuille, ConfirmDialog.
 */

type UserRow = Record<string, any>;
type UsersTab = 'users' | 'roles' | 'governance' | 'review';

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function UsersPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: UsersTab = tabParam === 'roles' ? 'roles' : tabParam === 'governance' ? 'governance' : tabParam === 'review' ? 'review' : 'users';
  const setTab = (t: UsersTab) => setParams(t === 'users' ? {} : { tab: t });
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);

  const tabs: { key: UsersTab; label: string; icon: typeof Users }[] = [
    { key: 'users', label: 'Comptes', icon: Users },
    { key: 'roles', label: 'Rôles et contrôle', icon: ShieldCheck },
    { key: 'governance', label: 'Gouvernance', icon: Scale },
    { key: 'review', label: 'Revue des accès', icon: ScanSearch },
  ];
  const current = tabs.find(t => t.key === tab)!;

  return (
    <>
      {/* Design Ventes (2026-11-18) : barre fil d'Ariane + action, grand titre de la rubrique,
          contrôle segmenté des quatre vues, puis contenu au gabarit Liste. */}
      <SalesPageShell icon={Lock} parent="Utilisateurs" title={current.label} list
        actions={tab === 'users' ? (
          <button type="button" className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Nouvel utilisateur
          </button>
        ) : undefined}>
        <div className="prj-toolbar">
          <Segmented label="Vues des utilisateurs" value={tab} onChange={setTab}
            options={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} />
        </div>
        {tab === 'users' && <AccountsTab onEdit={setEditing} />}
        {tab === 'roles' && <RolesPanel />}
        {tab === 'governance' && <GovernancePanel />}
        {tab === 'review' && <AccessReviewTab />}
      </SalesPageShell>

      {editing && <UserFormModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ============ COMPTES ============ */

function useRoleLabel() {
  // Rôles éditables (mig 330) ; repli sur les libellés fixes si la liste n'est pas disponible.
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const label = (code: string) => roles.find(r => r.code === code)?.label ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
  return { roles, label };
}

type SecurityFilter = '' | 'mfa_on' | 'mfa_todo' | 'mfa_off' | 'locked' | 'pwd' | 'never';
const SECURITY_FILTERS: { key: SecurityFilter; label: string }[] = [
  { key: '', label: 'Toute sécurité' },
  { key: 'mfa_on', label: 'Double auth. activée' },
  { key: 'mfa_todo', label: 'Double auth. à configurer' },
  { key: 'mfa_off', label: 'Double auth. non exigée' },
  { key: 'locked', label: 'Verrouillés' },
  { key: 'pwd', label: 'Mot de passe à changer' },
  { key: 'never', label: 'Jamais connectés' },
];
const matchSecurity = (u: UserRow, f: SecurityFilter) =>
  f === '' ? true
  : f === 'mfa_on' ? !!u.mfaEnabled
  : f === 'mfa_todo' ? !!u.mfaRequired && !u.mfaEnabled
  : f === 'mfa_off' ? !u.mfaRequired && !u.mfaEnabled
  : f === 'locked' ? !!u.lockedUntil
  : f === 'pwd' ? !!u.mustChangePassword
  : !u.lastLoginAt;

function AccountsTab({ onEdit }: { onEdit: (u: UserRow) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const selfId = me?.id;
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [security, setSecurity] = useState<SecurityFilter>('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [permUser, setPermUser] = useState<UserRow | null>(null);
  const [reviewUser, setReviewUser] = useState<UserRow | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { run } = useAccountActions();

  const { data: users = [], isLoading } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { roles, label: roleLabel } = useRoleLabel();
  const storeName = (id: unknown) => stores.find(s => s.id === id)?.name as string | undefined;
  // Rôles multiples (mig 335) : repli sur le rôle principal si la liste est absente.
  const rolesOf = (u: UserRow): string[] => (Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []));

  const active = users.filter(u => u.isActive);
  const activeCount = active.length;
  const inactiveCount = users.length - activeCount;
  const noPinCount = active.filter(u => !u.hasPin).length;
  const mfaTodoCount = active.filter(u => u.mfaRequired && !u.mfaEnabled).length;
  const mfaOnCount = active.filter(u => u.mfaEnabled).length;
  const lockedCount = active.filter(u => u.lockedUntil).length;

  const shown = useMemo(() => {
    const n = normalize(q.trim());
    return users.filter(u =>
      (status === 'all' || (status === 'active') === !!u.isActive)
      && (!roleFilter || rolesOf(u).includes(roleFilter))
      && matchSecurity(u, security)
      && (!n || normalize(`${u.firstName} ${u.lastName} ${u.email} ${rolesOf(u).map(roleLabel).join(' ')} ${storeName(u.storeId) ?? ''}`).includes(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, q, roleFilter, status, security, roles, stores]);

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

  return (
    <>
      <div className="prj-kpis">
        <button type="button" className="prj-kpi" onClick={() => { setStatus('active'); setSecurity(''); }} style={{ textAlign: 'left' }}>
          <div className="prj-kpi-head"><span>Comptes actifs</span><UserCheck size={14} /></div>
          <div className="prj-kpi-value">{activeCount}</div>
          <div className="prj-kpi-sub">{inactiveCount} désactivé{inactiveCount > 1 ? 's' : ''} sur {users.length}</div>
        </button>
        <button type="button" className="prj-kpi" onClick={() => { setStatus('active'); setSecurity('mfa_todo'); }} style={{ textAlign: 'left' }}>
          <div className="prj-kpi-head"><span>Double auth. à configurer</span><ShieldAlert size={14} /></div>
          <div className="prj-kpi-value" style={{ color: mfaTodoCount ? 'var(--prj-orange)' : undefined }}>{mfaTodoCount}</div>
          <div className="prj-kpi-sub">{mfaOnCount} compte{mfaOnCount > 1 ? 's' : ''} protégé{mfaOnCount > 1 ? 's' : ''}</div>
        </button>
        <button type="button" className="prj-kpi" onClick={() => { setStatus('active'); setSecurity('locked'); }} style={{ textAlign: 'left' }}>
          <div className="prj-kpi-head"><span>Verrouillés</span><Lock size={14} /></div>
          <div className="prj-kpi-value" style={{ color: lockedCount ? 'var(--prj-orange)' : undefined }}>{lockedCount}</div>
          <div className="prj-kpi-sub">trop d'échecs de connexion</div>
        </button>
        <div className="prj-kpi">
          <div className="prj-kpi-head"><span>Sans code PIN</span><KeyRound size={14} /></div>
          <div className="prj-kpi-value" style={{ color: noPinCount ? 'var(--prj-orange)' : undefined }}>{noPinCount}</div>
          <div className="prj-kpi-sub">pas de connexion rapide en caisse</div>
        </div>
      </div>

      <ListToolbar search={q} onSearch={setQ} placeholder="Rechercher un nom, un e-mail, un rôle…">
        <select id="users-role-filter" className="odoo-filter-dropdown" style={{ width: 'auto' }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filtrer par rôle">
          <option value="">Tous les rôles</option>
          {roleOptions.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <select id="users-security-filter" className="odoo-filter-dropdown" style={{ width: 'auto' }} value={security} onChange={e => setSecurity(e.target.value as SecurityFilter)} aria-label="Filtrer par sécurité">
          {SECURITY_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button type="button" className="odoo-btn-secondary" onClick={() => setPolicyOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ShieldCheck size={13} /> Double authentification
        </button>
      </ListToolbar>
      <FilterChips label="Statut" value={status} onChange={k => setStatus(k as typeof status)}
        chips={[{ key: 'active', label: 'Actifs', count: activeCount }, { key: 'inactive', label: 'Désactivés', count: inactiveCount }, { key: 'all', label: 'Tous', count: users.length }]} />

      {chosen.length > 0 && (
        <div className="sal-bulk" role="region" aria-label="Actions sur la sélection">
          <strong>{chosen.length} compte{chosen.length > 1 ? 's' : ''} sélectionné{chosen.length > 1 ? 's' : ''}</strong>
          <button type="button" disabled={bulkBusy} onClick={() => void bulk('Double authentification exigée', chosen.filter(u => !u.mfaRequired && !u.mfaEnabled), u => usersApi.setMfaRequired(u.id, true),
            { title: 'Exiger la double authentification ?', message: 'Les comptes sélectionnés devront configurer une application d\'authentification à leur prochaine connexion.' })}>
            <ShieldCheck size={13} /> Exiger la double auth.
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => void bulk('Changement de mot de passe imposé', chosen.filter(u => !u.mustChangePassword), u => usersApi.setMustChangePassword(u.id, true),
            { title: 'Imposer un nouveau mot de passe ?', message: 'Les comptes sélectionnés devront choisir un nouveau mot de passe à leur prochaine connexion.' })}>
            <KeyRound size={13} /> Imposer un mot de passe
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => void bulk('Sessions fermées', others.filter(u => u.isActive), u => usersApi.revokeSessions(u.id),
            { title: 'Fermer les sessions ?', message: 'Les comptes sélectionnés seront déconnectés de tous leurs appareils.' })}>
            <LogOut size={13} /> Fermer les sessions
          </button>
          {chosen.some(u => !u.isActive) && (
            <button type="button" disabled={bulkBusy} onClick={() => void bulk('Comptes réactivés', chosen.filter(u => !u.isActive), u => usersApi.update(u.id, { isActive: true }))}>
              <UserCheck size={13} /> Réactiver
            </button>
          )}
          {others.some(u => u.isActive) && (
            <button type="button" disabled={bulkBusy} onClick={() => void bulk('Comptes désactivés', others.filter(u => u.isActive), u => usersApi.update(u.id, { isActive: false }),
              { title: 'Désactiver les comptes ?', message: 'Les comptes sélectionnés ne pourront plus se connecter ; leur historique est conservé. Votre propre compte n\'est jamais désactivé.', danger: true })}>
              <UserX size={13} /> Désactiver
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} aria-label="Vider la sélection"><X size={13} /></button>
        </div>
      )}

      {isLoading ? <LoadingPanel /> : !shown.length ? (
        <ListEmpty icon={Users} title={users.length ? 'Aucun compte ne correspond aux filtres.' : 'Aucun utilisateur.'} />
      ) : (
        <ListPanel footer={<div className="hr-panel-foot">{shown.length} compte{shown.length > 1 ? 's' : ''}</div>}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" className="sal-check" checked={allChosen} onChange={toggleAll} aria-label="Tout sélectionner" /></th>
                <th>Utilisateur</th><th>Rôle</th><th>Établissement</th><th>Sécurité</th><th title="Dernière connexion réussie">Connexion</th><th>Statut</th><th style={{ width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(u => {
                const store = storeName(u.storeId);
                const name = fullName(u);
                return (
                  <tr key={u.id} id={`user-row-${u.id}`} onClick={() => onEdit(u)} style={{ cursor: 'pointer', opacity: u.isActive ? 1 : 0.6 }}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="sal-check" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Sélectionner ${name}`} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {name}{u.id === selfId && <span className="odoo-tag odoo-tag-blue">Vous</span>}
                      </div>
                      <div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>{u.email}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {rolesOf(u).map(rc => (
                          <span key={rc} className={`odoo-tag ${rc === u.role ? 'odoo-tag-purple' : 'odoo-tag-grey'}`}>{roleLabel(rc)}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {store
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {store}</span>
                        : <span style={{ color: 'var(--odoo-text-light)' }}>{u.role === 'admin' ? 'Tous' : 'Non assigné'}</span>}
                    </td>
                    <td>
                      {/* Sécurité : code PIN (caisse) et double authentification, l'un sous l'autre. */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 6px', alignItems: 'center', justifyContent: 'start' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>PIN</span>
                        {!u.hasPin ? <StatusTag tone="draft" label="Non défini" />
                          : u.pinWeak ? <StatusTag tone="todo" label="À renouveler" title="PIN de moins de 6 chiffres ou antérieur à la règle : à renouveler" />
                          : <StatusTag tone="done" label="Défini" />}
                        <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }} title="Double authentification">2FA</span>
                        <MfaTag u={u} />
                      </div>
                    </td>
                    <td style={{ color: u.lastLoginAt ? undefined : 'var(--odoo-text-light)' }} title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>
                      {formatLastLogin(u.lastLoginAt)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        <StatusTag tone={u.isActive ? 'done' : 'cancelled'} label={u.isActive ? 'Actif' : 'Désactivé'} />
                        {u.lockedUntil && <StatusTag tone="blocked" label="Verrouillé" title={`Jusqu'à ${formatDateTime(u.lockedUntil)}`} />}
                        {u.mustChangePassword && <StatusTag tone="todo" label="Mdp à changer" title="Nouveau mot de passe à choisir à la prochaine connexion" />}
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setPermUser(u)}
                          title="Droits d'accès" aria-label={`Droits de ${name}`}>
                          <Settings2 size={13} />
                        </button>
                        <RowMenu label={`Autres actions pour ${name}`} items={[
                          { label: 'Modifier la fiche', icon: Pencil, onSelect: () => onEdit(u) },
                          { label: 'Analyser les accès', icon: ScanSearch, onSelect: () => setReviewUser(u) },
                          ...securityMenuItems(u, (a, x) => void run(a, x), selfId),
                        ]} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListPanel>
      )}

      {permUser && <PermissionsModal user={permUser} roleLabel={roleLabel(permUser.role)} onClose={() => setPermUser(null)} />}
      {reviewUser && <AccessReviewModal userId={reviewUser.id as string} name={fullName(reviewUser)} onClose={() => setReviewUser(null)} />}
      {policyOpen && <MfaPolicyModal onClose={() => setPolicyOpen(false)} />}
    </>
  );
}

/* ============ FICHE UTILISATEUR ============ */

function UserFormModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const { roles } = useRoleLabel();
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
  const passwordInvalid = !user && form.password.length < 4;
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

  const roleChoices = roles.length
    ? roles.filter(r => r.is_active || roleCodes.includes(r.code)).map(r => [r.code, r.label] as const)
    : Object.entries(ROLE_LABELS);
  const toggleRole = (code: string) => {
    const next = roleCodes.includes(code) ? roleCodes.filter(c => c !== code) : [...roleCodes, code];
    setRoleCodes(next);
    if (!next.includes(primaryRole)) setPrimaryRole(next[0] ?? '');
  };

  return (
    <HrModal icon={Lock} crumb="Utilisateurs" title={user ? `${user.firstName} ${user.lastName}` : 'Nouvel utilisateur'}
      tag={user && <StatusTag tone={user.isActive ? 'done' : 'cancelled'} label={user.isActive ? 'Actif' : 'Désactivé'} />}
      width={620} onClose={onClose}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <SubmitButton pending={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
          <Check size={13} /> {user ? 'Enregistrer' : 'Créer le compte'}
        </SubmitButton>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Prénom"><input id="user-first-name" className="odoo-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} autoFocus /></Field>
        <Field label="Nom"><input id="user-last-name" className="odoo-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} /></Field>
      </div>
      <Field label="E-mail" hint="Identifiant de connexion administrateur">
        <input id="user-email" type="email" className="odoo-input" value={form.email} onChange={e => set('email', e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={user ? 'Nouveau mot de passe' : 'Mot de passe'} hint={user ? 'Vide = inchangé' : (mustChangePassword ? 'Provisoire : à changer à la 1re connexion' : '4 caractères minimum')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="user-password" type={showPassword ? 'text' : 'password'} className={`odoo-input${form.password && passwordInvalid ? ' invalid' : ''}`} autoComplete="new-password"
              style={showPassword ? { fontFamily: 'ui-monospace, monospace' } : undefined}
              value={form.password} onChange={e => set('password', e.target.value)} placeholder={user ? '••••••••' : ''} />
            <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={generate} title="Générer un mot de passe sûr" aria-label="Générer un mot de passe sûr">
              <Wand2 size={13} />
            </button>
            {form.password && showPassword && (
              <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px' }} onClick={() => void copyPassword()} title="Copier" aria-label="Copier le mot de passe">
                <Copy size={13} />
              </button>
            )}
          </div>
        </Field>
        <Field label="Code PIN" hint={user ? (user.hasPin ? (removePin ? 'Sera retiré à l\'enregistrement' : (user.pinWeak ? 'À renouveler (6 chiffres au moins) ; vide = inchangé' : 'Défini ; vide = inchangé')) : 'Non défini ; 6 à 10 chiffres') : '6 à 10 chiffres, connexion en caisse'}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="user-pin" inputMode="numeric" maxLength={10} className={`odoo-input${pinInvalid ? ' invalid' : ''}`}
              style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em' }} autoComplete="off" disabled={removePin}
              value={form.pinCode} onChange={e => set('pinCode', e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            {user?.hasPin && (
              <button type="button" className={removePin ? 'odoo-btn-secondary' : 'odoo-btn-danger'} style={{ whiteSpace: 'nowrap' }}
                onClick={() => { setRemovePin(!removePin); set('pinCode', ''); }}>
                {removePin ? 'Garder' : 'Retirer'}
              </button>
            )}
          </div>
        </Field>
      </div>
      <Field label="Rôles" hint="Plusieurs rôles cumulent leurs droits (le plus permissif gagne). Droits par défaut : onglet Rôles et contrôle.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {roleChoices.map(([code, label]) => {
            const on = roleCodes.includes(code);
            return (
              <button key={code} type="button" className="odoo-filter-chip" aria-pressed={on} onClick={() => toggleRole(code)}
                style={{ background: on ? 'var(--odoo-purple)' : 'var(--odoo-bg)', color: on ? '#fff' : 'var(--odoo-text)', borderColor: on ? 'var(--odoo-purple)' : 'var(--odoo-border)', padding: '0.25rem 0.625rem', fontSize: '0.75rem' }}>
                {on && <Check size={11} />} {label}
              </button>
            );
          })}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Rôle principal" hint="Fixe le périmètre technique (écrans, filtres) du compte">
          <select id="user-primary-role" className="odoo-input" value={primaryRole} onChange={e => setPrimaryRole(e.target.value)} disabled={roleCodes.length <= 1}>
            {roleCodes.map(code => {
              const label = roleChoices.find(([c]) => c === code)?.[1] ?? ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code;
              return <option key={code} value={code}>{label}</option>;
            })}
          </select>
        </Field>
        <Field label="Établissement" hint="Boutique ou site de rattachement">
          <select id="user-store" className="odoo-input" value={form.storeId} onChange={e => set('storeId', e.target.value)}>
            <option value="">Aucun</option>
            {stores.map(s => <option key={s.id as string} value={s.id as string}>{s.name as string}{s.city ? ` (${s.city})` : ''}</option>)}
          </select>
        </Field>
      </div>
      {!user && (
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input id="user-must-change" type="checkbox" className="sal-check" checked={mustChangePassword} onChange={e => setMustChangePassword(e.target.checked)} />
            <span><strong>Changer le mot de passe à la première connexion</strong><br />
              <span style={{ color: 'var(--odoo-text-muted)' }}>Vous communiquez un mot de passe provisoire ; l'utilisateur choisit le sien en arrivant.</span></span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input id="user-mfa-required" type="checkbox" className="sal-check" checked={mfaRequired} onChange={e => setMfaRequired(e.target.checked)} />
            <span><strong>Exiger la double authentification</strong><br />
              <span style={{ color: 'var(--odoo-text-muted)' }}>Application d'authentification à configurer dès la première connexion (en plus des rôles qui l'imposent).</span></span>
          </label>
        </div>
      )}
      <Field label="Fiche salarié" hint="Relie ce compte à sa fiche pour l'espace employé (heures, bulletins, congés). Aucune = pas d'espace employé.">
        <select id="user-employee" className="odoo-input" value={effEmployeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Aucune</option>
          {employees.map(e => {
            const linkedElsewhere = !!e.user_id && e.user_id !== (user?.id as string);
            return <option key={e.id} value={e.id} disabled={linkedElsewhere}>{e.name}{linkedElsewhere ? ' (déjà lié à un compte)' : ''}</option>;
          })}
        </select>
      </Field>
      {user && <SecuritySection userId={user.id as string} selfId={me?.id} onDeleted={onClose} />}
    </HrModal>
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

// Modules that support category_slugs config (for partial access)
const CATEGORY_MODULES: AppModule[] = ['production'];

// Sections du module Parametres (config.sections) : vide = toutes les sections.
const SETTINGS_SECTION_KEYS = Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[];

function PermissionsModal({ user, roleLabel, onClose }: { user: UserRow; roleLabel: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const userId = user.id as string;
  const userRole = user.role as string;
  const userName = `${user.firstName} ${user.lastName}`;

  const { data: existingPerms, isLoading } = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => usersApi.getPermissions(userId),
  });

  // Puces de categories du module Production : table dediee /categories (legere),
  // au lieu de charger 500 produits entiers a chaque ouverture de la modale.
  const { data: categories = [] } = useQuery({
    queryKey: ['categories-list'],
    queryFn: () => categoriesApi.list(),
    staleTime: 5 * 60_000,
    select: (rows: Record<string, any>[]) =>
      rows.map(c => ({ slug: c.slug as string, name: c.name as string })).filter(c => c.slug && c.name),
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
  const toggleCategorySlug = (mod: AppModule, slug: string) => {
    const current = (perms?.[mod].config.category_slugs as string[]) || [];
    setConfig(mod, { category_slugs: current.includes(slug) ? current.filter(s => s !== slug) : [...current, slug] });
  };
  const toggleSettingsSection = (section: SettingsSection) => {
    const current = (perms?.settings.config.sections as SettingsSection[]) || [];
    setConfig('settings', { sections: current.includes(section) ? current.filter(s => s !== section) : [...current, section] });
  };

  if (userRole === 'admin') {
    return (
      <HrModal icon={Settings2} crumb="Droits" title={userName} width={480} onClose={onClose}
        footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
        <StatusBanner tone="neutral" icon={Lock} title="Administrateur">L'administrateur a accès à tous les modules ; ses droits ne se règlent pas.</StatusBanner>
      </HrModal>
    );
  }

  const chip = (selected: boolean): React.CSSProperties => ({
    background: selected ? 'var(--odoo-purple)' : 'var(--odoo-bg)', color: selected ? '#fff' : 'var(--odoo-text)',
    borderColor: selected ? 'var(--odoo-purple)' : 'var(--odoo-border)', padding: '0.25rem 0.625rem', fontSize: '0.75rem',
  });

  return (
    <HrModal icon={Settings2} crumb="Droits" title={userName} width={760} onClose={onClose}
      tag={<span className={`odoo-tag ${hasCustomPerms ? 'odoo-tag-orange' : 'odoo-tag-blue'}`}>{hasCustomPerms ? 'Droits propres' : `Droits du rôle ${roleLabel}`}</span>}
      footer={<>
        {hasCustomPerms && (
          <button type="button" className="odoo-btn-secondary" style={{ marginRight: 'auto' }} disabled={resetMutation.isPending} onClick={() => void resetToRole()}>
            <RotateCcw size={13} /> Revenir aux droits du rôle
          </button>
        )}
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <SubmitButton pending={saveMutation.isPending} disabled={!perms} onClick={() => saveMutation.mutate()}>
          <Check size={13} /> Enregistrer les droits
        </SubmitButton>
      </>}>
      <StatusBanner tone="info" icon={ShieldCheck} title={hasCustomPerms ? 'Cet utilisateur a des droits propres' : `Point de départ : les droits du rôle « ${roleLabel} »`}>
        {hasCustomPerms
          ? 'Ils remplacent ceux de son rôle tant qu\'ils existent.'
          : 'Enregistrer crée des droits propres à cet utilisateur, qui remplacent alors ceux du rôle.'}
      </StatusBanner>
      {isLoading || !perms ? <Loader2 className="animate-spin" size={18} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Module</th>{ACTIONS.map(([, l]) => <th key={l} style={{ textAlign: 'center', width: 84 }}>{l}</th>)}</tr></thead>
            <tbody>
              {/* « Utilisateurs » reste reserve a l'administrateur (routes /users en dur). */}
              {ALL_MODULES.filter(m => m !== 'users').map(mod => {
                const p = perms[mod];
                const sections = (p.config.sections as string[]) || [];
                const slugs = (p.config.category_slugs as string[]) || [];
                return [
                  <tr key={mod} style={{ opacity: p.canView ? 1 : 0.65 }}>
                    <td style={{ fontWeight: p.canView ? 600 : 400 }}>{MODULE_LABELS[mod] ?? mod}</td>
                    {ACTIONS.map(([f, l]) => (
                      <td key={f} style={{ textAlign: 'center' }}>
                        <input type="checkbox" id={`up-${mod}-${f}`} aria-label={`${l} ${MODULE_LABELS[mod] ?? mod}`}
                          checked={p[f]} onChange={() => toggleModule(mod, f)} />
                      </td>
                    ))}
                  </tr>,
                  p.canView && (
                    <tr key={`${mod}-scope`}>
                      <td colSpan={5} style={{ background: 'var(--odoo-bg-alt)' }}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingLeft: 16 }}>
                          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.75rem' }}>
                            <span style={{ fontWeight: 600 }}>Portée des données</span>
                            <select className="odoo-input" style={{ width: 'auto', padding: '2px 6px' }}
                              value={p.scope || 'store'} onChange={e => setScope(mod, e.target.value)}>
                              {DATA_SCOPES.map(s => <option key={s} value={s}>{DATA_SCOPE_LABELS[s]}</option>)}
                            </select>
                          </label>
                          {verbsFor(mod).length > 0 && (
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Actions métier</span>
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
                      <td colSpan={5} style={{ background: 'var(--odoo-bg-alt)' }}>
                        <div style={{ display: 'grid', gap: 6, paddingLeft: 16 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                            Sections autorisées {!sections.length && <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)' }}>— toutes (aucune restriction)</span>}
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
                  CATEGORY_MODULES.includes(mod) && p.canView && (
                    <tr key={`${mod}-categories`}>
                      <td colSpan={5} style={{ background: 'var(--odoo-bg-alt)' }}>
                        <div style={{ display: 'grid', gap: 6, paddingLeft: 16 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                            Catégories autorisées {!slugs.length && <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)' }}>— toutes (aucune restriction)</span>}
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                              <button type="button" className="odoo-btn-secondary" style={{ padding: '1px 8px', fontSize: '0.75rem' }}
                                onClick={() => setConfig(mod, { category_slugs: categories.map(c => c.slug) })}>Tout</button>
                              <button type="button" className="odoo-btn-secondary" style={{ padding: '1px 8px', fontSize: '0.75rem' }}
                                onClick={() => setConfig(mod, { category_slugs: [] })}>Effacer</button>
                            </span>
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {categories.map(cat => (
                              <button key={cat.slug} type="button" className="odoo-filter-chip" style={chip(slugs.includes(cat.slug))}
                                aria-pressed={slugs.includes(cat.slug)} onClick={() => toggleCategorySlug(mod, cat.slug)}>
                                {slugs.includes(cat.slug) && <Check size={11} />} {cat.name}
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
        </div>
      )}
    </HrModal>
  );
}
