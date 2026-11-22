import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import api from '../../api/client';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

import { DataPanel, SectionHeader, TableFooter } from '../../components/ds';
/**
 * Référentiel équipement (M5-05) : chaque équipement physique se rattache à un poste de
 * travail et à une immobilisation. Les immobilisations au nom proche sont proposées ;
 * le lien n'existe qu'une fois validé ici.
 */
type Row = {
  id: string; nom: string; type: string; work_center_id: string | null; work_center_name: string | null;
  fixed_asset_id: string | null; fixed_asset_label: string | null; asset_proposals: { id: string; label: string; score: number }[];
};

export default function EquipmentLinksPanel({ workCenters }: { workCenters: { id: string; name: string; is_active: boolean }[] }) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['equipment-links'], queryFn: () => api.get('/routings/equipments').then(r => r.data.data as Row[]) });
  const link = useMutation({
    mutationFn: (v: { id: string; workCenterId?: string | null; fixedAssetId?: string | null }) =>
      api.put(`/routings/equipments/${v.id}/link`, { workCenterId: v.workCenterId, fixedAssetId: v.fixedAssetId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment-links'] }); notify.success('Lien enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  if (!data.length) return null;
  const centers = workCenters.filter(w => w.is_active).map(w => ({ id: w.id, label: w.name }));

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <SectionHeader title="Équipements" note="Rattachement aux postes de travail et aux immobilisations" />
      <DataPanel label="Équipements" footer={<TableFooter note={`${data.length} équipement(s)`} />}>
      <table className="odoo-table">
        <thead><tr><th>Équipement</th><th>Poste de travail</th><th>Immobilisation</th></tr></thead>
        <tbody>{data.map(e => (
          <tr key={e.id}>
            <td><span className="ds-strong">{e.nom}</span><div style={{ fontSize: 12, color: 'var(--ds-muted)' }}>{e.type}</div></td>
            <td>
              <SearchSelect options={centers} value={e.work_center_id ?? ''} onChange={v => link.mutate({ id: e.id, workCenterId: v || null })}
                placeholder="Aucun poste" width={200} ariaLabel={`Poste de ${e.nom}`} />
            </td>
            <td>
              {e.fixed_asset_id ? (
                <span>{e.fixed_asset_label} <button type="button" className="bsi-link-btn" onClick={() => link.mutate({ id: e.id, fixedAssetId: null })}>Détacher</button></span>
              ) : e.asset_proposals.length ? (
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {e.asset_proposals.map(a => (
                    <button key={a.id} type="button" className="odoo-btn-secondary ds-btn-sm"
                      title={`Ressemblance des noms : ${Math.round(a.score * 100)} %`} onClick={() => link.mutate({ id: e.id, fixedAssetId: a.id })}>
                      Rattacher « {a.label} »
                    </button>
                  ))}
                </span>
              ) : <span style={{ color: 'var(--ds-muted)' }}>Aucune proposition</span>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      </DataPanel>
    </section>
  );
}
