import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, ShoppingCart, Package, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { purchaseRequestsApi } from '../../api/purchase-requests.api';
import { notify } from '../../components/ui/InlineNotification';

/**
 * Onglet "Ingredients a commander" du module Economat (delta v1 point 5 / decision metier).
 * Centralise les ruptures BSI cross-plans : le magasinier voit toutes les ruptures actives
 * et peut declencher une commande fournisseur en lot (au lieu d'agir BSI par BSI dans le
 * panneau de production).
 *
 * Une ligne "deja commandee" (already_ordered=true cote serveur) est marquee visuellement
 * pour eviter les doublons de demande d'achat.
 */
export function RuptureRequestsList({ variant = 'tab' }: { variant?: 'tab' | 'compact' }) {
  const queryClient = useQueryClient();
  const [commandedLineIds, setCommandedLineIds] = useState<Set<string>>(new Set());

  const { data: rows = [], isLoading, error, isError } = useQuery<Record<string, any>[]>({
    queryKey: ['warehouse-rupture-requests'],
    queryFn: bonSortieApi.ruptureRequests,
    refetchInterval: 30000,
    retry: 1,
  });

  const commanderMutation = useMutation({
    mutationFn: (line: Record<string, any>) =>
      purchaseRequestsApi.create({
        ingredientId: line.ingredient_id as string,
        quantity: parseFloat(line.needed_quantity as string || '0'),
        unit: (line.unit || line.ingredient_unit || 'kg') as string,
        reason: 'production',
        note: `BSI ${line.bon_numero || ''} — rupture totale signalee depuis Economat`,
        supplierId: null,
      }),
    onSuccess: (_data, line) => {
      setCommandedLineIds(prev => new Set(prev).add(line.line_id as string));
      queryClient.invalidateQueries({ queryKey: ['warehouse-rupture-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests-grouped'] });
      notify.success('Ajoute a la liste d\'attente d\'achat');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || e?.response?.data?.error || 'Erreur ajout liste d\'attente'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-orange-500" />
      </div>
    );
  }
  if (isError) {
    const errMsg = (error as any)?.response?.data?.error || (error as any)?.message || 'Erreur inconnue';
    const status = (error as any)?.response?.status;
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm">
        <div className="flex items-start gap-2 text-red-800 font-semibold mb-1">
          <AlertTriangle size={16} /> Impossible de charger les ruptures
        </div>
        <p className="text-red-700 text-xs">
          {status ? `[${status}] ` : ''}{errMsg}
        </p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
        <CheckCircle size={28} className="mx-auto mb-2 text-emerald-300" />
        Aucun ingredient en rupture. Tous les BSI actifs sont couverts.
      </div>
    );
  }

  // Groupage par BSI pour faciliter la lecture quand plusieurs ruptures viennent du meme bon.
  const groups = new Map<string, { bon_numero: string; plan_date?: string; plan_type?: string; lines: Record<string, any>[] }>();
  for (const r of rows) {
    const key = r.bon_id as string;
    if (!groups.has(key)) {
      groups.set(key, {
        bon_numero: r.bon_numero as string,
        plan_date: r.plan_date as string | undefined,
        plan_type: r.plan_type as string | undefined,
        lines: [],
      });
    }
    groups.get(key)!.lines.push(r);
  }

  return (
    <div className="space-y-4">
      {variant === 'tab' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-orange-700" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-orange-900">
              {rows.length} ingredient{rows.length > 1 ? 's' : ''} en rupture sur les BSI actifs
            </p>
            <p className="text-xs text-orange-800 mt-0.5">
              Stock absent du pesage ET de l'economat. Declenche une commande fournisseur — la production reprendra automatiquement apres reapprovisionnement (bouton "Re-verifier dispo" sur le BSI).
            </p>
          </div>
        </div>
      )}

      {Array.from(groups.entries()).map(([bonId, g]) => (
        <div key={bonId} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Package size={14} className="text-gray-400" />
              <span className="font-mono text-xs text-gray-600">{g.bon_numero}</span>
              <span className="text-gray-300">·</span>
              <span className="font-semibold text-gray-700">
                Plan du {g.plan_date ? format(new Date(g.plan_date), 'dd MMM yyyy', { locale: fr }) : '—'}
              </span>
              {g.plan_type && (
                <span className="text-[10px] uppercase tracking-wide text-gray-400">{g.plan_type}</span>
              )}
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {g.lines.map((l) => {
              const lineId = l.line_id as string;
              const need = parseFloat(l.needed_quantity as string || '0');
              const avail = parseFloat(l.allocated_quantity as string || '0');
              const missing = need - avail;
              const unit = (l.unit || l.ingredient_unit || 'kg') as string;
              const alreadyOrdered = !!l.already_ordered || commandedLineIds.has(lineId);
              const isPending = commanderMutation.isPending && (commanderMutation.variables as any)?.line_id === lineId;
              return (
                <div key={lineId} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
                    <AlertTriangle size={14} className="text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {l.ingredient_name as string}
                    </p>
                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 mt-0.5">
                      <span>
                        besoin <span className="font-mono font-semibold text-gray-700">{need.toFixed(2)} {unit}</span>
                      </span>
                      <span className="text-gray-400">·</span>
                      <span>
                        dispo <span className="font-mono">{avail.toFixed(2)} {unit}</span>
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="text-red-600 font-semibold">manque {missing.toFixed(2)} {unit}</span>
                    </div>
                  </div>
                  {alreadyOrdered ? (
                    <span className="px-2.5 py-1.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-1 text-xs font-semibold shrink-0">
                      <CheckCircle size={12} /> Commande
                    </span>
                  ) : (
                    <button
                      onClick={() => commanderMutation.mutate(l)}
                      disabled={isPending}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1 text-xs font-semibold shrink-0 shadow-sm"
                      title={`Ajouter ${need.toFixed(2)} ${unit} a la liste d'attente d'achat`}
                    >
                      {isPending ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                      Commander
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
