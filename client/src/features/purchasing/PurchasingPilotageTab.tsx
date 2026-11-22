import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageCheck, FileWarning, Hourglass, FileX, Download, AlertTriangle, Clock, X } from 'lucide-react';
import { purchasingReportsApi, type PilotageKind } from '../../api/purchasing-reports.api';
import { suppliersApi } from '../../api/accounting.api';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { PODetailModal } from '../accounting/PurchaseOrdersTab';
import { useOpenReception } from './purchasingNav';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';
import { KpiGrid, KpiCard, SectionHeader, Toolbar, SearchBar, DataPanel, TableFooter, EmptyState, NoResultState, LoadingState, Alert, ErrorState } from '../../components/ds';
import { pdate } from './PurLayouts';
import { money, currencySymbol } from '../../utils/money';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number | string) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const date = (v: string | null | undefined) => (v ? pdate(v) : '—');

/**
 * Les 4 contrôles du rapprochement, dans l'ordre du flux commande → réception → facture.
 * « Factures sans lignes » est hors flux : ces factures échappent au rapprochement.
 */
const PIL_STAGES: Array<StageDef & { key: PilotageKind }> = [
  { key: 'commitments', label: 'Commandé, non reçu', hint: 'engagements ouverts', icon: Hourglass },
  { key: 'rni', label: 'Reçu, non facturé', hint: 'factures attendues', icon: PackageCheck },
  { key: 'inr', label: 'Facturé, non reçu', hint: 'à vérifier avant paiement', icon: FileWarning },
  { key: 'nolines', label: 'Factures sans lignes', hint: 'hors rapprochement', icon: FileX },
];
const DATE_LABEL: Record<PilotageKind, { label: string; title: string }> = {
  commitments: { label: 'Commandé', title: 'Filtre sur la date de commande' },
  rni: { label: 'Reçu', title: 'Filtre sur la date de dernière réception' },
  inr: { label: 'Facturé', title: 'Filtre sur la date de facture' },
  nolines: { label: 'Facturé', title: 'Filtre sur la date de facture' },
};
const AGES = [
  { key: '7', label: 'plus de 7 jours' },
  { key: '30', label: 'plus de 30 jours' },
  { key: '60', label: 'plus de 60 jours' },
  { key: '90', label: 'plus de 90 jours' },
];
const PAYMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'Non réglée', tone: 'todo' }, partial: { label: 'Partielle', tone: 'progress' },
  paid: { label: 'Réglée', tone: 'done' }, overdue: { label: 'En retard', tone: 'late' },
  disputed: { label: 'En litige', tone: 'blocked' }, cancelled: { label: 'Annulée', tone: 'cancelled' },
};
const PO_STATUS: Record<string, string> = { en_attente: 'Brouillon', envoye: 'Envoyé', livre_partiel: 'Partiel' };

/** Colonnes du détail (le fournisseur est en intertitre, pas en colonne). La dernière porte le montant ; `money` = unité dans l'en-tête. */
const COLUMNS: Record<PilotageKind, Array<{ label: string; right?: boolean; money?: boolean }>> = {
  commitments: [{ label: 'BC' }, { label: 'Commandé le' }, { label: 'Livraison prévue' }, { label: 'Lignes ouvertes', right: true }, { label: 'Reste à recevoir HT', right: true, money: true }],
  rni: [{ label: 'Article' }, { label: 'BC' }, { label: 'Quantité', right: true }, { label: 'Prix commandé', right: true, money: true }, { label: 'Reçu le' }, { label: 'Montant HT', right: true, money: true }],
  inr: [{ label: 'Article' }, { label: 'BC' }, { label: 'Reçu', right: true }, { label: 'Facturé', right: true }, { label: 'Montant en trop', right: true, money: true }],
  nolines: [{ label: 'Facture' }, { label: 'Date' }, { label: 'Règlement' }, { label: 'Montant TTC', right: true, money: true }],
};
/** Ce que mesure chaque contrôle (note de la section). */
const KIND_NOTE: Record<PilotageKind, string> = {
  commitments: 'Ce qui reste à recevoir sur les bons envoyés : vos engagements à payer. Une livraison prévue dépassée apparaît en rouge.',
  rni: 'Marchandise reçue, facture attendue. Au prix commandé : dette à provisionner à la clôture.',
  inr: 'Facturé au-delà de ce qui a été reçu, à vérifier avant paiement.',
  nolines: 'Factures saisies sans lignes : complétez-les pour qu\'elles entrent dans le rapprochement ligne par ligne.',
};
const muted: React.CSSProperties = { color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 };

/** Ancienneté : discrète sous 30 j, orange au-delà, rouge au-delà de 90 j. */
function AgeTag({ days }: { days: number }) {
  const color = days > 90 ? 'var(--ds-danger)' : days > 30 ? 'var(--ds-warning)' : 'var(--ds-muted)';
  return <span style={{ marginLeft: 8, fontSize: 12, fontWeight: days > 30 ? 600 : 400, color }}>{days} j</span>;
}

/** N° de document cliquable (ouvre le BC ou la facture) : remplace un bouton par ligne. */
function DocLink({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="ds-ref" onClick={onClick} title={title ?? 'Ouvrir le document'}
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ds-accent-ink)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
      {label}
    </button>
  );
}

function TotalRow({ label, amount, span, trailing }: { label: string; amount: number; span: number; trailing?: boolean }) {
  return (
    <tfoot>
      <tr>
        <td colSpan={span}>Total du filtre · {label}</td>
        <td className="ds-num">{fmt(amount)}</td>
        {trailing && <td />}
      </tr>
    </tfoot>
  );
}

/**
 * Pilotage des achats (mig 312, D9 G-D9-03) : ce qui est commandé et pas reçu, reçu et pas
 * facturé, facturé sans réception — mesuré par LIGNE de BC, au prix du BC — et les factures
 * qui échappent au rapprochement. Même chiffre que la carte du tableau de bord.
 */
export default function PurchasingPilotageTab({ onOpenInvoice }: {
  /** Ouvre l'onglet Factures reçues sur une facture (recherche + vue). Le circuit d'achat est sur le Poste de travail. */
  onOpenInvoice?: (f: { supplierId?: string; search?: string; view?: 'open' | 'history' }) => void;
}) {
  const [kind, setKind] = useState<PilotageKind>('rni');
  const [group, setGroup] = useState<'detail' | 'supplier'>('detail');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [minAge, setMinAge] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [poDetail, setPoDetail] = useState<string | null>(null);
  const openReception = useOpenReception();

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [kind, group, searchTerm, supplierFilter, minAge, period, customFrom, customTo]);

  const params = useMemo(() => {
    const p: Record<string, string> = { kind, group, page: String(page), pageSize: String(PAGE_SIZE) };
    if (searchTerm) p.search = searchTerm;
    if (supplierFilter) p.supplierId = supplierFilter;
    if (minAge && kind !== 'inr') p.minAgeDays = minAge;
    return { ...p, ...periodParams(period, customFrom, customTo) };
  }, [kind, group, page, searchTerm, supplierFilter, minAge, period, customFrom, customTo]);

  const { data: s } = useQuery({ queryKey: ['purch-reports-summary'], queryFn: () => purchasingReportsApi.summary() });
  const { data: board, isLoading, isFetching, error: boardError, refetch: refetchBoard } = useQuery({
    queryKey: ['purch-board', params],
    queryFn: () => purchasingReportsApi.board(params),
    // On ne garde l'ancienne page affichée pendant le chargement que si sa forme est la même
    // (même liste, même présentation) : sinon des lignes « détail » s'afficheraient en colonnes « fournisseur ».
    placeholderData: (prev, prevQuery) => {
      const prevParams = prevQuery?.queryKey[1] as Record<string, string> | undefined;
      return prevParams?.kind === kind && prevParams?.group === group ? prev : undefined;
    },
  });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const supplierOptions = useMemo(
    () => (suppliers as Record<string, any>[])
      .map(x => ({ id: x.id as string, label: x.name as string }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers],
  );

  const rows = board?.rows ?? [];
  const total = board?.total ?? 0;
  const hasFilters = !!(searchTerm || supplierFilter || minAge || period !== 'all');
  const resetFilters = () => {
    setSearchInput(''); setSearchTerm(''); setSupplierFilter(''); setMinAge('');
    setPeriod('all'); setCustomFrom(''); setCustomTo('');
  };
  const pickKind = (k: string) => { setKind(k as PilotageKind); if (k === 'inr') setMinAge(''); };
  const drillSupplier = (supplierId: string) => { setSupplierFilter(supplierId); setGroup('detail'); };

  const stats = s ? {
    commitments: { count: s.open_commitments.pos, sub: `${money(s.open_commitments.amount)}` },
    rni: { count: s.received_not_invoiced.lines, sub: `${money(s.received_not_invoiced.amount)}`, late: s.received_not_invoiced.aged, alertLabel: '> 30 j' },
    inr: { count: s.invoiced_not_received.lines, sub: `${money(s.invoiced_not_received.amount)}`, late: s.invoiced_not_received.lines, alertLabel: 'à vérifier' },
    nolines: { count: s.invoices_without_lines.count, sub: `${money(s.invoices_without_lines.amount)}` },
  } : {};
  const unit = kind === 'commitments' ? 'BC' : kind === 'nolines' ? 'facture' : 'ligne';
  const plural = (k: number, w: string) => `${k} ${w}${k > 1 ? 's' : ''}`;

  const openInvoice = (r: Record<string, any>) => onOpenInvoice?.({
    supplierId: r.supplier_id, search: r.invoice_number,
    view: r.invoice_status === 'paid' || r.invoice_status === 'cancelled' ? 'history' : 'open',
  });

  const cur = currencySymbol();
  const footNote = `${PIL_STAGES.find(x => x.key === kind)?.label}${period !== 'all' ? ` · ${DATE_LABEL[kind].label.toLowerCase()} ${periodLabel(period, customFrom, customTo)}` : ''}`;

  return (
    <>
      {/* Montants des 4 contrôles (au prix du BC) ; les pastilles dessous choisissent la liste affichée. */}
      {s && (
        <KpiGrid>
          <KpiCard label="Commandé, non reçu" value={money(s.open_commitments.amount)} sub={plural(s.open_commitments.pos, 'BC envoyé')} />
          <KpiCard label="Reçu, non facturé" value={money(s.received_not_invoiced.amount)} sub={`${plural(s.received_not_invoiced.lines, 'ligne')} · ${s.received_not_invoiced.aged} > 30 j`}
            tone={s.received_not_invoiced.aged ? 'orange' : undefined} />
          <KpiCard label="Facturé, non reçu" value={money(s.invoiced_not_received.amount)} sub={plural(s.invoiced_not_received.lines, 'ligne') + ' à vérifier'}
            tone={s.invoiced_not_received.lines ? 'red' : undefined} />
          <KpiCard label="Factures sans lignes" value={money(s.invoices_without_lines.amount)} sub={plural(s.invoices_without_lines.count, 'facture') + ' hors contrôle'} />
        </KpiGrid>
      )}

      {/* Les 4 contrôles du rapprochement : une pastille par liste, clic = afficher */}
      <StagePipeline
        title="Rapprochement commande → réception → facture"
        summary="Mesuré par ligne de BC, au prix du BC"
        stages={PIL_STAGES}
        stats={stats}
        isActive={k => kind === k}
        onPick={pickKind}
      />

      <SectionHeader title={PIL_STAGES.find(x => x.key === kind)?.label} note={KIND_NOTE[kind]}>
        {kind === 'rni' && (
          <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={!total}
            onClick={() => purchasingReportsApi.exportReceivedNotInvoiced().catch(() => notify.error('Export impossible'))}>
            <Download size={13} aria-hidden="true" /> Exporter
          </button>
        )}
      </SectionHeader>
      {kind === 'rni' && (s?.received_not_invoiced.price_missing ?? 0) > 0 && (
        <Alert tone="warning" icon={AlertTriangle}>{s!.received_not_invoiced.price_missing} ligne(s) sans prix commandé sont comptées à 0.</Alert>
      )}
      {kind === 'inr' && !!s?.invoiced_not_received.lines && (
        <Alert tone="danger" icon={FileWarning}>Facturé au-delà de ce qui a été reçu : ne payez pas avant d'avoir vérifié la livraison.</Alert>
      )}

      {/* Barre d'outils unique : recherche, filtres, présentation Détail / Par fournisseur */}
      <Toolbar>
        <SearchBar value={searchInput} onChange={setSearchInput} label="Rechercher dans le rapprochement" busy={isFetching && !isLoading}
          placeholder={kind === 'nolines' ? 'Fournisseur ou N° de facture…' : 'Fournisseur, BC ou article…'} />
        {kind !== 'inr' && (
          <SelectFilter label="Ancienneté" icon={Clock} value={minAge} onChange={setMinAge} options={AGES} allLabel="Toutes" />
        )}
        <PeriodFilter label={DATE_LABEL[kind].label} title={DATE_LABEL[kind].title}
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <div style={{ minWidth: 190 }}><SearchSelect options={supplierOptions} value={supplierFilter} onChange={setSupplierFilter} placeholder="Tous les fournisseurs" ariaLabel="Filtrer par fournisseur" /></div>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="ds-btn-ghost ds-btn-sm"><X size={13} aria-hidden="true" /> Effacer</button>
        )}
        <ViewSwitch ariaLabel="Présentation" view={group === 'detail' ? 'open' : 'history'}
          onChange={v => setGroup(v === 'open' ? 'detail' : 'supplier')}
          openLabel="Détail" historyLabel="Par fournisseur" />
      </Toolbar>

      {isLoading ? <LoadingState /> : boardError || !board ? <ErrorState error={boardError} onRetry={() => { void refetchBoard(); }} /> : rows.length === 0 ? (
        hasFilters
          ? <NoResultState onReset={resetFilters} text="Aucune ligne ne correspond aux filtres." />
          : <EmptyState icon={PackageCheck} title="Rien à signaler dans cette liste"
              text={kind === 'inr' ? 'Aucune facture ne dépasse ce qui a été reçu.' : 'Commandes, réceptions et factures concordent pour ce contrôle.'} />
      ) : (
        <div style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          <DataPanel label={PIL_STAGES.find(x => x.key === kind)?.label}
            footer={<TableFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} note={footNote} />}>
          {group === 'supplier' ? (
            /* ── Par fournisseur : une ligne cliquable par fournisseur, triée par montant ── */
            <table className="odoo-table">
              <thead><tr>
                <th>Fournisseur</th>
                <th className="ds-num">{kind === 'nolines' ? 'Factures' : kind === 'commitments' ? 'BC' : 'Lignes'}</th>
                <th>Plus ancien</th>
                <th className="ds-num">Montant ({cur})</th>
                <th className="ds-actions"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{rows.map(r => {
                const age = Number(r.max_age);
                return (
                  <tr key={r.supplier_id ?? 'none'} onClick={() => r.supplier_id && drillSupplier(r.supplier_id)}
                    style={{ cursor: r.supplier_id ? 'pointer' : 'default' }} title="Voir le détail de ce fournisseur">
                    <td className="ds-strong">{r.supplier_name ?? '—'}</td>
                    <td className="ds-num">
                      {r.lines}
                      {(kind === 'rni' || kind === 'inr') && <span style={muted}> · {plural(r.docs, 'BC')}</span>}
                    </td>
                    <td>
                      {date(r.oldest_date)}
                      {r.max_age != null && <AgeTag days={age} />}
                    </td>
                    <td className="ds-num ds-strong">{fmt(r.doc_amount)}</td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {r.supplier_id && <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => drillSupplier(r.supplier_id)}>Détail</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
              <TotalRow label={plural(total, 'fournisseur')} amount={board.sumAmount} span={3} trailing />
            </table>
          ) : (
            /* ── Détail : regroupé par fournisseur (intertitre + sous-total de la page) ── */
            <table className="odoo-table">
              <thead><tr>{COLUMNS[kind].map(c => <th key={c.label} className={c.right ? 'ds-num' : undefined}>{c.label}{c.money ? ` (${cur})` : ''}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => {
                const firstOfGroup = i === 0 || rows[i - 1].supplier_id !== r.supplier_id;
                const groupRows = firstOfGroup ? rows.filter(x => x.supplier_id === r.supplier_id) : [];
                return (
                  <Fragment key={r.po_item_id ?? r.invoice_id ?? r.po_id}>
                    {firstOfGroup && (
                      <tr className="ds-group">
                        <td colSpan={COLUMNS[kind].length - 1}>
                          {r.supplier_name ?? '—'}
                          <small>{plural(groupRows.length, unit)}</small>
                        </td>
                        <td className="ds-num">{fmt(groupRows.reduce((a, x) => a + (parseFloat(x.doc_amount) || 0), 0))}</td>
                      </tr>
                    )}
                    {kind === 'commitments' && (
                      <tr>
                        <td>
                          <DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} />
                          <span style={{ ...muted, marginLeft: 8 }}>{PO_STATUS[r.po_status] ?? r.po_status}</span>
                        </td>
                        <td>{date(r.order_date)}</td>
                        <td style={{ color: r.is_late ? 'var(--ds-danger)' : undefined, fontWeight: r.is_late ? 600 : 400 }}>
                          {date(r.expected_delivery_date)}{r.is_late && ' · en retard'}
                        </td>
                        <td className="ds-num">{r.open_lines}</td>
                        <td className="ds-num">
                          {r.price_missing && (
                            <span style={{ color: 'var(--ds-warning)', fontSize: 12, marginRight: 6 }} title="Au moins une ligne sans prix : montant sous-évalué">
                              <AlertTriangle size={11} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> prix manquant
                            </span>
                          )}
                          {fmt(r.doc_amount)}
                        </td>
                      </tr>
                    )}
                    {kind === 'rni' && (
                      <tr>
                        <td className="ds-strong">
                          {r.item_name ?? '—'}
                          {r.price_overwritten && <span style={{ color: 'var(--ds-warning)', fontSize: 12, fontWeight: 400, marginLeft: 6 }} title="Prix saisi à la réception différent du prix BC">prix modifié</span>}
                        </td>
                        <td><DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} /></td>
                        <td className="ds-num">{qty(r.qty)} <span style={muted}>{r.unit ?? ''}</span></td>
                        <td className="ds-num">
                          {r.price_missing ? <span style={{ color: 'var(--ds-danger)', fontWeight: 600, fontSize: 12 }}>à définir</span> : fmt(r.price_po)}
                        </td>
                        <td>
                          {date(r.last_received_at)}
                          {r.age_days != null && <AgeTag days={Number(r.age_days)} />}
                        </td>
                        <td className="ds-num">{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                    {kind === 'inr' && (
                      <tr>
                        <td className="ds-strong">{r.item_name ?? '—'}</td>
                        <td><DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} /></td>
                        <td className="ds-num">{qty(r.qty_received)} <span style={muted}>{r.unit ?? ''}</span></td>
                        <td className="ds-num" style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>{qty(r.qty_invoiced)} {r.unit ?? ''}</td>
                        <td className="ds-num" style={{ color: 'var(--ds-danger)', fontWeight: 600 }}>{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                    {kind === 'nolines' && (
                      <tr>
                        <td>
                          {onOpenInvoice
                            ? <DocLink label={r.invoice_number} onClick={() => openInvoice(r)} title="Ouvrir la facture pour compléter ses lignes" />
                            : <span className="ds-ref">{r.invoice_number}</span>}
                          {r.supplier_invoice_number && r.supplier_invoice_number !== r.invoice_number && (
                            <span style={{ ...muted, marginLeft: 8 }}>n° fourn. {r.supplier_invoice_number}</span>
                          )}
                        </td>
                        <td>{date(r.invoice_date)}</td>
                        <td>
                          {PAYMENT_STATUS[r.invoice_status as string]
                            ? <StatusTag tone={PAYMENT_STATUS[r.invoice_status as string].tone} label={PAYMENT_STATUS[r.invoice_status as string].label} />
                            : '—'}
                        </td>
                        <td className="ds-num">{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}</tbody>
              <TotalRow label={plural(total, unit)} amount={board.sumAmount} span={COLUMNS[kind].length - 1} />
            </table>
          )}
          </DataPanel>
        </div>
      )}

      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} onDelivery={() => openReception(poDetail)} />}
    </>
  );
}
