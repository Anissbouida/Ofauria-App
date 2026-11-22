import { useMemo, useState } from 'react';
import { LoadingPanel } from '../employees/ui';
import { DataPanel, Toolbar, SearchBar, FormFooter, ErrorState } from '../../components/ds';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ShieldCheck, Eye } from 'lucide-react';
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
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['role-action-matrix'], queryFn: rolesApi.actionMatrix });
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

  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <LoadingPanel />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <StatusBanner tone="info" icon={ShieldCheck} title="Permissions par action">
        Chaque action du serveur (confirmer un ordre, annuler une facture, valider un paiement…) est gardée par une
        permission. Cochez ce que chaque rôle peut faire. Au départ, chaque rôle a exactement les droits qu'il avait
        avant cet écran. Le rôle administrateur garde tout.
      </StatusBanner>

      <Toolbar>
        <SearchBar value={query} onChange={setQuery} placeholder="Rechercher une permission ou un module" label="Rechercher une permission" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-muted)' }}>
          <Eye size={13} aria-hidden /> Aperçu pour
        </span>
        <SearchSelect value={previewUser} onChange={setPreviewUser} placeholder="Choisir un utilisateur" width={240}
          ariaLabel="Utilisateur à prévisualiser"
          options={(users as { id: string; first_name: string; last_name: string; email: string; role: string }[])
            .map(u => ({ id: u.id, label: `${u.first_name} ${u.last_name}`, sublabel: u.email, detail: u.role }))} />
        {previewUser && preview && (
          <span style={{ fontSize: 13 }}><strong>{preview.keys.length}</strong> permission(s) sur {data.keys.length}</span>
        )}
      </Toolbar>

      {/* Pied de formulaire : Annuler puis Enregistrer, à droite, sous la matrice. */}
      <DataPanel label="Permissions par action" footer={
        <FormFooter dirty={changed.length > 0} onCancel={() => setDraft({})} onSubmit={() => save.mutate()} busy={save.isPending}
          disabled={!changed.length} submitLabel={`Enregistrer${changed.length ? ` (${changed.length})` : ''}`} />
      }>
        <table className="odoo-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--ds-card)', zIndex: 1 }}>Permission</th>
              {previewUser && <th style={{ textAlign: 'center' }}>Aperçu</th>}
              {cols.map(r => <th key={r.code} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(([mod, keys]) => {
              const isOpen = open[mod] ?? !!query;
              return [
                <tr key={mod} className="ds-group">
                  <td style={{ position: 'sticky', left: 0, background: 'color-mix(in srgb, var(--ds-bg) 55%, var(--ds-card))' }}>
                    <button type="button" onClick={() => setOpen(o => ({ ...o, [mod]: !isOpen }))} aria-expanded={isOpen}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                      {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} {moduleLabel(mod)}
                      <small>{keys.length} permission{keys.length > 1 ? 's' : ''}</small>
                    </button>
                  </td>
                  {previewUser && <td style={{ textAlign: 'center', fontSize: 13 }}>{keys.filter(k => previewSet.has(k.key)).length}/{keys.length}</td>}
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
                    <td style={{ position: 'sticky', left: 0, background: 'var(--ds-card)', paddingLeft: 28 }}>
                      <div>{k.label}</div>
                      <div className="ds-ref" style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>{k.key}</div>
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
      </DataPanel>
    </div>
  );
}
