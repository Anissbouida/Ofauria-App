import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { notify } from '../../components/ui/InlineNotification';
import {
  TrendingUp, TrendingDown, Package, Flame, AlertTriangle, Loader2,
  ChevronDown, ChevronRight, Scale, PieChart
} from 'lucide-react';

interface RendementPanelProps {
  planId: string;
  planStatus: string;
  items: Record<string, unknown>[];
  isChef: boolean;
}

interface Rendement {
  id: string;
  plan_item_id: string;
  product_name: string;
  contenant_nom: string | null;
  planned_quantity: number;
  actual_quantity: number;
  quantite_brute: number;
  quantite_nette_cible: number;
  seuil_rendement: number;
  quantite_nette_reelle: number;
  rendement_reel: number;
  vers_magasin: number;
  vers_frigo: number;
  pertes_total: number;
  pertes_detail: { categorie: string; quantite: number; notes?: string }[];
  recorded_by_name: string;
  recorded_at: string;
}

interface RendementTarget {
  quantiteTheorique: number;
  pertesFixes: number;
  seuilRendement: number;
  nbContenants: number;
  quantiteNetteCible: number;
  categoriesPertes: string[];
}

export default function RendementPanel({ planId, planStatus, items, isChef }: RendementPanelProps) {
  const queryClient = useQueryClient();
  const [recordingItem, setRecordingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    quantite_brute: number; quantite_nette_reelle: number;
    vers_magasin: number; vers_frigo: number;
    pertes: { categorie: string; quantite: number }[];
  }>({ quantite_brute: 0, quantite_nette_reelle: 0, vers_magasin: 0, vers_frigo: 0, pertes: [] });

  const { data: rendements = [], isLoading } = useQuery<Rendement[]>({
    queryKey: ['production-rendement', planId],
    queryFn: () => productionEtapesApi.planRendement(planId),
    enabled: ['in_progress', 'completed'].includes(planStatus),
  });

  const { data: target } = useQuery<RendementTarget | null>({
    queryKey: ['rendement-target', recordingItem],
    queryFn: () => recordingItem ? productionEtapesApi.getRendementTarget(recordingItem) : null,
    enabled: !!recordingItem,
  });

  const recordMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) =>
      productionEtapesApi.recordRendement(itemId, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-rendement', planId] });
      setRecordingItem(null);
      notify.success('Rendement enregistre');
    },
    onError: (e: any) => notify.error(e?.response?.data?.error?.message || 'Erreur'),
  });

  // Only show for in_progress or completed plans with produced items
  const producedItems = items.filter(it => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
  if (producedItems.length === 0 && rendements.length === 0) return null;

  const openRecordForm = (itemId: string, item: Record<string, unknown>) => {
    setRecordingItem(itemId);
    setFormData({
      quantite_brute: (item.quantite_brute_totale as number) || (item.actual_quantity as number) || 0,
      quantite_nette_reelle: (item.actual_quantity as number) || 0,
      vers_magasin: (item.actual_quantity as number) || 0,
      vers_frigo: 0,
      pertes: [],
    });
  };

  const handleSubmit = () => {
    if (!recordingItem) return;
    recordMutation.mutate({
      itemId: recordingItem,
      data: {
        quantite_brute: formData.quantite_brute,
        quantite_nette_reelle: formData.quantite_nette_reelle,
        vers_magasin: formData.vers_magasin,
        vers_frigo: formData.vers_frigo,
        pertes_detail: formData.pertes.filter(p => p.quantite > 0),
      },
    });
  };

  // Summary stats
  const avgRendement = rendements.length > 0
    ? rendements.reduce((s, r) => s + r.rendement_reel, 0) / rendements.length
    : 0;
  const totalPertes = rendements.reduce((s, r) => s + r.pertes_total, 0);
  const totalVersFrigo = rendements.reduce((s, r) => s + r.vers_frigo, 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
        <Scale size={16} className="text-emerald-600" />
        <h3 className="font-semibold text-gray-900 text-sm">Rendement de production</h3>
        <span className="text-xs text-gray-400">{rendements.length}/{producedItems.length} enregistres</span>
      </div>

      {/* Summary bar */}
      {rendements.length > 0 && (
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <PieChart size={12} className="text-violet-500" />
            <span className="text-gray-500">Rendement moy:</span>
            <span className={`font-bold ${avgRendement >= 85 ? 'text-emerald-600' : avgRendement >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
              {avgRendement.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-red-400" />
            <span className="text-gray-500">Pertes:</span>
            <span className="font-bold text-red-600">{totalPertes}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Flame size={12} className="text-cyan-500" />
            <span className="text-gray-500">Vers frigo:</span>
            <span className="font-bold text-cyan-600">{totalVersFrigo}</span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="p-6 flex items-center justify-center gap-2 text-gray-400">
          <Loader2 size={16} className="animate-spin" /> Chargement...
        </div>
      )}

      {/* Per-item rendement */}
      <div className="divide-y divide-gray-100">
        {producedItems.map((item) => {
          const itemId = item.id as string;
          const existing = rendements.find(r => r.plan_item_id === itemId);
          const isRecording = recordingItem === itemId;

          return (
            <div key={itemId} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="font-medium text-sm text-gray-900 flex-1">{item.product_name as string}</span>
                <span className="text-xs text-gray-400">
                  Prevu: {item.planned_quantity as number} | Fait: {item.actual_quantity as number}
                </span>

                {existing ? (
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${existing.rendement_reel >= (existing.seuil_rendement || 85) ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {existing.rendement_reel >= (existing.seuil_rendement || 85) ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      {existing.rendement_reel.toFixed(1)}%
                    </div>
                    <span className="text-[10px] text-gray-400">
                      Mag: {existing.vers_magasin} | Frigo: {existing.vers_frigo} | Pertes: {existing.pertes_total}
                    </span>
                  </div>
                ) : isChef && planStatus === 'in_progress' ? (
                  <button onClick={() => openRecordForm(itemId, item)}
                    className="px-3 py-1 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 transition inline-flex items-center gap-1">
                    <Scale size={11} /> Saisir rendement
                  </button>
                ) : (
                  <span className="text-xs text-gray-300">Non saisi</span>
                )}
              </div>

              {/* Inline form */}
              {isRecording && (
                <div className="mt-3 p-4 bg-violet-50 border border-violet-200 rounded-xl space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Qte brute</label>
                      <input type="number" value={formData.quantite_brute}
                        onChange={e => setFormData(f => ({ ...f, quantite_brute: parseFloat(e.target.value) || 0 }))}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Qte nette reelle</label>
                      <input type="number" value={formData.quantite_nette_reelle}
                        onChange={e => setFormData(f => ({ ...f, quantite_nette_reelle: parseFloat(e.target.value) || 0 }))}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Vers magasin</label>
                      <input type="number" value={formData.vers_magasin}
                        onChange={e => setFormData(f => ({ ...f, vers_magasin: parseInt(e.target.value) || 0 }))}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase">Vers frigo</label>
                      <input type="number" value={formData.vers_frigo}
                        onChange={e => setFormData(f => ({ ...f, vers_frigo: parseInt(e.target.value) || 0 }))}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  </div>

                  {/* Loss categories from target */}
                  {target && target.categoriesPertes.length > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Pertes par categorie</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {target.categoriesPertes.map((cat, i) => {
                          const existing = formData.pertes.find(p => p.categorie === cat);
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 truncate flex-1">{cat.replace(/_/g, ' ')}</span>
                              <input type="number" min={0}
                                value={existing?.quantite || ''}
                                placeholder="0"
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setFormData(f => ({
                                    ...f,
                                    pertes: [
                                      ...f.pertes.filter(p => p.categorie !== cat),
                                      ...(val > 0 ? [{ categorie: cat, quantite: val }] : []),
                                    ],
                                  }));
                                }}
                                className="w-16 px-2 py-1 border border-gray-200 rounded text-xs text-center" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Rendement preview */}
                  {formData.quantite_brute > 0 && (
                    <div className="text-xs text-gray-500 flex items-center gap-3">
                      <span>Rendement: <span className={`font-bold ${(formData.quantite_nette_reelle / formData.quantite_brute * 100) >= (target?.seuilRendement || 85) ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {(formData.quantite_nette_reelle / formData.quantite_brute * 100).toFixed(1)}%
                      </span></span>
                      {target && <span className="text-gray-400">Seuil: {target.seuilRendement}%</span>}
                    </div>
                  )}

                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => setRecordingItem(null)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-gray-200 transition">
                      Annuler
                    </button>
                    <button onClick={handleSubmit} disabled={recordMutation.isPending}
                      className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 transition inline-flex items-center gap-1">
                      {recordMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
                      Enregistrer
                    </button>
                  </div>
                </div>
              )}

              {/* Existing rendement detail (expanded) */}
              {existing && existing.pertes_detail.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {existing.pertes_detail.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-50 text-red-600">
                      {p.categorie.replace(/_/g, ' ')}: {p.quantite}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
