import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Truck, FileText, Plus, X, Trash2, Loader2, Ban, Eye, CheckSquare, Square, ClipboardList } from 'lucide-react';
import { deliveryNotesApi, type DeliveryNote, type ToInvoiceGroup } from '../../api/delivery-notes.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';

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
  const [view, setView] = useState<'notes' | 'invoice'>('notes');
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: toInvoice = [] } = useQuery({ queryKey: ['delivery-notes', 'to-invoice'], queryFn: () => deliveryNotesApi.toInvoice() });
  const pending = toInvoice.reduce((n, g) => n + g.notes.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setView('notes')} className={view === 'notes' ? 'odoo-btn-primary' : 'odoo-btn-secondary'}>
          <Truck size={13} /> Bons de livraison
        </button>
        <button type="button" onClick={() => setView('invoice')} className={view === 'invoice' ? 'odoo-btn-primary' : 'odoo-btn-secondary'}>
          <FileText size={13} /> À facturer {pending > 0 && <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 4 }}>{pending}</span>}
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', marginLeft: 8 }}>
          Commande → bon de livraison → facture : le chiffre d'affaires et la créance naissent à la facture.
        </span>
        <button type="button" onClick={() => setShowNew(true)} className="odoo-btn-primary" style={{ marginLeft: 'auto' }}>
          <Plus size={13} /> Nouveau bon de livraison
        </button>
      </div>
      {view === 'notes' ? <NotesList onOpen={setDetailId} /> : <ToInvoice groups={toInvoice} onOpen={setDetailId} />}
      {showNew && <NewNoteModal onClose={() => setShowNew(false)} />}
      {detailId && <NoteDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function NotesList({ onOpen }: { onOpen: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>('');
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['delivery-notes', 'list', status],
    queryFn: () => deliveryNotesApi.list(status ? { status } : undefined),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => deliveryNotesApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); notify.success('Bon de livraison annulé'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Annulation impossible')),
  });
  return (
    <>
      <div className="flex gap-2">
        {([['', 'Tous'], ['delivered', 'À facturer'], ['invoiced', 'Facturés'], ['cancelled', 'Annulés']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={status === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
            style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}>{l}</button>
        ))}
      </div>
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>N° BL</th><th>Date</th><th>Client</th><th>Commande</th><th style={{ textAlign: 'right' }}>HT</th><th style={{ textAlign: 'right' }}>TTC</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && notes.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--odoo-text-muted)' }}>Aucun bon de livraison. « Nouveau bon de livraison » pour livrer un client professionnel.</td></tr>
            )}
            {notes.map(n => (
              <tr key={n.id} onClick={() => onOpen(n.id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{n.number}</td>
                <td>{day(n.delivery_date)}</td>
                <td>{n.customer_name}</td>
                <td style={{ color: 'var(--odoo-text-muted)' }}>{n.order_number ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{money(n.total_ht)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(n.total_ttc)}</td>
                <td>
                  <span className={`odoo-tag ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>
                  {n.invoice_number && <span style={{ marginLeft: 6, fontSize: '0.75rem', fontFamily: 'ui-monospace, monospace' }}>{n.invoice_number}</span>}
                </td>
                <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  <button type="button" className="odoo-pager-btn" title="Voir" onClick={() => onOpen(n.id)}><Eye size={13} /></button>
                  {n.status === 'delivered' && (
                    <button type="button" className="odoo-pager-btn" title="Annuler le BL"
                      onClick={() => { if (window.confirm(`Annuler le bon ${n.number} ?`)) cancel.mutate(n.id); }}><Ban size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ToInvoice({ groups, onOpen }: { groups: ToInvoiceGroup[]; onOpen: (id: string) => void }) {
  if (groups.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--odoo-text-muted)', border: '1px dashed var(--odoo-border)', borderRadius: 6 }}>Rien à facturer : tous les bons de livraison sont facturés.</div>;
  }
  return <div style={{ display: 'grid', gap: 12 }}>{groups.map(g => <InvoiceGroup key={g.customerId} g={g} onOpen={onOpen} />)}</div>;
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
      notify.success(`Facture ${inv.invoice_number} créée (${money(inv.total_amount)}) : elle apparaît dans Factures émises et Créances clients.`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Facturation impossible')),
  });
  const toggle = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  return (
    <article style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'grid', gap: 8 }}>
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <div style={{ fontWeight: 700 }}>{g.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
            {g.notes.length} bon{g.notes.length > 1 ? 's' : ''} du {day(g.firstDate)} au {day(g.lastDate)} · {money(g.totalTtc)} TTC
          </div>
        </div>
        <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Date de facture
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ marginLeft: 6, padding: '0.2rem 0.4rem', border: '1px solid var(--odoo-border)', borderRadius: 4 }} />
          </label>
          <button type="button" className="odoo-btn-primary" disabled={chosen.length === 0 || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
            Facturer {chosen.length} BL · {money(ttc)}
          </button>
        </div>
      </header>
      <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
        <tbody>
          {g.notes.map(n => (
            <tr key={n.id} style={{ borderTop: '1px solid var(--odoo-border)' }}>
              <td style={{ padding: 4, width: 28 }}>
                <button type="button" onClick={() => toggle(n.id)} style={{ display: 'flex' }}>
                  {selected.has(n.id) ? <CheckSquare size={15} style={{ color: 'var(--theme-accent)' }} /> : <Square size={15} />}
                </button>
              </td>
              <td style={{ padding: 4, fontFamily: 'ui-monospace, monospace' }}>{n.number}</td>
              <td style={{ padding: 4 }}>{day(n.delivery_date)}</td>
              <td style={{ padding: 4, color: 'var(--odoo-text-muted)' }}>{n.order_number ?? ''}</td>
              <td style={{ padding: 4, textAlign: 'right' }}>{money(n.total_ht)} HT</td>
              <td style={{ padding: 4, textAlign: 'right', fontWeight: 600 }}>{money(n.total_ttc)}</td>
              <td style={{ padding: 4, textAlign: 'right' }}><button type="button" className="odoo-pager-btn" onClick={() => onOpen(n.id)}><Eye size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', textAlign: 'right' }}>
        Sélection : {money(ht)} HT · {money(ttc)} TTC — une seule facture, échéance selon le délai de paiement du client.
      </div>
    </article>
  );
}

type Line = { productId: string; description: string; quantity: string; unitPrice: string; tvaRate: string };
const emptyLine = (): Line => ({ productId: '', description: '', quantity: '1', unitPrice: '', tvaRate: '' });

function NewNoteModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orderId, setOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const { data: customersResp } = useQuery({ queryKey: ['customers', 'all-for-bl'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers = ((customersResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const customerOptions = useMemo(() => customers
    .map(c => ({ id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '), sublabel: c.customer_type === 'professionnel' ? 'Professionnel' : 'Particulier' }))
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
    setLines(await applyDefaults(ol.map(l => l.product_id), ol.map(l => ({
      productId: l.product_id, description: l.description, quantity: String(Number(l.quantity)), unitPrice: String(Number(l.unit_price)), tvaRate: '',
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
      items: lines.map(l => ({ productId: l.productId || null, description: l.description.trim() || null, quantity: parseFloat(l.quantity), unitPrice: parseFloat(l.unitPrice), tvaRate: l.tvaRate === '' ? null : Number(l.tvaRate) })),
    }),
    onSuccess: (n) => { queryClient.invalidateQueries({ queryKey: ['delivery-notes'] }); notify.success(`Bon de livraison ${n.number} enregistré`); onClose(); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Enregistrement impossible')),
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
            Prix proposés : tarif catalogue moins la remise du client ; TVA : dernier taux utilisé pour le produit. Le BL ne touche ni à la comptabilité ni au stock vitrine : il sera facturé depuis « À facturer ».
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />} Enregistrer le bon de livraison
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
                    <td>{i.description}</td>
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
