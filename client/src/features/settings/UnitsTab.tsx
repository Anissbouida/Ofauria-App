import { useQuery } from '@tanstack/react-query';
import { Loader2, Ruler, AlertTriangle } from 'lucide-react';
import api from '../../api/client';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { DataPanel, ErrorState } from '../../components/ds';

/**
 * Paramètres › Unités de mesure (M3-01).
 *
 * Unités par dimension (masse, volume, pièce, longueur, surface, temps) avec leur facteur
 * vers l'unité de base de la dimension. Les unités système sont en lecture seule ; une
 * unité s'ajoute dans Référentiels › Unités de mesure. En bas : les fiches dont l'unité
 * n'est rattachée à aucune unité du référentiel (à corriger à la main).
 */
type Unit = { id: string; code: string; label: string; dimension: string | null; factor: number | null; decimals: number; is_system: boolean; is_base: boolean; is_active: boolean; items: number; composition_lines: number };
type Unmatched = { table_name: string; unit: string; lines: number; example: string };

const DIM: Record<string, string> = { masse: 'Masse', volume: 'Volume', piece: 'Pièce', longueur: 'Longueur', surface: 'Surface', temps: 'Temps' };
const TABLE: Record<string, string> = {
  ingredients: 'Ingrédients', packaging_items: 'Emballages', recipes: 'Fiches (rendement)',
  recipe_ingredients: 'Lignes de fiche', recipe_components: 'Composants de fiche', recipe_format_components: 'Composants de format',
};

export default function UnitsTab() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings-units'],
    queryFn: () => api.get('/settings/units').then(r => r.data.data as { units: Unit[]; unmatched: Unmatched[] }),
  });
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;
  const base = (dim: string | null) => data.units.find(u => u.dimension === dim && u.is_base)?.code ?? '';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatusBanner tone="info" icon={Ruler} title="Unités de mesure">
        Chaque unité appartient à une dimension et se convertit vers l'unité de base de sa dimension par un facteur
        (1 kg = 1 000 g). Les unités système servent aux coûts et ne se modifient pas ; ajoutez une unité dans Référentiels › Unités de mesure.
      </StatusBanner>
      <DataPanel label="Unités de mesure">
        <table className="odoo-table">
          <thead><tr><th>Code</th><th>Libellé</th><th>Dimension</th><th className="ds-num">Facteur</th><th className="ds-num">Décimales</th>
            <th className="ds-num">Articles</th><th className="ds-num">Lignes de fiche</th><th>État</th></tr></thead>
          <tbody>{data.units.map(u => (
            <tr key={u.id}>
              <td className="ds-ref">{u.code}</td>
              <td className="ds-strong">{u.label}{u.is_system && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Système</span>}</td>
              <td>{u.dimension ? DIM[u.dimension] ?? u.dimension : <span style={{ color: 'var(--ds-danger)' }}>non renseignée</span>}</td>
              <td className="ds-num">{u.factor != null ? `${u.factor.toLocaleString('fr-FR')} ${u.is_base ? '(base)' : base(u.dimension)}` : '—'}</td>
              <td className="ds-num">{u.decimals}</td>
              <td className="ds-num">{u.items || '—'}</td>
              <td className="ds-num">{u.composition_lines || '—'}</td>
              <td><StatusTag tone={u.is_active ? 'done' : 'draft'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
            </tr>
          ))}</tbody>
        </table>
      </DataPanel>
      {data.unmatched.length > 0 ? (
        <>
          <StatusBanner tone="warning" icon={AlertTriangle} title="Unités non rattachées">
            Ces fiches portent une unité absente du référentiel : ajoutez l'unité ou corrigez la fiche.
          </StatusBanner>
          <DataPanel label="Unités non rattachées">
          <table className="odoo-table">
            <thead><tr><th>Fiches</th><th>Unité saisie</th><th className="ds-num">Lignes</th><th>Exemple</th></tr></thead>
            <tbody>{data.unmatched.map(m => (
              <tr key={`${m.table_name}|${m.unit}`}><td>{TABLE[m.table_name] ?? m.table_name}</td><td className="ds-ref">{m.unit}</td>
                <td className="ds-num">{m.lines}</td><td>{m.example}</td></tr>
            ))}</tbody>
          </table>
          </DataPanel>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--ds-muted)' }}>Toutes les fiches ont une unité rattachée au référentiel.</p>
      )}
    </div>
  );
}
