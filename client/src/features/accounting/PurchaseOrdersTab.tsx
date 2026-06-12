import { useState, useMemo, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { suppliersApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter, Loader2, Download, Pencil,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_LABELS: Record<string, string> = {
  en_attente: 'En attente',
  envoye: 'Envoyé',
  livre_complet: 'Livré',
  livre_partiel: 'Partiel',
  non_livre: 'Non livré',
  annule: 'Annulé',
  en_attente_facturation: 'Att. facturation',
};
const STATUS_COLORS: Record<string, string> = {
  en_attente: 'bg-amber-100 text-amber-800 border border-amber-200',
  envoye: 'bg-blue-100 text-blue-800 border border-blue-200',
  livre_complet: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  livre_partiel: 'bg-orange-100 text-orange-800 border border-orange-200',
  non_livre: 'bg-red-100 text-red-800 border border-red-200',
  annule: 'bg-gray-100 text-gray-500 border border-gray-200',
  en_attente_facturation: 'bg-purple-100 text-purple-800 border border-purple-200',
};
const STATUS_ICONS: Record<string, typeof Clock> = {
  en_attente: Clock,
  envoye: Send,
  livre_complet: CheckCircle2,
  livre_partiel: Package,
  non_livre: PackageX,
  annule: Ban,
  en_attente_facturation: FileText,
};

type POItem = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  ingredient_unit: string;
  quantity_ordered: string;
  quantity_delivered: string;
  unit_price: string;
};

export default function PurchaseOrdersTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showDelivery, setShowDelivery] = useState<string | null>(null);
  // Modal d'edition complete (admin) : qty/prix/ajout/suppression de lignes
  const [editPoId, setEditPoId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => purchaseOrdersApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: overdue = [] } = useQuery({
    queryKey: ['purchase-orders-overdue'],
    queryFn: () => purchaseOrdersApi.overdue(),
  });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { entries: ingredientCats } = useReferentiel('ingredient_categories');
  const { entries: unitEntries } = useReferentiel('units');

  const sendMutation = useMutation({
    mutationFn: purchaseOrdersApi.send,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('BC envoyé au fournisseur'); },
  });
  const cancelMutation = useMutation({
    mutationFn: purchaseOrdersApi.cancel,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('BC annulé'); },
  });
  const deleteMutation = useMutation({
    mutationFn: purchaseOrdersApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('BC supprimé'); },
  });
  const notDeliveredMutation = useMutation({
    mutationFn: purchaseOrdersApi.markNotDelivered,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }); notify.success('Marqué non livré'); },
  });

  // Stats
  const handleDownloadPoPdf = async (po: Record<string, any>) => {
    try {
      const response = await purchaseOrdersApi.downloadPdf(po.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      // Ouvrir le PDF directement — compatible web et mobile (Capacitor)
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('Erreur lors du téléchargement du PDF');
    }
  };

  const allOrders = orders as Record<string, any>[];
  const stats = useMemo(() => {
    const byStatus: Record<string, { count: number; total: number }> = {};
    for (const po of allOrders) {
      const s = po.status as string;
      if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
      byStatus[s].count++;
      byStatus[s].total += parseFloat(po.total_amount as string) || 0;
    }
    const totalAmount = allOrders.reduce((s, po) => s + (parseFloat(po.total_amount as string) || 0), 0);
    return { byStatus, totalAmount, totalCount: allOrders.length };
  }, [allOrders]);

  // Filter
  const displayed = useMemo(() => {
    let list = allOrders;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(po =>
        (po.order_number as string).toLowerCase().includes(q) ||
        (po.supplier_name as string).toLowerCase().includes(q)
      );
    }
    if (supplierFilter) {
      list = list.filter(po => po.supplier_id === supplierFilter);
    }
    return list;
  }, [allOrders, searchTerm, supplierFilter]);

  // Unique suppliers from orders
  const orderSuppliers = useMemo(() => {
    const map = new Map<string, string>();
    allOrders.forEach(po => map.set(po.supplier_id as string, po.supplier_name as string));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allOrders]);

  const statusTabs = [
    { key: '', label: 'Tous', icon: ShoppingBag, color: 'text-gray-600' },
    { key: 'en_attente', label: 'En attente', icon: Clock, color: 'text-amber-600' },
    { key: 'envoye', label: 'Envoyés', icon: Send, color: 'text-blue-600' },
    { key: 'livre_partiel', label: 'Partiels', icon: Package, color: 'text-orange-600' },
    { key: 'livre_complet', label: 'Livrés', icon: CheckCircle2, color: 'text-emerald-600' },
    { key: 'non_livre', label: 'Non livrés', icon: PackageX, color: 'text-red-600' },
    { key: 'en_attente_facturation', label: 'Att. facture', icon: FileText, color: 'text-purple-600' },
    { key: 'annule', label: 'Annulés', icon: Ban, color: 'text-gray-400' },
  ];

  const overdueList = overdue as Record<string, any>[];

  return (
    <>
      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div className="odoo-alert danger">
          <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6 }} />
          <strong>{overdueList.length} bon{overdueList.length > 1 ? 's' : ''} en retard de livraison.</strong>
          <span style={{ marginLeft: 6, color: 'var(--theme-text-muted)' }}>Consulte la liste ci-dessous pour confirmer la réception.</span>
        </div>
      )}

      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <button onClick={() => setStatusFilter('')} className={`odoo-stat-card ${statusFilter === '' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label"><ShoppingBag size={11} style={{ display: 'inline', marginRight: 4 }} />Total BC</div>
          <div className="odoo-stat-card-value">{stats.totalCount}</div>
          <div className="odoo-stat-card-sub">{n(stats.totalAmount)} DH</div>
        </button>
        {(['en_attente', 'envoye', 'livre_complet'] as const).map((s) => {
          const Icon = STATUS_ICONS[s] || Clock;
          const data = stats.byStatus[s] || { count: 0, total: 0 };
          return (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)} className={`odoo-stat-card ${statusFilter === s ? 'active' : ''}`}>
              <div className="odoo-stat-card-label"><Icon size={11} style={{ display: 'inline', marginRight: 4 }} />{STATUS_LABELS[s]}</div>
              <div className="odoo-stat-card-value">{data.count}</div>
              <div className="odoo-stat-card-sub">{n(data.total)} DH</div>
            </button>
          );
        })}
      </div>

      {/* Search panel: status chips + filters + action */}
      <div className="odoo-search-panel">
        {statusTabs.map((tab) => {
          const Icon = tab.icon;
          const count = tab.key === '' ? stats.totalCount : (stats.byStatus[tab.key]?.count || 0);
          return (
            <button key={tab.key} onClick={() => setStatusFilter(tab.key)} className="odoo-filter-dropdown"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                backgroundColor: statusFilter === tab.key ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
                color: statusFilter === tab.key ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
                fontWeight: statusFilter === tab.key ? 600 : 400,
              }}>
              <Icon size={11} /> {tab.label}
              {count > 0 && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 2 }}>{count}</span>}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowCreate(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau BC
        </button>
      </div>

      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N° ou fournisseur..."
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="odoo-search-input" />
        {orderSuppliers.length > 1 && (
          <>
            <Filter size={13} style={{ color: 'var(--theme-text-muted)' }} />
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="odoo-filter-dropdown">
              <option value="">Tous les fournisseurs</option>
              {orderSuppliers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Orders table */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des bons de commande...</p>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Truck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun bon de commande</p>
          <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
            {statusFilter || searchTerm || supplierFilter ? 'Aucun résultat pour ces filtres' : 'Créez votre premier bon de commande'}
          </p>
          {!statusFilter && !searchTerm && (
            <button onClick={() => setShowCreate(true)} className="odoo-btn-primary"
              style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Créer un BC
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>N° BC</th>
                <th>Fournisseur</th>
                <th>Statut</th>
                <th>Commande</th>
                <th>Livraison prévue</th>
                <th style={{ textAlign: 'right' }}>Articles</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right', width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((po) => {
                const isExpanded = expandedRow === (po.id as string);
                const totalAmount = parseFloat(po.total_amount as string) || 0;
                const deliveredAmount = parseFloat(po.delivered_amount as string) || 0;
                const deliveryPct = totalAmount > 0 ? Math.min(100, (deliveredAmount / totalAmount) * 100) : 0;
                const status = po.status as string;
                const statusTag = status === 'livre_complet' ? 'odoo-tag-green'
                  : status === 'livre_partiel' ? 'odoo-tag-orange'
                  : status === 'envoye' ? 'odoo-tag-blue'
                  : status === 'en_attente' ? 'odoo-tag-yellow'
                  : status === 'non_livre' ? 'odoo-tag-red'
                  : 'odoo-tag-grey';
                const dotClass = status === 'livre_complet' ? 'ok'
                  : status === 'non_livre' ? 'danger'
                  : status === 'annule' ? 'neutral'
                  : 'warning';
                return (
                  <Fragment key={po.id as string}>
                    <tr onClick={() => setExpandedRow(isExpanded ? null : po.id as string)} style={{ cursor: 'pointer' }}>
                      <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {isExpanded ? <ChevronUp size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{po.order_number as string}</span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Truck size={11} style={{ color: 'var(--theme-accent)' }} />
                          {po.supplier_name as string}
                        </span>
                      </td>
                      <td><span className={`odoo-tag ${statusTag}`}>{STATUS_LABELS[status]}</span></td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {format(new Date(po.order_date as string), 'dd MMM yyyy', { locale: fr })}
                      </td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>
                        {po.expected_delivery_date
                          ? format(new Date(po.expected_delivery_date as string), 'dd MMM yyyy', { locale: fr })
                          : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{po.item_count as number}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700 }}>{n(totalAmount)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                        {(status === 'livre_partiel' || status === 'livre_complet') && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                            <span style={{ width: 50, height: 3, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
                              <span style={{ display: 'block', height: '100%', background: deliveryPct >= 100 ? '#28a745' : '#b85d1a', width: `${deliveryPct}%` }} />
                            </span>
                            <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>{deliveryPct.toFixed(0)}%</span>
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {status === 'en_attente' && (
                            <button onClick={() => sendMutation.mutate(po.id as string)} title="Envoyer" className="odoo-pager-btn">
                              <Send size={13} />
                            </button>
                          )}
                          {(status === 'envoye' || status === 'livre_partiel') && (
                            <button onClick={() => setShowDelivery(po.id as string)} title="Confirmer réception" className="odoo-pager-btn" style={{ color: '#28a745' }}>
                              <PackageCheck size={13} />
                            </button>
                          )}
                          {status !== 'en_attente' && (
                            <button onClick={() => handleDownloadPoPdf(po)} title="Télécharger PDF" className="odoo-pager-btn">
                              <Download size={13} />
                            </button>
                          )}
                          <button onClick={() => setShowDetail(po.id as string)} title="Voir détails" className="odoo-pager-btn">
                            <Eye size={13} />
                          </button>
                          {/* Edition complete (admin/gerant) : qty/prix/lignes. Dispo sur tous statuts. */}
                          <button onClick={() => setEditPoId(po.id as string)} title="Modifier le BC (qty, prix, lignes)" className="odoo-pager-btn">
                            <Pencil size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
                          <ExpandedPORow poId={po.id as string} status={status}
                            onSend={() => sendMutation.mutate(po.id as string)}
                            onDelivery={() => setShowDelivery(po.id as string)}
                            onNotDelivered={() => notDeliveredMutation.mutate(po.id as string)}
                            onCancel={() => cancelMutation.mutate(po.id as string)}
                            onDelete={() => { if (confirm('Supprimer ce bon de commande ?')) deleteMutation.mutate(po.id as string); }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} />}
      {showDetail && <PODetailModal poId={showDetail} onClose={() => setShowDetail(null)} />}
      {showDelivery && <DeliveryModal poId={showDelivery} onClose={() => setShowDelivery(null)} />}
      {editPoId && <EditPOModal poId={editPoId} onClose={() => setEditPoId(null)} />}
    </>
  );
}

/* ═══ Expanded Row — shows items inline ═══ */
function ExpandedPORow({ poId, status, onSend, onDelivery, onNotDelivered, onCancel, onDelete }: {
  poId: string; status: string;
  onSend: () => void; onDelivery: () => void; onNotDelivered: () => void;
  onCancel: () => void; onDelete: () => void;
}) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  if (isLoading) return <div className="py-4 text-center text-gray-400 text-sm">Chargement des articles...</div>;
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  return (
    <div className="space-y-3">
      {/* Items table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2">Ingrédient</th>
              <th className="text-right px-3 py-2">Qté commandée</th>
              <th className="text-right px-3 py-2">Qté livrée</th>
              <th className="text-right px-3 py-2">Prix unit.</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-right px-3 py-2 w-24">Progression</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map(item => {
              const ordered = parseFloat(item.quantity_ordered);
              const delivered = parseFloat(item.quantity_delivered);
              const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
              const price = item.unit_price != null ? parseFloat(item.unit_price) : null;
              return (
                <tr key={item.id} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {item.ingredient_name} <span className="text-gray-400 text-xs">({item.ingredient_unit})</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{ordered}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{delivered}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{price != null ? `${n(price)} DH` : <span className="text-amber-500 text-xs">À définir</span>}</td>
                  <td className="px-3 py-2 text-right font-medium">{price != null ? `${n(ordered * price)} DH` : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {po.notes && (
        <p className="text-sm text-gray-500 italic flex items-center gap-1.5">
          <FileText size={14} className="text-gray-400" /> {po.notes}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {status === 'en_attente' && (
          <button onClick={onSend}
            className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center gap-1.5 transition-colors">
            <Send size={14} /> Envoyer au fournisseur
          </button>
        )}
        {(status === 'envoye' || status === 'livre_partiel') && (
          <>
            <button onClick={onDelivery}
              className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 flex items-center gap-1.5 transition-colors">
              <PackageCheck size={14} /> Confirmer réception
            </button>
            <button onClick={onNotDelivered}
              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
              <PackageX size={14} /> Non livré
            </button>
          </>
        )}
        {!['livre_complet', 'annule'].includes(status) && (
          <button onClick={onCancel}
            className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-100 flex items-center gap-1.5 transition-colors">
            <Ban size={14} /> Annuler le BC
          </button>
        )}
        {/* Suppression definitive : autorise sur en_attente ou annule (BC abandonne). */}
        {(status === 'en_attente' || status === 'annule') && (
          <button onClick={onDelete}
            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center gap-1.5 transition-colors">
            <Trash2 size={14} /> Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══ Create PO Modal ═══ */
function CreatePOModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [searchIngredient, setSearchIngredient] = useState('');
  const [items, setItems] = useState<{ ingredientId: string; ingredientName: string; unit: string; quantityOrdered: number; unitPrice: number | null }[]>([]);
  const [showNewIngredient, setShowNewIngredient] = useState(false);
  const [newIng, setNewIng] = useState({ name: '', unit: 'kg', category: 'autre', unitCost: '' });

  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });
  const { entries: ingredientCats } = useReferentiel('ingredient_categories');
  const { entries: unitEntries } = useReferentiel('units');

  const createMutation = useMutation({
    mutationFn: purchaseOrdersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      notify.success('Bon de commande créé');
      onClose();
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const createIngredientMutation = useMutation({
    mutationFn: ingredientsApi.create,
    onSuccess: (created: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      const cost = parseFloat(created.unit_cost as string) || 0;
      setItems([...items, {
        ingredientId: created.id as string,
        ingredientName: created.name as string,
        unit: created.unit as string,
        quantityOrdered: 1,
        unitPrice: cost > 0 ? cost : null,
      }]);
      setShowNewIngredient(false);
      setNewIng({ name: '', unit: 'kg', category: 'autre', unitCost: '' });
      setSearchIngredient('');
      notify.success(`Ingrédient "${created.name}" créé et ajouté`);
    },
    onError: () => notify.error('Erreur lors de la création de l\'ingrédient'),
  });

  const handleCreateIngredient = () => {
    if (!newIng.name.trim()) { notify.error('Saisissez le nom de l\'ingrédient'); return; }
    createIngredientMutation.mutate({
      name: newIng.name.trim(),
      unit: newIng.unit,
      category: newIng.category,
      unitCost: newIng.unitCost ? parseFloat(newIng.unitCost) : 0,
    });
  };

  // Filtered ingredients (not already added)
  const addedIds = new Set(items.map(it => it.ingredientId));
  const filteredIngredients = (ingredients as Record<string, any>[]).filter(ing => {
    if (addedIds.has(ing.id as string)) return false;
    if (!searchIngredient) return true;
    return (ing.name as string).toLowerCase().includes(searchIngredient.toLowerCase());
  });

  const addIngredient = (ing: Record<string, any>) => {
    const cost = parseFloat(ing.unit_cost as string) || 0;
    setItems([...items, {
      ingredientId: ing.id as string,
      ingredientName: ing.name as string,
      unit: ing.unit as string,
      quantityOrdered: 1,
      unitPrice: cost > 0 ? cost : null,
    }]);
    setSearchIngredient('');
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: number) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, it) => sum + it.quantityOrdered * (it.unitPrice || 0), 0);
  const hasMissingPrices = items.some(it => it.unitPrice == null || it.unitPrice === 0);

  const handleSubmit = () => {
    if (!supplierId) { notify.error('Sélectionnez un fournisseur'); return; }
    if (items.length === 0) { notify.error('Ajoutez au moins un article'); return; }
    const invalidItems = items.filter(it => it.quantityOrdered <= 0);
    if (invalidItems.length > 0) { notify.error('Les quantités doivent être supérieures à 0'); return; }
    createMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDate || undefined,
      notes: notes || undefined,
      items: items.map(({ ingredientId, quantityOrdered, unitPrice }) => ({
        ingredientId, quantityOrdered,
        unitPrice: unitPrice != null && unitPrice > 0 ? unitPrice : null,
      })),
    });
  };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-600 to-gray-700 px-6 py-5 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <ShoppingBag size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Nouveau bon de commande</h2>
              <p className="text-sm text-white/70">Créez une commande fournisseur avec les articles souhaités</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Supplier + Date */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
                <option value="">Choisir un fournisseur</option>
                {(suppliers as Record<string, any>[]).filter((s) => s.is_active !== false).map((s) => (
                  <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Livraison prévue</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" placeholder="Optionnel..." />
            </div>
          </div>

          {/* Add ingredient search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ajouter des articles</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Chercher un ingrédient..."
                  value={searchIngredient} onChange={e => setSearchIngredient(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
              </div>
              <button onClick={() => { setShowNewIngredient(true); setNewIng({ name: searchIngredient || '', unit: 'kg', category: 'autre', unitCost: '' }); }}
                className="px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5 border border-emerald-200 whitespace-nowrap shrink-0">
                <Plus size={14} /> Nouvel ingrédient
              </button>
            </div>
            {searchIngredient && filteredIngredients.length > 0 && (
              <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filteredIngredients.slice(0, 10).map(ing => (
                  <button key={ing.id as string} onClick={() => addIngredient(ing)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm flex items-center justify-between transition-colors first:rounded-t-xl last:rounded-b-xl">
                    <span className="font-medium">{ing.name as string} <span className="text-gray-400">({ing.unit as string})</span></span>
                    <span className="text-xs text-gray-400">{n(parseFloat(ing.unit_cost as string) || 0)} DH/{ing.unit as string}</span>
                  </button>
                ))}
              </div>
            )}
            {searchIngredient && filteredIngredients.length === 0 && !showNewIngredient && (
              <p className="text-sm text-gray-400 mt-2">Aucun ingrédient trouvé</p>
            )}
            {showNewIngredient && (
              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                    <Plus size={14} /> Nouvel ingrédient
                  </h4>
                  <button onClick={() => setShowNewIngredient(false)} className="p-1 hover:bg-emerald-100 rounded-lg transition-colors">
                    <X size={14} className="text-emerald-600" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Nom *</label>
                    <input type="text" value={newIng.name} onChange={e => setNewIng({ ...newIng, name: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" placeholder="Ex: Farine T55" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Unité *</label>
                    <select value={newIng.unit} onChange={e => setNewIng({ ...newIng, unit: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      {unitEntries.map(u => (
                        <option key={u.code} value={u.code}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Catégorie</label>
                    <select value={newIng.category} onChange={e => setNewIng({ ...newIng, category: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      {ingredientCats.map(c => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">Coût unitaire (DH)</label>
                    <input type="number" step="0.01" min="0" value={newIng.unitCost} onChange={e => setNewIng({ ...newIng, unitCost: e.target.value })}
                      className="w-full px-2.5 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white" placeholder="Optionnel" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowNewIngredient(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Annuler</button>
                  <button onClick={handleCreateIngredient} disabled={createIngredientMutation.isPending}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50">
                    {createIngredientMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
                    {createIngredientMutation.isPending ? 'Création...' : 'Créer et ajouter'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ingrédient</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Quantité</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Prix unit. (DH)</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-28">Sous-total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item, idx) => (
                    <tr key={item.ingredientId} className="group hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-700">{item.ingredientName}</span>
                        <span className="text-gray-400 text-xs ml-1">({item.unit})</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''}
                          onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500" />
                      </td>
                      <td className="px-4 py-2.5">
                        <input type="number" min={0} step="0.01" value={item.unitPrice ?? ''}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="Optionnel"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500" />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-700">
                        {item.unitPrice ? n(item.quantityOrdered * item.unitPrice) : <span className="text-gray-400 text-xs">À définir</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => removeItem(idx)}
                          className="p-1.5 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                          <X size={14} className="text-red-400" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-gradient-to-r from-slate-600 to-gray-700 px-4 py-3 flex items-center justify-between text-white rounded-b-2xl">
                <span className="text-sm">
                  {items.length} article{items.length > 1 ? 's' : ''}
                  {hasMissingPrices && <span className="ml-2 text-amber-300 text-xs">(prix à définir par le fournisseur)</span>}
                </span>
                <span className="text-lg font-bold">{totalAmount > 0 ? `Total: ${n(totalAmount)} DH` : 'Prix à définir'}</span>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                <ShoppingBag size={24} className="text-gray-300" />
              </div>
              <p className="text-gray-400 text-sm">Recherchez et ajoutez des ingrédients ci-dessus</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-between items-center rounded-b-2xl">
          <div>
            {items.length > 0 && (
              <p className="text-sm text-gray-500">{items.length} article{items.length > 1 ? 's' : ''} — <span className="font-bold text-gray-800">{n(totalAmount)} DH</span></p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
            <button onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0}
              className="px-5 py-2.5 bg-gradient-to-r from-slate-600 to-gray-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2 disabled:opacity-50">
              {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
              {createMutation.isPending ? 'Création...' : 'Créer le bon de commande'}
            </button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══ PO Detail Modal ═══ */
function PODetailModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  if (isLoading) return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-2xl text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Loader2 className="animate-spin text-slate-400 mx-auto mb-3" size={28} />
        <p className="text-sm text-gray-400">Chargement...</p>
      </div>
    </ModalBackdrop>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];
  const totalOrdered = items.reduce((s, it) => s + parseFloat(it.quantity_ordered) * (it.unit_price != null ? parseFloat(it.unit_price) : 0), 0);
  const totalDelivered = items.reduce((s, it) => s + parseFloat(it.quantity_delivered) * (it.unit_price != null ? parseFloat(it.unit_price) : 0), 0);
  const globalPct = totalOrdered > 0 ? (totalDelivered / totalOrdered) * 100 : 0;
  const StatusIcon = STATUS_ICONS[po.status] || Clock;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-600 to-gray-700 px-6 py-5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white">{po.order_number}</h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[po.status] || ''}`}>
                  <StatusIcon size={12} />
                  {STATUS_LABELS[po.status] || po.status}
                </span>
              </div>
              <p className="text-sm text-white/70 mt-1">
                {po.supplier_name} — Créé par {po.created_by_name}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Info cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Commande</p>
              <p className="font-medium text-sm mt-1">{format(new Date(po.order_date), 'dd MMM yyyy', { locale: fr })}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Livraison prévue</p>
              <p className="font-medium text-sm mt-1">
                {po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Date livraison</p>
              <p className="font-medium text-sm mt-1">
                {po.delivery_date ? format(new Date(po.delivery_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </p>
            </div>
          </div>

          {/* Global progress */}
          {(po.status === 'livre_partiel' || po.status === 'livre_complet') && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Progression globale</span>
                <span className="text-sm font-bold">{globalPct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${globalPct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                  style={{ width: `${Math.min(100, globalPct)}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span>Commande: {n(totalOrdered)} DH</span>
                <span>Livré: {n(totalDelivered)} DH</span>
              </div>
            </div>
          )}

          {po.notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <FileText size={14} className="inline mr-1.5" /> {po.notes}
            </div>
          )}

          {/* Items table */}
          <div className="border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Ingrédient</th>
                  <th className="text-right px-4 py-2.5">Commandé</th>
                  <th className="text-right px-4 py-2.5">Livré</th>
                  <th className="text-right px-4 py-2.5">Prix unit.</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-right px-4 py-2.5 w-28">État</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const delivered = parseFloat(item.quantity_delivered);
                  const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 font-medium">{item.ingredient_name}
                        <span className="text-gray-400 text-xs ml-1">({item.ingredient_unit})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{ordered}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={delivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{delivered}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{item.unit_price != null ? `${n(parseFloat(item.unit_price))} DH` : <span className="text-amber-500 text-xs">À définir</span>}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{item.unit_price != null ? `${n(ordered * parseFloat(item.unit_price))} DH` : <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-14 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-orange-400' : 'bg-gray-300'}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-between pt-2 border-t text-sm">
            <span className="font-semibold text-gray-700">Total commande: <span className="text-lg">{n(totalOrdered)} DH</span></span>
            <span className="font-semibold text-green-700">Total livré: <span className="text-lg">{n(totalDelivered)} DH</span></span>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══ Delivery Confirmation Modal ═══ */
function DeliveryModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });

  const [deliveries, setDeliveries] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [lotInfo, setLotInfo] = useState<Record<string, { supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }>>({});
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState('');

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[]; supplierInvoiceNumber?: string; supplierInvoiceDate?: string }) =>
      purchaseOrdersApi.confirmDelivery(poId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['eligible-pos'] });
      notify.success('Réception confirmée — stock et facture mis à jour');
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la confirmation');
    },
  });

  if (isLoading) return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white p-8 rounded-2xl text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Loader2 className="animate-spin text-emerald-400 mx-auto mb-3" size={28} />
        <p className="text-sm text-gray-400">Chargement...</p>
      </div>
    </ModalBackdrop>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  // Cette reception va-t-elle completer entierement le BC ?
  // (impacte la creation automatique de la facture cote backend)
  const willCompletePO = items.every((item) => {
    const ordered = parseFloat(item.quantity_ordered);
    const alreadyDelivered = parseFloat(item.quantity_delivered);
    const beingDelivered = deliveries[item.id] || 0;
    return alreadyDelivered + beingDelivered >= ordered;
  });

  const handleSubmit = () => {
    const deliveredItems = Object.entries(deliveries)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, quantityDelivered]) => ({
        itemId, quantityDelivered,
        ...(prices[itemId] != null && prices[itemId] > 0 ? { unitPrice: prices[itemId] } : {}),
        ...lotInfo[itemId],
      }));
    if (deliveredItems.length === 0) { notify.error('Saisissez au moins une quantité livrée'); return; }
    // Si cette reception va creer la facture (livraison complete), on conseille
    // fortement le N° de facture fournisseur — sinon le systeme retombera
    // sur un numero auto-genere (legacy, non recommande).
    if (willCompletePO && !supplierInvoiceNumber.trim()) {
      const proceed = confirm(
        'Aucun N° de facture fournisseur saisi.\n\n' +
        'Cette réception va clôturer le BC et créer automatiquement la facture. ' +
        'Sans N° de facture fournisseur, le système générera un numéro interne ' +
        '(non recommandé — il vaut mieux saisir celui imprimé sur la facture papier).\n\n' +
        'Continuer sans le numéro ?'
      );
      if (!proceed) return;
    }
    confirmMutation.mutate({
      items: deliveredItems,
      ...(supplierInvoiceNumber.trim() ? { supplierInvoiceNumber: supplierInvoiceNumber.trim() } : {}),
      ...(supplierInvoiceDate ? { supplierInvoiceDate } : {}),
    });
  };

  const fillAll = () => {
    const filled: Record<string, number> = {};
    const filledPrices: Record<string, number> = {};
    items.forEach((item) => {
      const remaining = parseFloat(item.quantity_ordered) - parseFloat(item.quantity_delivered);
      if (remaining > 0) {
        filled[item.id] = remaining;
        if (item.unit_price != null) filledPrices[item.id] = parseFloat(item.unit_price);
      }
    });
    setDeliveries(filled);
    setPrices(prev => ({ ...prev, ...filledPrices }));
  };

  const totalDelivering = Object.entries(deliveries).reduce((sum, [itemId, qty]) => {
    const price = prices[itemId] ?? (() => { const item = items.find(it => it.id === itemId); return item?.unit_price != null ? parseFloat(item.unit_price) : 0; })();
    return sum + qty * price;
  }, 0);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50">
      <div className="bg-white w-full h-full flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-6 py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <PackageCheck size={20} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Confirmer la réception</h2>
                <p className="text-sm text-white/70">{po.order_number} — {po.supplier_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
          </div>
        </div>

        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Facture fournisseur — N° et date imprimes sur le document papier */}
          <div className={`rounded-xl p-4 border ${willCompletePO ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-start gap-2 mb-3">
              <FileText size={16} className={willCompletePO ? 'text-amber-600 mt-0.5' : 'text-gray-500 mt-0.5'} />
              <div className="flex-1">
                <h3 className={`text-sm font-semibold ${willCompletePO ? 'text-amber-800' : 'text-gray-700'}`}>
                  Facture fournisseur
                </h3>
                <p className={`text-xs mt-0.5 ${willCompletePO ? 'text-amber-700' : 'text-gray-500'}`}>
                  {willCompletePO
                    ? 'Cette réception va clôturer le BC. Saisis le N° imprimé sur la facture papier du fournisseur (il sera utilisé tel quel, pas auto-généré).'
                    : 'Optionnel pour une livraison partielle. Tu pourras le saisir lors de la livraison finale.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  N° facture fournisseur {willCompletePO && <span className="text-amber-600">*</span>}
                </label>
                <input type="text" value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  placeholder="Ex: FAC-2026-12345"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date de la facture</label>
                <input type="date" value={supplierInvoiceDate}
                  onChange={(e) => setSupplierInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white" />
              </div>
            </div>
          </div>

          {/* Fill all button */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Saisissez les quantités reçues pour chaque article</p>
            <button onClick={fillAll}
              className="text-sm text-emerald-700 font-medium flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors">
              <CheckCircle2 size={14} /> Tout reçu
            </button>
          </div>

          {/* Items */}
          <div className="border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1050px]">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ingrédient</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Commandé</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Déjà reçu</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Restant</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Qté reçue</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Prix U.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Total</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-24">Ref. lot</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">DLC</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide w-32">Date prod.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const alreadyDelivered = parseFloat(item.quantity_delivered);
                  const remaining = ordered - alreadyDelivered;
                  const isComplete = remaining <= 0;
                  return (
                    <tr key={item.id} className={isComplete ? 'bg-green-50/50' : ''}>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${isComplete ? 'text-green-600' : 'text-gray-700'}`}>
                          {item.ingredient_name}
                        </span>
                        <span className="text-gray-400 text-xs ml-1">({item.ingredient_unit})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{ordered}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={alreadyDelivered > 0 ? 'text-green-600 font-medium' : 'text-gray-400'}>{alreadyDelivered}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isComplete
                          ? <span className="text-green-600 font-medium flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Complet</span>
                          : <span className="font-semibold text-gray-700">{remaining}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="number" min={0} max={remaining} step="0.01"
                            value={deliveries[item.id] ?? ''}
                            onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="0" />
                        ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="number" min={0} step="0.01"
                            value={prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : '')}
                            onChange={(e) => setPrices({ ...prices, [item.id]: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Prix" />
                        ) : <span className="text-sm text-gray-400 text-right block">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {(() => {
                          const qty = deliveries[item.id] || 0;
                          const price = prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : 0);
                          const lineTotal = qty * price;
                          return lineTotal > 0
                            ? <span className="text-sm font-semibold text-gray-700">{n(lineTotal)}</span>
                            : <span className="text-sm text-gray-400">—</span>;
                        })()}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="text"
                            value={lotInfo[item.id]?.supplierLotNumber ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], supplierLotNumber: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Lot" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.expirationDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], expirationDate: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.manufacturedDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], manufacturedDate: e.target.value } })}
                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        ) : <span className="text-sm text-gray-400 text-center block">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of what's being received */}
          {totalDelivering > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-emerald-700 flex items-center gap-1.5">
                <ArrowRight size={14} />
                Valeur de cette réception
              </span>
              <span className="font-bold text-emerald-800">{n(totalDelivering)} DH</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex justify-end gap-2 shrink-0 bg-white">
          <button onClick={onClose}
            className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
            {confirmMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={16} />}
            {confirmMutation.isPending ? 'Confirmation...' : 'Confirmer la réception'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ Edit PO Modal (admin) ═══
 *
 * Edition complete d'un BC : en-tete (notes, date prevue) + lignes (qty
 * ordonnees, qty livrees, prix unitaires, ajout/suppression de lignes).
 *
 * - Save en-tete : appelle purchaseOrdersApi.updateHeader
 * - Save lignes : appelle purchaseOrdersApi.replaceItems (bulk save)
 * - Modifier qty_delivered ajuste automatiquement le stock (cf. backend
 *   replaceItems._adjustInventory) avec trace inventory_transactions type='adjustment'
 * - Suppression d'une ligne deja referencee par un bon de reception est refusee
 *   par le backend (erreur affichee). Il faut annuler la reception d'abord.
 */
type POLine = {
  id?: string;
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: string;
  quantityOrdered: string;
  quantityDelivered: string;
  unitPrice: string;
};

function EditPOModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients'], queryFn: ingredientsApi.list });

  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<POLine[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || !po) return;
    setSupplierId((po.supplier_id as string) || '');
    setExpectedDate(po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : '');
    setNotes((po.notes as string) || '');
    const items = (po.items as Record<string, any>[]) || [];
    setLines(items.map(it => ({
      id: it.id as string,
      ingredientId: it.ingredient_id as string,
      ingredientName: (it.ingredient_name as string) || '',
      ingredientUnit: (it.ingredient_unit as string) || '',
      quantityOrdered: String(it.quantity_ordered ?? ''),
      quantityDelivered: String(it.quantity_delivered ?? ''),
      unitPrice: it.unit_price != null ? String(it.unit_price) : '',
    })));
    setInitialized(true);
  }, [po, initialized]);

  const headerMutation = useMutation({
    mutationFn: (data: { supplierId?: string; expectedDeliveryDate?: string | null; notes?: string | null }) =>
      purchaseOrdersApi.updateHeader(poId, data),
  });
  const itemsMutation = useMutation({
    mutationFn: (items: Array<{ id?: string; ingredientId: string; quantityOrdered: number; quantityDelivered?: number; unitPrice?: number | null }>) =>
      purchaseOrdersApi.replaceItems(poId, items),
  });

  const newTotalOrdered = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantityOrdered) || 0;
      const p = parseFloat(l.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<POLine>) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const addLine = () => {
    setLines(prev => [...prev, {
      ingredientId: '', ingredientName: '', ingredientUnit: '',
      quantityOrdered: '1', quantityDelivered: '0', unitPrice: '',
    }]);
  };

  const handleSave = async () => {
    // Validation : toutes les lignes doivent avoir un ingredient et qty > 0
    if (lines.some(l => !l.ingredientId || (parseFloat(l.quantityOrdered) || 0) <= 0)) {
      notify.error('Chaque ligne doit avoir un ingredient et une quantite commandee > 0');
      return;
    }
    try {
      // 1. En-tete
      await headerMutation.mutateAsync({
        supplierId: supplierId || undefined,
        expectedDeliveryDate: expectedDate || null,
        notes: notes.trim() || null,
      });
      // 2. Lignes (bulk replace). Status BC + stock recalcules cote backend.
      await itemsMutation.mutateAsync(lines.map(l => ({
        id: l.id,
        ingredientId: l.ingredientId,
        quantityOrdered: parseFloat(l.quantityOrdered) || 0,
        quantityDelivered: parseFloat(l.quantityDelivered) || 0,
        unitPrice: l.unitPrice === '' ? null : (parseFloat(l.unitPrice) || 0),
      })));
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      notify.success('BC mis a jour');
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement');
    }
  };

  const isPending = headerMutation.isPending || itemsMutation.isPending;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1100, maxHeight: '92vh' }}>
        <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-6 py-4 rounded-t-2xl flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Pencil size={18} className="text-white" />
            <div>
              <h2 className="text-white font-bold text-lg">Modifier le BC</h2>
              <p className="text-white/80 text-xs">{po?.order_number as string || '...'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white hover:bg-white/20 p-2 rounded-xl"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 size={20} className="animate-spin mr-2" /> Chargement...
            </div>
          ) : (
            <>
              {/* En-tete */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Fournisseur</label>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="">—</option>
                    {(suppliers as Record<string, any>[]).filter(s => s.is_active || s.id === supplierId).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date livraison prevue</label>
                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Statut actuel</label>
                  <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
                    {(po?.status as string) || '—'}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Modifier la <strong>qty livree</strong> ajuste automatiquement le stock (mouvement
                  d'inventaire trace). Supprimer une ligne deja referencee par un bon de reception
                  sera refuse — annule la reception d'abord.
                </span>
              </div>

              {/* Lignes */}
              <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 900 }}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 uppercase tracking-wide">
                      <th className="text-left px-3 py-2 font-semibold" style={{ width: '28%' }}>Ingredient</th>
                      <th className="text-right px-3 py-2 font-semibold">Qty commandee</th>
                      <th className="text-right px-3 py-2 font-semibold">Qty livree</th>
                      <th className="text-right px-3 py-2 font-semibold">Prix U.</th>
                      <th className="text-right px-3 py-2 font-semibold">Sous-total</th>
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((line, idx) => {
                      const q = parseFloat(line.quantityOrdered) || 0;
                      const p = parseFloat(line.unitPrice) || 0;
                      const isExisting = !!line.id;
                      return (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            {isExisting ? (
                              <span className="text-sm text-gray-800">{line.ingredientName} <span className="text-xs text-gray-400">({line.ingredientUnit})</span></span>
                            ) : (
                              <select value={line.ingredientId}
                                onChange={e => {
                                  const ing = (ingredients as Record<string, any>[]).find(i => i.id === e.target.value);
                                  updateLine(idx, {
                                    ingredientId: e.target.value,
                                    ingredientName: ing ? (ing.name as string) : '',
                                    ingredientUnit: ing ? (ing.unit as string) : '',
                                  });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm">
                                <option value="">— Choisir —</option>
                                {(ingredients as Record<string, any>[]).map(i => (
                                  <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min={0} value={line.quantityOrdered}
                              onChange={e => updateLine(idx, { quantityOrdered: e.target.value })}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min={0} value={line.quantityDelivered}
                              onChange={e => updateLine(idx, { quantityDelivered: e.target.value })}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right bg-amber-50" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" step="0.01" min={0} value={line.unitPrice}
                              onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                              placeholder="—"
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right" />
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-gray-700">
                            {n(q * p)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button type="button" onClick={() => removeLine(idx)}
                              className="text-red-600 hover:bg-red-50 p-1 rounded" title="Supprimer">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={addLine}
                className="text-sm text-blue-600 inline-flex items-center gap-1 px-3 py-2 border border-dashed border-gray-300 rounded-lg hover:bg-blue-50">
                <Plus size={14} /> Ajouter une ligne
              </button>

              {/* Total */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-800">Nouveau total BC (qty commandee x prix)</span>
                <span className="font-bold text-blue-900 font-mono text-lg">{n(newTotalOrdered)} DH</span>
              </div>
            </>
          )}
        </div>

        <div className="border-t px-6 py-3 flex justify-end gap-2 shrink-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50">Annuler</button>
          <button onClick={handleSave} disabled={isPending || isLoading}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl text-sm font-medium shadow flex items-center gap-2">
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <CheckCircle2 size={14} /> Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
