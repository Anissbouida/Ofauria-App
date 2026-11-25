import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Beaker, ChevronDown, ChevronRight, Layers, PackageOpen } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { recipesApi } from '../../api/recipes.api';
import { useProdTerms } from '../../hooks/useProdTerms';

import { EmptyState, LoadingState } from '../../components/ds';
import '../production/production.css';
/**
 * Ce que la production de l'article sort du stock (2026-11-24).
 *
 * Trois lectures, du plus concret au contrôle :
 *  1. les préparations de base consommées (quantité, stock, reste) ;
 *  2. les matières saisies directement sur la fiche — les seules matières premières qui
 *     sortent à cette production ;
 *  3. le contenu des préparations de base, replié : ces matières sont sorties quand les
 *     préparations ont été fabriquées. Les afficher en une seule liste cumulée laissait
 *     croire que la production de l'article les consommait une seconde fois.
 * Quantités seulement : le coût se lit dans le coût standard de l'article.
 */
export default function ExplosionSection({ recipeId, defaultOpen = false }: { recipeId: string; defaultOpen?: boolean }) {
  const { ingredient, ingredients, ingredientsLc, batch } = useProdTerms();
  const [open, setOpen] = useState(defaultOpen);
  const [showContent, setShowContent] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-explosion', recipeId],
    queryFn: () => recipesApi.explosion(recipeId),
    enabled: open,
  });
  const lines = [...(data?.lines ?? [])].sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'fr'));
  // Base des quantités, comme l'onglet Composition : saisie par pièce → colonne « Fournée ×N » ;
  // saisie par fournée → colonne « Par pièce » ; fournée au kilo → pas de seconde colonne.
  const b = data?.basis;
  const nb = b && !b.rendement_kg && (b.nb_par_defaut ?? 0) > 1 ? b.nb_par_defaut! : null;
  const baseLabel = !b ? '' : b.par_piece ? 'pour une pièce'
    : b.rendement_kg ? `pour une ${batch.toLowerCase()} de ${b.rendement_kg.toLocaleString('fr-FR')} kg`
    : `pour une ${batch.toLowerCase()}${nb ? ` de ${nb} pièces` : ''}`;
  const fmt = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 });
  const bases = data?.bases ?? [];
  const perBatch = (q: number) => (b?.par_piece && nb ? q * nb : q);
  const batchLabel = b?.rendement_kg ? `${batch} de ${b.rendement_kg.toLocaleString('fr-FR')} kg` : nb ? `${batch} ×${nb}` : batch;
  const unitTxt = (u: string) => (u === 'unit' ? 'pièce(s)' : u);
  const muted = { color: 'var(--ds-muted)' } as const;

  // Sans préparation de base, tout est direct : une seule liste, comme avant.
  const hasBases = bases.length > 0;
  const total = (l: typeof lines[number]) => l.display_qty ?? l.total_qty;
  const directOf = (l: typeof lines[number]) => (hasBases ? Math.min(l.direct_qty ?? 0, total(l)) : total(l));
  const direct = lines.filter(l => directOf(l) > 0.0005);
  const inBases = lines.map(l => ({ l, q: Math.round((total(l) - directOf(l)) * 1000) / 1000 })).filter(x => x.q > 0.0005);

  const sub = (icon: React.ReactNode, title: string, hint: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, padding: '2px 2px 6px', fontWeight: 600, fontSize: '0.85rem' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon} {title}</span>
      <span style={{ ...muted, fontWeight: 400, fontSize: '0.78rem' }}>{hint}</span>
    </div>
  );
  /** Tableau de matières : quantité de la base (pièce ou fournée) et, s'il y a lieu, l'autre. */
  const table = (rows: { l: typeof lines[number]; q: number }[]) => (
    <div style={{ overflowX: 'auto' }}>
      <table className="odoo-table">
        <thead><tr>
          <th>{ingredient}</th>
          <th className="ds-num">{b?.par_piece ? 'Par pièce' : 'Quantité totale'}</th>
          {nb && <th className="ds-num">{b?.par_piece ? `${batch} ×${nb}` : 'Par pièce'}</th>}
        </tr></thead>
        <tbody>
          {rows.map(({ l, q }) => (
            <tr key={l.ingredient_id}>
              <td className="ds-strong">{l.ingredient_name}</td>
              <td className="ds-num">{fmt(q)} <span style={muted}>{l.display_unit ?? l.unit}</span></td>
              {nb && <td className="ds-num" style={muted}>{fmt(b?.par_piece ? q * nb : q / nb)} {l.display_unit ?? l.unit}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="ds-panel pd-section" style={{ marginTop: 16 }}>
      <button type="button" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="pd-section-head"
        style={{ width: '100%', cursor: 'pointer', border: 'none', background: 'transparent', font: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Layers size={12} /> Ce que la production sort du stock
        <span style={{ marginLeft: 8, ...muted, fontSize: '0.78rem', fontWeight: 400 }}>{baseLabel}</span>
      </button>

      {open && (
        <div style={{ padding: '0.5rem 0' }}>
          {isLoading && <LoadingState bare />}
          {!isLoading && data && lines.length === 0 && bases.length === 0 && (
            <EmptyState bare icon={Layers} title={`${ingredients} : aucune ligne`} text="Cette recette n'a pas encore de composition matière." />
          )}

          {/* 1. Préparations de base : la production les prend dans le stock de préparations. */}
          {!isLoading && data && hasBases && (
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              {sub(<Beaker size={13} aria-hidden="true" />, 'Préparations de base consommées', 'sorties du stock de préparations')}
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
                        {b?.par_piece && <td className="ds-num">{fmt(s.qty)} <span style={muted}>{unitTxt(s.unit)}</span></td>}
                        <td className="ds-num">{fmt(need)} <span style={muted}>{unitTxt(s.unit)}</span></td>
                        <td className="ds-num">{fmt(s.stock)} <span style={muted}>{unitTxt(s.unit)}</span></td>
                        <td className="ds-num">
                          {rest >= 0
                            ? <>{fmt(rest)} <span style={muted}>{unitTxt(s.unit)}</span></>
                            : <StatusTag tone="todo" label={`À fabriquer : ${fmt(-rest)} ${unitTxt(s.unit)}`} title="Le stock ne couvre pas une fournée : le plan de production créera la fabrication de cette préparation." />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 2. Matières saisies directement sur la fiche : les seules matières premières sorties ici. */}
          {!isLoading && data && (lines.length > 0 || hasBases) && (
            <div style={{ marginBottom: hasBases ? 16 : 0 }}>
              {hasBases && sub(<PackageOpen size={13} aria-hidden="true" />, `${ingredients} sortis à cette production`,
                'saisis directement sur la fiche, en plus des préparations')}
              {direct.length > 0
                ? table(direct.map(l => ({ l, q: directOf(l) })))
                : hasBases && (
                  <p style={{ ...muted, fontSize: '0.82rem', padding: '2px 2px 4px' }}>
                    Aucun : cet article n'utilise que des préparations de base. Aucune matière première ne sort du stock à sa production.
                  </p>
                )}
            </div>
          )}

          {/* 3. Contenu des préparations : déjà sorti à leur fabrication. Replié pour ne pas être lu comme une sortie. */}
          {!isLoading && data && hasBases && inBases.length > 0 && (
            <div>
              <button type="button" aria-expanded={showContent} onClick={() => setShowContent(v => !v)}
                style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, width: '100%', padding: '2px 2px 6px', border: 'none', background: 'transparent', font: 'inherit', cursor: 'pointer', textAlign: 'left', fontWeight: 600, fontSize: '0.85rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {showContent ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Contenu des préparations de base
                </span>
                <span style={{ ...muted, fontWeight: 400, fontSize: '0.78rem' }}>
                  {inBases.length} {ingredientsLc} déjà sortis à la fabrication des préparations — ne sortent pas une seconde fois
                </span>
              </button>
              {showContent && (
                <>
                  {table(inBases)}
                  <p style={{ fontSize: '0.72rem', ...muted, padding: '6px 2px 0' }}>
                    Pour contrôle seulement (allergènes, cohérence des dosages) : toutes préparations dépliées, sur tous les niveaux, hors emballage.
                    Ces quantités sont sorties du stock quand chaque préparation a été fabriquée.
                  </p>
                </>
              )}
            </div>
          )}

          <p style={{ fontSize: '0.72rem', ...muted, padding: '8px 2px 0' }}>
            Le stock affiché est celui du moment ; rien n'est réservé depuis cet écran.
          </p>
        </div>
      )}
    </div>
  );
}
