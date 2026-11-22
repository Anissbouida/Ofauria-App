import { money, currencySymbol } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Truck, FileText, Plus, Trash2, Loader2, Ban, Eye, CheckSquare, Printer, Columns3, List, SquareKanban, Send, PackageCheck, ExternalLink, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { deliveryNotesApi, type DeliveryNote, type ToInvoiceGroup } from '../../api/delivery-notes.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import SearchSelect from '../../components/ui/SearchSelect';
import SalesPageShell from './SalesPageShell';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { ListToolbar, FilterChips, NextStep, ListKpi } from './ListTemplate';
import { Segmented, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, Alert, Modal, FormField, FormSection, FormFooter } from '../../components/ds';

/** BL imprimable (mig 354) : remis avec la marchandise, signé par le client. */
async function printNote(id: string) {
  try {
    window.open(URL.createObjectURL(await deliveryNotesApi.pdf(id)), '_blank');
  } catch (e) {
    notify.error(apiErrorMessage(e, 'Impression du bon de livraison impossible'));
  }
}

/**
 * Ventes aux professionnels (mig 352) — remplace « Ventes spéciales ».
 * Chaîne des ERP (SAP B1 « copier vers », Odoo « À facturer ») :
 * commande (facultative) → bon de livraison → facture, avec une facture qui
 * regroupe les BL d'un client (facture mensuelle d'un hôtel ou d'un café).
 * Le BL ne passe aucune écriture ; CA, TVA et créance naissent à la facture.
 */

const day = (d: string) => format(new Date(String(d).slice(0, 10) + 'T00:00:00'), 'dd MMM yyyy', { locale: fr });
const TVA_RATES = [0, 7, 10, 14, 20];
/** Montant sans unité (l'unité est dans l'en-tête de colonne). */
const amt = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Cycle différé (mig 489) : brouillon, préparé, expédié — avant la livraison. */
const IN_PROGRESS = new Set<DeliveryNote['status']>(['draft', 'prepared', 'shipped']);
const STATUS: Record<DeliveryNote['status'], { label: string }> = {
  draft: { label: 'Brouillon' },
  prepared: { label: 'Préparé' },
  shipped: { label: 'Expédié' },
  delivered: { label: 'À facturer' },
  invoiced: { label: 'Facturé' },
  cancelled: { label: 'Annulé' },
};
/** Étiquette commune par statut de BL (à facturer = action attendue → ambre). */
const STATUS_TAG: Record<DeliveryNote['status'], { tone: StatusTone; icon?: LucideIcon }> = {
  draft: { tone: 'draft' },
  prepared: { tone: 'progress', icon: PackageCheck },
  shipped: { tone: 'progress', icon: Truck },
  delivered: { tone: 'todo', icon: FileText },
  invoiced: { tone: 'done' },
  cancelled: { tone: 'cancelled' },
};

export default function ProSalesTab() {
  // Une seule rangée de filtres : « À facturer » = BL livrés regroupés par client
  // avec l'action de facturation ; les autres filtrent la liste des BL.
  // Retour depuis une commande (?open=<id>) : tous les BL, pour que le bon d'origine reste visible et sélectionné.
  const [view, setView] = useState<'' | 'inprogress' | 'delivered' | 'invoiced' | 'cancelled' | null>(() => (new URLSearchParams(window.location.search).get('open') ? '' : null));
  // Design System : Tableau par défaut ; Colonnes (liste + fiche) et Kanban au choix.
  const [layout, setLayout] = useState<'split' | 'list' | 'kanban'>('list');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  // ?open=<id> : bon ouvert depuis la fiche commande.
  const [detailId, setDetailId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('open'));
  const { data: toInvoice = [], isSuccess } = useQuery({ queryKey: ['delivery-notes', 'to-invoice'], queryFn: () => deliveryNotesApi.toInvoice() });
  const pending = toInvoice.reduce((n, g) => n + g.notes.length, 0);
  const current = view ?? (isSuccess && pending > 0 ? 'delivered' : '');
  // Compteurs des pastilles : nombre et montant TTC par statut.
  const { data: allNotes = [] } = useQuery({ queryKey: ['delivery-notes', 'list', 'all'], queryFn: () => deliveryNotesApi.list() });
  const stats = useMemo(() => {
    const acc: Record<string, { count: number; total: number }> = {
      delivered: { count: 0, total: 0 }, invoiced: { count: 0, total: 0 }, cancelled: { count: 0, total: 0 }, inprogress: { count: 0, total: 0 },
    };
    for (const n of allNotes) { const a = acc[IN_PROGRESS.has(n.status) ? 'inprogress' : n.status]; if (a) { a.count += 1; a.total += Number(n.total_ttc) || 0; } }
    return acc;
  }, [allNotes]);
  // Tuiles : ancienneté du non-facturé et activité du mois (les pastilles donnent déjà les nombres).
  const kpis = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const k = { oldest: null as string | null, monthCount: 0, monthTotal: 0, invoicedMonth: 0 };
    for (const n of allNotes) {
      const d = String(n.delivery_date).slice(0, 10);
      if (n.status === 'delivered' && (!k.oldest || d < k.oldest)) k.oldest = d;
      if (n.status !== 'cancelled' && d.slice(0, 7) === month) { k.monthCount++; k.monthTotal += Number(n.total_ttc) || 0; }
      if (n.status === 'invoiced' && d.slice(0, 7) === month) k.invoicedMonth += Number(n.total_ttc) || 0;
    }
    return k;
  }, [allNotes]);
  const oldestDays = kpis.oldest ? Math.max(0, Math.round((Date.now() - new Date(`${kpis.oldest}T00:00:00`).getTime()) / 86_400_000)) : null;
  const q = search.trim().toLowerCase();
  // Colonnes et Kanban lisent la liste complète, filtrée par pastille et recherche.
  const shownNotes = allNotes.filter(n => (!current || (current === 'inprogress' ? IN_PROGRESS.has(n.status) : n.status === current))
    && (!q || `${n.number} ${n.customer_name} ${n.order_number ?? ''}`.toLowerCase().includes(q)));
  const groups = q ? toInvoice.filter(g => g.name.toLowerCase().includes(q) || g.notes.some(n => n.number.toLowerCase().includes(q))) : toInvoice;

  return (
    <SalesPageShell icon={Truck} title="Bons de livraison" parent="Ventes" list
      summary={`${stats.delivered.count} à facturer · ${money(stats.delivered.total)}`}
      actions={<button type="button" onClick={() => setShowNew(true)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau bon de livraison</button>}>
      {layout !== 'split' && <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="À facturer" value={money(stats.delivered.total)} sub={`${toInvoice.length} client${toInvoice.length > 1 ? 's' : ''}`} tone={stats.delivered.count ? 'orange' : undefined} />
        <ListKpi label="Plus ancien non facturé" value={oldestDays == null ? '—' : `${oldestDays} j`} sub={kpis.oldest ? `livré le ${format(new Date(`${kpis.oldest}T00:00:00`), 'dd/MM/yyyy', { locale: fr })}` : 'rien en attente'} tone={oldestDays != null && oldestDays > 30 ? 'red' : undefined} />
        <ListKpi label="Livré ce mois" value={money(kpis.monthTotal)} sub={`${kpis.monthCount} bon${kpis.monthCount > 1 ? 's' : ''}`} />
        <ListKpi label="Facturé ce mois" value={money(kpis.invoicedMonth)} sub="BL du mois déjà facturés" />
      </section>}
      <FilterChips label="Filtrer les bons de livraison" value={current} onChange={k => setView(k as '' | 'inprogress' | 'delivered' | 'invoiced' | 'cancelled')} chips={[
        ...(stats.inprogress.count ? [{ key: 'inprogress', label: 'En préparation', count: stats.inprogress.count, icon: PackageCheck }] : []),
        { key: 'delivered', label: 'À facturer', count: stats.delivered.count, icon: FileText },
        { key: 'invoiced', label: 'Facturés', count: stats.invoiced.count },
        { key: 'cancelled', label: 'Annulés', count: stats.cancelled.count },
        { key: '', label: 'Tous', count: allNotes.length },
      ]} />
      <ListToolbar search={search} onSearch={setSearch} placeholder="N° de BL, client, commande…">
        <Segmented label="Affichage" value={layout} onChange={setLayout} options={[
          { key: 'list', label: 'Tableau', icon: List },
          { key: 'split', label: 'Colonnes', icon: Columns3 },
          { key: 'kanban', label: 'Kanban', icon: SquareKanban },
        ]} />
      </ListToolbar>
      {layout !== 'split' && <p className="prj-note">Commande → bon de livraison → facture : le chiffre d'affaires et la créance naissent à la facture.</p>}
      {layout === 'split' ? <NotesSplit notes={shownNotes} search={!!q} onReset={() => setSearch('')} onToInvoice={() => { setLayout('list'); setView('delivered'); }} />
        : layout === 'kanban' ? <NotesKanban notes={allNotes.filter(n => !q || `${n.number} ${n.customer_name} ${n.order_number ?? ''}`.toLowerCase().includes(q))} onOpen={setDetailId} />
        : current === 'delivered'
        ? <ToInvoice groups={groups} filtered={!!q} onReset={() => setSearch('')} onOpen={setDetailId} />
        : <NotesList status={current === 'inprogress' ? '' : current} search={q} onReset={() => setSearch('')} onOpen={setDetailId} onToInvoice={() => setView('delivered')} />}
      {showNew && <NewNoteModal onClose={() => setShowNew(false)} />}
      {detailId && <NoteDetail id={detailId} onClose={() => setDetailId(null)} />}
    </SalesPageShell>
  );
}

function NotesList({ status, search, onReset, onOpen, onToInvoice }: { status: string; search: string; onReset: () => void; onOpen: (id: string) => void; onToInvoice: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: all = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['delivery-notes', 'list', status],
    queryFn: () => deliveryNotesApi.list(status ? { status } : undefined),
  });
  const notes = search
    ? all.filter(n => `${n.number} ${n.customer_name} ${n.order_number ?? ''}`.toLowerCase().includes(search))
    : all;
  const cancel = useMutation({
    mutationFn: (id: string) => deliveryNotesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); notify.success('Bon de livraison annulé'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  const menu = (n: DeliveryNote): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      { label: 'Voir le détail', icon: Eye, onSelect: () => onOpen(n.id) },
      { label: 'Imprimer le BL à faire signer', icon: Printer, onSelect: () => printNote(n.id) },
    ];
    if (n.status === 'delivered') items.push({
      label: 'Annuler le BL', icon: Ban, danger: true, disabled: cancel.isPending,
      onSelect: async () => { if (await confirm(`Annuler le bon ${n.number} ?`, { title: 'Annuler le bon de livraison', confirmLabel: 'Annuler le BL', cancelLabel: 'Retour', danger: true })) cancel.mutate(n.id); },
    });
    return items;
  };
  if (isLoading) return <LoadingState label="Chargement des bons de livraison…" />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!notes.length) {
    return search
      ? <NoResultState onReset={onReset} text="Aucun bon de livraison ne correspond à la recherche." />
      : <EmptyState icon={Truck} title="Aucun bon de livraison" text="« Nouveau bon de livraison » pour livrer un client." />;
  }
  const ttc = notes.reduce((s, n) => s + Number(n.total_ttc), 0);
  return (
    <DataPanel label="Bons de livraison" footer={<TableFooter note={<>{notes.length} bon{notes.length > 1 ? 's' : ''} de livraison · total <strong>{money(ttc)} TTC</strong></>} />}>
      <table className="odoo-table">
        <thead><tr><th>N° BL</th><th>Date</th><th>Client</th><th>Commande</th><th className="ds-num">HT ({currencySymbol()})</th><th className="ds-num">TTC ({currencySymbol()})</th><th>Statut</th><th className="ds-actions">Actions</th></tr></thead>
        <tbody>
          {notes.map(n => (
            <tr key={n.id} onClick={() => onOpen(n.id)}>
              <td style={{ whiteSpace: 'nowrap' }}><span className="ds-ref">{n.number}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>{day(n.delivery_date)}</td>
              <td className="ds-strong">{n.customer_name}</td>
              <td><span className="sal-mono">{n.order_number ?? '—'}</span></td>
              <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{amt(n.total_ht)}</td>
              <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{amt(n.total_ttc)}</td>
              <td>
                <StatusTag tone={STATUS_TAG[n.status].tone} icon={STATUS_TAG[n.status].icon} label={STATUS[n.status].label} />
                {n.invoice_number && <span className="sal-sub sal-mono">{n.invoice_number}</span>}
              </td>
              <td className="ds-actions" onClick={e => e.stopPropagation()}>
                {n.status === 'delivered' && <NextStep icon={FileText} label="Facturer" onClick={onToInvoice} />}
                <RowMenu items={menu(n)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}

function ToInvoice({ groups, filtered, onReset, onOpen }: { groups: ToInvoiceGroup[]; filtered: boolean; onReset: () => void; onOpen: (id: string) => void }) {
  if (groups.length === 0) {
    return filtered
      ? <NoResultState onReset={onReset} text="Aucun client à facturer ne correspond à la recherche." />
      : <EmptyState icon={CheckSquare} title="Rien à facturer" text="Tous les bons de livraison sont facturés." />;
  }
  return <div style={{ display: 'grid', gap: 14 }}>{groups.map(g => <InvoiceGroup key={g.customerId} g={g} onOpen={onOpen} />)}</div>;
}

function InvoiceGroup({ g, onOpen }: { g: ToInvoiceGroup; onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(g.notes.map(n => n.id)));
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const chosen = g.notes.filter(n => selected.has(n.id));
  const ht = chosen.reduce((s, n) => s + Number(n.total_ht), 0);
  const ttc = chosen.reduce((s, n) => s + Number(n.total_ttc), 0);
  const mutation = useMutation({
    mutationFn: () => deliveryNotesApi.invoice(chosen.map(n => n.id), date),
    onSuccess: (inv) => {
      ['delivery-notes', 'invoices', 'receivables'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      notify.success(`Facture ${inv.invoice_number} créée (${money(inv.total_amount)}) : elle apparaît dans Factures et Créances.`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Facturation impossible')),
  });
  const toggle = (id: string) => setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const allChosen = chosen.length === g.notes.length;
  return (
    <section className="prj-panel sal-panel">
      <div className="prj-panel-head" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span>{g.name}</span>
          <small>{g.notes.length} bon{g.notes.length > 1 ? 's' : ''} du {day(g.firstDate)} au {day(g.lastDate)} · {money(g.totalTtc)} TTC</small>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="ds-period">Date de facture
            <input type="date" className="ds-input sm" aria-label={`Date de facture pour ${g.name}`} value={date} onChange={e => setDate(e.target.value)} style={{ width: 'auto' }} />
          </span>
          <button type="button" className="odoo-btn-primary" disabled={chosen.length === 0 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            Facturer {chosen.length} BL · {money(ttc)}
          </button>
        </div>
      </div>
      <div className="prj-scroll">
        <table className="odoo-table">
          <thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" className="sal-check" checked={allChosen} aria-label={`Tout sélectionner pour ${g.name}`}
              onChange={() => setSelected(allChosen ? new Set() : new Set(g.notes.map(n => n.id)))} /></th>
            <th>N° BL</th><th>Date</th><th>Commande</th><th className="ds-num">HT ({currencySymbol()})</th><th className="ds-num">TTC ({currencySymbol()})</th><th className="ds-actions">Actions</th>
          </tr></thead>
          <tbody>
            {g.notes.map(n => (
              <tr key={n.id} className={selected.has(n.id) ? 'selected ds-selected' : undefined} onClick={() => toggle(n.id)}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" className="sal-check" checked={selected.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Inclure ${n.number}`} /></td>
                <td><span className="ds-ref">{n.number}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{day(n.delivery_date)}</td>
                <td><span className="sal-mono">{n.order_number ?? ''}</span></td>
                <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>{amt(n.total_ht)}</td>
                <td className="ds-num ds-strong" style={{ whiteSpace: 'nowrap' }}>{amt(n.total_ttc)}</td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>
                  <button type="button" className="ds-icon-btn" aria-label={`Voir ${n.number}`} onClick={() => onOpen(n.id)}><Eye size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFooter note={<>Sélection : {money(ht)} HT · <strong>{money(ttc)} TTC</strong></>}><span>Une seule facture, échéance selon le délai de paiement du client.</span></TableFooter>
    </section>
  );
}

type Line = { productId: string; description: string; quantity: string; unitPrice: string; tvaRate: string; orderItemId?: string };
const emptyLine = (): Line => ({ productId: '', description: '', quantity: '1', unitPrice: '', tvaRate: '' });

function NewNoteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orderId, setOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  // Crédit bloqué à l'expédition (O2C L3) : dérogation motivée de la direction.
  const [creditBlock, setCreditBlock] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const { data: customersResp } = useQuery({ queryKey: ['customers', 'all-for-bl'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers = ((customersResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  // Le bon de livraison est un document logistique ouvert à tout client (pro ou
  // particulier) : le sélecteur liste tous les clients, pros d'abord, type indiqué.
  const customerOptions = useMemo(() => customers
    .map(c => ({ id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '), sublabel: (c.customer_type ?? 'particulier') === 'particulier' ? 'Particulier' : 'Professionnel' }))
    .sort((a, b) => Number(b.sublabel === 'Professionnel') - Number(a.sublabel === 'Professionnel') || a.label.localeCompare(b.label)), [customers]);
  const { data: productsResp } = useQuery({ queryKey: ['products-bl'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((productsResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name), detail: p.price ? money(p.price) : undefined })), [products]);
  const { data: orders = [] } = useQuery({ queryKey: ['delivery-notes', 'orders', customerId], queryFn: () => deliveryNotesApi.eligibleOrders(customerId), enabled: !!customerId });

  const applyDefaults = async (productIds: string[], base: Line[]) => {
    if (!customerId || productIds.length === 0) return base;
    const d = await deliveryNotesApi.lineDefaults(customerId, productIds);
    return base.map(l => (l.productId && d[l.productId] ? {
      ...l, unitPrice: l.unitPrice || String(d[l.productId].unitPrice),
      tvaRate: l.tvaRate || (d[l.productId].tvaRate != null ? String(d[l.productId].tvaRate) : ''),
    } : l));
  };
  const setLine = (i: number, patch: Partial<Line>) => setLines(prev => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pickProduct = async (i: number, productId: string) => {
    const p = products.find(x => String(x.id) === productId);
    const next = lines.map((l, k) => (k === i ? { ...l, productId, description: p ? String(p.name) : '', unitPrice: '', tvaRate: l.tvaRate } : l));
    setLines(await applyDefaults([productId], next));
  };
  const pickOrder = async (id: string) => {
    setOrderId(id);
    if (!id) return;
    const ol = await deliveryNotesApi.orderLines(id);
    // Lignes rattachées à la commande (O2C L2) : reste à livrer par défaut, lignes soldées omises.
    setLines(await applyDefaults(ol.map(l => l.product_id), ol.filter(l => Number(l.remaining) > 0).map(l => ({
      productId: l.product_id, description: l.description, quantity: String(Number(l.remaining)), unitPrice: String(Number(l.unit_price)), tvaRate: '',
      orderItemId: l.id,
    }))));
  };

  const totals = lines.reduce((t, l) => {
    const st = (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0);
    t.ht += st; t.tva += l.tvaRate !== '' ? Math.round(st * Number(l.tvaRate)) / 100 : 0;
    return t;
  }, { ht: 0, tva: 0 });
  const valid = !!customerId && lines.length > 0 && lines.every(l => (l.productId || l.description.trim()) && parseFloat(l.quantity) > 0 && parseFloat(l.unitPrice) >= 0 && l.unitPrice !== '');

  const save = useMutation({
    mutationFn: () => deliveryNotesApi.create({
      customerId, deliveryDate: date, orderId: orderId || null, notes: notes.trim() || undefined,
      items: lines.map(l => ({ productId: l.productId || null, description: l.description.trim() || null, quantity: parseFloat(l.quantity), unitPrice: parseFloat(l.unitPrice), tvaRate: l.tvaRate === '' ? null : Number(l.tvaRate), orderItemId: orderId ? l.orderItemId ?? null : null })),
      creditOverrideReason: creditBlock && overrideReason.trim().length >= 3 ? overrideReason.trim() : undefined,
    }),
    onSuccess: (n) => { queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); notify.success(`Bon de livraison ${n.number} enregistré`); onClose(); },
    onError: (e) => {
      const code = (e as { response?: { data?: { error?: { code?: string } } } }).response?.data?.error?.code;
      if (code === 'CREDIT_BLOCKED') { setCreditBlock(apiErrorMessage(e, 'Crédit bloqué')); return; }
      notify.error(apiErrorMessage(e, 'Enregistrement impossible'));
    },
  });

  const dirty = !!(customerId || notes || lines.some(l => l.productId || l.description || l.unitPrice));
  return (
    <Modal title="Nouveau bon de livraison" onClose={onClose} width={980} locked={save.isPending}
      footer={<FormFooter dirty={dirty} onCancel={onClose} onSubmit={() => save.mutate()}
        submitLabel={creditBlock ? 'Déroger et enregistrer' : 'Enregistrer le bon de livraison'}
        disabled={!valid || (!!creditBlock && overrideReason.trim().length < 3)} busy={save.isPending} />}>
      <FormSection title="En-tête">
        <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <FormField label="Client" required>
            <SearchSelect options={customerOptions} value={customerId} onChange={id => { setCustomerId(id); setOrderId(''); }} placeholder="Rechercher un client…" ariaLabel="Client" width="100%" size="md" />
          </FormField>
          <FormField label="Date de livraison" htmlFor="bl-date" required>
            <input id="bl-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Depuis une commande (facultatif)" htmlFor="bl-order">
            <select id="bl-order" value={orderId} onChange={e => pickOrder(e.target.value)} disabled={!customerId || orders.length === 0} className="ds-input">
              <option value="">{!customerId ? 'Choisissez le client' : orders.length ? '— Saisie libre —' : 'Aucune commande prête'}</option>
              {orders.map(o => <option key={o.id} value={o.id}>{o.order_number} · {money(o.total)}</option>)}
            </select>
          </FormField>
        </div>
      </FormSection>
      <FormSection title="Lignes">
        <DataPanel label="Lignes du bon de livraison">
          <table className="odoo-table ds-dense" style={{ minWidth: 760 }}>
            <thead><tr><th style={{ width: '36%' }}>Produit / désignation</th><th className="ds-num" style={{ width: 90 }}>Qté</th><th className="ds-num" style={{ width: 120 }}>Prix unit. HT ({currencySymbol()})</th><th style={{ width: 90 }}>TVA</th><th className="ds-num">Total HT ({currencySymbol()})</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <SearchSelect options={productOptions} value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Produit…" ariaLabel="Produit" width="100%" />
                    {!l.productId && <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} aria-label="Désignation libre" placeholder="ou désignation libre" className="ds-input sm" style={{ marginTop: 4 }} />}
                  </td>
                  <td><input type="number" min={0} step="0.001" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} aria-label="Quantité" className="ds-input sm" style={{ textAlign: 'right' }} /></td>
                  <td><input type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} aria-label="Prix unitaire HT" placeholder="0,00" className="ds-input sm" style={{ textAlign: 'right' }} /></td>
                  <td>
                    <select value={l.tvaRate} onChange={e => setLine(i, { tvaRate: e.target.value })} aria-label="Taux de TVA" className="ds-input sm">
                      <option value="">—</option>
                      {TVA_RATES.map(r => <option key={r} value={String(r)}>{r} %</option>)}
                    </select>
                  </td>
                  <td className="ds-num ds-strong">{amt((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0))}</td>
                  <td><button type="button" className="odoo-pager-btn" aria-label="Retirer la ligne" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
        <div className="flex items-start gap-4" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, emptyLine()])}><Plus size={13} /> Ajouter une ligne</button>
          <div style={{ flex: 1, minWidth: 240 }}>
            <FormField label="Notes" htmlFor="bl-notes">
              <textarea id="bl-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (adresse, heure de livraison…)" className="ds-input" />
            </FormField>
          </div>
          <table className="ds-summary" aria-label="Totaux">
            <tbody>
              <tr><td>Total HT ({currencySymbol()})</td><td className="ds-num ds-strong">{amt(totals.ht)}</td></tr>
              <tr><td>TVA ({currencySymbol()})</td><td className="ds-num">{amt(totals.tva)}</td></tr>
              <tr className="ds-total"><td className="ds-strong">Total TTC ({currencySymbol()})</td><td className="ds-num ds-strong">{amt(totals.ht + totals.tva)}</td></tr>
            </tbody>
          </table>
        </div>
        <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--ds-muted)' }}>
          Prix proposés : tarif catalogue moins la remise du client ; TVA : dernier taux utilisé pour le produit. Le BL sort les produits du stock avec leurs lots ; il sera facturé depuis « À facturer ».
        </p>
      </FormSection>
      {creditBlock && (
        <Alert tone="danger">
          <b>Expédition bloquée par le contrôle de crédit.</b> {creditBlock}
          <div style={{ marginTop: 6 }}>
            <FormField label="Motif de la dérogation (direction)" htmlFor="bl-override" required
              error={overrideReason !== '' && overrideReason.trim().length < 3 ? 'Au moins 3 caractères.' : undefined}>
              <input id="bl-override" type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} maxLength={500} className="ds-input"
                placeholder="Ex. règlement promis vendredi" />
            </FormField>
          </div>
        </Alert>
      )}
    </Modal>
  );
}

function NoteDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: n } = useQuery({ queryKey: ['delivery-notes', 'detail', id], queryFn: () => deliveryNotesApi.getById(id) });
  return (
    <Modal title={n ? `Bon de livraison ${n.number}` : 'Bon de livraison'} onClose={onClose} width={720}
      aside={n && <StatusTag tone={STATUS_TAG[n.status].tone} icon={STATUS_TAG[n.status].icon} label={STATUS[n.status].label} />}
      footer={<button type="button" onClick={() => printNote(id)} className="odoo-btn-secondary"><Printer size={13} /> Imprimer</button>}>
      {!n ? <LoadingState bare /> : (
        <>
          <div className="flex flex-wrap gap-6" style={{ fontSize: '0.8125rem' }}>
            <div><div style={{ color: 'var(--ds-muted)', fontSize: '0.75rem' }}>Client</div><b>{n.customer_name}</b></div>
            <div><div style={{ color: 'var(--ds-muted)', fontSize: '0.75rem' }}>Livré le</div>{day(n.delivery_date)}</div>
            {n.order_number && <div><div style={{ color: 'var(--ds-muted)', fontSize: '0.75rem' }}>Commande</div><span className="ds-ref">{n.order_number}</span></div>}
            {n.invoice_number && <div><div style={{ color: 'var(--ds-muted)', fontSize: '0.75rem' }}>Facture</div><span className="ds-ref">{n.invoice_number}</span></div>}
          </div>
          {n.notes && <div style={{ fontSize: '0.8125rem' }}><b>Notes :</b> {n.notes}</div>}
          <DataPanel label="Lignes du bon de livraison">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Désignation</th><th className="ds-num">Qté</th><th className="ds-num">Prix HT ({currencySymbol()})</th><th className="ds-num">TVA</th><th className="ds-num">Total HT ({currencySymbol()})</th></tr></thead>
              <tbody>
                {(n.items ?? []).map(i => (
                  <tr key={i.id}>
                    <td>{i.description}
                      {(i.lots ?? []).length > 0 && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--ds-muted)', marginTop: 2 }}>
                          {(i.lots ?? []).map(l => `Lot ${l.lot_number} · ${Number(l.quantity).toLocaleString('fr-FR')}${l.dlc ? ` (DLC ${l.dlc.slice(0, 10).split('-').reverse().join('/')})` : ''}`).join(' — ')}
                        </div>
                      )}
                    </td>
                    <td className="ds-num">{Number(i.quantity).toLocaleString('fr-FR')}</td>
                    <td className="ds-num">{amt(i.unit_price)}</td>
                    <td className="ds-num">{i.tva_rate != null ? `${Number(i.tva_rate)} %` : '—'}</td>
                    <td className="ds-num ds-strong">{amt(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4} style={{ textAlign: 'right' }}>Total HT ({currencySymbol()})</td><td className="ds-num">{amt(n.total_ht)}</td></tr>
                <tr><td colSpan={4} style={{ textAlign: 'right' }}>TVA ({currencySymbol()})</td><td className="ds-num">{amt(n.total_tva)}</td></tr>
                <tr><td colSpan={4} className="ds-strong" style={{ textAlign: 'right' }}>Total TTC ({currencySymbol()})</td><td className="ds-num ds-strong">{amt(n.total_ttc)}</td></tr>
              </tfoot>
            </table>
          </DataPanel>
        </>
      )}
    </Modal>
  );
}

/* ═══════════════ Colonnes (liste + fiche) et Kanban — style Apple, 2026-11 ═══════════════ */

const initials = (name: string) => name.split(/\s+/).filter(w => /[A-Za-zÀ-ÿ]/.test(w[0] ?? '')).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';

/** Étape suivante d'un BL : expédier un BL préparé, constater la livraison, puis facturer. */
function useNoteActions(onToInvoice: () => void) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const done = (msg: string) => { queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); queryClient.invalidateQueries({ queryKey: ['orders'] }); notify.success(msg); };
  const ship = useMutation({ mutationFn: (id: string) => deliveryNotesApi.ship(id), onSuccess: () => done('Bon de livraison expédié : le stock est sorti'), onError: (e) => notify.error(apiErrorMessage(e, 'Expédition impossible')) });
  const deliver = useMutation({ mutationFn: (id: string) => deliveryNotesApi.deliver(id), onSuccess: () => done('Livraison constatée : le BL passe « à facturer »'), onError: (e) => notify.error(apiErrorMessage(e, 'Livraison impossible')) });
  const cancel = useMutation({ mutationFn: (id: string) => deliveryNotesApi.cancel(id), onSuccess: () => done('Bon de livraison annulé'), onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')) });
  const busy = ship.isPending || deliver.isPending || cancel.isPending;
  const next = (n: DeliveryNote): { label: string; icon: LucideIcon; run: () => void } | null => {
    if (n.status === 'draft' || n.status === 'prepared') return { label: 'Expédier', icon: Send, run: () => ship.mutate(n.id) };
    if (n.status === 'shipped') return { label: 'Marquer livré', icon: PackageCheck, run: () => deliver.mutate(n.id) };
    if (n.status === 'delivered') return { label: 'Facturer', icon: FileText, run: onToInvoice };
    return null;
  };
  const menu = (n: DeliveryNote): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ label: 'Imprimer le BL à faire signer', icon: Printer, onSelect: () => printNote(n.id) }];
    if (n.status === 'delivered' || IN_PROGRESS.has(n.status)) items.push({
      label: 'Annuler le BL', icon: Ban, danger: true, disabled: busy,
      onSelect: async () => { if (await confirm(`Annuler le bon ${n.number} ?`, { title: 'Annuler le bon de livraison', confirmLabel: 'Annuler le BL', cancelLabel: 'Retour', danger: true })) cancel.mutate(n.id); },
    });
    return items;
  };
  return { next, menu, busy };
}

function NotesSplit({ notes, search, onReset, onToInvoice }: { notes: DeliveryNote[]; search: boolean; onReset: () => void; onToInvoice: () => void }) {
  const [activeId, setActiveId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('open'));
  const actions = useNoteActions(onToInvoice);
  if (!notes.length) {
    return search
      ? <NoResultState onReset={onReset} text="Aucun bon de livraison ne correspond à la recherche." />
      : <EmptyState icon={Truck} title="Aucun bon de livraison" text="« Nouveau bon de livraison » pour livrer un client." />;
  }
  const active = notes.find(n => n.id === activeId) ?? notes[0];
  return (
    <div className="ord-split">
      <nav className="ord-list" aria-label="Bons de livraison">
        {notes.map(n => (
          <button key={n.id} type="button" className={`ord-row${n.id === active.id ? ' sel' : ''}`} aria-current={n.id === active.id ? 'true' : undefined} onClick={() => setActiveId(n.id)}>
            <span className="ord-dot" aria-hidden="true" />
            <span className="ord-l1"><span className="ord-nm">{n.customer_name}</span><span className="ord-when">{day(n.delivery_date)}</span></span>
            <span className="ord-l2"><span className="sal-num">{n.number}</span> · <b>{money(n.total_ttc)}</b></span>
            <span className="ord-l3"><StatusTag tone={STATUS_TAG[n.status].tone} icon={STATUS_TAG[n.status].icon} label={STATUS[n.status].label} />{n.invoice_number ? ` ${n.invoice_number}` : n.order_number ? ` ${n.order_number}` : ''}</span>
          </button>
        ))}
      </nav>
      <NotePane key={active.id} note={active} next={actions.next(active)} menu={actions.menu(active)} busy={actions.busy} />
    </div>
  );
}

function NotePane({ note, next, menu, busy }: { note: DeliveryNote; next: { label: string; icon: LucideIcon; run: () => void } | null; menu: RowMenuItem[]; busy: boolean }) {
  const navigate = useNavigate();
  const { data: n0, isLoading } = useQuery({ queryKey: ['delivery-notes', 'detail', note.id], queryFn: () => deliveryNotesApi.getById(note.id) });
  const n = n0 ?? note;
  const st = n.status;
  const order = ['prepared', 'shipped', 'delivered', 'invoiced'];
  const idx = st === 'draft' ? -1 : order.indexOf(st);
  const steps = [
    { label: 'Préparé', sub: n.prepared_at ? day(n.prepared_at) : idx >= 0 ? 'fait' : 'à préparer' },
    { label: 'Expédié', sub: n.shipped_at ? day(n.shipped_at) : idx >= 1 ? 'stock sorti' : 'à expédier' },
    { label: 'Livré', sub: idx >= 2 ? `${day(n.delivery_date)}${n.received_by_name ? ` · reçu par ${n.received_by_name}` : ''}` : `prévu le ${day(n.delivery_date)}` },
    { label: 'Facturé', sub: n.invoice_number ?? (idx >= 2 ? 'à facturer' : '—') },
  ].map((s, i) => ({ ...s, tone: i <= idx ? 'done' : i === idx + 1 ? (i === 3 ? 'warn' : 'current') : '' }));
  const pct = st === 'invoiced' ? 100 : Math.round(((idx + 1) + 0.5) / steps.length * 100);
  const items = n.items ?? [];

  return (
    <section className="ord-pane" aria-label={`Bon de livraison ${n.number}`}>
      <header className="ord-head">
        <span className="ord-mono" aria-hidden="true">{initials(n.customer_name)}</span>
        <div className="ord-who">
          <h2>{n.customer_name}</h2>
          <p><span className="sal-num">{n.number}</span>{n.order_number ? <> · commande <span className="sal-num">{n.order_number}</span></> : ' · saisie libre'}</p>
        </div>
        <div className="ord-amt"><b>{money(n.total_ttc)}</b><small>{money(n.total_ht)} HT · {money(n.total_tva)} TVA</small></div>
      </header>

      <div className="ord-actions">
        {next && <button type="button" className="odoo-btn-primary" disabled={busy} onClick={next.run} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><next.icon size={14} /> {next.label}</button>}
        <button type="button" className="odoo-btn-secondary" onClick={() => printNote(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Printer size={13} /> Imprimer</button>
        {n.order_id && <button type="button" className="odoo-btn-secondary" onClick={() => navigate(`/orders/${n.order_id}`, { state: { from: { label: 'Bons de livraison', href: `/delivery-notes?open=${n.id}` } } })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ExternalLink size={13} /> Commande</button>}
        <RowMenu items={menu} label="Autres actions" />
      </div>

      {st === 'cancelled' ? (
        <div className="kl-widget"><div className="ord-state">Bon de livraison annulé</div><div className="ord-state-sub">Le stock sorti a été réintégré.</div></div>
      ) : (
        <div className="kl-widget">
          <div className="ord-state">{STATUS[st].label}</div>
          <div className="ord-state-sub">{st === 'delivered' ? 'Livré, en attente de facture : le chiffre d\'affaires naît à la facture.' : st === 'invoiced' ? `Facturé${n.invoice_number ? ` sur ${n.invoice_number}` : ''}.` : `Livraison prévue le ${day(n.delivery_date)}.`}</div>
          <div className="ord-track" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          <ol className="ord-steps" aria-label="Avancement">
            {steps.map(s => <li key={s.label} className={s.tone || undefined}><b>{s.label}</b><span>{s.sub}</span></li>)}
          </ol>
        </div>
      )}

      <section>
        <div className="kl-sec"><h2>Articles</h2><small>{items.length ? `${items.length} ligne${items.length > 1 ? 's' : ''}` : ''}</small></div>
        <div className="kl-group">
          {items.length ? items.map(i => (
            <div key={i.id} className="ord-line">
              <span className="ord-qty">{Number(i.quantity).toLocaleString('fr-FR')} ×</span>
              <span className="ord-pn">{i.description}
                {(i.lots ?? []).length > 0 && <small>{(i.lots ?? []).map(l => `Lot ${l.lot_number}${l.dlc ? ` · DLC ${l.dlc.slice(0, 10).split('-').reverse().join('/')}` : ''}`).join(' — ')}</small>}
              </span>
              <span className="ord-pv">{money(i.subtotal)}</span>
            </div>
          )) : <div className="kl-empty">{isLoading ? 'Chargement…' : 'Aucune ligne.'}</div>}
          {items.length > 0 && <div className="ord-line tot"><span className="ord-pn">Total TTC</span><span className="ord-pv">{money(n.total_ttc)}</span></div>}
        </div>
      </section>

      <section>
        <div className="kl-sec"><h2>Livraison</h2></div>
        <div className="kl-group">
          <div className="ord-kv"><span>Date</span><b>{day(n.delivery_date)}</b></div>
          {n.received_by_name && <div className="ord-kv"><span>Reçu par</span><b>{n.received_by_name}</b></div>}
          <div className="ord-kv"><span>Établi par</span><b>{n.created_by_name || '—'}</b></div>
          {n.notes && <div className="ord-kv"><span>Notes</span><b style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>{n.notes}</b></div>}
        </div>
      </section>
    </section>
  );
}

/** Kanban : une colonne par étape du cycle (les annulés n'y figurent pas) ; une carte ouvre le détail. */
function NotesKanban({ notes, onOpen }: { notes: DeliveryNote[]; onOpen: (id: string) => void }) {
  const lanes: Array<{ key: string; label: string; tone: string; match: (n: DeliveryNote) => boolean }> = [
    { key: 'prep', label: 'En préparation', tone: 'grey', match: n => n.status === 'draft' || n.status === 'prepared' },
    { key: 'shipped', label: 'Expédiés', tone: 'blue', match: n => n.status === 'shipped' },
    { key: 'delivered', label: 'Livrés · à facturer', tone: 'orange', match: n => n.status === 'delivered' },
    { key: 'invoiced', label: 'Facturés', tone: 'green', match: n => n.status === 'invoiced' },
  ];
  return (
    <div className="prj-board">
      {lanes.map(l => {
        const cards = notes.filter(l.match);
        const sum = cards.reduce((s, n) => s + Number(n.total_ttc), 0);
        return (
          <section key={l.key} aria-label={l.label} className="prj-lane">
            <div className="prj-lane-head"><span className={`prj-dot ${l.tone}`} /><strong>{l.label}</strong><small className="sal-lane-sum">{cards.length} · {money(sum)}</small></div>
            {!cards.length && <div className="prj-lane-empty">Aucun bon</div>}
            {cards.slice(0, 60).map(n => (
              <button key={n.id} type="button" className="prj-task" onClick={() => onOpen(n.id)} style={{ cursor: 'pointer' }}>
                <span className="prj-card-num">{n.number}</span>
                <span className="prj-task-title">{n.customer_name}</span>
                <span className="prj-task-meta"><span style={{ flex: 1 }}>{day(n.delivery_date)}{n.invoice_number ? ` · ${n.invoice_number}` : ''}</span><span className="sal-amount">{money(n.total_ttc)}</span></span>
              </button>
            ))}
            {cards.length > 60 && <div className="prj-lane-empty">+ {cards.length - 60} autres — filtrez ou passez en tableau</div>}
          </section>
        );
      })}
    </div>
  );
}
