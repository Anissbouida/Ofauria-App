import { money } from '../../utils/money';
import { usePermissions } from '../../context/PermissionsContext';
import { useProdTerms } from '../../hooks/useProdTerms';
import HistoryPanel from '../../components/audit/HistoryPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Layers, Pencil, AlertTriangle, Lock } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import RecipeCreateDialog from './RecipeCreateDialog';
import { allergenLabel } from '../../constants/allergens';
import { recipesApi } from '../../api/recipes.api';
import NomenclatureEditor, { type FormatKpi } from './NomenclatureEditor';
import EtapesSection from './EtapesSection';
import ExplosionSection from './ExplosionSection';
import VersionsSection from './VersionsSection';
import BomVersionBanner from './BomVersionBanner';
import AlternativeOfPanel from './AlternativeOfPanel';
import SubstitutesPanel from './SubstitutesPanel';
import RecipeOutputsPanel from './RecipeOutputsPanel';
import RecipeRoutingPanel from './RecipeRoutingPanel';
import '../production/production.css';
import '../projects/projects.css';
import '../sales/sales.css';

const dh = (v: number) => money(v);

export default function NomenclaturePage() {
  const T = useProdTerms();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sectorLabel } = usePermissions();
  const [kpi, setKpi] = useState<FormatKpi | null>(null);
  const [editIdentity, setEditIdentity] = useState(false);

  const { data: recipe, isLoading, error } = useQuery({
    queryKey: ['recipe', id], queryFn: () => recipesApi.getById(id!), enabled: !!id,
    retry: (n, e) => (e as { response?: { status?: number } })?.response?.status !== 403 && n < 1,
  });
  // Lecture des fiches réservée (`recipes.view`, scénario 1, constat 105).
  const forbidden = (error as { response?: { status?: number } } | null)?.response?.status === 403;
  const { data: etapesStatus } = useQuery({ queryKey: ['recipe-etapes-status', id], queryFn: () => recipesApi.etapesStatus(id!), enabled: !!id });

  if (isLoading) {
    return <div className="odoo-scope pd"><div className="pd-page"><section className="prj-panel sal-empty"><span>Chargement…</span></section></div></div>;
  }
  if (!recipe) {
    return (
      <div className="odoo-scope pd">
        <div className="pd-page">
          <section className="prj-panel sal-empty">
            <ChefHat size={28} style={{ opacity: 0.4 }} />
            <strong>{forbidden ? "Vous n'avez pas accès aux fiches techniques." : `${T.recipe} introuvable.`}</strong>
            <button onClick={() => navigate('/recipes?tab=product')} className="odoo-btn-secondary">Retour aux {T.recipesLc}</button>
          </section>
        </div>
      </div>
    );
  }

  // Fiche d'un autre atelier (constat 106) : consultation seule, le serveur refuse toute écriture.
  const r = recipe as { can_edit?: boolean; workshop_label?: string | null };
  const readOnly = r.can_edit === false;
  const readOnlyReason = readOnly ? `Fiche de l'atelier ${r.workshop_label ?? '?'} : vous n'en êtes pas membre, elle est en lecture seule.` : null;

  const margeColor = kpi && kpi.margePct >= 50 ? 'var(--prj-green)' : kpi && kpi.margePct >= 30 ? 'var(--prj-orange)' : 'var(--prj-red)';

  return (
    <div className="odoo-scope pd">
      {/* Barre : retour + fil d'Ariane (design Ventes). */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/recipes?tab=product')} className="odoo-pager-btn" title={`Retour aux ${T.recipesLc}`} aria-label={`Retour aux ${T.recipesLc}`}>
          <ArrowLeft size={14} />
        </button>
        <div className="odoo-breadcrumb">
          <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/recipes?tab=product')}>{sectorLabel('recipes', 'Fiches techniques')}</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{recipe.name}</span>
        </div>
      </div>

      <div className="pd-page">
        {/* En-tête de fiche : nom, produit lié, modification de l'identité. */}
        <section className="prj-panel prj-hero">
          <div className="prj-hero-top">
            <span className="prj-hero-icon"><Layers size={22} /></span>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1>{recipe.name}</h1>
                {!readOnly && <button type="button" onClick={() => setEditIdentity(true)} className="odoo-pager-btn" title="Modifier le nom ou la catégorie">
                  <Pencil size={13} />
                </button>}
              </div>
              <div className="prj-hero-meta">
                {recipe.product_name && <span>{recipe.product_name}</span>}
                {Array.isArray((recipe as { used_by?: { name?: string }[] }).used_by) && (recipe as { used_by?: { name?: string }[] }).used_by!.length > 0 && (
                  <span><span style={{ fontWeight: 500 }}>Utilisée par :</span>{' '}
                    {[...new Set((recipe as { used_by: { name?: string }[] }).used_by.map((u) => u.name).filter(Boolean))].join(' · ')}</span>
                )}
              </div>
            </div>
          </div>
          <p className="prj-note" style={{ margin: 0 }}>
            La composition est définie <strong>par format (contenant)</strong> : chaque contenant a sa propre liste de quantités. Sélectionne ou ajoute un format ci-dessous.
          </p>
        </section>
        {(recipe as { compo_vide?: boolean }).compo_vide && (
          <StatusBanner tone="danger" icon={AlertTriangle} title="Fiche incomplète : aucun composant">
            Cette fiche n'a encore aucun ingrédient ni préparation de base : son coût est inconnu et elle ne peut pas servir en production. Complète la composition ci-dessous.
          </StatusBanner>
        )}
        {(() => {
          // Coût de revient incomplet (constat 108, mig 621) : détail des trous.
          const gaps = ((recipe as { cost_gaps?: { composant: string; motif: string; via: string | null }[] }).cost_gaps) ?? [];
          if (!gaps.length) return null;
          const motif: Record<string, string> = { sans_prix: 'sans prix', conversion: 'conversion d\'unité douteuse', preparation_vide: 'préparation sans composant' };
          return (
            <StatusBanner tone="warning" icon={AlertTriangle} title="Coût de revient incomplet">
              Le coût affiché est plus bas ou faux tant que ces lignes ne sont pas réglées :{' '}
              {gaps.map((g) => `${g.composant} (${motif[g.motif] ?? g.motif}${g.via ? `, via ${g.via}` : ''})`).join(' ; ')}.
              {' '}Renseigne le prix de l'ingrédient (achat ou fiche ingrédient), sa densité, ou complète la préparation.
            </StatusBanner>
          );
        })()}
        {readOnlyReason && (
          <StatusBanner tone="neutral" icon={Lock} title="Lecture seule">{readOnlyReason} Seuls ses membres, le gérant et l'administrateur la modifient.</StatusBanner>
        )}
        {editIdentity && (
          <RecipeCreateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null,
            is_base: (recipe as { is_base?: boolean }).is_base ?? false,
            is_phantom: (recipe as { is_phantom?: boolean }).is_phantom ?? false,
            compo_par_piece: (recipe as { compo_par_piece?: boolean }).compo_par_piece ?? false,
            temperature_pate_cible_c: (recipe as { temperature_pate_cible_c?: number | null }).temperature_pate_cible_c ?? null,
            hydratation_pct: (recipe as { hydratation_pct?: number | null }).hydratation_pct ?? null }}
            onClose={() => setEditIdentity(false)} />
        )}

        {/* Indicateurs du format affiché. Les quatre tuiles doivent se recouper :
            marge = (prix − coût de production) / prix. La tuile coût affiche donc le
            coût de PRODUCTION (matière + MO + énergie + structure), avec le coût
            matière en second plan — auparavant elle montrait la matière seule, ce qui
            rendait la marge inexplicable pour qui refaisait le calcul.
            Restent visibles en haut pendant l'édition de la composition. */}
        <div className="prj-kpis pd-sticky-kpis">
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Layers size={13} /> Rendement {kpi?.contenantNom ? `(${kpi.contenantNom})` : `(pièces/${T.batch.toLowerCase()})`}</span></div>
            <div className="prj-kpi-value">
              {kpi ? (kpi.unite === 'kg' ? `${kpi.rendement.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg` : kpi.rendement) : '—'}
            </div>
          </div>
          <div className="prj-kpi" title={`Matière + main d'œuvre + énergie + frais de structure, ramenés ${kpi?.unite === 'kg' ? 'au kilo' : 'à une pièce'}.`}>
            <div className="prj-kpi-head"><span>Coût prod. / {kpi?.unite ?? 'pièce'}</span></div>
            <div className="prj-kpi-value">{kpi ? dh(kpi.coutProd) : '—'}</div>
            {kpi && <div className="prj-kpi-sub">matière {dh(kpi.coutMatiere)}</div>}
          </div>
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>Prix / {kpi?.unite ?? 'pièce'}</span></div>
            <div className="prj-kpi-value">{kpi ? dh(kpi.prix) : '—'}</div>
          </div>
          <div className="prj-kpi" title="(Prix − coût de production) / prix">
            <div className="prj-kpi-head"><span>Marge</span></div>
            <div className="prj-kpi-value" style={{ color: kpi ? margeColor : undefined }}>{kpi ? `${kpi.margePct.toFixed(1)}%` : '—'}</div>
          </div>
        </div>

        {/* Allergènes — agrégés sur toute la nomenclature (v_recipe_allergens, mig 343),
            resynchronisés à chaque sauvegarde de composition. Mention réglementaire
            (UE 1169/2011) : affichée même vide, pour que « aucun allergène » soit une
            information et non un oubli de saisie. Réintégré depuis l'ancien écran (L3). */}
        {(() => {
          const allergens = (recipe as { allergens?: string[] | null }).allergens || [];
          return (
            <section className="prj-panel">
              <div className="prj-panel-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={15} /> Allergènes
                {allergens.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--prj-red)' }}>{allergens.length}</span>
                )}
              </div>
              <div style={{ padding: '12px 18px', display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {allergens.length > 0 ? (
                  allergens.map((a) => <span key={a} className="odoo-tag odoo-tag-red">{allergenLabel(a)}</span>)
                ) : (
                  <span style={{ fontSize: 13, color: 'var(--theme-text-muted)' }}>
                    Aucun allergène déclaré sur les ingrédients de cette nomenclature. Vérifiez que les fiches ingrédients sont renseignées.
                  </span>
                )}
              </div>
            </section>
          );
        })()}

        <BomVersionBanner recipeId={recipe.id} />
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}>
          <AlternativeOfPanel recipe={recipe} />
          <SubstitutesPanel recipeId={recipe.id} />
          <RecipeOutputsPanel recipeId={recipe.id} />
        </fieldset>
        <RecipeRoutingPanel recipeId={recipe.id} recipeName={recipe.name} />
        <CustomFieldsCard entity="recipe" id={recipe.id} />
        <HistoryPanel table="recipes" id={recipe.id} />

        <NomenclatureEditor recipeId={recipe.id} readOnly={readOnly} onFinance={setKpi} onCancel={() => navigate('/recipes?tab=product')} onSaved={() => qc.invalidateQueries({ queryKey: ['recipe', id] })} />

        {/* Explosion à plat (mig 400) : tous les ingrédients élémentaires cumulés sur tous les niveaux. */}
        <ExplosionSection recipeId={recipe.id} />

        {/* Mode opératoire : il n'apparaissait jusqu'ici que sur la fiche PDF. */}
        <EtapesSection etapes={recipe.etapes || []} recipeId={recipe.id} editBlockedReason={readOnlyReason ?? (etapesStatus?.frozen ? etapesStatus.reason : null)} />

        {/* Historique des versions + restauration (réintégré, L3). */}
        <VersionsSection recipeId={recipe.id} />
      </div>
    </div>
  );
}
