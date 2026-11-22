import { useQuery } from '@tanstack/react-query';
import { Hash, Loader2 } from 'lucide-react';
import api from '../../api/client';

import { LoadingState } from '../../components/ds';
/**
 * Numéros de série de l'ordre (M9, mig 585) : un par pièce des articles suivis par série,
 * créés à la déclaration (saisis, sinon « numéro de lot-0001… »). Lecture seule.
 */
interface SerialRow { id: string; serial_number: string; status: string; product_name: string; lot_number: string | null }
const STATUS: Record<string, string> = { in_stock: 'En stock', sold: 'Vendu', scrapped: 'Rebuté' };

export default function SerialsPanel({ planId }: { planId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['production', planId, 'serials'],
    queryFn: () => api.get(`/production/${planId}/serials`).then(r => r.data.data as SerialRow[]),
  });
  return (
    <div className="odoo-section" style={{ margin: '1rem' }}>
      <div className="odoo-section-header"><Hash size={12} /> Numéros de série
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400 }}>{data.length}</span>
      </div>
      {isLoading ? <LoadingState bare /> : data.length === 0 ? (
        <p className="text-xs text-gray-500" style={{ padding: '0.75rem 1rem' }}>
          Les numéros sont créés à la déclaration de production, un par pièce.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table className="odoo-table">
            <thead><tr><th>Numéro</th><th>Article</th><th>Lot</th><th>État</th></tr></thead>
            <tbody>
              {data.map(s => (
                <tr key={s.id}>
                  <td style={{ fontFamily: 'monospace' }}>{s.serial_number}</td>
                  <td>{s.product_name}</td>
                  <td style={{ fontFamily: 'monospace' }}>{s.lot_number ?? '—'}</td>
                  <td>{STATUS[s.status] ?? s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
