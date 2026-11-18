import PriceCorrectionsCard from './PriceCorrectionsCard';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Loader2, ChevronRight, CheckCircle } from 'lucide-react';
import { StatusTag } from '../../components/ui/StatusTag';
import { inventoryApi } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { money } from '../../utils/money';


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
    <div className="odoo-scope" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => navigate('/stock')} className="odoo-pager-btn" title="Retour au stock"><ArrowLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: '1.05rem' }}>Santé des prix</span>
      </div>

      <StatusBanner tone="info" icon={ShieldAlert} title="Contrôle des prix d'achat (catalogue)">
        Repère les prix suspects : prix manquant, ou écart fort entre le coût catalogue (CMUP) et le coût réel des lots en stock
        — souvent une erreur d'unité (ex. prix saisi au kg au lieu du g). À corriger sur la fiche de l'ingrédient. Le CMUP sert à la valorisation du stock.
      </StatusBanner>

      {isLoading && <div style={{ padding: 24, color: 'var(--theme-text-muted)' }}><Loader2 size={16} className="animate-spin" style={{ display: 'inline' }} /> Chargement…</div>}

      {!isLoading && s && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Tile label="Écarts de prix" value={String(s.ecart_prix)} hint={`${money(s.total_gap)} de survalorisation`} tone="danger" />
          <Tile label="Prix manquants" value={String(s.prix_manquant)} hint="prix à 0 ou absent" tone="warn" />
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <CheckCircle size={28} style={{ color: '#2e7d32', marginBottom: 8 }} />
          <div>Aucune anomalie de prix détectée. 👍</div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden' }}>
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
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.divergence_pct != null && Math.abs(r.divergence_pct) > 50 ? '#c62828' : undefined }}>
                    {r.divergence_pct != null ? `${r.divergence_pct > 0 ? '+' : ''}${r.divergence_pct} %` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.value_gap ? money(r.value_gap) : '—'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* G2-04 : prix à revoir par rapport à la catégorie, avec correction tracée. */}
      <PriceCorrectionsCard />

      <StatusBanner tone={conversions.length > 0 ? 'warning' : 'info'} icon={ShieldAlert} title="Conversions d'unité impossibles">
        Lignes de fiche technique saisies dans une unité qui ne se convertit pas vers l'unité de stock de la matière (pièce vers kg,
        poids vers volume sans densité…). Leur coût et leurs besoins sont calculés comme si 1 valait 1 : ils sont faux.
        Corrigez l'unité de la ligne, ou renseignez la densité de la matière.
      </StatusBanner>
      {!loadingConversions && conversions.length === 0 && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <CheckCircle size={22} style={{ color: '#2e7d32', marginBottom: 6 }} />
          <div>Aucune conversion impossible : toutes les lignes de fiche se convertissent vers l'unité de stock.</div>
        </div>
      )}
      {conversions.length > 0 && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, overflow: 'hidden' }}>
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
        </div>
      )}
      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Divergence = (coût catalogue − coût lot réel) / coût lot réel. Écart valeur = quantité en stock × écart de coût.
        Cliquez une ligne pour ouvrir la fiche et corriger le prix (souvent une unité mal saisie).
      </p>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'danger' | 'warn' }) {
  const color = tone === 'danger' ? '#c62828' : '#b45309';
  return (
    <div style={{ flex: 1, minWidth: 180, border: '1px solid var(--odoo-border)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '0.74rem', color: 'var(--theme-text-muted)' }}>{hint}</div>
    </div>
  );
}
