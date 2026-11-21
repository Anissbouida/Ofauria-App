import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Copy, X } from 'lucide-react';
import { recipesApi, type RecipeCategory } from '../../api/recipes.api';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { notify } from '../../components/ui/InlineNotification';

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
  const field = { width: '100%', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.875rem' } as const;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="odoo-scope" role="dialog" aria-label="Dupliquer la fiche" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--odoo-bg)', borderRadius: 6, border: '1px solid var(--odoo-border)', width: '100%', maxWidth: 460, margin: '0 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <div style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Copy size={14} /> Dupliquer la fiche</div>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--odoo-text-muted)' }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <p className="odoo-setting-help" style={{ margin: 0 }}>
            La copie reprend les paramètres, les étapes, les formats et la composition de « {recipe.name} ». Elle est indépendante de l'original et n'est reliée à aucun produit.
          </p>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Nom de la copie
            <input style={field} value={name} autoFocus onChange={e => setName(e.target.value)} maxLength={200} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Catégorie
            <select style={field} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">Sans catégorie</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={dup.isPending}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={dup.isPending || !name.trim()} onClick={() => dup.mutate()}>
            {dup.isPending ? 'Duplication…' : 'Dupliquer'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
