import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { packagingApi } from '../../api/packaging.api';
import { usePermissions } from '../../context/PermissionsContext';
import { money } from '../../utils/money';
import { StatusTag } from '../../components/ui/StatusTag';
import { ModulePage } from '../../components/layout/ModuleShell';
import { Breadcrumb, EmptyState, KpiCard, KpiGrid, LoadingState } from '../../components/ds';
import SupplierItemsSection from '../stock/SupplierItemsSection';
import '../stock/stock.css';

/**
 * Fiche consommable en blocs (refonte Stock, même principe que la fiche article) :
 * chiffres clés, historique des mouvements, fournisseurs (module Achats).
 */
type Tx = { id: string; type: string; quantity_change: string | number; stock_after: string | number | null; note: string | null; created_at: string };
const TYPE_LABEL: Record<string, string> = { restock: 'Réception', purchase_order: 'Réception', usage: 'Utilisation', adjustment: 'Ajustement', waste: 'Perte', inventory: 'Inventaire', sale: 'Vente', production: 'Production' };
const n = (v: unknown) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export default function PackagingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasModule } = usePermissions();
  const { data: item, isLoading } = useQuery({ queryKey: ['packaging-item', id], queryFn: () => packagingApi.getById(id!), enabled: !!id });
  const { data: txs = [] } = useQuery({ queryKey: ['packaging-item', id, 'transactions'], queryFn: (): Promise<Tx[]> => packagingApi.transactions(id!), enabled: !!id });
  if (isLoading || !item) return <div className="odoo-scope"><LoadingState bare label="Chargement du consommable…" /></div>;
  const it = item as Record<string, any>;
  const stock = Number(it.stock_quantity || 0);
  const min = Number(it.stock_min_threshold || 0);

  return (
    <div className="odoo-scope">
      <div className="odoo-control-bar">
        <Breadcrumb items={[{ label: 'Stock', onClick: () => navigate('/stock') }, { label: 'Consommables', onClick: () => navigate('/stock?tab=consumables') }, { label: String(it.name ?? '—') }]} />
      </div>
      <ModulePage>
        <section className="prj-panel prj-hero">
          <div className="prj-hero-top">
            <span className="prj-hero-icon"><Boxes size={22} /></span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1>{it.name}</h1>
                {stock <= 0 ? <StatusTag tone="late" label="Rupture" /> : stock < min ? <StatusTag tone="todo" label="Stock bas" /> : null}
              </div>
              <div className="prj-hero-meta">
                {(it.category_name || it.category) && <span className="odoo-tag">{it.category_name || it.category}</span>}
                {it.format && <span>{it.format}</span>}
                <span>Unité : {it.unit}</span>
              </div>
            </div>
          </div>
        </section>
        <KpiGrid label="Chiffres clés">
          <KpiCard label={`En stock (${it.unit})`} value={n(stock)} tone={stock <= 0 ? 'red' : stock < min ? 'orange' : undefined} sub={stock <= 0 ? 'En rupture' : stock < min ? `Sous le seuil de ${n(min)}` : 'Au-dessus du seuil'} />
          <KpiCard label={`Seuil (${it.unit})`} value={n(min)} />
          <KpiCard label="Coût unitaire" value={money(Number(it.unit_cost || 0))} />
          <KpiCard label="Valeur du stock" value={money(stock * Number(it.unit_cost || 0))} />
        </KpiGrid>
        <div className="stk-blocks">
          <div className="stk-blocks-main">
            <div className="odoo-section">
              <div className="odoo-section-header">Historique des mouvements</div>
              {!txs.length ? <EmptyState bare icon={Boxes} title="Aucun mouvement" text="Réceptions, utilisations, pertes et ajustements apparaissent ici." /> : (
                <table className="odoo-table">
                  <thead><tr><th>Date</th><th>Mouvement</th><th className="ds-num">Quantité</th><th className="ds-num">Stock après</th><th>Note</th></tr></thead>
                  <tbody>{txs.slice(0, 50).map(t => {
                    const q = Number(t.quantity_change);
                    return (
                      <tr key={t.id}><td>{new Date(t.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>{TYPE_LABEL[t.type] ?? t.type}</td>
                        <td className="ds-num" style={{ color: q < 0 ? 'var(--ds-danger)' : 'var(--ds-success)' }}>{q > 0 ? '+' : ''}{n(q)}</td>
                        <td className="ds-num">{t.stock_after === null ? '—' : n(t.stock_after)}</td><td>{t.note ?? ''}</td></tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          </div>
          <aside className="stk-blocks-aside" aria-label="Autres informations du consommable">
            {hasModule('purchasing') && id && (
              <div className="odoo-section" style={{ padding: '0.75rem 1rem' }}>
                <SupplierItemsSection kind="packaging" purchasableId={id} unit={it.unit} />
              </div>
            )}
          </aside>
        </div>
      </ModulePage>
    </div>
  );
}
