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

  const lossList = losses as Record<string, unknown>[];

  // Totals from stats
  const totalsByType = useMemo(() => {
    const map: Record<string, { count: number; quantity: number; cost: number }> = {};
    let totalCost = 0;
    let totalQty = 0;
    let totalCount = 0;
    if (stats?.byType) {
      for (const row of stats.byType as Record<string, unknown>[]) {
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
      {/* Month selector + actions */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select value={month} onChange={e => setMonth(+e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-auto">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(+e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all flex items-center gap-2 text-sm shadow-sm">
            <Download size={14} /> Exporter
          </button>
          <button onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm">
            <Plus size={16} /> Declarer une perte
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
              <TrendingDown size={16} className="text-white" />
            </div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total pertes</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{n(totalsByType.totalCost)} <span className="text-sm font-normal text-gray-400">DH</span></p>
          <p className="text-xs text-gray-400 mt-1">{totalsByType.totalCount} declaration{totalsByType.totalCount > 1 ? 's' : ''}</p>
        </div>
        {Object.keys(LOSS_TYPE_CONFIG).map(type => {
          const config = LOSS_TYPE_CONFIG[type];
          const data = totalsByType.map[type] || { count: 0, quantity: 0, cost: 0 };
          const Icon = config.icon;
          return (
            <div key={type} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${config.gradient} flex items-center justify-center`}>
                  <Icon size={16} className="text-white" />
                </div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{config.label}</p>
              </div>
              <p className={`text-2xl font-bold ${config.color}`}>{n(data.cost)} <span className="text-sm font-normal text-gray-400">DH</span></p>
              <p className="text-xs text-gray-400 mt-1">{data.count} perte{data.count > 1 ? 's' : ''} — {data.quantity} unites</p>
            </div>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2">
        <div className="flex gap-1 bg-gray-50 rounded-xl p-1">
          {[
            { key: 'all', label: 'Tout', count: totalsByType.totalCount },
            ...Object.entries(LOSS_TYPE_CONFIG).map(([key, cfg]) => ({
              key, label: cfg.label, count: totalsByType.map[key]?.count || 0,
            })),
          ].map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                typeFilter === f.key ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {f.label}
              {f.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  typeFilter === f.key ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-500'
                }`}>{f.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Top products + Top reasons (side by side) */}
      {stats && (stats.topProducts as Record<string, unknown>[])?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top products */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center">
                <BarChart3 size={12} className="text-white" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Top produits les plus perdus</p>
            </div>
            <div className="space-y-2">
              {(stats.topProducts as Record<string, unknown>[]).slice(0, 5).map((p, i) => {
                const cost = parseFloat(p.total_cost as string) || 0;
                const maxCost = parseFloat((stats.topProducts as Record<string, unknown>[])[0]?.total_cost as string) || 1;
                return (
                  <div key={p.id as string} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{p.name as string}</p>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-red-400 to-rose-500 rounded-full" style={{ width: `${(cost / maxCost) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-red-600 whitespace-nowrap">{n(cost)} DH</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top reasons */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <AlertTriangle size={12} className="text-white" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Motifs les plus frequents</p>
            </div>
            <div className="space-y-2">
              {(stats.topReasons as Record<string, unknown>[]).slice(0, 6).map((r, i) => {
                const cfg = LOSS_TYPE_CONFIG[r.loss_type as string];
                return (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg?.bg} ${cfg?.color}`}>
                        {cfg?.label}
                      </span>
                      <span className="text-sm text-gray-700">{REASON_LABELS[r.reason as string] || String(r.reason)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{r.count as number}x</span>
                      <span className="text-sm font-bold text-gray-700">{n(parseFloat(r.total_cost as string) || 0)} DH</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Losses table */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="animate-spin text-red-400 mb-3" size={32} />
          <p className="text-sm text-gray-400">Chargement des pertes...</p>
        </div>
      ) : lossList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
            <TrendingDown size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-400 font-medium">Aucune perte declaree pour cette periode</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Produit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Motif</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Qte</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Cout</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Declare par</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lossList.map(l => {
                const cfg = LOSS_TYPE_CONFIG[l.loss_type as string] || LOSS_TYPE_CONFIG.casse;
                return (
                  <tr key={l.id as string} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 text-xs">{format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm')}</td>
                    <td className="px-4 py-3 font-medium text-gray-700">{l.product_name as string}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {REASON_LABELS[l.reason as string] || String(l.reason)}
                      {l.reason_note ? <span className="text-gray-400 ml-1">— {String(l.reason_note)}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-700">{parseFloat(l.quantity as string)}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">{n(parseFloat(l.total_cost as string) || 0)} DH</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {l.declared_by_first_name ? `${l.declared_by_first_name} ${l.declared_by_last_name}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {l.photo_url && (
                          <button onClick={() => setViewPhoto({
                            url: serverUrl(l.photo_url as string),
                            productName: l.product_name as string,
                            date: format(new Date(l.created_at as string), 'dd/MM/yyyy HH:mm'),
                          })}
                            className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-400 hover:text-blue-600 transition-colors"
                            title="Voir la photo">
                            <Camera size={14} />
                          </button>
                        )}
                        <button onClick={() => deleteMutation.mutate(l.id as string)}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 transition-colors"
                          title="Supprimer">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lossList.length > 0 && (
              <tfoot>
                <tr className="bg-gradient-to-r from-red-500 to-rose-500 text-white">
                  <td colSpan={4} className="px-4 py-3 font-medium rounded-bl-2xl">Total ({lossList.length} perte{lossList.length > 1 ? 's' : ''})</td>
                  <td className="px-4 py-3 text-right font-bold">
                    {lossList.reduce((s, l) => s + parseFloat(l.quantity as string), 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-lg font-bold">
                    {n(lossList.reduce((s, l) => s + (parseFloat(l.total_cost as string) || 0), 0))} DH
                  </td>
                  <td colSpan={2} className="rounded-br-2xl"></td>
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
function AddLossModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
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

  const products = (productsData?.data || []) as Record<string, unknown>[];

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
