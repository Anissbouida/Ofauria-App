import { useState, useMemo, useEffect, Fragment, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import { suppliersApi, invoicesApi } from '../../api/accounting.api';
import { ingredientsApi } from '../../api/inventory.api';
import {
  Plus, Send, PackageCheck, X, Trash2, AlertTriangle, Eye, Ban, PackageX,
  Truck, Search, ChevronDown, ChevronUp, ShoppingBag, Clock, CheckCircle2,
  Package, ArrowRight, FileText, Filter, Loader2, Download, Pencil, Receipt,
  Combine,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Normalise les valeurs du backend a 2 decimales (ex: "48.0000" -> "48.00", "25.8300" -> "25.83")
function trimNum(v: unknown): string {
  if (v == null || v === '') return '';
  const f = parseFloat(String(v));
  return Number.isFinite(f) ? f.toFixed(2) : '';
}

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

// Styles partagés pour les formulaires en style Odoo (cf. .odoo-scope dans index.css)
const odooLabelStyle: CSSProperties = {
  display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.03em', color: 'var(--odoo-text-muted)', marginBottom: 4,
};
const odooFieldStyle: CSSProperties = {
  width: '100%', padding: '0.375rem 0.5rem', border: '1px solid var(--odoo-border)',
  borderRadius: 4, fontSize: '0.8125rem', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};
const odooNumFieldStyle: CSSProperties = { ...odooFieldStyle, textAlign: 'right' };
const odooModalPanelStyle: CSSProperties = {
  backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
  borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};
const odooModalHeaderStyle: CSSProperties = {
  backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem',
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
  // Selection multi-BC pour fusionner leurs factures fournisseurs en une seule.
  const [selectedPoIds, setSelectedPoIds] = useState<Set<string>>(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);

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
  // Generation manuelle de facture : rattrapage quand l'auto-creation au
  // moment de la reception n'a pas eu lieu (typiquement prix saisis a posteriori).
  const generateInvoiceMutation = useMutation({
    mutationFn: purchaseOrdersApi.generateInvoice,
    onSuccess: (inv: { invoice_number?: string } | null) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success(`Facture ${inv?.invoice_number ?? ''} générée`);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message ?? 'Erreur lors de la génération de la facture');
    },
  });

  const mergeInvoicesMutation = useMutation({
    mutationFn: invoicesApi.merge,
    onSuccess: (inv: { invoice_number?: string } | null) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['debts'] });
      notify.success(`Factures fusionnees en ${inv?.invoice_number ?? ''}`);
      setSelectedPoIds(new Set());
      setShowMergeModal(false);
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      notify.error(err?.response?.data?.error?.message ?? 'Erreur lors de la fusion');
    },
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

  // Etat selection : eligibilite et validite pour fusion.
  // Un BC est eligible s'il a une facture liee OU des articles deja livres
  // (le backend creera une facture a la volee sur le perimetre livre).
  // Tous les selectionnes doivent etre du meme fournisseur.
  const selectedPOs = useMemo(
    () => allOrders.filter(po => selectedPoIds.has(po.id as string)),
    [allOrders, selectedPoIds]
  );
  const poIsEligible = (po: Record<string, any>) =>
    po.has_invoice || parseFloat((po.delivered_amount as string) || '0') > 0;
  const mergeSupplierIds = new Set(selectedPOs.map(po => po.supplier_id as string));
  const mergeReady = selectedPOs.length >= 2
    && mergeSupplierIds.size === 1
    && selectedPOs.every(poIsEligible);
  const mergeWarning = selectedPOs.length >= 2 && !mergeReady
    ? (mergeSupplierIds.size > 1
        ? 'Les BCs selectionnes doivent etre du meme fournisseur.'
        : 'Chaque BC selectionne doit avoir au moins une livraison partielle.')
    : '';

  const togglePoSelection = (po: Record<string, any>) => {
    const id = po.id as string;
    const next = new Set(selectedPoIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPoIds(next);
  };

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
        {selectedPoIds.size > 0 && (
          <>
            <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
              {selectedPoIds.size} BC selectionne{selectedPoIds.size > 1 ? 's' : ''}
            </span>
            <button onClick={() => setSelectedPoIds(new Set())} className="odoo-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="Tout deselectionner">
              <X size={13} />
            </button>
            <button onClick={() => setShowMergeModal(true)} disabled={!mergeReady}
              className="odoo-btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: mergeReady ? 1 : 0.5 }}
              title={mergeReady ? 'Fusionner les factures liees' : mergeWarning}>
              <Combine size={13} /> Fusionner les factures
            </button>
          </>
        )}
        <button onClick={() => setShowCreate(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau BC
        </button>
      </div>
      {mergeWarning && (
        <div className="odoo-alert" style={{ fontSize: '0.75rem' }}>
          <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} />
          {mergeWarning}
        </div>
      )}

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
                <th style={{ width: 28 }} title="Cocher pour fusionner les factures liees"></th>
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
                      <td onClick={e => e.stopPropagation()}>
                        {(() => {
                          const eligible = poIsEligible(po);
                          return (
                            <input type="checkbox"
                              checked={selectedPoIds.has(po.id as string)}
                              onChange={() => togglePoSelection(po)}
                              disabled={!eligible}
                              title={eligible
                                ? (po.has_invoice ? 'Selectionner pour fusion' : 'Selectionner — la facture sera generee a la fusion')
                                : 'Aucun article livre — fusion impossible'}
                              style={{ cursor: eligible ? 'pointer' : 'not-allowed' }} />
                          );
                        })()}
                      </td>
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
                          {/* Generer la facture : seulement si BC livre_complet sans facture liee.
                              Rattrapage des cas ou la facture auto n'a pas ete creee
                              (typiquement prix saisis apres la reception). */}
                          {status === 'livre_complet' && !po.has_invoice && (
                            <button
                              onClick={() => {
                                if (confirm(`Générer la facture pour le BC ${po.order_number} ?`)) {
                                  generateInvoiceMutation.mutate(po.id as string);
                                }
                              }}
                              title="Générer la facture"
                              className="odoo-pager-btn"
                              disabled={generateInvoiceMutation.isPending}
                              style={{ color: '#7c3aed' }}
                            >
                              <Receipt size={13} />
                            </button>
                          )}
                          {/* Edition complete (admin/gerant) : qty/prix/lignes. Dispo sur tous statuts. */}
                          <button onClick={() => setEditPoId(po.id as string)} title="Modifier le BC (qty, prix, lignes)" className="odoo-pager-btn">
                            <Pencil size={13} />
                          </button>
                          {/* Suppression definitive : seulement en_attente ou annule. */}
                          {(status === 'en_attente' || status === 'annule') && (
                            <button
                              onClick={() => { if (confirm(`Supprimer definitivement le BC ${po.order_number} ?`)) deleteMutation.mutate(po.id as string); }}
                              title="Supprimer le BC"
                              className="odoo-pager-btn"
                              style={{ color: '#dc3545' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
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
      {showMergeModal && (
        <MergeInvoicesModal
          selectedPOs={selectedPOs}
          isPending={mergeInvoicesMutation.isPending}
          onClose={() => setShowMergeModal(false)}
          onConfirm={(data) => mergeInvoicesMutation.mutate({
            purchaseOrderIds: Array.from(selectedPoIds),
            supplierInvoiceNumber: data.supplierInvoiceNumber || undefined,
            invoiceDate: data.invoiceDate || undefined,
          })}
        />
      )}
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}
        style={odooModalPanelStyle}>
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between z-10" style={odooModalHeaderStyle}>
          <div className="flex items-center gap-3">
            <ShoppingBag size={16} style={{ color: '#fff' }} />
            <div>
              <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Nouveau bon de commande</h2>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>Commande fournisseur avec les articles souhaités</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-5">
          {/* Supplier + Date */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label style={odooLabelStyle}>Fournisseur *</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={odooFieldStyle}>
                <option value="">Choisir un fournisseur</option>
                {(suppliers as Record<string, any>[]).filter((s) => s.is_active !== false).map((s) => (
                  <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={odooLabelStyle}>Livraison prévue</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={odooFieldStyle} />
            </div>
            <div>
              <label style={odooLabelStyle}>Notes</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} style={odooFieldStyle} placeholder="Optionnel..." />
            </div>
          </div>

          {/* Add ingredient search */}
          <div>
            <label style={odooLabelStyle}>Ajouter des articles</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--odoo-text-muted)' }} />
                <input type="text" placeholder="Chercher un ingrédient..."
                  value={searchIngredient} onChange={e => setSearchIngredient(e.target.value)}
                  style={{ ...odooFieldStyle, paddingLeft: 30 }} />
              </div>
              <button onClick={() => { setShowNewIngredient(true); setNewIng({ name: searchIngredient || '', unit: 'kg', category: 'autre', unitCost: '' }); }}
                className="odoo-btn-secondary whitespace-nowrap shrink-0" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Nouvel ingrédient
              </button>
            </div>
            {searchIngredient && filteredIngredients.length > 0 && (
              <div style={{ marginTop: 4, backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)', borderRadius: 4, maxHeight: 192, overflowY: 'auto' }}>
                {filteredIngredients.slice(0, 10).map(ing => (
                  <button key={ing.id as string} onClick={() => addIngredient(ing)}
                    className="w-full text-left text-sm flex items-center justify-between hover:bg-gray-50"
                    style={{ padding: '0.5rem 0.75rem' }}>
                    <span className="font-medium">{ing.name as string} <span style={{ color: 'var(--odoo-text-muted)' }}>({ing.unit as string})</span></span>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{n(parseFloat(ing.unit_cost as string) || 0)} DH/{ing.unit as string}</span>
                  </button>
                ))}
              </div>
            )}
            {searchIngredient && filteredIngredients.length === 0 && !showNewIngredient && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', marginTop: 8 }}>Aucun ingrédient trouvé</p>
            )}
            {showNewIngredient && (
              <div style={{ marginTop: 12, backgroundColor: 'var(--odoo-bg-alt)', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '1rem' }} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--odoo-text)' }}>
                    <Plus size={14} /> Nouvel ingrédient
                  </h4>
                  <button onClick={() => setShowNewIngredient(false)} className="hover:bg-gray-100" style={{ padding: 4, borderRadius: 4, color: 'var(--odoo-text-muted)' }}>
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label style={odooLabelStyle}>Nom *</label>
                    <input type="text" value={newIng.name} onChange={e => setNewIng({ ...newIng, name: e.target.value })}
                      style={odooFieldStyle} placeholder="Ex: Farine T55" />
                  </div>
                  <div>
                    <label style={odooLabelStyle}>Unité *</label>
                    <select value={newIng.unit} onChange={e => setNewIng({ ...newIng, unit: e.target.value })} style={odooFieldStyle}>
                      {unitEntries.map(u => (
                        <option key={u.code} value={u.code}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={odooLabelStyle}>Catégorie</label>
                    <select value={newIng.category} onChange={e => setNewIng({ ...newIng, category: e.target.value })} style={odooFieldStyle}>
                      {ingredientCats.map(c => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={odooLabelStyle}>Coût unitaire (DH)</label>
                    <input type="number" step="0.01" min="0" value={newIng.unitCost} onChange={e => setNewIng({ ...newIng, unitCost: e.target.value })}
                      style={odooFieldStyle} placeholder="Optionnel" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowNewIngredient(false)} className="odoo-btn-secondary">Annuler</button>
                  <button onClick={handleCreateIngredient} disabled={createIngredientMutation.isPending}
                    className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {createIngredientMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={14} />}
                    {createIngredientMutation.isPending ? 'Création...' : 'Créer et ajouter'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Ingrédient</th>
                    <th style={{ textAlign: 'right', width: 128 }}>Quantité</th>
                    <th style={{ textAlign: 'right', width: 128 }}>Prix unit. (DH)</th>
                    <th style={{ textAlign: 'right', width: 112 }}>Sous-total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.ingredientId}>
                      <td>
                        <span className="font-medium">{item.ingredientName}</span>
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({item.unit})</span>
                      </td>
                      <td>
                        <input type="number" min={0.01} step="0.01" value={item.quantityOrdered || ''}
                          onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)}
                          style={odooNumFieldStyle} />
                      </td>
                      <td>
                        <input type="number" min={0} step="0.01" value={item.unitPrice ?? ''}
                          onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                          placeholder="Optionnel"
                          style={odooNumFieldStyle} />
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {item.unitPrice ? n(item.quantityOrdered * item.unitPrice) : <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem' }}>À définir</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => removeItem(idx)} className="odoo-btn-danger" title="Retirer" style={{ padding: '0.25rem 0.4rem' }}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between"
                style={{ backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', borderTop: '1px solid var(--odoo-border)', padding: '0.625rem 0.875rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--theme-accent)', fontWeight: 600 }}>
                  {items.length} article{items.length > 1 ? 's' : ''}
                  {hasMissingPrices && <span style={{ marginLeft: 8, color: '#b85d1a', fontSize: '0.6875rem' }}>(prix à définir par le fournisseur)</span>}
                </span>
                <span style={{ fontWeight: 700, color: 'var(--theme-accent)' }}>{totalAmount > 0 ? `Total: ${n(totalAmount)} DH` : 'Prix à définir'}</span>
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center"
              style={{ padding: '2.5rem 0', backgroundColor: 'var(--odoo-bg-alt)', borderRadius: 4, border: '1px dashed var(--odoo-border)' }}>
              <ShoppingBag size={24} style={{ color: 'var(--odoo-text-light)', marginBottom: 8 }} />
              <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Recherchez et ajoutez des ingrédients ci-dessus</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex justify-between items-center"
          style={{ backgroundColor: 'var(--odoo-bg)', borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem' }}>
          <div>
            {items.length > 0 && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{items.length} article{items.length > 1 ? 's' : ''} — <span style={{ fontWeight: 700, color: 'var(--odoo-text)' }}>{n(totalAmount)} DH</span></p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button onClick={handleSubmit} disabled={createMutation.isPending || items.length === 0}
              className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="odoo-scope text-center" style={{ ...odooModalPanelStyle, padding: '2rem' }} onClick={(e) => e.stopPropagation()}>
        <Loader2 className="animate-spin mx-auto mb-3" size={28} style={{ color: 'var(--odoo-text-muted)' }} />
        <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Chargement...</p>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={odooModalPanelStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={odooModalHeaderStyle}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1.05rem', margin: 0 }}>{po.order_number}</h2>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold ${STATUS_COLORS[po.status] || ''}`}>
                  <StatusIcon size={12} />
                  {STATUS_LABELS[po.status] || po.status}
                </span>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', marginTop: 2 }}>
                {po.supplier_name} — Créé par {po.created_by_name}
              </p>
            </div>
            <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-4">
          {/* Info cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Commande', value: format(new Date(po.order_date), 'dd MMM yyyy', { locale: fr }) },
              { label: 'Livraison prévue', value: po.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'dd MMM yyyy', { locale: fr }) : '—' },
              { label: 'Date livraison', value: po.delivery_date ? format(new Date(po.delivery_date), 'dd MMM yyyy', { locale: fr }) : '—' },
            ].map(card => (
              <div key={card.label} style={{ backgroundColor: 'var(--odoo-bg-alt)', borderRadius: 4, padding: '0.625rem 0.75rem', border: '1px solid var(--odoo-border)' }}>
                <p style={{ ...odooLabelStyle, marginBottom: 2 }}>{card.label}</p>
                <p style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Global progress */}
          {(po.status === 'livre_partiel' || po.status === 'livre_complet') && (
            <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '0.875rem' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--odoo-text-muted)' }}>Progression globale</span>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700 }}>{globalPct.toFixed(0)}%</span>
              </div>
              <div style={{ width: '100%', height: 8, backgroundColor: 'var(--odoo-bg-alt)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 999, width: `${Math.min(100, globalPct)}%`, backgroundColor: globalPct >= 100 ? '#28a745' : '#e6892b' }} />
              </div>
              <div className="flex justify-between" style={{ marginTop: 8, fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
                <span>Commande: {n(totalOrdered)} DH</span>
                <span>Livré: {n(totalDelivered)} DH</span>
              </div>
            </div>
          )}

          {po.notes && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.8125rem', backgroundColor: '#fff8e8', color: '#856404', border: '1px solid #ffeeba' }}>
              <FileText size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {po.notes}
            </div>
          )}

          {/* Items table */}
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' }}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th>Ingrédient</th>
                  <th style={{ textAlign: 'right' }}>Commandé</th>
                  <th style={{ textAlign: 'right' }}>Livré</th>
                  <th style={{ textAlign: 'right' }}>Prix unit.</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right', width: 112 }}>État</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const delivered = parseFloat(item.quantity_delivered);
                  const pct = ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0;
                  return (
                    <tr key={item.id}>
                      <td className="font-medium">{item.ingredient_name}
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({item.ingredient_unit})</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{ordered}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ color: delivered > 0 ? '#28a745' : 'var(--odoo-text-muted)', fontWeight: delivered > 0 ? 500 : 400 }}>{delivered}</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{item.unit_price != null ? `${n(parseFloat(item.unit_price))} DH` : <span style={{ color: '#e6892b', fontSize: '0.6875rem' }}>À définir</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{item.unit_price != null ? `${n(ordered * parseFloat(item.unit_price))} DH` : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>}</td>
                      <td>
                        <div className="flex items-center gap-2 justify-end">
                          <div style={{ width: 56, height: 8, backgroundColor: 'var(--odoo-bg-alt)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, backgroundColor: pct >= 100 ? '#28a745' : pct > 0 ? '#e6892b' : 'var(--odoo-border)' }} />
                          </div>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', width: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-between" style={{ paddingTop: 8, borderTop: '1px solid var(--odoo-border)', fontSize: '0.8125rem' }}>
            <span style={{ fontWeight: 600 }}>Total commande: <span style={{ fontSize: '1.05rem' }}>{n(totalOrdered)} DH</span></span>
            <span style={{ fontWeight: 600, color: '#28a745' }}>Total livré: <span style={{ fontSize: '1.05rem' }}>{n(totalDelivered)} DH</span></span>
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
  // forceComplete : le fournisseur ne livrera pas le reste. Le BC est cloture
  // sur ce qui a ete recu (qty_ordered alignee sur qty_delivered, lignes vides
  // supprimees).
  const [forceComplete, setForceComplete] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: (data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[]; supplierInvoiceNumber?: string; supplierInvoiceDate?: string; forceComplete?: boolean }) =>
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="odoo-scope text-center" style={{ ...odooModalPanelStyle, padding: '2rem' }} onClick={(e) => e.stopPropagation()}>
        <Loader2 className="animate-spin mx-auto mb-3" size={28} style={{ color: 'var(--odoo-text-muted)' }} />
        <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Chargement...</p>
      </div>
    </ModalBackdrop>
  );
  if (!po) return null;

  const items = (po.items || []) as POItem[];

  // Cette reception va-t-elle completer entierement le BC ?
  // (impacte la creation automatique de la facture cote backend)
  // forceComplete : on cloture meme si la couverture n'est pas totale.
  const naturallyComplete = items.every((item) => {
    const ordered = parseFloat(item.quantity_ordered);
    const alreadyDelivered = parseFloat(item.quantity_delivered);
    const beingDelivered = deliveries[item.id] || 0;
    return alreadyDelivered + beingDelivered >= ordered;
  });
  const willCompletePO = naturallyComplete || forceComplete;

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
      ...(forceComplete ? { forceComplete: true } : {}),
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
    <div className="fixed inset-0 bg-black/40 z-50">
      <div className="odoo-scope w-full h-full flex flex-col" style={{ backgroundColor: 'var(--odoo-bg)' }}>
        {/* Header */}
        <div className="shrink-0" style={odooModalHeaderStyle}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PackageCheck size={18} style={{ color: '#fff' }} />
              <div>
                <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Confirmer la réception</h2>
                <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>{po.order_number} — {po.supplier_name}</p>
              </div>
            </div>
            <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-4 flex-1 overflow-y-auto">
          {/* Force-complete : le fournisseur ne livrera pas le reste, on
              cloture le BC sur ce qui est recu et la facture est emise sur ce
              perimetre. */}
          {!naturallyComplete && (
            <label className="flex items-start gap-3 cursor-pointer"
              style={{ borderRadius: 4, padding: '0.75rem', border: `1px solid ${forceComplete ? '#f0b27a' : 'var(--odoo-border)'}`, backgroundColor: forceComplete ? '#fff3e6' : 'var(--odoo-bg-alt)' }}>
              <input type="checkbox" checked={forceComplete}
                onChange={e => setForceComplete(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#e6892b' }} />
              <div className="flex-1">
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: forceComplete ? '#b85d1a' : 'var(--odoo-text)' }}>
                  Clôturer le BC : le fournisseur ne livrera pas le reste
                </div>
                <div style={{ fontSize: '0.6875rem', marginTop: 2, color: forceComplete ? '#b85d1a' : 'var(--odoo-text-muted)' }}>
                  Les lignes non livrées sont supprimées du BC, les lignes partielles sont alignées sur la quantité reçue. La facture est créée sur ce périmètre.
                </div>
              </div>
            </label>
          )}

          {/* Facture fournisseur — N° et date imprimes sur le document papier */}
          <div style={{ borderRadius: 4, padding: '1rem', border: `1px solid ${willCompletePO ? '#ffeeba' : 'var(--odoo-border)'}`, backgroundColor: willCompletePO ? '#fff8e8' : 'var(--odoo-bg-alt)' }}>
            <div className="flex items-start gap-2" style={{ marginBottom: 12 }}>
              <FileText size={16} style={{ marginTop: 2, color: willCompletePO ? '#b8860b' : 'var(--odoo-text-muted)' }} />
              <div className="flex-1">
                <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: willCompletePO ? '#856404' : 'var(--odoo-text)' }}>
                  Facture fournisseur
                </h3>
                <p style={{ fontSize: '0.6875rem', marginTop: 2, color: willCompletePO ? '#856404' : 'var(--odoo-text-muted)' }}>
                  {willCompletePO
                    ? 'Cette réception va clôturer le BC. Saisis le N° imprimé sur la facture papier du fournisseur (il sera utilisé tel quel, pas auto-généré).'
                    : 'Optionnel pour une livraison partielle. Tu pourras le saisir lors de la livraison finale.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label style={odooLabelStyle}>
                  N° facture fournisseur {willCompletePO && <span style={{ color: '#b8860b' }}>*</span>}
                </label>
                <input type="text" value={supplierInvoiceNumber}
                  onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                  placeholder="Ex: FAC-2026-12345" style={odooFieldStyle} />
              </div>
              <div>
                <label style={odooLabelStyle}>Date de la facture</label>
                <input type="date" value={supplierInvoiceDate}
                  onChange={(e) => setSupplierInvoiceDate(e.target.value)} style={odooFieldStyle} />
              </div>
            </div>
          </div>

          {/* Fill all button */}
          <div className="flex justify-between items-center">
            <p style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Saisissez les quantités reçues pour chaque article</p>
            <button onClick={fillAll} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} /> Tout reçu
            </button>
          </div>

          {/* Items */}
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
            <table className="odoo-table" style={{ minWidth: 1050 }}>
              <thead>
                <tr>
                  <th>Ingrédient</th>
                  <th style={{ textAlign: 'right' }}>Commandé</th>
                  <th style={{ textAlign: 'right' }}>Déjà reçu</th>
                  <th style={{ textAlign: 'right' }}>Restant</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Qté reçue</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Prix U.</th>
                  <th style={{ textAlign: 'right', width: 96 }}>Total</th>
                  <th style={{ textAlign: 'center', width: 96 }}>Ref. lot</th>
                  <th style={{ textAlign: 'center', width: 128 }}>DLC</th>
                  <th style={{ textAlign: 'center', width: 128 }}>Date prod.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const ordered = parseFloat(item.quantity_ordered);
                  const alreadyDelivered = parseFloat(item.quantity_delivered);
                  const remaining = ordered - alreadyDelivered;
                  const isComplete = remaining <= 0;
                  return (
                    <tr key={item.id} style={isComplete ? { backgroundColor: '#f0fbf3' } : undefined}>
                      <td>
                        <span style={{ fontWeight: 500, color: isComplete ? '#28a745' : 'var(--odoo-text)' }}>
                          {item.ingredient_name}
                        </span>
                        <span style={{ color: 'var(--odoo-text-muted)', fontSize: '0.6875rem', marginLeft: 4 }}>({item.ingredient_unit})</span>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{ordered}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ color: alreadyDelivered > 0 ? '#28a745' : 'var(--odoo-text-muted)', fontWeight: alreadyDelivered > 0 ? 500 : 400 }}>{alreadyDelivered}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isComplete
                          ? <span style={{ color: '#28a745', fontWeight: 500 }} className="flex items-center justify-end gap-1"><CheckCircle2 size={14} /> Complet</span>
                          : <span style={{ fontWeight: 600 }}>{remaining}</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="number" min={0} max={remaining} step="0.01"
                            value={deliveries[item.id] ?? ''}
                            onChange={(e) => setDeliveries({ ...deliveries, [item.id]: parseFloat(e.target.value) || 0 })}
                            style={{ ...odooNumFieldStyle, backgroundColor: '#fff8e8' }} placeholder="0" />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'right' }}>—</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="number" min={0} step="0.01"
                            value={prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : '')}
                            onChange={(e) => setPrices({ ...prices, [item.id]: parseFloat(e.target.value) || 0 })}
                            style={odooNumFieldStyle} placeholder="Prix" />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'right' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {(() => {
                          const qty = deliveries[item.id] || 0;
                          const price = prices[item.id] ?? (item.unit_price != null ? parseFloat(item.unit_price) : 0);
                          const lineTotal = qty * price;
                          return lineTotal > 0
                            ? <span style={{ fontWeight: 600 }}>{n(lineTotal)}</span>
                            : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>;
                        })()}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="text"
                            value={lotInfo[item.id]?.supplierLotNumber ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], supplierLotNumber: e.target.value } })}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem' }} placeholder="Lot" />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.expirationDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], expirationDate: e.target.value } })}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem' }} />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                      <td>
                        {!isComplete ? (
                          <input type="date"
                            value={lotInfo[item.id]?.manufacturedDate ?? ''}
                            onChange={(e) => setLotInfo({ ...lotInfo, [item.id]: { ...lotInfo[item.id], manufacturedDate: e.target.value } })}
                            style={{ ...odooFieldStyle, fontSize: '0.75rem' }} />
                        ) : <span style={{ color: 'var(--odoo-text-muted)', display: 'block', textAlign: 'center' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of what's being received */}
          {totalDelivering > 0 && (
            <div className="flex items-center justify-between"
              style={{ backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '0.625rem 0.875rem' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--theme-accent)', fontWeight: 600 }} className="flex items-center gap-1.5">
                <ArrowRight size={14} />
                Valeur de cette réception
              </span>
              <span style={{ fontWeight: 700, color: 'var(--theme-accent)' }}>{n(totalDelivering)} DH</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={handleSubmit} disabled={confirmMutation.isPending}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
      quantityOrdered: trimNum(it.quantity_ordered),
      quantityDelivered: trimNum(it.quantity_delivered),
      unitPrice: it.unit_price != null ? trimNum(it.unit_price) : '',
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
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="odoo-scope flex flex-col" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 1100, maxHeight: '92vh', backgroundColor: 'var(--odoo-bg)',
          border: '1px solid var(--odoo-border)', borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
        {/* Header */}
        <div className="flex items-center justify-between shrink-0"
          style={{ backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem' }}>
          <div className="flex items-center gap-3">
            <Pencil size={16} style={{ color: '#fff' }} />
            <div>
              <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Modifier le bon de commande</h2>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.75rem', margin: 0 }}>{po?.order_number as string || '...'}</p>
            </div>
          </div>
          <button onClick={onClose} className="hover:bg-white/20"
            style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: '1.25rem' }}>
          {isLoading ? (
            <div className="flex items-center justify-center" style={{ padding: '2.5rem 0', color: 'var(--odoo-text-muted)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginRight: 8 }} /> Chargement...
            </div>
          ) : (
            <>
              {/* En-tete */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label style={odooLabelStyle}>Fournisseur</label>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={odooFieldStyle}>
                    <option value="">—</option>
                    {(suppliers as Record<string, any>[]).filter(s => s.is_active || s.id === supplierId).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={odooLabelStyle}>Date livraison prévue</label>
                  <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={odooFieldStyle} />
                </div>
                <div>
                  <label style={odooLabelStyle}>Statut actuel</label>
                  <div style={{ ...odooFieldStyle, display: 'flex', alignItems: 'center', minHeight: 34 }}>
                    {po?.status ? (() => {
                      const Icon = STATUS_ICONS[po.status as string];
                      return (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${STATUS_COLORS[po.status as string] || 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {Icon && <Icon size={12} />}
                          {STATUS_LABELS[po.status as string] || (po.status as string)}
                        </span>
                      );
                    })() : <span style={{ color: 'var(--odoo-text-muted)' }}>—</span>}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={odooLabelStyle}>Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  style={{ ...odooFieldStyle, resize: 'vertical' }} />
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.75rem',
                backgroundColor: '#fff8e8', color: '#856404', border: '1px solid #ffeeba' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Modifier la <strong>qté livrée</strong> ajuste automatiquement le stock (mouvement
                  d'inventaire tracé). Supprimer une ligne déjà référencée par un bon de réception
                  sera refusé — annule la réception d'abord.
                </span>
              </div>

              {/* Lignes */}
              <div style={{ marginTop: 12, border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
                <table className="odoo-table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Ingrédient</th>
                      <th style={{ textAlign: 'right' }}>Qté commandée</th>
                      <th style={{ textAlign: 'right' }}>Qté livrée</th>
                      <th style={{ textAlign: 'right' }}>Prix U.</th>
                      <th style={{ textAlign: 'right' }}>Sous-total</th>
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const q = parseFloat(line.quantityOrdered) || 0;
                      const p = parseFloat(line.unitPrice) || 0;
                      const isExisting = !!line.id;
                      return (
                        <tr key={idx}>
                          <td>
                            {isExisting ? (
                              <span style={{ fontWeight: 500 }}>{line.ingredientName} <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>({line.ingredientUnit})</span></span>
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
                                style={odooFieldStyle}>
                                <option value="">— Choisir —</option>
                                {(ingredients as Record<string, any>[]).map(i => (
                                  <option key={i.id as string} value={i.id as string}>{i.name as string}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.quantityOrdered}
                              onChange={e => updateLine(idx, { quantityOrdered: e.target.value })}
                              style={odooNumFieldStyle} />
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.quantityDelivered}
                              onChange={e => updateLine(idx, { quantityDelivered: e.target.value })}
                              style={{ ...odooNumFieldStyle, backgroundColor: '#fff8e8' }} />
                          </td>
                          <td>
                            <input type="number" step="0.01" min={0} value={line.unitPrice}
                              onChange={e => updateLine(idx, { unitPrice: e.target.value })}
                              placeholder="—"
                              style={odooNumFieldStyle} />
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}>
                            {n(q * p)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" onClick={() => removeLine(idx)}
                              className="odoo-btn-danger" title="Supprimer"
                              style={{ padding: '0.25rem 0.4rem' }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <button type="button" onClick={addLine} className="odoo-btn-secondary"
                style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Ajouter une ligne
              </button>

              {/* Total */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.625rem 0.875rem', borderRadius: 4,
                backgroundColor: 'var(--theme-accent-light, rgba(0,0,0,0.04))', border: '1px solid var(--odoo-border)' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-accent)' }}>Nouveau total BC (qté commandée × prix)</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace', fontSize: '1.0625rem', color: 'var(--theme-accent)' }}>{n(newTotalOrdered)} DH</span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={handleSave} disabled={isPending || isLoading}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <CheckCircle2 size={14} /> Enregistrer
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══ Merge Invoices Modal ═══
   Confirme la fusion des factures liees aux BCs selectionnes. L'utilisateur
   peut fournir le N° facture fournisseur consolide et la date.
*/
function MergeInvoicesModal({
  selectedPOs, isPending, onClose, onConfirm,
}: {
  selectedPOs: Record<string, any>[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (data: { supplierInvoiceNumber: string; invoiceDate: string }) => void;
}) {
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const totalAmount = selectedPOs.reduce((s, po) => s + (parseFloat(po.total_amount as string) || 0), 0);
  const supplierName = selectedPOs[0]?.supplier_name as string || '';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope w-full max-w-lg flex flex-col" style={odooModalPanelStyle} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={odooModalHeaderStyle}>
          <div className="flex items-center gap-2">
            <Combine size={16} style={{ color: '#fff' }} />
            <h2 style={{ color: '#fff', fontWeight: 600, fontSize: '1rem', margin: 0 }}>Fusionner les factures</h2>
          </div>
          <button onClick={onClose} className="hover:bg-white/20" style={{ color: '#fff', padding: 6, borderRadius: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: '1.25rem' }} className="space-y-4">
          <div style={{ display: 'flex', gap: 8, padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.75rem', backgroundColor: '#fff8e8', color: '#856404', border: '1px solid #ffeeba' }}>
            <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 2 }} />
            <div>
              Cette action remplace plusieurs factures par une seule, en additionnant les lignes et les montants.
              Refus si l'une des factures a déjà un paiement enregistré.
            </div>
          </div>

          <div>
            <div style={odooLabelStyle}>Fournisseur</div>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{supplierName}</div>
          </div>

          <div>
            <div style={odooLabelStyle}>BCs à fusionner ({selectedPOs.length})</div>
            <div style={{ backgroundColor: 'var(--odoo-bg-alt)', border: '1px solid var(--odoo-border)', borderRadius: 4, padding: '0.75rem', maxHeight: 192, overflow: 'auto' }} className="space-y-1">
              {selectedPOs.map(po => (
                <div key={po.id as string} className="flex justify-between" style={{ fontSize: '0.75rem' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{po.order_number as string}</span>
                  <span style={{ fontWeight: 600 }}>{n(parseFloat(po.total_amount as string))} DH</span>
                </div>
              ))}
              <div className="flex justify-between" style={{ fontSize: '0.8125rem', fontWeight: 700, paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--odoo-border)' }}>
                <span>Total fusionné</span>
                <span>{n(totalAmount)} DH</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={odooLabelStyle}>N° facture fournisseur</label>
              <input type="text" value={supplierInvoiceNumber}
                onChange={e => setSupplierInvoiceNumber(e.target.value)}
                placeholder="Optionnel" style={odooFieldStyle} />
            </div>
            <div>
              <label style={odooLabelStyle}>Date facture</label>
              <input type="date" value={invoiceDate}
                onChange={e => setInvoiceDate(e.target.value)} style={odooFieldStyle} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2" style={{ borderTop: '1px solid var(--odoo-border)', padding: '0.75rem 1.25rem', backgroundColor: 'var(--odoo-bg)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => onConfirm({ supplierInvoiceNumber, invoiceDate })}
            disabled={isPending}
            className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            <Combine size={14} /> Confirmer la fusion
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
