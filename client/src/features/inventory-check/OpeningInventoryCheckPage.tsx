import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, AlertTriangle, CheckCircle2, XCircle, Clock, Plus, Minus, Package } from 'lucide-react';
import {
  openingInventoryCheckApi,
  type MissingReason,
  type OpeningCheckSubmitItem,
} from '../../api/opening-inventory-check.api';

const REASON_LABELS: Record<MissingReason, string> = {
  theft: 'Vol',
  breakage: 'Casse',
  forgotten_recycle: 'Recyclage oublié',
  undeclared_loss: 'Perte non déclarée',
  measurement_error: 'Erreur de comptage',
  other: 'Autre',
};

interface Counts {
  [productId: string]: { found: number; reason?: MissingReason };
}

export default function OpeningInventoryCheckPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Counts>({});
  const [notes, setNotes] = useState('');
  const [submitMsg, setSubmitMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['opening-check-pending'],
    queryFn: () => openingInventoryCheckApi.getPending(),
  });

  const submitMutation = useMutation({
    mutationFn: openingInventoryCheckApi.submit,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['opening-check-pending'] });
      if (created.status === 'validated') {
        setSubmitMsg({ type: 'success', text: 'Contrôle validé automatiquement. Caisse débloquée.' });
        setTimeout(() => navigate('/pos', { state: { autoOpenCash: true } }), 1500);
      } else {
        setSubmitMsg({
          type: 'success',
          text: 'Contrôle soumis — en attente de validation par un responsable.',
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erreur lors de la soumission';
      setSubmitMsg({ type: 'error', text: message });
    },
  });

  const items = data?.items || [];
  const existingCheck = data?.existingCheck || null;

  // Groupage par categorie pour rendu cards (similaire fermeture caisse).
  // Doit etre defini AVANT les early returns pour respecter les regles des hooks React.
  const grouped = useMemo(() => {
    const m: Record<string, typeof items> = {};
    items.forEach((it) => {
      const cat = ((it as Record<string, any>).category_name as string) || 'Sans categorie';
      if (!m[cat]) m[cat] = [];
      m[cat].push(it);
    });
    return m;
  }, [items]);
  const categoryNames = Object.keys(grouped).sort();

  const totals = useMemo(() => {
    let totalExpected = 0;
    let totalFound = 0;
    let withDiscrepancy = 0;
    items.forEach((it) => {
      const found = counts[it.product_id]?.found ?? it.expected_qty;
      totalExpected += it.expected_qty;
      totalFound += found;
      if (found !== it.expected_qty) withDiscrepancy += 1;
    });
    return { totalExpected, totalFound, totalDiscrepancy: totalFound - totalExpected, withDiscrepancy };
  }, [items, counts]);

  const updateCount = (productId: string, found: number) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], found } }));
  };

  const updateReason = (productId: string, reason: MissingReason) => {
    setCounts((prev) => ({ ...prev, [productId]: { ...prev[productId], reason } }));
  };

  const handleSubmit = () => {
    setSubmitMsg(null);
    const payload: OpeningCheckSubmitItem[] = items.map((it) => {
      const c = counts[it.product_id];
      const foundQty = c?.found ?? it.expected_qty;
      const isDiscrepancy = foundQty !== it.expected_qty;
      return {
        productId: it.product_id,
        expectedQty: it.expected_qty,
        foundQty,
        missingReason: isDiscrepancy ? c?.reason || 'other' : undefined,
      };
    });

    // Validation locale: si écart sans raison choisie -> bloque
    const missingReason = payload.find(
      (p) => p.foundQty !== p.expectedQty && !p.missingReason
    );
    if (missingReason) {
      setSubmitMsg({
        type: 'error',
        text: 'Choisir une raison pour chaque écart constaté.',
      });
      return;
    }

    submitMutation.mutate({
      previousCheckId: data?.previousCheckId || null,
      items: payload,
      notes: notes || undefined,
    });
  };

  if (isLoading) {
    return <div className="p-8 text-gray-500">Chargement...</div>;
  }

  // Cas 1: rien à contrôler — caisse libre
  if (items.length === 0 && !existingCheck) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 flex items-center gap-4">
          <CheckCircle2 className="text-green-600" size={32} />
          <div>
            <h2 className="font-bold text-green-900">Aucun contrôle requis</h2>
            <p className="text-sm text-green-700">
              Pas d'invendus réexposés à recontrôler. Vous pouvez ouvrir la caisse directement.
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/pos', { state: { autoOpenCash: true } })}
          className="mt-4 w-full px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold"
        >
          Aller à la caisse
        </button>
      </div>
    );
  }

  // Cas 2: check déjà en cours
  if (existingCheck) {
    const statusBadge =
      existingCheck.status === 'awaiting_validation' ? (
        <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold flex items-center gap-1">
          <Clock size={12} /> En attente de validation
        </span>
      ) : existingCheck.status === 'validated' ? (
        <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold flex items-center gap-1">
          <CheckCircle2 size={12} /> Validé
        </span>
      ) : (
        <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-semibold flex items-center gap-1">
          <XCircle size={12} /> Rejeté
        </span>
      );
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <ClipboardCheck size={24} /> Contrôle d'ouverture
            </h2>
            {statusBadge}
          </div>
          {existingCheck.status === 'awaiting_validation' && (
            <p className="text-sm text-gray-700">
              Votre contrôle a été soumis. Un responsable doit valider les écarts avant l'ouverture
              de la caisse.
            </p>
          )}
          {existingCheck.status === 'validated' && (
            <>
              <p className="text-sm text-gray-700 mb-4">Le contrôle a été validé. La caisse est ouverte.</p>
              <button
                onClick={() => navigate('/pos', { state: { autoOpenCash: true } })}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold"
              >
                Aller à la caisse
              </button>
            </>
          )}
          {existingCheck.status === 'rejected' && existingCheck.rejection_reason && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm font-semibold text-red-900">Motif du rejet :</p>
              <p className="text-sm text-red-700">{existingCheck.rejection_reason}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const incCount = (pid: string, expected: number) => {
    const cur = counts[pid]?.found ?? expected;
    updateCount(pid, cur + 1);
  };
  const decCount = (pid: string, expected: number) => {
    const cur = counts[pid]?.found ?? expected;
    updateCount(pid, Math.max(0, cur - 1));
  };

  // Cas 3: formulaire de saisie
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-2">
          <ClipboardCheck size={28} className="text-amber-600" /> Contrôle d'inventaire d'ouverture
        </h1>
        <p className="text-gray-600 text-sm">
          Vérifiez la présence physique des invendus réexposés depuis la veille avant d'ouvrir la caisse.
        </p>
      </div>

      {submitMsg && (
        <div
          className={`mb-4 p-4 rounded-xl border ${
            submitMsg.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {submitMsg.text}
        </div>
      )}

      {/* ═══ Stat cards (haut, comme fermeture) ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Package size={14} className="text-indigo-600" />
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Attendu</span>
          </div>
          <div className="text-2xl font-bold text-indigo-700">{totals.totalExpected}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <ClipboardCheck size={14} className="text-blue-600" />
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Compté</span>
          </div>
          <div className="text-2xl font-bold text-blue-700">{totals.totalFound}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totals.totalDiscrepancy === 0 ? 'bg-green-100' : 'bg-amber-100'}`}>
              <AlertTriangle size={14} className={totals.totalDiscrepancy === 0 ? 'text-green-600' : 'text-amber-600'} />
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Écart</span>
          </div>
          <div className={`text-2xl font-bold ${totals.totalDiscrepancy === 0 ? 'text-green-600' : totals.totalDiscrepancy < 0 ? 'text-red-600' : 'text-blue-600'}`}>
            {totals.totalDiscrepancy > 0 ? '+' : ''}{totals.totalDiscrepancy}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totals.withDiscrepancy === 0 ? 'bg-green-100' : 'bg-red-100'}`}>
              <XCircle size={14} className={totals.withDiscrepancy === 0 ? 'text-green-600' : 'text-red-600'} />
            </div>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Lignes en ecart</span>
          </div>
          <div className={`text-2xl font-bold ${totals.withDiscrepancy === 0 ? 'text-green-600' : 'text-red-600'}`}>{totals.withDiscrepancy}</div>
        </div>
      </div>

      {/* ═══ Cards par categorie ═══ */}
      <div className="space-y-3 mb-5">
        {categoryNames.map((catName) => {
          const catItems = grouped[catName];
          const catTotalExpected = catItems.reduce((s, it) => s + it.expected_qty, 0);
          return (
            <div key={catName} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {/* Category header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">{catName}</span>
                  <span className="text-[11px] font-medium text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                    {catItems.length} article{catItems.length > 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-xs font-semibold text-gray-500">{catTotalExpected} attendu{catTotalExpected > 1 ? 's' : ''}</span>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50/50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                <span className="col-span-4">Produit</span>
                <span className="col-span-1 text-center">Attendu</span>
                <span className="col-span-3 text-center">Compté</span>
                <span className="col-span-1 text-center">Ecart</span>
                <span className="col-span-3 text-center">Raison (si ecart)</span>
              </div>

              {/* Items */}
              <div className="divide-y divide-gray-100">
                {catItems.map((it) => {
                  const pid = it.product_id;
                  const c = counts[pid];
                  // Le champ "Compte" est pre-rempli avec la qte attendue par defaut.
                  // L'utilisateur l'ajuste avec +/- uniquement en cas d'ecart constate.
                  const hasBeenCounted = true;
                  const found = c?.found ?? it.expected_qty;
                  const discrepancy = found - it.expected_qty;
                  const hasDiscrepancy = discrepancy !== 0;
                  return (
                    <div key={pid} className={`grid grid-cols-12 gap-2 items-center px-4 py-3 transition-colors ${
                      !hasBeenCounted ? 'bg-yellow-50/60 ring-1 ring-inset ring-yellow-200' :
                      hasDiscrepancy ? 'bg-amber-50/50' : 'hover:bg-gray-50'
                    }`}>
                      <div className="col-span-4 min-w-0">
                        <span className="text-sm font-semibold text-gray-900 truncate block" title={it.product_name}>
                          {it.product_name}
                        </span>
                      </div>
                      <div className="col-span-1 text-center">
                        <span className="text-sm font-bold text-indigo-700">{it.expected_qty}</span>
                      </div>
                      <div className="col-span-3 flex justify-center">
                        <div className="flex items-center gap-1">
                          <button onClick={() => decCount(pid, it.expected_qty)}
                            className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
                            <Minus size={12} />
                          </button>
                          <input type="number" min={0}
                            value={hasBeenCounted ? found : ''}
                            placeholder="?"
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                setCounts((prev) => {
                                  const n = { ...prev };
                                  delete n[pid];
                                  return n;
                                });
                              } else {
                                updateCount(pid, Math.max(0, parseInt(v) || 0));
                              }
                            }}
                            className={`w-14 h-7 text-center text-sm font-bold border rounded-lg focus:ring-2 focus:ring-amber-500 ${
                              hasBeenCounted ? 'border-gray-300' : 'border-yellow-400 bg-yellow-50 placeholder-yellow-500'
                            }`} />
                          <button onClick={() => incCount(pid, it.expected_qty)}
                            className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold">
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="col-span-1 text-center">
                        {!hasBeenCounted ? (
                          <span className="text-sm font-bold text-yellow-600">—</span>
                        ) : hasDiscrepancy ? (
                          <span className={`text-sm font-bold ${discrepancy < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                            {discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                          </span>
                        ) : (
                          <span className="text-sm text-green-500">0</span>
                        )}
                      </div>
                      <div className="col-span-3">
                        {hasDiscrepancy ? (
                          <select
                            value={c?.reason || ''}
                            onChange={(e) => updateReason(pid, e.target.value as MissingReason)}
                            className={`w-full text-[11px] px-2 py-1 rounded-md border font-medium focus:ring-1 ${
                              c?.reason ? 'border-amber-300 bg-amber-50 text-amber-800 focus:ring-amber-400' :
                              'border-red-300 bg-red-50 text-red-700 focus:ring-red-400 animate-pulse'
                            }`}
                          >
                            <option value="">⚠ Motif obligatoire</option>
                            {(Object.keys(REASON_LABELS) as MissingReason[]).map((r) => (
                              <option key={r} value={r}>{REASON_LABELS[r]}</option>
                            ))}
                          </select>
                        ) : hasBeenCounted ? (
                          <span className="text-[11px] text-green-600 font-semibold flex items-center gap-1 justify-center">
                            <CheckCircle2 size={12} /> Conforme
                          </span>
                        ) : (
                          <span className="text-[11px] text-yellow-600 font-medium text-center block">A compter</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Notes ═══ */}
      <div className="mb-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optionnel)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500"
          placeholder="Observations particulières..."
        />
      </div>

      {totals.withDiscrepancy > 0 && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-900">
            <strong>{totals.withDiscrepancy} ligne(s) en écart.</strong> Le contrôle nécessitera la
            validation d'un responsable avant l'ouverture de la caisse.
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button
          onClick={() => refetch()}
          className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold"
        >
          Recharger
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitMutation.isPending}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold disabled:opacity-50 shadow-md"
        >
          {submitMutation.isPending ? 'Soumission...' : 'Valider le contrôle'}
        </button>
      </div>
    </div>
  );
}
