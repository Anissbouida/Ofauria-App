import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Split, Trash2 } from 'lucide-react';
import api from '../../api/client';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { money } from '../../utils/money';
import '../production/production.css';

/**
 * Sorties déclarées de la fiche (M4-06) : co-produits (coût au prorata des pièces
 * équivalentes) et sous-produits / déchets valorisés (valeur fixe déduite du coût).
 * Proposées à la déclaration de production ; la quantité réelle s'y saisit.
 */
type Out = { id: string; product_name: string; output_type: string; quantity_per_unit: string | null; equiv_pieces: string | null; fixed_unit_value: string | null };
const TYPE: Record<string, string> = { co_produit: 'Co-produit', sous_produit: 'Sous-produit', dechet_valorise: 'Déchet valorisé' };

export default function RecipeOutputsPanel({ recipeId }: { recipeId: string }) {
  const qc = useQueryClient();
  const key = ['recipe-outputs', recipeId];
  const { data: outs = [] } = useQuery({ queryKey: key, queryFn: () => api.get(`/recipes/${recipeId}/outputs`).then(r => r.data.data as Out[]) });
  const [adding, setAdding] = useState(false);
  const { data: products = [] } = useQuery({
    queryKey: ['products-min'], enabled: adding,
    queryFn: () => api.get('/products', { params: { limit: 1000 } }).then(r => (r.data.data?.products ?? r.data.data ?? []) as { id: string; name: string }[]),
  });
  const [form, setForm] = useState({ productId: '', outputType: 'co_produit', equivPieces: '', fixedUnitValue: '', quantityPerUnit: '' });
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = useMutation({
    mutationFn: () => api.post(`/recipes/${recipeId}/outputs`, {
      productId: form.productId, outputType: form.outputType, quantityPerUnit: n(form.quantityPerUnit),
      equivPieces: form.outputType === 'co_produit' ? n(form.equivPieces) : null,
      fixedUnitValue: form.outputType === 'co_produit' ? null : n(form.fixedUnitValue),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setAdding(false); setForm(f => ({ ...f, productId: '' })); notify.success('Sortie déclarée'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/recipes/outputs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const keyOk = form.outputType === 'co_produit' ? (n(form.equivPieces) ?? 0) > 0 : (n(form.fixedUnitValue) ?? -1) >= 0;

  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head"><Split size={13} /> Sorties déclarées
        <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(a => !a)}>{adding ? 'Fermer' : 'Ajouter'}</button>
      </div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 8 }}>
        {outs.length === 0 && !adding && <span className="text-xs text-gray-500">Une seule sortie : le produit de la fiche. La coupe reste possible à la déclaration.</span>}
        {outs.length > 0 && (
          <table className="odoo-table">
            <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">Produit</th><th className="text-left px-2">Type</th><th className="text-right px-2">Prévu / pièce</th><th className="text-right px-2">Clé de coût</th><th /></tr></thead>
            <tbody>{outs.map(o => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="px-2 py-1">{o.product_name}</td>
                <td className="px-2">{TYPE[o.output_type] ?? o.output_type}</td>
                <td className="text-right px-2">{o.quantity_per_unit != null ? Number(o.quantity_per_unit).toLocaleString('fr-FR') : '—'}</td>
                <td className="text-right px-2">{o.output_type === 'co_produit' ? `${Number(o.equiv_pieces).toLocaleString('fr-FR')} pièces` : `${money(Number(o.fixed_unit_value))} l'unité (déduit)`}</td>
                <td className="px-2 text-right"><button type="button" className="bsi-link-btn" aria-label={`Retirer ${o.product_name}`} onClick={() => remove.mutate(o.id)}><Trash2 size={12} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {adding && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchSelect options={products.map(p => ({ id: p.id, label: p.name }))} value={form.productId} onChange={v => setForm(f => ({ ...f, productId: v }))} placeholder="Produit…" width={240} ariaLabel="Produit de sortie" />
            <select className="input" style={{ width: 'auto' }} value={form.outputType} onChange={e => setForm(f => ({ ...f, outputType: e.target.value }))} aria-label="Type de sortie">
              {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {form.outputType === 'co_produit'
              ? <label className="text-xs">Vaut <input className="input" style={{ width: 60 }} value={form.equivPieces} onChange={e => setForm(f => ({ ...f, equivPieces: e.target.value }))} /> pièces</label>
              : <label className="text-xs">Valeur unitaire <input className="input" style={{ width: 70 }} value={form.fixedUnitValue} onChange={e => setForm(f => ({ ...f, fixedUnitValue: e.target.value }))} /></label>}
            <label className="text-xs">Prévu par pièce <input className="input" style={{ width: 60 }} value={form.quantityPerUnit} onChange={e => setForm(f => ({ ...f, quantityPerUnit: e.target.value }))} /></label>
            <button type="button" className="odoo-btn-primary" disabled={!form.productId || !keyOk || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
          </div>
        )}
      </div>
    </div>
  );
}
