import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Landmark, Percent, Ban, CheckCircle2, Undo2, type LucideIcon } from 'lucide-react';
import { billsApi, type BillEffect, type BillStatus, type BillRemittance } from '../../api/ledger.api';
import { paymentsApi } from '../../api/accounting.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { LoadingState, ErrorState, DataPanel, KpiGrid, KpiCard, EmptyState, TableFooter, BulkBar, SectionHeader, Modal, FormSection, FormField, FormFooter } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { currencySymbol } from '../../utils/money';

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

/** En portefeuille = à remettre en banque (action attendue) ; remis / escompté = en cours. */
const STATUS: Record<BillStatus, { label: string; tone: StatusTone; icon?: LucideIcon }> = {
  portfolio: { label: 'En portefeuille', tone: 'todo' },
  remitted: { label: 'Remis à l\'encaissement', tone: 'progress', icon: Landmark },
  discounted: { label: 'Escompté', tone: 'progress', icon: Percent },
  cashed: { label: 'Encaissé', tone: 'done' },
  unpaid: { label: 'Impayé', tone: 'blocked' },
};

export default function BillsPortfolioTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<BillStatus | 'open' | 'all'>('open');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remit, setRemit] = useState<'collection' | 'discount' | null>(null);
  const [unpaidFor, setUnpaidFor] = useState<BillEffect | null>(null);
  const [cashFor, setCashFor] = useState<BillEffect | null>(null);
  const [settleFor, setSettleFor] = useState<BillRemittance | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['bills', status], queryFn: () => billsApi.list(status) });
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
  const cards: { label: string; value: number; hint: string; tone?: 'red' }[] = t ? [
    { label: 'En portefeuille', value: t.portfolio, hint: 'à remettre en banque' },
    { label: 'Remis à l\'encaissement', value: t.remitted, hint: 'en attente du crédit bancaire' },
    { label: 'Escomptés non échus', value: t.discounted, hint: 'risque si impayé (5520)' },
    { label: 'Échus non dénoués', value: t.overdue, hint: 'échéance dépassée', tone: t.overdue > 0 ? 'red' : undefined },
    { label: 'Impayés', value: t.unpaid, hint: 'factures redevenues dues', tone: t.unpaid > 0 ? 'red' : undefined },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatusBanner tone="info" icon={Info} title="Chèques et traites reçus des clients">
        Sélectionnez des effets en portefeuille pour établir un bordereau de remise : à l'encaissement (chèques et traites), ou à l'escompte (traites : la banque avance le nominal moins ses agios et commissions). À l'échéance, l'effet est crédité ou déclaré impayé ; un impayé annule le règlement et la facture redevient due.
      </StatusBanner>
      <KpiGrid>
        {cards.map(c => <KpiCard key={c.label} label={c.label} value={n(c.value)} sub={c.hint} tone={c.tone} />)}
      </KpiGrid>

      <div className="prj-toolbar">
        <select value={status} onChange={e => { setStatus(e.target.value as typeof status); setSelected(new Set()); }} className="ds-input sm" style={{ width: 'auto' }} aria-label="Statut">
          <option value="open">À dénouer (portefeuille, remis, escomptés)</option>
          <option value="portfolio">En portefeuille</option>
          <option value="remitted">Remis à l'encaissement</option>
          <option value="discounted">Escomptés</option>
          <option value="cashed">Encaissés</option>
          <option value="unpaid">Impayés</option>
          <option value="all">Tous</option>
        </select>
      </div>

      {isLoading ? <LoadingState /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : effects.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Aucun effet dans cette vue" text="Les chèques et traites reçus en règlement de factures clients apparaissent ici." />
      ) : (
        <DataPanel label="Effets" footer={<TableFooter note={`${effects.length} effet${effects.length > 1 ? 's' : ''} · montants en ${currencySymbol()}`} />}
          bulk={
            <BulkBar count={chosen.length} noun="effet" detail={<span className="ds-num">{n(chosenTotal)} {currencySymbol()}</span>} onClear={() => setSelected(new Set())}>
              <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!onlyTraites} onClick={() => setRemit('discount')}
                title={onlyTraites ? 'Escompte des traites sélectionnées' : 'Seules les traites s\'escomptent'}>
                <Percent size={13} aria-hidden="true" /> Remise à l'escompte
              </button>
              <button type="button" className="odoo-btn-primary ds-btn-sm" onClick={() => setRemit('collection')}>
                <Landmark size={13} aria-hidden="true" /> Remise à l'encaissement
              </button>
            </BulkBar>
          }>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th style={{ width: 28 }}><span className="ds-sr-only">Sélection</span></th>
                <th>Échéance</th><th>Effet</th><th>Client · facture</th><th>Reçu le</th>
                <th className="ds-num">Montant ({currencySymbol()})</th><th>Statut</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {effects.map(e => {
                const open = e.status === 'portfolio' || e.status === 'remitted' || e.status === 'discounted';
                return (
                  <tr key={e.id} className={selected.has(e.id) ? 'ds-selected' : undefined}>
                    <td>{e.status === 'portfolio' && <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Sélectionner ${e.check_number ?? e.reference ?? ''}`} />}</td>
                    <td style={{ color: e.overdue ? 'var(--ds-danger)' : undefined, fontWeight: e.overdue ? 600 : undefined }}>{fmtDate(e.due_date)}</td>
                    <td>{e.payment_method === 'traite' ? 'Traite' : 'Chèque'} <span className="ds-ref">{e.check_number ?? e.reference ?? ''}</span></td>
                    <td><span className="ds-strong">{e.customer_name ?? '—'}</span>{e.invoice_number && <div className="ds-ref" style={{ fontSize: 12, fontWeight: 400, color: 'var(--ds-muted)' }}>{e.invoice_number}</div>}</td>
                    <td>{fmtDate(e.received_on)}</td>
                    <td className="ds-num">{n(e.amount)}</td>
                    <td>
                      <StatusTag tone={STATUS[e.status].tone} icon={STATUS[e.status].icon} label={STATUS[e.status].label} />
                      <div style={{ fontSize: 11, color: 'var(--ds-muted)' }}>
                        {e.remittance_number && <span style={mono}>{e.remittance_number}</span>}
                        {e.status === 'cashed' && ` le ${fmtDate(e.cashed_at)}`}
                        {e.status === 'unpaid' && ` le ${fmtDate(e.unpaid_at)}${e.unpaid_fees ? ` · frais ${n(e.unpaid_fees)}` : ''}`}
                      </div>
                    </td>
                    <td className="ds-actions">
                      {open && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setCashFor(e)}>{e.status === 'discounted' ? 'Payé à l\'échéance' : 'Crédité'}</button>}
                      {open && <RowMenu items={[{ label: 'Déclarer impayé', icon: Ban, danger: true, onSelect: () => setUnpaidFor(e) }]} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      <SectionHeader title="Bordereaux de remise" note={remittances.length ? `${remittances.length} bordereau${remittances.length > 1 ? 'x' : ''}` : undefined} />
      {remittances.length === 0 ? (
        <EmptyState icon={Landmark} title="Aucun bordereau" text="Sélectionnez des effets en portefeuille pour établir la première remise." />
      ) : (
        <DataPanel label="Bordereaux de remise">
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Bordereau</th><th>Type</th><th>Date</th><th>Banque</th><th className="ds-num">Effets</th>
                <th className="ds-num">Nominal ({currencySymbol()})</th><th className="ds-num">Frais ({currencySymbol()})</th><th className="ds-num">Net ({currencySymbol()})</th><th>Écriture</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {remittances.map(r => (
                <tr key={r.id} style={{ opacity: r.status === 'cancelled' ? 0.55 : 1 }}>
                  <td className="ds-ref">{r.remittance_number}{r.status === 'cancelled' && <span style={{ marginLeft: 6 }}><StatusTag tone="cancelled" label="Annulé" /></span>}</td>
                  <td>{r.kind === 'discount' ? 'Escompte' : 'Encaissement'}</td>
                  <td>{fmtDate(r.remittance_date)}</td>
                  <td>{r.bank_label} <span style={{ ...mono, color: 'var(--ds-muted)' }}>{r.bank_code}</span></td>
                  <td className="ds-num">{r.effects}{r.pending > 0 && r.status === 'posted' && <span style={{ color: 'var(--ds-muted)' }}> ({r.pending} à dénouer)</span>}</td>
                  <td className="ds-num">{n(r.gross_amount)}</td>
                  <td className="ds-num">{r.kind === 'discount' ? n(r.interest + r.commission + r.commission_vat) : '—'}</td>
                  <td className="ds-num">{n(r.net_amount)}</td>
                  <td className="ds-ref">{r.entry_number ?? '—'}</td>
                  <td className="ds-actions">
                    {r.status === 'posted' && r.pending > 0 && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setSettleFor(r)}>{r.kind === 'discount' ? 'Échéance de tous' : 'Créditer tous'}</button>
                    )}
                    {r.status === 'posted' && r.pending === r.effects && (
                      <RowMenu items={[{ label: 'Annuler le bordereau', icon: Undo2, danger: true, disabled: cancel.isPending, onSelect: async () => {
                        if (await confirm(`Annuler le bordereau ${r.remittance_number} ? Les effets reviennent en portefeuille${r.entry_number ? ` et l'écriture ${r.entry_number} est extournée` : ''}.`, { danger: true, confirmLabel: 'Annuler le bordereau', cancelLabel: 'Garder' })) cancel.mutate(r.id);
                      } }]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
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
    <Modal title={kind === 'discount' ? 'Remise à l\'escompte' : 'Remise à l\'encaissement'} onClose={onClose} width={520} locked={save.isPending}
      subtitle={<>{effects.length} effet{effects.length > 1 ? 's' : ''} · nominal <strong className="ds-num">{n(gross)} {currencySymbol()}</strong></>}
      footer={<FormFooter onCancel={onClose} submitLabel="Établir le bordereau" onSubmit={() => save.mutate()} busy={save.isPending} disabled={!bankId || gross - fees <= 0} />}>
      <FormSection title="Remise">
        <div className="ds-form-grid">
          <FormField label="Banque" htmlFor="rem-bank" required>
            <select id="rem-bank" value={bankId} onChange={e => setBank(e.target.value)} className="ds-input">
              {banks.map(b => <option key={b.id} value={b.id}>{b.label} ({b.account_code})</option>)}
            </select>
          </FormField>
          <FormField label="Date de remise" htmlFor="rem-date" required><input id="rem-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" /></FormField>
        </div>
      </FormSection>
      {kind === 'discount' && (
        <FormSection title={`Frais du bordereau (${currencySymbol()})`}>
          <div className="ds-form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <FormField label="Agios (intérêts)" htmlFor="rem-int"><input id="rem-int" inputMode="decimal" value={interest} onChange={e => setInterest(e.target.value)} className="ds-input" /></FormField>
            <FormField label="Commissions HT" htmlFor="rem-com"><input id="rem-com" inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} className="ds-input" /></FormField>
            <FormField label="TVA sur commissions" htmlFor="rem-vat"><input id="rem-vat" inputMode="decimal" value={vat} onChange={e => setVat(e.target.value)} className="ds-input" /></FormField>
          </div>
          <div>Net crédité par la banque : <strong className="ds-num">{n(gross - fees)} {currencySymbol()}</strong></div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-muted)' }}>Écriture : banque (net) + 6311 agios + 6147 commissions + 34552 TVA au débit, 5520 crédits d'escompte au crédit. Montants du bordereau de la banque.</p>
        </FormSection>
      )}
      <FormField label="Note" htmlFor="rem-note"><input id="rem-note" value={note} onChange={e => setNote(e.target.value)} className="ds-input" maxLength={500} /></FormField>
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
    <Modal title={`Impayé — ${effect.payment_method === 'traite' ? 'traite' : 'chèque'} ${effect.check_number ?? effect.reference ?? ''}`} onClose={onClose} width={520} locked={save.isPending}
      subtitle={<>{effect.customer_name ?? 'Client'} · <strong className="ds-num">{n(effect.amount)} {currencySymbol()}</strong>{effect.invoice_number && <> · facture <span className="ds-ref">{effect.invoice_number}</span></>}</>}
      footer={
        <div className="ds-form-foot">
          <span className="ds-grow" />
          <button type="button" className="odoo-btn-secondary" onClick={onClose} disabled={save.isPending}>Annuler</button>
          <button type="button" className="ds-btn-danger solid" disabled={save.isPending} aria-busy={save.isPending || undefined} onClick={() => save.mutate()}>Enregistrer l'impayé</button>
        </div>
      }>
      <StatusBanner tone="warning" icon={Ban} title="Le règlement sera annulé">
        La créance du client est rouverte (3421) et la facture redevient due.{effect.status === 'discounted' && ' La banque reprend le nominal escompté (5520 / banque).'}
      </StatusBanner>
      <FormSection title="Impayé">
        <div className="ds-form-grid">
          <FormField label="Date de l'impayé" htmlFor="unp-date" required><input id="unp-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" /></FormField>
          {remitted && <FormField label={`Frais prélevés par la banque (${currencySymbol()})`} htmlFor="unp-fees"><input id="unp-fees" inputMode="decimal" value={fees} onChange={e => setFees(e.target.value)} className="ds-input" /></FormField>}
        </div>
        <FormField label="Précision" htmlFor="unp-note"><input id="unp-note" value={note} onChange={e => setNote(e.target.value)} className="ds-input" maxLength={500} /></FormField>
      </FormSection>
    </Modal>
  );
}

function DateModal({ title, hint, initial, run, onClose, onDone }: { title: string; hint: string; initial: string; run: (date: string) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(initial);
  const save = useMutation({ mutationFn: () => run(date), onSuccess: onDone, onError: (e) => notify.error(errMsg(e)) });
  return (
    <Modal title={title} onClose={onClose} width={480} locked={save.isPending}
      footer={<FormFooter onCancel={onClose} submitLabel="Valider" onSubmit={() => save.mutate()} busy={save.isPending} disabled={!date} />}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>{hint}</p>
      <FormField label="Date" htmlFor="bill-date" required><input id="bill-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="ds-input" /></FormField>
    </Modal>
  );
}
