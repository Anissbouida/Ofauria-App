import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Nomenclature d'une ligne d'ordre (M4-04) : la fiche par défaut du produit, ou une de ses
 * nomenclatures supplémentaires (alternative, sous-traitance). Modifiable tant que
 * l'ordre est en brouillon ; les besoins sont calculés sur ce choix à la confirmation.
 */
type ProductRecipe = { id: string; name: string; usage: string; is_default: boolean; archived: boolean };
const USAGE: Record<string, string> = { fabrication: 'par défaut', alternative: 'alternative', sous_traitance: 'sous-traitance' };

export default function ItemRecipeSelect({ planId, itemId, productId, value, editable }: { planId: string; itemId: string; productId: string; value: string | null; editable: boolean }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['product-recipes', productId], queryFn: () => api.get(`/recipes/for-product/${productId}`).then(r => r.data.data as ProductRecipe[]) });
  const save = useMutation({
    mutationFn: (recipeId: string | null) => api.put(`/production/${planId}/items/${itemId}/recipe`, { recipeId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production'] }); notify.success('Nomenclature de la ligne modifiée'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const options = data.filter(r => !r.archived);
  if (options.length < 2) return null;
  const def = options.find(r => r.is_default);
  return (
    <select className="ds-input sm" value={value ?? ''} disabled={!editable || save.isPending} aria-label="Nomenclature de la ligne"
      style={{ width: 'auto', marginTop: 3 }}
      onChange={e => save.mutate(e.target.value || null)}>
      <option value="">{def ? `${def.name} (par défaut)` : 'Fiche par défaut'}</option>
      {options.filter(r => !r.is_default).map(r => <option key={r.id} value={r.id}>{r.name} ({USAGE[r.usage] ?? r.usage})</option>)}
    </select>
  );
}
