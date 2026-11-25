import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, ShieldAlert, Eye, Check, Copy, FolderOpen } from 'lucide-react';
import { MODULE_LABELS, APPROVAL_DOC_TYPES, type AppModule } from '@ofauria/shared';
import { HrHeaderActions } from '../employees/ui';
import {
  DataPanel, TableFooter, ErrorState, LoadingState, Toolbar, SearchBar, Modal, FormField, NoResultState, Alert,
} from '../../components/ds';
import { FilterChips } from '../sales/ListTemplate';
import { RowMenu } from '../../components/ui/RowMenu';
import { rolesApi, usersApi, type RoleRow, type RolePermission, type RoleProfile } from '../../api/users.api';
import { settingsApi } from '../../api/settings.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { currencySymbol } from '../../utils/money';
import { ORIGIN, ROLE_MODULES, accessSummary, permOf } from './roleAccess';
import './users.css';

/**
 * Rôles (refonte Utilisateurs, lot 4) : liste avec l'origine de chaque rôle (système, modèle du
 * secteur, personnalisé), recherche, comparaison de deux à quatre rôles et création. Les droits
 * se règlent dans la fiche du rôle (page /users/roles/:code).
 */

type OriginFilter = '' | 'system' | 'custom' | 'template' | 'inactive';
const originOf = (r: RoleRow) => r.origin ?? (r.is_system ? 'system' : 'custom');

export function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

/** Rôles de base proposés : rôles système actifs du secteur (et celui déjà choisi), administrateur exclu. */
export function baseRoleChoices(roles: RoleRow[], current: string): [string, string][] {
  return roles
    .filter(r => r.is_system && r.code !== 'admin' && (r.code === current || (r.is_active !== false && r.available !== false)))
    .map(r => [r.code, r.label] as [string, string]);
}

export default function RolesPanel() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<OriginFilter>('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'list' | 'compare'>('list');
  const [creating, setCreating] = useState<{ copyOf?: RoleRow } | null>(null);
  const { data: roles = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: mfa } = useQuery({ queryKey: ['mfa-policy'], queryFn: usersApi.mfaPolicy, retry: false });
  const open = (code: string) => navigate(`/users/roles/${code}`);

  const count = (f: OriginFilter) => roles.filter(r => (f === 'inactive' ? !r.is_active : r.is_active && (!f || originOf(r) === f))).length;
  const needle = q.trim().toLowerCase();
  const rows = roles.filter(r => (filter === 'inactive' ? !r.is_active : (r.is_active || filter === '') && (!filter || originOf(r) === filter))
    && (!needle || r.label.toLowerCase().includes(needle) || (r.description ?? '').toLowerCase().includes(needle) || r.code.includes(needle)));
  const empty = roles.filter(r => r.is_active && r.user_count === 0).length;
  const baseLabel = (c: string) => roles.find(r => r.code === c)?.label ?? c;

  return (
    <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
      <HrHeaderActions>
        <button type="button" className="odoo-btn-primary" onClick={() => setCreating({})} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} aria-hidden="true" /> Nouveau rôle
        </button>
      </HrHeaderActions>
      <FilterChips label="Origine" value={filter} onChange={k => setFilter(k as OriginFilter)} chips={[
        { key: '', label: 'Tous', count: roles.filter(r => r.is_active).length },
        { key: 'system', label: 'Système', count: count('system') },
        { key: 'custom', label: 'Personnalisés', count: count('custom') },
        { key: 'template', label: 'Modèles du secteur', count: count('template') },
        { key: 'inactive', label: 'Désactivés', count: count('inactive') },
      ]} />
      <Toolbar>
        <SearchBar value={q} onChange={setQ} placeholder="Rechercher un rôle…" />
        <span className="ds-grow" />
        <div className="prj-views" role="group" aria-label="Affichage">
          <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>Liste</button>
          <button type="button" className={view === 'compare' ? 'active' : ''} aria-pressed={view === 'compare'} onClick={() => setView('compare')}>Comparer</button>
        </div>
      </Toolbar>
      {isLoading ? <LoadingState /> : isError ? <DataPanel label="Rôles"><ErrorState bare error={error} onRetry={() => void refetch()} /></DataPanel>
        : view === 'compare' ? <CompareRoles roles={roles.filter(r => r.is_active)} />
        : (
          <DataPanel label="Rôles" footer={<TableFooter note={`${rows.length} rôle${rows.length > 1 ? 's' : ''}${empty ? ` · ${empty} sans titulaire` : ''}`} />}>
            {rows.length === 0 ? <NoResultState onReset={() => { setQ(''); setFilter(''); }} /> : (
              <div className="ds-scroll">
                <table className="odoo-table">
                  <thead><tr><th>Rôle</th><th>Origine</th><th>Rôle de base</th><th className="ds-num">Comptes</th><th className="ds-num">Modules</th><th>2FA</th><th>Statut</th><th className="ds-actions" aria-label="Actions" /></tr></thead>
                  <tbody>
                    {rows.map(r => {
                      const o = ORIGIN[originOf(r)];
                      return (
                        <tr key={r.code} onClick={() => open(r.code)} style={{ cursor: 'pointer' }}>
                          <td>
                            <span className="ds-strong">{r.label}</span>
                            {r.description && <span className="usr-sub">{r.description}</span>}
                          </td>
                          <td><span className={`kl-tag ${o.tag}`}>{o.label}</span></td>
                          <td>{r.is_system ? <span style={{ color: 'var(--ds-muted)' }}>—</span> : baseLabel(r.base_role)}</td>
                          <td className="ds-num">{r.user_count}{r.inactive_user_count ? <span className="usr-sub" title="Comptes désactivés qui gardent ce rôle">+{r.inactive_user_count} désactivé{r.inactive_user_count > 1 ? 's' : ''}</span> : null}</td>
                          <td className="ds-num">{r.code === 'admin' ? 'Tous' : r.module_count}</td>
                          <td>{mfa?.requiredRoles?.includes(r.code) ? <span className="kl-tag g">Exigée</span> : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>
                          <td><StatusTag tone={r.is_active ? 'done' : 'cancelled'} label={r.is_active ? 'Actif' : 'Désactivé'} /></td>
                          <td className="ds-actions" onClick={e => e.stopPropagation()}>
                            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => open(r.code)} aria-label={`Ouvrir le rôle ${r.label}`}>Ouvrir</button>
                            <RowMenu label={`Autres actions pour ${r.label}`} items={[
                              { label: 'Ouvrir la fiche', icon: FolderOpen, onSelect: () => open(r.code) },
                              ...(r.code !== 'admin' ? [{ label: 'Dupliquer', icon: Copy, onSelect: () => setCreating({ copyOf: r }) }] : []),
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DataPanel>
        )}
      {creating && <NewRoleModal roles={roles} copyOf={creating.copyOf} onClose={() => setCreating(null)} onCreated={code => { setCreating(null); open(code); }} />}
    </div>
  );
}

/* ── Comparaison de deux à quatre rôles ── */
function CompareRoles({ roles }: { roles: RoleRow[] }) {
  const initial = roles.filter(r => r.code !== 'admin').sort((a, b) => b.user_count - a.user_count).slice(0, 3).map(r => r.code);
  const [picked, setPicked] = useState<string[]>(initial);
  const { data: sector } = useQuery({ queryKey: ['sector'], queryFn: settingsApi.sector });
  const active = new Set(sector?.current?.modules ?? []);
  const toggle = (c: string) => setPicked(p => (p.includes(c) ? p.filter(x => x !== c) : p.length >= 4 ? p : [...p, c]));
  const perms = useQueries({ queries: picked.map(c => ({ queryKey: ['role-permissions', c], queryFn: () => rolesApi.permissions(c), enabled: c !== 'admin' })) });
  const profiles = useQueries({ queries: picked.map(c => ({ queryKey: ['role-profile', c], queryFn: () => rolesApi.profile(c) })) });
  const label = (c: string) => roles.find(r => r.code === c)?.label ?? c;
  const cell = (i: number, mod: string) => (picked[i] === 'admin' ? 'Complet' : accessSummary(permOf(perms[i]?.data as RolePermission[] | undefined, mod)));
  const modules = ROLE_MODULES.filter(m => (active.size === 0 || active.has(m)) && picked.some((_, i) => cell(i, m)));
  const prof = (i: number) => profiles[i]?.data as RoleProfile | undefined;
  const docTypes = [...new Set(picked.flatMap((_, i) => prof(i)?.approvalLimits.map(l => l.documentType) ?? []))];
  const docLabel = (d: string) => (APPROVAL_DOC_TYPES as Record<string, { label: string }>)[d]?.label ?? d;
  const muted = <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const loading = perms.some(q => q.isLoading) || profiles.some(q => q.isLoading);

  return (
    <DataPanel label="Comparer des rôles" footer={<TableFooter note="Les écarts entre rôles se lisent ligne par ligne." />}>
      <div className="usr-pad" style={{ paddingBottom: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Choisissez de deux à quatre rôles.</div>
        <div className="prj-chips" role="group" aria-label="Rôles comparés">
          {roles.map(r => {
            const on = picked.includes(r.code);
            return (
              <button key={r.code} type="button" aria-pressed={on} disabled={!on && picked.length >= 4}
                className={`prj-chip${on ? ' active' : ''}`} onClick={() => toggle(r.code)}>
                {on && <Check size={13} aria-hidden="true" />} {r.label}
              </button>
            );
          })}
        </div>
      </div>
      {picked.length < 2 ? <div className="usr-pad"><Alert tone="info">Choisissez au moins deux rôles.</Alert></div>
        : loading ? <LoadingState /> : (
          <div className="ds-scroll">
            <table className="odoo-table">
              <thead><tr><th>Module</th>{picked.map(c => <th key={c}>{label(c)}</th>)}</tr></thead>
              <tbody>
                {modules.map(m => (
                  <tr key={m}>
                    <td className="ds-strong">{MODULE_LABELS[m as AppModule] ?? m}</td>
                    {picked.map((c, i) => <td key={c}>{cell(i, m) ?? muted}</td>)}
                  </tr>
                ))}
                <tr className="ds-group"><td colSpan={picked.length + 1}><b>Contrôles</b></td></tr>
                <tr>
                  <td className="ds-strong">Double authentification</td>
                  {picked.map((c, i) => <td key={c}>{prof(i)?.mfaRequired ? <span className="kl-tag g">Exigée</span> : <span style={{ color: 'var(--ds-muted)' }}>Non exigée</span>}</td>)}
                </tr>
                {docTypes.map(d => (
                  <tr key={d}>
                    <td className="ds-strong">Plafond {docLabel(d).toLowerCase()}</td>
                    {picked.map((c, i) => {
                      const l = prof(i)?.approvalLimits.find(x => x.documentType === d);
                      return <td key={c} className="ds-num" style={{ textAlign: 'left' }}>{l ? `${l.maxAmount.toLocaleString('fr-FR')} ${currencySymbol()}` : muted}</td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="ds-strong">Incompatible avec</td>
                  {picked.map((c, i) => {
                    const inc = prof(i)?.sod.incompatibleWith ?? [];
                    return <td key={c}>{inc.length ? inc.map(x => x.label).join(', ') : muted}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
    </DataPanel>
  );
}

/* ── Nouveau rôle : depuis un modèle du secteur, en copiant un rôle, ou vide ── */
type Start = 'template' | 'copy' | 'empty';
export function NewRoleModal({ roles, copyOf, onClose, onCreated }: { roles: RoleRow[]; copyOf?: RoleRow; onClose: () => void; onCreated: (code: string) => void }) {
  const queryClient = useQueryClient();
  const { data: templates = [], isLoading: tplLoading } = useQuery({ queryKey: ['role-templates'], queryFn: rolesApi.templates, retry: false });
  const [start, setStart] = useState<Start>('copy');
  const [label, setLabel] = useState(copyOf ? `${copyOf.label} (copie)` : '');
  const [template, setTemplate] = useState('');
  const [copyFrom, setCopyFrom] = useState(copyOf && copyOf.code !== 'admin' ? copyOf.code : '');
  const [baseRole, setBaseRole] = useState(copyOf && copyOf.base_role !== 'admin' ? copyOf.base_role : 'cashier');
  const tpl = templates.find(t => t.code === template);
  // Premier affichage sans copie demandée : le modèle du secteur est proposé s'il y en a.
  useEffect(() => { if (!copyOf && templates.length && !template) { setStart('template'); setTemplate(templates[0].code); setLabel(l => l || templates[0].label); } }, [templates.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const copySource = roles.find(r => r.code === copyFrom);
  const create = useMutation({
    mutationFn: () => rolesApi.create(start === 'template'
      ? { label: label.trim(), template }
      : start === 'empty' ? { label: label.trim(), baseRole, empty: true }
      : { label: label.trim(), baseRole, copyFrom: copyFrom || undefined }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['role-templates'] });
      notify.success(`Rôle « ${r.label} » créé`);
      onCreated(r.code);
    },
    onError: (err) => notify.error(errorMessage(err, 'Création refusée')),
  });
  const invalid = label.trim().length < 2 ? 'Libellé requis (2 caractères au moins)'
    : start === 'template' && !template ? 'Choisissez un modèle' : null;
  const card = (k: Start, title: string, text: string, disabled = false) => (
    <button type="button" className={`usr-card${start === k ? ' on' : ''}`} aria-pressed={start === k} disabled={disabled}
      style={disabled ? { opacity: .55, cursor: 'not-allowed' } : undefined}
      onClick={() => {
        setStart(k);
        if (k === 'template' && tpl && !label.trim()) setLabel(tpl.label);
        // Le libellé repris du modèle ne suit pas vers une copie ou un rôle vide.
        if (k !== 'template' && tpl && label === tpl.label) setLabel('');
      }}>
      <b>{title}{start === k && <Check size={15} aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--ds-accent)' }} />}</b>
      <small>{text}</small>
    </button>
  );

  return (
    <Modal title="Nouveau rôle" subtitle="Les droits se règlent ensuite dans la fiche du rôle." onClose={onClose} width={680} locked={create.isPending}
      footer={(
        <div className="ds-form-foot">
          <span className="ds-grow" style={{ color: 'var(--ds-muted)', fontSize: 13 }}>{invalid ?? ''}</span>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!!invalid || create.isPending} aria-busy={create.isPending || undefined} onClick={() => create.mutate()}>
            {create.isPending ? 'Création…' : 'Créer le rôle'}
          </button>
        </div>
      )}>
      <div style={{ display: 'grid', gap: 'var(--ds-s4)' }}>
        <FormField label="Libellé" htmlFor="nr-label" required>
          <input id="nr-label" className="ds-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Responsable boutique" maxLength={60} autoFocus />
        </FormField>
        <fieldset className="ds-fieldset">
          <legend>Partir de</legend>
          <div className="usr-cards">
            {card('template', 'Un modèle du secteur', tplLoading ? 'Chargement…' : templates.length ? templates.slice(0, 3).map(t => t.label).join(', ') + (templates.length > 3 ? '…' : '') : 'Tous les modèles du secteur existent déjà.', !templates.length)}
            {card('copy', 'Copier un rôle', 'Reprend tous ses droits, sauf Administrateur.')}
            {card('empty', 'Rôle vide', 'Aucun droit au départ.')}
          </div>
        </fieldset>
        <div className="ds-form-grid">
          {start === 'template' && (
            <FormField label="Modèle" htmlFor="nr-tpl" hint={tpl ? `${tpl.description ?? ''}${tpl.homeRoute && tpl.homeRoute !== '/' ? ` · page d'accueil ${tpl.homeRoute}` : ''}` : undefined}>
              <select id="nr-tpl" className="ds-input" value={template} onChange={e => { setTemplate(e.target.value); const t = templates.find(x => x.code === e.target.value); if (t) setLabel(t.label); }}>
                {templates.map(t => <option key={t.code} value={t.code}>{t.label}{t.sectorCode ? '' : ' (commun à tous les secteurs)'}</option>)}
              </select>
            </FormField>
          )}
          {start === 'copy' && (
            <FormField label="Rôle à copier" htmlFor="nr-copy">
              <select id="nr-copy" className="ds-input" value={copyFrom} onChange={e => {
                setCopyFrom(e.target.value);
                const src = roles.find(r => r.code === e.target.value);
                if (src && src.base_role !== 'admin') setBaseRole(src.base_role);
              }}>
                <option value="">Son rôle de base</option>
                {roles.filter(r => r.code !== 'admin' && r.is_active).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </FormField>
          )}
          {start !== 'template' && (
            <FormField label="Rôle de base" htmlFor="nr-base" required hint="Fixe ce que l'application montre et filtre (écrans de caisse, magasin…).">
              <select id="nr-base" className="ds-input" value={baseRole} onChange={e => setBaseRole(e.target.value)}>
                {baseRoleChoices(roles, baseRole).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </FormField>
          )}
        </div>
        {start === 'copy' && copySource && copySource.base_role !== baseRole && (
          <Alert tone="info">Les droits sont copiés de « {copySource.label} » ; le rôle de base choisi fixe seulement les écrans et filtres.</Alert>
        )}
      </div>
    </Modal>
  );
}

export function SecurityModePanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ['security'], queryFn: rolesApi.security });
  const save = useMutation({
    mutationFn: (mode: 'off' | 'log' | 'enforce') => rolesApi.setSecurityMode(mode),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['security'] }); notify.success('Mode de contrôle enregistré'); },
    onError: (err) => notify.error(errorMessage(err, 'Erreur')),
  });
  if (!data) return null;
  const denials = data.denials ?? [];
  const setMode = async (mode: 'off' | 'log' | 'enforce') => {
    if (mode === 'enforce' && !(await confirm(
      denials.length
        ? `${denials.length} appel(s) hors droits ont été observés ces 14 derniers jours : ils seront refusés. Ajustez d'abord les droits des rôles concernés si ces accès sont légitimes.`
        : 'Les appels hors droits seront refusés (erreur 403).',
      { title: 'Bloquer les accès hors droits ?', confirmLabel: 'Bloquer', danger: denials.length > 0 },
    ))) return;
    save.mutate(mode);
  };
  const tone = data.mode === 'enforce' ? 'success' : data.mode === 'log' ? 'info' : 'warning';
  const title = data.mode === 'enforce' ? 'Droits appliqués : les accès hors droits sont refusés'
    : data.mode === 'log' ? 'Observation : les accès hors droits sont journalisés, pas bloqués'
    : 'Contrôle des droits désactivé';
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <StatusBanner tone={tone} icon={data.mode === 'enforce' ? ShieldCheck : data.mode === 'log' ? Eye : ShieldAlert} title={title}
        actions={
          <div className="prj-views" role="group" aria-label="Mode de contrôle">
            {(['log', 'enforce', 'off'] as const).map(m => (
              <button key={m} type="button" aria-pressed={data.mode === m} className={data.mode === m ? 'active' : ''} disabled={save.isPending} onClick={() => data.mode !== m && setMode(m)}>
                {m === 'log' ? 'Observer' : m === 'enforce' ? 'Bloquer' : 'Désactiver'}
              </button>
            ))}
          </div>
        }>
        Chaque appel est comparé aux droits du rôle, ou aux droits propres de l'utilisateur s'il en a.
        {data.mode === 'log' && ' Laissez tourner quelques jours, vérifiez la liste ci-dessous, puis passez en « Bloquer ».'}
      </StatusBanner>
      {denials.length > 0 && (
        <DataPanel>
          <table className="odoo-table">
            <thead><tr><th>Appel hors droits (14 jours)</th><th>Rôle</th><th>Modules requis</th><th>Utilisateurs</th><th className="ds-num">Appels</th><th>Dernier appel</th></tr></thead>
            <tbody>
              {denials.map(d => (
                <tr key={`${d.route}|${d.role_code}`}>
                  <td className="ds-ref">{d.route}</td>
                  <td>{d.role_code}</td>
                  <td>{(d.modules ?? []).map(m => MODULE_LABELS[m as AppModule] ?? m).join(', ')}</td>
                  <td>{d.user_names}</td>
                  <td className="ds-num">{d.hits}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.last_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </div>
  );
}

