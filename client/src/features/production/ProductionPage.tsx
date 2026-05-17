import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { productionApi } from '../../api/production.api';
import { productsApi } from '../../api/products.api';
import { ordersApi } from '../../api/orders.api';
import { usePermissions } from '../../context/PermissionsContext';
import { useAuth } from '../../context/AuthContext';
import { PRODUCTION_STATUS_LABELS, PRODUCTION_TYPE_LABELS, getRoleCategorySlugs } from '@ofauria/shared';
import {
  Plus, Trash2, Factory, Calendar, ShoppingBag, Package, Search,
  Clock, CheckCircle2, Play, Flag, Eye, AlertCircle,
  FileText, User,
  ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, Layers,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { notify } from '../../components/ui/InlineNotification';

const CHEF_ROLES = ['baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'];
const ROLE_LABELS: Record<string, string> = {
  baker: 'Boulanger',
  pastry_chef: 'Pâtissier',
  viennoiserie: 'Viennoiserie',
  beldi_sale: 'Beldi & Salé',
};

const roleConfig: Record<string, { color: string; bg: string; gradient: string }> = {
  baker:        { color: 'text-amber-700',  bg: 'bg-amber-50',  gradient: 'from-amber-500 to-amber-600' },
  pastry_chef:  { color: 'text-pink-700',   bg: 'bg-pink-50',   gradient: 'from-pink-500 to-pink-600' },
  viennoiserie: { color: 'text-orange-700', bg: 'bg-orange-50', gradient: 'from-orange-500 to-orange-600' },
  beldi_sale:   { color: 'text-teal-700',   bg: 'bg-teal-50',   gradient: 'from-teal-500 to-teal-600' },
};

const statusConfig: Record<string, { color: string; bg: string; icon: typeof Clock; gradient: string }> = {
  draft:                { color: 'text-gray-600',    bg: 'bg-gray-100',    icon: FileText,     gradient: 'from-gray-400 to-gray-500' },
  confirmed:            { color: 'text-blue-700',    bg: 'bg-blue-50',     icon: CheckCircle2, gradient: 'from-blue-500 to-blue-600' },
  awaiting_ingredients: { color: 'text-orange-700',  bg: 'bg-orange-50',   icon: Clock,        gradient: 'from-orange-500 to-orange-600' },
  ready_to_produce:     { color: 'text-indigo-700',  bg: 'bg-indigo-50',   icon: AlertCircle,  gradient: 'from-indigo-500 to-indigo-600' },
  in_progress:          { color: 'text-amber-700',   bg: 'bg-amber-50',    icon: Play,         gradient: 'from-amber-500 to-amber-600' },
  completed:            { color: 'text-emerald-700', bg: 'bg-emerald-50',  icon: Flag,         gradient: 'from-emerald-500 to-emerald-600' },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' DH';
}

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th onClick={() => onSort(sk)} style={{ textAlign: align }}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`odoo-sort-arrow ${active ? 'active' : ''}`}>
          {active ? (currentDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} />}
        </span>
      </span>
    </th>
  );
}

export default function ProductionPage() {
  return (
    <div className="odoo-scope">
      <ProductionPlansView />
    </div>
  );
}

function ProductionPlansView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [resumePrefill, setResumePrefill] = useState<{ items: Record<string, number>; role?: string } | null>(null);
  const [showResumePicker, setShowResumePicker] = useState(false);
  const [sortKey, setSortKey] = useState<string>('plan_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'plan_date' ? 'desc' : 'asc'); }
  };

  const isChef = CHEF_ROLES.includes(user?.role || '');
  const isAdmin = ['admin', 'manager'].includes(user?.role || '');

  const effectiveRole = isChef ? (user?.role || '') : roleFilter;
  const { data, isLoading } = useQuery({
    queryKey: ['production', { status: statusFilter, targetRole: effectiveRole }],
    queryFn: () => productionApi.list({
      status: statusFilter,
      ...(effectiveRole ? { targetRole: effectiveRole } : {}),
    }),
  });

  // Yesterday's plans for "resume" feature
  const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
  const { data: yesterdayData } = useQuery({
    queryKey: ['production-yesterday', yesterday],
    queryFn: () => productionApi.list({ dateFrom: yesterday, dateTo: yesterday }),
    enabled: showResumePicker,
  });

  const deleteMutation = useMutation({
    mutationFn: productionApi.remove,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production'] }); notify.success('Plan supprimé'); },
  });

  const plans = data?.data || [];

  // Search filter
  const filteredPlans = useMemo(() => {
    if (!searchQuery.trim()) return plans;
    const q = searchQuery.toLowerCase();
    return plans.filter((p: Record<string, any>) =>
      (p.order_number as string)?.toLowerCase().includes(q) ||
      (p.order_customer_name as string)?.toLowerCase().includes(q) ||
      (p.created_by_name as string)?.toLowerCase().includes(q) ||
      (ROLE_LABELS[p.target_role as string] || '').toLowerCase().includes(q) ||
      format(new Date(p.plan_date as string), 'dd MMM yyyy', { locale: fr }).toLowerCase().includes(q)
    );
  }, [plans, searchQuery]);

  const sortedPlans = useMemo(() => {
    const arr = [...filteredPlans];
    const STATUS_ORDER: Record<string, number> = { draft: 0, confirmed: 1, in_progress: 2, completed: 3 };
    arr.sort((a: Record<string, any>, b: Record<string, any>) => {
      let cmp = 0;
      switch (sortKey) {
        case 'plan_date': cmp = new Date(a.plan_date as string).getTime() - new Date(b.plan_date as string).getTime(); break;
        case 'status': cmp = (STATUS_ORDER[a.status as string] ?? 0) - (STATUS_ORDER[b.status as string] ?? 0); break;
        case 'type': cmp = ((a.type as string) || '').localeCompare((b.type as string) || ''); break;
        case 'target_role': cmp = ((a.target_role as string) || '').localeCompare((b.target_role as string) || ''); break;
        case 'item_count': cmp = ((a.item_count as number) || 0) - ((b.item_count as number) || 0); break;
        case 'created_by_name': cmp = ((a.created_by_name as string) || '').localeCompare((b.created_by_name as string) || ''); break;
        case 'order_number': cmp = ((a.order_number as string) || '').localeCompare((b.order_number as string) || ''); break;
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredPlans, sortKey, sortDir]);

  // Stats
  const stats = useMemo(() => ({
    total: plans.length,
    draft: plans.filter((p: Record<string, any>) => p.status === 'draft').length,
    confirmed: plans.filter((p: Record<string, any>) => p.status === 'confirmed').length,
    awaiting_ingredients: plans.filter((p: Record<string, any>) => p.status === 'awaiting_ingredients').length,
    ready_to_produce: plans.filter((p: Record<string, any>) => p.status === 'ready_to_produce').length,
    in_progress: plans.filter((p: Record<string, any>) => p.status === 'in_progress').length,
    completed: plans.filter((p: Record<string, any>) => p.status === 'completed').length,
  }), [plans]);

  const tabs = [
    { key: '', label: 'Tous', count: stats.total, icon: Factory },
    { key: 'draft', label: 'Brouillon', count: stats.draft, icon: FileText },
    { key: 'confirmed', label: 'Confirmé', count: stats.confirmed, icon: CheckCircle2 },
    { key: 'awaiting_ingredients', label: 'En attente ingr.', count: stats.awaiting_ingredients, icon: Clock },
    { key: 'ready_to_produce', label: 'Prêt à produire', count: stats.ready_to_produce, icon: AlertCircle },
    { key: 'in_progress', label: 'En cours', count: stats.in_progress, icon: Play },
    { key: 'completed', label: 'Terminé', count: stats.completed, icon: Flag },
  ];

  return (
    <>
      {/* ══════ CONTROL BAR ══════ */}
      <div className="odoo-control-bar">
        <div className="odoo-breadcrumb">
          <Factory size={14} style={{ color: 'var(--theme-accent)' }} />
          <span>Production</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">Plans</span>
        </div>
        <button onClick={() => { setResumePrefill(null); setShowForm(true); }} className="odoo-btn-primary">
          <Plus size={14} /> Nouveau
        </button>
        <button onClick={() => setShowResumePicker(true)} className="odoo-btn-secondary">
          <RotateCcw size={13} /> Reprendre
        </button>
        <div style={{ flex: 1 }} />
        <span className="odoo-pager">
          <strong>{filteredPlans.length}</strong> / {(data as Record<string, any>[] | undefined)?.length || 0}
        </span>
      </div>

      {/* ══════ STAT TILES (sober) ══════ */}
      <div className="odoo-stat-grid">
        <button onClick={() => setStatusFilter('')}
          className={`odoo-stat-card ${statusFilter === '' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <FileText size={11} style={{ display: 'inline', marginRight: 4 }} />Brouillons
          </div>
          <div className="odoo-stat-card-value">{stats.draft}</div>
        </button>
        <button onClick={() => setStatusFilter(statusFilter === 'confirmed' ? '' : 'confirmed')}
          className={`odoo-stat-card ${statusFilter === 'confirmed' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 4, color: '#1f6391' }} />Confirmés
          </div>
          <div className="odoo-stat-card-value">{stats.confirmed}</div>
        </button>
        <button onClick={() => setStatusFilter(statusFilter === 'in_progress' ? '' : 'in_progress')}
          className={`odoo-stat-card ${statusFilter === 'in_progress' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <Play size={11} style={{ display: 'inline', marginRight: 4, color: '#b85d1a' }} />En cours
          </div>
          <div className="odoo-stat-card-value" style={{ color: stats.in_progress > 0 ? '#b85d1a' : undefined }}>{stats.in_progress}</div>
        </button>
        <button onClick={() => setStatusFilter(statusFilter === 'completed' ? '' : 'completed')}
          className={`odoo-stat-card ${statusFilter === 'completed' ? 'active' : ''}`}>
          <div className="odoo-stat-card-label">
            <Flag size={11} style={{ display: 'inline', marginRight: 4, color: '#28a745' }} />Terminés
          </div>
          <div className="odoo-stat-card-value">{stats.completed}</div>
        </button>
      </div>

      {/* ══════ SEARCH PANEL avec filtres role + statut ══════ */}
      <div className="odoo-search-panel">
        <Search size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher par date, chef, commande..."
          className="odoo-search-input" />
        {searchQuery && (
          <span className="odoo-filter-chip">
            Recherche: {searchQuery}
            <span className="odoo-filter-chip-remove" onClick={() => setSearchQuery('')}>×</span>
          </span>
        )}
        {statusFilter && (
          <span className="odoo-filter-chip">
            {tabs.find(t => t.key === statusFilter)?.label}
            <span className="odoo-filter-chip-remove" onClick={() => setStatusFilter('')}>×</span>
          </span>
        )}
        {roleFilter && (
          <span className="odoo-filter-chip">
            {ROLE_LABELS[roleFilter]}
            <span className="odoo-filter-chip-remove" onClick={() => setRoleFilter('')}>×</span>
          </span>
        )}
        {isAdmin && (
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            className="odoo-filter-dropdown"
            style={{ border: 'none', backgroundColor: 'transparent', outline: 'none' }}>
            <option value="">▾ Chef</option>
            {CHEF_ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        )}
      </div>

      {/* Tabs status secondaires (Odoo notebook) */}
      <div className="odoo-tabs">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setStatusFilter(statusFilter === tab.key ? '' : tab.key)}
            className={`odoo-tab ${statusFilter === tab.key ? 'active' : ''}`}>
            <tab.icon size={13} />
            {tab.label}
            {tab.count > 0 && (
              <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 4 }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Plans table */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <div style={{ width: 28, height: 28, border: '3px solid var(--theme-accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filteredPlans.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <Factory size={40} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>Aucun plan de production</p>
          <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
            {searchQuery ? 'Essayez une autre recherche' : 'Créez votre premier plan de production'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}></th>
                <th>N° Plan</th>
                <SortHeader label="Date" sortKey="plan_date" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Statut" sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Type" sortKey="type" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                {isAdmin && <SortHeader label="Chef" sortKey="target_role" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />}
                <SortHeader label="Produits" sortKey="item_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <SortHeader label="Créé par" sortKey="created_by_name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Commande liée" sortKey="order_number" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
                {sortedPlans.map((p: Record<string, any>, idx: number) => {
                  const status = p.status as string;
                  const sCfg = statusConfig[status] || statusConfig.draft;
                  const rCfg = roleConfig[p.target_role as string] || roleConfig.baker;
                  const StatusIcon = sCfg.icon;
                  const hasOrder = !!p.order_number;
                  const planDate = new Date(p.plan_date as string);
                  const planNumber = (p.id as string).slice(0, 8).toUpperCase();

                  const dotClass = status === 'completed' ? 'ok'
                    : status === 'in_progress' ? 'warning'
                    : status === 'ready_to_produce' ? 'ok'
                    : status === 'awaiting_ingredients' ? 'warning'
                    : status === 'confirmed' ? 'ok' : 'neutral';
                  return (
                    <tr key={p.id as string} onClick={() => navigate(`/production/${p.id}`)}>
                      <td><span className={`odoo-status-dot ${dotClass}`} /></td>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{planNumber}</span>
                        {p.is_semi_finished_plan && (
                          <span className="odoo-tag odoo-tag-purple" style={{ marginLeft: 6 }}>Semi-fini</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Calendar size={12} style={{ color: 'var(--theme-text-muted)' }} />
                          <span style={{ fontWeight: 500 }}>{format(planDate, 'dd MMM yyyy', { locale: fr })}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`odoo-tag ${
                          status === 'completed' ? 'odoo-tag-green'
                          : status === 'in_progress' ? 'odoo-tag-yellow'
                          : status === 'ready_to_produce' ? 'odoo-tag-blue'
                          : status === 'awaiting_ingredients' ? 'odoo-tag-orange'
                          : status === 'confirmed' ? 'odoo-tag-blue'
                          : 'odoo-tag-grey'
                        }`}>
                          <StatusIcon size={10} />
                          {PRODUCTION_STATUS_LABELS[(status) as keyof typeof PRODUCTION_STATUS_LABELS]}
                        </span>
                        {Number(p.dep_total) > 0 && (() => {
                          const depTotal = Number(p.dep_total);
                          const depFulfilled = Number(p.dep_fulfilled);
                          const allDone = depFulfilled === depTotal;
                          return (
                            <span className={`odoo-tag ${allDone ? 'odoo-tag-green' : 'odoo-tag-yellow'}`} style={{ marginLeft: 4 }}>
                              <Layers size={9} /> SF {depFulfilled}/{depTotal}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <span className="odoo-tag odoo-tag-grey">
                          {PRODUCTION_TYPE_LABELS[(p.type as string) as keyof typeof PRODUCTION_TYPE_LABELS]}
                        </span>
                      </td>
                      {isAdmin && (
                        <td>
                          {p.target_role ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <User size={11} style={{ color: 'var(--theme-accent)' }} />
                              <span style={{ fontWeight: 500 }}>{ROLE_LABELS[p.target_role as string]}</span>
                            </span>
                          ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                        </td>
                      )}
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <Package size={12} style={{ color: 'var(--theme-text-muted)' }} />
                          {p.item_count as number}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--theme-text-muted)' }}>
                          <User size={11} />
                          {p.created_by_name as string}
                        </span>
                      </td>
                      <td>
                        {hasOrder ? (
                          <span className="odoo-tag odoo-tag-blue">
                            <ShoppingBag size={10} /> {p.order_number as string}
                            {p.order_customer_name && <span style={{ opacity: 0.7 }}> — {p.order_customer_name as string}</span>}
                          </span>
                        ) : <span style={{ color: 'var(--theme-bg-separator)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {status === 'draft' && (
                            <button onClick={() => { if (confirm('Supprimer ce plan ?')) deleteMutation.mutate(p.id as string); }}
                              className="odoo-pager-btn" title="Supprimer" style={{ color: '#dc3545' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
                          <button className="odoo-pager-btn" title="Voir">
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>
      )}

      {showForm && (
        <PlanFormModal
          onClose={() => { setShowForm(false); setResumePrefill(null); }}
          onCreated={(id) => { setShowForm(false); setResumePrefill(null); navigate(`/production/${id}`); }}
          prefillItems={resumePrefill?.items}
          prefillRole={resumePrefill?.role}
        />
      )}

      {/* Resume picker modal */}
      {showResumePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <div className="odoo-scope" style={{ width: '100%', maxWidth: 460, borderRadius: 4, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minHeight: 0 }}>
            <div className="odoo-control-bar">
              <div className="odoo-breadcrumb">
                <RotateCcw size={14} style={{ color: 'var(--theme-accent)' }} />
                <span>Reprendre un plan</span>
                <span className="odoo-breadcrumb-separator">›</span>
                <span className="odoo-breadcrumb-current">{format(new Date(Date.now() - 86400000), 'dd MMM yyyy', { locale: fr })}</span>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowResumePicker(false)} className="odoo-pager-btn" title="Fermer">&times;</button>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {(() => {
                const yesterdayPlans = (yesterdayData?.data || []) as Record<string, any>[];
                if (yesterdayPlans.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-400">
                      <Clock size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="font-medium">Aucun plan hier</p>
                      <p className="text-xs mt-1">Aucun plan de production trouvé pour hier</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {yesterdayPlans.map((plan) => {
                      const role = plan.target_role as string;
                      const rc = roleConfig[role] || { color: 'text-gray-700', bg: 'bg-gray-50', gradient: 'from-gray-400 to-gray-500' };
                      const sc = statusConfig[plan.status as string] || statusConfig.draft;
                      const StatusIcon = sc.icon;
                      return (
                        <button key={plan.id as string}
                          onClick={async () => {
                            // Fetch plan details to get items
                            const detail = await productionApi.getById(plan.id as string);
                            const items: Record<string, number> = {};
                            for (const item of (detail.items || []) as Record<string, any>[]) {
                              if (item.product_id) {
                                items[item.product_id as string] = item.planned_quantity as number;
                              }
                            }
                            setResumePrefill({ items, role: role || undefined });
                            setShowResumePicker(false);
                            setShowForm(true);
                          }}
                          className="w-full text-left p-3 rounded-xl border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition-all group">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${rc.gradient} flex items-center justify-center flex-shrink-0`}>
                                <Factory size={16} className="text-white" />
                              </div>
                              <div>
                                <p className="font-semibold text-gray-800 text-sm">{ROLE_LABELS[role] || role}</p>
                                <p className="text-xs text-gray-400">{plan.item_count as number} produit{(plan.item_count as number) > 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.bg} ${sc.color}`}>
                                <StatusIcon size={10} />
                                {PRODUCTION_STATUS_LABELS[plan.status as keyof typeof PRODUCTION_STATUS_LABELS] || plan.status as string}
                              </span>
                              <RotateCcw size={14} className="text-gray-300 group-hover:text-violet-500 transition-colors" />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══ Plan Form Modal ═══
function PlanFormModal({ onClose, onCreated, prefillItems, prefillRole }: {
  onClose: () => void; onCreated: (id: string) => void;
  prefillItems?: Record<string, number>; prefillRole?: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { getModuleConfig } = usePermissions();
  const [planDate, setPlanDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [type, setType] = useState<'daily' | 'weekly'>('daily');
  const [notes, setNotes] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>(prefillItems || {});
  const [orderQtys, setOrderQtys] = useState<Record<string, number>>({});
  const [selectedRole, setSelectedRole] = useState<string>(
    prefillRole || (CHEF_ROLES.includes(user?.role || '') ? user!.role : '')
  );

  const isAdminUser = ['admin', 'manager'].includes(user?.role || '');

  const allowedSlugs = selectedRole
    ? getRoleCategorySlugs(selectedRole)
    : (getModuleConfig('production').category_slugs as string[] | undefined) || null;

  const { data: productsData } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ isAvailable: 'true', limit: '500' }),
  });
  const allProducts = (productsData?.data || []) as Record<string, any>[];
  const products = allowedSlugs
    ? allProducts.filter(p => allowedSlugs.includes(p.category_slug as string))
    : allProducts;

  const { data: ordersForDate, isLoading: ordersLoading } = useQuery({
    queryKey: ['orders-for-date', planDate],
    queryFn: () => ordersApi.forDate(planDate),
    enabled: !!planDate,
  });

  const orders = (ordersForDate || []) as Record<string, any>[];
  const orderCount = orders.length;

  const computeOrderQtys = () => {
    const qtys: Record<string, number> = {};
    orders.forEach((order) => {
      const items = (order.items || []) as Record<string, any>[];
      items.forEach((item) => {
        const pid = item.product_id as string;
        qtys[pid] = (qtys[pid] || 0) + (item.quantity as number);
      });
    });
    return qtys;
  };

  const currentOrderQtysStr = JSON.stringify(computeOrderQtys());
  if (currentOrderQtysStr !== JSON.stringify(orderQtys)) {
    const newOrderQtys = JSON.parse(currentOrderQtysStr) as Record<string, number>;
    setOrderQtys(newOrderQtys);
    setSelected((prev) => {
      const next: Record<string, number> = {};
      for (const [pid, qty] of Object.entries(prev)) {
        const oldOrderQty = orderQtys[pid] || 0;
        const manual = qty - oldOrderQty;
        if (manual > 0) next[pid] = manual;
      }
      for (const [pid, qty] of Object.entries(newOrderQtys)) {
        next[pid] = (next[pid] || 0) + qty;
      }
      return next;
    });
  }

  const categories = Array.from(
    new Map(
      products
        .filter((p) => p.category_name)
        .map((p) => [p.category_id as number, p.category_name as string])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const filteredProducts = products.filter((p) => {
    if (activeCategory && String(p.category_id) !== activeCategory) return false;
    if (search && !(p.name as string).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const setQty = (productId: string, qty: number) => {
    const minQty = orderQtys[productId] || 0;
    setSelected((prev) => {
      const next = { ...prev };
      if (qty <= 0 && minQty <= 0) { delete next[productId]; }
      else { next[productId] = Math.max(qty, minQty); }
      return next;
    });
  };

  const totalSelected = Object.keys(selected).length;

  const createMutation = useMutation({
    mutationFn: productionApi.create,
    onSuccess: (plan: Record<string, any>) => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      notify.success('Plan de production créé');
      onCreated(plan.id as string);
    },
  });

  const handleSubmit = () => {
    if (isAdminUser && !selectedRole) { notify.error('Sélectionnez un chef'); return; }
    const items = Object.entries(selected).map(([productId, plannedQuantity]) => ({ productId, plannedQuantity }));
    if (items.length === 0) { notify.error('Sélectionnez au moins un produit'); return; }
    createMutation.mutate({ planDate, type, notes: notes || undefined, targetRole: selectedRole || undefined, items });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      <div className="odoo-scope" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
        {/* Control bar */}
        <div className="odoo-control-bar">
          <div className="odoo-breadcrumb">
            <Factory size={14} style={{ color: 'var(--theme-accent)' }} />
            <span>Production</span>
            <span className="odoo-breadcrumb-separator">›</span>
            <span className="odoo-breadcrumb-current">Nouveau plan</span>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="odoo-pager-btn" title="Fermer">&times;</button>
        </div>

        {/* Settings bar */}
        <div className="px-5 py-3 border-b bg-gray-50 shrink-0">
          <div className="flex flex-wrap gap-3 items-end">
            {isAdminUser && (
              <div className="w-48">
                <label className="block text-xs font-medium text-gray-500 mb-1">Chef responsable *</label>
                <select value={selectedRole} onChange={(e) => { setSelectedRole(e.target.value); setSelected({}); setActiveCategory(''); }}
                  className="input text-base py-2.5">
                  <option value="">-- Choisir un chef --</option>
                  {CHEF_ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Date de production</label>
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)}
                className="input text-base py-2.5" required />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as 'daily' | 'weekly')}
                className="input text-base py-2.5">
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
              </select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optionnel)</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="input text-base py-2.5" placeholder="Ex: commande spéciale..." />
            </div>
          </div>
        </div>

        {/* Pre-orders banner */}
        {orderCount > 0 && (
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 shrink-0">
            <div className="flex items-center gap-2 text-blue-800">
              <ShoppingBag size={18} className="text-blue-500" />
              <span className="text-sm font-medium">{orderCount} commande(s) pour cette date</span>
              <span className="text-xs text-blue-400 ml-1">— quantités ajoutées automatiquement</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {Object.entries(orderQtys).map(([pid, qty]) => {
                const prod = products.find((p) => p.id === pid);
                return (
                  <span key={pid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                    <ShoppingBag size={12} /> {prod ? prod.name as string : pid} &times;{qty}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {ordersLoading && (
          <div className="px-5 py-2 bg-gray-50 border-b text-sm text-gray-400 shrink-0">Chargement des commandes...</div>
        )}

        {/* Category sidebar + Products grid */}
        <div className="flex flex-1 min-h-0">
          {/* Category sidebar */}
          <div className="w-44 shrink-0 border-r bg-gray-50 overflow-y-auto py-3 px-2 flex flex-col gap-1.5">
            <button type="button" onClick={() => setActiveCategory('')}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                !activeCategory ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              Tous
            </button>
            {categories.map(([id, name]) => (
              <button key={id} type="button" onClick={() => setActiveCategory(String(id))}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeCategory === String(id) ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {name}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-5 py-2 shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un produit..."
                  className="input text-base py-2.5 w-full pl-10" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map((p) => {
                  const pid = p.id as string;
                  const qty = selected[pid] || 0;
                  const fromOrders = orderQtys[pid] || 0;
                  const isSelected = qty > 0;
                  return (
                    <div key={pid}
                      className={`rounded-xl border-2 p-3 transition-all select-none ${
                        isSelected
                          ? 'border-amber-400 bg-amber-50 shadow-sm'
                          : 'border-gray-200 bg-white active:border-gray-300'
                      }`}>
                      <div className="text-sm font-semibold text-gray-800 mb-1 leading-tight h-[2.5rem]" title={p.name as string}>
                        <span className="line-clamp-2">{p.name as string}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-xs text-gray-400">{p.category_name as string}</span>
                        {fromOrders > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                            CMD: {fromOrders}
                          </span>
                        )}
                      </div>

                      {!isSelected ? (
                        <button type="button" onClick={() => setQty(pid, Math.max(1, fromOrders))}
                          className="w-full py-2.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 active:bg-amber-700 transition-colors">
                          <Plus size={16} className="inline -mt-0.5 mr-1" /> Ajouter
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-white rounded-lg border border-amber-300 overflow-hidden">
                          <button type="button" onClick={() => setQty(pid, qty - 1)}
                            className={`w-12 h-11 flex items-center justify-center text-xl font-bold transition-colors ${
                              qty <= fromOrders && fromOrders > 0 ? 'text-gray-300 cursor-not-allowed' : 'text-amber-600 active:bg-amber-50'
                            }`}
                            disabled={qty <= fromOrders && fromOrders > 0}>
                            {qty === 1 && fromOrders === 0 ? <Trash2 size={16} className="text-red-400" /> : '−'}
                          </button>
                          <input type="number" min={fromOrders || 1} value={qty}
                            onChange={(e) => setQty(pid, parseInt(e.target.value) || 0)}
                            className="w-14 text-center text-lg font-bold border-x border-amber-300 h-11 focus:outline-none" />
                          <button type="button" onClick={() => setQty(pid, qty + 1)}
                            className="w-12 h-11 flex items-center justify-center text-xl font-bold text-amber-600 active:bg-amber-50 transition-colors">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-gray-400">Aucun produit trouvé</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-white px-5 py-4 shrink-0 sm:rounded-b-2xl">
          {totalSelected > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(selected).map(([pid, qty]) => {
                const prod = products.find((p) => p.id === pid);
                const fromOrder = orderQtys[pid] || 0;
                return (
                  <span key={pid} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium">
                    {fromOrder > 0 && <ShoppingBag size={12} className="text-blue-500" />}
                    {prod ? prod.name as string : pid} <strong>&times;{qty}</strong>
                    {fromOrder > 0 && fromOrder < qty && (
                      <span className="text-xs text-gray-400">(dont {fromOrder} cmd)</span>
                    )}
                    {fromOrder === 0 && (
                      <button type="button" onClick={() => setQty(pid, 0)}
                        className="ml-1 text-amber-400 hover:text-red-500">&times;</button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              {totalSelected > 0 ? `${totalSelected} produit(s) sélectionné(s)` : 'Aucun produit sélectionné'}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary px-5 py-2.5 text-base">Annuler</button>
              <button type="button" onClick={handleSubmit} disabled={createMutation.isPending || totalSelected === 0}
                className="btn-primary px-6 py-2.5 text-base disabled:opacity-50 flex items-center gap-2">
                {createMutation.isPending ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Création...</>
                ) : (
                  <><Factory size={16} /> Créer le plan ({totalSelected})</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
