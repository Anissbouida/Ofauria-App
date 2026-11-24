import { useActionPermissions } from '../../hooks/useActionPermissions';
import { usePermissions } from '../../context/PermissionsContext';
import { useProdTerms } from '../../hooks/useProdTerms';
import HistoryPanel from '../../components/audit/HistoryPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Pencil, AlertTriangle, Lock, Copy, Calculator, ArrowRight } from 'lucide-react';
import { Breadcrumb, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, PageHeader, SectionHeader } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import RecipeDuplicateDialog from './RecipeDuplicateDialog';
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


export default function NomenclaturePage() {
  const T = useProdTerms();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sectorLabel } = usePermissions();
  const [kpi, setKpi] = useState<FormatKpi | null>(null);
  // Le coût n'est plus sur la fiche (2026-11-24) : un lien vers le coût standard de l'article,
  // montré seulement au gérant (comptabilité analytique) : le labo ne voit ni coût ni marge.
  const { can } = useActionPermissions();
  const canSeeCost = can('production.production_cout.analytique');
  const [editIdentity, setEditIdentity] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const { data: recipe, isLoading, error, refetch } = useQuery({
    queryKey: ['recipe', id], queryFn: () => recipesApi.getById(id!), enabled: !!id,
    retry: (n, e) => (e as { response?: { status?: number } })?.response?.status !== 403 && n < 1,
  });
  // Lecture des fiches réservée (`recipes.view`, scénario 1, constat 105).
  const forbidden = (error as { response?: { status?: number } } | null)?.response?.status === 403;
  const { data: etapesStatus } = useQuery({ queryKey: ['recipe-etapes-status', id], queryFn: () => recipesApi.etapesStatus(id!), enabled: !!id });

  const listLabel = sectorLabel('recipes', 'Fiches techniques');
  const bar = (current?: string) => (
    <div className="odoo-control-bar">
      <button type="button" onClick={() => navigate('/recipes?tab=product')} className="ds-icon-btn" title={`Retour aux ${T.recipesLc}`} aria-label={`Retour aux ${T.recipesLc}`}>
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <Breadcrumb icon={ChefHat} items={[
        { label: sectorLabel('production', 'Production') },
        { label: listLabel, onClick: () => navigate('/recipes?tab=product') },
        ...(current ? [{ label: current }] : []),
      ]} />
    </div>
  );

  if (isLoading) {
    return <div className="odoo-scope pd">{bar()}<div className="pd-page"><LoadingState label="Chargement de la fiche…" /></div></div>;
  }
  if (!recipe) {
    const back = <button type="button" onClick={() => navigate('/recipes?tab=product')} className="odoo-btn-secondary">Retour aux {T.recipesLc}</button>;
    return (
      <div className="odoo-scope pd">
        {bar()}
        <div className="pd-page">
          {forbidden
            ? <EmptyState icon={Lock} title="Vous n'avez pas accès aux fiches techniques" text="La consultation des fiches est réservée à la production, au magasin et à la direction." action={back} />
            : error
              ? <ErrorState error={error} title="La fiche n'a pas pu être chargée" onRetry={() => refetch()} />
              : <EmptyState icon={ChefHat} title={`${T.recipe} introuvable`} text="Elle a peut-être été archivée ou supprimée." action={back} />}
        </div>
      </div>
    );
  }

  // Fiche d'un autre atelier (constat 106) : consultation seule, le serveur refuse toute écriture.
  const r = recipe as { can_edit?: boolean; workshop_label?: string | null };
  const readOnly = r.can_edit === false;
  const readOnlyReason = readOnly ? `Fiche de l'atelier ${r.workshop_label ?? '?'} : vous n'en êtes pas membre, elle est en lecture seule.` : null;

  const allergensList = (recipe as { allergens?: string[] | null }).allergens || [];
  const poidsTxt = (g: number | null) => g == null ? '—'
    : g >= 1000 ? `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`
    : `${g.toLocaleString('fr-FR', { maximumFractionDigits: g < 10 ? 1 : 0 })} g`;
  const usedBy = Array.isArray((recipe as { used_by?: { name?: string }[] }).used_by)
    ? [...new Set((recipe as { used_by: { name?: string }[] }).used_by.map((u) => u.name).filter(Boolean))] : [];

  return (
    <div className="odoo-scope pd">
      {/* Barre : retour + fil d'Ariane jusqu'au nom de la fiche, actions à droite. */}
      <div className="odoo-control-bar">
        <button type="button" onClick={() => navigate('/recipes?tab=product')} className="ds-icon-btn" title={`Retour aux ${T.recipesLc}`} aria-label={`Retour aux ${T.recipesLc}`}>
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <Breadcrumb icon={ChefHat} items={[
          { label: sectorLabel('production', 'Production') },
          { label: listLabel, onClick: () => navigate('/recipes?tab=product') },
          { label: recipe.name },
        ]} />
        <div style={{ flex: 1 }} />
        {/* Copie de la fiche entière (constat 109) : permise même en lecture seule. */}
        <button type="button" onClick={() => setDuplicating(true)} className="odoo-btn-secondary" title="Dupliquer la fiche entière (nouvelle fiche indépendante)">
          <Copy size={13} aria-hidden="true" /> Dupliquer
        </button>
        {!readOnly && (
          <button type="button" onClick={() => setEditIdentity(true)} className="odoo-btn-secondary" title="Modifier le nom ou la catégorie">
            <Pencil size={13} aria-hidden="true" /> Modifier le nom
          </button>
        )}
      </div>

      <div className="pd-page">
        {/* En-tête de fiche : nom, statut de lecture, produit lié. */}
        <PageHeader title={recipe.name}
          aside={readOnly ? <StatusTag tone="draft" icon={Lock} label="Lecture seule" /> : undefined}
          description={<>
            {recipe.product_name && <>{recipe.product_name} · </>}
            {usedBy.length > 0 && <>Utilisée par : {usedBy.join(', ')} · </>}
            Composition définie par format : chaque contenant a sa propre liste de quantités.
          </>} />
        {(recipe as { compo_vide?: boolean }).compo_vide && (
          <StatusBanner tone="danger" icon={AlertTriangle} title="Fiche incomplète : aucun composant">
            Cette fiche n'a encore aucune ligne ({T.ingredientsLc} ou préparations de base) : son coût est inconnu et elle ne peut pas servir en production. Complète la composition ci-dessous.
          </StatusBanner>
        )}
        {readOnlyReason && (
          <StatusBanner tone="neutral" icon={Lock} title="Lecture seule">{readOnlyReason} Seuls ses membres, le gérant et l'administrateur la modifient.</StatusBanner>
        )}
        {duplicating && (
          <RecipeDuplicateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null }} onClose={() => setDuplicating(false)} />
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

        {/* Indicateurs TECHNIQUES du format affiché (2026-11-24) : rendement, poids, perte,
            allergènes. Ni coût, ni prix, ni marge : la fiche technique dit quoi et comment,
            le coût se calcule à part (Production › Coûts standard), comme dans les ERP du
            marché (nomenclature et gamme d'un côté, calcul du coût standard de l'autre). */}
        <div className="pd-sticky-kpis">
          <KpiGrid label="Indicateurs du format affiché">
            <KpiCard label={`Rendement ${kpi?.contenantNom ? `(${kpi.contenantNom})` : `(pièces par ${T.batch.toLowerCase()})`}`}
              value={kpi ? (kpi.unite === 'kg' ? `${kpi.rendement.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg` : `${kpi.rendement} pièce${kpi.rendement > 1 ? 's' : ''}`) : '—'}
              sub={`par ${T.batch.toLowerCase()}`} />
            <KpiCard label={kpi?.unite === 'kg' ? 'Matière engagée par kg' : 'Poids brut par pièce'} value={kpi ? poidsTxt(kpi.poidsPieceG) : '—'}
              sub="composants pesables, avant perte" />
            <KpiCard label="Perte de fabrication" value={kpi ? `${kpi.pertePct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : '—'}
              sub="cuisson, parures et casse prévues" />
            <KpiCard label="Allergènes" value={String(allergensList.length)}
              sub={allergensList.length ? allergensList.map(allergenLabel).join(', ') : 'aucun déclaré'} />
          </KpiGrid>
        </div>

        {/* Allergènes — agrégés sur toute la nomenclature (v_recipe_allergens, mig 343),
            resynchronisés à chaque sauvegarde de composition. Mention réglementaire
            (UE 1169/2011) : affichée même vide, pour que « aucun allergène » soit une
            information et non un oubli de saisie. Réintégré depuis l'ancien écran (L3). */}
        {(() => {
          const allergens = (recipe as { allergens?: string[] | null }).allergens || [];
          return (
            <section className="ds-panel" style={{ padding: '14px 20px', display: 'grid', gap: 10 }}>
              <SectionHeader title="Allergènes" note={allergens.length > 0 ? `${allergens.length} déclaré(s)` : undefined} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {allergens.length > 0 ? (
                  allergens.map((a) => <StatusTag key={a} tone="blocked" icon={AlertTriangle} label={allergenLabel(a)} />)
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--ds-muted)' }}>
                    Aucun allergène déclaré sur les {T.ingredientsLc} de cette nomenclature. Vérifiez que les fiches {T.ingredientsLc} sont renseignées.
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
        {/* Le coût de l'article n'est plus calculé ici : lien vers son coût standard. */}
        {canSeeCost && !(recipe as { is_base?: boolean }).is_base && (
          <section className="ds-panel" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 360px', minWidth: 0, display: 'grid', gap: 4 }}>
              <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Calculator size={16} aria-hidden="true" /> Coût de l'article</span>} />
              <span style={{ fontSize: 14, color: 'var(--ds-body)' }}>
                Le coût ne fait pas partie de la fiche : il se calcule à part, à partir de ces quantités, des prix des lots et des charges des centres.
              </span>
              <span style={{ fontSize: 12, color: 'var(--ds-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Lock size={12} aria-hidden="true" /> Ce cadre n'apparaît que pour le gérant : le labo ne voit ni coût ni marge.
              </span>
            </div>
            <Link to={`/production/couts-standard/${recipe.id}`} className="odoo-btn-secondary">
              Voir le coût standard <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </section>
        )}
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
