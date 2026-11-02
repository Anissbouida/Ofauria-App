import { useState } from 'react';
import { apiErrorMessage } from '../../api/errors';
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
  items: Record<string, any>[];
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
  // Bilan massique (épic labo L3, mig 427).
  masse_petrie_kg: number | string | null;
  patons_nombre: number | null;
  patons_poids_unitaire_g: number | string | null;
  masse_cuite_kg: number | string | null;
  freinte_reelle_pct: number | string | null;
  freinte_standard_pct: number | string | null;
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
    // Bilan massique (épic labo L3) — 0 = non pesé.
    masse_petrie_kg: number; patons_nombre: number; patons_poids_unitaire_g: number; masse_cuite_kg: number;
  }>({ quantite_brute: 0, quantite_nette_reelle: 0, vers_magasin: 0, vers_frigo: 0, pertes: [],
       masse_petrie_kg: 0, patons_nombre: 0, patons_poids_unitaire_g: 0, masse_cuite_kg: 0 });

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
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, any> }) =>
      productionEtapesApi.recordRendement(itemId, data as any),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['production-rendement', planId] });
      queryClient.invalidateQueries({ queryKey: ['stock-frigo'] });
      setRecordingItem(null);
      // Retour du surplus -> frigo automatique : dire ce qui a ete pousse, ou pourquoi pas.
      const frigo = result?.frigo ?? {};
      if (frigo.added && frigo.added > 0) {
        notify.success(`Rendement enregistre — ${frigo.added} pousse(s) au frigo${frigo.lot_number ? ` (lot ${frigo.lot_number})` : ''}`);
      } else {
        notify.success('Rendement enregistre');
      }
      if (frigo.warning) {
        notify(frigo.warning, { icon: '⚠️', duration: 8000 });
      }
    },
    onError: (e: any) => notify.error(apiErrorMessage(e, 'Erreur')),
  });

  // Only show for in_progress or completed plans with produced items
  const producedItems = items.filter(it => it.status === 'produced' || it.status === 'transferred' || it.status === 'received');
  if (producedItems.length === 0 && rendements.length === 0) return null;

  const openRecordForm = (itemId: string, item: Record<string, any>) => {
    setRecordingItem(itemId);
    setFormData({
      quantite_brute: (item.quantite_brute_totale as number) || (item.actual_quantity as number) || 0,
      quantite_nette_reelle: (item.actual_quantity as number) || 0,
      vers_magasin: (item.actual_quantity as number) || 0,
      vers_frigo: 0,
      pertes: [],
      masse_petrie_kg: 0, patons_nombre: 0, patons_poids_unitaire_g: 0, masse_cuite_kg: 0,
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
        // Bilan massique (épic labo L3) : 0 = non pesé → null.
        masse_petrie_kg: formData.masse_petrie_kg > 0 ? formData.masse_petrie_kg : null,
        patons_nombre: formData.patons_nombre > 0 ? formData.patons_nombre : null,
        patons_poids_unitaire_g: formData.patons_poids_unitaire_g > 0 ? formData.patons_poids_unitaire_g : null,
        masse_cuite_kg: formData.masse_cuite_kg > 0 ? formData.masse_cuite_kg : null,
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
    <div className="odoo-section">
      <div className="odoo-section-header">
        <Scale size={12} /> Rendement de production
        <span style={{ marginLeft: 4, color: 'var(--theme-text-muted)', fontWeight: 400 }}>{rendements.length}/{producedItems.length} enregistrés</span>
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

                  {/* Bilan massique et pâtons (épic labo L3) */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Bilan massique (optionnel)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Masse pétrie (kg)</label>
                        <input type="number" min={0} step="0.001" value={formData.masse_petrie_kg || ''} placeholder="0"
                          onChange={e => setFormData(f => ({ ...f, masse_petrie_kg: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-200 rounded text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Pâtons (nb)</label>
                        <input type="number" min={0} value={formData.patons_nombre || ''} placeholder="0"
                          onChange={e => setFormData(f => ({ ...f, patons_nombre: parseInt(e.target.value) || 0 }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-200 rounded text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Poids/pâton (g)</label>
                        <input type="number" min={0} value={formData.patons_poids_unitaire_g || ''} placeholder="0"
                          onChange={e => setFormData(f => ({ ...f, patons_poids_unitaire_g: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-200 rounded text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Masse cuite (kg)</label>
                        <input type="number" min={0} step="0.001" value={formData.masse_cuite_kg || ''} placeholder="0"
                          onChange={e => setFormData(f => ({ ...f, masse_cuite_kg: parseFloat(e.target.value) || 0 }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-200 rounded text-xs" />
                      </div>
                    </div>
                    {formData.masse_petrie_kg > 0 && formData.masse_cuite_kg > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        Freinte réelle : <span className="font-bold text-gray-800">{((formData.masse_petrie_kg - formData.masse_cuite_kg) / formData.masse_petrie_kg * 100).toFixed(2)} %</span>
                      </div>
                    )}
                  </div>

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

              {/* Bilan massique enregistré (épic labo L3) */}
              {existing && existing.masse_petrie_kg != null && (() => {
                const reelle = existing.freinte_reelle_pct != null ? parseFloat(String(existing.freinte_reelle_pct)) : null;
                const std = existing.freinte_standard_pct != null ? parseFloat(String(existing.freinte_standard_pct)) : null;
                const ecart = reelle != null && std != null ? reelle - std : null;
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
                      <Scale size={10} /> {parseFloat(String(existing.masse_petrie_kg))} kg pétrie
                      {existing.patons_nombre ? ` · ${existing.patons_nombre} pâtons` : ''}
                      {existing.masse_cuite_kg != null ? ` → ${parseFloat(String(existing.masse_cuite_kg))} kg cuit` : ''}
                    </span>
                    {reelle != null && (
                      <span className="inline-flex items-center gap-1">
                        Freinte réelle <span className="font-bold text-gray-800">{reelle.toFixed(2)} %</span>
                        {std != null && <span className="text-gray-400">· standard {std.toFixed(2)} %</span>}
                        {ecart != null && (
                          <span className={`font-bold ${ecart > 0.5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            ({ecart > 0 ? '+' : ''}{ecart.toFixed(2)} pts)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
