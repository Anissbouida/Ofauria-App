import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Replace, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import '../production/production.css';

/**
 * Substituts d'article de la fiche (M4-05) : article d'origine → article de remplacement,
 * ratio (quantité de substitut pour 1 d'origine), priorité, validité ; « toutes les fiches »
 * pour un substitut général. Proposés au bon de sortie quand l'article manque.
 */
type Sub = { id: string; ingredient_name: string; substitute_name: string; substitute_unit: string; ratio: string; priority: number; valid_from: string | null; valid_to: string | null; is_global: boolean; allergens_added?: string[] };

export default function SubstitutesPanel({ recipeId }: { recipeId: string }) {
  const qc = useQueryClient();
  const key = ['recipe-substitutes', recipeId];
  const { data: subs = [] } = useQuery({ queryKey: key, queryFn: () => api.get(`/recipes/${recipeId}/substitutes`).then(r => r.data.data as Sub[]) });
  const [adding, setAdding] = useState(false);
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients-min-allergens'], queryFn: () => ingredientsApi.allergenGrid(), enabled: adding });
  const [form, setForm] = useState({ ingredientId: '', substituteIngredientId: '', ratio: '1', priority: '1', allRecipes: false, validFrom: '', validTo: '' });
  const options = ingredients.map(i => ({ id: i.id, label: i.name }));
  const create = useMutation({
    mutationFn: () => api.post(`/recipes/${recipeId}/substitutes`, {
      ingredientId: form.ingredientId, substituteIngredientId: form.substituteIngredientId,
      ratio: Number(form.ratio.replace(',', '.')), priority: Number(form.priority), allRecipes: form.allRecipes,
      validFrom: form.validFrom || null, validTo: form.validTo || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setAdding(false); setForm(f => ({ ...f, substituteIngredientId: '' })); notify.success('Substitut ajouté'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/recipes/substitutes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const ratioOk = Number(form.ratio.replace(',', '.')) > 0;

  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head"><Replace size={13} /> Substituts d'article
        <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(a => !a)}>{adding ? 'Fermer' : 'Ajouter'}</button>
      </div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 8 }}>
        {subs.length === 0 && !adding && <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Aucun substitut : en cas de rupture, le bon de sortie ne propose que d'autres lots du même article.</span>}
        {subs.length > 0 && (
          <table className="odoo-table ds-dense">
            <thead><tr><th>Article</th><th>Remplacé par</th><th className="ds-num">Ratio</th><th className="ds-num">Priorité</th><th>Validité</th><th>Portée</th><th /></tr></thead>
            <tbody>{subs.map(s => (
              <tr key={s.id}>
                <td>{s.ingredient_name}</td>
                <td>{s.substitute_name}</td>
                <td className="ds-num">{Number(s.ratio).toLocaleString('fr-FR')}</td>
                <td className="ds-num">{s.priority}</td>
                <td>{s.valid_from || s.valid_to ? `${s.valid_from?.slice(0, 10) ?? '…'} → ${s.valid_to?.slice(0, 10) ?? '…'}` : 'Permanente'}</td>
                <td>{s.is_global ? 'Toutes les fiches' : 'Cette fiche'}</td>
                <td className="ds-num"><button type="button" className="bsi-link-btn" aria-label={`Retirer ${s.substitute_name}`} onClick={() => remove.mutate(s.id)}><Trash2 size={12} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {adding && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchSelect options={options} value={form.ingredientId} onChange={v => setForm(f => ({ ...f, ingredientId: v }))} placeholder="Article d'origine…" width={220} ariaLabel="Article d'origine" />
            <SearchSelect options={options.filter(o => o.id !== form.ingredientId)} value={form.substituteIngredientId} onChange={v => setForm(f => ({ ...f, substituteIngredientId: v }))} placeholder="Substitut…" width={220} ariaLabel="Substitut" />
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Ratio <input className="ds-input sm" style={{ width: 60 }} value={form.ratio} onChange={e => setForm(f => ({ ...f, ratio: e.target.value }))} /></label>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Priorité <input className="ds-input sm" style={{ width: 44 }} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value.replace(/\D/g, '') }))} /></label>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Du <input type="date" className="ds-input sm" style={{ width: 'auto' }} value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} /></label>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>au <input type="date" className="ds-input sm" style={{ width: 'auto' }} value={form.validTo} onChange={e => setForm(f => ({ ...f, validTo: e.target.value }))} /></label>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={form.allRecipes} onChange={e => setForm(f => ({ ...f, allRecipes: e.target.checked }))} /> Toutes les fiches</label>
            <button type="button" className="odoo-btn-primary" disabled={!form.ingredientId || !form.substituteIngredientId || !ratioOk || !form.priority || create.isPending} onClick={() => create.mutate()}>Enregistrer</button>
          </div>
        )}
      </div>
    </div>
  );
}
