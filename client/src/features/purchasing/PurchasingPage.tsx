import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersApi, expenseCategoriesApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote,
  X, Check, Download, AlertTriangle, ChevronRight,
  ClipboardList, ShoppingCart, Receipt, Paperclip, Eye, Trash2, Upload,
  Loader2, Search, Coins, ArrowDownRight,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import PurchaseOrdersTab from '../accounting/PurchaseOrdersTab';
import PurchaseRequestsPage from './PurchaseRequestsPage';
import { useReferentiel } from '../../hooks/useReferentiel';
import { RotateCcw } from 'lucide-react';

type PurchasingTab = 'suppliers' | 'purchase_orders' | 'invoices' | 'waiting_list';

const INVOICE_STATUS_LABELS: Record<string, string> = { pending: 'En attente', partial: 'Partiel', paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500',
};

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function PurchasingPage() {
  const [tab, setTab] = useState<PurchasingTab>('suppliers');

  const allTabs: { key: PurchasingTab; label: string; icon: typeof Truck }[] = [
    { key: 'waiting_list', label: "Liste d'attente", icon: ShoppingCart },
    { key: 'suppliers', label: 'Fournisseurs', icon: Truck },
    { key: 'purchase_orders', label: 'Bons de commande', icon: ClipboardList },
    { key: 'invoices', label: 'Factures reçues', icon: FileText },
  ];

  const currentTab = allTabs.find(t => t.key === tab);

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ShoppingCart size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Achats</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">{currentTab?.label}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="odoo-tabs">
        {allTabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`odoo-tab ${tab === t.key ? 'active' : ''}`}>
              <Icon size={13} style={{ marginRight: 4 }} /> {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'waiting_list' && <PurchaseRequestsPage />}
        {tab === 'suppliers' && <SuppliersTab />}
        {tab === 'purchase_orders' && <PurchaseOrdersTab />}
        {tab === 'invoices' && <InvoicesTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════ SUPPLIERS TAB ═══════════════════════ */
function SuppliersTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      editing ? suppliersApi.update(editing.id as string, data) : suppliersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      notify.success(editing ? 'Fournisseur modifié' : 'Fournisseur ajouté');
      setShowForm(false); setEditing(null);
    },
    onError: () => notify.error('Erreur'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      notify.success('Fournisseur désactivé');
    },
    onError: () => notify.error('Erreur lors de la désactivation'),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.update(id, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      notify.success('Fournisseur réactivé');
    },
    onError: () => notify.error('Erreur lors de la réactivation'),
  });

  const suppliersList = suppliers as Record<string, any>[];
  const activeCount = suppliersList.filter(s => s.is_active).length;

  return (
    <>
      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Truck size={11} style={{ display: 'inline', marginRight: 4 }} />Fournisseurs</div>
          <div className="odoo-stat-card-value">{suppliersList.length}</div>
          <div className="odoo-stat-card-sub">total</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Check size={11} style={{ display: 'inline', marginRight: 4 }} />Actifs</div>
          <div className="odoo-stat-card-value" style={{ color: activeCount > 0 ? '#28a745' : undefined }}>{activeCount}</div>
          <div className="odoo-stat-card-sub">en activité</div>
        </div>
      </div>

      {/* Search panel + action */}
      <div className="odoo-search-panel">
        <div style={{ flex: 1 }} />
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouveau fournisseur
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des fournisseurs...</p>
        </div>
      ) : suppliersList.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Truck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucun fournisseur</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>Nom</th>
                <th>Contact</th>
                <th>Téléphone</th>
                <th>Ville</th>
                <th>ICE</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right', width: 70 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliersList.map(s => (
                <tr key={s.id as string} onClick={() => { setEditing(s); setShowForm(true); }} style={{ cursor: 'pointer' }}>
                  <td><span className={`odoo-status-dot ${s.is_active ? 'ok' : 'neutral'}`} /></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                      <Truck size={11} style={{ color: 'var(--theme-accent)' }} />
                      {s.name as string}
                    </span>
                  </td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{(s.contact_name as string) || '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{(s.phone as string) || '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)' }}>{(s.city as string) || '—'}</td>
                  <td style={{ color: 'var(--theme-text-muted)', fontFamily: 'ui-monospace, monospace', fontSize: '0.6875rem' }}>
                    {(s.ice as string) || '—'}
                  </td>
                  <td>
                    <span className={`odoo-tag ${s.is_active ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>
                      {s.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button onClick={() => { setEditing(s); setShowForm(true); }}
                        className="odoo-pager-btn" title="Modifier">
                        <Pencil size={13} />
                      </button>
                      {s.is_active ? (
                        <button
                          onClick={() => {
                            if (confirm(`Désactiver le fournisseur « ${s.name as string} » ?\n\nIl n'apparaîtra plus dans les listes de sélection.\nL'historique (factures, bons de commande, paiements) est conservé.`)) {
                              deactivateMutation.mutate(s.id as string);
                            }
                          }}
                          className="odoo-pager-btn" title="Désactiver" style={{ color: '#dc3545' }}>
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (confirm(`Réactiver le fournisseur « ${s.name as string} » ?`)) {
                              reactivateMutation.mutate(s.id as string);
                            }
                          }}
                          className="odoo-pager-btn" title="Réactiver" style={{ color: '#28a745' }}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ModalBackdrop onClose={() => { setShowForm(false); setEditing(null); }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <Truck size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Fournisseur</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span className="odoo-breadcrumb-current">{editing ? (editing.name as string) : 'Nouveau'}</span>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="odoo-pager-btn" title="Fermer">
                <X size={14} />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              saveMutation.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }} className="flex-1 overflow-y-auto">
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Nom *</label>
                  <input name="name" defaultValue={editing?.name as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Contact</label>
                    <input name="contactName" defaultValue={editing?.contact_name as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Téléphone</label>
                    <input name="phone" defaultValue={editing?.phone as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Email</label>
                    <input name="email" type="email" defaultValue={editing?.email as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Ville</label>
                    <input name="city" defaultValue={editing?.city as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                </div>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Adresse</label>
                  <input name="address" defaultValue={editing?.address as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>ICE</label>
                  <input name="ice" defaultValue={editing?.ice as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Notes</label>
                  <textarea name="notes" rows={2} defaultValue={editing?.notes as string} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              </div>
              <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

/* ═══════════════════════ INVOICES TAB (factures reçues only) ═══════════════════════ */
function InvoicesTab() {
  return <ReceivedInvoicesSection />;
}

/* ═══ Factures reçues (fournisseurs) ═══ */
function ReceivedInvoicesSection() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showPayForm, setShowPayForm] = useState<Record<string, any> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [statusFilter, setStatusFilter] = useState('');
  const { entries: paymentMethods, getLabel: getPaymentLabel } = useReferentiel('payment_methods');

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'received', statusFilter],
    queryFn: () => invoicesApi.list({ invoiceType: 'received', ...(statusFilter ? { status: statusFilter } : {}) }),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => expenseCategoriesApi.list() });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, any>) => invoicesApi.create({ ...data, invoiceType: 'received' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture ajoutée'); setShowForm(false); },
    onError: () => notify.error('Erreur'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture annulée'); },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      notify.success('Paiement enregistré');
      setShowPayForm(null);
    },
    onError: () => notify.error('Erreur'),
  });

  const attachMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => invoicesApi.uploadAttachment(id, file),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture jointe avec succès'); },
    onError: () => notify.error('Erreur lors de l\'envoi du fichier'),
  });

  const removeAttachMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.removeAttachment(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Pièce jointe supprimée'); },
  });

  const handleAttachFile = (invoiceId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.webp';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) attachMutation.mutate({ id: invoiceId, file });
    };
    input.click();
  };

  const totalPending = (invoices as Record<string, any>[])
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string), 0);

  const invoicesList = invoices as Record<string, any>[];
  const totalFacture = invoicesList.reduce((s, inv) => s + parseFloat(inv.total_amount as string || '0'), 0);
  const totalPaid = invoicesList.reduce((s, inv) => s + parseFloat(inv.paid_amount as string || '0'), 0);

  return (
    <>
      {/* Stat tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><FileText size={11} style={{ display: 'inline', marginRight: 4 }} />Total facturé</div>
          <div className="odoo-stat-card-value">{n(totalFacture)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{invoicesList.length} facture{invoicesList.length > 1 ? 's' : ''}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Banknote size={11} style={{ display: 'inline', marginRight: 4 }} />Payé</div>
          <div className="odoo-stat-card-value" style={{ color: '#28a745' }}>{n(totalPaid)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">réglé</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />Reste à payer</div>
          <div className="odoo-stat-card-value" style={{ color: totalPending > 0 ? '#dc3545' : undefined }}>{n(totalPending)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">en attente</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><Coins size={11} style={{ display: 'inline', marginRight: 4 }} />Taux paiement</div>
          <div className="odoo-stat-card-value">{totalFacture > 0 ? Math.round((totalPaid / totalFacture) * 100) : 0}%</div>
          <div className="odoo-stat-card-sub">progression</div>
        </div>
      </div>

      {/* Search panel */}
      <div className="odoo-search-panel">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="odoo-filter-dropdown">
          <option value="">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="partial">Partiel</option>
          <option value="paid">Payée</option>
          <option value="overdue">En retard</option>
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle facture
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des factures...</p>
        </div>
      ) : invoicesList.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <FileText size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune facture reçue</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>N° Facture</th>
                <th>Fournisseur</th>
                <th>Date</th>
                <th>BC</th>
                <th>Catégorie</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right', width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoicesList.map(inv => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const hasAttachment = !!(inv.attachment_url as string);
                const statusTag = inv.status === 'paid' ? 'odoo-tag-green'
                  : inv.status === 'partial' ? 'odoo-tag-blue'
                  : inv.status === 'overdue' ? 'odoo-tag-red'
                  : inv.status === 'cancelled' ? 'odoo-tag-grey'
                  : 'odoo-tag-yellow';
                const dotClass = inv.status === 'paid' ? 'ok'
                  : inv.status === 'overdue' ? 'danger'
                  : inv.status === 'cancelled' ? 'neutral'
                  : 'warning';
                return (
                  <tr key={inv.id as string}>
                    <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.invoice_number as string}</span>
                        {hasAttachment && <Paperclip size={10} style={{ color: 'var(--theme-accent)' }} />}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{inv.supplier_name as string}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(inv.invoice_date as string), 'dd/MM/yyyy')}</td>
                    <td>
                      {inv.purchase_order_number ? (
                        <span className="odoo-tag odoo-tag-blue" style={{ fontFamily: 'ui-monospace, monospace' }}>{inv.purchase_order_number as string}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(inv.category_name as string) || '—'}</td>
                    <td><span className={`odoo-tag ${statusTag}`}>{INVOICE_STATUS_LABELS[inv.status as string]}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 700 }}>{n(total)}</span>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                      {remaining > 0 && inv.status !== 'cancelled' && (
                        <div style={{ color: '#dc3545', fontSize: '0.6875rem', marginTop: 2 }}>Reste {n(remaining)}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 2 }}>
                        {hasAttachment ? (
                          <>
                            <a href={inv.attachment_url as string} target="_blank" rel="noopener noreferrer"
                              className="odoo-pager-btn" title="Voir la pièce jointe">
                              <Eye size={13} />
                            </a>
                            <button onClick={() => removeAttachMutation.mutate(inv.id as string)}
                              className="odoo-pager-btn" title="Supprimer la pièce jointe" style={{ color: '#dc3545' }}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleAttachFile(inv.id as string)} className="odoo-pager-btn" title="Joindre">
                            <Upload size={13} />
                          </button>
                        )}
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <button onClick={() => { setShowPayForm(inv); setPayMethod('cash'); }}
                            className="odoo-btn-primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: '0.6875rem' }}>
                            <Banknote size={11} /> Payer
                          </button>
                        )}
                        {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                          <button
                            onClick={() => {
                              if (confirm(`Annuler la facture « ${inv.invoice_number as string} » de ${inv.supplier_name as string} ?\n\nElle sera marquée « Annulée » mais reste visible dans l'historique.`)) {
                                cancelMutation.mutate(inv.id as string);
                              }
                            }}
                            className="odoo-pager-btn" title="Annuler la facture" style={{ color: '#dc3545' }}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create invoice modal */}
      {showForm && (
        <ModalBackdrop onClose={() => setShowForm(false)} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Facture fournisseur</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span className="odoo-breadcrumb-current">Nouvelle</span>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowForm(false)} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string) || 0;
              fd.taxAmount = parseFloat(fd.taxAmount as string) || 0;
              fd.totalAmount = (fd.amount as number) + (fd.taxAmount as number);
              createMutation.mutate(fd);
            }} className="flex-1 overflow-y-auto">
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>N° Facture *</label>
                    <input name="invoiceNumber" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date *</label>
                    <input name="invoiceDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur *</label>
                    <select name="supplierId" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required>
                      <option value="">Choisir...</option>
                      {(suppliers as Record<string, any>[]).filter(s => s.is_active).map(s => (
                        <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                      ))}
                    </select></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Catégorie</label>
                    <select name="categoryId" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="">Choisir...</option>
                      {(categories as Record<string, any>[]).filter(c => c.type === 'expense').map(c => (
                        <option key={c.id as string} value={c.id as string}>{c.name as string}</option>
                      ))}
                    </select></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Montant HT *</label>
                    <input name="amount" type="number" step="0.01" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>TVA</label>
                    <input name="taxAmount" type="number" step="0.01" defaultValue="0" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Échéance</label>
                    <input name="dueDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
                </div>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Notes</label>
                  <textarea name="notes" rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              </div>
              <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setShowForm(false)} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {createMutation.isPending && <Loader2 size={12} className="animate-spin" />} Enregistrer
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {/* Pay invoice modal */}
      {showPayForm && (
        <ModalBackdrop onClose={() => setShowPayForm(null)} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <Banknote size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Payer</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span className="odoo-breadcrumb-current" style={{ fontFamily: 'ui-monospace, monospace' }}>{showPayForm.invoice_number as string}</span>
              </div>
              <div style={{ flex: 1 }} />
              <span className="odoo-tag odoo-tag-orange">Reste {n(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string))} DH</span>
              <button onClick={() => setShowPayForm(null)} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, any>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'invoice';
              fd.invoiceId = showPayForm.id;
              fd.supplierId = showPayForm.supplier_id;
              fd.categoryId = showPayForm.category_id || undefined;
              fd.description = `Paiement facture ${showPayForm.invoice_number}`;
              if (payMethod !== 'check') { fd.checkNumber = undefined; fd.checkDate = undefined; }
              payMutation.mutate(fd);
            }} className="flex-1 overflow-y-auto">
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Montant *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required
                    defaultValue={(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string)).toFixed(2)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Méthode *</label>
                    <select name="paymentMethod" value={payMethod} onChange={e => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {paymentMethods.map(pm => (
                        <option key={pm.code} value={pm.code}>{pm.label}</option>
                      ))}
                    </select></div>
                  <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date *</label>
                    <input name="paymentDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" defaultValue={format(new Date(), 'yyyy-MM-dd')} required /></div>
                </div>
                {payMethod === 'check' && (
                  <div className="odoo-alert" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <strong style={{ fontSize: '0.75rem' }}>Détails du chèque</strong>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginBottom: 4 }}>N° Chèque *</label>
                        <input name="checkNumber" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
                      <div><label style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date du chèque</label>
                        <input name="checkDate" type="date" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
                    </div>
                  </div>
                )}
                <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Référence / Notes</label>
                  <input name="reference" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Optionnel" /></div>
              </div>
              <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setShowPayForm(null)} className="odoo-btn-secondary">Annuler</button>
                <button type="submit" disabled={payMutation.isPending} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {payMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  <Check size={13} /> Payer
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

/* EmittedInvoicesSection moved to ../sales/EmittedInvoicesTab.tsx */
