import { money } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertTriangle, ChevronDown, Banknote, X, Loader2, Receipt, FileText, Phone, ScrollText, Layers, PiggyBank, Scale } from 'lucide-react';
import { salesApi, type AgingBucket, type CustomerReceivable, type ReceivableDoc } from '../../api/sales.api';
import { customersApi, type CustomerStatement } from '../../api/customers.api';
import { paymentsApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { RowMenu } from '../../components/ui/RowMenu';
import { ListToolbar, FilterChips, ListKpi, NextStep } from './ListTemplate';

/**
 * Créances clients (mig 351) — remplace l'onglet « Impayés ».
 * Balance âgée par client (Odoo « Aged Receivable », SAP FI-AR, échéancier Sage) :
 * tickets de caisse portés sur le compte client + factures clients ouvertes.
 * « Encaisser » : un ticket se solde en entier (il entre au chiffre d'affaires du
 * jour d'encaissement) ; une facture accepte un règlement partiel, chèque ou traite.
 */

const BUCKETS: Array<{ key: AgingBucket; label: string; tone: string }> = [
  { key: 'current', label: 'Non échu', tone: 'var(--theme-accent)' },
  { key: 'd30', label: '1-30 j', tone: '#b45309' },
  { key: 'd60', label: '31-60 j', tone: '#c2410c' },
  { key: 'd90', label: '61-90 j', tone: '#dc2626' },
  { key: 'over90', label: '+ 90 j', tone: '#991b1b' },
];
const day = (d: string) => format(new Date(d + 'T00:00:00'), 'dd MMM yyyy', { locale: fr });

type Filter = 'all' | 'overdue' | 'over60';

export default function ReceivablesTab() {
  // ?filter=overdue|over60 : lien « Créances échues » du tableau de bord.
  const [filter, setFilter] = useState<Filter>(() => {
    const f = new URLSearchParams(window.location.search).get('filter');
    return f === 'overdue' || f === 'over60' ? f : 'all';
  });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<{ doc: ReceivableDoc; customer: string } | null>(null);
  const [statement, setStatement] = useState<{ id: string; name: string } | null>(null);
  const [receipt, setReceipt] = useState<CustomerReceivable | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['receivables'], queryFn: salesApi.receivables });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.customers ?? []).filter(c => {
      if (filter === 'overdue' && c.overdue <= 0) return false;
      if (filter === 'over60' && c.buckets.d90 + c.buckets.over90 <= 0) return false;
      return !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || c.docs.some(d => d.number.toLowerCase().includes(q));
    });
  }, [data, filter, search]);

  const all = data?.customers ?? [];
  const counts = {
    all: all.length,
    overdue: all.filter(c => c.overdue > 0).length,
    over60: all.filter(c => c.buckets.d90 + c.buckets.over90 > 0).length,
  };
  const toggle = (key: string) => setOpen(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const t = data?.totals;
  const rec = data?.reconciliation;
  // Concordance gestion ↔ 3421 : l'écart s'explique par les tickets à crédit non
  // comptabilisés et les impayés sans fiche client (les avoirs sont dans les deux).
  const reconciled = rec ? Math.abs(rec.gap - rec.legacyTickets - rec.unassigned) < 1 : true;

  return (
    <div className="prj" style={{ gap: 20 }}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Total dû par les clients" value={t ? money(t.total) : '—'} sub={t ? `${t.documents} document${t.documents > 1 ? 's' : ''} ouverts` : ''} />
        <ListKpi label="Échu (en retard)" value={t ? money(t.overdue) : '—'} sub="à relancer" tone={t && t.overdue > 0 ? 'red' : undefined} />
        <ListKpi label="Plus de 60 jours" value={t ? money(t.buckets.d90 + t.buckets.over90) : '—'} sub="risque d'impayé" tone={t && t.buckets.d90 + t.buckets.over90 > 0 ? 'red' : undefined} />
        <ListKpi label="Clients concernés" value={t ? String(t.customers) : '—'} />
      </section>

      {/* Rapprochement avec le compte clients 3421 (G-CA-05) : une seule vue des créances */}
      {rec && (
        <section className="kl-ar-rec">
          <span className={`kl-ic ${reconciled ? 'g' : 'o'}`}><Scale size={16} /></span>
          <span className="tx">
            <b>Rapprochement comptable</b>
            <small>
              {[rec.legacyTickets > 0.005 ? `${money(rec.legacyTickets)} en tickets à crédit non comptabilisés` : '',
                rec.unassigned > 0.005 ? `${money(rec.unassigned)} sans fiche client` : '',
                rec.unappliedCredits > 0.005 ? `${money(rec.unappliedCredits)} d'avoirs non imputés` : ''].filter(Boolean).join(' · ') || 'Tout est comptabilisé au grand livre'}
            </small>
          </span>
          <span className="kl-ar-rec-v"><small>Pièces de gestion</small><b>{money(rec.documents)}</b></span>
          <span className="kl-ar-rec-v"><small>Compte clients 3421</small><b>{money(rec.ledger)}</b></span>
          <span className={`kl-pill ${reconciled ? 'g' : 'o'}`}>
            {reconciled ? 'Concorde' : `Écart ${money(rec.gap - rec.legacyTickets - rec.unassigned)}`}
          </span>
        </section>
      )}

      {/* Balance âgée : répartition du total dû par tranche de retard */}
      {t && t.total > 0 && (
        <section>
          <div className="kl-sec"><h2>Balance âgée</h2><small>{money(t.total)} dus</small></div>
          <div className="kl-ar-aging">
            <div className="kl-ar-bar" aria-hidden="true">
              {BUCKETS.map(b => t.buckets[b.key] > 0 && (
                <i key={b.key} style={{ flexGrow: t.buckets[b.key], background: b.tone }} />
              ))}
            </div>
            <div className="kl-ar-buckets">
              {BUCKETS.map(b => (
                <div key={b.key} className={t.buckets[b.key] > 0 ? '' : 'empty'}>
                  <span><i style={{ background: b.tone }} />{b.label}</span>
                  <b>{t.buckets[b.key] > 0 ? money(t.buckets[b.key]) : '—'}</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <ListToolbar search={search} onSearch={setSearch} placeholder="Client, téléphone ou n° de pièce…" />
      <FilterChips label="Filtrer les créances" value={filter} onChange={k => setFilter(k as Filter)} chips={[
        { key: 'all', label: 'Tous', count: counts.all },
        { key: 'overdue', label: 'En retard', count: counts.overdue, tone: counts.overdue ? 'late' : undefined, icon: counts.overdue ? AlertTriangle : undefined },
        { key: 'over60', label: '+ 60 jours', count: counts.over60 },
      ]} />

      {/* Clients débiteurs : une carte par client, pièces dépliables */}
      <section style={{ display: 'grid', gap: 12 }}>
        {isLoading && <div className="kl-ar-empty"><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></div>}
        {!isLoading && rows.length === 0 && (
          <div className="kl-ar-empty">
            {data?.customers.length ? 'Aucun client pour ce filtre' : 'Aucune créance : tous les clients sont à jour.'}
          </div>
        )}
        {rows.map(c => {
          const key = c.customerId ?? c.name;
          const isOpen = open.has(key);
          return (
            <CustomerCard key={key} c={c} isOpen={isOpen} onToggle={() => toggle(key)}
              onPay={doc => setPaying({ doc, customer: c.name })}
              onStatement={() => c.customerId && setStatement({ id: c.customerId, name: c.name })}
              onReceipt={() => setReceipt(c)} />
          );
        })}
      </section>

      {paying && <PayDialog doc={paying.doc} customer={paying.customer} onClose={() => setPaying(null)} />}
      {statement && <StatementDialog customerId={statement.id} name={statement.name} onClose={() => setStatement(null)} />}
      {receipt && <ReceiptDialog c={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function CustomerCard({ c, isOpen, onToggle, onPay, onStatement, onReceipt }: { c: CustomerReceivable; isOpen: boolean; onToggle: () => void; onPay: (d: ReceivableDoc) => void; onStatement: () => void; onReceipt: () => void }) {
  const overLimit = c.creditLimit != null && c.total > c.creditLimit;
  const initials = c.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
  const hasInvoices = c.docs.some(d => d.kind === 'invoice');
  return (
    <article className="kl-ar-card">
      <div className="kl-ar-head" role="button" tabIndex={0} aria-expanded={isOpen} onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <span className="kl-mono">{initials}</span>
        <span className="tx">
          <span className="kl-ar-name">
            {c.name}
            {c.customerType === 'professionnel' && <span className="kl-pill b">Pro</span>}
            {overLimit && <span className="kl-pill r" title={`Plafond ${money(c.creditLimit!)}`}>Plafond dépassé</span>}
          </span>
          <span className="kl-ar-sub">
            {c.phone && <><Phone size={11} style={{ display: 'inline', verticalAlign: -1 }} /> {c.phone} · </>}
            {c.docs.length} pièce{c.docs.length > 1 ? 's' : ''}
            {c.maxDaysLate > 0 && <span className="late"> · plus ancien retard {c.maxDaysLate} j</span>}
          </span>
        </span>
        <span className="kl-ar-split">
          {BUCKETS.filter(b => c.buckets[b.key] > 0).map(b => (
            <span key={b.key}><i style={{ background: b.tone }} />{b.label} <b>{money(c.buckets[b.key])}</b></span>
          ))}
        </span>
        <span className="kl-ar-total"><small>Total dû</small>{money(c.total)}</span>
        <span className="sal-actions" onClick={e => e.stopPropagation()}>
          {c.docs.length === 1 && <NextStep icon={Banknote} label="Encaisser" onClick={() => onPay(c.docs[0])} />}
          <RowMenu items={[
            { label: isOpen ? 'Masquer les pièces' : 'Voir les pièces', icon: FileText, onSelect: onToggle },
            ...(c.customerId && hasInvoices ? [{ label: 'Règlement sur plusieurs factures', icon: Layers, onSelect: onReceipt }] : []),
            ...(c.customerId ? [{ label: 'Relevé de compte', icon: ScrollText, onSelect: onStatement }] : []),
          ]} />
        </span>
        <ChevronDown size={16} className={`kl-ar-chev${isOpen ? ' open' : ''}`} />
      </div>

      {isOpen && (
        <div className="kl-ar-body">
          {c.customerId && (
            <div className="kl-ar-actions">
              {hasInvoices && (
                <button type="button" className="odoo-btn-secondary"
                  title="Un chèque ou un virement qui règle plusieurs factures ; le reste devient une avance"
                  onClick={onReceipt}>
                  <Layers size={13} /> Règlement sur plusieurs factures
                </button>
              )}
              <button type="button" className="odoo-btn-secondary" onClick={onStatement}>
                <ScrollText size={13} /> Relevé de compte
              </button>
            </div>
          )}
          {c.customerId && <AdvancesBlock customerId={c.customerId} invoices={c.docs.filter(d => d.kind === 'invoice')} />}
          {c.gap != null && Math.abs(c.gap) > 0.005 && (
            <div className="kl-ar-warn">
              <AlertTriangle size={12} /> Écart avec le compte 3421&nbsp;: {money(c.gap)} à vérifier
              {c.legacyTickets > 0.005 ? ` (hors ${money(c.legacyTickets)} de tickets à crédit non comptabilisés)` : ''}
            </div>
          )}
          <div className="kl-ar-docs">
            {c.docs.map(d => (
              <div key={d.kind + d.id} className="kl-ar-doc">
                <span className={`kl-ic ${d.days_late > 0 ? 'r' : 'x'}`}>{d.kind === 'ticket' ? <Receipt size={15} /> : <FileText size={15} />}</span>
                <span className="tx">
                  <span className="t1"><span className="num">{d.number}</span> <span className="kind">{d.kind === 'ticket' ? 'Ticket' : 'Facture'}</span></span>
                  <span className="t2">
                    Émise le {day(d.doc_date)} · échéance <span className={d.days_late > 0 ? 'late' : ''}>{day(d.due_date)}{d.days_late > 0 ? ` · ${d.days_late} j de retard` : ''}</span>
                  </span>
                </span>
                <span className="kl-ar-amt">
                  <b>{money(d.remaining)}</b>
                  {d.paid > 0 && <small>sur {money(d.amount)} · {money(d.paid)} payés</small>}
                </span>
                <NextStep icon={Banknote} label="Encaisser" onClick={() => onPay(d)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

const TICKET_METHODS = [
  { value: 'cash', label: 'Espèces' }, { value: 'card', label: 'Carte' },
  { value: 'mobile', label: 'Mobile' }, { value: 'check', label: 'Chèque' },
];
const INVOICE_METHODS = [
  { value: 'cash', label: 'Espèces' }, { value: 'bank', label: 'Virement' },
  { value: 'check', label: 'Chèque' }, { value: 'traite', label: 'Traite' },
];

function PayDialog({ doc, customer, onClose }: { doc: ReceivableDoc; customer: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isTicket = doc.kind === 'ticket';
  const today = format(new Date(), 'yyyy-MM-dd');
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(String(doc.remaining));
  const [date, setDate] = useState(today);
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (isTicket) return salesApi.pay(doc.id, { paymentMethod: method, ...(date !== today ? { paidAt: date } : {}) });
      return paymentsApi.create({
        invoiceId: doc.id, type: 'income', amount: parseFloat(amount), paymentMethod: method, paymentDate: date,
        description: `Encaissement facture ${doc.number} — ${customer}`,
        ...(method === 'check' || method === 'traite' ? { checkNumber, checkDate: checkDate || undefined } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['customer-situation'] });
      notify.success('Encaissement enregistré');
      onClose();
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Encaissement impossible')),
  });

  const value = parseFloat(amount);
  const invalid = !isTicket && (!(value > 0) || value > doc.remaining + 0.001);
  const methods = isTicket ? TICKET_METHODS : INVOICE_METHODS;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', background: 'var(--odoo-bg)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><Banknote size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">Encaisser {isTicket ? 'le ticket' : 'la facture'} {doc.number}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 12, fontSize: '0.8125rem' }}>
          <div style={{ display: 'grid', gap: 4, padding: 10, borderRadius: 6, background: 'var(--odoo-bg-alt, #f8f9fa)' }}>
            <div className="flex justify-between"><span>Client</span><b>{customer}</b></div>
            <div className="flex justify-between"><span>Reste dû</span><b>{money(doc.remaining)}</b></div>
            {doc.days_late > 0 && <div className="flex justify-between" style={{ color: '#dc2626' }}><span>Retard</span><b>{doc.days_late} jours</b></div>}
          </div>
          {!isTicket && (
            <label style={{ display: 'grid', gap: 4 }}>Montant encaissé
              <input type="number" step="0.01" min={0} max={doc.remaining} value={amount} onChange={e => setAmount(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.9375rem', fontWeight: 600 }} />
              <span style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>Un montant inférieur laisse le reste ouvert (règlement partiel).</span>
            </label>
          )}
          {isTicket && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
              Le ticket est soldé en entier ; il entre dans le chiffre d'affaires du jour d'encaissement.
            </p>
          )}
          <label style={{ display: 'grid', gap: 4 }}>Date d'encaissement
            <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4 }} />
          </label>
          <div style={{ display: 'grid', gap: 4 }}>Mode de paiement
            <div className="flex gap-2">
              {methods.map(m => (
                <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                  className={method === m.value ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ flex: 1, justifyContent: 'center' }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {!isTicket && (method === 'check' || method === 'traite') && (
            <div className="grid grid-cols-2 gap-2">
              <label style={{ display: 'grid', gap: 4 }}>N° {method === 'traite' ? 'de la traite' : 'du chèque'}
                <input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4 }} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>Échéance du titre
                <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4 }} />
              </label>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} Confirmer l'encaissement
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/**
 * Relevé de compte client : factures (débit) et règlements (crédit) sur une
 * période, avec solde d'ouverture, solde glissant et solde de clôture.
 */
function StatementDialog({ customerId, name, onClose }: { customerId: string; name: string; onClose: () => void }) {
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y}-12-31`);
  const { data, isLoading } = useQuery<CustomerStatement>({
    queryKey: ['customer-statement', customerId, from, to],
    queryFn: () => customersApi.statement(customerId, from, to),
  });

  const fmt = (d: string) => format(new Date(d + 'T00:00:00'), 'd MMM yyyy', { locale: fr });

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.32)' }}>
      {/* Style Apple (2026-11) : même feuille que la fiche facture (apple-look.css, .kl-sheet). */}
      <div className="odoo-scope kl-sheet w-full" style={{ maxWidth: 780, maxHeight: '92vh' }} onClick={e => e.stopPropagation()} role="dialog" aria-label={`Relevé de compte ${name}`}>
        <header className="kl-sheet-head">
          <span className="ord-mono" aria-hidden="true"><ScrollText size={18} /></span>
          <div className="ord-who">
            <h2>Relevé de compte</h2>
            <p>{name} · du {fmt(from)} au {fmt(to)}</p>
          </div>
          {data && (
            <div className="ord-amt">
              <b>{money(data.closing)}</b>
              <small>{data.closing > 0.004 ? 'solde dû au ' + fmt(to) : 'compte soldé'}</small>
            </div>
          )}
          <button type="button" className="kl-sheet-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>

        <div className="kl-sheet-body">
          <div className="kl-stmt-period">
            <label>Du<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
            <label>Au<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
          </div>

          {data && (
            <div className="kl-stmt-sum">
              <div><span>Solde d'ouverture</span><b>{money(data.opening)}</b></div>
              <div><span>Facturé</span><b>{money(data.totalDebit)}</b></div>
              <div><span>Réglé</span><b className="g">{data.totalCredit > 0 ? '−' : ''}{money(data.totalCredit)}</b></div>
              <div><span>Solde de clôture</span><b className={data.closing > 0.004 ? 'r' : ''}>{money(data.closing)}</b></div>
            </div>
          )}

          <section>
            <div className="kl-sec"><h2>Mouvements</h2>{data && <small>{data.entries.length} écriture{data.entries.length > 1 ? 's' : ''}</small>}</div>
            <div className="kl-group">
              {isLoading ? (
                <div className="kl-empty"><Loader2 size={16} className="animate-spin" /> Chargement…</div>
              ) : (
                <>
                  {data && <div className="kl-stmt-cols"><span>Montant</span><span>Solde</span></div>}
                  {data && (
                    <div className="kl-stmt-row muted">
                      <span className="kl-ic x"><Scale size={15} /></span>
                      <span className="tx"><span className="t1">Solde d'ouverture</span><span className="t2">{fmt(data.from)}</span></span>
                      <span className="kl-stmt-amt" />
                      <span className="kl-stmt-bal">{money(data.opening)}</span>
                    </div>
                  )}
                  {data?.entries.map((e, i) => {
                    const pay = e.kind === 'payment';
                    return (
                      <div key={i} className="kl-stmt-row">
                        <span className={`kl-ic ${pay ? 'g' : 'b'}`}>{pay ? <Banknote size={15} /> : <FileText size={15} />}</span>
                        <span className="tx">
                          <span className="t1">{e.label} <span className="num">{e.number}</span></span>
                          <span className="t2">{fmt(e.date)}</span>
                        </span>
                        <span className={`kl-stmt-amt${pay ? ' g' : ''}`}>{pay ? `−${money(e.credit)}` : `+${money(e.debit)}`}</span>
                        <span className="kl-stmt-bal">{money(e.balance)}</span>
                      </div>
                    );
                  })}
                  {data && data.entries.length === 0 && <div className="kl-empty">Aucun mouvement sur cette période.</div>}
                </>
              )}
            </div>
          </section>
        </div>

        <footer className="kl-sheet-foot">
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}

/**
 * Avances du client (O2C L5) : règlements reçus pas encore affectés à une facture,
 * en 4421. « Affecter » solde une facture ouverte avec l'avance (écriture 4421 → 3421).
 */
function AdvancesBlock({ customerId, invoices }: { customerId: string; invoices: ReceivableDoc[] }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<Record<string, string>>({});
  const { data = [] } = useQuery({ queryKey: ['customer-receipts', customerId], queryFn: () => paymentsApi.customerReceipts(customerId) });
  const advances = data.filter(r => r.unapplied > 0.004);
  const mutation = useMutation({
    mutationFn: (v: { id: string; invoiceId: string }) => paymentsApi.allocateCustomerReceipt(v.id, { invoiceId: v.invoiceId }),
    onSuccess: (r) => {
      ['receivables', 'invoices', 'customer-receipts', 'customer-situation'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      notify.success(`${money(r.allocated)} affectés`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Affectation impossible')),
  });
  if (!advances.length) return null;
  return (
    <div className="kl-ar-adv">
      {advances.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <PiggyBank size={13} style={{ color: '#6f42c1' }} />
          <span>Avance de <b>{money(a.unapplied)}</b> non affectée
            <span style={{ color: 'var(--odoo-text-muted)' }}> · règlement du {day(a.payment_date)}{a.check_number ? ` · n° ${a.check_number}` : ''}</span></span>
          {invoices.length > 0 && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }} onClick={e => e.stopPropagation()}>
              <SearchSelect value={target[a.id] ?? invoices[0].id} onChange={v => setTarget(t => ({ ...t, [a.id]: v }))}
                placeholder="Facture à affecter" width={220} clearable={false} ariaLabel="Facture à affecter"
                options={invoices.map(i => ({ id: String(i.id), label: `${i.number} · reste ${money(i.remaining)}` }))} />
              <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: a.id, invoiceId: target[a.id] ?? invoices[0].id })}>Affecter</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Règlement sur plusieurs factures (O2C L5) : un seul chèque ou virement réparti
 * sur les factures ouvertes du client, des plus anciennes aux plus récentes par
 * défaut ; ce qui reste devient une avance du client (4421).
 */
function ReceiptDialog({ c, onClose }: { c: CustomerReceivable; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const invoices = c.docs.filter(d => d.kind === 'invoice').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const total = parseFloat(amount.replace(',', '.')) || 0;
  const allocated = Math.round(invoices.reduce((s, i) => s + (parseFloat((alloc[i.id] ?? '').replace(',', '.')) || 0), 0) * 100) / 100;
  const rest = Math.round((total - allocated) * 100) / 100;
  /** Répartit le montant sur les factures, de la plus ancienne échéance à la plus récente. */
  const spread = (v: number) => {
    let left = v; const next: Record<string, string> = {};
    for (const i of invoices) { const take = Math.min(left, i.remaining); next[i.id] = take > 0 ? take.toFixed(2) : ''; left = Math.round((left - take) * 100) / 100; }
    setAlloc(next);
  };
  const overInvoice = invoices.some(i => (parseFloat((alloc[i.id] ?? '').replace(',', '.')) || 0) > i.remaining + 0.004);
  const invalid = !(total > 0) || rest < -0.004 || overInvoice || ((method === 'check' || method === 'traite') && !checkNumber.trim());
  const mutation = useMutation({
    mutationFn: () => paymentsApi.createCustomerReceipt({
      customerId: c.customerId!, amount: total, paymentMethod: method, paymentDate: date,
      reference: reference.trim() || undefined, description: `Règlement ${c.name}`,
      ...(method === 'check' || method === 'traite' ? { checkNumber: checkNumber.trim(), checkDate: checkDate || undefined } : {}),
      allocations: invoices.map(i => ({ invoiceId: i.id, amount: parseFloat((alloc[i.id] ?? '').replace(',', '.')) || 0 })).filter(a => a.amount > 0),
    }),
    onSuccess: (r) => {
      ['receivables', 'invoices', 'customer-receipts', 'customer-situation'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      notify.success(r.unapplied > 0.004 ? `Règlement enregistré · ${money(r.unapplied)} en avance du client` : 'Règlement enregistré');
      onClose();
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Règlement impossible')),
  });
  const field = { padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4 } as const;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 620, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', background: 'var(--odoo-bg)' }}>
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb"><Layers size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="odoo-breadcrumb-current">Règlement de {c.name}</span></div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 12, fontSize: '0.8125rem', overflowY: 'auto' }}>
          <div className="grid grid-cols-2 gap-2">
            <label style={{ display: 'grid', gap: 4 }}>Montant reçu
              <input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); spread(parseFloat(e.target.value.replace(',', '.')) || 0); }}
                style={{ ...field, fontSize: '0.9375rem', fontWeight: 600 }} placeholder="0,00" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>Date
              <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} style={field} />
            </label>
          </div>
          <div style={{ display: 'grid', gap: 4 }}>Mode de paiement
            <div className="flex gap-2">
              {INVOICE_METHODS.map(m => (
                <button key={m.value} type="button" onClick={() => setMethod(m.value)}
                  className={method === m.value ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ flex: 1, justifyContent: 'center' }}>{m.label}</button>
              ))}
            </div>
          </div>
          {method === 'check' || method === 'traite' ? (
            <div className="grid grid-cols-2 gap-2">
              <label style={{ display: 'grid', gap: 4 }}>N° {method === 'traite' ? 'de la traite' : 'du chèque'}
                <input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} style={field} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>Échéance du titre
                <input type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} style={field} />
              </label>
            </div>
          ) : (
            <label style={{ display: 'grid', gap: 4 }}>Référence (virement, bordereau)
              <input value={reference} onChange={e => setReference(e.target.value)} style={field} />
            </label>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--odoo-text-muted)', textAlign: 'left' }}>
                <th style={{ padding: 4 }}>Facture</th><th style={{ padding: 4 }}>Échéance</th>
                <th style={{ padding: 4, textAlign: 'right' }}>Reste dû</th><th style={{ padding: 4, textAlign: 'right', width: 120 }}>Affecté</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id} style={{ borderTop: '1px solid var(--odoo-border)' }}>
                  <td style={{ padding: 4, fontFamily: 'ui-monospace, monospace' }}>{i.number}</td>
                  <td style={{ padding: 4, color: i.days_late > 0 ? '#dc2626' : undefined }}>{day(i.due_date)}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{money(i.remaining)}</td>
                  <td style={{ padding: 4 }}>
                    <input inputMode="decimal" value={alloc[i.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [i.id]: e.target.value }))}
                      style={{ ...field, width: '100%', textAlign: 'right' }} placeholder="0,00" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'grid', gap: 4, padding: 10, borderRadius: 6, background: 'var(--odoo-bg-alt, #f8f9fa)' }}>
            <div className="flex justify-between"><span>Affecté aux factures</span><b>{money(allocated)}</b></div>
            <div className="flex justify-between" style={{ color: rest < -0.004 ? '#dc2626' : rest > 0.004 ? '#6f42c1' : undefined }}>
              <span>{rest < -0.004 ? 'Affecté au-delà du montant reçu' : 'Reste en avance du client (4421)'}</span><b>{money(Math.abs(rest))}</b>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="odoo-btn-primary" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Banknote size={13} />} Enregistrer le règlement
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
