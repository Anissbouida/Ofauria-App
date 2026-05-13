import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { notify } from '../../components/ui/InlineNotification';
import { useProductionTimers } from '../../context/ProductionTimerContext';
import {
  CheckCircle, Play, Clock, SkipForward, ListChecks, Timer,
  ChevronDown, ChevronRight, RotateCcw, AlertTriangle, Loader2, Save, Lock
} from 'lucide-react';

interface EtapesPanelProps {
  planId: string;
  planStatus: string;
  isChef: boolean;
  onSaveAndExit?: () => void;
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

export default function EtapesPanel({ planId, planStatus, isChef, onSaveAndExit }: EtapesPanelProps) {
  const queryClient = useQueryClient();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, { label: string; ok: boolean }[]>>({});
  const currentEtapeRef = useRef<HTMLDivElement | null>(null);
  const autoScrolledRef = useRef(false);
  // Le contexte timer est monte au root de l'app → l'alarme sonne sur n'importe
  // quelle page tant que l'onglet reste ouvert. On lui pousse les timers d'etapes
  // demarres ici pour beneficier du tick global et du son d'alarme.
  const { startTimer: pushClientTimer, timers: clientTimers } = useProductionTimers();

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
    mutationFn: ({ etapeId, status, data }: { etapeId: string; status: string; data?: Record<string, any> }) =>
      productionEtapesApi.updateStatus(etapeId, { status, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
      queryClient.invalidateQueries({ queryKey: ['production-etapes-progress', planId] });
    },
  });

  const timerMutation = useMutation({
    mutationFn: (etape: Etape) => productionEtapesApi.startTimer(etape.id).then(() => etape),
    onSuccess: (etape) => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
      // Synchronisation avec le contexte timer global : declenche l'alarme sonore
      // a la fin meme si le chef navigue ailleurs dans l'app.
      const alreadyTracked = clientTimers.some(t => t.etapeId === etape.id);
      if (etape.duree_estimee_min && !alreadyTracked) {
        pushClientTimer({
          planId,
          planItemId: etape.plan_item_id,
          etapeId: etape.id,
          stepName: etape.nom,
          productName: etape.product_name,
          durationMin: etape.duree_estimee_min,
        });
      }
      notify.success('Timer demarre');
    },
  });

  const repetitionMutation = useMutation({
    mutationFn: (etapeId: string) => productionEtapesApi.completeRepetition(etapeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-etapes', planId] });
    },
  });

  // Group by plan_item_id (memoized so the same Map is reused across renders).
  const grouped = useMemo(() => {
    const map = new Map<string, { productName: string; etapes: Etape[] }>();
    for (const e of etapes) {
      const key = e.plan_item_id;
      if (!map.has(key)) map.set(key, { productName: e.product_name, etapes: [] });
      map.get(key)!.etapes.push(e);
    }
    // Sort etapes by ordre within each group (defensive — backend should already do this).
    for (const g of map.values()) g.etapes.sort((a, b) => a.ordre - b.ordre);
    return map;
  }, [etapes]);

  // Identifie l'etape "courante" pour la reprise. Priorites :
  // 1. Etape memorisee lors du "Enregistrer & quitter" (localStorage par planId)
  //    → repositionnement exact, meme avec plusieurs produits.
  // 2. Sinon, 1ere etape in_progress (dans n'importe quel groupe).
  // 3. Sinon, dans le groupe contenant la derniere etape completee (le produit sur lequel
  //    le chef travaillait), 1ere etape pending.
  // 4. Sinon, 1ere etape pending globale.
  const lastResumeKey = `ofauria_resume_etape_${planId}`;
  const currentEtape = useMemo<{ etape: Etape; itemId: string } | null>(() => {
    // 1. Etape memorisee
    try {
      const memorized = localStorage.getItem(lastResumeKey);
      if (memorized) {
        for (const [itemId, group] of grouped.entries()) {
          const found = group.etapes.find(e => e.id === memorized && (e.status === 'pending' || e.status === 'in_progress'));
          if (found) return { etape: found, itemId };
        }
        // Memo obsolete (etape terminee/sautee) : on la nettoie pour passer aux heuristiques.
        localStorage.removeItem(lastResumeKey);
      }
    } catch {
      // localStorage indispo (mode prive) — on continue avec les heuristiques.
    }

    // 2. Premiere etape in_progress
    for (const [itemId, group] of grouped.entries()) {
      const inProgress = group.etapes.find(e => e.status === 'in_progress');
      if (inProgress) return { etape: inProgress, itemId };
    }

    // 3. Groupe avec la completion la plus recente → 1ere pending dans CE groupe
    let mostRecentGroup: { itemId: string; group: { productName: string; etapes: Etape[] }; lastTs: number } | null = null;
    for (const [itemId, group] of grouped.entries()) {
      const completedTimestamps = group.etapes
        .filter(e => e.status === 'completed' && e.completed_at)
        .map(e => new Date(e.completed_at as string).getTime())
        .filter(n => !Number.isNaN(n));
      const lastTs = completedTimestamps.length > 0 ? Math.max(...completedTimestamps) : 0;
      if (lastTs > 0 && (!mostRecentGroup || lastTs > mostRecentGroup.lastTs)) {
        mostRecentGroup = { itemId, group, lastTs };
      }
    }
    if (mostRecentGroup) {
      const pending = mostRecentGroup.group.etapes.find(e => e.status === 'pending');
      if (pending) return { etape: pending, itemId: mostRecentGroup.itemId };
    }

    // 4. Premiere etape pending globale
    for (const [itemId, group] of grouped.entries()) {
      const pending = group.etapes.find(e => e.status === 'pending');
      if (pending) return { etape: pending, itemId };
    }
    return null;
  }, [grouped, lastResumeKey]);

  // Auto-deplie le groupe contenant l'etape courante a la 1ere arrivee sur le plan.
  useEffect(() => {
    if (!currentEtape || expandedItem !== null || autoScrolledRef.current) return;
    setExpandedItem(currentEtape.itemId);
  }, [currentEtape, expandedItem]);

  // Resynchronise les timers cote serveur avec le contexte client a l'arrivee :
  // si le chef revient sur un autre poste/onglet (localStorage vide), on re-pousse les
  // timers d'etapes encore actifs pour que l'alarme sonne quand meme.
  useEffect(() => {
    for (const etape of etapes) {
      if (etape.status !== 'in_progress' || !etape.timer_fire_at) continue;
      const endsAt = new Date(etape.timer_fire_at).getTime();
      if (Number.isNaN(endsAt) || endsAt <= Date.now()) continue;
      const alreadyTracked = clientTimers.some(t => t.etapeId === etape.id);
      if (alreadyTracked) continue;
      const remainingMs = endsAt - Date.now();
      pushClientTimer({
        planId,
        planItemId: etape.plan_item_id,
        etapeId: etape.id,
        stepName: etape.nom,
        productName: etape.product_name,
        durationMin: remainingMs / 60000,
      });
    }
  }, [etapes, clientTimers, pushClientTimer, planId]);

  // Auto-scroll vers l'etape courante apres deploiement, une seule fois par session.
  useEffect(() => {
    if (autoScrolledRef.current) return;
    if (!currentEtape || expandedItem !== currentEtape.itemId) return;
    if (!currentEtapeRef.current) return;
    currentEtapeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    autoScrolledRef.current = true;
  }, [currentEtape, expandedItem]);

  if (etapes.length === 0 && !isLoading) return null;
  if (isLoading) return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex items-center justify-center gap-2 text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Chargement des etapes...
    </div>
  );

  const handleStartEtape = (etape: Etape) => {
    if (etape.timer_auto && etape.duree_estimee_min) {
      timerMutation.mutate(etape);
    } else {
      updateMutation.mutate({ etapeId: etape.id, status: 'in_progress' });
    }
  };

  const handleCompleteEtape = (etape: Etape) => {
    const data: Record<string, any> = {};
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
        <div className="ml-auto flex items-center gap-3">
          {progress.length > 0 && (
            <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${(etapes.filter(e => e.status === 'completed').length / etapes.length) * 100}%` }} />
            </div>
          )}
          {/* Sauvegarde implicite : chaque action ecrit deja en base. Le bouton sert
              uniquement de signal UX explicite ("je quitte, je reprends plus tard"). */}
          {isChef && planStatus === 'in_progress' && onSaveAndExit && (
            <button
              onClick={onSaveAndExit}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              title="Vos actions sont deja enregistrees. Vous reviendrez sur l'etape en cours."
            >
              <Save size={12} /> Enregistrer & quitter
            </button>
          )}
        </div>
      </div>

      {/* Bandeau "reprise" : indique au chef ou il en est, visible juste sous le header.
          Disparait quand le plan est entierement termine. */}
      {isChef && planStatus === 'in_progress' && currentEtape && (
        <div className="px-5 py-2.5 bg-violet-50/60 border-b border-violet-100 flex items-center gap-2 text-xs">
          <Play size={12} className="text-violet-600" />
          <span className="text-violet-800">
            <span className="font-semibold">Etape en cours :</span> {currentEtape.etape.nom}
            <span className="text-violet-500 ml-1.5">— {grouped.get(currentEtape.itemId)?.productName}</span>
          </span>
        </div>
      )}

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
                  {group.etapes.map((etape, idx) => {
                    const sc = statusColors[etape.status];
                    const timerActive = etape.status === 'in_progress' && etape.timer_fire_at;
                    const timerDone = timerActive && new Date(etape.timer_fire_at!) <= new Date();
                    // Progression stricte : une etape pending ne peut etre demarree que si toutes
                    // les etapes precedentes (par ordre) sont 'completed' ou 'skipped'.
                    // Aucune autre etape ne peut etre 'in_progress' simultanement dans le groupe.
                    const previous = group.etapes.slice(0, idx);
                    const allPreviousDone = previous.every(p => p.status === 'completed' || p.status === 'skipped');
                    const someoneElseInProgress = group.etapes.some(e => e.id !== etape.id && e.status === 'in_progress');
                    const canStart = allPreviousDone && !someoneElseInProgress;
                    const isCurrent = currentEtape?.etape.id === etape.id;

                    return (
                      <div
                        key={etape.id}
                        ref={isCurrent ? currentEtapeRef : undefined}
                        className={`rounded-xl border p-3 ${etape.status === 'completed' ? 'border-emerald-200 bg-emerald-50/50' : etape.status === 'in_progress' ? 'border-blue-200 bg-blue-50/50' : isCurrent ? 'border-violet-300 bg-violet-50/40 ring-2 ring-violet-200' : 'border-gray-200 bg-white'}`}
                      >
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
                                  <button
                                    onClick={() => handleStartEtape(etape)}
                                    disabled={!canStart}
                                    className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition inline-flex items-center gap-1 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                    title={canStart ? '' : 'Termine d\'abord l\'etape precedente'}
                                  >
                                    {canStart ? <Play size={11} /> : <Lock size={11} />} {etape.timer_auto ? 'Timer' : 'Demarrer'}
                                  </button>
                                  {/* "Passer" interdit pour les etapes bloquantes : elles doivent
                                      etre completees, pas sautees. Et toujours conditionne par
                                      la progression stricte (etape precedente terminee). */}
                                  {!etape.est_bloquante && (
                                    <button
                                      onClick={() => updateMutation.mutate({ etapeId: etape.id, status: 'skipped' })}
                                      disabled={!canStart}
                                      className="px-2 py-1 bg-gray-100 text-gray-500 rounded-lg text-xs hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                      title={canStart ? 'Passer cette etape (non bloquante)' : 'Termine d\'abord l\'etape precedente'}
                                    >
                                      <SkipForward size={11} />
                                    </button>
                                  )}
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
