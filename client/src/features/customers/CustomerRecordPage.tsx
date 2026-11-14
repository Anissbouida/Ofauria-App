import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { ArrowLeft, Loader2, Users, Pencil, AlertTriangle, Phone, Mail, Wallet, BellRing } from 'lucide-react';
import { customersApi } from '../../api/customers.api';
import { salesApi, type AgingBucket } from '../../api/sales.api';
import { quotesApi, QUOTE_STATUS_LABELS, QUOTE_STATUS_TAG } from '../../api/quotes.api';
import { deliveryNotesApi } from '../../api/delivery-notes.api';
import { loyaltyApi } from '../../api/promotions.api';
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu';
import { useAuth } from '../../context/AuthContext';
import CustomerLoyalty from '../promotions/CustomerLoyalty';
import CustomerAddressesPanel from './CustomerAddressesPanel';
import CustomerTaxExemptionsPanel from './CustomerTaxExemptionsPanel';
import CustomerPortalPanel from './CustomerPortalPanel';
import CustomerHistoryPanel from './CustomerHistoryPanel';
import CustomerDataProtectionPanel from './CustomerDataProtectionPanel';
import { ListKpi } from '../sales/ListTemplate';
import { TYPE_META, displayName, isMoral, needsIce, PAYMENT_LABELS, type CustomerType } from './CustomersPage';

/**
 * Fiche client 360 (refonte Ventes, maquette planche 4) : tuiles (CA, encours contre
 * plafond, échu, conditions, fidélité), toutes les pièces du client dans un seul tableau
 * (devis, commandes, livraisons, factures, règlements, tickets), achats par mois, balance
 * âgée et informations à côté. Les panneaux existants (adresses, exonérations, portail,
 * fidélité, données personnelles, journal) deviennent des onglets.
 */

type Row = Record<string, any>;
type DocKind = 'quote' | 'order' | 'delivery' | 'invoice' | 'payment' | 'ticket';
const KIND_LABEL: Record<DocKind, string> = { quote: 'Devis', order: 'Commande', delivery: 'Livraison', invoice: 'Facture', payment: 'Règlement', ticket: 'Ticket' };
const KIND_PLURAL: Record<DocKind, string> = { quote: 'Devis', order: 'Commandes', delivery: 'Livraisons', invoice: 'Factures', payment: 'Règlements', ticket: 'Tickets' };
const BL_STATUS: Record<string, { label: string; tag: string }> = {
  delivered: { label: 'À facturer', tag: 'odoo-tag-orange' }, invoiced: { label: 'Facturé', tag: 'odoo-tag-green' }, cancelled: { label: 'Annulé', tag: 'odoo-tag-grey' },
};
const ORDER_TAG: Record<string, string> = {
  pending: 'odoo-tag-grey', confirmed: 'odoo-tag-blue', in_production: 'odoo-tag-yellow', ready: 'odoo-tag-green',
  partially_delivered: 'odoo-tag-orange', completed: 'odoo-tag-purple', cancelled: 'odoo-tag-red',
};
const BUCKETS: Array<{ key: AgingBucket; label: string; color: string }> = [
  { key: 'current', label: 'Non échu', color: 'var(--odoo-purple)' },
  { key: 'd30', label: 'Échu 1 à 30 j', color: '#D97706' },
  { key: 'd60', label: 'Échu 31 à 60 j', color: '#C2410C' },
  { key: 'd90', label: 'Échu 61 à 90 j', color: '#B42318' },
  { key: 'over90', label: 'Plus de 90 j', color: '#7F1D1D' },
];
const n2 = (v: number) => (v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number) => Math.round(v || 0).toLocaleString('fr-FR');
const num = (v: unknown) => { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; };
const day = (d: string | null | undefined, p = 'dd MMM yyyy') => (d ? format(new Date(d), p, { locale: fr }) : '—');
const PAGE = 12;

type Tab = 'docs' | 'receivables' | 'addresses' | 'loyalty' | 'portal' | 'data';
type Doc = { kind: DocKind; key: string; number: string; date: string; status: string; tag: string; sub?: string; amount: number; owed: number | null; href?: string };

export default function CustomerRecordPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isDirection = user?.role === 'admin' || user?.role === 'manager';
  const [tab, setTab] = useState<Tab>('docs');
  const [kind, setKind] = useState<DocKind | ''>('');
  const [showAll, setShowAll] = useState(false);

  const { data: stats, isLoading, error } = useQuery({ queryKey: ['customer-stats', id], queryFn: () => customersApi.stats(id), enabled: !!id });
  const { data: situation } = useQuery({ queryKey: ['customer-situation', id], queryFn: () => customersApi.situation(id), enabled: !!id, retry: false });
  const { data: loyalty } = useQuery({ queryKey: ['loyalty', 'customer', id], queryFn: () => loyaltyApi.customer(id), enabled: !!id, retry: false });
  const { data: quotes } = useQuery({ queryKey: ['quotes', { customerId: id }], queryFn: () => quotesApi.list({ customerId: id, limit: '100' }), enabled: !!id && isDirection, retry: false });
  const { data: notes = [] } = useQuery({ queryKey: ['delivery-notes', 'list', { customerId: id }], queryFn: () => deliveryNotesApi.list({ customerId: id }), enabled: !!id && isDirection, retry: false });
  const { data: statement } = useQuery({ queryKey: ['customer-statement', id, 'all'], queryFn: () => customersApi.statement(id, '2000-01-01', format(new Date(), 'yyyy-MM-dd')), enabled: !!id && isDirection, retry: false });
  const { data: rec } = useQuery({ queryKey: ['receivables'], queryFn: salesApi.receivables, enabled: isDirection, retry: false });

  const recCustomer = rec?.customers.find(x => x.customerId === id) ?? null;

  /* ── Toutes les pièces du client, la plus récente d'abord ── */
  const docs = useMemo(() => {
    const out: Doc[] = [];
    const owedBy = new Map((recCustomer?.docs ?? []).map(d => [d.number, d]));
    for (const q of quotes?.data ?? []) out.push({ kind: 'quote', key: `q${q.id}`, number: q.number, date: q.quote_date, status: QUOTE_STATUS_LABELS[q.status], tag: QUOTE_STATUS_TAG[q.status], sub: q.title ?? undefined, amount: num(q.total), owed: null, href: `/quotes?open=${q.id}` });
    for (const o of (stats?.orders?.history ?? []) as Row[]) out.push({ kind: 'order', key: `o${o.id}`, number: o.order_number, date: o.created_at, status: ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status, tag: ORDER_TAG[o.status] ?? 'odoo-tag-grey', amount: num(o.total), owed: null, href: `/orders/${o.id}` });
    for (const d of notes) out.push({ kind: 'delivery', key: `d${d.id}`, number: d.number, date: d.delivery_date, status: BL_STATUS[d.status]?.label ?? d.status, tag: BL_STATUS[d.status]?.tag ?? 'odoo-tag-grey', sub: d.order_number ?? undefined, amount: num(d.total_ttc), owed: null, href: `/delivery-notes?open=${d.id}` });
    for (const e of statement?.entries ?? []) {
      if (e.kind === 'invoice') {
        const open = owedBy.get(e.number);
        out.push({
          kind: 'invoice', key: `i${e.number}${e.date}`, number: e.number, date: e.date,
          status: open ? (open.days_late > 0 ? `Échue · ${open.days_late} j` : 'À encaisser') : e.debit < 0 ? 'Avoir' : 'Soldée',
          tag: open ? (open.days_late > 0 ? 'odoo-tag-red' : 'odoo-tag-blue') : 'odoo-tag-green',
          sub: open?.due_date ? `échéance ${day(open.due_date, 'dd MMM')}` : undefined,
          amount: e.debit || -e.credit, owed: open ? open.remaining : 0, href: '/sales?tab=invoices',
        });
      } else {
        out.push({ kind: 'payment', key: `p${e.number}${e.date}`, number: e.number, date: e.date, status: 'Encaissé', tag: 'odoo-tag-green', sub: e.label, amount: e.credit, owed: null });
      }
    }
    for (const s of (stats?.sales?.history ?? []) as Row[]) {
      const open = owedBy.get(s.sale_number);
      out.push({ kind: 'ticket', key: `t${s.id}`, number: s.sale_number, date: s.created_at, status: open ? 'Sur compte' : (PAYMENT_LABELS[s.payment_method] ?? 'Payé'), tag: open ? 'odoo-tag-orange' : 'odoo-tag-grey', amount: num(s.total), owed: open ? open.remaining : null });
    }
    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [quotes, stats, notes, statement, recCustomer]);

  if (isLoading) return <div className="prj sal-page"><div className="prj-panel sal-empty"><Loader2 className="animate-spin" size={20} /><span>Chargement de la fiche…</span></div></div>;
  const c = stats?.customer as Row | undefined;
  if (error || !c) {
    return (
      <div className="prj sal-page">
        <div className="prj-panel sal-empty"><Users size={28} style={{ opacity: 0.4 }} /><strong>Client introuvable</strong>
          <button type="button" className="odoo-btn-secondary" onClick={() => navigate('/customers')}>Retour aux clients</button></div>
      </div>
    );
  }

  const type = (c.customer_type as CustomerType) || 'particulier';
  const meta = TYPE_META[type] ?? TYPE_META.particulier;
  const TypeIcon = meta.icon;
  const { primary, secondary } = displayName(c);
  const moral = isMoral(type);
  const purchases = num(stats?.orders?.count) + num(stats?.sales?.count);
  const last = [stats?.orders?.last_date, stats?.sales?.last_date].filter(Boolean).sort().pop() as string | undefined;
  const limit = situation?.creditLimit ?? null;
  const owed = situation?.total ?? 0;
  const counts = docs.reduce<Record<string, number>>((acc, d) => { acc[d.kind] = (acc[d.kind] || 0) + 1; return acc; }, {});
  const shownDocs = docs.filter(d => !kind || d.kind === kind);
  const monthly: Array<{ month: string; amount: number }> = stats?.monthly ?? [];
  const monthMax = Math.max(1, ...monthly.map(m => m.amount));
  const buckets = recCustomer?.buckets;
  const bucketTotal = recCustomer?.total ?? 0;
  const initials = primary.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const more: RowMenuItem[] = [];
  if (isDirection) more.push({ label: 'Voir dans les créances', icon: Wallet, onSelect: () => navigate('/sales?tab=unpaid') });
  if (isDirection && situation && situation.overdue > 0) more.push({ label: 'Relances', icon: BellRing, onSelect: () => navigate('/dunning') });

  const tabs: Array<[Tab, string, number | null]> = [
    ['docs', 'Pièces', docs.length], ['receivables', 'Créances', recCustomer?.docs.length ?? 0], ['addresses', 'Adresses et TVA', null],
    ['loyalty', 'Fidélité', null], ['portal', 'Portail', null], ['data', 'Données et journal', null],
  ];
  const chips: Array<[DocKind | '', string, number]> = [['', 'Tout', docs.length], ...(Object.keys(KIND_LABEL) as DocKind[]).filter(k => counts[k]).map(k => [k, KIND_PLURAL[k], counts[k]] as [DocKind, string, number])];

  return (
    <div className="prj prj-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)', flexWrap: 'wrap' }}>
        <button type="button" className="sal-link" style={{ marginLeft: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => navigate('/customers')}><ArrowLeft size={14} /> Clients</button>
        <span aria-hidden="true">›</span><span>{primary}</span>
      </div>

      <section className="prj-panel prj-hero">
        <div className="prj-hero-top">
          <span className="prj-hero-icon" style={{ width: 56, height: 56, borderRadius: 14, fontWeight: 700, fontSize: '1.0625rem' }}>{initials}</span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1>{primary}</h1>
              <span className={`odoo-tag ${moral ? 'odoo-tag-blue' : 'odoo-tag-grey'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><TypeIcon size={11} /> {meta.label}</span>
              {c.is_active === false && <span className="odoo-tag odoo-tag-grey">Archivé</span>}
              {c.credit_hold && <span className="odoo-tag odoo-tag-red">Bloqué (relances)</span>}
              {loyalty?.tier && <span className="odoo-tag odoo-tag-purple">Fidélité {loyalty.tier.label}</span>}
            </div>
            <div className="prj-hero-meta">
              {secondary && <span>{secondary}{c.contact_role ? ` (${c.contact_role})` : ''}</span>}
              {c.city && <span>{c.city}</span>}
              {c.phone && <span>{c.phone}</span>}
              <span>Client depuis {day(c.created_at, 'MMMM yyyy')}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="odoo-btn-primary" onClick={() => navigate(`/customers?edit=${id}`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Pencil size={14} /> Modifier</button>
            <RowMenu label="Autres actions" items={more} />
          </div>
        </div>
      </section>

      {needsIce(c) && (
        <div className="sal-alert"><AlertTriangle size={16} /><span>ICE manquant : les factures adressées à ce client ne sont pas conformes.</span>
          <button type="button" className="sal-next" onClick={() => navigate(`/customers?edit=${id}`)}>Saisir l'ICE</button></div>
      )}

      <section className="prj-kpis" aria-label="Indicateurs du client">
        <ListKpi label="CA cumulé" value={`${n2(num(c.total_spent))} DH`} sub={`${purchases} achat${purchases > 1 ? 's' : ''}${last ? ` · dernier le ${day(last, 'd MMM')}` : ''}`} />
        {situation && (
          <div className="prj-kpi">
            <div className="prj-kpi-head"><span>{limit != null ? 'Encours / plafond' : 'Encours'}</span>{limit ? <span>{Math.round(owed / limit * 100)} %</span> : null}</div>
            <div className="prj-kpi-value">{n0(owed)} DH</div>
            {limit != null && limit > 0 && <div className={`prj-bar ${owed > limit ? 'red' : owed > limit * 0.85 ? 'orange' : 'green'}`}><span style={{ width: `${Math.min(100, owed / limit * 100)}%` }} /></div>}
            <div className="prj-kpi-sub">{limit != null ? `plafond ${n0(limit)} DH` : 'sans plafond'}</div>
          </div>
        )}
        {situation && <ListKpi label="Échu" value={`${n0(situation.overdue)} DH`} sub={situation.overdue > 0 ? `plus ancien retard ${situation.maxDaysLate} j` : 'rien d\'échu'} tone={situation.overdue > 0 ? 'red' : undefined} />}
        {situation && moral && <ListKpi label="Conditions de paiement" value={situation.paymentTermDays ? `${situation.paymentTermDays} j` : 'Comptant'} sub={c.billing_frequency === 'per_delivery' ? 'facture à chaque livraison' : 'facture mensuelle (BL regroupés)'} />}
        <ListKpi label="Fidélité" value={`${n0(num(c.loyalty_points))} pts`} sub={loyalty?.tier ? `niveau ${loyalty.tier.label}${loyalty.value ? ` · ${n0(loyalty.value)} DH de remise` : ''}` : 'aucun niveau'} />
      </section>

      <div className="prj-columns">
        <div className="prj-main" style={{ display: 'grid', gap: 16 }}>
          <section className="prj-panel">
            <div className="prj-tabs" role="tablist" aria-label="Rubriques du client">
              {tabs.map(([k, label, count]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`prj-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
                  {label}{count != null && <small>{count}</small>}
                </button>
              ))}
            </div>

            {tab === 'docs' && (<>
              <div className="prj-chips" role="group" aria-label="Type de pièce" style={{ padding: '12px 14px 4px' }}>
                {chips.map(([k, label, count]) => (
                  <button key={k || 'all'} type="button" aria-pressed={kind === k} className={`prj-chip${kind === k ? ' active' : ''}`} onClick={() => { setKind(k); setShowAll(false); }}>{label} <small>{count}</small></button>
                ))}
              </div>
              {shownDocs.length ? (<>
                <div className="prj-scroll sal-panel">
                  <table className="odoo-table" style={{ margin: 0 }}>
                    <thead><tr><th>Pièce</th><th>N°</th><th>Date</th><th>Statut</th><th style={{ textAlign: 'right' }}>Montant TTC</th><th style={{ textAlign: 'right' }}>Reste dû</th></tr></thead>
                    <tbody>
                      {(showAll ? shownDocs : shownDocs.slice(0, PAGE)).map(d => (
                        <tr key={d.key} onClick={d.href ? () => navigate(d.href!) : undefined} style={{ cursor: d.href ? 'pointer' : 'default' }}>
                          <td><span className="odoo-tag odoo-tag-grey">{KIND_LABEL[d.kind]}</span></td>
                          <td><span className="sal-num">{d.number}</span>{d.sub && <span className="sal-sub">{d.sub}</span>}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{day(d.date)}</td>
                          <td><span className={`odoo-tag ${d.tag}`}>{d.status}</span></td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{n2(d.amount)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: d.owed ? 600 : 400, color: d.owed ? 'var(--prj-orange)' : 'var(--odoo-text-muted)' }}>{d.owed == null ? '—' : n2(d.owed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sal-foot">
                  <span>{showAll ? shownDocs.length : Math.min(PAGE, shownDocs.length)} pièce{shownDocs.length > 1 ? 's' : ''} sur {shownDocs.length} · 20 dernières commandes et 20 derniers tickets{!isDirection ? ' · devis, livraisons et factures réservés à la direction' : ''}</span>
                  {shownDocs.length > PAGE && <button type="button" className="sal-link" onClick={() => setShowAll(v => !v)}>{showAll ? 'Réduire' : 'Voir toutes les pièces'}</button>}
                </div>
              </>) : <div className="sal-empty">Aucune pièce pour ce client.</div>}
            </>)}

            {tab === 'receivables' && (recCustomer?.docs.length ? (<>
              <div className="prj-scroll">
                <table className="odoo-table" style={{ margin: 0 }}>
                  <thead><tr><th>Pièce</th><th>Date</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Déjà payé</th><th style={{ textAlign: 'right' }}>Reste dû</th></tr></thead>
                  <tbody>{recCustomer.docs.map(d => (
                    <tr key={d.kind + d.id} style={{ cursor: 'default' }}>
                      <td><span className="sal-num">{d.number}</span><span className="sal-sub">{d.kind === 'ticket' ? 'Ticket sur compte' : 'Facture'}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{day(d.doc_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{day(d.due_date)}{d.days_late > 0 && <span className="sal-late-txt">{d.days_late} j de retard</span>}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n2(d.amount)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--odoo-text-muted)' }}>{d.paid > 0 ? n2(d.paid) : '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{n2(d.remaining)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="sal-foot"><span>Encaissement, relevé de compte et règlement sur plusieurs factures : écran Créances.</span><button type="button" className="sal-link" onClick={() => navigate('/sales?tab=unpaid')}>Ouvrir les créances</button></div>
            </>) : <div className="sal-empty">{isDirection ? 'Aucune créance : le client est à jour.' : 'Créances réservées à la direction.'}</div>)}

            {tab === 'addresses' && <div className="prj-tab-body"><CustomerAddressesPanel customerId={id} /><CustomerTaxExemptionsPanel customerId={id} /></div>}
            {tab === 'loyalty' && <div className="prj-tab-body"><CustomerLoyalty customerId={id} /></div>}
            {tab === 'portal' && <div className="prj-tab-body"><CustomerPortalPanel customerId={id} /></div>}
            {tab === 'data' && (
              <div className="prj-tab-body">
                <CustomerDataProtectionPanel customerId={id} marketingConsent={c.marketing_consent === true} anonymizedAt={(c.anonymized_at as string | null) ?? null} />
                <CustomerHistoryPanel customerId={id} isActive={c.is_active !== false} />
              </div>
            )}
          </section>

          {monthly.length > 0 && (
            <section className="prj-panel">
              <div className="prj-panel-head">Achats par mois <small>12 derniers mois · tickets et factures TTC</small></div>
              <div className="prj-panel-body">
                <div className="sal-months" role="img" aria-label="Achats mensuels du client sur 12 mois">
                  {monthly.map((m, i) => (
                    <div key={m.month} className={`sal-month${i === monthly.length - 1 ? ' cur' : ''}`} title={`${format(new Date(`${m.month}-01T00:00:00`), 'MMMM yyyy', { locale: fr })} : ${n2(m.amount)} DH`}>
                      <span style={{ height: `${m.amount / monthMax * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="sal-months-axis" aria-hidden="true">
                  {monthly.map(m => <span key={m.month}>{format(new Date(`${m.month}-01T00:00:00`), 'MMM', { locale: fr })}</span>)}
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="prj-aside" aria-label="Informations du client">
          {isDirection && (
            <section className="prj-panel">
              <h2>Balance âgée</h2>
              {buckets && bucketTotal > 0 ? (<>
                <div className="sal-stack" role="img" aria-label={BUCKETS.filter(b => buckets[b.key] > 0).map(b => `${b.label} ${n0(buckets[b.key])} DH`).join(', ')}>
                  {BUCKETS.map(b => (buckets[b.key] > 0 ? <span key={b.key} style={{ width: `${buckets[b.key] / bucketTotal * 100}%`, background: b.color }} /> : null))}
                </div>
                <dl className="sal-legend">
                  {BUCKETS.map(b => <div key={b.key} className="sal-legend-row"><dt><i style={{ background: b.color }} />{b.label}</dt><dd>{n2(buckets[b.key])}</dd></div>)}
                </dl>
              </>) : <p className="prj-note">Aucune créance ouverte.</p>}
            </section>
          )}

          <section className="prj-panel">
            <h2>Informations</h2>
            <dl className="prj-dl">
              {moral && c.company_name && <><dt>Raison sociale</dt><dd>{c.company_name}</dd></>}
              {moral && <><dt>ICE</dt><dd>{c.ice || <span className="odoo-tag odoo-tag-orange">À saisir</span>}</dd></>}
              {c.if_fiscal && <><dt>IF</dt><dd>{c.if_fiscal}</dd></>}
              {c.rc && <><dt>RC</dt><dd>{c.rc}{c.rc_ville ? ` · ${c.rc_ville}` : ''}</dd></>}
              {c.forme_juridique && <><dt>Forme</dt><dd>{c.forme_juridique}</dd></>}
              {moral && <><dt>Paiement</dt><dd>{c.delai_paiement_jours ? `${c.delai_paiement_jours} jours` : 'comptant'}</dd></>}
              {c.credit_limit && <><dt>Plafond</dt><dd>{n0(num(c.credit_limit))} DH</dd></>}
              {c.remise_pct && <><dt>Remise</dt><dd>{num(c.remise_pct)} %</dd></>}
              {moral && <><dt>TVA</dt><dd>{c.tva_exonere ? 'Exonérée' : 'Assujettie'}</dd></>}
              {type === 'particulier' && c.birthday && <><dt>Naissance</dt><dd>{day(c.birthday, 'd MMMM yyyy')}</dd></>}
              {type === 'particulier' && c.allergies && <><dt>Allergies</dt><dd>{c.allergies}</dd></>}
            </dl>
          </section>

          <section className="prj-panel">
            <h2>Contact</h2>
            <dl className="prj-dl">
              {(secondary || !moral) && <><dt>{moral ? 'Contact' : 'Nom'}</dt><dd>{secondary ?? primary}{c.contact_role ? ` (${c.contact_role})` : ''}</dd></>}
              {c.phone && <><dt>Téléphone</dt><dd style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {c.phone}</dd></>}
              {c.email && <><dt>E-mail</dt><dd style={{ display: 'inline-flex', alignItems: 'center', gap: 4, overflowWrap: 'anywhere' }}><Mail size={11} /> {c.email}</dd></>}
              {(c.address || c.city) && <><dt>Adresse</dt><dd>{[c.address, c.city].filter(Boolean).join(', ')}</dd></>}
              {c.preferred_contact && <><dt>Préférence</dt><dd>{({ phone: 'Téléphone', email: 'E-mail', whatsapp: 'WhatsApp' } as Record<string, string>)[c.preferred_contact] ?? c.preferred_contact}</dd></>}
            </dl>
            {!c.phone && !c.email && <p className="prj-note">Aucun moyen de contact.</p>}
          </section>

          {c.notes && (
            <section className="prj-panel">
              <h2>Notes internes</h2>
              <p className="prj-note" style={{ whiteSpace: 'pre-line', color: 'var(--odoo-text)' }}>{c.notes}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
