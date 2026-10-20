import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, CalendarOff, HandCoins, Plus, X } from 'lucide-react';
import { selfApi } from '../../../api/employees.api';
import { notify } from '../../../components/ui/InlineNotification';
import { MONTH_NAMES, apiErrorMessage, saveBlobResponse } from '../shared';

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

  if (isLoading) return <p style={{ color: 'var(--odoo-text-muted)', fontSize: '0.8125rem' }}>Chargement...</p>;
  if (error || !profile) {
    return <div className="odoo-alert info" style={{ padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>{apiErrorMessage(error, 'Aucune fiche employé liée à votre compte.')}</div>;
  }
  const e = profile.employee;
  const pendingAdvance = (adv?.requests ?? []).some((r: Record<string, any>) => r.status === 'pending');
  const box = { border: '1px solid var(--odoo-border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } as const;
  const h = { fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 6 } as const;
  const smallBtn = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0.2rem 0.5rem', fontSize: '0.6875rem' } as const;

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
        <p style={h}><FileText size={14} /> Mes attestations</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="odoo-btn-secondary" style={smallBtn} onClick={() => attestation('travail')}><FileText size={12} /> Attestation de travail</button>
          <button className="odoo-btn-secondary" style={smallBtn} onClick={() => attestation('salaire')}><FileText size={12} /> Attestation de salaire</button>
        </div>
      </section>

      <section style={box}>
        <p style={h}><FileText size={14} /> Mes bulletins de paie</p>
        {!slips || (slips.monthly.length === 0 && slips.periodic.length === 0) ? <p className="text-sm text-gray-400">Aucun bulletin disponible.</p> : (
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
        <div className="flex justify-between items-center">
          <p style={h}><CalendarOff size={14} /> Mes congés</p>
          {!leaveForm && e.isActive && <button className="odoo-btn-primary" style={smallBtn} onClick={() => setLeaveForm({ type: 'annual', startDate: '', endDate: '', reason: '' })}><Plus size={11} /> Demander un congé</button>}
        </div>
        {leaveForm && (
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2">
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Type
              <select className="input" value={leaveForm.type} onChange={ev => setLeaveForm({ ...leaveForm, type: ev.target.value })}>
                {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
              </select></label>
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Du
              <input className="input" type="date" value={leaveForm.startDate} onChange={ev => setLeaveForm({ ...leaveForm, startDate: ev.target.value, endDate: leaveForm.endDate || ev.target.value })} /></label>
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Au
              <input className="input" type="date" min={leaveForm.startDate} value={leaveForm.endDate} onChange={ev => setLeaveForm({ ...leaveForm, endDate: ev.target.value })} /></label>
            <label className="text-xs col-span-3" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Motif
              <input className="input" value={leaveForm.reason} onChange={ev => setLeaveForm({ ...leaveForm, reason: ev.target.value })} /></label>
            {leaveReady && preview && (
              <p className="text-sm col-span-3">
                <strong>{preview.days} jour(s)</strong>{preview.unit === 'ouvrable' && ' ouvrables (hors repos et fériés)'}
                {preview.deductsBalance && <> · disponible {fmt((preview.available ?? 0) - (preview.pending ?? 0))} j</>}
              </p>
            )}
            <div className="col-span-3 flex justify-end gap-2">
              <button className="odoo-btn-secondary" onClick={() => setLeaveForm(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!leaveReady || requestLeave.isPending || (preview?.days ?? 1) <= 0} onClick={() => requestLeave.mutate()}>Envoyer la demande</button>
            </div>
          </div>
        )}
        {leaves.length === 0 ? <p className="text-sm text-gray-400">Aucune demande.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Type</th><th>Période</th><th style={{ textAlign: 'right' }}>Jours</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {leaves.map(l => (
                <tr key={l.id}>
                  <td>{leaveLabel(l.type)}</td><td>{frd(l.start_date)} → {frd(l.end_date)}</td>
                  <td style={{ textAlign: 'right' }}>{parseFloat(l.days)}</td><td>{tag(l.status)}</td>
                  <td>{l.status === 'pending' && <button className="odoo-pager-btn" title="Annuler la demande" style={{ color: '#dc3545' }} onClick={() => cancelLeave.mutate(l.id)}><X size={13} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <div className="flex justify-between items-center">
          <p style={h}><HandCoins size={14} /> Mes avances sur salaire</p>
          {!advForm && !pendingAdvance && e.isActive && <button className="odoo-btn-primary" style={smallBtn} onClick={() => setAdvForm({ amount: '', monthlyDeduction: '', reason: '' })}><Plus size={11} /> Demander une avance</button>}
        </div>
        {advForm && (
          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2">
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Montant (DH)
              <input className="input" type="number" min="0" step="10" value={advForm.amount} onChange={ev => setAdvForm({ ...advForm, amount: ev.target.value })} /></label>
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Retenue par paie (facultatif)
              <input className="input" type="number" min="0" step="10" value={advForm.monthlyDeduction} onChange={ev => setAdvForm({ ...advForm, monthlyDeduction: ev.target.value })} /></label>
            <label className="text-xs" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>Motif
              <input className="input" value={advForm.reason} onChange={ev => setAdvForm({ ...advForm, reason: ev.target.value })} /></label>
            <div className="col-span-3 flex justify-end gap-2">
              <button className="odoo-btn-secondary" onClick={() => setAdvForm(null)}>Annuler</button>
              <button className="odoo-btn-primary" disabled={!(parseFloat(advForm.amount) > 0) || requestAdvance.isPending} onClick={() => requestAdvance.mutate()}>Envoyer la demande</button>
            </div>
          </div>
        )}
        {(adv?.requests ?? []).length === 0 && (adv?.advances ?? []).length === 0 ? <p className="text-sm text-gray-400">Aucune avance.</p> : (
          <table className="odoo-table">
            <thead><tr><th>Date</th><th>Objet</th><th style={{ textAlign: 'right' }}>Montant</th><th style={{ textAlign: 'right' }}>Reste dû</th><th>Statut</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {(adv?.requests ?? []).filter((r: Record<string, any>) => r.status !== 'approved').map((r: Record<string, any>) => (
                <tr key={r.id} title={r.decision_note ?? undefined}>
                  <td>{frd(String(r.created_at).slice(0, 10))}</td><td>Demande{r.reason ? ` · ${r.reason}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.amount)}</td><td style={{ textAlign: 'right' }}>—</td><td>{tag(r.status)}</td>
                  <td>{r.status === 'pending' && <button className="odoo-pager-btn" title="Annuler la demande" style={{ color: '#dc3545' }} onClick={() => cancelAdvance.mutate(r.id)}><X size={13} /></button>}</td>
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
