import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { settingsApi, type DataQualityIndicator } from '../../api/settings.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import IngredientMergeCard from './IngredientMergeCard';
import FormatWeightsGrid from './FormatWeightsGrid';
import AllergenGrid from './AllergenGrid';
import { SettingsTabs } from './SettingsPrimitives';

/**
 * Paramètres › Qualité des données (G2-02) : complétude des fiches (formats, ingrédients,
 * fiches techniques), en direct, avec la liste à corriger de chaque compteur. Sert de
 * suivi au lot « données maîtres et étiquetage ». Lecture seule.
 */

/** Part des fiches en règle, en pourcentage entier. */
const completeness = (i: DataQualityIndicator) => (i.total > 0 ? Math.round(((i.total - i.toFix) / i.total) * 100) : 100);

function Items({ indicator }: { indicator: DataQualityIndicator }) {
  const { data, isLoading } = useQuery({
    queryKey: ['data-quality', indicator.key], queryFn: () => settingsApi.dataQualityItems(indicator.key),
  });
  if (isLoading || !data) return <div style={{ padding: 12 }}><Loader2 className="animate-spin" size={16} /></div>;
  if (!data.length) return <div style={{ padding: 12, color: 'var(--theme-text-muted)' }}>Rien à corriger.</div>;
  return (
    <div style={{ maxHeight: 360, overflowY: 'auto', borderTop: '1px solid var(--odoo-border)' }}>
      <table className="odoo-table" style={{ width: '100%' }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>Fiche</th><th style={{ textAlign: 'left' }}>{indicator.detailLabel}</th><th /></tr>
        </thead>
        <tbody>
          {data.map((it, n) => (
            <tr key={`${it.id}-${n}`}>
              <td>{it.label}</td>
              <td style={{ color: 'var(--theme-text-muted)' }}>{it.detail}</td>
              <td style={{ textAlign: 'right' }}>
                <Link className="odoo-btn-secondary" to={it.kind === 'recipe' ? `/recipes/${it.id}/nomenclature` : `/stock/${it.id}`}>Ouvrir la fiche</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length >= 200 && (
        <div style={{ padding: '8px 12px', fontSize: '0.78rem', color: 'var(--theme-text-muted)' }}>Les 200 premières lignes sont affichées.</div>
      )}
    </div>
  );
}

export default function DataQualityTab() {
  const { data, isLoading } = useQuery({ queryKey: ['data-quality'], queryFn: settingsApi.dataQuality });
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading || !data) return <Loader2 className="animate-spin" size={18} />;
  const remaining = data.filter(i => i.toFix > 0).length;

  const controls = (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatusBanner tone={remaining === 0 ? 'success' : 'info'} icon={Activity} title="Qualité des données">
        {remaining === 0
          ? 'Toutes les fiches contrôlées sont complètes.'
          : `${remaining} contrôle${remaining > 1 ? 's' : ''} sur ${data.length} ont encore des fiches à compléter. Les compteurs sont calculés en direct.`}
      </StatusBanner>

      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', overflowX: 'auto' }}>
        <table className="odoo-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Contrôle</th>
              <th style={{ textAlign: 'right' }}>À corriger</th>
              <th style={{ textAlign: 'right' }}>Sur</th>
              <th style={{ textAlign: 'left', minWidth: 130 }}>Complétude</th>
              <th style={{ textAlign: 'left' }}>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map(i => {
              const pct = completeness(i);
              const isOpen = open === i.key;
              return [
                <tr key={i.key}>
                  <td style={{ minWidth: 260, maxWidth: 420 }}>
                    <div style={{ fontWeight: 500 }}>{i.label}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--theme-text-muted)' }}>{i.help}</div>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{i.toFix.toLocaleString('fr-FR')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{i.total.toLocaleString('fr-FR')}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Complétude : ${pct} %`}
                        style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--odoo-border)', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#2e7d32' : pct >= 70 ? '#b45309' : '#c62828' }} />
                      </div>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8rem', minWidth: 38, textAlign: 'right' }}>{pct} %</span>
                    </div>
                  </td>
                  <td><StatusTag tone={i.toFix === 0 ? 'done' : pct >= 70 ? 'todo' : 'late'} label={i.toFix === 0 ? 'Complet' : pct >= 70 ? 'À compléter' : 'Prioritaire'} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {i.toFix > 0 && (
                      <button type="button" className="odoo-btn-secondary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.key)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {isOpen ? 'Masquer' : 'Voir la liste'}
                      </button>
                    )}
                  </td>
                </tr>,
                isOpen && <tr key={`${i.key}-items`}><td colSpan={6} style={{ padding: 0 }}><Items indicator={i} /></td></tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Les contrôles d'un côté, les outils de correction de l'autre (G2-03, G2-05, G2-06).
  return (
    <div className="odoo-scope">
      <SettingsTabs label="Qualité des données" tabs={[
        { key: 'controls', label: 'Contrôles', content: controls },
        { key: 'duplicates', label: 'Ingrédients en double', content: <IngredientMergeCard /> },
        { key: 'weights', label: 'Poids des formats', content: <FormatWeightsGrid /> },
        { key: 'allergens', label: 'Allergènes', content: <AllergenGrid /> },
      ]} />
    </div>
  );
}
