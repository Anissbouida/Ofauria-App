import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle, Info } from 'lucide-react';
import { managementApi } from '../../api/management.api';
import { StatusBanner } from '../../components/ui/StatusBanner';

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
const tableWrap: React.CSSProperties = { overflowX: 'auto', border: '1px solid var(--odoo-border)', borderRadius: 4 };

export default function MarginsTab({ from, to }: { from: string; to: string }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const { data, isLoading, error } = useQuery({ queryKey: ['margins', from, to, groupBy], queryFn: () => managementApi.margins({ from, to, groupBy }), retry: false });

  if (error) {
    return <StatusBanner tone="danger" icon={AlertTriangle} title="Marges indisponibles">{String((error as any)?.response?.data?.error?.message ?? error)}</StatusBanner>;
  }
  if (isLoading || !data) return <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Loader2 size={20} className="animate-spin" /></div>;
  const t = data.total;
  const lowCoverage = (t.coverage_pct ?? 0) < 80;

  return (
    <div className="odoo-scope" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {GROUPS.map(g => (
          <button key={g.key} type="button" className={groupBy === g.key ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setGroupBy(g.key)}>{g.label}</button>
        ))}
      </div>

      <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
        <Tile label="Chiffre d'affaires" value={`${dh(t.revenue)} DH`} sub="toutes ventes de la période" />
        <Tile label="CA dont le coût est connu" value={pct(t.coverage_pct)} sub={`${dh(t.revenue_costed)} DH`} />
        <Tile label="Marge sur coût de revient" value={`${dh(t.margin)} DH`} sub="sur le CA couvert" />
        <Tile label="Taux de marge" value={pct(t.margin_pct)} sub="marge / CA couvert" />
      </div>

      {t.revenue === 0 ? (
        <StatusBanner tone="info" icon={Info} title="Aucune vente sur la période" />
      ) : lowCoverage && (
        <StatusBanner tone="warning" icon={AlertTriangle} title={`Seulement ${pct(t.coverage_pct)} du CA a un coût de revient fiable`}>
          La marge ne porte que sur cette part. Complétez les fiches techniques des produits listés plus bas pour l'étendre.
        </StatusBanner>
      )}

      {data.groups.length > 0 && (
        <div style={tableWrap}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead><tr>
              <th>{GROUPS.find(g => g.key === groupBy)!.label.replace('Par ', '').replace(/^./, c => c.toUpperCase())}</th>
              <th style={{ textAlign: 'right' }}>CA</th><th style={{ textAlign: 'right' }}>Couverture</th>
              <th style={{ textAlign: 'right' }}>Coût</th><th style={{ textAlign: 'right' }}>Marge</th><th style={{ textAlign: 'right' }}>Taux</th>
              {groupBy !== 'product' && <th style={{ textAlign: 'right' }}>Produits sans coût</th>}
            </tr></thead>
            <tbody>{data.groups.map(g => (
              <tr key={g.key}>
                <td style={{ fontWeight: 600 }}>{g.key}</td>
                <td style={{ textAlign: 'right' }}>{dh(g.revenue)}</td>
                <td style={{ textAlign: 'right', color: (g.coverage_pct ?? 0) < 50 ? '#b85d1a' : undefined }}>{pct(g.coverage_pct)}</td>
                <td style={{ textAlign: 'right' }}>{g.revenue_costed ? dh(g.cost) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{g.revenue_costed ? dh(g.margin) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{pct(g.margin_pct)}</td>
                {groupBy !== 'product' && <td style={{ textAlign: 'right' }}>{g.products_without_cost + g.products_incoherent} / {g.products}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data.toFix.length > 0 && (
        <>
          <h3 style={{ margin: '6px 0 0', fontSize: '0.875rem', fontWeight: 600 }}>Coûts à corriger (plus gros CA d'abord)</h3>
          <div style={tableWrap}>
            <table className="odoo-table" style={{ margin: 0 }}>
              <thead><tr><th>Produit</th><th>Famille</th><th style={{ textAlign: 'right' }}>CA</th><th style={{ textAlign: 'right' }}>Prix moyen vendu</th><th style={{ textAlign: 'right' }}>Coût retenu</th><th>Problème</th></tr></thead>
              <tbody>{data.toFix.map(p => (
                <tr key={p.name}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.category ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{dh(p.revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{p.avg_price.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                  <td style={{ textAlign: 'right' }}>{p.unit_cost == null ? '—' : p.unit_cost.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                  <td style={{ fontSize: '0.75rem' }}>
                    {p.issue === 'missing'
                      ? <span className="odoo-tag odoo-tag-grey">Pas de coût de revient</span>
                      : <span className="odoo-tag odoo-tag-orange" title="Unité de vente différente de la fiche (part vs entier) ou coût erroné">Coût ≥ prix de vente</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
        Coût de revient : format de la fiche technique, sinon recette, sinon coût saisi sur le produit (ignoré s'il est égal ou supérieur au prix).
        Les ventes importées du Contrôle des ventes sont rattachées au canal par défaut. Les charges ne portant pas de canal, il s'agit d'une marge sur coût de revient, pas d'un résultat net.
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="odoo-stat-card" style={{ cursor: 'default' }}>
      <div className="odoo-stat-card-label">{label}</div>
      <div className="odoo-stat-card-value">{value}</div>
      <div className="odoo-stat-card-sub">{sub}</div>
    </div>
  );
}
