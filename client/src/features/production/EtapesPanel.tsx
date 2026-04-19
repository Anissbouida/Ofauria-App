import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  CheckCircle, Play, Clock, SkipForward, ListChecks, Timer,
  ChevronDown, ChevronRight, RotateCcw, AlertTriangle, Loader2
} from 'lucide-react';

interface EtapesPanelProps {
  planId: string;
  planStatus: string;
  isChef: boolean;
}

interface Etape {
  id: string;
  plan_item_id: string;
  product_name: string;
  ordre: number;
  nom: string;
  duree_estimee_min: number | null;
  est_bloquante: boolean;
  timer_auto: boolean;
  controle_qualite: boolean;
  checklist_items: string[];
  est_repetable: boolean;
  nb_repetitions_cible: number;
  nb_repetitions_actuelle: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  started_by_name: string | null;
  completed_by_name: string | null;
  timer_fire_at: string | null;
  duree_reelle_min: number | null;
  checklist_resultats: { label: string; ok: boolean; notes?: string }[];
  notes: string | null;
}

const statusColors = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  skipped: { bg: 'bg-amber-100', text: 'text-amber-600', dot: 'bg-amber-400' },
};

const statusLabels = { pending: 'A faire', in_progress: 'En cours', completed: 'Termine', skipped: 'Passe' };

export default function EtapesPanel({ planId, planStatus, isChef }: EtapesPanelProps) {
  const queryClient = useQueryClient();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, { label: string; ok: boolean }[]>>({});

  const { data: etapes = [], isLoading } = useQuery<Etape[]>({
    queryKey: ['production-etapes', planId],
    queryFn: () => productionEtapesApi.listByPlan(planId),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const { data: progress = [] } = useQuery({
    queryKey: ['production-etapes-progress', planId],
    queryFn: () => productionEtapesApi.planProgress(planId),
    enabled: planStatus === 'in_progress',
  });

  const updateMutation = useMutation({
    mutationFn: ({ etapeId, status, data }: { etapeId: string; status: string; data?: Record<string, unknown> }) =>
      productionEtapesApi.updateStatus(etapeId, { status, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
      queryClient.invalidateQueries({ queryKey: ['production-etapes-progress', planId] });
    },
  });

  const timerMutation = useMutation({
    mutationFn: (etapeId: string) => productionEtapesApi.startTimer(etapeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
      notify.success('Timer demarre');
    },
  });

  const repetitionMutation = useMutation({
    mutationFn: (etapeId: string) => productionEtapesApi.completeRepetition(etapeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
    },
  });

  if (etapes.length === 0 && !isLoading) return null;
  if (isLoading) return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center justify-center gap-2 text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Chargement des etapes...
    </div>
  );

  // Group by plan_item_id
  const grouped = new Map<string, { productName: string; etapes: Etape[] }>();
  for (const e of etapes) {
    const key = e.plan_item_id;
    if (!grouped.has(key)) grouped.set(key, { productName: e.product_name, etapes: [] });
    grouped.get(key)!.etapes.push(e);
  }

  const handleStartEtape = (etape: Etape) => {
    if (etape.timer_auto && etape.duree_estimee_min) {
      timerMutation.mutate(etape.id);
    } else {
      updateMutation.mutate({ etapeId: etape.id, status: 'in_progress' });
    }
  };

  const handleCompleteEtape = (etape: Etape) => {
    const data: Record<string, unknown> = {};
    if (etape.controle_qualite && checklistState[etape.id]) {
      data.checklist_resultats = checklistState[etape.id];
    }
    updateMutation.mutate({ etapeId: etape.id, status: 'completed', data });
    notify.success(`Etape "${etape.nom}" terminee`);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
        <ListChecks size={16} className="text-violet-600" />
        <h3 className="font-semibold text-gray-900 text-sm">Etapes de production</h3>
        <span className="text-xs text-gray-400">
          {etapes.filter(e => e.status === 'completed').length}/{etapes.length} terminees
        </span>
        {progress.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${(etapes.filter(e => e.status === 'completed').length / etapes.length) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {Array.from(grouped.entries()).map(([itemId, group]) => {
          const isExpanded = expandedItem === itemId;
          const completedCount = group.etapes.filter(e => e.status === 'completed').length;
          const totalCount = group.etapes.length;
          const hasBlocking = group.etapes.some(e => e.est_bloquante && e.status !== 'completed' && e.status !== 'skipped');
          const currentStep = group.etapes.find(e => e.status === 'in_progress') || group.etapes.find(e => e.status === 'pending');

          return (
            <div key={itemId}>
              <button onClick={() => setExpandedItem(isExpanded ? null : itemId)}
                className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left">
                {isExpanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="font-medium text-gray-900 text-sm flex-1">{group.productName}</span>
                {hasBlocking && <span title="Etapes bloquantes en attente"><AlertTriangle size={12} className="text-amber-500" /></span>}
                <span className="text-xs text-gray-400">{completedCount}/{totalCount}</span>
                <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
                </div>
                {currentStep && (
                  <span className="text-xs text-violet-600 truncate max-w-[120px]">{currentStep.nom}</span>
                )}
              </button>

              {isExpanded && (
                <div className="px-5 pb-4 space-y-2">
                  {group.etapes.map((etape) => {
                    const sc = statusColors[etape.status];
                    const timerActive = etape.status === 'in_progress' && etape.timer_fire_at;
                    const timerDone = timerActive && new Date(etape.timer_fire_at!) <= new Date();

                    return (
                      <div key={etape.id} className={`rounded-xl border p-3 ${etape.status === 'completed' ? 'border-emerald-200 bg-emerald-50/50' : etape.status === 'in_progress' ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200 bg-white'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${sc.bg} ${sc.text}`}>
                            {etape.status === 'completed' ? <CheckCircle size={14} /> : etape.status === 'in_progress' ? <Play size={12} /> : etape.ordre}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium text-sm ${etape.status === 'completed' ? 'text-emerald-800 line-through' : 'text-gray-900'}`}>{etape.nom}</span>
                              {etape.est_bloquante && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-bold uppercase">Bloquante</span>}
                              {etape.timer_auto && etape.duree_estimee_min && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-bold"><Timer size={9} className="inline mr-0.5" />{etape.duree_estimee_min}min</span>}
                              {etape.est_repetable && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-bold"><RotateCcw size={9} className="inline mr-0.5" />{etape.nb_repetitions_actuelle}/{etape.nb_repetitions_cible}</span>}
                            </div>
                            {etape.status === 'completed' && etape.duree_reelle_min != null && (
                              <span className="text-[10px] text-gray-400">Duree: {Math.round(etape.duree_reelle_min)} min</span>
                            )}
                            {timerActive && !timerDone && (
                              <span className="text-[10px] text-blue-500 animate-pulse">Timer en cours...</span>
                            )}
                            {timerDone && (
                              <span className="text-[10px] text-emerald-600 font-bold">Timer termine !</span>
                            )}
                          </div>

                          {/* Actions */}
                          {isChef && planStatus === 'in_progress' && (
                            <div className="flex items-center gap-1.5">
                              {etape.status === 'pending' && (
                                <>
                                  <button onClick={() => handleStartEtape(etape)}
                                    className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition inline-flex items-center gap-1">
                                    <Play size={11} /> {etape.timer_auto ? 'Timer' : 'Demarrer'}
                                  </button>
                                  <button onClick={() => updateMutation.mutate({ etapeId: etape.id, status: 'skipped' })}
                                    className="px-2 py-1 bg-gray-100 text-gray-500 rounded-lg text-xs hover:bg-gray-200 transition" title="Passer">
                                    <SkipForward size={11} />
                                  </button>
                                </>
                              )}
                              {etape.status === 'in_progress' && !etape.est_repetable && (
                                <button onClick={() => handleCompleteEtape(etape)}
                                  className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition inline-flex items-center gap-1">
                                  <CheckCircle size={11} /> Terminer
                                </button>
                              )}
                              {etape.status === 'in_progress' && etape.est_repetable && etape.nb_repetitions_actuelle < etape.nb_repetitions_cible && (
                                <button onClick={() => repetitionMutation.mutate(etape.id)}
                                  className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition inline-flex items-center gap-1">
                                  <RotateCcw size={11} /> Tour {etape.nb_repetitions_actuelle + 1}/{etape.nb_repetitions_cible}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* QC Checklist */}
                        {etape.controle_qualite && etape.checklist_items.length > 0 && etape.status === 'in_progress' && isChef && (
                          <div className="mt-2 pl-9 space-y-1">
                            <div className="text-[10px] font-bold text-gray-500 uppercase">Controle qualite</div>
                            {etape.checklist_items.map((label, ci) => {
                              const current = (checklistState[etape.id] || etape.checklist_items.map(l => ({ label: l, ok: false })));
                              if (!checklistState[etape.id]) {
                                setChecklistState(s => ({ ...s, [etape.id]: etape.checklist_items.map(l => ({ label: l, ok: false })) }));
                              }
                              const checked = current[ci]?.ok ?? false;
                              return (
                                <label key={ci} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer hover:text-gray-900">
                                  <input type="checkbox" checked={checked} onChange={() => {
                                    setChecklistState(s => {
                                      const arr = [...(s[etape.id] || etape.checklist_items.map(l => ({ label: l, ok: false })))];
                                      arr[ci] = { ...arr[ci], ok: !arr[ci].ok };
                                      return { ...s, [etape.id]: arr };
                                    });
                                  }} className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                                  {label}
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {/* Completed checklist results */}
                        {etape.status === 'completed' && etape.checklist_resultats && etape.checklist_resultats.length > 0 && (
                          <div className="mt-2 pl-9 space-y-0.5">
                            {etape.checklist_resultats.map((cr, ci) => (
                              <div key={ci} className="text-[10px] flex items-center gap-1.5">
                                {cr.ok ? <CheckCircle size={10} className="text-emerald-500" /> : <AlertTriangle size={10} className="text-red-500" />}
                                <span className={cr.ok ? 'text-gray-500' : 'text-red-600'}>{cr.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
