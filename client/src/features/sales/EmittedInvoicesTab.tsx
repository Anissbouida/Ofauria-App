import { money, currencySymbol } from '../../utils/money';
import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesApi, paymentsApi } from '../../api/accounting.api';
import { customersApi } from '../../api/customers.api';
import InvoiceDisputePanel from './InvoiceDisputePanel';
import InvoiceBadDebtPanel from './InvoiceBadDebtPanel';
import { currenciesApi, BASE_CURRENCY } from '../../api/currencies.api';
import { format, startOfDay, differenceInCalendarDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, Pencil, X, Check, Download, Receipt, Loader2, Search, Banknote, Eye, Ban, Trash2,
  AlertTriangle, CalendarDays, Building2, CheckCircle2, Clock, Coins, ClipboardList, Package,
  FileText, Truck, Undo2, Columns3, List, SquareKanban, Maximize2,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { ListToolbar, FilterChips, ListKpi, ListPanel, ListEmpty, NextStep } from './ListTemplate';
import { useReferentiel } from '../../hooks/useReferentiel';

function n(val: number): string {
  return val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ Référentiel d'affichage (même grammaire que Commandes et Achats) ═══ */

type Inv = Record<string, any>;

const STATUS_LABEL: Record<string, string> = { pending: 'À encaisser', partial: 'Partielle', paid: 'Soldée', cancelled: 'Annulée', credit: 'Avoir' };
/** Ton de l'étiquette commune par statut (avoir = gris, comme un document sans action). */
const STATUS_TONE: Record<string, StatusTone> = { pending: 'todo', partial: 'progress', paid: 'done', cancelled: 'cancelled', credit: 'draft' };
const STATUS_DOT: Record<string, string> = { pending: 'warning', partial: 'warning', paid: 'ok', cancelled: 'neutral', credit: 'neutral' };
/** Motifs d'avoir (O2C L4, mig 450). */
const CREDIT_REASON_LABEL: Record<string, string> = {
  cancellation: 'Annulation', return: 'Retour de marchandise', price: 'Erreur de prix', commercial: 'Geste commercial',
};
const FILTER_CHIPS: Array<{ key: string; label: string; icon: typeof Clock }> = [
  { key: '', label: 'Toutes', icon: ClipboardList },
  { key: 'pending', label: 'À encaisser', icon: Clock },
  { key: 'partial', label: 'Partielles', icon: Coins },
  { key: 'paid', label: 'Soldées', icon: CheckCircle2 },
  { key: 'cancelled', label: 'Annulées', icon: Ban },
  { key: 'credit', label: 'Avoirs', icon: Undo2 },
];

const PAY_LABELS: Record<string, string> = { bank: 'Virement', check: 'Chèque', traite: 'Traite (LCN)', cash: 'Espèces', card: 'Carte', avoir: 'Avoir imputé' };
/** Libellé du mode de paiement : référentiel, sinon libellé par défaut (le référentiel n'a pas « bank »). */
const payLabel = (get: (c: string) => string, code: string) => { const l = get(code); return l && l !== code ? l : PAY_LABELS[code] ?? code; };

function num(v: unknown) { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; }
function remainingOf(inv: Inv) { return Math.max(0, num(inv.total_amount) - num(inv.paid_amount)); }
/** Avoir client (O2C L4) : pièce AV liée à une facture ; son « reste » est la part non imputée. */
function isCredit(inv: Inv) { return inv.kind === 'credit_note'; }
/** Étape d'affichage : « partielle » dès qu'une partie est encaissée (le statut base reste pending). */
function stageOf(inv: Inv): string {
  if (isCredit(inv)) return 'credit';
  if (inv.status === 'cancelled' || inv.status === 'paid') return inv.status;
  return num(inv.paid_amount) > 0.004 ? 'partial' : 'pending';
}
function isOverdue(inv: Inv, today: Date) {
  const st = stageOf(inv);
  if ((st !== 'pending' && st !== 'partial') || !inv.due_date) return false;
  return startOfDay(new Date(String(inv.due_date).slice(0, 10) + 'T00:00:00')) < today;
}
/** Annulation = avoir d'annulation total : facture non annulée et encore jamais créditée. */
function canCancel(inv: Inv) { return !isCredit(inv) && inv.status !== 'cancelled' && num(inv.credited_total) <= 0.004; }
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

export default function EmittedInvoicesTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  // Filtres côté client : le pipeline et la liste partagent la même lecture.
  const [statusFilter, setStatusFilter] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewing, setViewing] = useState<Inv | null>(null);
  // Style Apple (2026-11) : Colonnes (liste + fiche) par défaut sur grand écran, Liste, Kanban.
  const [layout, setLayout] = useState<'split' | 'list' | 'kanban'>(() => (window.innerWidth >= 1100 ? 'split' : 'list'));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState<Record<string, any> | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualDate, setManualDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [manualNotes, setManualNotes] = useState('');
  // Facture en devise (mig 431) : prix saisis dans la devise, convertis en DH au taux de la facture.
  const [manualCurrency, setManualCurrency] = useState(BASE_CURRENCY);
  const [manualRate, setManualRate] = useState('');
  // Encaissement d'une facture en devise : montant en devise et taux du jour.
  const [payForeign, setPayForeign] = useState('');
  const [payRate, setPayRate] = useState('');
  // Édition d'une facture existante : id ciblé (null = création). Réutilise le formulaire manuel.
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // tvaRate : taux TVA de la ligne en % (null = pas de TVA explicite).
  const [manualItems, setManualItems] = useState<{ id?: string; productId: string; description: string; quantity: number; unitPrice: number; tvaRate: number | null }[]>([
    { productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null },
  ]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', 'emitted'],
    queryFn: () => invoicesApi.list({ invoiceType: 'emitted' }),
  });

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const { data: currencies = [] } = useQuery({ queryKey: ['currencies'], queryFn: () => currenciesApi.list() });
  const dayRate = (code: string) => { const c = currencies.find(x => x.code.trim() === code); return c?.rate ? String(parseFloat(c.rate)) : ''; };
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
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-credit-notes'] });
      if (res?.approval) notify.warning(`Annulation soumise à approbation (${res.approval.rule_label}).`);
      else notify.success(res?.creditNote ? `Avoir d'annulation ${res.creditNote.creditNote.invoice_number} émis` : 'Facture annulée');
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

  const resetManualForm = () => {
    setManualCustomerId('');
    setManualDate(format(new Date(), 'yyyy-MM-dd'));
    setManualNotes('');
    setManualCurrency(BASE_CURRENCY);
    setManualRate('');
    setManualItems([{ productId: '', description: '', quantity: 1, unitPrice: 0, tvaRate: null }]);
    setEditingInvoiceId(null);
  };
  const foreign = manualCurrency !== BASE_CURRENCY;
  const curLabel = foreign ? manualCurrency : currencySymbol();
  const rateValue = parseFloat(manualRate.replace(',', '.')) || 0;
  /** Lignes envoyées au serveur : prix convertis en DH (prix unitaire à 4 décimales) quand la facture est en devise. */
  const linesInDh = () => manualItems.map(it => {
    const unitPrice = foreign ? Math.round(it.unitPrice * rateValue * 10000) / 10000 : it.unitPrice;
    // Facture directe = prestations (O2C L4) : les marchandises se facturent depuis le BL.
    // id d'une ligne existante (modification) : mise à jour sur place, liens conservés (constat 81).
    return { ...(it.id ? { id: it.id } : {}),
      description: it.description, quantity: it.quantity, unitPrice,
      subtotal: Math.round(it.quantity * unitPrice * 100) / 100, tvaRate: it.tvaRate };
  });

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
    if (foreign && !(rateValue > 0)) { notify.error(`Indiquez le taux du ${manualCurrency} (${currencySymbol()} pour 1 ${manualCurrency})`); return; }
    const lines = linesInDh();
    const ht = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
    const tva = Math.round(lines.reduce((s, l) => s + (l.tvaRate == null ? 0 : l.subtotal * l.tvaRate / 100), 0) * 100) / 100;
    createManualMutation.mutate({
      invoiceType: 'emitted',
      customerId: manualCustomerId,
      invoiceDate: manualDate,
      // Le backend redrive HT/TVA/TTC depuis les lignes quand un taux est saisi.
      amount: ht,
      taxAmount: tva,
      totalAmount: Math.round((ht + tva) * 100) / 100,
      notes: manualNotes,
      items: lines,
      ...(foreign ? { currencyCode: manualCurrency, exchangeRate: rateValue } : {}),
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
      const cur = String(full.currency_code ?? BASE_CURRENCY).trim();
      const rate = cur !== BASE_CURRENCY ? parseFloat(full.exchange_rate as string) || 1 : 1;
      setManualCurrency(cur);
      setManualRate(cur !== BASE_CURRENCY ? String(rate) : '');
      const items = (full.items as Record<string, any>[]) || [];
      setManualItems(items.length ? items.map(it => ({
        id: it.id as string,
        productId: (it.product_id as string) || '',
        description: (it.description as string) || (it.product_name as string) || '',
        quantity: parseFloat(it.quantity as string) || 0,
        // Facture en devise : le prix se modifie dans la devise de la facture.
        unitPrice: Math.round((parseFloat(it.unit_price as string) || 0) / rate * 100) / 100,
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
      items: linesInDh(),
      // Pas de montants ici : replaceItems a déjà recalculé HT/TVA/TTC depuis les lignes.
      header: { invoiceDate: manualDate, notes: manualNotes, customerId: manualCustomerId },
    });
  };

  const allInvoices = invoices as Record<string, any>[];
  // Indicateurs : factures seules ; les avoirs viennent en déduction du facturé.
  const invoicesOnly = useMemo(() => allInvoices.filter(inv => !isCredit(inv)), [allInvoices]);
  const today = startOfDay(new Date());

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': allInvoices.length };
    for (const inv of allInvoices) { const k = stageOf(inv); c[k] = (c[k] || 0) + 1; }
    return c;
  }, [allInvoices]);
  const overdue = useMemo(() => invoicesOnly.filter(inv => isOverdue(inv, today)), [invoicesOnly, today]);
  const overdueAmount = overdue.reduce((s, inv) => s + remainingOf(inv), 0);
  const billed = invoicesOnly.filter(inv => inv.status !== 'cancelled');
  const totalBilled = billed.reduce((s, inv) => s + num(inv.total_amount), 0);
  const totalPaid = billed.reduce((s, inv) => s + num(inv.paid_amount), 0);
  const rate = totalBilled > 0 ? Math.round(totalPaid / totalBilled * 100) : 0;

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allInvoices.filter(inv => {
      if (statusFilter && stageOf(inv) !== statusFilter) return false;
      if (lateOnly && !isOverdue(inv, today)) return false;
      if (!q) return true;
      return [inv.invoice_number, customerLabel(inv), inv.order_number_ref, inv.delivery_note_numbers, inv.credited_invoice_number]
        .some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }, [allInvoices, searchQuery, statusFilter, lateOnly, today]);
  const filteredTotal = filteredInvoices.filter(inv => inv.status !== 'cancelled')
    .reduce((s, inv) => s + (isCredit(inv) ? -1 : 1) * num(inv.total_amount), 0);
  const filteredRemaining = filteredInvoices.filter(inv => inv.status !== 'cancelled' && !isCredit(inv)).reduce((s, inv) => s + remainingOf(inv), 0);
  const hasFilters = !!(statusFilter || lateOnly || searchQuery);

  const handleDownloadPdf = async (inv: Record<string, any>, locale?: 'fr' | 'ar') => {
    try {
      const response = await invoicesApi.downloadDocx(inv.id as string, locale);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { notify.error('Erreur lors du téléchargement'); }
  };
  const cancelInvoice = async (inv: Record<string, any>) => {
    if (await confirm(`Annuler la facture ${inv.invoice_number} ? Un avoir d'annulation (AV) est émis : la facture garde son numéro, ses bons de livraison redeviennent « à facturer » et un règlement déjà reçu reste au crédit du client.`,
      { title: 'Annuler la facture', confirmLabel: 'Émettre l\'avoir d\'annulation', cancelLabel: 'Retour', danger: true })) {
      cancelMutation.mutate(inv.id as string);
    }
  };
  const openPay = (inv: Record<string, any>) => {
    setShowPayModal(inv); setPayMethod('bank');
    const cur = String(inv.currency_code ?? BASE_CURRENCY).trim();
    setPayForeign(cur !== BASE_CURRENCY && inv.foreign_total_amount != null
      ? (num(inv.foreign_total_amount) - num(inv.foreign_paid_amount)).toFixed(2) : '');
    setPayRate(cur !== BASE_CURRENCY ? dayRate(cur) : '');
  };
  const openCreate = () => { resetManualForm(); setShowCreateModal(true); };

  const openInvoices = invoicesOnly.filter(inv => ['pending', 'partial'].includes(stageOf(inv)));
  const toCollect = openInvoices.reduce((s, inv) => s + remainingOf(inv), 0);
  const menuItems = (inv: Inv): RowMenuItem[] => {
    const status = stageOf(inv);
    const items: RowMenuItem[] = [
      { label: 'Voir le détail', icon: Eye, onSelect: () => setViewing(inv) },
      { label: 'Télécharger le PDF', icon: Download, onSelect: () => handleDownloadPdf(inv) },
    ];
    // Facture validée : figée (O2C L0), la correction passe par un avoir (L4).
    if (status !== 'cancelled' && !isCredit(inv) && inv.validation_status !== 'validated') items.push({ label: 'Modifier (date, TVA, articles)', icon: Pencil, onSelect: () => openEdit(inv) });
    if (canCancel(inv)) items.push({ label: "Annuler (avoir d'annulation)", icon: Ban, danger: true, onSelect: () => cancelInvoice(inv) });
    return items;
  };

  return (
    <div className="prj">
      {layout !== 'split' && <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="À encaisser" value={`${money(toCollect)}`} sub={`${openInvoices.length} facture${openInvoices.length > 1 ? 's' : ''}${overdue.length ? ` · ${money(overdueAmount)} échus` : ''}`} tone={overdue.length ? 'orange' : undefined} />
        <ListKpi label="Facturé" value={`${money(totalBilled)}`} sub={`${billed.length} facture${billed.length > 1 ? 's' : ''} hors annulées`} />
        <ListKpi label="Taux d'encaissement" value={`${rate} %`} sub={`${money(totalPaid)} encaissés`} tone={rate >= 100 ? 'green' : undefined} />
      </section>}

      <ListToolbar search={searchQuery} onSearch={setSearchQuery} placeholder="N° de facture, client, commande ou bon de livraison…">
        <div className="prj-views" role="group" aria-label="Affichage">
          <button type="button" className={layout === 'split' ? 'active' : ''} aria-pressed={layout === 'split'} onClick={() => setLayout('split')}><Columns3 size={14} /> Colonnes</button>
          <button type="button" className={layout === 'list' ? 'active' : ''} aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={14} /> Liste</button>
          <button type="button" className={layout === 'kanban' ? 'active' : ''} aria-pressed={layout === 'kanban'} onClick={() => setLayout('kanban')}><SquareKanban size={14} /> Kanban</button>
        </div>
        <button type="button" onClick={openCreate} className="odoo-btn-primary"><Plus size={13} /> Nouvelle facture</button>
      </ListToolbar>
      <FilterChips label="Filtrer les factures" value={lateOnly ? 'late' : statusFilter}
        onChange={k => { if (k === 'late') { setLateOnly(true); setStatusFilter(''); } else { setLateOnly(false); setStatusFilter(k); } }}
        chips={[
          { key: '', label: 'Toutes', count: counts[''] || 0 },
          ...(overdue.length ? [{ key: 'late', label: 'En retard', count: overdue.length, tone: 'late' as const, icon: AlertTriangle }] : []),
          ...FILTER_CHIPS.filter(c => c.key).map(c => ({ key: c.key, label: c.label, count: counts[c.key] || 0 })),
        ]} />

      {isLoading ? <ListEmpty icon={Loader2} title="Chargement des factures…" /> : filteredInvoices.length === 0 ? (
        <ListEmpty icon={Receipt} title={hasFilters ? 'Aucune facture pour ces filtres' : 'Aucune facture'}
          text={hasFilters ? 'Changez de filtre ou effacez la recherche.' : 'Les factures naissent des bons de livraison ou d\'une saisie manuelle.'}
          action={hasFilters ? <button type="button" className="odoo-btn-secondary" onClick={() => { setStatusFilter(''); setLateOnly(false); setSearchQuery(''); }}>Effacer les filtres</button> : undefined} />
      ) : layout === 'split' ? (() => {
        const active = filteredInvoices.find(inv => inv.id === activeId) ?? filteredInvoices[0];
        return (
          <div className="ord-split">
            <nav className="ord-list" aria-label="Factures">
              {filteredInvoices.map(inv => {
                const st = stageOf(inv);
                const late = isOverdue(inv, today);
                const rest = remainingOf(inv);
                const sel = inv.id === active.id;
                return (
                  <button key={inv.id as string} type="button" className={`ord-row${sel ? ' sel' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => setActiveId(inv.id as string)}>
                    <span className={`ord-dot${late ? ' late' : ''}`} aria-hidden="true" />
                    <span className="ord-l1"><span className="ord-nm">{customerLabel(inv)}</span><span className="ord-when">{fmtDate(inv.invoice_date, 'd MMM yyyy')}</span></span>
                    <span className="ord-l2"><span className="sal-num">{inv.invoice_number as string}</span> · <b>{isCredit(inv) ? '−' : ''}{money(num(inv.total_amount))}</b></span>
                    <span className="ord-l3"><StatusTag tone={late ? 'late' : STATUS_TONE[st] ?? 'draft'} label={late ? 'En retard' : STATUS_LABEL[st] || st} />{(st === 'pending' || st === 'partial') && rest > 0.004 ? ` reste ${money(rest)}` : ''}</span>
                  </button>
                );
              })}
            </nav>
            <InvoicePane key={active.id as string} inv={active} late={isOverdue(active, today)} menu={menuItems(active)}
              onPay={() => openPay(active)} onPdf={() => handleDownloadPdf(active)} onFull={() => setViewing(active)} />
          </div>
        );
      })() : layout === 'kanban' ? (
        <InvoiceKanban invoices={filteredInvoices} today={today} onOpen={setViewing} />
      ) : (
        <ListPanel footer={
          <div className="sal-foot">
            <span>{filteredInvoices.length} facture{filteredInvoices.length > 1 ? 's' : ''}{hasFilters ? ' (filtrées)' : ''}</span>
            <span>Total <strong>{money(filteredTotal)}</strong> · reste à encaisser <strong style={{ color: 'var(--prj-orange)' }}>{money(filteredRemaining)}</strong></span>
          </div>
        }>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>N° facture</th>
                <th>Client</th>
                <th>Origine</th>
                <th>Date</th>
                <th>Échéance</th>
                <th>Statut</th>
                <th>Encaissement</th>
                <th style={{ textAlign: 'right' }}>Total TTC</th>
                <th style={{ textAlign: 'right' }}>Reste</th>
                <th style={{ textAlign: 'right' }}>Action</th>
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
                const lateDays = late && inv.due_date ? differenceInCalendarDays(today, startOfDay(new Date(String(inv.due_date)))) : 0;
                return (
                  <tr key={inv.id as string} onClick={() => setViewing(inv)}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="sal-num">{inv.invoice_number as string}</span>
                      {isCredit(inv) && inv.credited_invoice_number && <span className="sal-sub" style={{ whiteSpace: 'nowrap' }}>sur {inv.credited_invoice_number as string}</span>}
                      {!isCredit(inv) && inv.cancelled_by_credit && <span className="sal-late-txt">annulée par avoir</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {isPro(inv) && <Building2 size={12} style={{ color: 'var(--theme-text-muted)' }} aria-label="Professionnel" />}
                        {customerLabel(inv)}
                      </span>
                      <span className="sal-sub">{isPro(inv) ? 'Professionnel' : 'Particulier'}</span>
                    </td>
                    <td style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                      {isCredit(inv) ? (CREDIT_REASON_LABEL[inv.credit_reason as string] ?? 'Avoir')
                        : (inv.delivery_note_numbers || inv.order_number_ref)
                          ? <span className="sal-mono">{(inv.delivery_note_numbers || inv.order_number_ref) as string}</span>
                          : 'Saisie manuelle'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.invoice_date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {inv.due_date ? fmtDate(inv.due_date) : '—'}
                      {late && <span className="sal-late-txt">échue depuis {lateDays} j</span>}
                    </td>
                    <td><StatusTag tone={STATUS_TONE[status] ?? 'draft'} label={STATUS_LABEL[status] || status} /></td>
                    <td style={{ minWidth: 110 }}>
                      {status === 'cancelled' ? <span className="sal-sub" style={{ margin: 0 }}>—</span>
                        : isCredit(inv) ? <span className="sal-sub" style={{ margin: 0 }}>{remaining > 0.004 ? 'à imputer' : 'imputé'}</span>
                        : (
                          <div title={`${Math.round(pct)} % encaissé`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className={`prj-bar ${pct >= 100 ? 'green' : late ? 'red' : ''}`} style={{ flex: 1, maxWidth: 90 }}><span style={{ width: `${pct}%` }} /></span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)} %</span>
                          </div>
                        )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <strong style={{ color: isCredit(inv) ? '#5B3A9E' : undefined }}>{isCredit(inv) ? '−' : ''}{n(total)}</strong>
                      <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 3 }}>{currencySymbol()}</span>
                      {inv.foreign_total_amount != null && String(inv.currency_code).trim() !== BASE_CURRENCY && (
                        <span className="sal-sub">{n(num(inv.foreign_total_amount))} {String(inv.currency_code).trim()}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {status === 'cancelled' ? <span style={{ color: 'var(--theme-text-muted)' }}>—</span>
                        : isCredit(inv) ? (remaining > 0.004
                          ? <span style={{ color: '#5B3A9E', fontWeight: 600 }} title="Crédit du client, à imputer sur une facture">{money(remaining)}</span>
                          : <span className="sal-sub" style={{ margin: 0 }}>imputé</span>)
                        : remaining > 0.004 ? <span style={{ color: late ? 'var(--prj-red)' : 'var(--prj-orange)', fontWeight: 600 }}>{money(remaining)}</span>
                        : <span style={{ color: 'var(--prj-green)', fontSize: '0.8125rem' }}>soldée</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <div className="sal-actions">
                        {open && !isCredit(inv) && remaining > 0.004 && <NextStep icon={Banknote} label="Encaisser" onClick={() => openPay(inv)} />}
                        <RowMenu items={menuItems(inv)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListPanel>
      )}

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
                <StatusBanner tone="info" icon={Truck} title="Facture directe : prestations uniquement">
                  Des marchandises se facturent depuis leur bon de livraison (Commandes › Livrer sur BL, ou Livraisons pros › À facturer),
                  pour ne facturer que ce qui a été livré. Une commande de particulier se règle en caisse.
                </StatusBanner>
              )}
              {editLoading ? (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
                  <Loader2 className="animate-spin" size={22} style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '0.8125rem' }}>Chargement de la facture...</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Client</label>
                      <SearchSelect value={manualCustomerId} onChange={setManualCustomerId}
                        placeholder="— Sélectionner un client —" width="100%" size="md" ariaLabel="Client"
                        options={customers.map(c => ({ id: c.id as string, label: customerOption(c) }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>Date de facturation</label>
                      <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} style={fieldStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Devise</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <SearchSelect value={manualCurrency} disabled={!!editingInvoiceId || currencies.length <= 1} clearable={false}
                          onChange={v => { setManualCurrency(v); setManualRate(v === BASE_CURRENCY ? '' : dayRate(v)); }}
                          placeholder="Devise" width={foreign ? 90 : '100%'} size="md" ariaLabel="Devise"
                          options={currencies.map(c => ({ id: c.code.trim(), label: c.code.trim() }))} />
                        {foreign && (
                          <input value={manualRate} onChange={e => setManualRate(e.target.value)} disabled={!!editingInvoiceId} inputMode="decimal"
                            placeholder="taux" title={`${currencySymbol()} pour 1 ${manualCurrency}`} style={{ ...fieldStyle, textAlign: 'right', minWidth: 0 }} />
                        )}
                      </div>
                    </div>
                  </div>
                  {foreign && (
                    <StatusBanner tone="info" icon={Coins} title={`Facture en ${manualCurrency} au taux de ${manualRate || '…'} ${currencySymbol()}`}>
                      Prix saisis en {manualCurrency}. La facture est comptabilisée en dirhams à ce taux ; l'écart avec le taux du jour de l'encaissement sera un gain ou une perte de change.
                    </StatusBanner>
                  )}

                  <div style={sectionStyle}>
                    <div className="odoo-section-header" style={{ display: 'flex', alignItems: 'center' }}>
                      <Package size={11} /> Prestations
                      <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>prix HT ou TTC : l'autre se calcule selon la TVA</span>
                      <button onClick={addManualItem} className="odoo-btn-secondary" style={{ marginLeft: 'auto', padding: '0.15rem 0.5rem' }}><Plus size={12} /> Ligne</button>
                    </div>
                    <table className="odoo-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Désignation</th>
                          <th style={{ width: 70, textAlign: 'right' }}>Qté</th>
                          <th style={{ width: 100, textAlign: 'right' }}>P.U. HT{foreign ? ` (${manualCurrency})` : ''}</th>
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
                              <input type="text" title="Désignation de la prestation" value={item.description} placeholder="Prestation (transport, location, formation…)"
                                onChange={e => updateManualItem(idx, 'description', e.target.value)} style={fieldStyle} />
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
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total HT</span><span>{n(manualTotal)} {curLabel}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>TVA</span><span>{n(manualTva)} {curLabel}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4 }}><span>Total TTC</span><span>{n(manualTtc)} {curLabel}</span></div>
                      {foreign && rateValue > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}><span>Contre-valeur</span><span>{money(manualTtc * rateValue)}</span></div>
                      )}
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
        const payCur = String(inv.currency_code ?? BASE_CURRENCY).trim();
        const payInFx = payCur !== BASE_CURRENCY && inv.foreign_total_amount != null;
        const remainingFx = payInFx ? Math.round((num(inv.foreign_total_amount) - num(inv.foreign_paid_amount)) * 100) / 100 : 0;
        const fxAmount = parseFloat(payForeign.replace(',', '.')) || 0;
        const fxRate = parseFloat(payRate.replace(',', '.')) || 0;
        const fxDh = Math.round(fxAmount * fxRate * 100) / 100;
        // Part de la créance soldée au taux de la facture (le dernier règlement solde le reste exact).
        const fxSettled = fxAmount >= remainingFx - 0.005 ? remaining : Math.round(fxAmount * num(inv.exchange_rate) * 100) / 100;
        const fxGain = Math.round((fxDh - fxSettled) * 100) / 100;
        return (
          <ModalBackdrop onClose={() => setShowPayModal(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <form className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 480 }} onClick={e => e.stopPropagation()} onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const paymentDate = (fd.get('paymentDate') as string) || format(new Date(), 'yyyy-MM-dd');
              let amount: number;
              if (payInFx) {
                if (!(fxAmount > 0) || !(fxRate > 0)) { notify.error(`Indiquez le montant reçu en ${payCur} et le taux du jour`); return; }
                if (fxAmount > remainingFx + 0.005) { notify.error(`Le montant dépasse le reste à encaisser (${n(remainingFx)} ${payCur})`); return; }
                amount = fxDh;
              } else {
                amount = parseFloat(fd.get('amount') as string);
                if (!amount || amount <= 0) { notify.error('Montant invalide'); return; }
                if (amount > remaining + 0.004) { notify.error(`Le montant dépasse le reste à encaisser (${money(remaining)})`); return; }
              }
              const reference = (fd.get('reference') as string || '').trim();
              payMutation.mutate({
                invoiceId: inv.id as string, type: 'income', amount, paymentMethod: payMethod, paymentDate,
                ...(payInFx ? { foreignAmount: fxAmount, exchangeRate: fxRate } : {}),
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
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total TTC</span><span style={{ fontWeight: 600 }}>{money(total)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}><span>Déjà encaissé</span><span style={{ fontWeight: 600 }}>{money(paid)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                      <span>Reste à encaisser</span><span style={{ color: '#b85d1a' }}>{money(remaining)}{payInFx ? ` · ${n(remainingFx)} ${payCur}` : ''}</span>
                    </div>
                    {payInFx && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Facture en {payCur} au taux de {num(inv.exchange_rate)} {currencySymbol()}</div>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: payInFx ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
                  {payInFx ? (
                    <>
                      <div>
                        <label style={labelStyle}>Montant reçu ({payCur})</label>
                        <input value={payForeign} onChange={e => setPayForeign(e.target.value)} inputMode="decimal" autoFocus
                          style={{ ...fieldStyle, textAlign: 'right', fontWeight: 700, fontSize: '1rem' }} />
                      </div>
                      <div>
                        <label style={labelStyle}>Taux du jour ({currencySymbol()})</label>
                        <input value={payRate} onChange={e => setPayRate(e.target.value)} inputMode="decimal" style={{ ...fieldStyle, textAlign: 'right' }} />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label style={labelStyle}>Montant ({currencySymbol()})</label>
                      <input name="amount" type="number" step="0.01" defaultValue={remaining.toFixed(2)} max={remaining} autoFocus
                        style={{ ...fieldStyle, textAlign: 'right', fontWeight: 700, fontSize: '1rem' }} />
                    </div>
                  )}
                  <div>
                    <label style={labelStyle}>Date d'encaissement</label>
                    <input name="paymentDate" type="date" required defaultValue={format(new Date(), 'yyyy-MM-dd')} style={fieldStyle} />
                  </div>
                </div>
                {payInFx && fxAmount > 0 && fxRate > 0 && (
                  <div style={{ ...sectionStyle, padding: '8px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Reçu en trésorerie</span><span>{money(fxDh)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Créance soldée (taux de la facture)</span><span>{money(fxSettled)}</span></div>
                    {Math.abs(fxGain) >= 0.01 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: fxGain > 0 ? '#155724' : '#721c24' }}>
                        <span>{fxGain > 0 ? 'Gain de change (7331)' : 'Perte de change (6331)'}</span><span>{money(Math.abs(fxGain))}</span>
                      </div>
                    )}
                  </div>
                )}
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
  onPdf: (inv: Record<string, any>, locale?: 'fr' | 'ar') => void;
  onEdit: (inv: Record<string, any>) => void;
  onPay: (inv: Record<string, any>) => void;
  onCancel: (inv: Record<string, any>) => void;
}) {
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const queryClient = useQueryClient();
  const [creditOpen, setCreditOpen] = useState(false);
  const { data: detail } = useQuery({
    queryKey: ['invoice-detail', inv.id],
    queryFn: () => invoicesApi.getById(inv.id as string) as Promise<Record<string, any>>,
  });
  const credit = isCredit(inv);
  // Avoirs de la facture et avoirs du client encore à imputer (O2C L4).
  const { data: credits } = useQuery({
    queryKey: ['invoice-credit-notes', inv.id],
    queryFn: () => invoicesApi.creditNotes(inv.id as string),
    enabled: !credit,
  });
  const applyMutation = useMutation({
    mutationFn: (creditNoteId: string) => invoicesApi.applyCredit(inv.id as string, { creditNoteId }),
    onSuccess: (r) => {
      ['invoices', 'invoice-detail', 'invoice-credit-notes', 'receivables'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      notify.success(`${money(r.applied)} d'avoir imputés`);
      onClose();
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Imputation refusée'),
  });
  const status = stageOf(inv);
  const total = num(inv.total_amount);
  const ht = num(inv.amount);
  const tva = num(inv.tax_amount);
  const paid = num(inv.paid_amount);
  const remaining = remainingOf(inv);
  const open = status === 'pending' || status === 'partial';
  const items: Record<string, any>[] = detail?.items || [];
  const payments: Record<string, any>[] = detail?.payments || [];
  const pct = total > 0 ? Math.min(100, paid / total * 100) : 0;
  const lateDays = late && inv.due_date ? differenceInCalendarDays(startOfDay(new Date()), startOfDay(new Date(String(inv.due_date).slice(0, 10) + 'T00:00:00'))) : 0;
  const pill = status === 'paid' ? 'g' : status === 'partial' ? 'b' : status === 'cancelled' ? 'r' : status === 'credit' ? 'x' : late ? 'r' : 'o';
  const steps = [
    { label: 'Émise', sub: fmtDate(inv.invoice_date, 'd MMM yyyy'), tone: 'done' },
    { label: 'Échéance', sub: inv.due_date ? fmtDate(inv.due_date, 'd MMM yyyy') + (late ? ` · ${lateDays} j de retard` : '') : 'non fixée', tone: status === 'paid' ? 'done' : late ? 'warn' : 'current' },
    { label: 'Encaissée', sub: status === 'paid' ? 'soldée' : paid > 0.004 ? `${money(paid)} reçus` : 'rien reçu', tone: status === 'paid' ? 'done' : '' },
  ];
  const name = customerLabel(inv);
  const initials = name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.32)' }}>
      {/* Style Apple (2026-11) : feuille claire, suivi en barre, listes groupées, boutons en pilule (apple-look.css, .kl-sheet). */}
      <div className="odoo-scope kl-sheet w-full" style={{ maxWidth: 780, maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Facture ${inv.invoice_number as string}`}>
        <header className="kl-sheet-head">
          <span className="ord-mono" aria-hidden="true">{initials}</span>
          <div className="ord-who">
            <h2><span className="sal-num" style={{ fontSize: 'inherit' }}>{inv.invoice_number as string}</span> <span className={`kl-pill ${pill}`}>{late && (status === 'pending' || status === 'partial') ? 'En retard' : STATUS_LABEL[status] || status}</span></h2>
            <p>{name} · {isPro(inv) ? 'Professionnel' : 'Particulier'} · {credit
              ? `avoir du ${fmtDate(inv.invoice_date, 'dd/MM/yyyy')} sur ${inv.credited_invoice_number ?? '—'} (${CREDIT_REASON_LABEL[inv.credit_reason as string] ?? 'avoir'})`
              : `émise le ${fmtDate(inv.invoice_date, 'dd/MM/yyyy')}`}</p>
          </div>
          <div className="ord-amt">
            <b>{credit ? '−' : ''}{money(total)}</b>
            <small>{status === 'cancelled' ? 'annulée' : credit ? (remaining > 0.004 ? `${money(remaining)} à imputer` : 'imputé') : remaining > 0.004 ? `reste ${money(remaining)}` : 'soldée'}</small>
          </div>
          <button type="button" className="kl-sheet-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>

        <div className="kl-sheet-body">
          {status === 'cancelled' ? (
            <div className="kl-widget"><div className="ord-state">Facture annulée</div><div className="ord-state-sub">{inv.cancelled_by_credit ? 'Annulée par avoir : ses bons de livraison sont redevenus « à facturer ».' : 'Facture annulée.'}</div></div>
          ) : credit ? (
            <div className="kl-widget"><div className="ord-state">Avoir</div><div className="ord-state-sub">{remaining > 0.004 ? `${money(remaining)} au crédit du client, à imputer sur une facture.` : 'Avoir entièrement imputé.'}</div></div>
          ) : (
            <div className="kl-widget">
              <div className="ord-state">{late ? 'En retard' : STATUS_LABEL[status]}</div>
              <div className="ord-state-sub">{Math.round(pct)} % encaissé{late ? ` · échue depuis ${lateDays} j` : inv.due_date && status !== 'paid' ? ` · échéance le ${fmtDate(inv.due_date, 'd MMMM')}` : ''}</div>
              <div className={`ord-track${late ? ' late' : ''}`} aria-hidden="true"><span style={{ width: `${status === 'paid' ? 100 : Math.max(pct, 4)}%` }} /></div>
              <ol className="ord-steps" aria-label="Avancement">
                {steps.map(st => <li key={st.label} className={st.tone || undefined}><b>{st.label}</b><span>{st.sub}</span></li>)}
              </ol>
            </div>
          )}

          <div className="kl-sheet-cols">
            <section>
              <div className="kl-sec"><h2>Client</h2></div>
              <div className="kl-group">
                <div className="ord-kv"><span>Nom</span><b>{name}</b></div>
                <div className="ord-kv"><span>ICE</span><b>{(detail?.customer_ice as string) || '—'}</b></div>
                {(detail?.customer_address || detail?.customer_city) && <div className="ord-kv"><span>Adresse</span><b style={{ textAlign: 'right' }}>{[detail?.customer_address, detail?.customer_city].filter(Boolean).join(', ')}</b></div>}
              </div>
            </section>
            <section>
              <div className="kl-sec"><h2>Origine</h2></div>
              <div className="kl-group">
                <div className="ord-kv"><span>Bons de livraison</span><b className="sal-num">{(inv.delivery_note_numbers as string) || '—'}</b></div>
                {inv.order_number_ref && <div className="ord-kv"><span>Commande</span><b className="sal-num">{inv.order_number_ref as string}</b></div>}
                {inv.notes && <div className="ord-kv"><span>Notes</span><b style={{ textAlign: 'right', whiteSpace: 'pre-line' }}>{inv.notes as string}</b></div>}
              </div>
            </section>
          </div>

          <section>
            <div className="kl-sec"><h2>Articles</h2><small>{items.length ? `${items.length} ligne${items.length > 1 ? 's' : ''}` : ''}</small></div>
            <div className="kl-group">
              {!detail ? <div className="kl-empty"><Loader2 className="animate-spin" size={16} /> Chargement…</div>
                : items.length === 0 ? <div className="kl-empty">Aucun article</div>
                : items.map((it, idx) => (
                  <div key={idx} className="ord-line">
                    <span className="ord-qty">{num(it.quantity)} ×</span>
                    <span className="ord-pn">{(it.description as string) || (it.product_name as string)}<small>{n(num(it.unit_price))} HT{it.tva_rate != null ? ` · TVA ${num(it.tva_rate)} %` : ''}</small></span>
                    <span className="ord-pv">{n(num(it.subtotal))}</span>
                  </div>
                ))}
              <div className="ord-kv"><span>Total HT</span><b>{money(ht)}</b></div>
              <div className="ord-kv"><span>TVA</span><b>{money(tva)}</b></div>
              <div className="ord-line tot"><span className="ord-pn">Total TTC</span><span className="ord-pv">{money(total)}</span></div>
              <div className="ord-kv"><span>{credit ? 'Imputé' : 'Encaissé'}</span><b style={{ color: 'var(--prj-green, #15803D)' }}>{money(paid)}</b></div>
              <div className="ord-kv"><span>{credit ? 'À imputer' : 'Reste à encaisser'}</span>
                <b style={{ fontWeight: 700, color: remaining > 0.004 && status !== 'cancelled' ? 'var(--prj-orange, #B45309)' : undefined }}>
                  {status === 'cancelled' ? 'Annulée' : remaining > 0.004 ? `${money(remaining)}` : credit ? 'Imputé' : 'Soldée'}</b></div>
            </div>
          </section>

          {!credit && ((credits?.creditNotes.length ?? 0) > 0 || (open && (credits?.openCredits.length ?? 0) > 0)) && (
            <section>
              <div className="kl-sec"><h2>Avoirs</h2></div>
              <div className="kl-group">
                {credits?.creditNotes.map(c => (
                  <div key={c.id} className="ord-kv"><span><span className="sal-num">{c.invoice_number}</span> · {fmtDate(c.invoice_date, 'dd/MM/yyyy')} · {CREDIT_REASON_LABEL[c.credit_reason] ?? c.credit_reason}</span><b>−{money(c.total_amount)}</b></div>
                ))}
                {open && credits?.openCredits.map(c => (
                  <div key={c.id} className="ord-kv"><span>Crédit du client : avoir <span className="sal-num">{c.invoice_number}</span>, {money(c.unapplied)} à imputer</span>
                    <button className="odoo-btn-secondary" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate(c.id)}>Imputer</button></div>
                ))}
              </div>
            </section>
          )}

          {!credit && (
            <section>
              <div className="kl-sec"><h2>Encaissements</h2><small>{payments.length ? `${money(paid)} reçus` : ''}</small></div>
              <div className="kl-group">
                {payments.length === 0 ? <div className="kl-empty">Aucun encaissement</div> : payments.map(p => (
                  <div key={p.id as string} className="ord-kv" style={{ opacity: p.voided_at ? 0.5 : 1 }}>
                    <span>{fmtDate(p.payment_date, 'dd/MM/yyyy')} · {payLabel(getPaymentLabel, (p.payment_method as string) || '')}{p.reference ? ` · ${p.reference as string}` : ''}</span>
                    {/* Règlement réparti sur plusieurs factures (O2C L5) : la part de cette facture. */}
                    <b style={{ textDecoration: p.voided_at ? 'line-through' : undefined }}
                      title={p.allocated_amount != null && num(p.allocated_amount) !== num(p.amount) ? `Règlement de ${money(num(p.amount))} réparti sur plusieurs factures` : undefined}>
                      {money(num(p.allocated_amount ?? p.amount))}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Litiges (phase 11, D5-59) : montant contesté exclu des relances ; créance douteuse / irrécouvrable. */}
          {!credit && status !== 'cancelled' && (
            <section>
              <div className="kl-sec"><h2>Recouvrement</h2></div>
              <div className="kl-group kl-sheet-panel">
                <InvoiceDisputePanel invoiceId={inv.id as string} remaining={remaining} editable={status !== 'cancelled'} />
                <InvoiceBadDebtPanel invoiceId={inv.id as string} remaining={remaining} editable={status !== 'cancelled'} />
              </div>
            </section>
          )}
        </div>

        <footer className="kl-sheet-foot">
          {canCancel(inv) && (
            <button onClick={() => onCancel(inv)} className="odoo-btn-danger" style={{ marginRight: 'auto' }}><Ban size={13} /> Annuler la facture</button>
          )}
          {!credit && status !== 'cancelled' && !inv.cancelled_by_credit && (
            <button onClick={() => setCreditOpen(true)} className="odoo-btn-secondary" disabled={!detail}><Undo2 size={13} /> Émettre un avoir</button>
          )}
          <button onClick={() => onPdf(inv)} className="odoo-btn-secondary"><Download size={13} /> PDF</button>
          {/* Phase 10.1 — même facture en arabe (RTL, police Cairo). */}
          <button onClick={() => onPdf(inv, 'ar')} className="odoo-btn-secondary" title="Facture en arabe"><Download size={13} /> PDF ‎عربي</button>
          {status !== 'cancelled' && inv.validation_status !== 'validated' && (
            <button onClick={() => onEdit(inv)} className="odoo-btn-secondary"><Pencil size={13} /> Modifier</button>
          )}
          {open && !credit && remaining > 0.004 && (
            <button onClick={() => onPay(inv)} className="odoo-btn-primary"><Banknote size={13} /> Encaisser</button>
          )}
        </footer>
      </div>
      {creditOpen && detail && (
        <CreditNoteModal invoice={detail} onClose={() => setCreditOpen(false)} onDone={() => { setCreditOpen(false); onClose(); }} />
      )}
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Avoir partiel (O2C L4) ═══════════════════════ */

function CreditNoteModal({ invoice: inv, onClose, onDone }: {
  invoice: Record<string, any>; onClose: () => void; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<'return' | 'price' | 'commercial'>('return');
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const items: Record<string, any>[] = inv.items || [];
  const byQty = reason === 'return';
  const lines = items
    .map(it => ({ it, v: parseFloat((values[it.id as string] ?? '').replace(',', '.')) || 0 }))
    .filter(l => l.v > 0);
  const totalHt = Math.round(lines.reduce((s, l) => s + (byQty ? l.v * num(l.it.unit_price) : l.v), 0) * 100) / 100;
  const mutation = useMutation({
    mutationFn: () => invoicesApi.createCreditNote(inv.id as string, {
      reason, note: note.trim() || undefined,
      lines: lines.map(l => byQty ? { invoiceItemId: l.it.id as string, quantity: l.v } : { invoiceItemId: l.it.id as string, amount: l.v }),
    }),
    onSuccess: (r) => {
      ['invoices', 'invoice-detail', 'invoice-credit-notes', 'receivables'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      notify.success(`Avoir ${r.creditNote.invoice_number} émis${r.unapplied > 0.004 ? ` · ${money(r.unapplied)} au crédit du client` : ''}`);
      onDone();
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Avoir refusé'),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 680, maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Undo2 size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Avoir sur la facture {inv.invoice_number as string}</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>Pièce AV numérotée, imputée sur la facture ; le surplus reste au crédit du client</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div>
            <label style={labelStyle}>Motif</label>
            <select value={reason} onChange={e => { setReason(e.target.value as typeof reason); setValues({}); }} style={fieldStyle}>
              <option value="return">Retour de marchandise (quantités, au prix facturé)</option>
              <option value="price">Erreur de prix (montant HT par ligne)</option>
              <option value="commercial">Geste commercial (montant HT par ligne)</option>
            </select>
          </div>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Ligne facturée</th>
                <th style={{ textAlign: 'right' }}>Qté</th>
                <th style={{ textAlign: 'right' }}>Montant HT</th>
                <th style={{ width: 120, textAlign: 'right' }}>{byQty ? 'Qté retournée' : 'Avoir HT'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id as string} style={{ cursor: 'default' }}>
                  <td style={{ fontWeight: 500 }}>{(it.description as string) || (it.product_name as string)}</td>
                  <td style={{ textAlign: 'right' }}>{num(it.quantity)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{money(num(it.subtotal))}</td>
                  <td>
                    <input inputMode="decimal" value={values[it.id as string] ?? ''} placeholder="0"
                      onChange={e => setValues(v => ({ ...v, [it.id as string]: e.target.value }))}
                      style={{ ...fieldStyle, textAlign: 'right' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={labelStyle}>Commentaire (imprimé sur l'avoir)</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} style={fieldStyle} placeholder="ex. 12 baguettes rendues le 03/11" />
            </div>
            <div style={{ ...sectionStyle, padding: '8px 12px', fontSize: '0.8125rem', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--odoo-text-muted)' }}>Avoir HT</span><strong>{money(totalHt)}</strong>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary">Annuler</button>
          <button onClick={() => mutation.mutate()} disabled={!lines.length || mutation.isPending} className="odoo-btn-primary">
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Émettre l'avoir
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════ Colonnes (fiche à droite) et Kanban — style Apple, 2026-11 ═══════════════ */

const initialsOf = (name: string) => name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';

/** Fiche de la facture choisie : encaissement, articles, règlements ; la fenêtre complète garde avoirs et litiges. */
function InvoicePane({ inv, late, menu, onPay, onPdf, onFull }: {
  inv: Inv; late: boolean; menu: RowMenuItem[]; onPay: () => void; onPdf: () => void; onFull: () => void;
}) {
  const { getLabel: getPaymentLabel } = useReferentiel('payment_methods');
  const { data: detail, isLoading } = useQuery({
    queryKey: ['invoice-detail', inv.id],
    queryFn: () => invoicesApi.getById(inv.id as string) as Promise<Record<string, any>>,
  });
  const status = stageOf(inv);
  const credit = isCredit(inv);
  const total = num(inv.total_amount);
  const paid = num(inv.paid_amount);
  const remaining = remainingOf(inv);
  const open = status === 'pending' || status === 'partial';
  const pct = total > 0 ? Math.min(100, paid / total * 100) : 0;
  const items: Inv[] = detail?.items || [];
  const payments: Inv[] = detail?.payments || [];
  const lateDays = late && inv.due_date ? differenceInCalendarDays(startOfDay(new Date()), startOfDay(new Date(String(inv.due_date).slice(0, 10) + 'T00:00:00'))) : 0;
  const origin = credit ? (CREDIT_REASON_LABEL[inv.credit_reason as string] ?? 'Avoir') + (inv.credited_invoice_number ? ` sur ${inv.credited_invoice_number}` : '')
    : (inv.delivery_note_numbers || inv.order_number_ref) ? String(inv.delivery_note_numbers || inv.order_number_ref) : 'saisie manuelle';
  const steps = [
    { label: 'Émise', sub: fmtDate(inv.invoice_date, 'd MMM yyyy'), tone: 'done' },
    { label: 'Échéance', sub: inv.due_date ? fmtDate(inv.due_date, 'd MMM yyyy') + (late ? ` · ${lateDays} j de retard` : '') : 'non fixée', tone: status === 'paid' ? 'done' : late ? 'warn' : 'current' },
    { label: 'Encaissée', sub: status === 'paid' ? 'soldée' : paid > 0.004 ? `${money(paid)} reçus` : 'rien reçu', tone: status === 'paid' ? 'done' : '' },
  ];

  return (
    <section className="ord-pane" aria-label={`Facture ${inv.invoice_number as string}`}>
      <header className="ord-head">
        <span className="ord-mono" aria-hidden="true">{initialsOf(customerLabel(inv))}</span>
        <div className="ord-who">
          <h2>{customerLabel(inv)}</h2>
          <p><span className="sal-num">{inv.invoice_number as string}</span> · {origin}</p>
        </div>
        <div className="ord-amt">
          <b>{credit ? '−' : ''}{money(total)}</b>
          <small>{status === 'cancelled' ? 'annulée' : credit ? (remaining > 0.004 ? `${money(remaining)} à imputer` : 'imputé') : remaining > 0.004 ? `reste à encaisser ${money(remaining)}` : 'soldée'}</small>
        </div>
      </header>

      <div className="ord-actions">
        {open && !credit && remaining > 0.004 && <button type="button" className="odoo-btn-primary" onClick={onPay} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Banknote size={14} /> Encaisser</button>}
        <button type="button" className="odoo-btn-secondary" onClick={onPdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={13} /> PDF</button>
        <button type="button" className="odoo-btn-secondary" onClick={onFull} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Maximize2 size={13} /> Détail complet</button>
        <RowMenu items={menu} label="Autres actions" />
      </div>

      {status === 'cancelled' ? (
        <div className="kl-widget"><div className="ord-state">Facture annulée</div><div className="ord-state-sub">{inv.cancelled_by_credit ? 'Annulée par avoir : ses bons de livraison sont redevenus « à facturer ».' : 'Facture annulée.'}</div></div>
      ) : credit ? (
        <div className="kl-widget"><div className="ord-state">Avoir</div><div className="ord-state-sub">{remaining > 0.004 ? `${money(remaining)} au crédit du client, à imputer sur une facture.` : 'Avoir entièrement imputé.'}</div></div>
      ) : (
        <div className="kl-widget">
          <div className="ord-state">{late ? 'En retard' : STATUS_LABEL[status]}</div>
          <div className="ord-state-sub">{Math.round(pct)} % encaissé{late ? ` · échue depuis ${lateDays} j` : inv.due_date && status !== 'paid' ? ` · échéance le ${fmtDate(inv.due_date, 'd MMMM')}` : ''}</div>
          <div className={`ord-track${late ? ' late' : ''}`} aria-hidden="true"><span style={{ width: `${status === 'paid' ? 100 : Math.max(pct, 4)}%` }} /></div>
          <ol className="ord-steps" aria-label="Avancement">
            {steps.map(st => <li key={st.label} className={st.tone || undefined}><b>{st.label}</b><span>{st.sub}</span></li>)}
          </ol>
        </div>
      )}

      <section>
        <div className="kl-sec"><h2>Articles</h2><small>{items.length ? `${items.length} ligne${items.length > 1 ? 's' : ''}` : ''}</small></div>
        <div className="kl-group">
          {items.length ? items.map((it, i) => (
            <div key={i} className="ord-line">
              <span className="ord-qty">{num(it.quantity)} ×</span>
              <span className="ord-pn">{(it.description as string) || (it.product_name as string)}<small>{n(num(it.unit_price))} HT{it.tva_rate != null ? ` · TVA ${num(it.tva_rate)} %` : ''}</small></span>
              <span className="ord-pv">{n(num(it.subtotal))}</span>
            </div>
          )) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucun article.'}</div>}
          <div className="ord-kv"><span>Total HT</span><b>{money(num(inv.amount))}</b></div>
          <div className="ord-kv"><span>TVA</span><b>{money(num(inv.tax_amount))}</b></div>
          <div className="ord-line tot"><span className="ord-pn">Total TTC</span><span className="ord-pv">{money(total)}</span></div>
        </div>
      </section>

      {!credit && (
        <section>
          <div className="kl-sec"><h2>Encaissements</h2><small>{payments.length ? `${money(paid)} reçus` : ''}</small></div>
          <div className="kl-group">
            {payments.length ? payments.map(p => (
              <div key={p.id as string} className="ord-kv" style={{ opacity: p.voided_at ? 0.5 : 1 }}>
                <span>{fmtDate(p.payment_date, 'd MMM yyyy')} · {payLabel(getPaymentLabel, (p.payment_method as string) || '')}{p.reference ? ` · ${p.reference as string}` : ''}</span>
                <b style={{ textDecoration: p.voided_at ? 'line-through' : undefined }}>{money(num(p.allocated_amount ?? p.amount))}</b>
              </div>
            )) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucun encaissement.'}</div>}
          </div>
        </section>
      )}

      {(inv.notes || detail?.customer_ice) && (
        <section>
          <div className="kl-sec"><h2>Informations</h2></div>
          <div className="kl-group">
            {detail?.customer_ice && <div className="ord-kv"><span>ICE du client</span><b>{detail.customer_ice as string}</b></div>}
            {inv.notes && <div className="ord-kv"><span>Notes</span><b style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>{inv.notes as string}</b></div>}
          </div>
        </section>
      )}
    </section>
  );
}

/** Kanban : À encaisser, En retard, Partielles, Soldées (avoirs et annulées hors tableau) ; une carte ouvre le détail. */
function InvoiceKanban({ invoices, today, onOpen }: { invoices: Inv[]; today: Date; onOpen: (inv: Inv) => void }) {
  const lanes: Array<{ key: string; label: string; tone: string; match: (inv: Inv) => boolean }> = [
    { key: 'pending', label: 'À encaisser', tone: 'orange', match: inv => stageOf(inv) === 'pending' && !isOverdue(inv, today) },
    { key: 'late', label: 'En retard', tone: 'red', match: inv => isOverdue(inv, today) },
    { key: 'partial', label: 'Partielles', tone: 'blue', match: inv => stageOf(inv) === 'partial' && !isOverdue(inv, today) },
    { key: 'paid', label: 'Soldées', tone: 'green', match: inv => stageOf(inv) === 'paid' },
  ];
  return (
    <div className="prj-board">
      {lanes.map(l => {
        const cards = invoices.filter(l.match);
        const sum = cards.reduce((s, inv) => s + (l.key === 'paid' ? num(inv.total_amount) : remainingOf(inv)), 0);
        return (
          <section key={l.key} aria-label={l.label} className="prj-lane">
            <div className="prj-lane-head"><span className={`prj-dot ${l.tone}`} /><strong>{l.label}</strong><small className="sal-lane-sum">{cards.length} · {money(sum)}</small></div>
            {!cards.length && <div className="prj-lane-empty">Aucune facture</div>}
            {cards.slice(0, 60).map(inv => (
              <button key={inv.id as string} type="button" className="prj-task" onClick={() => onOpen(inv)} style={{ cursor: 'pointer' }}>
                <span className="prj-card-num">{inv.invoice_number as string}</span>
                <span className="prj-task-title">{customerLabel(inv)}</span>
                <span className="prj-task-meta">
                  <span style={{ flex: 1 }}>{inv.due_date ? `échéance ${fmtDate(inv.due_date, 'd MMM')}` : fmtDate(inv.invoice_date, 'd MMM')}</span>
                  <span className="sal-amount">{money(l.key === 'paid' ? num(inv.total_amount) : remainingOf(inv))}</span>
                </span>
              </button>
            ))}
            {cards.length > 60 && <div className="prj-lane-empty">+ {cards.length - 60} autres — filtrez ou passez en liste</div>}
          </section>
        );
      })}
    </div>
  );
}
