import { MessageSquareText } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Observations du lancement (G0-24, mig 528) : note du chef et bases partagées déclarées
 * dans la fenêtre de lancement, enregistrées avec la déclaration (declareProduction) et
 * renvoyées avec l'ordre (`plan.observations`). Lecture seule, la plus récente d'abord.
 */
export interface PlanObservation {
  id: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  bases: { subRecipeId: string; actualQuantity: number; alreadyProduced?: boolean; name: string | null; unit: string | null }[];
}

const qty = (n: number) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export default function PlanObservationsPanel({ observations }: { observations: PlanObservation[] }) {
  if (observations.length === 0) return null;
  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <div className="odoo-section-header">
        <MessageSquareText size={12} /> Observations du lancement
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {observations.length} déclaration{observations.length > 1 ? 's' : ''}
        </span>
      </div>
      <div>
        {observations.map(o => (
          <div key={o.id} style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--theme-border, #eee)' }}>
            <div style={{ fontSize: 12, color: 'var(--theme-text-muted)' }}>
              {format(new Date(o.created_at), 'dd/MM/yyyy HH:mm')}{o.created_by_name ? ` · ${o.created_by_name}` : ''}
            </div>
            {o.note && <p style={{ margin: '0.35rem 0 0', whiteSpace: 'pre-wrap' }}>{o.note}</p>}
            {o.bases.length > 0 && (
              <table className="odoo-table" style={{ marginTop: '0.5rem' }}>
                <thead><tr><th>Base partagée</th><th style={{ textAlign: 'right' }}>Quantité déclarée</th><th>Origine</th></tr></thead>
                <tbody>
                  {o.bases.map((b, i) => (
                    <tr key={`${b.subRecipeId}-${i}`}>
                      <td style={{ fontWeight: 500 }}>{b.name ?? <span style={{ color: 'var(--theme-text-muted)' }}>Fiche supprimée</span>}</td>
                      {/* « Déjà produite » : aucune quantité saisie au lancement (champ masqué). */}
                      <td style={{ textAlign: 'right' }}>{b.alreadyProduced ? '—' : `${qty(b.actualQuantity)}${b.unit ? ` ${b.unit}` : ''}`}</td>
                      <td>{b.alreadyProduced ? 'Déjà produite' : 'Produite au lancement'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
