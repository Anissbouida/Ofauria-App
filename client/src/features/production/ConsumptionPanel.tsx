import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import api from '../../api/client';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import './production.css';

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
    <div className="ds-panel pd-section">
      <div className="pd-section-head">
        <Scale size={12} aria-hidden="true" /> Consommation des matières
        <span style={{ color: 'var(--ds-muted)', fontSize: 13, fontWeight: 400 }}>{manual ? 'sorties manuelles' : 'nomenclature appliquée aux quantités produites, face aux sorties réelles'}</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {data.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table ds-dense">
            <thead><tr><th>Matière</th><th className="ds-num">Théorique</th><th className="ds-num">Réel</th><th className="ds-num">Écart</th></tr></thead>
            <tbody>{data.map(r => {
              const strong = Math.abs(r.variance_pct ?? 0) > 5;
              return (
                <tr key={r.ingredient_id}>
                  <td className="ds-strong">{r.name}</td>
                  <td className="ds-num">{r.theoretical.toLocaleString('fr-FR')} <span style={{ color: 'var(--ds-muted)' }}>{r.unit}</span></td>
                  <td className="ds-num">{r.actual.toLocaleString('fr-FR')} <span style={{ color: 'var(--ds-muted)' }}>{r.unit}</span></td>
                  <td className="ds-num" style={strong ? { color: 'var(--ds-warning)', fontWeight: 600 } : undefined}>
                    {r.variance > 0 ? '+' : ''}{r.variance.toLocaleString('fr-FR')} {r.unit}{r.variance_pct != null ? ` (${r.variance_pct > 0 ? '+' : ''}${r.variance_pct} %)` : ''}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          </div>
        )}
        {manual && canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 16px 14px' }}>
            <SearchSelect options={ingredients.map(i => ({ id: i.id, label: i.name }))} value={form.ingredientId} onChange={v => setForm(f => ({ ...f, ingredientId: v }))} placeholder="Matière…" width={240} ariaLabel="Matière sortie" />
            <input className="ds-input sm" style={{ width: 90 }} inputMode="decimal" placeholder="Quantité" aria-label="Quantité sortie" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            <input className="ds-input sm" style={{ width: 200 }} placeholder="Note (optionnel)" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            <button type="button" className="odoo-btn-secondary" disabled={!form.ingredientId || !(qty > 0) || issue.isPending} onClick={() => issue.mutate()}>Enregistrer la sortie</button>
          </div>
        )}
      </div>
    </div>
  );
}
