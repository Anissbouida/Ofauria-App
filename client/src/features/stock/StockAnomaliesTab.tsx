import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, PackageX, Search, Check } from 'lucide-react';
import { inventoryApi, type StockAnomaly } from '../../api/inventory.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Anomalies de stock (G0-18) : sorties supérieures au disponible. Le stock a été ramené
 * à zéro et le manque inscrit ici, au lieu de disparaître. Chaque ligne se régularise
 * (ajustement, inventaire, correction de saisie) puis se clôt avec son motif.
 */

const KIND_LABEL: Record<StockAnomaly['item_kind'], string> = {
  ingredient: 'Matière première', product: 'Produit fini', packaging: 'Emballage', semi_finished: 'Semi-fini',
};
const ORIGIN_LABEL: Record<string, string> = {
  production_plan: 'Production', lot_disposal: 'Mise au rebut d\'un lot', lot_expiry: 'Péremption d\'un lot',
  product_stock_adjust: 'Mouvement de stock produit', delivery_note: 'Bon de livraison',
  bon_sortie: 'Bon de sortie (pesée)', opening_check: 'Contrôle d\'ouverture', inventory_check: 'Inventaire de vitrine',
  unsold_decision: 'Décision sur les invendus', unsold_discrepancy: 'Écart d\'invendus', expired_destruction: 'Destruction de périmés',
  product_transfer: 'Transfert entre sites', product_loss: 'Perte déclarée', manual_adjustment: 'Ajustement manuel',
  production_transfer_gap: 'Écart de réception en boutique', frigo_loss: 'Perte au frigo', frigo_expired: 'Périmé au frigo',
  packaging_consumption: 'Consommation d\'emballage', packaging_waste: 'Perte d\'emballage', packaging_adjustment: 'Ajustement d\'emballage',
};
/** Page où l'on ajuste le stock de l'article, avec un motif. */
const adjustLink = (a: StockAnomaly): string | null =>
  a.item_kind === 'ingredient' ? `/stock/${a.item_id}`
    : a.item_kind === 'product' ? '/products'
    : a.item_kind === 'packaging' ? '/stock?tab=consumables' : null;
// Quantité dans l'unité de stock de l'article, telle qu'elle a été saisie.
const qty = (n: number, unit: string) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ' ' + unit : ''}`;
const day = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function StockAnomaliesTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['stock-anomalies', status], queryFn: () => inventoryApi.anomalies(status) });

  const resolve = useMutation({
    mutationFn: (id: string) => inventoryApi.resolveAnomaly(id, note.trim()),
    onSuccess: () => {
      notify.success('Anomalie clôturée');
      setEditing(null); setNote('');
      void qc.invalidateQueries({ queryKey: ['stock-anomalies'] });
    },
    onError: (e: { response?: { data?: { error?: { message?: string } } } }) =>
      notify.error(e.response?.data?.error?.message ?? 'Clôture impossible'),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.filter(a => (a.item_name ?? '').toLowerCase().includes(q) || (a.label ?? '').toLowerCase().includes(q)) : data;
  }, [data, search]);

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StatusBanner tone="info" icon={PackageX} title="Sorties supérieures au stock">
        Quand une sortie dépasse le stock disponible, le stock tombe à zéro et le manque est inscrit ici. Régularisez l'article
        (ajustement de stock, inventaire, correction de la saisie d'origine), puis clôturez la ligne avec le motif.
      </StatusBanner>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="odoo-search-panel" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ color: 'var(--theme-text-muted)' }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un article…"
            aria-label="Rechercher un article"
            style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'inherit', font: 'inherit' }} />
        </div>
        <div role="group" aria-label="État des anomalies" style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className={status === 'open' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setStatus('open')}>À régulariser</button>
          <button type="button" className={status === 'resolved' ? 'odoo-btn-primary' : 'odoo-btn-secondary'} onClick={() => setStatus('resolved')}>Clôturées</button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="animate-spin mr-2" size={18} /> Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          {status === 'open' ? 'Aucune anomalie à régulariser.' : 'Aucune anomalie clôturée.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Article</th>
                <th>Origine</th>
                <th style={{ textAlign: 'right' }}>Demandé</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Manque</th>
                <th>État</th>
                <th>{status === 'open' ? '' : 'Régularisation'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{day(a.created_at)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.item_name ?? '—'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                      {KIND_LABEL[a.item_kind]}{a.store_name ? ` · ${a.store_name}` : ''}
                    </div>
                  </td>
                  <td>
                    <div>{ORIGIN_LABEL[a.origin_type] ?? a.origin_type}</div>
                    {a.created_by_name && <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>{a.created_by_name}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(a.requested_qty, a.unit)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(a.available_qty, a.unit)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{qty(a.shortfall_qty, a.unit)}</td>
                  <td>{a.status === 'open' ? <StatusTag tone="late" label="À régulariser" /> : <StatusTag tone="done" label="Clôturée" />}</td>
                  <td style={{ minWidth: 240 }}>
                    {a.status === 'resolved' ? (
                      <div>
                        <div>{a.resolution_note}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                          {a.resolved_at ? day(a.resolved_at) : ''}{a.resolved_by_name ? ` · ${a.resolved_by_name}` : ''}
                        </div>
                      </div>
                    ) : editing === a.id ? (
                      <form style={{ display: 'flex', gap: 6 }} onSubmit={e => { e.preventDefault(); if (note.trim().length >= 3) resolve.mutate(a.id); }}>
                        <input className="odoo-input" autoFocus value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
                          placeholder="Comment a-t-elle été régularisée ?" aria-label="Motif de régularisation" style={{ flex: 1 }} />
                        <button type="submit" className="odoo-btn-primary" disabled={note.trim().length < 3 || resolve.isPending}>
                          <Check size={14} style={{ display: 'inline', marginRight: 4 }} />Clôturer
                        </button>
                        <button type="button" className="odoo-btn-secondary" onClick={() => { setEditing(null); setNote(''); }}>Annuler</button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {adjustLink(a) && (
                          <Link to={adjustLink(a)!} className="odoo-btn-secondary" title="Ouvre l'article pour ajuster son stock, avec un motif">
                            Ajuster le stock
                          </Link>
                        )}
                        <button type="button" className="odoo-btn-secondary" onClick={() => { setEditing(a.id); setNote(''); }}>Clôturer</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
