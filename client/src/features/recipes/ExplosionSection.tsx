import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers, Loader2 } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';

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
  const dh = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
  const total = data?.total_cost ?? 0;

  return (
    <div className="odoo-section" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="odoo-section-header"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} /> Explosion — ingrédients à plat
        <span style={{ marginLeft: 8, color: 'var(--theme-text-muted)', fontSize: '0.78rem', fontWeight: 400 }}>tous niveaux cumulés</span>
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Chargement…
            </div>
          )}
          {!isLoading && data && data.lines.length === 0 && (
            <div style={{ padding: 12, color: 'var(--theme-text-muted)', fontSize: '0.85rem' }}>
              Aucun ingrédient (recette sans composition matière).
            </div>
          )}
          {!isLoading && data && data.lines.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr>
                  <th>Ingrédient</th>
                  <th style={{ textAlign: 'right' }}>Quantité totale</th>
                  <th style={{ textAlign: 'right' }}>Coût roulé</th>
                  <th style={{ textAlign: 'right' }}>Part</th>
                </tr></thead>
                <tbody>
                  {data.lines.map(l => (
                    <tr key={l.ingredient_id}>
                      <td style={{ fontWeight: 500 }}>{l.ingredient_name}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {l.total_qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {l.unit}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{dh(l.rolled_cost)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>
                        {total > 0 ? `${(l.rolled_cost / total * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700 }}>
                    <td>Total matière (roulé)</td>
                    <td />
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{dh(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--theme-text-muted)', padding: '6px 2px 0' }}>
            Déplie la nomenclature sur tous les niveaux (sous-recettes incluses) et cumule chaque
            ingrédient élémentaire. Coût matière uniquement (hors emballage).
          </p>
        </div>
      )}
    </div>
  );
}
