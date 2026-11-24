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
  const { ingredient, ingredients, ingredientsLc, batch } = useProdTerms();
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-explosion', recipeId],
    queryFn: () => recipesApi.explosion(recipeId),
    enabled: open,
  });
  // Tri alphabétique : l'ordre par coût n'a plus de sens sans la colonne coût.
  const lines = [...(data?.lines ?? [])].sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'fr'));
  // Base des quantités, comme l'onglet Composition : saisie par pièce → colonne « Fournée ×N » ;
  // saisie par fournée → colonne « Par pièce » ; fournée au kilo → pas de seconde colonne.
  const b = data?.basis;
  const nb = b && !b.rendement_kg && (b.nb_par_defaut ?? 0) > 1 ? b.nb_par_defaut! : null;
  const baseLabel = !b ? '' : b.par_piece ? 'pour une pièce'
    : b.rendement_kg ? `pour une ${batch.toLowerCase()} de ${b.rendement_kg.toLocaleString('fr-FR')} kg`
    : `pour une ${batch.toLowerCase()}${nb ? ` de ${nb} pièces` : ''}`;
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 });

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} /> Explosion — {ingredientsLc} à plat
        <span style={{ marginLeft: 8, color: 'var(--ds-muted)', fontSize: '0.78rem', fontWeight: 400 }}>tous niveaux cumulés{baseLabel ? `, ${baseLabel}` : ''}</span>
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
                  <th className="ds-num">{b?.par_piece ? 'Par pièce' : 'Quantité totale'}</th>
                  {nb && <th className="ds-num">{b?.par_piece ? `${batch} ×${nb}` : 'Par pièce'}</th>}
                </tr></thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.ingredient_id}>
                      <td className="ds-strong">{l.ingredient_name}</td>
                      <td className="ds-num">
                        {fmt(l.display_qty ?? l.total_qty)} <span style={{ color: 'var(--ds-muted)' }}>{l.display_unit ?? l.unit}</span>
                      </td>
                      {nb && (
                        <td className="ds-num" style={{ color: 'var(--ds-muted)' }}>
                          {fmt(b?.par_piece ? (l.display_qty ?? l.total_qty) * nb : (l.display_qty ?? l.total_qty) / nb)} {l.display_unit ?? l.unit}
                        </td>
                      )}
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
