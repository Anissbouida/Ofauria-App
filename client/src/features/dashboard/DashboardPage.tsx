import { money, currencySymbol } from '../../utils/money';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports.api';
import { LayoutDashboard, PackageCheck, ShoppingCart, Trash2 } from 'lucide-react';
import {
  Alert, Breadcrumb, DataPanel, EmptyState, ErrorState, KpiCard, KpiGrid, LoadingState, PageHeader, SectionHeader, TableFooter,
} from '../../components/ds';

type TopProduct = { id: string; name: string; total_sold: number; total_revenue: string };
type TopLoss = { id: string; name: string; total_lost: string; total_cost: string; loss_type: string };

/**
 * Tableau de bord de direction, au gabarit commun (Design System) : fil d'Ariane, titre,
 * alertes, indicateurs (4 par ligne au plus), puis sections en tableau standard.
 */
export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: reportsApi.dashboard });

  const d = data || { todaySales: 0, todayRevenue: 0, avgSaleValue: 0, todayItemsSold: 0, topProducts: [], pendingOrders: 0, lowStockCount: 0, todayLossCount: 0, todayLossCost: 0, todayLossQuantity: 0, monthlyLossCost: 0, monthlyLossQuantity: 0, topLossProducts: [] };
  const topProducts = (d.topProducts || []) as TopProduct[];
  const topLosses = (d.topLossProducts || []) as TopLoss[];

  return (
    <div className="odoo-scope kl-apple">
      <div className="odoo-control-bar">
        <Breadcrumb icon={LayoutDashboard} items={[{ label: 'Accueil' }, { label: 'Direction' }, { label: 'Tableau de bord' }]} />
      </div>
      <div className="kl-page">
        <PageHeader title="Tableau de bord" description="Ventes, commandes, pertes et stock de la journée." />

        {isLoading ? <LoadingState label="Chargement du tableau de bord…" />
          : isError ? <ErrorState title="Le tableau de bord n'a pas pu être chargé" onRetry={() => refetch()} />
          : (
          <>
            {d.lowStockCount > 0 && (
              <Alert tone="warning">{d.lowStockCount} ingrédient{d.lowStockCount > 1 ? 's' : ''} en stock bas</Alert>
            )}

            <KpiGrid label="Indicateurs du jour">
              <KpiCard label="Chiffre d'affaires du jour" value={money(d.todayRevenue)} sub={`${d.todaySales} vente${d.todaySales > 1 ? 's' : ''}`} />
              <KpiCard label="Panier moyen" value={money(d.avgSaleValue)} sub={`${d.todayItemsSold} article${d.todayItemsSold > 1 ? 's' : ''} vendu${d.todayItemsSold > 1 ? 's' : ''}`} />
              <KpiCard label="Commandes en attente" value={String(d.pendingOrders)}
                sub={d.pendingOrders > 0 ? 'À préparer' : 'Rien en attente'} tone={d.pendingOrders > 0 ? 'orange' : undefined} />
              <KpiCard label="Pertes du jour" value={money(d.todayLossCost || 0)}
                sub={`${d.todayLossCount || 0} déclaration${(d.todayLossCount || 0) > 1 ? 's' : ''} · ${money(d.monthlyLossCost || 0)} ce mois`}
                tone={(d.todayLossCost || 0) > 0 ? 'red' : undefined} />
            </KpiGrid>

            <SectionHeader title="Produits les plus vendus" note="7 derniers jours" />
            {topProducts.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="Aucune vente pour le moment" text="Les produits les plus vendus de la semaine s'afficheront ici." />
            ) : (
              <DataPanel label="Produits les plus vendus" footer={<TableFooter note={`${topProducts.length} produit${topProducts.length > 1 ? 's' : ''}`} />}>
                <table className="odoo-table">
                  <thead><tr><th>Rang</th><th>Produit</th><th className="ds-num">Quantité vendue</th><th className="ds-num">Chiffre d'affaires ({currencySymbol()})</th></tr></thead>
                  <tbody>
                    {topProducts.map((p, i) => (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td className="ds-strong">{p.name}</td>
                        <td className="ds-num">{p.total_sold}</td>
                        <td className="ds-num">{money(parseFloat(p.total_revenue))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            )}

            <SectionHeader title="Pertes les plus coûteuses" note="7 derniers jours" />
            {topLosses.length === 0 ? (
              <EmptyState icon={Trash2} title="Aucune perte cette semaine" />
            ) : (
              <DataPanel label="Pertes les plus coûteuses" footer={<TableFooter note={`${topLosses.length} ligne${topLosses.length > 1 ? 's' : ''}`} />}>
                <table className="odoo-table">
                  <thead><tr><th>Rang</th><th>Produit</th><th className="ds-num">Quantité perdue (unités)</th><th className="ds-num">Coût ({currencySymbol()})</th></tr></thead>
                  <tbody>
                    {topLosses.map((p, i) => (
                      <tr key={`${p.id}-${p.loss_type}-${i}`}>
                        <td>{i + 1}</td>
                        <td className="ds-strong">{p.name}</td>
                        <td className="ds-num">{parseFloat(p.total_lost)}</td>
                        <td className="ds-num">{money(parseFloat(p.total_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataPanel>
            )}

            <SectionHeader title="Alertes de stock" />
            {d.lowStockCount === 0
              ? <Alert tone="success" icon={PackageCheck}>Tous les stocks sont suffisants</Alert>
              : <Alert tone="warning">{d.lowStockCount} ingrédient{d.lowStockCount > 1 ? 's' : ''} sous le seuil : à réapprovisionner</Alert>}
          </>
        )}
      </div>
    </div>
  );
}
