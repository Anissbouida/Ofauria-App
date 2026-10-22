import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, ShieldAlert, Eye, Lock, Trash2, Loader2 } from 'lucide-react';
import * as shared from '@ofauria/shared';
import { APP_MODULES, MODULE_LABELS, type AppModule } from '@ofauria/shared';
import { rolesApi, type RoleRow, type RolePermission } from '../../api/users.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Rôles éditables et contrôle des droits côté serveur (audit Paramètres, lot 3, mig 330).
 * Un rôle créé s'appuie sur un rôle de base (périmètre technique : écrans et
 * filtres) et a ses propres droits par module. Les droits d'un utilisateur
 * (bouton Permissions) restent des exceptions qui remplacent ceux du rôle.
 */

// Clés historiques (fusion Stock) masquées ; constante absente de certaines versions de shared.
const LEGACY = (shared as unknown as { LEGACY_MODULE_KEYS?: ReadonlySet<string> }).LEGACY_MODULE_KEYS ?? new Set<string>();
const MODULES = (Object.values(APP_MODULES) as AppModule[]).filter(m => !LEGACY.has(m) && m !== 'users');
const BASE_ROLES: [string, string][] = [
  ['manager', 'Gérant'], ['cashier', 'Caissier'], ['saleswoman', 'Vendeuse'], ['baker', 'Boulanger'],
  ['pastry_chef', 'Pâtissier'], ['viennoiserie', 'Viennoiserie'], ['beldi_sale', 'Beldi & Salé'], ['magasinier', 'Magasinier'],
];
const ACTIONS = [['canView', 'Voir'], ['canCreate', 'Créer'], ['canEdit', 'Modifier'], ['canDelete', 'Supprimer']] as const;
type Flag = typeof ACTIONS[number][0];

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}

export default function RolesPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const current = roles.find(r => r.code === selected) ?? null;

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 16 }}>
      <SecurityModePanel />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Rôles</h2>
        <button className="odoo-btn-primary" onClick={() => { setCreating(true); setSelected(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau rôle
        </button>
      </div>
      {creating && <CreateRoleForm roles={roles} onDone={(code) => { setCreating(false); if (code) setSelected(code); }} />}
      {isLoading ? <Loader2 className="animate-spin" size={18} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Rôle</th><th>Rôle de base</th><th>Modules</th><th>Utilisateurs</th><th>Statut</th></tr></thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.code} onClick={() => { setSelected(r.code); setCreating(false); }}
                  style={{ cursor: 'pointer', background: r.code === selected ? 'var(--odoo-bg-hover)' : undefined }}>
                  <td>
                    <strong>{r.label}</strong>
                    {r.is_system && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Système</span>}
                  </td>
                  <td>{r.is_system ? '—' : (BASE_ROLES.find(b => b[0] === r.base_role)?.[1] ?? r.base_role)}</td>
                  <td>{r.code === 'admin' ? 'Tous' : r.module_count}</td>
                  <td>{r.user_count}</td>
                  <td><span className={`odoo-tag ${r.is_active ? 'odoo-tag-green' : 'odoo-tag-red'}`}>{r.is_active ? 'Actif' : 'Désactivé'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && <RoleEditor key={current.code} role={current} onDeleted={() => setSelected(null)} />}
    </div>
  );
}

function SecurityModePanel() {
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
          <div className="odoo-view-switcher">
            {(['log', 'enforce', 'off'] as const).map(m => (
              <button key={m} className={data.mode === m ? 'active' : ''} disabled={save.isPending} onClick={() => data.mode !== m && setMode(m)}>
                {m === 'log' ? 'Observer' : m === 'enforce' ? 'Bloquer' : 'Désactiver'}
              </button>
            ))}
          </div>
        }>
        Chaque appel est comparé aux droits du rôle, ou aux droits propres de l'utilisateur s'il en a.
        {data.mode === 'log' && ' Laissez tourner quelques jours, vérifiez la liste ci-dessous, puis passez en « Bloquer ».'}
      </StatusBanner>
      {denials.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Appel hors droits (14 jours)</th><th>Rôle</th><th>Modules requis</th><th>Utilisateurs</th><th>Appels</th><th>Dernier</th></tr></thead>
            <tbody>
              {denials.map(d => (
                <tr key={`${d.route}|${d.role_code}`}>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>{d.route}</td>
                  <td>{d.role_code}</td>
                  <td>{(d.modules ?? []).map(m => MODULE_LABELS[m as AppModule] ?? m).join(', ')}</td>
                  <td>{d.user_names}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.hits}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(d.last_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateRoleForm({ roles, onDone }: { roles: RoleRow[]; onDone: (code?: string) => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [baseRole, setBaseRole] = useState('cashier');
  const [copyFrom, setCopyFrom] = useState('');
  const create = useMutation({
    mutationFn: () => rolesApi.create({ label, baseRole, copyFrom: copyFrom || undefined }),
    onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: ['roles'] }); notify.success(`Rôle « ${r.label} » créé`); onDone(r.code); },
    onError: (err) => notify.error(errorMessage(err, 'Création refusée')),
  });
  const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' };
  const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12, background: 'var(--odoo-bg-alt)' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...lab, flex: '1 1 220px' }}>Libellé
          <input id="role-label" style={field} value={label} onChange={e => setLabel(e.target.value)} placeholder="Responsable boutique" maxLength={60} />
        </label>
        <label style={{ ...lab, width: 190 }}>Rôle de base
          <select id="role-base" style={field} value={baseRole} onChange={e => setBaseRole(e.target.value)}>
            {BASE_ROLES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
        <label style={{ ...lab, width: 210 }}>Copier les droits de
          <select id="role-copy" style={field} value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
            <option value="">Son rôle de base</option>
            {roles.filter(r => r.code !== 'admin').map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
        Le rôle de base fixe ce que l'application montre et filtre (écrans de caisse, catégories des chefs, magasin).
        Les droits par module se règlent ensuite dans le tableau du rôle.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="odoo-btn-secondary" onClick={() => onDone()}>Annuler</button>
        <button className="odoo-btn-primary" disabled={label.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>Créer le rôle</button>
      </div>
    </div>
  );
}

function RoleEditor({ role, onDeleted }: { role: RoleRow; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: saved, isLoading } = useQuery({
    queryKey: ['role-permissions', role.code], queryFn: () => rolesApi.permissions(role.code), enabled: role.code !== 'admin',
  });
  const [perms, setPerms] = useState<Record<string, RolePermission>>({});
  useEffect(() => {
    if (!saved) return;
    const m: Record<string, RolePermission> = {};
    for (const mod of MODULES) {
      const s = saved.find(p => p.module === mod || ((shared as unknown as { MODULE_ALIASES?: Record<string, string[]> }).MODULE_ALIASES?.[mod] ?? []).includes(p.module));
      m[mod] = s ? { ...s, module: mod } : { module: mod, canView: false, canCreate: false, canEdit: false, canDelete: false, config: {} };
    }
    setPerms(m);
  }, [saved]);

  const save = useMutation({
    mutationFn: () => rolesApi.setPermissions(role.code, Object.values(perms).filter(p => p.canView)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-permissions', role.code] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      notify.success(`Droits du rôle « ${role.label} » enregistrés`);
    },
    onError: (err) => notify.error(errorMessage(err, 'Enregistrement refusé')),
  });
  const toggleActive = useMutation({
    mutationFn: () => rolesApi.update(role.code, { isActive: !role.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
    onError: (err) => notify.error(errorMessage(err, 'Erreur')),
  });
  const remove = useMutation({
    mutationFn: () => rolesApi.remove(role.code),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['roles'] }); notify.success('Rôle supprimé'); onDeleted(); },
    onError: (err) => notify.error(errorMessage(err, 'Suppression refusée')),
  });

  const toggle = (mod: string, f: Flag) => {
    const p = { ...perms[mod], [f]: !perms[mod][f] };
    if (f === 'canView' && !p.canView) { p.canCreate = false; p.canEdit = false; p.canDelete = false; }
    if (f !== 'canView' && p[f]) p.canView = true;
    setPerms({ ...perms, [mod]: p });
  };
  const dirty = !!saved && MODULES.some(mod => {
    const s = saved.find(p => p.module === mod);
    const c = perms[mod];
    return c && ACTIONS.some(([f]) => (s?.[f] ?? false) !== c[f]);
  });

  if (role.code === 'admin') {
    return <StatusBanner tone="neutral" icon={Lock} title="Administrateur">L'administrateur a tous les droits ; son rôle ne se modifie pas.</StatusBanner>;
  }
  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Droits du rôle « {role.label} »</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
            S'appliquent aux {role.user_count} utilisateur(s) du rôle qui n'ont pas de droits propres. Effet sous 30 secondes.
          </div>
        </div>
        {!role.is_system && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="odoo-btn-secondary" onClick={() => toggleActive.mutate()}>{role.is_active ? 'Désactiver' : 'Réactiver'}</button>
            <button className="odoo-btn-danger" disabled={role.user_count > 0} title={role.user_count > 0 ? 'Rôle attribué à des utilisateurs' : undefined}
              onClick={async () => { if (await confirm(`Supprimer le rôle « ${role.label} » ?`, { danger: true, confirmLabel: 'Supprimer' })) remove.mutate(); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={13} /> Supprimer
            </button>
          </div>
        )}
      </div>
      {isLoading || !Object.keys(perms).length ? <Loader2 className="animate-spin" size={18} /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>Module</th>{ACTIONS.map(([, l]) => <th key={l} style={{ textAlign: 'center', width: 90 }}>{l}</th>)}</tr></thead>
            <tbody>
              {MODULES.map(mod => (
                <tr key={mod} style={{ opacity: perms[mod]?.canView ? 1 : 0.65 }}>
                  <td>{MODULE_LABELS[mod] ?? mod}</td>
                  {ACTIONS.map(([f, l]) => (
                    <td key={f} style={{ textAlign: 'center' }}>
                      <input type="checkbox" id={`rp-${role.code}-${mod}-${f}`} aria-label={`${l} ${MODULE_LABELS[mod] ?? mod}`}
                        checked={!!perms[mod]?.[f]} onChange={() => toggle(mod, f)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="odoo-btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer les droits'}
        </button>
      </div>
    </div>
  );
}
