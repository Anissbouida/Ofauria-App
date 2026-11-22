import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { PageNote } from './SettingsPrimitives';
import { expenseCategoriesApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { DataPanel, EmptyState, LoadingState, SectionHeader } from '../../components/ds';

type Cat = {
  id: string; name: string; parent_name?: string | null;
  requires_qc?: boolean; requires_dlc?: boolean; requires_lot?: boolean;
};

/**
 * Paramètres › Achats : exigences de réception par catégorie (mig 308 + 461).
 *  • Contrôle qualité (requires_qc) : les lots entrent en QUARANTAINE et ne sont
 *    libérés qu'après un contrôle réception conforme ; n° de lot obligatoire.
 *  • DLC (requires_dlc) et Lot fournisseur (requires_lot) : exigés à la saisie.
 * On n'affiche que les catégories stockables déjà configurées (au moins une
 * exigence), là où ces drapeaux ont un sens.
 */
const FIELD_LABEL = { requires_qc: 'Contrôle qualité', requires_dlc: 'DLC', requires_lot: 'Lot' } as const;

export default function ReceptionQcCategoriesCard() {
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useQuery<Cat[]>({
    queryKey: ['expense-categories', 'all'],
    queryFn: () => expenseCategoriesApi.list(true),
  });

  const rows = useMemo(
    () => (all as Cat[])
      .filter(c => c.requires_qc || c.requires_dlc || c.requires_lot)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, boolean> }) => expenseCategoriesApi.update(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense-categories'] }); notify.success('Exigence mise à jour'); },
    onError: e => notify.error(apiErrorMessage(e, 'Modification impossible')),
  });

  const Toggle = ({ c, field }: { c: Cat; field: 'requires_qc' | 'requires_dlc' | 'requires_lot' }) => (
    <input type="checkbox" checked={!!c[field]} disabled={update.isPending}
      onChange={e => update.mutate({ id: c.id, patch: { [field]: e.target.checked } })}
      aria-label={`${FIELD_LABEL[field]} : ${c.name}`} />
  );

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={16} aria-hidden="true" style={{ color: 'var(--ds-accent)' }} /> Exigences de réception par catégorie</span>} />
      <PageNote help="Contrôle qualité : les lots entrent en quarantaine, indisponibles tant qu'un contrôle réception n'est pas conforme, et le n° de lot fournisseur devient obligatoire. DLC et Lot : exigés à la saisie de la réception.">
        Ce qui est exigé à la réception, par catégorie.
      </PageNote>

      {isLoading ? (
        <LoadingState bare />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Aucune catégorie stockable configurée" />
      ) : (
        <DataPanel label="Exigences de réception">
        <table className="odoo-table">
          <thead><tr>
            <th>Catégorie</th>
            <th style={{ textAlign: 'center', width: 110 }}>Contrôle qualité</th>
            <th style={{ textAlign: 'center', width: 70 }}>DLC</th>
            <th style={{ textAlign: 'center', width: 70 }}>Lot</th>
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td><span className="ds-strong">{c.name}</span>{c.parent_name ? <span style={{ color: 'var(--ds-muted)', fontSize: 12 }}> · {c.parent_name}</span> : null}</td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_qc" /></td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_dlc" /></td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_lot" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </DataPanel>
      )}
    </section>
  );
}
