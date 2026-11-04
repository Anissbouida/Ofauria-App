import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PackageCheck, Search, Truck, X, PackageSearch } from 'lucide-react';
import { receptionVouchersApi, purchaseOrdersApi } from '../../api/purchase-orders.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PODetailModal, DeliveryModal } from '../accounting/PurchaseOrdersTab';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const daysLate = (v: string | null | undefined) => {
  if (!v) return 0;
  const due = new Date(String(v).slice(0, 10));
  return Math.floor((Date.now() - due.getTime()) / 86400000);
};

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

/** BC en attente de réception (board, étapes « envoyé » et « réception partielle »). */
type PendingPO = Record<string, any>;

const Dh = () => <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', fontWeight: 400 }}>DH</span>;

/**
 * Étape 6 du cycle d'achat — Réception.
 *
 * Deux parties :
 *  1. « À réceptionner » : les bons de commande envoyés au fournisseur et en attente de
 *     livraison (ou partiellement livrés). C'EST ICI qu'on saisit la réception — plus
 *     dans l'onglet « 5 · Bons de commande ». Le bouton ouvre le même formulaire de
 *     réception (DeliveryModal) que le détail du BC.
 *  2. « Bons de réception » : l'historique des entrées de marchandise déjà enregistrées.
 */
export default function ReceptionsTab() {
  const [searchInput, setSearchInput] = useState('');
  const [poDetail, setPoDetail] = useState<string | null>(null);
  // BC en cours de réception (ouvre le formulaire de saisie).
  const [receivePoId, setReceivePoId] = useState<string | null>(null);

  // Historique des bons de réception.
  const { data: vouchers = [], isLoading: loadingVouchers } = useQuery<ReceptionRow[]>({
    queryKey: ['reception-vouchers', 'all'],
    queryFn: () => receptionVouchersApi.list(),
  });

  // BC à réceptionner : étapes « sent » (envoyé, attente de livraison) et « partial » (reliquat attendu).
  const { data: sentBoard, isLoading: loadingSent } = useQuery({
    queryKey: ['purchase-orders', 'board', 'reception-sent'],
    queryFn: () => purchaseOrdersApi.board({ view: 'open', stage: 'sent', page: '1', pageSize: '100' }),
  });
  const { data: partialBoard, isLoading: loadingPartial } = useQuery({
    queryKey: ['purchase-orders', 'board', 'reception-partial'],
    queryFn: () => purchaseOrdersApi.board({ view: 'open', stage: 'partial', page: '1', pageSize: '100' }),
  });

  const pending = useMemo<PendingPO[]>(() => {
    const rows = [...(sentBoard?.rows ?? []), ...(partialBoard?.rows ?? [])]
      // Un BC bloqué (on_hold) ne peut pas être réceptionné.
      .filter(po => !po.on_hold);
    // En retard d'abord, puis par date de livraison prévue la plus proche.
    return rows.sort((a, b) => {
      if (!!a.is_late !== !!b.is_late) return a.is_late ? -1 : 1;
      const da = a.expected_delivery_date ?? '9999';
      const db = b.expected_delivery_date ?? '9999';
      return String(da).localeCompare(String(db));
    });
  }, [sentBoard, partialBoard]);

  const term = searchInput.trim().toLowerCase();
  const pendingRows = useMemo(() => {
    if (!term) return pending;
    return pending.filter(po =>
      [po.order_number, po.supplier_name].some(f => String(f ?? '').toLowerCase().includes(term)));
  }, [pending, term]);
  const vouchersRows = useMemo(() => {
    if (!term) return vouchers;
    return vouchers.filter(r =>
      [r.voucher_number, r.order_number, r.supplier_name, r.received_by_name]
        .some(f => (f ?? '').toLowerCase().includes(term)));
  }, [vouchers, term]);

  const loadingPending = loadingSent || loadingPartial;

  return (
    <>
      <StatusBanner tone="neutral" icon={PackageCheck} title="Réception des marchandises">
        Réceptionnez ici les bons de commande envoyés au fournisseur : sélectionnez-en un dans « À réceptionner »
        et saisissez les quantités reçues. Chaque réception crée un bon de réception (ci-dessous). L'écart de prix
        et le rapprochement facture se suivent dans le Pilotage.
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

      {/* ───────── 1. BC à réceptionner ───────── */}
      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <PackageSearch size={14} style={{ color: 'var(--theme-accent)' }} />
        <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600 }}>
          À réceptionner
          {!loadingPending && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}> · {pending.length}</span>}
        </h3>
      </div>

      {loadingPending ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={18} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : pendingRows.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <PackageSearch size={24} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {term ? 'Aucun BC à réceptionner pour cette recherche' : 'Aucun bon de commande en attente de livraison'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 24 }}>
          <table className="odoo-table">
            <thead><tr>
              <th>N° BC</th>
              <th>Fournisseur</th>
              <th>Étape</th>
              <th>Livraison prévue</th>
              <th style={{ textAlign: 'right' }}>Montant</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr></thead>
            <tbody>{pendingRows.map(po => {
              const id = po.id as string;
              const isPartial = po.stage === 'partial';
              const late = !!po.is_late;
              return (
                <tr key={id} onClick={() => setPoDetail(id)} style={{ cursor: 'pointer' }}
                  title="Ouvrir le détail du bon de commande">
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{po.order_number ?? '—'}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                      <Truck size={11} style={{ color: 'var(--theme-accent)' }} />
                      {po.supplier_name ?? '—'}
                    </span>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)' }}>
                      {po.item_count} article{Number(po.item_count) > 1 ? 's' : ''}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    <strong style={{ fontWeight: 600 }}>{isPartial ? 'Réception partielle' : 'Envoyé'}</strong>
                    <span style={{ color: 'var(--theme-text-muted)' }}> · {isPartial ? 'reliquat attendu' : 'en attente de livraison'}</span>
                  </td>
                  <td style={{ color: late ? '#dc3545' : 'var(--theme-text-muted)', fontWeight: late ? 600 : 400 }}>
                    {po.expected_delivery_date ? date(po.expected_delivery_date) : '—'}
                    {late && (
                      <div style={{ fontSize: '0.6875rem', color: '#dc3545' }}>
                        {daysLate(po.expected_delivery_date)} j de retard
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmt(po.total_amount)} <Dh /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => setReceivePoId(id)}
                      className={late ? 'odoo-btn-danger' : 'odoo-btn-primary'}>
                      {isPartial ? 'Réceptionner le reliquat' : 'Réceptionner'}
                    </button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      {/* ───────── 2. Historique des bons de réception ───────── */}
      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <PackageCheck size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600 }}>
          Bons de réception
          {!loadingVouchers && <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}> · {vouchers.length}</span>}
        </h3>
      </div>

      {loadingVouchers ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={18} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : vouchersRows.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <PackageCheck size={24} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
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
            <tbody>{vouchersRows.map(r => (
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

      {receivePoId && <DeliveryModal poId={receivePoId} onClose={() => setReceivePoId(null)} />}
      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} />}
    </>
  );
}
