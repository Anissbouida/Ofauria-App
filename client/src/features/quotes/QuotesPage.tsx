import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FileSignature, FileText, Send, CheckCircle2, XCircle, ShoppingCart, Plus, Search, Loader2, X, Copy, RotateCcw, Ban, Trash2, Printer, Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { quotesApi, QUOTE_STATUS_LABELS, QUOTE_STATUS_TAG, type Quote, type QuoteStatus, type QuoteInput } from '../../api/quotes.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useReferentiel } from '../../hooks/useReferentiel';
import { StagePipeline, Pager, PAGE_SIZE, type StageDef } from '../../components/purchasing/ProcessBoard';

/**
 * Devis clients (mig 365) : offre chiffrée pour un client ou un prospect, envoyée,
 * acceptée ou perdue (avec motif), puis convertie en commande. La proforma est le même
 * document titré « Facture proforma », sans effet comptable.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d10 = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
const fr = (v: string | null | undefined) => (v ? format(new Date(`${d10(v)}T00:00:00`), 'dd/MM/yyyy') : '—');
const field: React.CSSProperties = { fontSize: '0.875rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', width: '100%' };
const lab: React.CSSProperties = { display: 'grid', gap: 4, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' };
const TVA_RATES = ['', '0', '7', '10', '14', '20'];

const STAGES: Array<StageDef & { key: string }> = [
  { key: 'draft', label: 'Brouillons', hint: 'à finaliser', icon: FileText },
  { key: 'sent', label: 'Envoyés', hint: 'en attente du client', icon: Send },
  { key: 'accepted', label: 'Acceptés', hint: 'à transformer en commande', icon: CheckCircle2 },
  { key: 'converted', label: 'Commandés', hint: 'commande créée', icon: ShoppingCart },
  { key: 'lost', label: 'Perdus / expirés', hint: 'motif renseigné', icon: XCircle },
];

async function openPdf(id: string, kind: 'quote' | 'proforma') {
  try {
    const blob = await quotesApi.pdf(id, kind);
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) { notify.error(apiErrorMessage(e)); }
}

export default function QuotesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Quote | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, search]);
  const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
  if (status) params.status = status;
  if (search) params.search = search;
  const { data, isLoading } = useQuery({ queryKey: ['quotes', params], queryFn: () => quotesApi.list(params) });
  const { data: ov } = useQuery({ queryKey: ['quotes', 'overview'], queryFn: quotesApi.overview });
  const by = ov?.byStatus ?? {};
  const lost = { count: (by.refused?.count ?? 0) + (by.expired?.count ?? 0), amount: (by.refused?.amount ?? 0) + (by.expired?.amount ?? 0) };
  const open = { count: (by.draft?.count ?? 0) + (by.sent?.count ?? 0), amount: (by.draft?.amount ?? 0) + (by.sent?.amount ?? 0) };
  const kpi = (label: string, value: string, sub?: string, danger?: boolean) => (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value" style={{ color: danger ? '#dc3545' : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{sub}</div>}
    </div>
  );

  return (
    <div className="odoo-scope" style={{ display: 'grid', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}><FileSignature size={18} /> Devis</h1>
        <button className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau devis</button>
      </div>

      {ov && (
        <div className="odoo-stat-grid">
          {kpi('Devis en cours', String(open.count), `${n2(open.amount)} DH`)}
          {kpi('À relancer', String((by.sent?.expiring ?? 0) + (by.sent?.overdue ?? 0)), 'validité proche ou dépassée', (by.sent?.overdue ?? 0) > 0)}
          {kpi('Acceptés à commander', String(by.accepted?.count ?? 0), `${n2(by.accepted?.amount)} DH`)}
          {kpi('Taux de transformation', ov.conversion.rate != null ? `${ov.conversion.rate} %` : '—', `90 j : ${ov.conversion.won} gagné(s), ${ov.conversion.lost} perdu(s)`)}
          {kpi('Montant perdu (90 j)', `${n2(ov.conversion.lostAmount)} DH`, ov.lostByReason[0] ? `1er motif : ${ov.lostByReason[0].label}` : undefined)}
        </div>
      )}

      <StagePipeline title="Où en sont mes devis" summary={`${open.count} en cours · ${lost.count} perdu(s) ou expiré(s)`}
        stages={STAGES}
        stats={{
          draft: { count: by.draft?.count ?? 0, sub: `${n2(by.draft?.amount)} DH` },
          sent: { count: by.sent?.count ?? 0, sub: `${n2(by.sent?.amount)} DH`, late: by.sent?.overdue ?? 0, alertLabel: 'validité dépassée' },
          accepted: { count: by.accepted?.count ?? 0, sub: `${n2(by.accepted?.amount)} DH` },
          converted: { count: by.converted?.count ?? 0, sub: `${n2(by.converted?.amount)} DH` },
          lost: { count: lost.count, sub: `${n2(lost.amount)} DH` },
        }}
        isActive={k => status === k} onPick={k => setStatus(status === k ? '' : k)} />

      <div className="odoo-search-panel" style={{ margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <input className="odoo-search-input" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="N°, objet, client, prospect…" />
        <select className="odoo-filter-dropdown" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="open">En cours (brouillon ou envoyé)</option>
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(k => <option key={k} value={k}>{QUOTE_STATUS_LABELS[k]}</option>)}
        </select>
      </div>

      {isLoading ? <Loader2 className="animate-spin" size={18} /> : !data?.data.length ? (
        <StatusBanner tone="info" icon={FileSignature} title="Aucun devis">
          Un devis chiffre une offre pour un client ou un prospect. Une fois accepté, il devient une commande en un clic.
        </StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Client</th><th>Objet</th><th>Date</th><th>Valable jusqu'au</th><th>Statut</th><th style={{ textAlign: 'right' }}>Total</th><th>Commande</th></tr></thead>
            <tbody>{data.data.map(q => (
              <tr key={q.id} onClick={() => setOpenId(q.id)} style={{ cursor: 'pointer' }}>
                <td className="font-mono" style={{ whiteSpace: 'nowrap' }}>{q.number}</td>
                <td>{q.client_label}{!q.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}</td>
                <td>{q.title || <span style={{ color: 'var(--theme-text-muted)' }}>{q.item_count} article(s)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fr(q.quote_date)}</td>
                <td style={{ whiteSpace: 'nowrap', color: q.is_overdue ? '#dc3545' : q.expires_soon ? '#b85d1a' : undefined }}>
                  {fr(q.valid_until)}{q.is_overdue && ' · dépassée'}
                </td>
                <td><span className={`odoo-tag ${QUOTE_STATUS_TAG[q.status]}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
                  {q.lost_reason_label && <div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{q.lost_reason_label}</div>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{n2(q.total)} DH<div style={{ fontSize: '0.7rem', color: 'var(--theme-text-muted)' }}>{q.with_tax ? 'TTC (HT + TVA)' : 'TTC'}</div></td>
                <td className="font-mono">{q.order_number ?? ''}</td>
              </tr>
            ))}</tbody>
          </table>
          <Pager page={page} total={data.total} onPage={setPage} note={`${data.total} devis`} />
        </div>
      )}

      {editing && <QuoteFormModal quote={editing === 'new' ? null : editing} validityDays={ov?.validityDays ?? 30}
        onClose={() => setEditing(null)}
        onSaved={q => { qc.invalidateQueries({ queryKey: ['quotes'] }); setEditing(null); setOpenId(q.id); }} />}
      {openId && !editing && <QuoteDetailModal id={openId} onClose={() => setOpenId(null)} onEdit={q => setEditing(q)} onOpen={setOpenId} />}
    </div>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────────── */
type Line = { productId: string; quantity: string; unitPrice: string; tvaRate: string; description: string };
const emptyLine = (): Line => ({ productId: '', quantity: '1', unitPrice: '', tvaRate: '', description: '' });
const today = () => format(new Date(), 'yyyy-MM-dd');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return format(d, 'yyyy-MM-dd'); };

function QuoteFormModal({ quote, validityDays, onClose, onSaved }: { quote: Quote | null; validityDays: number; onClose: () => void; onSaved: (q: Quote) => void }) {
  const [mode, setMode] = useState<'customer' | 'prospect'>(quote && !quote.customer_id ? 'prospect' : 'customer');
  const [customerId, setCustomerId] = useState(quote?.customer_id ?? '');
  const [prospect, setProspect] = useState({ name: quote?.prospect_name ?? '', company: quote?.prospect_company ?? '', phone: quote?.prospect_phone ?? '', email: quote?.prospect_email ?? '' });
  const [head, setHead] = useState({
    title: quote?.title ?? '', quoteDate: d10(quote?.quote_date) || today(), validUntil: d10(quote?.valid_until) || addDays(today(), validityDays),
    discountPct: quote ? String(Number(quote.discount_pct)) : '0', deliveryTerms: quote?.delivery_terms ?? '', notes: quote?.notes ?? '', internalNotes: quote?.internal_notes ?? '',
    withTax: quote?.with_tax ?? false,
  });
  const [lines, setLines] = useState<Line[]>(() => quote?.items?.length
    ? quote.items.map(i => ({ productId: i.product_id, quantity: String(i.quantity), unitPrice: String(Number(i.unit_price)), tvaRate: i.tva_rate != null ? String(Number(i.tva_rate)) : '', description: i.description ?? '' }))
    : [emptyLine()]);

  const { data: customersResp } = useQuery({ queryKey: ['customers', 'all-for-quotes'], queryFn: () => customersApi.list({ limit: '500' }) });
  const customers = ((customersResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const customerOptions = useMemo(() => customers.map(c => ({
    id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '),
    sublabel: (c.customer_type ?? 'particulier') !== 'particulier' ? 'Professionnel · HT + TVA' : 'Particulier · TTC',
  })).sort((a, b) => a.label.localeCompare(b.label)), [customers]);
  const customer = customers.find(c => String(c.id) === customerId);
  const isPro = !!customer && (customer.customer_type ?? 'particulier') !== 'particulier';
  const withTax = mode === 'customer' ? isPro : head.withTax;

  const { data: productsResp } = useQuery({ queryKey: ['products-quotes'], queryFn: () => productsApi.list({ limit: '1000' }) });
  const products = ((productsResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name), detail: p.price ? `${n2(p.price)} DH` : undefined })), [products]);

  const setLine = (i: number, patch: Partial<Line>) => setLines(prev => prev.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pickProduct = async (i: number, productId: string) => {
    const p = products.find(x => String(x.id) === productId);
    let unitPrice = p?.price != null ? String(Number(p.price)) : '';
    let tvaRate = lines[i].tvaRate;
    if (mode === 'customer' && isPro && customerId) {
      try {
        const d = await deliveryNotesApi.lineDefaults(customerId, [productId]);
        if (d[productId]) { unitPrice = String(d[productId].unitPrice); tvaRate = d[productId].tvaRate != null ? String(d[productId].tvaRate) : tvaRate; }
      } catch { /* prix catalogue */ }
    }
    setLine(i, { productId, unitPrice, tvaRate });
  };

  const valid = lines.filter(l => l.productId && Number(l.quantity) > 0);
  const subtotal = valid.reduce((s, l) => s + Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * 100) / 100, 0);
  const pct = Math.min(100, Math.max(0, Number(head.discountPct) || 0));
  const discount = Math.round(subtotal * pct) / 100;
  const ratio = subtotal > 0 ? 1 - discount / subtotal : 1;
  const tax = withTax ? valid.reduce((s, l) => s + (Number(l.tvaRate) ? Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * ratio * Number(l.tvaRate)) / 100 : 0), 0) : 0;
  const total = subtotal - discount + tax;

  const save = useMutation({
    mutationFn: () => {
      const payload: QuoteInput = {
        customerId: mode === 'customer' ? customerId || null : null,
        prospectName: mode === 'prospect' ? prospect.name || null : null, prospectCompany: mode === 'prospect' ? prospect.company || null : null,
        prospectPhone: mode === 'prospect' ? prospect.phone || null : null, prospectEmail: mode === 'prospect' ? prospect.email || null : null,
        title: head.title || null, quoteDate: head.quoteDate, validUntil: head.validUntil, withTax: mode === 'prospect' ? head.withTax : undefined,
        discountPct: pct, deliveryTerms: head.deliveryTerms || null, notes: head.notes || null, internalNotes: head.internalNotes || null,
        items: valid.map(l => ({ productId: l.productId, quantity: Math.round(Number(l.quantity)), unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice),
          tvaRate: withTax && l.tvaRate !== '' ? Number(l.tvaRate) : null, description: l.description || null })),
      };
      return quote ? quotesApi.update(quote.id, payload) : quotesApi.create(payload);
    },
    onSuccess: q => { notify.success(quote ? 'Devis enregistré' : `Devis ${q.number} créé`); onSaved(q); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const canSave = (mode === 'customer' ? !!customerId : !!(prospect.name.trim() || prospect.company.trim())) && valid.length > 0 && head.validUntil >= head.quoteDate;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1000, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">{quote ? `Modifier le devis ${quote.number}` : 'Nouveau devis'}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['customer', 'prospect'] as const).map(m => (
              <button key={m} type="button" className={mode === m ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode(m)}>
                {m === 'customer' ? 'Client existant' : 'Prospect (sans fiche)'}
              </button>
            ))}
          </div>
          {mode === 'customer' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, alignItems: 'end' }}>
              <label style={lab}>Client<SearchSelect options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="Rechercher un client…" width="100%" size="md" /></label>
              <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)', paddingBottom: 6 }}>
                {customer ? (isPro ? 'Professionnel : prix HT, TVA par ligne, remise client appliquée' : 'Particulier : prix TTC') : ''}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label style={lab}>Nom du contact<input style={field} maxLength={160} value={prospect.name} onChange={e => setProspect({ ...prospect, name: e.target.value })} /></label>
              <label style={lab}>Société<input style={field} maxLength={200} value={prospect.company} onChange={e => setProspect({ ...prospect, company: e.target.value })} /></label>
              <label style={lab}>Téléphone<input style={field} maxLength={30} value={prospect.phone} onChange={e => setProspect({ ...prospect, phone: e.target.value })} /></label>
              <label style={lab}>E-mail<input style={field} type="email" maxLength={255} value={prospect.email} onChange={e => setProspect({ ...prospect, email: e.target.value })} /></label>
              <label style={{ ...lab, gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={head.withTax} onChange={e => setHead({ ...head, withTax: e.target.checked })} />
                Prix HT avec TVA par ligne (prospect professionnel) — sinon prix TTC
              </label>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label style={lab}>Objet<input style={field} maxLength={200} value={head.title} onChange={e => setHead({ ...head, title: e.target.value })} placeholder="Ex. : buffet mariage 120 personnes" /></label>
            <label style={lab}>Date du devis<input style={field} type="date" value={head.quoteDate} onChange={e => setHead({ ...head, quoteDate: e.target.value })} /></label>
            <label style={lab}>Valable jusqu'au<input style={field} type="date" value={head.validUntil} min={head.quoteDate} onChange={e => setHead({ ...head, validUntil: e.target.value })} /></label>
            <label style={lab}>Remise globale (%)<input style={field} type="number" min={0} max={100} step="0.5" value={head.discountPct} onChange={e => setHead({ ...head, discountPct: e.target.value })} /></label>
          </div>

          <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table" style={{ minWidth: 720 }}>
            <thead><tr><th>Article</th><th>Précision</th><th style={{ width: 90 }}>Qté</th><th style={{ width: 130 }}>Prix unit. {withTax ? 'HT' : 'TTC'}</th>{withTax && <th style={{ width: 90 }}>TVA %</th>}<th style={{ textAlign: 'right', width: 120 }}>Montant</th><th style={{ width: 36 }}></th></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 220 }}><SearchSelect options={productOptions} value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Choisir un article…" width="100%" size="md" /></td>
                <td><input style={field} maxLength={300} value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Parfum, inscription, format…" /></td>
                <td><input style={field} type="number" min={1} step={1} value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                <td><input style={field} type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></td>
                {withTax && <td><select style={field} value={l.tvaRate} onChange={e => setLine(i, { tvaRate: e.target.value })}>{TVA_RATES.map(r => <option key={r} value={r}>{r === '' ? '—' : `${r} %`}</option>)}</select></td>}
                <td style={{ textAlign: 'right' }}>{l.productId ? n2(Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * 100) / 100) : ''}</td>
                <td><button type="button" className="odoo-pager-btn" aria-label="Retirer la ligne" onClick={() => setLines(lines.length > 1 ? lines.filter((_, k) => k !== i) : [emptyLine()])}><Trash2 size={13} /></button></td>
              </tr>
            ))}</tbody>
          </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, emptyLine()])} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Ajouter une ligne</button>
            <table style={{ fontSize: '0.875rem', minWidth: 280 }}>
              <tbody>
                <tr><td>Sous-total {withTax ? 'HT' : 'TTC'}</td><td style={{ textAlign: 'right' }}>{n2(subtotal)} DH</td></tr>
                {pct > 0 && <tr><td>Remise {pct} %</td><td style={{ textAlign: 'right' }}>−{n2(discount)} DH</td></tr>}
                {withTax && <tr><td>TVA</td><td style={{ textAlign: 'right' }}>{n2(tax)} DH</td></tr>}
                <tr style={{ fontWeight: 700 }}><td>Total TTC</td><td style={{ textAlign: 'right' }}>{n2(total)} DH</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <label style={lab}>Livraison / délai (imprimé)<input style={field} maxLength={300} value={head.deliveryTerms} onChange={e => setHead({ ...head, deliveryTerms: e.target.value })} placeholder="Ex. : livraison sur site le jour J, 9 h" /></label>
            <label style={lab}>Conditions particulières (imprimé)<input style={field} maxLength={2000} value={head.notes} onChange={e => setHead({ ...head, notes: e.target.value })} placeholder="Ex. : acompte de 30 % à la commande" /></label>
            <label style={{ ...lab, gridColumn: '1 / -1' }}>Note interne (non imprimée)<textarea style={{ ...field, minHeight: 50 }} maxLength={2000} value={head.internalNotes} onChange={e => setHead({ ...head, internalNotes: e.target.value })} /></label>
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', justifyContent: 'flex-end', gap: 8, position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
          <button className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button className="odoo-btn-primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Enregistrer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ─── Fiche ───────────────────────────────────────────────────────────────── */
const EVENT_LABEL = (e: { event_type: string; from_value: string | null; to_value: string | null }) => {
  if (e.event_type === 'created') return 'Devis créé';
  if (e.event_type === 'edited') return 'Devis modifié';
  if (e.event_type === 'duplicated') return `Copie du devis ${e.from_value}`;
  if (e.event_type === 'status') return `${QUOTE_STATUS_LABELS[e.from_value as QuoteStatus] ?? e.from_value} → ${QUOTE_STATUS_LABELS[e.to_value as QuoteStatus] ?? e.to_value}`;
  return e.event_type;
};

function QuoteDetailModal({ id, onClose, onEdit, onOpen }: { id: string; onClose: () => void; onEdit: (q: Quote) => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data: q, isLoading } = useQuery({ queryKey: ['quote', id], queryFn: () => quotesApi.get(id) });
  const { entries: reasons } = useReferentiel('quote_lost_reasons');
  const [losing, setLosing] = useState<{ reasonCode: string; note: string } | null>(null);
  const [converting, setConverting] = useState<{ pickupDate: string; customerId: string } | null>(null);
  const { data: customersResp } = useQuery({ queryKey: ['customers', 'all-for-quotes'], queryFn: () => customersApi.list({ limit: '500' }), enabled: !!converting && !q?.customer_id });
  const customers = ((customersResp as { data?: Record<string, any>[] } | undefined)?.data ?? []) as Record<string, any>[];
  const refresh = () => { qc.invalidateQueries({ queryKey: ['quotes'] }); qc.invalidateQueries({ queryKey: ['quote', id] }); };

  const act = useMutation({
    mutationFn: (p: { action: 'send' | 'accept' | 'refuse' | 'reopen' | 'cancel'; reasonCode?: string; note?: string }) => quotesApi.action(id, p.action, { reasonCode: p.reasonCode, note: p.note }),
    onSuccess: () => { refresh(); setLosing(null); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const dup = useMutation({
    mutationFn: () => quotesApi.duplicate(id),
    onSuccess: n => { refresh(); notify.success(`Copie ${n.number} créée`); onOpen(n.id); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const convert = useMutation({
    mutationFn: () => quotesApi.convert(id, { pickupDate: converting!.pickupDate, customerId: converting!.customerId || null }),
    onSuccess: r => {
      refresh(); setConverting(null);
      notify.success(`Commande ${r.order.orderNumber} créée`);
      if (r.creditWarning) notify.error(r.creditWarning.message);
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 960, maxHeight: '92vh', overflowY: 'auto', background: 'var(--theme-bg-card)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        {isLoading || !q ? <div style={{ padding: 24 }}><Loader2 className="animate-spin" size={18} /></div> : (<>
          <div className="odoo-control-bar" style={{ position: 'sticky', top: 0, zIndex: 1, flexWrap: 'wrap', gap: 6 }}>
            <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Devis {q.number}</span></div>
            <span className={`odoo-tag ${QUOTE_STATUS_TAG[q.status]}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
            <div style={{ flex: 1 }} />
            <button className="odoo-btn-secondary" onClick={() => openPdf(q.id, 'quote')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Printer size={13} /> Devis PDF</button>
            <button className="odoo-btn-secondary" onClick={() => openPdf(q.id, 'proforma')} title={q.proforma_number ? `Proforma ${q.proforma_number}` : 'Attribue un numéro de proforma à la première édition'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={13} /> Proforma</button>
            <button type="button" onClick={onClose} className="odoo-btn-secondary" aria-label="Fermer"><X size={14} /></button>
          </div>
          <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
            {/* Prochaine étape */}
            {q.status === 'draft' && <StatusBanner tone="info" icon={Send} title="Prochaine étape : envoyer le devis au client"
              actions={<>
                <button className="odoo-btn-secondary" onClick={() => onEdit(q)}>Modifier</button>
                <button className="odoo-btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'send' })}><Send size={13} /> Marquer envoyé</button>
              </>}>Imprimez le PDF ou la proforma, envoyez-le, puis marquez-le envoyé : la validité est suivie et l'expiration signalée.</StatusBanner>}
            {q.status === 'sent' && <StatusBanner tone={q.is_overdue ? 'warning' : 'info'} icon={Clock}
              title={q.is_overdue ? 'Validité dépassée : relancer ou classer' : `En attente de la réponse du client (jusqu'au ${fr(q.valid_until)})`}
              actions={<>
                <button className="odoo-btn-secondary" onClick={() => setLosing({ reasonCode: '', note: '' })}><XCircle size={13} /> Perdu</button>
                <button className="odoo-btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'accept' })}><CheckCircle2 size={13} /> Accepté</button>
              </>}>Une fois le bon pour accord reçu, marquez le devis accepté puis transformez-le en commande.</StatusBanner>}
            {(q.status === 'accepted') && <StatusBanner tone="success" icon={ShoppingCart} title="Accepté : transformer en commande"
              actions={<button className="odoo-btn-primary" onClick={() => setConverting({ pickupDate: '', customerId: '' })}><ShoppingCart size={13} /> Créer la commande</button>}>
              La commande reprend les prix, la remise et les lignes du devis ; elle suit ensuite son cycle habituel (production, livraison, facture).</StatusBanner>}
            {q.status === 'converted' && <StatusBanner tone="success" icon={ShoppingCart} title={`Commande ${q.order_number} créée`}
              actions={<button className="odoo-btn-secondary" onClick={() => navigate('/orders')}>Voir les commandes</button>}>Le devis est clos.</StatusBanner>}
            {(q.status === 'refused' || q.status === 'expired') && <StatusBanner tone="warning" icon={XCircle} title={`${QUOTE_STATUS_LABELS[q.status]}${q.lost_reason_label ? ` · ${q.lost_reason_label}` : ''}`}
              actions={<>
                <button className="odoo-btn-secondary" onClick={() => setLosing({ reasonCode: q.lost_reason_code ?? '', note: q.lost_note ?? '' })} hidden={q.status !== 'expired'}>Classer perdu</button>
                <button className="odoo-btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'reopen' })}><RotateCcw size={13} /> Rouvrir</button>
                <button className="odoo-btn-primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'accept' })}><CheckCircle2 size={13} /> Accepté finalement</button>
              </>}>{q.lost_note || 'Le motif alimente l\'analyse des devis perdus.'}</StatusBanner>}

            {losing && (
              <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--odoo-bg-alt)' }}>
                <label style={{ ...lab, width: 240 }}>Motif de la perte<select style={field} value={losing.reasonCode} onChange={e => setLosing({ ...losing, reasonCode: e.target.value })}>
                  <option value="">Choisir…</option>{reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
                <label style={{ ...lab, flex: '1 1 240px' }}>Précision<input style={field} maxLength={1000} value={losing.note} onChange={e => setLosing({ ...losing, note: e.target.value })} placeholder="Ex. : concurrent 15 % moins cher" /></label>
                <button className="odoo-btn-secondary" onClick={() => setLosing(null)}>Annuler</button>
                <button className="odoo-btn-primary" disabled={!losing.reasonCode || act.isPending} onClick={() => act.mutate({ action: 'refuse', reasonCode: losing.reasonCode, note: losing.note })}>Classer perdu</button>
              </div>
            )}
            {converting && (
              <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--odoo-bg-alt)' }}>
                <label style={{ ...lab, width: 240 }}>Livraison ou retrait le<input style={field} type="datetime-local" value={converting.pickupDate} onChange={e => setConverting({ ...converting, pickupDate: e.target.value })} /></label>
                {!q.customer_id && (
                  <label style={{ ...lab, flex: '1 1 260px' }}>Client (facultatif)
                    <SearchSelect value={converting.customerId} onChange={v => setConverting({ ...converting, customerId: v })} width="100%" size="md"
                      placeholder={`Sinon : commande au nom de « ${q.prospect_company || q.prospect_name} »`}
                      options={customers.map(c => ({ id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '), sublabel: (c.customer_type ?? 'particulier') !== 'particulier' ? 'Professionnel' : 'Particulier' }))} />
                  </label>
                )}
                <button className="odoo-btn-secondary" onClick={() => setConverting(null)}>Annuler</button>
                <button className="odoo-btn-primary" disabled={!converting.pickupDate || convert.isPending}
                  onClick={async () => { if (await confirm(`Créer la commande depuis le devis ${q.number} (${n2(q.total)} DH) ?`)) convert.mutate(); }}>
                  {convert.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShoppingCart size={13} />} Créer la commande
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, fontSize: '0.875rem' }}>
              <div><div style={lab}>Client</div><strong>{q.client_label}</strong>{!q.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}
                <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{[q.customer_phone ?? q.prospect_phone, q.customer_email ?? q.prospect_email].filter(Boolean).join(' · ')}</div></div>
              <div><div style={lab}>Objet</div>{q.title || '—'}</div>
              <div><div style={lab}>Date · validité</div>{fr(q.quote_date)} → <span style={{ color: q.is_overdue ? '#dc3545' : undefined }}>{fr(q.valid_until)}</span></div>
              <div><div style={lab}>Proforma</div>{q.proforma_number ?? '—'}</div>
            </div>

            <table className="odoo-table">
              <thead><tr><th>Article</th><th style={{ textAlign: 'right' }}>Qté</th><th style={{ textAlign: 'right' }}>Prix unit. {q.with_tax ? 'HT' : 'TTC'}</th>{q.with_tax && <th style={{ textAlign: 'right' }}>TVA</th>}<th style={{ textAlign: 'right' }}>Montant</th></tr></thead>
              <tbody>{(q.items ?? []).map(i => (
                <tr key={i.id}>
                  <td>{i.product_name}{i.description && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{i.description}</div>}</td>
                  <td style={{ textAlign: 'right' }}>{i.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{n2(i.unit_price)}</td>
                  {q.with_tax && <td style={{ textAlign: 'right' }}>{i.tva_rate != null ? `${Number(i.tva_rate)} %` : '—'}</td>}
                  <td style={{ textAlign: 'right' }}>{n2(i.subtotal)}</td>
                </tr>
              ))}</tbody>
              <tfoot>
                <tr><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Sous-total {q.with_tax ? 'HT' : 'TTC'}</td><td style={{ textAlign: 'right' }}>{n2(q.subtotal)}</td></tr>
                {Number(q.discount_pct) > 0 && <tr><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Remise {Number(q.discount_pct)} %</td><td style={{ textAlign: 'right' }}>−{n2(q.discount_amount)}</td></tr>}
                {q.with_tax && <tr><td colSpan={4} style={{ textAlign: 'right' }}>TVA</td><td style={{ textAlign: 'right' }}>{n2(q.tax_amount)}</td></tr>}
                <tr style={{ fontWeight: 700 }}><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Total TTC</td><td style={{ textAlign: 'right' }}>{n2(q.total)} DH</td></tr>
              </tfoot>
            </table>
            {(q.delivery_terms || q.notes || q.internal_notes) && (
              <div style={{ fontSize: '0.8125rem', display: 'grid', gap: 4 }}>
                {q.delivery_terms && <div><strong>Livraison :</strong> {q.delivery_terms}</div>}
                {q.notes && <div><strong>Conditions :</strong> {q.notes}</div>}
                {q.internal_notes && <div style={{ color: 'var(--theme-text-muted)' }}><strong>Note interne :</strong> {q.internal_notes}</div>}
              </div>
            )}

            <div>
              <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Historique</div>
              <ul className="ui-timeline" style={{ margin: 0 }}>
                {(q.events ?? []).map(e => (
                  <li key={e.id} style={{ fontSize: '0.8125rem' }}>
                    <strong>{EVENT_LABEL(e)}</strong> <span style={{ color: 'var(--theme-text-muted)' }}>· {format(new Date(e.created_at), 'dd/MM/yyyy HH:mm')}{e.by_name ? ` · ${e.by_name}` : ''}</span>
                    {e.note && e.event_type !== 'edited' && <div style={{ color: 'var(--theme-text-muted)' }}>{reasons.find(r => r.code === e.note)?.label ?? e.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--odoo-border)', display: 'flex', gap: 8, flexWrap: 'wrap', position: 'sticky', bottom: 0, background: 'var(--theme-bg-card)' }}>
            {(q.status === 'draft' || q.status === 'sent') && <button className="odoo-btn-secondary" onClick={() => onEdit(q)}>Modifier</button>}
            <button className="odoo-btn-secondary" disabled={dup.isPending} onClick={() => dup.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Copy size={13} /> Dupliquer</button>
            <div style={{ flex: 1 }} />
            {['draft', 'sent', 'accepted'].includes(q.status) && (
              <button className="odoo-btn-secondary" disabled={act.isPending} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={async () => { if (await confirm(`Annuler le devis ${q.number} ?`)) act.mutate({ action: 'cancel' }); }}><Ban size={13} /> Annuler le devis</button>
            )}
            {q.status === 'cancelled' && <button className="odoo-btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'reopen' })}><RotateCcw size={13} /> Rouvrir</button>}
          </div>
        </>)}
      </div>
    </ModalBackdrop>
  );
}
