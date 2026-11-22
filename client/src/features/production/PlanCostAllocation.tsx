import { useState } from 'react';
import { money } from '../../utils/money';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel } from '../../components/ds';

/**
 * Répartition du coût d'un ordre entre ses articles (M3-05). La clé (poids, quantité,
 * valeur de vente, parts saisies) se règle dans Production › Paramétrage › Politiques ;
 * avec la clé « parts saisies », les parts de chaque article se saisissent ici (total 100 %).
 */
type Allocation = {
  total: number; key: string; applied: string; fallback: string | null; source: string;
  items: { plan_item_id: string; product_name: string; quantity: number; basis: number; share_pct: number; cost: number; unit_cost: number | null; manual_pct: number | null }[];
};
const KEY: Record<string, string> = { poids: 'Poids produit', quantite: 'Quantité produite', valeur_de_vente: 'Valeur de vente', manuelle: 'Parts saisies' };

export default function PlanCostAllocation({ planId, canEdit }: { planId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['plan-cost-allocation', planId],
    queryFn: () => api.get(`/production-cout/plans/${planId}/allocation`).then(r => r.data.data as Allocation),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/production-cout/plans/${planId}/cost-shares`, {
      shares: (data?.items ?? []).map(i => ({ planItemId: i.plan_item_id, pct: draft[i.plan_item_id] !== undefined && draft[i.plan_item_id] !== '' ? Number(draft[i.plan_item_id].replace(',', '.')) : i.manual_pct })),
    }),
    onSuccess: () => { setDraft({}); qc.invalidateQueries({ queryKey: ['plan-cost-allocation', planId] }); notify.success('Parts enregistrées'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (isLoading || !data) return <Loader2 size={14} className="animate-spin" />;
  const manual = data.key === 'manuelle';
  const draftTotal = data.items.reduce((t, i) => t + (draft[i.plan_item_id] !== undefined && draft[i.plan_item_id] !== '' ? Number(draft[i.plan_item_id].replace(',', '.')) || 0 : i.manual_pct ?? 0), 0);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="text-xs text-gray-600">
        Clé : <strong>{KEY[data.key] ?? data.key}</strong>{data.applied !== data.key && <> → appliquée : <strong>{KEY[data.applied]}</strong></>}
        {data.fallback && <span className="text-orange-700"> · {data.fallback}</span>}
      </div>
      <DataPanel label="Répartition du coût entre les articles">
      <table className="odoo-table ds-dense">
        <thead><tr><th>Article</th><th className="ds-num">Quantité</th>
          {manual && <th className="ds-num">Part saisie (%)</th>}
          <th className="ds-num">Part (%)</th><th className="ds-num">Coût</th><th className="ds-num">Coût unitaire</th></tr></thead>
        <tbody>{data.items.map(i => (
          <tr key={i.plan_item_id}>
            <td className="ds-strong">{i.product_name}</td>
            <td className="ds-num">{i.quantity.toLocaleString('fr-FR')}</td>
            {manual && (
              <td className="ds-num">
                <input className="ds-input sm" style={{ width: 70, textAlign: 'right' }} disabled={!canEdit}
                  aria-label={`Part saisie de ${i.product_name}`}
                  value={draft[i.plan_item_id] ?? (i.manual_pct ?? '')} onChange={e => setDraft(d => ({ ...d, [i.plan_item_id]: e.target.value }))} />
              </td>
            )}
            <td className="ds-num">{i.share_pct.toLocaleString('fr-FR')}</td>
            <td className="ds-num">{money(i.cost)}</td>
            <td className="ds-num">{i.unit_cost != null ? money(i.unit_cost) : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      </DataPanel>
      {manual && canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <span className={`text-xs ${Math.abs(draftTotal - 100) > 0.01 ? 'text-red-600' : 'text-gray-500'}`}>Total saisi : {draftTotal.toLocaleString('fr-FR')} %</span>
          <button type="button" className="odoo-btn-secondary" disabled={!Object.keys(draft).length || Math.abs(draftTotal - 100) > 0.01 || save.isPending}
            onClick={() => save.mutate()}>Enregistrer les parts</button>
        </div>
      )}
    </div>
  );
}
