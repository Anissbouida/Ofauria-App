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
import toast from 'react-hot-toast';
import PurchaseOrdersTab from '../accounting/PurchaseOrdersTab';
import PurchaseRequestsPage from './PurchaseRequestsPage';

type PurchasingTab = 'suppliers' | 'purchase_orders' | 'invoices' | 'waiting_list';

const PAYMENT_METHOD_LABELS: Record<string, string> = { cash: 'Espèces', bank: 'Virement', check: 'Chèque', transfer: 'Virement' };
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-700 to-indigo-800 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-white rounded-full" />
        </div>
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <ShoppingCart size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Achats</h1>
            <p className="text-blue-200 text-sm mt-0.5">Fournisseurs, commandes et facturation</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
        <div className="flex gap-1 overflow-x-auto">
          {allTabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                  tab === t.key
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}>
                <Icon size={16} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'waiting_list' && <PurchaseRequestsPage />}
      {tab === 'suppliers' && <SuppliersTab />}
      {tab === 'purchase_orders' && <PurchaseOrdersTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </div>
  );
}

/* ═══════════════════════ SUPPLIERS TAB ═══════════════════════ */
function SuppliersTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing ? suppliersApi.update(editing.id as string, data) : suppliersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(editing ? 'Fournisseur modifié' : 'Fournisseur ajouté');
      setShowForm(false); setEditing(null);
    },
    onError: () => toast.error('Erreur'),
  });

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
            <Truck size={14} className="text-white" />
          </div>
          <p className="text-sm font-medium text-gray-600">{(suppliers as Record<string, unknown>[]).length} fournisseur{(suppliers as Record<string, unknown>[]).length > 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
          <Plus size={16} /> Ajouter un fournisseur
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-blue-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des fournisseurs...</p>
        </div>
      ) : (suppliers as Record<string, unknown>[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
            <Truck size={28} className="text-blue-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucun fournisseur</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(suppliers as Record<string, unknown>[]).map(s => (
            <div key={s.id as string} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center flex-shrink-0">
                    <Truck size={16} className="text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-800">{s.name as string}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {s.is_active ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {s.contact_name && <span>{s.contact_name as string}</span>}
                      {s.phone && <><span className="text-gray-200">|</span><span>{s.phone as string}</span></>}
                      {s.city && <><span className="text-gray-200">|</span><span>{s.city as string}</span></>}
                      {s.ice && <span className="font-mono text-gray-300 text-[10px]">ICE: {s.ice as string}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => { setEditing(s); setShowForm(true); }}
                  className="p-2.5 hover:bg-blue-50 rounded-xl text-blue-400 hover:text-blue-600 transition-colors ml-3">
                  <Pencil size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Truck size={18} className="text-white" />
                </div>
                <h2 className="text-lg font-bold text-white">{editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h2>
              </div>
              <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X size={18} className="text-white" />
              </button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              saveMutation.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }} className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Nom *</label>
                <input name="name" defaultValue={editing?.name as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Contact</label>
                  <input name="contactName" defaultValue={editing?.contact_name as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Téléphone</label>
                  <input name="phone" defaultValue={editing?.phone as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                  <input name="email" type="email" defaultValue={editing?.email as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Ville</label>
                  <input name="city" defaultValue={editing?.city as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Adresse</label>
                <input name="address" defaultValue={editing?.address as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">ICE</label>
                <input name="ice" defaultValue={editing?.ice as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <textarea name="notes" rows={2} defaultValue={editing?.notes as string} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }}
                  className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={saveMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
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
  const [showPayForm, setShowPayForm] = useState<Record<string, unknown> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'received', statusFilter],
    queryFn: () => invoicesApi.list({ invoiceType: 'received', ...(statusFilter ? { status: statusFilter } : {}) }),
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const { data: categories = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: expenseCategoriesApi.list });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => invoicesApi.create({ ...data, invoiceType: 'received' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Facture ajoutée'); setShowForm(false); },
    onError: () => toast.error('Erreur'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Facture annulée'); },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments-charges'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      toast.success('Paiement enregistré');
      setShowPayForm(null);
    },
    onError: () => toast.error('Erreur'),
  });

  const attachMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => invoicesApi.uploadAttachment(id, file),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Facture jointe avec succès'); },
    onError: () => toast.error('Erreur lors de l\'envoi du fichier'),
  });

  const removeAttachMutation = useMutation({
    mutationFn: (id: string) => invoicesApi.removeAttachment(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['invoices'] }); toast.success('Pièce jointe supprimée'); },
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

  const totalPending = (invoices as Record<string, unknown>[])
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + parseFloat(inv.total_amount as string) - parseFloat(inv.paid_amount as string), 0);

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 w-auto">
            <option value="">Tous les statuts</option>
            <option value="pending">En attente</option>
            <option value="partial">Partiel</option>
            <option value="paid">Payée</option>
            <option value="overdue">En retard</option>
          </select>
          {totalPending > 0 && (
            <div className="flex items-center gap-2 text-sm bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
                <AlertTriangle size={12} className="text-white" />
              </div>
              <span className="text-red-700">Reste à payer: <span className="font-bold">{n(totalPending)} DH</span></span>
            </div>
          )}
        </div>
        <button onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
          <Plus size={16} /> Nouvelle facture
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-amber-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des factures...</p>
        </div>
      ) : (invoices as Record<string, unknown>[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <FileText size={28} className="text-amber-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucune facture reçue</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(invoices as Record<string, unknown>[]).map(inv => {
            const total = parseFloat(inv.total_amount as string);
            const paid = parseFloat(inv.paid_amount as string);
            const remaining = total - paid;
            const hasAttachment = !!(inv.attachment_url as string);
            const progressPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
            const statusColor = INVOICE_STATUS_COLORS[inv.status as string] || 'bg-gray-100 text-gray-500';
            return (
              <div key={inv.id as string} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
                      <FileText size={16} className="text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-bold text-gray-800 font-mono">{inv.invoice_number as string}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor}`}>
                          {INVOICE_STATUS_LABELS[inv.status as string]}
                        </span>
                        {hasAttachment && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-500"><Paperclip size={10} /></span>}
                        {inv.purchase_order_number && (
                          <span className="px-2 py-0.5 rounded bg-slate-50 text-slate-500 text-[10px] font-mono">BC {inv.purchase_order_number as string}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="font-medium text-gray-600">{inv.supplier_name as string}</span>
                        <span className="text-gray-200">|</span>
                        <span>{format(new Date(inv.invoice_date as string), 'dd/MM/yyyy')}</span>
                        {inv.category_name && <><span className="text-gray-200">|</span><span>{inv.category_name as string}</span></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-800">{n(total)} <span className="text-xs font-normal text-gray-400">DH</span></p>
                      {remaining > 0 && <p className="text-xs text-red-500 font-medium">Reste: {n(remaining)} DH</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      {hasAttachment ? (
                        <>
                          <a href={inv.attachment_url as string} target="_blank" rel="noopener noreferrer"
                            className="p-2 hover:bg-blue-50 rounded-xl text-blue-500 hover:text-blue-700 transition-colors" title="Voir"><Eye size={14} /></a>
                          <button onClick={() => removeAttachMutation.mutate(inv.id as string)}
                            className="p-2 hover:bg-red-50 rounded-xl text-red-400 hover:text-red-600 transition-colors" title="Supprimer pièce jointe"><Trash2 size={14} /></button>
                        </>
                      ) : (
                        <button onClick={() => handleAttachFile(inv.id as string)}
                          className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-colors" title="Joindre facture"><Upload size={14} /></button>
                      )}
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                        <button onClick={() => { setShowPayForm(inv); setPayMethod('cash'); }}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm hover:shadow-md transition-all">Payer</button>
                      )}
                      {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                        <button onClick={() => cancelMutation.mutate(inv.id as string)}
                          className="p-2 hover:bg-red-50 rounded-xl text-red-400 hover:text-red-600 transition-colors"><X size={14} /></button>
                      )}
                    </div>
                  </div>
                </div>
                {inv.status !== 'cancelled' && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progressPct >= 100 ? 'bg-gradient-to-r from-emerald-400 to-green-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                        style={{ width: `${progressPct}%` }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                      <span>Payé: {n(paid)} DH</span>
                      <span>{Math.round(progressPct)}%</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create invoice modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><FileText size={18} className="text-white" /></div>
                <h2 className="text-lg font-bold text-white">Nouvelle facture fournisseur</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/20 rounded-xl transition-colors"><X size={18} className="text-white" /></button>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string) || 0;
              fd.taxAmount = parseFloat(fd.taxAmount as string) || 0;
              fd.totalAmount = (fd.amount as number) + (fd.taxAmount as number);
              createMutation.mutate(fd);
            }} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">N° Facture *</label>
                  <input name="invoiceNumber" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="invoiceDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" required defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Fournisseur *</label>
                  <select name="supplierId" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" required>
                    <option value="">Choisir...</option>
                    {(suppliers as Record<string, unknown>[]).filter(s => s.is_active).map(s => (
                      <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
                    ))}
                  </select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Catégorie</label>
                  <select name="categoryId" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">Choisir...</option>
                    {(categories as Record<string, unknown>[]).filter(c => c.type === 'expense').map(c => (
                      <option key={c.id as string} value={c.id as string}>{c.name as string}</option>
                    ))}
                  </select></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant HT *</label>
                  <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">TVA</label>
                  <input name="taxAmount" type="number" step="0.01" defaultValue="0" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Échéance</label>
                  <input name="dueDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
                <textarea name="notes" rows={2} className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={createMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {createMutation.isPending && <Loader2 size={14} className="animate-spin" />} Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay invoice modal */}
      {showPayForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500 to-green-500 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Banknote size={18} className="text-white" /></div>
                <h2 className="text-lg font-bold text-white">Payer la facture</h2>
              </div>
              <div className="bg-white/20 rounded-xl p-3 flex items-center justify-between">
                <span className="text-white/80 text-sm font-mono">{showPayForm.invoice_number as string}</span>
                <span className="text-white font-bold">
                  {n(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string))} DH
                </span>
              </div>
            </div>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, unknown>;
              fd.amount = parseFloat(fd.amount as string);
              fd.type = 'invoice';
              fd.invoiceId = showPayForm.id;
              fd.supplierId = showPayForm.supplier_id;
              fd.categoryId = showPayForm.category_id || undefined;
              fd.description = `Paiement facture ${showPayForm.invoice_number}`;
              if (payMethod !== 'check') { fd.checkNumber = undefined; fd.checkDate = undefined; }
              payMutation.mutate(fd);
            }} className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Montant *</label>
                <input name="amount" type="number" step="0.01" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" required
                  defaultValue={(parseFloat(showPayForm.total_amount as string) - parseFloat(showPayForm.paid_amount as string)).toFixed(2)} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Méthode *</label>
                  <select name="paymentMethod" value={payMethod} onChange={e => setPayMethod(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                    <option value="cash">Espèces</option>
                    <option value="check">Chèque</option>
                    <option value="bank">Virement</option>
                    <option value="transfer">Virement bancaire</option>
                  </select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Date *</label>
                  <input name="paymentDate" type="date" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" defaultValue={format(new Date(), 'yyyy-MM-dd')} required /></div>
              </div>
              {payMethod === 'check' && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Détails du chèque</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-blue-700 mb-1">N° Chèque *</label>
                      <input name="checkNumber" className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" required /></div>
                    <div><label className="block text-xs font-medium text-blue-700 mb-1">Date du chèque</label>
                      <input name="checkDate" type="date" className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" defaultValue={format(new Date(), 'yyyy-MM-dd')} /></div>
                  </div>
                </div>
              )}
              <div><label className="block text-sm font-medium text-gray-700 mb-1.5">Référence / Notes</label>
                <input name="reference" className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Optionnel" /></div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowPayForm(null)} className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">Annuler</button>
                <button type="submit" disabled={payMutation.isPending}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
                  {payMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  <Check size={16} /> Payer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/* EmittedInvoicesSection moved to ../sales/EmittedInvoicesTab.tsx */
