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
        {!routing ? <span className="text-xs text-gray-500">Aucune gamme : l'atelier suit les étapes de la fiche.</span> : (
          <table className="odoo-table">
            <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">#</th><th className="text-left px-2">Opération</th><th className="text-left px-2">Type</th><th className="text-left px-2">Poste</th><th className="text-right px-2">MO prévue (min)</th><th className="text-right px-2">Machine (min)</th></tr></thead>
            <tbody>{routing.operations.map(o => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="px-2 py-1">{o.sequence}</td>
                <td className="px-2">{o.operation_name}{o.is_blocking ? ' · bloquante' : ''}{o.control_point ? <div className="text-gray-500">{o.control_point}</div> : null}</td>
                <td className="px-2">{OP_TYPE_LABELS[o.op_type ?? 'execution']}</td>
                <td className="px-2">{o.work_center_name ?? '—'}</td>
                <td className="text-right px-2">{(o.planned_labor_min ?? o.duration_min).toLocaleString('fr-FR')}</td>
                <td className="text-right px-2">{(o.planned_machine_min ?? 0).toLocaleString('fr-FR')}</td>
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
