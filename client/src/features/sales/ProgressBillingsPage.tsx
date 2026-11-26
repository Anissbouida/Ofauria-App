import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HardHat, Check, Save, X } from 'lucide-react';
import { computeProgressBilling } from '@ofauria/shared';
import { money } from '../../utils/money';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { progressBillingsApi, type ProgressContract } from '../../api/progress-billings.api';
import SalesPageShell from './SalesPageShell';
import { ListKpi } from './ListTemplate';
import { TableFooter, EmptyState, LoadingState, ErrorState, DataPanel, FormField } from '../../components/ds';

/**
 * Ventes › Situations de travaux (facturation à l'avancement, mig 713 ; maquette
 * « Ventes-BTP-Situation »). Le marché est un devis accepté ; chaque situation fixe le %
 * cumulé de chaque ouvrage. L'aperçu utilise la même fonction partagée que le serveur.
 */
const n2 = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (b > 0 ? Math.round(a / b * 1000) / 10 : 0);

export default function ProgressBillingsPage() {
  const { data: contracts = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['progress-contracts'], queryFn: progressBillingsApi.contracts });
  const [selected, setSelected] = useState<string>('');
  useEffect(() => { if (!selected && contracts.length) setSelected(contracts[0].id); }, [contracts, selected]);
  const current = contracts.find(c => c.id === selected);
  const totals = useMemo(() => contracts.reduce((a, c) => ({ contract: a.contract + c.contract_ht, done: a.done + c.cumulative_ht, held: a.held + c.retention_held }), { contract: 0, done: 0, held: 0 }), [contracts]);

  return (
    <SalesPageShell icon={HardHat} title="Situations de travaux" parent="Ventes" list
      summary={`${contracts.length} marché${contracts.length > 1 ? 's' : ''} · ${pct(totals.done, totals.contract)} % réalisé`}>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Montant des marchés (HT)" value={money(totals.contract)} sub="devis acceptés" />
        <ListKpi label="Facturé à l'avancement (HT)" value={money(totals.done)} sub={`${pct(totals.done, totals.contract)} % des marchés`} />
        <ListKpi label="Reste à facturer (HT)" value={money(totals.contract - totals.done)} sub="selon l'avancement" />
        <ListKpi label="Retenues de garantie" value={money(totals.held)} sub="à libérer à la réception des travaux" tone={totals.held > 0 ? 'orange' : undefined} />
      </section>
      <p className="prj-note">Une situation fixe le pourcentage d'avancement cumulé de chaque ouvrage. La période facturée est le cumul moins la situation précédente ; la retenue de garantie et le remboursement de l'avance sont déduits avant la TVA.</p>

      {isLoading ? <LoadingState label="Chargement des marchés…" /> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : !contracts.length ? (
        <EmptyState icon={HardHat} title="Aucun marché à facturer" text="Un devis accepté devient un marché facturable par situations de travaux." />
      ) : (
        <>
          <DataPanel label="Marchés" footer={<TableFooter note={`${contracts.length} marché${contracts.length > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>Marché</th><th>Client</th><th className="ds-num">Montant HT</th><th>Avancement</th><th className="ds-num">Situations</th><th className="ds-num">Retenue</th><th>État</th></tr></thead>
              <tbody>
                {contracts.map(c => {
                  const p = pct(c.cumulative_ht, c.contract_ht);
                  return (
                    <tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: 'pointer', background: c.id === selected ? '#EEF3FE' : undefined }} aria-selected={c.id === selected}>
                      <td><span className="ds-strong">{c.number}</span>{c.title && <span className="sal-sub">{c.title}</span>}</td>
                      <td>{c.customer_name ?? '—'}</td>
                      <td className="ds-num">{n2(c.contract_ht)}</td>
                      <td style={{ minWidth: 150 }}>{p} %<span className={`prj-bar ${p >= 100 ? 'green' : ''}`} style={{ marginTop: 4 }}><span style={{ width: `${Math.min(100, p)}%` }} /></span></td>
                      <td className="ds-num">{c.situations}</td>
                      <td className="ds-num">{n2(c.retention_held)}</td>
                      <td>{c.has_draft ? <StatusTag tone="draft" label="Situation en préparation" /> : p >= 100 ? <StatusTag tone="done" label="Terminé" /> : <StatusTag tone="progress" label="En cours" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
          {current && <ContractDetail key={current.id} contract={current} />}
        </>
      )}
    </SalesPageShell>
  );
}

function ContractDetail({ contract }: { contract: ProgressContract }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const prep = useQuery({ queryKey: ['progress-prepare', contract.id], queryFn: () => progressBillingsApi.prepare(contract.id) });
  const history = useQuery({ queryKey: ['progress-list', contract.id], queryFn: () => progressBillingsApi.list(contract.id) });
  const draft = history.data?.find(b => b.status === 'draft');
  const validated = (history.data ?? []).filter(b => b.status === 'validated');
  const [pcts, setPcts] = useState<Record<string, string>>({});
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState({ retentionPct: String(contract.retention_pct), advanceAmount: String(contract.advance_amount), advanceRecoveryPct: String(contract.advance_recovery_pct) });

  // Une situation en préparation reprend ses pourcentages ; sinon on part de la précédente.
  const draftDetail = useQuery({ queryKey: ['progress-billing', draft?.id], queryFn: () => progressBillingsApi.get(draft!.id), enabled: !!draft });
  useEffect(() => {
    if (!prep.data) return;
    const fromDraft = new Map((draftDetail.data?.lines ?? []).map(l => [l.quote_item_id, l.pct_cumulative]));
    setPcts(Object.fromEntries(prep.data.items.map(i => [i.quoteItemId, String(Number(fromDraft.get(i.quoteItemId) ?? i.previousPct))])));
    if (draftDetail.data?.period_end) setPeriodEnd(String(draftDetail.data.period_end).slice(0, 10));
  }, [prep.data, draftDetail.data]);

  const preview = useMemo(() => prep.data ? computeProgressBilling(
    prep.data.items.map(i => ({ contractAmount: i.contractAmount, tvaRate: i.tvaRate, previousCumulative: i.previousCumulative, pctCumulative: Number(pcts[i.quoteItemId] ?? i.previousPct) })),
    prep.data.settings) : null, [prep.data, pcts]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['progress-contracts'] });
    qc.invalidateQueries({ queryKey: ['progress-prepare', contract.id] });
    qc.invalidateQueries({ queryKey: ['progress-list', contract.id] });
    qc.invalidateQueries({ queryKey: ['progress-billing'] });
  };
  const onError = (e: unknown) => notify.error(apiErrorMessage(e));
  const save = useMutation({
    mutationFn: () => progressBillingsApi.saveDraft(contract.id, { periodEnd, lines: Object.entries(pcts).map(([quoteItemId, v]) => ({ quoteItemId, pctCumulative: Number(v) })) }),
    onSuccess: () => { notify.success('Situation enregistrée'); refresh(); }, onError,
  });
  const validate = useMutation({ mutationFn: (id: string) => progressBillingsApi.validate(id), onSuccess: () => { notify.success('Situation validée'); refresh(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => progressBillingsApi.cancel(id), onSuccess: refresh, onError });
  const saveTerms = useMutation({
    mutationFn: () => progressBillingsApi.setTerms(contract.id, { retentionPct: Number(terms.retentionPct), advanceAmount: Number(terms.advanceAmount), advanceRecoveryPct: Number(terms.advanceRecoveryPct) }),
    onSuccess: () => { notify.success('Conditions du marché enregistrées'); refresh(); }, onError,
  });

  if (prep.isLoading || history.isLoading) return <LoadingState label="Chargement du marché…" />;
  if (prep.isError) return <ErrorState error={prep.error} onRetry={() => prep.refetch()} />;
  const p = prep.data!;
  const frozen = validated.length > 0;
  const rows: React.ReactNode[] = [];
  let lastLot: string | null = null;
  p.items.forEach((i, idx) => {
    if (i.lot && i.lot !== lastLot) rows.push(<tr key={`lot-${idx}`}><td colSpan={7} className="ds-strong" style={{ background: '#F8FAFC' }}>{i.lot}</td></tr>);
    lastLot = i.lot;
    const c = preview?.lines[idx];
    rows.push(
      <tr key={i.quoteItemId}>
        <td>{i.label}</td>
        <td className="ds-num">{n2(i.contractAmount)}</td>
        <td className="ds-num">{i.previousPct} %</td>
        <td className="ds-num"><input className="ds-input sm" type="number" min={i.previousPct} max={100} step="1" style={{ width: 80, textAlign: 'right' }}
          aria-label={`% cumulé — ${i.label}`} value={pcts[i.quoteItemId] ?? ''} onChange={e => setPcts({ ...pcts, [i.quoteItemId]: e.target.value })} /></td>
        <td className="ds-num">{n2(c?.amountCumulative)}</td>
        <td className="ds-num">{n2(c?.amountPrevious)}</td>
        <td className="ds-num ds-strong">{n2(c?.amountPeriod)}</td>
      </tr>);
  });

  return (
    <>
      <DataPanel label={`Conditions du marché ${p.quote.number}`}>
        <div className="ds-form-grid" style={{ padding: 16, alignItems: 'end' }}>
          <FormField label="Retenue de garantie (%)" htmlFor="pb-ret">
            <input id="pb-ret" className="ds-input" type="number" step="0.5" min={0} max={100} disabled={frozen} value={terms.retentionPct} onChange={e => setTerms({ ...terms, retentionPct: e.target.value })} />
          </FormField>
          <FormField label="Avance de démarrage (HT)" htmlFor="pb-adv">
            <input id="pb-adv" className="ds-input" type="number" min={0} disabled={frozen} value={terms.advanceAmount} onChange={e => setTerms({ ...terms, advanceAmount: e.target.value })} />
          </FormField>
          <FormField label="Remboursement de l'avance (% par situation)" htmlFor="pb-rec">
            <input id="pb-rec" className="ds-input" type="number" step="0.5" min={0} max={100} disabled={frozen} value={terms.advanceRecoveryPct} onChange={e => setTerms({ ...terms, advanceRecoveryPct: e.target.value })} />
          </FormField>
          {frozen ? <p className="sal-sub">Figées depuis la première situation validée.</p>
            : <button type="button" className="odoo-btn-secondary" disabled={saveTerms.isPending} onClick={() => saveTerms.mutate()}>Enregistrer les conditions</button>}
        </div>
      </DataPanel>

      <DataPanel label={`Situation n° ${draft?.situation_no ?? p.situationNo}`} footer={preview && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '12px 20px', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
          <span>Période HT <b>{n2(preview.periodHt)}</b></span>
          <span>Retenue <b>− {n2(preview.retentionAmount)}</b></span>
          <span>Avance <b>− {n2(preview.advanceRecoveryAmount)}</b></span>
          <span>Net HT <b>{n2(preview.netHt)}</b></span>
          <span>TVA <b>{n2(preview.taxAmount)}</b></span>
          <span className="ds-strong">Net à payer TTC {n2(preview.totalTtc)}</span>
        </div>
      )}>
        <div style={{ display: 'flex', gap: 12, padding: '12px 20px', alignItems: 'end', flexWrap: 'wrap' }}>
          <FormField label="Fin de période" htmlFor="pb-end">
            <input id="pb-end" className="ds-input" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </FormField>
          <span style={{ flex: 1 }} />
          {draft && <button type="button" className="odoo-btn-secondary" onClick={async () => {
            if (await confirm(`Annuler la situation n° ${draft.situation_no} en préparation ?`, { title: 'Annuler la situation', confirmLabel: 'Annuler la situation', cancelLabel: 'Retour', danger: true })) cancel.mutate(draft.id);
          }}><X size={14} /> Annuler</button>}
          <button type="button" className="odoo-btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}><Save size={14} /> Enregistrer</button>
          {draft && <button type="button" className="odoo-btn-primary" disabled={validate.isPending || save.isPending} onClick={async () => {
            if (await confirm(`Valider la situation n° ${draft.situation_no} ? Ses cumuls deviendront la base de la suivante et les conditions du marché seront figées.`, { title: 'Valider la situation', confirmLabel: 'Valider' })) validate.mutate(draft.id);
          }}><Check size={14} /> Valider</button>}
        </div>
        <table className="odoo-table">
          <thead><tr><th>Ouvrage</th><th className="ds-num">Montant HT</th><th className="ds-num">% précédent</th><th className="ds-num">% cumulé</th><th className="ds-num">Cumul HT</th><th className="ds-num">Précédent HT</th><th className="ds-num">Période HT</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </DataPanel>

      {validated.length > 0 && (
        <DataPanel label="Situations validées">
          <table className="odoo-table">
            <thead><tr><th>Situation</th><th>Fin de période</th><th className="ds-num">Cumul HT</th><th className="ds-num">Période HT</th><th className="ds-num">Retenue</th><th className="ds-num">Avance</th><th className="ds-num">Net TTC</th></tr></thead>
            <tbody>
              {validated.map(b => (
                <tr key={b.id}>
                  <td className="ds-strong">{b.number}</td>
                  <td>{new Date(b.period_end).toLocaleDateString('fr-FR')}</td>
                  <td className="ds-num">{n2(b.cumulative_ht)}</td>
                  <td className="ds-num">{n2(b.period_ht)}</td>
                  <td className="ds-num">{n2(b.retention_amount)}</td>
                  <td className="ds-num">{n2(b.advance_recovery_amount)}</td>
                  <td className="ds-num ds-strong">{n2(b.total_ttc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
    </>
  );
}
