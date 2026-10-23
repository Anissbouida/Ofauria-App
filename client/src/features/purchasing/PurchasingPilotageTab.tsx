import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PackageCheck, FileWarning, Hourglass, FileX, Download, AlertTriangle, Search, Clock, X, ChevronRight } from 'lucide-react';
import { purchasingReportsApi, type PilotageKind } from '../../api/purchasing-reports.api';
import { suppliersApi } from '../../api/accounting.api';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import SearchSelect from '../../components/ui/SearchSelect';
import { PODetailModal } from '../accounting/PurchaseOrdersTab';
import {
  StagePipeline, ViewSwitch, PeriodFilter, SelectFilter, Pager,
  PAGE_SIZE, periodParams, periodLabel, type PeriodKey, type StageDef,
} from '../../components/purchasing/ProcessBoard';

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number | string) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const date = (v: string | null | undefined) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

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
const PAYMENT_STATUS: Record<string, { label: string; tag: string }> = {
  pending: { label: 'Non réglée', tag: 'odoo-tag-yellow' }, partial: { label: 'Partielle', tag: 'odoo-tag-blue' },
  paid: { label: 'Réglée', tag: 'odoo-tag-green' }, overdue: { label: 'En retard', tag: 'odoo-tag-red' },
  disputed: { label: 'En litige', tag: 'odoo-tag-orange' }, cancelled: { label: 'Annulée', tag: 'odoo-tag-grey' },
};
const PO_STATUS: Record<string, string> = { en_attente: 'Brouillon', envoye: 'Envoyé', livre_partiel: 'Partiel' };

/** Colonnes du détail (le fournisseur est en intertitre, pas en colonne). La dernière porte le montant. */
const COLUMNS: Record<PilotageKind, Array<{ label: string; right?: boolean }>> = {
  commitments: [{ label: 'BC' }, { label: 'Commandé le' }, { label: 'Livraison prévue' }, { label: 'Lignes ouvertes', right: true }, { label: 'Reste à recevoir HT', right: true }],
  rni: [{ label: 'Article' }, { label: 'BC' }, { label: 'Quantité', right: true }, { label: 'Prix BC', right: true }, { label: 'Reçu le' }, { label: 'Montant HT', right: true }],
  inr: [{ label: 'Article' }, { label: 'BC' }, { label: 'Reçu', right: true }, { label: 'Facturé', right: true }, { label: 'Montant en trop', right: true }],
  nolines: [{ label: 'Facture' }, { label: 'Date' }, { label: 'Règlement' }, { label: 'TTC', right: true }],
};

const Dh = () => <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', fontWeight: 400 }}>DH</span>;

/** Ancienneté : discrète sous 30 j, orange au-delà, rouge au-delà de 90 j. */
function AgeTag({ days }: { days: number }) {
  const color = days > 90 ? '#dc3545' : days > 30 ? '#b85d1a' : 'var(--theme-text-muted)';
  return <span style={{ marginLeft: 8, fontSize: '0.75rem', fontWeight: days > 30 ? 600 : 400, color }}>{days} j</span>;
}

/** N° de document cliquable (ouvre le BC ou la facture) : remplace un bouton par ligne. */
function DocLink({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title ?? 'Ouvrir le document'}
      style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: 'var(--odoo-purple)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
      {label}
    </button>
  );
}

function TotalRow({ label, amount, span }: { label: string; amount: number; span: number }) {
  return (
    <tfoot>
      <tr style={{ fontWeight: 700, borderTop: '2px solid var(--theme-bg-separator)' }}>
        <td colSpan={span} style={{ color: 'var(--theme-text-muted)' }}>Total du filtre — {label}</td>
        <td style={{ textAlign: 'right' }}>{fmt(amount)} <Dh /></td>
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
  /** Ouvre l'onglet Factures reçues sur une facture (recherche + vue). */
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
  const { data: board, isLoading, isFetching } = useQuery({
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
    commitments: { count: s.open_commitments.pos, sub: `${fmt(s.open_commitments.amount)} DH` },
    rni: { count: s.received_not_invoiced.lines, sub: `${fmt(s.received_not_invoiced.amount)} DH`, late: s.received_not_invoiced.aged, alertLabel: '> 30 j' },
    inr: { count: s.invoiced_not_received.lines, sub: `${fmt(s.invoiced_not_received.amount)} DH`, late: s.invoiced_not_received.lines, alertLabel: 'à vérifier' },
    nolines: { count: s.invoices_without_lines.count, sub: `${fmt(s.invoices_without_lines.amount)} DH` },
  } : {};
  const unit = kind === 'commitments' ? 'BC' : kind === 'nolines' ? 'facture' : 'ligne';
  const plural = (k: number, w: string) => `${k} ${w}${k > 1 ? 's' : ''}`;

  const openInvoice = (r: Record<string, any>) => onOpenInvoice?.({
    supplierId: r.supplier_id, search: r.invoice_number,
    view: r.invoice_status === 'paid' || r.invoice_status === 'cancelled' ? 'history' : 'open',
  });

  return (
    <>
      {/* Les 4 contrôles du rapprochement : une carte par liste, clic = afficher */}
      <StagePipeline
        title="Rapprochement commande → réception → facture"
        summary="Mesuré par ligne de BC, au prix du BC"
        stages={PIL_STAGES}
        stats={stats}
        isActive={k => kind === k}
        onPick={pickKind}
      />

      {kind === 'commitments' && (
        <StatusBanner tone="info" icon={Hourglass} title="Commandé, pas encore reçu">
          Ce qui reste à recevoir sur les BC envoyés : c'est ce que vous vous êtes engagé à payer. Une livraison prévue dépassée apparaît en rouge.
        </StatusBanner>
      )}
      {kind === 'rni' && (
        <StatusBanner tone={s?.received_not_invoiced.aged ? 'warning' : 'neutral'} icon={PackageCheck} title="Marchandise reçue, facture fournisseur attendue"
          actions={<button className="odoo-btn-secondary" disabled={!total}
            onClick={() => purchasingReportsApi.exportReceivedNotInvoiced().catch(() => notify.error('Export impossible'))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={12} /> Exporter</button>}>
          Valorisé au prix du BC, ligne par ligne. C'est la dette latente à provisionner à la clôture (factures non parvenues).
          {(s?.received_not_invoiced.price_missing ?? 0) > 0 && ` ${s!.received_not_invoiced.price_missing} ligne(s) sans prix BC sont comptées à 0.`}
        </StatusBanner>
      )}
      {kind === 'inr' && (
        <StatusBanner tone={s?.invoiced_not_received.lines ? 'danger' : 'success'} icon={FileWarning}
          title={s?.invoiced_not_received.lines ? 'Facturé au-delà de ce qui a été reçu' : 'Aucune facture au-delà du reçu'}>
          Quantité facturée supérieure à la quantité réceptionnée sur la ligne de BC : ne payez pas avant d'avoir vérifié la livraison.
        </StatusBanner>
      )}
      {kind === 'nolines' && (
        <StatusBanner tone="neutral" icon={FileX} title="Factures saisies sans détail de lignes">
          Elles ne peuvent pas être rapprochées des réceptions ligne par ligne. Complétez leurs lignes pour qu'elles entrent dans le contrôle.
        </StatusBanner>
      )}

      {/* Vue + filtres */}
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <ViewSwitch ariaLabel="Présentation" view={group === 'detail' ? 'open' : 'history'}
          onChange={v => setGroup(v === 'open' ? 'detail' : 'supplier')}
          openLabel="Détail" historyLabel="Par fournisseur" />
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0, marginLeft: 8 }} />
        <input type="text" aria-label="Rechercher"
          placeholder={kind === 'nolines' ? 'Rechercher par fournisseur ou N° de facture...' : 'Rechercher par fournisseur, BC ou article...'}
          value={searchInput} onChange={e => setSearchInput(e.target.value)} className="odoo-search-input"
          style={{ flex: '1 1 200px', minWidth: 0 }} />
        {isFetching && !isLoading && <Loader2 className="animate-spin" size={13} style={{ color: 'var(--theme-text-muted)' }} />}
        {kind !== 'inr' && (
          <SelectFilter label="Ancienneté" icon={Clock} value={minAge} onChange={setMinAge} options={AGES} allLabel="Toutes" />
        )}
        <PeriodFilter label={DATE_LABEL[kind].label} title={DATE_LABEL[kind].title}
          period={period} onPeriod={setPeriod}
          from={customFrom} onFrom={setCustomFrom} to={customTo} onTo={setCustomTo} />
        <SearchSelect options={supplierOptions} value={supplierFilter} onChange={setSupplierFilter} placeholder="Tous les fournisseurs" />
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="odoo-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={12} /> Effacer les filtres
          </button>
        )}
      </div>

      {isLoading || !board ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
          <p style={{ fontSize: '0.8125rem' }}>Chargement...</p>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <PackageCheck size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
            {hasFilters ? 'Aucun résultat pour ces filtres' : 'Rien à signaler dans cette liste'}
          </p>
          {hasFilters && (
            <button type="button" onClick={resetFilters} style={{ fontSize: '0.6875rem', textDecoration: 'underline', color: 'inherit', marginTop: 2 }}>
              Effacer les filtres
            </button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', opacity: isFetching ? 0.7 : 1, transition: 'opacity 0.15s' }}>
          {group === 'supplier' ? (
            /* ── Par fournisseur : une ligne cliquable par fournisseur, triée par montant ── */
            <table className="odoo-table">
              <thead><tr>
                <th>Fournisseur</th>
                <th style={{ textAlign: 'right' }}>{kind === 'nolines' ? 'Factures' : kind === 'commitments' ? 'BC' : 'Lignes'}</th>
                <th>Plus ancien</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ width: 32 }}></th>
              </tr></thead>
              <tbody>{rows.map(r => {
                const age = Number(r.max_age);
                return (
                  <tr key={r.supplier_id ?? 'none'} onClick={() => r.supplier_id && drillSupplier(r.supplier_id)}
                    style={{ cursor: r.supplier_id ? 'pointer' : 'default' }} title="Voir le détail de ce fournisseur">
                    <td style={{ fontWeight: 600 }}>{r.supplier_name ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.lines}
                      {(kind === 'rni' || kind === 'inr') && (
                        <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}> · {plural(r.docs, 'BC')}</span>
                      )}
                    </td>
                    <td>
                      <span style={{ color: 'var(--theme-text-muted)' }}>{date(r.oldest_date)}</span>
                      {r.max_age != null && <AgeTag days={age} />}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.doc_amount)} <Dh /></td>
                    <td style={{ textAlign: 'right', color: 'var(--theme-text-muted)' }}><ChevronRight size={14} /></td>
                  </tr>
                );
              })}</tbody>
              <TotalRow label={plural(total, 'fournisseur')} amount={board.sumAmount} span={3} />
            </table>
          ) : (
            /* ── Détail : regroupé par fournisseur (intertitre + sous-total de la page) ── */
            <table className="odoo-table">
              <thead><tr>{COLUMNS[kind].map(c => <th key={c.label} style={{ textAlign: c.right ? 'right' : undefined }}>{c.label}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => {
                const firstOfGroup = i === 0 || rows[i - 1].supplier_id !== r.supplier_id;
                const groupRows = firstOfGroup ? rows.filter(x => x.supplier_id === r.supplier_id) : [];
                return (
                  <Fragment key={r.po_item_id ?? r.invoice_id ?? r.po_id}>
                    {firstOfGroup && (
                      <tr style={{ background: 'var(--odoo-bg-hover)' }}>
                        <td colSpan={COLUMNS[kind].length - 1} style={{ fontWeight: 600, color: 'var(--odoo-text)' }}>
                          {r.supplier_name ?? '—'}
                          <span style={{ fontWeight: 400, color: 'var(--theme-text-muted)', marginLeft: 6, fontSize: '0.75rem' }}>
                            {plural(groupRows.length, unit)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          {fmt(groupRows.reduce((a, x) => a + (parseFloat(x.doc_amount) || 0), 0))} <Dh />
                        </td>
                      </tr>
                    )}
                    {kind === 'commitments' && (
                      <tr>
                        <td style={{ paddingLeft: 24 }}>
                          <DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} />
                          <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>{PO_STATUS[r.po_status] ?? r.po_status}</span>
                        </td>
                        <td style={{ color: 'var(--theme-text-muted)' }}>{date(r.order_date)}</td>
                        <td style={{ color: r.is_late ? '#dc3545' : 'var(--theme-text-muted)', fontWeight: r.is_late ? 600 : 400 }}>
                          {date(r.expected_delivery_date)}{r.is_late && ' · en retard'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{r.open_lines}</td>
                        <td style={{ textAlign: 'right' }}>
                          {r.price_missing && (
                            <span style={{ color: '#b85d1a', fontSize: '0.75rem', marginRight: 6 }} title="Au moins une ligne sans prix : montant sous-évalué">
                              <AlertTriangle size={11} style={{ verticalAlign: '-1px' }} /> prix manquant
                            </span>
                          )}
                          {fmt(r.doc_amount)}
                        </td>
                      </tr>
                    )}
                    {kind === 'rni' && (
                      <tr>
                        <td style={{ paddingLeft: 24 }}>
                          {r.item_name ?? '—'}
                          {r.price_overwritten && <span style={{ color: '#b85d1a', fontSize: '0.75rem', marginLeft: 6 }} title="Prix saisi à la réception différent du prix BC">prix modifié</span>}
                        </td>
                        <td><DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} /></td>
                        <td style={{ textAlign: 'right' }}>{qty(r.qty)} <span style={{ color: 'var(--theme-text-muted)' }}>{r.unit ?? ''}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          {r.price_missing ? <span style={{ color: '#dc3545', fontWeight: 600, fontSize: '0.75rem' }}>à définir</span> : fmt(r.price_po)}
                        </td>
                        <td>
                          <span style={{ color: 'var(--theme-text-muted)' }}>{date(r.last_received_at)}</span>
                          {r.age_days != null && <AgeTag days={Number(r.age_days)} />}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                    {kind === 'inr' && (
                      <tr>
                        <td style={{ paddingLeft: 24 }}>{r.item_name ?? '—'}</td>
                        <td><DocLink label={r.order_number} onClick={() => setPoDetail(r.po_id)} /></td>
                        <td style={{ textAlign: 'right' }}>{qty(r.qty_received)} <span style={{ color: 'var(--theme-text-muted)' }}>{r.unit ?? ''}</span></td>
                        <td style={{ textAlign: 'right', color: '#dc3545', fontWeight: 600 }}>{qty(r.qty_invoiced)} {r.unit ?? ''}</td>
                        <td style={{ textAlign: 'right', color: '#dc3545', fontWeight: 600 }}>{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                    {kind === 'nolines' && (
                      <tr>
                        <td style={{ paddingLeft: 24 }}>
                          {onOpenInvoice
                            ? <DocLink label={r.invoice_number} onClick={() => openInvoice(r)} title="Ouvrir la facture pour compléter ses lignes" />
                            : <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.invoice_number}</span>}
                          {r.supplier_invoice_number && r.supplier_invoice_number !== r.invoice_number && (
                            <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem', marginLeft: 8 }}>n° fourn. {r.supplier_invoice_number}</span>
                          )}
                        </td>
                        <td style={{ color: 'var(--theme-text-muted)' }}>{date(r.invoice_date)}</td>
                        <td>
                          {PAYMENT_STATUS[r.invoice_status as string]
                            ? <span className={`odoo-tag ${PAYMENT_STATUS[r.invoice_status as string].tag}`}>{PAYMENT_STATUS[r.invoice_status as string].label}</span>
                            : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.doc_amount)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}</tbody>
              <TotalRow label={plural(total, unit)} amount={board.sumAmount} span={COLUMNS[kind].length - 1} />
            </table>
          )}
          <Pager page={page} total={total} onPage={setPage}
            note={`${PIL_STAGES.find(x => x.key === kind)?.label}${period !== 'all' ? ` · ${DATE_LABEL[kind].label.toLowerCase()} ${periodLabel(period, customFrom, customTo)}` : ''}${group === 'detail' ? ' · cliquez un N° pour ouvrir le document' : ' · cliquez un fournisseur pour son détail'}`} />
        </div>
      )}

      {poDetail && <PODetailModal poId={poDetail} onClose={() => setPoDetail(null)} />}
    </>
  );
}
