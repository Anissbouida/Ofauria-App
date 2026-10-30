import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, X, Loader2, AlertTriangle, Plus } from 'lucide-react';
import { routingsApi } from '../../api/routings.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import ModalBackdrop from '../../components/ui/ModalBackdrop';

const REASONS: [string, string][] = [
  ['panne', 'Panne'], ['maintenance', 'Maintenance'], ['reglage', 'Réglage'],
  ['electricite', 'Électricité'], ['operateur', 'Opérateur'], ['rupture', 'Rupture'], ['autre', 'Autre'],
];
const inp: React.CSSProperties = { padding: '0.4rem 0.5rem', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'inherit', font: 'inherit', fontSize: '0.82rem' };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 90, border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--theme-text-muted)' }}>{label}</div>
    </div>
  );
}

export default function WorkCenterOeeModal({ workCenter, onClose }: { workCenter: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: oee, isLoading } = useQuery({ queryKey: ['oee', workCenter.id], queryFn: () => routingsApi.oee(workCenter.id) });
  const { data: downtimes = [] } = useQuery({ queryKey: ['downtime', workCenter.id], queryFn: () => routingsApi.listDowntime(workCenter.id) });

  const [fromTime, setFromTime] = useState(nowLocal());
  const [toTime, setToTime] = useState('');
  const [reason, setReason] = useState('panne');
  const [notes, setNotes] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['oee', workCenter.id] });
    qc.invalidateQueries({ queryKey: ['downtime', workCenter.id] });
  };
  const record = useMutation({
    mutationFn: () => routingsApi.recordDowntime(workCenter.id, {
      fromTime: new Date(fromTime).toISOString(),
      toTime: toTime ? new Date(toTime).toISOString() : null,
      reason, notes: notes.trim() || null,
    }),
    onSuccess: () => { notify.success('Arrêt enregistré'); setNotes(''); setToTime(''); invalidate(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const pct = (v: number | null | undefined) => v == null ? '—' : `${v}%`;
  const trsColor = oee?.trs_pct == null ? undefined : oee.trs_pct >= 85 ? '#2e7d32' : oee.trs_pct >= 60 ? '#b45309' : '#c62828';

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="odoo-scope" onClick={e => e.stopPropagation()} style={{ background: 'var(--odoo-bg)', borderRadius: 8, width: 'min(620px, 97vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--odoo-border)' }}>
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Gauge size={16} /> TRS & arrêts — {workCenter.name}</span>
          <button type="button" onClick={onClose} className="odoo-pager-btn"><X size={14} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isLoading && <div style={{ color: 'var(--theme-text-muted)' }}><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}
          {oee && (
            <>
              <div style={{ fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>7 derniers jours · {oee.active_days} jour(s) d'activité</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tile label="TRS" value={pct(oee.trs_pct)} color={trsColor} />
                <Tile label="Disponibilité" value={pct(oee.availability_pct)} />
                <Tile label="Performance" value={pct(oee.performance_pct)} />
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--theme-text-muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Planifié : {oee.planned_min} min</span>
                <span>Arrêts : {oee.downtime_min} min</span>
                <span>Standard : {oee.standard_min} min</span>
                <span>Réel : {oee.reel_min} min</span>
              </div>
              {(oee.availability_pct == null || oee.performance_pct == null) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#b45309' }}>
                  <AlertTriangle size={13} /> Indicateur partiel : définissez une capacité (disponibilité) et chronométrez des étapes sur ce poste (performance). Qualité non incluse.
                </div>
              )}
            </>
          )}

          {/* Enregistrer un arrêt */}
          <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 8 }}>Enregistrer un arrêt</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>Début
                <input type="datetime-local" value={fromTime} onChange={e => setFromTime(e.target.value)} style={inp} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>Fin (optionnel)
                <input type="datetime-local" value={toTime} onChange={e => setToTime(e.target.value)} style={inp} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>Motif
                <select value={reason} onChange={e => setReason(e.target.value)} style={inp}>
                  {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>Note
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optionnel" style={inp} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="odoo-btn-primary" disabled={record.isPending || !fromTime} onClick={() => record.mutate()}>
                {record.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ajouter l'arrêt
              </button>
            </div>
          </div>

          {/* Arrêts récents */}
          {downtimes.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr><th>Début</th><th>Durée</th><th>Motif</th><th>Note</th></tr></thead>
                <tbody>
                  {downtimes.map(d => (
                    <tr key={d.id}>
                      <td style={{ fontSize: '0.8rem' }}>{new Date(d.from_time).toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{d.minutes} min{!d.to_time ? ' (en cours)' : ''}</td>
                      <td>{REASONS.find(r => r[0] === d.reason)?.[1] ?? d.reason}</td>
                      <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.8rem' }}>{d.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--odoo-border)' }}>
          <button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
