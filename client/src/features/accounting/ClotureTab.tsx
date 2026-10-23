import { Fragment, useState } from 'react';
import SearchSelect from '../../components/ui/SearchSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, LockOpen, ShieldCheck, ListChecks, AlertTriangle, CheckCircle2, RotateCcw, Inbox, PackageOpen, X } from 'lucide-react';
import { fiscalPeriodsApi, purchaseLedgerApi, type CloseCheck } from '../../api/ledger.api';
import type { FiscalPeriod } from '@ofauria/shared';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { apiErrorMessage } from '../../api/errors';

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const STATUS_META: Record<string, { label: string; tag: string; icon: typeof Lock }> = {
  open:   { label: 'Ouverte',     tag: 'odoo-tag-green',  icon: LockOpen },
  closed: { label: 'Clôturée',    tag: 'odoo-tag-orange', icon: Lock },
  locked: { label: 'Verrouillée', tag: 'odoo-tag-red',    icon: ShieldCheck },
};
const TRANSITION_LABEL: Record<string, string> = { open: 'Rouverte', closed: 'Clôturée', locked: 'Verrouillée' };

const fmt = (v: number | string | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Clôture des périodes (mig 311, D8 G-D8-16) :
 *  - contrôles de clôture par période (bloquants / avertissements), clôture séquentielle ;
 *  - réouverture motivée, verrou réservé à l'administrateur, historique des transitions ;
 *  - réceptions à facturer (compte d'attente 4417 par ligne de BC) ;
 *  - comptabilisations en attente (file ledger_outbox) et rejeu.
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

  const { data: periods = [], isLoading } = useQuery({
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
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
        <Lock size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
        <p style={{ fontSize: '0.875rem' }}>La clôture est réservée à l'administrateur ou au gérant.</p>
      </div>
    );
  }

  const close = async (p: FiscalPeriod) => {
    if (!(await confirm(`Clôturer ${MONTH_NAMES[p.month - 1]} ${p.year} ? Plus aucune écriture ne pourra y être passée ; une correction sera datée dans la période ouverte suivante.`))) return;
    mutation.mutate({ id: p.id, status: 'closed' });
  };
  const lock = async (p: FiscalPeriod) => {
    if (!(await confirm(`Verrouiller définitivement ${MONTH_NAMES[p.month - 1]} ${p.year} ? Aucune correction ne sera plus possible, même par extourne.`))) return;
    mutation.mutate({ id: p.id, status: 'locked' });
  };
  const grirTotal = grir.reduce((t, g) => t + (parseFloat(g.open_amount) || 0), 0);
  const grirAged = grir.filter(g => g.age_days > 30 && parseFloat(g.open_amount) > 0);

  return (
    <>
      <div className="odoo-search-panel" style={{ flexWrap: 'wrap', gap: 6 }}>
        <SearchSelect
          options={[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1].map(y => ({ id: String(y), label: String(y) }))}
          value={String(year)}
          onChange={id => id && setYear(parseInt(id, 10))}
          placeholder="Année"
          width={120}
        />
        <div style={{ flex: 1 }} />
      </div>

      {pendingOutbox.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <StatusBanner tone="danger" icon={Inbox} title={`${pendingOutbox.length} pièce(s) non comptabilisée(s)`}
            actions={isAdmin ? (
              <button className="odoo-btn-primary" disabled={replay.isPending} onClick={() => replay.mutate(undefined)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {replay.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Rejouer tout
              </button>
            ) : undefined}>
            La pièce a été enregistrée mais son écriture a échoué. Corrigez la cause (paramétrage, prix BC…) puis rejouez.
          </StatusBanner>
          <table className="odoo-table" style={{ margin: '8px 0 0' }}>
            <thead><tr><th style={{ width: 120 }}>Pièce</th><th style={{ width: 160 }}>Document</th><th>Motif de l'échec</th><th style={{ width: 70, textAlign: 'right' }}>Essais</th>{isAdmin && <th style={{ width: 90 }} />}</tr></thead>
            <tbody>
              {pendingOutbox.map(o => (
                <tr key={o.id}>
                  <td><span className="odoo-tag odoo-tag-grey">{o.source_kind === 'invoice' ? 'Facture' : o.source_kind === 'payment' ? 'Paiement' : o.source_kind === 'goods_receipt' ? 'Réception' : o.source_kind}</span></td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{o.document_label || o.source_id.slice(0, 8)}</td>
                  <td style={{ fontSize: '0.75rem', color: '#721c24' }}>{o.last_error}</td>
                  <td style={{ textAlign: 'right' }}>{o.attempts}</td>
                  {isAdmin && <td style={{ textAlign: 'right' }}>
                    <button className="odoo-btn-secondary" disabled={replay.isPending} onClick={() => replay.mutate(o.id)}>Rejouer</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)', marginBottom: 12 }}>
        <strong>Ouverte</strong> : écritures libres. <strong>Clôturée</strong> : plus de nouvelle écriture ; une correction est
        datée au premier jour de la période ouverte suivante. Les mois se clôturent dans l'ordre, après des contrôles sans
        point bloquant. <strong>Verrouillée</strong> : verrou définitif, réservé à l'administrateur.
      </p>

      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
        </div>
      ) : (
        <div className="odoo-section" style={{ padding: 0 }}>
          <table className="odoo-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Période</th>
                <th style={{ width: 200 }}>Dates</th>
                <th style={{ width: 130 }}>Statut</th>
                <th style={{ width: 360, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(periods as FiscalPeriod[]).map(p => {
                const meta = STATUS_META[p.status];
                const Icon = meta.icon;
                const expanded = openChecks === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{MONTH_NAMES[p.month - 1]} {p.year}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
                        {String(p.start_date).slice(0, 10)} → {String(p.end_date).slice(0, 10)}
                      </td>
                      <td>
                        <span className={`odoo-tag ${meta.tag}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon size={11} /> {meta.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="odoo-btn-secondary" onClick={() => setOpenChecks(expanded ? null : p.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ListChecks size={12} /> {expanded ? 'Masquer' : 'Contrôles'}
                          </button>
                          {p.status === 'open' && (
                            <button className="odoo-btn-primary" disabled={mutation.isPending} onClick={() => close(p)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Lock size={12} /> Clôturer
                            </button>
                          )}
                          {p.status === 'closed' && (
                            <>
                              <button className="odoo-btn-secondary" disabled={mutation.isPending} onClick={() => setReopen(p)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <LockOpen size={12} /> Rouvrir
                              </button>
                              {isAdmin && (
                                <button className="odoo-btn-danger" disabled={mutation.isPending} onClick={() => lock(p)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <ShieldCheck size={12} /> Verrouiller
                                </button>
                              )}
                            </>
                          )}
                          {p.status === 'locked' && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontStyle: 'italic' }}>Verrou définitif</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr><td colSpan={4} style={{ background: 'var(--theme-bg-page)', padding: 12 }}>
                        <PeriodChecks periodId={p.id} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Réceptions à facturer : compte d'attente 4417 lettré par ligne de BC (G-D8-05). */}
      <div style={{ marginTop: 16 }}>
        <StatusBanner tone={grirAged.length ? 'warning' : 'neutral'} icon={PackageOpen}
          title={`Réceptions à facturer : ${fmt(grirTotal)} DH sur ${grir.length} ligne(s) de BC`}>
          Marchandise reçue et comptabilisée au prix du BC, en attente de la facture fournisseur.
          {grirAged.length > 0 && ` ${grirAged.length} ligne(s) attendent depuis plus de 30 jours.`}
        </StatusBanner>
        {grir.length > 0 && (
          <table className="odoo-table" style={{ margin: '8px 0 0' }}>
            <thead><tr><th>Fournisseur</th><th style={{ width: 130 }}>BC</th><th>Article</th><th style={{ width: 110 }}>Depuis</th><th style={{ width: 70, textAlign: 'right' }}>Âge</th><th style={{ width: 120, textAlign: 'right' }}>Solde</th></tr></thead>
            <tbody>
              {grir.map(g => {
                const v = parseFloat(g.open_amount);
                return (
                  <tr key={g.po_line_id}>
                    <td>{g.supplier_name || '—'}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{g.order_number}</td>
                    <td>{g.item_name || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{String(g.first_event).slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>{g.age_days > 30 ? <span className="odoo-tag odoo-tag-orange">{g.age_days} j</span> : `${g.age_days} j`}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: v < 0 ? '#b71c1c' : undefined }}
                      title={v < 0 ? 'Facturé non reçu' : 'Reçu non facturé'}>{fmt(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {reopen && (
        <ModalBackdrop onClose={() => setReopen(null)} className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="odoo-scope" onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb"><span className="odoo-breadcrumb-current">Rouvrir {MONTH_NAMES[reopen.month - 1]} {reopen.year}</span></div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setReopen(null)} className="odoo-pager-btn" title="Fermer"><X size={14} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ id: reopen.id, status: 'open', note: reopenNote.trim() }); }}
              style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
                La réouverture est historisée avec son motif. Refermez la période après la correction.
              </p>
              <label htmlFor="reopen-note" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>Motif *</label>
              <textarea id="reopen-note" rows={2} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={() => setReopen(null)} className="odoo-btn-secondary">Retour</button>
                <button type="submit" disabled={reopenNote.trim().length < 3 || mutation.isPending} className="odoo-btn-primary">Rouvrir</button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </>
  );
}

/** Contrôles de clôture d'une période + historique des transitions. */
function PeriodChecks({ periodId }: { periodId: string }) {
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['ledger-close-checklist', periodId], queryFn: () => fiscalPeriodsApi.checklist(periodId),
  });
  const { data: events = [] } = useQuery({
    queryKey: ['ledger-period-events', periodId], queryFn: () => fiscalPeriodsApi.events(periodId),
  });
  if (isLoading) return <Loader2 size={16} className="animate-spin" />;
  const blocking = (checks as CloseCheck[]).filter(c => c.blocking && c.item_count > 0);
  const warnings = (checks as CloseCheck[]).filter(c => !c.blocking && c.item_count > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocking.length > 0
        ? <StatusBanner tone="danger" icon={AlertTriangle} title={`${blocking.length} contrôle(s) bloquant(s)`}>La période ne peut pas être clôturée tant qu'ils ne sont pas résolus.</StatusBanner>
        : <StatusBanner tone="success" icon={CheckCircle2} title="Aucun point bloquant">{warnings.length ? `${warnings.length} avertissement(s) à examiner.` : 'Tous les contrôles sont au vert.'}</StatusBanner>}
      <table className="odoo-table" style={{ margin: 0 }}>
        <thead><tr><th>Contrôle</th><th style={{ width: 90, textAlign: 'right' }}>Nombre</th><th style={{ width: 130, textAlign: 'right' }}>Montant</th><th style={{ width: 120 }}>Effet</th></tr></thead>
        <tbody>
          {(checks as CloseCheck[]).map(c => (
            <tr key={c.code}>
              <td>{c.label}</td>
              <td style={{ textAlign: 'right' }}>{c.item_count}</td>
              <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{c.amount != null && c.item_count > 0 ? fmt(c.amount) : '—'}</td>
              <td>{c.item_count === 0
                ? <span className="odoo-tag odoo-tag-green">OK</span>
                : c.blocking ? <span className="odoo-tag odoo-tag-red">Bloquant</span> : <span className="odoo-tag odoo-tag-orange">À examiner</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length > 0 && (
        <div className="ui-timeline" style={{ fontSize: '0.75rem' }}>
          {events.map(e => (
            <div key={e.id} style={{ color: 'var(--theme-text-muted)' }}>
              {new Date(e.at).toLocaleString('fr-FR')} · <strong>{TRANSITION_LABEL[e.to_status] ?? e.to_status}</strong>
              {e.user_name ? ` par ${e.user_name}` : ''}{e.note ? ` — ${e.note}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
