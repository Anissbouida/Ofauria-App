import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import api from '../../api/client';
import { Drawer, FormSection, FormField } from '../../components/ds';
import SearchSelect from '../../components/ui/SearchSelect';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useReferentiel } from '../../hooks/useReferentiel';

/**
 * Fiche structurée d'une non-conformité (M7-05) : cause, fournisseur, décision sur le lot,
 * actions correctives et préventives avec vérification d'efficacité.
 */
type Action = { id: string; action_type: string; description: string; responsible_name: string | null; due_date: string | null; status: string; overdue: boolean; effectiveness_result: string | null; effectiveness_note: string | null };
type Detail = {
  id: string; title: string; cause_code: string | null; supplier_id: string | null; supplier_name: string | null;
  product_lot_id: string | null; ingredient_lot_id: string | null; product_lot_number: string | null; ingredient_lot_number: string | null;
  lot_decision: string | null; actions: Action[];
};
const DECISIONS: [string, string][] = [['accepte', 'Accepté (dérogation)'], ['retouche', 'Retouché'], ['declasse', 'Déclassé'], ['detruit', 'Détruit'], ['retour_fournisseur', 'Retour fournisseur']];

export default function NcDetailPanel({ ncId, onClose }: { ncId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['quality', 'nc-detail', ncId];
  const { data: nc } = useQuery({ queryKey: key, queryFn: () => api.get(`/quality/nonconformities/${ncId}/detail`).then(r => r.data.data as Detail) });
  const { entries: causes } = useReferentiel('nc_causes');
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers-min'], queryFn: () => api.get('/suppliers', { params: { limit: 500 } }).then(r => (r.data.data?.suppliers ?? r.data.data ?? []) as { id: string; name: string }[]) });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['quality'] }); };
  const err = (e: unknown) => notify.error(apiErrorMessage(e));
  const details = useMutation({ mutationFn: (b: Record<string, unknown>) => api.put(`/quality/nonconformities/${ncId}/details`, b), onSuccess: refresh, onError: err });
  const [decisionNote, setDecisionNote] = useState('');
  const decide = useMutation({ mutationFn: (decision: string) => api.post(`/quality/nonconformities/${ncId}/decision`, { decision, note: decisionNote || null }), onSuccess: () => { refresh(); notify.success('Décision enregistrée'); }, onError: err });
  const [act, setAct] = useState({ actionType: 'corrective', description: '', dueDate: '' });
  const addAction = useMutation({
    mutationFn: () => api.post(`/quality/nonconformities/${ncId}/actions`, { actionType: act.actionType, description: act.description, dueDate: act.dueDate || null }),
    onSuccess: () => { refresh(); setAct({ actionType: 'corrective', description: '', dueDate: '' }); }, onError: err,
  });
  const updAction = useMutation({ mutationFn: (v: { id: string; body: Record<string, unknown> }) => api.put(`/quality/nc-actions/${v.id}`, v.body), onSuccess: refresh, onError: err });
  const lotLabel = nc?.product_lot_number ? `lot produit ${nc.product_lot_number}` : nc?.ingredient_lot_number ? `lot matière ${nc.ingredient_lot_number}` : null;

  return (
    <Drawer title={nc?.title ?? 'Non-conformité'} subtitle="Fiche de non-conformité" onClose={onClose} width={720}>
      {nc && (
        <div style={{ display: 'grid', gap: 16, fontSize: '0.8125rem' }}>
          <FormSection title="Analyse">
            <div className="ds-form-grid">
              <FormField label="Cause" htmlFor="nc-detail-cause">
                <select id="nc-detail-cause" className="ds-input" value={nc.cause_code ?? ''} onChange={e => details.mutate({ causeCode: e.target.value || null })}>
                  <option value="">— Non renseignée —</option>
                  {causes.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </FormField>
              <FormField label="Fournisseur">
                <SearchSelect options={suppliers.map(s => ({ id: s.id, label: s.name }))} value={nc.supplier_id ?? ''} onChange={v => details.mutate({ supplierId: v || null })} placeholder="Fournisseur…" width="100%" size="md" ariaLabel="Fournisseur" />
              </FormField>
            </div>
          </FormSection>
          <FormSection title={<>Décision sur le lot {lotLabel ? `(${lotLabel})` : ''}</>}>
            {!lotLabel ? <span style={{ color: 'var(--ds-muted)' }}>Aucun lot rattaché.</span> : nc.lot_decision ? (
              <span>Décision : <strong>{DECISIONS.find(d => d[0] === nc.lot_decision)?.[1] ?? nc.lot_decision}</strong></span>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <FormField label="Commentaire (optionnel)" htmlFor="nc-detail-decision-note">
                  <input id="nc-detail-decision-note" className="ds-input" value={decisionNote} onChange={e => setDecisionNote(e.target.value)} />
                </FormField>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {DECISIONS.map(([k, l]) => (
                    <button key={k} type="button" className="odoo-btn-secondary ds-btn-sm" disabled={decide.isPending} onClick={() => decide.mutate(k)}>{l}</button>
                  ))}
                </div>
              </div>
            )}
          </FormSection>
          <FormSection title="Actions">
            <div style={{ display: 'grid', gap: 6 }}>
              {nc.actions.length === 0 && <span style={{ color: 'var(--ds-muted)' }}>Aucune action.</span>}
              {nc.actions.map(a => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--ds-hair)', paddingTop: 6 }}>
                  <StatusTag tone={a.status === 'faite' ? 'done' : a.overdue ? 'late' : 'todo'} label={a.status === 'faite' ? 'Faite' : a.overdue ? 'En retard' : a.status === 'en_cours' ? 'En cours' : 'À faire'} />
                  <span>{a.action_type === 'corrective' ? 'Corrective' : 'Préventive'} — {a.description}{a.due_date ? ` (échéance ${a.due_date.slice(0, 10).split('-').reverse().join('/')})` : ''}</span>
                  {a.status !== 'faite' && <button type="button" className="bsi-link-btn" onClick={() => updAction.mutate({ id: a.id, body: { status: 'faite' } })}>Marquer faite</button>}
                  {a.status === 'faite' && !a.effectiveness_result && <>
                    <button type="button" className="bsi-link-btn" onClick={() => updAction.mutate({ id: a.id, body: { status: 'faite', effectivenessResult: 'efficace' } })}>Efficace</button>
                    <button type="button" className="bsi-link-btn" onClick={() => updAction.mutate({ id: a.id, body: { status: 'faite', effectivenessResult: 'inefficace' } })}>Inefficace</button>
                  </>}
                  {a.effectiveness_result && <span style={{ color: 'var(--ds-muted)' }}>Efficacité : {a.effectiveness_result}</span>}
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) minmax(0, 1fr) minmax(140px, auto) auto', gap: 8, alignItems: 'end', marginTop: 8 }}>
                <FormField label="Type" htmlFor="nc-detail-act-type">
                  <select id="nc-detail-act-type" className="ds-input" value={act.actionType} onChange={e => setAct({ ...act, actionType: e.target.value })}>
                    <option value="corrective">Corrective</option><option value="preventive">Préventive</option>
                  </select>
                </FormField>
                <FormField label="Description de l'action" htmlFor="nc-detail-act-desc" required>
                  <input id="nc-detail-act-desc" className="ds-input" value={act.description} onChange={e => setAct({ ...act, description: e.target.value })} />
                </FormField>
                <FormField label="Échéance" htmlFor="nc-detail-act-due">
                  <input id="nc-detail-act-due" type="date" className="ds-input" value={act.dueDate} onChange={e => setAct({ ...act, dueDate: e.target.value })} />
                </FormField>
                <button type="button" className="odoo-btn-secondary" disabled={act.description.trim().length < 3 || addAction.isPending} onClick={() => addAction.mutate()}><Plus size={12} /> Ajouter</button>
              </div>
            </div>
          </FormSection>
        </div>
      )}
    </Drawer>
  );
}
