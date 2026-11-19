import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import api from '../../api/client';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Nomenclature supplémentaire d'un produit (M4-04) : une fiche qui n'est la fiche par défaut
 * d'aucun produit peut être rattachée à un produit comme alternative ou sous-traitance ;
 * elle se choisit alors sur la ligne d'un ordre au lancement.
 */
export default function AlternativeOfPanel({ recipe }: { recipe: { id: string; product_id: string | null; alternative_for_product_id?: string | null; usage?: string } }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState(recipe.alternative_for_product_id ?? '');
  const [usage, setUsage] = useState<'alternative' | 'sous_traitance'>(recipe.usage === 'sous_traitance' ? 'sous_traitance' : 'alternative');
  const { data: products = [] } = useQuery({
    queryKey: ['products-min'],
    queryFn: () => api.get('/products', { params: { limit: 1000 } }).then(r => (r.data.data?.products ?? r.data.data ?? []) as { id: string; name: string }[]),
  });
  const save = useMutation({
    mutationFn: (pid: string | null) => api.put(`/recipes/${recipe.id}/alternative`, { productId: pid, usage }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipe'] }); notify.success('Rattachement enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  // M4-04 : cette nomenclature devient la fiche par défaut (l'actuelle devient une alternative).
  const makeDefault = useMutation({
    mutationFn: () => api.post(`/recipes/${recipe.id}/make-default`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipe'] }); qc.invalidateQueries({ queryKey: ['recipes'] }); notify.success('Fiche par défaut du produit'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (recipe.product_id) return null;
  return (
    <div className="odoo-section">
      <div className="odoo-section-header flex items-center gap-2"><Layers size={13} /> Nomenclature supplémentaire d'un produit</div>
      <div style={{ padding: '0.625rem 1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SearchSelect options={products.map(p => ({ id: p.id, label: p.name }))} value={productId} onChange={setProductId} placeholder="Produit…" width={260} ariaLabel="Produit" />
        <select className="input" value={usage} onChange={e => setUsage(e.target.value as 'alternative' | 'sous_traitance')} aria-label="Usage" style={{ width: 'auto' }}>
          <option value="alternative">Alternative</option><option value="sous_traitance">Sous-traitance</option>
        </select>
        <button type="button" className="odoo-btn-secondary" disabled={!productId || save.isPending} onClick={() => save.mutate(productId)}>Rattacher</button>
        {recipe.alternative_for_product_id && <button type="button" className="odoo-btn-secondary" onClick={() => { setProductId(''); save.mutate(null); }}>Détacher</button>}
        {recipe.alternative_for_product_id && (
          <button type="button" className="odoo-btn-secondary" disabled={makeDefault.isPending}
            title="Cette fiche devient la fiche par défaut du produit ; l'actuelle devient une alternative"
            onClick={() => makeDefault.mutate()}>Définir par défaut</button>
        )}
      </div>
    </div>
  );
}
