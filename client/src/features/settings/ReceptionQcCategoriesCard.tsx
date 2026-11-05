import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { expenseCategoriesApi } from '../../api/accounting.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

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
      aria-label={`${field} ${c.name}`} />
  );

  return (
    <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '12px 16px', background: 'var(--odoo-bg)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShieldCheck size={16} style={{ color: 'var(--theme-accent)' }} />
        <div style={{ fontWeight: 600 }}>Exigences de réception par catégorie</div>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        <strong>Contrôle qualité</strong> : les lots de cette catégorie entrent en quarantaine (indisponibles tant qu'un contrôle réception n'est pas conforme) et le n° de lot fournisseur devient obligatoire.
        <strong> DLC</strong> et <strong>Lot</strong> : exigés à la saisie de la réception.
      </div>

      {isLoading ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Aucune catégorie stockable configurée.</div>
      ) : (
        <table className="odoo-table" style={{ margin: 0 }}>
          <thead><tr>
            <th>Catégorie</th>
            <th style={{ textAlign: 'center', width: 110 }}>Contrôle qualité</th>
            <th style={{ textAlign: 'center', width: 70 }}>DLC</th>
            <th style={{ textAlign: 'center', width: 70 }}>Lot</th>
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td>{c.name}{c.parent_name ? <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}> · {c.parent_name}</span> : null}</td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_qc" /></td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_dlc" /></td>
                <td style={{ textAlign: 'center' }}><Toggle c={c} field="requires_lot" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
