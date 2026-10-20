import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, CalendarOff, HandCoins, Plus, X, Loader2, UserX, CalendarDays } from 'lucide-react';
import { selfApi } from '../../../api/employees.api';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse } from '../shared';
import { StatusBanner } from '../../../components/ui/StatusBanner';
import { Field, SectionTitle, EmptyState, inputCls, panel, smallBtn } from '../ui';

const fmt = (v: unknown) => (parseFloat(String(v ?? 0)) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const frd = (s?: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
const STATUS: Record<string, [string, string]> = {
  pending: ['En attente', 'odoo-tag-yellow'], approved: ['Accordée', 'odoo-tag-green'], rejected: ['Refusée', 'odoo-tag-red'],
  cancelled: ['Annulée', 'odoo-tag-grey'], open: ['En cours', 'odoo-tag-orange'], partial: ['Partiellement remboursée', 'odoo-tag-orange'], repaid: ['Remboursée', 'odoo-tag-green'],
};
const tag = (s: string) => <span className={`odoo-tag ${STATUS[s]?.[1] ?? ''}`}>{STATUS[s]?.[0] ?? s}</span>;

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
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
        <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
      </div>
    );
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
  const box = { ...panel, display: 'flex', flexDirection: 'column', gap: 8 } as const;
  const formBox = { ...panel, background: 'var(--odoo-bg-hover)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } as const;
  const full = { gridColumn: '1 / -1' } as const;
  const empty = { fontSize: '0.8125rem', color: 'var(--theme-text-muted)', margin: 0 } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Bonjour</div>
          <div className="odoo-stat-card-value" style={{ fontSize: '1.1rem' }}>{e.firstName} {e.lastName}</div>
          <div className="odoo-stat-card-sub">{e.role}{e.hireDate && ` · depuis le ${frd(e.hireDate)}`}</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Congés disponibles</div>
          <div className="odoo-stat-card-value">{profile.leave ? `${fmt(profile.leave.available)} j` : '—'}</div>
          <div className="odoo-stat-card-sub">
            {profile.leave ? <>acquis {fmt(profile.leave.acquiredThisYear)} · pris {fmt(profile.leave.takenThisYear)}{profile.leave.pending > 0 && ` · ${fmt(profile.leave.pending)} en attente`}</> : 'date d\'embauche manquante'}
          </div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Avance à rembourser</div>
          <div className="odoo-stat-card-value">{fmt(profile.advanceOutstanding)} DH</div>
        </div>
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label">Contrat</div>
          <div className="odoo-stat-card-value" style={{ fontSize: '1.1rem' }}>{profile.contract ? String(profile.contract.contract_type).toUpperCase() : '—'}</div>
          <div className="odoo-stat-card-sub">
            {profile.contract && (profile.contract.end_date ? `jusqu'au ${frd(profile.contract.end_date)}` : 'durée indéterminée')}
            {profile.contract?.trial_end_date && ` · essai jusqu'au ${frd(profile.contract.trial_end_date)}`}
          </div>
        </div>
      </div>

      <section style={box}>
        <SectionTitle icon={FileText}>Mes attestations</SectionTitle>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="odoo-btn-secondary" style={smallBtn} onClick={() => attestation('travail')}><FileText size={12} /> Attestation de travail</button>
          <button className="odoo-btn-secondary" style={smallBtn} onClick={() => attestation('salaire')}><FileText size={12} /> Attestation de salaire</button>
        </div>
      </section>

      <section style={box}>
        <SectionTitle icon={FileText}>Mes bulletins de paie</SectionTitle>
        {!slips || (slips.monthly.length === 0 && slips.periodic.length === 0) ? <EmptyState icon={FileText}>Aucun bulletin disponible.</EmptyState> : (
          <table className="odoo-table">
            <thead><tr><th>Période</th><th style={{ textAlign: 'right' }}>Brut</th><th style={{ textAlign: 'right' }}>Net</th><th style={{ textAlign: 'right' }}>Avance retenue</th><th>Payé</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {slips.monthly.map((p: Record<string, any>) => (
                <tr key={p.id}>
                  <td>{MONTH_NAMES[p.month - 1]} {p.year}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(p.gross_salary)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.net_salary)}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(p.advance_deduction) > 0 ? fmt(p.advance_deduction) : '—'}</td>
                  <td>{p.paid ? frd(String(p.paid_at).slice(0, 10)) : 'à venir'}</td>
                  <td><button className="odoo-pager-btn" title="Télécharger le bulletin" onClick={() => pdf(p.id)}><FileText size={13} /></button></td>
                </tr>
              ))}
              {slips.periodic.map((p: Record<string, any>) => (
                <tr key={p.id}>
                  <td>{p.kind} du {frd(p.start)} au {frd(p.end_d)}</td>
                  <td style={{ textAlign: 'right' }}>—</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.net_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(p.advance_deduction) > 0 ? fmt(p.advance_deduction) : '—'}</td>
                  <td>{frd(String(p.paid_at).slice(0, 10))}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <SectionTitle icon={CalendarOff} actions={!leaveForm && e.isActive ? (
          <button className="odoo-btn-primary" style={smallBtn} onClick={() => setLeaveForm({ type: 'annual', startDate: '', endDate: '', reason: '' })}><Plus size={11} /> Demander un congé</button>
        ) : undefined}>Mes congés</SectionTitle>
        {leaveForm && (
          <div style={formBox}>
            <Field label="Type">
              <select className={inputCls} value={leaveForm.type} onChange={ev => setLeaveForm({ ...leaveForm, type: ev.target.value })}>
                {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
              </select></Field>
            <Field label="Du">
              <input className={inputCls} type="date" value={leaveForm.startDate} onChange={ev => setLeaveForm({ ...leaveForm, startDate: ev.target.value, endDate: leaveForm.endDate || ev.target.value })} /></Field>
            <Field label="Au">
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
            <div style={{ ...full, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="odoo-btn-secondary" onClick={() => setLeaveForm(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!leaveReady || requestLeave.isPending || (preview?.days ?? 1) <= 0} onClick={() => requestLeave.mutate()}>Envoyer la demande</button>
            </div>
          </div>
        )}
        {leaves.length === 0 ? <p style={empty}>Aucune demande.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Type</th><th>Période</th><th style={{ textAlign: 'right' }}>Jours</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id}>
                  <td>{leaveLabel(l.type)}</td><td>{frd(l.start_date)} → {frd(l.end_date)}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(l.days)}</td><td>{tag(l.status)}</td>
                  <td>{l.status === 'pending' && <button className="odoo-pager-btn" title="Annuler la demande" style={{ color: '#dc3545' }} onClick={async () => { if (await confirm('Annuler cette demande de congé ?', { title: 'Annuler la demande', confirmLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true })) cancelLeave.mutate(l.id); }}><X size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <SectionTitle icon={HandCoins} actions={!advForm && !pendingAdvance && e.isActive ? (
          <button className="odoo-btn-primary" style={smallBtn} onClick={() => setAdvForm({ amount: '', monthlyDeduction: '', reason: '' })}><Plus size={11} /> Demander une avance</button>
        ) : undefined}>Mes avances sur salaire</SectionTitle>
        {advForm && (
          <div style={formBox}>
            <Field label="Montant (DH)">
              <input className={inputCls} type="number" min="0" step="10" value={advForm.amount} onChange={ev => setAdvForm({ ...advForm, amount: ev.target.value })} /></Field>
            <Field label="Retenue par paie (facultatif)">
              <input className={inputCls} type="number" min="0" step="10" value={advForm.monthlyDeduction} onChange={ev => setAdvForm({ ...advForm, monthlyDeduction: ev.target.value })} /></Field>
            <Field label="Motif">
              <input className={inputCls} value={advForm.reason} onChange={ev => setAdvForm({ ...advForm, reason: ev.target.value })} /></Field>
            <div style={{ ...full, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="odoo-btn-secondary" onClick={() => setAdvForm(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!(parseFloat(advForm.amount) > 0) || requestAdvance.isPending} onClick={() => requestAdvance.mutate()}>Envoyer la demande</button>
            </div>
          </div>
        )}
        {(adv?.requests ?? []).length === 0 && (adv?.advances ?? []).length === 0 ? <p style={empty}>Aucune avance.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Objet</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Reste dû</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {(adv?.requests ?? []).filter((r: Record<string, any>) => r.status !== 'approved').map((r: Record<string, any>) => (
                <tr key={r.id} title={r.decision_note ?? undefined}>
                  <td>{frd(String(r.created_at).slice(0, 10))}</td><td>Demande{r.reason ? ` · ${r.reason}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td><td style={{ textAlign: 'right' }}>—</td><td>{tag(r.status)}</td>
                  <td>{r.status === 'pending' && <button className="odoo-pager-btn" title="Annuler la demande" style={{ color: '#dc3545' }} onClick={async () => { if (await confirm('Annuler cette demande d\'avance ?', { title: 'Annuler la demande', confirmLabel: 'Annuler la demande', cancelLabel: 'Garder', danger: true })) cancelAdvance.mutate(r.id); }}><X size={13} /></button>}</td>
                </tr>
              ))}
              {(adv?.advances ?? []).map((a: Record<string, any>) => (
                <tr key={a.id}>
                  <td>{frd(a.advance_date)}</td><td>Avance versée</td>
                  <td style={{ textAlign: 'right' }}>{fmt(a.amount)}</td><td style={{ textAlign: 'right' }}>{fmt(a.remaining_amount)}</td><td>{tag(a.status)}</td><td></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
