import { useState, useMemo, useEffect, Fragment } from 'react';
import { PesageLotActions } from './PesageLotActions';
import { LotMovementModal } from './LotMovementModal';
import { TransferToPesage } from './TransferToPesage';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { StatusBanner } from '../../components/ui/StatusBanner';
import {
  StagePipeline, Pager, PAGE_SIZE, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import {
  Loader2, PackageOpen, AlertTriangle, Beaker, ChevronDown, ChevronRight, CalendarClock, Search, Trash2,
  CheckCircle2, BatteryLow, X, Archive,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';
import { fmtQty, type InventoryItem } from './types';

/**
 * Poste de pesée : contenants ouverts (ex-« stock entamé »), regroupés par ingrédient.
 * Même ergonomie que les autres listes : cartes de situation (clic = filtre),
 * « Prochaine action » par ligne, détail des lots ouverts au clic.
 *
 * Situation (exclusive, la plus urgente d'abord) :
 *   DLC dépassée → à déclarer en perte ; Vide → reste à solder ;
 *   DLC ≤ 3 j → à utiliser en premier ; Bientôt vide → moins d'un jour de
 *   consommation, ouvrir un contenant de la réserve ; OK.
 */
type Situation = 'expired' | 'empty' | 'urgent' | 'low' | 'ok';
const SITUATIONS: Array<StageDef & { key: Situation }> = [
  { key: 'expired', label: 'DLC dépassée', hint: 'à déclarer en perte', icon: Trash2 },
  { key: 'empty', label: 'Vide', hint: 'reste à solder', icon: Archive },
  { key: 'urgent', label: 'DLC ≤ 3 j', hint: 'à utiliser en premier', icon: CalendarClock },
  { key: 'low', label: 'Bientôt vide', hint: 'moins d\'un jour de pesée', icon: BatteryLow },
  { key: 'ok', label: 'OK', hint: 'rien à faire', icon: CheckCircle2 },
];
const DOT: Record<Situation, string> = { expired: '#dc3545', empty: '#adb5bd', urgent: '#d9822b', low: '#c99a06', ok: '#28a745' };
const EMPTY_EPS = 0.01;

type Row = Record<string, any>;
type Enriched = Row & {
  _qty: number; _days: number | null; _reserve: number; _avg: number; _autonomy: number | null;
  _openedDays: number | null; _situation: Situation;
};
type SortKey = 'urgency' | 'dlc' | 'name' | 'qty' | 'autonomy';

const dlcText = (days: number | null) => days === null ? null
  : days < 0 ? `dépassée de ${-days} j` : days === 0 ? 'aujourd\'hui' : `dans ${days} j`;
const dlcColor = (days: number | null) => days === null ? 'var(--theme-text-muted)'
  : days < 0 ? '#dc3545' : days <= 3 ? '#d9822b' : days <= 7 ? '#b38600' : 'var(--theme-text-muted)';

export function PesageStockList({ rows, isLoading, inventory = [], canOpen = false }: {
  rows: Row[];
  isLoading: boolean;
  /** Inventaire (réserve + consommation moyenne) pour l'autonomie et le réapprovisionnement. */
  inventory?: InventoryItem[];
  /** Magasinier / admin / gérant : peut ouvrir un contenant de la réserve. */
  canOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [situation, setSituation] = useState<Situation | ''>('');
  const [sortBy, setSortBy] = useState<SortKey>('urgency');
  const [page, setPage] = useState(1);
  const [openFor, setOpenFor] = useState<{ ingredientId: string | null } | null>(null);
  const [lotAction, setLotAction] = useState<{ row: Row; lot: Row; type: 'waste' | 'return' } | null>(null);

  const invById = useMemo(() => new Map(inventory.map(i => [i.ingredient_id, i])), [inventory]);

  const enriched: Enriched[] = useMemo(() => rows.map(r => {
    const qty = parseFloat(r.total_pesage as string || '0') || 0;
    const dlc = r.nearest_dlc_effective ? new Date(r.nearest_dlc_effective as string) : null;
    const days = dlc ? differenceInDays(dlc, new Date()) : null;
    const inv = invById.get(r.ingredient_id as string);
    const reserve = parseFloat(inv?.economat_quantity || '0') || 0;
    const avg = parseFloat(inv?.avg_daily_consumption || '0') || 0;
    const lots = (r.lots as Row[]) || [];
    const firstOpened = lots.map(l => l.first_opened_at).filter(Boolean).map(d => new Date(d as string).getTime()).sort()[0];
    const openedDays = firstOpened ? differenceInDays(new Date(), new Date(firstOpened)) : null;
    const situation: Situation =
      r.has_expired_lot || (days !== null && days < 0) ? 'expired'
      : qty <= EMPTY_EPS ? 'empty'
      : days !== null && days <= 3 ? 'urgent'
      : avg > 0 && qty < avg ? 'low'
      : 'ok';
    return { ...r, _qty: qty, _days: days, _reserve: reserve, _avg: avg, _autonomy: avg > 0 ? qty / avg : null, _openedDays: openedDays, _situation: situation };
  }), [rows, invById]);

  const counts = useMemo(() => {
    const c: Record<Situation, number> = { expired: 0, empty: 0, urgent: 0, low: 0, ok: 0 };
    for (const r of enriched) c[r._situation]++;
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rank = (s: Situation) => SITUATIONS.findIndex(x => x.key === s);
    return enriched
      .filter(r => (!q || String(r.ingredient_name || '').toLowerCase().includes(q)) && (!situation || r._situation === situation))
      .sort((a, b) => {
        switch (sortBy) {
          case 'name': return String(a.ingredient_name).localeCompare(String(b.ingredient_name), 'fr');
          case 'qty': return b._qty - a._qty;
          case 'autonomy': return (a._autonomy ?? Infinity) - (b._autonomy ?? Infinity);
          case 'dlc': return (a._days ?? Infinity) - (b._days ?? Infinity);
          default: return rank(a._situation) - rank(b._situation) || (a._days ?? Infinity) - (b._days ?? Infinity);
        }
      });
  }, [enriched, search, situation, sortBy]);
  useEffect(() => { setPage(1); }, [search, situation, sortBy]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** Prochaine action selon la situation. */
  const nextAction = (r: Enriched): { label: string; run: () => void; cls: string; title: string } | null => {
    const lots = (r.lots as Row[]) || [];
    if (r._situation === 'expired') {
      const lot = lots.find(l => l.is_expired || (l.expiration_date && new Date(l.expiration_date as string) < new Date())) ?? lots[0];
      return lot ? { label: 'Déclarer la perte', run: () => setLotAction({ row: r, lot, type: 'waste' }), cls: 'odoo-btn-danger', title: 'Sortir du stock le lot périmé' } : null;
    }
    if (r._situation === 'empty' && lots[0]) {
      return { label: 'Solder le reste', run: () => setLotAction({ row: r, lot: lots[0], type: 'waste' }), cls: 'odoo-btn-secondary', title: 'Contenant vide : solder le fond restant' };
    }
    if (r._situation === 'low' && canOpen && r._reserve > 0) {
      return { label: 'Ouvrir un contenant', run: () => setOpenFor({ ingredientId: r.ingredient_id as string }), cls: 'odoo-btn-primary', title: 'Passer un contenant de la réserve au poste de pesée' };
    }
    return null;
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <Loader2 size={28} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
      </div>
    );
  }

  const unit = (r: Row) => (r.ingredient_unit as string) || '';
  const totalToHandle = counts.expired + counts.empty + counts.urgent + counts.low;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0 1rem' }}>
      <StagePipeline
        title="Poste de pesée · contenants ouverts"
        summary={`${rows.length} ingrédient${rows.length > 1 ? 's' : ''} ouvert${rows.length > 1 ? 's' : ''} · ${totalToHandle} à traiter`}
        stages={SITUATIONS}
        stats={Object.fromEntries(SITUATIONS.map(s => [s.key, { count: counts[s.key], sub: '' }]))}
        isActive={k => situation === k}
        onPick={k => setSituation(situation === k ? '' : (k as Situation))}
      />

      {counts.expired > 0 && situation !== 'expired' && (
        <StatusBanner tone="danger" icon={AlertTriangle}
          title={`${counts.expired} ingrédient${counts.expired > 1 ? 's' : ''} avec un lot périmé au poste de pesée`}
          actions={<button type="button" className="odoo-btn-secondary" onClick={() => setSituation('expired')}>Les afficher</button>}>
          Un lot périmé n'est plus servi aux bons de sortie : déclarez la perte pour le sortir du stock.
        </StatusBanner>
      )}

      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8, margin: 0 }}>
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un ingrédient"
          placeholder="Rechercher un ingrédient..." className="odoo-search-input" style={{ flex: '1 1 220px', minWidth: 0 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
          Trier
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className="odoo-filter-dropdown">
            <option value="urgency">par urgence</option>
            <option value="dlc">par DLC</option>
            <option value="autonomy">par autonomie</option>
            <option value="qty">par quantité</option>
            <option value="name">par nom</option>
          </select>
        </label>
        {(search || situation) && (
          <button type="button" className="odoo-btn-secondary" onClick={() => { setSearch(''); setSituation(''); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
        {canOpen && (
          <button type="button" className="odoo-btn-primary" onClick={() => setOpenFor({ ingredientId: null })}
            title="Préparer le poste de pesée à l'avance (le matin, avant une grosse production)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <PackageOpen size={13} /> Ouvrir un contenant
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Beaker size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun contenant ouvert au poste de pesée.</p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>Ils s'ouvrent au moment de la pesée d'un bon, ou à l'avance avec « Ouvrir un contenant ».</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucun ingrédient ne correspond aux filtres.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Ingrédient</th>
                <th style={{ textAlign: 'right' }}>Au pesage</th>
                <th style={{ textAlign: 'right' }}>Autonomie</th>
                <th>Contenants ouverts</th>
                <th>DLC la plus proche</th>
                <th style={{ textAlign: 'right' }}>En réserve</th>
                <th style={{ textAlign: 'right' }}>Prochaine action</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {paged.map(r => {
                const id = r.ingredient_id as string;
                const isOpen = expanded === id;
                const lots = (r.lots as Row[]) || [];
                const action = nextAction(r);
                return (
                  <Fragment key={id}>
                    <tr onClick={() => setExpanded(isOpen ? null : id)} style={{ cursor: 'pointer' }} aria-expanded={isOpen}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{r.ingredient_name as string}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.6875rem', color: 'var(--theme-text-muted)', marginTop: 1 }}>
                          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: DOT[r._situation] }} />
                          {SITUATIONS.find(s => s.key === r._situation)?.label}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: r._situation === 'empty' ? 'var(--theme-text-muted)' : 'var(--odoo-text)' }}>{fmtQty(r._qty)}</span>
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 3 }}>{unit(r)}</span>
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.8125rem' }}>
                        {r._autonomy === null ? <span style={{ color: 'var(--theme-text-muted)' }}>—</span> : (
                          <span style={{ color: r._autonomy < 1 ? '#b38600' : 'var(--theme-text-muted)', fontWeight: r._autonomy < 1 ? 600 : 400 }}
                            title={`Consommation moyenne : ${fmtQty(r._avg)} ${unit(r)} / jour`}>
                            {r._autonomy < 1 ? '< 1 jour' : `${Math.floor(r._autonomy)} j`}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                        {lots.length} contenant{lots.length > 1 ? 's' : ''}
                        {r._openedDays !== null && <span> · ouvert {r._openedDays === 0 ? 'aujourd\'hui' : `depuis ${r._openedDays} j`}</span>}
                      </td>
                      <td style={{ fontSize: '0.8125rem' }}>
                        {r.nearest_dlc_effective ? (
                          <>
                            <span style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(r.nearest_dlc_effective as string), 'dd MMM', { locale: fr })}</span>
                            <span style={{ color: dlcColor(r._days), fontWeight: r._days !== null && r._days <= 3 ? 600 : 400, marginLeft: 6 }}>{dlcText(r._days)}</span>
                          </>
                        ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                        {r._reserve > 0 ? <>{fmtQty(r._reserve)} {unit(r)}</> : <span title="Plus rien en réserve : à commander">épuisée</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {action && <button type="button" className={action.cls} onClick={action.run} title={action.title}>{action.label}</button>}
                      </td>
                      <td style={{ color: 'var(--theme-text-muted)' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    </tr>

                    {isOpen && lots.length > 0 && (
                      <tr className="odoo-subrow">
                        <td colSpan={8} style={{ padding: '0 0 0 1.5rem', background: 'var(--odoo-bg-alt)' }}>
                          <table className="odoo-table" style={{ margin: 0, boxShadow: 'none', background: 'transparent' }}>
                            <thead>
                              <tr>
                                <th>Lot</th>
                                <th>Fournisseur</th>
                                <th>Ouvert le</th>
                                <th>DLC</th>
                                <th style={{ textAlign: 'right' }}>Au pesage</th>
                                <th style={{ textAlign: 'right' }}>En réserve</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {lots.map((lot, i) => {
                                const pq = parseFloat(lot.pesage_quantity as string || '0');
                                const eq = parseFloat(lot.economat_quantity as string || '0');
                                const lotDlc = lot.expiration_date as string | null;
                                const lotDays = lotDlc ? differenceInDays(new Date(lotDlc), new Date()) : null;
                                const lotName = (lot.supplier_lot_number || lot.lot_number || '—') as string;
                                return (
                                  <tr key={(lot.lot_id as string) ?? i}>
                                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{lotName}</td>
                                    <td style={{ color: 'var(--theme-text-muted)' }}>{(lot.supplier_name as string) || '—'}</td>
                                    <td style={{ color: 'var(--theme-text-muted)' }}>{lot.first_opened_at ? format(new Date(lot.first_opened_at as string), 'dd/MM/yyyy') : '—'}</td>
                                    <td style={{ fontSize: '0.8125rem' }}>
                                      {lotDlc ? (
                                        <>
                                          <span style={{ color: 'var(--theme-text-muted)' }}>{format(new Date(lotDlc), 'dd/MM')}</span>
                                          <span style={{ color: dlcColor(lotDays), marginLeft: 6, fontWeight: lotDays !== null && lotDays <= 3 ? 600 : 400 }}>{dlcText(lotDays)}</span>
                                        </>
                                      ) : <span style={{ color: 'var(--theme-text-muted)' }}>—</span>}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtQty(pq)} <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>{unit(r)}</span></td>
                                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}>{eq > 0 ? `${fmtQty(eq)} ${unit(r)}` : '—'}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <PesageLotActions lotId={lot.lot_id as string} lotNumber={lotName} ingredientName={r.ingredient_name as string}
                                        pesageQuantity={pq} economatQuantity={eq} unit={unit(r)}
                                        isExpired={!!lot.is_expired || (lotDays !== null && lotDays < 0)} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} total={filtered.length} onPage={setPage}
            note={`${filtered.length} ingrédient${filtered.length > 1 ? 's' : ''} au poste de pesée · cliquez une ligne pour voir ses contenants`} />
        </div>
      )}

      {/* Ouvrir un contenant de la réserve (à l'avance, ou pour recharger un ingrédient bientôt vide) */}
      {openFor && (
        <ModalBackdrop onClose={() => setOpenFor(null)} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" role="dialog" aria-label="Ouvrir un contenant" onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <PackageOpen size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Poste de pesée</span>
                <span className="odoo-breadcrumb-separator">/</span>
                <span className="odoo-breadcrumb-current">Ouvrir un contenant de la réserve</span>
              </div>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => setOpenFor(null)} className="odoo-pager-btn" aria-label="Fermer"><X size={14} /></button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <TransferToPesage initialIngredientId={openFor.ingredientId} onDone={() => setOpenFor(null)} />
            </div>
          </div>
        </ModalBackdrop>
      )}

      {lotAction && (
        <LotMovementModal
          lot={{
            id: lotAction.lot.lot_id as string,
            lot_number: (lotAction.lot.supplier_lot_number || lotAction.lot.lot_number) as string | null,
            ingredient_name: lotAction.row.ingredient_name as string,
            unit: unit(lotAction.row),
            economat_quantity: parseFloat(lotAction.lot.economat_quantity as string || '0') || 0,
            pesage_quantity: parseFloat(lotAction.lot.pesage_quantity as string || '0') || 0,
            is_expired: lotAction.row._situation === 'expired',
          }}
          initialType={lotAction.type}
          onClose={() => setLotAction(null)}
        />
      )}
    </div>
  );
}
