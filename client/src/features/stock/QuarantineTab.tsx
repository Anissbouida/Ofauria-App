import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ingredientLotsApi } from '../../api/inventory.api';
import { StatusTag } from '../../components/ui/StatusTag';
import { EmptyState, KpiCard, KpiGrid, LoadingState } from '../../components/ds';

/**
 * Stock › Quarantaine (refonte Stock, maquette « Réception en quarantaine ») : lots reçus et
 * retenus jusqu'au contrôle de réception (quarantaine) ou refusés par un contrôle non conforme
 * (bloqués). Le contrôle se fait dans Contrôle › Achats et réception : conforme, il libère les
 * lots de la réception ; non conforme, il les bloque.
 */
type LotRow = {
  id: string; lot_number: string; supplier_lot_number: string | null; ingredient_id: string; ingredient_name: string; ingredient_unit: string;
  supplier_name: string | null; reception_voucher_number: string | null; quantity_remaining: string; expiration_date: string | null;
  received_at: string | null; status: string;
};
const qty = (v: string, unit: string) => `${Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${unit}`;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

export default function QuarantineTab() {
  const navigate = useNavigate();
  const load = async (status: string): Promise<LotRow[]> => {
    const r = await ingredientLotsApi.list({ status, limit: '500' });
    return (Array.isArray(r) ? r : r?.data) ?? [];
  };
  const { data: held = [], isLoading: l1 } = useQuery({ queryKey: ['ingredient-lots', 'quarantine'], queryFn: () => load('quarantine') });
  const { data: blocked = [], isLoading: l2 } = useQuery({ queryKey: ['ingredient-lots', 'blocked'], queryFn: () => load('blocked') });
  if (l1 || l2) return <LoadingState label="Chargement des lots retenus…" />;
  const rows = [...held, ...blocked];
  const receptions = new Set(held.map(l => l.reception_voucher_number).filter(Boolean)).size;
  return (
    <>
      <div className="odoo-section" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem 1rem', flexWrap: 'wrap' }}>
        <ShieldAlert size={18} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 240 }}>Un lot en quarantaine n'est ni pesé, ni consommé, ni vendu. Le contrôle de sa réception le libère (conforme) ou le bloque (non conforme).</span>
        <button type="button" className="odoo-btn-secondary" onClick={() => navigate('/controle?tab=achats')}>Contrôler les réceptions</button>
      </div>
      <KpiGrid label="Chiffres clés de la quarantaine">
        <KpiCard label="Lots en quarantaine" value={String(held.length)} sub={`${receptions} réception${receptions > 1 ? 's' : ''} à contrôler`} tone={held.length ? 'orange' : undefined} />
        <KpiCard label="Lots bloqués" value={String(blocked.length)} sub="Contrôle non conforme" tone={blocked.length ? 'red' : undefined} />
      </KpiGrid>
      {!rows.length ? (
        <EmptyState icon={ShieldAlert} title="Aucun lot retenu" text="Les lots reçus attendent ici leur contrôle quand la quarantaine à réception est active." />
      ) : (
        <div className="odoo-section">
          <div className="odoo-section-header">Lots retenus · {rows.length}</div>
          <table className="odoo-table">
            <thead><tr><th>Lot</th><th>Article</th><th>Fournisseur</th><th>Réception</th><th>Reçu le</th><th>Péremption</th><th className="ds-num">Quantité</th><th>Statut</th></tr></thead>
            <tbody>{rows.map(l => (
              <tr key={l.id} onClick={() => navigate(`/stock/${l.ingredient_id}`)} style={{ cursor: 'pointer' }}>
                <td className="ds-strong">{l.lot_number}{l.supplier_lot_number ? ` · ${l.supplier_lot_number}` : ''}</td>
                <td>{l.ingredient_name}</td><td>{l.supplier_name ?? '—'}</td><td>{l.reception_voucher_number ?? '—'}</td>
                <td>{day(l.received_at)}</td><td>{day(l.expiration_date)}</td>
                <td className="ds-num">{qty(l.quantity_remaining, l.ingredient_unit)}</td>
                <td>{l.status === 'blocked' ? <StatusTag tone="late" label="Bloqué" /> : <StatusTag tone="todo" label="Quarantaine" />}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
