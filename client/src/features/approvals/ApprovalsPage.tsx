import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, CheckCircle2, XCircle, Clock, Inbox, Send, History, UserCheck, Trash2, Loader2, ChevronDown, ChevronRight, FileDown, Truck } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ROLE_LABELS, APPROVAL_DOC_TYPES, APPROVAL_REQUEST_STATUS_LABELS, type ApprovalDocTypeDef } from '@ofauria/shared';
import { approvalsApi, apiErrorMessage, type ApprovalRequest } from '../../api/approvals.api';
import { useAuth } from '../../context/AuthContext';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { purchaseOrdersApi } from '../../api/purchase-orders.api';

/**
 * Boîte « À approuver » (lot 8). Les demandes que je peux trancher, celles
 * que j'ai faites, l'historique (admin / gérant) et mes délégations.
 */

const DOC_TYPES = APPROVAL_DOC_TYPES as Record<string, ApprovalDocTypeDef>;
const money = (v: string | number | null | undefined) => v === null || v === undefined ? '' : `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
const when = (d: string) => format(new Date(d), 'dd MMM yyyy à HH:mm', { locale: fr });
const statusTag: Record<string, string> = { pending: 'odoo-tag-orange', approved: 'odoo-tag-green', rejected: 'odoo-tag-red', cancelled: 'odoo-tag-grey' };
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
              {s.status === 'pending' && <span className="odoo-tag odoo-tag-orange" style={{ marginLeft: 6 }}>En cours</span>}
              {s.status === 'approved' && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6 }}>Approuvée</span>}
              {s.status === 'rejected' && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 6 }}>Refusée</span>}
              {s.status === 'skipped' && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>Sans objet</span>}
            </div>
            <div className="ui-timeline-detail">
              {done && s.decided_at && <>{s.decided_by_name} · {when(s.decided_at)}{s.reason ? ` · ${s.reason}` : ''}</>}
              {s.status === 'pending' && s.due_at && <><Clock size={11} style={{ verticalAlign: -1 }} /> attendue avant le {when(s.due_at)}{s.escalated_at ? ' · en retard, administrateur prévenu' : ''}</>}
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
const dateOnly = (d: unknown) => (d ? format(new Date(String(d)), 'dd MMM yyyy', { locale: fr }) : '—');

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
  if (isLoading) return <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}><Loader2 size={12} className="animate-spin" style={{ verticalAlign: -2 }} /> Chargement du bon…</div>;
  if (isError || !po) return <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>Détails du bon non accessibles avec votre profil.</div>;

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
  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--odoo-border)', fontSize: '0.8125rem' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: '0.8125rem' }}>
        <div>
          <div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}><Truck size={11} /> Fournisseur</div>
          <div style={{ fontWeight: 600 }}>{po.supplier_name}</div>
          {(po.supplier_contact || po.supplier_phone) && (
            <div style={{ color: 'var(--odoo-text-muted)' }}>{[po.supplier_contact, po.supplier_phone].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <div>
          <div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Commandé le</div>
          <div>{dateOnly(po.order_date)}{po.created_by_name ? ` par ${po.created_by_name}` : ''}</div>
        </div>
        <div>
          <div style={{ color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Livraison prévue</div>
          <div>{dateOnly(po.expected_delivery_date)}</div>
        </div>
      </div>
      {po.notes && <div style={{ fontSize: '0.8125rem' }}><b>Notes :</b> {po.notes}</div>}
      <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--odoo-bg-alt, #f8f9fa)', textAlign: 'left' }}>
              <th style={{ ...cell, fontWeight: 600 }}>Article</th>
              <th style={{ ...num, fontWeight: 600 }}>Quantité</th>
              <th style={{ ...num, fontWeight: 600 }}>Prix unit. HT</th>
              <th style={{ ...num, fontWeight: 600 }}>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => {
              const tag = KIND_TAG[it.kind as string];
              const lineTotal = Number(it.quantity_ordered ?? 0) * Number(it.unit_price ?? 0);
              return (
                <tr key={it.id as string}>
                  <td style={cell}>
                    {it.ingredient_name as string}
                    {tag && <span className={`odoo-tag ${tag.cls}`} style={{ marginLeft: 6, fontSize: '0.625rem' }}>{tag.label}</span>}
                  </td>
                  <td style={num}>
                    {qty(it.quantity_ordered)} {it.ingredient_unit === 'unit' ? 'u' : it.ingredient_unit}
                    {it.line_container_label && Number(it.qty_container) > 0 && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{qty(it.qty_container)} × {String(it.line_container_label).toLowerCase()}</div>
                    )}
                  </td>
                  <td style={num}>{it.unit_price != null ? money(it.unit_price) : <span style={{ color: '#b45309' }}>à définir</span>}</td>
                  <td style={{ ...num, fontWeight: 600 }}>{money(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ ...cell, borderBottom: 'none', textAlign: 'right', fontWeight: 600 }}>{items.length} ligne{items.length > 1 ? 's' : ''} · Total HT</td>
              <td style={{ ...num, borderBottom: 'none', fontWeight: 700 }}>{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div>
        <button type="button" className="odoo-btn-secondary" onClick={downloadPdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FileDown size={13} /> Voir le PDF du bon
        </button>
      </div>
    </div>
  );
}

function RequestCard({ r, decide, cancel }: {
  r: ApprovalRequest;
  decide?: (id: string, action: 'approve' | 'reject', reason: string) => void;
  cancel?: (id: string) => void;
}) {
  const [reason, setReason] = useState('');
  // Ouvert d'office quand il faut décider : on approuve sur pièce.
  const [showDetails, setShowDetails] = useState(!!decide && r.status === 'pending');
  const values = r.summary?.values ?? {};
  const def = DOC_TYPES[r.doc_type];
  return (
    <article style={{ border: '1px solid var(--odoo-border)', borderRadius: 8, padding: 14, display: 'grid', gap: 10, background: 'var(--odoo-bg-card, var(--odoo-bg))' }}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{r.doc_label}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
            {def?.label ?? r.doc_type} · règle « {r.rule_label} » ({r.summary?.condition ?? 'toujours'})
            {r.store_name ? ` · ${r.store_name}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {r.amount && <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</span>}
          <span className={`odoo-tag ${statusTag[r.status]}`}>{APPROVAL_REQUEST_STATUS_LABELS[r.status]}</span>
        </div>
      </header>
      <div style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
        Demandé par <b style={{ color: 'var(--odoo-text)' }}>{r.requested_by_name}</b> le {when(r.requested_at)}
        {Object.keys(values).length > 0 && (
          <> · {Object.entries(values).map(([k, v]) => `${def?.fields[k]?.label ?? k} : ${typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : String(v)}${def?.fields[k]?.unit ? ` ${def.fields[k].unit}` : ''}`).join(' · ')}</>
        )}
      </div>
      {r.doc_type === 'purchase_order' && (
        <div style={{ border: '1px solid var(--odoo-border)', borderRadius: 6, padding: '8px 10px' }}>
          <button type="button" onClick={() => setShowDetails(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: '0.8125rem', width: '100%', textAlign: 'left' }}>
            {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Détails du bon de commande
          </button>
          {showDetails && <div style={{ marginTop: 10 }}><PurchaseOrderDetails poId={r.doc_id} /></div>}
        </div>
      )}
      <Steps r={r} />
      {r.status !== 'pending' && r.decision_reason && <div style={{ fontSize: '0.8125rem' }}><b>Motif :</b> {r.decision_reason}</div>}
      {r.status === 'approved' && r.apply_error && (
        <StatusBanner tone="danger" icon={XCircle} title="Approuvée, mais l'effet n'a pas pu être appliqué">{r.apply_error}</StatusBanner>
      )}
      {r.status === 'approved' && r.applied_at && !r.apply_error && (
        <div style={{ fontSize: '0.8125rem', color: '#155724' }}><CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> {def?.effect}</div>
      )}
      {decide && r.status === 'pending' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <textarea id={`approval-reason-${r.id}`} value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Motif (obligatoire pour refuser, facultatif pour approuver)"
            style={{ width: '100%', fontSize: '0.8125rem', padding: '6px 8px', border: '1px solid var(--odoo-border)', borderRadius: 6, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="odoo-btn-danger" disabled={!reason.trim()} onClick={() => decide(r.id, 'reject', reason)}><XCircle size={14} /> Refuser</button>
            <button type="button" className="odoo-btn-primary" onClick={() => decide(r.id, 'approve', reason)}><CheckCircle2 size={14} /> Approuver</button>
          </div>
        </div>
      )}
      {cancel && r.status === 'pending' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="odoo-btn-secondary" onClick={() => cancel(r.id)}>Retirer la demande</button>
        </div>
      )}
    </article>
  );
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const [tab, setTab] = useState<'inbox' | 'mine' | 'history' | 'delegations'>('inbox');
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
  const delegations = useQuery({ queryKey: ['approvals', 'delegations'], queryFn: approvalsApi.delegations, enabled: tab === 'delegations' });
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

  const tabs = [
    { key: 'inbox' as const, label: 'À approuver', icon: Inbox, count: inbox.data?.length },
    { key: 'mine' as const, label: 'Mes demandes', icon: Send },
    ...(isManager ? [{ key: 'history' as const, label: 'Historique', icon: History }] : []),
    { key: 'delegations' as const, label: 'Délégations', icon: UserCheck },
  ];

  return (
    <div className="odoo-scope p-6" style={{ display: 'grid', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div className="odoo-form-header">
        <div>
          <h1 className="odoo-form-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardCheck size={22} /> Approbations</h1>
          <p className="odoo-form-subtitle">Bons de commande au-dessus du seuil, annulations de factures, écarts d'inventaire : les pièces qui attendent une décision.</p>
        </div>
      </div>
      {/* Synthèse décisionnelle */}
      <div className="odoo-stat-grid" style={{ border: '1px solid var(--odoo-border)', borderRadius: 4 }}>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">À approuver</div>
          <div className="odoo-stat-card-value" style={{ color: inboxRows.length ? 'var(--odoo-primary, #714B67)' : undefined }}>{inboxRows.length}</div>
          <div className="odoo-stat-card-sub">{pendingAmount > 0 ? `${money(pendingAmount)} en attente` : 'pièces en attente de décision'}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">En retard</div>
          <div className="odoo-stat-card-value" style={{ color: overdue > 0 ? '#dc3545' : undefined }}>{overdue}</div>
          <div className="odoo-stat-card-sub">{overdue > 0 ? 'échéance dépassée / escaladées' : 'aucune escalade'}</div>
        </div>
        <div className="odoo-stat-card" style={{ cursor: 'default' }}>
          <div className="odoo-stat-card-label">Mes demandes en cours</div>
          <div className="odoo-stat-card-value">{myPending}</div>
          <div className="odoo-stat-card-sub">pièces que j'ai soumises</div>
        </div>
        {isManager && <>
          <div className="odoo-stat-card" style={{ cursor: 'default' }}>
            <div className="odoo-stat-card-label">Demandes (30 j)</div>
            <div className="odoo-stat-card-value">{req30}</div>
            <div className="odoo-stat-card-sub">{rej30} rejetée{rej30 > 1 ? 's' : ''}</div>
          </div>
          <div className="odoo-stat-card" style={{ cursor: 'default' }}>
            <div className="odoo-stat-card-label">Taux d'approbation</div>
            <div className="odoo-stat-card-value">{approveRate == null ? '—' : `${approveRate} %`}</div>
            <div className="odoo-stat-card-sub">sur 30 jours</div>
          </div>
          <div className="odoo-stat-card" style={{ cursor: 'default' }}>
            <div className="odoo-stat-card-label">Délai moyen de décision</div>
            <div className="odoo-stat-card-value">{avgDelay}</div>
            <div className="odoo-stat-card-sub">{activeRules} circuit{activeRules > 1 ? 's' : ''} actif{activeRules > 1 ? 's' : ''}</div>
          </div>
        </>}
      </div>

      <div className="odoo-tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`odoo-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <t.icon size={14} /> {t.label}{t.count ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {tab === 'inbox' && (
        <section style={{ display: 'grid', gap: 12 }}>
          {inbox.isLoading && <Loader2 className="animate-spin" size={18} />}
          {!inbox.isLoading && !inbox.data?.length && (
            <StatusBanner tone="success" icon={CheckCircle2} title="Rien à approuver">Aucune pièce n'attend votre décision — tout est traité.</StatusBanner>
          )}
          {inboxRows.length > 0 && byType.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>
              <span>{inboxRows.length} pièce(s){pendingAmount > 0 ? ` · ${money(pendingAmount)}` : ''} :</span>
              {byType.map(([label, n]) => <span key={label} className="odoo-tag odoo-tag-grey">{label} · {n}</span>)}
            </div>
          )}
          {inbox.data?.map(r => <RequestCard key={r.id} r={r} decide={(id, action, reason) => decideMutation.mutate({ id, action, reason })} />)}
        </section>
      )}

      {tab === 'mine' && (
        <section style={{ display: 'grid', gap: 12 }}>
          {mine.isLoading && <Loader2 className="animate-spin" size={18} />}
          {!mine.isLoading && !mine.data?.length && <StatusBanner tone="neutral" icon={Send} title="Aucune demande">Vous n'avez soumis aucune pièce à approbation.</StatusBanner>}
          {mine.data?.map(r => <RequestCard key={r.id} r={r} cancel={async id => { if (await confirm('Retirer cette demande ? La pièce reste en attente, vous pourrez la soumettre de nouveau.')) cancelMutation.mutate(id); }} />)}
        </section>
      )}

      {tab === 'history' && isManager && (
        <section style={{ display: 'grid', gap: 12 }}>
          <div className="odoo-control-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select id="approval-history-status" aria-label="Filtrer par statut" value={histStatus} onChange={e => setHistStatus(e.target.value)}
              style={{ fontSize: '0.8125rem', padding: '4px 6px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }}>
              <option value="">Tous les statuts</option>
              {Object.entries(APPROVAL_REQUEST_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {history.data && <span style={{ fontSize: '0.8125rem', color: 'var(--odoo-text-muted)' }}>{history.data.total} demande{history.data.total > 1 ? 's' : ''}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['approved', 'rejected', 'pending', 'cancelled'] as const).map(st => {
                const n = (statsHistory.data?.rows ?? []).filter(r => r.status === st).length;
                return n > 0 ? <span key={st} className={`odoo-tag ${statusTag[st]}`}>{APPROVAL_REQUEST_STATUS_LABELS[st]} · {n}</span> : null;
              })}
              {avgHours != null && <span className="odoo-tag odoo-tag-blue">délai moyen {avgDelay}</span>}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>Pièce</th><th>Règle</th><th style={{ textAlign: 'right' }}>Montant</th><th>Demandeur</th><th>Demandée le</th><th>Statut</th><th>Décidée par</th><th>Motif</th></tr></thead>
              <tbody>
                {history.data?.rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.doc_label}<div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)', fontWeight: 400 }}>{DOC_TYPES[r.doc_type]?.label}</div></td>
                    <td>{r.rule_label}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</td>
                    <td>{r.requested_by_name}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(r.requested_at)}</td>
                    <td><span className={`odoo-tag ${statusTag[r.status]}`}>{APPROVAL_REQUEST_STATUS_LABELS[r.status]}</span>{r.apply_error && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 4 }}>effet non appliqué</span>}</td>
                    <td>{r.decided_by_name ?? '—'}{r.decided_at && <div style={{ fontSize: '0.75rem', color: 'var(--odoo-text-muted)' }}>{when(r.decided_at)}</div>}</td>
                    <td style={{ fontSize: '0.8125rem' }}>{r.decision_reason ?? '—'}</td>
                  </tr>
                ))}
                {history.data && !history.data.rows.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>Aucune demande</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'delegations' && (
        <section style={{ display: 'grid', gap: 12 }}>
          <StatusBanner tone="neutral" icon={UserCheck} title="Déléguer mes approbations pendant une absence">
            Le délégué peut trancher les étapes qui m'attendent, à ma place, entre les deux dates. Chaque décision reste signée de son nom.
          </StatusBanner>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Délégué
              <select id="delegation-to" value={delegate.toUserId} onChange={e => setDelegate({ ...delegate, toUserId: e.target.value })}
                style={{ fontSize: '0.8125rem', padding: '4px 6px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)', minWidth: 220 }}>
                <option value="">Choisir…</option>
                {delegates.data?.map(d => <option key={d.id} value={d.id}>{d.name} · {d.role_label}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Du
              <input id="delegation-start" type="date" value={delegate.startsOn} onChange={e => setDelegate({ ...delegate, startsOn: e.target.value })}
                style={{ fontSize: '0.8125rem', padding: '4px 6px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: '0.8125rem' }}>Au
              <input id="delegation-end" type="date" value={delegate.endsOn} min={delegate.startsOn} onChange={e => setDelegate({ ...delegate, endsOn: e.target.value })}
                style={{ fontSize: '0.8125rem', padding: '4px 6px', border: '1px solid var(--odoo-border)', borderRadius: 4, background: 'var(--odoo-bg)', color: 'var(--odoo-text)' }} />
            </label>
            <button type="button" className="odoo-btn-primary" disabled={!delegate.toUserId || !delegate.endsOn || addDelegation.isPending} onClick={() => addDelegation.mutate()}>Déléguer</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="odoo-table">
              <thead><tr><th>De</th><th>À</th><th>Du</th><th>Au</th><th /></tr></thead>
              <tbody>
                {delegations.data?.map(d => {
                  const active = d.starts_on.slice(0, 10) <= format(new Date(), 'yyyy-MM-dd') && d.ends_on.slice(0, 10) >= format(new Date(), 'yyyy-MM-dd');
                  return (
                    <tr key={d.id} style={{ opacity: active ? 1 : 0.6 }}>
                      <td>{d.from_name}{d.from_user_id === user?.id && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>moi</span>}</td>
                      <td>{d.to_name}{d.to_user_id === user?.id && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 6 }}>moi</span>}</td>
                      <td>{format(new Date(d.starts_on), 'dd MMM yyyy', { locale: fr })}</td>
                      <td>{format(new Date(d.ends_on), 'dd MMM yyyy', { locale: fr })}{active && <span className="odoo-tag odoo-tag-green" style={{ marginLeft: 6 }}>active</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {(d.from_user_id === user?.id || user?.role === 'admin') && (
                          <button type="button" className="odoo-pager-btn" title="Retirer" aria-label="Retirer la délégation" style={{ color: '#dc3545' }} onClick={() => removeDelegation.mutate(d.id)}><Trash2 size={13} /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {delegations.data && !delegations.data.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--odoo-text-muted)' }}>Aucune délégation</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
