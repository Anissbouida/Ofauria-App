import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Lock, Mail, Plus, ShieldAlert, TriangleAlert, Users, Wand2, Copy } from 'lucide-react';
import { APPROVAL_DOC_TYPES, APPROVAL_DOCUMENT_LABELS, MODULE_LABELS, WORKSPACES, type AppModule, type ApprovalDocumentType } from '@ofauria/shared';
import { currencySymbol } from '../../utils/money';
import { usersApi, rolesApi, accessReviewApi } from '../../api/users.api';
import { storesApi } from '../../api/stores.api';
import {
  Breadcrumb, Tabs, SectionHeader, DataPanel, FormField, FormFooter, Alert, LoadingState, ErrorState, EmptyState,
} from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { useAuth } from '../../context/AuthContext';
import { AccessRightsView, AccessHistoryView } from './AccessReviewPanel';
import { SecuritySection, MfaTag, errorMessage, fullName, formatLastLogin, formatDateTime, generatePassword, type UserRow } from './AccountSecurity';
import { ExceptionsPanel } from './ExceptionsPanel';
import { StoresField } from './StoresField';
import { useSecurityPolicy, strongPasswordOk, passwordRule, pinOk, deviceLabel, METHOD_LABELS } from './securityPolicy';
import { fmtDate } from './UsersOverview';
import { InvitationSentModal } from './NewUserWizard';
import type { InvitationResult } from '../../api/users.api';
import '../settings/settings.css';
import './users.css';

/**
 * Fiche d'un compte en page (refonte Utilisateurs, lot 2) : Profil, Rôles et périmètre, Droits
 * effectifs, Sécurité, Historique ; résumé et signaux à droite. Les rattachements réglés dans les
 * autres modules (ateliers, essais, circuits, délégations) y sont réunis pour lecture.
 */
type Tab = 'profile' | 'roles' | 'rights' | 'security' | 'history';

const docLabel = (d: string) => (APPROVAL_DOC_TYPES as Record<string, { label: string }>)[d]?.label ?? d;
const PROVIDERS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

export default function UserRecordPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (['profile', 'roles', 'rights', 'security', 'history'].includes(params.get('tab') ?? '') ? params.get('tab') : 'profile') as Tab;
  const setTab = (t: Tab) => { const n = new URLSearchParams(params); n.set('tab', t); setParams(n, { replace: true }); };
  const { user: me } = useAuth();

  const usersQ = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: review } = useQuery({ queryKey: ['access-review', id], queryFn: () => accessReviewApi.review(id), enabled: !!id, retry: false });
  const { data: employees = [] } = useQuery<Array<{ id: string; name: string; user_id: string | null }>>({ queryKey: ['employees-link'], queryFn: usersApi.employeesForLink });
  const back = () => navigate('/users?tab=accounts');

  const u = usersQ.data?.find(x => x.id === id);
  if (usersQ.isLoading) return <div className="odoo-scope kl-page"><LoadingState /></div>;
  if (usersQ.isError || !u) {
    return (
      <div className="odoo-scope kl-page">
        <ErrorState error={usersQ.error} title="Compte introuvable" text="Ce compte n'existe pas ou a été supprimé définitivement." />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="odoo-btn-secondary" onClick={back}>Retour aux comptes</button>
        </div>
      </div>
    );
  }

  const name = fullName(u) || (u.email as string);
  const roleLabel = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const roleCodes: string[] = Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []);
  const store = stores.find(s => s.id === u.storeId)?.name as string | undefined;
  const otherStores = (Array.isArray(u.storeIds) ? (u.storeIds as string[]) : []).filter(id => id !== u.storeId).length;
  const employee = employees.find(e => e.user_id === u.id);
  const conflicts = review?.sodViolations ?? [];
  const self = u.id === me?.id;
  const initials = (`${(u.firstName as string)?.[0] ?? ''}${(u.lastName as string)?.[0] ?? ''}` || name[0]).toUpperCase();

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Breadcrumb icon={Users} items={[
          { label: 'Utilisateurs', onClick: () => navigate('/users') },
          { label: 'Comptes', onClick: back },
          { label: name },
        ]} />
      </div>
      <div className="kl-page">
        <header className="usr-record-head">
          <span className={`usr-av lg${u.isActive ? '' : ' off'}`} aria-hidden="true">{initials}</span>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h1>
              {name}
              {self && <StatusTag tone="progress" label="Vous" />}
              {!u.isActive ? <StatusTag tone="cancelled" label="Désactivé" />
                : u.lockedUntil ? <StatusTag tone="blocked" label="Verrouillé" icon={Lock} />
                : u.invitationExpiresAt ? (new Date(u.invitationExpiresAt).getTime() < Date.now()
                  ? <StatusTag tone="late" label="Invitation expirée" icon={Mail} />
                  : <StatusTag tone="todo" label="Invité" icon={Mail} />)
                : <StatusTag tone="done" label="Actif" />}
            </h1>
            <p>{roleLabel(u.role)} · {store ?? (u.role === 'admin' ? 'Tous les établissements' : 'Sans établissement')}{u.createdAt ? ` · compte créé le ${fmtDate(u.createdAt)}` : ''}</p>
          </div>
        </header>
        <Tabs label="Sections de la fiche" value={tab} onChange={setTab} tabs={[
          { key: 'profile', label: 'Profil' },
          { key: 'roles', label: 'Rôles et périmètre', count: roleCodes.length },
          { key: 'rights', label: 'Droits effectifs' },
          { key: 'security', label: 'Sécurité', count: (u.mfaRequired && !u.mfaEnabled) || u.lockedUntil || u.mustChangePassword ? 1 : undefined },
          { key: 'history', label: 'Historique' },
        ]} />
        <div className="usr-record">
          <div style={{ display: 'grid', gap: 'var(--ds-s5)', minWidth: 0 }}>
            {tab === 'profile' && <ProfileTab u={u} />}
            {tab === 'roles' && <RolesTab u={u} limits={review?.approvalLimits ?? []} />}
            {tab === 'rights' && <RightsTab u={u} />}
            {tab === 'security' && <SecurityTab u={u} selfId={me?.id} onDeleted={back} />}
            {tab === 'history' && <DataPanel label="Historique du compte"><AccessHistoryView userId={u.id} /></DataPanel>}
          </div>
          <aside className="ds-panel usr-side" aria-label="Résumé du compte">
            <h3>Résumé</h3>
            <dl className="usr-kv">
              <dt>Rôle principal</dt><dd>{roleLabel(u.role)}</dd>
              {roleCodes.length > 1 && <><dt>Autres rôles</dt><dd>{roleCodes.filter(c => c !== u.role).map(roleLabel).join(', ')}</dd></>}
              <dt>Établissement</dt><dd>{store ? `${store}${otherStores ? ` +${otherStores}` : ''}` : (u.role === 'admin' ? 'Tous' : 'Aucun')}</dd>
              <dt>Connexion</dt><dd title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>{u.lastLoginAt ? formatLastLogin(u.lastLoginAt) : 'Jamais connecté'}</dd>
              <dt>2FA</dt><dd><MfaTag u={u} /></dd>
            </dl>
            {(conflicts.length > 0 || (u.mfaRequired && !u.mfaEnabled) || u.lockedUntil || u.mustChangePassword || u.pinWeak) && <>
              <h3>Signaux</h3>
              {conflicts.map(c => <Alert key={c.code} tone="danger" icon={TriangleAlert}>Conflit « {c.label} »</Alert>)}
              {u.mfaRequired && !u.mfaEnabled && <Alert tone="warning" icon={ShieldAlert}>Double authentification à configurer</Alert>}
              {u.lockedUntil && <Alert tone="warning" icon={Lock}>Verrouillé jusqu'au {formatDateTime(u.lockedUntil)}</Alert>}
              {u.mustChangePassword && <Alert tone="warning" icon={KeyRound}>Mot de passe à changer à la prochaine connexion</Alert>}
              {u.pinWeak && <Alert tone="warning" icon={KeyRound}>Code PIN à renouveler</Alert>}
            </>}
            <h3>Fiche salarié</h3>
            {employee ? (
              <button type="button" className="ds-btn-ghost ds-btn-sm" style={{ justifySelf: 'start' }} onClick={() => navigate(`/employees/${employee.id}`)}>
                {employee.name} <ExternalLink size={12} aria-hidden="true" />
              </button>
            ) : <span style={{ color: 'var(--ds-muted)' }}>Aucune fiche reliée</span>}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ============ PROFIL ============ */

function ProfileTab({ u }: { u: UserRow }) {
  const queryClient = useQueryClient();
  const { data: employees = [], isFetched } = useQuery<Array<{ id: string; name: string; user_id: string | null }>>({ queryKey: ['employees-link'], queryFn: usersApi.employeesForLink });
  const { data: profile } = useQuery({ queryKey: ['user-profile', u.id], queryFn: () => usersApi.profile(u.id) });
  const linked = employees.find(e => e.user_id === u.id)?.id ?? '';
  const initial = useMemo(() => ({ firstName: (u.firstName as string) ?? '', lastName: (u.lastName as string) ?? '', email: (u.email as string) ?? '', employeeId: linked }), [u, linked]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const invalid = !form.firstName.trim() || !form.lastName.trim() || !/^\S+@\S+\.\S+$/.test(form.email);
  const save = useMutation({
    mutationFn: () => usersApi.update(u.id, {
      firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
      ...(isFetched ? { employeeId: form.employeeId || null } : {}),
    }),
    onSuccess: () => { notify.success('Profil enregistré'); queryClient.invalidateQueries({ queryKey: ['users'] }); queryClient.invalidateQueries({ queryKey: ['employees-link'] }); },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  const prefInitial = useMemo(() => ({ locale: profile?.preferences.locale ?? '', workspace: profile?.preferences.workspace ?? '' }), [profile]);
  const [prefs, setPrefs] = useState(prefInitial);
  useEffect(() => setPrefs(prefInitial), [prefInitial]);
  const prefsDirty = JSON.stringify(prefs) !== JSON.stringify(prefInitial);
  const savePrefs = useMutation({
    mutationFn: () => usersApi.setPreferences(u.id, { locale: (prefs.locale || null) as 'fr' | 'ar' | 'en' | null, workspace: prefs.workspace || null }),
    onSuccess: () => { notify.success('Préférences enregistrées'); queryClient.invalidateQueries({ queryKey: ['user-profile', u.id] }); queryClient.invalidateQueries({ queryKey: ['users'] }); },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });

  return (
    <>
      <DataPanel label="Identité">
        <div className="usr-pad">
          <fieldset className="ds-fieldset"><legend>Identité</legend>
            <div className="ds-form-grid">
              <FormField label="Prénom" htmlFor="u-first" required><input id="u-first" className="ds-input" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} /></FormField>
              <FormField label="Nom" htmlFor="u-last" required><input id="u-last" className="ds-input" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} /></FormField>
              <FormField label="E-mail de connexion" htmlFor="u-mail" required hint="Sert d'identifiant de connexion.">
                <input id="u-mail" type="email" className="ds-input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </FormField>
              <FormField label="Fiche salarié" htmlFor="u-emp" hint="Ouvre l'espace employé à ce compte.">
                <select id="u-emp" className="ds-input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
                  <option value="">Aucune</option>
                  {employees.map(e => <option key={e.id} value={e.id} disabled={!!e.user_id && e.user_id !== u.id}>{e.name}{e.user_id && e.user_id !== u.id ? ' (reliée à un autre compte)' : ''}</option>)}
                </select>
              </FormField>
            </div>
          </fieldset>
        </div>
        <FormFooter dirty={dirty} busy={save.isPending} disabled={!dirty || invalid} onCancel={() => setForm(initial)} onSubmit={() => save.mutate()} />
      </DataPanel>

      <DataPanel label="Préférences">
        <div className="usr-pad">
          <fieldset className="ds-fieldset"><legend>Préférences</legend>
            <div className="ds-form-grid">
              <FormField label="Langue de l'interface" htmlFor="u-locale" hint="La personne peut aussi la changer elle-même.">
                <select id="u-locale" className="ds-input" value={prefs.locale} onChange={e => setPrefs(p => ({ ...p, locale: e.target.value }))}>
                  <option value="">Langue de la société</option>
                  <option value="fr">Français</option>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </FormField>
              <FormField label="Espace de travail à l'ouverture" htmlFor="u-ws" hint="Préférence de navigation, jamais un droit d'accès.">
                <select id="u-ws" className="ds-input" value={prefs.workspace} onChange={e => setPrefs(p => ({ ...p, workspace: e.target.value }))} disabled={profile && !profile.preferences.available}>
                  <option value="">Valeur de la société</option>
                  {WORKSPACES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
              </FormField>
            </div>
          </fieldset>
        </div>
        <FormFooter dirty={prefsDirty} busy={savePrefs.isPending} disabled={!prefsDirty} onCancel={() => setPrefs(prefInitial)} onSubmit={() => savePrefs.mutate()} />
      </DataPanel>

      <section style={{ display: 'grid', gap: 'var(--ds-s3)' }}>
        <SectionHeader title="Connexion par un compte externe" note="Rattachée par l'adresse e-mail à chaque connexion" />
        <DataPanel label="Connexion par un compte externe">
          {profile?.identities.length ? (
            <table className="odoo-table ds-dense">
              <thead><tr><th>Fournisseur</th><th>Adresse</th><th>Première connexion</th><th>Dernière connexion</th></tr></thead>
              <tbody>
                {profile.identities.map(i => (
                  <tr key={`${i.provider}-${i.email}`}>
                    <td className="ds-strong">{PROVIDERS[i.provider] ?? i.provider}</td>
                    <td>{i.email ?? '—'}</td>
                    <td>{fmtDate(i.createdAt)}</td>
                    <td>{i.lastLoginAt ? formatDateTime(i.lastLoginAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={Users} title="Aucune connexion externe" text="Ce compte se connecte par son e-mail et son mot de passe." bare />}
        </DataPanel>
      </section>
    </>
  );
}

/* ============ RÔLES ET PÉRIMÈTRE ============ */

function RolesTab({ u, limits }: { u: UserRow; limits: { documentType: string; configured: boolean; limit: number | null }[] }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, retry: false });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const { data: profile } = useQuery({ queryKey: ['user-profile', u.id], queryFn: () => usersApi.profile(u.id) });
  const initial = useMemo(() => ({
    roles: (Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : [])) as string[],
    primary: (u.role as string) ?? '',
    storeId: (u.storeId as string) ?? '',
    storeIds: (Array.isArray(u.storeIds) ? u.storeIds : (u.storeId ? [u.storeId] : [])) as string[],
  }), [u]);
  const [form, setForm] = useState(initial);
  const [adding, setAdding] = useState('');
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const label = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const addable = roles.filter(r => r.is_active && r.available !== false && !form.roles.includes(r.code));

  const save = useMutation({
    mutationFn: () => usersApi.update(u.id, { roles: form.roles, primaryRole: form.primary, storeId: form.storeId || null, storeIds: form.storeIds }),
    onSuccess: () => {
      notify.success('Rôles et périmètre enregistrés');
      ['users', 'roles', 'access-review', 'user-profile', 'sod-violations'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
    },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  // Changement de rôle principal : les sessions sont fermées, les exceptions individuelles conservées (lot 6).
  const submit = async () => {
    if (form.primary !== initial.primary) {
      const ok = await confirm(
        `Le rôle principal passe de « ${label(initial.primary)} » à « ${label(form.primary)} ». La page d'accueil et le contrôle des écrans suivront le nouveau rôle.`
        + ' Ses exceptions individuelles sont conservées. Ses sessions ouvertes seront fermées.',
        { title: 'Changer le rôle principal ?', confirmLabel: 'Changer le rôle principal' });
      if (!ok) return;
    }
    save.mutate();
  };

  const attachments = [
    ...(profile?.workshops ?? []).map(w => ({ key: `w-${w.code}-${w.roleCode}`, what: 'Atelier de production', value: w.label, via: w.via === 'user' ? 'ce compte' : `rôle ${label(w.roleCode ?? '')}`, link: { label: 'Ateliers', to: '/settings?page=production' } })),
    ...(profile?.pilots ?? []).map(p => ({ key: `p-${p.moduleKey}-${p.roleCode}`, what: 'Module en essai', value: MODULE_LABELS[p.moduleKey as AppModule] ?? p.moduleKey, via: p.via === 'user' ? 'ce compte' : `rôle ${label(p.roleCode ?? '')}`, link: { label: 'Modules', to: '/settings?page=sector' } })),
    ...(profile?.approvalSteps ?? []).map(s => ({ key: `a-${s.ruleCode}-${s.stepOrder}`, what: "Circuit d'approbation", value: `${s.ruleLabel} (${docLabel(s.docType)}, étape ${s.stepOrder})${s.enabled ? '' : ' · circuit désactivé'}`, via: s.via === 'user' ? 'ce compte' : `rôle ${label(s.roleCode ?? '')}`, link: { label: 'Circuits', to: '/settings?page=approvals' } })),
    ...(profile?.delegations ?? []).map(d => ({ key: d.id, what: d.direction === 'given' ? 'Délégation donnée' : 'Délégation reçue', value: `${d.kind === 'role' ? `Rôle ${label(d.roleCode ?? '')}` : 'Approbations'} ${d.direction === 'given' ? '→' : '←'} ${d.otherName}, du ${fmtDate(d.startsAt)} au ${fmtDate(d.endsAt)}${d.active ? ' · en cours' : ''}`, via: d.kind === 'role' ? 'administrateur' : 'la personne', link: { label: 'Délégations', to: d.kind === 'role' ? '/users?tab=delegations' : '/approvals' } })),
  ];

  return (
    <>
      <DataPanel label="Rôles">
        <div className="usr-pad" style={{ paddingBottom: 0 }}>
          <SectionHeader title="Rôles" note="Le droit le plus large l'emporte." />
        </div>
        <table className="odoo-table">
          <thead><tr><th>Rôle</th><th>Principal</th><th className="ds-num">Modules</th><th className="ds-actions"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>
            {form.roles.map(c => (
              <tr key={c}>
                <td className="ds-strong">{label(c)}</td>
                <td><input type="radio" name="primary-role" checked={form.primary === c} onChange={() => setForm(f => ({ ...f, primary: c }))} aria-label={`${label(c)} comme rôle principal`} /></td>
                <td className="ds-num">{c === 'admin' ? 'Tous' : roles.find(r => r.code === c)?.module_count ?? '—'}</td>
                <td className="ds-actions">
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={form.roles.length === 1}
                    title={form.roles.length === 1 ? 'Au moins un rôle' : undefined}
                    onClick={() => setForm(f => { const next = f.roles.filter(x => x !== c); return { ...f, roles: next, primary: f.primary === c ? next[0] : f.primary }; })}>Retirer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="usr-pad" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="ds-input sm" style={{ width: 'auto' }} value={adding} onChange={e => setAdding(e.target.value)} aria-label="Rôle à ajouter">
            <option value="">Ajouter un rôle…</option>
            {addable.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!adding}
            onClick={() => { setForm(f => ({ ...f, roles: [...f.roles, adding] })); setAdding(''); }}><Plus size={13} aria-hidden="true" /> Ajouter</button>
        </div>
        <div className="usr-pad">
          <fieldset className="ds-fieldset"><legend>Périmètre</legend>
            <div className="ds-form-grid">
              <FormField label="Établissements" hint="La portée « Son établissement » se lit sur l'établissement actif : celui par défaut à la connexion, puis celui choisi dans la barre du haut.">
                <StoresField idPrefix="u-store" stores={stores.map(s => ({ id: s.id as string, name: s.name as string }))}
                  ids={form.storeIds} defaultId={form.storeId} onChange={(ids, def) => setForm(f => ({ ...f, storeIds: ids, storeId: def }))} />
              </FormField>
              <FormField label="Plafonds d'approbation" hint="Viennent des rôles ; ils se règlent dans Contrôles internes.">
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 6 }}>
                  {limits.filter(l => l.configured).length
                    ? limits.filter(l => l.configured).map(l => <span key={l.documentType} className="kl-tag x">{APPROVAL_DOCUMENT_LABELS[l.documentType as ApprovalDocumentType] ?? l.documentType} : {l.limit === null ? 'illimité' : `${l.limit.toLocaleString('fr-FR')} ${currencySymbol()}`}</span>)
                    : <span style={{ color: 'var(--ds-muted)', fontSize: 14 }}>Aucun plafond</span>}
                </div>
              </FormField>
            </div>
          </fieldset>
        </div>
        <FormFooter dirty={dirty} busy={save.isPending} disabled={!dirty || form.roles.length === 0} onCancel={() => setForm(initial)} onSubmit={() => void submit()} />
      </DataPanel>

      <section style={{ display: 'grid', gap: 'var(--ds-s3)' }}>
        <SectionHeader title="Rattachements" note="Réglés dans d'autres modules, réunis ici pour lecture" />
        <DataPanel label="Rattachements">
          {attachments.length ? (
            <table className="odoo-table ds-dense">
              <thead><tr><th>Élément</th><th>Valeur</th><th>Par</th><th className="ds-actions"><span className="sr-only">Ouvrir</span></th></tr></thead>
              <tbody>
                {attachments.map(a => (
                  <tr key={a.key}>
                    <td className="ds-strong">{a.what}</td>
                    <td>{a.value}</td>
                    <td>{a.via}</td>
                    <td className="ds-actions"><button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate(a.link.to)}>{a.link.label} <ExternalLink size={12} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={Users} title="Aucun rattachement" text="Ni atelier, ni module en essai, ni circuit d'approbation, ni délégation." bare />}
        </DataPanel>
      </section>
    </>
  );
}

/* ============ DROITS EFFECTIFS ============ */

function RightsTab({ u }: { u: UserRow }) {
  return (
    <>
      <section style={{ display: 'grid', gap: 'var(--ds-s3)' }}>
        <SectionHeader title="Droits effectifs" note="Ce que le compte peut faire, et pourquoi" />
        <AccessRightsView userId={u.id} />
      </section>
      <ExceptionsPanel userId={u.id} userName={fullName(u)} />
    </>
  );
}

/* ============ SÉCURITÉ ============ */

function SecurityTab({ u, selfId, onDeleted }: { u: UserRow; selfId?: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pin, setPin] = useState('');
  const policy = useSecurityPolicy();
  const pwdInvalid = !!password && !strongPasswordOk(password, policy.passwordMinLength);
  const pinInvalid = !!pin && !pinOk(pin, policy.pinMinLength);
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => usersApi.update(u.id, data),
    onSuccess: (_d, data) => {
      notify.success('pinCode' in data ? (data.pinCode ? 'Code PIN enregistré' : 'Code PIN retiré') : 'Mot de passe enregistré : les sessions du compte sont fermées');
      setPassword(''); setPin(''); setShow(false);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: err => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); notify.success('Mot de passe copié'); }
    catch { notify.error('Copie impossible : sélectionnez le mot de passe à la main'); }
  };
  const [sent, setSent] = useState<InvitationResult | null>(null);
  const invite = useMutation({
    mutationFn: () => usersApi.invite(u.id),
    onSuccess: r => { setSent(r); queryClient.invalidateQueries({ queryKey: ['users'] }); },
    onError: err => notify.error(errorMessage(err, 'Invitation refusée')),
  });
  const invitationExpired = !!u.invitationExpiresAt && new Date(u.invitationExpiresAt).getTime() < Date.now();

  return (
    <>
      {u.isActive && (u.invitationExpiresAt || !u.lastLoginAt) && (
        <Alert tone={invitationExpired ? 'danger' : u.invitationExpiresAt ? 'warning' : 'info'} icon={Mail}
          action={<button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={invite.isPending} onClick={() => invite.mutate()}>{u.invitationExpiresAt ? 'Renvoyer l\'invitation' : 'Envoyer une invitation'}</button>}>
          {invitationExpired ? `Invitation expirée le ${formatDateTime(u.invitationExpiresAt)} : le compte ne peut pas se connecter.`
            : u.invitationExpiresAt ? `Invitation en attente, lien valable jusqu'au ${formatDateTime(u.invitationExpiresAt)}.`
            : 'Ce compte ne s\'est jamais connecté. Une invitation lui permet de choisir son mot de passe.'}
        </Alert>
      )}
      {sent && <InvitationSentModal result={sent} email={u.email as string} onClose={() => setSent(null)} />}
      <DataPanel label="Mot de passe et code PIN">
        <div className="usr-pad">
          <fieldset className="ds-fieldset"><legend>Mot de passe et code PIN</legend>
            <div className="ds-form-grid">
              <FormField label="Nouveau mot de passe" htmlFor="u-pwd" error={pwdInvalid ? passwordRule(policy.passwordMinLength) : undefined}
                hint={pwdInvalid ? undefined : 'Pensez à imposer un changement à la prochaine connexion, ci-dessous.'}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="u-pwd" type={show ? 'text' : 'password'} className="ds-input" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} aria-invalid={pwdInvalid || undefined} />
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => { setPassword(generatePassword(Math.max(14, policy.passwordMinLength + 2))); setShow(true); }} title="Générer un mot de passe sûr"><Wand2 size={13} aria-hidden="true" /> Générer</button>
                  {password && show && <button type="button" className="ds-icon-btn" onClick={() => void copy()} aria-label="Copier le mot de passe"><Copy size={15} /></button>}
                </div>
              </FormField>
              <FormField label="Code PIN de caisse" htmlFor="u-pin" error={pinInvalid ? `${policy.pinMinLength} à 10 chiffres` : undefined}
                hint={pinInvalid ? undefined : (u.hasPin ? (u.pinWeak ? `Code actuel à renouveler (moins de ${policy.pinMinLength} chiffres).` : 'Un code est défini ; saisir pour le remplacer.') : 'Aucun code : connexion rapide indisponible sur les postes partagés.')}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="u-pin" className="ds-input" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder={`${policy.pinMinLength} chiffres au moins`} />
                  {u.hasPin && <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={save.isPending} onClick={() => save.mutate({ pinCode: null })}>Retirer</button>}
                </div>
              </FormField>
            </div>
          </fieldset>
        </div>
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" className="odoo-btn-secondary" disabled={!pin || pinInvalid || save.isPending} onClick={() => save.mutate({ pinCode: pin })}>Enregistrer le PIN</button>
          <button type="button" className="odoo-btn-primary" disabled={!password || pwdInvalid || save.isPending} onClick={() => save.mutate({ password })}>Enregistrer le mot de passe</button>
        </div>
      </DataPanel>
      <DataPanel label="Sécurité du compte">
        <div className="usr-pad"><SecuritySection userId={u.id} selfId={selfId} onDeleted={onDeleted} /></div>
      </DataPanel>
      <SessionsPanel u={u} selfId={selfId} />
    </>
  );
}

/* ============ SESSIONS ET APPAREILS (lot 8) ============ */

function SessionsPanel({ u, selfId }: { u: UserRow; selfId?: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: sessions = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['user-sessions', u.id], queryFn: () => usersApi.sessions(u.id) });
  const refresh = () => ['user-sessions', 'users', 'access-history'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const closeOne = useMutation({
    mutationFn: (jti: string) => usersApi.closeSession(u.id, jti),
    onSuccess: () => { notify.success('Session fermée'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Fermeture refusée')),
  });
  const closeAll = useMutation({
    mutationFn: () => usersApi.revokeSessions(u.id),
    onSuccess: () => { notify.success('Sessions fermées'); refresh(); },
    onError: err => notify.error(errorMessage(err, 'Fermeture refusée')),
  });
  const self = u.id === selfId;
  const askAll = async () => {
    if (await confirm(`${fullName(u)} devra se reconnecter sur tous ses appareils ; les postes de confiance sont oubliés.`,
      { title: 'Fermer toutes les sessions ?', confirmLabel: 'Fermer les sessions' })) closeAll.mutate();
  };
  return (
    <section style={{ display: 'grid', gap: 'var(--ds-s3)' }} aria-label="Sessions et appareils">
      <SectionHeader title="Sessions et appareils" note="Connexions encore ouvertes, avec leur dernière activité">
        {!self && sessions.length > 0 && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={closeAll.isPending} onClick={() => void askAll()}>Fermer toutes les sessions</button>
        )}
      </SectionHeader>
      <DataPanel label="Sessions et appareils">
        {isError ? <ErrorState bare error={error} title="Les sessions n'ont pas pu être chargées" onRetry={() => void refetch()} />
          : isLoading ? <LoadingState bare />
          : sessions.length ? (
            <table className="odoo-table ds-dense">
              <thead><tr><th>Appareil</th><th>Connexion</th><th>Adresse IP</th><th>Ouverte le</th><th>Dernière activité</th><th className="ds-actions"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.jti}>
                    <td><span className="ds-strong">{deviceLabel(s.userAgent)}</span>{s.current && <span className="kl-tag b" style={{ marginLeft: 6 }}>Cette session</span>}{s.storeName && <div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{s.storeName}</div>}</td>
                    <td>{METHOD_LABELS[s.method ?? ''] ?? '—'}</td>
                    <td>{s.ip === '::1' || s.ip === '127.0.0.1' || s.ip === '::ffff:127.0.0.1' ? 'Ce poste (local)' : s.ip ?? '—'}</td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td>{formatLastLogin(s.lastSeenAt)}</td>
                    <td className="ds-actions">
                      {!s.current && <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={closeOne.isPending} onClick={() => closeOne.mutate(s.jti)}>Fermer</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState icon={Lock} bare title="Aucune session ouverte" text="Les connexions faites depuis la mise en place du suivi apparaissent ici." />}
      </DataPanel>
    </section>
  );
}
