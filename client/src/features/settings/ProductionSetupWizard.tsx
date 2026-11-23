import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FlaskConical, Send, XCircle } from 'lucide-react';
import api from '../../api/client';
import { Alert, DataPanel, FormField } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag } from '../../components/ui/StatusTag';
import { SettingsSection } from './SettingsPrimitives';

/**
 * Assistant de configuration de la production (plan d'exécution multi-industries, étape 11).
 *
 * Huit étapes ; chacune renvoie vers l'écran qui la règle. La simulation déroule un ordre
 * fictif dans une transaction annulée et rend son rapport étape par étape. La publication
 * (version de configuration) est refusée tant qu'un point bloquant subsiste.
 */
type Step = { key: string; label: string; status: 'fait' | 'a_faire' | 'facultatif' | 'bloquant'; detail: string; to: string };
type SimStep = { step: string; ok: boolean; detail: string; stock?: string };
type Sim = { ok: boolean; orderType: string | null; steps: SimStep[]; at: string };
type Setup = { steps: Step[]; blocking: string[]; lastSimulation: Sim | null };
const TONE: Record<Step['status'], 'done' | 'todo' | 'draft' | 'blocked'> = { fait: 'done', a_faire: 'todo', facultatif: 'draft', bloquant: 'blocked' };
const LABEL: Record<Step['status'], string> = { fait: 'Fait', a_faire: 'À faire', facultatif: 'Facultatif', bloquant: 'Bloquant' };
const errMsg = (e: unknown) => {
  const err = (e as { response?: { data?: { error?: { message?: string; details?: string[] } } } })?.response?.data?.error;
  return [err?.message ?? 'Opération impossible', ...(err?.details ?? [])].join(' — ');
};

export default function ProductionSetupWizard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [orderType, setOrderType] = useState('');
  const { data } = useQuery({ queryKey: ['production-setup'], queryFn: () => api.get('/settings/production-setup').then(r => r.data.data as Setup) });
  const { data: types = [] } = useQuery({
    queryKey: ['order-types-min'],
    queryFn: () => api.get('/production/order-types').then(r => (r.data.data ?? []) as { code: string; label: string; is_active?: boolean }[]).catch(() => []),
  });
  const simulate = useMutation({
    mutationFn: () => api.post('/settings/production-setup/simulate', { orderTypeCode: orderType || null }).then(r => r.data.data as Sim),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['production-setup'] }); r.ok ? notify.success('Simulation réussie : rien n\'a été enregistré') : notify.error('La simulation a échoué : voir le rapport'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: () => api.post('/settings/production-setup/publish', {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-setup'] }); notify.success('Configuration publiée (version enregistrée)'); },
    onError: (e: unknown) => notify.error(errMsg(e)),
  });
  const sim = simulate.data ?? data?.lastSimulation ?? null;

  return (
    <SettingsSection title="Assistant de configuration" columns={1}
      description="Huit étapes pour configurer la production d'une société sans développement. Chaque étape ouvre l'écran qui la règle ; la simulation déroule un ordre fictif sans rien enregistrer ; la publication fige une version de la configuration.">
      <div style={{ display: 'grid', gap: 16 }}>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Étapes de la configuration">
          {(data?.steps ?? []).map((s, i) => (
            <li key={s.key} className="prj-panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
              <span style={{ width: 26, textAlign: 'center', fontWeight: 700 }}>{s.status === 'fait' ? <CheckCircle2 size={20} color="var(--ds-success)" /> : <Circle size={20} />}</span>
              <span style={{ fontWeight: 600, minWidth: 190 }}>{i + 1}. {s.label}</span>
              <span className="odoo-setting-help" style={{ flex: 1 }}>{s.detail}</span>
              <StatusTag tone={TONE[s.status]} label={LABEL[s.status]} />
              {s.to && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => navigate(s.to)}>Ouvrir</button>}
            </li>
          ))}
        </ol>

        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260 }}>
            <FormField label="Type d'ordre à simuler" htmlFor="sim-type">
              <select id="sim-type" className="ds-input" value={orderType} onChange={e => setOrderType(e.target.value)}>
                <option value="">Type par défaut</option>
                {types.filter(t => t.is_active !== false).map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </FormField>
          </div>
          <button type="button" className="odoo-btn-secondary" disabled={simulate.isPending} onClick={() => simulate.mutate()}><FlaskConical size={14} /> Lancer la simulation</button>
          <button type="button" className="odoo-btn-primary" disabled={publish.isPending || (data?.blocking.length ?? 1) > 0} onClick={() => publish.mutate()}
            title={(data?.blocking.length ?? 0) > 0 ? 'Des points bloquants subsistent' : undefined}><Send size={14} /> Publier la configuration</button>
        </div>

        {(data?.blocking.length ?? 0) > 0 && (
          <Alert tone="warning">Publication impossible tant que ces points subsistent : {data!.blocking.join(' · ')}</Alert>
        )}

        {sim && (
          <DataPanel label="Rapport de simulation">
            <table className="odoo-table">
              <thead><tr><th>Étape</th><th>Résultat</th><th>Ce que le système a fait</th><th>Stock de la matière</th></tr></thead>
              <tbody>
                {sim.steps.map((s, i) => (
                  <tr key={i}>
                    <td className="ds-strong">{s.step}</td>
                    <td>{s.ok ? <CheckCircle2 size={16} color="var(--ds-success)" aria-label="Réussi" /> : <XCircle size={16} color="var(--ds-danger)" aria-label="Échoué" />}</td>
                    <td>{s.detail}</td>
                    <td>{s.stock ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </div>
    </SettingsSection>
  );
}
