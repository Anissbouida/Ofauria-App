import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersApi, expenseCategoriesApi, invoicesApi, paymentsApi } from '../../api/accounting.api';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, Truck, FileText, Banknote,
  X, Check, Download, AlertTriangle, ChevronRight,
  ClipboardList, ShoppingCart, Receipt, Paperclip, Eye, Trash2, Upload,
  Loader2, Search, Coins, ArrowDownRight, Filter, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import PurchaseOrdersTab from '../accounting/PurchaseOrdersTab';
import PurchaseRequestsPage from './PurchaseRequestsPage';
import { useReferentiel } from '../../hooks/useReferentiel';
import { RotateCcw } from 'lucide-react';

type PurchasingTab = 'suppliers' | 'purchase_orders' | 'invoices' | 'waiting_list';

const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: 'Non réglée', partial: 'Partiellement réglée', paid: 'Réglée',
  overdue: 'En retard', cancelled: 'Annulée', disputed: 'En litige',
};
const INVOICE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700', partial: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500', disputed: 'bg-purple-100 text-purple-700',
};
const PAYMENT_MODE_LABELS: Record<string, string> = { cash: 'Espèces', check: 'Chèque', transfer: 'Virement' };
// Statuts modifiables manuellement (admin/gérant). 'overdue' et 'cancelled' restent
// pilotés par leur logique propre (cancel button + flag automatique d'echeance depassee).
const MANUAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Non réglée' },
  { value: 'partial', label: 'Partiellement réglée' },
  { value: 'paid', label: 'Réglée' },
  { value: 'disputed', label: 'En litige' },
];

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
  // editInvoice = facture en cours de modification (null = creation, sinon edit)
  const [editInvoice, setEditInvoice] = useState<Record<string, any> | null>(null);
  const [showPayForm, setShowPayForm] = useState<Record<string, any> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortBy, setSortBy] = useState<string>('invoice_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) => invoicesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      notify.success('Facture modifiée');
      setEditInvoice(null);
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la modification');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => invoicesApi.remove(id, { force }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      notify.success('Facture supprimée');
    },
    onError: (err: unknown) => {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de la suppression');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); notify.success('Facture annulée'); },
  });

  /**
   * Suppression facture avec strategie 2 niveaux :
   * 1er confirm : demande s'il faut supprimer
   * Si paiements lies : 2eme confirm pour cascade (force=true)
   * Si aucun paiement : suppression directe
   */
  function handleDelete(inv: Record<string, any>) {
    const paid = parseFloat(inv.paid_amount as string || '0');
    const hasPayments = paid > 0;
    const baseMsg = `Supprimer DEFINITIVEMENT la facture « ${inv.invoice_number} » de ${inv.supplier_name} ?\n\nCette action est irreversible.`;
    if (!confirm(baseMsg)) return;
    if (hasPayments) {
      const force = confirm(
        `Cette facture a ${parseFloat(String(inv.paid_amount || '0')).toFixed(2)} DH de paiements enregistres.\n\n` +
        `OK = supprimer AUSSI les paiements (perte de tracabilite comptable)\n` +
        `Annuler = abandonner la suppression (utilisez plutot "Annuler la facture")`
      );
      if (!force) return;
      deleteMutation.mutate({ id: inv.id as string, force: true });
    } else {
      deleteMutation.mutate({ id: inv.id as string, force: false });
    }
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => invoicesApi.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Statut mis à jour');
    },
    onError: () => notify.error('Erreur lors du changement de statut'),
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-payment-alerts'] });
      notify.success('Paiement enregistré');
      setShowPayForm(null);
    },
    onError: (err: unknown) => {
      // Affiche le message precis du backend (sur-paiement, doublon de cheque, etc.)
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : null;
      notify.error(msg || 'Erreur lors de l\'enregistrement du paiement');
    },
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

  // Liste des fournisseurs et categories presents dans les factures, pour les dropdowns
  const invoiceSuppliers = useMemo(() => {
    const map = new Map<string, string>();
    invoicesList.forEach(inv => {
      if (inv.supplier_id) map.set(inv.supplier_id as string, (inv.supplier_name as string) || '');
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoicesList]);

  const invoiceCategories = useMemo(() => {
    const map = new Map<string, string>();
    invoicesList.forEach(inv => {
      if (inv.category_id) map.set(inv.category_id as string, (inv.category_name as string) || '');
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoicesList]);

  // Application des filtres (recherche, fournisseur, categorie) puis tri
  const displayedInvoices = useMemo(() => {
    let list = invoicesList;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(inv =>
        ((inv.invoice_number as string) || '').toLowerCase().includes(q) ||
        ((inv.supplier_name as string) || '').toLowerCase().includes(q) ||
        ((inv.purchase_order_number as string) || '').toLowerCase().includes(q) ||
        ((inv.category_name as string) || '').toLowerCase().includes(q)
      );
    }
    if (supplierFilter) {
      list = list.filter(inv => inv.supplier_id === supplierFilter);
    }
    if (categoryFilter) {
      list = list.filter(inv => inv.category_id === categoryFilter);
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'invoice_number':
          cmp = String(a.invoice_number || '').localeCompare(String(b.invoice_number || ''));
          break;
        case 'supplier_name':
          cmp = String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''));
          break;
        case 'invoice_date':
          cmp = new Date(a.invoice_date as string).getTime() - new Date(b.invoice_date as string).getTime();
          break;
        case 'due_date': {
          const ad = a.due_date ? new Date(a.due_date as string).getTime() : 0;
          const bd = b.due_date ? new Date(b.due_date as string).getTime() : 0;
          cmp = ad - bd;
          break;
        }
        case 'category_name':
          cmp = String(a.category_name || '').localeCompare(String(b.category_name || ''));
          break;
        case 'status':
          cmp = String(a.status || '').localeCompare(String(b.status || ''));
          break;
        case 'total_amount':
          cmp = parseFloat(a.total_amount as string || '0') - parseFloat(b.total_amount as string || '0');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [invoicesList, searchTerm, supplierFilter, categoryFilter, sortBy, sortDir]);

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: string) => {
    if (sortBy !== field) return <ArrowUpDown size={10} style={{ opacity: 0.3, marginLeft: 4, verticalAlign: 'middle' }} />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
      : <ArrowDown size={10} style={{ marginLeft: 4, verticalAlign: 'middle' }} />;
  };

  const hasActiveFilters = !!(searchTerm || supplierFilter || categoryFilter);

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

      {/* Search panel — statut + bouton nouvelle facture */}
      <div className="odoo-search-panel">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="odoo-filter-dropdown">
          <option value="">Tous les statuts</option>
          <option value="pending">Non réglée</option>
          <option value="partial">Partiellement réglée</option>
          <option value="paid">Réglée</option>
          <option value="overdue">En retard</option>
          <option value="disputed">En litige</option>
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Nouvelle facture
        </button>
      </div>

      {/* Search panel — recherche texte + filtres fournisseur / categorie */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" placeholder="Rechercher par N° facture, fournisseur, BC ou catégorie..."
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="odoo-search-input" />
        {invoiceSuppliers.length > 1 && (
          <>
            <Filter size={13} style={{ color: 'var(--theme-text-muted)' }} />
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} className="odoo-filter-dropdown">
              <option value="">Tous les fournisseurs</option>
              {invoiceSuppliers.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </>
        )}
        {invoiceCategories.length > 1 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="odoo-filter-dropdown">
            <option value="">Toutes les catégories</option>
            {invoiceCategories.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        {hasActiveFilters && (
          <button onClick={() => { setSearchTerm(''); setSupplierFilter(''); setCategoryFilter(''); }}
            className="odoo-filter-dropdown"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <X size={11} /> Effacer
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement des factures...</p>
        </div>
      ) : displayedInvoices.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <FileText size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>
            {(hasActiveFilters || statusFilter) ? 'Aucune facture ne correspond à ces filtres' : 'Aucune facture reçue'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th onClick={() => toggleSort('invoice_number')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  N° Facture {sortIcon('invoice_number')}
                </th>
                <th onClick={() => toggleSort('supplier_name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Fournisseur {sortIcon('supplier_name')}
                </th>
                <th onClick={() => toggleSort('invoice_date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Date {sortIcon('invoice_date')}
                </th>
                <th onClick={() => toggleSort('due_date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Échéance / Mode {sortIcon('due_date')}
                </th>
                <th>BC</th>
                <th onClick={() => toggleSort('category_name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Catégorie {sortIcon('category_name')}
                </th>
                <th onClick={() => toggleSort('status')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Statut {sortIcon('status')}
                </th>
                <th onClick={() => toggleSort('total_amount')} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}>
                  Montant {sortIcon('total_amount')}
                </th>
                <th style={{ textAlign: 'right', width: 160 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedInvoices.map(inv => {
                const total = parseFloat(inv.total_amount as string);
                const paid = parseFloat(inv.paid_amount as string);
                const remaining = total - paid;
                const hasAttachment = !!(inv.attachment_url as string);
                const isFinalStatus = inv.status === 'paid' || inv.status === 'cancelled';
                const dueDateStr = inv.due_date as string | null;
                let daysUntilDue: number | null = null;
                let dueAlert = false;
                if (dueDateStr && !isFinalStatus) {
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const d = new Date(dueDateStr); d.setHours(0, 0, 0, 0);
                  daysUntilDue = Math.round((d.getTime() - today.getTime()) / 86400000);
                  dueAlert = daysUntilDue <= 7;
                }
                const expectedMode = (inv.expected_payment_mode as string) || '';
                const statusTag = inv.status === 'paid' ? 'odoo-tag-green'
                  : inv.status === 'partial' ? 'odoo-tag-blue'
                  : inv.status === 'overdue' ? 'odoo-tag-red'
                  : inv.status === 'cancelled' ? 'odoo-tag-grey'
                  : inv.status === 'disputed' ? 'odoo-tag-orange'
                  : 'odoo-tag-yellow';
                const dotClass = inv.status === 'paid' ? 'ok'
                  : inv.status === 'overdue' || inv.status === 'disputed' ? 'danger'
                  : inv.status === 'cancelled' ? 'neutral'
                  : 'warning';
                return (
                  <tr key={inv.id as string}>
                    <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.invoice_number as string}</span>
                        {hasAttachment && <Paperclip size={10} style={{ color: 'var(--theme-accent)' }} />}
                        {dueAlert && (
                          <span title={daysUntilDue !== null && daysUntilDue < 0
                            ? `Échéance dépassée de ${Math.abs(daysUntilDue)} jour(s)`
                            : `Échéance dans ${daysUntilDue} jour(s)`}
                            style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <AlertTriangle size={11} style={{ color: '#dc3545' }} />
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{inv.supplier_name as string}</td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(inv.invoice_date as string), 'dd/MM/yyyy')}</td>
                    <td style={{ color: dueAlert ? '#dc3545' : 'var(--theme-text-muted)' }}>
                      {dueDateStr ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.2 }}>
                          <span style={{ fontWeight: dueAlert ? 600 : 400 }}>
                            {format(new Date(dueDateStr), 'dd/MM/yyyy')}
                          </span>
                          {expectedMode && (
                            <span style={{ fontSize: '0.6875rem' }}>
                              {PAYMENT_MODE_LABELS[expectedMode] || expectedMode}
                            </span>
                          )}
                        </div>
                      ) : expectedMode ? (
                        <span style={{ fontSize: '0.6875rem' }}>{PAYMENT_MODE_LABELS[expectedMode]}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td>
                      {inv.purchase_order_number ? (
                        <span className="odoo-tag odoo-tag-blue" style={{ fontFamily: 'ui-monospace, monospace' }}>{inv.purchase_order_number as string}</span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>{(inv.category_name as string) || '—'}</td>
                    <td>
                      {inv.status === 'cancelled' ? (
                        <span className={`odoo-tag ${statusTag}`}>{INVOICE_STATUS_LABELS[inv.status as string]}</span>
                      ) : (
                        <select
                          value={inv.status as string}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next === inv.status) return;
                            if (confirm(`Mettre à jour le statut de la facture ${inv.invoice_number} vers « ${INVOICE_STATUS_LABELS[next]} » ?`)) {
                              statusMutation.mutate({ id: inv.id as string, status: next });
                            }
                          }}
                          disabled={statusMutation.isPending}
                          className={`odoo-tag ${statusTag}`}
                          style={{ border: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: '0.6875rem' }}>
                          {MANUAL_STATUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                          {inv.status === 'overdue' && <option value="overdue">En retard</option>}
                        </select>
                      )}
                    </td>
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
                          <button onClick={() => {
                            setShowPayForm(inv);
                            // Pre-selectionne le mode prevu sur la facture (ex: cheque)
                            const preMode = (inv.expected_payment_mode as string) || 'cash';
                            setPayMethod(preMode);
                          }}
                            className="odoo-btn-primary"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: '0.6875rem' }}>
                            <Banknote size={11} /> Payer
                          </button>
                        )}
                        {/* Modifier : disponible meme apres paiement (ajustement comptable) */}
                        <button
                          onClick={() => setEditInvoice(inv)}
                          className="odoo-pager-btn" title="Modifier la facture">
                          <Pencil size={13} />
                        </button>
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
                        {/* Supprimer DEFINITIVEMENT — distinct de "Annuler" qui marque seulement */}
                        <button
                          onClick={() => handleDelete(inv)}
                          disabled={deleteMutation.isPending}
                          className="odoo-pager-btn" title="Supprimer definitivement" style={{ color: '#b71c1c' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit invoice modal — un seul composant, mode determine par editInvoice */}
      {(showForm || editInvoice) && (
        <ReceivedInvoiceFormModal
          invoice={editInvoice}
          suppliers={suppliers as Record<string, any>[]}
          categories={categories as Record<string, any>[]}
          onClose={() => { setShowForm(false); setEditInvoice(null); }}
          onSubmit={(data) => {
            if (editInvoice) {
              updateMutation.mutate({ id: editInvoice.id as string, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isPending={createMutation.isPending || updateMutation.isPending}
        />
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
                        <input name="checkNumber" defaultValue={(showPayForm.check_number as string) || ''}
                          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
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

/**
 * Modal de creation / modification d'une facture recue.
 *
 * Le calcul HT / TVA / TTC est synchronise live : si l'utilisateur edite HT ou
 * TVA, le TTC est recalcule ; s'il edite le TTC, la TVA est deduite (HT - TTC).
 * Cela couvre les 2 cas d'usage usuels :
 *   1. La facture du fournisseur affiche un HT et un TVA explicites
 *   2. La facture n'affiche que le TTC (cas frequent au Maroc pour les PME)
 */
function ReceivedInvoiceFormModal({
  invoice, suppliers, categories, onClose, onSubmit, isPending,
}: {
  invoice: Record<string, any> | null;
  suppliers: Record<string, any>[];
  categories: Record<string, any>[];
  onClose: () => void;
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
}) {
  const isEdit = !!invoice;

  const [invoiceNumber, setInvoiceNumber] = useState<string>(invoice?.invoice_number as string || '');
  const [invoiceDate, setInvoiceDate] = useState<string>(
    invoice?.invoice_date ? String(invoice.invoice_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd')
  );
  const [supplierId, setSupplierId] = useState<string>(invoice?.supplier_id as string || '');
  const [categoryId, setCategoryId] = useState<string>(invoice?.category_id as string || '');
  const [amountHT, setAmountHT] = useState<string>(
    invoice?.amount !== undefined ? String(invoice.amount) : ''
  );
  const [taxAmount, setTaxAmount] = useState<string>(
    invoice?.tax_amount !== undefined ? String(invoice.tax_amount) : '0'
  );
  const [totalTTC, setTotalTTC] = useState<string>(
    invoice?.total_amount !== undefined ? String(invoice.total_amount) : ''
  );
  // Champ source de derniere edition : evite les boucles infinies dans le calcul live.
  // 'ht_tva' : on a edite HT ou TVA -> TTC est derive
  // 'ttc' : on a edite TTC -> TVA est derive (HT garde sa valeur)
  const [lastEdit, setLastEdit] = useState<'ht_tva' | 'ttc'>('ht_tva');
  // Taux TVA selectionne (Maroc : 0/7/10/14/20%). '' = mode manuel (montant libre).
  // Quand un taux est selectionne, TVA = HT * taux/100 et TTC suit automatiquement.
  // Detecte a l'initialisation si le ratio TVA/HT correspond a un taux usuel.
  const [vatRate, setVatRate] = useState<string>(() => {
    const ht = parseFloat(invoice?.amount as string) || 0;
    const tva = parseFloat(invoice?.tax_amount as string) || 0;
    if (ht <= 0) return '';
    if (tva === 0) return '0';
    const rate = (tva / ht) * 100;
    for (const r of [7, 10, 14, 20]) {
      if (Math.abs(rate - r) < 0.05) return String(r);
    }
    return '';
  });
  const [dueDate, setDueDate] = useState<string>(
    invoice?.due_date ? String(invoice.due_date).slice(0, 10) : ''
  );
  const [receptionDate, setReceptionDate] = useState<string>(
    invoice?.reception_date ? String(invoice.reception_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd')
  );
  const [expectedPaymentMode, setExpectedPaymentMode] = useState<string>(
    invoice?.expected_payment_mode as string || ''
  );
  // N° cheque saisi des la creation/edition facture quand mode = cheque.
  // Servira de pre-remplissage du payment.check_number au moment du paiement.
  const [checkNumber, setCheckNumber] = useState<string>(
    invoice?.check_number as string || ''
  );
  const [notes, setNotes] = useState<string>(invoice?.notes as string || '');

  // Quand un taux TVA est selectionne, on derive le montant TVA depuis HT.
  // Le useEffect HT+TVA=TTC en aval s'occupera de mettre a jour le TTC.
  useEffect(() => {
    if (vatRate === '') return;
    const ht = parseFloat(amountHT) || 0;
    const rate = parseFloat(vatRate);
    const newTVA = (ht * rate / 100).toFixed(2);
    if (newTVA !== taxAmount) {
      setTaxAmount(newTVA);
      setLastEdit('ht_tva');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vatRate, amountHT]);

  // Recalcul live : HT + TVA = TTC OU TTC - HT = TVA
  useEffect(() => {
    const ht = parseFloat(amountHT) || 0;
    if (lastEdit === 'ht_tva') {
      const tva = parseFloat(taxAmount) || 0;
      const newTTC = (ht + tva).toFixed(2);
      if (newTTC !== totalTTC) setTotalTTC(newTTC);
    } else {
      const ttc = parseFloat(totalTTC) || 0;
      const newTVA = (ttc - ht).toFixed(2);
      if (newTVA !== taxAmount) setTaxAmount(newTVA);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountHT, taxAmount, totalTTC, lastEdit]);

  // Pour les editions, paid_amount sert de borne basse — le user ne peut pas
  // baisser le total en dessous de ce qui a deja ete encaisse.
  const paidAmount = parseFloat(invoice?.paid_amount as string || '0');
  const ttcNum = parseFloat(totalTTC) || 0;
  const ttcBelowPaid = isEdit && paidAmount > 0 && ttcNum < paidAmount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, any> = {
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate,
      supplierId: supplierId || null,
      categoryId: categoryId || null,
      amount: parseFloat(amountHT) || 0,
      taxAmount: parseFloat(taxAmount) || 0,
      totalAmount: parseFloat(totalTTC) || 0,
      notes: notes.trim() || null,
    };
    if (dueDate) data.dueDate = dueDate; else data.dueDate = null;
    if (receptionDate) data.receptionDate = receptionDate; else data.receptionDate = null;
    if (expectedPaymentMode) data.expectedPaymentMode = expectedPaymentMode;
    else data.expectedPaymentMode = null;
    // N° cheque : seulement si mode = cheque (sinon on neutralise pour eviter
    // les valeurs orphelines apres un changement de mode)
    data.checkNumber = expectedPaymentMode === 'check' ? (checkNumber.trim() || null) : null;
    onSubmit(data);
  };

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <FileText size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Facture fournisseur</span>
            <span className="odoo-breadcrumb-separator">/</span>
            <span className="odoo-breadcrumb-current">
              {isEdit ? `Modifier ${invoice?.invoice_number as string}` : 'Nouvelle'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>N° Facture *</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date *</label>
                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Fournisseur *</label>
                <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required>
                  <option value="">Choisir...</option>
                  {suppliers.filter(s => s.is_active || s.id === supplierId).map(s => (
                    <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                  ))}
                </select></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Catégorie</label>
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">Choisir...</option>
                  {categories.filter(c => c.type === 'expense').map(c => (
                    <option key={c.id as string} value={c.id as string}>{c.name as string}</option>
                  ))}
                </select></div>
            </div>
            {/* HT / TVA / TTC : ligne dediee avec live sync */}
            <div className="grid grid-cols-3 gap-3" style={{ padding: '8px 10px', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4, border: '1px solid var(--theme-bg-separator)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Montant HT *</label>
                <input type="number" step="0.01" value={amountHT}
                  onChange={e => { setAmountHT(e.target.value); setLastEdit('ht_tva'); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>TVA</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={vatRate} onChange={e => setVatRate(e.target.value)}
                    title="Taux TVA — applique HT × taux/100"
                    className="px-2 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    style={{ width: 68, flexShrink: 0 }}>
                    <option value="">—</option>
                    <option value="0">0%</option>
                    <option value="7">7%</option>
                    <option value="10">10%</option>
                    <option value="14">14%</option>
                    <option value="20">20%</option>
                  </select>
                  <input type="number" step="0.01" value={taxAmount}
                    onChange={e => { setTaxAmount(e.target.value); setLastEdit('ht_tva'); setVatRate(''); }}
                    className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                    style={{ flex: 1, minWidth: 0 }} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-accent)', marginBottom: 4 }}>Montant TTC</label>
                <input type="number" step="0.01" value={totalTTC}
                  onChange={e => { setTotalTTC(e.target.value); setLastEdit('ttc'); }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  style={{ fontWeight: 600 }} />
              </div>
            </div>
            {ttcBelowPaid && (
              <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: '#b71c1c', backgroundColor: '#fff5f5', border: '1px solid #f5c6cb', borderRadius: 4 }}>
                ⚠ Le montant TTC ({n(ttcNum)} DH) est inférieur au montant déjà payé ({n(paidAmount)} DH). Ajustez avant d'enregistrer.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Échéance</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Date de réception</label>
                <input type="date" value={receptionDate} onChange={e => setReceptionDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
              <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Règlement prévu</label>
                <select value={expectedPaymentMode} onChange={e => setExpectedPaymentMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400">
                  <option value="">— Non défini —</option>
                  <option value="cash">Espèces</option>
                  <option value="check">Chèque</option>
                  <option value="transfer">Virement</option>
                </select></div>
            </div>
            {/* N° cheque : affiche uniquement quand le mode est "Cheque".
                Pre-remplira automatiquement le payment.check_number au moment du reglement. */}
            {expectedPaymentMode === 'check' && (
              <div style={{ padding: '8px 10px', backgroundColor: '#fef3c7', borderRadius: 4, border: '1px solid #fde68a' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                  N° Chèque
                </label>
                <input type="text" value={checkNumber} onChange={e => setCheckNumber(e.target.value)}
                  placeholder="Ex: 1234567"
                  className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-amber-400" />
                <p style={{ fontSize: '0.6875rem', color: '#92400e', marginTop: 4 }}>
                  💡 Sera pré-rempli au moment du paiement.
                </p>
              </div>
            )}
            <div><label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)', marginBottom: 4 }}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></div>
            {isEdit && paidAmount > 0 && (
              <div style={{ padding: '6px 10px', fontSize: '0.6875rem', color: 'var(--theme-text-muted)', backgroundColor: 'var(--theme-bg-page)', borderRadius: 4 }}>
                💡 Déjà payé : <strong>{n(paidAmount)} DH</strong>. Le statut sera recalculé automatiquement après modification.
              </div>
            )}
          </div>
          <div style={{ position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)', borderTop: '1px solid var(--theme-bg-separator)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={onClose} className="odoo-btn-secondary">Annuler</button>
            <button type="submit" disabled={isPending || ttcBelowPaid} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {isPending && <Loader2 size={12} className="animate-spin" />}
              {isEdit ? 'Enregistrer' : 'Créer la facture'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
