import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { Modal, FormSection } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Calendrier d'un poste de travail (M5-04) : plages d'ouverture par jour de semaine avec
 * nombre de ressources, jours fermés. Sans plage, la capacité reste la capacité journalière
 * du poste. Le calendrier sert de capacité à la charge par plan et de temps planifié au TRS.
 */
type Slot = { isoWeekday: number; startTime: string; endTime: string; resources: number };
type Calendar = { slots: { iso_weekday: number; start_time: string; end_time: string; resources: number }[]; closures: { id: string; work_center_id: string | null; closed_on: string; reason: string | null }[] };
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const minutes = (s: Slot) => {
  const [h1, m1] = s.startTime.split(':').map(Number); const [h2, m2] = s.endTime.split(':').map(Number);
  return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1)) * (s.resources || 1);
};

export default function WorkCenterCalendarModal({ workCenter, onClose }: { workCenter: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['work-center-calendar', workCenter.id];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get(`/routings/work-centers/${workCenter.id}/calendar`).then(r => r.data.data as Calendar) });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [closure, setClosure] = useState({ closedOn: '', reason: '', allCenters: false });
  useEffect(() => {
    if (data) setSlots(data.slots.map(s => ({ isoWeekday: s.iso_weekday, startTime: s.start_time, endTime: s.end_time, resources: s.resources })));
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put(`/routings/work-centers/${workCenter.id}/calendar`, { slots }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); notify.success('Calendrier enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const addClosure = useMutation({
    mutationFn: () => api.post(`/routings/work-centers/${workCenter.id}/closures`, { closedOn: closure.closedOn, reason: closure.reason || null, allCenters: closure.allCenters }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setClosure({ closedOn: '', reason: '', allCenters: false }); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const removeClosure = useMutation({
    mutationFn: (id: string) => api.delete(`/routings/work-centers/closures/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const set = (i: number, patch: Partial<Slot>) => setSlots(a => a.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const weekMinutes = slots.reduce((t, s) => t + minutes(s), 0);

  return (
    <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CalendarDays size={18} aria-hidden="true" /> Calendrier</span>}
      subtitle={workCenter.name} onClose={onClose} width={680}>
          <FormSection title="Plages d'ouverture">
            {slots.length === 0 && <span className="text-xs text-gray-500">Aucune plage : la capacité journalière du poste s'applique tous les jours.</span>}
            {slots.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
                <select className="ds-input sm" style={{ width: 'auto' }} value={s.isoWeekday} aria-label="Jour" onChange={e => set(i, { isoWeekday: Number(e.target.value) })}>
                  {DAYS.map((d, k) => <option key={d} value={k + 1}>{d}</option>)}
                </select>
                <input type="time" className="ds-input sm" style={{ width: 'auto' }} value={s.startTime} aria-label="Début" onChange={e => set(i, { startTime: e.target.value })} />
                <span>à</span>
                <input type="time" className="ds-input sm" style={{ width: 'auto' }} value={s.endTime} aria-label="Fin" onChange={e => set(i, { endTime: e.target.value })} />
                <label>× <input type="number" min={1} className="ds-input sm" style={{ width: 56 }} value={s.resources} aria-label="Ressources" onChange={e => set(i, { resources: Math.max(1, Number(e.target.value) || 1) })} /> ressource(s)</label>
                <span className="text-xs text-gray-500">{minutes(s)} min</span>
                <button type="button" className="ds-icon-btn" aria-label="Retirer la plage" onClick={() => setSlots(a => a.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="odoo-btn-secondary" onClick={() => setSlots(a => [...a, { isoWeekday: 1, startTime: '06:00', endTime: '14:00', resources: 1 }])}><Plus size={12} /> Ajouter une plage</button>
              <button type="button" className="odoo-btn-secondary" onClick={() => setSlots([1, 2, 3, 4, 5, 6].map(d => ({ isoWeekday: d, startTime: '06:00', endTime: '14:00', resources: 1 })))}>Lundi → samedi 6 h-14 h</button>
              <span className="text-xs text-gray-500" style={{ marginLeft: 'auto' }}>Semaine : {Math.round(weekMinutes / 6) / 10} h</span>
              <button type="button" className="odoo-btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
            </div>
          </FormSection>
          <FormSection title="Jours fermés">
            {(data?.closures ?? []).map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '13px' }}>
                <span>{c.closed_on.split('-').reverse().join('/')}</span>
                <span className="text-gray-500">{c.reason ?? ''}{c.work_center_id ? '' : ' (tous les postes)'}</span>
                <button type="button" className="ds-icon-btn" style={{ marginLeft: 'auto' }} aria-label="Rouvrir ce jour" onClick={() => removeClosure.mutate(c.id)}><Trash2 size={14} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
              <input type="date" className="ds-input sm" style={{ width: 'auto' }} value={closure.closedOn} aria-label="Jour fermé" onChange={e => setClosure(c => ({ ...c, closedOn: e.target.value }))} />
              <input type="text" className="ds-input sm" style={{ width: 200 }} placeholder="Motif (férié, maintenance…)" aria-label="Motif de fermeture" value={closure.reason} onChange={e => setClosure(c => ({ ...c, reason: e.target.value }))} />
              <label><input type="checkbox" checked={closure.allCenters} onChange={e => setClosure(c => ({ ...c, allCenters: e.target.checked }))} /> Tous les postes</label>
              <button type="button" className="odoo-btn-secondary" disabled={!closure.closedOn || addClosure.isPending} onClick={() => addClosure.mutate()}>Fermer ce jour</button>
            </div>
          </FormSection>
    </Modal>
  );
}
