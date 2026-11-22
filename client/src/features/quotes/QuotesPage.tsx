import { money, currencySymbol } from '../../utils/money';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileSignature, FileText, Send, CheckCircle2, XCircle, ShoppingCart, Plus, Copy, RotateCcw, Ban, Trash2, Printer, Clock, Pencil,
  type LucideIcon,
} from 'lucide-react';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { format } from 'date-fns';
import { quotesApi, QUOTE_STATUS_LABELS, type Quote, type QuoteStatus, type QuoteInput } from '../../api/quotes.api';
import { customersApi } from '../../api/customers.api';
import { productsApi } from '../../api/products.api';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import { apiErrorMessage } from '../../api/errors';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import SearchSelect from '../../components/ui/SearchSelect';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useReferentiel } from '../../hooks/useReferentiel';
import { crmApi, type Opportunity } from '../../api/crm.api';
import { PAGE_SIZE } from '../../components/purchasing/ProcessBoard';
import { TableFooter, EmptyState, NoResultState, LoadingState, ErrorState, Modal, FormField, FormSection, FormFooter, DataPanel } from '../../components/ds';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { ListToolbar, FilterChips, ListKpi, ListPanel, NextStep } from '../sales/ListTemplate';
import SalesPageShell from '../sales/SalesPageShell';

/**
 * Devis clients (mig 365) : offre chiffrée pour un client ou un prospect, envoyée,
 * acceptée ou perdue (avec motif), puis convertie en commande. La proforma est le même
 * document titré « Facture proforma », sans effet comptable.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d10 = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
const fr = (v: string | null | undefined) => (v ? format(new Date(`${d10(v)}T00:00:00`), 'dd/MM/yyyy') : '—');
const lab: React.CSSProperties = { fontSize: '13px', color: 'var(--ds-muted)' };
const TVA_RATES = ['', '0', '7', '10', '14', '20'];
/** Statut d'un devis en étiquette commune (perdu = clos sans suite, expiré = échéance dépassée). */
export const QUOTE_TONE: Record<QuoteStatus, { tone: StatusTone; icon?: LucideIcon }> = {
  draft: { tone: 'draft' }, sent: { tone: 'progress', icon: Send }, accepted: { tone: 'done' },
  refused: { tone: 'cancelled', icon: XCircle }, expired: { tone: 'late' }, converted: { tone: 'done', icon: ShoppingCart }, cancelled: { tone: 'cancelled' },
};
export function QuoteStatusTag({ status }: { status: QuoteStatus }) {
  const t = QUOTE_TONE[status] ?? { tone: 'draft' as StatusTone };
  return <StatusTag tone={t.tone} icon={t.icon} label={QUOTE_STATUS_LABELS[status] ?? status} />;
}


async function openPdf(id: string, kind: 'quote' | 'proforma') {
  try {
    const blob = await quotesApi.pdf(id, kind);
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) { notify.error(apiErrorMessage(e)); }
}

export default function QuotesPage() {
  const qc = useQueryClient();
  // ?status=follow|open : liens du tableau de bord Ventes.
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get('status') ?? '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Quote | 'new' | null>(null);
  // ?open=<id> : pièce liée ouverte depuis la fiche commande.
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('open'));
  // « Créer un devis » depuis une opportunité du CRM : /quotes?opportunity=<id> ouvre la saisie préremplie.
  const [urlParams, setUrlParams] = useSearchParams();
  const opportunityId = urlParams.get('opportunity');
  const { data: fromOpp } = useQuery({ queryKey: ['crm', 'opp', opportunityId], queryFn: () => crmApi.get(opportunityId!), enabled: !!opportunityId });
  useEffect(() => { if (fromOpp) setEditing('new'); }, [fromOpp]);
  const closeForm = () => { setEditing(null); if (opportunityId) { urlParams.delete('opportunity'); setUrlParams(urlParams, { replace: true }); } };
  useEffect(() => { const t = setTimeout(() => setSearch(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  useEffect(() => { setPage(1); }, [status, search]);
  const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
  if (status) params.status = status;
  if (search) params.search = search;
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['quotes', params], queryFn: () => quotesApi.list(params) });
  const { data: ov } = useQuery({ queryKey: ['quotes', 'overview'], queryFn: quotesApi.overview });
  const by = ov?.byStatus ?? {};
  const lost = { count: (by.refused?.count ?? 0) + (by.expired?.count ?? 0), amount: (by.refused?.amount ?? 0) + (by.expired?.amount ?? 0) };
  const open = { count: (by.draft?.count ?? 0) + (by.sent?.count ?? 0), amount: (by.draft?.amount ?? 0) + (by.sent?.amount ?? 0) };
  const follow = (by.sent?.expiring ?? 0) + (by.sent?.overdue ?? 0);
  const allCount = Object.values(by).reduce((s, x) => s + x.count, 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['quotes'] }); qc.invalidateQueries({ queryKey: ['crm'] }); };
  const quickAct = useMutation({
    mutationFn: (p: { id: string; action: 'send' | 'accept' }) => quotesApi.action(p.id, p.action),
    onSuccess: (q, p) => { refresh(); notify.success(p.action === 'send' ? `Devis ${q.number} marqué envoyé` : `Devis ${q.number} accepté`); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => quotesApi.duplicate(id),
    onSuccess: q => { refresh(); notify.success(`Copie ${q.number} créée`); setOpenId(q.id); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  // La ligne de liste n'a pas les articles : la saisie repart de la fiche complète.
  const editQuote = async (id: string) => {
    try { setEditing(await quotesApi.get(id)); } catch (e) { notify.error(apiErrorMessage(e)); }
  };
  const nextStep = (q: Quote) => {
    if (q.status === 'draft') return <NextStep icon={Send} label="Marquer envoyé" disabled={quickAct.isPending} onClick={() => quickAct.mutate({ id: q.id, action: 'send' })} />;
    if (q.status === 'sent') return <NextStep icon={CheckCircle2} label="Accepté" disabled={quickAct.isPending} onClick={() => quickAct.mutate({ id: q.id, action: 'accept' })} />;
    if (q.status === 'accepted') return <NextStep icon={ShoppingCart} label="Créer la commande" onClick={() => setOpenId(q.id)} />;
    return null;
  };
  const menuItems = (q: Quote): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ label: 'Voir le détail', icon: FileText, onSelect: () => setOpenId(q.id) }];
    if (q.status === 'draft' || q.status === 'sent') items.push({ label: 'Modifier', icon: Pencil, onSelect: () => editQuote(q.id) });
    items.push({ label: 'Devis PDF', icon: Printer, onSelect: () => openPdf(q.id, 'quote') });
    items.push({ label: 'Proforma', icon: FileText, onSelect: () => openPdf(q.id, 'proforma') });
    items.push({ label: 'Dupliquer', icon: Copy, disabled: duplicate.isPending, onSelect: () => duplicate.mutate(q.id) });
    if (q.status === 'sent') items.push({ label: 'Classer perdu…', icon: XCircle, onSelect: () => setOpenId(q.id) });
    return items;
  };

  return (
    <SalesPageShell icon={FileSignature} parent="Ventes" title="Devis" list
      summary={ov ? `${open.count} en cours · ${money(open.amount)}` : undefined}
      actions={
        <button className="odoo-btn-primary" onClick={() => setEditing('new')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Nouveau devis</button>
      }>

      {ov && (
        <section className="prj-kpis" aria-label="Indicateurs">
          <ListKpi label="Devis en cours" value={String(open.count)} sub={`${money(open.amount)}`} />
          <ListKpi label="Acceptés à commander" value={String(by.accepted?.count ?? 0)} sub={`${money(by.accepted?.amount ?? 0)}`} />
          <ListKpi label="Taux de transformation" value={ov.conversion.rate != null ? `${ov.conversion.rate} %` : '—'} sub={`90 j : ${ov.conversion.won} gagné(s), ${ov.conversion.lost} perdu(s)`} />
          <ListKpi label="Montant perdu (90 j)" value={`${money(ov.conversion.lostAmount)}`} sub={ov.lostByReason[0] ? `1er motif : ${ov.lostByReason[0].label}` : undefined} />
        </section>
      )}

      <FilterChips label="Filtrer par étape" value={status} onChange={setStatus} chips={[
        { key: '', label: 'Tous', count: allCount },
        ...(follow ? [{ key: 'follow', label: 'À relancer', count: follow, tone: 'late' as const, icon: Clock }] : []),
        { key: 'open', label: 'En cours', count: open.count },
        { key: 'draft', label: 'Brouillons', count: by.draft?.count ?? 0 },
        { key: 'sent', label: 'Envoyés', count: by.sent?.count ?? 0 },
        { key: 'accepted', label: 'Acceptés', count: by.accepted?.count ?? 0 },
        { key: 'converted', label: 'Commandés', count: by.converted?.count ?? 0 },
        { key: 'lost', label: 'Perdus ou expirés', count: lost.count },
        { key: 'cancelled', label: 'Annulés', count: by.cancelled?.count ?? 0 },
      ]} />

      <ListToolbar search={searchInput} onSearch={setSearchInput} placeholder="N°, objet, client, prospect…" />

      {isLoading ? <LoadingState label="Chargement des devis…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !data?.data.length ? (
        status || search
          ? <NoResultState onReset={() => { setStatus(''); setSearchInput(''); }} text="Aucun devis ne correspond aux filtres." />
          : <EmptyState icon={FileSignature} title="Aucun devis"
              text="Un devis chiffre une offre pour un client ou un prospect. Une fois accepté, il devient une commande en un clic."
              action={<button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setEditing('new')}><Plus size={13} /> Nouveau devis</button>} />
      ) : (
        <ListPanel footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} note="devis" />}>
          <table className="odoo-table">
            <thead><tr><th>N°</th><th>Client</th><th>Objet</th><th>Date</th><th>Valable jusqu'au</th><th>Statut</th><th className="ds-num">Total TTC ({currencySymbol()})</th><th className="ds-actions">Actions</th></tr></thead>
            <tbody>{data.data.map(q => (
              <tr key={q.id} onClick={() => setOpenId(q.id)}>
                <td style={{ whiteSpace: 'nowrap' }}><span className="ds-ref">{q.number}</span></td>
                <td>
                  <span className="ds-strong">{q.client_label}</span>
                  <span className="sal-sub">{q.customer_id ? (q.with_tax ? 'Professionnel' : 'Client') : 'Prospect'}</span>
                </td>
                <td>{q.title || <span style={{ color: 'var(--ds-muted)' }}>{q.item_count} article(s)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fr(q.quote_date)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fr(q.valid_until)}
                  {q.is_overdue && <span className="sal-late-txt">validité dépassée</span>}
                  {!q.is_overdue && q.expires_soon && <span className="sal-sub" style={{ color: 'var(--ds-warning)', fontWeight: 600 }}>expire bientôt</span>}
                </td>
                <td>
                  <QuoteStatusTag status={q.status} />
                  {q.lost_reason_label && <span className="sal-sub">{q.lost_reason_label}</span>}
                  {q.order_number && <span className="sal-sub sal-mono">{q.order_number}</span>}
                </td>
                <td className="ds-num" style={{ whiteSpace: 'nowrap' }}>
                  <span className="ds-strong">{n2(q.total)}</span>
                  {q.with_tax && <span className="sal-sub">HT + TVA</span>}
                </td>
                <td className="ds-actions" onClick={e => e.stopPropagation()}>{nextStep(q)}<RowMenu items={menuItems(q)} /></td>
              </tr>
            ))}</tbody>
          </table>
        </ListPanel>
      )}

      {editing && <QuoteFormModal quote={editing === 'new' ? null : editing} validityDays={ov?.validityDays ?? 30}
        opportunity={editing === 'new' ? fromOpp ?? null : null}
        onClose={closeForm}
        onSaved={q => { qc.invalidateQueries({ queryKey: ['quotes'] }); qc.invalidateQueries({ queryKey: ['crm'] }); closeForm(); setOpenId(q.id); }} />}
      {openId && !editing && <QuoteDetailModal id={openId} onClose={() => setOpenId(null)} onEdit={q => setEditing(q)} onOpen={setOpenId} />}
    </SalesPageShell>
  );
}

/* ─── Saisie ──────────────────────────────────────────────────────────────── */
// Lignes libres/sections (phase 11, D3-24) : lineType 'free' = texte + prix sans
// article ; 'section' = titre de lot (sans montant) ; 'product' par défaut.
type LineType = 'product' | 'free' | 'section';
type Line = { lineType: LineType; productId: string; quantity: string; unitPrice: string; tvaRate: string; description: string };
const emptyLine = (): Line => ({ lineType: 'product', productId: '', quantity: '1', unitPrice: '', tvaRate: '', description: '' });
const freeLine = (): Line => ({ lineType: 'free', productId: '', quantity: '1', unitPrice: '', tvaRate: '', description: '' });
const sectionLine = (): Line => ({ lineType: 'section', productId: '', quantity: '', unitPrice: '', tvaRate: '', description: '' });
const today = () => format(new Date(), 'yyyy-MM-dd');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return format(d, 'yyyy-MM-dd'); };

function QuoteFormModal({ quote, opportunity, validityDays, onClose, onSaved }: { quote: Quote | null; opportunity?: Opportunity | null; validityDays: number; onClose: () => void; onSaved: (q: Quote) => void }) {
  const o = opportunity;
  const [mode, setMode] = useState<'customer' | 'prospect'>((quote && !quote.customer_id) || (o && !o.customer_id) ? 'prospect' : 'customer');
  const [customerId, setCustomerId] = useState(quote?.customer_id ?? o?.customer_id ?? '');
  const [prospect, setProspect] = useState({
    name: quote?.prospect_name ?? o?.prospect_name ?? '', company: quote?.prospect_company ?? o?.prospect_company ?? '',
    phone: quote?.prospect_phone ?? o?.prospect_phone ?? '', email: quote?.prospect_email ?? o?.prospect_email ?? '',
  });
  const [head, setHead] = useState({
    title: quote?.title ?? o?.title ?? '', quoteDate: d10(quote?.quote_date) || today(), validUntil: d10(quote?.valid_until) || addDays(today(), validityDays),
    discountPct: quote ? String(Number(quote.discount_pct)) : '0', deliveryTerms: quote?.delivery_terms ?? '', notes: quote?.notes ?? '', internalNotes: quote?.internal_notes ?? '',
    withTax: quote?.with_tax ?? false,
  });
  const [lines, setLines] = useState<Line[]>(() => quote?.items?.length
    ? quote.items.map(i => ({ lineType: (i.line_type ?? 'product') as LineType, productId: i.product_id ?? '', quantity: i.quantity != null ? String(i.quantity) : '', unitPrice: i.unit_price != null ? String(Number(i.unit_price)) : '', tvaRate: i.tva_rate != null ? String(Number(i.tva_rate)) : '', description: i.description ?? '' }))
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
  const productOptions = useMemo(() => products.map(p => ({ id: String(p.id), label: String(p.name), detail: p.price ? `${money(p.price)}` : undefined })), [products]);

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

  // Lignes valides : article (avec article + qté), libre (désignation + qté + prix),
  // section (intitulé). Le sous-total somme article + libre ; la section vaut 0.
  const valid = lines.filter(l =>
    (l.lineType === 'section' && l.description.trim())
    || (l.lineType === 'free' && l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== '')
    || (l.lineType === 'product' && l.productId && Number(l.quantity) > 0));
  const amountLines = valid.filter(l => l.lineType !== 'section');
  const subtotal = amountLines.reduce((s, l) => s + Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * 100) / 100, 0);
  const pct = Math.min(100, Math.max(0, Number(head.discountPct) || 0));
  const discount = Math.round(subtotal * pct) / 100;
  const ratio = subtotal > 0 ? 1 - discount / subtotal : 1;
  const tax = withTax ? amountLines.reduce((s, l) => s + (Number(l.tvaRate) ? Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * ratio * Number(l.tvaRate)) / 100 : 0), 0) : 0;
  const total = subtotal - discount + tax;

  const save = useMutation({
    mutationFn: () => {
      const payload: QuoteInput = {
        customerId: mode === 'customer' ? customerId || null : null,
        prospectName: mode === 'prospect' ? prospect.name || null : null, prospectCompany: mode === 'prospect' ? prospect.company || null : null,
        prospectPhone: mode === 'prospect' ? prospect.phone || null : null, prospectEmail: mode === 'prospect' ? prospect.email || null : null,
        title: head.title || null, opportunityId: quote ? undefined : o?.id ?? null, quoteDate: head.quoteDate, validUntil: head.validUntil, withTax: mode === 'prospect' ? head.withTax : undefined,
        discountPct: pct, deliveryTerms: head.deliveryTerms || null, notes: head.notes || null, internalNotes: head.internalNotes || null,
        items: valid.map(l => l.lineType === 'section'
          ? { lineType: 'section' as const, description: l.description }
          : {
            lineType: l.lineType, productId: l.lineType === 'product' ? l.productId : undefined,
            quantity: Number(l.quantity), unitPrice: l.unitPrice === '' ? null : Number(l.unitPrice),
            tvaRate: withTax && l.tvaRate !== '' ? Number(l.tvaRate) : null, description: l.description || null,
          }),
      };
      return quote ? quotesApi.update(quote.id, payload) : quotesApi.create(payload);
    },
    onSuccess: q => { notify.success(quote ? 'Devis enregistré' : `Devis ${q.number} créé`); onSaved(q); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const canSave = (mode === 'customer' ? !!customerId : !!(prospect.name.trim() || prospect.company.trim())) && valid.length > 0 && head.validUntil >= head.quoteDate;

  const [initialSnapshot] = useState(() => JSON.stringify({ mode, customerId, prospect, head, lines }));
  const dirty = JSON.stringify({ mode, customerId, prospect, head, lines }) !== initialSnapshot;
  const dateError = head.validUntil < head.quoteDate ? 'La date de validité doit suivre la date du devis.' : undefined;
  const tvaSelect = (l: Line, i: number) => (
    <select className="ds-input sm" aria-label="Taux de TVA" value={l.tvaRate} onChange={e => setLine(i, { tvaRate: e.target.value })}>{TVA_RATES.map(r => <option key={r} value={r}>{r === '' ? '—' : `${r} %`}</option>)}</select>
  );

  return (
    <Modal title={quote ? `Modifier le devis ${quote.number}` : 'Nouveau devis'} onClose={onClose} width={1000} locked={save.isPending}
      footer={<FormFooter dirty={dirty} onCancel={onClose} onSubmit={() => save.mutate()} disabled={!canSave} busy={save.isPending} />}>
      <FormSection title="Destinataire">
        <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Type de destinataire">
          {(['customer', 'prospect'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setMode(m)}>
              {m === 'customer' ? 'Client existant' : 'Prospect (sans fiche)'}
            </button>
          ))}
        </div>
        {mode === 'customer' ? (
          <FormField label="Client" required hint={customer ? (isPro ? 'Professionnel : prix HT, TVA par ligne, remise client appliquée' : 'Particulier : prix TTC') : undefined}>
            <SearchSelect options={customerOptions} value={customerId} onChange={setCustomerId} placeholder="Rechercher un client…" ariaLabel="Client" width="100%" size="md" />
          </FormField>
        ) : (
          <>
            <div className="ds-form-grid">
              <FormField label="Nom du contact" htmlFor="qf-p-name" hint="Nom du contact ou société obligatoire.">
                <input id="qf-p-name" className="ds-input" maxLength={160} value={prospect.name} onChange={e => setProspect({ ...prospect, name: e.target.value })} />
              </FormField>
              <FormField label="Société" htmlFor="qf-p-company">
                <input id="qf-p-company" className="ds-input" maxLength={200} value={prospect.company} onChange={e => setProspect({ ...prospect, company: e.target.value })} />
              </FormField>
              <FormField label="Téléphone" htmlFor="qf-p-phone">
                <input id="qf-p-phone" className="ds-input" maxLength={30} value={prospect.phone} onChange={e => setProspect({ ...prospect, phone: e.target.value })} />
              </FormField>
              <FormField label="E-mail" htmlFor="qf-p-email">
                <input id="qf-p-email" className="ds-input" type="email" maxLength={255} value={prospect.email} onChange={e => setProspect({ ...prospect, email: e.target.value })} />
              </FormField>
            </div>
            <label htmlFor="qf-p-tax" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input id="qf-p-tax" type="checkbox" checked={head.withTax} onChange={e => setHead({ ...head, withTax: e.target.checked })} />
              Prix HT avec TVA par ligne (prospect professionnel) — sinon prix TTC
            </label>
          </>
        )}
      </FormSection>

      <FormSection title="En-tête du devis">
        <div className="ds-form-grid cols-4">
          <FormField label="Objet" htmlFor="qf-title">
            <input id="qf-title" className="ds-input" maxLength={200} value={head.title} onChange={e => setHead({ ...head, title: e.target.value })} placeholder="Ex. : buffet mariage 120 personnes" />
          </FormField>
          <FormField label="Date du devis" htmlFor="qf-date" required>
            <input id="qf-date" className="ds-input" type="date" value={head.quoteDate} onChange={e => setHead({ ...head, quoteDate: e.target.value })} />
          </FormField>
          <FormField label="Valable jusqu'au" htmlFor="qf-valid" required error={dateError}>
            <input id="qf-valid" className="ds-input" type="date" value={head.validUntil} min={head.quoteDate} aria-invalid={!!dateError || undefined} onChange={e => setHead({ ...head, validUntil: e.target.value })} />
          </FormField>
          <FormField label="Remise globale (%)" htmlFor="qf-discount">
            <input id="qf-discount" className="ds-input" type="number" min={0} max={100} step="0.5" value={head.discountPct} onChange={e => setHead({ ...head, discountPct: e.target.value })} />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Lignes">
        <DataPanel label="Lignes du devis">
          <table className="odoo-table ds-dense" style={{ minWidth: 720 }}>
            <thead><tr><th>Article</th><th>Précision</th><th style={{ width: 90 }}>Qté</th><th style={{ width: 130 }}>Prix unit. {withTax ? 'HT' : 'TTC'} ({currencySymbol()})</th>{withTax && <th style={{ width: 90 }}>TVA %</th>}<th className="ds-num" style={{ width: 120 }}>Montant ({currencySymbol()})</th><th style={{ width: 36 }}></th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const del = <td><button type="button" className="odoo-pager-btn" aria-label="Retirer la ligne" onClick={() => setLines(lines.length > 1 ? lines.filter((_, k) => k !== i) : [emptyLine()])}><Trash2 size={13} /></button></td>;
              // Section (phase 11, D3-24) : intitulé de lot sur toute la largeur.
              if (l.lineType === 'section') return (
                <tr key={i} className="ds-group">
                  <td colSpan={withTax ? 6 : 5}><input className="ds-input sm" style={{ fontWeight: 600 }} aria-label="Titre de section" maxLength={300} value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Titre de section (ex. : Lot 1 — Prestations)" /></td>
                  {del}
                </tr>
              );
              const amount = n2(Math.round(Number(l.quantity) * (Number(l.unitPrice) || 0) * 100) / 100);
              // Ligne libre : désignation saisie à la place de l'article.
              if (l.lineType === 'free') return (
                <tr key={i}>
                  <td style={{ minWidth: 220 }}><input className="ds-input sm" aria-label="Désignation" maxLength={300} value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Désignation libre (sans article)…" /></td>
                  <td style={{ color: 'var(--ds-muted)', fontSize: 12 }}>ligne libre</td>
                  <td><input className="ds-input sm" aria-label="Quantité" type="number" min={0.001} step="0.001" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input className="ds-input sm" aria-label="Prix unitaire" type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></td>
                  {withTax && <td>{tvaSelect(l, i)}</td>}
                  <td className="ds-num">{l.description && l.unitPrice !== '' ? amount : ''}</td>
                  {del}
                </tr>
              );
              return (
                <tr key={i}>
                  <td style={{ minWidth: 220 }}><SearchSelect options={productOptions} value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Choisir un article…" ariaLabel="Article" width="100%" size="sm" /></td>
                  <td><input className="ds-input sm" aria-label="Précision" maxLength={300} value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Parfum, inscription, format…" /></td>
                  <td><input className="ds-input sm" aria-label="Quantité" type="number" min={0.001} step="0.001" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input className="ds-input sm" aria-label="Prix unitaire" type="number" min={0} step="0.01" value={l.unitPrice} onChange={e => setLine(i, { unitPrice: e.target.value })} /></td>
                  {withTax && <td>{tvaSelect(l, i)}</td>}
                  <td className="ds-num">{l.productId ? amount : ''}</td>
                  {del}
                </tr>
              );
            })}</tbody>
          </table>
        </DataPanel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, emptyLine()])}><Plus size={13} /> Ajouter une ligne</button>
            {/* Lignes libres / sections (phase 11, D3-24). */}
            <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, freeLine()])}><Plus size={13} /> Ligne libre</button>
            <button type="button" className="odoo-btn-secondary" onClick={() => setLines([...lines, sectionLine()])}><Plus size={13} /> Section</button>
          </div>
          <table className="ds-summary" aria-label="Totaux">
            <tbody>
              <tr><td>Sous-total {withTax ? 'HT' : 'TTC'}</td><td className="ds-num">{money(subtotal)}</td></tr>
              {pct > 0 && <tr><td>Remise {pct} %</td><td className="ds-num">−{money(discount)}</td></tr>}
              {withTax && <tr><td>TVA</td><td className="ds-num">{money(tax)}</td></tr>}
              <tr className="ds-total"><td className="ds-strong">Total TTC</td><td className="ds-num ds-strong">{money(total)}</td></tr>
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection title="Conditions">
        <div className="ds-form-grid">
          <FormField label="Livraison / délai (imprimé)" htmlFor="qf-delivery">
            <input id="qf-delivery" className="ds-input" maxLength={300} value={head.deliveryTerms} onChange={e => setHead({ ...head, deliveryTerms: e.target.value })} placeholder="Ex. : livraison sur site le jour J, 9 h" />
          </FormField>
          <FormField label="Conditions particulières (imprimé)" htmlFor="qf-notes">
            <input id="qf-notes" className="ds-input" maxLength={2000} value={head.notes} onChange={e => setHead({ ...head, notes: e.target.value })} placeholder="Ex. : acompte de 30 % à la commande" />
          </FormField>
        </div>
        <FormField label="Note interne (non imprimée)" htmlFor="qf-internal">
          <textarea id="qf-internal" className="ds-input" style={{ minHeight: 50 }} maxLength={2000} value={head.internalNotes} onChange={e => setHead({ ...head, internalNotes: e.target.value })} />
        </FormField>
      </FormSection>
    </Modal>
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
  const { data: q, isLoading, isError, error, refetch } = useQuery({ queryKey: ['quote', id], queryFn: () => quotesApi.get(id) });
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
  // Révision (phase 11, D3-22) : nouvelle version, l'originale est figée.
  const rev = useMutation({
    mutationFn: () => quotesApi.revise(id),
    onSuccess: n => { refresh(); notify.success(`Nouvelle version ${n.number} créée`); onOpen(n.id); },
    onError: e => notify.error(apiErrorMessage(e)),
  });
  const { data: versions = [] } = useQuery({ queryKey: ['quote-versions', id], queryFn: () => quotesApi.versions(id), enabled: !!id });
  const convert = useMutation({
    mutationFn: () => quotesApi.convert(id, { pickupDate: converting!.pickupDate, customerId: converting!.customerId || null }),
    onSuccess: r => {
      refresh(); setConverting(null);
      notify.success(`Commande ${r.order.orderNumber} créée`);
      if (r.creditWarning) notify.error(r.creditWarning.message);
    },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  if (isError) return <Modal title="Devis" onClose={onClose} width={960}><ErrorState title="Le devis n'a pas pu être chargé" error={error} onRetry={() => refetch()} bare /></Modal>;
  if (isLoading || !q) return <Modal title="Devis" onClose={onClose} width={960}><LoadingState bare /></Modal>;

  return (
    <Modal title={`Devis ${q.number}`} onClose={onClose} width={960}
      aside={<div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <QuoteStatusTag status={q.status} />
        {(q as { version?: number }).version && (q as { version?: number }).version! > 1 && (
          <span className="odoo-tag odoo-tag-grey" title="Version du devis">v{(q as { version?: number }).version}</span>
        )}
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => openPdf(q.id, 'quote')}><Printer size={13} /> Devis PDF</button>
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => openPdf(q.id, 'proforma')} title={q.proforma_number ? `Proforma ${q.proforma_number}` : 'Attribue un numéro de proforma à la première édition'}><FileText size={13} /> Proforma</button>
      </div>}
      footer={<>
        {(q.status === 'draft' || q.status === 'sent') && <button type="button" className="odoo-btn-secondary" onClick={() => onEdit(q)}>Modifier</button>}
        <button type="button" className="odoo-btn-secondary" disabled={dup.isPending} onClick={() => dup.mutate()}><Copy size={13} /> Dupliquer</button>
        {q.status !== 'converted' && (
          <button type="button" className="odoo-btn-secondary" disabled={rev.isPending} onClick={() => rev.mutate()} title="Crée une nouvelle version ; l'actuelle est figée"><FileSignature size={13} /> Réviser</button>
        )}
        <div style={{ flex: 1 }} />
        {['draft', 'sent', 'accepted'].includes(q.status) && (
          <button type="button" className="ds-btn-danger" disabled={act.isPending}
            onClick={async () => { if (await confirm(`Annuler le devis ${q.number} ?`)) act.mutate({ action: 'cancel' }); }}><Ban size={13} /> Annuler le devis</button>
        )}
        {q.status === 'cancelled' && <button type="button" className="odoo-btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ action: 'reopen' })}><RotateCcw size={13} /> Rouvrir</button>}
      </>}>
            {/* Chaîne des versions (phase 11, D3-22) : versions figées accessibles. */}
            {versions.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                <span style={{ opacity: 0.7 }}>Versions :</span>
                {versions.map(v => (
                  <button key={v.id} className={`odoo-tag ${v.id === id ? 'odoo-tag-blue' : 'odoo-tag-grey'}`}
                    style={{ cursor: 'pointer', border: 0 }} title={`${v.number} · ${money(v.total)}`}
                    onClick={() => v.id !== id && onOpen(v.id)}>v{v.version}{v.superseded_by ? '' : ' (actuelle)'}</button>
                ))}
              </div>
            )}
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
              <FormSection title="Classer le devis perdu">
                <div className="ds-form-grid">
                  <FormField label="Motif de la perte" htmlFor="qd-lost-reason" required>
                    <select id="qd-lost-reason" className="ds-input" value={losing.reasonCode} onChange={e => setLosing({ ...losing, reasonCode: e.target.value })}>
                      <option value="">Choisir…</option>{reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
                  </FormField>
                  <FormField label="Précision" htmlFor="qd-lost-note">
                    <input id="qd-lost-note" className="ds-input" maxLength={1000} value={losing.note} onChange={e => setLosing({ ...losing, note: e.target.value })} placeholder="Ex. : concurrent 15 % moins cher" />
                  </FormField>
                </div>
                <FormFooter onCancel={() => setLosing(null)} submitLabel="Classer perdu" disabled={!losing.reasonCode} busy={act.isPending}
                  onSubmit={() => act.mutate({ action: 'refuse', reasonCode: losing.reasonCode, note: losing.note })} />
              </FormSection>
            )}
            {converting && (
              <FormSection title="Transformer en commande">
                <div className="ds-form-grid">
                  <FormField label="Livraison ou retrait le" htmlFor="qd-pickup" required>
                    <input id="qd-pickup" className="ds-input" type="datetime-local" value={converting.pickupDate} onChange={e => setConverting({ ...converting, pickupDate: e.target.value })} />
                  </FormField>
                  {!q.customer_id && (
                    <FormField label="Client (facultatif)">
                      <SearchSelect value={converting.customerId} onChange={v => setConverting({ ...converting, customerId: v })} width="100%" size="md" ariaLabel="Client (facultatif)"
                        placeholder={`Sinon : commande au nom de « ${q.prospect_company || q.prospect_name} »`}
                        options={customers.map(c => ({ id: String(c.id), label: (c.company_name as string) || [c.first_name, c.last_name].filter(Boolean).join(' '), sublabel: (c.customer_type ?? 'particulier') !== 'particulier' ? 'Professionnel' : 'Particulier' }))} />
                    </FormField>
                  )}
                </div>
                <FormFooter onCancel={() => setConverting(null)} submitLabel="Créer la commande" disabled={!converting.pickupDate} busy={convert.isPending}
                  onSubmit={async () => { if (await confirm(`Créer la commande depuis le devis ${q.number} (${money(q.total)}) ?`)) convert.mutate(); }} />
              </FormSection>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, fontSize: '14px' }}>
              <div><div style={lab}>Client</div><strong>{q.client_label}</strong>{!q.customer_id && <span className="odoo-tag odoo-tag-yellow" style={{ marginLeft: 6 }}>prospect</span>}
                <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{[q.customer_phone ?? q.prospect_phone, q.customer_email ?? q.prospect_email].filter(Boolean).join(' · ')}</div></div>
              <div><div style={lab}>Objet</div>{q.title || '—'}</div>
              <div><div style={lab}>Date · validité</div>{fr(q.quote_date)} → <span style={{ color: q.is_overdue ? 'var(--ds-danger)' : undefined }}>{fr(q.valid_until)}</span></div>
              <div><div style={lab}>Proforma</div>{q.proforma_number ?? '—'}</div>
            </div>

            <DataPanel label="Lignes du devis">
            <table className="odoo-table ds-dense">
              <thead><tr><th>Article</th><th className="ds-num">Qté</th><th className="ds-num">Prix unit. {q.with_tax ? 'HT' : 'TTC'} ({currencySymbol()})</th>{q.with_tax && <th className="ds-num">TVA</th>}<th className="ds-num">Montant ({currencySymbol()})</th></tr></thead>
              <tbody>{(q.items ?? []).map(i => {
                // Section (phase 11, D3-24) : intitulé de lot sur toute la largeur.
                if ((i.line_type ?? 'product') === 'section') return (
                  <tr key={i.id} className="ds-group">
                    <td colSpan={q.with_tax ? 5 : 4}>{i.description}</td>
                  </tr>
                );
                return (
                  <tr key={i.id}>
                    <td>{i.product_name || i.description}{i.product_name && i.description && <div style={{ fontSize: '12px', color: 'var(--ds-muted)' }}>{i.description}</div>}</td>
                    <td className="ds-num">{i.quantity}</td>
                    <td className="ds-num">{i.unit_price != null ? n2(i.unit_price) : '—'}</td>
                    {q.with_tax && <td className="ds-num">{i.tva_rate != null ? `${Number(i.tva_rate)} %` : '—'}</td>}
                    <td className="ds-num">{n2(i.subtotal)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot>
                <tr><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Sous-total {q.with_tax ? 'HT' : 'TTC'}</td><td className="ds-num">{n2(q.subtotal)}</td></tr>
                {Number(q.promotion_amount) > 0 && <tr><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Promotions</td><td className="ds-num">−{n2(q.promotion_amount)}</td></tr>}
                {Number(q.discount_pct) > 0 && <tr><td colSpan={q.with_tax ? 4 : 3} style={{ textAlign: 'right' }}>Remise {Number(q.discount_pct)} %</td><td className="ds-num">−{n2(Number(q.discount_amount) - Number(q.promotion_amount ?? 0))}</td></tr>}
                {q.with_tax && <tr><td colSpan={4} style={{ textAlign: 'right' }}>TVA</td><td className="ds-num">{n2(q.tax_amount)}</td></tr>}
                <tr><td colSpan={q.with_tax ? 4 : 3} className="ds-strong" style={{ textAlign: 'right' }}>Total TTC</td><td className="ds-num ds-strong">{n2(q.total)}</td></tr>
              </tfoot>
            </table>
            </DataPanel>
            {(q.delivery_terms || q.notes || q.internal_notes) && (
              <div style={{ fontSize: '13px', display: 'grid', gap: 4 }}>
                {q.delivery_terms && <div><strong>Livraison :</strong> {q.delivery_terms}</div>}
                {q.notes && <div><strong>Conditions :</strong> {q.notes}</div>}
                {q.internal_notes && <div style={{ color: 'var(--ds-muted)' }}><strong>Note interne :</strong> {q.internal_notes}</div>}
              </div>
            )}

            <div>
              <div className="odoo-section-header" style={{ border: 'none', paddingLeft: 0 }}>Historique</div>
              <ul className="ui-timeline" style={{ margin: 0 }}>
                {(q.events ?? []).map(e => (
                  <li key={e.id} style={{ fontSize: '13px' }}>
                    <strong>{EVENT_LABEL(e)}</strong> <span style={{ color: 'var(--ds-muted)' }}>· {format(new Date(e.created_at), 'dd/MM/yyyy HH:mm')}{e.by_name ? ` · ${e.by_name}` : ''}</span>
                    {e.note && e.event_type !== 'edited' && <div style={{ color: 'var(--ds-muted)' }}>{reasons.find(r => r.code === e.note)?.label ?? e.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
    </Modal>
  );
}
