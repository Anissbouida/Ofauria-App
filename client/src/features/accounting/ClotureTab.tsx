import { Fragment, useState } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, LockOpen, ShieldCheck, ListChecks, AlertTriangle, CheckCircle2, RotateCcw, Inbox, PackageOpen } from 'lucide-react';
import { fiscalPeriodsApi, purchaseLedgerApi, type CloseCheck, type PeriodEndOperation } from '../../api/ledger.api';
import type { FiscalPeriod } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage } from '../../api/errors';
import IntegrityPanel from './IntegrityPanel';
import FiscalYearsPanel from './FiscalYearsPanel';
import { money, currencySymbol } from '../../utils/money';
import { DataPanel, EmptyState, ErrorState, LoadingState, SectionHeader, Toolbar, TableFooter, Modal, FormField, FormFooter } from '../../components/ds';
import { RowMenu } from '../../components/ui/RowMenu';

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const STATUS_META: Record<string, { label: string; tone: StatusTone; icon: typeof Lock }> = {
  open:   { label: 'Ouverte',     tone: 'progress', icon: LockOpen },
  closed: { label: 'Clôturée',    tone: 'done',     icon: Lock },
  locked: { label: 'Verrouillée', tone: 'done',     icon: ShieldCheck },
};
const TRANSITION_LABEL: Record<string, string> = { open: 'Rouverte', closed: 'Clôturée', locked: 'Verrouillée' };

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Clôture des périodes (mig 311, D8 G-D8-16) :
 *  - contrôles de clôture par période (bloquants / avertissements), clôture séquentielle ;
 *  - réouverture motivée, verrou réservé à l'administrateur, historique des transitions ;
 *  - réceptions à facturer (compte d'attente 4417 par ligne de BC) ;
 *  - comptabilisations en attente (file ledger_outbox) et rejeu ;
 *  - intégrité du grand livre (mig 413) : chaînage, gardes, journal d'audit.
 */
export default function ClotureTab() {
  const { user } = useAuth();
  const canSee = user?.role === 'admin' || user?.role === 'manager';
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [openChecks, setOpenChecks] = useState<string | null>(null);
  const [reopen, setReopen] = useState<FiscalPeriod | null>(null);
  const [reopenNote, setReopenNote] = useState('');

  const { data: periods = [], isLoading, isError: periodsError, error: periodsErr, refetch: refetchPeriods } = useQuery({
    queryKey: ['ledger-fiscal-periods', year],
    queryFn: () => fiscalPeriodsApi.list(year),
    enabled: canSee,
  });
  const { data: outbox = [] } = useQuery({
    queryKey: ['ledger-outbox'], queryFn: () => purchaseLedgerApi.outbox(), enabled: canSee,
  });
  const pendingOutbox = outbox.filter(o => o.status !== 'posted');
  const { data: grir = [] } = useQuery({
    queryKey: ['ledger-grir'], queryFn: () => purchaseLedgerApi.grirOpenItems(), enabled: canSee,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ledger-fiscal-periods'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-close-checklist'] });
    queryClient.invalidateQueries({ queryKey: ['ledger-period-events'] });
  };
  const mutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'open' | 'closed' | 'locked'; note?: string }) =>
      fiscalPeriodsApi.updateStatus(id, status, note),
    onSuccess: () => { invalidate(); notify.success('Période mise à jour'); setReopen(null); setReopenNote(''); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Erreur lors de la mise à jour')),
  });
  const replay = useMutation({
    mutationFn: (id?: string) => purchaseLedgerApi.replay(id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['ledger-outbox'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-close-checklist'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-grir'] });
      if (r.failed) notify.error(`${r.posted} comptabilisée(s), ${r.failed} encore en échec`);
      else notify.success(`${r.posted} pièce(s) comptabilisée(s)`);
    },
    onError: (e) => notify.error(apiErrorMessage(e, 'Rejeu impossible')),
  });

  if (!canSee) {
    return (
      <EmptyState icon={Lock} title="La clôture est réservée à l'administrateur ou au gérant" />
    );
  }

  const close = async (p: FiscalPeriod) => {
    if (!(await confirm(`Clôturer ${MONTH_NAMES[p.month - 1]} ${p.year} ? Plus aucune écriture ne pourra y être passée ; une correction sera datée dans la période ouverte suivante.`, { title: 'Clôturer la période', confirmLabel: 'Clôturer', danger: true }))) return;
    mutation.mutate({ id: p.id, status: 'closed' });
  };
  const lock = async (p: FiscalPeriod) => {
    if (!(await confirm(`Verrouiller définitivement ${MONTH_NAMES[p.month - 1]} ${p.year} ? Aucune correction ne sera plus possible, même par extourne.`, { title: 'Verrouiller définitivement', confirmLabel: 'Verrouiller', danger: true }))) return;
    mutation.mutate({ id: p.id, status: 'locked' });
  };
  const grirTotal = grir.reduce((t, g) => t + (parseFloat(g.open_amount) || 0), 0);
  const grirAged = grir.filter(g => g.age_days > 30 && parseFloat(g.open_amount) > 0);

  return (
    <>
      {pendingOutbox.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <StatusBanner tone="danger" icon={Inbox} title={`${pendingOutbox.length} pièce(s) non comptabilisée(s)`}
            actions={isAdmin ? (
              <button type="button" className="odoo-btn-primary" disabled={replay.isPending} aria-busy={replay.isPending || undefined} onClick={() => replay.mutate(undefined)}>
                {replay.isPending ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />} Rejouer tout
              </button>
            ) : undefined}>
            La pièce a été enregistrée mais son écriture a échoué. Corrigez la cause (paramétrage, prix BC…) puis rejouez.
          </StatusBanner>
          <DataPanel label="Pièces non comptabilisées">
          <table className="odoo-table ds-dense">
            <thead><tr><th style={{ width: 120 }}>Pièce</th><th style={{ width: 160 }}>Document</th><th>Motif de l'échec</th><th className="ds-num" style={{ width: 70 }}>Essais</th>{isAdmin && <th className="ds-actions" style={{ width: 90 }} />}</tr></thead>
            <tbody>
              {pendingOutbox.map(o => (
                <tr key={o.id}>
                  <td><StatusTag tone="draft" label={o.source_kind === 'invoice' ? 'Facture' : o.source_kind === 'payment' ? 'Paiement' : o.source_kind === 'goods_receipt' ? 'Réception' : o.source_kind} /></td>
                  <td className="ds-ref">{o.document_label || o.source_id.slice(0, 8)}</td>
                  <td style={{ color: 'var(--ds-danger)' }}>{o.last_error}</td>
                  <td className="ds-num">{o.attempts}</td>
                  {isAdmin && <td className="ds-actions">
                    <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={replay.isPending} onClick={() => replay.mutate(o.id)}>Rejouer</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
          </DataPanel>
        </div>
      )}

      <IntegrityPanel />

      <FiscalYearsPanel isAdmin={isAdmin} />

      <SectionHeader title="Périodes mensuelles" />
      <Toolbar>
        <SearchSelect
          options={[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1].map(y => ({ id: String(y), label: String(y) }))}
          value={String(year)}
          onChange={id => id && setYear(parseInt(id, 10))}
          placeholder="Année"
          width={120}
        />
      </Toolbar>

      <p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>
        <strong>Ouverte</strong> : écritures libres. <strong>Clôturée</strong> : plus de nouvelle écriture ; une correction est
        datée au premier jour de la période ouverte suivante. Les mois se clôturent dans l'ordre, après des contrôles sans
        point bloquant. <strong>Verrouillée</strong> : verrou définitif, réservé à l'administrateur.
      </p>

      {isLoading ? (
        <LoadingState />
      ) : periodsError ? (
        <ErrorState error={periodsErr} title="Les périodes n'ont pas pu être chargées" onRetry={() => refetchPeriods()} />
      ) : (
        <DataPanel label="Périodes mensuelles" footer={<TableFooter note={`${periods.length} période${periods.length > 1 ? 's' : ''} · exercice ${year}`} />}>
          <table className="odoo-table ds-dense">
            <thead>
              <tr>
                <th>Période</th>
                <th style={{ width: 220 }}>Dates</th>
                <th style={{ width: 150 }}>Statut</th>
                <th className="ds-actions" style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(periods as FiscalPeriod[]).map(p => {
                const meta = STATUS_META[p.status];
                const expanded = openChecks === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td className="ds-strong">{MONTH_NAMES[p.month - 1]} {p.year}</td>
                      <td style={{ color: 'var(--ds-muted)' }}>
                        {String(p.start_date).slice(0, 10)} → {String(p.end_date).slice(0, 10)}
                      </td>
                      <td>
                        <StatusTag tone={meta.tone} icon={meta.icon} label={meta.label} />
                      </td>
                      <td className="ds-actions">
                        <button type="button" className="odoo-btn-secondary ds-btn-sm" aria-expanded={expanded} onClick={() => setOpenChecks(expanded ? null : p.id)}>
                          <ListChecks size={12} aria-hidden="true" /> {expanded ? 'Masquer' : 'Contrôles'}
                        </button>
                        {p.status === 'locked' && <span style={{ fontSize: 12, color: 'var(--ds-muted)' }}>Verrou définitif</span>}
                        <RowMenu label={`Actions sur ${MONTH_NAMES[p.month - 1]} ${p.year}`} items={[
                          ...(p.status === 'open' ? [{ label: 'Clôturer la période', icon: Lock, danger: true, disabled: mutation.isPending, onSelect: () => { void close(p); } }] : []),
                          ...(p.status === 'closed' ? [{ label: 'Rouvrir la période', icon: LockOpen, disabled: mutation.isPending, onSelect: () => setReopen(p) }] : []),
                          ...(p.status === 'closed' && isAdmin ? [{ label: 'Verrouiller définitivement', icon: ShieldCheck, danger: true, disabled: mutation.isPending, onSelect: () => { void lock(p); } }] : []),
                        ]} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr><td colSpan={4} style={{ background: 'var(--ds-bg)', padding: 16 }}>
                        <PeriodChecks periodId={p.id} />
                        <SalesPeriodEnd periodId={p.id} open={p.status === 'open'} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {/* Réceptions à facturer : compte d'attente 4417 lettré par ligne de BC (G-D8-05). */}
      <div style={{ display: 'grid', gap: 8 }}>
        <SectionHeader title="Réceptions à facturer" />
        <StatusBanner tone={grirAged.length ? 'warning' : 'neutral'} icon={PackageOpen}
          title={`Réceptions à facturer : ${money(grirTotal)} sur ${grir.length} ligne(s) de BC`}>
          Marchandise reçue et comptabilisée au prix du BC, en attente de la facture fournisseur.
          {grirAged.length > 0 && ` ${grirAged.length} ligne(s) attendent depuis plus de 30 jours.`}
        </StatusBanner>
        {grir.length > 0 && (
          <DataPanel label="Réceptions à facturer">
          <table className="odoo-table ds-dense">
            <thead><tr><th>Fournisseur</th><th style={{ width: 130 }}>BC</th><th>Article</th><th style={{ width: 110 }}>Depuis</th><th className="ds-num" style={{ width: 70 }}>Âge</th><th className="ds-num" style={{ width: 120 }}>Solde ({currencySymbol()})</th></tr></thead>
            <tbody>
              {grir.map(g => {
                const v = parseFloat(g.open_amount);
                return (
                  <tr key={g.po_line_id}>
                    <td className="ds-strong">{g.supplier_name || '—'}</td>
                    <td className="ds-ref">{g.order_number}</td>
                    <td>{g.item_name || '—'}</td>
                    <td>{String(g.first_event).slice(0, 10)}</td>
                    <td className="ds-num">{g.age_days > 30 ? <StatusTag tone="todo" label={`${g.age_days} j`} /> : `${g.age_days} j`}</td>
                    <td className="ds-num" style={{ color: v < 0 ? 'var(--ds-danger)' : undefined }}
                      title={v < 0 ? 'Facturé non reçu' : 'Reçu non facturé'}>{fmt(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </DataPanel>
        )}
      </div>

      {reopen && (
        <Modal title={`Rouvrir ${MONTH_NAMES[reopen.month - 1]} ${reopen.year}`} onClose={() => setReopen(null)} width={440} locked={mutation.isPending}
          footer={<FormFooter onCancel={() => setReopen(null)} cancelLabel="Retour" submitLabel="Rouvrir" busy={mutation.isPending}
            disabled={reopenNote.trim().length < 3} onSubmit={() => mutation.mutate({ id: reopen.id, status: 'open', note: reopenNote.trim() })} />}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-muted)' }}>
            La réouverture est historisée avec son motif. Refermez la période après la correction.
          </p>
          <FormField label="Motif" htmlFor="reopen-note" required hint="3 caractères au moins.">
            <textarea id="reopen-note" rows={2} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} autoFocus className="ds-input" />
          </FormField>
        </Modal>
      )}
    </>
  );
}

/** Contrôles de clôture d'une période + historique des transitions. */
function PeriodChecks({ periodId }: { periodId: string }) {
  const { data: checks = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ledger-close-checklist', periodId], queryFn: () => fiscalPeriodsApi.checklist(periodId),
  });
  const { data: events = [] } = useQuery({
    queryKey: ['ledger-period-events', periodId], queryFn: () => fiscalPeriodsApi.events(periodId),
  });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState error={error} title="Les contrôles n'ont pas pu être chargés" onRetry={() => refetch()} />;
  const blocking = (checks as CloseCheck[]).filter(c => c.blocking && c.item_count > 0);
  const warnings = (checks as CloseCheck[]).filter(c => !c.blocking && c.item_count > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocking.length > 0
        ? <StatusBanner tone="danger" icon={AlertTriangle} title={`${blocking.length} contrôle(s) bloquant(s)`}>La période ne peut pas être clôturée tant qu'ils ne sont pas résolus.</StatusBanner>
        : <StatusBanner tone="success" icon={CheckCircle2} title="Aucun point bloquant">{warnings.length ? `${warnings.length} avertissement(s) à examiner.` : 'Tous les contrôles sont au vert.'}</StatusBanner>}
      <DataPanel label="Contrôles de clôture">
      <table className="odoo-table ds-dense">
        <thead><tr><th>Contrôle</th><th className="ds-num" style={{ width: 90 }}>Nombre</th><th className="ds-num" style={{ width: 130 }}>Montant ({currencySymbol()})</th><th style={{ width: 120 }}>Effet</th></tr></thead>
        <tbody>
          {(checks as CloseCheck[]).map(c => (
            <tr key={c.code}>
              <td>{c.label}</td>
              <td className="ds-num">{c.item_count}</td>
              <td className="ds-num">{c.amount != null && c.item_count > 0 ? fmt(c.amount) : '—'}</td>
              <td>{c.item_count === 0
                ? <StatusTag tone="done" label="OK" />
                : c.blocking ? <StatusTag tone="blocked" label="Bloquant" /> : <StatusTag tone="todo" label="À examiner" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </DataPanel>
      {events.length > 0 && (
        <div className="ui-timeline" style={{ fontSize: 12 }}>
          {events.map(e => (
            <div key={e.id} style={{ color: 'var(--ds-muted)' }}>
              {new Date(e.at).toLocaleString('fr-FR')} · <strong>{TRANSITION_LABEL[e.to_status] ?? e.to_status}</strong>
              {e.user_name ? ` par ${e.user_name}` : ''}{e.note ? ` — ${e.note}` : ''}
              {e.chain_hash && (
                <span title={e.chain_hash} style={{ fontFamily: 'ui-monospace, monospace' }}>
                  {' '}· ancre n° {e.chain_seq} · {e.chain_hash.slice(0, 16)}…
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fin de période du cycle de vente (O2C L6) : factures à établir sur les BL livrés
 * non facturés (3427, extournées le 1er du mois suivant) et variation du stock de
 * produits finis (3151 / 7132). Relancer une opération remplace la précédente.
 */
function SalesPeriodEnd({ periodId, open }: { periodId: string; open: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ['ledger-period-end', periodId], queryFn: () => fiscalPeriodsApi.endOperations(periodId) });
  const done = () => {
    ['ledger-period-end', 'ledger-close-checklist'].forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  };
  const fae = useMutation({
    mutationFn: () => fiscalPeriodsApi.postFae(periodId),
    onSuccess: (r) => { done(); notify.success(r.amount > 0 ? `Factures à établir passées : ${money(r.amount)}` : 'Aucun BL à facturer en fin de période'); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Opération refusée')),
  });
  const fg = useMutation({
    mutationFn: () => fiscalPeriodsApi.postFgStock(periodId),
    onSuccess: (r) => { done(); notify.success(`Stock de produits finis : ${money(r.amount)} (variation ${money(r.detail?.delta ?? 0)})`); },
    onError: (e) => notify.error(apiErrorMessage(e, 'Opération refusée')),
  });
  const active = (k: 'fae' | 'fg_stock') => (data?.operations ?? []).find((o: PeriodEndOperation) => o.kind === k && !o.superseded_at);
  const unbilled = data?.unbilled ?? [];
  const unbilledHt = unbilled.reduce((s, u) => s + u.ht, 0);
  const faeOp = active('fae');
  const fgOp = active('fg_stock');
  const run = async (kind: 'fae' | 'fg', redo: boolean) => {
    if (redo && !(await confirm('L\'opération déjà passée sera extournée et remplacée par un nouveau calcul.', { title: 'Recalculer', confirmLabel: 'Recalculer', cancelLabel: 'Retour' }))) return;
    (kind === 'fae' ? fae : fg).mutate();
  };
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <SectionHeader title="Fin de période — ventes" />
      <div className="ds-panel" style={{ padding: '12px 16px', display: 'grid', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260 }}>
            <strong>Factures à établir</strong> — {unbilled.length
              ? `${unbilled.length} BL livré(s) non facturé(s) à la fin de la période, ${money(unbilledHt)} HT`
              : 'aucun BL livré non facturé à la fin de la période'}
            {faeOp && <span style={{ color: 'var(--ds-muted)' }}> · passées : {money(faeOp.amount)} (extournées le 1er du mois suivant)</span>}
          </span>
          {open && (
            <button type="button" className="odoo-btn-secondary" disabled={fae.isPending} onClick={() => run('fae', !!faeOp)}>
              {fae.isPending ? <Loader2 size={13} className="animate-spin" /> : null} {faeOp ? 'Recalculer' : 'Passer les FAE'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 260 }}>
            <strong>Stock de produits finis</strong> — {fgOp
              ? <>valorisé à {money(fgOp.amount)} (variation {money(fgOp.detail?.delta ?? 0)}){fgOp.detail?.products_without_cost
                  ? <span style={{ color: 'var(--ds-warning)' }}> · {fgOp.detail.products_without_cost} produit(s) sans coût</span> : null}</>
              : 'non valorisé pour cette période'}
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)' }}>
              Valorisation du stock au moment du calcul (lots au coût figé, sinon coût standard) : à lancer le dernier jour du mois.
            </span>
          </span>
          {open && (
            <button type="button" className="odoo-btn-secondary" disabled={fg.isPending} onClick={() => run('fg', !!fgOp)}>
              {fg.isPending ? <Loader2 size={13} className="animate-spin" /> : null} {fgOp ? 'Recalculer' : 'Valoriser le stock'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
