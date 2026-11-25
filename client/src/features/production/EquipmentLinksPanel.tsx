import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useProcessRefs } from '../../api/production.api';
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
  capacite_par_cycle: number | null; capacite_unite: string | null; cycles_par_jour: number | null;
};
const UNITS = [{ v: 'plaque', l: 'plaques' }, { v: 'contenant', l: 'contenants' }, { v: 'kg', l: 'kg' }, { v: 'piece', l: 'pièces' }];

/** Audit 2026-11 C-19 : capacité physique (par cycle × cycles par jour), saisie dans la ligne. */
function CapacityCell({ e }: { e: Row }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ cap: e.capacite_par_cycle?.toString() ?? '', unit: e.capacite_unite ?? 'plaque', cycles: e.cycles_par_jour?.toString() ?? '' });
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const dirty = n(f.cap) !== e.capacite_par_cycle || n(f.cycles) !== e.cycles_par_jour || (f.cap !== '' && f.unit !== e.capacite_unite);
  const ok = (n(f.cap) === null && n(f.cycles) === null) || ((n(f.cap) ?? 0) > 0 && Number.isInteger(n(f.cycles)) && (n(f.cycles) ?? 0) > 0);
  const save = useMutation({
    mutationFn: () => api.put(`/production-cout/equipements/${e.id}`, {
      capacite_par_cycle: n(f.cap), capacite_unite: n(f.cap) === null ? null : f.unit, cycles_par_jour: n(f.cycles),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment-links'] }); notify.success('Capacité enregistrée'); },
    onError: (err) => notify.error(apiErrorMessage(err)),
  });
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <input className="ds-input sm" style={{ width: 60, textAlign: 'right' }} inputMode="decimal" value={f.cap}
        aria-label={`Capacité par cycle de ${e.nom}`} onChange={ev => setF(x => ({ ...x, cap: ev.target.value }))} />
      <select className="ds-input sm" style={{ width: 'auto' }} value={f.unit} aria-label={`Unité de capacité de ${e.nom}`}
        onChange={ev => setF(x => ({ ...x, unit: ev.target.value }))}>
        {UNITS.map(u => <option key={u.v} value={u.v}>{u.l}</option>)}
      </select>
      <span>×</span>
      <input className="ds-input sm" style={{ width: 44, textAlign: 'right' }} inputMode="numeric" value={f.cycles}
        aria-label={`Cycles par jour de ${e.nom}`} onChange={ev => setF(x => ({ ...x, cycles: ev.target.value }))} />
      <span className="ds-muted">cycles / jour</span>
      {dirty && <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!ok || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>}
    </span>
  );
}

/** Création d'un équipement (nom, type du référentiel, capacité facultative). Avant le lot 7
 *  de l'audit, aucun écran ne permettait d'en créer : le registre restait vide. */
function NewEquipmentForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { equipmentTypes } = useProcessRefs();
  const [f, setF] = useState({ nom: '', type: '', cap: '', unit: 'plaque', cycles: '' });
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const capOk = (n(f.cap) === null && n(f.cycles) === null) || ((n(f.cap) ?? 0) > 0 && Number.isInteger(n(f.cycles)) && (n(f.cycles) ?? 0) > 0);
  const save = useMutation({
    mutationFn: () => api.post('/production-cout/equipements', {
      nom: f.nom.trim(), type: f.type, cout_horaire: 0,
      ...(n(f.cap) !== null ? { capacite_par_cycle: n(f.cap), capacite_unite: f.unit, cycles_par_jour: n(f.cycles) } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment-links'] }); notify.success('Équipement créé'); onDone(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--ds-border, #e5e7eb)', fontSize: 13 }}>
      <input className="ds-input sm" style={{ width: 200 }} placeholder="Nom (Four à sole 1…)" value={f.nom} aria-label="Nom de l'équipement"
        onChange={e => setF(x => ({ ...x, nom: e.target.value }))} />
      <select className="ds-input sm" style={{ width: 'auto' }} value={f.type} aria-label="Type d'équipement" onChange={e => setF(x => ({ ...x, type: e.target.value }))}>
        <option value="">Type…</option>
        {equipmentTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
      </select>
      <span className="ds-muted">Capacité</span>
      <input className="ds-input sm" style={{ width: 60, textAlign: 'right' }} inputMode="decimal" value={f.cap} aria-label="Capacité par cycle"
        onChange={e => setF(x => ({ ...x, cap: e.target.value }))} />
      <select className="ds-input sm" style={{ width: 'auto' }} value={f.unit} aria-label="Unité de capacité" onChange={e => setF(x => ({ ...x, unit: e.target.value }))}>
        {UNITS.map(u => <option key={u.v} value={u.v}>{u.l}</option>)}
      </select>
      <span>×</span>
      <input className="ds-input sm" style={{ width: 44, textAlign: 'right' }} inputMode="numeric" value={f.cycles} aria-label="Cycles par jour"
        onChange={e => setF(x => ({ ...x, cycles: e.target.value }))} />
      <span className="ds-muted">cycles / jour</span>
      <button type="button" className="odoo-btn-primary" disabled={!f.nom.trim() || !f.type || !capOk || save.isPending} onClick={() => save.mutate()}>Créer</button>
      <button type="button" className="odoo-btn-secondary" onClick={onDone}>Annuler</button>
    </div>
  );
}

export default function EquipmentLinksPanel({ workCenters }: { workCenters: { id: string; name: string; is_active: boolean }[] }) {
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['equipment-links'], queryFn: () => api.get('/routings/equipments').then(r => r.data.data as Row[]) });
  const link = useMutation({
    mutationFn: (v: { id: string; workCenterId?: string | null; fixedAssetId?: string | null }) =>
      api.put(`/routings/equipments/${v.id}/link`, { workCenterId: v.workCenterId, fixedAssetId: v.fixedAssetId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment-links'] }); notify.success('Lien enregistré'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const centers = workCenters.filter(w => w.is_active).map(w => ({ id: w.id, label: w.name }));

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <SectionHeader title="Équipements" note="Rattachement aux postes de travail et aux immobilisations ; capacité contrôlée à la confirmation des ordres">
        {!adding && <button type="button" className="odoo-btn-secondary" onClick={() => setAdding(true)}><Plus size={13} aria-hidden="true" /> Ajouter un équipement</button>}
      </SectionHeader>
      <DataPanel label="Équipements" footer={<TableFooter note={`${data.length} équipement(s)`} />}>
      {adding && <NewEquipmentForm onDone={() => setAdding(false)} />}
      {data.length === 0 && !adding && (
        <p style={{ margin: 0, padding: '14px 16px', fontSize: 13, color: 'var(--ds-muted)' }}>
          Aucun équipement. Déclarez le four, le batteur, le pétrin… avec leur capacité : les fiches s'y rattachent et chaque ordre est contrôlé à sa confirmation.
        </p>
      )}
      {data.length > 0 && <table className="odoo-table">
        <thead><tr><th>Équipement</th><th>Poste de travail</th><th>Immobilisation</th><th>Capacité</th></tr></thead>
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
            <td><CapacityCell key={`${e.id}-${e.capacite_par_cycle}-${e.capacite_unite}-${e.cycles_par_jour}`} e={e} /></td>
          </tr>
        ))}</tbody>
      </table>}
      </DataPanel>
    </section>
  );
}
