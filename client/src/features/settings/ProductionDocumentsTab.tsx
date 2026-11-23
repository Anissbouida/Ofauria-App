import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPROVAL_DOC_TYPES } from '@ofauria/shared';
import { productionApi, type ProductionDocument } from '../../api/production.api';
import { DataPanel, LoadingState } from '../../components/ds';
import { notify } from '../../components/ui/InlineNotification';
import { SettingsSection } from './SettingsPrimitives';

/**
 * Documents de production pilotables (plan d'exécution multi-industries, étape 6, mig 640).
 *
 * Activer, rendre obligatoire, choisir la génération. Désactiver retire le document, jamais
 * l'enregistrement dont il est la trace (la pesée, la déclaration, le transfert restent).
 * L'approbation se règle dans Paramètres › Approbations, par type de pièce.
 */
const STAGES: Record<string, string> = {
  planification: 'Planification', bon_de_sortie: 'Bon de sortie', fabrication: 'Fabrication',
  cloture: 'Déclaration et clôture', transfert: 'Transfert',
};

export default function ProductionDocumentsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['production-documents'], queryFn: productionApi.documents });
  const save = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: Parameters<typeof productionApi.updateDocument>[1] }) => productionApi.updateDocument(key, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production-documents'] }); notify.success('Document mis à jour'); },
    onError: (e: unknown) => notify.error((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Enregistrement impossible'),
  });
  if (isLoading || !data) return <LoadingState />;
  const set = (d: ProductionDocument, patch: Parameters<typeof productionApi.updateDocument>[1]) => save.mutate({ key: d.docKey, patch });
  const approvalLabel = (t: string | null) => (t && (APPROVAL_DOC_TYPES as Record<string, { label: string }>)[t]?.label) || '—';

  return (
    <SettingsSection title="Documents de production" columns={1}
      description="Choisissez les documents que votre métier utilise. Désactiver un document le retire des impressions ; l'opération dont il est la trace (pesée, déclaration, transfert) reste possible. Un document obligatoire est toujours actif. Les approbations se règlent par type de pièce dans Paramètres › Approbations.">
      <DataPanel label="Documents de production">
        <table className="odoo-table">
          <thead>
            <tr><th>Document</th><th>Étape</th><th>Génération</th><th>Actif</th><th>Obligatoire</th><th>Approbation possible</th><th>Trace de</th></tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.docKey} style={{ opacity: d.enabled ? 1 : 0.6 }}>
                <td><span className="ds-strong">{d.label}</span>{d.description && <><br /><span className="odoo-setting-help">{d.description}</span></>}</td>
                <td>{d.stageCode ? (STAGES[d.stageCode] ?? d.stageCode) : '—'}</td>
                <td>
                  <select className="ds-input sm" aria-label={`Génération — ${d.label}`} value={d.generation} disabled={save.isPending}
                    onChange={e => set(d, { generation: e.target.value as 'auto' | 'manuel' })}>
                    <option value="auto">Automatique</option>
                    <option value="manuel">À la demande</option>
                  </select>
                </td>
                <td><input type="checkbox" aria-label={`Actif — ${d.label}`} checked={d.enabled} disabled={save.isPending}
                  onChange={e => set(d, { enabled: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`Obligatoire — ${d.label}`} checked={d.mandatory} disabled={save.isPending}
                  onChange={e => set(d, { mandatory: e.target.checked })} /></td>
                <td>{approvalLabel(d.approvalDocType)}</td>
                <td>{d.recordLabel ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataPanel>
    </SettingsSection>
  );
}
