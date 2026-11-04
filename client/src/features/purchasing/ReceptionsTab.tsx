import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PackageCheck, Search, Truck, X, PackageSearch } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { receptionVouchersApi, purchaseOrdersApi } from '../../api/purchase-orders.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { PODetailModal, DeliveryModal } from '../accounting/PurchaseOrdersTab';
import { ViewSwitch, PeriodFilter, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const monthKey = (v: string | null | undefined) => (v ? String(v).slice(0, 7) : '');
const monthLabel = (v: string | null | undefined) =>
  v ? format(new Date(`${String(v).slice(0, 10)}T00:00:00`), 'MMMM yyyy', { locale: fr }) : '—';
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
 * Étape 6 du cycle d'achat — Réception. Deux vues (ViewSwitch) :
 *  • « À réceptionner » : les bons de commande envoyés au fournisseur et en attente de
 *    livraison (ou partiellement livrés). C'EST ICI qu'on saisit la réception. Le bouton
 *    ouvre le même formulaire (DeliveryModal) que le détail du BC.
 *  • « Historique » : les bons de réception déjà enregistrés, classés par mois et
 *    filtrables par période.
 */
export default function ReceptionsTab() {
  const [view, setView] = useState<'open' | 'history'>('open');
  const [searchInput, setSearchInput] = useState('');
  const [poDetail, setPoDetail] = useState<string | null>(null);
  // BC en cours de réception (ouvre le formulaire de saisie).
  const [receivePoId, setReceivePoId] = useState<string | null>(null);
  // Filtre de période de l'historique (sur la date de réception).
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

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
  const loadingPending = loadingSent || loadingPartial;

  const pendingRows = useMemo(() => {
    if (!term) return pending;
    return pending.filter(po =>
      [po.order_number, po.supplier_name].some(f => String(f ?? '').toLowerCase().includes(term)));
  }, [pending, term]);

  // Historique : filtré par période (date de réception) puis par recherche, trié décroissant.
  const { dateFrom, dateTo } = periodParams(period, customFrom, customTo) as { dateFrom?: string; dateTo?: string };
  const vouchersRows = useMemo(() => {
    return vouchers
      .filter(r => {
        const d = (r.reception_date ?? '').slice(0, 10);
        if (dateFrom && (!d || d < dateFrom)) return false;
        if (dateTo && (!d || d > dateTo)) return false;
        return true;
      })
      .filter(r => !term || [r.voucher_number, r.order_number, r.supplier_name, r.received_by_name]
        .some(f => (f ?? '').toLowerCase().includes(term)))
      .sort((a, b) => String(b.reception_date ?? '').localeCompare(String(a.reception_date ?? '')));
  }, [vouchers, dateFrom, dateTo, term]);

  const hasPeriodFilter = period !== 'all';

  return (
    <>
      <StatusBanner tone="neutral" icon={PackageCheck} title="Réception des marchandises">
        Réceptionnez ici les bons de commande envoyés au fournisseur : dans « À réceptionner », sélectionnez-en un
        et saisissez les quantités reçues. Chaque réception crée un bon de réception, classé dans l'« Historique ».
        L'écart de prix et le rapprochement facture se suivent dans le Pilotage.
      </StatusBanner>

      {/* Bascule À réceptionner / Historique */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch
          view={view}
          onChange={setView}
          openLabel={`À réceptionner${loadingPending ? '' : ` · ${pending.length}`}`}
          historyLabel={`Historique${loadingVouchers ? '' : ` · ${vouchers.length}`}`}
          ariaLabel="Vue des réceptions"
        />
      </div>

      {/* Recherche + (historique) filtre de période */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" aria-label="Rechercher"
          placeholder={view === 'open' ? 'Rechercher par N° de BC, fournisseur...' : 'Rechercher par N° de réception, BC, fournisseur...'}
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 220px', minWidth: 0 }} />
        {view === 'history' && (
          <PeriodFilter label="Reçu" title="Filtre sur la date de réception"
            period={period} onPeriod={setPeriod}
            from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        )}
        {(searchInput || (view === 'history' && hasPeriodFilter)) && (
          <button type="button"
            onClick={() => { setSearchInput(''); setPeriod('all'); setCustomFrom(''); setCustomTo(''); }}
            className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer
          </button>
        )}
      </div>

      {/* ───────── À réceptionner ───────── */}
      {view === 'open' && (
        loadingPending ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <Loader2 className="animate-spin" size={18} style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
          </div>
        ) : pendingRows.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <PackageSearch size={26} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {term ? 'Aucun BC à réceptionner pour cette recherche' : 'Aucun bon de commande en attente de livraison'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
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
        )
      )}

      {/* ───────── Historique des bons de réception (par mois) ───────── */}
      {view === 'history' && (
        loadingVouchers ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <Loader2 className="animate-spin" size={18} style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
          </div>
        ) : vouchersRows.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
            <PackageCheck size={26} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
            <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              {term || hasPeriodFilter ? 'Aucune réception pour ces filtres' : 'Aucune réception enregistrée'}
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
              <tbody>{vouchersRows.map((r, i) => {
                const prev = i > 0 ? vouchersRows[i - 1] : null;
                const showMonth = !prev || monthKey(prev.reception_date) !== monthKey(r.reception_date);
                return (
                  <Fragment key={r.id}>
                    {showMonth && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--odoo-bg-hover)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'capitalize', color: 'var(--odoo-text)' }}>
                          {monthLabel(r.reception_date)}
                        </td>
                      </tr>
                    )}
                    <tr onClick={() => setPoDetail(r.purchase_order_id)}
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
                  </Fragment>
                );
              })}</tbody>
            </table>
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>
              {vouchersRows.length} réception{vouchersRows.length > 1 ? 's' : ''} · {periodLabel(period, customFrom, customTo)}
            </div>
          </div>
        )
      )}

      {receivePoId && <DeliveryModal poId={receivePoId} onClose={() => setReceivePoId(null)} />}
      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} />}
    </>
  );
}
