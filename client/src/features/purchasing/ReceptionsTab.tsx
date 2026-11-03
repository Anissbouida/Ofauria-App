import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PackageCheck, Search, X } from 'lucide-react';
import { receptionVouchersApi } from '../../api/purchase-orders.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PODetailModal } from '../accounting/PurchaseOrdersTab';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

/** Ligne renvoyée par GET /reception-vouchers (reception_voucher.repository.findAll). */
type ReceptionRow = {
  id: string;
  voucher_number: string;
  reception_date: string | null;
  purchase_order_id: string;
  order_number: string | null;
  supplier_name: string | null;
  received_by_name: string | null;
  item_count: string | number;
  total_amount: string | number;
  notes: string | null;
};

const Dh = () => <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', fontWeight: 400 }}>DH</span>;

/**
 * Étape 6 du cycle d'achat — Réception. Liste des bons de réception (entrées de
 * marchandise liées à un BC). Lecture seule : la réception elle-même se déclenche
 * et se complète depuis le détail du bon de commande (clic sur le BC ci-dessous).
 */
export default function ReceptionsTab() {
  const [searchInput, setSearchInput] = useState('');
  const [poDetail, setPoDetail] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery<ReceptionRow[]>({
    queryKey: ['reception-vouchers', 'all'],
    queryFn: () => receptionVouchersApi.list(),
  });

  const term = searchInput.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!term) return data;
    return data.filter(r =>
      [r.voucher_number, r.order_number, r.supplier_name, r.received_by_name]
        .some(f => (f ?? '').toLowerCase().includes(term)));
  }, [data, term]);

  return (
    <>
      <StatusBanner tone="neutral" icon={PackageCheck} title="Bons de réception — entrées de marchandise">
        Chaque entrée liée à un bon de commande. La réception se déclenche et se complète depuis le détail du BC :
        cliquez son numéro pour l'ouvrir. L'écart de prix et le rapprochement facture se suivent dans le Pilotage.
      </StatusBanner>

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" aria-label="Rechercher" placeholder="Rechercher par N° de réception, BC, fournisseur..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        {searchInput && (
          <button type="button" onClick={() => setSearchInput('')} className="odoo-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <PackageCheck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {term ? 'Aucune réception pour cette recherche' : 'Aucune réception enregistrée'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead><tr>
              <th>Reçu le</th>
              <th>N° réception</th>
              <th>BC</th>
              <th>Fournisseur</th>
              <th style={{ textAlign: 'right' }}>Lignes</th>
              <th style={{ textAlign: 'right' }}>Montant reçu</th>
              <th>Reçu par</th>
            </tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} onClick={() => setPoDetail(r.purchase_order_id)}
                style={{ cursor: 'pointer' }} title="Ouvrir le bon de commande et le détail de la réception">
                <td style={{ color: 'var(--theme-text-muted)' }}>{date(r.reception_date)}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.voucher_number}</td>
                <td style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--odoo-purple)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                  {r.order_number ?? '—'}
                </td>
                <td style={{ fontWeight: 600 }}>{r.supplier_name ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.item_count}</td>
                <td style={{ textAlign: 'right' }}>{fmt(r.total_amount)} <Dh /></td>
                <td style={{ color: 'var(--theme-text-muted)' }}>{r.received_by_name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} />}
    </>
  );
}
