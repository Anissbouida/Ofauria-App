import { useState, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, paymentsApi } from '../../api/accounting.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { format, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, X, Check, Download, Receipt, Loader2, Search, Banknote, Eye, Ban, Trash2,
  AlertTriangle, CalendarDays, Building2, CheckCircle2, Clock, Coins, ClipboardList, Package,
  User, FileText, CreditCard, Truck,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StagePipeline, type StageDef, type StageStat } from '../../components/purchasing/ProcessBoard';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(val: number): string {
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ Référentiel d'affichage (même grammaire que Commandes et Achats) ═══ */

type Inv = Record<string, any>;

/** Étapes d'une facture client : émise → partiellement encaissée → soldée. */
const STAGES: StageDef[] = [
  { key: 'pending', label: 'À encaisser', hint: 'reste dû', icon: Clock },
  { key: 'partial', label: 'Partielles', hint: 'reste dû', icon: Coins },
  { key: 'paid', label: 'Soldées', hint: 'encaissé', icon: CheckCircle2 },
];
const STATUS_LABEL: Record<string, string> = { pending: 'À encaisser', partial: 'Partielle', paid: 'Soldée', cancelled: 'Annulée' };
const STATUS_TAG: Record<string, string> = { pending: 'odoo-tag-yellow', partial: 'odoo-tag-blue', paid: 'odoo-tag-green', cancelled: 'odoo-tag-red' };
const STATUS_DOT: Record<string, string> = { pending: 'warning', partial: 'warning', paid: 'ok', cancelled: 'neutral' };
const FILTER_CHIPS: Array<{ key: string; label: string; icon: typeof Clock }> = [
  { key: '', label: 'Toutes', icon: ClipboardList },
  { key: 'pending', label: 'À encaisser', icon: Clock },
  { key: 'partial', label: 'Partielles', icon: Coins },
  { key: 'paid', label: 'Soldées', icon: CheckCircle2 },
  { key: 'cancelled', label: 'Annulées', icon: Ban },
];

const PAY_LABELS: Record<string, string> = { bank: 'Virement', check: 'Chèque', traite: 'Traite (LCN)', cash: 'Espèces', card: 'Carte' };
/** Libellé du mode de paiement : référentiel, sinon libellé par défaut (le référentiel n'a pas « bank »). */
const payLabel = (get: (c: string) => string, code: string) => { const l = get(code); return l && l !== code ? l : PAY_LABELS[code] ?? code; };

function num(v: unknown) { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; }
function remainingOf(inv: Inv) { return Math.max(0, num(inv.total_amount) - num(inv.paid_amount)); }
/** Étape d'affichage : « partielle » dès qu'une partie est encaissée (le statut base reste pending). */
function stageOf(inv: Inv): string {
  if (inv.status === 'cancelled' || inv.status === 'paid') return inv.status;
  return num(inv.paid_amount) > 0.004 ? 'partial' : 'pending';
}
function isOverdue(inv: Inv, today: Date) {
  const st = stageOf(inv);
  if ((st !== 'pending' && st !== 'partial') || !inv.due_date) return false;
  return startOfDay(new Date(String(inv.due_date).slice(0, 10) + 'T00:00:00')) < today;
}
function isPro(inv: Inv) { return !!inv.customer_type && inv.customer_type !== 'particulier'; }
function customerLabel(inv: Inv) {
  if (inv.customer_company_name && isPro(inv)) return inv.customer_company_name as string;
  return inv.customer_first_name ? `${inv.customer_first_name} ${inv.customer_last_name || ''}`.trim() : 'Client inconnu';
}
function customerOption(c: Inv) {
  return c.company_name && c.customer_type && c.customer_type !== 'particulier'
    ? c.company_name as string : `${c.first_name || ''} ${c.last_name || ''}`.trim();
}
function fmtDate(d: unknown, pattern = 'dd MMM yyyy') {
  return d ? format(new Date(String(d).slice(0, 10) + 'T00:00:00'), pattern, { locale: fr }) : '—';
}

/* Styles partagés des fenêtres (mêmes valeurs que Commandes et Achats). */
const modalPanelStyle: CSSProperties = {
  backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
  borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};
const modalHeaderStyle: CSSProperties = { backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem', color: '#fff' };
const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.03em', color: 'var(--odoo-text-muted)', marginBottom: 4,
};
const fieldStyle: CSSProperties = {
  width: '100%', padding: '0.375rem 0.5rem', border: '1px solid var(--odoo-border)',
  borderRadius: 4, fontSize: '0.8125rem', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};
const sectionStyle: CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' };

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
  const confirm = useConfirm();
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  // Filtres côté client : le pipeline et la liste partagent la même lecture.
  const [statusFilter, setStatusFilter] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewing, setViewing] = useState<Inv | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState<Record<string, any> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualDate, setManualDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [manualNotes, setManualNotes] = useState('');
  // Édition d'une facture existante : id ciblé (null = création). Réutilise le formulaire manuel.
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // tvaRate : taux TVA de la ligne en % (null = pas de TVA explicite).
  const [manualItems, setManualItems] = useState<{ productId: string; description: string; quantity: number; unitPrice: number; tvaRate: number | null }[]>([
    { productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null },
  ]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'emitted'],
    queryFn: () => invoicesApi.list({ invoiceType: 'emitted' }),
  });

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const customers = ((customersData as Record<string, any>)?.data || customersData || []) as Record<string, any>[];

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
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (res?.approval) notify.warning(`Annulation soumise à approbation (${res.approval.rule_label}).`);
      else notify.success('Facture annulée');
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      notify.error(e?.response?.data?.error?.message ?? 'Annulation refusée');
    },
  });

  const payMutation = useMutation({
    mutationFn: (data: Record<string, any>) => paymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['caisse-register'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      notify.success('Encaissement enregistré');
      setShowPayModal(null);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Encaissement refusé'),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-for-invoice'],
    queryFn: () => productsApi.list({ limit: '500' }),
    enabled: showCreateModal,
  });
  const products = ((productsData as Record<string, any>)?.data || productsData || []) as Record<string, any>[];

  const resetManualForm = () => {
    setManualCustomerId('');
    setManualDate(format(new Date(), 'yyyy-MM-dd'));
    setManualNotes('');
    setManualItems([{ productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null }]);
    setEditingInvoiceId(null);
  };

  // Saisie « intelligente » HT <-> TTC. On stocke toujours le prix unitaire HT ; le TTC
  // est dérivé du taux TVA de la ligne (taux null => 0, pas de TVA). Éditer l'un recalcule l'autre.
  const lineRate = (it: { tvaRate: number | null }) => (it.tvaRate == null ? 0 : it.tvaRate);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const unitTtc = (it: { unitPrice: number; tvaRate: number | null }) => round2(it.unitPrice * (1 + lineRate(it) / 100));
  const setUnitHt = (idx: number, ht: number) => updateManualItem(idx, 'unitPrice', ht);
  const setUnitTtc = (idx: number, ttc: number) => {
    const it = manualItems[idx];
    updateManualItem(idx, 'unitPrice', round2(ttc / (1 + lineRate(it) / 100)));
  };
  // Gabarit de colonnes partagé entre l'en-tête et les lignes d'articles (une seule ligne par article).
  const ITEM_GRID = 'minmax(0,1fr) 44px 72px 64px 72px 84px 22px';

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

  // Modification : remplace les lignes (recalcule HT/TVA/TTC) puis met à jour date/notes/client.
  const updateManualMutation = useMutation({
    mutationFn: async (payload: { id: string; items: Record<string, any>[]; header: Record<string, any> }) => {
      await invoicesApi.replaceItems(payload.id, payload.items as any);
      await invoicesApi.update(payload.id, payload.header);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      notify.success('Facture modifiée');
      setShowCreateModal(false);
      resetManualForm();
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur lors de la modification'),
  });

  const openEdit = async (inv: Record<string, any>) => {
    setEditingInvoiceId(inv.id as string);
    setShowCreateModal(true);
    setEditLoading(true);
    try {
      const full = await invoicesApi.getById(inv.id as string) as Record<string, any>;
      setManualCustomerId((full.customer_id as string) || '');
      setManualDate(full.invoice_date ? String(full.invoice_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd'));
      setManualNotes((full.notes as string) || '');
      const items = (full.items as Record<string, any>[]) || [];
      setManualItems(items.length ? items.map(it => ({
        productId: (it.product_id as string) || '',
        description: (it.description as string) || (it.product_name as string) || '',
        quantity: parseFloat(it.quantity as string) || 0,
        unitPrice: parseFloat(it.unit_price as string) || 0,
        tvaRate: it.tva_rate === null || it.tva_rate === undefined ? null : parseFloat(it.tva_rate as string),
      })) : [{ productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null }]);
    } catch {
      notify.error('Erreur lors du chargement de la facture');
      setShowCreateModal(false);
      resetManualForm();
    } finally {
      setEditLoading(false);
    }
  };

  const handleUpdateManual = () => {
    if (!editingInvoiceId) return;
    if (!manualCustomerId) { notify.error('Veuillez sélectionner un client'); return; }
    if (manualItems.some(it => !it.description || it.unitPrice <= 0)) { notify.error('Veuillez remplir tous les articles'); return; }
    if (!manualDate) { notify.error('Veuillez saisir la date de facturation'); return; }
    updateManualMutation.mutate({
      id: editingInvoiceId,
      items: manualItems.map(it => ({
        productId: it.productId || undefined,
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
        tvaRate: it.tvaRate,
      })),
      // Pas de montants ici : replaceItems a déjà recalculé HT/TVA/TTC depuis les lignes.
      header: { invoiceDate: manualDate, notes: manualNotes, customerId: manualCustomerId },
    });
  };

  const allInvoices = invoices as Record<string, any>[];
  const today = startOfDay(new Date());

  /* ── Compteurs du pipeline (même grammaire que Commandes et Achats) ── */
  const stageStats = useMemo(() => {
    const stats: Record<string, StageStat> = {};
    const amounts: Record<string, number> = {};
    for (const s of STAGES) { stats[s.key] = { count: 0, sub: '', late: 0 }; amounts[s.key] = 0; }
    for (const inv of allInvoices) {
      const key = stageOf(inv);
      if (!stats[key]) continue;
      stats[key].count += 1;
      amounts[key] += key === 'paid' ? num(inv.total_amount) : remainingOf(inv);
      if (isOverdue(inv, today)) stats[key].late = (stats[key].late || 0) + 1;
    }
    for (const s of STAGES) stats[s.key].sub = `${n(amounts[s.key])} DH`;
    return stats;
  }, [allInvoices, today]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': allInvoices.length };
    for (const inv of allInvoices) { const k = stageOf(inv); c[k] = (c[k] || 0) + 1; }
    return c;
  }, [allInvoices]);
  const overdue = useMemo(() => allInvoices.filter(inv => isOverdue(inv, today)), [allInvoices, today]);
  const overdueAmount = overdue.reduce((s, inv) => s + remainingOf(inv), 0);
  const billed = allInvoices.filter(inv => inv.status !== 'cancelled');
  const totalBilled = billed.reduce((s, inv) => s + num(inv.total_amount), 0);
  const totalPaid = billed.reduce((s, inv) => s + num(inv.paid_amount), 0);
  const rate = totalBilled > 0 ? Math.round(totalPaid / totalBilled * 100) : 0;

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allInvoices.filter(inv => {
      if (statusFilter && stageOf(inv) !== statusFilter) return false;
      if (lateOnly && !isOverdue(inv, today)) return false;
      if (!q) return true;
      return [inv.invoice_number, customerLabel(inv), inv.order_number_ref, inv.delivery_note_numbers]
        .some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [allInvoices, searchQuery, statusFilter, lateOnly, today]);
  const filteredTotal = filteredInvoices.reduce((s, inv) => s + num(inv.total_amount), 0);
  const filteredRemaining = filteredInvoices.filter(inv => inv.status !== 'cancelled').reduce((s, inv) => s + remainingOf(inv), 0);
  const hasFilters = !!(statusFilter || lateOnly || searchQuery);

  const handleDownloadPdf = async (inv: Record<string, any>) => {
    try {
      const response = await invoicesApi.downloadDocx(inv.id as string);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { notify.error('Erreur lors du téléchargement'); }
  };
  const cancelInvoice = async (inv: Record<string, any>) => {
    if (await confirm(`Annuler la facture ${inv.invoice_number} ? Ses bons de livraison redeviendront « à facturer ».`,
      { title: 'Annuler la facture', confirmLabel: 'Annuler la facture', cancelLabel: 'Retour', danger: true })) {
      cancelMutation.mutate(inv.id as string);
    }
  };
  const openPay = (inv: Record<string, any>) => { setShowPayModal(inv); setPayMethod('bank'); };
  const openCreate = () => { resetManualForm(); setShowCreateModal(true); };

  const chipStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    backgroundColor: active ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
    color: active ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Alerte échéances dépassées */}
      {overdue.length > 0 && (
        <StatusBanner tone="danger" icon={AlertTriangle}
          title={`${overdue.length} facture${overdue.length > 1 ? 's' : ''} en retard de paiement · ${n(overdueAmount)} DH`}
          actions={
            <button type="button" className={lateOnly ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
              onClick={() => { setLateOnly(v => !v); setStatusFilter(''); }}>
              {lateOnly ? 'Voir toutes les factures' : 'Voir les retards'}
            </button>
          }>
          Échéance dépassée sans règlement complet : à relancer ou à encaisser.
        </StatusBanner>
      )}

      {/* Pipeline */}
      <StagePipeline
        title="Suivi des factures"
        summary={`${(counts.pending || 0) + (counts.partial || 0)} à encaisser · ${counts.paid || 0} soldée${(counts.paid || 0) > 1 ? 's' : ''} · ${counts.cancelled || 0} annulée${(counts.cancelled || 0) > 1 ? 's' : ''} · ${rate} % encaissé`}
        stages={STAGES}
        stats={stageStats}
        isActive={(k) => statusFilter === k && !lateOnly}
        onPick={(k) => { setLateOnly(false); setStatusFilter(statusFilter === k ? '' : k); }}
      />

      {/* Liste */}
      <div style={sectionStyle}>
        <div className="odoo-search-panel" style={{ flexWrap: 'wrap' }}>
          {FILTER_CHIPS.map((chip) => {
            const Icon = chip.icon;
            const active = statusFilter === chip.key && !lateOnly;
            const count = counts[chip.key] || 0;
            return (
              <button key={chip.key} onClick={() => { setLateOnly(false); setStatusFilter(chip.key); }}
                className="odoo-filter-dropdown" style={chipStyle(active)}>
                <Icon size={11} /> {chip.label}
                {count > 0 && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 2 }}>{count}</span>}
              </button>
            );
          })}
          {lateOnly && (
            <span className="odoo-filter-chip">
              En retard
              <span className="odoo-filter-chip-remove" onClick={() => setLateOnly(false)} role="button" aria-label="Retirer le filtre">×</span>
            </span>
          )}
          <button onClick={openCreate} className="odoo-btn-primary" style={{ marginLeft: 'auto' }}>
            <Plus size={13} /> Nouvelle facture
          </button>
        </div>
        <div className="odoo-search-panel" style={{ borderTop: '1px solid var(--odoo-border)' }}>
          <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <input type="text" placeholder="Rechercher par n°, client, commande ou bon de livraison..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="odoo-search-input" />
        </div>

        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Chargement des factures...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <Receipt size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucune facture</p>
            <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>{hasFilters ? 'Aucun résultat pour ces filtres' : 'Les factures naissent des bons de livraison ou d\'une saisie manuelle'}</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th style={{ width: 24 }}></th>
                    <th>N° facture</th>
                    <th>Client</th>
                    <th>Origine</th>
                    <th>Statut</th>
                    <th>Date</th>
                    <th>Échéance</th>
                    <th>Encaissement</th>
                    <th style={{ textAlign: 'right' }}>Total TTC</th>
                    <th style={{ textAlign: 'right' }}>Reste</th>
                    <th style={{ textAlign: 'right', width: 150 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(inv => {
                    const status = stageOf(inv);
                    const total = num(inv.total_amount);
                    const paid = num(inv.paid_amount);
                    const remaining = remainingOf(inv);
                    const late = isOverdue(inv, today);
                    const open = status === 'pending' || status === 'partial';
                    const pct = total > 0 ? Math.min(100, paid / total * 100) : 0;
                    return (
                      <tr key={inv.id as string} onClick={() => setViewing(inv)} className={late ? 'row-danger' : undefined}>
                        <td><span className={`odoo-status-dot ${late ? 'danger' : STATUS_DOT[status] || 'neutral'}`} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{inv.invoice_number as string}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {isPro(inv) && <Building2 size={11} style={{ color: '#1e7e4f' }} aria-label="Professionnel" />}
                            {customerLabel(inv)}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                          {inv.delivery_note_numbers || inv.order_number_ref || <span style={{ fontFamily: 'inherit' }}>Saisie manuelle</span>}
                        </td>
                        <td><span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{STATUS_LABEL[status] || status}</span></td>
                        <td style={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date)}</td>
                        <td style={{ color: late ? '#721c24' : 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CalendarDays size={11} /> {inv.due_date ? fmtDate(inv.due_date) : '—'}
                            {late && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 4 }}>En retard</span>}
                          </span>
                        </td>
                        <td style={{ minWidth: 110 }}>
                          {status === 'cancelled' ? (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ban size={11} /> Annulée</span>
                          ) : (
                            <div title={`${Math.round(pct)} % encaissé`}>
                              <span style={{ display: 'block', height: 5, borderRadius: 3, background: 'var(--odoo-border)', overflow: 'hidden', maxWidth: 120 }}>
                                <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct >= 100 ? '#28a745' : late ? '#dc3545' : 'var(--odoo-purple)' }} />
                              </span>
                              <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{Math.round(pct)} %</span>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 700 }}>{n(total)}</span>
                          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {status === 'cancelled' ? <span style={{ color: 'var(--theme-text-muted)' }}>—</span>
                            : remaining > 0.004 ? <span style={{ color: '#b85d1a', fontWeight: 600 }}>{n(remaining)} DH</span>
                            : <span style={{ color: '#155724', fontSize: '0.75rem' }}>soldée</span>}
                        </td>
                        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: 2 }}>
                            {open && remaining > 0.004 && (
                              <button onClick={() => openPay(inv)} title="Encaisser" className="odoo-pager-btn" style={{ color: '#28a745' }}><Banknote size={13} /></button>
                            )}
                            <button onClick={() => setViewing(inv)} title="Voir le détail" className="odoo-pager-btn"><Eye size={13} /></button>
                            <button onClick={() => handleDownloadPdf(inv)} title="Télécharger le PDF" className="odoo-pager-btn"><Download size={13} /></button>
                            {status !== 'cancelled' && (
                              <button onClick={() => openEdit(inv)} title="Modifier (date, TVA, articles)" className="odoo-pager-btn"><Pencil size={13} /></button>
                            )}
                            {open && (
                              <button onClick={() => cancelInvoice(inv)} title="Annuler la facture" className="odoo-pager-btn" style={{ color: '#dc3545' }}><Ban size={13} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', borderTop: '1px solid var(--odoo-border)' }}>
              <span>{filteredInvoices.length} facture{filteredInvoices.length > 1 ? 's' : ''}{hasFilters ? ' (filtrées)' : ''}</span>
              <span>Total <strong style={{ color: 'var(--theme-text-strong)' }}>{n(filteredTotal)} DH</strong> · reste à encaisser <strong style={{ color: '#b85d1a' }}>{n(filteredRemaining)} DH</strong></span>
            </div>
          </>
        )}
      </div>

      {viewing && (
        <InvoiceDetailModal
          invoice={viewing}
          late={isOverdue(viewing, today)}
          onClose={() => setViewing(null)}
          onPdf={handleDownloadPdf}
          onEdit={(inv) => { setViewing(null); openEdit(inv); }}
          onPay={(inv) => { setViewing(null); openPay(inv); }}
          onCancel={(inv) => { setViewing(null); cancelInvoice(inv); }}
        />
      )}

      {/* Création / modification */}
      {showCreateModal && (
        <ModalBackdrop onClose={() => { setShowCreateModal(false); resetManualForm(); }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 860, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Receipt size={18} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{editingInvoiceId ? 'Modifier la facture' : 'Nouvelle facture'}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{editingInvoiceId ? 'Date, TVA ou articles' : 'Saisie manuelle d\'une facture client'}</div>
              </div>
              <button onClick={() => { setShowCreateModal(false); resetManualForm(); }} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {!editingInvoiceId && (
                <StatusBanner tone="info" icon={Truck} title="Commande de professionnel ?">
                  Elle se facture depuis son bon de livraison (Commandes › Livrer sur BL, ou Livraisons pros › À facturer).
                  Une commande de particulier se règle en caisse.
                </StatusBanner>
              )}
              {editLoading ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  <Loader2 className="animate-spin" size={22} style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '0.8125rem' }}>Chargement de la facture...</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Client</label>
                      <select value={manualCustomerId} onChange={e => setManualCustomerId(e.target.value)} style={fieldStyle}>
                        <option value="">— Sélectionner un client —</option>
                        {customers.map(c => (<option key={c.id as string} value={c.id as string}>{customerOption(c)}</option>))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Date de facturation</label>
                      <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} style={fieldStyle} />
                    </div>
                  </div>

                  <div style={sectionStyle}>
                    <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center' }}>
                      <Package size={11} /> Articles
                      <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>prix HT ou TTC : l'autre se calcule selon la TVA</span>
                      <button onClick={addManualItem} className="odoo-btn-secondary" style={{ marginLeft: 'auto', padding: '0.15rem 0.5rem' }}><Plus size={12} /> Ligne</button>
                    </div>
                    <table className="odoo-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Désignation</th>
                          <th style={{ width: 70, textAlign: 'right' }}>Qté</th>
                          <th style={{ width: 100, textAlign: 'right' }}>P.U. HT</th>
                          <th style={{ width: 80 }}>TVA</th>
                          <th style={{ width: 100, textAlign: 'right' }}>P.U. TTC</th>
                          <th style={{ width: 110, textAlign: 'right' }}>Total TTC</th>
                          <th style={{ width: 32 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualItems.map((item, idx) => (
                          <tr key={idx} style={{ cursor: 'default' }}>
                            <td>
                              <ProductSearchInput products={products} value={item.description}
                                onSelect={(product) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], productId: product.id as string, description: product.name as string, unitPrice: parseFloat(product.price as string) || 0 }; setManualItems(updated); }}
                                onChange={(val) => { const updated = [...manualItems]; updated[idx] = { ...updated[idx], description: val, productId: '' }; setManualItems(updated); }} />
                            </td>
                            <td><input type="number" title="Quantité" value={item.quantity || ''} min="1" onChange={e => updateManualItem(idx, 'quantity', parseFloat(e.target.value) || 0)} style={{ ...fieldStyle, textAlign: 'right' }} /></td>
                            <td><input type="number" title="Prix unitaire HT" value={item.unitPrice || ''} min="0" step="0.01" onChange={e => setUnitHt(idx, parseFloat(e.target.value) || 0)} style={{ ...fieldStyle, textAlign: 'right' }} /></td>
                            <td>
                              <select title="Taux TVA" value={item.tvaRate === null ? '' : String(item.tvaRate)} style={fieldStyle}
                                onChange={e => updateManualItem(idx, 'tvaRate', e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}>
                                <option value="">—</option>
                                {['0', '7', '10', '14', '20'].map(r => (<option key={r} value={r}>{r} %</option>))}
                              </select>
                            </td>
                            <td><input type="number" title="Prix unitaire TTC" value={unitTtc(item) || ''} min="0" step="0.01" onChange={e => setUnitTtc(idx, parseFloat(e.target.value) || 0)} style={{ ...fieldStyle, textAlign: 'right' }} /></td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(item.quantity * unitTtc(item))}</td>
                            <td>
                              <button onClick={() => removeManualItem(idx)} disabled={manualItems.length <= 1} className="odoo-pager-btn" title="Supprimer la ligne" style={{ color: '#dc3545' }}><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, alignItems: 'start' }}>
                    <div>
                      <label style={labelStyle}>Notes</label>
                      <input type="text" value={manualNotes} onChange={e => setManualNotes(e.target.value)} placeholder="Notes ou référence..." style={fieldStyle} />
                    </div>
                    <div style={{ ...sectionStyle, padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total HT</span><span>{n(manualTotal)} DH</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>TVA</span><span>{n(manualTva)} DH</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4 }}><span>Total TTC</span><span>{n(manualTtc)} DH</span></div>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
              <button onClick={() => { setShowCreateModal(false); resetManualForm(); }} className="odoo-btn-secondary">Annuler</button>
              {editingInvoiceId ? (
                <button onClick={handleUpdateManual} disabled={updateManualMutation.isPending || editLoading} className="odoo-btn-primary">
                  {updateManualMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Enregistrer les modifications
                </button>
              ) : (
                <button onClick={handleCreateManual} disabled={createManualMutation.isPending} className="odoo-btn-primary">
                  {createManualMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />} Créer la facture
                </button>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* Encaissement — saisi par la direction */}
      {showPayModal && (() => {
        const inv = showPayModal;
        const total = num(inv.total_amount);
        const paid = num(inv.paid_amount);
        const remaining = remainingOf(inv);
        const needsRef = payMethod === 'check' || payMethod === 'traite';
        return (
          <ModalBackdrop onClose={() => setShowPayModal(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <form className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 480 }} onClick={e => e.stopPropagation()} onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const amount = parseFloat(fd.get('amount') as string);
              const paymentDate = (fd.get('paymentDate') as string) || format(new Date(), 'yyyy-MM-dd');
              if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
              if (amount > remaining + 0.004) { notify.error(`Le montant dépasse le reste à encaisser (${n(remaining)} DH)`); return; }
              const reference = (fd.get('reference') as string || '').trim();
              payMutation.mutate({
                invoiceId: inv.id as string, type: 'income', amount, paymentMethod: payMethod, paymentDate,
                description: `Encaissement facture ${inv.invoice_number}`,
                ...(reference ? { reference } : {}),
                ...(needsRef ? { checkNumber: reference, checkDate: fd.get('checkDate') as string } : {}),
              });
            }}>
              <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Banknote size={18} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Encaisser la facture</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{inv.invoice_number as string} · {customerLabel(inv)}</div>
                </div>
                <button type="button" onClick={() => setShowPayModal(null)} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={sectionStyle}>
                  <div className="odoo-section-header"><Banknote size={11} /> Solde de la facture</div>
                  <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total TTC</span><span style={{ fontWeight: 600 }}>{n(total)} DH</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}><span>Déjà encaissé</span><span style={{ fontWeight: 600 }}>{n(paid)} DH</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                      <span>Reste à encaisser</span><span style={{ color: '#b85d1a' }}>{n(remaining)} DH</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Montant (DH)</label>
                    <input name="amount" type="number" step="0.01" defaultValue={remaining.toFixed(2)} max={remaining} autoFocus
                      style={{ ...fieldStyle, textAlign: 'right', fontWeight: 700, fontSize: '1rem' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Date d'encaissement</label>
                    <input name="paymentDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} style={fieldStyle} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Mode de paiement</label>
                  <div className="odoo-view-switcher" role="radiogroup" style={{ width: '100%' }}>
                    {(['bank', 'check', 'traite', 'cash'] as const).map(m => (
                      <button key={m} type="button" role="radio" aria-checked={payMethod === m} onClick={() => setPayMethod(m)}
                        className={payMethod === m ? 'active' : ''} style={{ flex: 1, padding: '0.45rem 0.5rem', fontSize: '0.8125rem', fontWeight: payMethod === m ? 600 : 400 }}>
                        {payLabel(getPaymentLabel, m)}
                      </button>
                    ))}
                  </div>
                </div>
                {payMethod !== 'cash' && (
                  <div style={{ display: 'grid', gridTemplateColumns: needsRef ? '1fr 1fr' : '1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>{payMethod === 'bank' ? 'Référence du virement' : `N° ${payMethod === 'traite' ? 'de la traite' : 'du chèque'}`}</label>
                      <input name="reference" type="text" required style={fieldStyle} />
                    </div>
                    {needsRef && (
                      <div>
                        <label style={labelStyle}>Date {payMethod === 'traite' ? 'd\'échéance' : 'du chèque'}</label>
                        <input name="checkDate" type="date" style={fieldStyle} />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
                <button type="button" onClick={() => setShowPayModal(null)} className="odoo-btn-secondary" disabled={payMutation.isPending}>Annuler</button>
                <button type="submit" disabled={payMutation.isPending} className="odoo-btn-primary">
                  {payMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirmer l'encaissement
                </button>
              </div>
            </form>
          </ModalBackdrop>
        );
      })()}
    </div>
  );
}

/* ═══════════════════════ Fiche facture ═══════════════════════ */

function InvoiceDetailModal({ invoice: inv, late, onClose, onPdf, onEdit, onPay, onCancel }: {
  invoice: Record<string, any>; late: boolean;
  onClose: () => void;
  onPdf: (inv: Record<string, any>) => void;
  onEdit: (inv: Record<string, any>) => void;
  onPay: (inv: Record<string, any>) => void;
  onCancel: (inv: Record<string, any>) => void;
}) {
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { data: detail } = useQuery({
    queryKey: ['invoice-detail', inv.id],
    queryFn: () => invoicesApi.getById(inv.id as string) as Promise<Record<string, any>>,
  });
  const status = stageOf(inv);
  const total = num(inv.total_amount);
  const ht = num(inv.amount);
  const tva = num(inv.tax_amount);
  const paid = num(inv.paid_amount);
  const remaining = remainingOf(inv);
  const open = status === 'pending' || status === 'partial';
  const stageIdx = STAGES.findIndex(s => s.key === status);
  const items: Record<string, any>[] = detail?.items || [];
  const payments: Record<string, any>[] = detail?.payments || [];

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 760, maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '1rem' }}>{inv.invoice_number as string}</span>
              <span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{STATUS_LABEL[status] || status}</span>
              {late && <span className="odoo-tag odoo-tag-red">En retard</span>}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: 2 }}>
              Émise le {fmtDate(inv.invoice_date, 'dd/MM/yyyy')}{inv.due_date ? ` · échéance le ${fmtDate(inv.due_date, 'dd/MM/yyyy')}` : ''}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        {/* Frise d'avancement */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          {status === 'cancelled' ? (
            <span style={{ fontSize: '0.75rem', color: '#721c24', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ban size={12} /> Facture annulée</span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 6 }}>
              {STAGES.map((s, i) => {
                const reached = i <= stageIdx;
                const current = i === stageIdx;
                const Icon = s.icon;
                return (
                  <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ height: 5, borderRadius: 3, background: reached ? (current && late ? '#dc3545' : 'var(--odoo-purple)') : 'var(--odoo-border)', opacity: current && !late && s.key !== 'paid' ? 0.6 : 1 }} />
                    <span style={{ fontSize: '0.6875rem', fontWeight: current ? 700 : 500, color: reached ? 'var(--odoo-text)' : 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Icon size={10} /> {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><User size={11} /> Client</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {customerLabel(inv)}
                  <span className={`odoo-tag ${isPro(inv) ? 'odoo-tag-green' : 'odoo-tag-grey'}`}>{isPro(inv) ? 'Professionnel' : 'Particulier'}</span>
                </div>
                {detail?.customer_ice && <div style={{ color: 'var(--odoo-text-muted)' }}>ICE {detail.customer_ice as string}</div>}
                {(detail?.customer_address || detail?.customer_city) && (
                  <div style={{ color: 'var(--odoo-text-muted)' }}>{[detail?.customer_address, detail?.customer_city].filter(Boolean).join(', ')}</div>
                )}
              </div>
            </div>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><FileText size={11} /> Origine</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Bons de livraison</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>{(inv.delivery_note_numbers as string) || '—'}</span>
                </div>
                {inv.order_number_ref && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--odoo-text-muted)' }}>Commande</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{inv.order_number_ref as string}</span>
                  </div>
                )}
                {inv.notes && <div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>{inv.notes as string}</div>}
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div className="odoo-section-header"><Package size={11} /> Articles facturés</div>
            {!detail ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>
                <Loader2 className="animate-spin" size={16} style={{ margin: '0 auto 6px' }} /> Chargement des articles...
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Aucun article</div>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Désignation</th>
                    <th style={{ textAlign: 'right' }}>Qté</th>
                    <th style={{ textAlign: 'right' }}>P.U. HT</th>
                    <th style={{ textAlign: 'right' }}>TVA</th>
                    <th style={{ textAlign: 'right' }}>Montant HT</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} style={{ cursor: 'default' }}>
                      <td style={{ fontWeight: 500 }}>{(it.description as string) || (it.product_name as string)}</td>
                      <td style={{ textAlign: 'right' }}>{num(it.quantity)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{n(num(it.unit_price))}</td>
                      <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{it.tva_rate != null ? `${num(it.tva_rate)} %` : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(num(it.subtotal))} DH</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><Banknote size={11} /> Règlement</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total HT</span><span>{n(ht)} DH</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>TVA</span><span>{n(tva)} DH</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                  <span>Total TTC</span><span>{n(total)} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}><span>Encaissé</span><span style={{ fontWeight: 600 }}>{n(paid)} DH</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Reste à encaisser</span>
                  <span style={{ color: remaining > 0.004 && status !== 'cancelled' ? '#b85d1a' : undefined }}>
                    {status === 'cancelled' ? 'Annulée' : remaining > 0.004 ? `${n(remaining)} DH` : 'Soldée'}
                  </span>
                </div>
              </div>
            </div>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><CreditCard size={11} /> Encaissements</div>
              {payments.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Aucun encaissement</div>
              ) : (
                <div style={{ padding: '6px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {payments.map(p => (
                    <div key={p.id as string} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, opacity: p.voided_at ? 0.5 : 1 }}>
                      <span style={{ color: 'var(--odoo-text-muted)' }}>
                        {fmtDate(p.payment_date, 'dd/MM/yyyy')} · {payLabel(getPaymentLabel, (p.payment_method as string) || '')}{p.reference ? ` · ${p.reference as string}` : ''}
                      </span>
                      <span style={{ fontWeight: 600, textDecoration: p.voided_at ? 'line-through' : undefined }}>{n(num(p.amount))} DH</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)', flexWrap: 'wrap' }}>
          {open && (
            <button onClick={() => onCancel(inv)} className="odoo-btn-danger" style={{ marginRight: 'auto' }}><Ban size={13} /> Annuler la facture</button>
          )}
          <button onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          <button onClick={() => onPdf(inv)} className="odoo-btn-secondary"><Download size={13} /> PDF</button>
          {status !== 'cancelled' && (
            <button onClick={() => onEdit(inv)} className="odoo-btn-secondary"><Pencil size={13} /> Modifier</button>
          )}
          {open && remaining > 0.004 && (
            <button onClick={() => onPay(inv)} className="odoo-btn-primary"><Banknote size={13} /> Encaisser</button>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
