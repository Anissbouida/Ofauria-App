import { money, currencySymbol } from '../../utils/money';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertTriangle, ChevronDown, Banknote, FileText, Phone, ScrollText, Layers, PiggyBank, Scale } from 'lucide-react';
import { salesApi, type AgingBucket, type CustomerReceivable, type ReceivableDoc } from '../../api/sales.api';
import { customersApi, type CustomerStatement } from '../../api/customers.api';
import { paymentsApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { apiErrorMessage } from '../../api/errors';
import { RowMenu } from '../../components/ui/RowMenu';
import { ListToolbar, FilterChips, ListKpi, NextStep } from './ListTemplate';
import { EmptyState, NoResultState, LoadingState, ErrorState, DataPanel, TableFooter, Alert, Modal, FormField, FormSection, FormFooter, DateRangeField } from '../../components/ds';

/**
 * Créances clients (mig 351) — remplace l'onglet « Impayés ».
 * Balance âgée par client (Odoo « Aged Receivable », SAP FI-AR, échéancier Sage) :
 * tickets de caisse portés sur le compte client + factures clients ouvertes.
 * « Encaisser » : un ticket se solde en entier (il entre au chiffre d'affaires du
 * jour d'encaissement) ; une facture accepte un règlement partiel, chèque ou traite.
 */

const BUCKETS: Array<{ key: AgingBucket; label: string; tone: string }> = [
  { key: 'current', label: 'Non échu', tone: 'var(--theme-accent)' },
  { key: 'd30', label: '1-30 j', tone: 'var(--ds-warning)' },
  { key: 'd60', label: '31-60 j', tone: 'var(--ds-warning)' },
  { key: 'd90', label: '61-90 j', tone: 'var(--ds-danger)' },
  { key: 'over90', label: '+ 90 j', tone: 'var(--ds-danger)' },
];
const day = (d: string) => format(new Date(d + 'T00:00:00'), 'dd MMM yyyy', { locale: fr });
const n2 = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['receivables'], queryFn: salesApi.receivables });

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

      <FilterChips label="Filtrer les créances" value={filter} onChange={k => setFilter(k as Filter)} chips={[
        { key: 'all', label: 'Tous', count: counts.all },
        { key: 'overdue', label: 'En retard', count: counts.overdue, tone: counts.overdue ? 'late' : undefined, icon: counts.overdue ? AlertTriangle : undefined },
        { key: 'over60', label: '+ 60 jours', count: counts.over60 },
      ]} />
      <ListToolbar search={search} onSearch={setSearch} placeholder="Client, téléphone ou n° de pièce…" />

      {/* Clients débiteurs : une ligne par client, pièces dépliables sous la ligne */}
      {isLoading ? <LoadingState label="Chargement des créances…" />
        : isError ? <ErrorState error={error} onRetry={() => refetch()} />
        : rows.length === 0 ? (
          data?.customers.length
            ? <NoResultState onReset={() => { setFilter('all'); setSearch(''); }} text="Aucun client ne correspond aux filtres." />
            : <EmptyState icon={Scale} title="Aucune créance" text="Tous les clients sont à jour." />
        ) : (
          <DataPanel label="Créances par client"
            footer={<TableFooter note={<>{rows.length} client{rows.length > 1 ? 's' : ''} · total dû <strong>{n2(rows.reduce((a, c) => a + c.total, 0))} {currencySymbol()}</strong></>} />}>
            <table className="odoo-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}><span className="sr-only">Détail</span></th>
                  <th>Client</th>
                  <th className="ds-num">Pièces</th>
                  <th className="ds-num">Plus ancien retard</th>
                  {BUCKETS.map(b => <th key={b.key} className="ds-num">{b.label} ({currencySymbol()})</th>)}
                  <th className="ds-num">Total dû ({currencySymbol()})</th>
                  <th className="ds-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const key = c.customerId ?? c.name;
                  const isOpen = open.has(key);
                  return (
                    <CustomerRow key={key} c={c} isOpen={isOpen} onToggle={() => toggle(key)}
                      onPay={doc => setPaying({ doc, customer: c.name })}
                      onStatement={() => c.customerId && setStatement({ id: c.customerId, name: c.name })}
                      onReceipt={() => setReceipt(c)} />
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
        )}

      {paying && <PayDialog doc={paying.doc} customer={paying.customer} onClose={() => setPaying(null)} />}
      {statement && <StatementDialog customerId={statement.id} name={statement.name} onClose={() => setStatement(null)} />}
      {receipt && <ReceiptDialog c={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

const COLS = 5 + BUCKETS.length;

function CustomerRow({ c, isOpen, onToggle, onPay, onStatement, onReceipt }: { c: CustomerReceivable; isOpen: boolean; onToggle: () => void; onPay: (d: ReceivableDoc) => void; onStatement: () => void; onReceipt: () => void }) {
  const overLimit = c.creditLimit != null && c.total > c.creditLimit;
  const hasInvoices = c.docs.some(d => d.kind === 'invoice');
  return (
    <>
      <tr onClick={onToggle} className={isOpen ? 'ds-selected' : undefined} style={{ cursor: 'pointer' }}>
        <td onClick={e => e.stopPropagation()}>
          <button type="button" className="ds-icon-btn" aria-expanded={isOpen} aria-label={isOpen ? `Masquer les pièces de ${c.name}` : `Voir les pièces de ${c.name}`} onClick={onToggle}>
            <ChevronDown size={16} className={`kl-ar-chev${isOpen ? ' open' : ''}`} />
          </button>
        </td>
        <td>
          <span className="ds-strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {c.name}
            {c.customerType === 'professionnel' && <span className="kl-pill b">Pro</span>}
            {overLimit && <span className="kl-pill r" title={`Plafond ${money(c.creditLimit!)}`}>Plafond dépassé</span>}
          </span>
          {c.phone && <span className="sal-sub"><Phone size={11} style={{ display: 'inline', verticalAlign: -1 }} /> {c.phone}</span>}
        </td>
        <td className="ds-num">{c.docs.length}</td>
        <td className="ds-num">{c.maxDaysLate > 0 ? <span style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>{c.maxDaysLate} j</span> : '—'}</td>
        {BUCKETS.map(b => <td key={b.key} className="ds-num">{c.buckets[b.key] > 0 ? n2(c.buckets[b.key]) : <span style={{ color: 'var(--ds-muted)' }}>—</span>}</td>)}
        <td className="ds-num ds-strong">{n2(c.total)}</td>
        <td className="ds-actions" onClick={e => e.stopPropagation()}>
          {c.docs.length === 1 && <NextStep icon={Banknote} label="Encaisser" onClick={() => onPay(c.docs[0])} />}
          <RowMenu items={[
            { label: isOpen ? 'Masquer les pièces' : 'Voir les pièces', icon: FileText, onSelect: onToggle },
            ...(c.customerId && hasInvoices ? [{ label: 'Règlement sur plusieurs factures', icon: Layers, onSelect: onReceipt }] : []),
            ...(c.customerId ? [{ label: 'Relevé de compte', icon: ScrollText, onSelect: onStatement }] : []),
          ]} />
        </td>
      </tr>

      {isOpen && (
        <tr style={{ cursor: 'default' }}>
          <td colSpan={COLS} style={{ background: 'var(--ds-bg)', padding: 12 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              {c.customerId && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {hasInvoices && (
                    <button type="button" className="odoo-btn-secondary ds-btn-sm"
                      title="Un chèque ou un virement qui règle plusieurs factures ; le reste devient une avance"
                      onClick={onReceipt}>
                      <Layers size={13} /> Règlement sur plusieurs factures
                    </button>
                  )}
                  <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={onStatement}>
                    <ScrollText size={13} /> Relevé de compte
                  </button>
                </div>
              )}
              {c.customerId && <AdvancesBlock customerId={c.customerId} invoices={c.docs.filter(d => d.kind === 'invoice')} />}
              {c.gap != null && Math.abs(c.gap) > 0.005 && (
                <Alert tone="warning" icon={AlertTriangle}>
                  Écart avec le compte 3421&nbsp;: {money(c.gap)} à vérifier
                  {c.legacyTickets > 0.005 ? ` (hors ${money(c.legacyTickets)} de tickets à crédit non comptabilisés)` : ''}
                </Alert>
              )}
              <DataPanel label={`Pièces de ${c.name}`}>
                <table className="odoo-table ds-dense">
                  <thead>
                    <tr>
                      <th>Pièce</th><th>Type</th><th>Émise le</th><th>Échéance</th>
                      <th className="ds-num">Montant ({currencySymbol()})</th><th className="ds-num">Payé ({currencySymbol()})</th><th className="ds-num">Reste dû ({currencySymbol()})</th>
                      <th className="ds-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.docs.map(d => (
                      <tr key={d.kind + d.id} style={{ cursor: 'default' }}>
                        <td><span className="ds-ref">{d.number}</span></td>
                        <td>{d.kind === 'ticket' ? 'Ticket' : 'Facture'}</td>
                        <td>{day(d.doc_date)}</td>
                        <td style={{ color: d.days_late > 0 ? 'var(--ds-danger)' : undefined }}>{day(d.due_date)}{d.days_late > 0 ? ` · ${d.days_late} j de retard` : ''}</td>
                        <td className="ds-num">{n2(d.amount)}</td>
                        <td className="ds-num">{d.paid > 0 ? n2(d.paid) : '—'}</td>
                        <td className="ds-num ds-strong">{n2(d.remaining)}</td>
                        <td className="ds-actions"><NextStep icon={Banknote} label="Encaisser" onClick={() => onPay(d)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            </div>
          </td>
        </tr>
      )}
    </>
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
    <Modal title={`Encaisser ${isTicket ? 'le ticket' : 'la facture'} ${doc.number}`} subtitle={customer} onClose={onClose} width={440} locked={mutation.isPending}
      footer={<FormFooter onCancel={onClose} onSubmit={() => mutation.mutate()} submitLabel="Confirmer l'encaissement" disabled={invalid} busy={mutation.isPending} />}>
      <table className="odoo-table ds-dense" aria-label="Pièce à encaisser">
        <tbody>
          <tr><td>Client</td><td className="ds-strong" style={{ textAlign: 'right' }}>{customer}</td></tr>
          <tr><td>Reste dû ({currencySymbol()})</td><td className="ds-num ds-strong">{n2(doc.remaining)}</td></tr>
          {doc.days_late > 0 && <tr style={{ color: 'var(--ds-danger)' }}><td>Retard</td><td className="ds-num ds-strong">{doc.days_late} jours</td></tr>}
        </tbody>
      </table>
      {!isTicket && (
        <FormField label={`Montant encaissé (${currencySymbol()})`} htmlFor="rp-amount" required
          error={amount !== '' && invalid ? (value > doc.remaining + 0.001 ? `Au plus ${money(doc.remaining)}.` : 'Saisissez un montant supérieur à 0.') : undefined}
          hint="Un montant inférieur laisse le reste ouvert (règlement partiel).">
          <input id="rp-amount" type="number" step="0.01" min={0} max={doc.remaining} value={amount} onChange={e => setAmount(e.target.value)}
            className="ds-input" style={{ fontWeight: 600 }} />
        </FormField>
      )}
      {isTicket && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--ds-muted)' }}>
          Le ticket est soldé en entier ; il entre dans le chiffre d'affaires du jour d'encaissement.
        </p>
      )}
      <FormField label="Date d'encaissement" htmlFor="rp-date" required>
        <input id="rp-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className="ds-input" />
      </FormField>
      <div className="ds-field">
        <span id="rp-method" className="ds-field-label">Mode de paiement</span>
        <div className="flex gap-2" role="radiogroup" aria-labelledby="rp-method">
          {methods.map(m => (
            <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethod(m.value)}
              className={method === m.value ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ flex: 1, justifyContent: 'center' }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!isTicket && (method === 'check' || method === 'traite') && (
        <div className="ds-form-grid">
          <FormField label={`N° ${method === 'traite' ? 'de la traite' : 'du chèque'}`} htmlFor="rp-check">
            <input id="rp-check" value={checkNumber} onChange={e => setCheckNumber(e.target.value)} className="ds-input" />
          </FormField>
          <FormField label="Échéance du titre" htmlFor="rp-check-date">
            <input id="rp-check-date" type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} className="ds-input" />
          </FormField>
        </div>
      )}
    </Modal>
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
    <Modal width={780} onClose={onClose} label={`Relevé de compte ${name}`}
      title="Relevé de compte" subtitle={`${name} · du ${fmt(from)} au ${fmt(to)}`}
      aside={data && (
        <div style={{ textAlign: 'right' }}>
          <div className="ds-strong" style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(data.closing)}</div>
          <small style={{ color: 'var(--ds-muted)' }}>{data.closing > 0.004 ? 'solde dû au ' + fmt(to) : 'compte soldé'}</small>
        </div>
      )}
      footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
      {/* Corps au style Apple (apple-look.css, .kl-sheet), comme la fiche facture. */}
      <div className="kl-sheet" style={{ margin: -20, borderRadius: 0, boxShadow: 'none', overflow: 'visible' }}>
        <div className="kl-sheet-body">
          <DateRangeField from={from} to={to} onFrom={setFrom} onTo={setTo} />

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
                <LoadingState bare />
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
      </div>
    </Modal>
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
  const needsCheck = method === 'check' || method === 'traite';

  return (
    <Modal title={`Règlement de ${c.name}`} subtitle="Un seul règlement réparti sur plusieurs factures" onClose={onClose} width={620} locked={mutation.isPending}
      footer={<FormFooter dirty={total > 0} onCancel={onClose} onSubmit={() => mutation.mutate()} submitLabel="Enregistrer le règlement" disabled={invalid} busy={mutation.isPending} />}>
      <FormSection title="Règlement reçu">
        <div className="ds-form-grid">
          <FormField label={`Montant reçu (${currencySymbol()})`} htmlFor="rc-amount" required>
            <input id="rc-amount" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); spread(parseFloat(e.target.value.replace(',', '.')) || 0); }}
              className="ds-input" style={{ fontWeight: 600 }} placeholder="0,00" />
          </FormField>
          <FormField label="Date" htmlFor="rc-date" required>
            <input id="rc-date" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className="ds-input" />
          </FormField>
        </div>
        <div className="ds-field">
          <span id="rc-method" className="ds-field-label">Mode de paiement</span>
          <div className="flex gap-2" role="radiogroup" aria-labelledby="rc-method">
            {INVOICE_METHODS.map(m => (
              <button key={m.value} type="button" role="radio" aria-checked={method === m.value} onClick={() => setMethod(m.value)}
                className={method === m.value ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ flex: 1, justifyContent: 'center' }}>{m.label}</button>
            ))}
          </div>
        </div>
        {needsCheck ? (
          <div className="ds-form-grid">
            <FormField label={`N° ${method === 'traite' ? 'de la traite' : 'du chèque'}`} htmlFor="rc-check" required>
              <input id="rc-check" value={checkNumber} onChange={e => setCheckNumber(e.target.value)} className="ds-input" />
            </FormField>
            <FormField label="Échéance du titre" htmlFor="rc-check-date">
              <input id="rc-check-date" type="date" value={checkDate} onChange={e => setCheckDate(e.target.value)} className="ds-input" />
            </FormField>
          </div>
        ) : (
          <FormField label="Référence (virement, bordereau)" htmlFor="rc-ref">
            <input id="rc-ref" value={reference} onChange={e => setReference(e.target.value)} className="ds-input" />
          </FormField>
        )}
      </FormSection>
      <FormSection title="Affectation aux factures">
        <DataPanel label="Affectation aux factures">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Facture</th><th>Échéance</th>
                <th className="ds-num">Reste dû ({currencySymbol()})</th><th className="ds-num" style={{ width: 120 }}>Affecté ({currencySymbol()})</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => {
                const over = (parseFloat((alloc[i.id] ?? '').replace(',', '.')) || 0) > i.remaining + 0.004;
                return (
                  <tr key={i.id} style={{ cursor: 'default' }}>
                    <td><span className="ds-ref">{i.number}</span></td>
                    <td style={{ color: i.days_late > 0 ? 'var(--ds-danger)' : undefined }}>{day(i.due_date)}</td>
                    <td className="ds-num">{n2(i.remaining)}</td>
                    <td>
                      <input inputMode="decimal" value={alloc[i.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [i.id]: e.target.value }))}
                        aria-label={`Montant affecté à ${i.number}`} aria-invalid={over || undefined}
                        className="ds-input sm" style={{ textAlign: 'right' }} placeholder="0,00" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} style={{ textAlign: 'right' }}>Affecté aux factures ({currencySymbol()})</td><td className="ds-num ds-strong">{n2(allocated)}</td></tr>
              <tr style={{ color: rest < -0.004 ? 'var(--ds-danger)' : rest > 0.004 ? '#6f42c1' : undefined }}>
                <td colSpan={3} style={{ textAlign: 'right' }}>{rest < -0.004 ? 'Affecté au-delà du montant reçu' : 'Reste en avance du client (4421)'} ({currencySymbol()})</td>
                <td className="ds-num ds-strong">{n2(Math.abs(rest))}</td>
              </tr>
            </tfoot>
          </table>
        </DataPanel>
        {overInvoice && <span className="ds-field-hint" role="alert" style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>Un montant affecté dépasse le reste dû de sa facture.</span>}
      </FormSection>
    </Modal>
  );
}
