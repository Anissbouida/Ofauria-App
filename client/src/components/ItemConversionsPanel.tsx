import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import api from '../api/client';
import { notify } from './ui/InlineNotification';
import { apiErrorMessage } from '../api/errors';

/**
 * Unités et conversions d'un article (M3-02) : « 1 carton = 12 pièces », « 1 pièce = 0,35 kg ».
 * Les lignes reprises de la fiche (densité, contenant, poids par pièce) se modifient par
 * leur champ sur la fiche ; les lignes saisies s'ajoutent et se retirent ici.
 */
type Conversion = {
  id: string; origin: 'saisie' | 'densite' | 'contenant' | 'poids_piece'; factor: number; notes: string | null;
  from_unit: string | null; from_unit_label: string | null; from_container: string | null; to_unit: string; to_unit_label: string;
};
type UnitRow = { code: string; label: string; is_active: boolean };
const ORIGIN: Record<Conversion['origin'], string> = { saisie: 'Saisie', densite: 'Densité', contenant: 'Contenant', poids_piece: 'Poids par pièce' };

export default function ItemConversionsPanel({ kind, itemId, canEdit = true }: { kind: 'ingredient' | 'product'; itemId: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const base = kind === 'ingredient' ? `/ingredients/${itemId}/conversions` : `/products/${itemId}/conversions`;
  const { data = [], isLoading } = useQuery({ queryKey: ['item-conversions', kind, itemId], queryFn: () => api.get(base).then(r => r.data.data as Conversion[]) });
  const { data: unitsData } = useQuery({
    queryKey: ['settings-units'],
    queryFn: () => api.get('/settings/units').then(r => r.data.data as { units: UnitRow[] }),
  });
  const units = (unitsData?.units ?? []).filter(u => u.is_active);
  const [draft, setDraft] = useState({ fromUnit: '', toUnit: '', factor: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['item-conversions', kind, itemId] });
  const add = useMutation({
    mutationFn: () => api.post(base, { fromUnit: draft.fromUnit, toUnit: draft.toUnit, factor: Number(draft.factor.replace(',', '.')) }),
    onSuccess: () => { setDraft({ fromUnit: '', toUnit: '', factor: '' }); refresh(); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`${base}/${id}`), onSuccess: refresh, onError: (e) => notify.error(apiErrorMessage(e)) });

  if (isLoading) return <Loader2 className="animate-spin" size={16} />;
  const factorOk = Number(draft.factor.replace(',', '.')) > 0;
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-label="Unités et conversions">
      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Unités et conversions</div>
      {data.length === 0 && <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Aucune conversion.</div>}
      {data.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
          <span>1 {c.from_container ?? c.from_unit_label ?? c.from_unit} = <strong>{c.factor.toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</strong> {c.to_unit_label}</span>
          <span className="odoo-tag odoo-tag-grey">{ORIGIN[c.origin]}</span>
          {canEdit && c.origin === 'saisie' && (
            <button type="button" className="odoo-btn-secondary" onClick={() => remove.mutate(c.id)} aria-label="Retirer la conversion" style={{ padding: '2px 6px' }}><Trash2 size={12} /></button>
          )}
        </div>
      ))}
      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.875rem' }}>
          1
          <select className="input" value={draft.fromUnit} onChange={e => setDraft(d => ({ ...d, fromUnit: e.target.value }))} aria-label="Unité source" style={{ width: 'auto' }}>
            <option value="">unité…</option>{units.map(u => <option key={u.code} value={u.code}>{u.label}</option>)}
          </select>
          =
          <input className="input" value={draft.factor} onChange={e => setDraft(d => ({ ...d, factor: e.target.value }))} placeholder="12" aria-label="Facteur" style={{ width: 90 }} />
          <select className="input" value={draft.toUnit} onChange={e => setDraft(d => ({ ...d, toUnit: e.target.value }))} aria-label="Unité cible" style={{ width: 'auto' }}>
            <option value="">unité…</option>{units.map(u => <option key={u.code} value={u.code}>{u.label}</option>)}
          </select>
          <button type="button" className="odoo-btn-secondary" disabled={!draft.fromUnit || !draft.toUnit || draft.fromUnit === draft.toUnit || !factorOk || add.isPending}
            onClick={() => add.mutate()}><Plus size={12} /> Ajouter</button>
        </div>
      )}
    </div>
  );
}
