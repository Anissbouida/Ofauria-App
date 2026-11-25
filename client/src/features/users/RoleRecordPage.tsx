import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Info, Lock, Plus, ShieldCheck, Trash2, TriangleAlert, Users } from 'lucide-react';
import {
  APPROVAL_DOC_TYPES, BUSINESS_VERB_LABELS, DATA_SCOPES, DATA_SCOPE_LABELS, MODULE_LABELS, SETTINGS_SECTION_LABELS, screenDef,
  type AppModule, type BusinessVerb, type DataScope, type SettingsSection,
} from '@ofauria/shared';
import { rolesApi, usersApi, type RolePermission, type RoleRow } from '../../api/users.api';
import { settingsApi } from '../../api/settings.api';
import { storesApi } from '../../api/stores.api';
import {
  Breadcrumb, Tabs, DataPanel, TableFooter, FormField, Alert, LoadingState, ErrorState, EmptyState, Modal, Toolbar, SearchBar, NoResultState, SectionHeader,
} from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { currencySymbol } from '../../utils/money';
import { NAV_ITEMS, navLabel } from '../../config/navigation';
import { NewRoleModal, baseRoleChoices, errorMessage } from './RolesPanel';
import { fmtDate } from './UsersOverview';
import type { UserRow } from './AccountSecurity';
import {
  LEVELS, ORIGIN, ROLE_MODULES, alignKeys, applyLevel, keyGroup, keyInLevel, keyLevel, keysOfModule, levelLabel, levelOf, permOf, verbsOf,
  type Level,
} from './roleAccess';
import '../settings/settings.css';
import './users.css';

/**
 * Fiche d'un rôle en page (refonte Utilisateurs, lot 4) : accès par module (un niveau par module
 * qui règle aussi les permissions détaillées), permissions détaillées, membres, contrôles et
 * rattachements, identité (libellé, rôle de base, description, page d'accueil).
 */
type Tab = 'access' | 'detail' | 'members' | 'controls' | 'identity';
const TABS: Tab[] = ['access', 'detail', 'members', 'controls', 'identity'];
const SECTION_KEYS = Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[];
const docLabel = (d: string) => (APPROVAL_DOC_TYPES as Record<string, { label: string }>)[d]?.label ?? d;
const sameSet = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

function emptyPerm(mod: string): RolePermission {
  return { module: mod, canView: false, canCreate: false, canEdit: false, canDelete: false, verbs: [], scope: 'store', config: {} };
}
function samePerm(a: RolePermission, b: RolePermission) {
  return a.canView === b.canView && a.canCreate === b.canCreate && a.canEdit === b.canEdit && a.canDelete === b.canDelete
    && (a.scope ?? 'store') === (b.scope ?? 'store') && sameSet(a.verbs, b.verbs)
    && sameSet((a.config?.sections as string[]) ?? [], (b.config?.sections as string[]) ?? []);
}

export default function RoleRecordPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'access') as Tab;
  const setTab = (t: Tab) => { const n = new URLSearchParams(params); n.set('tab', t); setParams(n, { replace: true }); };
  const queryClient = useQueryClient();

  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const role = rolesQ.data?.find(r => r.code === code);
  const isAdmin = code === 'admin';
  const profileQ = useQuery({ queryKey: ['role-profile', code], queryFn: () => rolesApi.profile(code), enabled: !!role });
  const permsQ = useQuery({ queryKey: ['role-permissions', code], queryFn: () => rolesApi.permissions(code), enabled: !!role && !isAdmin });
  const { data: sector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const active = useMemo(() => new Set(sector?.current?.modules ?? []), [sector]);

  // Brouillon des droits, partagé par les onglets Accès et Permissions détaillées.
  const [perms, setPerms] = useState<Record<string, RolePermission> | null>(null);
  const [keys, setKeys] = useState<string[] | null>(null);
  const savedPerms = useMemo(() => {
    if (!permsQ.data) return null;
    const m: Record<string, RolePermission> = {};
    for (const mod of ROLE_MODULES) {
      const s = permOf(permsQ.data, mod);
      m[mod] = s ? { ...emptyPerm(mod), ...s, module: mod, verbs: s.verbs ?? [], scope: s.scope ?? 'store', config: s.config ?? {} } : emptyPerm(mod);
    }
    return m;
  }, [permsQ.data]);
  const savedKeys = profileQ.data?.actionKeys;
  useEffect(() => { if (savedPerms) setPerms(savedPerms); }, [savedPerms]);
  useEffect(() => { if (savedKeys) setKeys(savedKeys); }, [savedKeys]);
  const changedModules = perms && savedPerms ? ROLE_MODULES.filter(m => !samePerm(perms[m], savedPerms[m])) : [];
  const keysChanged = !!keys && !!savedKeys && !sameSet(keys, savedKeys);
  const dirty = changedModules.length > 0 || keysChanged;

  const save = useMutation({
    mutationFn: () => rolesApi.setPermissions(code, Object.values(perms!).filter(p => p.canView), keys ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions', code] });
      queryClient.invalidateQueries({ queryKey: ['role-profile', code] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      notify.success(`Droits du rôle « ${role?.label ?? code} » enregistrés`);
    },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const reset = () => { if (savedPerms) setPerms(savedPerms); if (savedKeys) setKeys(savedKeys); };
  const back = () => navigate('/users?tab=roles');

  if (rolesQ.isLoading) return <div className="odoo-scope kl-page"><LoadingState /></div>;
  if (rolesQ.isError || !role) {
    return (
      <div className="odoo-scope kl-page">
        <ErrorState error={rolesQ.error} title="Rôle introuvable" text="Ce rôle n'existe pas ou a été supprimé." />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="odoo-btn-secondary" onClick={back}>Retour aux rôles</button>
        </div>
      </div>
    );
  }

  const roles = rolesQ.data ?? [];
  const origin = ORIGIN[role.origin ?? (role.is_system ? 'system' : 'custom')];
  const profile = profileQ.data;
  const baseLabel = roles.find(r => r.code === role.base_role)?.label ?? role.base_role;
  const memberCount = profile ? profile.members.filter(m => m.isActive).length + profile.delegations.length : role.user_count;
  const subtitle = [
    role.description,
    `${role.user_count} compte${role.user_count > 1 ? 's' : ''}`,
    !role.is_system ? `basé sur ${baseLabel}` : null,
  ].filter(Boolean).join(' · ');
  const editorFoot = !isAdmin && (
    <div className="ds-form-foot">
      <span className="ds-grow" style={{ color: 'var(--ds-muted)', fontSize: 13 }}>
        {dirty ? `${changedModules.length ? `${changedModules.length} module${changedModules.length > 1 ? 's' : ''} modifié${changedModules.length > 1 ? 's' : ''}` : 'Permissions détaillées modifiées'} · non enregistré` : 'Effet sous 30 secondes pour les comptes connectés'}
      </span>
      <button type="button" className="odoo-btn-secondary" disabled={!dirty || save.isPending} onClick={reset}>Annuler</button>
      <button type="button" className="odoo-btn-primary" disabled={!dirty || save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>
        {save.isPending ? 'Enregistrement…' : 'Enregistrer les droits'}
      </button>
    </div>
  );
  const adminBanner = <StatusBanner tone="neutral" icon={Lock} title="Administrateur">L'administrateur a tous les droits ; ils ne se règlent pas.</StatusBanner>;
  const loadingEditor = !perms || !keys;

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      <div className="odoo-control-bar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Breadcrumb icon={ShieldCheck} items={[
          { label: 'Utilisateurs', onClick: () => navigate('/users') },
          { label: 'Rôles', onClick: back },
          { label: role.label },
        ]} />
      </div>
      <div className="kl-page">
        <header className="usr-record-head">
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h1>
              {role.label}
              <span className={`kl-tag ${origin.tag}`}>{origin.label}</span>
              {!role.is_active && <StatusTag tone="cancelled" label="Désactivé" />}
            </h1>
            <p>{subtitle}</p>
          </div>
        </header>
        <Tabs label="Sections du rôle" value={tab} onChange={setTab} tabs={[
          { key: 'access', label: 'Accès par module' },
          { key: 'detail', label: 'Permissions détaillées', count: isAdmin ? undefined : (keys ?? savedKeys ?? []).length },
          { key: 'members', label: 'Membres', count: memberCount },
          { key: 'controls', label: 'Contrôles et rattachements', count: profile && (profile.sod.conflictAccounts || profile.sod.alone.length) ? 1 : undefined },
          { key: 'identity', label: 'Identité' },
        ]} />
        <div style={{ display: 'grid', gap: 'var(--ds-s4)', marginTop: 'var(--ds-s4)' }}>
          {tab === 'access' && (isAdmin ? adminBanner : permsQ.isError ? <ErrorState error={permsQ.error} onRetry={() => void permsQ.refetch()} />
            : loadingEditor ? <LoadingState /> : (
              <AccessTab perms={perms!} keys={keys!} active={active} footer={editorFoot}
                onLevel={(mod, level) => { setPerms({ ...perms!, [mod]: applyLevel(perms![mod], level) }); setKeys(alignKeys(keys!, mod, level)); }}
                onChange={(mod, p) => setPerms({ ...perms!, [mod]: p })} />
            ))}
          {tab === 'detail' && (isAdmin ? adminBanner : loadingEditor ? <LoadingState /> : (
            <DetailTab perms={perms!} keys={keys!} active={active} footer={editorFoot} onKeys={setKeys} />
          ))}
          {tab === 'members' && <MembersTab role={role} />}
          {tab === 'controls' && <ControlsTab role={role} />}
          {tab === 'identity' && <IdentityTab role={role} roles={roles} />}
        </div>
      </div>
    </div>
  );
}

/* ── Accès par module ── */
function AccessTab({ perms, keys, active, footer, onLevel, onChange }: {
  perms: Record<string, RolePermission>; keys: string[]; active: Set<string>; footer: React.ReactNode;
  onLevel: (mod: string, level: Level) => void; onChange: (mod: string, p: RolePermission) => void;
}) {
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const held = new Set(keys);
  const isActive = (m: string) => active.size === 0 || active.has(m);
  const inactiveCount = ROLE_MODULES.filter(m => !isActive(m)).length;
  const needle = q.trim().toLowerCase();
  const modules = ROLE_MODULES.filter(m => (showInactive || isActive(m) || perms[m]?.canView)
    && (!needle || (MODULE_LABELS[m as AppModule] ?? m).toLowerCase().includes(needle)));
  const chip = (on: boolean) => `prj-chip${on ? ' active' : ''}`;
  const toggleVerb = (mod: string, v: BusinessVerb) => {
    const p = perms[mod]; const cur = p.verbs ?? [];
    onChange(mod, { ...p, verbs: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
  };
  const toggleSection = (s: SettingsSection) => {
    const p = perms.settings; const cur = ((p.config?.sections as SettingsSection[]) ?? []);
    onChange('settings', { ...p, config: { ...p.config, sections: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] } });
  };

  return (
    <>
      <Toolbar>
        <SearchBar value={q} onChange={setQ} placeholder="Rechercher un module…" />
        {inactiveCount > 0 && (
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--ds-body)' }}>
            <button type="button" role="switch" aria-checked={showInactive} className={`odoo-toggle${showInactive ? ' on' : ''}`} onClick={() => setShowInactive(s => !s)} aria-label="Afficher les modules inactifs">
              <span className="odoo-toggle-knob" />
            </button>
            Afficher les modules inactifs ({inactiveCount})
          </label>
        )}
      </Toolbar>
      <DataPanel label="Accès par module" footer={footer}>
        {modules.length === 0 ? <NoResultState onReset={() => setQ('')} /> : (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Module</th><th style={{ width: 170 }}>Niveau d'accès</th><th style={{ width: 200 }}>Portée des données</th><th>Actions métier ou sections</th><th className="ds-num">Permissions</th></tr></thead>
              <tbody>
                {modules.map(m => {
                  const p = perms[m];
                  const level = levelOf(p);
                  const own = keysOfModule(m);
                  const n = own.filter(k => held.has(k)).length;
                  const verbs = verbsOf(m);
                  return (
                    <tr key={m}>
                      <td>
                        <span className={p.canView ? 'ds-strong' : undefined}>{MODULE_LABELS[m as AppModule] ?? m}</span>
                        {!isActive(m) && <span className="usr-sub">Module inactif</span>}
                      </td>
                      <td>
                        <select className="ds-input sm" value={level} aria-label={`Niveau d'accès ${MODULE_LABELS[m as AppModule] ?? m}`}
                          title={LEVELS.find(l => l.key === level)?.hint}
                          onChange={e => onLevel(m, e.target.value as Level)}>
                          {level === 'custom' && <option value="custom" disabled>Personnalisé</option>}
                          {LEVELS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="ds-input sm" disabled={!p.canView} aria-label={`Portée des données ${MODULE_LABELS[m as AppModule] ?? m}`}
                          value={(p.scope as DataScope) ?? 'store'} onChange={e => onChange(m, { ...p, scope: e.target.value })}>
                          {DATA_SCOPES.map(s => <option key={s} value={s}>{DATA_SCOPE_LABELS[s]}</option>)}
                        </select>
                      </td>
                      <td>
                        {!p.canView ? <span style={{ color: 'var(--ds-muted)' }}>—</span>
                          : m === 'settings' ? (
                            <div className="prj-chips" role="group" aria-label="Sections de Paramètres" style={{ gap: 4 }}>
                              {SECTION_KEYS.map(s => {
                                const on = ((p.config?.sections as string[]) ?? []).includes(s);
                                return <button key={s} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleSection(s)}>{on && <Check size={11} aria-hidden="true" />} {SETTINGS_SECTION_LABELS[s]}</button>;
                              })}
                              <span className="usr-sub" style={{ width: '100%' }}>{((p.config?.sections as string[]) ?? []).length ? 'Limité aux sections cochées' : 'Aucune section cochée : toutes les sections'}</span>
                            </div>
                          ) : verbs.length ? (
                            <div className="prj-chips" role="group" aria-label={`Actions métier ${MODULE_LABELS[m as AppModule] ?? m}`} style={{ gap: 4 }}>
                              {verbs.map(v => {
                                const on = (p.verbs ?? []).includes(v);
                                return <button key={v} type="button" className={chip(on)} aria-pressed={on} onClick={() => toggleVerb(m, v)}>{on && <Check size={11} aria-hidden="true" />} {BUSINESS_VERB_LABELS[v]}</button>;
                              })}
                            </div>
                          ) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}
                      </td>
                      <td className="ds-num">{own.length ? `${n} / ${own.length}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
      <Alert tone="info" icon={Info}>
        <span><strong>Les niveaux</strong> — {LEVELS.slice(1).map(l => `${l.label} : ${l.hint.replace(/^\+ /, '+ ')}`).join(' · ')}. Changer le niveau d'un module coche ses permissions détaillées ; le détail reste ajustable dans l'onglet suivant.</span>
      </Alert>
    </>
  );
}

/* ── Permissions détaillées ── */
function DetailTab({ perms, keys, active, footer, onKeys }: {
  perms: Record<string, RolePermission>; keys: string[]; active: Set<string>; footer: React.ReactNode; onKeys: (k: string[]) => void;
}) {
  const modulesWithKeys = ROLE_MODULES.filter(m => keysOfModule(m).length && (active.size === 0 || active.has(m) || perms[m]?.canView));
  // Ouvre sur le module où le rôle détient le plus de permissions.
  const [mod, setMod] = useState<string>(() => {
    const held0 = new Set(keys);
    const score = (m: string) => keysOfModule(m).filter(k => held0.has(k)).length;
    return [...modulesWithKeys].sort((a, b) => score(b) - score(a))[0] ?? '';
  });
  const [q, setQ] = useState('');
  const [gapsOnly, setGapsOnly] = useState(false);
  const held = new Set(keys);
  const level = levelOf(perms[mod]);
  const needle = q.trim().toLowerCase();
  const all = keysOfModule(mod);
  const gap = (k: string) => held.has(k) !== keyInLevel(k, level);
  const list = all.filter(k => (!needle || keyGroup(k).group.toLowerCase().includes(needle) || keyGroup(k).action.toLowerCase().includes(needle) || k.includes(needle))
    && (!gapsOnly || gap(k)));
  const groups = new Map<string, string[]>();
  for (const k of list) { const g = keyGroup(k).group; groups.set(g, [...(groups.get(g) ?? []), k]); }
  const toggle = (k: string) => onKeys(held.has(k) ? keys.filter(x => x !== k) : [...keys, k]);
  const gaps = all.filter(gap).length;
  const state = (k: string) => {
    const inL = keyInLevel(k, level), on = held.has(k);
    if (on && inL) return <span className="kl-tag g">Selon le niveau</span>;
    if (!on && inL) return <span className="kl-tag o">Retirée du niveau</span>;
    if (on) return <span className="kl-tag b">Ajoutée hors niveau</span>;
    return <span className="kl-tag x">Hors du niveau</span>;
  };

  return (
    <>
      <Toolbar>
        <SearchBar value={q} onChange={setQ} placeholder="Rechercher une permission…" />
        <select className="odoo-filter-dropdown" style={{ width: 'auto' }} value={mod} onChange={e => setMod(e.target.value)} aria-label="Module">
          {modulesWithKeys.map(m => {
            const own = keysOfModule(m); const n = own.filter(k => held.has(k)).length;
            return <option key={m} value={m}>{MODULE_LABELS[m as AppModule] ?? m} ({n}/{own.length})</option>;
          })}
        </select>
        <span className="ds-grow" />
        <div className="prj-views" role="group" aria-label="Affichage">
          <button type="button" className={!gapsOnly ? 'active' : ''} aria-pressed={!gapsOnly} onClick={() => setGapsOnly(false)}>Toutes</button>
          <button type="button" className={gapsOnly ? 'active' : ''} aria-pressed={gapsOnly} onClick={() => setGapsOnly(true)}>Écarts au niveau{gaps ? ` (${gaps})` : ''}</button>
        </div>
      </Toolbar>
      <DataPanel label="Permissions détaillées" footer={footer}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 20px', borderBottom: '1px solid var(--ds-hair)', fontSize: 13, color: 'var(--ds-muted)' }}>
          <span>Niveau d'accès du module : <strong style={{ color: 'var(--ds-ink)' }}>{levelLabel(level)}</strong></span>
          <span className="ds-grow" />
          {level !== 'custom' && level !== 'none' && gaps > 0 && (
            <button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => onKeys(alignKeys(keys, mod, level))}>Revenir au niveau ({gaps} écart{gaps > 1 ? 's' : ''})</button>
          )}
        </div>
        {list.length === 0 ? (gapsOnly ? <EmptyState icon={Check} title="Aucun écart" text="Les permissions de ce module suivent son niveau d'accès." /> : <NoResultState onReset={() => setQ('')} />) : (
          <div className="ds-scroll">
            <table className="odoo-table ds-dense">
              <thead><tr><th style={{ width: 36 }} aria-label="Accordée" /><th>Permission</th><th>Comprise dans le niveau</th><th>État</th></tr></thead>
              <tbody>
                {[...groups.entries()].map(([g, ks]) => [
                  <tr key={`g-${g}`} className="ds-group"><td colSpan={4}><b>{g}</b> <span style={{ color: 'var(--ds-muted)' }}>· {ks.filter(k => held.has(k)).length} sur {ks.length}</span></td></tr>,
                  ...ks.map(k => (
                    <tr key={k}>
                      <td><input type="checkbox" checked={held.has(k)} onChange={() => toggle(k)} aria-label={keyGroup(k).action} /></td>
                      <td>{keyGroup(k).action}<span className="usr-sub" style={{ fontFamily: 'var(--ds-mono, monospace)' }}>{k}</span></td>
                      <td>{levelLabel(keyLevel(k))}</td>
                      <td>{state(k)}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
    </>
  );
}

/* ── Membres ── */
function MembersTab({ role }: { role: RoleRow }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile, isLoading, isError, error, refetch } = useQuery({ queryKey: ['role-profile', role.code], queryFn: () => rolesApi.profile(role.code) });
  const { data: stores = [] } = useQuery<UserRow[]>({ queryKey: ['stores'], queryFn: storesApi.list });
  const [assigning, setAssigning] = useState(false);
  const storeName = (id: string | null) => (id ? (stores.find(s => s.id === id)?.name as string | undefined) : undefined) ?? 'Sans établissement';
  if (isLoading) return <LoadingState />;
  if (isError || !profile) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const initials = (n: string) => n.split(/\s+/).map(x => x[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <>
    <SectionHeader title="Comptes qui ont ce rôle" note="Rôle principal, rôle secondaire ou délégation">
      {role.is_active && role.code !== 'admin' && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setAssigning(true)}><Plus size={13} aria-hidden="true" /> Attribuer à un compte</button>}
    </SectionHeader>
    <DataPanel label="Comptes qui ont ce rôle"
      footer={<TableFooter note={`${profile.members.filter(m => m.isActive).length} compte${profile.members.filter(m => m.isActive).length > 1 ? 's' : ''} actif${profile.members.filter(m => m.isActive).length > 1 ? 's' : ''}${profile.delegations.length ? ` · ${profile.delegations.length} délégation${profile.delegations.length > 1 ? 's' : ''}` : ''}`} />}>
      {profile.members.length === 0 && profile.delegations.length === 0
        ? <EmptyState icon={Users} title="Aucun compte" text="Aucun compte n'a ce rôle pour l'instant." />
        : (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Compte</th><th>Comme</th><th>Depuis</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
              <tbody>
                {profile.members.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="usr-who">
                        <span className={`usr-av${m.isActive ? '' : ' off'}`} aria-hidden="true">{initials(m.name)}</span>
                        <div><b>{m.name}</b><small>{storeName(m.storeId)}</small></div>
                      </div>
                    </td>
                    <td>
                      {m.as === 'primary' ? 'Rôle principal' : 'Rôle secondaire'}
                      {!m.isActive && <> <StatusTag tone="cancelled" label="Désactivé" /></>}
                    </td>
                    <td>{m.since ? fmtDate(m.since) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                    <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate(`/users/${m.id}`)}>Ouvrir</button></td>
                  </tr>
                ))}
                {profile.delegations.map(d => (
                  <tr key={`d-${d.id}`}>
                    <td><div className="usr-who"><span className="usr-av" aria-hidden="true">{initials(d.toName)}</span><div><b>{d.toName}</b><small>De la part de {d.fromName}</small></div></div></td>
                    <td><span className={`kl-tag ${d.status === 'active' ? 'g' : 'o'}`}>{d.status === 'active' ? 'Délégation en cours' : 'Délégation programmée'}</span> du {fmtDate(d.startsAt)} au {fmtDate(d.endsAt)}</td>
                    <td><span style={{ color: 'var(--ds-muted)' }}>—</span></td>
                    <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate(`/users/${d.toId}`)}>Ouvrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {assigning && <AssignRoleModal role={role} memberIds={new Set(profile.members.map(m => m.id))} onClose={() => setAssigning(false)}
        onDone={() => { setAssigning(false); queryClient.invalidateQueries({ queryKey: ['role-profile', role.code] }); queryClient.invalidateQueries({ queryKey: ['roles'] }); queryClient.invalidateQueries({ queryKey: ['users'] }); }} />}
    </DataPanel>
    </>
  );
}

function AssignRoleModal({ role, memberIds, onClose, onDone }: { role: RoleRow; memberIds: Set<string>; onClose: () => void; onDone: () => void }) {
  const { data: users = [] } = useQuery<UserRow[]>({ queryKey: ['users'], queryFn: usersApi.list });
  const [userId, setUserId] = useState('');
  const choices = users.filter(u => u.isActive && !memberIds.has(u.id as string) && u.role !== 'admin' && !u.isSystem)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  const target = users.find(u => u.id === userId);
  const assign = useMutation({
    mutationFn: () => {
      const current: string[] = Array.isArray(target!.roles) && target!.roles.length ? target!.roles : [target!.role as string];
      return usersApi.update(userId, { roles: [...current, role.code], primaryRole: target!.role });
    },
    onSuccess: () => { notify.success(`Rôle « ${role.label} » attribué à ${target?.firstName} ${target?.lastName}`); onDone(); },
    onError: (err) => notify.error(errorMessage(err, 'Attribution refusée')),
  });
  return (
    <Modal title="Attribuer le rôle" subtitle={`${role.label} · ajouté aux rôles du compte, son rôle principal ne change pas`} onClose={onClose} width={520} locked={assign.isPending}
      footer={<>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!userId || assign.isPending} aria-busy={assign.isPending || undefined} onClick={() => assign.mutate()}>
          {assign.isPending ? 'Attribution…' : 'Attribuer'}
        </button>
      </>}>
      <FormField label="Compte" htmlFor="ar-user" required hint="Comptes actifs qui n'ont pas encore ce rôle. Un conflit de séparation des tâches est signalé à l'enregistrement.">
        <select id="ar-user" className="ds-input" value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">Choisir un compte…</option>
          {choices.map(u => <option key={u.id as string} value={u.id as string}>{u.firstName} {u.lastName} · {u.email}</option>)}
        </select>
      </FormField>
    </Modal>
  );
}

/* ── Contrôles et rattachements ── */
function ControlsTab({ role }: { role: RoleRow }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: profile, isLoading, isError, error, refetch } = useQuery({ queryKey: ['role-profile', role.code], queryFn: () => rolesApi.profile(role.code) });
  const { data: mfa } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });
  const setMfa = useMutation({
    mutationFn: (on: boolean) => {
      const cur = mfa?.requiredRoles ?? [];
      return usersApi.setMfaPolicy(on ? [...new Set([...cur, role.code])] : cur.filter(c => c !== role.code));
    },
    onSuccess: (_d, on) => {
      queryClient.invalidateQueries({ queryKey: ['mfa-policy'] });
      queryClient.invalidateQueries({ queryKey: ['role-profile', role.code] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      notify.success(on ? 'Double authentification exigée pour ce rôle' : 'Double authentification non exigée pour ce rôle');
    },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  if (isLoading) return <LoadingState />;
  if (isError || !profile) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const toggleMfa = async () => {
    const on = !profile.mfaRequired;
    const n = profile.members.filter(m => m.isActive).length;
    if (on && !(await confirm(`Les ${n} compte(s) qui ont ce rôle devront configurer la double authentification à leur prochaine connexion.`, { title: 'Exiger la double authentification ?', confirmLabel: 'Exiger' }))) return;
    if (!on && role.code === 'admin' && !(await confirm('Les administrateurs ne seront plus tenus d\'activer la double authentification.', { title: 'Ne plus l\'exiger ?', confirmLabel: 'Ne plus exiger', danger: true }))) return;
    setMfa.mutate(on);
  };
  const muted = (t: string) => <span style={{ color: 'var(--ds-muted)' }}>{t}</span>;
  const limits = profile.approvalLimits.map(l => `${docLabel(l.documentType)} ${l.maxAmount.toLocaleString('fr-FR')} ${currencySymbol()}`).join(' · ');
  const sodText = [
    profile.sod.alone.length ? `Enfreint à lui seul : ${profile.sod.alone.map(v => v.label).join(', ')}.` : '',
    profile.sod.incompatibleWith.length ? `Incompatible avec ${profile.sod.incompatibleWith.map(x => x.label).join(', ')}.` : '',
    profile.sod.conflictAccounts ? `${profile.sod.conflictAccounts} compte${profile.sod.conflictAccounts > 1 ? 's' : ''} en conflit.` : '',
  ].filter(Boolean).join(' ');
  const screens = profile.screens.map(s => screenDef(s.screenKey)?.label ?? s.screenKey);
  const homeItem = NAV_ITEMS.find(i => i.href === role.home_route);

  return (
    <>
      <DataPanel label="Contrôles du rôle">
        <div className="usr-row">
          <div><b>Double authentification exigée</b><p>Pour tous les comptes qui ont ce rôle.</p></div>
          <button type="button" role="switch" aria-checked={profile.mfaRequired} aria-label="Double authentification exigée" disabled={setMfa.isPending}
            className={`odoo-toggle${profile.mfaRequired ? ' on' : ''}`} onClick={() => void toggleMfa()}><span className="odoo-toggle-knob" /></button>
        </div>
        <div className="usr-row">
          <div><b>Plafonds d'approbation</b><p>{limits || 'Aucun plafond défini pour ce rôle.'}</p></div>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/users?tab=controls')}>Modifier</button>
        </div>
        <div className="usr-row">
          <div>
            <b>Séparation des tâches</b>
            <p>{sodText || 'Aucune incompatibilité avec les autres rôles actifs.'}</p>
          </div>
          <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate('/users?tab=controls')}>Voir les règles</button>
        </div>
        {(profile.sod.alone.length > 0 || profile.sod.conflictAccounts > 0) && (
          <div className="usr-pad" style={{ paddingTop: 0 }}>
            <Alert tone="danger" icon={TriangleAlert}>
              {profile.sod.alone.length ? 'Ce rôle réunit à lui seul deux capacités incompatibles : réduisez ses droits ou acceptez le risque dans Contrôles internes.' : 'Des comptes cumulent ce rôle avec un rôle incompatible.'}
            </Alert>
          </div>
        )}
      </DataPanel>
      <DataPanel label="Où ce rôle intervient" footer={<TableFooter note="Réglé dans les autres modules, réuni ici pour lecture." />}>
        <div className="ds-scroll">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Élément</th><th>Valeur</th><th className="ds-actions" aria-label="Ouvrir" /></tr></thead>
            <tbody>
              <tr>
                <td className="ds-strong">Circuits d'approbation</td>
                <td>{profile.approvalSteps.length ? profile.approvalSteps.map(s => `${s.ruleLabel} (${docLabel(s.docType)}, étape ${s.stepOrder})${s.enabled ? '' : ' · désactivé'}`).join(' · ') : muted('Aucun')}</td>
                <td className="ds-actions"><button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate('/settings?page=approvals')}>Ouvrir <ExternalLink size={12} aria-hidden="true" /></button></td>
              </tr>
              <tr>
                <td className="ds-strong">Ateliers de production</td>
                <td>{profile.workshops.length ? profile.workshops.map(w => w.label).join(', ') : muted('Aucun')}</td>
                <td className="ds-actions"><button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate('/settings?page=production')}>Ouvrir <ExternalLink size={12} aria-hidden="true" /></button></td>
              </tr>
              <tr>
                <td className="ds-strong">Écrans personnalisés</td>
                <td>{screens.length ? `${screens.join(', ')} (publié${screens.length > 1 ? 's' : ''} pour ce rôle)` : muted('Aucun')}</td>
                <td className="ds-actions" />
              </tr>
              <tr>
                <td className="ds-strong">Modules en essai</td>
                <td>{profile.pilots.length ? profile.pilots.map(p => MODULE_LABELS[p as AppModule] ?? p).join(', ') : muted('Aucun')}</td>
                <td className="ds-actions"><button type="button" className="ds-btn-ghost ds-btn-sm" onClick={() => navigate('/settings?page=sector')}>Ouvrir <ExternalLink size={12} aria-hidden="true" /></button></td>
              </tr>
              <tr>
                <td className="ds-strong">Page d'accueil</td>
                <td>{role.home_route ? (homeItem ? navLabel(homeItem) : role.home_route) : muted('Celle du secteur')}</td>
                <td className="ds-actions" />
              </tr>
            </tbody>
          </table>
        </div>
      </DataPanel>
    </>
  );
}

/* ── Identité ── */
function IdentityTab({ role, roles }: { role: RoleRow; roles: RoleRow[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: profile } = useQuery({ queryKey: ['role-profile', role.code], queryFn: () => rolesApi.profile(role.code) });
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description ?? '');
  const [baseRole, setBaseRole] = useState(role.base_role);
  const [home, setHome] = useState(role.home_route ?? '');
  const [duplicating, setDuplicating] = useState(false);
  useEffect(() => { setLabel(role.label); setDescription(role.description ?? ''); setBaseRole(role.base_role); setHome(role.home_route ?? ''); }, [role]);
  const homeChoices = NAV_ITEMS.filter(i => i.href !== '/').map(i => ({ href: i.href, label: navLabel(i) }))
    .filter((x, i, a) => a.findIndex(y => y.href === x.href) === i).sort((a, b) => a.label.localeCompare(b.label));
  const dirty = label.trim() !== role.label || (description.trim() || null) !== (role.description ?? null)
    || (!role.is_system && baseRole !== role.base_role) || (home || null) !== (role.home_route ?? null);
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ['roles'] }); queryClient.invalidateQueries({ queryKey: ['role-profile', role.code] }); };
  const save = useMutation({
    mutationFn: () => rolesApi.update(role.code, {
      label: label.trim(), description: description.trim() || null, homeRoute: home || null,
      ...(!role.is_system && baseRole !== role.base_role ? { baseRole } : {}),
    }),
    onSuccess: () => { invalidate(); notify.success('Identité du rôle enregistrée'); },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const toggleActive = useMutation({
    mutationFn: () => rolesApi.update(role.code, { isActive: !role.is_active }),
    onSuccess: () => { invalidate(); notify.success(role.is_active ? 'Rôle désactivé' : 'Rôle réactivé'); },
    onError: (err) => notify.error(errorMessage(err, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: () => rolesApi.remove(role.code),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['roles'] }); notify.success('Rôle supprimé'); navigate('/users?tab=roles'); },
    onError: (err) => notify.error(errorMessage(err, 'Suppression refusée')),
  });
  const submit = async () => {
    if (!role.is_system && baseRole !== role.base_role && !(await confirm(
      `Les comptes qui ont ce rôle seront déconnectés, et ses permissions détaillées reprendront celles de « ${roles.find(r => r.code === baseRole)?.label ?? baseRole} ».`,
      { title: 'Changer le rôle de base ?', confirmLabel: 'Changer' }))) return;
    save.mutate();
  };
  const holders = role.user_count + (role.inactive_user_count ?? 0);
  const originText = role.origin === 'template'
    ? `Créé${role.created_at ? ` le ${fmtDate(role.created_at)}` : ''} à partir du modèle « ${profile?.template?.label ?? role.label} »${profile?.template && !profile.template.sectorCode ? ' (commun à tous les secteurs)' : ''}.`
    : role.is_system ? 'Rôle livré avec Kalum : il ne se supprime pas et garde son rôle de base.'
    : `Rôle personnalisé${role.created_at ? `, créé le ${fmtDate(role.created_at)}` : ''}.`;

  return (
    <DataPanel label="Identité du rôle" footer={(
      <div className="ds-form-foot">
        <span className="ds-grow" />
        <button type="button" className="odoo-btn-secondary" disabled={!dirty || save.isPending} onClick={() => { setLabel(role.label); setDescription(role.description ?? ''); setBaseRole(role.base_role); setHome(role.home_route ?? ''); }}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!dirty || label.trim().length < 2 || save.isPending} aria-busy={save.isPending || undefined} onClick={() => void submit()}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    )}>
      <div className="usr-pad">
        <div className="ds-form-grid">
          <FormField label="Libellé" htmlFor="ri-label" required>
            <input id="ri-label" className="ds-input" value={label} onChange={e => setLabel(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="Rôle de base" htmlFor="ri-base" required hint={role.is_system ? 'Un rôle système est son propre rôle de base.' : 'Fixe ce que l\'application montre et filtre ; tous les rôles système actifs.'}>
            <select id="ri-base" className="ds-input" value={baseRole} disabled={role.is_system} onChange={e => setBaseRole(e.target.value)}>
              {role.is_system ? <option value={role.base_role}>{role.label}</option>
                : baseRoleChoices(roles, baseRole).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
          </FormField>
          <FormField label="Description" htmlFor="ri-desc">
            <input id="ri-desc" className="ds-input" value={description} onChange={e => setDescription(e.target.value)} maxLength={500} placeholder="Ce que fait ce rôle, en une phrase" />
          </FormField>
          <FormField label="Page d'accueil" htmlFor="ri-home" hint={profile?.template?.homeRoute && profile.template.homeRoute !== '/' ? `Le modèle propose ${homeChoices.find(h => h.href === profile.template!.homeRoute)?.label ?? profile.template.homeRoute}.` : 'Ouverte à la connexion, si le compte y a accès et n\'a pas choisi son espace de travail.'}>
            <select id="ri-home" className="ds-input" value={home} onChange={e => setHome(e.target.value)}>
              <option value="">Celle du secteur</option>
              {home && !homeChoices.some(h => h.href === home) && <option value={home}>{home}</option>}
              {homeChoices.map(h => <option key={h.href} value={h.href}>{h.label}</option>)}
            </select>
          </FormField>
        </div>
        <Alert tone="info" icon={Info}>{originText}</Alert>
        {role.code !== 'admin' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDuplicating(true)}>Dupliquer</button>
            {!role.is_system && <button type="button" className="odoo-btn-secondary" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate()}>{role.is_active ? 'Désactiver' : 'Réactiver'}</button>}
            {!role.is_system && (
              <button type="button" className="ds-btn-danger" disabled={holders > 0 || remove.isPending}
                title={holders > 0 ? `${holders} compte(s) ont encore ce rôle, désactivés compris` : undefined}
                onClick={async () => { if (await confirm(`Supprimer le rôle « ${role.label} » ? Ses droits et plafonds sont supprimés avec lui.`, { title: 'Supprimer le rôle', danger: true, confirmLabel: 'Supprimer' })) remove.mutate(); }}>
                <Trash2 size={13} aria-hidden="true" /> Supprimer
              </button>
            )}
          </div>
        )}
      </div>
      {duplicating && <NewRoleModal roles={roles} copyOf={role} onClose={() => setDuplicating(false)} onCreated={c => { setDuplicating(false); navigate(`/users/roles/${c}`); }} />}
    </DataPanel>
  );
}
