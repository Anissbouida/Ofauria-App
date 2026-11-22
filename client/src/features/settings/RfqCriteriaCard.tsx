import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { rfqApi, RFQ_CRITERION_TYPE_LABELS, type RfqCriterion, type RfqCriterionType } from '../../api/rfq.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, FormField, LoadingState, SectionHeader } from '../../components/ds';

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
    <section style={{ display: 'grid', gap: 10 }}>
      <div>
        <SectionHeader title="Critères de notation des demandes de prix" />
        <PageNote help="Moyenne pondérée. Les critères calculés sont automatiques ; les critères manuels se notent sur chaque devis.">
          Le devis recommandé est le mieux noté sur ces critères.
        </PageNote>
      </div>

      {isLoading ? <LoadingState bare /> : (
        <DataPanel label="Critères de notation">
        <table className="odoo-table">
          <thead><tr><th style={{ width: 20 }} /><th>Critère</th><th>Type</th><th className="ds-num" style={{ width: 100 }}>Poids (%)</th><th style={{ textAlign: 'center', width: 70 }}>Actif</th><th className="ds-actions" style={{ width: 120 }} /></tr></thead>
          <tbody>
            {(criteria as RfqCriterion[]).map(c => (
              <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
                <td style={{ color: 'var(--ds-muted)' }}><GripVertical size={12} aria-hidden="true" /></td>
                <td>
                  <input className="ds-input sm" aria-label={`Libellé du critère ${c.label}`} style={{ maxWidth: 220 }} defaultValue={c.label}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== c.label) update.mutate({ id: c.id, patch: { label: v } }); }} />
                </td>
                <td style={{ color: 'var(--ds-muted)' }}>{RFQ_CRITERION_TYPE_LABELS[c.type]}</td>
                <td className="ds-num">
                  <input className="ds-input sm" aria-label={`Poids de ${c.label}`} type="number" min={0} max={100} style={{ width: 70, textAlign: 'right' }} defaultValue={c.weight}
                    onBlur={e => { const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))); if (v !== c.weight) update.mutate({ id: c.id, patch: { weight: v } }); }} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={c.active} onChange={e => update.mutate({ id: c.id, patch: { active: e.target.checked } })} aria-label={`Activer ${c.label}`} />
                </td>
                <td className="ds-actions">
                  <button type="button" className="ds-btn-danger ds-btn-sm" disabled={remove.isPending} onClick={() => remove.mutate(c.id)} aria-label={`Retirer le critère ${c.label}`}><Trash2 size={13} aria-hidden="true" /> Retirer</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ color: activeWeight === 0 ? 'var(--ds-danger)' : undefined }}>
            <td colSpan={3} style={{ textAlign: 'right' }}>Somme des poids actifs</td>
            <td className="ds-num">{activeWeight}</td><td colSpan={2} style={{ fontWeight: 400 }}>{activeWeight === 0 ? 'au moins un critère actif requis' : ''}</td>
          </tr></tfoot>
        </table>
        </DataPanel>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8, borderTop: '1px solid var(--ds-hair)', paddingTop: 10 }}>
        <div style={{ width: 220 }}><FormField label="Nouveau critère" htmlFor="rfq-new-label" required>
          <input id="rfq-new-label" className="ds-input" placeholder="ex. Référence, SAV…" value={label} onChange={e => setLabel(e.target.value)} /></FormField></div>
        <div style={{ width: 220 }}><FormField label="Type" htmlFor="rfq-new-type">
          <select id="rfq-new-type" className="ds-input" value={type} onChange={e => setType(e.target.value as RfqCriterionType)}>
            <option value="manual">{RFQ_CRITERION_TYPE_LABELS.manual}</option>
            <option value="price" disabled={hasType('price')}>{RFQ_CRITERION_TYPE_LABELS.price}</option>
            <option value="supplier" disabled={hasType('supplier')}>{RFQ_CRITERION_TYPE_LABELS.supplier}</option>
            <option value="delivery" disabled={hasType('delivery')}>{RFQ_CRITERION_TYPE_LABELS.delivery}</option>
          </select></FormField></div>
        <div style={{ width: 110 }}><FormField label="Poids (%)" htmlFor="rfq-new-weight">
          <input id="rfq-new-weight" className="ds-input" type="number" min={0} max={100} value={weight} onChange={e => setWeight(e.target.value)} style={{ textAlign: 'right' }} /></FormField></div>
        <button type="button" className="odoo-btn-primary" disabled={!label.trim() || create.isPending} onClick={() => create.mutate()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <Plus size={13} /> Ajouter
        </button>
      </div>
    </section>
  );
}
