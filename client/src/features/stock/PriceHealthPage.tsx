import PriceCorrectionsCard from './PriceCorrectionsCard';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Loader2, ChevronRight, CheckCircle } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { inventoryApi } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { money } from '../../utils/money';
import { ModulePage } from '../../components/layout/ModuleShell';
import { ListKpi, ListPanel, ListEmpty } from '../sales/ListTemplate';
import { FullPageBar } from './StockUi';


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
      <ModulePage title="Santé des prix">

      <StatusBanner tone="info" icon={ShieldAlert} title="Contrôle des prix d'achat (catalogue)">
        Repère les prix suspects : prix manquant, ou écart fort entre le coût catalogue (CMUP) et le coût réel des lots en stock
        — souvent une erreur d'unité (ex. prix saisi au kg au lieu du g). À corriger sur la fiche de l'ingrédient. Le CMUP sert à la valorisation du stock.
      </StatusBanner>

      {isLoading && <ListEmpty icon={Loader2} title="Chargement…" />}

      {!isLoading && s && (
        <section className="prj-kpis" aria-label="Anomalies de prix">
          <ListKpi label="Écarts de prix" value={String(s.ecart_prix)} sub={`${money(s.total_gap)} de survalorisation`} tone={s.ecart_prix > 0 ? 'red' : undefined} />
          <ListKpi label="Prix manquants" value={String(s.prix_manquant)} sub="prix à 0 ou absent" tone={s.prix_manquant > 0 ? 'orange' : undefined} />
        </section>
      )}

      {!isLoading && rows.length === 0 && (
        <ListEmpty icon={CheckCircle} title="Aucune anomalie de prix détectée." />
      )}

      {rows.length > 0 && (
        <ListPanel>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr>
              <th>Ingrédient</th><th>Anomalie</th>
              <th style={{ textAlign: 'right' }}>Coût catalogue</th>
              <th style={{ textAlign: 'right' }}>Coût lot réel</th>
              <th style={{ textAlign: 'right' }}>Divergence</th>
              <th style={{ textAlign: 'right' }}>Écart valeur</th>
              <th style={{ width: 40 }} />
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ingredient_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/stock/${r.ingredient_id}`)} title="Ouvrir la fiche pour corriger">
                  <td style={{ fontWeight: 500 }}>
                    {r.name}
                    {r.used_in_recipe && <span className="odoo-tag odoo-tag-blue" style={{ marginLeft: 6, fontSize: '0.65rem' }} title="Utilisé dans au moins une recette — impacte le coût de production">en recette</span>}
                  </td>
                  <td>
                    {r.flag === 'ecart_prix'
                      ? <StatusTag tone="blocked" label="Écart de prix" />
                      : <StatusTag tone="todo" label="Prix manquant" />}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.catalogue_cost != null ? `${Number(r.catalogue_cost).toFixed(2)} /${r.unit}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--theme-text-muted)' }}>{r.lot_avg_cost != null ? `${Number(r.lot_avg_cost).toFixed(2)} /${r.unit}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.divergence_pct != null && Math.abs(r.divergence_pct) > 50 ? 'var(--prj-red)' : undefined }}>
                    {r.divergence_pct != null ? `${r.divergence_pct > 0 ? '+' : ''}${r.divergence_pct} %` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.value_gap ? money(r.value_gap) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>
      )}
      {/* G2-04 : prix à revoir par rapport à la catégorie, avec correction tracée. */}
      <PriceCorrectionsCard />

      <StatusBanner tone={conversions.length > 0 ? 'warning' : 'info'} icon={ShieldAlert} title="Conversions d'unité impossibles">
        Lignes de fiche technique saisies dans une unité qui ne se convertit pas vers l'unité de stock de la matière (pièce vers kg,
        poids vers volume sans densité…). Leur coût et leurs besoins sont calculés comme si 1 valait 1 : ils sont faux.
        Corrigez l'unité de la ligne, ou renseignez la densité de la matière.
      </StatusBanner>
      {!loadingConversions && conversions.length === 0 && (
        <ListEmpty icon={CheckCircle} title="Aucune conversion impossible : toutes les lignes de fiche se convertissent vers l'unité de stock." />
      )}
      {conversions.length > 0 && (
        <ListPanel>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr>
              <th>Recette</th><th>Matière</th>
              <th style={{ textAlign: 'right' }}>Quantité saisie</th>
              <th>Unité de stock</th><th>Densité</th>
            </tr></thead>
            <tbody>
              {conversions.map(c => (
                <tr key={`${c.source}-${c.line_id}`} style={{ cursor: 'pointer' }} onClick={() => navigate(`/stock/${c.ingredient_id}`)} title="Ouvrir la fiche de la matière">
                  <td style={{ fontWeight: 500 }}>{c.recipe_name}</td>
                  <td>{c.ingredient_name}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} {c.line_unit}</td>
                  <td>{c.stock_unit}</td>
                  <td>{c.densite_kg_l ? c.densite_kg_l.toLocaleString('fr-FR') : <StatusTag tone="todo" label="Non renseignée" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListPanel>
      )}
      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', margin: 0 }}>
        Divergence = (coût catalogue − coût lot réel) / coût lot réel. Écart valeur = quantité en stock × écart de coût.
        Cliquez une ligne pour ouvrir la fiche et corriger le prix (souvent une unité mal saisie).
      </p>
      </ModulePage>
    </div>
  );
}
