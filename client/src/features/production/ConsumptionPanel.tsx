import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import api from '../../api/client';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Consommation de l'ordre (M6-01) : écart entre la nomenclature appliquée aux quantités
 * produites et les sorties réelles ; en mode « manuel » du type d'ordre, saisie des sorties.
 */
type Row = { ingredient_id: string; name: string; unit: string; theoretical: number; actual: number; variance: number; variance_pct: number | null };

export default function ConsumptionPanel({ planId, mode, canEdit }: { planId: string; mode: string | null; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['plan-consumption-variance', planId];
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api.get(`/production/${planId}/consumption-variance`).then(r => r.data.data as Row[]) });
  const manual = mode === 'manuel';
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients-min-allergens'], queryFn: () => ingredientsApi.allergenGrid(), enabled: manual && canEdit });
  const [form, setForm] = useState({ ingredientId: '', quantity: '', note: '' });
  const issue = useMutation({
    mutationFn: () => api.post(`/production/${planId}/manual-consumption`, { ingredientId: form.ingredientId, quantity: Number(form.quantity.replace(',', '.')), note: form.note || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setForm({ ingredientId: '', quantity: '', note: '' }); notify.success('Sortie enregistrée'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (!data.length && !manual) return null;
  const qty = Number(form.quantity.replace(',', '.'));

  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <div className="odoo-section-header flex items-center gap-2"><Scale size={13} /> Consommation des matières {manual && <span className="text-xs text-gray-500">— sorties manuelles</span>}</div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 8 }}>
        {data.length > 0 && (
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">Matière</th><th className="text-right px-2">Théorique</th><th className="text-right px-2">Réel</th><th className="text-right px-2">Écart</th></tr></thead>
            <tbody>{data.map(r => (
              <tr key={r.ingredient_id} className="border-t border-gray-100">
                <td className="px-2 py-1">{r.name}</td>
                <td className="text-right px-2">{r.theoretical.toLocaleString('fr-FR')} {r.unit}</td>
                <td className="text-right px-2">{r.actual.toLocaleString('fr-FR')} {r.unit}</td>
                <td className={`text-right px-2 ${Math.abs(r.variance_pct ?? 0) > 5 ? 'text-orange-700 font-semibold' : ''}`}>
                  {r.variance > 0 ? '+' : ''}{r.variance.toLocaleString('fr-FR')} {r.unit}{r.variance_pct != null ? ` (${r.variance_pct > 0 ? '+' : ''}${r.variance_pct} %)` : ''}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {manual && canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SearchSelect options={ingredients.map(i => ({ id: i.id, label: i.name }))} value={form.ingredientId} onChange={v => setForm(f => ({ ...f, ingredientId: v }))} placeholder="Matière…" width={240} ariaLabel="Matière sortie" />
            <input className="input" style={{ width: 90 }} inputMode="decimal" placeholder="Quantité" aria-label="Quantité sortie" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            <input className="input" style={{ width: 200 }} placeholder="Note (optionnel)" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            <button type="button" className="odoo-btn-secondary" disabled={!form.ingredientId || !(qty > 0) || issue.isPending} onClick={() => issue.mutate()}>Enregistrer la sortie</button>
          </div>
        )}
      </div>
    </div>
  );
}
