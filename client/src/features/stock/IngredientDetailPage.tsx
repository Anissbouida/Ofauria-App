import { useReferentiel } from '../../hooks/useReferentiel';
import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, ingredientsApi, ingredientLotsApi } from '../../api/inventory.api';
import { fmtQty, type InventoryItem } from './types';
import { LotMovementModal } from './LotMovementModal';
import IngredientFormModal from './IngredientFormModal';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { suppliersApi } from '../../api/accounting.api';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Package, AlertTriangle, Boxes, ShieldCheck, CalendarClock,
  ChevronDown, ChevronRight, ChevronLeft, Factory, TrendingDown, Trash2, Edit3,
  Truck, FileText, Clock, Beaker, Ban, Shield, Hash, ShoppingCart,
  Warehouse, PackageOpen, MapPin, Printer,
} from 'lucide-react';
import { stockLocationsApi, type StockLocation } from '../../api/stock-locations.api';
import { apiErrorMessage } from '../../api/errors';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';
import CategoryCascadeSelector, { CONSUMABLE_ROOT_IDS } from '../../components/CategoryCascadeSelector';
import { useStockCategories } from './useStockCategories';
import { containerOf, containerLabel, type ContainerDef } from '../../utils/container';
import SupplierItemsSection from './SupplierItemsSection';
import { StatusTag } from '../../components/ui/StatusTag';
import SearchSelect from '../../components/ui/SearchSelect';
import { planStatusTag } from '../production/status';
import { money, currencySymbol } from '../../utils/money';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ModulePage } from '../../components/layout/ModuleShell';
import { SubViews } from './StockUi';
import { Alert, Breadcrumb, EmptyState, FormField, FormFooter, FormSection, KpiCard, KpiGrid, Modal } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import IngredientNutritionCard from './IngredientNutritionCard';

const CATEGORY_COLORS: Record<string, string> = {
  farines: 'bg-amber-100 text-amber-700',
  sucres: 'bg-pink-100 text-pink-700',
  lait: 'bg-sky-100 text-sky-700',
  cremes: 'bg-amber-50 text-amber-600',
  beurre: 'bg-yellow-50 text-yellow-600',
  fromages: 'bg-orange-200 text-orange-800',
  produits_laitiers: 'bg-blue-100 text-blue-700',
  oeufs: 'bg-yellow-100 text-yellow-700',
  matieres_grasses: 'bg-orange-100 text-orange-700',
  chocolat: 'bg-stone-200 text-stone-700',
  fruits: 'bg-green-100 text-green-700',
  fruits_secs: 'bg-lime-100 text-lime-700',
  viandes: 'bg-red-200 text-red-800',
  poissons_fruits_de_mer: 'bg-teal-200 text-teal-800',
  legumes: 'bg-emerald-100 text-emerald-700',
  epices: 'bg-red-100 text-red-700',
  sel_vinaigre: 'bg-slate-100 text-slate-700',
  levures: 'bg-violet-100 text-violet-700',
  gelifiants: 'bg-cyan-100 text-cyan-700',
  colorants: 'bg-fuchsia-100 text-fuchsia-700',
  decors: 'bg-purple-100 text-purple-700',
  sauces: 'bg-rose-100 text-rose-700',
  conserves: 'bg-teal-100 text-teal-700',
  preparations: 'bg-indigo-100 text-indigo-700',
  pates_riz: 'bg-yellow-200 text-yellow-800',
  emballages: 'bg-gray-100 text-gray-600',
  autre: 'bg-gray-100 text-gray-500',
};


interface Lot {
  id: string;
  lot_number: string;
  supplier_lot_number: string | null;
  ingredient_name: string;
  ingredient_unit: string;
  ingredient_category: string;
  supplier_name: string | null;
  quantity_received: string;
  quantity_remaining: string;
  economat_quantity?: string;
  pesage_quantity?: string;
  unit_cost: string | null;
  expiration_date: string | null;
  manufactured_date: string | null;
  received_at: string;
  status: string;
  expiration_status: string;
  reception_voucher_number?: string;
  purchase_order_number?: string;
  // Emplacement physique courant (épic labo L1, mig 424/425).
  location_id?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  // Réception bloquante + DLC/DLUO + allergènes (épic labo L5, mig 428).
  date_kind?: 'dlc' | 'dluo' | null;
  ingredient_allergens?: string[] | null;
}

interface Transaction {
  id: string;
  ingredient_name: string;
  ingredient_unit: string;
  type: string;
  quantity_change: string;
  note: string | null;
  performed_by_name: string;
  performed_by_first: string | null;
  performed_by_last: string | null;
  performed_by_role: string | null;
  created_at: string;
}

interface LotTraceability {
  id: string;
  production_plan_id: string;
  quantity_used: string;
  plan_date: string;
  plan_status: string;
  plan_type: string;
  ingredient_name: string;
  created_by_name: string;
}

export default function IngredientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'lots' | 'suppliers' | 'history' | 'nutrition'>('lots');
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [convertCategoryId, setConvertCategoryId] = useState('');
  const [showOrderRequest, setShowOrderRequest] = useState(false);
  // Ouvrir un contenant (scelle -> entame) hors bon : magasinier, admin, gerant.
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  // Fiche, ajustement, conversion, suppression, quarantaine, dechet : admin/gerant
  // (memes groupes que les routes serveur ADMIN_MANAGER ; avant, les boutons etaient
  // affiches a tous et echouaient en 403).
  const canManage = ['admin', 'manager'].includes(user?.role || '');
  // Modale unique de mouvement de lot (ouvrir / retour / perte / lot aux pertes).
  const [movement, setMovement] = useState<{ lot: Lot; type: 'open' | 'losses' } | null>(null);
  // Étiquette de lot (épic labo L5, mig 428).
  const [labelLot, setLabelLot] = useState<Lot | null>(null);

  // Fetch inventory list and find this ingredient
  const { data: inventory = [] } = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });
  const item = (inventory as InventoryItem[]).find(i => i.ingredient_id === id) || null;

  // Fetch ingredient details
  const { data: ingredient } = useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => ingredientsApi.getById(id!),
    enabled: !!id,
  });

  // Fetch lots for this ingredient
  const { data: lotsData } = useQuery({
    queryKey: ['ingredient-lots', id],
    queryFn: () => ingredientLotsApi.list({ ingredientId: id! }),
    enabled: !!id,
  });
  const lots = (lotsData?.data || []) as Lot[];

  // Fetch transactions for this ingredient
  const { data: transactions = [] } = useQuery({
    queryKey: ['inventory-transactions', id],
    queryFn: () => inventoryApi.transactions(id),
    enabled: !!id,
  });

  // Forward traceability for expanded lot
  const { data: lotTraceability = [] } = useQuery({
    queryKey: ['lot-traceability', expandedLot],
    queryFn: () => ingredientLotsApi.traceability(expandedLot!),
    enabled: !!expandedLot,
  });

  // Mutations
  const updateIngredientMutation = useMutation({
    mutationFn: (data: Record<string, any>) => ingredientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      // Changement de unit_cost : cascade côté serveur via v_recipe_total_cost +
      // syncProductPrice. Invalider aussi le cache recettes / produits pour
      // que les coûts affichés reflètent immédiatement la nouvelle valeur.
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowEdit(false);
      notify.success('Ingrédient mis à jour');
    },
  });

  const updateThresholdMutation = useMutation({
    mutationFn: (threshold: number) => inventoryApi.updateThreshold({ ingredientId: id!, threshold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('Seuil mis à jour');
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (data: { quantity: number; type: string; note?: string; reasonCode?: string }) =>
      inventoryApi.adjust({ ingredientId: id!, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions', id] });
      setShowAdjust(false);
      notify.success('Stock ajusté');
    },
  });

  const deleteIngredientMutation = useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) => ingredientsApi.remove(id!, { force }),
    onSuccess: (resp: unknown) => {
      const wasted = (resp as { data?: { data?: { wastedQty?: number } } })?.data?.data?.wastedQty || 0;
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success(
        wasted > 0
          ? `Ingrédient supprimé (${wasted.toFixed(2)} unité(s) jetée(s))`
          : 'Ingrédient supprimé'
      );
      setShowDelete(false);
      navigate('/stock');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Suppression impossible');
    },
  });

  const convertMutation = useMutation({
    mutationFn: () => ingredientsApi.convertToConsumable(id!, convertCategoryId),
    onSuccess: (data: unknown) => {
      const transferred = (data as { transferredQty?: number })?.transferredQty || 0;
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-items'] });
      notify.success(
        transferred > 0
          ? `Déplacé vers Consommables (${transferred.toFixed(2)} ${unit} transféré(s))`
          : 'Déplacé vers Consommables'
      );
      setShowConvert(false);
      navigate('/stock?tab=consumables');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Conversion impossible');
    },
  });

  const quarantineMutation = useMutation({
    mutationFn: (lotId: string) => ingredientLotsApi.quarantine(lotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('Lot mis en quarantaine');
    },
  });

  // Emplacements (épic labo L1) : liste pour le déplacement physique d'un lot.
  const { data: locations = [] } = useQuery<StockLocation[]>({
    queryKey: ['stock-locations'],
    queryFn: () => stockLocationsApi.list(),
  });
  const moveLocationMutation = useMutation({
    mutationFn: ({ lotId, toLocationId }: { lotId: string; toLocationId: string }) =>
      ingredientLotsApi.moveLocation(lotId, toLocationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      notify.success('Lot déplacé.');
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Échec du déplacement.')),
  });
  const onMoveLot = canManage || isMagasinier
    ? (lotId: string, toLocationId: string) => moveLocationMutation.mutate({ lotId, toLocationId })
    : undefined;

  const addToWaitingListMutation = useMutation({
    mutationFn: (data: { quantity: number; reason?: string; note?: string; supplierId?: string | null }) =>
      purchaseRequestsApi.create({
        ingredientId: id!,
        supplierId: data.supplierId || null,
        quantity: data.quantity,
        unit: unit || 'kg',
        reason: data.reason,
        note: data.note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      setShowOrderRequest(false);
      notify.success('Demande d\'achat créée : visible dans Stock › À commander');
    },
  });

  // IMPORTANT : tous les hooks doivent etre appeles AVANT le moindre return
  // conditionnel. useStockCategories etait appele plus bas, apres le early-return
  // "Ingredient introuvable" : au chargement direct de la page (cache vide), le
  // 1er rendu prenait l'early-return (sans ce hook) puis le 2e rendu, data chargee,
  // l'appelait => "Rendered more hooks than during the previous render" => page
  // blanche. En navigation SPA le cache ['inventory'] evitait l'early-return, d'ou
  // le bug invisible en navigation mais fatal en rechargement direct.
  const { resolve: resolveCategory, tagClass: categoryTagClass } = useStockCategories();

  if (!item && !ingredient) {
    return (
      <div className="prj sal-page">
        <EmptyState icon={Package} title="Ingrédient introuvable" text="Il a peut-être été supprimé ou converti en consommable."
          action={<button type="button" onClick={() => navigate('/stock')} className="odoo-btn-secondary">Retour au stock</button>} />
      </div>
    );
  }

  const qty = parseFloat(item?.current_quantity || '0');
  const threshold = parseFloat(item?.minimum_threshold || '0');
  const isLow = threshold > 0 && qty <= threshold;
  const isOut = qty <= 0;
  const unitCost = parseFloat(item?.unit_cost || ingredient?.unit_cost || '0');
  const lotsCount = parseInt(item?.active_lots_count || '0') || 0;
  const scelleQty = parseFloat(item?.economat_quantity || '0');
  const entameQty = parseFloat(item?.pesage_quantity || '0');
  const expiredCount = parseInt(item?.expired_lots_count || '0') || 0;
  const expiringSoonCount = parseInt(item?.expiring_soon_count || '0') || 0;
  const ingredientName = item?.ingredient_name || ingredient?.name || '';
  const categoryId = (item?.category_id || ingredient?.category_id || null) as string | null;
  const unit = item?.unit || ingredient?.unit || '';
  const supplier = item?.supplier || ingredient?.supplier || '';

  const activeLots = lots.filter(l => l.status === 'active' && parseFloat(l.quantity_remaining) > 0);
  const depletedLots = lots.filter(l => l.status === 'depleted' || parseFloat(l.quantity_remaining) <= 0);
  const quarantinedLots = lots.filter(l => l.status === 'quarantine');
  // Lots bloqués par un contrôle réception non conforme (épic labo L5, mig 428).
  const blockedLots = lots.filter(l => l.status === 'blocked');

  return (
    <div className="odoo-scope">
      {/* ══════ BARRE : retour + fil d'Ariane (design Ventes, 2026-11-18) ══════ */}
      <div className="odoo-control-bar">
        <Breadcrumb items={[
          { label: 'Stock', onClick: () => navigate('/stock') },
          { label: 'Réserve', onClick: () => navigate('/stock') },
          { label: ingredientName || '—' },
        ]} />
        <div style={{ flex: 1 }} />
        {canManage && (
          <button type="button" onClick={() => setShowEdit(true)} className="odoo-btn-secondary">
            <Edit3 size={14} aria-hidden="true" /> Modifier
          </button>
        )}
        {canManage && (
          <button type="button" onClick={() => setShowAdjust(true)} className="odoo-btn-secondary">
            <TrendingDown size={14} aria-hidden="true" /> Ajuster le stock
          </button>
        )}
        <button type="button" onClick={() => setShowOrderRequest(true)} className="odoo-btn-primary">
          <ShoppingCart size={14} aria-hidden="true" /> Commander
        </button>
        {canManage && (
          <RowMenu label="Autres actions" items={[
            { label: 'Convertir en consommable', icon: Boxes, onSelect: () => { setConvertCategoryId(''); setShowConvert(true); } },
            { label: 'Supprimer l\'ingrédient', icon: Trash2, danger: true, onSelect: () => setShowDelete(true) },
          ]} />
        )}
      </div>

      <ModulePage>
      {/* ══════ EN-TÊTE DE FICHE : nom, catégorie, fournisseur, actions ══════ */}
      <section className="prj-panel prj-hero">
        <div className="prj-hero-top">
          <span className="prj-hero-icon"><Warehouse size={22} /></span>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1>{ingredientName}</h1>
              {isLow && <StatusTag tone="todo" label="Stock bas" />}
              {expiredCount > 0 && <StatusTag tone="late" label="Lot expiré" />}
            </div>
            <div className="prj-hero-meta">
              <span className={`odoo-tag ${categoryTagClass(categoryId)}`}>
                {resolveCategory(categoryId)?.typeName || 'Non classé'}
              </span>
              {supplier && <span>{supplier}</span>}
              <span>Unité : {unit || '—'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════ ALERTES ══════ */}
      {isLow && (
        <StatusBanner tone="warning" icon={AlertTriangle} title="Stock bas"
          actions={<button type="button" onClick={() => setShowOrderRequest(true)} className="odoo-btn-secondary"><ShoppingCart size={12} aria-hidden="true" /> Commander</button>}>
          {qty.toFixed(1)} {unit} restant(s), seuil minimum {threshold.toFixed(0)} {unit}
        </StatusBanner>
      )}
      {expiredCount > 0 && (
        <StatusBanner tone="danger" icon={CalendarClock} title={`${expiredCount} lot(s) expiré(s)`}>
          Des lots actifs ont dépassé leur date limite de consommation.
        </StatusBanner>
      )}

      {/* ══════ CHIFFRES CLÉS (clic = onglet Lots ou modification) ══════ */}
      <KpiGrid label="Chiffres clés">
        <KpiCard label={`Stock total (${unit})`} value={qty.toFixed(qty % 1 === 0 ? 0 : 1)}
          sub={isOut ? 'En rupture' : isLow ? 'Sous le seuil' : 'Réserve et poste de pesée'} tone={isOut ? 'red' : isLow ? 'orange' : undefined}
          onClick={() => setActiveTab('lots')} />
        <KpiCard label={`En réserve (${unit})`} value={fmtQty(scelleQty)} sub="Contenants intacts" onClick={() => setActiveTab('lots')} />
        <KpiCard label={`Au pesage (${unit})`} value={fmtQty(entameQty)} sub="Contenants ouverts" onClick={() => setActiveTab('lots')} />
        <KpiCard label={`Seuil minimum (${unit})`} value={threshold.toFixed(0)} onClick={canManage ? () => setShowEdit(true) : undefined} />
        <KpiCard label="Lots actifs" value={String(lotsCount)} onClick={() => setActiveTab('lots')} />
        <KpiCard label={`Coût unitaire (${currencySymbol()} / ${unit})`} value={unitCost.toFixed(2)} />
      </KpiGrid>

      {/* ══════ ONGLETS (contrôle segmenté) ══════ */}
      <SubViews label="Contenu de la fiche" value={activeTab} onChange={setActiveTab} views={[
        { key: 'lots', label: 'Lots et traçabilité', icon: ShieldCheck },
        { key: 'suppliers', label: 'Fournisseurs', icon: Truck },
        { key: 'history', label: 'Historique', icon: Clock },
        { key: 'nutrition', label: 'Valeurs nutritionnelles', icon: ShieldCheck },
      ]} />

      {/* ══════ VALEURS NUTRITIONNELLES (mig 634, étape 10c) ══════ */}
      {activeTab === 'nutrition' && id && <IngredientNutritionCard ingredientId={id} />}

      {/* ══════ FOURNISSEURS TAB (mig 404 — Achats lot prix P1) ══════ */}
      {activeTab === 'suppliers' && id && (
        <div className="odoo-section" style={{ padding: '0.75rem 1rem' }}>
          <SupplierItemsSection kind="ingredient" purchasableId={id} unit={unit} />
        </div>
      )}

      {/* ══════ LOTS TAB ══════ */}
      {activeTab === 'lots' && (
        <div className="stk-stack">
          {activeLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header">
                <Boxes size={14} style={{ color: 'var(--ds-success)' }} /> Lots actifs ({activeLots.length})
              </div>
              {activeLots.map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onQuarantine={canManage ? () => quarantineMutation.mutate(lot.id) : undefined}
                    onWaste={canManage ? () => setMovement({ lot, type: 'losses' }) : undefined}
                    onOpenContainer={isMagasinier ? () => setMovement({ lot, type: 'open' }) : undefined}
                    locations={locations}
                    onMove={onMoveLot}
                    onLabel={() => setLabelLot(lot)}
                  />
                </div>
              ))}
            </div>
          )}

          {blockedLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header">
                <Ban size={14} style={{ color: 'var(--ds-danger)' }} /> Bloqués — contrôle réception non conforme ({blockedLots.length})
              </div>
              {blockedLots.map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onLabel={() => setLabelLot(lot)}
                  />
                </div>
              ))}
            </div>
          )}

          {quarantinedLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header">
                <Shield size={14} style={{ color: 'var(--ds-warning)' }} /> Quarantaine ({quarantinedLots.length})
              </div>
              {quarantinedLots.map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onWaste={canManage ? () => setMovement({ lot, type: 'losses' }) : undefined}
                  />
                </div>
              ))}
            </div>
          )}

          {depletedLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header">
                <Package size={12} /> Lots épuisés ({depletedLots.length})
              </div>
              {depletedLots.slice(0, 10).map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                  />
                </div>
              ))}
              {depletedLots.length > 10 && (
                <div style={{ padding: '0.5rem', fontSize: '12px', color: 'var(--ds-muted)', textAlign: 'center', borderTop: '1px solid var(--ds-sep)' }}>
                  + {depletedLots.length - 10} lots épuisés supplémentaires
                </div>
              )}
            </div>
          )}

          {lots.length === 0 && (
            <EmptyState icon={Boxes} title="Aucun lot enregistré" text="Les lots sont créés automatiquement à la réception des bons de commande." />
          )}
        </div>
      )}

      {/* ══════ HISTORY TAB ══════ */}
      {activeTab === 'history' && (
        <div className="odoo-section">
          <div className="odoo-section-header">
            <Clock size={12} /> Historique des mouvements
          </div>
          {(transactions as Transaction[]).length === 0 ? (
            <EmptyState bare icon={Clock} title="Aucun mouvement enregistré" text="Réceptions, sorties, ajustements et pertes apparaîtront ici." />
          ) : (
            <div>
              {(transactions as Transaction[]).map((tx, i) => {
                const isPositive = parseFloat(tx.quantity_change) > 0;
                const initials = tx.performed_by_first
                  ? `${tx.performed_by_first[0]}${(tx.performed_by_last || '')[0] || ''}`.toUpperCase()
                  : 'SY';
                const roleLabel = tx.performed_by_role === 'admin' ? 'Admin' :
                  tx.performed_by_role === 'manager' ? 'Manager' :
                  tx.performed_by_role === 'baker' ? 'Boulanger' :
                  tx.performed_by_role === 'cashier' ? 'Caissier' : '';
                return (
                  <div key={tx.id} style={{
                    padding: '0.5rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.625rem',
                    borderTop: i > 0 ? '1px solid var(--ds-sep)' : 'none', fontSize: '13px',
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: isPositive ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)', flexShrink: 0,
                    }}>
                      {tx.type === 'restock' ? <Package size={12} style={{ color: 'var(--ds-success)' }} /> :
                       tx.type === 'purchase_order' ? <Package size={12} style={{ color: 'var(--ds-success)' }} /> :
                       tx.type === 'production' ? <Factory size={12} style={{ color: 'var(--ds-info)' }} /> :
                       tx.type === 'adjustment' ? <TrendingDown size={12} style={{ color: 'var(--ds-warning)' }} /> :
                       tx.type === 'waste' ? <Ban size={12} style={{ color: 'var(--ds-danger)' }} /> :
                       tx.type === 'usage' ? <Beaker size={12} style={{ color: 'var(--ds-warning)' }} /> :
                       <Beaker size={12} style={{ color: 'var(--ds-muted)' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--ds-ink)' }}>
                        {tx.type === 'restock' ? 'Réapprovisionnement' :
                         tx.type === 'purchase_order' ? 'Bon de commande' :
                         tx.type === 'production' ? 'Production' :
                         tx.type === 'adjustment' ? 'Ajustement' :
                         tx.type === 'waste' ? 'Perte' :
                         tx.type === 'usage' ? 'Utilisation' : tx.type}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: 1, fontSize: '12px', color: 'var(--ds-muted)' }}>
                        <span className="odoo-tag odoo-tag-purple" style={{ fontSize: '11px' }}>
                          <span style={{
                            width: 12, height: 12, borderRadius: '50%', backgroundColor: 'var(--ds-tint)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700,
                          }}>{initials}</span>
                          {tx.performed_by_name || 'Système'}
                        </span>
                        {roleLabel && <span className="odoo-tag odoo-tag-grey" style={{ fontSize: '11px' }}>{roleLabel}</span>}
                        <span>{format(new Date(tx.created_at), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                      {tx.note && <div style={{ fontSize: '12px', color: 'var(--ds-muted)', fontStyle: 'italic', marginTop: 2 }}>{tx.note}</div>}
                    </div>
                    <span style={{ fontWeight: 600, color: isPositive ? 'var(--ds-success)' : 'var(--ds-danger)', flexShrink: 0 }}>
                      {isPositive ? '+' : ''}{parseFloat(tx.quantity_change).toFixed(1)} {unit}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      </ModulePage>

      {/* ══════ MODALS ══════ */}
      {showEdit && ingredient && (
        <IngredientFormModal
          mode="edit"
          ingredient={ingredient}
          threshold={threshold}
          onClose={() => setShowEdit(false)}
          onSave={(data) => {
            if (data.threshold !== undefined) {
              updateThresholdMutation.mutate(data.threshold as number);
            }
            const { threshold: _t, ...ingredientData } = data;
            if (Object.keys(ingredientData).length > 0) {
              updateIngredientMutation.mutate(ingredientData);
            } else {
              setShowEdit(false);
            }
          }}
          isLoading={updateIngredientMutation.isPending || updateThresholdMutation.isPending}
        />
      )}

      {showAdjust && (
        <AdjustStockModal
          ingredientName={ingredientName}
          unit={unit}
          onClose={() => setShowAdjust(false)}
          onSave={(data) => adjustMutation.mutate(data)}
          isLoading={adjustMutation.isPending}
        />
      )}

      {showDelete && (
        <Modal title="Supprimer l'ingrédient" subtitle={ingredientName} onClose={() => setShowDelete(false)} locked={deleteIngredientMutation.isPending} width={480}
          footer={
            <div className="ds-form-foot">
              <span className="ds-grow" />
              <button type="button" onClick={() => setShowDelete(false)} className="odoo-btn-secondary" disabled={deleteIngredientMutation.isPending}>Annuler</button>
              {qty > 0 ? (
                <button type="button" onClick={() => deleteIngredientMutation.mutate({ force: true })} disabled={deleteIngredientMutation.isPending}
                  className="ds-btn-danger solid" title="Jette le stock restant et supprime l'ingrédient">
                  <Trash2 size={13} /> {deleteIngredientMutation.isPending ? 'Suppression…' : 'Forcer la suppression'}
                </button>
              ) : (
                <button type="button" onClick={() => deleteIngredientMutation.mutate({})} disabled={deleteIngredientMutation.isPending} className="ds-btn-danger solid">
                  <Trash2 size={13} /> {deleteIngredientMutation.isPending ? 'Suppression…' : 'Supprimer'}
                </button>
              )}
            </div>
          }>
          <p style={{ fontSize: '13px', color: 'var(--ds-ink)', marginBottom: '0.75rem' }}>
            Voulez-vous vraiment supprimer <strong>{ingredientName}</strong> ? Cette action est irréversible et supprimera toutes les données associées.
          </p>
          {qty > 0 && (
            <Alert tone="warning">
              <strong>Stock actif : {qty.toFixed(2)} {unit}.</strong>{' '}
              Utilisez « Forcer la suppression » pour jeter le stock et supprimer quand même.
            </Alert>
          )}
        </Modal>
      )}

      {showConvert && (
        <Modal title="Convertir en consommable" subtitle={ingredientName} onClose={() => setShowConvert(false)} locked={convertMutation.isPending} width={480}
          footer={<FormFooter onCancel={() => setShowConvert(false)} submitLabel={convertMutation.isPending ? 'Conversion…' : 'Convertir'} busy={convertMutation.isPending} disabled={!convertCategoryId}
            onSubmit={() => { if (!convertCategoryId) { notify.error('Choisissez une catégorie'); return; } convertMutation.mutate(); }} />}>
          <p style={{ fontSize: '13px', color: 'var(--ds-ink)', marginBottom: '0.75rem' }}>
            <strong>{ingredientName}</strong> sera déplacé vers l'onglet <strong>Consommables</strong> avec la catégorie choisie.
            {qty > 0 && <> Son stock (<strong>{qty.toFixed(2)} {unit}</strong>) est transféré.</>} La ligne ingrédient est ensuite supprimée.
            {' '}Bloqué si l'article est utilisé dans une recette.
          </p>
          <FormSection title="Consommable">
            <FormField label="Catégorie du consommable" required>
              <CategoryCascadeSelector
                value={convertCategoryId}
                onChange={setConvertCategoryId}
                rootIds={CONSUMABLE_ROOT_IDS}
                type="expense"
                required
              />
            </FormField>
          </FormSection>
        </Modal>
      )}

      {showOrderRequest && (
        <OrderRequestModal
          ingredientName={ingredientName}
          unit={unit}
          container={containerOf(ingredient)}
          isLow={isLow}
          supplierHint={supplier}
          onClose={() => setShowOrderRequest(false)}
          onSave={(data) => addToWaitingListMutation.mutate(data)}
          isLoading={addToWaitingListMutation.isPending}
        />
      )}

      {movement && (
        <LotMovementModal
          lot={{
            id: movement.lot.id,
            lot_number: movement.lot.supplier_lot_number || movement.lot.lot_number,
            ingredient_name: movement.lot.ingredient_name,
            unit: movement.lot.ingredient_unit,
            economat_quantity: parseFloat(movement.lot.economat_quantity || '0'),
            pesage_quantity: parseFloat(movement.lot.pesage_quantity || '0'),
            unit_cost: movement.lot.unit_cost != null ? parseFloat(movement.lot.unit_cost) : null,
            is_expired: movement.lot.expiration_status === 'expired',
            container_size: containerOf(ingredient)?.size ?? null,
            container_type_label: containerOf(ingredient)?.label ?? null,
          }}
          initialType={movement.type}
          onClose={() => setMovement(null)}
        />
      )}

      {/* Étiquette de lot (épic labo L5) */}
      {labelLot && (
        <LotLabelModal lot={labelLot} ingredientName={labelLot.ingredient_name} onClose={() => setLabelLot(null)} />
      )}
    </div>
  );
}

/* ─── Étiquette de lot (épic labo L5, mig 428) : lot, DLC/DLUO, allergènes ─── */
function LotLabelModal({ lot, ingredientName, onClose }: { lot: Lot; ingredientName: string; onClose: () => void }) {
  const isDluo = lot.date_kind === 'dluo';
  const dateStr = lot.expiration_date ? new Date(lot.expiration_date).toLocaleDateString('fr-FR') : '—';
  const allergens = (lot.ingredient_allergens || []).filter(Boolean);
  return (
    <Modal title="Étiquette de lot" onClose={onClose} width={384}
      footer={
        <>
          <button type="button" onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          <button type="button" onClick={() => window.print()} className="odoo-btn-primary"><Printer size={14} /> Imprimer</button>
        </>
      }>
        {/* Zone imprimable */}
        <div id="lot-label-print">
          <div style={{ border: '2px solid var(--ds-ink)', borderRadius: 8, padding: '0.875rem 1rem' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--ds-ink)' }}>{ingredientName}</div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem', marginTop: 4 }}>
              Lot : {lot.supplier_lot_number || lot.lot_number}
            </div>
            <div style={{ marginTop: 6, fontSize: '0.95rem' }}>
              <span style={{ fontWeight: 700, background: isDluo ? 'var(--ds-info-bg)' : 'var(--ds-danger-bg)', padding: '1px 6px', borderRadius: 4 }}>
                {isDluo ? 'DLUO' : 'DLC'}
              </span>{' '}
              <span style={{ fontWeight: 700 }}>{dateStr}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.68rem', color: 'var(--ds-body)' }}>Allergènes</div>
              {allergens.length > 0 ? (
                <div style={{ fontWeight: 600 }}>{allergens.join(' · ')}</div>
              ) : (
                <div style={{ color: 'var(--ds-muted)' }}>Aucun déclaré</div>
              )}
            </div>
          </div>
        </div>
    </Modal>
  );
}

/* ─── Open Container Modal : magasinier transfere qty Economat -> Pesage ─── */
/* ─── Order Request Modal (add to waiting list) ─── */
function OrderRequestModal({ ingredientName, unit, container, isLow, supplierHint, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
  /** Regle « contenant entier » : commande en nombre de contenants, 1 par defaut. */
  container: ContainerDef | null;
  isLow: boolean;
  supplierHint?: string;
  onClose: () => void;
  onSave: (data: { quantity: number; reason?: string; note?: string; supplierId?: string | null }) => void;
  isLoading: boolean;
}) {
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  // Try to auto-match supplier by name
  const matchedSupplier = supplierHint
    ? (suppliers as Record<string, any>[]).find(s => (s.name as string)?.toLowerCase() === supplierHint.toLowerCase())
    : null;

  const [form, setForm] = useState({
    // Un contenant complet par defaut (minimum de commande) quand l'ingredient en a un.
    quantity: container ? String(container.size) : '',
    reason: isLow ? 'stock_bas' : 'manual',
    note: '',
    supplierId: '',
  });
  const [containerCount, setContainerCount] = useState('1');

  // Set matched supplier once loaded
  const [didAutoMatch, setDidAutoMatch] = useState(false);
  if (matchedSupplier && !didAutoMatch && !form.supplierId) {
    setForm(f => ({ ...f, supplierId: matchedSupplier.id as string }));
    setDidAutoMatch(true);
  }

  const formRef = useRef<HTMLFormElement>(null);
  return (
    <Modal title="Demande d'achat" subtitle={ingredientName} onClose={onClose} locked={isLoading} width={460}
      footer={<FormFooter onCancel={onClose} submitLabel={isLoading ? 'Ajout…' : 'Ajouter à la liste'} busy={isLoading} onSubmit={() => formRef.current?.requestSubmit()} />}>
      <form ref={formRef} onSubmit={(e) => {
        e.preventDefault();
        const qty = parseFloat(form.quantity);
        if (isNaN(qty) || qty <= 0) return;
        onSave({ quantity: qty, reason: form.reason, note: form.note || undefined, supplierId: form.supplierId || null });
      }} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <Alert tone="info">
          La demande apparaîtra dans Stock › À commander, où le gérant crée directement le bon de commande auprès du fournisseur.
        </Alert>
        <FormSection title="Demande">
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Fournisseur">
              <SearchSelect value={form.supplierId} onChange={v => setForm({ ...form, supplierId: v })}
                placeholder="— Aucun fournisseur —" width="100%" size="md" ariaLabel="Fournisseur"
                options={(suppliers as Record<string, any>[]).filter(s => s.is_active !== false).map(s => ({ id: s.id as string, label: s.name as string }))} />
            </FormField>
            {container ? (
              <FormField label="Nombre de contenants à commander" htmlFor="order-req-count" required>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input id="order-req-count" type="number" step="1" min="1" className="ds-input" style={{ width: 96 }} value={containerCount}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      const c = Math.max(1, parseInt(raw || '1', 10));
                      setContainerCount(raw);
                      setForm({ ...form, quantity: String(c * container.size) });
                    }}
                    required autoFocus />
                  <span style={{ fontSize: '13px', color: 'var(--ds-muted)' }}>
                    × {containerLabel(container, unit)} = <strong style={{ color: 'var(--ds-ink)' }}>{form.quantity || container.size} {unit}</strong>
                  </span>
                </div>
              </FormField>
            ) : (
              <FormField label={`Quantité à commander (${unit})`} htmlFor="order-req-qty" required
                hint="Aucun contenant défini sur la fiche (Modifier → type et quantité par contenant) : la commande minimum d'un contenant ne peut pas être proposée.">
                <input id="order-req-qty" type="number" step="0.1" min="0.1" className="ds-input" value={form.quantity}
                  onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
              </FormField>
            )}
            <FormField label="Motif" htmlFor="order-req-reason">
              <select id="order-req-reason" className="ds-input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
                <option value="stock_bas">Stock bas</option>
                <option value="production">Besoin production</option>
                <option value="manual">Demande manuelle</option>
                <option value="replenishment">Approvisionnement</option>
              </select>
            </FormField>
            <FormField label="Note (optionnel)" htmlFor="order-req-note">
              <input id="order-req-note" className="ds-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
                placeholder="Contexte de la demande..." />
            </FormField>
          </div>
        </FormSection>
      </form>
    </Modal>
  );
}

/* ─── Lot Row Component ─── */
function LotRow({ lot, isExpanded, onToggle, traceability, onQuarantine, onWaste, onOpenContainer, locations, onMove, onLabel }: {
  lot: Lot;
  isExpanded: boolean;
  onToggle: () => void;
  traceability: LotTraceability[];
  onQuarantine?: () => void;
  onWaste?: () => void;
  onOpenContainer?: () => void;
  locations?: StockLocation[];
  onMove?: (lotId: string, toLocationId: string) => void;
  onLabel?: () => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const remaining = parseFloat(lot.quantity_remaining);
  const received = parseFloat(lot.quantity_received);
  const economat = parseFloat(lot.economat_quantity || '0');
  const pesage = parseFloat(lot.pesage_quantity || '0');
  const pct = received > 0 ? Math.round((remaining / received) * 100) : 0;
  const isExpired = lot.expiration_date ? new Date(lot.expiration_date) < new Date() : false;
  const daysUntil = lot.expiration_date
    ? Math.ceil((new Date(lot.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const dotClass = lot.status === 'quarantine' ? 'warning' :
    lot.status === 'waste' ? 'neutral' :
    remaining <= 0 ? 'neutral' :
    isExpired ? 'danger' :
    daysUntil !== null && daysUntil <= 7 ? 'warning' : 'ok';
  // La pastille ne porte jamais seule l'état : libellé lu au survol et par les lecteurs d'écran.
  const dotLabel = lot.status === 'quarantine' ? 'En quarantaine' :
    lot.status === 'waste' ? 'Mis au rebut' :
    remaining <= 0 ? 'Épuisé' :
    isExpired ? 'Expiré' :
    daysUntil !== null && daysUntil <= 7 ? 'DLC proche' : 'Utilisable';

  return (
    <div>
      <div onClick={onToggle}
        style={{
          padding: '0.5rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.625rem',
          cursor: 'pointer', backgroundColor: 'var(--ds-card)', fontSize: '13px',
        }}>
        <span className={`odoo-status-dot ${dotClass}`} role="img" title={dotLabel} aria-label={dotLabel} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ds-ink)' }}>
              {lot.supplier_lot_number || lot.lot_number || '—'}
            </span>
            {lot.status === 'quarantine' && <StatusTag tone="blocked" label="QUARANTAINE" />}
            {lot.status === 'blocked' && <StatusTag tone="blocked" label="BLOQUÉ" />}
            <span className="odoo-tag" title={lot.date_kind === 'dluo' ? 'Date de durabilité minimale (sec)' : 'Date limite de consommation (périssable)'}>
              {lot.date_kind === 'dluo' ? 'DLUO' : 'DLC'}
            </span>
            {isExpired && lot.status === 'active' && <StatusTag tone="late" label="EXPIRÉ" />}
            {!isExpired && daysUntil !== null && daysUntil <= 7 && lot.status === 'active' && (
              <StatusTag tone="todo" label={`${daysUntil}j`} title={`DLC dans ${daysUntil} jour(s)`} />
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '12px', color: 'var(--ds-muted)', marginTop: 2 }}>
            {lot.supplier_name && <span>{lot.supplier_name}</span>}
            {lot.location_code && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} title={lot.location_name || undefined}>
                <MapPin size={10} style={{ color: 'var(--ds-info)' }} /> {lot.location_code}
              </span>
            )}
            {lot.unit_cost && parseFloat(lot.unit_cost) > 0 && (
              <span style={{ fontWeight: 500 }}>
                {money(parseFloat(lot.unit_cost))}/{lot.ingredient_unit}
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--ds-ink)' }}>
            {remaining.toFixed(1)} / {received.toFixed(1)} {lot.ingredient_unit}
          </div>
          {lot.unit_cost && parseFloat(lot.unit_cost) > 0 && remaining > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--ds-muted)', marginTop: 2 }}>
              Valeur : {money(remaining * parseFloat(lot.unit_cost))}
            </div>
          )}
          <div style={{ width: 64, height: 4, backgroundColor: 'var(--ds-hair)', borderRadius: 2, overflow: 'hidden', marginTop: 4, marginLeft: 'auto' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              backgroundColor: pct > 50 ? 'var(--ds-success)' : pct > 20 ? 'var(--ds-warning)' : 'var(--ds-danger)',
            }} />
          </div>
        </div>

        <div style={{ flexShrink: 0, color: 'var(--ds-muted)' }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0.5rem 0.875rem 0.875rem', backgroundColor: 'var(--ds-bg)', borderTop: '1px solid var(--ds-sep)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {/* Supply chain */}
            <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: 'var(--ds-card)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ds-accent)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheck size={11} /> Chaîne d'approvisionnement
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {lot.purchase_order_number && (
                  <>
                    <span className="odoo-tag odoo-tag-purple"><FileText size={9} /> BC : {lot.purchase_order_number}</span>
                    <ChevronRight size={10} style={{ color: 'var(--ds-sep)' }} />
                  </>
                )}
                {lot.reception_voucher_number && (
                  <>
                    <span className="odoo-tag odoo-tag-purple"><Truck size={9} /> BR : {lot.reception_voucher_number}</span>
                    <ChevronRight size={10} style={{ color: 'var(--ds-sep)' }} />
                  </>
                )}
                <span className="odoo-tag odoo-tag-purple"><Hash size={9} /> Lot : {lot.supplier_lot_number || lot.lot_number || '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: 6, fontSize: '12px', color: 'var(--ds-muted)' }}>
                {lot.expiration_date && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: isExpired ? 'var(--ds-danger)' : 'var(--ds-muted)', fontWeight: isExpired ? 600 : 400 }}>
                    <CalendarClock size={10} /> DLC : {format(new Date(lot.expiration_date), 'dd/MM/yyyy')}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Clock size={10} /> Reçu : {format(new Date(lot.received_at), 'dd/MM/yyyy')}
                </span>
                {lot.manufactured_date && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Factory size={10} /> Fabriqué : {format(new Date(lot.manufactured_date), 'dd/MM/yyyy')}
                  </span>
                )}
              </div>
            </div>

            {/* Forward traceability */}
            {traceability.length > 0 && (
              <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: 'var(--ds-card)' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ds-info)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Factory size={11} /> Productions utilisant ce lot ({traceability.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {traceability.map((t) => (
                    <div key={t.id}
                      onClick={(e) => { e.stopPropagation(); window.location.href = `/production/${t.production_plan_id}`; }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.25rem 0.5rem', borderRadius: 3, border: '1px solid var(--ds-sep)',
                        cursor: 'pointer', fontSize: '12px',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Factory size={11} style={{ color: 'var(--ds-info)' }} />
                        <span style={{ fontWeight: 500 }}>
                          {format(new Date(t.plan_date), 'dd/MM/yyyy')} — {t.plan_type === 'morning' ? 'Matin' : t.plan_type === 'afternoon' ? 'Après-midi' : t.plan_type}
                        </span>
                        <StatusTag tone={planStatusTag(t.plan_status).tone} icon={planStatusTag(t.plan_status).icon}
                          label={t.plan_status === 'completed' ? 'Terminé' : t.plan_status === 'in_progress' ? 'En cours' : t.plan_status} />
                      </div>
                      <span style={{ fontWeight: 600, color: 'var(--ds-info)' }}>
                        {parseFloat(t.quantity_used).toFixed(1)} {lot.ingredient_unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {traceability.length === 0 && (
              <div style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontSize: '12px', color: 'var(--ds-muted)', backgroundColor: 'var(--ds-card)', border: '1px solid var(--ds-sep)', borderRadius: 3 }}>
                Aucune production liée à ce lot
              </div>
            )}

            {/* Repartition Economat / Pesage */}
            {(economat > 0 || pesage > 0) && (
              <div style={{ border: '1px solid var(--ds-sep)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: 'var(--ds-card)' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ds-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Package size={11} /> Répartition par zone
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1, border: '1px solid var(--ds-warning-bg)', borderRadius: 3, padding: '0.375rem 0.5rem' }}>
                    <div style={{ fontSize: '11px', color: 'var(--ds-warning)', fontWeight: 600 }}>En réserve</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ds-warning)' }}>{economat.toFixed(2)} {lot.ingredient_unit}</div>
                  </div>
                  <div style={{ flex: 1, border: '1px solid var(--ds-success-bg)', borderRadius: 3, padding: '0.375rem 0.5rem' }}>
                    <div style={{ fontSize: '11px', color: 'var(--ds-success)', fontWeight: 600 }}>Au pesage</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--ds-success)' }}>{pesage.toFixed(2)} {lot.ingredient_unit}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Lot actions */}
            {(onQuarantine || onWaste || onOpenContainer) && lot.status === 'active' && remaining > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {onOpenContainer && economat > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); onOpenContainer(); }}
                    className="odoo-btn-secondary"
                    title="Passer une partie de ce lot de la réserve au poste de pesée">
                    <PackageOpen size={11} /> Ouvrir contenant
                  </button>
                )}
                {onQuarantine && (
                  <button onClick={(e) => { e.stopPropagation(); onQuarantine(); }} className="odoo-btn-secondary">
                    <Shield size={11} /> Quarantaine
                  </button>
                )}
                {onWaste && (
                  <button onClick={(e) => { e.stopPropagation(); onWaste(); }} className="ds-btn-danger">
                    <Ban size={11} /> Lot aux pertes
                  </button>
                )}
              </div>
            )}

            {/* Étiquette de lot (épic labo L5) : lot, DLC/DLUO, allergènes */}
            {onLabel && (
              <div style={{ marginTop: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                <button className="odoo-btn-secondary" onClick={onLabel}>
                  <FileText size={11} /> Étiquette
                </button>
              </div>
            )}

            {/* Déplacement physique vers un emplacement (épic labo L1) */}
            {onMove && locations && locations.length > 0 && lot.status === 'active' && remaining > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                <MapPin size={12} style={{ color: 'var(--ds-muted)' }} />
                <SearchSelect value={moveTo} onChange={setMoveTo}
                  placeholder="Déplacer vers…" width={200} ariaLabel="Déplacer vers un emplacement"
                  options={locations.filter(l => l.id !== lot.location_id).map(l => ({ id: l.id, label: `${l.code} — ${l.name}` }))} />
                <button className="odoo-btn-secondary" disabled={!moveTo}
                  onClick={() => { if (moveTo) { onMove(lot.id, moveTo); setMoveTo(''); } }}>
                  Déplacer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Adjust Stock Modal ─── */
function AdjustStockModal({ ingredientName, unit, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
  onClose: () => void;
  onSave: (data: { quantity: number; type: string; note?: string; reasonCode?: string }) => void;
  isLoading: boolean;
}) {
  const { entries: lossReasons } = useReferentiel('material_loss_reasons');
  // Valeurs alignees avec la contrainte DB inventory_transactions_type_check :
  // 'waste' = perte/casse (decremente), 'adjustment' = correction (decremente),
  // 'restock' = reapprovisionnement manuel (incremente).
  const [form, setForm] = useState({ quantity: '', type: 'waste', note: '', reasonCode: 'autre' });

  const formRef = useRef<HTMLFormElement>(null);
  return (
    <Modal title="Ajuster le stock" subtitle={ingredientName} onClose={onClose} locked={isLoading} width={420}
      footer={<FormFooter onCancel={onClose} submitLabel={isLoading ? 'Ajustement…' : 'Enregistrer l\'ajustement'} busy={isLoading} onSubmit={() => formRef.current?.requestSubmit()} />}>
      <form ref={formRef} onSubmit={(e) => {
        e.preventDefault();
        const qty = parseFloat(form.quantity);
        if (isNaN(qty) || qty <= 0) return;
        const signedQty = form.type === 'restock' ? qty : -qty;
        onSave({ quantity: signedQty, type: form.type, note: form.note || undefined, reasonCode: form.type === 'waste' ? form.reasonCode : undefined });
      }}>
        <FormSection title="Ajustement">
          <div style={{ display: 'grid', gap: 12 }}>
            <FormField label="Type d'ajustement" htmlFor="adjust-type">
              <select id="adjust-type" className="ds-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option value="waste">Perte / Casse</option>
                <option value="adjustment">Correction d'inventaire</option>
                <option value="restock">Réapprovisionnement manuel</option>
              </select>
            </FormField>
            <FormField label={`Quantité (${unit})`} htmlFor="adjust-qty" required>
              <input id="adjust-qty" type="number" step="0.1" min="0.1" className="ds-input" value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
            </FormField>
            {form.type === 'waste' && (
              <FormField label="Motif de la perte" htmlFor="adjust-reason">
                <select id="adjust-reason" className="ds-input" value={form.reasonCode} onChange={e => setForm({ ...form, reasonCode: e.target.value })}>
                  {lossReasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </FormField>
            )}
            <FormField label="Note (optionnel)" htmlFor="adjust-note">
              <input id="adjust-note" className="ds-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
                placeholder="Raison de l'ajustement..." />
            </FormField>
          </div>
        </FormSection>
      </form>
    </Modal>
  );
}
