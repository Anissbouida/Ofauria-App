import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Calculator } from 'lucide-react';
import { analyticCostApi } from '../../api/analytic-cost.api';
import { SectionHeader } from '../../components/ds';
import { money } from '../../utils/money';

/**
 * Lot E (mig 655-657) : coût de revient standard d'une pièce de la fiche, avec les mêmes
 * charges que le coût réel des plans (coût de l'unité d'œuvre des centres du mois), et le
 * prix de vente conseillé pour un taux de marque visé.
 */
export default function RecipeAnalyticCostPanel({ recipeId }: { recipeId: string }) {
  const [formatId, setFormatId] = useState<string | null>(null);
  const [marque, setMarque] = useState('30');
  const target = Number(marque) > 0 && Number(marque) < 95 ? Number(marque) : 30;
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['recipe-standard-cost', recipeId, formatId, target],
    queryFn: () => analyticCostApi.standard(recipeId, formatId, target),
  });
  if (isLoading || isError || !s) return null;
  const row = (label: string, detail: string, value: number | null, strong = false) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 2fr) auto', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--ds-hair)', fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span><span className="ds-muted" style={{ fontWeight: 400 }}>{detail}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value != null ? money(value, { decimals: 4 }) : '—'}</span>
    </div>
  );
  const prod = s.lines.find(l => l.level === 'production');
  const appro = s.lines.find(l => l.level === 'approvisionnement');
  const structRate = s.lines.filter(l => l.level === 'administration' || l.level === 'distribution');
  return (
    <section className="ds-panel" style={{ padding: '14px 20px', display: 'grid', gap: 12 }}>
      <SectionHeader title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Calculator size={16} aria-hidden="true" /> Coût de revient et prix conseillé</span>}
        note={`Charges des centres de ${s.month} · ${s.productName ?? ''}`} />
      {s.formats.length > 1 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          Format
          <select className="ds-input sm" style={{ width: 'auto' }} value={s.formatId ?? ''} onChange={e => setFormatId(e.target.value || null)}>
            {s.formats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
        <div>
          {row('Matières', s.pieces ? `fiche ÷ ${s.pieces} pièces` : 'fiche', s.matiere)}
          {s.emballage > 0 && row('Emballage', 'fiche', s.emballage)}
          {row('Main-d\'œuvre directe', s.labourMinutes != null ? `${s.labourMinutes.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} min de gamme × ${money(s.directRate)}/h` : 'aucune gamme', s.labourMinutes != null ? s.mainOeuvre : null)}
          {appro && row('Approvisionnement', `matières × ${appro.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}`, s.appro)}
          {prod && row('Charges de production', `${prod.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} × ${prod.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} (${prod.driverLabel.toLowerCase()})`, s.production)}
          {row('Coût de production', 'valeur du stock', s.coutProduction, true)}
          {row('Structure', structRate.length ? structRate.map(l => `${l.name} ${l.driverLabel === 'Valeur de vente HT' ? `${(l.rate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} % du prix` : l.driverLabel}`).join(' · ') : '—', s.structure)}
          {row('Coût de revient complet', '', s.coutRevient, true)}
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div className="ds-kpi"><span className="ds-kpi-label">Prix de vente HT</span><span className="ds-kpi-value">{s.priceHt != null ? money(s.priceHt) : '—'}</span></div>
            <div className="ds-kpi"><span className="ds-kpi-label">Marge par pièce</span><span className="ds-kpi-value">{s.marge != null ? money(s.marge, { decimals: 4 }) : '—'}</span></div>
            <div className="ds-kpi"><span className="ds-kpi-label">Taux de marque</span><span className="ds-kpi-value">{s.tauxMarque != null ? `${s.tauxMarque.toLocaleString('fr-FR')} %` : '—'}</span></div>
          </div>
          <label htmlFor="cible-marque" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Taux de marque visé
            <input id="cible-marque" type="number" min="1" max="90" className="ds-input sm" style={{ width: 80 }} value={marque} onChange={e => setMarque(e.target.value)} /> %
          </label>
          <div style={{ background: 'var(--kl-read-green-bg, #ECFDF3)', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>Prix de vente HT conseillé pour {s.cibleMarque} % de marque</span>
            <strong style={{ fontSize: 18 }}>{s.prixConseille != null ? money(s.prixConseille) : '—'}</strong>
          </div>
          <p className="ds-muted" style={{ fontSize: 12, margin: 0 }}>
            Prix = (coût de production{s.structureFixed > 0 ? ' + structure fixe' : ''}) ÷ (1 − {s.cibleMarque} % − {(s.structureSalesRate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} % de structure liée au prix).
            Mêmes charges que le coût réel des plans : <Link to="/production/analyse-couts">Analyse des coûts</Link>.
          </p>
          {s.warnings.slice(0, 2).map((w, i) => <p key={i} className="ds-muted" style={{ fontSize: 12, margin: 0 }}>{w}</p>)}
        </div>
      </div>
    </section>
  );
}
