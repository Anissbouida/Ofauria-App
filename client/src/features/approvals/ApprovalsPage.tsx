import { money as fmtMoney } from '../../utils/money';
import { Fragment, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Clock, Send, History, UserCheck, ChevronDown, ChevronRight, FileDown, ClipboardCheck } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ROLE_LABELS, APPROVAL_DOC_TYPES, APPROVAL_REQUEST_STATUS_LABELS, type ApprovalDocTypeDef } from '@ofauria/shared';
import { approvalsApi, apiErrorMessage, type ApprovalRequest } from '../../api/approvals.api';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';
import SearchSelect from '../../components/ui/SearchSelect';
import SalesPageShell from '../sales/SalesPageShell';
import { FilterChips } from '../sales/ListTemplate';
import { PurHeaderActions } from '../purchasing/PurHeaderActions';
import {
  KpiGrid, KpiCard, Tabs, DataPanel, TableFooter, EmptyState, LoadingState, SectionHeader, Alert, FormField,
} from '../../components/ds';
import { currencySymbol } from '../../utils/money';
import './approvals.css';

/**
 * Boîte « À approuver » (lot 8). Les demandes que je peux trancher, celles
 * que j'ai faites, l'historique (admin / gérant) et mes délégations.
 */

const DOC_TYPES = APPROVAL_DOC_TYPES as Record<string, ApprovalDocTypeDef>;
const money = (v: string | number | null | undefined) => v === null || v === undefined ? '' : fmtMoney(Number(v));
const amount = (v: string | number | null | undefined) => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d: string) => format(new Date(d), 'dd MMM yyyy à HH:mm', { locale: fr });
const STATUS_TONE: Record<string, StatusTone> = { pending: 'todo', approved: 'done', rejected: 'blocked', cancelled: 'cancelled' };
const RequestStatusTag = ({ status }: { status: string }) => (
  <StatusTag tone={STATUS_TONE[status] ?? 'draft'} label={(APPROVAL_REQUEST_STATUS_LABELS as Record<string, string>)[status] ?? status} />
);
const roleLabel = (c: string | null) => (c ? (ROLE_LABELS as Record<string, string>)[c] ?? c : '');

function Steps({ r }: { r: ApprovalRequest }) {
  return (
    <ol className="ui-timeline" style={{ margin: 0 }}>
      {r.steps.map(s => {
        const done = s.status === 'approved' || s.status === 'rejected';
        const cls = `ui-timeline-step${done ? ' is-done' : s.status === 'pending' ? ' is-current' : ''}`;
        return (
          <li key={s.id} className={cls}>
            <span className="ui-timeline-dot" />
            <div className="ui-timeline-label">
              Étape {s.step_order} · {s.approver_name ?? roleLabel(s.approver_role)}
              {s.status === 'pending' && <span style={{ marginLeft: 6 }}><StatusTag tone="progress" label="En cours" /></span>}
              {s.status === 'approved' && <span style={{ marginLeft: 6 }}><StatusTag tone="done" label="Approuvée" /></span>}
              {s.status === 'rejected' && <span style={{ marginLeft: 6 }}><StatusTag tone="blocked" label="Refusée" /></span>}
              {s.status === 'skipped' && <span style={{ marginLeft: 6 }}><StatusTag tone="cancelled" label="Sans objet" /></span>}
            </div>
            <div className="ui-timeline-detail">
              {done && s.decided_at && <>{s.decided_by_name} · {when(s.decided_at)}{s.reason ? ` · ${s.reason}` : ''}</>}
              {s.status === 'pending' && s.due_at && <><Clock size={11} aria-hidden="true" style={{ verticalAlign: -1 }} /> attendue avant le {when(s.due_at)}{s.escalated_at ? ' · en retard, administrateur prévenu' : ''}</>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const KIND_TAG: Record<string, { label: string; cls: string }> = {
  consumable: { label: 'Consommable', cls: 'odoo-tag-purple' },
  service: { label: 'Service', cls: 'odoo-tag-blue' },
  asset: { label: 'Immobilisation', cls: 'odoo-tag-orange' },
};
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const dateOnly = (d: unknown) => (d ? format(new Date(String(d)), 'd MMM yyyy', { locale: fr }) : '—');
const muted: React.CSSProperties = { color: 'var(--ds-muted)', fontSize: 12, fontWeight: 400 };

/**
 * Contenu du bon de commande soumis : l'approbateur décide sur pièce (fournisseur,
 * lignes, prix, total), sans quitter la boîte d'approbation.
 */
function PurchaseOrderDetails({ poId }: { poId: string }) {
  const { data: po, isLoading, isError } = useQuery({
    queryKey: ['purchase-orders', poId],
    queryFn: () => purchaseOrdersApi.getById(poId),
    retry: false,
  });
  if (isLoading) return <LoadingState bare label="Chargement du bon…" />;
  if (isError || !po) return <p style={{ ...muted, fontSize: 14, margin: 0 }}>Détails du bon non accessibles avec votre profil.</p>;

  const items = (po.items ?? []) as Record<string, any>[];
  const total = items.reduce((t, it) => t + Number(it.quantity_ordered ?? 0) * Number(it.unit_price ?? 0), 0);
  const downloadPdf = async () => {
    try {
      const response = await purchaseOrdersApi.downloadPdf(poId);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { notify.error('PDF indisponible'); }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', fontSize: 14 }}>
        <div>
          <div style={muted}>Fournisseur</div>
          <div className="ds-strong">{po.supplier_name}</div>
          {(po.supplier_contact || po.supplier_phone) && <div style={muted}>{[po.supplier_contact, po.supplier_phone].filter(Boolean).join(' · ')}</div>}
        </div>
        <div>
          <div style={muted}>Commandé le</div>
          <div>{dateOnly(po.order_date)}{po.created_by_name ? ` par ${po.created_by_name}` : ''}</div>
        </div>
        <div>
          <div style={muted}>Livraison prévue</div>
          <div>{dateOnly(po.expected_delivery_date)}</div>
        </div>
        <span className="ds-grow" />
        <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={downloadPdf}>
          <FileDown size={13} aria-hidden="true" /> Voir le PDF du bon
        </button>
      </div>
      {po.notes && <div style={{ fontSize: 14 }}><span className="ds-strong">Notes :</span> {po.notes}</div>}
      <DataPanel label="Lignes du bon de commande">
        <table className="odoo-table ds-dense">
          <thead>
            <tr>
              <th>Article</th>
              <th className="ds-num">Quantité</th>
              <th className="ds-num">Prix unitaire HT ({currencySymbol()})</th>
              <th className="ds-num">Total HT ({currencySymbol()})</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const tag = KIND_TAG[it.kind as string];
              const lineTotal = Number(it.quantity_ordered ?? 0) * Number(it.unit_price ?? 0);
              return (
                <tr key={it.id as string}>
                  <td>
                    {it.ingredient_name as string}
                    {tag && <span className={`odoo-tag ${tag.cls}`} style={{ marginLeft: 6 }}>{tag.label}</span>}
                  </td>
                  <td className="ds-num">
                    {qty(it.quantity_ordered)} {it.ingredient_unit === 'unit' ? 'u' : it.ingredient_unit}
                    {it.line_container_label && Number(it.qty_container) > 0 && (
                      <div style={muted}>{qty(it.qty_container)} × {String(it.line_container_label).toLowerCase()}</div>
                    )}
                  </td>
                  <td className="ds-num">{it.unit_price != null ? amount(it.unit_price) : <span style={{ color: 'var(--ds-warning)' }}>à définir</span>}</td>
                  <td className="ds-num ds-strong">{amount(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="ds-num">{items.length} ligne{items.length > 1 ? 's' : ''} · total HT</td>
              <td className="ds-num">{amount(total)}</td>
            </tr>
          </tfoot>
        </table>
      </DataPanel>
    </div>
  );
}

/** Détail d'une demande, affiché sous sa ligne : pièce, circuit, effet, et motif de la décision. */
function RequestDetail({ r, reason, onReason, reasonError }: {
  r: ApprovalRequest;
  /** Saisie du motif (boîte « À approuver » seulement). */
  reason?: string; onReason?: (v: string) => void; reasonError?: boolean;
}) {
  const values = r.summary?.values ?? {};
  const def = DOC_TYPES[r.doc_type];
  return (
    <div style={{ display: 'grid', gap: 12, padding: '12px 8px' }}>
      <div style={{ fontSize: 13, color: 'var(--ds-muted)' }}>
        Règle « {r.rule_label} » ({r.summary?.condition ?? 'toujours'}){r.store_name ? ` · ${r.store_name}` : ''}
        {Object.keys(values).length > 0 && (
          <> · {Object.entries(values).map(([k, v]) => `${def?.fields[k]?.label ?? k} : ${typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(v)}${def?.fields[k]?.unit ? ` ${def.fields[k].unit}` : ''}`).join(' · ')}</>
        )}
      </div>
      {r.doc_type === 'purchase_order' && <PurchaseOrderDetails poId={r.doc_id} />}
      <Steps r={r} />
      {r.status !== 'pending' && r.decision_reason && <div style={{ fontSize: 14 }}><span className="ds-strong">Motif :</span> {r.decision_reason}</div>}
      {r.status === 'approved' && r.apply_error && (
        <StatusBanner tone="danger" icon={XCircle} title="Approuvée, mais l'effet n'a pas pu être appliqué">{r.apply_error}</StatusBanner>
      )}
      {r.status === 'approved' && r.applied_at && !r.apply_error && def?.effect && (
        <Alert tone="success" icon={CheckCircle2}>{def.effect}</Alert>
      )}
      {onReason && r.status === 'pending' && (
        <FormField label="Motif" htmlFor={`approval-reason-${r.id}`}
          hint="Obligatoire pour refuser, facultatif pour approuver."
          error={reasonError ? 'Saisissez le motif du refus : le demandeur le recevra.' : undefined}>
          <textarea id={`approval-reason-${r.id}`} className="ds-input" rows={2} value={reason ?? ''} onChange={e => onReason(e.target.value)}
            aria-invalid={reasonError || undefined} style={{ minHeight: 60 }} />
        </FormField>
      )}
    </div>
  );
}

/** Tableau des demandes (« À approuver » et « Mes demandes ») : une ligne par pièce, détail déplié dessous. */
function RequestsTable({ rows, label, footer, decide, cancel, busy }: {
  rows: ApprovalRequest[]; label: string; footer: string;
  decide?: (id: string, action: 'approve' | 'reject', reason: string) => void;
  cancel?: (id: string) => void;
  busy?: boolean;
}) {
  // Ouvert d'office sur la première pièce à décider : on approuve sur pièce.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, i: number) => open[id] ?? (!!decide && i === 0);
  const colSpan = decide ? 9 : 8;
  // Motif obligatoire pour refuser : sans motif, la ligne se déplie sur le champ, en erreur.
  const reject = (id: string) => {
    const reason = (reasons[id] ?? '').trim();
    if (!reason) {
      setOpen(o => ({ ...o, [id]: true })); setMissing(m => ({ ...m, [id]: true }));
      setTimeout(() => document.getElementById(`approval-reason-${id}`)?.focus(), 0);
      return;
    }
    decide?.(id, 'reject', reasons[id]);
  };
  return (
    <DataPanel label={label} footer={<TableFooter note={footer} />}>
      <table className="odoo-table">
        <thead>
          <tr>
            <th style={{ width: 44 }}><span className="sr-only">Détail</span></th>
            <th>Pièce</th><th>Objet</th>
            {decide && <th>Demandeur</th>}
            <th>Demandée le</th><th>Règle</th>
            <th className="ds-num">Montant ({currencySymbol()})</th>
            <th>Statut</th>
            <th className="ds-actions">{decide ? 'Décision' : <span className="sr-only">Actions</span>}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const opened = isOpen(r.id, i);
            const late = r.steps.some(s => s.status === 'pending' && s.escalated_at);
            return (
              <Fragment key={r.id}>
                <tr onClick={() => setOpen(o => ({ ...o, [r.id]: !opened }))} style={{ cursor: 'pointer' }}>
                  <td>
                    <button type="button" className="ds-icon-btn" aria-expanded={opened}
                      aria-label={`${opened ? 'Replier' : 'Afficher'} le détail de ${r.doc_label}`}
                      onClick={e => { e.stopPropagation(); setOpen(o => ({ ...o, [r.id]: !opened })); }}>
                      {opened ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </td>
                  <td className="ds-ref">{r.doc_label}</td>
                  <td>{DOC_TYPES[r.doc_type]?.label ?? r.doc_type}{r.store_name && <div style={muted}>{r.store_name}</div>}</td>
                  {decide && <td>{r.requested_by_name ?? '—'}</td>}
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.requested_at)}</td>
                  <td>{r.rule_label}</td>
                  <td className="ds-num ds-strong">{amount(r.amount)}</td>
                  <td>
                    <RequestStatusTag status={r.status} />
                    {r.status === 'pending' && late && <span style={{ marginLeft: 4 }}><StatusTag tone="late" label="En retard" /></span>}
                    {r.apply_error && <span style={{ marginLeft: 4 }}><StatusTag tone="blocked" label="Effet non appliqué" /></span>}
                  </td>
                  <td className="ds-actions" onClick={e => e.stopPropagation()}>
                    {decide && r.status === 'pending' && (
                      <>
                        <button type="button" className="ds-btn-danger ds-btn-sm" disabled={busy} onClick={() => reject(r.id)}>Refuser</button>
                        <button type="button" className="odoo-btn-primary ds-btn-sm" disabled={busy} onClick={() => decide(r.id, 'approve', reasons[r.id] ?? '')}>Approuver</button>
                      </>
                    )}
                    {cancel && r.status === 'pending' && (
                      <button type="button" className="odoo-btn-secondary ds-btn-sm" disabled={busy} onClick={() => cancel(r.id)}>Retirer</button>
                    )}
                  </td>
                </tr>
                {opened && (
                  <tr>
                    <td colSpan={colSpan} style={{ background: 'var(--ds-bg)', height: 'auto' }}>
                      <RequestDetail r={r}
                        reason={decide ? reasons[r.id] ?? '' : undefined}
                        onReason={decide ? v => { setReasons(x => ({ ...x, [r.id]: v })); if (v.trim()) setMissing(m => ({ ...m, [r.id]: false })); } : undefined}
                        reasonError={!!missing[r.id]} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </DataPanel>
  );
}

type TabKey = 'inbox' | 'mine' | 'history' | 'delegations';

export default function ApprovalsPage() {
  // Monté dans Achats (la coquille pose déjà fil d'Ariane, titre et description) ou seul sur /approvals.
  const standalone = useLocation().pathname.startsWith('/approvals');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const [tab, setTab] = useState<TabKey>('inbox');
  const [histStatus, setHistStatus] = useState('');

  const inbox = useQuery({ queryKey: ['approvals', 'inbox'], queryFn: approvalsApi.inbox });
  const mine = useQuery({ queryKey: ['approvals', 'mine'], queryFn: approvalsApi.mine });
  const rules = useQuery({ queryKey: ['approvals', 'rules'], queryFn: approvalsApi.rules, enabled: isManager });
  const history = useQuery({ queryKey: ['approvals', 'history', histStatus], queryFn: () => approvalsApi.history({ status: histStatus || undefined, limit: 100 }), enabled: tab === 'history' && isManager });
  const statsHistory = useQuery({ queryKey: ['approvals', 'stats-history'], queryFn: () => approvalsApi.history({ limit: 300 }), enabled: isManager });

  // ── Synthèse : métriques d'aide à la décision ───────────────────────────
  const now = Date.now();
  const inboxRows = inbox.data ?? [];
  const pendingAmount = inboxRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const overdue = inboxRows.filter(r => r.steps.some(s => s.status === 'pending' && (s.escalated_at || (s.due_at && Date.parse(s.due_at) < now)))).length;
  const myPending = (mine.data ?? []).filter(r => r.status === 'pending').length;
  const rulesData = rules.data ?? [];
  const req30 = rulesData.reduce((s, r) => s + (r.requests_30d || 0), 0);
  const rej30 = rulesData.reduce((s, r) => s + (r.rejected_30d || 0), 0);
  const activeRules = rulesData.filter(r => r.enabled).length;
  const approveRate = req30 > 0 ? Math.round((1 - rej30 / req30) * 100) : null;
  const decided = (statsHistory.data?.rows ?? []).filter(r => (r.status === 'approved' || r.status === 'rejected') && r.decided_at);
  const avgHours = decided.length ? decided.reduce((s, r) => s + (Date.parse(r.decided_at!) - Date.parse(r.requested_at)) / 3_600_000, 0) / decided.length : null;
  const avgDelay = avgHours == null ? '—' : avgHours < 24 ? `${avgHours.toFixed(1)} h` : `${(avgHours / 24).toFixed(1)} j`;
  // Répartition des pièces en attente par type.
  const byType = Object.entries(inboxRows.reduce((m, r) => { const k = DOC_TYPES[r.doc_type]?.label ?? r.doc_type; m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
  const delegations = useQuery({ queryKey: ['approvals', 'delegations'], queryFn: approvalsApi.delegations });
  const delegates = useQuery({ queryKey: ['approvals', 'delegates'], queryFn: approvalsApi.delegates, enabled: tab === 'delegations' });

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['approvals'] }); queryClient.invalidateQueries({ queryKey: ['notifications'] }); };
  const decideMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason: string }) =>
      action === 'approve' ? approvalsApi.approve(id, reason || undefined) : approvalsApi.reject(id, reason),
    onSuccess: (r, v) => {
      refresh();
      if (r.status === 'pending') notify.success('Étape approuvée. La demande passe à l\'étape suivante.');
      else if (v.action === 'approve') notify.success(r.apply_error ? `Approuvée, mais : ${r.apply_error}` : `Approuvée. ${DOC_TYPES[r.doc_type]?.effect ?? ''}`);
      else notify.success('Demande refusée, le demandeur est prévenu.');
    },
    onError: (err) => notify.error(apiErrorMessage(err, 'Décision refusée')),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.cancel(id),
    onSuccess: () => { refresh(); notify.success('Demande retirée'); },
    onError: (err) => notify.error(apiErrorMessage(err, 'Retrait refusé')),
  });
  const [delegate, setDelegate] = useState({ toUserId: '', startsOn: format(new Date(), 'yyyy-MM-dd'), endsOn: '' });
  const addDelegation = useMutation({
    mutationFn: () => approvalsApi.addDelegation({ toUserId: delegate.toUserId, startsOn: delegate.startsOn, endsOn: delegate.endsOn }),
    onSuccess: () => { refresh(); setDelegate(d => ({ ...d, toUserId: '', endsOn: '' })); notify.success('Délégation enregistrée'); },
    onError: (err) => notify.error(apiErrorMessage(err, 'Délégation refusée')),
  });
  const removeDelegation = useMutation({
    mutationFn: (id: string) => approvalsApi.removeDelegation(id),
    onSuccess: () => { refresh(); notify.success('Délégation retirée'); },
    onError: (err) => notify.error(apiErrorMessage(err, 'Retrait refusé')),
  });

  const today = format(new Date(), 'yyyy-MM-dd');
  const activeDelegations = (delegations.data ?? []).filter(d => d.starts_on.slice(0, 10) <= today && d.ends_on.slice(0, 10) >= today).length;
  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'inbox', label: 'À approuver', count: inboxRows.length },
    { key: 'mine', label: 'Mes demandes', count: myPending },
    ...(isManager ? [{ key: 'history' as const, label: 'Traitées (30 j)', count: req30 }] : []),
    { key: 'delegations', label: 'Délégations', count: activeDelegations },
  ];
  const pipelineSummary = isManager
    ? `Taux d'approbation ${approveRate == null ? '—' : `${approveRate} %`} · délai moyen ${avgDelay} · ${activeRules} circuit${activeRules > 1 ? 's' : ''} actif${activeRules > 1 ? 's' : ''}`
    : `${inboxRows.length} pièce${inboxRows.length > 1 ? 's' : ''} en attente de votre décision`;
  const histRows = statsHistory.data?.rows ?? [];
  const delegateButton = (
    <button type="button" className="odoo-btn-secondary" onClick={() => setTab('delegations')}>
      <UserCheck size={14} aria-hidden="true" /> Déléguer
    </button>
  );

  const content = (
    <>
      <KpiGrid>
        <KpiCard label="À approuver" value={String(inboxRows.length)}
          sub={overdue > 0 ? `${overdue} en retard` : pendingAmount > 0 ? money(pendingAmount) : 'en attente de votre décision'} tone={overdue > 0 ? 'red' : undefined} />
        <KpiCard label="Mes demandes en attente" value={String(myPending)} sub="pièces que j'ai soumises" />
        {isManager && <KpiCard label="Taux d'approbation" value={approveRate == null ? '—' : `${approveRate} %`} sub={`${req30} demande${req30 > 1 ? 's' : ''} sur 30 jours${rej30 > 0 ? ` · ${rej30} refus` : ''}`} />}
        {isManager && <KpiCard label="Délai moyen de décision" value={avgDelay} sub={`${activeRules} circuit${activeRules > 1 ? 's' : ''} actif${activeRules > 1 ? 's' : ''}`} />}
      </KpiGrid>

      <Tabs label="Vues des approbations" value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'inbox' && (
        inbox.isLoading ? <LoadingState /> : !inboxRows.length ? (
          <EmptyState icon={CheckCircle2} title="Rien à approuver" text="Aucune pièce n'attend votre décision : tout est traité." />
        ) : (
          <RequestsTable rows={inboxRows} label="Pièces à approuver" busy={decideMutation.isPending}
            footer={`${inboxRows.length} pièce${inboxRows.length > 1 ? 's' : ''}${pendingAmount > 0 ? ` · ${money(pendingAmount)}` : ''}${byType.length ? ` · ${byType.map(([l, n]) => `${l} ${n}`).join(', ')}` : ''}`}
            decide={(id, action, reason) => decideMutation.mutate({ id, action, reason })} />
        )
      )}

      {tab === 'mine' && (
        mine.isLoading ? <LoadingState /> : !mine.data?.length ? (
          <EmptyState icon={Send} title="Aucune demande" text="Vous n'avez soumis aucune pièce à approbation." />
        ) : (
          <RequestsTable rows={mine.data} label="Mes demandes" busy={cancelMutation.isPending}
            footer={`${mine.data.length} demande${mine.data.length > 1 ? 's' : ''} · ${myPending} en attente`}
            cancel={async id => { if (await confirm('Retirer cette demande ? La pièce reste en attente, vous pourrez la soumettre de nouveau.')) cancelMutation.mutate(id); }} />
        )
      )}

      {tab === 'history' && isManager && (
        <>
          <FilterChips label="Filtrer par statut" value={histStatus} onChange={setHistStatus} chips={[
            { key: '', label: 'Tous les statuts', count: histRows.length },
            ...(['approved', 'rejected', 'pending', 'cancelled'] as const).map(st => ({
              key: st, label: APPROVAL_REQUEST_STATUS_LABELS[st], count: histRows.filter(r => r.status === st).length,
            })),
          ]} />
          {history.isLoading ? <LoadingState /> : !history.data?.rows.length ? (
            <EmptyState icon={History} title="Aucune demande" text="Les demandes traitées sur les 30 derniers jours s'affichent ici." />
          ) : (
            <DataPanel label="Demandes traitées"
              footer={<TableFooter note={`${history.data.total} demande${history.data.total > 1 ? 's' : ''}${avgHours != null ? ` · délai moyen ${avgDelay}` : ''}`} />}>
              <table className="odoo-table">
                <thead><tr><th>Pièce</th><th>Objet</th><th>Demandeur</th><th>Demandée le</th><th>Règle</th><th className="ds-num">Montant ({currencySymbol()})</th><th>Statut</th><th>Décidée par</th><th>Motif</th></tr></thead>
                <tbody>
                  {history.data.rows.map(r => (
                    <tr key={r.id}>
                      <td className="ds-ref">{r.doc_label}</td>
                      <td>{DOC_TYPES[r.doc_type]?.label ?? r.doc_type}</td>
                      <td>{r.requested_by_name ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.requested_at)}</td>
                      <td>{r.rule_label}</td>
                      <td className="ds-num ds-strong">{amount(r.amount)}</td>
                      <td><RequestStatusTag status={r.status} />{r.apply_error && <span style={{ marginLeft: 4 }}><StatusTag tone="blocked" label="Effet non appliqué" /></span>}</td>
                      <td>{r.decided_by_name ?? '—'}{r.decided_at && <div style={{ ...muted, whiteSpace: 'nowrap' }}>{when(r.decided_at)}</div>}</td>
                      <td>{r.decision_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          )}
        </>
      )}

      {tab === 'delegations' && (
        <>
          <SectionHeader title="Nouvelle délégation" note="Le délégué tranche à ma place entre les deux dates ; chaque décision reste signée de son nom." />
          <section className="ds-panel" aria-label="Nouvelle délégation" style={{ padding: 20, overflow: 'visible' }}>
            <div className="ds-form-grid cols-4" style={{ alignItems: 'end' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <FormField label="Délégué" required>
                  <SearchSelect size="md" width="100%" ariaLabel="Délégué" placeholder="Choisir…" value={delegate.toUserId}
                    onChange={id => setDelegate({ ...delegate, toUserId: id })}
                    options={(delegates.data ?? []).map(d => ({ id: d.id, label: d.name, sublabel: d.role_label }))} />
                </FormField>
              </div>
              <FormField label="Du" htmlFor="delegation-start" required>
                <input id="delegation-start" className="ds-input" type="date" value={delegate.startsOn} onChange={e => setDelegate({ ...delegate, startsOn: e.target.value })} />
              </FormField>
              <FormField label="Au" htmlFor="delegation-end" required>
                <input id="delegation-end" className="ds-input" type="date" value={delegate.endsOn} min={delegate.startsOn} onChange={e => setDelegate({ ...delegate, endsOn: e.target.value })} />
              </FormField>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="odoo-btn-primary" disabled={!delegate.toUserId || !delegate.endsOn || addDelegation.isPending} onClick={() => addDelegation.mutate()}>Enregistrer la délégation</button>
            </div>
          </section>

          <SectionHeader title="Délégations enregistrées" note={activeDelegations > 0 ? `${activeDelegations} active${activeDelegations > 1 ? 's' : ''}` : undefined} />
          {delegations.isLoading ? <LoadingState /> : !delegations.data?.length ? (
            <EmptyState icon={UserCheck} title="Aucune délégation" text="Déléguez vos approbations pendant une absence pour que les pièces ne restent pas bloquées." />
          ) : (
            <DataPanel label="Délégations enregistrées" footer={<TableFooter note={`${delegations.data.length} délégation${delegations.data.length > 1 ? 's' : ''}`} />}>
              <table className="odoo-table">
                <thead><tr><th>De</th><th>À</th><th>Du</th><th>Au</th><th>Statut</th><th className="ds-actions"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {delegations.data.map(d => {
                    const active = d.starts_on.slice(0, 10) <= today && d.ends_on.slice(0, 10) >= today;
                    const ended = d.ends_on.slice(0, 10) < today;
                    return (
                      <tr key={d.id}>
                        <td className="ds-strong">{d.from_name}{d.from_user_id === user?.id && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>moi</span>}</td>
                        <td>{d.to_name}{d.to_user_id === user?.id && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>moi</span>}</td>
                        <td>{dateOnly(d.starts_on)}</td>
                        <td>{dateOnly(d.ends_on)}</td>
                        <td><StatusTag tone={active ? 'done' : ended ? 'cancelled' : 'draft'} label={active ? 'Active' : ended ? 'Terminée' : 'À venir'} /></td>
                        <td className="ds-actions">
                          {(d.from_user_id === user?.id || user?.role === 'admin') && (
                            <button type="button" className="ds-btn-danger ds-btn-sm" disabled={removeDelegation.isPending}
                              onClick={async () => { if (await confirm(`Retirer la délégation de ${d.from_name} à ${d.to_name} ?`, { title: 'Retirer une délégation', confirmLabel: 'Retirer', danger: true })) removeDelegation.mutate(d.id); }}>
                              Retirer
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DataPanel>
          )}
        </>
      )}
    </>
  );

  // Dans Achats : pas de seconde barre ni de second titre, le bouton va dans l'en-tête du module.
  if (!standalone) return <><PurHeaderActions>{delegateButton}</PurHeaderActions>{content}</>;
  return (
    <div className="approvals-page">
      <SalesPageShell icon={ClipboardCheck} title="Approbations" summary={pipelineSummary} actions={delegateButton}>
        {content}
      </SalesPageShell>
    </div>
  );
}
