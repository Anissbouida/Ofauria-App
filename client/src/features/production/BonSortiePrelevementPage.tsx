import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bonSortieApi } from '../../api/bon-sortie.api';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Loader2, CheckCircle, AlertTriangle, Package, Check,
  RefreshCw, ChevronDown, ChevronUp, Edit3,
} from 'lucide-react';
import { format } from 'date-fns';
import { notify } from '../../components/ui/InlineNotification';

export default function BonSortiePrelevementPage() {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isChef = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale'].includes(user?.role || '');

  // Editing state: which line is being manually edited
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const { data: bons = [], isLoading } = useQuery({
    queryKey: ['bons-sortie', planId],
    queryFn: () => bonSortieApi.getByPlan(planId!),
    enabled: !!planId,
  });

  const bon = (bons as Record<string, unknown>[]).find((b: Record<string, unknown>) => b.status !== 'annule') as Record<string, unknown> | undefined;
  const lines = (bon?.lines || []) as Record<string, unknown>[];

  // Auto-start prelevement when page opens with a "genere" bon
  const startMutation = useMutation({
    mutationFn: () => bonSortieApi.startPrelevement(bon!.id as string),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] }); },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  useEffect(() => {
    if (bon && bon.status === 'genere' && isChef && !startMutation.isPending) {
      startMutation.mutate();
    }
  }, [bon?.id, bon?.status]);

  const ligneMutation = useMutation({
    mutationFn: ({ ligneId, actualQuantity }: { ligneId: string; actualQuantity: number }) =>
      bonSortieApi.updateLigne(ligneId, { actualQuantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      setEditingLine(null);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const verifyMutation = useMutation({
    mutationFn: () => bonSortieApi.verify(bon!.id as string),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] }); },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const closeMutation = useMutation({
    mutationFn: () => bonSortieApi.close(bon!.id as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Bon cloture — ingredients livres');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => bonSortieApi.regenerate(planId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] }); notify.success('Bon regenere'); },
    onError: (e: any) => notify.error(e?.response?.data?.error || 'Erreur'),
  });

  // Stats
  const totalLines = lines.length;
  const prelevees = lines.filter((l) => ['preleve', 'substitue'].includes(l.status as string)).length;
  const enAttente = lines.filter((l) => l.status === 'en_attente').length;
  const nonBloquees = lines.filter((l) => l.status === 'en_attente' && !l.lot_expired && l.lot_status !== 'expired');
  const allDone = totalLines > 0 && enAttente === 0;
  const progressPct = totalLines > 0 ? Math.round(((totalLines - enAttente) / totalLines) * 100) : 0;

  // ── Confirm one line with allocated quantity ──
  const confirmLine = (line: Record<string, unknown>) => {
    const allocated = parseFloat(line.allocated_quantity as string || '0');
    ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: allocated });
  };

  // ── Confirm ALL pending lines at once ──
  const [confirmingAll, setConfirmingAll] = useState(false);
  const confirmAllLines = async () => {
    setConfirmingAll(true);
    try {
      for (const line of nonBloquees) {
        const allocated = parseFloat(line.allocated_quantity as string || '0');
        await bonSortieApi.updateLigne(line.id as string, { actualQuantity: allocated });
      }
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success(`${nonBloquees.length} ligne(s) confirmee(s)`);
    } catch (e: any) {
      notify.error(e?.response?.data?.error || 'Erreur');
    } finally {
      setConfirmingAll(false);
    }
  };

  // ── Validate bon (verify + close in one flow) ──
  const [validating, setValidating] = useState(false);
  const validateBon = async () => {
    setValidating(true);
    try {
      if (bon!.status === 'prelevement') {
        await bonSortieApi.verify(bon!.id as string);
      }
      await bonSortieApi.close(bon!.id as string);
      await queryClient.invalidateQueries({ queryKey: ['bons-sortie', planId] });
      notify.success('Bon valide et cloture — ingredients livres');
    } catch (e: any) {
      notify.error(e?.response?.data?.error || 'Erreur de validation');
    } finally {
      setValidating(false);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-emerald-500" />
    </div>
  );

  if (!bon) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <Package size={40} className="text-gray-300" />
      <p className="text-gray-500">Aucun bon de sortie pour ce plan</p>
      <button onClick={() => navigate(`/production/${planId}`)}
        className="text-amber-600 hover:text-amber-700 text-sm font-medium flex items-center gap-1">
        <ArrowLeft size={16} /> Retour au plan
      </button>
    </div>
  );

  const isClosed = bon.status === 'cloture';
  const isVerified = bon.status === 'verifie';

  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-32">
      {/* Header compact */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/production/${planId}`)}
          className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-800">Bon de sortie</h1>
          <p className="text-xs text-gray-400 font-mono">{bon.numero as string}</p>
        </div>
        {isClosed && (
          <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
            <CheckCircle size={12} /> Cloture
          </span>
        )}
      </div>

      {/* Progress bar */}
      {!isClosed && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">
              {prelevees} / {totalLines} ingredients preleves
            </span>
            <span className={`text-sm font-bold ${allDone ? 'text-emerald-600' : 'text-amber-600'}`}>
              {progressPct}%
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Quick action: Tout conforme */}
      {!isClosed && !isVerified && nonBloquees.length > 0 && (
        <button
          onClick={confirmAllLines}
          disabled={confirmingAll}
          className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.98]"
        >
          {confirmingAll ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <CheckCircle size={18} />
          )}
          Tout conforme ({nonBloquees.length} ligne{nonBloquees.length > 1 ? 's' : ''})
        </button>
      )}

      {/* Lines list — card style, mobile-friendly */}
      <div className="space-y-2">
        {lines.map((line) => {
          const lineStatus = line.status as string;
          const allocated = parseFloat(line.allocated_quantity as string || '0');
          const actual = line.actual_quantity != null ? parseFloat(line.actual_quantity as string) : null;
          const unit = line.ingredient_unit as string || line.unit as string || 'kg';
          const lotExpired = line.lot_expired || line.lot_status === 'expired';
          const isDone = ['preleve', 'substitue'].includes(lineStatus);
          const isEditing = editingLine === (line.id as string);
          const hasEcart = lineStatus === 'ecart';

          return (
            <div
              key={line.id as string}
              className={`bg-white rounded-xl border p-3.5 transition-all ${
                isDone ? 'border-emerald-200 bg-emerald-50/30' :
                hasEcart ? 'border-amber-200 bg-amber-50/30' :
                lotExpired ? 'border-red-200 bg-red-50/20 opacity-60' :
                'border-gray-100'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Status indicator */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isDone ? 'bg-emerald-500 text-white' :
                  hasEcart ? 'bg-amber-500 text-white' :
                  lotExpired ? 'bg-red-100 text-red-400' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {isDone ? <Check size={16} /> :
                   hasEcart ? <AlertTriangle size={14} /> :
                   lotExpired ? <AlertTriangle size={14} /> :
                   <Package size={14} />}
                </div>

                {/* Ingredient info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isDone ? 'text-emerald-800' : 'text-gray-800'}`}>
                    {line.ingredient_name as string}
                  </p>
                  <p className="text-xs text-gray-400">
                    {allocated.toFixed(2)} {unit}
                    {actual !== null && actual !== allocated && (
                      <span className="text-amber-600 font-medium ml-1">→ {actual.toFixed(2)}</span>
                    )}
                    {lotExpired && <span className="text-red-500 font-bold ml-1">Lot expire</span>}
                  </p>
                </div>

                {/* Action area */}
                {!isClosed && !isVerified && lineStatus === 'en_attente' && !lotExpired && !isEditing && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Tap to edit quantity */}
                    <button
                      onClick={() => { setEditingLine(line.id as string); setEditValue(allocated.toFixed(2)); }}
                      className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      title="Modifier la quantite"
                    >
                      <Edit3 size={16} />
                    </button>
                    {/* Quick confirm with allocated quantity */}
                    <button
                      onClick={() => confirmLine(line)}
                      disabled={ligneMutation.isPending}
                      className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors active:scale-95"
                      title="Confirmer"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                )}

                {isDone && (
                  <span className="text-emerald-500 shrink-0">
                    <CheckCircle size={20} />
                  </span>
                )}
              </div>

              {/* Inline edit row */}
              {isEditing && (
                <div className="mt-2.5 flex items-center gap-2 pl-11">
                  <input
                    type="number" step="0.01" min="0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    className="w-28 text-sm border border-amber-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-400 outline-none text-right"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseFloat(editValue);
                        if (!isNaN(val)) ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: val });
                      }
                      if (e.key === 'Escape') setEditingLine(null);
                    }}
                  />
                  <span className="text-xs text-gray-400">{unit}</span>
                  <button
                    onClick={() => {
                      const val = parseFloat(editValue);
                      if (!isNaN(val)) ligneMutation.mutate({ ligneId: line.id as string, actualQuantity: val });
                    }}
                    className="px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors"
                  >
                    OK
                  </button>
                  <button
                    onClick={() => setEditingLine(null)}
                    className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showDetails ? 'Masquer les details' : 'Voir les details'}
      </button>

      {showDetails && (
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-3">
          {/* Timestamps */}
          <div className="space-y-1 text-xs text-gray-500">
            {bon.generated_at && <p>Genere le {format(new Date(bon.generated_at as string), 'dd/MM/yyyy a HH:mm')}{bon.generated_by_name ? ` par ${bon.generated_by_name as string}` : ''}</p>}
            {bon.prelevement_at && <p>Prelevement le {format(new Date(bon.prelevement_at as string), 'dd/MM/yyyy a HH:mm')}{bon.prelevement_by_name ? ` par ${bon.prelevement_by_name as string}` : ''}</p>}
            {bon.verified_at && <p>Verifie le {format(new Date(bon.verified_at as string), 'dd/MM/yyyy a HH:mm')}{bon.verified_by_name ? ` par ${bon.verified_by_name as string}` : ''}</p>}
            {bon.closed_at && <p>Cloture le {format(new Date(bon.closed_at as string), 'dd/MM/yyyy a HH:mm')}{bon.closed_by_name ? ` par ${bon.closed_by_name as string}` : ''}</p>}
          </div>
          {/* Regenerate option */}
          {['genere', 'prelevement'].includes(bon.status as string) && isChef && (
            <button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50 transition flex items-center gap-1.5">
              <RefreshCw size={13} /> Regenerer le bon
            </button>
          )}
        </div>
      )}

      {/* Fixed bottom bar: Validate */}
      {!isClosed && allDone && isChef && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-40 safe-bottom">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={isVerified ? () => closeMutation.mutate() : validateBon}
              disabled={validating || closeMutation.isPending}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 text-base active:scale-[0.98]"
            >
              {(validating || closeMutation.isPending) ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <CheckCircle size={20} />
              )}
              Valider le bon de sortie
            </button>
          </div>
        </div>
      )}

      {/* Closed confirmation */}
      {isClosed && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
          <CheckCircle size={32} className="text-emerald-500 mx-auto mb-2" />
          <p className="text-emerald-800 font-semibold">Ingredients livres</p>
          <p className="text-xs text-emerald-600 mt-1">La production peut demarrer</p>
          <button
            onClick={() => navigate(`/production/${planId}`)}
            className="mt-3 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            Retour au plan
          </button>
        </div>
      )}
    </div>
  );
}
