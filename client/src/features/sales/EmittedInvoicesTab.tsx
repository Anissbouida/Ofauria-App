import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, paymentsApi } from '../../api/accounting.api';
import { customersApi } from '../../api/customers.api';
import { ordersApi } from '../../api/orders.api';
import { productsApi } from '../../api/products.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, X, Check, Download, ChevronRight, ChevronDown,
  ShoppingCart, Receipt, Loader2, Search, Coins,
  BarChart3, Users, Banknote,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(val: number): string {
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ Composant recherche produit intelligent ═══ */
function ProductSearchInput({ products, value, onSelect, onChange }: {
  products: Record<string, any>[]; value: string;
  onSelect: (product: Record<string, any>) => void; onChange: (val: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setIsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query || query.length < 1) return products.slice(0, 10);
    const q = query.toLowerCase();
    return products.filter(p => {
      const name = (p.name as string || '').toLowerCase();
      const cat = (p.category_name as string || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    }).slice(0, 10);
  }, [query, products]);

  const handleSelect = (product: Record<string, any>) => { setQuery(product.name as string); setIsOpen(false); onSelect(product); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlightIdx]) { e.preventDefault(); handleSelect(filtered[highlightIdx]); }
    else if (e.key === 'Escape') { setIsOpen(false); }
  };

  return (
    <div ref={wrapperRef} className="flex-1 relative">
      <div className="relative">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input ref={inputRef} type="text" placeholder="Rechercher un produit..." value={query}
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); setIsOpen(true); setHighlightIdx(0); }}
          onFocus={() => setIsOpen(true)} onKeyDown={handleKeyDown}
          className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filtered.map((p, i) => (
            <button key={p.id as string} type="button" onClick={() => handleSelect(p)} onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${i === highlightIdx ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{p.name as string}</p>
                {p.category_name && <p className="text-[10px] text-gray-400">{p.category_name as string}</p>}
              </div>
              <span className="text-sm font-bold text-blue-600 ml-2 flex-shrink-0">{n(parseFloat(p.price as string) || 0)} DH</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Factures émises (clients) ═══ */
export default function EmittedInvoicesTab() {
  const queryClient = useQueryClient();
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createMode, setCreateMode] = useState<'order' | 'manual'>('order');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [showPayModal, setShowPayModal] = useState<Record<string, any> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualDate, setManualDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [manualNotes, setManualNotes] = useState('');
  // tvaRate : taux TVA de la ligne en % (null = pas de TVA explicite).
  const [manualItems, setManualItems] = useState<{ productId: string; description: string; quantity: number; unitPrice: number; tvaRate: number | null }[]>([
    { productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null },
  ]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'emitted', statusFilter],
    queryFn: () => invoicesApi.list({ invoiceType: 'emitted', ...(statusFilter ? { status: statusFilter } : {}) }),
  });

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const customers = ((customersData as Record<string, any>)?.data || customersData || []) as Record<string, any>[];

  const { data: ordersData } = useQuery({
    queryKey: ['orders-for-invoice'],
    queryFn: () => ordersApi.list(),
    enabled: showCreateModal,
  });
  const orders = ((ordersData as Record<string, any>)?.data || ordersData || []) as Record<string, any>[];

  const createFromOrderMutation = useMutation({
    mutationFn: (orderId: string) => invoicesApi.createFromOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Facture émise créée');
      setShowCreateModal(false);
      setSelectedOrderId('');
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const createManualMutation = useMutation({
    mutationFn: (data: Record<string, any>) => invoicesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Facture émise créée');
      setShowCreateModal(false);
      resetManualForm();
    },
    onError: () => notify.error('Erreur lors de la création'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture annulée'); },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Encaissement enregistré');
      setShowPayModal(null);
    },
    onError: () => notify.error('Erreur'),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-for-invoice'],
    queryFn: () => productsApi.list({ limit: '500' }),
    enabled: showCreateModal && createMode === 'manual',
  });
  const products = ((productsData as Record<string, any>)?.data || productsData || []) as Record<string, any>[];

  const resetManualForm = () => {
    setManualCustomerId('');
    setManualDate(format(new Date(), 'yyyy-MM-dd'));
    setManualNotes('');
    setManualItems([{ productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null }]);
  };

  const addManualItem = () => setManualItems([...manualItems, { productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null }]);
  const removeManualItem = (idx: number) => setManualItems(manualItems.filter((_, i) => i !== idx));
  const updateManualItem = (idx: number, field: string, value: string | number | null) => {
    const updated = [...manualItems];
    (updated[idx] as Record<string, any>)[field] = value;
    setManualItems(updated);
  };

  const manualTotal = manualItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  // TVA ventilee par ligne : somme des (sous-total x taux). Lignes sans taux = 0.
  const manualTva = Math.round(manualItems.reduce((s, it) => {
    if (it.tvaRate === null) return s;
    return s + it.quantity * it.unitPrice * (it.tvaRate / 100);
  }, 0) * 100) / 100;
  const manualTtc = Math.round((manualTotal + manualTva) * 100) / 100;

  const handleCreateManual = () => {
    if (!manualCustomerId) { notify.error('Veuillez sélectionner un client'); return; }
    if (manualItems.some(it => !it.description || it.unitPrice <= 0)) { notify.error('Veuillez remplir tous les articles'); return; }
    if (!manualDate) { notify.error('Veuillez saisir la date de facturation'); return; }
    createManualMutation.mutate({
      invoiceType: 'emitted',
      customerId: manualCustomerId,
      invoiceDate: manualDate,
      // Le backend redrive HT/TVA/TTC depuis les lignes quand un taux est saisi.
      amount: manualTotal,
      taxAmount: manualTva,
      totalAmount: manualTtc,
      notes: manualNotes,
      items: manualItems.map(it => ({
        productId: it.productId || undefined,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
        tvaRate: it.tvaRate,
      })),
    });
  };

  const allInvoices = invoices as Record<string, any>[];
  const totalFacture = allInvoices.reduce((s, inv) => s + parseFloat(inv.total_amount as string), 0);
  const totalEncaisse = allInvoices.reduce((s, inv) => s + parseFloat(inv.paid_amount as string), 0);
  const totalToCollect = allInvoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string), 0);
  const countByStatus = {
    pending: allInvoices.filter(inv => inv.status === 'pending').length,
    partial: allInvoices.filter(inv => inv.status === 'partial').length,
    paid: allInvoices.filter(inv => inv.status === 'paid').length,
    cancelled: allInvoices.filter(inv => inv.status === 'cancelled').length,
  };
  const tauxEncaissement = totalFacture > 0 ? Math.round((totalEncaisse / totalFacture) * 100) : 0;

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return allInvoices;
    const q = searchQuery.toLowerCase();
    return allInvoices.filter(inv => {
      const num = (inv.invoice_number as string || '').toLowerCase();
      const customer = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.toLowerCase();
      const orderRef = (inv.order_number_ref as string || '').toLowerCase();
      return num.includes(q) || customer.includes(q) || orderRef.includes(q);
    });
  }, [allInvoices, searchQuery]);

  const handleDownloadPdf = async (inv: Record<string, any>) => {
    try {
      const response = await invoicesApi.downloadDocx(inv.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { notify.error('Erreur lors du téléchargement'); }
  };

  return (
    <>
      {/* KPI stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Receipt size={11} style={{ display: 'inline', marginRight: 4 }} />Total facturé</div>
          <div className="odoo-stat-card-value">{n(totalFacture)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{allInvoices.length} facture{allInvoices.length > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />À encaisser</div>
          <div className="odoo-stat-card-value" style={{ color: totalToCollect > 0 ? '#b85d1a' : undefined }}>{n(totalToCollect)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{countByStatus.pending + countByStatus.partial} en cours</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Encaissé</div>
          <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{n(totalEncaisse)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{countByStatus.paid} soldée{countByStatus.paid > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><BarChart3 size={11} style={{ display: 'inline', marginRight: 4 }} />Taux encaissement</div>
          <div className="odoo-stat-card-value">{tauxEncaissement}%</div>
          <div className="odoo-stat-card-sub" style={{ paddingTop: 4 }}>
            <span style={{ display: 'block', width: '100%', height: 3, background: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', background: 'var(--theme-accent)', width: `${tauxEncaissement}%` }} />
            </span>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N°, client, commande..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="odoo-search-input" />
        <div style={{ display: 'inline-flex', gap: 4 }}>
          <button onClick={() => setStatusFilter('')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: !statusFilter ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: !statusFilter ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: !statusFilter ? 600 : 400,
            }}>
            Tous <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 4 }}>{allInvoices.length}</span>
          </button>
          <button onClick={() => setStatusFilter(statusFilter === 'pending' ? '' : 'pending')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: statusFilter === 'pending' ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: statusFilter === 'pending' ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: statusFilter === 'pending' ? 600 : 400,
            }}>
            En attente <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 4 }}>{countByStatus.pending}</span>
          </button>
          <button onClick={() => setStatusFilter(statusFilter === 'partial' ? '' : 'partial')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: statusFilter === 'partial' ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: statusFilter === 'partial' ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: statusFilter === 'partial' ? 600 : 400,
            }}>
            Partiel <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 4 }}>{countByStatus.partial}</span>
          </button>
          <button onClick={() => setStatusFilter(statusFilter === 'paid' ? '' : 'paid')} className="odoo-filter-dropdown"
            style={{
              backgroundColor: statusFilter === 'paid' ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: statusFilter === 'paid' ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: statusFilter === 'paid' ? 600 : 400,
            }}>
            Encaissée <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 4 }}>{countByStatus.paid}</span>
          </button>
        </div>
        <button onClick={() => { setShowCreateModal(true); setCreateMode('order'); }}
          className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <Plus size={13} /> Nouvelle facture
        </button>
      </div>

      {/* Invoice Table */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des factures...</p>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{searchQuery ? 'Aucun résultat' : 'Aucune facture émise'}</p>
          {!searchQuery && (
            <button onClick={() => { setShowCreateModal(true); setCreateMode('order'); }}
              className="odoo-btn-primary" style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Créer une facture
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Facture / Client</th>
                <th>Date</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right', width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(inv => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const progressPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                const isExpanded = expandedId === inv.id;
                const customerName = inv.customer_first_name ? `${inv.customer_first_name} ${inv.customer_last_name || ''}` : 'Client inconnu';
                const statusTag = inv.status === 'paid' ? 'odoo-tag-green'
                  : inv.status === 'partial' ? 'odoo-tag-blue'
                  : inv.status === 'overdue' ? 'odoo-tag-red'
                  : inv.status === 'cancelled' ? 'odoo-tag-grey'
                  : 'odoo-tag-yellow';
                const statusLabel = inv.status === 'paid' ? 'Soldée'
                  : inv.status === 'partial' ? 'Partiel'
                  : inv.status === 'overdue' ? 'En retard'
                  : inv.status === 'cancelled' ? 'Annulée'
                  : 'En attente';
                const dotClass = inv.status === 'paid' ? 'ok'
                  : inv.status === 'overdue' ? 'danger'
                  : inv.status === 'cancelled' ? 'neutral'
                  : 'warning';
                return (
                  <Fragment key={inv.id as string}>
                    <tr onClick={() => setExpandedId(isExpanded ? null : inv.id as string)} style={{ cursor: 'pointer' }}>
                      <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {isExpanded ? <ChevronDown size={13} style={{ color: 'var(--theme-text-muted)' }} /> : <ChevronRight size={13} style={{ color: 'var(--theme-text-muted)' }} />}
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.invoice_number as string}</span>
                          {inv.order_number_ref && <span className="odoo-tag odoo-tag-blue" style={{ fontFamily: 'ui-monospace, monospace' }}>CMD {inv.order_number_ref as string}</span>}
                        </span>
                        <span style={{ display: 'block', color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginTop: 2 }}>
                          <Users size={10} style={{ display: 'inline', marginRight: 3 }} /> {customerName}
                        </span>
                      </td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(inv.invoice_date as string), 'dd MMM yyyy', { locale: fr })}</td>
                      <td><span className={`odoo-tag ${statusTag}`}>{statusLabel}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700 }}>{n(total)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                        {remaining > 0 && inv.status !== 'cancelled' && (
                          <div style={{ color: '#b85d1a', fontSize: '0.6875rem', marginTop: 2 }}>Reste {n(remaining)}</div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          <button onClick={() => handleDownloadPdf(inv)} className="odoo-pager-btn" title="Télécharger PDF"><Download size={13} /></button>
                          {inv.status !== 'cancelled' && inv.status !== 'paid' && remaining > 0 && (
                            <button onClick={() => { setShowPayModal(inv); setPayMethod('cash'); }} className="odoo-pager-btn" title="Encaisser" style={{ color: '#28a745' }}><Banknote size={13} /></button>
                          )}
                          {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                            <button onClick={() => cancelMutation.mutate(inv.id as string)} className="odoo-pager-btn" title="Annuler" style={{ color: '#dc3545' }}><X size={13} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && inv.status !== 'cancelled' && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))', padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 6 }}>
                            <span style={{ color: 'var(--theme-text-muted)' }}>Progression encaissement</span>
                            <span style={{ fontWeight: 700 }}>{Math.round(progressPct)}%</span>
                          </div>
                          <span style={{ display: 'block', width: '100%', height: 5, background: 'var(--theme-bg-separator)', borderRadius: 3, overflow: 'hidden' }}>
                            <span style={{ display: 'block', height: '100%', background: progressPct >= 100 ? '#28a745' : 'var(--theme-accent)', width: `${progressPct}%` }} />
                          </span>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.6875rem' }}>
                            <span style={{ color: '#28a745', fontWeight: 600 }}>Encaissé : {n(paid)} DH</span>
                            {remaining > 0 && <span style={{ color: '#b85d1a', fontWeight: 600 }}>Reste : {n(remaining)} DH</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                <td colSpan={4} style={{ padding: 12, fontWeight: 600 }}>
                  {filteredInvoices.length} facture{filteredInvoices.length > 1 ? 's' : ''}{searchQuery && ` pour "${searchQuery}"`}
                </td>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem' }}>
                  Total : {n(filteredInvoices.reduce((s, inv) => s + parseFloat(inv.total_amount as string), 0))} DH
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateModal && (
        <ModalBackdrop onClose={() => { setShowCreateModal(false); resetManualForm(); }} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center"><Receipt size={18} className="text-white" /></div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Nouvelle facture</h3>
                    <p className="text-xs text-gray-400">Créez une facture client</p>
                  </div>
                </div>
                <button onClick={() => { setShowCreateModal(false); resetManualForm(); }} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><X size={18} className="text-gray-400" /></button>
              </div>
              <div className="flex gap-1 mt-4 bg-gray-100 rounded-xl p-1">
                <button onClick={() => setCreateMode('order')} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${createMode === 'order' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <ShoppingCart size={14} className="inline mr-1.5" />Depuis commande
                </button>
                <button onClick={() => setCreateMode('manual')} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${createMode === 'manual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <Pencil size={14} className="inline mr-1.5" />Saisie manuelle
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {createMode === 'order' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sélectionner une commande</label>
                    <select value={selectedOrderId} onChange={e => setSelectedOrderId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                      <option value="">-- Choisir une commande --</option>
                      {(orders as Record<string, any>[]).filter(o => o.status === 'completed' || o.status === 'delivered' || o.status === 'confirmed' || o.status === 'ready').map(o => (
                        <option key={o.id as string} value={o.id as string}>
                          {o.order_number as string} — {o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}` : 'Client direct'} — {n(parseFloat(o.total as string))} DH
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedOrderId && (() => {
                    const sel = (orders as Record<string, any>[]).find(o => o.id === selectedOrderId);
                    return sel ? (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-blue-800">Commande {sel.order_number as string}</p>
                            <p className="text-xs text-blue-600 mt-0.5">{sel.customer_first_name ? `${sel.customer_first_name} ${sel.customer_last_name || ''}` : 'Client direct'}</p>
                          </div>
                          <p className="text-xl font-bold text-blue-800">{n(parseFloat(sel.total as string))} <span className="text-xs font-normal">DH</span></p>
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <button onClick={() => { if (selectedOrderId) createFromOrderMutation.mutate(selectedOrderId); }}
                    disabled={!selectedOrderId || createFromOrderMutation.isPending}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {createFromOrderMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Générer la facture
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                    <select value={manualCustomerId} onChange={e => setManualCustomerId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                      <option value="">-- Sélectionner un client --</option>
                      {customers.map(c => (<option key={c.id as string} value={c.id as string}>{c.first_name as string} {c.last_name as string || ''}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date de facturation</label>
                    <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Articles</label>
                      <button onClick={addManualItem} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1 font-medium"><Plus size={12} /> Ajouter</button>
                    </div>
                    <div className="space-y-2">
                      {manualItems.map((item, idx) => (
                        <div key={idx} className="bg-gray-50 rounded-xl p-2.5 space-y-2 border border-gray-100">
                          <div className="flex items-center gap-2">
                            <ProductSearchInput products={products} value={item.description}
                              onSelect={(product) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], productId: product.id as string, description: product.name as string, unitPrice: parseFloat(product.price as string) || 0 }; setManualItems(updated); }}
                              onChange={(val) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], description: val, productId: '' }; setManualItems(updated); }} />
                            {manualItems.length > 1 && <button onClick={() => removeManualItem(idx)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 flex-shrink-0"><X size={14} /></button>}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-1 text-xs text-gray-400">
                              {item.productId && <Check size={12} className="text-green-500" />}
                              {item.productId ? <span className="text-green-600">Produit lié</span> : <span>Saisie libre</span>}
                            </div>
                            <input type="number" placeholder="Qté" value={item.quantity || ''} onChange={e => updateManualItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                              className="w-16 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30" min="1" />
                            <input type="number" placeholder="Prix" value={item.unitPrice || ''} onChange={e => updateManualItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/30" min="0" step="0.01" />
                            <select title="Taux TVA" value={item.tvaRate === null ? '' : String(item.tvaRate)}
                              onChange={e => updateManualItem(idx, 'tvaRate', e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                              className="w-20 px-1.5 py-1.5 border border-gray-200 rounded-lg text-sm text-right bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                              <option value="">TVA —</option>
                              {['0', '7', '10', '14', '20'].map(r => (<option key={r} value={r}>{r} %</option>))}
                            </select>
                            <span className="text-xs text-gray-700 w-20 text-right font-bold">{n(item.quantity * item.unitPrice)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                    <input type="text" value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Notes ou référence..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                  </div>
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4 space-y-1">
                    <div className="flex items-center justify-between text-sm text-blue-700">
                      <span>Total HT</span><span className="font-semibold">{n(manualTotal)} DH</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-blue-700">
                      <span>TVA</span><span className="font-semibold">{n(manualTva)} DH</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-blue-200/60 pt-1">
                      <span className="text-sm font-medium text-blue-700">Total TTC</span>
                      <span className="text-xl font-bold text-blue-800">{n(manualTtc)} <span className="text-xs font-normal">DH</span></span>
                    </div>
                  </div>
                  <button onClick={handleCreateManual} disabled={createManualMutation.isPending}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {createManualMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />} Créer la facture
                  </button>
                </>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Pay Modal */}
      {showPayModal && (() => {
        const inv = showPayModal;
        const total = parseFloat(inv.total_amount as string);
        const paid = parseFloat(inv.paid_amount as string);
        const remaining = total - paid;
        return (
          <ModalBackdrop onClose={() => setShowPayModal(null)} className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center"><Banknote size={18} className="text-white" /></div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">Encaisser</h3>
                      <p className="text-xs text-gray-400 font-mono">{inv.invoice_number as string}</p>
                    </div>
                  </div>
                  <button onClick={() => setShowPayModal(null)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors"><X size={18} className="text-gray-400" /></button>
                </div>
              </div>
              <form className="p-5 space-y-4" onSubmit={e => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const amount = parseFloat(fd.get('amount') as string);
                const paymentDate = (fd.get('paymentDate') as string) || format(new Date(), 'yyyy-MM-dd');
                if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
                if (amount > remaining) { notify.error(`Le montant dépasse le reste à encaisser (${n(remaining)} DH)`); return; }
                payMutation.mutate({
                  invoiceId: inv.id as string, type: 'income', amount, paymentMethod: payMethod,
                  paymentDate,
                  description: `Encaissement facture ${inv.invoice_number}`,
                  ...(payMethod === 'check' || payMethod === 'traite' ? { checkNumber: fd.get('checkNumber') as string, checkDate: fd.get('checkDate') as string } : {}),
                });
              }}>
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-green-600">Total facture</span><span className="font-bold text-green-800">{n(total)} DH</span></div>
                  <div className="flex justify-between text-sm"><span className="text-green-600">Déjà encaissé</span><span className="font-medium text-green-700">{n(paid)} DH</span></div>
                  <div className="flex justify-between text-sm pt-2 border-t border-green-200/50"><span className="text-green-700 font-semibold">Reste à encaisser</span><span className="font-bold text-green-900 text-base">{n(remaining)} DH</span></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Montant</label>
                  <input name="amount" type="number" step="0.01" defaultValue={remaining} max={remaining}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 text-lg font-semibold text-center" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Date d'encaissement</label>
                  <input name="paymentDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" /></div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mode de paiement</label>
                  <div className="flex gap-2">
                    {(['cash', 'bank', 'check', 'traite'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setPayMethod(m)}
                        className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${payMethod === m ? 'bg-green-500 text-white border-green-500 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {getPaymentLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>
                {(payMethod === 'check' || payMethod === 'traite') && (
                  <div className="space-y-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">N° {payMethod === 'traite' ? 'de la traite' : 'du chèque'}</label>
                      <input name="checkNumber" type="text" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Date {payMethod === 'traite' ? 'de la traite' : 'du chèque'}</label>
                      <input name="checkDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" /></div>
                  </div>
                )}
                <button type="submit" disabled={payMutation.isPending}
                  className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {payMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Confirmer l'encaissement
                </button>
              </form>
            </div>
          </ModalBackdrop>
        );
      })()}
    </>
  );
}
