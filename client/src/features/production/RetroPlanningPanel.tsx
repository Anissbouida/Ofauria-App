import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Clock, AlertTriangle, CalendarClock } from 'lucide-react';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';

// Rétro-planning par temps de procédé (mig 432, épic labo L6).
// À partir de l'heure de mise en vitrine, le serveur remonte étape par étape ;
// ce panneau affiche la frise (Gantt) des créneaux calculés par article et
// signale les conflits de capacité (chevauchement sur un même poste).

const TYPE_LABELS: Record<string, string> = {
  petrissage: 'Pétrissage', pointage: 'Pointage', faconnage: 'Façonnage', tourage: 'Tourage', appret: 'Apprêt',
  cuisson: 'Cuisson', refroidissement: 'Refroidissement', montage: 'Montage', finition: 'Finition', autre: 'Autre',
};
const TYPE_COLORS: Record<string, string> = {
  petrissage: '#8b5cf6', pointage: '#06b6d4', faconnage: '#f59e0b', tourage: '#6366f1', appret: '#10b981',
  cuisson: '#ef4444', refroidissement: '#3b82f6', montage: '#ec4899', finition: '#14b8a6', autre: '#9ca3af',
};

interface Etape {
  id: string;
  plan_item_id: string;
  product_name?: string | null;
  ordre: number;
  nom: string;
  type_etape?: string | null;
  duree_estimee_min?: number | null;
  work_center_name?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  heure_vitrine_cible?: string | null;
}

interface Conflict {
  work_center_id: string; work_center_name: string;
  a: string; b: string; overlap_start: string; overlap_end: string;
}

interface Props {
  planId: string;
  planStatus: string;
  isChef: boolean;
}

const hhmm = (iso: string) => format(new Date(iso), 'HH:mm', { locale: fr });

export default function RetroPlanningPanel({ planId, planStatus, isChef }: Props) {
  const queryClient = useQueryClient();
  const [heureVitrine, setHeureVitrine] = useState('07:00');
  const [lastResult, setLastResult] = useState<{ earliest_start: string | null; conflicts: Conflict[] } | null>(null);

  const { data: etapes = [], isLoading } = useQuery<Etape[]>({
    queryKey: ['plan-etapes', planId],
    queryFn: () => productionEtapesApi.listByPlan(planId),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const compute = useMutation({
    mutationFn: () => productionEtapesApi.computeRetroPlanning(planId, heureVitrine),
    onSuccess: (res) => {
      setLastResult({ earliest_start: res.earliest_start, conflicts: res.conflicts });
      queryClient.invalidateQueries({ queryKey: ['plan-etapes', planId] });
      notify.success(
        res.conflicts.length > 0
          ? `Rétro-planning calculé — ${res.conflicts.length} conflit(s) de capacité`
          : 'Rétro-planning calculé'
      );
    },
    onError: (e) => notify.error(apiErrorMessage(e)),
  });

  // Groupes par article, étapes triées par ordre.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; etapes: Etape[] }>();
    for (const e of etapes) {
      const g = m.get(e.plan_item_id) ?? { name: e.product_name || 'Article', etapes: [] };
      g.etapes.push(e);
      m.set(e.plan_item_id, g);
    }
    for (const g of m.values()) g.etapes.sort((a, b) => a.ordre - b.ordre);
    return [...m.values()];
  }, [etapes]);

  // Fenêtre temporelle globale (sur les étapes datées).
  const { minMs, spanMs, hasSchedule } = useMemo(() => {
    const dated = etapes.filter(e => e.planned_start && e.planned_end);
    if (dated.length === 0) return { minMs: 0, spanMs: 0, hasSchedule: false };
    let mn = Infinity, mx = -Infinity;
    for (const e of dated) {
      mn = Math.min(mn, new Date(e.planned_start!).getTime());
      mx = Math.max(mx, new Date(e.planned_end!).getTime());
    }
    return { minMs: mn, spanMs: Math.max(mx - mn, 60_000), hasSchedule: true };
  }, [etapes]);

  if (!['in_progress', 'completed'].includes(planStatus)) return null;

  const conflicts = lastResult?.conflicts ?? [];

  return (
    <div className="odoo-section">
      <div className="odoo-section-header flex items-center justify-between flex-wrap gap-2">
        <span className="flex items-center gap-2"><CalendarClock size={16} /> Rétro-planning par temps de procédé</span>
        {isChef && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <Clock size={13} /> Heure de vitrine
            </label>
            <input
              type="time"
              value={heureVitrine}
              onChange={(e) => setHeureVitrine(e.target.value)}
              className="odoo-input !py-1 !w-28 text-sm"
            />
            <button
              className="odoo-btn-primary !py-1 text-sm"
              style={{ textTransform: 'none', letterSpacing: 0 }}
              disabled={compute.isPending}
              onClick={() => compute.mutate()}
            >
              {compute.isPending ? 'Calcul…' : 'Calculer'}
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        <p className="text-xs text-gray-500">
          À partir de l'heure de mise en vitrine, le système remonte chaque étape par sa durée estimée
          (apprêt, tourage, pointage, surgélation…) et donne l'heure de démarrage au plus tôt.
        </p>

        {isLoading && <p className="text-sm text-gray-400">Chargement…</p>}

        {!isLoading && !hasSchedule && (
          <div className="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded p-4 text-center">
            {etapes.length === 0
              ? 'Aucune étape instanciée sur ce plan.'
              : 'Aucun créneau calculé.'}{' '}
            {isChef ? 'Saisissez l’heure de vitrine et cliquez sur « Calculer ».' : 'Le chef doit lancer le calcul.'}
          </div>
        )}

        {lastResult?.earliest_start && (
          <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
            <Clock size={15} />
            <span>Démarrage au plus tôt : <strong>{hhmm(lastResult.earliest_start)}</strong> le {format(new Date(lastResult.earliest_start), 'EEEE d MMMM', { locale: fr })}</span>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <AlertTriangle size={15} /> {conflicts.length} conflit(s) de capacité
            </div>
            {conflicts.map((c, i) => (
              <div key={i} className="text-xs text-red-700 pl-6">
                <strong>{c.work_center_name}</strong> : « {c.a} » et « {c.b} » se chevauchent de {hhmm(c.overlap_start)} à {hhmm(c.overlap_end)}
              </div>
            ))}
          </div>
        )}

        {hasSchedule && (
          <>
            {/* Axe temporel : début → fin de la fenêtre. */}
            <div className="flex justify-between text-[10px] text-gray-400 border-b border-gray-200 pb-1">
              <span>{hhmm(new Date(minMs).toISOString())}</span>
              <span>{hhmm(new Date(minMs + spanMs).toISOString())}</span>
            </div>

            <div className="space-y-3">
              {groups.map((g, gi) => {
                const dated = g.etapes.filter(e => e.planned_start && e.planned_end);
                if (dated.length === 0) return null;
                return (
                  <div key={gi} className="space-y-1">
                    <div className="text-xs font-semibold text-gray-700">{g.name}</div>
                    <div className="relative h-7 bg-gray-50 rounded border border-gray-100">
                      {dated.map((e) => {
                        const s = new Date(e.planned_start!).getTime();
                        const en = new Date(e.planned_end!).getTime();
                        const left = ((s - minMs) / spanMs) * 100;
                        const width = Math.max(((en - s) / spanMs) * 100, 1.5);
                        const color = TYPE_COLORS[e.type_etape || 'autre'] || TYPE_COLORS.autre;
                        return (
                          <div
                            key={e.id}
                            className="absolute top-0.5 bottom-0.5 rounded flex items-center px-1 overflow-hidden"
                            style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
                            title={`${e.nom} — ${hhmm(e.planned_start!)} → ${hhmm(e.planned_end!)}${e.work_center_name ? ' · ' + e.work_center_name : ''} (${e.duree_estimee_min ?? 0} min)`}
                          >
                            <span className="text-[9px] text-white font-medium truncate">{e.nom}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Légende des types d'étape présents. */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              {[...new Set(etapes.map(e => e.type_etape || 'autre'))].map((t) => (
                <span key={t} className="flex items-center gap-1 text-[10px] text-gray-500">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: TYPE_COLORS[t] || TYPE_COLORS.autre }} />
                  {TYPE_LABELS[t] || t}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
