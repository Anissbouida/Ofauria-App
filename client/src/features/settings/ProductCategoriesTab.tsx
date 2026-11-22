import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageNote } from './SettingsPrimitives';
import { categoriesApi } from '../../api/categories.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { DataPanel, FormFooter, LoadingState } from '../../components/ds';

/**
 * Catégories de vente (mig 375) : famille d'appartenance et ordre d'affichage. En caisse,
 * la première rangée montre les familles, la seconde les catégories de la famille choisie.
 */
type Cat = { id: number; name: string; family: string | null; display_order: number };
type Row = { family: string; order: string };

export default function ProductCategoriesTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery<Cat[]>({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const [rows, setRows] = useState<Record<number, Row>>({});
  const initial = useMemo(() => Object.fromEntries(data.map(c => [c.id, { family: c.family ?? '', order: String(c.display_order ?? 0) }])) as Record<number, Row>, [data]);
  useEffect(() => { setRows(initial); }, [initial]);
  const families = useMemo(() => Array.from(new Set(Object.values(rows).map(r => r.family.trim()).filter(Boolean))).sort(), [rows]);
  const dirtyIds = data.filter(c => rows[c.id] && (rows[c.id].family !== initial[c.id].family || rows[c.id].order !== initial[c.id].order)).map(c => c.id);
  const save = useMutation({
    mutationFn: async () => {
      for (const id of dirtyIds) await categoriesApi.update(id, { family: rows[id].family.trim() || null, displayOrder: Number(rows[id].order) || 0 });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); notify.success(`${dirtyIds.length} catégorie(s) enregistrée(s)`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const set = (id: number, patch: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...r[id], ...patch } }));
  const sorted = [...data].sort((a, b) => (rows[a.id]?.family || '~').localeCompare(rows[b.id]?.family || '~') || Number(rows[a.id]?.order ?? 0) - Number(rows[b.id]?.order ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12 }}>
      <PageNote help="Tapez un nom de famille existant ou nouveau ; une catégorie sans famille apparaît sous « Autres ». L'ordre règle la place dans la rangée.">
        La caisse affiche les familles, puis les catégories de la famille choisie.
      </PageNote>
      {isLoading ? <LoadingState bare /> : (
        <DataPanel label="Catégories de vente" footer={
          <FormFooter dirty={dirtyIds.length > 0} onCancel={() => setRows(initial)} busy={save.isPending} disabled={!dirtyIds.length}
            onSubmit={() => save.mutate()} submitLabel={`Enregistrer${dirtyIds.length ? ` (${dirtyIds.length})` : ''}`} />
        }>
          <table className="odoo-table" style={{ tableLayout: 'fixed' }}>
            <colgroup><col /><col style={{ width: 260 }} /><col style={{ width: 110 }} /></colgroup>
            <thead><tr><th>Catégorie</th><th>Famille</th><th className="ds-num">Ordre</th></tr></thead>
            <tbody>{sorted.map(c => {
              const r = rows[c.id] ?? { family: '', order: '0' };
              const dirty = dirtyIds.includes(c.id);
              return (
                <tr key={c.id} className={dirty ? 'ds-selected' : undefined}>
                  <td className="ds-strong">{c.name}</td>
                  <td>
                    <input className="ds-input sm" aria-label={`Famille : ${c.name}`} list="category-families" value={r.family} placeholder="Sans famille (Autres)" maxLength={60}
                      onChange={e => set(c.id, { family: e.target.value })} />
                  </td>
                  <td className="ds-num"><input className="ds-input sm" style={{ textAlign: 'right' }} aria-label={`Ordre : ${c.name}`} type="number" min={0} value={r.order} onChange={e => set(c.id, { order: e.target.value })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <datalist id="category-families">{families.map(f => <option key={f} value={f} />)}</datalist>
        </DataPanel>
      )}
    </div>
  );
}
