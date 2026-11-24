import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Route } from 'lucide-react';
import { routingsApi, OP_TYPE_LABELS } from '../../api/routings.api';
import { RoutingEditor } from '../production/WorkCentersPage';
import '../production/production.css';

/**
 * Gamme de la fiche technique (M5-01) : opérations, postes et temps prévus ; édition dans
 * l'éditeur de gamme. Les étapes JSON restent la référence tant que l'atelier lit « json »
 * (politique production.steps_source, M5-03).
 */
export default function RecipeRoutingPanel({ recipeId, recipeName }: { recipeId: string; recipeName: string }) {
  const qc = useQueryClient();
  const { data: routing, isLoading } = useQuery({ queryKey: ['routing-for-recipe', recipeId], queryFn: () => routingsApi.forRecipe(recipeId) });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (isLoading) return null;
  return (
    <div className="ds-panel pd-section">
      <div className="pd-section-head"><Route size={13} /> Gamme opératoire
        <button type="button" className="odoo-btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setEditing(routing ? routing.id : 'new')}>{routing ? 'Modifier la gamme' : 'Créer la gamme'}</button>
      </div>
      <div style={{ padding: '0.5rem 1rem' }}>
        {!routing ? <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Aucune gamme : l'atelier suit les étapes de la fiche.</span> : (
          <table className="odoo-table ds-dense">
            <thead><tr><th>#</th><th>Opération</th><th>Type</th><th>Poste</th><th className="ds-num">MO prévue (min)</th><th className="ds-num">Machine (min)</th></tr></thead>
            <tbody>{routing.operations.map(o => (
              <tr key={o.id}>
                <td>{o.sequence}</td>
                <td>{o.operation_name}{o.is_blocking ? ' · bloquante' : ''}{o.control_point ? <div style={{ color: 'var(--ds-muted)', fontSize: 12 }}>{o.control_point}</div> : null}</td>
                <td>{OP_TYPE_LABELS[o.op_type ?? 'execution']}</td>
                <td>{o.work_center_name ?? '—'}</td>
                <td className="ds-num">{(o.planned_labor_min ?? o.duration_min).toLocaleString('fr-FR')}</td>
                <td className="ds-num">{(o.planned_machine_min ?? 0).toLocaleString('fr-FR')}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {editing && <RoutingEditor id={editing === 'new' ? null : editing} recipeId={recipeId} defaultName={`Gamme ${recipeName}`}
        onClose={() => setEditing(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['routing-for-recipe', recipeId] }); setEditing(null); }} />}
    </div>
  );
}
