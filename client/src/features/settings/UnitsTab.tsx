import { useQuery } from '@tanstack/react-query';
import { Loader2, Ruler, AlertTriangle } from 'lucide-react';
import api from '../../api/client';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';

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
  const { data, isLoading } = useQuery({
    queryKey: ['settings-units'],
    queryFn: () => api.get('/settings/units').then(r => r.data.data as { units: Unit[]; unmatched: Unmatched[] }),
  });
  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;
  const base = (dim: string | null) => data.units.find(u => u.dimension === dim && u.is_base)?.code ?? '';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatusBanner tone="info" icon={Ruler} title="Unités de mesure">
        Chaque unité appartient à une dimension et se convertit vers l'unité de base de sa dimension par un facteur
        (1 kg = 1 000 g). Les unités système servent aux coûts et ne se modifient pas ; ajoutez une unité dans Référentiels › Unités de mesure.
      </StatusBanner>
      <div style={{ overflowX: 'auto' }}>
        <table className="odoo-table">
          <thead><tr><th>Code</th><th>Libellé</th><th>Dimension</th><th style={{ textAlign: 'right' }}>Facteur</th><th style={{ textAlign: 'right' }}>Décimales</th>
            <th style={{ textAlign: 'right' }}>Articles</th><th style={{ textAlign: 'right' }}>Lignes de fiche</th><th>État</th></tr></thead>
          <tbody>{data.units.map(u => (
            <tr key={u.id}>
              <td style={{ fontFamily: 'monospace' }}>{u.code}</td>
              <td>{u.label}{u.is_system && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Système</span>}</td>
              <td>{u.dimension ? DIM[u.dimension] ?? u.dimension : <span style={{ color: 'var(--odoo-danger, #b91c1c)' }}>non renseignée</span>}</td>
              <td style={{ textAlign: 'right' }}>{u.factor != null ? `${u.factor.toLocaleString('fr-FR')} ${u.is_base ? '(base)' : base(u.dimension)}` : '—'}</td>
              <td style={{ textAlign: 'right' }}>{u.decimals}</td>
              <td style={{ textAlign: 'right' }}>{u.items || '—'}</td>
              <td style={{ textAlign: 'right' }}>{u.composition_lines || '—'}</td>
              <td><StatusTag tone={u.is_active ? 'done' : 'draft'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {data.unmatched.length > 0 ? (
        <>
          <StatusBanner tone="warning" icon={AlertTriangle} title="Unités non rattachées">
            Ces fiches portent une unité absente du référentiel : ajoutez l'unité ou corrigez la fiche.
          </StatusBanner>
          <table className="odoo-table">
            <thead><tr><th>Fiches</th><th>Unité saisie</th><th style={{ textAlign: 'right' }}>Lignes</th><th>Exemple</th></tr></thead>
            <tbody>{data.unmatched.map(m => (
              <tr key={`${m.table_name}|${m.unit}`}><td>{TABLE[m.table_name] ?? m.table_name}</td><td style={{ fontFamily: 'monospace' }}>{m.unit}</td>
                <td style={{ textAlign: 'right' }}>{m.lines}</td><td>{m.example}</td></tr>
            ))}</tbody>
          </table>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--odoo-text-muted)' }}>Toutes les fiches ont une unité rattachée au référentiel.</p>
      )}
    </div>
  );
}
