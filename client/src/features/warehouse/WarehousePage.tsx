import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { ingredientLotsApi } from '../../api/inventory.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import {
  Truck, Loader2, Package, ClipboardList, CheckCircle, Eye, Clock, AlertTriangle,
  Archive, XCircle, Lock, Beaker, ChevronDown, ChevronRight, CalendarClock,
  Search, ArrowUpDown,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { fr } from 'date-fns/locale';

type Tab = 'active' | 'history' | 'pesage';

/**
 * Tableau de bord du magasinier : file d'attente des bons de sortie a preparer
 * pour le store courant. Trois colonnes (statuts) :
 *   - A prendre en charge (genere)
 *   - En preparation     (preparation)
 *   - Pret a remettre    (pret)
 *
 * Cliquer sur une carte ouvre le BSI en vue "page autonome" (BonSortiePrelevementPage)
 * ou directement le plan (chef et magasinier partagent la meme interface).
 */
export default function WarehousePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isMagasinier = ['admin', 'manager', 'magasinier'].includes(user?.role || '');
  const [tab, setTab] = useState<Tab>('active');
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyLimit = 30;

  const { data: bons = [], isLoading, refetch, isRefetching } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-queue'],
    queryFn: bonSortieApi.warehouseQueue,
    refetchInterval: tab === 'active' ? 15000 : false, // polling uniquement sur l'onglet actif
  });

  const { data: history, isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery<{
    data: Record<string, any>[]; total: number;
  }>({
    queryKey: ['warehouse-history', historyLimit, historyOffset],
    queryFn: () => bonSortieApi.warehouseHistory({ limit: historyLimit, offset: historyOffset }),
    enabled: tab === 'history',
  });

  // Onglet "Stock pesage" : ingredients actuellement ouverts (pesage_quantity > 0).
  // Source de verite = lots actifs avec pesage_quantity > 0, agrege par ingredient.
  const { data: pesageStock = [], isLoading: isLoadingPesage, refetch: refetchPesage } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-pesage-stock'],
    queryFn: ingredientLotsApi.pesageStock,
    enabled: tab === 'pesage',
    refetchInterval: tab === 'pesage' ? 30000 : false,
  });

  // Actions rapides sur les cartes : le magasinier peut prendre en charge ou marquer pret
  // sans ouvrir le detail du BSI. Utile quand il gere une file de 10+ demandes.
  const takeChargeMutation = useMutation({
    mutationFn: (bonId: string) => bonSortieApi.markPreparation(bonId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
      notify.success('Pris en charge — le chef a ete notifie');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const markReadyMutation = useMutation({
    mutationFn: (bonId: string) => bonSortieApi.markReady(bonId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-queue'] });
      notify.success('Marque comme pret — le chef a ete notifie');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  if (!isMagasinier) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <AlertTriangle size={40} className="mx-auto text-amber-400 mb-3" />
        <h1 className="text-xl font-bold text-gray-800">Accès réservé</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cette interface est destinée aux magasiniers (et aux admins/managers).
        </p>
      </div>
    );
  }

  const byStatus = {
    genere: bons.filter(b => b.status === 'genere'),
    preparation: bons.filter(b => b.status === 'preparation'),
    pret: bons.filter(b => b.status === 'pret'),
  };

  const Column = ({
    title, bons: items, emptyLabel, color, icon: Icon,
  }: {
    title: string;
    bons: Record<string, any>[];
    emptyLabel: string;
    color: 'blue' | 'amber' | 'emerald';
    icon: typeof Truck;
  }) => {
    const colorClasses = {
      blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
      amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
      emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
    }[color];

    return (
      <div className="flex-1 min-w-[280px]">
        <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg ${colorClasses.bg} border ${colorClasses.border}`}>
          <Icon size={16} className={colorClasses.text} />
          <h2 className={`text-sm font-semibold ${colorClasses.text}`}>{title}</h2>
          <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${colorClasses.badge}`}>
            {items.length}
          </span>
        </div>
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="text-xs text-gray-400 italic text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              {emptyLabel}
            </div>
          ) : (
            items.map(bon => {
              const bonId = bon.id as string;
              const status = bon.status as string;
              const isTakingCharge = takeChargeMutation.isPending && takeChargeMutation.variables === bonId;
              const isMarkingReady = markReadyMutation.isPending && markReadyMutation.variables === bonId;
              return (
              <div
                key={bonId}
                className="bg-white border border-gray-200 rounded-xl p-3 hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-gray-500">{bon.numero as string}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${colorClasses.badge}`}>
                    {bon.total_lines} ligne{Number(bon.total_lines) > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 mb-1">
                  <Package size={13} className="text-gray-400 shrink-0" />
                  <span className="truncate">
                    Plan du {bon.plan_date ? format(new Date(bon.plan_date as string), 'dd MMM', { locale: fr }) : '—'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                  {bon.generated_by_name && (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-gray-400">Par :</span>
                      <strong>{bon.generated_by_name as string}</strong>
                    </span>
                  )}
                  {status === 'preparation' && bon.preparation_by_name && (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <Clock size={10} />
                      {bon.preparation_by_name as string}
                    </span>
                  )}
                  {status === 'pret' && bon.ready_by_name && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle size={10} />
                      pret par {bon.ready_by_name as string}
                    </span>
                  )}
                  {bon.chef_reject_reason && (
                    <span className="inline-flex items-center gap-1 text-red-600 w-full mt-1 bg-red-50 border border-red-200 rounded px-2 py-1 text-[10px]">
                      <AlertTriangle size={10} />
                      Refuse : {bon.chef_reject_reason as string}
                    </span>
                  )}
                </div>

                {/* Actions rapides : bouton principal selon statut + "Ouvrir" pour voir le detail */}
                <div className="mt-3 flex gap-1.5">
                  {isMagasinier && status === 'genere' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); takeChargeMutation.mutate(bonId); }}
                      disabled={isTakingCharge}
                      className="flex-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                      {isTakingCharge ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                      Prendre en charge
                    </button>
                  )}
                  {isMagasinier && status === 'preparation' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); markReadyMutation.mutate(bonId); }}
                      disabled={isMarkingReady}
                      className="flex-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                      {isMarkingReady ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Pret a remettre
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/warehouse/bsi/${bon.plan_id}`)}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors flex items-center gap-1"
                  >
                    <Eye size={12} /> Détail
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const historyRows = history?.data || [];
  const historyTotal = history?.total || 0;

  // Resume des statuts pour les badges des onglets
  const activeCount = bons.length;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck size={24} className="text-amber-600" />
            Pesage — Stock en cours
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            BSI à préparer + sacs/contenants ouverts en cours d'utilisation. Source FEFO de la production.
          </p>
        </div>
        <button
          onClick={() => (tab === 'active' ? refetch() : tab === 'pesage' ? refetchPesage() : refetchHistory())}
          disabled={isRefetching}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-1.5 disabled:opacity-60">
          {isRefetching ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
          Rafraichir
        </button>
      </div>

      {/* Barre d'onglets : File active / Historique */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setTab('active')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-all ${
            tab === 'active'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          <ClipboardList size={14} />
          <span>File active</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
            tab === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {activeCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('pesage')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-all ${
            tab === 'pesage'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          <Beaker size={14} />
          <span>Stock pesage</span>
          {pesageStock.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === 'pesage' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {pesageStock.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-all ${
            tab === 'history'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          <Archive size={14} />
          <span>Historique</span>
          {historyTotal > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              tab === 'history' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {historyTotal}
            </span>
          )}
        </button>
      </div>

      {/* Contenu selon l'onglet */}
      {tab === 'active' ? (
        isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-amber-500" />
          </div>
        ) : (
          <div className="flex flex-col md:flex-row gap-4">
            <Column
              title="A prendre en charge"
              bons={byStatus.genere}
              emptyLabel="Aucune demande en attente"
              color="blue"
              icon={Truck}
            />
            <Column
              title="En preparation"
              bons={byStatus.preparation}
              emptyLabel="Aucun bon en cours de preparation"
              color="amber"
              icon={Clock}
            />
            <Column
              title="Pret a remettre"
              bons={byStatus.pret}
              emptyLabel="Aucun bon pret"
              color="emerald"
              icon={CheckCircle}
            />
          </div>
        )
      ) : tab === 'pesage' ? (
        <PesageStockList rows={pesageStock} isLoading={isLoadingPesage} />
      ) : (
        <HistoryList
          rows={historyRows}
          total={historyTotal}
          isLoading={isLoadingHistory}
          limit={historyLimit}
          offset={historyOffset}
          onOffsetChange={setHistoryOffset}
          onOpen={(planId) => navigate(`/warehouse/bsi/${planId}`)}
        />
      )}
    </div>
  );
}

// ─── Onglet "Stock pesage" : ingredients actuellement ouverts au pesage ───
// Aggregation par ingredient (1 ligne) avec details des lots ouverts (expansion).
type PesageSort = 'dlc_asc' | 'name_asc' | 'qty_desc' | 'qty_asc';
function PesageStockList({ rows, isLoading }: { rows: Record<string, any>[]; isLoading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<PesageSort>('dlc_asc');
  const [filterExpiringSoon, setFilterExpiringSoon] = useState(false);

  // Calcule daysUntil une fois pour tri/filtre, evite Date.now() dans chaque comparaison.
  type EnrichedRow = Record<string, any> & { _daysUntil: number | null };
  const enriched: EnrichedRow[] = rows.map(r => {
    const dlc = r.nearest_dlc_effective ? new Date(r.nearest_dlc_effective as string) : null;
    const daysUntil = dlc ? differenceInDays(dlc, new Date()) : null;
    return { ...r, _daysUntil: daysUntil };
  });

  const filtered = enriched.filter(r => {
    if (search) {
      const q = search.toLowerCase().trim();
      const name = ((r.ingredient_name as string) || '').toLowerCase();
      if (!name.includes(q)) return false;
    }
    if (filterExpiringSoon) {
      const d = r._daysUntil;
      if (d === null || d > 7) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'name_asc':
        return ((a.ingredient_name as string) || '').localeCompare((b.ingredient_name as string) || '', 'fr');
      case 'qty_desc':
        return parseFloat(b.total_pesage as string || '0') - parseFloat(a.total_pesage as string || '0');
      case 'qty_asc':
        return parseFloat(a.total_pesage as string || '0') - parseFloat(b.total_pesage as string || '0');
      case 'dlc_asc':
      default: {
        const da = a._daysUntil;
        const db = b._daysUntil;
        if (da === null && db === null) return 0;
        if (da === null) return 1;  // pas de DLC en bas
        if (db === null) return -1;
        return da - db;
      }
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">
        Aucun ingredient au pesage actuellement. Ouvre un contenant via la page lot pour commencer.
      </div>
    );
  }

  // Compteurs pour les badges
  const expiringSoonCount = enriched.filter(r => r._daysUntil !== null && (r._daysUntil as number) <= 7).length;

  return (
    <div className="space-y-3">
      {/* Barre d'outils : recherche + tri + filtres */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un ingredient..."
            className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:bg-white outline-none transition"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <ArrowUpDown size={12} />
          <select
            value={sortBy} onChange={(e) => setSortBy(e.target.value as PesageSort)}
            className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-700 focus:ring-2 focus:ring-amber-400 focus:bg-white outline-none cursor-pointer">
            <option value="dlc_asc">DLC la plus proche</option>
            <option value="name_asc">Nom A-Z</option>
            <option value="qty_desc">Qty decroissante</option>
            <option value="qty_asc">Qty croissante</option>
          </select>
        </div>
        <button
          onClick={() => setFilterExpiringSoon(!filterExpiringSoon)}
          className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
            filterExpiringSoon
              ? 'bg-amber-100 text-amber-800 border-amber-300'
              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
          }`}>
          <CalendarClock size={12} />
          Expirant ≤7j
          {expiringSoonCount > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              filterExpiringSoon ? 'bg-amber-200 text-amber-900' : 'bg-gray-200 text-gray-700'
            }`}>
              {expiringSoonCount}
            </span>
          )}
        </button>
        {(search || filterExpiringSoon || sortBy !== 'dlc_asc') && (
          <button
            onClick={() => { setSearch(''); setFilterExpiringSoon(false); setSortBy('dlc_asc'); }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors">
            Reinitialiser
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 bg-amber-50/50 border-b border-amber-100 text-xs text-amber-800">
          <strong>{sorted.length}</strong> sur <strong>{rows.length}</strong> ingredient{rows.length > 1 ? 's' : ''} affiche{sorted.length > 1 ? 's' : ''}
          {(search || filterExpiringSoon) ? ' (filtres actifs)' : ''}.
        </div>
        {sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400 italic">
            Aucun ingredient ne correspond aux filtres.
          </div>
        ) : (
        <div className="divide-y divide-gray-50">
          {sorted.map((r) => {
          const ingredientId = r.ingredient_id as string;
          const isOpen = expanded === ingredientId;
          const total = parseFloat(r.total_pesage as string || '0');
          const lotsCount = parseInt(r.lots_count as string || '0', 10);
          const dlc = r.nearest_dlc_effective ? new Date(r.nearest_dlc_effective as string) : null;
          const daysUntil = dlc ? differenceInDays(dlc, new Date()) : null;
          const dlcClass = daysUntil === null ? 'text-gray-400' : daysUntil < 0 ? 'text-red-600 font-bold' : daysUntil <= 3 ? 'text-orange-600 font-bold' : daysUntil <= 7 ? 'text-amber-600' : 'text-gray-500';
          const lots = (r.lots as Record<string, any>[]) || [];
          return (
            <div key={ingredientId}>
              <div onClick={() => setExpanded(isOpen ? null : ingredientId)}
                className="px-5 py-3.5 flex items-center gap-4 cursor-pointer hover:bg-amber-50/30 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0">
                  <Beaker size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{r.ingredient_name as string}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {lotsCount} lot{lotsCount > 1 ? 's' : ''} ouvert{lotsCount > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-amber-900 font-mono">{total.toFixed(2)} {r.ingredient_unit as string}</div>
                  {dlc ? (
                    <div className={`text-[11px] mt-0.5 flex items-center gap-1 justify-end ${dlcClass}`}>
                      <CalendarClock size={10} />
                      <span>{format(dlc, 'dd/MM/yyyy')}</span>
                      <span>·</span>
                      <span>
                        {daysUntil !== null && daysUntil < 0
                          ? `Expire -${Math.abs(daysUntil)}j`
                          : daysUntil === 0
                            ? "auj."
                            : `J-${daysUntil}`}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                </div>
              </div>
              {isOpen && lots.length > 0 && (
                <div className="px-5 pb-3 pt-0 ml-12 space-y-1.5">
                  {lots.map((lot, i) => {
                    const pq = parseFloat(lot.pesage_quantity as string || '0');
                    const eq = parseFloat(lot.economat_quantity as string || '0');
                    const lotDlc = (lot.effective_expiry_after_opening || lot.expiration_date) as string | null;
                    const lotDays = lotDlc ? differenceInDays(new Date(lotDlc), new Date()) : null;
                    const lotDlcClass = lotDays === null ? 'text-gray-400' : lotDays < 0 ? 'text-red-600' : lotDays <= 3 ? 'text-orange-600' : lotDays <= 7 ? 'text-amber-600' : 'text-gray-500';
                    return (
                      <div key={i} className="bg-amber-50/40 border border-amber-100 rounded-lg px-3 py-2 flex items-center gap-3 text-xs">
                        <Package size={12} className="text-amber-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-bold text-amber-900">
                            {(lot.supplier_lot_number || lot.lot_number || '—') as string}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            {lot.supplier_name ? <span>{lot.supplier_name as string}</span> : null}
                            {lot.first_opened_at ? (
                              <span>Ouvert : {format(new Date(lot.first_opened_at as string), 'dd/MM/yyyy')}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-amber-900 font-semibold">{pq.toFixed(2)} {r.ingredient_unit as string}</div>
                          {eq > 0 && (
                            <div className="text-[10px] text-gray-400 mt-0.5">+ {eq.toFixed(2)} en economat</div>
                          )}
                        </div>
                        {lotDlc ? (
                          <div className={`text-[10px] flex flex-col items-end shrink-0 ${lotDlcClass}`}>
                            <span className="flex items-center gap-1">
                              <CalendarClock size={10} />
                              {format(new Date(lotDlc), 'dd/MM/yyyy')}
                            </span>
                            <span>
                              {lotDays !== null && lotDays < 0
                                ? `Exp. -${Math.abs(lotDays)}j`
                                : lotDays === 0
                                  ? "Exp. auj."
                                  : `J-${lotDays}`}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </div>
        )}
      </div>
    </div>
  );
}

// ─── Composant Historique : liste plate triee par date, badges par statut ───
function HistoryList({
  rows, total, isLoading, limit, offset, onOffsetChange, onOpen,
}: {
  rows: Record<string, any>[];
  total: number;
  isLoading: boolean;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onOpen: (planId: string) => void;
}) {
  const statusConfig: Record<string, { label: string; className: string; icon: typeof Truck }> = {
    prelevement: { label: 'En prelevement', className: 'bg-amber-100 text-amber-700', icon: Clock },
    verifie: { label: 'Verifie', className: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
    cloture: { label: 'Livre', className: 'bg-emerald-100 text-emerald-700', icon: Lock },
    annule: { label: 'Annule', className: 'bg-red-100 text-red-700', icon: XCircle },
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-amber-500" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">
        Aucun BSI dans l'historique pour le moment.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((bon) => {
        const bonId = bon.id as string;
        const status = (bon.status as string) || 'cloture';
        const conf = statusConfig[status] || statusConfig.cloture;
        const StatusIcon = conf.icon;
        const finalDate = (bon.closed_at || bon.prelevement_at || bon.updated_at) as string | null;

        return (
          <div key={bonId}
            className="bg-white border border-gray-200 rounded-xl p-3 hover:shadow-sm hover:border-gray-300 transition-all">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-mono text-gray-500 shrink-0">{bon.numero as string}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${conf.className}`}>
                <StatusIcon size={10} />
                {conf.label}
              </span>
              <span className="text-xs text-gray-400">
                {bon.total_lines as number} ligne{Number(bon.total_lines) > 1 ? 's' : ''}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
                  <Package size={13} className="text-gray-400" />
                  Plan du {bon.plan_date ? format(new Date(bon.plan_date as string), 'dd MMM yyyy', { locale: fr }) : '—'}
                </span>
              </div>
              <span className="text-[11px] text-gray-500">
                {finalDate ? format(new Date(finalDate), 'dd MMM HH:mm', { locale: fr }) : ''}
              </span>
              <button
                onClick={() => onOpen(bon.plan_id as string)}
                className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors flex items-center gap-1">
                <Eye size={12} /> Detail
              </button>
            </div>
            <div className="mt-1.5 text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
              {bon.generated_by_name && <span>Demande par <strong>{bon.generated_by_name as string}</strong></span>}
              {bon.preparation_by_name && <span>Prepare par <strong>{bon.preparation_by_name as string}</strong></span>}
              {bon.ready_by_name && <span>Pret par <strong>{bon.ready_by_name as string}</strong></span>}
              {bon.prelevement_by_name && <span>Valide par <strong>{bon.prelevement_by_name as string}</strong></span>}
              {bon.chef_reject_reason && (
                <span className="text-red-600 w-full bg-red-50 border border-red-200 rounded px-2 py-1">
                  <AlertTriangle size={10} className="inline mr-1" />
                  Refus prec. : {bon.chef_reject_reason as string}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            {offset + 1}–{Math.min(offset + limit, total)} sur {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onOffsetChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-40">
              Precedent
            </button>
            <button
              onClick={() => onOffsetChange(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors disabled:opacity-40">
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
