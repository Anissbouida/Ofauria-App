import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Layers, Pencil, AlertTriangle } from 'lucide-react';
import RecipeCreateDialog from './RecipeCreateDialog';
import { allergenLabel } from '../../constants/allergens';
import { recipesApi } from '../../api/recipes.api';
import NomenclatureEditor, { type FormatKpi } from './NomenclatureEditor';
import EtapesSection from './EtapesSection';
import ExplosionSection from './ExplosionSection';
import VersionsSection from './VersionsSection';

const dh = (v: number) => `${v.toFixed(2)} DH`;

export default function NomenclaturePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [kpi, setKpi] = useState<FormatKpi | null>(null);
  const [editIdentity, setEditIdentity] = useState(false);

  const { data: recipe, isLoading } = useQuery({ queryKey: ['recipe', id], queryFn: () => recipesApi.getById(id!), enabled: !!id });

  if (isLoading) {
    return <div className="odoo-scope"><div style={{ padding: '1.5rem' }} className="text-sm text-gray-400">Chargement…</div></div>;
  }
  if (!recipe) {
    return (
      <div className="odoo-scope">
        <div style={{ padding: '1.5rem' }} className="text-sm">
          Recette introuvable. <button onClick={() => navigate('/recipes?tab=product')} className="text-amber-600 hover:underline">Retour aux recettes</button>
        </div>
      </div>
    );
  }

  const margeColor = kpi && kpi.margePct >= 50 ? '#28a745' : kpi && kpi.margePct >= 30 ? '#b85d1a' : '#dc3545';

  return (
    <div className="odoo-scope">
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/recipes?tab=product')} className="odoo-btn-secondary inline-flex items-center gap-1.5" title="Retour aux recettes">
          <ArrowLeft size={15} /> Retour aux recettes
        </button>
        <div className="odoo-breadcrumb" style={{ marginLeft: '0.75rem' }}>
          <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/recipes?tab=product')}>Fiches techniques</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{recipe.name}</span>
        </div>
      </div>

      {/* Bandeau KPI du format affiché. Les quatre tuiles doivent se recouper :
          marge = (prix − coût de production) / prix. La tuile coût affiche donc le
          coût de PRODUCTION (matière + MO + énergie + structure), avec le coût
          matière en second plan — auparavant elle montrait la matière seule, ce qui
          rendait la marge inexplicable pour qui refaisait le calcul. */}
      <div className="odoo-smart-button-row" style={{ position: 'sticky', top: 46, zIndex: 9 }}>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{kpi ? kpi.rendement : '—'}</div>
          <div className="odoo-smart-button-label"><Layers size={11} /> Rendement {kpi?.contenantNom ? `(${kpi.contenantNom})` : '(pièces/fournée)'}</div>
        </div>
        <div className="odoo-smart-button" title="Matière + main d'œuvre + énergie + frais de structure, ramenés à une pièce.">
          <div className="odoo-smart-button-value">{kpi ? dh(kpi.coutProd) : '—'}</div>
          <div className="odoo-smart-button-label">
            Coût prod. / pièce
            {kpi && <span style={{ marginLeft: 4, opacity: 0.7 }}>· matière {dh(kpi.coutMatiere)}</span>}
          </div>
        </div>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{kpi ? dh(kpi.prix) : '—'}</div>
          <div className="odoo-smart-button-label">Prix / pièce</div>
        </div>
        <div className="odoo-smart-button" title="(Prix − coût de production) / prix">
          <div className="odoo-smart-button-value" style={{ color: kpi ? margeColor : undefined }}>{kpi ? `${kpi.margePct.toFixed(1)}%` : '—'}</div>
          <div className="odoo-smart-button-label">Marge</div>
        </div>
      </div>

      <div style={{ padding: '1.25rem', maxWidth: 1320, margin: '0 auto' }}>
        <div className="flex items-center gap-2 mb-1">
          <Layers size={20} style={{ color: 'var(--theme-accent)' }} />
          <h1 className="text-xl font-semibold" style={{ color: 'var(--theme-text-strong)' }}>{recipe.name}</h1>
          {recipe.product_name && <span className="text-sm text-gray-500">· {recipe.product_name}</span>}
          <button type="button" onClick={() => setEditIdentity(true)} className="odoo-pager-btn" title="Modifier le nom ou la catégorie">
            <Pencil size={13} />
          </button>
        </div>
        {editIdentity && (
          <RecipeCreateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null,
            is_base: (recipe as { is_base?: boolean }).is_base ?? false,
            compo_par_piece: (recipe as { compo_par_piece?: boolean }).compo_par_piece ?? false,
            temperature_pate_cible_c: (recipe as { temperature_pate_cible_c?: number | null }).temperature_pate_cible_c ?? null,
            hydratation_pct: (recipe as { hydratation_pct?: number | null }).hydratation_pct ?? null }}
            onClose={() => setEditIdentity(false)} />
        )}
        <p className="text-sm text-gray-500 mb-4">
          La composition est définie <strong>par format (contenant)</strong> : chaque contenant a sa propre liste de quantités. Sélectionne ou ajoute un format ci-dessous.
        </p>

        {/* « Utilisée par » (surtout utile pour une préparation de base, consommée par
            d'autres recettes) — repris de l'ancien écran PreparationPage lors de
            l'unification du modèle (L2). */}
        {Array.isArray((recipe as { used_by?: { name?: string }[] }).used_by) && (recipe as { used_by?: { name?: string }[] }).used_by!.length > 0 && (
          <div className="text-sm mb-4" style={{ color: 'var(--theme-text)' }}>
            <span className="font-medium">Utilisée par :</span>{' '}
            {[...new Set((recipe as { used_by: { name?: string }[] }).used_by.map((u) => u.name).filter(Boolean))].join(' · ')}
          </div>
        )}

        {/* Allergènes — agrégés sur toute la nomenclature (v_recipe_allergens, mig 343),
            resynchronisés à chaque sauvegarde de composition. Mention réglementaire
            (UE 1169/2011) : affichée même vide, pour que « aucun allergène » soit une
            information et non un oubli de saisie. Réintégré depuis l'ancien écran (L3). */}
        {(() => {
          const allergens = (recipe as { allergens?: string[] | null }).allergens || [];
          return (
            <div className="odoo-section" style={{ marginBottom: '1rem' }}>
              <div className="odoo-section-header flex items-center gap-2">
                <AlertTriangle size={13} /> Allergènes
                {allergens.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 600, color: '#dc3545' }}>{allergens.length}</span>
                )}
              </div>
              <div style={{ padding: '0.625rem 1rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {allergens.length > 0 ? (
                  allergens.map((a) => <span key={a} className="odoo-tag odoo-tag-red">{allergenLabel(a)}</span>)
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                    Aucun allergène déclaré sur les ingrédients de cette nomenclature. Vérifiez que les fiches ingrédients sont renseignées.
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        <NomenclatureEditor recipeId={recipe.id} onFinance={setKpi} onCancel={() => navigate('/recipes?tab=product')} onSaved={() => qc.invalidateQueries({ queryKey: ['recipe', id] })} />

        {/* Explosion à plat (mig 400) : tous les ingrédients élémentaires cumulés sur tous les niveaux. */}
        <ExplosionSection recipeId={recipe.id} />

        {/* Mode opératoire : il n'apparaissait jusqu'ici que sur la fiche PDF. */}
        <EtapesSection etapes={recipe.etapes || []} recipeId={recipe.id} />

        {/* Historique des versions + restauration (réintégré, L3). */}
        <VersionsSection recipeId={recipe.id} />
      </div>
    </div>
  );
}
