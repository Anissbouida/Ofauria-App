import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Inbox } from 'lucide-react';
import api from '../../api/client';
import { categoriesApi } from '../../api/categories.api';
import { ingredientsApi } from '../../api/inventory.api';
import SearchSelect from '../../components/ui/SearchSelect';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { StatusTag } from '../../components/ui/StatusTag';
import { Panel } from './KlUi';
import { EmptyState, FormSection, FormField } from '../../components/ds';

/**
 * Plan de contrôle par article (M7-02) : quoi contrôler (caractéristique, bornes), quand
 * (réception d'une matière, en cours de fabrication, contrôle final d'un article) et à quelle
 * fréquence. Les inspections à faire sont créées automatiquement ; une ligne « bloquante »
 * retient le lot tant qu'elle n'est pas conforme (M7-04).
 */
type Line = {
  id: string; stage: string; characteristic: string; char_type: string; min_value: string | null; max_value: string | null; unit: string | null;
  frequency: string; frequency_n: number | null; sample_size: number; is_blocking: boolean; product_name: string | null; ingredient_name: string | null; category_name?: string | null;
};
const STAGE: Record<string, string> = { reception: 'Réception', en_cours: 'En cours', final: 'Final', avant_transfert: 'Avant transfert', avant_livraison: 'Avant livraison' };
const FREQ: Record<string, string> = { chaque_lot: 'Chaque lot', un_sur_n: '1 lot sur N', par_quantite: 'Par quantité' };
const TYPE: Record<string, string> = { mesure: 'Mesure', oui_non: 'Oui / non', visuel: 'Visuel' };
const EMPTY = { stage: 'final', scope: 'article', targetId: '', characteristic: '', charType: 'oui_non', minValue: '', maxValue: '', unit: '', frequency: 'chaque_lot', frequencyN: '', sampleSize: '1', isBlocking: false };

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
  // Étape 7 multi-industries : un contrôle se rattache à un article OU à sa famille (exportable dans un profil).
  const family = !reception && f.scope === 'famille';
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list, enabled: family });
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const save = useMutation({
    mutationFn: () => api.post('/quality/control-plan', {
      stage: f.stage, characteristic: f.characteristic, charType: f.charType,
      ...(reception ? { ingredientId: f.targetId } : family ? { productCategoryId: Number(f.targetId) } : { productId: f.targetId }),
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
      <section className="prj-panel klc-body" aria-label="Ajouter un contrôle au plan">
        <FormSection title="Ajouter un contrôle au plan">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            <FormField label="Étape" htmlFor="cp-stage">
              <select id="cp-stage" className="ds-input" value={f.stage} onChange={e => setF({ ...f, stage: e.target.value, targetId: '' })}>
                {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            {!reception && (
              <FormField label="Porte sur" htmlFor="cp-scope">
                <select id="cp-scope" className="ds-input" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value, targetId: '' })}>
                  <option value="article">Un article</option>
                  <option value="famille">Une famille d'articles</option>
                </select>
              </FormField>
            )}
            <FormField label={reception ? 'Matière' : family ? 'Famille' : 'Article'}>
              <SearchSelect options={(reception ? ingredients : family ? (categories as { id: number; name: string }[]).map(c => ({ id: String(c.id), name: c.name })) : products).map(x => ({ id: String(x.id), label: x.name }))} value={f.targetId}
                onChange={v => setF({ ...f, targetId: v })} placeholder={reception ? 'Matière…' : family ? 'Famille…' : 'Article…'} width="100%" size="md" ariaLabel={reception ? 'Matière' : family ? 'Famille' : 'Article'} />
            </FormField>
            <FormField label="Caractéristique" htmlFor="cp-char" required>
              <input id="cp-char" className="ds-input" placeholder="Ex. Poids unitaire" value={f.characteristic} onChange={e => setF({ ...f, characteristic: e.target.value })} />
            </FormField>
            <FormField label="Type" htmlFor="cp-type">
              <select id="cp-type" className="ds-input" value={f.charType} onChange={e => setF({ ...f, charType: e.target.value })}>
                {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            {f.charType === 'mesure' && <>
              <FormField label="Min" htmlFor="cp-min"><input id="cp-min" className="ds-input" value={f.minValue} onChange={e => setF({ ...f, minValue: e.target.value })} /></FormField>
              <FormField label="Max" htmlFor="cp-max"><input id="cp-max" className="ds-input" value={f.maxValue} onChange={e => setF({ ...f, maxValue: e.target.value })} /></FormField>
              <FormField label="Unité" htmlFor="cp-unit"><input id="cp-unit" className="ds-input" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></FormField>
            </>}
            <FormField label="Fréquence" htmlFor="cp-freq">
              <select id="cp-freq" className="ds-input" value={f.frequency} onChange={e => setF({ ...f, frequency: e.target.value })}>
                {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            {f.frequency !== 'chaque_lot' && <FormField label="N" htmlFor="cp-n"><input id="cp-n" className="ds-input" value={f.frequencyN} onChange={e => setF({ ...f, frequencyN: e.target.value })} /></FormField>}
            <FormField label="Échantillon" htmlFor="cp-sample"><input id="cp-sample" className="ds-input" value={f.sampleSize} onChange={e => setF({ ...f, sampleSize: e.target.value.replace(/\D/g, '') })} /></FormField>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, fontSize: '13px' }}><input type="checkbox" checked={f.isBlocking} onChange={e => setF({ ...f, isBlocking: e.target.checked })} /> Bloquant</label>
            <div><button type="button" className="odoo-btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}><Plus size={12} /> Ajouter</button></div>
          </div>
        </FormSection>
      </section>
      <Panel>
        <table className="odoo-table">
          <thead><tr><th>Étape</th><th>Article / matière</th><th>Caractéristique</th><th>Fréquence</th><th className="ds-num">Échantillon</th><th className="ds-actions"><span className="ds-sr-only">Actions</span></th></tr></thead>
          <tbody>{lines.length === 0 ? <tr><td colSpan={6}><EmptyState bare icon={Inbox} title="Aucun contrôle planifié : aucune inspection n'est générée automatiquement" /></td></tr> : lines.map(l => (
            <tr key={l.id}>
              <td>{STAGE[l.stage]}</td>
              <td className="ds-strong">{l.product_name ?? l.ingredient_name ?? (l.category_name ? `Famille : ${l.category_name}` : 'Famille')}</td>
              <td>{l.characteristic} <span style={{ color: 'var(--ds-muted)', fontSize: '13px' }}>({TYPE[l.char_type]}{l.char_type === 'mesure' ? ` ${l.min_value ?? '−∞'} à ${l.max_value ?? '+∞'}${l.unit ? ' ' + l.unit : ''}` : ''})</span>{l.is_blocking && <span style={{ marginLeft: 6 }}><StatusTag tone="blocked" label="bloquant" /></span>}</td>
              <td>{FREQ[l.frequency]}{l.frequency_n ? ` (N = ${l.frequency_n})` : ''}</td>
              <td className="ds-num">{l.sample_size}</td>
              <td className="ds-actions"><button type="button" className="ds-icon-btn" aria-label={`Retirer ${l.characteristic}`} title="Retirer" onClick={() => remove.mutate(l.id)}><Trash2 size={12} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}
