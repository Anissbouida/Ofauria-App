import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, Truck, X, PackageSearch, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { receptionVouchersApi, purchaseOrdersApi } from '../../api/purchase-orders.api';
import { PODetailModal } from '../accounting/PurchaseOrdersTab';
import { useOpenReception } from './purchasingNav';
import { KpiGrid, KpiCard, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, ErrorState } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';
import { ViewSwitch, PeriodFilter, periodParams, periodLabel, type PeriodKey } from '../../components/purchasing/ProcessBoard';
import { usePurLayout, LayoutSwitch, SplitView, KanbanView, POPane, pdate, pmoney } from './PurLayouts';
import { StatusTag } from '../../components/ui/StatusTag';
import { money, currencySymbol } from '../../utils/money';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows: Array<{ total_amount?: unknown }>) => rows.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
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

/**
 * Étape 6 du cycle d'achat — Réception. Deux vues (ViewSwitch) :
 *  • « À réceptionner » : les bons de commande envoyés au fournisseur et en attente de
 *    livraison (ou partiellement livrés). C'EST ICI qu'on saisit la réception. Le bouton
 *    ouvre la page de réception du BC (?tab=reception&po=<id>), comme le détail du BC.
 *  • « Historique » : les bons de réception déjà enregistrés, classés par mois et
 *    filtrables par période.
 */
export default function ReceptionsTab() {
  const [view, setView] = useState<'open' | 'history'>('open');
  const [searchInput, setSearchInput] = useState('');
  const [poDetail, setPoDetail] = useState<string | null>(null);
  // Saisie d'une réception : page dédiée « Réception · n° du BC ».
  const openReception = useOpenReception();
  // Filtre de période de l'historique (sur la date de réception).
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Style Apple (2026-11) : Colonnes (liste + fiche BC) / Liste / Kanban, comme les Ventes.
  const [layout, setLayout] = usePurLayout();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Historique des bons de réception.
  const { data: vouchers = [], isLoading: loadingVouchers, error: vouchersError, refetch: refetchVouchers } = useQuery<ReceptionRow[]>({
    queryKey: ['reception-vouchers', 'all'],
    queryFn: () => receptionVouchersApi.list(),
  });

  // BC à réceptionner : étapes « sent » (envoyé, attente de livraison) et « partial » (reliquat attendu).
  const { data: sentBoard, isLoading: loadingSent, error: sentError, refetch: refetchSent } = useQuery({
    queryKey: ['purchase-orders', 'board', 'reception-sent'],
    queryFn: () => purchaseOrdersApi.board({ view: 'open', stage: 'sent', page: '1', pageSize: '500' }),
  });
  const { data: partialBoard, isLoading: loadingPartial, error: partialError, refetch: refetchPartial } = useQuery({
    queryKey: ['purchase-orders', 'board', 'reception-partial'],
    queryFn: () => purchaseOrdersApi.board({ view: 'open', stage: 'partial', page: '1', pageSize: '500' }),
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
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthVouchers = vouchers.filter(r => String(r.reception_date ?? '').slice(0, 7) === thisMonth);

  const resetFilters = () => { setSearchInput(''); setPeriod('all'); setCustomFrom(''); setCustomTo(''); };
  const lastReception = vouchers.map(r => String(r.reception_date ?? '')).sort().pop();

  return (
    <>
      {layout !== 'split' && (
        <KpiGrid>
          <KpiCard label="À réceptionner" value={String(pending.length)} sub={`${money(sum(pending))} attendus`} />
          <KpiCard label="Livraisons en retard" value={String(pending.filter(po => po.is_late).length)} sub="date prévue dépassée" tone={pending.some(po => po.is_late) ? 'red' : undefined} />
          <KpiCard label="Reçues ce mois" value={String(monthVouchers.length)} sub={money(sum(monthVouchers))} />
          <KpiCard label="Dernière réception" value={lastReception ? pdate(lastReception) : '—'} sub="bon de réception le plus récent" />
        </KpiGrid>
      )}

      {/* Barre d'outils : recherche, période (historique), puis bascules à droite. */}
      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} label="Rechercher une réception"
          placeholder={view === 'open' ? 'N° de BC, fournisseur…' : 'N° de réception, BC, fournisseur…'} />
        {view === 'history' && (
          <PeriodFilter label="Reçu" title="Filtre sur la date de réception"
            period={period} onPeriod={setPeriod}
            from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        )}
        {(searchInput || (view === 'history' && hasPeriodFilter)) && (
          <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm"><X size={13} aria-hidden="true" /> Effacer</button>
        )}
        <LayoutSwitch value={layout} onChange={setLayout} />
        <ViewSwitch
          view={view}
          onChange={v => { setView(v); setActiveId(null); }}
          openLabel={`À réceptionner${loadingPending ? '' : ` · ${pending.length}`}`}
          historyLabel={`Historique${loadingVouchers ? '' : ` · ${vouchers.length}`}`}
          ariaLabel="Vue des réceptions"
        />
      </Toolbar>

      {/* ───────── À réceptionner ───────── */}
      {view === 'open' && (
        loadingPending ? <LoadingState /> : (sentError || partialError) ? <ErrorState error={sentError || partialError} onRetry={() => { void refetchSent(); void refetchPartial(); }} /> : pendingRows.length === 0 ? (
          term
            ? <NoResultState onReset={resetFilters} text="Aucun bon de commande à réceptionner ne correspond à la recherche." />
            : <EmptyState icon={PackageSearch} title="Aucun bon de commande en attente de livraison"
                text="Les bons de commande envoyés au fournisseur apparaissent ici jusqu'à leur réception complète." />
        ) : layout === 'split' ? (
          <SplitView items={pendingRows} getId={po => po.id as string} activeId={activeId} onPick={setActiveId} label="Bons de commande à réceptionner"
            row={po => ({
              title: String(po.supplier_name ?? '—'), when: po.expected_delivery_date ? pdate(po.expected_delivery_date, 'd MMM') : undefined,
              l2: <><span className="sal-num">{po.order_number}</span> · <b>{pmoney(po.total_amount)}</b></>,
              l3: <PendingTag po={po} />,
              dot: po.is_late ? 'late' : '',
            })}
            pane={po => (
              <POPane poId={po.id as string} onFull={() => setPoDetail(po.id as string)}
                actions={<button type="button" className={po.is_late ? 'odoo-btn-danger' : 'odoo-btn-primary'} onClick={() => openReception(po.id as string)}>
                  <PackageCheck size={14} /> {po.stage === 'partial' ? 'Réceptionner le reliquat' : 'Réceptionner'}</button>} />
            )} />
        ) : layout === 'kanban' ? (
          <KanbanView items={pendingRows} getId={po => po.id as string} onOpen={po => setPoDetail(po.id as string)} empty="Aucun BC"
            sum={cards => pmoney(cards.reduce((a, po) => a + (Number(po.total_amount) || 0), 0))}
            lanes={[
              { key: 'sent', label: 'Attendus', tone: 'orange', match: po => po.stage !== 'partial' && !po.is_late },
              { key: 'late', label: 'En retard', tone: 'red', match: po => !!po.is_late },
              { key: 'partial', label: 'Reliquat attendu', tone: 'blue', match: po => po.stage === 'partial' && !po.is_late },
            ]}
            card={po => ({ num: String(po.order_number ?? '—'), title: String(po.supplier_name ?? '—'),
              meta: po.expected_delivery_date ? `prévu ${pdate(po.expected_delivery_date, 'd MMM')}` : 'sans date', amount: pmoney(po.total_amount) })} />
        ) : (
          <DataPanel label="Bons de commande à réceptionner"
            footer={<TableFooter note={`${pendingRows.length} bon${pendingRows.length > 1 ? 's' : ''} de commande à réceptionner · ${money(sum(pendingRows))} attendus`} />}>
            <table className="odoo-table">
              <thead><tr>
                <th>N° BC</th>
                <th>Fournisseur</th>
                <th>Articles</th>
                <th>Livraison prévue</th>
                <th>Statut</th>
                <th className="ds-num">Montant ({currencySymbol()})</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{pendingRows.map(po => {
                const id = po.id as string;
                const isPartial = po.stage === 'partial';
                return (
                  <tr key={id} onClick={() => setPoDetail(id)} style={{ cursor: 'pointer' }}
                    title="Ouvrir le détail du bon de commande">
                    <td className="ds-ref">{po.order_number ?? '—'}</td>
                    <td className="ds-strong">{po.supplier_name ?? '—'}</td>
                    <td>{po.item_count} article{Number(po.item_count) > 1 ? 's' : ''}</td>
                    <td>{po.expected_delivery_date ? pdate(po.expected_delivery_date) : '—'}</td>
                    <td><PendingTag po={po} /></td>
                    <td className="ds-num">{fmt(po.total_amount)}</td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => openReception(id)} className="odoo-btn-secondary ds-btn-sm">
                        {isPartial ? 'Réceptionner le reliquat' : 'Réceptionner'}
                      </button>
                      <RowMenu label={`Plus d'actions pour ${po.order_number ?? 'ce bon'}`} items={[
                        { label: 'Ouvrir le bon de commande', icon: FileText, onSelect: () => setPoDetail(id) },
                      ]} />
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </DataPanel>
        )
      )}

      {/* ───────── Historique des bons de réception (par mois) ───────── */}
      {view === 'history' && (
        loadingVouchers ? <LoadingState /> : vouchersError ? <ErrorState error={vouchersError} onRetry={() => { void refetchVouchers(); }} /> : vouchersRows.length === 0 ? (
          term || hasPeriodFilter
            ? <NoResultState onReset={resetFilters} text="Aucune réception ne correspond aux filtres." />
            : <EmptyState icon={PackageCheck} title="Aucune réception enregistrée"
                text="Chaque réception crée un bon de réception, classé ici par mois. L'écart de prix et le rapprochement facture se suivent dans Écarts de prix et Rapprochement." />
        ) : layout === 'split' ? (
          <SplitView items={vouchersRows} getId={r => r.id} activeId={activeId} onPick={setActiveId} label="Bons de réception"
            row={r => ({
              title: r.supplier_name ?? '—', when: pdate(r.reception_date, 'd MMM'),
              l2: <><span className="sal-num">{r.voucher_number}</span> · {pmoney(r.total_amount)}</>,
              l3: `${r.order_number ?? '—'} · ${r.item_count} ligne${Number(r.item_count) > 1 ? 's' : ''}${r.received_by_name ? ` · ${r.received_by_name}` : ''}`,
            })}
            pane={r => (
              <POPane poId={r.purchase_order_id} onFull={() => setPoDetail(r.purchase_order_id)}>
                <section>
                  <div className="kl-sec"><h2>Réception {r.voucher_number}</h2><small>{pdate(r.reception_date)}</small></div>
                  <div className="kl-group">
                    <div className="ord-kv"><span>Montant reçu</span><b>{pmoney(r.total_amount)}</b></div>
                    <div className="ord-kv"><span>Lignes</span><b>{r.item_count}</b></div>
                    <div className="ord-kv"><span>Reçu par</span><b>{r.received_by_name ?? '—'}</b></div>
                    {r.notes && <div className="ord-kv"><span>Notes</span><b style={{ whiteSpace: 'pre-line', textAlign: 'right' }}>{r.notes}</b></div>}
                  </div>
                </section>
              </POPane>
            )} />
        ) : layout === 'kanban' ? (() => {
          const now = new Date(); const m0 = now.toISOString().slice(0, 7);
          const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1); const m1 = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
          return (
            <KanbanView items={vouchersRows} getId={r => r.id} onOpen={r => setPoDetail(r.purchase_order_id)} empty="Aucune réception"
              sum={cards => pmoney(cards.reduce((a, r) => a + (Number(r.total_amount) || 0), 0))}
              lanes={[
                { key: 'm0', label: 'Ce mois-ci', tone: 'green', match: r => monthKey(r.reception_date) === m0 },
                { key: 'm1', label: 'Mois dernier', match: r => monthKey(r.reception_date) === m1 },
                { key: 'old', label: 'Plus ancien', match: r => monthKey(r.reception_date) < m1 },
              ]}
              card={r => ({ num: r.voucher_number, title: r.supplier_name ?? '—', meta: `${pdate(r.reception_date, 'd MMM')} · ${r.order_number ?? ''}`, amount: pmoney(r.total_amount) })} />
          );
        })() : (
          <DataPanel label="Bons de réception"
            footer={<TableFooter note={`${vouchersRows.length} réception${vouchersRows.length > 1 ? 's' : ''} · ${money(sum(vouchersRows))} · ${periodLabel(period, customFrom, customTo)}`} />}>
            <table className="odoo-table">
              <thead><tr>
                <th>N° réception</th>
                <th>Reçu le</th>
                <th>N° BC</th>
                <th>Fournisseur</th>
                <th className="ds-num">Lignes</th>
                <th className="ds-num">Montant reçu ({currencySymbol()})</th>
                <th>Reçu par</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{vouchersRows.map((r, i) => {
                const prev = i > 0 ? vouchersRows[i - 1] : null;
                const showMonth = !prev || monthKey(prev.reception_date) !== monthKey(r.reception_date);
                const monthRows = showMonth ? vouchersRows.filter(x => monthKey(x.reception_date) === monthKey(r.reception_date)) : [];
                return (
                  <Fragment key={r.id}>
                    {showMonth && (
                      <tr className="ds-group">
                        <td colSpan={5}>{cap(monthLabel(r.reception_date))}<small>{monthRows.length} réception{monthRows.length > 1 ? 's' : ''}</small></td>
                        <td className="ds-num">{fmt(sum(monthRows))}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    <tr onClick={() => setPoDetail(r.purchase_order_id)}
                      style={{ cursor: 'pointer' }} title="Ouvrir le bon de commande et le détail de la réception">
                      <td className="ds-ref">{r.voucher_number}</td>
                      <td>{pdate(r.reception_date)}</td>
                      <td className="ds-ref" style={{ fontWeight: 400 }}>{r.order_number ?? '—'}</td>
                      <td className="ds-strong">{r.supplier_name ?? '—'}</td>
                      <td className="ds-num">{r.item_count}</td>
                      <td className="ds-num">{fmt(r.total_amount)}</td>
                      <td>{r.received_by_name ?? '—'}</td>
                      <td className="ds-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setPoDetail(r.purchase_order_id)}>Ouvrir</button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}</tbody>
            </table>
          </DataPanel>
        )
      )}

      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} onDelivery={() => openReception(poDetail)} />}
    </>
  );
}

/** Statut d'un bon de commande en attente : retard, reliquat ou livraison attendue. */
function PendingTag({ po }: { po: PendingPO }) {
  if (po.is_late) return <StatusTag tone="late" label={`En retard de ${daysLate(po.expected_delivery_date)} j`} />;
  return po.stage === 'partial'
    ? <StatusTag tone="progress" icon={PackageSearch} label="Reliquat attendu" />
    : <StatusTag tone="todo" icon={Truck} label="En attente de livraison" />;
}
