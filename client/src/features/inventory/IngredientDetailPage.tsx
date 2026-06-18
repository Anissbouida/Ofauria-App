import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, ingredientsApi, ingredientLotsApi } from '../../api/inventory.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { suppliersApi } from '../../api/accounting.api';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Package, AlertTriangle, Boxes, ShieldCheck, CalendarClock,
  ChevronDown, ChevronRight, ChevronLeft, Factory, TrendingDown, Trash2, Edit3,
  X, Save, Truck, FileText, Clock, Beaker, Ban, Shield, Hash, ShoppingCart,
  Warehouse,
} from 'lucide-react';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';
import CategoryCascadeSelector from '../../components/CategoryCascadeSelector';
import { useStockCategories, STOCKABLE_ROOT_IDS } from './useStockCategories';

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

interface InventoryItem {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: string;
  minimum_threshold: string;
  unit: string;
  unit_cost: string;
  supplier: string;
  category: string;
  category_id: string | null;
  last_restocked_at: string | null;
  active_lots_count: string;
  nearest_dlc: string | null;
  expired_lots_count: string;
  expiring_soon_count: string;
  active_lot_numbers: string | null;
}

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
  const [activeTab, setActiveTab] = useState<'lots' | 'history'>('lots');
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showOrderRequest, setShowOrderRequest] = useState(false);
  // Magasinier seul peut ouvrir un contenant Economat → Pesage hors BSI.
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  const [openContainerLot, setOpenContainerLot] = useState<Lot | null>(null);

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
    mutationFn: (data: { quantity: number; type: string; note?: string }) =>
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
      navigate('/inventory');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Suppression impossible');
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

  const wasteMutation = useMutation({
    mutationFn: (lotId: string) => ingredientLotsApi.markAsWaste(lotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('Lot marqué comme déchet');
    },
  });

  // Ouverture manuelle d'un contenant : transfere qty Economat -> Pesage. Hors BSI,
  // utile pour pre-ouvrir un sac le matin ou reorganiser le stock entre zones.
  const openContainerMutation = useMutation({
    mutationFn: ({ lotId, quantity, note }: { lotId: string; quantity: number; note?: string }) =>
      ingredientLotsApi.openContainer(lotId, quantity, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredient-lots', id] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setOpenContainerLot(null);
      notify.success('Contenant ouvert — qty transferee Economat → Pesage');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Erreur ouverture contenant'),
  });

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
      notify.success('Ajouté à la liste d\'attente d\'achat');
    },
  });

  if (!item && !ingredient) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <Package size={48} className="mx-auto mb-3 opacity-30" />
          <p>Ingrédient introuvable</p>
          <button onClick={() => navigate('/inventory')} className="mt-3 text-violet-600 text-sm font-medium hover:underline">Retour à l'inventaire</button>
        </div>
      </div>
    );
  }

  const qty = parseFloat(item?.current_quantity || '0');
  const threshold = parseFloat(item?.minimum_threshold || '0');
  const isLow = threshold > 0 && qty <= threshold;
  const isOut = qty <= 0;
  const unitCost = parseFloat(item?.unit_cost || ingredient?.unit_cost || '0');
  const lotsCount = parseInt(item?.active_lots_count || '0') || 0;
  const expiredCount = parseInt(item?.expired_lots_count || '0') || 0;
  const expiringSoonCount = parseInt(item?.expiring_soon_count || '0') || 0;
  const ingredientName = item?.ingredient_name || ingredient?.name || '';
  const categoryId = (item?.category_id || ingredient?.category_id || null) as string | null;
  const { resolve: resolveCategory, tagClass: categoryTagClass } = useStockCategories();
  const unit = item?.unit || ingredient?.unit || '';
  const supplier = item?.supplier || ingredient?.supplier || '';

  const activeLots = lots.filter(l => l.status === 'active' && parseFloat(l.quantity_remaining) > 0);
  const depletedLots = lots.filter(l => l.status === 'depleted' || parseFloat(l.quantity_remaining) <= 0);
  const quarantinedLots = lots.filter(l => l.status === 'quarantine');

  return (
    <div className="odoo-scope">
      {/* ══════ CONTROL BAR (breadcrumb + actions + pager) ══════ */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/inventory')} className="odoo-pager-btn" title="Retour à la liste">
          <ArrowLeft size={14} />
        </button>
        <div className="odoo-breadcrumb">
          <Warehouse size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/inventory')}>Économat</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{ingredientName || '—'}</span>
        </div>
        <button onClick={() => setShowEdit(true)} className="odoo-btn-secondary">
          <Edit3 size={13} /> Modifier
        </button>
        <button onClick={() => setShowAdjust(true)} className="odoo-btn-secondary">
          <TrendingDown size={13} /> Ajuster
        </button>
        <button onClick={() => setShowOrderRequest(true)} className="odoo-btn-primary">
          <ShoppingCart size={13} /> Commander
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowDelete(true)} className="odoo-btn-danger" title="Supprimer">
          <Trash2 size={13} />
        </button>
      </div>

      {/* ══════ STATUS ALERTS (sober) ══════ */}
      {isLow && (
        <div className="odoo-alert warning">
          <AlertTriangle size={14} style={{ color: '#856404', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span className="odoo-alert-title">Stock bas</span> — {qty.toFixed(1)} {unit} restant(s), seuil minimum {threshold.toFixed(0)} {unit}
          </div>
          <button onClick={() => setShowOrderRequest(true)} className="odoo-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
            <ShoppingCart size={11} /> Demander
          </button>
        </div>
      )}
      {expiredCount > 0 && (
        <div className="odoo-alert danger">
          <CalendarClock size={14} style={{ color: '#721c24', marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span className="odoo-alert-title">{expiredCount} lot(s) expiré(s)</span> — des lots actifs ont dépassé leur date limite de consommation.
          </div>
        </div>
      )}

      {/* ══════ SMART BUTTONS ROW ══════ */}
      <div className="odoo-smart-button-row">
        <div className="odoo-smart-button" onClick={() => setActiveTab('lots')}>
          <div className="odoo-smart-button-value" style={{ color: isOut ? '#dc3545' : isLow ? '#b85d1a' : 'var(--theme-accent)' }}>
            {qty.toFixed(qty % 1 === 0 ? 0 : 1)}
          </div>
          <div className="odoo-smart-button-label"><Package size={11} /> Stock ({unit})</div>
        </div>
        <div className="odoo-smart-button" onClick={() => setShowEdit(true)}>
          <div className="odoo-smart-button-value">{threshold.toFixed(0)}</div>
          <div className="odoo-smart-button-label"><AlertTriangle size={11} /> Seuil min</div>
        </div>
        <div className="odoo-smart-button" onClick={() => setActiveTab('lots')}>
          <div className="odoo-smart-button-value">{lotsCount}</div>
          <div className="odoo-smart-button-label"><Boxes size={11} /> Lots actifs</div>
        </div>
        <div className="odoo-smart-button">
          <div className="odoo-smart-button-value">{unitCost.toFixed(2)}</div>
          <div className="odoo-smart-button-label">DH / {unit}</div>
        </div>
      </div>

      {/* ══════ FORM HEADER (title + category + supplier) ══════ */}
      <div className="odoo-form-header">
        <h1 className="odoo-form-title">{ingredientName}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 6 }}>
          <span className={`odoo-tag ${categoryTagClass(categoryId)}`}>
            {resolveCategory(categoryId)?.typeName || 'Non classé'}
          </span>
          {supplier && <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>{supplier}</span>}
          {isLow && <span className="odoo-tag odoo-tag-orange">STOCK BAS</span>}
          {expiredCount > 0 && <span className="odoo-tag odoo-tag-red">LOT EXPIRÉ</span>}
        </div>
      </div>

      {/* ══════ TABS Odoo (notebook) ══════ */}
      <div className="odoo-tabs">
        <button onClick={() => setActiveTab('lots')}
          className={`odoo-tab ${activeTab === 'lots' ? 'active' : ''}`}>
          <ShieldCheck size={13} /> Lots &amp; Traçabilité
        </button>
        <button onClick={() => setActiveTab('history')}
          className={`odoo-tab ${activeTab === 'history' ? 'active' : ''}`}>
          <Clock size={13} /> Historique
        </button>
      </div>

      {/* ══════ LOTS TAB ══════ */}
      {activeTab === 'lots' && (
        <div>
          {activeLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header" style={{ color: '#28a745' }}>
                <Boxes size={12} /> Lots actifs ({activeLots.length})
              </div>
              {activeLots.map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--theme-bg-separator)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onQuarantine={() => quarantineMutation.mutate(lot.id)}
                    onWaste={() => wasteMutation.mutate(lot.id)}
                    onOpenContainer={isMagasinier ? () => setOpenContainerLot(lot) : undefined}
                  />
                </div>
              ))}
            </div>
          )}

          {quarantinedLots.length > 0 && (
            <div className="odoo-section">
              <div className="odoo-section-header" style={{ color: '#b85d1a' }}>
                <Shield size={12} /> Quarantaine ({quarantinedLots.length})
              </div>
              {quarantinedLots.map((lot, i) => (
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--theme-bg-separator)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                    onWaste={() => wasteMutation.mutate(lot.id)}
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
                <div key={lot.id} style={{ borderTop: i > 0 ? '1px solid var(--theme-bg-separator)' : 'none' }}>
                  <LotRow lot={lot}
                    isExpanded={expandedLot === lot.id}
                    onToggle={() => setExpandedLot(expandedLot === lot.id ? null : lot.id)}
                    traceability={expandedLot === lot.id ? lotTraceability as LotTraceability[] : []}
                  />
                </div>
              ))}
              {depletedLots.length > 10 && (
                <div style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--theme-text-muted)', textAlign: 'center', borderTop: '1px solid var(--theme-bg-separator)' }}>
                  + {depletedLots.length - 10} lots épuisés supplémentaires
                </div>
              )}
            </div>
          )}

          {lots.length === 0 && (
            <div className="odoo-section">
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                <Boxes size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
                <p style={{ fontSize: '0.8125rem' }}>Aucun lot enregistré pour cet ingrédient</p>
                <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Les lots sont créés automatiquement lors de la réception des bons de commande</p>
              </div>
            </div>
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
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <Clock size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.8125rem' }}>Aucun mouvement enregistré</p>
            </div>
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
                    borderTop: i > 0 ? '1px solid var(--theme-bg-separator)' : 'none', fontSize: '0.8125rem',
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: isPositive ? '#d4edda' : '#f8d7da', flexShrink: 0,
                    }}>
                      {tx.type === 'restock' ? <Package size={12} style={{ color: '#155724' }} /> :
                       tx.type === 'purchase_order' ? <Package size={12} style={{ color: '#155724' }} /> :
                       tx.type === 'production' ? <Factory size={12} style={{ color: '#1f6391' }} /> :
                       tx.type === 'adjustment' ? <TrendingDown size={12} style={{ color: '#b85d1a' }} /> :
                       tx.type === 'waste' ? <Ban size={12} style={{ color: '#721c24' }} /> :
                       tx.type === 'usage' ? <Beaker size={12} style={{ color: '#b85d1a' }} /> :
                       <Beaker size={12} style={{ color: 'var(--theme-text-muted)' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--theme-text-strong)' }}>
                        {tx.type === 'restock' ? 'Réapprovisionnement' :
                         tx.type === 'purchase_order' ? 'Bon de commande' :
                         tx.type === 'production' ? 'Production' :
                         tx.type === 'adjustment' ? 'Ajustement' :
                         tx.type === 'waste' ? 'Perte / Déchet' :
                         tx.type === 'usage' ? 'Utilisation' : tx.type}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: 1, fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                        <span className="odoo-tag odoo-tag-purple" style={{ fontSize: '0.625rem' }}>
                          <span style={{
                            width: 12, height: 12, borderRadius: '50%', backgroundColor: '#efe6ee',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 700,
                          }}>{initials}</span>
                          {tx.performed_by_name || 'Système'}
                        </span>
                        {roleLabel && <span className="odoo-tag odoo-tag-grey" style={{ fontSize: '0.625rem' }}>{roleLabel}</span>}
                        <span>{format(new Date(tx.created_at), 'dd/MM/yyyy HH:mm')}</span>
                      </div>
                      {tx.note && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontStyle: 'italic', marginTop: 2 }}>{tx.note}</div>}
                    </div>
                    <span style={{ fontWeight: 600, color: isPositive ? '#28a745' : '#dc3545', flexShrink: 0 }}>
                      {isPositive ? '+' : ''}{parseFloat(tx.quantity_change).toFixed(1)} {unit}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════ MODALS ══════ */}
      {showEdit && ingredient && (
        <EditIngredientModal
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 480, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: '#fdf0ed', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Trash2 size={16} style={{ color: '#dc3545' }} />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#721c24' }}>Supprimer l'ingrédient</h2>
            </div>
            <div style={{ padding: '1rem', backgroundColor: '#fff' }}>
              <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-strong)', marginBottom: '0.75rem' }}>
                Voulez-vous vraiment supprimer <strong>{ingredientName}</strong> ? Cette action est irréversible et supprimera toutes les données associées.
              </p>
              {qty > 0 && (
                <div style={{
                  fontSize: '0.75rem', color: '#856404', backgroundColor: '#fff3cd',
                  border: '1px solid #ffeeba', borderRadius: 4, padding: '0.5rem 0.625rem',
                  marginBottom: '0.75rem',
                }}>
                  <strong>⚠ Stock actif : {qty.toFixed(2)} {unit}.</strong>{' '}
                  Utilisez « Forcer la suppression » pour jeter le stock et supprimer quand même.
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--theme-bg-separator)', paddingTop: '0.75rem' }}>
                <button onClick={() => setShowDelete(false)} className="odoo-btn-secondary">Annuler</button>
                {qty > 0 ? (
                  <button
                    onClick={() => deleteIngredientMutation.mutate({ force: true })}
                    disabled={deleteIngredientMutation.isPending}
                    className="odoo-btn-primary"
                    style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}
                    title="Jette le stock restant et supprime l'ingrédient"
                  >
                    <Trash2 size={13} /> {deleteIngredientMutation.isPending ? 'Suppression…' : 'Forcer la suppression'}
                  </button>
                ) : (
                  <button
                    onClick={() => deleteIngredientMutation.mutate({})}
                    disabled={deleteIngredientMutation.isPending}
                    className="odoo-btn-primary"
                    style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}
                  >
                    <Trash2 size={13} /> {deleteIngredientMutation.isPending ? 'Suppression…' : 'Supprimer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showOrderRequest && (
        <OrderRequestModal
          ingredientName={ingredientName}
          unit={unit}
          isLow={isLow}
          supplierHint={supplier}
          onClose={() => setShowOrderRequest(false)}
          onSave={(data) => addToWaitingListMutation.mutate(data)}
          isLoading={addToWaitingListMutation.isPending}
        />
      )}

      {openContainerLot && (
        <OpenContainerModal
          lot={openContainerLot}
          onClose={() => setOpenContainerLot(null)}
          onSave={(qty, note) => openContainerMutation.mutate({ lotId: openContainerLot.id, quantity: qty, note })}
          isLoading={openContainerMutation.isPending}
        />
      )}
    </div>
  );
}

/* ─── Open Container Modal : magasinier transfere qty Economat -> Pesage ─── */
function OpenContainerModal({ lot, onClose, onSave, isLoading }: {
  lot: Lot;
  onClose: () => void;
  onSave: (qty: number, note?: string) => void;
  isLoading: boolean;
}) {
  const economat = parseFloat(lot.economat_quantity || '0');
  const [quantity, setQuantity] = useState<string>(economat.toString());
  const [note, setNote] = useState<string>('');
  const qty = parseFloat(quantity);
  const isValid = !isNaN(qty) && qty > 0 && qty <= economat;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 480, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={16} style={{ color: 'var(--theme-accent)' }} />
          <div>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>Ouvrir contenant</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>Transfert Économat → Pesage</p>
          </div>
        </div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 4, backgroundColor: '#f9fafb', padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--theme-text-strong)' }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Lot : {lot.supplier_lot_number || lot.lot_number || '—'}</div>
            <div>Économat dispo : <strong style={{ fontFamily: 'monospace' }}>{economat.toFixed(2)} {lot.ingredient_unit}</strong></div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Quantité à transférer</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="number" step="0.01" min="0" max={economat} value={quantity}
                onChange={(e) => setQuantity(e.target.value)} autoFocus
                className="input" style={{ flex: 1, fontFamily: 'monospace', textAlign: 'right' }} />
              <span style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', fontWeight: 500 }}>{lot.ingredient_unit}</span>
            </div>
            {qty > economat && (
              <p style={{ fontSize: '0.75rem', color: '#dc3545', marginTop: 4 }}>Dépasse la qté Économat dispo ({economat.toFixed(2)})</p>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Motif (optionnel)</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : Pré-ouverture matin, réorganisation..." className="input" />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button onClick={() => onSave(qty, note.trim() || undefined)} disabled={!isValid || isLoading} className="odoo-btn-primary">
              <Truck size={13} /> {isLoading ? 'Transfert...' : 'Transférer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Order Request Modal (add to waiting list) ─── */
function OrderRequestModal({ ingredientName, unit, isLow, supplierHint, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
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
    quantity: '',
    reason: isLow ? 'stock_bas' : 'manual',
    note: '',
    supplierId: '',
  });

  // Set matched supplier once loaded
  const [didAutoMatch, setDidAutoMatch] = useState(false);
  if (matchedSupplier && !didAutoMatch && !form.supplierId) {
    setForm(f => ({ ...f, supplierId: matchedSupplier.id as string }));
    setDidAutoMatch(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 460, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingCart size={16} style={{ color: 'var(--theme-accent)' }} />
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>Demande d'achat</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{ingredientName}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const qty = parseFloat(form.quantity);
          if (isNaN(qty) || qty <= 0) return;
          onSave({ quantity: qty, reason: form.reason, note: form.note || undefined, supplierId: form.supplierId || null });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          <div style={{ border: '1px solid #d6e9f8', borderRadius: 4, backgroundColor: '#eaf3fb', padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#1f6391' }}>
            Cette demande sera ajoutée à la liste d'attente d'achat. Le manager pourra ensuite générer un bon de commande regroupé par fournisseur.
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur</label>
            <select className="input" value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">— Aucun fournisseur —</option>
              {(suppliers as Record<string, any>[]).filter(s => s.is_active !== false).map(s => (
                <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Quantité à commander ({unit})</label>
            <input type="number" step="0.1" min="0.1" className="input" value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Motif</label>
            <select className="input" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}>
              <option value="stock_bas">Stock bas</option>
              <option value="production">Besoin production</option>
              <option value="manual">Demande manuelle</option>
              <option value="replenishment">Approvisionnement</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Note (optionnel)</label>
            <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Contexte de la demande..." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              <ShoppingCart size={13} /> {isLoading ? 'Ajout...' : 'Ajouter à la liste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Lot Row Component ─── */
function LotRow({ lot, isExpanded, onToggle, traceability, onQuarantine, onWaste, onOpenContainer }: {
  lot: Lot;
  isExpanded: boolean;
  onToggle: () => void;
  traceability: LotTraceability[];
  onQuarantine?: () => void;
  onWaste?: () => void;
  onOpenContainer?: () => void;
}) {
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

  return (
    <div>
      <div onClick={onToggle}
        style={{
          padding: '0.5rem 0.875rem', display: 'flex', alignItems: 'center', gap: '0.625rem',
          cursor: 'pointer', backgroundColor: '#fff', fontSize: '0.8125rem',
        }}>
        <span className={`odoo-status-dot ${dotClass}`} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--theme-text-strong)' }}>
              {lot.supplier_lot_number || lot.lot_number || '—'}
            </span>
            {lot.status === 'quarantine' && <span className="odoo-tag odoo-tag-orange">QUARANTAINE</span>}
            {isExpired && lot.status === 'active' && <span className="odoo-tag odoo-tag-red">EXPIRÉ</span>}
            {!isExpired && daysUntil !== null && daysUntil <= 7 && lot.status === 'active' && (
              <span className="odoo-tag odoo-tag-yellow">{daysUntil}j</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
            {lot.supplier_name && <span>{lot.supplier_name}</span>}
            {lot.unit_cost && parseFloat(lot.unit_cost) > 0 && (
              <span style={{ fontWeight: 500 }}>
                {parseFloat(lot.unit_cost).toFixed(2)} DH/{lot.ingredient_unit}
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--theme-text-strong)' }}>
            {remaining.toFixed(1)} / {received.toFixed(1)} {lot.ingredient_unit}
          </div>
          {lot.unit_cost && parseFloat(lot.unit_cost) > 0 && remaining > 0 && (
            <div style={{ fontSize: '0.625rem', color: 'var(--theme-text-muted)', marginTop: 2 }}>
              Valeur : {(remaining * parseFloat(lot.unit_cost)).toFixed(2)} DH
            </div>
          )}
          <div style={{ width: 64, height: 4, backgroundColor: '#e9ecef', borderRadius: 2, overflow: 'hidden', marginTop: 4, marginLeft: 'auto' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              backgroundColor: pct > 50 ? '#28a745' : pct > 20 ? '#ffc107' : '#dc3545',
            }} />
          </div>
        </div>

        <div style={{ flexShrink: 0, color: 'var(--theme-text-muted)' }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0.5rem 0.875rem 0.875rem', backgroundColor: '#f9fafb', borderTop: '1px solid var(--theme-bg-separator)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {/* Supply chain */}
            <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: '#fff' }}>
              <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheck size={11} /> Chaîne d'approvisionnement
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {lot.purchase_order_number && (
                  <>
                    <span className="odoo-tag odoo-tag-purple"><FileText size={9} /> BC : {lot.purchase_order_number}</span>
                    <ChevronRight size={10} style={{ color: 'var(--theme-bg-separator)' }} />
                  </>
                )}
                {lot.reception_voucher_number && (
                  <>
                    <span className="odoo-tag odoo-tag-purple"><Truck size={9} /> BR : {lot.reception_voucher_number}</span>
                    <ChevronRight size={10} style={{ color: 'var(--theme-bg-separator)' }} />
                  </>
                )}
                <span className="odoo-tag odoo-tag-purple"><Hash size={9} /> Lot : {lot.supplier_lot_number || lot.lot_number || '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: 6, fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                {lot.expiration_date && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: isExpired ? '#dc3545' : 'var(--theme-text-muted)', fontWeight: isExpired ? 600 : 400 }}>
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
              <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: '#fff' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#1f6391', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Factory size={11} /> Productions utilisant ce lot ({traceability.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {traceability.map((t) => (
                    <div key={t.id}
                      onClick={(e) => { e.stopPropagation(); window.location.href = `/production/${t.production_plan_id}`; }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.25rem 0.5rem', borderRadius: 3, border: '1px solid var(--theme-bg-separator)',
                        cursor: 'pointer', fontSize: '0.75rem',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Factory size={11} style={{ color: '#1f6391' }} />
                        <span style={{ fontWeight: 500 }}>
                          {format(new Date(t.plan_date), 'dd/MM/yyyy')} — {t.plan_type === 'morning' ? 'Matin' : t.plan_type === 'afternoon' ? 'Après-midi' : t.plan_type}
                        </span>
                        <span className={`odoo-tag ${
                          t.plan_status === 'completed' ? 'odoo-tag-green' :
                          t.plan_status === 'in_progress' ? 'odoo-tag-yellow' : 'odoo-tag-grey'
                        }`}>
                          {t.plan_status === 'completed' ? 'Terminé' : t.plan_status === 'in_progress' ? 'En cours' : t.plan_status}
                        </span>
                      </div>
                      <span style={{ fontWeight: 600, color: '#1f6391' }}>
                        {parseFloat(t.quantity_used).toFixed(1)} {lot.ingredient_unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {traceability.length === 0 && (
              <div style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--theme-text-muted)', backgroundColor: '#fff', border: '1px solid var(--theme-bg-separator)', borderRadius: 3 }}>
                Aucune production liée à ce lot
              </div>
            )}

            {/* Repartition Economat / Pesage */}
            {(economat > 0 || pesage > 0) && (
              <div style={{ border: '1px solid var(--theme-bg-separator)', borderRadius: 3, padding: '0.625rem 0.75rem', backgroundColor: '#fff' }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--theme-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Package size={11} /> Répartition par zone
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1, border: '1px solid #ffe5d0', borderRadius: 3, padding: '0.375rem 0.5rem' }}>
                    <div style={{ fontSize: '0.625rem', color: '#b85d1a', textTransform: 'uppercase', fontWeight: 600 }}>Économat (scellé)</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#b85d1a' }}>{economat.toFixed(2)} {lot.ingredient_unit}</div>
                  </div>
                  <div style={{ flex: 1, border: '1px solid #d4edda', borderRadius: 3, padding: '0.375rem 0.5rem' }}>
                    <div style={{ fontSize: '0.625rem', color: '#28a745', textTransform: 'uppercase', fontWeight: 600 }}>Pesage (ouvert)</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#28a745' }}>{pesage.toFixed(2)} {lot.ingredient_unit}</div>
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
                    title="Transférer une partie du contenant Économat vers le Pesage">
                    <Package size={11} /> Ouvrir contenant → Pesage
                  </button>
                )}
                {onQuarantine && (
                  <button onClick={(e) => { e.stopPropagation(); onQuarantine(); }} className="odoo-btn-secondary">
                    <Shield size={11} /> Quarantaine
                  </button>
                )}
                {onWaste && (
                  <button onClick={(e) => { e.stopPropagation(); onWaste(); }} className="odoo-btn-danger">
                    <Ban size={11} /> Déchet
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Edit Ingredient Modal ─── */
function EditIngredientModal({ ingredient, threshold, onClose, onSave, isLoading }: {
  ingredient: Record<string, any>;
  threshold: number;
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    name: (ingredient.name as string) || '',
    unit: (ingredient.unit as string) || 'kg',
    unitCost: String(ingredient.unit_cost || ''),
    supplier: (ingredient.supplier as string) || '',
    categoryId: (ingredient.category_id as string) || '',
    threshold: String(threshold),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 480, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Edit3 size={16} style={{ color: 'var(--theme-accent)' }} />
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>Modifier l'ingrédient</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{ingredient.name as string}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name: form.name, unit: form.unit, unitCost: parseFloat(form.unitCost) || 0,
            supplier: form.supplier || undefined, categoryId: form.categoryId || null,
            threshold: parseFloat(form.threshold) || 0,
          });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Nom</label>
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Unité</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                <option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">Unité</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Coût unitaire (DH)</label>
              <input type="number" step="0.01" className="input" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Catégorie</label>
            <CategoryCascadeSelector value={form.categoryId} onChange={id => setForm({ ...form, categoryId: id })} rootIds={STOCKABLE_ROOT_IDS} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur</label>
            <input className="input" value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Seuil minimum d'alerte ({form.unit})</label>
            <input type="number" step="0.1" className="input" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              <Save size={13} /> {isLoading ? 'Enregistrement...' : 'Sauvegarder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Adjust Stock Modal ─── */
function AdjustStockModal({ ingredientName, unit, onClose, onSave, isLoading }: {
  ingredientName: string;
  unit: string;
  onClose: () => void;
  onSave: (data: { quantity: number; type: string; note?: string }) => void;
  isLoading: boolean;
}) {
  // Valeurs alignees avec la contrainte DB inventory_transactions_type_check :
  // 'waste' = perte/casse (decremente), 'adjustment' = correction (decremente),
  // 'restock' = reapprovisionnement manuel (incremente).
  const [form, setForm] = useState({ quantity: '', type: 'waste', note: '' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ margin: 0, minHeight: 0, width: '100%', maxWidth: 420, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingDown size={16} style={{ color: 'var(--theme-accent)' }} />
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--theme-text-strong)' }}>Ajuster le stock</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>{ingredientName}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 4, color: 'var(--theme-text-muted)' }}><X size={16} /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const qty = parseFloat(form.quantity);
          if (isNaN(qty) || qty <= 0) return;
          const signedQty = form.type === 'restock' ? qty : -qty;
          onSave({ quantity: signedQty, type: form.type, note: form.note || undefined });
        }} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', backgroundColor: '#fff' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Type d'ajustement</label>
            <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
              <option value="waste">Perte / Casse</option>
              <option value="adjustment">Correction d'inventaire</option>
              <option value="restock">Réapprovisionnement manuel</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Quantité ({unit})</label>
            <input type="number" step="0.1" min="0.1" className="input" value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })} required placeholder="0.0" autoFocus />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Note (optionnel)</label>
            <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              placeholder="Raison de l'ajustement..." />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--theme-bg-separator)' }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isLoading} className="odoo-btn-primary">
              <Save size={13} /> {isLoading ? 'Ajustement...' : 'Sauvegarder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
