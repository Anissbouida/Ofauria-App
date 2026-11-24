import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beaker, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
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
  // Préparations de base : c'est elles que la production consomme (leurs matières sortent à la
  // fabrication de la base). Quantité d'une fournée = base de comparaison avec le stock.
  const bases = data?.bases ?? [];
  const perBatch = (q: number) => (b?.par_piece && nb ? q * nb : q);
  const batchLabel = b?.rendement_kg ? `${batch} de ${b.rendement_kg.toLocaleString('fr-FR')} kg` : nb ? `${batch} ×${nb}` : batch;
  const unitTxt = (u: string) => (u === 'unit' ? 'pièce(s)' : u);

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
          {!isLoading && data && bases.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px', fontWeight: 600, fontSize: '0.85rem' }}>
                <Beaker size={13} aria-hidden="true" /> Préparations de base consommées
                <span style={{ color: 'var(--ds-muted)', fontWeight: 400, fontSize: '0.78rem' }}>ce que la production sort du stock de préparations</span>
              </div>
              <table className="odoo-table">
                <thead><tr>
                  <th>Préparation de base</th>
                  {b?.par_piece && <th className="ds-num">Par pièce</th>}
                  <th className="ds-num">{batchLabel}</th>
                  <th className="ds-num">En stock</th>
                  <th className="ds-num">Reste après une {batch.toLowerCase()}</th>
                </tr></thead>
                <tbody>
                  {bases.map(s => {
                    const need = perBatch(s.qty);
                    const rest = Math.round((s.stock - need) * 1000) / 1000;
                    return (
                      <tr key={s.recipe_id}>
                        <td className="ds-strong">{s.name}</td>
                        {b?.par_piece && <td className="ds-num">{fmt(s.qty)} <span style={{ color: 'var(--ds-muted)' }}>{unitTxt(s.unit)}</span></td>}
                        <td className="ds-num">{fmt(need)} <span style={{ color: 'var(--ds-muted)' }}>{unitTxt(s.unit)}</span></td>
                        <td className="ds-num">{fmt(s.stock)} <span style={{ color: 'var(--ds-muted)' }}>{unitTxt(s.unit)}</span></td>
                        <td className="ds-num">
                          {rest >= 0
                            ? <>{fmt(rest)} <span style={{ color: 'var(--ds-muted)' }}>{unitTxt(s.unit)}</span></>
                            : <StatusTag tone="todo" label={`À fabriquer : ${fmt(-rest)} ${unitTxt(s.unit)}`} title="Le stock ne couvre pas une fournée : le plan de production créera la fabrication de cette préparation." />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && data && lines.length > 0 && bases.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 6px', fontWeight: 600, fontSize: '0.85rem' }}>
              <Layers size={13} aria-hidden="true" /> Matières premières, tous niveaux cumulés
              <span style={{ color: 'var(--ds-muted)', fontWeight: 400, fontSize: '0.78rem' }}>à titre de contrôle : les matières d'une préparation sortent quand elle est fabriquée</span>
            </div>
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
            les {ingredientsLc} de base (hors emballage). Le stock affiché est celui du moment ;
            rien n'est réservé ici.
          </p>
        </div>
      )}
    </div>
  );
}
