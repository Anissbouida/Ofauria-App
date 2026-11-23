import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, Lock } from 'lucide-react';
import { SCREEN_CATALOG, applyScreenDefinition, type ScreenDefinition, type ScreenElementKind } from '@ofauria/shared';
import api from '../../api/client';
import { rolesApi } from '../../api/users.api';
import { customFieldsApi } from '../../api/custom-fields.api';
import { Alert, DataPanel, FormField } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { SettingsSection } from './SettingsPrimitives';

/**
 * Configurateur d'écrans (plan d'exécution multi-industries, étape 10, pas 10g ; mig 646).
 *
 * Pour un écran du catalogue et une portée (société ou rôle) : ordre et visibilité des
 * colonnes ou des sections, placement des champs personnalisés dans une section, aperçu,
 * puis publication. Seuls les éléments du catalogue sont proposés ; un élément verrouillé
 * (numéro, statut, alerte de blocage) ne se masque pas.
 */
type Row = { key: string; label: string; visible: boolean; locked?: string; group?: string };
type Scope = { scopeType: 'company' | 'role'; scopeId: string };
const KIND_LABEL: Record<ScreenElementKind, string> = { columns: 'Colonnes', sections: 'Sections', filters: 'Filtres' };
const errMsg = (e: unknown) => {
  const err = (e as { response?: { data?: { error?: { message?: string; details?: string[] } } } })?.response?.data?.error;
  return [err?.message ?? 'Opération impossible', ...(err?.details ?? [])].join(' — ');
};

export default function ScreenConfiguratorTab() {
  const qc = useQueryClient();
  const [screenKey, setScreenKey] = useState(SCREEN_CATALOG[0].key);
  const [scope, setScope] = useState<Scope>({ scopeType: 'company', scopeId: '' });
  const screen = SCREEN_CATALOG.find(s => s.key === screenKey)!;
  const kind = (Object.keys(screen.kinds)[0] ?? 'columns') as ScreenElementKind;
  const catalog = screen.kinds[kind] ?? [];
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const { data: saved = [] } = useQuery({
    queryKey: ['screen-defs', screenKey],
    queryFn: () => api.get(`/settings/screens/${screenKey}`).then(r => r.data.data as { scope_type: string; scope_id: string; status: string; version_no: number; definition: ScreenDefinition }[]),
  });
  const { data: cfDefs } = useQuery({
    queryKey: ['cf-defs', 'production_order'], queryFn: () => customFieldsApi.defs('production_order'), enabled: screenKey === 'production.plan',
  });
  const mine = saved.filter(r => r.scope_type === scope.scopeType && r.scope_id === (scope.scopeType === 'company' ? '' : scope.scopeId));
  const draft = mine.find(r => r.status === 'brouillon');
  const published = mine.find(r => r.status === 'publie');
  const base = draft?.definition ?? published?.definition ?? {};

  const initialRows = useMemo<Row[]>(() => {
    const keys = applyScreenDefinition(screenKey, kind, catalog.map(e => e.key), { [kind]: (base[kind] ?? []).map(r => ({ ...r, visible: true })) });
    const vis = new Map((base[kind] ?? []).map(r => [r.key, r.visible]));
    return keys.map(k => { const e = catalog.find(x => x.key === k)!; return { key: k, label: e.label, locked: e.locked, group: e.group, visible: e.locked ? true : vis.get(k) !== false }; });
  }, [screenKey, kind, JSON.stringify(base)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  useEffect(() => { setRows(initialRows); setPlacements(Object.fromEntries((base.custom_fields ?? []).map(c => [c.key, c.section]))); }, [initialRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const definition: ScreenDefinition = {
    [kind]: rows.map((r, i) => ({ key: r.key, visible: r.visible, order: (i + 1) * 10 })),
    ...(screenKey === 'production.plan' ? { custom_fields: Object.entries(placements).filter(([, s]) => s).map(([key, section]) => ({ key, section })) } : {}),
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ['screen-defs', screenKey] }); qc.invalidateQueries({ queryKey: ['screen-definition', screenKey] }); };
  const save = useMutation({
    mutationFn: () => api.put(`/settings/screens/${screenKey}/draft`, { ...scope, definition }),
    onSuccess: () => { refresh(); notify.success('Brouillon enregistré : visible en aperçu, pas encore pour les utilisateurs'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: async () => { await api.put(`/settings/screens/${screenKey}/draft`, { ...scope, definition }); return api.post(`/settings/screens/${screenKey}/publish`, scope); },
    onSuccess: () => { refresh(); notify.success('Écran publié'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/settings/screens/${screenKey}/reset`, scope),
    onSuccess: () => { refresh(); notify.success('Écran remis par défaut pour cette portée'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const move = (i: number, d: -1 | 1) => setRows(rs => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const busy = save.isPending || publish.isPending || reset.isPending;

  return (
    <SettingsSection title="Écrans" columns={1}
      description="Choisissez les colonnes, les sections et leur ordre, pour toute la société ou pour un rôle. Le rôle l'emporte sur la société, la société sur le profil d'industrie. Enregistrez un brouillon pour le prévisualiser, puis publiez.">
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <FormField label="Écran" htmlFor="sc-screen">
            <select id="sc-screen" className="ds-input" value={screenKey} onChange={e => setScreenKey(e.target.value)}>
              {SCREEN_CATALOG.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </FormField>
          <FormField label="Pour" htmlFor="sc-scope">
            <select id="sc-scope" className="ds-input" value={scope.scopeType === 'company' ? '' : scope.scopeId}
              onChange={e => setScope(e.target.value ? { scopeType: 'role', scopeId: e.target.value } : { scopeType: 'company', scopeId: '' })}>
              <option value="">Toute la société</option>
              {(roles as { code: string; label: string }[]).map(r => <option key={r.code} value={r.code}>Rôle : {r.label}</option>)}
            </select>
          </FormField>
          <FormField label="État">
            <div style={{ paddingTop: 6 }}>
              {published ? <StatusTag tone="done" label={`Publié v${published.version_no}`} /> : <StatusTag tone="draft" label="Par défaut" />}
              {draft && <span style={{ marginLeft: 6 }}><StatusTag tone="progress" label="Brouillon en cours" /></span>}
            </div>
          </FormField>
        </div>

        <DataPanel label={KIND_LABEL[kind]}>
          <table className="odoo-table">
            <thead><tr><th>{KIND_LABEL[kind]}</th>{kind === 'sections' && <th>Onglet</th>}<th>Affiché</th><th className="ds-actions"><span className="ds-sr-only">Ordre</span></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} style={{ opacity: r.visible ? 1 : 0.55 }}>
                  <td className="ds-strong">{r.label}{r.locked && <span title={r.locked} style={{ marginLeft: 6 }}><Lock size={11} aria-label={`Verrouillé : ${r.locked}`} /></span>}</td>
                  {kind === 'sections' && <td>{r.group ?? '—'}</td>}
                  <td><input type="checkbox" aria-label={`Afficher ${r.label}`} checked={r.visible} disabled={!!r.locked}
                    onChange={e => setRows(rs => rs.map(x => x.key === r.key ? { ...x, visible: e.target.checked } : x))} /></td>
                  <td className="ds-actions" style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Monter ${r.label}`}><ArrowUp size={12} /></button>{' '}
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Descendre ${r.label}`}><ArrowDown size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>

        {screenKey === 'production.plan' && (
          <DataPanel label="Champs personnalisés">
            <table className="odoo-table">
              <thead><tr><th>Champ personnalisé</th><th>Placé dans</th></tr></thead>
              <tbody>
                {(cfDefs?.data ?? []).length === 0 && <tr><td colSpan={2} className="odoo-setting-help">Aucun champ personnalisé défini pour l'ordre de fabrication.</td></tr>}
                {(cfDefs?.data ?? []).map(f => (
                  <tr key={f.code}>
                    <td className="ds-strong">{f.label}</td>
                    <td>
                      <select className="ds-input sm" aria-label={`Section de ${f.label}`} value={placements[f.code] ?? ''}
                        onChange={e => setPlacements(p => ({ ...p, [f.code]: e.target.value }))}>
                        <option value="">Bloc « Champs personnalisés »</option>
                        {catalog.filter(e => e.key !== 'custom-fields').map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}

        <Alert tone="info" icon={Eye}>Aperçu : {rows.filter(r => r.visible).map(r => r.label).join(' › ') || '—'}</Alert>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {(published || draft) && <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => reset.mutate()}>Revenir à l'écran par défaut</button>}
          <button type="button" className="odoo-btn-secondary" disabled={busy} onClick={() => save.mutate()}>Enregistrer le brouillon</button>
          <button type="button" className="odoo-btn-primary" disabled={busy} onClick={() => publish.mutate()}>Publier</button>
        </div>
      </div>
    </SettingsSection>
  );
}
