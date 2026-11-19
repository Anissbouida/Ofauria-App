import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import { Panel } from './KlUi';

/**
 * Plan de contrôle par article (M7-02) : quoi contrôler (caractéristique, bornes), quand
 * (réception d'une matière, en cours de fabrication, contrôle final d'un article) et à quelle
 * fréquence. Les inspections à faire sont créées automatiquement ; une ligne « bloquante »
 * retient le lot tant qu'elle n'est pas conforme (M7-04).
 */
type Line = {
  id: string; stage: string; characteristic: string; char_type: string; min_value: string | null; max_value: string | null; unit: string | null;
  frequency: string; frequency_n: number | null; sample_size: number; is_blocking: boolean; product_name: string | null; ingredient_name: string | null;
};
const STAGE: Record<string, string> = { reception: 'Réception', en_cours: 'En cours', final: 'Final' };
const FREQ: Record<string, string> = { chaque_lot: 'Chaque lot', un_sur_n: '1 lot sur N', par_quantite: 'Par quantité' };
const TYPE: Record<string, string> = { mesure: 'Mesure', oui_non: 'Oui / non', visuel: 'Visuel' };
const EMPTY = { stage: 'final', targetId: '', characteristic: '', charType: 'oui_non', minValue: '', maxValue: '', unit: '', frequency: 'chaque_lot', frequencyN: '', sampleSize: '1', isBlocking: false };

export default function ControlPlanSection() {
  const qc = useQueryClient();
  const { data: lines = [] } = useQuery({ queryKey: ['quality', 'control-plan'], queryFn: () => api.get('/quality/control-plan').then(r => r.data.data as Line[]) });
  const [f, setF] = useState(EMPTY);
  const reception = f.stage === 'reception';
  const { data: products = [] } = useQuery({
    queryKey: ['products-min'], enabled: !reception,
    queryFn: () => api.get('/products', { params: { limit: 1000 } }).then(r => (r.data.data?.products ?? r.data.data ?? []) as { id: string; name: string }[]),
  });
  const { data: ingredients = [] } = useQuery({ queryKey: ['ingredients-min-allergens'], queryFn: () => ingredientsApi.allergenGrid(), enabled: reception });
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = useMutation({
    mutationFn: () => api.post('/quality/control-plan', {
      stage: f.stage, characteristic: f.characteristic, charType: f.charType,
      ...(reception ? { ingredientId: f.targetId } : { productId: f.targetId }),
      minValue: f.charType === 'mesure' ? num(f.minValue) : null, maxValue: f.charType === 'mesure' ? num(f.maxValue) : null,
      unit: f.unit || null, frequency: f.frequency, frequencyN: f.frequency === 'chaque_lot' ? null : num(f.frequencyN),
      sampleSize: Number(f.sampleSize) || 1, isBlocking: f.isBlocking,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quality', 'control-plan'] }); setF({ ...EMPTY, stage: f.stage }); notify.success('Ligne ajoutée au plan de contrôle'); },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/quality/control-plan/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quality', 'control-plan'] }),
    onError: (e) => notify.error(apiErrorMessage(e)),
  });
  const valid = f.targetId && f.characteristic.trim().length >= 2 && (f.charType !== 'mesure' || num(f.minValue) != null || num(f.maxValue) != null)
    && (f.frequency === 'chaque_lot' || (num(f.frequencyN) ?? 0) > 0);

  return (
    <>
      <section className="prj-panel klc-body" aria-label="Ajouter un contrôle au plan" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8125rem' }}>
        <select className="input" style={{ width: 'auto' }} value={f.stage} aria-label="Étape" onChange={e => setF({ ...f, stage: e.target.value, targetId: '' })}>
          {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <SearchSelect options={(reception ? ingredients : products).map(x => ({ id: x.id, label: x.name }))} value={f.targetId}
          onChange={v => setF({ ...f, targetId: v })} placeholder={reception ? 'Matière…' : 'Article…'} width={220} ariaLabel={reception ? 'Matière' : 'Article'} />
        <input className="input" style={{ width: 200 }} placeholder="Caractéristique (ex. Poids unitaire)" value={f.characteristic} onChange={e => setF({ ...f, characteristic: e.target.value })} />
        <select className="input" style={{ width: 'auto' }} value={f.charType} aria-label="Type" onChange={e => setF({ ...f, charType: e.target.value })}>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {f.charType === 'mesure' && <>
          <input className="input" style={{ width: 70 }} placeholder="Min" value={f.minValue} onChange={e => setF({ ...f, minValue: e.target.value })} />
          <input className="input" style={{ width: 70 }} placeholder="Max" value={f.maxValue} onChange={e => setF({ ...f, maxValue: e.target.value })} />
          <input className="input" style={{ width: 60 }} placeholder="Unité" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} />
        </>}
        <select className="input" style={{ width: 'auto' }} value={f.frequency} aria-label="Fréquence" onChange={e => setF({ ...f, frequency: e.target.value })}>
          {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {f.frequency !== 'chaque_lot' && <input className="input" style={{ width: 60 }} placeholder="N" value={f.frequencyN} onChange={e => setF({ ...f, frequencyN: e.target.value })} />}
        <label>Échantillon <input className="input" style={{ width: 54 }} value={f.sampleSize} onChange={e => setF({ ...f, sampleSize: e.target.value.replace(/\D/g, '') })} /></label>
        <label><input type="checkbox" checked={f.isBlocking} onChange={e => setF({ ...f, isBlocking: e.target.checked })} /> Bloquant</label>
        <button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}><Plus size={12} /> Ajouter</button>
      </section>
      <Panel>
        <table className="odoo-table">
          <thead><tr><th>Étape</th><th>Article / matière</th><th>Caractéristique</th><th>Fréquence</th><th style={{ textAlign: 'right' }}>Échantillon</th><th /></tr></thead>
          <tbody>{lines.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--theme-text-muted)' }}>Aucun contrôle planifié : aucune inspection n'est générée automatiquement.</td></tr> : lines.map(l => (
            <tr key={l.id}>
              <td>{STAGE[l.stage]}</td>
              <td style={{ fontWeight: 500 }}>{l.product_name ?? l.ingredient_name ?? 'Famille'}</td>
              <td>{l.characteristic} <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.8125rem' }}>({TYPE[l.char_type]}{l.char_type === 'mesure' ? ` ${l.min_value ?? '−∞'} à ${l.max_value ?? '+∞'}${l.unit ? ' ' + l.unit : ''}` : ''})</span>{l.is_blocking && <span style={{ marginLeft: 6 }}><StatusTag tone="blocked" label="bloquant" /></span>}</td>
              <td>{FREQ[l.frequency]}{l.frequency_n ? ` (N = ${l.frequency_n})` : ''}</td>
              <td style={{ textAlign: 'right' }}>{l.sample_size}</td>
              <td style={{ textAlign: 'right' }}><button type="button" className="odoo-btn-secondary" aria-label={`Retirer ${l.characteristic}`} title="Retirer" onClick={() => remove.mutate(l.id)}><Trash2 size={12} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}
