import { useActionPermissions } from '../../hooks/useActionPermissions';
import { usePermissions } from '../../context/PermissionsContext';
import { useProdTerms } from '../../hooks/useProdTerms';
import HistoryPanel from '../../components/audit/HistoryPanel';
import CustomFieldsCard from '../../components/custom-fields/CustomFieldsCard';
import { useState } from 'react';
import { notify } from '../../components/ui/InlineNotification';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChefHat, Pencil, AlertTriangle, Lock, Copy, Calculator, ArrowRight, Printer } from 'lucide-react';
import { Alert, Breadcrumb, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, PageHeader, SectionHeader, Tabs } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import RecipeDuplicateDialog from './RecipeDuplicateDialog';
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
  const [printing, setPrinting] = useState(false);
  // Onglet de la fiche, gardé dans l'adresse (?onglet=…) : un lien ou un retour arrière
  // rouvre le même onglet.
  const [params, setParams] = useSearchParams();
  const TABS = ['composition', 'fabrication', 'ingredients', 'versions'] as const;
  type FicheTab = typeof TABS[number];
  const rawTab = params.get('onglet') as FicheTab | null;
  const tab: FicheTab = rawTab && (TABS as readonly string[]).includes(rawTab) ? rawTab : 'composition';
  const go = (t: FicheTab) => setParams(prev => { const n = new URLSearchParams(prev); n.set('onglet', t); return n; }, { replace: true });

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

  const isBase = (recipe as { is_base?: boolean }).is_base ?? false;
  const compoParPiece = (recipe as { compo_par_piece?: boolean }).compo_par_piece ?? false;
  const categoryLabel = (recipe as { category_label?: string | null }).category_label ?? null;
  const nbEtapes = (recipe.etapes || []).length;

  const printFiche = async () => {
    setPrinting(true);
    try {
      const response = await recipesApi.fichePdf(recipe.id, kpi?.formatId);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('La fiche technique n\'a pas pu être générée');
    } finally {
      setPrinting(false);
    }
  };

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
          <Copy size={14} aria-hidden="true" /> Dupliquer
        </button>
        <button type="button" onClick={printFiche} disabled={printing} className="odoo-btn-secondary"
          title={kpi?.contenantNom ? `Imprimer la fiche du format ${kpi.contenantNom}` : 'Imprimer la fiche technique'}>
          <Printer size={14} aria-hidden="true" /> {printing ? 'Génération…' : 'Imprimer la fiche'}
        </button>
      </div>

      <div className="pd-page">
        {/* En-tête de fiche : nom, statut, description d'une ligne. */}
        <PageHeader title={recipe.name}
          aside={readOnly ? <StatusTag tone="draft" icon={Lock} label="Lecture seule" /> : undefined}
          description={<>
            {[categoryLabel, isBase ? T.basePrep.toLowerCase() : recipe.product_name ? `produit vendu : ${recipe.product_name}` : null,
              `quantités saisies ${compoParPiece ? 'par pièce' : `par ${T.batch.toLowerCase()}`}`].filter(Boolean).join(' · ')}
            {usedBy.length > 0 && <> · utilisée par {usedBy.join(', ')}</>}
          </>} />
        {(recipe as { compo_vide?: boolean }).compo_vide && (
          <Alert tone="danger" icon={AlertTriangle}>
            <strong>Fiche incomplète : aucun composant.</strong> Elle ne peut pas servir en production tant que la composition n'est pas saisie.
          </Alert>
        )}
        {readOnlyReason && (
          <Alert tone="info" icon={Lock}>{readOnlyReason} Seuls ses membres, le gérant et l'administrateur la modifient.</Alert>
        )}
        {/* Version en vigueur et modifications en attente de publication. */}
        <BomVersionBanner recipeId={recipe.id} />
        {duplicating && (
          <RecipeDuplicateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null }} onClose={() => setDuplicating(false)} />
        )}
        {editIdentity && (
          <RecipeCreateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null,
            is_base: isBase,
            is_phantom: (recipe as { is_phantom?: boolean }).is_phantom ?? false,
            compo_par_piece: compoParPiece,
            temperature_pate_cible_c: (recipe as { temperature_pate_cible_c?: number | null }).temperature_pate_cible_c ?? null,
            hydratation_pct: (recipe as { hydratation_pct?: number | null }).hydratation_pct ?? null }}
            onClose={() => setEditIdentity(false)} />
        )}

        {/* Indicateurs TECHNIQUES du format affiché : ni coût, ni prix, ni marge — la fiche
            technique dit quoi et comment, le coût se calcule à part (Production › Coûts standard). */}
        <KpiGrid label="Indicateurs du format affiché">
          <KpiCard label="Rendement"
            value={kpi ? (kpi.unite === 'kg' ? `${kpi.rendement.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg` : `${kpi.rendement} pièce${kpi.rendement > 1 ? 's' : ''}`) : '—'}
            sub={`par ${T.batch.toLowerCase()}${kpi?.contenantNom ? ` · ${kpi.contenantNom}` : ''}`} />
          <KpiCard label={kpi?.unite === 'kg' ? 'Matière engagée par kg' : 'Poids par pièce'} value={kpi ? poidsTxt(kpi.poidsPieceG) : '—'}
            sub="composants pesables, avant perte" />
          <KpiCard label="Perte de fabrication" value={kpi ? `${kpi.pertePct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %` : '—'}
            sub="cuisson, parures et casse" />
          <KpiCard label="Étapes de fabrication" value={nbEtapes > 0 ? String(nbEtapes) : 'À décrire'} tone={nbEtapes > 0 ? undefined : 'orange'}
            sub={nbEtapes > 0 ? 'mode opératoire' : 'aucune étape saisie'} onClick={() => go('fabrication')} />
        </KpiGrid>

        <div className="fiche-body">
          {/* Colonne principale : le contenu de la fiche, en onglets (comme la nomenclature
              des ERP du marché : composants, opérations, versions). */}
          <section className="ds-panel fiche-main" aria-label="Contenu de la fiche">
            <Tabs label="Contenu de la fiche" value={tab} onChange={go} tabs={[
              { key: 'composition', label: 'Composition' },
              { key: 'fabrication', label: 'Fabrication', count: nbEtapes || undefined },
              { key: 'ingredients', label: `${T.ingredients} à plat` },
              { key: 'versions', label: 'Versions' },
            ]} />
            <div className="fiche-tab" role="tabpanel">
              {/* L'éditeur reste monté (masqué) hors de son onglet : une saisie non enregistrée
                  survit au changement d'onglet et les indicateurs du format restent renseignés. */}
              <div hidden={tab !== 'composition'}>
                <NomenclatureEditor recipeId={recipe.id} readOnly={readOnly} onFinance={setKpi}
                  onSaved={() => qc.invalidateQueries({ queryKey: ['recipe', id] })}
                  extra={<fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                    <SubstitutesPanel recipeId={recipe.id} />
                  </fieldset>} />
              </div>
              {tab === 'fabrication' && <>
                <RecipeRoutingPanel recipeId={recipe.id} recipeName={recipe.name} />
                {/* Mode opératoire : imprimé avec la fiche remise au labo. */}
                <EtapesSection etapes={recipe.etapes || []} recipeId={recipe.id} editBlockedReason={readOnlyReason ?? (etapesStatus?.frozen ? etapesStatus.reason : null)} />
                <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <RecipeOutputsPanel recipeId={recipe.id} />
                </fieldset>
              </>}
              {/* Explosion à plat (mig 400) : ingrédients élémentaires cumulés sur tous les niveaux. */}
              {tab === 'ingredients' && <ExplosionSection recipeId={recipe.id} defaultOpen />}
              {tab === 'versions' && <>
                <VersionsSection recipeId={recipe.id} defaultOpen />
                <HistoryPanel table="recipes" id={recipe.id} defaultOpen />
              </>}
            </div>
          </section>

          {/* Colonne d'informations : ce qu'on consulte sans le modifier souvent. */}
          <aside className="fiche-side" aria-label="Informations de la fiche">
            <section className="ds-panel" style={{ padding: '16px 20px', display: 'grid', gap: 12 }}>
              <SectionHeader title="Informations">
                {!readOnly && <button type="button" className="fx-link" onClick={() => setEditIdentity(true)}><Pencil size={13} aria-hidden="true" /> Modifier</button>}
              </SectionHeader>
              <dl className="fiche-dl">
                <dt>Catégorie</dt><dd>{categoryLabel ?? '—'}</dd>
                <dt>Type</dt><dd>{isBase ? 'Préparation de base' : 'Produit fini'}</dd>
                <dt>Quantités saisies</dt><dd>{compoParPiece ? 'Par pièce' : `Par ${T.batch.toLowerCase()}`}</dd>
                {!isBase && <><dt>Produit vendu</dt><dd>{recipe.product_name ?? '—'}</dd></>}
                {usedBy.length > 0 && <><dt>Utilisée par</dt><dd>{usedBy.join(', ')}</dd></>}
              </dl>
            </section>

            {/* Allergènes — agrégés sur toute la nomenclature (v_recipe_allergens, mig 343).
                Mention réglementaire (UE 1169/2011) affichée même vide. */}
            <section className="ds-panel" style={{ padding: '16px 20px', display: 'grid', gap: 10 }}>
              <SectionHeader title="Allergènes" note={allergensList.length > 0 ? `${allergensList.length} déclaré(s)` : undefined} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {allergensList.length > 0
                  ? allergensList.map((a) => <StatusTag key={a} tone="blocked" icon={AlertTriangle} label={allergenLabel(a)} />)
                  : <span style={{ fontSize: 14, color: 'var(--ds-muted)' }}>Aucun allergène déclaré sur les {T.ingredientsLc} de cette nomenclature.</span>}
              </div>
              <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Calculés sur tous les {T.ingredientsLc} de la nomenclature (règlement UE 1169/2011).</span>
            </section>

            {/* Le coût de l'article n'est pas sur la fiche : lien vers son coût standard (gérant). */}
            {canSeeCost && !isBase && (
              <section className="ds-panel" style={{ display: 'grid' }}>
                <div style={{ padding: '16px 20px 12px', display: 'grid', gap: 6 }}>
                  <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Calculator size={16} aria-hidden="true" /> Coût de l'article</span>} />
                  <span style={{ fontSize: 13, color: 'var(--ds-body)' }}>Calculé à part, à partir de ces quantités, des prix des lots et des charges des centres.</span>
                </div>
                <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--ds-hair)', display: 'grid', gap: 8 }}>
                  <Link to={`/production/couts-standard/${recipe.id}`} className="odoo-btn-secondary" style={{ justifySelf: 'start' }}>
                    Voir le coût standard <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                  <span style={{ fontSize: 12, color: 'var(--ds-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={12} aria-hidden="true" /> Visible seulement par le gérant.
                  </span>
                </div>
              </section>
            )}

            <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <AlternativeOfPanel recipe={recipe} />
            </fieldset>
            <CustomFieldsCard entity="recipe" id={recipe.id} />
          </aside>
        </div>
      </div>
    </div>
  );
}
