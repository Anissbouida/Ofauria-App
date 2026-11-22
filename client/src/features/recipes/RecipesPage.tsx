import { money, currencySymbol } from '../../utils/money';
import { usePermissions } from '../../context/PermissionsContext';
import { useState, useMemo, useEffect } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recipesApi } from '../../api/recipes.api';
import { ChefHat, Search, BookOpen, Plus, Pencil, Trash2, Layers, LayoutGrid, List, Package, Box, ArrowUp, ArrowDown, ArrowUpDown, Repeat, Upload, Download, Printer, Archive, ArchiveRestore } from 'lucide-react';
import ContenantsPage from '../production/ContenantsPage';
import SalesPageShell from '../sales/SalesPageShell';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import {
  BulkBar, DataPanel, EmptyState as DsEmptyState, ErrorState, LoadingState, NoResultState, SearchBar, Segmented, TableFooter, Tabs, Toolbar,
} from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useNavigate, useSearchParams } from 'react-router-dom';
import RecipeCreateDialog, { type RecipeIdentity } from './RecipeCreateDialog';
import { useAuth } from '../../context/AuthContext';
import RecipeImportModal from './RecipeImportModal';
import BulkReplaceModal from './BulkReplaceModal';
import type { RecipeCategory } from '../../api/recipes.api';
import { useActionPermissions } from '../../hooks/useActionPermissions';
import { textIncludes } from '../../utils/searchText';
import { apiErrorMessage } from '../../api/errors';

type ActiveTab = 'product' | 'base' | 'contenants';
type ViewMode = 'grid' | 'list';

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left', title }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center'; title?: string;
}) {
  const active = currentKey === sk;
  // En-tête triable au clavier : le <th onClick> nu n'était ni focusable ni annoncé
  // comme triable par un lecteur d'écran.
  return (
    <th style={{ textAlign: align }} aria-sort={active ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span role="button" tabIndex={0} title={title}
        onClick={() => onSort(sk)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sk); } }}
        className="inline-flex items-center gap-1 cursor-pointer">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

export default function RecipesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { sectorLabel } = usePermissions();
  // M8-03 : termes du secteur (défaut = boulangerie).
  const T = {
    finishedTab: sectorLabel('finished_products_tab', 'Recettes produits finis'),
    baseTab: sectorLabel('base_preps', 'Préparations de base'),
    base: sectorLabel('base_prep', 'Préparation de base'),
    formatsTab: sectorLabel('formats_tab', 'Formats de production'),
    yield: sectorLabel('yield', 'Rendement'),
    batchCost: sectorLabel('batch_cost', 'Coût fournée'),
    searchRecipes: sectorLabel('search_recipes', 'Rechercher une recette ou un produit...'),
    searchBase: sectorLabel('search_base_preps', 'Rechercher une préparation de base...'),
  };
  const isAdmin = user?.role === 'admin';
  // Constat 111 : seuls les boutons permis sont montrés, et un refus s'affiche.
  const { can } = useActionPermissions();
  const canArchive = can('recipes.delete');          // DELETE /recipes/:id archive la fiche
  const canRestore = can('recipes.restore');
  const canBulkArchive = can('recipes.bulk_archive');
  const canBulkRestore = can('recipes.bulk_restore');
  const canBulkDelete = can('recipes.bulk_delete');
  const onActionError = (e: unknown) => notify.error(apiErrorMessage(e, 'Action refusée'));
  // Vue « Archivées » : fiches retirées des listes (retenues par l'historique de
  // production, ou mises de côté) — consultables et restaurables, jamais mélangées
  // aux actives. La clé de query préfixée 'recipes' reste invalidée par les
  // invalidateQueries(['recipes']) existants.
  const [showArchived, setShowArchived] = useState(false);
  const { data: recipes = [], isLoading, error: listError, refetch } = useQuery({
    queryKey: ['recipes', { archived: showArchived }],
    queryFn: () => recipesApi.list(showArchived),
    // Refus de droit (403, `recipes.view`) : définitif, pas de nouvel essai.
    retry: (n, e) => (e as { response?: { status?: number } })?.response?.status !== 403 && n < 1,
  });
  const forbidden = (listError as { response?: { status?: number } } | null)?.response?.status === 403;
  const { data: recipeCategories = [] } = useQuery<RecipeCategory[]>({
    queryKey: ['recipe-categories'],
    queryFn: recipesApi.listCategories,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(''); // '' = toutes
  const [showForm, setShowForm] = useState(false);
  /** Fiche dont on modifie l'identité (nom, catégorie) depuis la liste. */
  const [identityEdit, setIdentityEdit] = useState<RecipeIdentity | null>(null);
  // Point d'entrée du module : les recettes produits finis. L'onglet « Formats de
  // production » est un référentiel de contenants (pas de recherche, pas de compteur) :
  // y atterrir par défaut donnait l'impression d'être ailleurs que dans les fiches.
  const [activeTab, setActiveTab] = useState<ActiveTab>('product');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  // Retour depuis la page plein écran : ?tab=<onglet> restaure l'onglet de liste.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (!tab) return;
    if (tab === 'product' || tab === 'base' || tab === 'contenants') setActiveTab(tab as ActiveTab);
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showImport, setShowImport] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  // Piloté depuis la barre de contrôle, consommé par l'onglet Formats de production.
  const [creatingContenant, setCreatingContenant] = useState(false);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'total_cost' || key === 'cost_per_unit' || key === 'margin' || key === 'yield_quantity' ? 'desc' : 'asc'); }
  };

  const deleteMutation = useMutation({
    mutationFn: recipesApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recipes'] }); notify.success('Fiche archivée — restaurable depuis la vue Archivées'); },
    onError: onActionError,
  });
  const restoreMutation = useMutation({
    mutationFn: recipesApi.restore,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['recipes'] }); notify.success('Fiche restaurée'); },
    onError: onActionError,
  });

  // Sélection multiple (vue liste, admin) : suppression en masse par onglet.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const bulkDeleteMutation = useMutation({
    mutationFn: recipesApi.bulkRemove,
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setSelectedIds(new Set());
      if (result.blocked.length > 0) {
        // Les fiches retenues par l'historique de production ne seront JAMAIS
        // supprimables : proposer tout de suite l'alternative qui marche,
        // sinon l'utilisateur reclique « Supprimer » en boucle sans issue.
        const names = result.blocked.map(b => b.name).join(', ');
        if (await confirm(
          `${result.deletedCount} supprimée(s). ${result.blocked.length} fiche(s) ne peuvent pas être supprimées car l'historique de production les référence :\n${names}\n\nLes archiver à la place ? Elles disparaissent des listes mais restent restaurables via « Archivées ».`,
          { title: 'Fiches conservées par l\'historique', confirmLabel: 'Archiver ces fiches' }
        )) {
          bulkArchiveMutation.mutate(result.blocked.map(b => b.id));
        } else {
          notify.error(`${result.deletedCount} supprimée(s) — ${result.blocked.length} conservée(s) : ${names}`);
        }
      } else {
        notify.success(`${result.deletedCount} fiche(s) supprimée(s)`);
      }
    },
    onError: onActionError,
  });
  const bulkArchiveMutation = useMutation({
    mutationFn: recipesApi.bulkArchive,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setSelectedIds(new Set());
      notify.success(`${result.archivedCount} fiche(s) archivée(s)`);
    },
    onError: onActionError,
  });
  const bulkRestoreMutation = useMutation({
    mutationFn: recipesApi.bulkRestore,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setSelectedIds(new Set());
      notify.success(`${result.restoredCount} fiche(s) restaurée(s)`);
    },
    onError: onActionError,
  });

  /** L'onglet Bases et l'onglet Produits partagent le tableau mais pas les colonnes :
      perte et rendement net n'ont de sens que pour une préparation, marge que pour
      un produit. */
  const isBaseTab = activeTab === 'base';

  const filtered = recipes.filter((r: Record<string, any>) => {
    // Constat 122 : accents ignorés (« eclair » trouve « Éclair au chocolat »).
    const matchSearch = textIncludes(search, r.name as string, r.product_name as string);
    const matchTab = isBaseTab ? r.is_base === true : !r.is_base;
    const matchCategory = !categoryFilter || (r.category_id as string) === categoryFilter;
    return matchSearch && matchTab && matchCategory;
  });

  // Constat 123 : même coût matière par pièce que l'affichage (source unique fn_recipe_cost).
  const unitMaterial = (x: Record<string, any>) => x.cout_matiere_piece != null
    ? parseFloat(String(x.cout_matiere_piece))
    : parseFloat((x.total_cost as string) || '0') / ((x.yield_quantity as number) || 1);

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = ((a.name as string) || '').localeCompare((b.name as string) || ''); break;
        case 'is_base': cmp = (a.is_base === b.is_base ? 0 : a.is_base ? -1 : 1); break;
        case 'contenant_nom': cmp = ((a.contenant_nom as string) || '').localeCompare((b.contenant_nom as string) || ''); break;
        case 'yield_quantity': cmp = ((a.yield_quantity as number) || 0) - ((b.yield_quantity as number) || 0); break;
        case 'total_cost': cmp = parseFloat((a.total_cost as string) || '0') - parseFloat((b.total_cost as string) || '0'); break;
        case 'perte': cmp = parseFloat((a.perte_standard_pct as string) || '0') - parseFloat((b.perte_standard_pct as string) || '0'); break;
        case 'net': {
          const nA = parseFloat((a.total_weight_kg as string) || '0') * (1 - (parseFloat((a.perte_standard_pct as string) || '0') / 100));
          const nB = parseFloat((b.total_weight_kg as string) || '0') * (1 - (parseFloat((b.perte_standard_pct as string) || '0') / 100));
          cmp = nA - nB; break;
        }
        case 'utilisee_par': cmp = (parseInt((a.utilisee_par as string) || '0') || 0) - (parseInt((b.utilisee_par as string) || '0') || 0); break;
        case 'cost_per_unit': {
          // Même normalisation que l'affichage : une base se trie au kg net,
          // sinon le tri classerait des DH/g face à des DH/kg.
          const perKg = (x: Record<string, any>) => {
            const net = parseFloat((x.total_weight_kg as string) || '0') * (1 - (parseFloat((x.perte_standard_pct as string) || '0') / 100));
            return net > 0 ? parseFloat((x.total_cost as string) || '0') / net : 0;
          };
          const cA = a.is_base ? perKg(a) : unitMaterial(a);
          const cB = b.is_base ? perKg(b) : unitMaterial(b);
          cmp = cA - cB; break;
        }
        case 'margin': {
          const prA = parseFloat((a.product_price as string) || '0');
          const cpuA = unitMaterial(a);
          const mA = prA > 0 ? (prA - cpuA) / prA * 100 : 0;
          const prB = parseFloat((b.product_price as string) || '0');
          const cpuB = unitMaterial(b);
          const mB = prB > 0 ? (prB - cpuB) / prB * 100 : 0;
          cmp = mA - mB; break;
        }
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const baseCount = recipes.filter((r: Record<string, any>) => r.is_base === true).length;
  const productCount = recipes.filter((r: Record<string, any>) => !r.is_base).length;

  // Produit composé → ouverture directe en plein écran (page composition).
  // Préparation de base → modal de consultation (pas de format/composition par contenant).
  // Une préparation et un produit fini ouvrent désormais la même chose : une page
  // pleine. Consultation et édition y sont fusionnées, comme côté produit — deux
  // entrées vers un même écran n'avaient plus de raison d'être.
  const openRecipe = (r: Record<string, any>) => {
    // Modèle unique (L2) : bases et produits s'éditent via le même éditeur de
    // composition (NomenclatureEditor), qui gère ingrédients, sous-recettes et
    // formats. L'ancien écran PreparationPage (ancien modèle) n'est plus routé.
    navigate(`/recipes/${r.id}/nomenclature`);
  };
  const editRecipe = openRecipe;

  /**
   * Fiche technique imprimable. On ouvre le PDF dans un onglet plutôt que de le
   * télécharger : le geste attendu est « imprimer », et la visionneuse du
   * navigateur enchaîne directement sur Ctrl+P. Compatible Capacitor.
   */
  const [printingId, setPrintingId] = useState<string | null>(null);
  const printFiche = async (r: Record<string, any>) => {
    setPrintingId(r.id as string);
    try {
      const response = await recipesApi.fichePdf(r.id as string);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('Erreur lors de la génération de la fiche technique');
    } finally {
      setPrintingId(null);
    }
  };

  const openCreate = () => {
    setShowForm(true);
  };

  /** Changement d'onglet : les filtres du précédent ne s'appliquent plus au suivant. */
  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSearch('');
    setCategoryFilter('');
    setSelectedIds(new Set());
  };

  const askDelete = async (r: Record<string, any>) => {
    const label = r.is_base ? 'la préparation de base' : 'la recette';
    if (await confirm(`Archiver ${label} « ${r.name as string} » ? Elle sort des listes et des sélecteurs, mais reste lisible depuis l'historique de production et restaurable depuis la vue Archivées.`,
      { title: 'Archiver la fiche', confirmLabel: 'Archiver' })) {
      deleteMutation.mutate(r.id as string);
    }
  };

  // « Tout sélectionner » porte sur les lignes visibles (onglet + filtres actifs),
  // pas sur tout le référentiel : ce que l'utilisateur voit est ce qu'il supprime.
  const visibleIds = useMemo(() => sortedFiltered.map((r: Record<string, any>) => r.id as string), [sortedFiltered]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
  };
  const askBulkDelete = async () => {
    const n = selectedIds.size;
    if (n === 0) return;
    const label = isBaseTab ? 'préparation(s) de base' : 'recette(s) produit fini';
    if (await confirm(`Supprimer ${n} ${label} ? Cette action est définitive. Les fiches utilisées ailleurs (sous-recette, plan de production) seront conservées.`,
      { title: 'Supprimer les fiches', confirmLabel: 'Supprimer', danger: true })) {
      bulkDeleteMutation.mutate([...selectedIds]);
    }
  };
  const askBulkArchive = async () => {
    const n = selectedIds.size;
    if (n === 0) return;
    if (await confirm(`Archiver ${n} fiche(s) ? Elles disparaissent des listes et des sélecteurs mais restent restaurables depuis la vue « Archivées ».`,
      { title: 'Archiver les fiches', confirmLabel: 'Archiver' })) {
      bulkArchiveMutation.mutate([...selectedIds]);
    }
  };

  // Distingue « le référentiel est vide » de « les filtres ne renvoient rien » :
  // le message et l'action utile ne sont pas les mêmes.
  const hasAnyInTab = activeTab === 'base' ? baseCount > 0 : productCount > 0;
  const emptyState = showArchived
    ? { title: 'Aucune fiche archivée', hint: 'Les fiches archivées disparaissent des listes et des sélecteurs sans être supprimées — elles restent restaurables ici.', action: 'clear' as const }
    : hasAnyInTab
    ? { title: 'Aucun résultat', hint: 'Aucune fiche ne correspond aux filtres actifs.', action: 'clear' as const }
    : {
        title: activeTab === 'base' ? 'Aucune préparation de base' : 'Aucune recette produit fini',
        hint: activeTab === 'base'
          ? 'Les préparations de base (pâtes, crèmes, garnitures) sont les briques réutilisées par les produits finis.'
          : 'Une recette produit fini se compose de préparations de base et d’ingrédients, format par format.',
        action: 'create' as const,
      };

  const EmptyState = () => (emptyState.action === 'create' ? (
    <DsEmptyState icon={BookOpen} title={emptyState.title} text={emptyState.hint}
      action={<button type="button" onClick={openCreate} className="odoo-btn-primary"><Plus size={14} aria-hidden="true" /> Créer une fiche</button>} />
  ) : showArchived && !search && !categoryFilter ? (
    <DsEmptyState icon={Archive} title={emptyState.title} text={emptyState.hint} />
  ) : (
    <NoResultState text={showArchived ? 'Aucune fiche archivée ne correspond aux filtres.' : emptyState.hint} onReset={() => { setSearch(''); setCategoryFilter(''); }} />
  ));

  const shellTitle = sectorLabel('recipes', 'Fiches techniques');
  const tabNoun = isBaseTab ? 'préparation' : 'recette';

  // Lecture des fiches réservée (scénario 1, constat 105) : la caisse n'y a pas accès.
  if (forbidden) {
    return (
      <SalesPageShell icon={ChefHat} parent="Production › Paramétrage" title={shellTitle} list>
        <DsEmptyState icon={ChefHat} title="Vous n'avez pas accès aux fiches techniques"
          text="La consultation des fiches est réservée à la production, au magasin et à la direction." />
      </SalesPageShell>
    );
  }

  return (
    <SalesPageShell icon={ChefHat} parent="Production › Paramétrage" title={shellTitle} list
      summary="Recettes des produits finis, préparations de base et formats de production, avec leur coût matière."
      actions={<>
        {/* Import/export xlsx — admin uniquement, pas sur l'onglet Contenants */}
        {activeTab !== 'contenants' && isAdmin && (
          <>
            <button type="button"
              onClick={() => setShowReplace(true)}
              className="odoo-btn-secondary"
              title="Remplacer un ingrédient par un autre sur toutes les recettes"
            >
              <Repeat size={13} aria-hidden="true" /> Remplacer un ingrédient
            </button>
            <button type="button"
              onClick={() => setShowImport(true)}
              className="odoo-btn-secondary"
              title="Importer des recettes depuis un fichier Excel"
            >
              <Upload size={13} aria-hidden="true" /> Importer
            </button>
            <button type="button"
              onClick={() => recipesApi.exportXlsx(activeTab === 'base' ? 'base' : 'product')}
              className="odoo-btn-secondary"
              title={activeTab === 'base' ? 'Exporter les recettes de base en Excel' : 'Exporter les recettes produits en Excel'}
            >
              <Download size={13} aria-hidden="true" /> Exporter
            </button>
          </>
        )}
        {/* L'onglet Formats gère son propre référentiel : le bouton reste dans la barre
            comme pour les deux autres onglets, mais pilote son formulaire. */}
        {activeTab === 'contenants' ? (
          <button type="button" onClick={() => setCreatingContenant(true)} className="odoo-btn-primary">
            <Plus size={14} aria-hidden="true" /> Nouveau format
          </button>
        ) : (
          <button type="button" onClick={openCreate} className="odoo-btn-primary">
            <Plus size={14} aria-hidden="true" /> Nouvelle fiche
          </button>
        )}
      </>}>

      {/* ══════ ONGLETS ══════ */}
      {/* Ordre = flux métier : on compose un produit fini à partir de préparations de
          base, elles-mêmes coulées dans des formats. Les filtres sont remis à zéro au
          changement d'onglet : une catégorie restée active donnait une liste vide
          inexpliquée sur l'onglet d'arrivée. */}
      <Tabs label={shellTitle} value={activeTab} onChange={switchTab} tabs={[
        { key: 'product', label: T.finishedTab, count: productCount > 0 ? productCount : undefined },
        { key: 'base', label: T.baseTab, count: baseCount > 0 ? baseCount : undefined },
        { key: 'contenants', label: T.formatsTab },
      ]} />

      {activeTab === 'contenants' ? (
        <ContenantsPage creating={creatingContenant} onCreatingChange={setCreatingContenant} />
      ) : <>
      {/* ══════ BARRE D'OUTILS : recherche, catégorie, puis bascules (période, affichage) ══════ */}
      <Toolbar>
        <SearchBar value={search} onChange={setSearch} placeholder={activeTab === 'base' ? T.searchBase : T.searchRecipes} />
        <SearchSelect
          options={recipeCategories.map(c => ({ id: String(c.id), label: c.label }))}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="Toutes catégories"
        />
        <span className="ds-grow" />
        <Segmented label="Fiches affichées" value={showArchived ? 'archived' : 'active'}
          onChange={k => { setShowArchived(k === 'archived'); setSelectedIds(new Set()); }}
          options={[{ key: 'active', label: 'Actives' }, { key: 'archived', label: 'Archivées', icon: Archive }]} />
        <Segmented label="Affichage" value={viewMode} onChange={setViewMode}
          options={[{ key: 'list', label: 'Tableau', icon: List }, { key: 'grid', label: 'Cartes', icon: LayoutGrid }]} />
      </Toolbar>

      {/* ══════ CONTENT ══════ */}
      {isLoading ? (
        <LoadingState label="Chargement des fiches…" />
      ) : listError ? (
        <ErrorState error={listError} onRetry={() => refetch()} />
      ) : viewMode === 'grid' ? (
        /* ═══ Vue cartes ═══ */
        sortedFiltered.length === 0 ? <EmptyState /> : (
        <div className="odoo-kanban">
          <div className="odoo-kanban-grid">
            {sortedFiltered.map((r: Record<string, any>) => {
              const yieldQty = r.yield_quantity as number || 1;
              // Constat 123 : matière par pièce lue à la source unique (fn_recipe_cost) quand elle
              // existe ; la fournée s'en déduit pour une composition saisie par pièce.
              const sourcePiece = !r.is_base && r.cout_matiere_piece != null ? parseFloat(String(r.cout_matiere_piece)) : null;
              const gridRendement = parseInt(String(r.rendement ?? '')) || Math.round(yieldQty) || 1;
              const totalCost = sourcePiece != null && r.compo_par_piece ? sourcePiece * gridRendement : parseFloat(r.total_cost as string || '0');
              const costPerUnit = sourcePiece ?? totalCost / yieldQty;
              // Fallback : pas de produit lie → calcule prix attendu via margin_multiplier
              const productPrice = parseFloat(r.product_price as string || '0');
              const rMargin = parseFloat(String(r.margin_multiplier ?? '0'));
              const price = productPrice > 0 ? productPrice : (rMargin > 0 ? costPerUnit * rMargin : 0);
              const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;
              const cardStatus = !r.is_base && price > 0 ? (margin >= 50 ? 'ok' : margin >= 30 ? 'warning' : 'danger') : 'ok';

              return (
                <div key={r.id as string}
                  className={`odoo-kanban-card ${cardStatus}`}
                  onClick={() => openRecipe(r)}>
                  <div className="odoo-kanban-card-title">
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {r.is_base ? <Layers size={14} style={{ color: 'var(--ds-accent)' }} /> : <ChefHat size={14} style={{ color: 'var(--ds-accent)' }} />}
                      {r.name as string}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {r.category_color && (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: `${r.category_color as string}22`, color: r.category_color as string }} title={r.category_label as string}>
                          {r.category_label as string}
                        </span>
                      )}
                      <span className={`odoo-tag ${r.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                        {r.is_base ? 'Base' : 'Produit'}
                      </span>
                    </span>
                  </div>
                  <div className="odoo-kanban-card-supplier">
                    {r.is_base ? T.base : (r.product_name as string || 'Aucun produit')}
                  </div>
                  <div className="odoo-kanban-card-stock">
                    <span className="odoo-kanban-card-stock-value" style={{ color: 'var(--ds-accent)' }}>
                      {totalCost.toFixed(2)}
                    </span>
                    <span className="odoo-kanban-card-stock-unit">{currencySymbol()} coût matière</span>
                  </div>
                  <div className="odoo-kanban-card-split">
                    <span>{T.yield} <strong>{yieldQty} {r.yield_unit as string || 'u.'}</strong></span>
                    <span style={{ color: 'var(--ds-muted)' }}>·</span>
                    <span>Coût matière par unité <strong>{money(costPerUnit)}</strong></span>
                  </div>
                  <div className="odoo-kanban-card-footer">
                    <span>
                      {r.contenant_nom && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--ds-muted)' }}>
                          <Box size={9} /> {r.contenant_nom as string}
                        </span>
                      )}
                    </span>
                    {!r.is_base && price > 0 && (
                      <StatusTag tone={margin >= 50 ? 'done' : margin >= 30 ? 'todo' : 'blocked'} label={`Marge matière ${margin.toFixed(0)} %`}
                        title="Marge sur coût matière — hors main d'œuvre, énergie et frais de structure." />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )
      ) : (
        /* ═══ Vue tableau ═══ */
        sortedFiltered.length === 0 ? <EmptyState /> : (
        <DataPanel label={shellTitle}
          bulk={
            <BulkBar count={selectedIds.size} noun={tabNoun} onClear={() => setSelectedIds(new Set())}>
              {showArchived ? (canBulkRestore && (
                <button type="button" onClick={() => bulkRestoreMutation.mutate([...selectedIds])} className="odoo-btn-secondary ds-btn-sm"
                  disabled={bulkRestoreMutation.isPending}>
                  <ArchiveRestore size={13} aria-hidden="true" /> {bulkRestoreMutation.isPending ? 'Restauration…' : 'Restaurer'}
                </button>
              )) : (canBulkArchive && (
                <button type="button" onClick={askBulkArchive} className="odoo-btn-secondary ds-btn-sm"
                  disabled={bulkArchiveMutation.isPending}>
                  <Archive size={13} aria-hidden="true" /> {bulkArchiveMutation.isPending ? 'Archivage…' : 'Archiver'}
                </button>
              ))}
              {canBulkDelete && (
                <button type="button" onClick={askBulkDelete} className="ds-btn-danger ds-btn-sm"
                  disabled={bulkDeleteMutation.isPending}>
                  <Trash2 size={13} aria-hidden="true" /> {bulkDeleteMutation.isPending ? 'Suppression…' : 'Supprimer'}
                </button>
              )}
            </BulkBar>
          }
          footer={<TableFooter note={`${sortedFiltered.length} sur ${activeTab === 'base' ? baseCount : productCount} fiche(s)${showArchived ? ' archivée(s)' : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label={allVisibleSelected ? 'Tout désélectionner' : 'Sélectionner toutes les fiches visibles'}
                    style={{ cursor: 'pointer', verticalAlign: 'middle' }} />
                </th>
                <SortHeader label={sectorLabel("recipe", "Recette")} sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                {/* Onglet Bases : « Type » ne dit rien (tout est Base) et « Marge »
                    est vide (une préparation ne se vend pas). On rend ces deux
                    colonnes à ce qui manque vraiment — la perte et le net. */}
                {!isBaseTab && <SortHeader label="Type" sortKey="is_base" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />}
                <SortHeader label="Format" sortKey="contenant_nom" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label={isBaseTab ? `${T.yield} brut` : T.yield} sortKey="yield_quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                {isBaseTab && (
                  <>
                    <SortHeader label="Perte (%)" sortKey="perte" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                      title="Perte de transformation (cuisson, réduction). Elle sépare le poids engagé du poids réellement utilisable." />
                    <SortHeader label={`${T.yield} net`} sortKey="net" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                      title="Poids brut moins la perte de transformation." />
                  </>
                )}
                {/* Ces colonnes viennent de v_recipe_total_cost = matière seule
                    (ingrédients + emballages + sous-recettes). Main d'œuvre, énergie et
                    frais de structure ne sont ajoutés que dans l'éditeur de composition.
                    Les libellés le disent, sinon la marge d'ici contredit celle de là-bas. */}
                <SortHeader label={`${isBaseTab ? T.batchCost : 'Coût matière'} (${currencySymbol()})`} sortKey="total_cost" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                  title="Ingrédients, emballages et préparations de base. Hors main d'œuvre, énergie et frais de structure." />
                <SortHeader label={isBaseTab ? `Coût par kg net (${currencySymbol()}/kg)` : `Coût matière par unité (${currencySymbol()})`} sortKey="cost_per_unit" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                  title={isBaseTab
                    ? "Coût de la fournée rapporté au kilo réellement utilisable. Normalisé au kg pour que deux préparations soient comparables, quelle que soit l'unité de leur rendement."
                    : 'Coût matière rapporté à une unité produite.'} />
                {isBaseTab ? (
                  <SortHeader label="Utilisée par" sortKey="utilisee_par" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                    title="Nombre de recettes qui consomment cette préparation. À zéro, la fiche n'est utilisée nulle part." />
                ) : (
                  <SortHeader label="Marge matière" sortKey="margin" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right"
                    title="Marge sur coût matière — majorée par rapport à la marge réelle, qui déduit aussi main d'œuvre, énergie et structure (voir l'éditeur de composition)." />
                )}
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((r: Record<string, any>) => {
                const isComposeRow = r.mode_cout === 'compose';
                const yieldQty = r.yield_quantity as number || 1;
                // Composé : coût/pièce = coût total ÷ rendement (format) ; sinon legacy ÷ yield.
                const rendement = parseInt(String(r.rendement ?? '')) || (isComposeRow ? Math.round(yieldQty) : yieldQty) || 1;
                // Constat 123 : matière par pièce de la source unique (fn_recipe_cost) ; en saisie par
                // pièce, le coût « fournée » vaut pièce × rendement (et non l'inverse).
                const sourcePiece = !r.is_base && r.cout_matiere_piece != null ? parseFloat(String(r.cout_matiere_piece)) : null;
                const totalCost = sourcePiece != null && r.compo_par_piece ? sourcePiece * rendement : parseFloat(r.total_cost as string || '0');
                // Base : le coût est ramené au kilo NET. Diviser par le rendement
                // tel quel donnait DH/g pour une fiche en grammes et DH/kg pour sa
                // voisine en kilos — deux lignes du même tableau à un facteur 1000.
                // On passe par le poids réel des ingrédients, pas par le rendement
                // saisi, puis on retire la perte de transformation.
                const perteBase = parseFloat(String(r.perte_standard_pct ?? '0')) || 0;
                const utiliseePar = parseInt(String(r.utilisee_par ?? '0')) || 0;
                const poidsKg = parseFloat(String(r.total_weight_kg ?? '0')) || 0;
                const poidsNetKg = poidsKg * (1 - perteBase / 100);
                const costPerUnit = r.is_base
                  ? (poidsNetKg > 0 ? totalCost / poidsNetKg : 0)
                  : sourcePiece ?? (isComposeRow ? totalCost / Math.max(1, rendement) : totalCost / yieldQty);
                const productPrice = parseFloat(r.product_price as string || '0');
                const rMargin = parseFloat(String(r.margin_multiplier ?? '0'));
                // Composé : prix conseillé théorique = coût/pièce × multiplicateur.
                const price = isComposeRow
                  ? (rMargin > 0 ? costPerUnit * rMargin : 0)
                  : (productPrice > 0 ? productPrice : (rMargin > 0 ? costPerUnit * rMargin : 0));
                const margin = price > 0 ? ((price - costPerUnit) / price * 100) : 0;
                // Indicateur d'ÉTAT (santé donnée) : vide → rouge, rendement à définir → ambre, sinon vert.
                // Composition vide : signalée aussi sur une préparation de base (constat 107).
                const dotTitle = r.compo_vide ? 'Fiche incomplète : aucun composant'
                  : r.cout_incomplet ? 'Coût de revient incomplet : ingrédient sans prix, conversion douteuse ou préparation vide (détail sur la fiche)'
                  : r.is_base ? T.base
                  : r.rendement_a_definir ? 'Rendement à définir (contenant non assigné)'
                  : 'OK';
                const formatNom = (r.default_contenant_nom as string) || (r.contenant_nom as string) || '';

                return (
                  <tr key={r.id as string} onClick={() => openRecipe(r)} className={selectedIds.has(r.id as string) ? 'ds-selected' : undefined}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox"
                        checked={selectedIds.has(r.id as string)}
                        onChange={() => toggleSelect(r.id as string)}
                        aria-label={`Sélectionner ${r.name as string}`}
                        style={{ cursor: 'pointer', verticalAlign: 'middle' }} />
                    </td>
                    <td>
                      <span className="ds-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {r.name as string}
                        {r.category_color && (
                          <span style={{ fontSize: '11px', fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: `${r.category_color as string}22`, color: r.category_color as string }}>
                            {r.category_label as string}
                          </span>
                        )}
                        {/* L'état de la donnée n'est pas porté par la seule pastille : libellé visible. */}
                        {r.compo_vide && <StatusTag tone="blocked" label="Composition vide" title={dotTitle} />}
                        {!r.compo_vide && r.cout_incomplet && <StatusTag tone="todo" label="Coût incomplet" title={dotTitle} />}
                        {!r.is_base && !r.compo_vide && r.rendement_a_definir && <StatusTag tone="todo" label="Rendement à définir" title={dotTitle} />}
                      </span>
                    </td>
                    {!isBaseTab && (
                      <td>
                        <span className={`odoo-tag ${r.is_base ? 'odoo-tag-purple' : 'odoo-tag-green'}`}>
                          {r.is_base ? 'Base' : 'Produit'}
                        </span>
                      </td>
                    )}
                    <td>{formatNom || '—'}</td>
                    <td className="ds-num">
                      {isComposeRow ? rendement : yieldQty}
                      <span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 3 }}>{isComposeRow ? 'p.' : (r.yield_unit as string || 'u.')}</span>
                    </td>
                    {isBaseTab && (
                      <>
                        <td className="ds-num" style={{ color: perteBase > 0 ? 'var(--ds-warning)' : undefined }}>
                          {perteBase > 0 ? perteBase.toFixed(1) : '—'}
                        </td>
                        <td className="ds-num">
                          {poidsNetKg > 0
                            ? <>{poidsNetKg >= 1 ? poidsNetKg.toFixed(2) : Math.round(poidsNetKg * 1000)}<span style={{ color: 'var(--ds-muted)', fontSize: 12, marginLeft: 3 }}>{poidsNetKg >= 1 ? 'kg' : 'g'}</span></>
                            : '—'}
                        </td>
                      </>
                    )}
                    <td className="ds-num ds-strong">{totalCost.toFixed(2)}</td>
                    <td className="ds-num">{costPerUnit.toFixed(2)}</td>
                    <td className="ds-num">
                      {isBaseTab ? (
                        utiliseePar > 0
                          ? <span title={`${utiliseePar} recette(s) consomment cette préparation`}>{utiliseePar}</span>
                          : <span title="Aucune recette n’utilise cette préparation">—</span>
                      ) : (!r.is_base && price > 0 ? (
                        <StatusTag tone={margin >= 50 ? 'done' : margin >= 30 ? 'todo' : 'blocked'} label={`${margin.toFixed(0)} %`} />
                      ) : '—')}
                    </td>
                    {/* Une seule entrée vers la fiche, des deux côtés : « Voir » et
                        « Modifier » menaient au même écran depuis que la préparation
                        s'ouvre en page pleine comme un produit fini. */}
                    <td className="ds-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openRecipe(r)} className="odoo-btn-secondary ds-btn-sm">Ouvrir</button>
                      {/* Un seul geste par entrée, montré seulement s'il est permis (constat 111). */}
                      <RowMenu label={`Plus d'actions sur ${r.name as string}`} items={[
                        { label: 'Modifier le nom ou la catégorie', icon: Pencil, onSelect: () => setIdentityEdit({ id: r.id as string, name: r.name as string, category_id: r.category_id ?? null, is_base: !!r.is_base, is_phantom: !!r.is_phantom }) },
                        { label: 'Imprimer la fiche technique', icon: Printer, disabled: printingId === r.id, onSelect: () => printFiche(r) },
                        ...(showArchived
                          ? (canRestore ? [{ label: 'Restaurer la fiche', icon: ArchiveRestore, disabled: restoreMutation.isPending, onSelect: () => restoreMutation.mutate(r.id as string) }] : [])
                          : (canArchive ? [{ label: 'Archiver la fiche', icon: Archive, danger: true, onSelect: () => askDelete(r) }] : [])),
                      ] as RowMenuItem[]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
        )
      )}

      {/* Création et édition d'identité passent par la même petite fenêtre
          (RecipeCreateDialog) ; composition et formats s'éditent sur la page
          plein écran. L'ancien RecipeFormModal (modèle pré-L2) a été retiré. */}
      {identityEdit && (
        <RecipeCreateDialog recipe={identityEdit} onClose={() => setIdentityEdit(null)} />
      )}

      {showForm && (
        <RecipeCreateDialog defaultIsBase={activeTab === 'base'} onClose={() => setShowForm(false)} />
      )}

      {showImport && isAdmin && (
        <RecipeImportModal onClose={() => setShowImport(false)} />
      )}
      {showReplace && isAdmin && (
        <BulkReplaceModal onClose={() => setShowReplace(false)} />
      )}
      </>}
    </SalesPageShell>
  );
}
