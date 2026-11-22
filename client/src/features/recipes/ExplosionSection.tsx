import { money } from '../../utils/money';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';

import { EmptyState, LoadingState } from '../../components/ds';
import '../production/production.css';
/**
 * Explosion à plat (mig 400) : déplie la nomenclature sur tous les niveaux
 * (sous-recettes incluses) et cumule chaque ingrédient élémentaire avec sa
 * quantité et son coût roulés. Σ(coût roulé) = coût matière total de la recette.
 */
export default function ExplosionSection({ recipeId }: { recipeId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-explosion', recipeId],
    queryFn: () => recipesApi.explosion(recipeId),
    enabled: open,
  });
  const dh = (n: number) => money(n);
  const total = data?.total_cost ?? 0;

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} /> Explosion — ingrédients à plat
        <span style={{ marginLeft: 8, color: 'var(--ds-muted)', fontSize: '0.78rem', fontWeight: 400 }}>tous niveaux cumulés</span>
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && (
            <LoadingState bare />
          )}
          {!isLoading && data && data.lines.length === 0 && (
            <EmptyState bare icon={Layers} title="Aucun ingrédient" text="Cette recette n'a pas encore de composition matière." />
          )}
          {!isLoading && data && data.lines.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr>
                  <th>Ingrédient</th>
                  <th className="ds-num">Quantité totale</th>
                  <th className="ds-num">Coût roulé</th>
                  <th className="ds-num">Part (%)</th>
                </tr></thead>
                <tbody>
                  {data.lines.map(l => (
                    <tr key={l.ingredient_id}>
                      <td className="ds-strong">{l.ingredient_name}</td>
                      <td className="ds-num">
                        {l.total_qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {l.unit}
                      </td>
                      <td className="ds-num">{dh(l.rolled_cost)}</td>
                      <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>
                        {total > 0 ? (l.rolled_cost / total * 100).toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total matière (roulé)</td>
                    <td />
                    <td className="ds-num">{dh(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--ds-muted)', padding: '6px 2px 0' }}>
            Déplie la nomenclature sur tous les niveaux (sous-recettes incluses) et cumule chaque
            ingrédient élémentaire. Coût matière uniquement (hors emballage).
          </p>
        </div>
      )}
    </div>
  );
}
