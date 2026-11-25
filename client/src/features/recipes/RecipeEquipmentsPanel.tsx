import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flame, Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { recipesApi } from '../../api/recipes.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { useProdTerms } from '../../hooks/useProdTerms';
import '../production/production.css';

/**
 * Équipements occupés par la fiche (audit 2026-11 C-19, mig 679) : pour chaque équipement,
 * la charge d'une fournée dans son unité de capacité (2 plaques de four, 8 kg de batteur…).
 * Une ligne sans format vaut pour tous les formats ; une ligne de format la remplace pour ce
 * format. À la confirmation d'un ordre, les fournées du jour sont comparées à la capacité.
 */
type Row = { formatId: string; equipementId: string; charge: string };
type Saved = { format_id: string | null; equipement_id: string; charge_par_fournee: number };
type Equipment = { id: string; nom: string; capacite_unite: string | null; capacite_par_cycle: number | null; cycles_par_jour: number | null };
const UNIT: Record<string, string> = { plaque: 'plaque(s)', contenant: 'contenant(s)', kg: 'kg', piece: 'pièce(s)' };

export default function RecipeEquipmentsPanel({ recipeId, readOnly }: { recipeId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const bLc = useProdTerms().batchLc;
  const key = ['recipe-equipements', recipeId];
  const { data: saved } = useQuery({ queryKey: key, queryFn: () => api.get(`/recipes/${recipeId}/equipements`).then(r => r.data.data as Saved[]) });
  const { data: equipments = [] } = useQuery({
    queryKey: ['equipment-links'], queryFn: () => api.get('/routings/equipments').then(r => r.data.data as Equipment[]),
  });
  const { data: formats = [] } = useQuery({ queryKey: ['recipe-formats', recipeId], queryFn: () => recipesApi.listFormats(recipeId) });
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (saved && !dirty) setRows(saved.map(s => ({ formatId: s.format_id ?? '', equipementId: s.equipement_id, charge: String(s.charge_par_fournee) })));
  }, [saved, dirty]);
  const edit = (i: number, patch: Partial<Row>) => { setDirty(true); setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const num = (v: string) => Number(v.replace(',', '.'));
  const valid = rows.every(r => r.equipementId && num(r.charge) > 0);
  const save = useMutation({
    mutationFn: () => api.put(`/recipes/${recipeId}/equipements`, {
      rows: rows.map(r => ({ formatId: r.formatId || null, equipementId: r.equipementId, chargeParFournee: num(r.charge) })),
    }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: key }); notify.success('Équipements enregistrés'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const eqById = new Map(equipments.map(e => [e.id, e]));
  const formatLabel = (f: (typeof formats)[number]) => `${f.contenant_nom ?? 'Format'}${f.is_default ? ' (défaut)' : ''}`;

  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head"><Flame size={13} aria-hidden="true" /> Équipements occupés
        {!readOnly && <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }}
          onClick={() => { setDirty(true); setRows(rs => [...rs, { formatId: '', equipementId: '', charge: '' }]); }}>
          <Plus size={13} aria-hidden="true" /> Ajouter
        </button>}
      </div>
      <div style={{ padding: '0.5rem 1rem', display: 'grid', gap: 8 }}>
        {rows.length === 0 && <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
          Aucun équipement : la fiche n'entre pas dans le contrôle de capacité (four, batteur…) à la confirmation des ordres.
        </span>}
        {rows.length > 0 && (
          <table className="odoo-table ds-dense">
            <thead><tr><th>Équipement</th><th>Format</th><th className="ds-num">Charge par {bLc}</th><th>Capacité de l'équipement</th>{!readOnly && <th />}</tr></thead>
            <tbody>{rows.map((r, i) => {
              const eq = eqById.get(r.equipementId);
              const unit = eq?.capacite_unite ? UNIT[eq.capacite_unite] : null;
              const fmt = formats.find(f => f.id === r.formatId);
              return (
                <tr key={i}>
                  <td>
                    {readOnly ? (eq?.nom ?? '—') : (
                      <SearchSelect options={equipments.map(e => ({ id: e.id, label: e.nom }))} value={r.equipementId}
                        onChange={v => edit(i, { equipementId: v })} placeholder="Équipement…" width={200} ariaLabel={`Équipement de la ligne ${i + 1}`} />
                    )}
                  </td>
                  <td>
                    {readOnly ? (fmt ? formatLabel(fmt) : 'Tous les formats') : (
                      <select className="ds-input sm" style={{ width: 'auto' }} value={r.formatId} aria-label={`Format de la ligne ${i + 1}`}
                        onChange={e => edit(i, { formatId: e.target.value })}>
                        <option value="">Tous les formats</option>
                        {formats.map(f => <option key={f.id} value={f.id}>{formatLabel(f)}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="ds-num">
                    {readOnly ? `${r.charge} ${unit ?? ''}` : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input className="ds-input sm" style={{ width: 70, textAlign: 'right' }} inputMode="decimal" value={r.charge}
                          aria-label={`Charge par ${bLc} de la ligne ${i + 1}`} onChange={e => edit(i, { charge: e.target.value })} />
                        <span className="ds-muted" style={{ fontSize: 12 }}>{unit ?? ''}</span>
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {!eq ? '—' : eq.capacite_par_cycle && eq.cycles_par_jour && unit
                      ? `${(eq.capacite_par_cycle * eq.cycles_par_jour).toLocaleString('fr-FR')} ${unit} par jour (${eq.capacite_par_cycle.toLocaleString('fr-FR')} × ${eq.cycles_par_jour} cycles)`
                      : <span style={{ color: 'var(--ds-warning, #b45309)' }}>Capacité non renseignée (Production › Postes de travail)</span>}
                  </td>
                  {!readOnly && <td className="ds-num">
                    <button type="button" className="bsi-link-btn" aria-label={`Retirer la ligne ${i + 1}`}
                      onClick={() => { setDirty(true); setRows(rs => rs.filter((_, j) => j !== i)); }}><Trash2 size={12} aria-hidden="true" /></button>
                  </td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {!readOnly && dirty && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-secondary" onClick={() => setDirty(false)}>Annuler</button>
            <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>Enregistrer</button>
          </div>
        )}
      </div>
    </div>
  );
}
