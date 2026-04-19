import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { stockFrigoApi } from '../../api/stock-frigo.api';
import { storesApi } from '../../api/stores.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import {
  Search, Snowflake, Package, AlertTriangle, Trash2,
  ChevronDown, ChevronUp, Clock, TrendingDown, TrendingUp,
  History, X, Pencil,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface StockEntry {
  id: string;
  product_id: string;
  product_name: string;
  product_price: string;
  store_id: string;
  quantity: string;
  lot_number: string | null;
  produced_at: string;
  expires_at: string | null;
  contenant_nom: string | null;
  contenant_type: string | null;
  plan_date: string;
  notes: string | null;
}

interface SummaryEntry {
  product_id: string;
  product_name: string;
  product_price: string;
  total_quantity: string;
  nb_lots: string;
  earliest_expiry: string | null;
}

interface Transaction {
  id: string;
  stock_frigo_id: string;
  type: string;
  quantity: string;
  reference_id: string | null;
  reference_type: string | null;
  performed_by_name: string | null;
  notes: string | null;
  created_at: string;
}

const TX_TYPE_LABELS: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  production_in:      { label: 'Production',       color: 'text-emerald-700 bg-emerald-50', icon: TrendingUp },
  sale_out:           { label: 'Vente',             color: 'text-red-700 bg-red-50',         icon: TrendingDown },
  replenishment_out:  { label: 'Approvisionnement', color: 'text-blue-700 bg-blue-50',      icon: TrendingDown },
  loss:               { label: 'Perte',             color: 'text-orange-700 bg-orange-50',   icon: Trash2 },
  expired:            { label: 'Perime',            color: 'text-red-700 bg-red-50',         icon: AlertTriangle },
  adjustment:         { label: 'Ajustement',        color: 'text-purple-700 bg-purple-50',   icon: Pencil },
};

function SortHeader({ label, sortKey: sk, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: string; currentKey: string; currentDir: 'asc' | 'desc';
  onSort: (key: string) => void; align?: 'left' | 'right' | 'center';
}) {
  const active = currentKey === sk;
  return (
    <th className={`${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 transition-colors`}
      onClick={() => onSort(sk)}>
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-cyan-500" /> : <ArrowDown size={12} className="text-cyan-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
        {label}
        {align !== 'right' && (active
          ? (currentDir === 'asc' ? <ArrowUp size={12} className="text-cyan-500" /> : <ArrowDown size={12} className="text-cyan-500" />)
          : <ArrowUpDown size={11} className="opacity-30" />)}
      </span>
    </th>
  );
}

export default function StockFrigoPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState(user?.storeId || '');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{ type: 'loss' | 'adjust'; entry: StockEntry } | null>(null);
  const [sortKey, setSortKey] = useState<string>('produced_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'produced_at' || key === 'expires_at' || key === 'quantity' ? 'desc' : 'asc'); }
  };

  // Fetch stores for picker
  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: storesApi.list,
  });

  // Auto-select first store if user has no store
  const storeId = selectedStoreId || (stores.length > 0 ? (stores[0] as Record<string, unknown>).id as string : '');

  const { data: stockItems = [], isLoading } = useQuery({
    queryKey: ['stock-frigo', storeId, includeExpired],
    queryFn: () => stockFrigoApi.list(storeId, includeExpired),
    enabled: !!storeId,
  });

  const { data: summary = [] } = useQuery({
    queryKey: ['stock-frigo-summary', storeId],
    queryFn: () => stockFrigoApi.summary(storeId),
    enabled: !!storeId,
  });

  // Transactions for expanded row
  const { data: transactions = [] } = useQuery({
    queryKey: ['stock-frigo-tx', expandedId],
    queryFn: () => stockFrigoApi.transactions(expandedId!),
    enabled: !!expandedId,
  });

  const lossMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; type: 'loss' | 'expired'; notes?: string } }) =>
      stockFrigoApi.recordLoss(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-frigo'] });
      queryClient.invalidateQueries({ queryKey: ['stock-frigo-summary'] });
      queryClient.invalidateQueries({ queryKey: ['stock-frigo-tx'] });
      notify.success('Perte enregistree');
      setActionModal(null);
    },
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; notes?: string } }) =>
      stockFrigoApi.adjust(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-frigo'] });
      queryClient.invalidateQueries({ queryKey: ['stock-frigo-summary'] });
      queryClient.invalidateQueries({ queryKey: ['stock-frigo-tx'] });
      notify.success('Quantite ajustee');
      setActionModal(null);
    },
  });

  const filtered = (stockItems as StockEntry[]).filter(e =>
    e.product_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'product_name': cmp = a.product_name.localeCompare(b.product_name); break;
        case 'quantity': cmp = parseFloat(a.quantity) - parseFloat(b.quantity); break;
        case 'lot_number': cmp = (a.lot_number || '').localeCompare(b.lot_number || ''); break;
        case 'produced_at': cmp = new Date(a.produced_at).getTime() - new Date(b.produced_at).getTime(); break;
        case 'expires_at': {
          const dA = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
          const dB = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
          cmp = dA - dB; break;
        }
        case 'contenant_nom': cmp = (a.contenant_nom || '').localeCompare(b.contenant_nom || ''); break;
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalQty = (summary as SummaryEntry[]).reduce((s, e) => s + parseFloat(e.total_quantity), 0);
  const totalLots = (summary as SummaryEntry[]).reduce((s, e) => s + parseInt(e.nb_lots), 0);
  const expiringCount = (stockItems as StockEntry[]).filter(e => {
    if (!e.expires_at) return false;
    const d = new Date(e.expires_at);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return d <= tomorrow;
  }).length;

  return (
    <div className="space-y-5">
      {/* ─── Header + Store Picker ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-100 flex items-center justify-center">
            <Snowflake size={20} className="text-cyan-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Stock Frigo</h2>
            <p className="text-xs text-gray-500">Surplus de production — FEFO</p>
          </div>
        </div>
        {stores.length > 1 && (
          <select
            value={storeId}
            onChange={e => setSelectedStoreId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {(stores as Record<string, unknown>[]).map(s => (
              <option key={s.id as string} value={s.id as string}>{s.name as string}</option>
            ))}
          </select>
        )}
      </div>

      {/* ─── Summary Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-cyan-700">{(summary as SummaryEntry[]).length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Produits</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-gray-700">{totalLots}</div>
          <div className="text-xs text-gray-500 mt-0.5">Lots</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-indigo-700">{totalQty}</div>
          <div className="text-xs text-gray-500 mt-0.5">Quantite totale</div>
        </div>
        {expiringCount > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
            <div className="text-2xl font-bold text-red-700">{expiringCount}</div>
            <div className="text-xs text-red-500 mt-0.5">Expiration imminente</div>
          </div>
        )}
      </div>

      {/* ─── Search + Filters ─── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Rechercher un produit..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={includeExpired}
            onChange={e => setIncludeExpired(e.target.checked)}
            className="rounded border-gray-300"
          />
          Inclure perimes
        </label>
      </div>

      {/* ─── Stock Table ─── */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Snowflake size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">Aucun stock frigo</p>
          <p className="text-xs text-gray-400 mt-1">Le surplus de production apparaitra ici automatiquement</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <SortHeader label="Produit" sortKey="product_name" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Quantite" sortKey="quantity" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Lot" sortKey="lot_number" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Production" sortKey="produced_at" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Expiration" sortKey="expires_at" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <SortHeader label="Contenant" sortKey="contenant_nom" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                  <th className="text-center px-3 py-2.5 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  const isExpiring = entry.expires_at && new Date(entry.expires_at) <= new Date(Date.now() + 86400000);
                  const isExpired = entry.expires_at && new Date(entry.expires_at) <= new Date();

                  return (
                    <StockRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={isExpanded}
                      isExpiring={!!isExpiring}
                      isExpired={!!isExpired}
                      transactions={isExpanded ? (transactions as Transaction[]) : []}
                      onToggle={() => setExpandedId(isExpanded ? null : entry.id)}
                      onLoss={() => setActionModal({ type: 'loss', entry })}
                      onAdjust={() => setActionModal({ type: 'adjust', entry })}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Action Modal ─── */}
      {actionModal && (
        <ActionModal
          type={actionModal.type}
          entry={actionModal.entry}
          onClose={() => setActionModal(null)}
          onSubmitLoss={(data) => lossMutation.mutate({ id: actionModal.entry.id, data })}
          onSubmitAdjust={(data) => adjustMutation.mutate({ id: actionModal.entry.id, data })}
          isSubmitting={lossMutation.isPending || adjustMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Stock Row ───
function StockRow({ entry, isExpanded, isExpiring, isExpired, transactions, onToggle, onLoss, onAdjust }: {
  entry: StockEntry;
  isExpanded: boolean;
  isExpiring: boolean;
  isExpired: boolean;
  transactions: Transaction[];
  onToggle: () => void;
  onLoss: () => void;
  onAdjust: () => void;
}) {
  const qty = parseFloat(entry.quantity);

  return (
    <>
      <tr className={`border-b border-gray-50 transition-colors hover:bg-gray-50/60 ${isExpired ? 'opacity-50 bg-red-50/30' : isExpiring ? 'bg-amber-50/30' : ''}`}>
        <td className="px-4 py-3">
          <span className="font-medium text-gray-900">{entry.product_name}</span>
          {entry.notes && <div className="text-[10px] text-gray-400 mt-0.5">{entry.notes}</div>}
        </td>
        <td className="px-3 py-3 text-center">
          <span className={`font-bold ${qty <= 0 ? 'text-red-500' : 'text-gray-700'}`}>{qty}</span>
        </td>
        <td className="px-3 py-3 text-gray-600 font-mono text-xs">
          {entry.lot_number || <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-3 text-center text-gray-600 text-xs whitespace-nowrap">
          {format(new Date(entry.produced_at), 'dd/MM/yy HH:mm')}
        </td>
        <td className="px-3 py-3 text-center whitespace-nowrap">
          {entry.expires_at ? (
            <span className={`text-xs font-medium ${isExpired ? 'text-red-600' : isExpiring ? 'text-amber-600' : 'text-gray-600'}`}>
              {isExpired ? 'Perime' : format(new Date(entry.expires_at), 'dd/MM/yyyy')}
            </span>
          ) : <span className="text-gray-300 text-xs">—</span>}
        </td>
        <td className="px-3 py-3 text-center">
          {entry.contenant_nom ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
              {entry.contenant_nom}
            </span>
          ) : <span className="text-gray-300 text-xs">—</span>}
        </td>
        <td className="px-3 py-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <button onClick={onAdjust} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="Ajuster">
              <Pencil size={14} />
            </button>
            <button onClick={onLoss} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Declarer perte">
              <Trash2 size={14} />
            </button>
            <button onClick={onToggle} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors" title="Historique">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-gray-50/50 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-gray-500" />
              <span className="text-xs font-semibold text-gray-600 uppercase">Historique des mouvements</span>
            </div>
            {transactions.length === 0 ? (
              <p className="text-xs text-gray-400">Aucun mouvement</p>
            ) : (
              <div className="space-y-1.5">
                {transactions.map(tx => {
                  const cfg = TX_TYPE_LABELS[tx.type] || { label: tx.type, color: 'text-gray-700 bg-gray-50', icon: Clock };
                  const TxIcon = cfg.icon;
                  const txQty = parseFloat(tx.quantity);
                  return (
                    <div key={tx.id} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded-lg bg-white border border-gray-100">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                        <TxIcon size={10} /> {cfg.label}
                      </span>
                      <span className={`font-bold ${txQty >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {txQty >= 0 ? '+' : ''}{txQty}
                      </span>
                      {tx.performed_by_name && (
                        <span className="text-gray-500">par {tx.performed_by_name}</span>
                      )}
                      <span className="text-gray-400 ml-auto">
                        {format(new Date(tx.created_at), 'dd/MM/yy HH:mm')}
                      </span>
                      {tx.notes && <span className="text-gray-400 italic">{tx.notes}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Action Modal ───
function ActionModal({ type, entry, onClose, onSubmitLoss, onSubmitAdjust, isSubmitting }: {
  type: 'loss' | 'adjust';
  entry: StockEntry;
  onClose: () => void;
  onSubmitLoss: (data: { quantity: number; type: 'loss' | 'expired'; notes?: string }) => void;
  onSubmitAdjust: (data: { quantity: number; notes?: string }) => void;
  isSubmitting: boolean;
}) {
  const [quantity, setQuantity] = useState('');
  const [lossType, setLossType] = useState<'loss' | 'expired'>('loss');
  const [notes, setNotes] = useState('');
  const currentQty = parseFloat(entry.quantity);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) return;

    if (type === 'loss') {
      if (q > currentQty) return;
      onSubmitLoss({ quantity: q, type: lossType, notes: notes || undefined });
    } else {
      onSubmitAdjust({ quantity: q, notes: notes || undefined });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {type === 'loss' ? 'Declarer une perte' : 'Ajuster la quantite'}
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-sm font-medium text-gray-900">{entry.product_name}</div>
            <div className="text-xs text-gray-500 mt-1">
              Quantite actuelle: <span className="font-bold">{currentQty}</span>
              {entry.lot_number && <> — Lot: <span className="font-mono">{entry.lot_number}</span></>}
            </div>
          </div>

          {type === 'loss' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLossType('loss')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    lossType === 'loss' ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Perte
                </button>
                <button
                  type="button"
                  onClick={() => setLossType('expired')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    lossType === 'expired' ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  Perime
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              {type === 'loss' ? 'Quantite perdue' : 'Nouvelle quantite'}
            </label>
            <input
              type="number"
              step="any"
              min={type === 'loss' ? '0.01' : '0'}
              max={type === 'loss' ? String(currentQty) : undefined}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder={type === 'loss' ? `Max: ${currentQty}` : `Actuel: ${currentQty}`}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes (optionnel)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Raison..."
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !quantity}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition-colors ${
                type === 'loss'
                  ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300'
                  : 'bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300'
              }`}
            >
              {isSubmitting ? 'En cours...' : type === 'loss' ? 'Declarer' : 'Ajuster'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
