import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ordersApi } from '../../api/orders.api';
import { ORDER_STATUS_LABELS } from '@ofauria/shared';
import { format, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { getApiErrorMessage } from '../../utils/api-error';
import ModalBackdrop from '../../components/ui/ModalBackdrop';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { StatusBanner } from '../../components/ui/StatusBanner';
import { StagePipeline, StageProgress, SelectFilter, type StageDef, type StageStat } from '../../components/purchasing/ProcessBoard';
import {
  ClipboardList, Plus, Phone, Pencil, Search, Eye, X,
  Clock, CheckCircle2, Factory, Truck, Ban, CalendarDays,
  Banknote, CreditCard, Package, PackageCheck, FileText,
  AlertTriangle, Trash2, Loader2, Tag, User,
} from 'lucide-react';
import OrderFormModal from '../../components/orders/OrderFormModal';

/* ═══════════════════════ Référentiel d'affichage ═══════════════════════ */

type OrderRow = Record<string, any>;

/** Étapes du cycle de vie d'une commande client (même grammaire que les BC / factures). */
const STAGES: StageDef[] = [
  { key: 'pending',       label: 'Brouillon',     hint: 'à confirmer',        icon: Clock },
  { key: 'confirmed',     label: 'Confirmées',    hint: 'à lancer',           icon: CheckCircle2 },
  { key: 'in_production', label: 'En production', hint: 'en atelier',         icon: Factory },
  { key: 'ready',         label: 'Prêtes',        hint: 'à livrer',           icon: Package },
  { key: 'completed',     label: 'Terminées',     hint: 'livrées',            icon: Truck },
];
const STAGE_KEYS = STAGES.map(s => s.key);

const STATUS_TAG: Record<string, string> = {
  pending: 'odoo-tag-grey',
  confirmed: 'odoo-tag-blue',
  in_production: 'odoo-tag-yellow',
  ready: 'odoo-tag-green',
  completed: 'odoo-tag-purple',
  cancelled: 'odoo-tag-red',
};
const STATUS_DOT: Record<string, string> = {
  pending: 'neutral', confirmed: 'warning', in_production: 'warning',
  ready: 'ok', completed: 'ok', cancelled: 'danger',
};

const TYPE_LABELS: Record<string, string> = { custom: 'Sur mesure', online: 'En ligne', event: 'Événement', staff: 'Personnel' };
const TYPE_TAG: Record<string, string> = { custom: 'odoo-tag-purple', online: 'odoo-tag-blue', event: 'odoo-tag-orange', staff: 'odoo-tag-grey' };

const FILTER_CHIPS: Array<{ key: string; label: string; icon: typeof Clock }> = [
  { key: '', label: 'Toutes', icon: ClipboardList },
  { key: 'pending', label: 'Brouillon', icon: Clock },
  { key: 'confirmed', label: 'Confirmées', icon: CheckCircle2 },
  { key: 'in_production', label: 'En production', icon: Factory },
  { key: 'ready', label: 'Prêtes', icon: Package },
  { key: 'completed', label: 'Terminées', icon: Truck },
  { key: 'cancelled', label: 'Annulées', icon: Ban },
];

const OPEN_STATUSES = new Set(['pending', 'confirmed', 'in_production', 'ready']);

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function num(v: unknown) { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0; }
function customerName(o: OrderRow) {
  return o.customer_first_name ? `${o.customer_first_name} ${o.customer_last_name || ''}`.trim() : '—';
}
function fmtDate(d: unknown, pattern = 'dd MMM yyyy') {
  return d ? format(new Date(String(d)), pattern, { locale: fr }) : '—';
}
/** Commande en cours dont la date de retrait est dépassée. */
function isLate(o: OrderRow, today: Date) {
  if (!OPEN_STATUSES.has(o.status as string) || !o.pickup_date) return false;
  return startOfDay(new Date(o.pickup_date as string)) < today;
}

/* Styles partagés des fenêtres (mêmes valeurs que les modales Achats). */
const modalPanelStyle: CSSProperties = {
  backgroundColor: 'var(--odoo-bg)', border: '1px solid var(--odoo-border)',
  borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
};
const modalHeaderStyle: CSSProperties = { backgroundColor: 'var(--theme-accent)', padding: '0.875rem 1.25rem', color: '#fff' };
const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.03em', color: 'var(--odoo-text-muted)', marginBottom: 4,
};
const fieldStyle: CSSProperties = {
  width: '100%', padding: '0.375rem 0.5rem', border: '1px solid var(--odoo-border)',
  borderRadius: 4, fontSize: '0.8125rem', backgroundColor: 'var(--odoo-bg)', color: 'var(--odoo-text)',
};
const sectionStyle: CSSProperties = { border: '1px solid var(--odoo-border)', borderRadius: 4, overflow: 'hidden' };

/* ═══════════════════════ Page ═══════════════════════ */

export default function OrdersPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRow | null>(null);
  const [viewingOrder, setViewingOrder] = useState<OrderRow | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<OrderRow | null>(null);

  // Une seule lecture : les compteurs du pipeline et la liste partagent la même source,
  // le filtrage par statut se fait côté client (le serveur pagine à 20 par défaut).
  const { data, isLoading } = useQuery({
    queryKey: ['orders', { all: true }],
    queryFn: () => ordersApi.list({ limit: '500' }),
  });
  const orders: OrderRow[] = data?.data || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['orders'] });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ordersApi.updateStatus(id, status),
    onSuccess: () => { invalidate(); notify.success('Statut mis à jour'); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la mise à jour')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ordersApi.remove(id),
    onSuccess: () => { invalidate(); notify.success('Commande supprimée'); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Impossible de supprimer la commande')),
  });

  const today = startOfDay(new Date());

  /* ── Compteurs du pipeline ── */
  const stageStats = useMemo(() => {
    const stats: Record<string, StageStat> = {};
    for (const key of STAGE_KEYS) stats[key] = { count: 0, sub: '', late: 0 };
    const totals: Record<string, number> = {};
    for (const o of orders) {
      const s = o.status as string;
      if (!stats[s]) continue;
      stats[s].count += 1;
      totals[s] = (totals[s] || 0) + num(o.total);
      if (isLate(o, today)) stats[s].late = (stats[s].late || 0) + 1;
    }
    for (const key of STAGE_KEYS) stats[key].sub = `${n(totals[key] || 0)} DH`;
    return stats;
  }, [orders, today]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': orders.length };
    for (const o of orders) c[o.status as string] = (c[o.status as string] || 0) + 1;
    return c;
  }, [orders]);
  const openCount = orders.filter(o => OPEN_STATUSES.has(o.status as string)).length;
  const lateOrders = useMemo(() => orders.filter(o => isLate(o, today)), [orders, today]);

  const typeOptions = useMemo(() => {
    const seen = new Set(orders.map(o => o.type as string).filter(Boolean));
    return Array.from(seen).map(k => ({ key: k, label: TYPE_LABELS[k] || k }));
  }, [orders]);

  /* ── Liste filtrée ── */
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (typeFilter && o.type !== typeFilter) return false;
      if (lateOnly && !isLate(o, today)) return false;
      if (!q) return true;
      return (
        String(o.order_number || '').toLowerCase().includes(q) ||
        customerName(o).toLowerCase().includes(q) ||
        String(o.customer_phone || '').toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, typeFilter, lateOnly, searchQuery, today]);

  const filteredTotal = filteredOrders.reduce((s, o) => s + num(o.total), 0);
  const hasFilters = !!(statusFilter || typeFilter || lateOnly || searchQuery);

  const cancelOrder = async (o: OrderRow) => {
    if (await confirm(`Annuler la commande ${o.order_number} ?`, { title: 'Annuler la commande', confirmLabel: 'Annuler la commande', cancelLabel: 'Retour', danger: true })) {
      updateStatusMutation.mutate({ id: o.id as string, status: 'cancelled' });
    }
  };
  const removeOrder = async (o: OrderRow) => {
    if (await confirm(`Supprimer définitivement la commande annulée ${o.order_number} ?`, { title: 'Supprimer la commande', confirmLabel: 'Supprimer', danger: true })) {
      deleteMutation.mutate(o.id as string);
    }
  };

  const chipStyle = (active: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    backgroundColor: active ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
    color: active ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div className="odoo-scope" style={{ minHeight: '100%' }}>
      {/* Control bar */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <ClipboardList size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Commandes</span>
          <span className="odoo-breadcrumb-separator">/</span>
          <span className="odoo-breadcrumb-current">Commandes clients</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary">
          <Plus size={13} /> Nouvelle commande
        </button>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Alerte retards */}
        {lateOrders.length > 0 && (
          <StatusBanner tone="danger" icon={AlertTriangle}
            title={`${lateOrders.length} commande${lateOrders.length > 1 ? 's' : ''} en retard de retrait`}
            actions={
              <button type="button" className={lateOnly ? 'odoo-btn-primary' : 'odoo-btn-secondary'}
                onClick={() => { setLateOnly(v => !v); setStatusFilter(''); }}>
                {lateOnly ? 'Voir toutes les commandes' : 'Voir les retards'}
              </button>
            }>
            Date de retrait dépassée sans livraison : à livrer, replanifier ou annuler.
          </StatusBanner>
        )}

        {/* Pipeline */}
        <StagePipeline
          title="Suivi des commandes"
          summary={`${openCount} en cours · ${counts.completed || 0} terminée${(counts.completed || 0) > 1 ? 's' : ''} · ${counts.cancelled || 0} annulée${(counts.cancelled || 0) > 1 ? 's' : ''}`}
          stages={STAGES}
          stats={stageStats}
          isActive={(k) => statusFilter === k && !lateOnly}
          onPick={(k) => { setLateOnly(false); setStatusFilter(statusFilter === k ? '' : k); }}
        />

        {/* Liste */}
        <div style={sectionStyle}>
          <div className="odoo-search-panel" style={{ flexWrap: 'wrap' }}>
            {FILTER_CHIPS.map((chip) => {
              const Icon = chip.icon;
              const active = statusFilter === chip.key && !lateOnly;
              const count = counts[chip.key] || 0;
              return (
                <button key={chip.key} onClick={() => { setLateOnly(false); setStatusFilter(chip.key); }}
                  className="odoo-filter-dropdown" style={chipStyle(active)}>
                  <Icon size={11} /> {chip.label}
                  {count > 0 && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 2 }}>{count}</span>}
                </button>
              );
            })}
            {lateOnly && (
              <span className="odoo-filter-chip">
                En retard
                <span className="odoo-filter-chip-remove" onClick={() => setLateOnly(false)} role="button" aria-label="Retirer le filtre">×</span>
              </span>
            )}
          </div>

          <div className="odoo-search-panel">
            <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
            <input type="text" placeholder="Rechercher par n°, client ou téléphone..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="odoo-search-input" />
            {typeOptions.length > 1 && (
              <SelectFilter label="Type" icon={Tag} value={typeFilter} onChange={setTypeFilter} options={typeOptions} allLabel="Tous les types" />
            )}
          </div>

          {isLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <Loader2 className="animate-spin" size={20} style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: '0.8125rem' }}>Chargement des commandes...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
              <ClipboardList size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.8125rem', fontWeight: 500 }}>Aucune commande</p>
              <p style={{ fontSize: '0.6875rem', marginTop: 2 }}>
                {hasFilters ? 'Aucun résultat pour ces filtres' : 'Créez votre première commande'}
              </p>
              {!hasFilters && (
                <button onClick={() => setShowForm(true)} className="odoo-btn-primary" style={{ marginTop: 12 }}>
                  <Plus size={13} /> Créer une commande
                </button>
              )}
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="odoo-table">
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th>N° commande</th>
                      <th>Client</th>
                      <th>Type</th>
                      <th>Statut</th>
                      <th>Retrait</th>
                      <th>Avancement</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ textAlign: 'right' }}>Avance / Reste</th>
                      <th style={{ textAlign: 'right', width: 150 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((o) => {
                      const status = o.status as string;
                      const totalAmt = num(o.total);
                      const advanceAmt = num(o.advance_amount);
                      const remaining = Math.max(0, totalAmt - advanceAmt);
                      const stageIdx = STAGE_KEYS.indexOf(status);
                      const late = isLate(o, today);
                      const busy = updateStatusMutation.isPending || deleteMutation.isPending;
                      return (
                        <tr key={o.id as string} onClick={() => setViewingOrder(o)} className={late ? 'row-danger' : undefined}>
                          <td><span className={`odoo-status-dot ${STATUS_DOT[status] || 'neutral'}`} /></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{o.order_number as string}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 500 }}>{customerName(o)}</span>
                              {o.customer_phone && (
                                <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <Phone size={9} /> {o.customer_phone as string}
                                </span>
                              )}
                            </div>
                          </td>
                          <td><span className={`odoo-tag ${TYPE_TAG[o.type as string] || 'odoo-tag-grey'}`}>{TYPE_LABELS[o.type as string] || (o.type as string) || '—'}</span></td>
                          <td><span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status}</span></td>
                          <td style={{ color: late ? '#721c24' : 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <CalendarDays size={11} /> {fmtDate(o.pickup_date)}
                              {late && <span className="odoo-tag odoo-tag-red" style={{ marginLeft: 4 }}>En retard</span>}
                            </span>
                          </td>
                          <td style={{ minWidth: 120 }}>
                            {status === 'cancelled' ? (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Ban size={11} /> Annulée
                              </span>
                            ) : (
                              <StageProgress count={STAGES.length - 1} current={stageIdx} done={status === 'completed'} late={late} />
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <span style={{ fontWeight: 700 }}>{n(totalAmt)}</span>
                            <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem', marginLeft: 2 }}>DH</span>
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {advanceAmt > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <span style={{ color: '#155724', fontWeight: 600 }}>{n(advanceAmt)} DH</span>
                                <span style={{ fontSize: '0.6875rem', color: remaining > 0 && status !== 'completed' ? '#b85d1a' : 'var(--theme-text-muted)' }}>
                                  {status === 'completed' ? 'soldée' : `reste ${n(remaining)} DH`}
                                </span>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--theme-text-muted)', fontSize: '0.75rem' }}>
                                {status === 'completed' ? 'soldée' : 'aucune avance'}
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'inline-flex', gap: 2 }}>
                              {status === 'pending' && (
                                <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'confirmed' })} disabled={busy}
                                  title="Confirmer la commande" className="odoo-pager-btn" style={{ color: '#1f6391' }}>
                                  <CheckCircle2 size={13} />
                                </button>
                              )}
                              {status === 'confirmed' && (
                                <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'in_production' })} disabled={busy}
                                  title="Envoyer en production" className="odoo-pager-btn" style={{ color: '#b85d1a' }}>
                                  <Factory size={13} />
                                </button>
                              )}
                              {status === 'in_production' && (
                                <button onClick={() => updateStatusMutation.mutate({ id: o.id as string, status: 'ready' })} disabled={busy}
                                  title="Marquer prête pour le retrait" className="odoo-pager-btn" style={{ color: '#28a745' }}>
                                  <PackageCheck size={13} />
                                </button>
                              )}
                              {status === 'ready' && (
                                <button onClick={() => setDeliverOrder(o)} title="Livrer et encaisser" className="odoo-pager-btn" style={{ color: '#28a745' }}>
                                  <Truck size={13} />
                                </button>
                              )}
                              <button onClick={() => setViewingOrder(o)} title="Voir le détail" className="odoo-pager-btn">
                                <Eye size={13} />
                              </button>
                              {status !== 'completed' && status !== 'cancelled' && (
                                <button onClick={() => setEditingOrder(o)} title="Modifier" className="odoo-pager-btn">
                                  <Pencil size={13} />
                                </button>
                              )}
                              {(status === 'pending' || status === 'confirmed' || status === 'in_production') && (
                                <button onClick={() => cancelOrder(o)} disabled={busy} title="Annuler la commande" className="odoo-pager-btn" style={{ color: '#dc3545' }}>
                                  <Ban size={13} />
                                </button>
                              )}
                              {status === 'cancelled' && (
                                <button onClick={() => removeOrder(o)} disabled={busy} title="Supprimer définitivement" className="odoo-pager-btn" style={{ color: '#dc3545' }}>
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', borderTop: '1px solid var(--odoo-border)' }}>
                <span>{filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}{hasFilters ? ' (filtrées)' : ''}</span>
                <span>Total <strong style={{ color: 'var(--theme-text-strong)' }}>{n(filteredTotal)} DH</strong></span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Formulaire création / édition */}
      {showForm && (
        <OrderFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); invalidate(); }}
        />
      )}
      {editingOrder && (
        <OrderFormModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSaved={() => { setEditingOrder(null); invalidate(); }}
        />
      )}

      {viewingOrder && (
        <OrderDetailModal
          order={viewingOrder}
          late={isLate(viewingOrder, today)}
          onClose={() => setViewingOrder(null)}
          onEdit={(o) => { setViewingOrder(null); setEditingOrder(o); }}
          onStatus={(o, status) => { setViewingOrder(null); updateStatusMutation.mutate({ id: o.id as string, status }); }}
          onDeliver={(o) => { setViewingOrder(null); setDeliverOrder(o); }}
          onCancel={(o) => { setViewingOrder(null); cancelOrder(o); }}
        />
      )}

      {deliverOrder && (
        <DeliverModal
          order={deliverOrder}
          onClose={() => setDeliverOrder(null)}
          onDelivered={() => { setDeliverOrder(null); invalidate(); queryClient.invalidateQueries({ queryKey: ['sales'] }); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════ Fiche commande ═══════════════════════ */

function OrderDetailModal({ order: o, late, onClose, onEdit, onStatus, onDeliver, onCancel }: {
  order: OrderRow; late: boolean;
  onClose: () => void;
  onEdit: (o: OrderRow) => void;
  onStatus: (o: OrderRow, status: string) => void;
  onDeliver: (o: OrderRow) => void;
  onCancel: (o: OrderRow) => void;
}) {
  const { data: detail } = useQuery({
    queryKey: ['order-detail', o.id],
    queryFn: () => ordersApi.getById(o.id as string),
  });
  const status = o.status as string;
  const totalAmt = num(o.total);
  const advanceAmt = num(o.advance_amount);
  const discountAmt = num(o.discount_amount);
  const remaining = Math.max(0, totalAmt - advanceAmt);
  const stageIdx = STAGE_KEYS.indexOf(status);
  const items: OrderRow[] = detail?.items || [];

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full flex flex-col" style={{ ...modalPanelStyle, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        {/* En-tête */}
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '1rem' }}>{o.order_number as string}</span>
              <span className={`odoo-tag ${STATUS_TAG[status] || 'odoo-tag-grey'}`}>{ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] || status}</span>
              <span className={`odoo-tag ${TYPE_TAG[o.type as string] || 'odoo-tag-grey'}`}>{TYPE_LABELS[o.type as string] || (o.type as string)}</span>
              {late && <span className="odoo-tag odoo-tag-red">En retard</span>}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: 2 }}>
              Créée le {fmtDate(o.created_at, 'dd/MM/yyyy HH:mm')} · Retrait le {fmtDate(o.pickup_date)}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        {/* Frise d'avancement */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          {status === 'cancelled' ? (
            <span style={{ fontSize: '0.75rem', color: '#721c24', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ban size={12} /> Commande annulée</span>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`, gap: 6 }}>
              {STAGES.map((s, i) => {
                const reached = i <= stageIdx;
                const current = i === stageIdx;
                const Icon = s.icon;
                return (
                  <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ height: 5, borderRadius: 3, background: reached ? (current && late ? '#dc3545' : 'var(--odoo-purple)') : 'var(--odoo-border)', opacity: current && !late ? 0.6 : 1 }} />
                    <span style={{ fontSize: '0.6875rem', fontWeight: current ? 700 : 500, color: reached ? 'var(--odoo-text)' : 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Icon size={10} /> {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><User size={11} /> Client</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600 }}>{customerName(o)}</div>
                {o.customer_phone && (
                  <div style={{ color: 'var(--odoo-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Phone size={10} /> {o.customer_phone as string}
                  </div>
                )}
              </div>
            </div>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><CalendarDays size={11} /> Retrait</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Date</span>
                  <span style={{ fontWeight: 600, color: late ? '#721c24' : undefined }}>{fmtDate(o.pickup_date)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Créée le</span>
                  <span>{fmtDate(o.created_at, 'dd/MM/yyyy HH:mm')}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <div className="odoo-section-header"><Package size={11} /> Articles commandés</div>
            {!detail ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>
                <Loader2 className="animate-spin" size={16} style={{ margin: '0 auto 6px' }} /> Chargement des articles...
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--odoo-text-muted)', fontSize: '0.75rem' }}>Aucun article</div>
            ) : (
              <table className="odoo-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th style={{ textAlign: 'right' }}>Qté</th>
                    <th style={{ textAlign: 'right' }}>P.U.</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const qty = num(item.quantity);
                    const pu = num(item.unit_price);
                    return (
                      <tr key={idx} style={{ cursor: 'default' }}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{(item.product_name as string) || (item.product_id as string)}</div>
                          {item.notes && <div style={{ fontSize: '0.6875rem', color: 'var(--odoo-text-muted)' }}>{item.notes as string}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>{qty}</td>
                        <td style={{ textAlign: 'right', color: 'var(--odoo-text-muted)' }}>{n(pu)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(qty * pu)} DH</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: o.notes ? '1fr 1fr' : '1fr', gap: 12 }}>
            <div style={sectionStyle}>
              <div className="odoo-section-header"><Banknote size={11} /> Règlement</div>
              <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--odoo-text-muted)' }}>Sous-total</span><span>{n(totalAmt + discountAmt)} DH</span>
                </div>
                {discountAmt > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#721c24' }}>
                    <span>Remise</span><span>-{n(discountAmt)} DH</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                  <span>Total</span><span>{n(totalAmt)} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}>
                  <span>Avance versée</span><span style={{ fontWeight: 600 }}>{n(advanceAmt)} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span>Reste à payer</span>
                  <span style={{ color: remaining > 0 && status !== 'completed' ? '#b85d1a' : undefined }}>
                    {status === 'completed' ? 'Soldée' : `${n(remaining)} DH`}
                  </span>
                </div>
              </div>
            </div>
            {o.notes && (
              <div style={sectionStyle}>
                <div className="odoo-section-header"><FileText size={11} /> Notes</div>
                <div style={{ padding: '10px 12px', fontSize: '0.8125rem', whiteSpace: 'pre-line' }}>{o.notes as string}</div>
              </div>
            )}
          </div>
        </div>

        {/* Pied */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)', flexWrap: 'wrap' }}>
          {(status === 'pending' || status === 'confirmed' || status === 'in_production') && (
            <button onClick={() => onCancel(o)} className="odoo-btn-danger" style={{ marginRight: 'auto' }}><Ban size={13} /> Annuler la commande</button>
          )}
          <button onClick={onClose} className="odoo-btn-secondary">Fermer</button>
          {status !== 'completed' && status !== 'cancelled' && (
            <button onClick={() => onEdit(o)} className="odoo-btn-secondary"><Pencil size={13} /> Modifier</button>
          )}
          {status === 'pending' && (
            <button onClick={() => onStatus(o, 'confirmed')} className="odoo-btn-primary"><CheckCircle2 size={13} /> Confirmer</button>
          )}
          {status === 'confirmed' && (
            <button onClick={() => onStatus(o, 'in_production')} className="odoo-btn-primary"><Factory size={13} /> Envoyer en production</button>
          )}
          {status === 'in_production' && (
            <button onClick={() => onStatus(o, 'ready')} className="odoo-btn-primary"><PackageCheck size={13} /> Marquer prête</button>
          )}
          {status === 'ready' && (
            <button onClick={() => onDeliver(o)} className="odoo-btn-primary"><Truck size={13} /> Livrer</button>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ═══════════════════════ Livraison / encaissement ═══════════════════════ */

function DeliverModal({ order, onClose, onDelivered }: { order: OrderRow; onClose: () => void; onDelivered: () => void }) {
  const totalAmt = num(order.total);
  const advanceAmt = num(order.advance_amount);
  const remaining = Math.max(0, totalAmt - advanceAmt);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [payment, setPayment] = useState<'cash' | 'card'>('cash');

  const deliverMutation = useMutation({
    mutationFn: () => ordersApi.deliver(order.id as string, { amountPaid: parseFloat(amount) || 0, paymentMethod: payment }),
    onSuccess: () => { notify.success('Commande livrée'); onDelivered(); },
    onError: (e: unknown) => notify.error(getApiErrorMessage(e, 'Erreur lors de la livraison')),
  });

  const paid = parseFloat(amount) || 0;
  const stillDue = remaining - paid;

  return (
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="odoo-scope w-full" style={{ ...modalPanelStyle, maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Truck size={18} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>Livraison et encaissement</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{order.order_number as string} · {customerName(order)}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ color: '#fff', opacity: 0.85, padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={sectionStyle}>
            <div className="odoo-section-header"><Banknote size={11} /> Solde de la commande</div>
            <div style={{ padding: '10px 12px', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--odoo-text-muted)' }}>Total commande</span><span style={{ fontWeight: 600 }}>{n(totalAmt)} DH</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#155724' }}><span>Avance versée</span><span style={{ fontWeight: 600 }}>{n(advanceAmt)} DH</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--odoo-border)', paddingTop: 4, marginTop: 2 }}>
                <span>Reste à payer</span><span style={{ color: '#b85d1a' }}>{n(remaining)} DH</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Montant encaissé (DH)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="0.01" autoFocus
                style={{ ...fieldStyle, textAlign: 'right', fontWeight: 700, fontSize: '1rem' }} />
            </div>
            <div>
              <label style={labelStyle}>Mode de paiement</label>
              <div className="odoo-view-switcher" role="radiogroup" style={{ width: '100%' }}>
                {([['cash', 'Espèces', Banknote], ['card', 'Carte', CreditCard]] as const).map(([key, label, Icon]) => (
                  <button key={key} type="button" role="radio" aria-checked={payment === key} onClick={() => setPayment(key)}
                    className={payment === key ? 'active' : ''} style={{ flex: 1, padding: '0.45rem 0.5rem', fontSize: '0.8125rem', gap: 4, fontWeight: payment === key ? 600 : 400 }}>
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {paid > 0 && stillDue > 0.004 && (
            <StatusBanner tone="warning" icon={AlertTriangle} title={`Le client devra encore ${n(stillDue)} DH`}>
              L'encaissement est partiel : la commande sera livrée avec un reliquat.
            </StatusBanner>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.75rem 1rem', borderTop: '1px solid var(--odoo-border)', background: 'var(--odoo-bg-alt)' }}>
          <button onClick={onClose} className="odoo-btn-secondary" disabled={deliverMutation.isPending}>Annuler</button>
          <button onClick={() => deliverMutation.mutate()} disabled={deliverMutation.isPending} className="odoo-btn-primary">
            {deliverMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Confirmer la livraison
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
