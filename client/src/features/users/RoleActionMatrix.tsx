import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Save, Search, ShieldCheck, Eye } from 'lucide-react';
import { MODULE_LABELS } from '@ofauria/shared';
import { rolesApi, usersApi, type RoleRow } from '../../api/users.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Utilisateurs › Rôles › Permissions par action (M2-07).
 *
 * Matrice rôle × permission, regroupée par module : une case cochée = le rôle peut faire
 * l'action (chaque route du serveur est gardée par une de ces clés). Le rôle
 * administrateur reste complet (verrou anti-blocage). Aperçu : ce que peut faire un
 * utilisateur donné, rôles, délégations et exceptions compris.
 */
const moduleLabel = (m: string) => (MODULE_LABELS as Record<string, string>)[m] ?? m;

export default function RoleActionMatrix({ roles }: { roles: RoleRow[] }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['role-action-matrix'], queryFn: rolesApi.actionMatrix });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [previewUser, setPreviewUser] = useState('');

  const cols = roles.filter(r => r.is_active || r.code === 'admin');
  const held = (role: string) => draft[role] ?? new Set(data?.byRole[role] ?? []);
  const changed = Object.keys(draft).filter(r => {
    const a = draft[r]; const b = new Set(data?.byRole[r] ?? []);
    return a.size !== b.size || [...a].some(k => !b.has(k));
  });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const keys = (data?.keys ?? []).filter(k => !q || k.key.includes(q) || k.label.toLowerCase().includes(q) || moduleLabel(k.module).toLowerCase().includes(q));
    const by = new Map<string, typeof keys>();
    for (const k of keys) { if (!by.has(k.module)) by.set(k.module, []); by.get(k.module)!.push(k); }
    return [...by.entries()].sort((a, b) => moduleLabel(a[0]).localeCompare(moduleLabel(b[0]), 'fr'));
  }, [data, query]);

  const toggle = (role: string, keys: string[], on: boolean) => setDraft(d => {
    const s = new Set(d[role] ?? data?.byRole[role] ?? []);
    for (const k of keys) { if (on) s.add(k); else s.delete(k); }
    return { ...d, [role]: s };
  });

  const save = useMutation({
    mutationFn: async () => { for (const r of changed) await rolesApi.setActionPermissions(r, [...draft[r]]); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['role-action-matrix'] });
      setDraft({});
      notify.success(`Permissions enregistrées (${changed.length} rôle${changed.length > 1 ? 's' : ''}) — effet sous 30 secondes`);
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const { data: preview } = useQuery({
    queryKey: ['user-action-permissions', previewUser], queryFn: () => rolesApi.userActionPermissions(previewUser), enabled: !!previewUser,
  });
  const previewSet = new Set(preview?.keys ?? []);

  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={ShieldCheck} title="Permissions par action">
        Chaque action du serveur (confirmer un ordre, annuler une facture, valider un paiement…) est gardée par une
        permission. Cochez ce que chaque rôle peut faire. Au départ, chaque rôle a exactement les droits qu'il avait
        avant cet écran. Le rôle administrateur garde tout.
      </StatusBanner>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--odoo-bg)' }}>
          <Search size={13} aria-hidden />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher une permission ou un module"
            aria-label="Rechercher une permission" style={{ border: 0, outline: 'none', background: 'transparent', minWidth: 220, fontSize: '0.875rem' }} />
        </label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          <Eye size={13} aria-hidden /> Aperçu pour
        </span>
        <SearchSelect value={previewUser} onChange={setPreviewUser} placeholder="Choisir un utilisateur" width={240}
          ariaLabel="Utilisateur à prévisualiser"
          options={(users as { id: string; first_name: string; last_name: string; email: string; role: string }[])
            .map(u => ({ id: u.id, label: `${u.first_name} ${u.last_name}`, sublabel: u.email, detail: u.role }))} />
        {previewUser && preview && (
          <span style={{ fontSize: '0.8125rem' }}><strong>{preview.keys.length}</strong> permission(s) sur {data.keys.length}</span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="odoo-btn-secondary" disabled={!changed.length || save.isPending} onClick={() => setDraft({})}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Enregistrer{changed.length ? ` (${changed.length})` : ''}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--odoo-bg)', zIndex: 1 }}>Permission</th>
              {previewUser && <th style={{ textAlign: 'center' }}>Aperçu</th>}
              {cols.map(r => <th key={r.code} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(([mod, keys]) => {
              const isOpen = open[mod] ?? !!query;
              return [
                <tr key={mod} style={{ background: 'var(--odoo-bg-alt)' }}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--odoo-bg-alt)' }}>
                    <button type="button" onClick={() => setOpen(o => ({ ...o, [mod]: !isOpen }))} aria-expanded={isOpen}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 0, cursor: 'pointer', fontWeight: 600, color: 'inherit' }}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {moduleLabel(mod)}
                      <span style={{ fontWeight: 400, color: 'var(--odoo-text-muted)' }}>({keys.length})</span>
                    </button>
                  </td>
                  {previewUser && <td style={{ textAlign: 'center', fontSize: '0.8125rem' }}>{keys.filter(k => previewSet.has(k.key)).length}/{keys.length}</td>}
                  {cols.map(r => {
                    const h = held(r.code); const n = keys.filter(k => h.has(k.key)).length;
                    return (
                      <td key={r.code} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={n === keys.length} ref={el => { if (el) el.indeterminate = n > 0 && n < keys.length; }}
                          disabled={r.code === 'admin'} aria-label={`${moduleLabel(mod)} : tout pour ${r.label}`}
                          onChange={e => toggle(r.code, keys.map(k => k.key), e.target.checked)} />
                      </td>
                    );
                  })}
                </tr>,
                ...(isOpen ? keys.map(k => (
                  <tr key={k.key}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--odoo-bg)', paddingLeft: 28 }}>
                      <div>{k.label}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', fontFamily: 'monospace' }}>{k.key}</div>
                    </td>
                    {previewUser && <td style={{ textAlign: 'center' }}>{previewSet.has(k.key) ? 'Oui' : '—'}</td>}
                    {cols.map(r => (
                      <td key={r.code} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={held(r.code).has(k.key)} disabled={r.code === 'admin'}
                          aria-label={`${k.label} pour ${r.label}`} onChange={e => toggle(r.code, [k.key], e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
