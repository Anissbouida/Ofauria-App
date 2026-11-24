import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { useProdTerms } from '../../hooks/useProdTerms';

import { EmptyState, LoadingState } from '../../components/ds';
import '../production/production.css';
/**
 * Explosion à plat (mig 400) : déplie la nomenclature sur tous les niveaux
 * (sous-recettes incluses) et cumule chaque ingrédient élémentaire avec sa quantité.
 * Quantités seulement (2026-11-24) : le coût de chaque ingrédient se lit dans le coût
 * standard de l'article (Production › Coûts standard), plus sur la fiche technique.
 */
export default function ExplosionSection({ recipeId, defaultOpen = false }: { recipeId: string; defaultOpen?: boolean }) {
  const { ingredient, ingredients, ingredientsLc } = useProdTerms();
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-explosion', recipeId],
    queryFn: () => recipesApi.explosion(recipeId),
    enabled: open,
  });
  // Tri alphabétique : l'ordre par coût n'a plus de sens sans la colonne coût.
  const lines = [...(data?.lines ?? [])].sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'fr'));

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} /> Explosion — {ingredientsLc} à plat
        <span style={{ marginLeft: 8, color: 'var(--ds-muted)', fontSize: '0.78rem', fontWeight: 400 }}>tous niveaux cumulés</span>
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && (
            <LoadingState bare />
          )}
          {!isLoading && data && lines.length === 0 && (
            <EmptyState bare icon={Layers} title={`${ingredients} : aucune ligne`} text="Cette recette n'a pas encore de composition matière." />
          )}
          {!isLoading && data && lines.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead><tr>
                  <th>{ingredient}</th>
                  <th className="ds-num">Quantité totale</th>
                </tr></thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.ingredient_id}>
                      <td className="ds-strong">{l.ingredient_name}</td>
                      <td className="ds-num">
                        {l.total_qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {l.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: '0.72rem', color: 'var(--ds-muted)', padding: '6px 2px 0' }}>
            Déplie la nomenclature sur tous les niveaux (sous-recettes incluses) et cumule
            les {ingredientsLc} de base (hors emballage).
          </p>
        </div>
      )}
    </div>
  );
}
