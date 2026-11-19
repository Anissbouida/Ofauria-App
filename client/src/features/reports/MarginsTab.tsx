import { money } from '../../utils/money';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { managementApi } from '../../api/management.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { ListKpi, ListPanel } from '../sales/ListTemplate';

/**
 * Rapports › Marges (mig 317) : marge sur coût de revient par famille, canal ou
 * produit. CA toutes sources (caisse, sinon Contrôle des ventes). Une vente
 * n'entre dans la marge que si son coût est connu et cohérent : la part
 * couverte est affichée, et les produits à corriger sont listés.
 */

type GroupBy = 'category' | 'channel' | 'product';
const GROUPS: Array<{ key: GroupBy; label: string }> = [
  { key: 'category', label: 'Par famille' },
  { key: 'channel', label: 'Par canal' },
  { key: 'product', label: 'Par produit' },
];
const dh = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
const pct = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);

export default function MarginsTab({ from, to }: { from: string; to: string }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const { data, isLoading, error } = useQuery({ queryKey: ['margins', from, to, groupBy], queryFn: () => managementApi.margins({ from, to, groupBy }), retry: false });

  if (error) {
    return <StatusBanner tone="danger" icon={AlertTriangle} title="Marges indisponibles">{String((error as any)?.response?.data?.error?.message ?? error)}</StatusBanner>;
  }
  if (isLoading || !data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" /></div>;
  const t = data.total;
  const lowCoverage = (t.coverage_pct ?? 0) < 80;

  const groupLabel = GROUPS.find(g => g.key === groupBy)!.label.replace('Par ', '').replace(/^./, c => c.toUpperCase());

  return (
    <>
      <section className="prj-kpis" aria-label="Indicateurs">
        <ListKpi label="Chiffre d'affaires" value={money(t.revenue, { decimals: 0 })} sub="toutes ventes de la période" />
        <ListKpi label="CA dont le coût est connu" value={pct(t.coverage_pct)} sub={money(t.revenue_costed, { decimals: 0 })} tone={lowCoverage && t.revenue > 0 ? 'orange' : undefined} />
        <ListKpi label="Marge sur coût de revient" value={money(t.margin, { decimals: 0 })} sub="sur le CA couvert" />
        <ListKpi label="Taux de marge" value={pct(t.margin_pct)} sub="marge / CA couvert" />
      </section>

      {t.revenue === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucune vente sur la période" />
      ) : lowCoverage && (
        <section className="kl-ar-rec">
          <span className="kl-ic o"><AlertTriangle size={16} /></span>
          <span className="tx">
            <b>Seulement {pct(t.coverage_pct)} du CA a un coût de revient fiable</b>
            <small>La marge ne porte que sur cette part. Complétez les fiches techniques des produits listés plus bas pour l'étendre.</small>
          </span>
        </section>
      )}

      {data.groups.length > 0 && (
        <section>
          <div className="kl-sec">
            <h2>Marge {groupBy === 'category' ? 'par famille' : groupBy === 'channel' ? 'par canal' : 'par produit'}</h2>
            <div className="prj-views" role="tablist" aria-label="Regrouper">
              {GROUPS.map(g => (
                <button key={g.key} type="button" role="tab" aria-selected={groupBy === g.key} className={groupBy === g.key ? 'active' : ''} onClick={() => setGroupBy(g.key)}>{g.label.replace('Par ', '').replace(/^./, c => c.toUpperCase())}</button>
              ))}
            </div>
          </div>
          <ListPanel>
            <table className="odoo-table">
              <thead><tr>
                <th>{groupLabel}</th>
                <th style={{ textAlign: 'right' }}>CA</th><th style={{ textAlign: 'right' }}>Couverture</th>
                <th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'right' }}>Marge</th><th style={{ textAlign: 'right' }}>Taux</th>
                {groupBy !== 'product' && <th style={{ textAlign: 'right' }}>Produits sans coût</th>}
              </tr></thead>
              <tbody>{data.groups.map(g => (
                <tr key={g.key}>
                  <td style={{ fontWeight: 500 }}>{g.key}</td>
                  <td style={{ textAlign: 'right' }}>{dh(g.revenue)}</td>
                  <td style={{ textAlign: 'right' }} className={(g.coverage_pct ?? 0) < 50 ? 'kl-rep-tone-o' : undefined}>{pct(g.coverage_pct)}</td>
                  <td style={{ textAlign: 'right' }}>{g.revenue_costed ? dh(g.cost) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{g.revenue_costed ? dh(g.margin) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{pct(g.margin_pct)}</td>
                  {groupBy !== 'product' && <td style={{ textAlign: 'right' }}>{g.products_without_cost + g.products_incoherent} / {g.products}</td>}
                </tr>
              ))}</tbody>
            </table>
          </ListPanel>
        </section>
      )}

      {data.toFix.length > 0 && (
        <section>
          <div className="kl-sec"><h2>Coûts à corriger</h2><small>plus gros CA d'abord</small></div>
          <ListPanel>
            <table className="odoo-table">
              <thead><tr><th>Produit</th><th>Famille</th><th style={{ textAlign: 'right' }}>CA</th><th style={{ textAlign: 'right' }}>Prix moyen vendu</th><th style={{ textAlign: 'right' }}>Coût retenu</th><th>Problème</th></tr></thead>
              <tbody>{data.toFix.map(p => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td>{p.category ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{dh(p.revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{p.avg_price.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'right' }}>{p.unit_cost == null ? '—' : p.unit_cost.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                  <td>
                    {p.issue === 'missing'
                      ? <span className="kl-pill x">Pas de coût de revient</span>
                      : <span className="kl-pill o" title="Unité de vente différente de la fiche (part vs entier) ou coût erroné">Coût ≥ prix de vente</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </ListPanel>
        </section>
      )}
      <p className="kl-rep-note">
        Coût de revient : celui du lot vendu (coût de revient réel de son ordre de fabrication, réparti entre ses articles comme sur la fiche de l'ordre) ; à défaut, format de la fiche technique, sinon recette, sinon coût saisi sur le produit (ignoré s'il est égal ou supérieur au prix).
        Les ventes importées du Contrôle des ventes sont rattachées au canal par défaut. Les charges ne portant pas de canal, il s'agit d'une marge sur coût de revient, pas d'un résultat net.
      </p>
    </>
  );
}
