import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productLossesApi } from '../../api/product-losses.api';
import { productsApi } from '../../api/products.api';
import { serverUrl } from '../../api/client';
import { useReferentiel } from '../../hooks/useReferentiel';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Plus, X, Search, Loader2, AlertTriangle, Flame, Package, Clock,
  Trash2, TrendingDown, Factory, ShoppingBag, Recycle, BarChart3, Download, Camera,
} from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';

function n(v: number) { return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

// Fallback styling per loss type (icon/gradient can't come from DB)
const LOSS_TYPE_STYLE: Record<string, { color: string; bg: string; gradient: string; icon: typeof Flame }> = {
  production: { color: 'text-orange-700', bg: 'bg-orange-100', gradient: 'from-orange-500 to-amber-500', icon: Factory },
  vitrine: { color: 'text-red-700', bg: 'bg-red-100', gradient: 'from-red-500 to-rose-500', icon: Package },
  perime: { color: 'text-purple-700', bg: 'bg-purple-100', gradient: 'from-purple-500 to-violet-500', icon: Clock },
  recyclage: { color: 'text-emerald-700', bg: 'bg-emerald-100', gradient: 'from-emerald-500 to-green-500', icon: Recycle },
};
const DEFAULT_LOSS_STYLE = { color: 'text-gray-700', bg: 'bg-gray-100', gradient: 'from-gray-500 to-gray-400', icon: Package };

export default function LossesTab() {
  const queryClient = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<{ url: string; productName: string; date: string } | null>(null);

  // Dynamic referentiel data
  const { entries: lossTypeEntries, getLabel: getLossTypeLabel } = useReferentiel('loss_types');
  const { entries: lossReasonEntries, getLabel: getLossReasonLabel } = useReferentiel('loss_reasons');
  const { entries: prodLossReasons, getLabel: getProdLossReasonLabel } = useReferentiel('production_loss_reasons');

  // Build LOSS_TYPE_CONFIG dynamically from referentiel + fallback styling
  const LOSS_TYPE_CONFIG = Object.fromEntries(
    lossTypeEntries.map(e => [e.code, { label: e.label, ...(LOSS_TYPE_STYLE[e.code] || DEFAULT_LOSS_STYLE) }])
  );
  // Build combined reason labels from both referentiel tables
  const REASON_LABELS: Record<string, string> = Object.fromEntries([
    ...lossReasonEntries.map(e => [e.code, e.label]),
    ...prodLossReasons.map(e => [e.code, e.label]),
  ]);
  // Reasons by type: production uses production_loss_reasons, others use loss_reasons
  const REASONS_BY_TYPE: Record<string, string[]> = Object.fromEntries(
    lossTypeEntries.map(e => [
      e.code,
      e.code === 'production'
        ? prodLossReasons.map(r => r.code)
        : lossReasonEntries.map(r => r.code),
    ])
  );

  const { data: losses = [], isLoading } = useQuery({
    queryKey: ['product-losses', month, year, typeFilter],
    queryFn: () => {
      const params: Record<string, string> = { month: String(month), year: String(year) };
      if (typeFilter !== 'all') params.lossType = typeFilter;
      return productLossesApi.list(params);
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['product-losses-stats', month, year],
    queryFn: () => productLossesApi.stats(month, year),
  });

  const deleteMutation = useMutation({
    mutationFn: productLossesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-losses'] });
      queryClient.invalidateQueries({ queryKey: ['product-losses-stats'] });
      notify.success('Perte supprimee');
    },
  });

  const lossList = losses as Record<string, any>[];

  // Totals from stats
  const totalsByType = useMemo(() => {
    const map: Record<string, { count: number; quantity: number; cost: number }> = {};
    let totalCost = 0;
    let totalQty = 0;
    let totalCount = 0;
    if (stats?.byType) {
      for (const row of stats.byType as Record<string, any>[]) {
        const t = row.loss_type as string;
        const cost = parseFloat(row.total_cost as string) || 0;
        const qty = parseFloat(row.total_quantity as string) || 0;
        const count = parseInt(row.count as string) || 0;
        map[t] = { count, quantity: qty, cost };
        totalCost += cost;
        totalQty += qty;
        totalCount += count;
      }
    }
    return { map, totalCost, totalQty, totalCount };
  }, [stats]);

  const handleExport = () => {
    const rows = lossList.map(l => [
      format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm'),
      l.product_name as string,
      LOSS_TYPE_CONFIG[l.loss_type as string]?.label || l.loss_type,
      REASON_LABELS[l.reason as string] || l.reason,
      String(l.quantity),
      n(parseFloat(l.total_cost as string) || 0),
      (l.declared_by_first_name || '') + ' ' + (l.declared_by_last_name || ''),
      l.reason_note as string || '',
    ]);
    const BOM = '\uFEFF';
    const csv = BOM + [
      'DATE;PRODUIT;TYPE;MOTIF;QUANTITE;COUT (DH);DECLARE PAR;NOTE',
      ...rows.map(r => r.join(';'))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pertes_${MONTH_NAMES[month - 1]}_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Search panel : period + actions */}
      <div className="odoo-search-panel">
        <select value={month} onChange={e => setMonth(+e.target.value)} className="odoo-filter-dropdown" style={{ minWidth: 120 }}>
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={e => setYear(+e.target.value)}
          className="odoo-filter-dropdown" style={{ width: 80 }} />
        <div style={{ flex: 1 }} />
        <button onClick={handleExport} className="odoo-btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={13} /> Exporter
        </button>
        <button onClick={() => setShowForm(true)} className="odoo-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Déclarer une perte
        </button>
      </div>

      {/* KPI tiles */}
      <div className="odoo-stat-grid">
        <div className="odoo-stat-card">
          <div className="odoo-stat-card-label"><TrendingDown size={11} style={{ display: 'inline', marginRight: 4 }} />Total pertes</div>
          <div className="odoo-stat-card-value" style={{ color: '#dc3545' }}>{n(totalsByType.totalCost)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
          <div className="odoo-stat-card-sub">{totalsByType.totalCount} déclaration{totalsByType.totalCount > 1 ? 's' : ''}</div>
        </div>
        {Object.keys(LOSS_TYPE_CONFIG).map(type => {
          const config = LOSS_TYPE_CONFIG[type];
          const data = totalsByType.map[type] || { count: 0, quantity: 0, cost: 0 };
          const Icon = config.icon;
          return (
            <div key={type} className="odoo-stat-card">
              <div className="odoo-stat-card-label"><Icon size={11} style={{ display: 'inline', marginRight: 4 }} />{config.label}</div>
              <div className="odoo-stat-card-value">{n(data.cost)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span></div>
              <div className="odoo-stat-card-sub">{data.count} perte{data.count > 1 ? 's' : ''} · {data.quantity} unités</div>
            </div>
          );
        })}
      </div>

      {/* Filter chips */}
      <div className="odoo-search-panel">
        {[
          { key: 'all', label: 'Tout', count: totalsByType.totalCount },
          ...Object.entries(LOSS_TYPE_CONFIG).map(([key, cfg]) => ({
            key, label: cfg.label, count: totalsByType.map[key]?.count || 0,
          })),
        ].map(f => (
          <button key={f.key} onClick={() => setTypeFilter(f.key)}
            className="odoo-filter-dropdown"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              backgroundColor: typeFilter === f.key ? 'var(--theme-accent-light, rgba(0,0,0,0.05))' : 'transparent',
              color: typeFilter === f.key ? 'var(--theme-accent, var(--theme-text))' : 'var(--theme-text-muted)',
              fontWeight: typeFilter === f.key ? 600 : 400,
            }}>
            {f.label}
            {f.count > 0 && <span className="odoo-tag odoo-tag-grey" style={{ marginLeft: 2 }}>{f.count}</span>}
          </button>
        ))}
      </div>

      {/* Losses table */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--theme-text-muted)' }} />
          <span style={{ marginLeft: 8, fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>Chargement...</span>
        </div>
      ) : lossList.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--theme-text-muted)' }}>
          <TrendingDown size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ fontSize: '0.8125rem' }}>Aucune perte déclarée pour cette période</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="odoo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Produit</th>
                <th>Type</th>
                <th>Motif</th>
                <th style={{ textAlign: 'right' }}>Qté</th>
                <th style={{ textAlign: 'right' }}>Coût</th>
                <th>Déclaré par</th>
                <th style={{ textAlign: 'center', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lossList.map(l => {
                const lossType = l.loss_type as string;
                const tagClass = lossType === 'casse' ? 'odoo-tag-red'
                  : lossType === 'perimee' ? 'odoo-tag-orange'
                  : lossType === 'invendu' ? 'odoo-tag-yellow'
                  : lossType === 'erreur' ? 'odoo-tag-blue'
                  : 'odoo-tag-grey';
                const cfg = LOSS_TYPE_CONFIG[lossType] || LOSS_TYPE_CONFIG.casse;
                return (
                  <tr key={l.id as string}>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                      {format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td style={{ fontWeight: 500 }}>{l.product_name as string}</td>
                    <td><span className={`odoo-tag ${tagClass}`}>{cfg.label}</span></td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                      {REASON_LABELS[l.reason as string] || String(l.reason)}
                      {l.reason_note ? <span style={{ marginLeft: 4, color: 'var(--theme-bg-separator)' }}>— {String(l.reason_note)}</span> : null}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{parseFloat(l.quantity as string)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#dc3545' }}>
                      {n(parseFloat(l.total_cost as string) || 0)} <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-muted)', fontWeight: 400 }}>DH</span>
                    </td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: '0.6875rem' }}>
                      {l.declared_by_first_name ? `${l.declared_by_first_name} ${l.declared_by_last_name}` : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {l.photo_url && (
                          <button onClick={() => setViewPhoto({
                            url: serverUrl(l.photo_url as string),
                            productName: l.product_name as string,
                            date: format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm'),
                          })}
                            style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--theme-text-muted)' }}
                            title="Voir la photo">
                            <Camera size={13} />
                          </button>
                        )}
                        <button onClick={() => deleteMutation.mutate(l.id as string)}
                          style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc3545' }}
                          title="Supprimer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lossList.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.03))', borderTop: '2px solid var(--theme-bg-separator)' }}>
                  <td colSpan={4} style={{ padding: 12, fontWeight: 600 }}>
                    Total ({lossList.length} perte{lossList.length > 1 ? 's' : ''})
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {lossList.reduce((s, l) => s + parseFloat(l.quantity as string), 0)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#dc3545' }}>
                    {n(lossList.reduce((s, l) => s + (parseFloat(l.total_cost as string) || 0), 0))} DH
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Photo viewer overlay */}
      {viewPhoto && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setViewPhoto(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50">
              <div>
                <h3 className="font-bold text-gray-900">{viewPhoto.productName}</h3>
                <p className="text-xs text-gray-500">Photo prise le {viewPhoto.date}</p>
              </div>
              <button onClick={() => setViewPhoto(null)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-400">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 bg-gray-100">
              <img src={viewPhoto.url} alt={`Photo de ${viewPhoto.productName}`}
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg" />
            </div>
          </div>
        </div>
      )}

      {/* Add loss modal */}
      {showForm && (
        <AddLossModal
          lossTypeConfig={LOSS_TYPE_CONFIG}
          reasonLabels={REASON_LABELS}
          reasonsByType={REASONS_BY_TYPE}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['product-losses'] });
            queryClient.invalidateQueries({ queryKey: ['product-losses-stats'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setShowForm(false);
          }}
        />
      )}
    </>
  );
}

/* ═══════════════════════ ADD LOSS MODAL ═══════════════════════ */
function AddLossModal({ onClose, onSuccess, lossTypeConfig: LOSS_TYPE_CONFIG, reasonLabels: REASON_LABELS, reasonsByType: REASONS_BY_TYPE }: {
  onClose: () => void;
  onSuccess: () => void;
  lossTypeConfig: Record<string, { label: string; color: string; bg: string; gradient: string; icon: typeof Flame }>;
  reasonLabels: Record<string, string>;
  reasonsByType: Record<string, string[]>;
}) {
  const [lossType, setLossType] = useState('');
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [quantity, setQuantity] = useState('');
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: productsData } = useQuery({
    queryKey: ['products', { limit: '500' }],
    queryFn: () => productsApi.list({ limit: '500' }),
  });

  const products = (productsData?.data || []) as Record<string, any>[];

  const selectedProduct = productId ? products.find(p => p.id === productId) : null;

  const normalizeStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filteredProducts = products.filter(p => {
    if (!productSearch.trim()) return true;
    const q = normalizeStr(productSearch);
    const name = normalizeStr(p.name as string);
    return q.split(/\s+/).filter(Boolean).every(w => name.includes(w));
  });

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const createMutation = useMutation({
    mutationFn: productLossesApi.create,
    onSuccess: () => {
      notify.success('Perte declaree avec succes');
      onSuccess();
    },
    onError: () => notify.error('Erreur lors de la declaration'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) { notify.error('Selectionnez un produit'); return; }
    if (!lossType) { notify.error('Selectionnez un type de perte'); return; }
    if (!reason) { notify.error('Selectionnez un motif'); return; }
    if (!quantity || parseFloat(quantity) <= 0) { notify.error('La quantite doit etre superieure a 0'); return; }
    createMutation.mutate({
      productId, quantity: parseFloat(quantity), lossType, reason,
      reasonNote: reasonNote || undefined,
    });
  };

  const availableReasons = lossType ? REASONS_BY_TYPE[lossType] || [] : [];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-rose-500 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <TrendingDown size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Declarer une perte</h2>
              <p className="text-sm text-white/70">Production, casse ou perime</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Loss type selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Type de perte *</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(LOSS_TYPE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const isSelected = lossType === key;
                return (
                  <button type="button" key={key} onClick={() => { setLossType(key); setReason(''); }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? `border-transparent bg-gradient-to-r ${cfg.gradient} text-white shadow-md`
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}>
                    <Icon size={18} className={isSelected ? 'text-white' : 'text-gray-400'} />
                    <span className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product search */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Produit *</label>
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input ref={searchRef} type="text"
                className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors ${
                  selectedProduct ? 'bg-red-50 border-red-300 font-semibold text-red-800' : 'bg-gray-50 border-gray-200'
                }`}
                placeholder="Rechercher un produit..."
                value={dropdownOpen ? productSearch : (selectedProduct ? selectedProduct.name as string : productSearch)}
                onChange={(e) => { setProductSearch(e.target.value); setDropdownOpen(true); if (productId) setProductId(''); }}
                onFocus={() => { setDropdownOpen(true); if (selectedProduct) setProductSearch(''); }}
                autoComplete="off" />
              {(selectedProduct || productSearch) && (
                <button type="button" onClick={() => { setProductId(''); setProductSearch(''); searchRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-lg">
                  <X size={14} className="text-gray-400" />
                </button>
              )}
            </div>
            {dropdownOpen && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                {filteredProducts.length === 0 ? (
                  <div className="px-4 py-4 text-center text-sm text-gray-400">Aucun produit trouve</div>
                ) : (
                  filteredProducts.slice(0, 15).map(p => (
                    <button type="button" key={p.id as string}
                      className="w-full text-left px-3 py-2.5 hover:bg-red-50 flex items-center gap-3 transition-colors"
                      onClick={() => { setProductId(p.id as string); setProductSearch(''); setDropdownOpen(false); }}>
                      {p.image_url ? (
                        <img src={serverUrl(p.image_url as string)} alt="" className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ShoppingBag size={12} className="text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{p.name as string}</p>
                        <p className="text-xs text-gray-400">{p.category_name as string || ''}</p>
                      </div>
                      <span className="text-xs text-gray-400">{parseFloat(p.price as string || '0').toFixed(2)} DH</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Reason */}
          {lossType && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Motif *</label>
              <select value={reason} onChange={e => setReason(e.target.value)} required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                <option value="">-- Choisir un motif --</option>
                {availableReasons.map(r => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Quantite perdue *</label>
            <input type="number" min="0.01" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Ex: 5" />
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Note (optionnel)</label>
            <textarea value={reasonNote} onChange={e => setReasonNote(e.target.value)} rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              placeholder="Details supplementaires..." />
          </div>

          {/* Cost preview */}
          {selectedProduct && quantity && parseFloat(quantity) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm text-red-700">Cout estime de la perte</span>
              <span className="text-lg font-bold text-red-700">
                {n((parseFloat(selectedProduct.cost_price as string) || parseFloat(selectedProduct.price as string) || 0) * parseFloat(quantity))} DH
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all text-sm">
              Annuler
            </button>
            <button type="submit" disabled={createMutation.isPending}
              className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all text-sm flex items-center gap-2">
              {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Declarer la perte
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
