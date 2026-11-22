import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { replenishmentApi } from '../../api/replenishment.api';
import { useWorkshops } from '../../api/production.api';
import { productsApi } from '../../api/products.api';
import { useAuth } from '../../context/AuthContext';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';
import { StatusTag, type StatusTone } from '../../components/ui/StatusTag';
import SalesPageShell from '../sales/SalesPageShell';
import { ListToolbar, FilterChips, type FilterChip } from '../sales/ListTemplate';
import {
  Plus, Package, ArrowRight, Clock, AlertTriangle, CheckCircle,
  Send, ShoppingBag, Trash2, Calendar, Search, X, Lightbulb, Truck,
  Loader2, PackageOpen, ChevronRight, Hash, User, Layers, PackageCheck,
  type LucideIcon,
} from 'lucide-react';
import { RowMenu } from '../../components/ui/RowMenu';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Alert, DataPanel, EmptyState, FormField, FormFooter, FormSection, LoadingState, Modal, NoResultState, SearchBar, Segmented, TableFooter } from '../../components/ds';

const STORE_ROLES = ['cashier', 'saleswoman'];

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Envoyée',
  acknowledged: 'Prise en charge',
  partially_received: 'Réception partielle',
  preparing: 'En préparation',
  transferred: 'Transféré',
  partially_delivered: 'Partiellement livré',
  closed: 'Clôturé',
  closed_with_discrepancy: 'Écart',
  cancelled: 'Annulé',
};

/** Étiquette de statut commune : transféré = à réceptionner par la boutique, écart = à traiter. */
const STATUS_TAG: Record<string, { tone: StatusTone; icon?: LucideIcon }> = {
  submitted: { tone: 'progress', icon: Send },
  acknowledged: { tone: 'progress' },
  partially_received: { tone: 'progress', icon: Truck },
  preparing: { tone: 'progress', icon: PackageCheck },
  transferred: { tone: 'todo', icon: Truck },
  partially_delivered: { tone: 'progress', icon: Truck },
  closed: { tone: 'done' },
  closed_with_discrepancy: { tone: 'blocked' },
  cancelled: { tone: 'cancelled' },
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-50 text-blue-600',
  normal: 'bg-gray-50 text-gray-600',
  high: 'bg-orange-50 text-orange-600',
  urgent: 'bg-red-100 text-red-700',
};

const ROLE_CONFIG: Record<string, { bg: string; text: string }> = {
  baker: { bg: 'bg-amber-100', text: 'text-amber-800' },
  pastry_chef: { bg: 'bg-pink-100', text: 'text-pink-800' },
  viennoiserie: { bg: 'bg-orange-100', text: 'text-orange-800' },
  beldi_sale: { bg: 'bg-green-100', text: 'text-green-800' },
};

export default function ReplenishmentPage() {
  const ws = useWorkshops(); // libellés des ateliers (mig 511)
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isStoreStaff = STORE_ROLES.includes(user?.role || '');
  const isAdmin = ['admin', 'manager'].includes(user?.role || '');

  const { data, isLoading } = useQuery({
    queryKey: ['replenishment', { status: statusFilter }],
    queryFn: () => replenishmentApi.list({
      ...(statusFilter ? { status: statusFilter } : {}),
    }),
  });

  const cancelMutation = useMutation({
    mutationFn: replenishmentApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      notify.success('Demande annulée');
    },
  });

  const requests = (data?.data || []) as Record<string, any>[];

  // Stats
  const allRequests = requests;
  const statCounts = {
    submitted: allRequests.filter(r => r.status === 'submitted').length,
    acknowledged: allRequests.filter(r => r.status === 'acknowledged').length,
    preparing: allRequests.filter(r => r.status === 'preparing').length,
    transferred: allRequests.filter(r => r.status === 'transferred').length,
    closed: allRequests.filter(r => r.status === 'closed' || r.status === 'closed_with_discrepancy').length,
  };

  const tabs = [
    { key: '', label: 'Tous', count: allRequests.length },
    { key: 'submitted', label: 'Envoyée', count: statCounts.submitted },
    { key: 'acknowledged', label: 'Prise en charge', count: statCounts.acknowledged },
    { key: 'preparing', label: 'En préparation', count: statCounts.preparing },
    { key: 'transferred', label: 'Transféré', count: statCounts.transferred },
    { key: 'closed', label: 'Clôturé', count: statCounts.closed },
  ];

  // Filter by search
  const filtered = requests.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const num = (r.request_number || r.id || '') as string;
    const name = (r.requested_by_name || '') as string;
    return num.toLowerCase().includes(q) || name.toLowerCase().includes(q);
  });

  const chips: FilterChip[] = tabs.map(t => ({ key: t.key, label: t.label, count: t.count }));

  return (
    <SalesPageShell icon={ShoppingBag} parent="Production" title="Demandes boutique" list
      summary={<><b>{filtered.length}</b> / {allRequests.length} demande(s){statCounts.submitted > 0 ? <> · <b>{statCounts.submitted}</b> en attente</> : null}</>}
      actions={(isStoreStaff || isAdmin) ? (
        <button type="button" onClick={() => setShowForm(true)} className="odoo-btn-primary">
          <Plus size={14} aria-hidden="true" /> Nouvelle demande
        </button>
      ) : undefined}>

      {/* ══════ STATUTS en pastilles avec compteurs ══════ */}
      <FilterChips chips={chips} value={statusFilter} onChange={setStatusFilter} label="Filtrer par statut" />

      {/* ══════ BARRE D'OUTILS ══════ */}
      <ListToolbar search={searchQuery} onSearch={setSearchQuery} placeholder="Rechercher par numéro ou demandeur…" />

      {/* ══════ REQUEST TABLE (.odoo-table) ══════ */}
      {isLoading ? (
        <LoadingState label="Chargement des demandes…" />
      ) : filtered.length === 0 ? (
        (searchQuery || statusFilter)
          ? <NoResultState text="Aucune demande ne correspond aux filtres." onReset={() => { setSearchQuery(''); setStatusFilter(''); }} />
          : <EmptyState icon={PackageOpen} title="Aucune demande d'approvisionnement" text="Les demandes de la boutique apparaîtront ici." />
      ) : (
        <DataPanel label="Demandes boutique" footer={<TableFooter note={`${filtered.length} demande${filtered.length > 1 ? 's' : ''}${filtered.length !== allRequests.length ? ` sur ${allRequests.length}` : ''}`} />}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}><span className="sr-only">État</span></th>
                <th>N° demande</th>
                <th>Statut</th>
                <th>Priorité</th>
                <th>Rôle</th>
                <th>Date</th>
                <th>Demandeur</th>
                <th className="ds-num">Progression</th>
                <th className="ds-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const effectiveStatus = (r.display_status as string) || (r.status as string);
                const sc = STATUS_TAG[effectiveStatus] || STATUS_TAG.submitted;
                const itemCount = (r.item_count as number) || 0;
                const completedCount = (r.completed_count as number) || 0;
                const progress = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;

                const dotClass = effectiveStatus === 'closed' ? 'ok'
                  : effectiveStatus === 'closed_with_discrepancy' ? 'warning'
                  : effectiveStatus === 'cancelled' ? 'neutral'
                  : effectiveStatus === 'submitted' ? 'warning'
                  : 'ok';
                const priorityTag = r.priority === 'urgent' ? 'odoo-tag-red'
                  : r.priority === 'high' ? 'odoo-tag-orange'
                  : r.priority === 'low' ? 'odoo-tag-blue'
                  : 'odoo-tag-grey';

                return (
                  <tr key={r.id as string} onClick={() => navigate(`/replenishment/${r.id}`)}>
                    <td><span className={`odoo-status-dot ${dotClass}`} aria-hidden="true" /></td>
                    <td>
                      <span className="ds-ref">
                        #{r.request_number || (r.id as string).slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <StatusTag tone={sc.tone} icon={sc.icon} label={STATUS_LABELS[effectiveStatus] || effectiveStatus} />
                    </td>
                    <td>
                      <span className={`odoo-tag ${priorityTag}`}>
                        {PRIORITY_LABELS[r.priority as string] || r.priority}
                      </span>
                    </td>
                    <td>
                      {r.assigned_role ? (
                        <span className="odoo-tag odoo-tag-purple">
                          {r.assigned_role === 'general' ? 'Général' : ws.label(r.assigned_role as string)}
                        </span>
                      ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--theme-text-muted)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={11} />
                        {format(new Date(r.created_at as string), 'dd MMM HH:mm', { locale: fr })}
                      </span>
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <User size={11} />
                        {r.requested_by_name as string || '—'}
                      </span>
                    </td>
                    <td className="ds-num">
                      <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{completedCount}/{itemCount}</span>
                      <div style={{ width: 60, height: 3, backgroundColor: 'var(--theme-bg-separator)', borderRadius: 2, overflow: 'hidden', marginTop: 3, marginLeft: 'auto' }}>
                        <div style={{
                          height: '100%', width: `${progress}%`,
                          backgroundColor: progress >= 100 ? 'var(--ds-success)' : 'var(--theme-accent)',
                        }} />
                      </div>
                    </td>
                    <td className="ds-actions" onClick={e => e.stopPropagation()}>
                      {['submitted', 'acknowledged'].includes(r.status as string) && (isAdmin || (isStoreStaff && r.requested_by === user?.id)) && (
                        <RowMenu items={[{ label: 'Annuler la demande', icon: Trash2, danger: true, onSelect: async () => {
                          if (await confirm(`Annuler la demande #${r.request_number || (r.id as string).slice(0, 8)} ?`, { title: 'Annuler la demande', confirmLabel: 'Annuler la demande', danger: true })) cancelMutation.mutate(r.id as string);
                        } }]} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataPanel>
      )}

      {showForm && (
        <CreateRequestModal
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['replenishment'] });
          }}
        />
      )}
    </SalesPageShell>
  );
}

/* ─────────────────── Create Request Modal ─────────────────── */

function CreateRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'suggestions' | 'catalog'>('suggestions');
  const [activeCategory, setActiveCategory] = useState('');
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [blockedItems, setBlockedItems] = useState<Array<{ productId: string; productName: string; unsoldQty: number; message: string }>>([]);
  const [validationDone, setValidationDone] = useState(false);

  const { data: todayCheck } = useQuery({
    queryKey: ['replenishment-check-today'],
    queryFn: () => replenishmentApi.checkToday(),
  });
  const alreadyRequestedIds: string[] = todayCheck?.alreadyRequestedProductIds || [];
  const alreadyRequestedDetails: Record<string, { last_requested_at: string; store_stock: number }> = {};
  for (const d of (todayCheck?.alreadyRequestedDetails || []) as Array<{ product_id: string; last_requested_at: string; store_stock: number }>) {
    alreadyRequestedDetails[d.product_id] = d;
  }

  const MARGIN = 1.10;

  /** Nom du jour CIBLE (= lendemain, car la demande se fait le soir) */
  const getTargetDayName = () => {
    const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return days[(new Date().getDay() + 1) % 7];
  };

  const { data: recommendations, isLoading: recoLoading } = useQuery({
    queryKey: ['replenishment-recommendations'],
    queryFn: () => replenishmentApi.recommendations(),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const products = (productsData?.data || []) as Record<string, any>[];

  useEffect(() => {
    if (suggestionsLoaded) return;
    const recos = (recommendations || []) as Record<string, any>[];
    if (!recos.length && !products.length) return;

    const auto: Record<string, number> = {};
    if (recos.length > 0) {
      for (const r of recos) {
        const sold = parseInt(r.last_week_qty as string) || 0;
        const stock = parseFloat(r.current_stock as string) || 0;
        const need = Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock));
        if (need > 0) auto[r.product_id as string] = need;
      }
    } else {
      const avail = products.filter(p => p.is_available !== false);
      const shuffled = [...avail].sort(() => Math.random() - 0.5).slice(0, 12);
      for (const p of shuffled) auto[p.id as string] = Math.floor(Math.random() * 8) + 2;
    }

    if (Object.keys(auto).length > 0) {
      setSelected(auto);
      setSuggestionsLoaded(true);
      const cats: Record<string, boolean> = {};
      for (const r of recos) cats[(r.category_name as string) || 'Autre'] = true;
      setExpandedCats(cats);
    }
  }, [recommendations, products, suggestionsLoaded]);

  const hasHistory = ((recommendations || []) as Record<string, any>[]).length > 0;

  const recosByCategory: Record<string, Record<string, any>[]> = {};
  for (const r of ((recommendations || []) as Record<string, any>[])) {
    const cat = (r.category_name as string) || 'Autre';
    if (!recosByCategory[cat]) recosByCategory[cat] = [];
    recosByCategory[cat].push(r);
  }

  const categories = Array.from(
    new Map(products.filter(p => p.category_name).map(p => [p.category_id as number, p.category_name as string])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredProducts = products.filter((p) => {
    if (activeCategory && String(p.category_id) !== activeCategory) return false;
    if (search && !(p.name as string).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setQty = (productId: string, qty: number) => {
    setSelected(prev => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const totalSelected = Object.keys(selected).length;
  const totalQty = Object.values(selected).reduce((s, q) => s + q, 0);

  const toggleCat = (cat: string) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));
  const selectAllCat = (items: Record<string, any>[]) => {
    const next = { ...selected };
    for (const item of items) {
      const pid = (item.product_id || item.id) as string;
      const sold = parseInt((item.last_week_qty as string) || '0') || 0;
      const stock = parseFloat((item.current_stock as string) || '0') || 0;
      const need = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
      next[pid] = need;
    }
    setSelected(next);
  };
  const deselectAllCat = (items: Record<string, any>[]) => {
    const next = { ...selected };
    for (const item of items) delete next[(item.product_id || item.id) as string];
    setSelected(next);
  };

  const createMutation = useMutation({
    mutationFn: replenishmentApi.create,
    onSuccess: () => { notify.success('Demande envoyée avec succès'); onCreated(); },
    onError: (error: unknown) => {
      const errData = (error as Record<string, any>)?.response as Record<string, any> | undefined;
      const data = errData?.data as Record<string, any> | undefined;
      const err = data?.error as Record<string, any> | undefined;
      if (err?.code === 'ALL_PRODUCTS_ALREADY_REQUESTED') {
        notify.error(err.message as string);
      } else {
        notify.error((err?.message as string) || 'Erreur lors de la création de la demande');
      }
    },
  });

  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async () => {
    if (createMutation.isPending || submitting) return;

    const productIds = Object.keys(selected);
    if (!productIds.length) { notify.error('Sélectionnez au moins un produit'); return; }

    if (!validationDone) {
      setSubmitting(true);
      try {
        const result = await replenishmentApi.checkItems(productIds);
        if (result.blockedItems?.length > 0) {
          setBlockedItems(result.blockedItems);
          setValidationDone(true);
          setSubmitting(false);
          return;
        }
      } catch (err) {
        console.error('Erreur de vérification des articles:', err);
        notify.error('Erreur lors de la vérification des articles');
        setSubmitting(false);
        return;
      }
    }

    const items = Object.entries(selected).map(([productId, requestedQuantity]) => ({ productId, requestedQuantity }));
    if (!items.length) { notify.error('Aucun article éligible à envoyer'); return; }
    setBlockedItems([]);
    setValidationDone(false);
    createMutation.mutate({ priority, notes: notes || undefined, items }, {
      onSettled: () => setSubmitting(false),
    });
  };

  const filterBySearch = (items: Record<string, any>[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(i => ((i.product_name || i.name) as string).toLowerCase().includes(q));
  };

  return (
    <Modal
      title="Nouvelle demande"
      subtitle={<>Demandes boutique · {hasHistory ? `Suggestions pour ${getTargetDayName()} basées sur l'historique du même jour (+10%)` : 'Aucun historique — saisie manuelle'}</>}
      onClose={onClose}
      locked={createMutation.isPending || submitting}
      width={1280}
      footer={
        <FormFooter onCancel={onClose} onSubmit={handleSubmit} busy={createMutation.isPending || submitting} disabled={!totalSelected}
          submitLabel={createMutation.isPending || submitting ? 'Vérification...' : validationDone ? 'Confirmer l\'envoi' : 'Envoyer la demande'}>
          <span style={{ fontSize: 14, color: 'var(--ds-ink)' }}>
            {totalSelected > 0 ? (
              <><strong>{totalSelected}</strong> produit{totalSelected > 1 ? 's' : ''} — <strong>{totalQty}</strong> unités</>
            ) : 'Aucun produit sélectionné'}
          </span>
          {totalSelected > 0 && (
            <button type="button" onClick={() => setSelected({})} className="ds-btn-ghost ds-btn-sm">Tout vider</button>
          )}
        </FormFooter>
      }
    >
        {/* Blocked items warning */}
        {blockedItems.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Alert tone="warning" icon={AlertTriangle}>
              <strong>Attention : {blockedItems.length} article(s) avec du stock non vendu</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>Ces articles ont encore du stock depuis le dernier approvisionnement. Vous pouvez quand même les envoyer si nécessaire.</div>
              <ul style={{ marginTop: 6, maxHeight: 96, overflowY: 'auto', fontSize: 12 }}>
                {blockedItems.map(bi => (
                  <li key={bi.productId}>{bi.productName} — {bi.unsoldQty} unité(s) restante(s)</li>
                ))}
              </ul>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>Cliquez sur « Confirmer l'envoi » pour continuer malgré tout.</div>
            </Alert>
          </div>
        )}

        <FormSection title="Demande">
          <div style={{ display: 'grid', gridTemplateColumns: '160px minmax(0, 1fr)', gap: 12 }}>
            <FormField label="Priorité" htmlFor="repl-priority">
              <select id="repl-priority" className="ds-input" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="normal">Normale</option>
                <option value="high">Haute</option>
                <option value="urgent">Urgente</option>
              </select>
            </FormField>
            <FormField label="Notes (optionnel)" htmlFor="repl-notes">
              <input id="repl-notes" type="text" className="ds-input" value={notes} onChange={e => setNotes(e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <div className="prj-toolbar" style={{ marginTop: 12 }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit..." />
          <span className="ds-grow" />
          <Segmented label="Mode de saisie" value={mode} onChange={setMode}
            options={[{ key: 'suggestions', label: 'Suggestions', icon: Lightbulb }, { key: 'catalog', label: 'Catalogue', icon: ShoppingBag }]} />
        </div>

        {/* ══════ SUGGESTIONS ══════ */}
        {mode === 'suggestions' && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {recoLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 size={28} className="animate-spin text-indigo-500 mb-3" />
                <span className="text-gray-400 text-sm">Chargement des suggestions...</span>
              </div>
            ) : Object.keys(recosByCategory).length > 0 ? (
              Object.entries(recosByCategory).map(([catName, items]) => {
                const filtered = filterBySearch(items);
                if (!filtered.length) return null;
                const isExpanded = expandedCats[catName] !== false;
                const catSelectedCount = filtered.filter(i => selected[(i.product_id as string)]).length;

                return (
                  <div key={catName} className="border-b last:border-b-0">
                    <div onClick={() => toggleCat(catName)}
                      className="w-full flex items-center justify-between px-6 py-3 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer select-none">
                      <div className="flex items-center gap-3">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${catSelectedCount > 0 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                          {catSelectedCount}
                        </span>
                        <span className="font-semibold text-sm text-gray-700">{catName}</span>
                        <span className="text-xs text-gray-400">{filtered.length} produit{filtered.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {catSelectedCount < filtered.length ? (
                          <button onClick={() => selectAllCat(filtered)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 hover:bg-indigo-50 rounded-lg">
                            Tout sélectionner
                          </button>
                        ) : (
                          <button onClick={() => deselectAllCat(filtered)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded-lg">
                            Tout retirer
                          </button>
                        )}
                        <span className={`transition-transform text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}>&#9662;</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="divide-y divide-gray-50">
                        {filtered.map((item) => {
                          const pid = item.product_id as string;
                          const sold = parseInt(item.last_week_qty as string) || 0;
                          const stock = parseFloat(item.current_stock as string) || 0;
                          const refType = (item.reference_type as string) || 'j7';
                          const refLabel = (item.reference_label as string) || '';
                          const suggested = Math.max(1, Math.ceil(sold * MARGIN) - Math.max(0, Math.floor(stock)));
                          const qty = selected[pid] || 0;
                          const isSelected = qty > 0;

                          // Badge couleur selon la source de la suggestion
                          const refBadge = refType === 'j7'
                            ? { bg: 'bg-green-50 text-green-700 border-green-200', label: 'J-7' }
                            : refType === 'j14'
                              ? { bg: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'J-14' }
                              : { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Moy.' };

                          const reqDetail = alreadyRequestedDetails[pid];
                          const showWarning = reqDetail && reqDetail.store_stock > 0;

                          return (
                            <div key={pid} className={`px-6 py-3 transition-colors ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}>
                              <div className="flex items-center gap-4">
                                <button onClick={() => isSelected ? setQty(pid, 0) : setQty(pid, suggested)}
                                  className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 hover:border-indigo-400'}`}>
                                  {isSelected && <CheckCircle size={14} className="text-white" />}
                                </button>

                                <div className="flex-1 min-w-0">
                                  <span className={`text-sm ${isSelected ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                                    {item.product_name as string}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {/* Reference source badge */}
                                  <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border font-semibold ${refBadge.bg}`} title={refLabel}>
                                    {refBadge.label}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-gray-100 text-gray-600" title={`Vendu: ${refLabel}`}>
                                    <Layers size={10} /> {sold}
                                  </span>
                                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg ${stock > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`} title="Stock actuel">
                                    <Package size={10} /> {Math.floor(stock)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-medium" title={`Suggere (${refLabel} x1.10)`}>
                                    <Lightbulb size={10} /> {suggested}
                                  </span>
                                </div>

                                {isSelected ? (
                                  <div className="flex items-center bg-white rounded-xl border border-indigo-200 shrink-0 shadow-sm overflow-hidden">
                                    <button onClick={() => setQty(pid, qty - 1)}
                                      className="w-8 h-8 flex items-center justify-center text-indigo-600 font-bold hover:bg-indigo-50">-</button>
                                    <input type="number" min={1} value={qty}
                                      onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                                      className="w-12 text-center text-sm font-bold h-8 border-x border-indigo-200 focus:outline-none focus:bg-indigo-50" />
                                    <button onClick={() => setQty(pid, qty + 1)}
                                      className="w-8 h-8 flex items-center justify-center text-indigo-600 font-bold hover:bg-indigo-50">+</button>
                                  </div>
                                ) : (
                                  <button onClick={() => setQty(pid, suggested)}
                                    className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-600 text-xs font-medium hover:bg-indigo-100 hover:text-indigo-700 transition-colors shrink-0">
                                    + Ajouter
                                  </button>
                                )}
                              </div>
                              {showWarning && (
                                <p className="ml-9 mt-1 text-[11px] text-amber-600 flex items-center gap-1">
                                  <AlertTriangle size={11} className="shrink-0" />
                                  Cet article a déjà été approvisionné aujourd'hui le {new Date(reqDetail.last_requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Il est encore disponible en vitrine ({reqDetail.store_stock} unité(s)).
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
                  <Lightbulb size={28} className="text-gray-400" />
                </div>
                <p className="text-gray-500">Aucune donnée de vente pour {getTargetDayName()}</p>
                <button onClick={() => setMode('catalog')} className="mt-3 text-indigo-600 text-sm font-medium hover:underline">
                  Sélectionner manuellement depuis le catalogue
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════ CATALOGUE ══════ */}
        {mode === 'catalog' && (
          <div className="flex flex-1 min-h-0">
            <div className="w-44 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-3 flex flex-col gap-1">
              <button onClick={() => setActiveCategory('')}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${!activeCategory ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                Tous
              </button>
              {categories.map(([id, name]) => (
                <button key={id} onClick={() => setActiveCategory(String(id))}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${activeCategory === String(id) ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {name}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
                {filteredProducts.map((p) => {
                  const pid = p.id as string;
                  const qty = selected[pid] || 0;
                  const isSelected = qty > 0;
                  return (
                    <div key={pid} className={`rounded-xl border-2 p-3 transition-all select-none ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 bg-white hover:border-gray-300 hover:shadow-sm'}`}>
                      <div className="text-xs font-semibold text-gray-800 mb-2 leading-tight h-8" title={p.name as string}>
                        <span className="line-clamp-2">{p.name as string}</span>
                      </div>
                      {(() => { const rd = alreadyRequestedDetails[pid]; return rd && rd.store_stock > 0 ? (
                        <p className="text-[10px] text-amber-600 mb-1.5 leading-tight flex items-start gap-0.5">
                          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                          Approvisionné aujourd'hui — encore {rd.store_stock} en vitrine
                        </p>
                      ) : null; })()}
                      {!isSelected ? (
                        <button onClick={() => setQty(pid, 1)}
                          className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1">
                          <Plus size={12} /> Ajouter
                        </button>
                      ) : (
                        <div className="flex items-center bg-white rounded-lg border border-indigo-200 overflow-hidden">
                          <button onClick={() => setQty(pid, qty - 1)} className="w-8 h-7 flex items-center justify-center text-sm font-bold text-indigo-600 hover:bg-indigo-50">-</button>
                          <input type="number" min={1} value={qty} onChange={e => setQty(pid, parseInt(e.target.value) || 0)}
                            className="flex-1 text-center text-xs font-bold h-7 border-x border-indigo-200 focus:outline-none" />
                          <button onClick={() => setQty(pid, qty + 1)} className="w-8 h-7 flex items-center justify-center text-sm font-bold text-indigo-600 hover:bg-indigo-50">+</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!filteredProducts.length && (
                <div className="flex flex-col items-center justify-center py-12">
                  <PackageOpen size={32} className="text-gray-300 mb-2" />
                  <span className="text-gray-400 text-sm">Aucun produit trouvé</span>
                </div>
              )}
            </div>
          </div>
        )}

    </Modal>
  );
}
