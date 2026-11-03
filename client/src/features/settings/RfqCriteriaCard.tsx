import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { rfqApi, RFQ_CRITERION_TYPE_LABELS, type RfqCriterion, type RfqCriterionType } from '../../api/rfq.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

/**
 * Paramètres › Achats : critères de notation des demandes de prix (mig 459).
 * On ajoute / retire des critères (même « Prix »), on règle leur poids, on les
 * active ou non. Les critères « calculés » (prix, fournisseur, délai) sont uniques
 * et automatiques ; les critères « manuels » sont notés sur chaque devis.
 */
export default function RfqCriteriaCard() {
  const qc = useQueryClient();
  const { data: criteria = [], isLoading } = useQuery({ queryKey: ['rfq-criteria', 'all'], queryFn: () => rfqApi.listCriteria(true) });
  const [label, setLabel] = useState('');
  const [type, setType] = useState<RfqCriterionType>('manual');
  const [weight, setWeight] = useState('10');

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['rfq-criteria'] }); qc.invalidateQueries({ queryKey: ['rfq'] }); };
  const create = useMutation({
    mutationFn: () => rfqApi.createCriterion({ label: label.trim(), type, weight: Number(weight) || 0 }),
    onSuccess: () => { setLabel(''); setWeight('10'); setType('manual'); invalidate(); notify.success('Critère ajouté'); },
    onError: e => notify.error(apiErrorMessage(e, 'Ajout impossible')),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { label?: string; weight?: number; active?: boolean } }) => rfqApi.updateCriterion(id, patch),
    onSuccess: invalidate, onError: e => notify.error(apiErrorMessage(e, 'Modification impossible')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => rfqApi.deleteCriterion(id),
    onSuccess: () => { invalidate(); notify.success('Critère retiré'); }, onError: e => notify.error(apiErrorMessage(e, 'Suppression impossible')),
  });

  const activeWeight = (criteria as RfqCriterion[]).filter(c => c.active).reduce((s, c) => s + c.weight, 0);
  const hasType = (t: RfqCriterionType) => (criteria as RfqCriterion[]).some(c => c.type === t);

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '12px 16px', background: 'var(--odoo-bg)', display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontWeight: 600 }}>Critères de notation des demandes de prix</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
          Le devis recommandé est le mieux noté sur ces critères (moyenne pondérée). Ajoutez ou retirez un critère, réglez son poids.
          Les critères calculés sont automatiques ; les critères manuels se notent sur chaque devis.
        </div>
      </div>

      {isLoading ? <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement…</div> : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr><th style={{ width: 20 }} /><th>Critère</th><th>Type</th><th style={{ textAlign: 'right', width: 90 }}>Poids</th><th style={{ textAlign: 'center', width: 70 }}>Actif</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {(criteria as RfqCriterion[]).map(c => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
                <td style={{ color: 'var(--theme-text-muted)' }}><GripVertical size={12} /></td>
                <td>
                  <input className="input" style={{ width: '100%', maxWidth: 220 }} defaultValue={c.label}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.label) update.mutate({ id: c.id, patch: { label: v } }); }} />
                </td>
                <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{RFQ_CRITERION_TYPE_LABELS[c.type]}</td>
                <td style={{ textAlign: 'right' }}>
                  <input className="input" type="number" min={0} max={100} style={{ width: 70, textAlign: 'right' }} defaultValue={c.weight}
                    onBlur={e => { const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))); if (v !== c.weight) update.mutate({ id: c.id, patch: { weight: v } }); }} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={c.active} onChange={e => update.mutate({ id: c.id, patch: { active: e.target.checked } })} aria-label={`Activer ${c.label}`} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="odoo-pager-btn" title="Retirer ce critère" style={{ color: '#dc3545' }} onClick={() => remove.mutate(c.id)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ fontSize: '0.75rem', color: activeWeight === 0 ? '#dc3545' : 'var(--theme-text-muted)' }}>
            <td colSpan={3} style={{ textAlign: 'right' }}>Somme des poids actifs</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{activeWeight}</td><td colSpan={2}>{activeWeight === 0 ? 'au moins un critère actif requis' : ''}</td>
          </tr></tfoot>
        </table>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8, borderTop: '1px solid var(--odoo-border)', paddingTop: 10 }}>
        <div><label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--theme-text-muted)', marginBottom: 2 }}>Nouveau critère</label>
          <input className="input" placeholder="ex. Référence, SAV…" value={label} onChange={e => setLabel(e.target.value)} style={{ width: 200 }} /></div>
        <div><label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--theme-text-muted)', marginBottom: 2 }}>Type</label>
          <select className="input" value={type} onChange={e => setType(e.target.value as RfqCriterionType)}>
            <option value="manual">{RFQ_CRITERION_TYPE_LABELS.manual}</option>
            <option value="price" disabled={hasType('price')}>{RFQ_CRITERION_TYPE_LABELS.price}</option>
            <option value="supplier" disabled={hasType('supplier')}>{RFQ_CRITERION_TYPE_LABELS.supplier}</option>
            <option value="delivery" disabled={hasType('delivery')}>{RFQ_CRITERION_TYPE_LABELS.delivery}</option>
          </select></div>
        <div><label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--theme-text-muted)', marginBottom: 2 }}>Poids</label>
          <input className="input" type="number" min={0} max={100} value={weight} onChange={e => setWeight(e.target.value)} style={{ width: 70, textAlign: 'right' }} /></div>
        <button className="odoo-btn-primary" disabled={!label.trim() || create.isPending} onClick={() => create.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Ajouter
        </button>
      </div>
    </div>
  );
}
