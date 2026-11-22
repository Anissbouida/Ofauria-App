import { currencySymbol } from '../../../utils/money';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, CalendarOff, HandCoins, Plus, X, UserX, CalendarDays } from 'lucide-react';
import { selfApi } from '../../../api/employees.api';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../../components/ui/StatusTag';
import { Field, LoadingPanel, HrHeaderActions, inputCls, panel } from '../ui';
import { KpiGrid, KpiCard, SectionHeader, DataPanel, TableFooter, EmptyState, FormFooter } from '../../../components/ds';

const fmt = (v: unknown) => (parseFloat(String(v ?? 0)) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frd = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
const STATUS: Record<string, [string, StatusTone]> = {
  pending: ['En attente', 'todo'], approved: ['Accordée', 'done'], rejected: ['Refusée', 'blocked'],
  cancelled: ['Annulée', 'cancelled'], open: ['En cours', 'progress'], partial: ['Partiellement remboursée', 'progress'], repaid: ['Remboursée', 'done'],
};
const tag = (s: string) => <StatusTag tone={STATUS[s]?.[1] ?? 'draft'} label={STATUS[s]?.[0] ?? s} />;

/**
 * Espace employé : ses bulletins (PDF), son solde de congés et ses demandes,
 * ses avances et ses demandes d'avance. Ne montre que les données du compte
 * connecté (fiche liée par employees.user_id).
 */
export default function MySpace() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: profile, isLoading, error } = useQuery<Record<string, any>>({ queryKey: ['me'], queryFn: selfApi.profile, retry: false });
  const { data: slips } = useQuery<Record<string, any>>({ queryKey: ['me-payslips'], queryFn: selfApi.payslips, enabled: !!profile });
  const { data: leaves = [] } = useQuery<Record<string, any>[]>({ queryKey: ['me-leaves'], queryFn: selfApi.leaves, enabled: !!profile });
  const { data: leaveTypes = [] } = useQuery<Array<{ code: string; label: string }>>({ queryKey: ['me-leave-types'], queryFn: selfApi.leaveTypes, enabled: !!profile });
  const leaveLabel = (code: string) => leaveTypes.find(t => t.code === code)?.label ?? code;
  const { data: adv } = useQuery<Record<string, any>>({ queryKey: ['me-advances'], queryFn: selfApi.advances, enabled: !!profile });
  const [leaveForm, setLeaveForm] = useState<Record<string, string> | null>(null);
  const [advForm, setAdvForm] = useState<Record<string, string> | null>(null);
  const refresh = () => ['me', 'me-leaves', 'me-advances'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));

  const leaveReady = !!(leaveForm?.type && leaveForm.startDate && leaveForm.endDate && leaveForm.endDate >= leaveForm.startDate);
  const { data: preview } = useQuery<Record<string, any>>({
    queryKey: ['me-leave-preview', leaveForm?.type, leaveForm?.startDate, leaveForm?.endDate],
    queryFn: () => selfApi.leavePreview({ type: leaveForm!.type, startDate: leaveForm!.startDate, endDate: leaveForm!.endDate }),
    enabled: leaveReady,
  });
  const requestLeave = useMutation({
    mutationFn: () => selfApi.requestLeave({ ...leaveForm, reason: leaveForm?.reason || null }),
    onSuccess: () => { refresh(); setLeaveForm(null); notify.success('Demande envoyée au gérant'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const cancelLeave = useMutation({
    mutationFn: (id: string) => selfApi.cancelLeave(id),
    onSuccess: () => { refresh(); notify.success('Demande annulée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const requestAdvance = useMutation({
    mutationFn: () => selfApi.requestAdvance({
      amount: parseFloat(advForm!.amount), monthlyDeduction: advForm!.monthlyDeduction ? parseFloat(advForm!.monthlyDeduction) : null, reason: advForm!.reason || null,
    }),
    onSuccess: () => { refresh(); setAdvForm(null); notify.success('Demande d\'avance envoyée au gérant'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const cancelAdvance = useMutation({
    mutationFn: (id: string) => selfApi.cancelAdvanceRequest(id),
    onSuccess: () => { refresh(); notify.success('Demande annulée'); },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Erreur')),
  });
  const pdf = async (id: string) => {
    try { saveBlobResponse(await selfApi.payslipPdf(id), 'bulletin.pdf'); }
    catch (err) { notify.error(apiErrorMessage(err, 'Bulletin indisponible')); }
  };
  const attestation = async (kind: 'travail' | 'salaire') => {
    try { saveBlobResponse(await selfApi.attestation(kind), `attestation_${kind}.pdf`); }
    catch (err) { notify.error(apiErrorMessage(err, 'Attestation indisponible')); }
  };

  if (isLoading) {
    return <LoadingPanel />;
  }
  if (error || !profile) {
    return (
      <StatusBanner tone="info" icon={UserX} title="Espace employé indisponible">
        {apiErrorMessage(error, 'Aucune fiche employé liée à votre compte.')}
      </StatusBanner>
    );
  }
  const e = profile.employee;
  const pendingAdvance = (adv?.requests ?? []).some((r: Record<string, any>) => r.status === 'pending');
  const formBox = { ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 } as const;
  const full = { gridColumn: '1 / -1' } as const;
  const cur = currencySymbol();
  const hasSlips = !!slips && (slips.monthly.length > 0 || slips.periodic.length > 0);
  const hasAdvances = (adv?.requests ?? []).length > 0 || (adv?.advances ?? []).length > 0;
  const section = { display: 'grid', gap: 12 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Éditions : actions secondaires, en haut à droite de la page. */}
      <HrHeaderActions>
        <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => attestation('travail')}><FileText size={13} aria-hidden="true" /> Attestation de travail</button>
        <button type="button" className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => attestation('salaire')}><FileText size={13} aria-hidden="true" /> Attestation de salaire</button>
      </HrHeaderActions>

      <KpiGrid>
        <KpiCard label="Bonjour" value={`${e.firstName} ${e.lastName}`} sub={<>{e.role}{e.hireDate && ` · depuis le ${frd(e.hireDate)}`}</>} />
        <KpiCard label="Congés disponibles (j)" value={profile.leave ? fmt(profile.leave.available) : '—'}
          sub={profile.leave ? <>acquis {fmt(profile.leave.acquiredThisYear)} · pris {fmt(profile.leave.takenThisYear)}{profile.leave.pending > 0 && ` · ${fmt(profile.leave.pending)} en attente`}</> : 'date d\'embauche manquante'} />
        <KpiCard label={`Avance à rembourser (${cur})`} value={fmt(profile.advanceOutstanding)} />
        <KpiCard label="Contrat" value={profile.contract ? String(profile.contract.contract_type).toUpperCase() : '—'}
          sub={<>{profile.contract && (profile.contract.end_date ? `jusqu'au ${frd(profile.contract.end_date)}` : 'durée indéterminée')}
            {profile.contract?.trial_end_date && ` · essai jusqu'au ${frd(profile.contract.trial_end_date)}`}</>} />
      </KpiGrid>

      <section style={section} aria-label="Mes bulletins de paie">
        <SectionHeader title="Mes bulletins de paie" />
        {!hasSlips ? <EmptyState icon={FileText} title="Aucun bulletin disponible" /> : (
          <DataPanel label="Mes bulletins de paie" footer={<TableFooter note={`${slips!.monthly.length + slips!.periodic.length} bulletin(s)`} />}>
            <table className="odoo-table">
              <thead><tr><th>Période</th><th className="ds-num">Brut ({cur})</th><th className="ds-num">Net ({cur})</th><th className="ds-num">Avance retenue ({cur})</th><th>Paiement</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {slips!.monthly.map((p: Record<string, any>) => (
                  <tr key={p.id}>
                    <td className="ds-strong">{MONTH_NAMES[p.month - 1]} {p.year}</td>
                    <td className="ds-num">{fmt(p.gross_salary)}</td>
                    <td className="ds-num ds-strong">{fmt(p.net_salary)}</td>
                    <td className="ds-num">{parseFloat(p.advance_deduction) > 0 ? fmt(p.advance_deduction) : '—'}</td>
                    <td>{p.paid ? <StatusTag tone="done" label={`Payé le ${frd(String(p.paid_at).slice(0, 10))}`} /> : <StatusTag tone="todo" label="À venir" />}</td>
                    <td className="ds-actions"><button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => pdf(p.id)}><FileText size={13} aria-hidden="true" /> Télécharger</button></td>
                  </tr>
                ))}
                {slips!.periodic.map((p: Record<string, any>) => (
                  <tr key={p.id}>
                    <td className="ds-strong">{p.kind} du {frd(p.start)} au {frd(p.end_d)}</td>
                    <td className="ds-num">—</td>
                    <td className="ds-num ds-strong">{fmt(p.net_amount)}</td>
                    <td className="ds-num">{parseFloat(p.advance_deduction) > 0 ? fmt(p.advance_deduction) : '—'}</td>
                    <td><StatusTag tone="done" label={`Payé le ${frd(String(p.paid_at).slice(0, 10))}`} /></td>
                    <td className="ds-actions"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </section>

      <section style={section} aria-label="Mes congés">
        <SectionHeader title="Mes congés">
          {!leaveForm && e.isActive && (
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setLeaveForm({ type: 'annual', startDate: '', endDate: '', reason: '' })}><Plus size={13} aria-hidden="true" /> Demander un congé</button>
          )}
        </SectionHeader>
        {leaveForm && (
          <div style={formBox}>
            <Field label="Type" required>
              <select className={inputCls} value={leaveForm.type} onChange={ev => setLeaveForm({ ...leaveForm, type: ev.target.value })}>
                {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
              </select></Field>
            <Field label="Du" required>
              <input className={inputCls} type="date" value={leaveForm.startDate} onChange={ev => setLeaveForm({ ...leaveForm, startDate: ev.target.value, endDate: leaveForm.endDate || ev.target.value })} /></Field>
            <Field label="Au" required>
              <input className={inputCls} type="date" min={leaveForm.startDate} value={leaveForm.endDate} onChange={ev => setLeaveForm({ ...leaveForm, endDate: ev.target.value })} /></Field>
            <Field label="Motif" style={full}>
              <input className={inputCls} value={leaveForm.reason} onChange={ev => setLeaveForm({ ...leaveForm, reason: ev.target.value })} /></Field>
            {leaveReady && preview && (
              <div style={full}>
                <StatusBanner tone="info" icon={CalendarDays}
                  title={`${preview.days} jour(s)${preview.unit === 'ouvrable' ? ' ouvrables (hors repos et fériés)' : ''}`}>
                  {preview.deductsBalance && <>Disponible {fmt((preview.available ?? 0) - (preview.pending ?? 0))} j</>}
                </StatusBanner>
              </div>
            )}
            <div style={{ ...full, margin: '0 -12px -12px' }}>
              <FormFooter onCancel={() => setLeaveForm(null)} submitLabel="Envoyer la demande" busy={requestLeave.isPending}
                disabled={!leaveReady || (preview?.days ?? 1) <= 0} onSubmit={() => requestLeave.mutate()} />
            </div>
          </div>
        )}
        {leaves.length === 0 ? <EmptyState icon={CalendarOff} title="Aucune demande de congé" /> : (
          <DataPanel label="Mes congés" footer={<TableFooter note={`${leaves.length} demande${leaves.length > 1 ? 's' : ''}`} />}>
            <table className="odoo-table">
              <thead><tr><th>Type</th><th>Période</th><th className="ds-num">Durée (j)</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.id}>
                    <td className="ds-strong">{leaveLabel(l.type)}</td><td>{frd(l.start_date)} → {frd(l.end_date)}</td>
                    <td className="ds-num">{parseFloat(l.days)}</td><td>{tag(l.status)}</td>
                    <td className="ds-actions">{l.status === 'pending' && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={async () => { if (await confirm('Annuler cette demande de congé ?', { title: 'Annuler la demande', confirmLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true })) cancelLeave.mutate(l.id); }}><X size={13} aria-hidden="true" /> Annuler</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </section>

      <section style={section} aria-label="Mes avances sur salaire">
        <SectionHeader title="Mes avances sur salaire">
          {!advForm && !pendingAdvance && e.isActive && (
            <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setAdvForm({ amount: '', monthlyDeduction: '', reason: '' })}><Plus size={13} aria-hidden="true" /> Demander une avance</button>
          )}
        </SectionHeader>
        {advForm && (
          <div style={formBox}>
            <Field label={`Montant (${cur})`} required>
              <input className={inputCls} type="number" min="0" step="10" value={advForm.amount} onChange={ev => setAdvForm({ ...advForm, amount: ev.target.value })} /></Field>
            <Field label="Retenue par paie (facultatif)">
              <input className={inputCls} type="number" min="0" step="10" value={advForm.monthlyDeduction} onChange={ev => setAdvForm({ ...advForm, monthlyDeduction: ev.target.value })} /></Field>
            <Field label="Motif">
              <input className={inputCls} value={advForm.reason} onChange={ev => setAdvForm({ ...advForm, reason: ev.target.value })} /></Field>
            <div style={{ ...full, margin: '0 -12px -12px' }}>
              <FormFooter onCancel={() => setAdvForm(null)} submitLabel="Envoyer la demande" busy={requestAdvance.isPending}
                disabled={!(parseFloat(advForm.amount) > 0)} onSubmit={() => requestAdvance.mutate()} />
            </div>
          </div>
        )}
        {!hasAdvances ? <EmptyState icon={HandCoins} title="Aucune avance" /> : (
          <DataPanel label="Mes avances sur salaire">
            <table className="odoo-table">
              <thead><tr><th>Date</th><th>Objet</th><th className="ds-num">Montant ({cur})</th><th className="ds-num">Reste dû ({cur})</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {(adv?.requests ?? []).filter((r: Record<string, any>) => r.status !== 'approved').map((r: Record<string, any>) => (
                  <tr key={r.id} title={r.decision_note ?? undefined}>
                    <td>{frd(String(r.created_at).slice(0, 10))}</td><td className="ds-strong">Demande{r.reason ? ` · ${r.reason}` : ''}</td>
                    <td className="ds-num">{fmt(r.amount)}</td><td className="ds-num">—</td><td>{tag(r.status)}</td>
                    <td className="ds-actions">{r.status === 'pending' && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={async () => { if (await confirm('Annuler cette demande d\'avance ?', { title: 'Annuler la demande', confirmLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true })) cancelAdvance.mutate(r.id); }}><X size={13} aria-hidden="true" /> Annuler</button>}</td>
                  </tr>
                ))}
                {(adv?.advances ?? []).map((a: Record<string, any>) => (
                  <tr key={a.id}>
                    <td>{frd(a.advance_date)}</td><td className="ds-strong">Avance versée</td>
                    <td className="ds-num">{fmt(a.amount)}</td><td className="ds-num">{fmt(a.remaining_amount)}</td><td>{tag(a.status)}</td><td className="ds-actions"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </section>
    </div>
  );
}
