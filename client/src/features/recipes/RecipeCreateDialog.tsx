import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Layers, X, ArrowRight } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Création d'une fiche : on ne demande que l'identité (type, nom, catégorie),
 * puis on ouvre la page complète — la MÊME qu'en modification. Composition,
 * formats, frais et étapes s'y saisissent ; les demander ici dans un second
 * formulaire donnait deux interfaces différentes pour une même fiche.
 */
export interface RecipeIdentity { id: string; name: string; category_id?: string | null; is_base?: boolean; compo_par_piece?: boolean }

/**
 * Avec `recipe`, la même fenêtre sert à MODIFIER l'identité d'une fiche existante
 * (nom, catégorie). Le type n'est pas modifiable après création : une
 * préparation est référencée par d'autres fiches, un produit fini par le POS.
 */
export default function RecipeCreateDialog({ defaultIsBase = false, recipe, onClose }: { defaultIsBase?: boolean; recipe?: RecipeIdentity; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!recipe;
  const [isBase, setIsBase] = useState(recipe ? !!recipe.is_base : defaultIsBase);
  const [name, setName] = useState(recipe?.name ?? '');
  const [categoryId, setCategoryId] = useState(recipe?.category_id ?? '');
  // Mode de saisie des quantités de composition, décidé ici une fois pour toutes :
  // par fournée (lot découpé) ou par pièce (unité). Modifiable ensuite via cette
  // même fenêtre, mais plus pendant la composition.
  const [compoParPiece, setCompoParPiece] = useState<boolean>(recipe?.compo_par_piece ?? false);

  const { data: categories = [] } = useQuery({ queryKey: ['recipe-categories'], queryFn: recipesApi.listCategories });

  const createMut = useMutation({
    mutationFn: () => recipesApi.create({
      name: name.trim(), isBase, categoryId: categoryId || null,
      yieldQuantity: 1, yieldUnit: isBase ? 'kg' : 'unit',
      // Le mode fournée/pièce ne concerne que les produits finis (nomenclature) ;
      // une préparation de base reste en « par fournée » par défaut.
      compoParPiece: isBase ? false : compoParPiece,
      ingredients: [],
    }),
    onSuccess: (r: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      notify.success(isBase ? 'Préparation créée — complète la composition' : 'Recette créée — complète la composition');
      navigate(isBase ? `/recipes/${r.id}/preparation` : `/recipes/${r.id}/nomenclature`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de la création');
    },
  });

  const editMut = useMutation({
    mutationFn: () => recipesApi.updateIdentity(recipe!.id, {
      name: name.trim(), categoryId: categoryId || null,
      compoParPiece: isBase ? undefined : compoParPiece,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe', recipe!.id] });
      // Le mode fournée/pièce est relu par l'éditeur depuis les composants du format.
      qc.invalidateQueries({ queryKey: ['format-components', recipe!.id] });
      notify.success('Fiche mise à jour');
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || 'Erreur lors de la mise à jour');
    },
  });

  const pending = createMut.isPending || editMut.isPending;
  const canSubmit = name.trim().length > 0 && !pending;
  const field = 'h-9 w-full px-3 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400';
  const typeBtn = (active: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm ${active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <form className="odoo-scope" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) (isEdit ? editMut : createMut).mutate(); }}
        style={{ width: '100%', maxWidth: 480, minHeight: 0, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            {isBase ? <Layers size={14} style={{ color: 'var(--theme-accent)' }} /> : <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />}
            <span>Fiches techniques</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">{isEdit ? recipe!.name : isBase ? 'Nouvelle préparation' : 'Nouvelle recette'}</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>

        <div className="p-5 space-y-4 bg-white">
          {!isEdit && <div>
            <div className="text-xs text-gray-500 mb-1" id="recipe-type-label">Type</div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-labelledby="recipe-type-label">
              <button type="button" aria-pressed={!isBase} onClick={() => setIsBase(false)} className={typeBtn(!isBase)}>
                <ChefHat size={15} /> Produit fini
              </button>
              <button type="button" aria-pressed={isBase} onClick={() => setIsBase(true)} className={`${typeBtn(isBase)} border-l border-gray-200`}>
                <Layers size={15} /> Préparation de base
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {isBase ? 'Réutilisable dans d\'autres recettes (pâte, crème, glaçage…).' : 'Produit vendu, composé d\'ingrédients et de préparations de base.'}
            </p>
          </div>}

          <label className="block" htmlFor="recipe-name">
            <span className="text-xs text-gray-500">Nom</span>
            <input id="recipe-name" autoFocus className={`${field} mt-1`} value={name} onChange={(e) => setName(e.target.value)}
              maxLength={200} placeholder={isBase ? 'ex : Crème pâtissière' : 'ex : Croissant'} />
          </label>

          <label className="block" htmlFor="recipe-category">
            <span className="text-xs text-gray-500">Catégorie de production</span>
            <select id="recipe-category" className={`${field} mt-1`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Aucune (à classifier) —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>

          {!isBase && (
            <div>
              <div className="text-xs text-gray-500 mb-1" id="recipe-mode-label">Mode de saisie des quantités</div>
              <div className="flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-labelledby="recipe-mode-label">
                <button type="button" aria-pressed={!compoParPiece} onClick={() => setCompoParPiece(false)} className={typeBtn(!compoParPiece)}>
                  Par fournée (lot)
                </button>
                <button type="button" aria-pressed={compoParPiece} onClick={() => setCompoParPiece(true)} className={`${typeBtn(compoParPiece)} border-l border-gray-200`}>
                  Par pièce (unité)
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {compoParPiece
                  ? 'Les quantités décrivent UNE pièce (entremets individuel, monoportion…). Coût/pièce = somme des composants.'
                  : 'Les quantités décrivent TOUTE la fournée (cadre/plaque découpé). Coût/pièce = total ÷ rendement.'}
                {' '}Ce choix se fait maintenant et n'apparaît plus pendant la composition.
              </p>
            </div>
          )}

          {!isEdit && (
            <p className="text-xs text-gray-500">
              La composition, les formats, les frais et les étapes se saisissent ensuite sur la page de la fiche.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-white border-t border-gray-200">
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button type="submit" disabled={!canSubmit} className="odoo-btn-primary inline-flex items-center gap-1">
            {isEdit ? (pending ? 'Enregistrement…' : 'Enregistrer') : <>{pending ? 'Création…' : 'Créer et composer'} <ArrowRight size={15} /></>}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}
