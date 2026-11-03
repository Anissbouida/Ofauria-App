import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Info, Landmark, Percent, Ban, CheckCircle2, Undo2 } from 'lucide-react';
import { billsApi, type BillEffect, type BillStatus, type BillRemittance } from '../../api/ledger.api';
import { paymentsApi } from '../../api/accounting.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

/**
 * Portefeuille d'effets clients (lot Bonus 15, mig 435) : chèques et traites
 * reçus, remis en banque par bordereau — à l'encaissement, ou à l'escompte pour
 * les traites (la banque avance le nominal moins agios et commissions) —, puis
 * crédités, payés à l'échéance ou revenus impayés (la facture redevient due).
 */

const n = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const mono = { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const num = (s: string) => { const v = Number(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const errMsg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? (e instanceof Error ? e.message : 'Action impossible');

const STATUS: Record<BillStatus, { label: string; tag: string }> = {
  portfolio: { label: 'En portefeuille', tag: 'odoo-tag-blue' },
  remitted: { label: 'Remis à l\'encaissement', tag: 'odoo-tag-yellow' },
  discounted: { label: 'Escompté', tag: 'odoo-tag-purple' },
  cashed: { label: 'Encaissé', tag: 'odoo-tag-green' },
  unpaid: { label: 'Impayé', tag: 'odoo-tag-red' },
};

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope" role="dialog" aria-modal="true" aria-label={title}
        style={{ width: 'min(480px, 94vw)', borderRadius: 6, border: '1px solid var(--theme-bg-separator)', overflow: 'hidden', background: 'var(--theme-bg-primary, #fff)' }}>
        <div className="odoo-section-header">{title}</div>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.8125rem' }}>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--theme-bg-separator)', background: 'var(--theme-bg-page)' }}>{footer}</div>
      </div>
    </ModalBackdrop>
  );
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{label}{children}</label>
);

export default function BillsPortfolioTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<BillStatus | 'open' | 'all'>('open');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remit, setRemit] = useState<'collection' | 'discount' | null>(null);
  const [unpaidFor, setUnpaidFor] = useState<BillEffect | null>(null);
  const [cashFor, setCashFor] = useState<BillEffect | null>(null);
  const [settleFor, setSettleFor] = useState<BillRemittance | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['bills', status], queryFn: () => billsApi.list(status) });
  const { data: remittances = [] } = useQuery({ queryKey: ['bill-remittances'], queryFn: billsApi.remittances });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['bill-remittances'] });
    qc.invalidateQueries({ queryKey: ['payments-checks'] });
    setSelected(new Set());
  };
  const effects = data?.effects ?? [];
  const chosen = useMemo(() => effects.filter(e => selected.has(e.id)), [effects, selected]);
  const chosenTotal = chosen.reduce((s, e) => s + e.amount, 0);
  const onlyTraites = chosen.length > 0 && chosen.every(e => e.payment_method === 'traite');
  const toggle = (id: string) => setSelected(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const cancel = useMutation({
    mutationFn: (id: string) => billsApi.cancel(id),
    onSuccess: () => { refresh(); notify.success('Bordereau annulé : effets remis en portefeuille'); },
    onError: (e) => notify.error(errMsg(e)),
  });

  const t = data?.totals;
  const cards: { label: string; value: number; hint: string; tone?: string }[] = t ? [
    { label: 'En portefeuille', value: t.portfolio, hint: 'à remettre en banque' },
    { label: 'Remis à l\'encaissement', value: t.remitted, hint: 'en attente du crédit bancaire' },
    { label: 'Escomptés non échus', value: t.discounted, hint: 'risque si impayé (5520)' },
    { label: 'Échus non dénoués', value: t.overdue, hint: 'échéance dépassée', tone: t.overdue > 0 ? '#c62828' : undefined },
    { label: 'Impayés', value: t.unpaid, hint: 'factures redevenues dues', tone: t.unpaid > 0 ? '#c62828' : undefined },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatusBanner tone="info" icon={Info} title="Chèques et traites reçus des clients">
        Sélectionnez des effets en portefeuille pour établir un bordereau de remise : à l'encaissement (chèques et traites), ou à l'escompte (traites : la banque avance le nominal moins ses agios et commissions). À l'échéance, l'effet est crédité ou déclaré impayé ; un impayé annule le règlement et la facture redevient due.
      </StatusBanner>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        {cards.map(c => (
          <div key={c.label} className="odoo-section" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--theme-text-muted)' }}>{c.label}</div>
            <div style={{ ...mono, fontSize: '1.125rem', fontWeight: 700, color: c.tone }}>{n(c.value)}</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="odoo-search-panel" style={{ margin: 0, flexWrap: 'wrap', rowGap: 8 }}>
        <select value={status} onChange={e => { setStatus(e.target.value as typeof status); setSelected(new Set()); }} className="odoo-search-input" aria-label="Statut">
          <option value="open">À dénouer (portefeuille, remis, escomptés)</option>
          <option value="portfolio">En portefeuille</option>
          <option value="remitted">Remis à l'encaissement</option>
          <option value="discounted">Escomptés</option>
          <option value="cashed">Encaissés</option>
          <option value="unpaid">Impayés</option>
          <option value="all">Tous</option>
        </select>
        {chosen.length > 0 && (
          <>
            <span style={{ fontSize: '0.8125rem' }}>{chosen.length} effet{chosen.length > 1 ? 's' : ''} · <strong style={mono}>{n(chosenTotal)}</strong></span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" className="odoo-btn-primary" onClick={() => setRemit('collection')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Landmark size={13} /> Remise à l'encaissement
              </button>
              <button type="button" className="odoo-btn-secondary" disabled={!onlyTraites} onClick={() => setRemit('discount')}
                title={onlyTraites ? 'Escompte des traites sélectionnées' : 'Seules les traites s\'escomptent'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Percent size={13} /> Remise à l'escompte
              </button>
            </div>
          </>
        )}
      </div>

      {isLoading ? <Loader2 size={18} className="animate-spin" /> : effects.length === 0 ? (
        <StatusBanner tone="neutral" icon={CheckCircle2} title="Aucun effet dans cette vue">Les chèques et traites reçus en règlement de factures clients apparaissent ici.</StatusBanner>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Échéance</th><th>Effet</th><th>Client · facture</th><th>Reçu le</th>
                <th style={{ textAlign: 'right' }}>Montant</th><th>Statut</th><th />
              </tr>
            </thead>
            <tbody>
              {effects.map(e => {
                const open = e.status === 'portfolio' || e.status === 'remitted' || e.status === 'discounted';
                return (
                  <tr key={e.id}>
                    <td>{e.status === 'portfolio' && <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Sélectionner ${e.check_number ?? e.reference ?? ''}`} />}</td>
                    <td style={{ ...mono, color: e.overdue ? '#c62828' : undefined, fontWeight: e.overdue ? 700 : undefined }}>{fmtDate(e.due_date)}</td>
                    <td>{e.payment_method === 'traite' ? 'Traite' : 'Chèque'} <span style={mono}>{e.check_number ?? e.reference ?? ''}</span></td>
                    <td>{e.customer_name ?? '—'}{e.invoice_number && <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', ...mono }}>{e.invoice_number}</div>}</td>
                    <td style={mono}>{fmtDate(e.received_on)}</td>
                    <td style={{ ...mono, textAlign: 'right' }}>{n(e.amount)}</td>
                    <td>
                      <span className={`odoo-tag ${STATUS[e.status].tag}`}>{STATUS[e.status].label}</span>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                        {e.remittance_number && <span style={mono}>{e.remittance_number}</span>}
                        {e.status === 'cashed' && ` le ${fmtDate(e.cashed_at)}`}
                        {e.status === 'unpaid' && ` le ${fmtDate(e.unpaid_at)}${e.unpaid_fees ? ` · frais ${n(e.unpaid_fees)}` : ''}`}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {open && <button type="button" className="odoo-btn-secondary" onClick={() => setCashFor(e)}>{e.status === 'discounted' ? 'Payé à l\'échéance' : 'Crédité'}</button>}{' '}
                      {open && <button type="button" className="odoo-btn-danger" onClick={() => setUnpaidFor(e)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ban size={12} /> Impayé</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ margin: '8px 0 0', fontSize: '0.875rem', fontWeight: 600 }}>Bordereaux de remise</h3>
      {remittances.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucun bordereau pour l'instant.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Bordereau</th><th>Type</th><th>Date</th><th>Banque</th><th style={{ textAlign: 'right' }}>Effets</th>
                <th style={{ textAlign: 'right' }}>Nominal</th><th style={{ textAlign: 'right' }}>Frais</th><th style={{ textAlign: 'right' }}>Net</th><th>Écriture</th><th />
              </tr>
            </thead>
            <tbody>
              {remittances.map(r => (
                <tr key={r.id} style={{ opacity: r.status === 'cancelled' ? 0.55 : 1 }}>
                  <td style={mono}>{r.remittance_number}{r.status === 'cancelled' && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}>Annulé</span>}</td>
                  <td>{r.kind === 'discount' ? 'Escompte' : 'Encaissement'}</td>
                  <td style={mono}>{fmtDate(r.remittance_date)}</td>
                  <td>{r.bank_label} <span style={{ ...mono, color: 'var(--theme-text-muted)' }}>{r.bank_code}</span></td>
                  <td style={{ ...mono, textAlign: 'right' }}>{r.effects}{r.pending > 0 && r.status === 'posted' && <span style={{ color: 'var(--theme-text-muted)' }}> ({r.pending} à dénouer)</span>}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{n(r.gross_amount)}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{r.kind === 'discount' ? n(r.interest + r.commission + r.commission_vat) : '—'}</td>
                  <td style={{ ...mono, textAlign: 'right' }}>{n(r.net_amount)}</td>
                  <td style={mono}>{r.entry_number ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.status === 'posted' && r.pending > 0 && (
                      <button type="button" className="odoo-btn-secondary" onClick={() => setSettleFor(r)}>{r.kind === 'discount' ? 'Échéance de tous' : 'Créditer tous'}</button>
                    )}{' '}
                    {r.status === 'posted' && r.pending === r.effects && (
                      <button type="button" className="odoo-btn-secondary" aria-label={`Annuler ${r.remittance_number}`} disabled={cancel.isPending}
                        onClick={async () => { if (await confirm(`Annuler le bordereau ${r.remittance_number} ? Les effets reviennent en portefeuille${r.entry_number ? ` et l'écriture ${r.entry_number} est extournée` : ''}.`, { danger: true, confirmLabel: 'Annuler le bordereau', cancelLabel: 'Garder' })) cancel.mutate(r.id); }}>
                        <Undo2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {remit && <RemittanceModal kind={remit} effects={chosen} onClose={() => setRemit(null)} onDone={() => { setRemit(null); refresh(); }} />}
      {unpaidFor && <UnpaidModal effect={unpaidFor} onClose={() => setUnpaidFor(null)} onDone={() => { setUnpaidFor(null); refresh(); }} />}
      {cashFor && (
        <DateModal title={`${cashFor.status === 'discounted' ? 'Paiement à l\'échéance' : 'Crédit bancaire'} — ${cashFor.check_number ?? cashFor.reference ?? ''}`}
          hint={cashFor.status === 'discounted' ? 'La banque a déjà avancé le nominal : l\'échéance dénoue le crédit d\'escompte (5520), sans mouvement de banque.' : 'Date du crédit sur le relevé bancaire.'}
          initial={cashFor.status === 'discounted' && cashFor.due_date <= today() ? cashFor.due_date : today()}
          run={date => paymentsApi.markCashed(cashFor.id, { cashedAt: date })}
          onClose={() => setCashFor(null)} onDone={() => { setCashFor(null); refresh(); notify.success('Effet dénoué'); }} />
      )}
      {settleFor && (
        <DateModal title={`${settleFor.remittance_number} — ${settleFor.kind === 'discount' ? 'échéance des traites' : 'crédit des effets'}`}
          hint={`${settleFor.pending} effet(s) encore à dénouer seront marqués ${settleFor.kind === 'discount' ? 'payés à l\'échéance' : 'crédités'} à cette date.`}
          initial={today()} run={date => billsApi.settle(settleFor.id, date)}
          onClose={() => setSettleFor(null)} onDone={() => { setSettleFor(null); refresh(); notify.success('Bordereau dénoué'); }} />
      )}
    </div>
  );
}

function RemittanceModal({ kind, effects, onClose, onDone }: { kind: 'collection' | 'discount'; effects: BillEffect[]; onClose: () => void; onDone: () => void }) {
  const { data: modes } = useQuery({ queryKey: ['payment-modes'], queryFn: paymentsApi.modes });
  const banks = (modes?.treasuryAccounts ?? []).filter(t => t.kind === 'bank');
  const [bank, setBank] = useState('');
  const [date, setDate] = useState(today());
  const [interest, setInterest] = useState(''), [commission, setCommission] = useState(''), [vat, setVat] = useState('');
  const [note, setNote] = useState('');
  const gross = effects.reduce((s, e) => s + e.amount, 0);
  const fees = kind === 'discount' ? num(interest) + num(commission) + num(vat) : 0;
  const bankId = bank || banks.find(b => b.is_default)?.id || banks[0]?.id || '';
  const save = useMutation({
    mutationFn: () => billsApi.createRemittance({
      kind, treasuryAccountId: bankId, date, paymentIds: effects.map(e => e.id), note: note.trim() || null,
      ...(kind === 'discount' ? { interest: num(interest), commission: num(commission), commissionVat: num(vat) } : {}),
    }),
    onSuccess: r => { notify.success(`Bordereau ${r.remittance_number} établi${r.entry_number ? ` (écriture ${r.entry_number})` : ''}`); onDone(); },
    onError: (e) => notify.error(errMsg(e)),
  });
  return (
    <Modal title={kind === 'discount' ? 'Remise à l\'escompte' : 'Remise à l\'encaissement'} onClose={onClose} footer={
      <>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={!bankId || save.isPending || gross - fees <= 0} onClick={() => save.mutate()}>Établir le bordereau</button>
      </>
    }>
      <div>{effects.length} effet{effects.length > 1 ? 's' : ''} · nominal <strong style={mono}>{n(gross)}</strong></div>
      <Field label="Banque">
        <select value={bankId} onChange={e => setBank(e.target.value)} className="odoo-search-input">
          {banks.map(b => <option key={b.id} value={b.id}>{b.label} ({b.account_code})</option>)}
        </select>
      </Field>
      <Field label="Date de remise"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="odoo-search-input" /></Field>
      {kind === 'discount' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Field label="Agios (intérêts)"><input inputMode="decimal" value={interest} onChange={e => setInterest(e.target.value)} className="odoo-search-input" /></Field>
            <Field label="Commissions HT"><input inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} className="odoo-search-input" /></Field>
            <Field label="TVA sur commissions"><input inputMode="decimal" value={vat} onChange={e => setVat(e.target.value)} className="odoo-search-input" /></Field>
          </div>
          <div>Net crédité par la banque : <strong style={mono}>{n(gross - fees)}</strong></div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>Écriture : banque (net) + 6311 agios + 6147 commissions + 34552 TVA au débit, 5520 crédits d'escompte au crédit. Montants du bordereau de la banque.</div>
        </>
      )}
      <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} className="odoo-search-input" maxLength={500} /></Field>
    </Modal>
  );
}

function UnpaidModal({ effect, onClose, onDone }: { effect: BillEffect; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(effect.due_date <= today() ? effect.due_date : today());
  const [fees, setFees] = useState('');
  const [note, setNote] = useState('');
  const remitted = effect.status !== 'portfolio';
  const save = useMutation({
    mutationFn: () => billsApi.unpaid(effect.id, { date, fees: remitted ? num(fees) : 0, note: note.trim() || null }),
    onSuccess: r => { notify.success(`Impayé enregistré${r.entry_number ? ` (écriture ${r.entry_number})` : ''} : la facture redevient due`); onDone(); },
    onError: (e) => notify.error(errMsg(e)),
  });
  return (
    <Modal title={`Impayé — ${effect.payment_method === 'traite' ? 'traite' : 'chèque'} ${effect.check_number ?? effect.reference ?? ''}`} onClose={onClose} footer={
      <>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-danger" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer l'impayé</button>
      </>
    }>
      <div>{effect.customer_name ?? 'Client'} · <strong style={mono}>{n(effect.amount)}</strong>{effect.invoice_number && <> · facture <span style={mono}>{effect.invoice_number}</span></>}</div>
      <StatusBanner tone="warning" icon={Ban} title="Le règlement sera annulé">
        La créance du client est rouverte (3421) et la facture redevient due.{effect.status === 'discounted' && ' La banque reprend le nominal escompté (5520 / banque).'}
      </StatusBanner>
      <Field label="Date de l'impayé"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="odoo-search-input" /></Field>
      {remitted && <Field label="Frais d'impayé prélevés par la banque"><input inputMode="decimal" value={fees} onChange={e => setFees(e.target.value)} className="odoo-search-input" /></Field>}
      <Field label="Précision"><input value={note} onChange={e => setNote(e.target.value)} className="odoo-search-input" maxLength={500} /></Field>
    </Modal>
  );
}

function DateModal({ title, hint, initial, run, onClose, onDone }: { title: string; hint: string; initial: string; run: (date: string) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(initial);
  const save = useMutation({ mutationFn: () => run(date), onSuccess: onDone, onError: (e) => notify.error(errMsg(e)) });
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button type="button" className="odoo-btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="odoo-btn-primary" disabled={save.isPending || !date} onClick={() => save.mutate()}>Valider</button>
      </>
    }>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{hint}</div>
      <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="odoo-search-input" /></Field>
    </Modal>
  );
}
