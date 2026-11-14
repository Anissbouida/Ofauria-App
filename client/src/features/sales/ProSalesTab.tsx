import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Truck, FileText, Plus, X, Trash2, Loader2, Ban, Eye, CheckSquare, ClipboardList, Printer } from 'lucide-react';
import { deliveryNotesApi, type DeliveryNote, type ToInvoiceGroup } from '../../api/delivery-notes.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import SalesPageShell from './SalesPageShell';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { ListToolbar, FilterChips, ListPanel, ListEmpty, NextStep, ListKpi } from './ListTemplate';

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

const money = (v: number | string) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const day = (d: string) => format(new Date(String(d).slice(0, 10) + 'T00:00:00'), 'dd MMM yyyy', { locale: fr });
const TVA_RATES = [0, 7, 10, 14, 20];
const STATUS: Record<DeliveryNote['status'], { label: string; cls: string }> = {
  delivered: { label: 'À facturer', cls: 'odoo-tag-orange' },
  invoiced: { label: 'Facturé', cls: 'odoo-tag-green' },
  cancelled: { label: 'Annulé', cls: 'odoo-tag-grey' },
};

export default function ProSalesTab() {
  // Une seule rangée de filtres : « À facturer » = BL livrés regroupés par client
  // avec l'action de facturation ; les autres filtrent la liste des BL.
  const [view, setView] = useState<'' | 'delivered' | 'invoiced' | 'cancelled' | null>(null);
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
      delivered: { count: 0, total: 0 }, invoiced: { count: 0, total: 0 }, cancelled: { count: 0, total: 0 },
    };
    for (const n of allNotes) { const a = acc[n.status]; if (a) { a.count += 1; a.total += Number(n.total_ttc) || 0; } }
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
  const groups = q ? toInvoice.filter(g => g.name.toLowerCase().includes(q) || g.notes.some(n => n.number.toLowerCase().includes(q))) : toInvoice;

  return (
    <SalesPageShell icon={Truck} title="Bons de livraison" parent="Ventes" list
      summary={`${stats.delivered.count} à facturer · ${money(stats.delivered.total)}`}
      actions={<button type="button" onClick={() => setShowNew(true)} className="odoo-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau bon de livraison</button>}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="À facturer" value={money(stats.delivered.total)} sub={`${toInvoice.length} client${toInvoice.length > 1 ? 's' : ''}`} tone={stats.delivered.count ? 'orange' : undefined} />
        <ListKpi label="Plus ancien non facturé" value={oldestDays == null ? '—' : `${oldestDays} j`} sub={kpis.oldest ? `livré le ${format(new Date(`${kpis.oldest}T00:00:00`), 'dd/MM/yyyy', { locale: fr })}` : 'rien en attente'} tone={oldestDays != null && oldestDays > 30 ? 'red' : undefined} />
        <ListKpi label="Livré ce mois" value={money(kpis.monthTotal)} sub={`${kpis.monthCount} bon${kpis.monthCount > 1 ? 's' : ''}`} />
        <ListKpi label="Facturé ce mois" value={money(kpis.invoicedMonth)} sub="BL du mois déjà facturés" />
      </section>
      <ListToolbar search={search} onSearch={setSearch} placeholder="N° de BL, client, commande…" />
      <FilterChips label="Filtrer les bons de livraison" value={current} onChange={k => setView(k as '' | 'delivered' | 'invoiced' | 'cancelled')} chips={[
        { key: 'delivered', label: 'À facturer', count: stats.delivered.count, icon: FileText },
        { key: 'invoiced', label: 'Facturés', count: stats.invoiced.count },
        { key: 'cancelled', label: 'Annulés', count: stats.cancelled.count },
        { key: '', label: 'Tous', count: allNotes.length },
      ]} />
      <p className="prj-note">Commande → bon de livraison → facture : le chiffre d'affaires et la créance naissent à la facture.</p>
      {current === 'delivered'
        ? <ToInvoice groups={groups} filtered={!!q} onOpen={setDetailId} />
        : <NotesList status={current} search={q} onOpen={setDetailId} onToInvoice={() => setView('delivered')} />}
      {showNew && <NewNoteModal onClose={() => setShowNew(false)} />}
      {detailId && <NoteDetail id={detailId} onClose={() => setDetailId(null)} />}
    </SalesPageShell>
  );
}

function NotesList({ status, search, onOpen, onToInvoice }: { status: string; search: string; onOpen: (id: string) => void; onToInvoice: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: all = [], isLoading } = useQuery({
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
  if (isLoading) return <ListEmpty icon={Loader2} title="Chargement des bons de livraison…" />;
  if (!notes.length) {
    return <ListEmpty icon={Truck} title={search ? 'Aucun bon de livraison pour cette recherche' : 'Aucun bon de livraison'}
      text={search ? 'Effacez la recherche ou changez de filtre.' : '« Nouveau bon de livraison » pour livrer un client.'} />;
  }
  const ttc = notes.reduce((s, n) => s + Number(n.total_ttc), 0);
  return (
    <ListPanel footer={<div className="sal-foot"><span>{notes.length} bon{notes.length > 1 ? 's' : ''} de livraison</span><span>Total <strong>{money(ttc)} TTC</strong></span></div>}>
      <table className="odoo-table">
        <thead><tr><th>N° BL</th><th>Date</th><th>Client</th><th>Commande</th><th style={{ textAlign: 'right' }}>HT</th><th style={{ textAlign: 'right' }}>TTC</th><th>Statut</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
        <tbody>
          {notes.map(n => (
            <tr key={n.id} onClick={() => onOpen(n.id)}>
              <td style={{ whiteSpace: 'nowrap' }}><span className="sal-num">{n.number}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>{day(n.delivery_date)}</td>
              <td style={{ fontWeight: 500 }}>{n.customer_name}</td>
              <td><span className="sal-mono">{n.order_number ?? '—'}</span></td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(n.total_ht)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(n.total_ttc)}</td>
              <td>
                <span className={`odoo-tag ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>
                {n.invoice_number && <span className="sal-sub sal-mono">{n.invoice_number}</span>}
              </td>
              <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                <div className="sal-actions">
                  {n.status === 'delivered' && <NextStep icon={FileText} label="Facturer" onClick={onToInvoice} />}
                  <RowMenu items={menu(n)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPanel>
  );
}

function ToInvoice({ groups, filtered, onOpen }: { groups: ToInvoiceGroup[]; filtered: boolean; onOpen: (id: string) => void }) {
  if (groups.length === 0) {
    return <ListEmpty icon={CheckSquare} title={filtered ? 'Aucun client à facturer pour cette recherche' : 'Rien à facturer'}
      text={filtered ? undefined : 'Tous les bons de livraison sont facturés.'} />;
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
          <label style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Date de facture
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ height: 32, padding: '0 8px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--theme-bg-card)', color: 'var(--odoo-text)' }} />
          </label>
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
            <th>N° BL</th><th>Date</th><th>Commande</th><th style={{ textAlign: 'right' }}>HT</th><th style={{ textAlign: 'right' }}>TTC</th><th style={{ width: 48 }} />
          </tr></thead>
          <tbody>
            {g.notes.map(n => (
              <tr key={n.id} className={selected.has(n.id) ? 'selected' : undefined} onClick={() => toggle(n.id)}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" className="sal-check" checked={selected.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Inclure ${n.number}`} /></td>
                <td><span className="sal-num">{n.number}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{day(n.delivery_date)}</td>
                <td><span className="sal-mono">{n.order_number ?? ''}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(n.total_ht)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(n.total_ttc)}</td>
                <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  <button type="button" className="sal-next" aria-label={`Voir ${n.number}`} onClick={() => onOpen(n.id)}><Eye size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sal-foot"><span>Sélection : {money(ht)} HT · {money(ttc)} TTC</span><span>Une seule facture, échéance selon le délai de paiement du client.</span></div>
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

  const field: React.CSSProperties = { padding: '0.35rem 0.5rem', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem', width: '100%' };
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 980, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', background: 'var(--odoo-bg)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><Truck size={14} style={{ color: 'var(--theme-accent)' }} /><span className="odoo-breadcrumb-current">Nouveau bon de livraison</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', display: 'grid', gap: 14 }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem', fontWeight: 600 }}>Client *
              <SearchSelect options={customerOptions} value={customerId} onChange={id => { setCustomerId(id); setOrderId(''); }} placeholder="Rechercher un client…" width="100%" size="md" />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem', fontWeight: 600 }}>Date de livraison
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={field} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem', fontWeight: 600 }}>Depuis une commande (facultatif)
              <select value={orderId} onChange={e => pickOrder(e.target.value)} disabled={!customerId || orders.length === 0} style={field}>
                <option value="">{!customerId ? 'Choisissez le client' : orders.length ? '— Saisie libre —' : 'Aucune commande prête'}</option>
                {orders.map(o => <option key={o.id} value={o.id}>{o.order_number} · {money(o.total)}</option>)}
              </select>
            </label>
          </div>
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
            <table className="odoo-table" style={{ minWidth: 760 }}>
              <thead><tr><th style={{ width: '36%' }}>Produit / désignation</th><th style={{ textAlign: 'right', width: 90 }}>Qté</th><th style={{ textAlign: 'right', width: 120 }}>Prix unit. HT</th><th style={{ width: 90 }}>TVA</th><th style={{ textAlign: 'right' }}>Total HT</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <SearchSelect options={productOptions} value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Produit…" width="100%" />
                      {!l.productId && <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="ou désignation libre" style={{ ...field, marginTop: 4 }} />}
                    </td>
                    <td><input type="number" min={0} step="0.001" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} style={{ ...field, textAlign: 'right' }} /></td>
                    <td><input type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} placeholder="0,00" style={{ ...field, textAlign: 'right' }} /></td>
                    <td>
                      <select value={l.tvaRate} onChange={e => setLine(i, { tvaRate: e.target.value })} style={field}>
                        <option value="">—</option>
                        {TVA_RATES.map(r => <option key={r} value={String(r)}>{r} %</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money((parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0))}</td>
                    <td><button type="button" className="odoo-pager-btn" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-start gap-4">
            <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, emptyLine()])}><Plus size={13} /> Ajouter une ligne</button>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes (adresse, heure de livraison…)" style={{ ...field, flex: 1 }} />
            <div style={{ minWidth: 220, fontSize: '0.8125rem', display: 'grid', gap: 2 }}>
              <div className="flex justify-between"><span>Total HT</span><b>{money(totals.ht)}</b></div>
              <div className="flex justify-between"><span>TVA</span><span>{money(totals.tva)}</span></div>
              <div className="flex justify-between" style={{ fontSize: '0.9375rem' }}><span>Total TTC</span><b>{money(totals.ht + totals.tva)}</b></div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>
            Prix proposés : tarif catalogue moins la remise du client ; TVA : dernier taux utilisé pour le produit. Le BL sort les produits du stock avec leurs lots ; il sera facturé depuis « À facturer ».
          </p>
          {creditBlock && (
            <div style={{ border: '1px solid #f5c2c7', background: '#f8d7da', color: '#842029', borderRadius: 4, padding: '8px 10px', fontSize: '0.8125rem' }}>
              <b>Expédition bloquée par le contrôle de crédit.</b> {creditBlock}
              <div style={{ marginTop: 6 }}>
                <input type="text" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} maxLength={500} style={field}
                  placeholder="Motif de la dérogation (direction) — ex. règlement promis vendredi" />
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending || (!!creditBlock && overrideReason.trim().length < 3)} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />} {creditBlock ? 'Déroger et enregistrer' : 'Enregistrer le bon de livraison'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function NoteDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: n } = useQuery({ queryKey: ['delivery-notes', 'detail', id], queryFn: () => deliveryNotesApi.getById(id) });
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', background: 'var(--odoo-bg)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><Truck size={14} style={{ color: 'var(--theme-accent)' }} /><span className="odoo-breadcrumb-current">{n ? `Bon de livraison ${n.number}` : 'Bon de livraison'}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => printNote(id)} className="odoo-btn-secondary"><Printer size={13} /> Imprimer</button>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        {!n ? <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div> : (
          <div style={{ padding: 16, overflowY: 'auto', display: 'grid', gap: 10, fontSize: '0.8125rem' }}>
            <div className="flex flex-wrap gap-6">
              <div><div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Client</div><b>{n.customer_name}</b></div>
              <div><div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Livré le</div>{day(n.delivery_date)}</div>
              {n.order_number && <div><div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Commande</div>{n.order_number}</div>}
              <div><div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Statut</div>
                <span className={`odoo-tag ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>{n.invoice_number ? ` ${n.invoice_number}` : ''}</div>
            </div>
            {n.notes && <div><b>Notes :</b> {n.notes}</div>}
            <table className="odoo-table">
              <thead><tr><th>Désignation</th><th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>Prix HT</th><th style={{ textAlign: 'right' }}>TVA</th><th style={{ textAlign: 'right' }}>Total HT</th></tr></thead>
              <tbody>
                {(n.items ?? []).map(i => (
                  <tr key={i.id}>
                    <td>{i.description}
                      {(i.lots ?? []).length > 0 && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginTop: 2 }}>
                          {(i.lots ?? []).map(l => `Lot ${l.lot_number} · ${Number(l.quantity).toLocaleString('fr-FR')}${l.dlc ? ` (DLC ${l.dlc.slice(0, 10).split('-').reverse().join('/')})` : ''}`).join(' — ')}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{Number(i.quantity).toLocaleString('fr-FR')}</td>
                    <td style={{ textAlign: 'right' }}>{money(i.unit_price)}</td>
                    <td style={{ textAlign: 'right' }}>{i.tva_rate != null ? `${Number(i.tva_rate)} %` : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right' }}>{money(n.total_ht)} HT · {money(n.total_tva)} TVA · <b>{money(n.total_ttc)} TTC</b></div>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
