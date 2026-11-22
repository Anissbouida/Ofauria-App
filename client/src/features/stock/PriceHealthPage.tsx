import PriceCorrectionsCard from './PriceCorrectionsCard';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ChevronRight, CheckCircle } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { inventoryApi } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { money } from '../../utils/money';
import { ModulePage } from '../../components/layout/ModuleShell';
import { ListKpi } from '../sales/ListTemplate';
import { FullPageBar } from './StockUi';
import { DataPanel, EmptyState, KpiGrid, LoadingState, TableFooter } from '../../components/ds';


/**
 * Santé des prix (mig 406, Achats lot prix P5) : anomalies de prix catalogue
 * (`ingredients.unit_cost`) à corriger — prix manquant, ou écart fort avec le
 * coût réel des lots (souvent une erreur d'unité). Diagnostic, pas d'auto-fix.
 */
export default function PriceHealthPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['price-health'], queryFn: inventoryApi.priceHealth });
  const rows = data?.rows ?? [];
  // G0-26 : conversions d'unité impossibles (calculées aujourd'hui avec un facteur 1).
  const { data: conversions = [], isLoading: loadingConversions } = useQuery({ queryKey: ['unit-conversion-issues'], queryFn: inventoryApi.unitConversionIssues });
  const s = data?.summary;

  return (
    <div className="odoo-scope">
      <FullPageBar backLabel="Stock" onBack={() => navigate('/stock')} trail={['Rapports']} current="Santé des prix" />
      <ModulePage title="Santé des prix" summary="Prix manquants, écarts avec le coût réel des lots et conversions d'unité impossibles, à corriger sur les fiches.">

      <StatusBanner tone="info" icon={ShieldAlert} title="Contrôle des prix d'achat (catalogue)">
        Repère les prix suspects : prix manquant, ou écart fort entre le coût catalogue (CMUP) et le coût réel des lots en stock
        — souvent une erreur d'unité (ex. prix saisi au kg au lieu du g). À corriger sur la fiche de l'ingrédient. Le CMUP sert à la valorisation du stock.
      </StatusBanner>

      {isLoading && <LoadingState label="Analyse des prix…" />}

      {!isLoading && s && (
        <KpiGrid label="Anomalies de prix">
          <ListKpi label="Écarts de prix" value={String(s.ecart_prix)} sub={`${money(s.total_gap)} de survalorisation`} tone={s.ecart_prix > 0 ? 'red' : undefined} />
          <ListKpi label="Prix manquants" value={String(s.prix_manquant)} sub="prix à 0 ou absent" tone={s.prix_manquant > 0 ? 'orange' : undefined} />
        </KpiGrid>
      )}

      {!isLoading && rows.length === 0 && (
        <EmptyState icon={CheckCircle} title="Aucune anomalie de prix" text="Tous les prix du catalogue sont cohérents avec le coût réel des lots." />
      )}

      {rows.length > 0 && (
        <DataPanel label="Anomalies de prix" footer={<TableFooter note={`${rows.length} anomalie${rows.length > 1 ? 's' : ''} · cliquez une ligne pour ouvrir la fiche et corriger le prix`} />}>
          <table className="odoo-table">
            <thead><tr>
              <th>Ingrédient</th><th>Anomalie</th>
              <th className="ds-num">Coût catalogue</th>
              <th className="ds-num">Coût lot réel</th>
              <th className="ds-num">Divergence (%)</th>
              <th className="ds-num">Écart valeur</th>
              <th style={{ width: 40 }}><span className="sr-only">Ouvrir</span></th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ingredient_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/stock/${r.ingredient_id}`)} title="Ouvrir la fiche pour corriger">
                  <td className="ds-strong">
                    {r.name}
                    {r.used_in_recipe && <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6, fontSize: '0.65rem' }} title="Utilisé dans au moins une recette — impacte le coût de production">en recette</span>}
                  </td>
                  <td>
                    {r.flag === 'ecart_prix'
                      ? <StatusTag tone="blocked" label="Écart de prix" />
                      : <StatusTag tone="todo" label="Prix manquant" />}
                  </td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.catalogue_cost != null ? `${Number(r.catalogue_cost).toFixed(2)} /${r.unit}` : '—'}</td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ds-muted)' }}>{r.lot_avg_cost != null ? `${Number(r.lot_avg_cost).toFixed(2)} /${r.unit}` : '—'}</td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.divergence_pct != null && Math.abs(r.divergence_pct) > 50 ? 'var(--ds-danger)' : undefined }}>
                    {r.divergence_pct != null ? `${r.divergence_pct > 0 ? '+' : ''}${r.divergence_pct}` : '—'}
                  </td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.value_gap ? money(r.value_gap) : '—'}</td>
                  <td className="ds-num" style={{ color: 'var(--ds-muted)' }}><ChevronRight size={14} aria-hidden="true" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      {/* G2-04 : prix à revoir par rapport à la catégorie, avec correction tracée. */}
      <PriceCorrectionsCard />

      <StatusBanner tone={conversions.length > 0 ? 'warning' : 'info'} icon={ShieldAlert} title="Conversions d'unité impossibles">
        Lignes de fiche technique saisies dans une unité qui ne se convertit pas vers l'unité de stock de la matière (pièce vers kg,
        poids vers volume sans densité…). Leur coût et leurs besoins sont calculés comme si 1 valait 1 : ils sont faux.
        Corrigez l'unité de la ligne, ou renseignez la densité de la matière.
      </StatusBanner>
      {!loadingConversions && conversions.length === 0 && (
        <EmptyState icon={CheckCircle} title="Aucune conversion impossible" text="Toutes les lignes de fiche se convertissent vers l'unité de stock." />
      )}
      {conversions.length > 0 && (
        <DataPanel label="Conversions d'unité impossibles" footer={<TableFooter note={`${conversions.length} ligne${conversions.length > 1 ? 's' : ''} de fiche technique`} />}>
          <table className="odoo-table">
            <thead><tr>
              <th>Recette</th><th>Matière</th>
              <th className="ds-num">Quantité saisie</th>
              <th>Unité de stock</th><th>Densité</th>
            </tr></thead>
            <tbody>
              {conversions.map(c => (
                <tr key={`${c.source}-${c.line_id}`} style={{ cursor: 'pointer' }} onClick={() => navigate(`/stock/${c.ingredient_id}`)} title="Ouvrir la fiche de la matière">
                  <td className="ds-strong">{c.recipe_name}</td>
                  <td>{c.ingredient_name}</td>
                  <td className="ds-num" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {c.line_unit}</td>
                  <td>{c.stock_unit}</td>
                  <td>{c.densite_kg_l ? c.densite_kg_l.toLocaleString('fr-FR') : <StatusTag tone="todo" label="Non renseignée" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataPanel>
      )}
      <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
        Divergence = (coût catalogue − coût lot réel) / coût lot réel. Écart valeur = quantité en stock × écart de coût.
      </p>
      </ModulePage>
    </div>
  );
}
