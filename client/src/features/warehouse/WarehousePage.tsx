import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { useAuth } from '../../context/AuthContext';
import { notify } from '../../components/ui/InlineNotification';
import {
  Truck, Loader2, Package, ClipboardList, CheckCircle, Eye, Clock, AlertTriangle,
  Archive, XCircle, Lock,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

type Tab = 'active' | 'history';

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

  const { data: bons = [], isLoading, refetch, isRefetching } = useQuery<Record<string, unknown>[]>({
    queryKey: ['warehouse-queue'],
    queryFn: bonSortieApi.warehouseQueue,
    refetchInterval: tab === 'active' ? 15000 : false, // polling uniquement sur l'onglet actif
  });

  const { data: history, isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery<{
    data: Record<string, unknown>[]; total: number;
  }>({
    queryKey: ['warehouse-history', historyLimit, historyOffset],
    queryFn: () => bonSortieApi.warehouseHistory({ limit: historyLimit, offset: historyOffset }),
    enabled: tab === 'history',
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
    bons: Record<string, unknown>[];
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
                    onClick={() => navigate(`/production/${bon.plan_id}/bon-sortie`)}
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
            Economat
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Preparez les bons de sortie d'ingredients demandes par les chefs.
          </p>
        </div>
        <button
          onClick={() => (tab === 'active' ? refetch() : refetchHistory())}
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
      ) : (
        <HistoryList
          rows={historyRows}
          total={historyTotal}
          isLoading={isLoadingHistory}
          limit={historyLimit}
          offset={historyOffset}
          onOffsetChange={setHistoryOffset}
          onOpen={(planId) => navigate(`/production/${planId}/bon-sortie`)}
        />
      )}
    </div>
  );
}

// ─── Composant Historique : liste plate triee par date, badges par statut ───
function HistoryList({
  rows, total, isLoading, limit, offset, onOffsetChange, onOpen,
}: {
  rows: Record<string, unknown>[];
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
