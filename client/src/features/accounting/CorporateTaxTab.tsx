import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, CheckCircle2, Landmark, Undo2, AlertTriangle, Settings2, Info } from 'lucide-react';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { corporateTaxApi } from '../../api/ledger.api';
import type { CorporateTax, TaxParams } from '../../api/ledger.api';
import EditionButtons from './EditionButtons';

/**
 * Impôt sur les sociétés (mig 430) : résultat fiscal, IS / cotisation
 * minimale, acomptes trimestriels, charge de l'exercice et solde.
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.')) || 0;
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' } as const;
const inp: React.CSSProperties = { padding: '5px 8px', border: '1px solid var(--theme-bg-separator)', borderRadius: 6, fontSize: '0.8125rem', background: 'var(--theme-bg-input)' };

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="odoo-section" style={{ padding: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--theme-bg-separator)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--theme-bg-secondary)' }}>
        <strong style={{ fontSize: '0.8125rem', flex: 1 }}>{title}</strong>{aside}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}
const Line = ({ label, value, strong, muted }: { label: React.ReactNode; value: number; strong?: boolean; muted?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.8125rem', fontWeight: strong ? 700 : 400, color: muted ? 'var(--theme-text-muted)' : undefined, borderTop: strong ? '1px solid var(--theme-bg-separator)' : undefined }}>
    <span>{label}</span><span style={mono}>{n(value)}</span>
  </div>
);

export default function CorporateTaxTab() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: s, isLoading } = useQuery({ queryKey: ['corporate-tax', year], queryFn: () => corporateTaxApi.get(year) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['corporate-tax'] }); qc.invalidateQueries({ queryKey: ['ledger-entries'] }); };
  const onErr = (e: unknown) => notify.error(apiErrorMessage(e, 'Opération impossible'));
  const draft = s?.status !== 'booked';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="odoo-search-input" style={{ minWidth: 110 }} aria-label="Exercice">
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => <option key={y} value={y}>Exercice {y}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <EditionButtons kind="is" params={{ endDate: `${year}-12-31` }} />
      </div>
      {isLoading || !s ? <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Loader2 size={20} className="animate-spin" /></div> : (
        <>
          {s.status === 'booked'
            ? <StatusBanner tone="success" icon={CheckCircle2} title={`IS ${year} comptabilisé (${s.charge_entry_number})`}>Le calcul est figé. Pour le reprendre, annulez la comptabilisation (aucun solde ne doit être versé).</StatusBanner>
            : <StatusBanner tone="info" icon={Info} title="Calcul provisoire">Le résultat évolue avec les écritures de l'exercice. Comptabilisez la charge d'IS une fois l'exercice arrêté, avant sa clôture.</StatusBanner>}
          <div className="odoo-stat-grid">
            <div className="odoo-stat-card"><div className="odoo-stat-card-label">Résultat fiscal</div><div className="odoo-stat-card-value">{n(s.taxable_result)}</div><div className="odoo-stat-card-sub">comptable {n(s.accounting_result)}</div></div>
            <div className="odoo-stat-card"><div className="odoo-stat-card-label">IS dû</div><div className="odoo-stat-card-value">{n(s.tax_due)}</div><div className="odoo-stat-card-sub">{s.cm_applies ? 'cotisation minimale' : `taux ${s.rate} %`}</div></div>
            <div className="odoo-stat-card"><div className="odoo-stat-card-label">Acomptes et crédit</div><div className="odoo-stat-card-value">{n(s.available)}</div><div className="odoo-stat-card-sub">{n(s.acomptes_paid)} versés cette année</div></div>
            <div className="odoo-stat-card"><div className="odoo-stat-card-label">Reste à payer</div><div className="odoo-stat-card-value" style={{ color: s.balance_due > 0 ? '#c62828' : undefined }}>{n(s.balance_due)}</div><div className="odoo-stat-card-sub">avant le {fmtDate(s.solde_deadline)}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <FiscalResult s={s} draft={draft} refresh={refresh} onErr={onErr} />
            <TaxCalc s={s} draft={draft} refresh={refresh} onErr={onErr} />
          </div>
          <Installments s={s} draft={draft} refresh={refresh} onErr={onErr} />
          <Booking s={s} refresh={refresh} onErr={onErr} />
        </>
      )}
    </div>
  );
}

type P = { s: CorporateTax; draft: boolean; refresh: () => void; onErr: (e: unknown) => void };

function FiscalResult({ s, draft, refresh, onErr }: P) {
  const [kind, setKind] = useState<'reintegration' | 'deduction'>('reintegration');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const add = useMutation({
    mutationFn: () => corporateTaxApi.addAdjustment(s.year, { kind, label: label.trim(), amount: num(amount) }),
    onSuccess: () => { setLabel(''); setAmount(''); refresh(); }, onError: onErr,
  });
  const del = useMutation({ mutationFn: (id: string) => corporateTaxApi.removeAdjustment(id), onSuccess: refresh, onError: onErr });
  return (
    <Section title="Du résultat comptable au résultat fiscal">
      <Line label="Produits de l'exercice" value={s.produits} muted />
      <Line label="Charges (hors IS)" value={s.charges} muted />
      <Line label="Résultat comptable avant impôt" value={s.accounting_result} strong />
      {s.adjustments.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', padding: '3px 0' }}>
          <span style={{ flex: 1 }}>{a.kind === 'reintegration' ? '+ Réintégration' : '− Déduction'} : {a.label}</span>
          <span style={mono}>{a.kind === 'reintegration' ? '' : '−'}{n(a.amount)}</span>
          {draft && <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 5px' }} onClick={() => del.mutate(a.id)} aria-label="Retirer"><Trash2 size={11} /></button>}
        </div>
      ))}
      {draft && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
          <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} style={inp}><option value="reintegration">Réintégration</option><option value="deduction">Déduction</option></select>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder={kind === 'reintegration' ? 'Amendes, charges non déductibles…' : 'Dividendes, déficit antérieur…'} style={{ ...inp, flex: 1, minWidth: 140 }} />
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Montant" inputMode="decimal" style={{ ...inp, width: 110 }} />
          <button type="button" className="odoo-btn-secondary" disabled={label.trim().length < 2 || num(amount) <= 0 || add.isPending} onClick={() => add.mutate()}><Plus size={13} /></button>
        </div>
      )}
      <Line label="Résultat fiscal" value={s.taxable_result} strong />
    </Section>
  );
}

function TaxCalc({ s, draft, refresh, onErr }: P) {
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState<TaxParams>(s.params);
  useEffect(() => setP(s.params), [s.params]);
  const save = useMutation({ mutationFn: () => corporateTaxApi.setParams(s.year, p), onSuccess: () => { setEdit(false); refresh(); }, onError: onErr });
  const field = (k: keyof TaxParams, label: string) => (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.75rem', alignItems: 'center' }}>{label}
      <input value={String(p[k] ?? '')} onChange={e => setP({ ...p, [k]: e.target.value === '' && k === 'cm_base_override' ? null : num(e.target.value) })} inputMode="decimal" style={{ ...inp, width: 130, textAlign: 'right' }} />
    </label>
  );
  return (
    <Section title="Calcul de l'impôt" aside={draft && <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }} onClick={() => setEdit(!edit)}><Settings2 size={12} /> Paramètres</button>}>
      {edit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, marginBottom: 8, background: 'var(--theme-bg-tertiary)', borderRadius: 4 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', alignItems: 'center' }}>Régime
            <select value={p.regime} onChange={e => setP({ ...p, regime: e.target.value as TaxParams['regime'] })} style={inp}><option value="standard">Droit commun</option><option value="credit">Établissement de crédit</option></select>
          </label>
          {field('rate_standard', 'Taux (%)')}{field('rate_high', 'Taux au-delà du seuil (%)')}{field('high_threshold', 'Seuil de bénéfice (DH)')}
          {field('cm_rate', 'Taux de cotisation minimale (%)')}{field('cm_minimum', 'Minimum de CM (DH)')}{field('cm_base_override', 'Base de CM saisie (vide = calculée)')}
          <label style={{ fontSize: '0.75rem' }}><input type="checkbox" checked={p.cm_exempt} onChange={e => setP({ ...p, cm_exempt: e.target.checked })} /> Exonéré de CM (36 premiers mois d'exploitation)</label>
          <button type="button" className="odoo-btn-primary" disabled={save.isPending} onClick={() => save.mutate()} style={{ alignSelf: 'flex-end' }}>Enregistrer</button>
        </div>
      )}
      <Line label={`IS : ${n(Math.max(0, s.taxable_result))} × ${s.rate} %`} value={s.is_amount} />
      <Line label={`Base de CM${s.params.cm_base_override != null ? ' (saisie)' : ''} : ventes, produits accessoires et financiers`} value={s.cm_base} muted />
      <Line label={s.params.cm_exempt ? 'Cotisation minimale (exonérée)' : `Cotisation minimale : ${String(s.params.cm_rate).replace(".", ",")} %, minimum ${n(s.params.cm_minimum)}`} value={s.cm_amount} />
      <Line label={s.cm_applies ? 'IS dû — la cotisation minimale s\'applique' : 'IS dû'} value={s.tax_due} strong />
      <Line label="Résultat net après impôt" value={s.net_result} muted />
    </Section>
  );
}

function PayForm({ defaultAmount, defaultDate, onPay, pending }: { defaultAmount: number | null; defaultDate: string; onPay: (b: { amount: number; date: string; treasury: 'bank' | 'cash' }) => void; pending: boolean }) {
  const [amount, setAmount] = useState(defaultAmount != null ? String(defaultAmount) : '');
  const [date, setDate] = useState(defaultDate);
  const [treasury, setTreasury] = useState<'bank' | 'cash'>('bank');
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="Montant" style={{ ...inp, width: 100, textAlign: 'right' }} aria-label="Montant" />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 130 }} aria-label="Date" />
      <select value={treasury} onChange={e => setTreasury(e.target.value as typeof treasury)} style={inp} aria-label="Règlement"><option value="bank">Banque</option><option value="cash">Caisse</option></select>
      <button type="button" className="odoo-btn-primary" disabled={num(amount) <= 0 || pending} onClick={() => onPay({ amount: num(amount), date, treasury })}>Verser</button>
    </span>
  );
}

function Installments({ s, draft, refresh, onErr }: P) {
  const pay = useMutation({
    mutationFn: (b: { quarter: number; amount: number; date: string; treasury: 'bank' | 'cash' }) => corporateTaxApi.pay(s.year, { kind: 'acompte', ...b }),
    onSuccess: r => { notify.success(`Acompte versé (${r.entry_number})`); refresh(); }, onError: onErr,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => corporateTaxApi.cancelPayment(id, 'Saisie erronée'),
    onSuccess: () => { notify.success('Versement annulé (écriture extournée)'); refresh(); }, onError: onErr,
  });
  return (
    <Section title={`Acomptes provisionnels ${s.year}`} aside={<span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
      {s.basis.source === 'previous' ? `Base : impôt ${s.year - 1} aux taux ${s.year} = ${n(s.basis.tax ?? 0)}` : `Pas d'IS ${s.year - 1} comptabilisé : saisissez les montants`}
    </span>}>
      {s.prior_credit > 0 && <p style={{ margin: '0 0 6px', fontSize: '0.75rem' }}>Crédit d'acomptes de {s.year - 1} : {n(s.prior_credit)} DH, imputé d'abord sur les premiers acomptes.</p>}
      <table className="odoo-table" style={{ margin: 0 }}>
        <thead><tr><th>N°</th><th>Échéance</th><th style={{ textAlign: 'right' }}>Théorique</th><th style={{ textAlign: 'right' }}>Crédit imputé</th><th style={{ textAlign: 'right' }}>À verser</th><th>Versement</th></tr></thead>
        <tbody>
          {s.schedule.map(q => (
            <tr key={q.quarter}>
              <td>{q.quarter}</td>
              <td style={{ fontSize: '0.75rem' }}>{fmtDate(q.due_date)}</td>
              <td style={{ ...mono, textAlign: 'right' }}>{q.theoretical != null ? n(q.theoretical) : '—'}</td>
              <td style={{ ...mono, textAlign: 'right' }}>{q.credit_used ? n(q.credit_used) : ''}</td>
              <td style={{ ...mono, textAlign: 'right' }}>{q.to_pay != null ? n(q.to_pay) : '—'}</td>
              <td>
                {q.payment ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.75rem' }}>
                    <span className="odoo-tag odoo-tag-green">{n(q.payment.amount)} le {fmtDate(q.payment.paid_on)}</span>
                    <span style={{ ...mono, color: '#185fa5' }}>{q.payment.entry_number}</span>
                    {draft && <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 5px' }} onClick={() => cancel.mutate(q.payment!.id)} title="Annuler le versement"><Undo2 size={11} /></button>}
                  </span>
                ) : draft ? (
                  <PayForm defaultAmount={q.to_pay} defaultDate={q.due_date < today() ? today() : q.due_date} pending={pay.isPending} onPay={b => pay.mutate({ quarter: q.quarter, ...b })} />
                ) : <span style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>non versé</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Booking({ s, refresh, onErr }: Omit<P, 'draft'>) {
  const [reason, setReason] = useState('');
  const book = useMutation({ mutationFn: () => corporateTaxApi.book(s.year), onSuccess: r => { notify.success(`Charge d'IS comptabilisée (${r.entry_number})`); refresh(); }, onError: onErr });
  const unbook = useMutation({ mutationFn: () => corporateTaxApi.unbook(s.year, reason.trim()), onSuccess: () => { setReason(''); notify.success('Comptabilisation annulée'); refresh(); }, onError: onErr });
  const paySolde = useMutation({
    mutationFn: (b: { amount: number; date: string; treasury: 'bank' | 'cash' }) => corporateTaxApi.pay(s.year, { kind: 'solde', ...b }),
    onSuccess: r => { notify.success(`Solde versé (${r.entry_number})`); refresh(); }, onError: onErr,
  });
  const cancel = useMutation({ mutationFn: (id: string) => corporateTaxApi.cancelPayment(id, 'Saisie erronée'), onSuccess: refresh, onError: onErr });
  const rest = Math.round((s.tax_due - s.imputed) * 100) / 100;
  return (
    <Section title="Charge de l'exercice et solde">
      {s.status !== 'booked' ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.8125rem', flex: 1, minWidth: 260 }}>
            Écriture au 31/12/{s.year} : <span style={mono}>6701</span> débit {n(s.tax_due)} ; <span style={mono}>3453</span> crédit {n(s.imputed)} (acomptes imputés) ;
            {' '}<span style={mono}>4453</span> crédit {n(rest)} (reste dû).
          </div>
          <button type="button" className="odoo-btn-primary" disabled={s.tax_due <= 0 || book.isPending} onClick={() => book.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {book.isPending ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} Comptabiliser l'IS {s.year}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Line label="IS dû" value={s.tax_due} />
          <Line label="Acomptes imputés" value={s.imputed} />
          {s.payments.filter(p => p.kind === 'solde').map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8125rem' }}>
              <span style={{ flex: 1 }}>Solde versé le {fmtDate(p.paid_on)} <span style={{ ...mono, color: '#185fa5' }}>{p.entry_number}</span></span>
              <span style={mono}>{n(p.amount)}</span>
              <button type="button" className="odoo-btn-secondary" style={{ padding: '2px 5px' }} onClick={() => cancel.mutate(p.id)} title="Annuler le versement"><Undo2 size={11} /></button>
            </div>
          ))}
          <Line label="Reste à payer" value={s.balance_due} strong />
          {s.credit_after > 0 && <StatusBanner tone="info" icon={Info} title={`Crédit d'acomptes de ${n(s.credit_after)} DH`}>Il reste au compte 3453 et s'imputera sur les acomptes de {s.year + 1}.</StatusBanner>}
          {s.balance_due > 0 && <div style={{ fontSize: '0.8125rem' }}>Verser le solde (avant le {fmtDate(s.solde_deadline)}) : <PayForm defaultAmount={s.balance_due} defaultDate={today()} pending={paySolde.isPending} onPay={b => paySolde.mutate(b)} /></div>}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid var(--theme-bg-separator)', paddingTop: 8 }}>
            <AlertTriangle size={13} style={{ color: '#856404' }} />
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif pour annuler la comptabilisation" style={{ ...inp, flex: 1 }} />
            <button type="button" className="odoo-btn-secondary" disabled={reason.trim().length < 3 || unbook.isPending} onClick={() => unbook.mutate()}><Undo2 size={12} /> Annuler la comptabilisation</button>
          </div>
        </div>
      )}
    </Section>
  );
}
