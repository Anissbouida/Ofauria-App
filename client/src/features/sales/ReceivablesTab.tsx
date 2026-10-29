import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Wallet, AlertTriangle, Users, ChevronDown, ChevronRight, Banknote, X, Loader2, Receipt, FileText, Phone, ScrollText } from 'lucide-react';
import { salesApi, type AgingBucket, type CustomerReceivable, type ReceivableDoc } from '../../api/sales.api';
import { customersApi, type CustomerStatement } from '../../api/customers.api';
import { paymentsApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Créances clients (mig 351) — remplace l'onglet « Impayés ».
 * Balance âgée par client (Odoo « Aged Receivable », SAP FI-AR, échéancier Sage) :
 * tickets de caisse portés sur le compte client + factures clients ouvertes.
 * « Encaisser » : un ticket se solde en entier (il entre au chiffre d'affaires du
 * jour d'encaissement) ; une facture accepte un règlement partiel, chèque ou traite.
 */

const BUCKETS: Array<{ key: AgingBucket; label: string; tone: string }> = [
  { key: 'current', label: 'Non échu', tone: 'var(--odoo-text)' },
  { key: 'd30', label: '1-30 j', tone: '#b45309' },
  { key: 'd60', label: '31-60 j', tone: '#c2410c' },
  { key: 'd90', label: '61-90 j', tone: '#dc2626' },
  { key: 'over90', label: '+ 90 j', tone: '#991b1b' },
];
const money = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const day = (d: string) => format(new Date(d + 'T00:00:00'), 'dd MMM yyyy', { locale: fr });

type Filter = 'all' | 'overdue' | 'over60';

export default function ReceivablesTab() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<{ doc: ReceivableDoc; customer: string } | null>(null);
  const [statement, setStatement] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['receivables'], queryFn: salesApi.receivables });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.customers ?? []).filter(c => {
      if (filter === 'overdue' && c.overdue <= 0) return false;
      if (filter === 'over60' && c.buckets.d90 + c.buckets.over90 <= 0) return false;
      return !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || c.docs.some(d => d.number.toLowerCase().includes(q));
    });
  }, [data, filter, search]);

  const toggle = (key: string) => setOpen(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const t = data?.totals;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Indicateurs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Wallet} label="Total dû par les clients" value={t ? money(t.total) : '—'} sub={t ? `${t.documents} document${t.documents > 1 ? 's' : ''} ouverts` : ''} />
        <Kpi icon={AlertTriangle} label="Échu (en retard)" value={t ? money(t.overdue) : '—'} sub="à relancer" tone={t && t.overdue > 0 ? '#dc2626' : undefined} />
        <Kpi icon={AlertTriangle} label="Plus de 60 jours" value={t ? money(t.buckets.d90 + t.buckets.over90) : '—'} sub="risque d'impayé" tone={t && t.buckets.d90 + t.buckets.over90 > 0 ? '#991b1b' : undefined} />
        <Kpi icon={Users} label="Clients concernés" value={t ? String(t.customers) : '—'} sub="" />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        {([['all', 'Tous'], ['overdue', 'En retard'], ['over60', '+ 60 jours']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={filter === k ? 'odoo-btn-primary' : 'odoo-btn-secondary'} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8125rem' }}>
            {label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, téléphone ou n° de pièce…"
          style={{ marginLeft: 'auto', minWidth: 260, padding: '0.35rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, fontSize: '0.8125rem' }} />
      </div>

      {/* Balance âgée */}
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 4, overflowX: 'auto' }}>
        <table className="odoo-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Client</th>
              {BUCKETS.map(b => <th key={b.key} style={{ textAlign: 'right' }}>{b.label}</th>)}
              <th style={{ textAlign: 'right' }}>Total dû</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /></td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--odoo-text-muted)' }}>
                {data?.customers.length ? 'Aucun client pour ce filtre' : 'Aucune créance : tous les clients sont à jour.'}
              </td></tr>
            )}
            {rows.map(c => {
              const key = c.customerId ?? c.name;
              const isOpen = open.has(key);
              return (
                <CustomerRows key={key} c={c} isOpen={isOpen} onToggle={() => toggle(key)}
                  onPay={doc => setPaying({ doc, customer: c.name })}
                  onStatement={() => c.customerId && setStatement({ id: c.customerId, name: c.name })} />
              );
            })}
          </tbody>
          {t && rows.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                {BUCKETS.map(b => <td key={b.key} style={{ textAlign: 'right' }}>{t.buckets[b.key] > 0 ? money(t.buckets[b.key]) : '—'}</td>)}
                <td style={{ textAlign: 'right' }}>{money(t.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {paying && <PayDialog doc={paying.doc} customer={paying.customer} onClose={() => setPaying(null)} />}
      {statement && <StatementDialog customerId={statement.id} name={statement.name} onClose={() => setStatement(null)} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Wallet; label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="odoo-stat-card">
      <div className="odoo-stat-card-label"><Icon size={11} style={{ display: 'inline', marginRight: 4 }} />{label}</div>
      <div className="odoo-stat-card-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="odoo-stat-card-sub">{sub}</div>}
    </div>
  );
}

function CustomerRows({ c, isOpen, onToggle, onPay, onStatement }: { c: CustomerReceivable; isOpen: boolean; onToggle: () => void; onPay: (d: ReceivableDoc) => void; onStatement: () => void }) {
  const overLimit = c.creditLimit != null && c.total > c.creditLimit;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            {c.customerType === 'professionnel' && <span className="odoo-tag odoo-tag-blue" style={{ fontSize: '0.625rem' }}>Pro</span>}
            {overLimit && <span className="odoo-tag odoo-tag-red" style={{ fontSize: '0.625rem' }} title={`Plafond ${money(c.creditLimit!)}`}>plafond dépassé</span>}
          </span>
          <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)', marginLeft: 20 }}>
            {c.phone && <><Phone size={10} style={{ display: 'inline', verticalAlign: -1 }} /> {c.phone} · </>}
            {c.docs.length} pièce{c.docs.length > 1 ? 's' : ''}
            {c.maxDaysLate > 0 && <span style={{ color: '#dc2626' }}> · plus ancien retard {c.maxDaysLate} j</span>}
          </div>
        </td>
        {BUCKETS.map(b => (
          <td key={b.key} style={{ textAlign: 'right', color: c.buckets[b.key] > 0 ? b.tone : 'var(--odoo-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {c.buckets[b.key] > 0 ? money(c.buckets[b.key]) : '—'}
          </td>
        ))}
        <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(c.total)}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--odoo-bg-alt, #f8f9fa)', padding: '8px 12px 12px 32px' }}>
            {c.customerId && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button type="button" className="odoo-btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                  onClick={e => { e.stopPropagation(); onStatement(); }}>
                  <ScrollText size={12} /> Relevé de compte
                </button>
              </div>
            )}
            <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--odoo-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: 4 }}>Pièce</th><th style={{ padding: 4 }}>Date</th><th style={{ padding: 4 }}>Échéance</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Montant</th><th style={{ padding: 4, textAlign: 'right' }}>Déjà payé</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Reste dû</th><th />
                </tr>
              </thead>
              <tbody>
                {c.docs.map(d => (
                  <tr key={d.kind + d.id} style={{ borderTop: '1px solid var(--odoo-border)' }}>
                    <td style={{ padding: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {d.kind === 'ticket' ? <Receipt size={12} /> : <FileText size={12} />}
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{d.number}</span>
                        <span className="odoo-tag odoo-tag-grey" style={{ fontSize: '0.625rem' }}>{d.kind === 'ticket' ? 'Ticket' : 'Facture'}</span>
                      </span>
                    </td>
                    <td style={{ padding: 4 }}>{day(d.doc_date)}</td>
                    <td style={{ padding: 4, color: d.days_late > 0 ? '#dc2626' : undefined }}>
                      {day(d.due_date)}{d.days_late > 0 ? ` · ${d.days_late} j de retard` : ''}
                    </td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{money(d.amount)}</td>
                    <td style={{ padding: 4, textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{d.paid > 0 ? money(d.paid) : '—'}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontWeight: 600 }}>{money(d.remaining)}</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>
                      <button type="button" className="odoo-btn-primary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={e => { e.stopPropagation(); onPay(d); }}>
                        <Banknote size={12} /> Encaisser
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()}
        style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(760px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <ScrollText size={16} /> Relevé de compte — {name}
          </div>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
            Du
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
            Au
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit' }} />
          </label>
          {data && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>Solde de clôture</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.closing > 0 ? '#dc2626' : 'var(--odoo-text)', fontVariantNumeric: 'tabular-nums' }}>{money(data.closing)}</div>
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 16px 16px' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--odoo-text-muted)' }}><Loader2 size={18} className="animate-spin" style={{ display: 'inline' }} /></div>
          ) : (
            <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--odoo-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: 4 }}>Date</th><th style={{ padding: 4 }}>Pièce</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Débit</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Crédit</th>
                  <th style={{ padding: 4, textAlign: 'right' }}>Solde</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: '1px solid var(--odoo-border)', color: 'var(--odoo-text-muted)' }}>
                  <td style={{ padding: 4 }}>{data ? day(data.from) : ''}</td>
                  <td style={{ padding: 4, fontStyle: 'italic' }}>Solde d'ouverture</td>
                  <td /><td />
                  <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{data ? money(data.opening) : ''}</td>
                </tr>
                {data?.entries.map((e, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--odoo-border)' }}>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{day(e.date)}</td>
                    <td style={{ padding: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {e.kind === 'payment' ? <Banknote size={12} /> : <FileText size={12} />}
                        {e.label} <span style={{ fontFamily: 'ui-monospace, monospace' }}>{e.number}</span>
                      </span>
                    </td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.debit > 0 ? money(e.debit) : '—'}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--odoo-text-muted)' }}>{e.credit > 0 ? money(e.credit) : '—'}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(e.balance)}</td>
                  </tr>
                ))}
                {data && data.entries.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--odoo-text-muted)' }}>Aucun mouvement sur cette période.</td></tr>
                )}
              </tbody>
              {data && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--odoo-border)', fontWeight: 700 }}>
                    <td style={{ padding: 4 }} colSpan={2}>Total période</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.totalDebit)}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.totalCredit)}</td>
                    <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(data.closing)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
