import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import api from '../../api/client';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

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
    <div className="odoo-section" style={{ marginTop: '1rem' }}>
      <div className="odoo-section-header flex items-center gap-2"><Wrench size={13} /> Équipements</div>
      <table className="w-full text-xs">
        <thead><tr className="text-gray-500"><th className="text-left px-3 py-1">Équipement</th><th className="text-left px-2">Poste de travail</th><th className="text-left px-2">Immobilisation</th></tr></thead>
        <tbody>{data.map(e => (
          <tr key={e.id} className="border-t border-gray-100">
            <td className="px-3 py-1.5">{e.nom}<div className="text-gray-500">{e.type}</div></td>
            <td className="px-2">
              <SearchSelect options={centers} value={e.work_center_id ?? ''} onChange={v => link.mutate({ id: e.id, workCenterId: v || null })}
                placeholder="— Aucun poste —" width={200} ariaLabel={`Poste de ${e.nom}`} />
            </td>
            <td className="px-2">
              {e.fixed_asset_id ? (
                <span>{e.fixed_asset_label} <button type="button" className="bsi-link-btn" onClick={() => link.mutate({ id: e.id, fixedAssetId: null })}>Détacher</button></span>
              ) : e.asset_proposals.length ? (
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {e.asset_proposals.map(a => (
                    <button key={a.id} type="button" className="odoo-btn-secondary" style={{ padding: '0.15rem 0.45rem' }}
                      title={`Ressemblance des noms : ${Math.round(a.score * 100)} %`} onClick={() => link.mutate({ id: e.id, fixedAssetId: a.id })}>
                      Rattacher « {a.label} »
                    </button>
                  ))}
                </span>
              ) : <span className="text-gray-500">Aucune proposition</span>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
