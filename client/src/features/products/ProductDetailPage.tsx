import { Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Edit3, ShoppingBag } from 'lucide-react';
import api from '../../api/client';
import { productsApi } from '../../api/products.api';
import { usePermissions } from '../../context/PermissionsContext';
import { money } from '../../utils/money';
import { StatusTag } from '../../components/ui/StatusTag';
import { ModulePage } from '../../components/layout/ModuleShell';
import { Breadcrumb, EmptyState, KpiCard, KpiGrid, LoadingState } from '../../components/ds';
import '../stock/stock.css';

/**
 * Fiche produit en blocs (refonte Stock, même principe que la fiche article) : chaque bloc
 * s'affiche selon sa capacité — lots (Lots), numéros de série (Séries), fiches techniques
 * (module Fiches techniques). La modification reste le formulaire existant.
 */
type Overview = {
  stock: { store_name: string; stock: number; vitrine: number; reserved: number }[];
  lots: { id: string; lot_number: string; produced_at: string | null; expires_at: string | null; status: string; quantity_total: number; remaining: number }[];
  serials: { status: string; n: number }[];
  sales: { quantity: number; amount: number; tickets: number };
  recipes: { id: string; name: string; archived: boolean }[];
};
const n = (v: number) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
const SERIAL_STATUS: Record<string, string> = { in_stock: 'En stock', sold: 'Vendus', scrapped: 'Mis au rebut', returned: 'Retournés' };

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasFeature, hasModule, canEdit } = usePermissions();
  const { data: product, isLoading } = useQuery({ queryKey: ['product', id], queryFn: () => productsApi.getById(id!), enabled: !!id });
  const { data: ov } = useQuery({ queryKey: ['product', id, 'overview'], queryFn: (): Promise<Overview> => api.get(`/products/${id}/overview`).then(r => r.data.data), enabled: !!id });
  if (isLoading || !product) return <div className="odoo-scope"><LoadingState bare label="Chargement du produit…" /></div>;
  const p = product as Record<string, any>;
  const stock = (ov?.stock ?? []).reduce((s, x) => s + Number(x.stock), 0);
  const vitrine = (ov?.stock ?? []).reduce((s, x) => s + Number(x.vitrine), 0);
  const reserved = (ov?.stock ?? []).reduce((s, x) => s + Number(x.reserved), 0);

  return (
    <div className="odoo-scope">
      <div className="odoo-control-bar">
        <Breadcrumb items={[{ label: 'Produits', onClick: () => navigate('/products') }, { label: String(p.name ?? '—') }]} />
        <div style={{ flex: 1 }} />
        {canEdit('products') && (
          <button type="button" className="odoo-btn-primary" onClick={() => navigate(`/products?edit=${id}`)}><Edit3 size={14} aria-hidden="true" /> Modifier</button>
        )}
      </div>
      <ModulePage>
        <section className="prj-panel prj-hero">
          <div className="prj-hero-top">
            <span className="prj-hero-icon"><ShoppingBag size={22} /></span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1>{p.name}</h1>
                {p.is_available === false ? <StatusTag tone="cancelled" label="Indisponible" /> : <StatusTag tone="done" label="Disponible" />}
              </div>
              <div className="prj-hero-meta">
                {p.category_name && <span className="odoo-tag">{p.category_name}</span>}
                <span>Prix : {money(Number(p.price || 0))}</span>
              </div>
            </div>
          </div>
        </section>
        <KpiGrid label="Chiffres clés">
          <KpiCard label="En stock" value={n(stock)} sub={(ov?.stock.length ?? 0) > 1 ? `${ov!.stock.length} établissements` : 'Réserve'} />
          <KpiCard label="En vitrine" value={n(vitrine)} sub="Prêt à vendre" />
          <KpiCard label="Réservé" value={n(reserved)} sub="Commandes clients" />
          <KpiCard label="Vendu sur 30 jours" value={n(ov?.sales.quantity ?? 0)} sub={`${money(ov?.sales.amount ?? 0)} · ${ov?.sales.tickets ?? 0} tickets`} />
        </KpiGrid>
        <div className="stk-blocks">
          <div className="stk-blocks-main">
            {hasFeature('lots') && (
              <div className="odoo-section">
                <div className="odoo-section-header">Lots en stock</div>
                {!ov?.lots.length ? <EmptyState bare icon={ShoppingBag} title="Aucun lot en stock" text="Les lots sont créés à la fin de chaque fabrication." /> : (
                  <table className="odoo-table">
                    <thead><tr><th>Lot</th><th>Fabriqué le</th><th>Date limite</th><th className="ds-num">Reste</th><th>Statut</th></tr></thead>
                    <tbody>{ov.lots.map(l => (
                      <tr key={l.id}><td className="ds-strong">{l.lot_number}</td><td>{day(l.produced_at)}</td><td>{day(l.expires_at)}</td>
                        <td className="ds-num">{n(l.remaining)} / {n(l.quantity_total)}</td>
                        <td>{l.status === 'pending_release' ? <StatusTag tone="todo" label="À libérer" /> : <StatusTag tone="done" label="Libéré" />}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            )}
            {(ov?.stock.length ?? 0) > 1 && (
              <div className="odoo-section">
                <div className="odoo-section-header">Stock par établissement</div>
                <dl className="stk-dl">{ov!.stock.map(s => <Fragment key={s.store_name}><dt>{s.store_name}</dt><dd>{n(s.stock)} · vitrine {n(s.vitrine)}</dd></Fragment>)}</dl>
              </div>
            )}
          </div>
          <aside className="stk-blocks-aside" aria-label="Autres informations du produit">
            {hasFeature('series') && (ov?.serials.length ?? 0) > 0 && (
              <div className="odoo-section">
                <div className="odoo-section-header">Numéros de série</div>
                <dl className="stk-dl">{ov!.serials.map(s => <Fragment key={s.status}><dt>{SERIAL_STATUS[s.status] ?? s.status}</dt><dd>{s.n}</dd></Fragment>)}</dl>
              </div>
            )}
            {hasModule('recipes') && (
              <div className="odoo-section">
                <div className="odoo-section-header">Fiches techniques</div>
                {!ov?.recipes.length ? <p className="stk-dl" style={{ color: 'var(--ds-muted)' }}>Aucune fiche technique rattachée.</p> : (
                  <dl className="stk-dl">{ov.recipes.map(r => (
                    <Fragment key={r.id}><dt><button type="button" className="odoo-link" onClick={() => navigate(`/recipes/${r.id}`)}>{r.name}</button></dt>
                      <dd>{r.archived ? 'Archivée' : 'Active'}</dd></Fragment>
                  ))}</dl>
                )}
              </div>
            )}
          </aside>
        </div>
      </ModulePage>
    </div>
  );
}
