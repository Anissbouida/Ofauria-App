import { usePermissions } from '../../context/PermissionsContext';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Layers } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';

import { FormField, FormFooter, Modal } from '../../components/ds';
/**
 * Création d'une fiche : on ne demande que l'identité (type, nom, catégorie),
 * puis on ouvre la page complète — la MÊME qu'en modification. Composition,
 * formats, frais et étapes s'y saisissent ; les demander ici dans un second
 * formulaire donnait deux interfaces différentes pour une même fiche.
 */
export interface RecipeIdentity { id: string; name: string; category_id?: string | null; is_base?: boolean; is_phantom?: boolean; compo_par_piece?: boolean; temperature_pate_cible_c?: number | null; hydratation_pct?: number | null; conservation_heures?: number | null }

/**
 * Avec `recipe`, la même fenêtre sert à MODIFIER l'identité d'une fiche existante
 * (nom, catégorie). Le type n'est pas modifiable après création : une
 * préparation est référencée par d'autres fiches, un produit fini par le POS.
 */
export default function RecipeCreateDialog({ defaultIsBase = false, recipe, onClose }: { defaultIsBase?: boolean; recipe?: RecipeIdentity; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sectorLabel, hasFeature } = usePermissions();
  // M8-03 / M8-06 : termes du secteur ; saisie par fournée seulement avec l'option boulangerie.
  const batchMode = hasFeature('mode_fournee');
  const tFinished = sectorLabel('finished_product', 'Produit fini');
  const tBase = sectorLabel('base_prep', 'Préparation de base');
  const tBatch = sectorLabel('batch', 'Fournée');
  const isEdit = !!recipe;
  const [isBase, setIsBase] = useState(recipe ? !!recipe.is_base : defaultIsBase);
  const [name, setName] = useState(recipe?.name ?? '');
  // M9 (mig 588) : sous-ensemble fantôme — jamais stocké, composants tirés dans l'ordre parent.
  const [isPhantom, setIsPhantom] = useState<boolean>(!!recipe?.is_phantom);
  // Mig 673 : conservation d'une préparation après fabrication (date limite de ses lots).
  const [conservation, setConservation] = useState<string>(recipe?.conservation_heures != null ? String(recipe.conservation_heures) : '');
  const [categoryId, setCategoryId] = useState(recipe?.category_id ?? '');
  // Mode de saisie des quantités de composition, décidé ici une fois pour toutes :
  // par fournée (lot découpé) ou par pièce (unité). Modifiable ensuite via cette
  // même fenêtre, mais plus pendant la composition.
  const [compoParPiece, setCompoParPiece] = useState<boolean>(recipe?.compo_par_piece ?? !hasFeature('mode_fournee'));
  // Parametres de pate (mig 342) : temperature de pate cible en fin de petrissage,
  // hydratation en % boulanger. Edites ici pour les preparations de base (pates).
  const [tempPate, setTempPate] = useState<string>(recipe?.temperature_pate_cible_c != null ? String(recipe.temperature_pate_cible_c) : '');
  const [hydr, setHydr] = useState<string>(recipe?.hydratation_pct != null ? String(recipe.hydratation_pct) : '');
  const numOrNull = (s: string) => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? n : null; };

  const { data: categories = [] } = useQuery({ queryKey: ['recipe-categories'], queryFn: recipesApi.listCategories });

  const createMut = useMutation({
    mutationFn: () => recipesApi.create({
      name: name.trim(), isBase, categoryId: categoryId || null,
      yieldQuantity: 1, yieldUnit: isBase ? 'kg' : 'unit',
      // Le mode fournée/pièce ne concerne que les produits finis (nomenclature) ;
      // une préparation de base reste en « par fournée » par défaut.
      compoParPiece: isBase ? false : compoParPiece,
      temperaturePateCibleC: isBase ? numOrNull(tempPate) : undefined,
      hydratationPct: isBase ? numOrNull(hydr) : undefined,
      isPhantom: isBase ? isPhantom : undefined,
      ingredients: [],
    }),
    onSuccess: (r: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      notify.success(isBase ? 'Préparation créée — complète la composition' : 'Recette créée — complète la composition');
      // Bases et produits finis s'éditent dans le même éditeur (L2) : l'ancienne route
      // /recipes/:id/preparation n'existe plus et affichait une page blanche.
      navigate(`/recipes/${r.id}/nomenclature`);
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de la création')),
  });

  const editMut = useMutation({
    mutationFn: () => recipesApi.updateIdentity(recipe!.id, {
      name: name.trim(), categoryId: categoryId || null,
      compoParPiece: isBase ? undefined : compoParPiece,
      temperaturePateCibleC: isBase ? numOrNull(tempPate) : undefined,
      hydratationPct: isBase ? numOrNull(hydr) : undefined,
      isPhantom: isBase ? isPhantom : undefined,
      conservationHeures: isBase ? (numOrNull(conservation) != null ? Math.round(numOrNull(conservation)!) : null) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe', recipe!.id] });
      // Le mode fournée/pièce est relu par l'éditeur depuis les composants du format.
      qc.invalidateQueries({ queryKey: ['format-components', recipe!.id] });
      notify.success('Fiche mise à jour');
      onClose();
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur lors de la mise à jour')),
  });

  const pending = createMut.isPending || editMut.isPending;
  const canSubmit = name.trim().length > 0 && !pending;
  const submit = () => { if (canSubmit) (isEdit ? editMut : createMut).mutate(); };
  const typeBtn = (active: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm ${active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`;

  return (
    <Modal onClose={onClose} width={480} locked={pending}
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{isBase ? <Layers size={18} aria-hidden="true" /> : <ChefHat size={18} aria-hidden="true" />}{isEdit ? recipe!.name : batchMode ? (isBase ? 'Nouvelle préparation' : 'Nouvelle recette') : (isBase ? `Nouveau : ${tBase.toLowerCase()}` : `Nouvelle ${sectorLabel('recipe', 'recette').toLowerCase()}`)}</span>}
      subtitle={sectorLabel('recipes', 'Fiches techniques')}
      footer={<FormFooter onCancel={onClose} onSubmit={submit} busy={pending} disabled={!canSubmit}
        submitLabel={isEdit ? (pending ? 'Enregistrement…' : 'Enregistrer') : (pending ? 'Création…' : 'Créer et composer →')} />}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={isEdit ? 'Modifier la fiche' : 'Nouvelle fiche'}>
        {/* Bouton invisible : Entrée dans un champ valide le formulaire. */}
        <button type="submit" className="ds-sr-only" tabIndex={-1} aria-hidden="true" />
        <div className="space-y-4">
          {!isEdit && <div>
            <div className="ds-field-label" style={{ marginBottom: 6 }} id="recipe-type-label">Type</div>
            <div className="flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-labelledby="recipe-type-label">
              <button type="button" aria-pressed={!isBase} onClick={() => setIsBase(false)} className={typeBtn(!isBase)}>
                <ChefHat size={15} /> {tFinished}
              </button>
              <button type="button" aria-pressed={isBase} onClick={() => setIsBase(true)} className={`${typeBtn(isBase)} border-l border-gray-200`}>
                <Layers size={15} /> {tBase}
              </button>
            </div>
            <p className="ds-field-hint" style={{ marginTop: 4 }}>
              {batchMode
                ? (isBase ? 'Réutilisable dans d\'autres recettes (pâte, crème, glaçage…).' : 'Produit vendu, composé d\'ingrédients et de préparations de base.')
                : (isBase ? `${tBase} réutilisable dans d'autres nomenclatures.` : `${tFinished} composé de composants et de ${tBase.toLowerCase()}s.`)}
            </p>
          </div>}

          <FormField label="Nom" htmlFor="recipe-name" required>
            <input id="recipe-name" autoFocus className="ds-input" value={name} onChange={(e) => setName(e.target.value)} required
              maxLength={200} placeholder={batchMode ? (isBase ? 'Ex. : crème pâtissière' : 'Ex. : croissant') : (isBase ? 'Ex. : sous-ensemble châssis' : 'Ex. : article fini')} />
          </FormField>

          {isBase && (
            <label className="flex items-start gap-2 text-sm" htmlFor="recipe-phantom">
              <input id="recipe-phantom" type="checkbox" className="mt-0.5" checked={isPhantom} onChange={(e) => setIsPhantom(e.target.checked)} />
              <span>
                <span className="font-medium">Fantôme (jamais stocké)</span>
                <span className="block ds-field-hint">
                  Pas d'ordre ni de stock propre : ses composants sont tirés directement dans l'ordre qui l'utilise.
                </span>
              </span>
            </label>
          )}

          {isBase && !isPhantom && recipe && (
            <FormField label="Conservation après fabrication" htmlFor="recipe-conservation"
              hint="En heures : chaque lot fabriqué reçoit sa date limite (24 = un jour). Un lot périmé n'est plus réservé pour la production.">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input id="recipe-conservation" className="ds-input" type="number" min="1" max="8760" step="1" inputMode="numeric"
                  value={conservation} onChange={(e) => setConservation(e.target.value)} placeholder="Ex. : 48" style={{ maxWidth: 120 }} />
                <span className="ds-field-hint">heures</span>
              </span>
            </FormField>
          )}

          <FormField label="Catégorie de production" hint="Sans catégorie, la fiche reste à classer.">
            <SearchSelect value={categoryId} onChange={setCategoryId}
              placeholder="Aucune" width="100%" size="md" ariaLabel="Catégorie de production"
              options={categories.map((c) => ({ id: String(c.id), label: c.label as string }))} />
          </FormField>

          {!isBase && batchMode && (
            <div>
              <div className="ds-field-label" style={{ marginBottom: 6 }} id="recipe-mode-label">Mode de saisie des quantités</div>
              <div className="flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-labelledby="recipe-mode-label">
                <button type="button" aria-pressed={!compoParPiece} onClick={() => setCompoParPiece(false)} className={typeBtn(!compoParPiece)}>
                  Par {tBatch.toLowerCase()} (lot)
                </button>
                <button type="button" aria-pressed={compoParPiece} onClick={() => setCompoParPiece(true)} className={`${typeBtn(compoParPiece)} border-l border-gray-200`}>
                  Par pièce (unité)
                </button>
              </div>
              <p className="ds-field-hint" style={{ marginTop: 4 }}>
                {compoParPiece
                  ? 'Les quantités décrivent UNE pièce (entremets individuel, monoportion…). Coût/pièce = somme des composants.'
                  : `Les quantités sont saisies par ${tBatch.toLowerCase()}, en entier (cadre/plaque découpé). Coût/pièce = total ÷ rendement.`}
                {' '}Ce choix se fait maintenant et n'apparaît plus pendant la composition.
              </p>
            </div>
          )}

          {/* M8-06 : paramètres de pâte (température, hydratation) — boulangerie seulement. */}
          {isBase && batchMode && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Température de pâte cible (°C)" htmlFor="recipe-temp">
                <input id="recipe-temp" type="number" step="any" className="ds-input" value={tempPate}
                  onChange={(e) => setTempPate(e.target.value)} placeholder="Ex. : 24" />
              </FormField>
              <FormField label="Hydratation (% boulanger)" htmlFor="recipe-hydr">
                <input id="recipe-hydr" type="number" step="any" className="ds-input" value={hydr}
                  onChange={(e) => setHydr(e.target.value)} placeholder="Ex. : 65" />
              </FormField>
            </div>
          )}

          {!isEdit && (
            <p className="ds-field-hint">
              La composition, les formats, les frais et les étapes se saisissent ensuite sur la page de la fiche.
            </p>
          )}
        </div>

      </form>
    </Modal>
  );
}
