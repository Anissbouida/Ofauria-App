import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import api from '../../api/client';
import { StatusTag } from '../../components/ui/StatusTag';
import { DataPanel, EmptyState, ErrorState, LoadingState, TableFooter } from '../../components/ds';

/**
 * Stock › Réservations (feuille de route 2.6, mig 722) : une seule vue des quantités réservées
 * par les commandes clients et les ordres de fabrication, avec le disponible de l'article
 * (stock − total réservé), calculé par le serveur.
 */
type Row = {
  origin: 'commande' | 'ordre_fabrication'; id: string; item_kind: 'product' | 'ingredient'; item_id: string; item_name: string; unit: string | null;
  quantity: number; reference: string | null; created_at: string; stock_quantity: number; reserved_total: number; available: number;
};
const ORIGIN: Record<Row['origin'], string> = { commande: 'Commande client', ordre_fabrication: 'Ordre de fabrication' };
const q = (n: number, unit: string | null) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

export default function ReservationsTab() {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory', 'reservations'],
    queryFn: (): Promise<Row[]> => api.get('/inventory/reservations').then(r => r.data.data),
  });
  const [origin, setOrigin] = useState<'' | Row['origin']>('');
  const rows = useMemo(() => (origin ? data.filter(r => r.origin === origin) : data), [data, origin]);
  const short = new Set(data.filter(r => r.available < 0).map(r => r.item_id)).size;

  if (isLoading) return <LoadingState label="Chargement des réservations…" />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data.length) return <EmptyState icon={Lock} title="Aucune réservation en cours" text="Les commandes confirmées et les ordres de fabrication réservent ici le stock qu'ils utiliseront." />;
  return (
    <>
      <div className="chips" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }} role="group" aria-label="Filtrer par origine">
        {([['', 'Toutes', data.length], ['commande', 'Commandes', data.filter(r => r.origin === 'commande').length], ['ordre_fabrication', 'Ordres de fabrication', data.filter(r => r.origin === 'ordre_fabrication').length]] as const).map(([k, label, n]) => (
          <button key={k} type="button" className={origin === k ? 'odoo-btn-primary ds-btn-sm' : 'odoo-btn-secondary ds-btn-sm'} aria-pressed={origin === k} onClick={() => setOrigin(k)}>{label} · {n}</button>
        ))}
        {short > 0 && <StatusTag tone="late" label={`${short} article${short > 1 ? 's' : ''} réservé${short > 1 ? 's' : ''} au-delà du stock`} />}
      </div>
      <DataPanel label="Réservations" footer={<TableFooter note={`${rows.length} réservation${rows.length > 1 ? 's' : ''}`} />}>
        <table className="odoo-table">
          <thead><tr><th>Article</th><th>Origine</th><th>Référence</th><th className="ds-num">Réservé</th><th className="ds-num">Stock</th><th className="ds-num">Total réservé</th><th className="ds-num">Disponible</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={`${r.origin}-${r.id}`}>
              <td className="ds-strong">{r.item_name}</td>
              <td>{ORIGIN[r.origin]}</td>
              <td>{r.reference ?? '—'}</td>
              <td className="ds-num">{q(r.quantity, r.unit)}</td>
              <td className="ds-num">{q(r.stock_quantity, r.unit)}</td>
              <td className="ds-num">{q(r.reserved_total, r.unit)}</td>
              <td className="ds-num ds-strong" style={{ color: r.available < 0 ? 'var(--ds-danger)' : undefined }}>{q(r.available, r.unit)}</td>
            </tr>))}</tbody>
        </table>
      </DataPanel>
    </>
  );
}
