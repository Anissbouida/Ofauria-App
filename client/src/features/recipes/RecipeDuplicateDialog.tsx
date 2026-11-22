import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { recipesApi, type RecipeCategory } from '../../api/recipes.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';

import { FormField, FormFooter, Modal } from '../../components/ds';
/**
 * Dupliquer une fiche entière (scénario 1, constat 109) : nom et catégorie de la copie.
 * La copie reprend paramètres, étapes, formats et composition, sans le produit lié.
 */
export default function RecipeDuplicateDialog({ recipe, onClose }: {
  recipe: { id: string; name: string; category_id?: string | null };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(`${recipe.name} (copie)`);
  const [categoryId, setCategoryId] = useState<string>(recipe.category_id ?? '');
  const { data: categories = [] } = useQuery<RecipeCategory[]>({ queryKey: ['recipe-categories'], queryFn: recipesApi.listCategories });
  const dup = useMutation({
    mutationFn: () => recipesApi.duplicate(recipe.id, { name: name.trim(), categoryId: categoryId || null }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      notify.success(`Fiche dupliquée : « ${name.trim()} ». Relie-la à son produit et ajuste la composition.`);
      onClose();
      navigate(`/recipes/${id}/nomenclature`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Duplication impossible')),
  });

  return (
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Copy size={18} aria-hidden="true" /> Dupliquer la fiche</span>}
      onClose={onClose} width={460} locked={dup.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => dup.mutate()} busy={dup.isPending} disabled={!name.trim()}
        submitLabel={dup.isPending ? 'Duplication…' : 'Dupliquer'} />}>
          <p className="ds-field-hint" style={{ margin: 0, fontSize: 13 }}>
            La copie reprend les paramètres, les étapes, les formats et la composition de « {recipe.name} ». Elle est indépendante de l'original et n'est reliée à aucun produit.
          </p>
          <FormField label="Nom de la copie" htmlFor="dup-name" required>
            <input id="dup-name" className="ds-input" value={name} autoFocus onChange={e => setName(e.target.value)} maxLength={200} />
          </FormField>
          <FormField label="Catégorie" htmlFor="dup-category">
            <select id="dup-category" className="ds-input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Sans catégorie</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </FormField>
    </Modal>
  );
}
