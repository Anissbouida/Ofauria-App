import { useProductionPolicies } from './usePolicies';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gauge, Loader2, AlertTriangle, Plus } from 'lucide-react';
import { routingsApi } from '../../api/routings.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

import { LoadingState, Modal, FormField, FormSection, DataPanel } from '../../components/ds';
const REASONS: [string, string][] = [
  ['panne', 'Panne'], ['maintenance', 'Maintenance'], ['reglage', 'Réglage'],
  ['electricite', 'Électricité'], ['operateur', 'Opérateur'], ['rupture', 'Rupture'], ['autre', 'Autre'],
];
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
  const [withIntervention, setWithIntervention] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['oee', workCenter.id] });
    qc.invalidateQueries({ queryKey: ['downtime', workCenter.id] });
  };
  const record = useMutation({
    mutationFn: () => routingsApi.recordDowntime(workCenter.id, {
      fromTime: new Date(fromTime).toISOString(),
      toTime: toTime ? new Date(toTime).toISOString() : null,
      reason, notes: notes.trim() || null, createIntervention: withIntervention,
    }),
    onSuccess: () => { notify.success(withIntervention ? 'Arrêt enregistré, demande d\'intervention ouverte' : 'Arrêt enregistré'); setNotes(''); setToTime(''); setWithIntervention(false); invalidate(); },
    onError: e => notify.error(apiErrorMessage(e)),
  });

  const pct = (v: number | null | undefined) => v == null ? '—' : `${v}%`;
  // M1-03 : seuils du TRS lus dans les politiques de production.
  const policies = useProductionPolicies();
  const trsGood = policies.num('production.oee_thresholds', 'good');
  const trsAlert = policies.num('production.oee_thresholds', 'alert');
  const trsColor = oee?.trs_pct == null || trsGood === null || trsAlert === null ? undefined
    : oee.trs_pct >= trsGood ? 'var(--ds-success)' : oee.trs_pct >= trsAlert ? 'var(--ds-warning)' : 'var(--ds-danger)';

  return (
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Gauge size={18} aria-hidden="true" /> TRS & arrêts</span>}
      subtitle={workCenter.name} onClose={onClose} width={620}
      footer={<button type="button" className="odoo-btn-secondary" onClick={onClose}>Fermer</button>}>
          {isLoading && <LoadingState bare />}
          {oee && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--ds-muted)' }}>7 derniers jours · {oee.active_days} jour(s) d'activité</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tile label="TRS" value={pct(oee.trs_pct)} color={trsColor} />
                <Tile label="Disponibilité" value={pct(oee.availability_pct)} />
                <Tile label="Performance" value={pct(oee.performance_pct)} />
                <Tile label="Qualité" value={pct(oee.quality_pct)} />
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--ds-muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Planifié : {oee.planned_min} min</span>
                <span>Arrêts : {oee.downtime_min} min</span>
                <span>Standard : {oee.standard_min} min</span>
                <span>Réel : {oee.reel_min} min</span>
              </div>
              {(oee.availability_pct == null || oee.performance_pct == null) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--ds-warning)' }}>
                  <AlertTriangle size={13} /> Indicateur partiel : définissez une capacité (disponibilité) et chronométrez des étapes sur ce poste (performance). Qualité non incluse.
                </div>
              )}
            </div>
          )}

          <FormSection title="Enregistrer un arrêt">
            <div className="ds-form-grid">
              <FormField label="Début" htmlFor="oee-from" required>
                <input id="oee-from" type="datetime-local" value={fromTime} onChange={e => setFromTime(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label="Fin" htmlFor="oee-to" hint="Optionnel : laisser vide si l'arrêt est en cours.">
                <input id="oee-to" type="datetime-local" value={toTime} onChange={e => setToTime(e.target.value)} className="ds-input" />
              </FormField>
              <FormField label="Motif" htmlFor="oee-reason">
                <select id="oee-reason" value={reason} onChange={e => setReason(e.target.value)} className="ds-input">
                  {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
              <FormField label="Note" htmlFor="oee-notes">
                <input id="oee-notes" type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optionnel" className="ds-input" />
              </FormField>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: '0.85rem', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={withIntervention} onChange={e => setWithIntervention(e.target.checked)} /> Ouvrir une demande d'intervention
              </label>
              <button type="button" className="odoo-btn-primary" disabled={record.isPending || !fromTime} onClick={() => record.mutate()}>
                {record.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ajouter l'arrêt
              </button>
            </div>
          </FormSection>

          {downtimes.length > 0 && (
            <DataPanel label="Arrêts récents">
              <table className="odoo-table ds-dense">
                <thead><tr><th>Début</th><th className="ds-num">Durée (min)</th><th>Motif</th><th>Note</th></tr></thead>
                <tbody>
                  {downtimes.map(d => (
                    <tr key={d.id}>
                      <td>{new Date(d.from_time).toLocaleString('fr-FR')}</td>
                      <td className="ds-num">{d.minutes}{!d.to_time ? ' (en cours)' : ''}</td>
                      <td>{REASONS.find(r => r[0] === d.reason)?.[1] ?? d.reason}</td>
                      <td style={{ color: 'var(--ds-muted)' }}>{d.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          )}
    </Modal>
  );
}
