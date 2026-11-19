import { useProductionPolicies, yieldLevel, YIELD_PILL, YIELD_TEXT } from './usePolicies';
import { useState } from 'react';
import { usePermissions } from '../../context/PermissionsContext';
import { apiErrorMessage } from '../../api/errors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionEtapesApi } from '../../api/production-etapes.api';
import { usePlanSummary, planSummaryKey } from '../../api/production.api';
import { notify } from '../../components/ui/InlineNotification';
import { stockLocationsApi, type StockLocation } from '../../api/stock-locations.api';
import { convertWeight, readWeight, formatWeight, type WeightUnit } from '../../utils/weight-unit';
import WeightQtyInput from '../../components/ui/WeightQtyInput';
import {
  TrendingUp, TrendingDown, Package, Flame, AlertTriangle, Loader2,
  ChevronDown, ChevronRight, Scale, PieChart
} from 'lucide-react';

interface RendementPanelProps {
  planId: string;
  planStatus: string;
  items: Record<string, any>[];
  isChef: boolean;
  /** Contexte des politiques (seuils d'affichage) : atelier et établissement du plan. */
  workshop?: string | null;
  storeId?: string | null;
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
  // M3-04 : les mêmes pesées dans l'unité saisie.
  masse_petrie_qty?: number | string | null; masse_petrie_unit?: string | null;
  patons_poids_unitaire_qty?: number | string | null; patons_poids_unitaire_unit?: string | null;
  masse_cuite_qty?: number | string | null; masse_cuite_unit?: string | null;
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

export default function RendementPanel({ planId, planStatus, items, isChef, workshop, storeId }: RendementPanelProps) {
  const queryClient = useQueryClient();
  // M8-06 : pâtons et termes de cuisson réservés à l'option « saisie par fournée » (boulangerie).
  const batchMode = usePermissions().hasFeature('mode_fournee');
  const { data: summary } = usePlanSummary(planId, ['in_progress', 'completed'].includes(planStatus));
  // M1-03 : seuils lus dans les politiques de production, plus en dur.
  const policies = useProductionPolicies({ workshop, store: storeId });
  const yieldTarget = policies.num('production.yield_target', 'pct');
  const avgGood = policies.num('production.yield_display', 'good');
  const avgAlert = policies.num('production.yield_display', 'alert');
  const [recordingItem, setRecordingItem] = useState<string | null>(null);
  type Weighing = { qty: number; unit: WeightUnit };
  const emptyMass = { masse_petrie: { qty: 0, unit: 'kg' as WeightUnit }, patons_nombre: 0,
    patons_poids_unitaire: { qty: 0, unit: 'g' as WeightUnit }, masse_cuite: { qty: 0, unit: 'kg' as WeightUnit } };
  const [formData, setFormData] = useState<{
    quantite_brute: number; quantite_nette_reelle: number;
    vers_magasin: number; vers_frigo: number;
    pertes: { categorie: string; quantite: number }[];
    // Bilan massique (épic labo L3) — 0 = non pesé. M3-04 : quantité + unité saisie (g ou kg).
    masse_petrie: Weighing; patons_nombre: number; patons_poids_unitaire: Weighing; masse_cuite: Weighing;
    // M6-02 : emplacement de destination ; '' = emplacement de code MAGASIN / FRIGO.
    magasin_location_id: string; frigo_location_id: string;
  }>({ quantite_brute: 0, quantite_nette_reelle: 0, vers_magasin: 0, vers_frigo: 0, pertes: [], ...emptyMass,
       magasin_location_id: '', frigo_location_id: '' });
  const setWeighing = (key: 'masse_petrie' | 'patons_poids_unitaire' | 'masse_cuite', patch: Partial<Weighing>) =>
    setFormData(f => ({ ...f, [key]: { ...f[key], ...patch } }));
  const petrieKg = convertWeight(formData.masse_petrie.qty, formData.masse_petrie.unit, 'kg');
  const cuiteKg = convertWeight(formData.masse_cuite.qty, formData.masse_cuite.unit, 'kg');

  // M6-02 : emplacements de l'établissement, destinations « vers magasin » / « vers frigo ».
  const { data: locations = [] } = useQuery<StockLocation[]>({
    queryKey: ['stock-locations', storeId ?? null],
    queryFn: () => stockLocationsApi.list(storeId ?? undefined),
    enabled: !!recordingItem,
  });
  const destinations = locations.filter(l => l.is_active && l.type !== 'pesage');
  const hasCode = (code: string) => destinations.some(l => l.code === code);

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
      queryClient.invalidateQueries({ queryKey: planSummaryKey(planId) });
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
      // M6-02 : rangement du lot dans les emplacements Magasin / Frigo.
      const placed = (result?.emplacements?.moved ?? []).filter(m => m.quantity > 0);
      if (placed.length) notify.success(`Lot rangé : ${placed.map(m => `${m.quantity} → ${m.location}`).join(', ')}`);
      for (const w of result?.emplacements?.warnings ?? []) notify(w, { icon: '⚠️', duration: 8000 });
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
      ...emptyMass,
      magasin_location_id: '', frigo_location_id: '',
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
        // Bilan massique (épic labo L3) : 0 = non pesé → null. M3-04 : unité saisie conservée.
        masse_petrie_qty: formData.masse_petrie.qty > 0 ? formData.masse_petrie.qty : null,
        masse_petrie_unit: formData.masse_petrie.unit,
        patons_nombre: formData.patons_nombre > 0 ? formData.patons_nombre : null,
        patons_poids_unitaire_qty: formData.patons_poids_unitaire.qty > 0 ? formData.patons_poids_unitaire.qty : null,
        patons_poids_unitaire_unit: formData.patons_poids_unitaire.unit,
        masse_cuite_qty: formData.masse_cuite.qty > 0 ? formData.masse_cuite.qty : null,
        masse_cuite_unit: formData.masse_cuite.unit,
        vers_magasin_location_id: formData.magasin_location_id || null,
        vers_frigo_location_id: formData.frigo_location_id || null,
      },
    });
  };

  // M8-05 : synthèse calculée au serveur (même requête que l'en-tête de l'ordre).
  const avgRendement = summary?.yield.average ?? 0;
  const totalPertes = summary?.yield.lossesTotal ?? 0;
  const totalVersFrigo = summary?.yield.toFridgeTotal ?? 0;

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
            <span className={`font-bold ${YIELD_TEXT[yieldLevel(avgRendement, avgGood, avgAlert)]}`}>
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
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${YIELD_PILL[yieldLevel(existing.rendement_reel, Number(existing.seuil_rendement) || yieldTarget)]}`}>
                      {yieldLevel(existing.rendement_reel, Number(existing.seuil_rendement) || yieldTarget) === 'good' ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
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

                  {/* M6-02 : emplacements de destination (le lot y est rangé, mouvement tracé). */}
                  {destinations.length === 0 ? (
                    <div className="text-[11px] text-amber-700">
                      Aucun emplacement de stock pour cet établissement : le lot ne sera pas rangé. Créez « Magasin » (code MAGASIN) et « Frigo » (code FRIGO) dans Stock › Emplacements.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {([['magasin_location_id', 'Emplacement magasin', 'MAGASIN', formData.vers_magasin],
                         ['frigo_location_id', 'Emplacement frigo', 'FRIGO', formData.vers_frigo]] as const).map(([key, label, code, qty]) => (
                        <div key={key}>
                          <label className="text-[10px] font-bold text-gray-500 uppercase">{label}</label>
                          <select value={formData[key]} onChange={e => setFormData(f => ({ ...f, [key]: e.target.value }))}
                            className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                            <option value="">{hasCode(code) ? `Par défaut (${code})` : `— Aucun emplacement ${code} —`}</option>
                            {destinations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                          </select>
                          {qty > 0 && !formData[key] && !hasCode(code) && (
                            <div className="text-[10px] text-amber-700 mt-0.5">Choisissez un emplacement, sinon ces {qty} ne seront pas rangés.</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

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

                  {/* Bilan massique (épic labo L3) ; pâtons réservés à l'option « saisie par fournée » (M8-06). */}
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Bilan massique (optionnel)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">{batchMode ? 'Masse pétrie' : 'Masse mise en œuvre'}</label>
                        <WeightQtyInput className="mt-0.5" value={formData.masse_petrie} onChange={v => setWeighing('masse_petrie', v)} />
                      </div>
                      {batchMode && <div>
                        <label className="text-[10px] text-gray-500">Pâtons (nb)</label>
                        <input type="number" min={0} value={formData.patons_nombre || ''} placeholder="0"
                          onChange={e => setFormData(f => ({ ...f, patons_nombre: parseInt(e.target.value) || 0 }))}
                          className="w-full mt-0.5 px-2 py-1 border border-gray-200 rounded text-xs" />
                      </div>}
                      {batchMode && <div>
                        <label className="text-[10px] text-gray-500">Poids/pâton</label>
                        <WeightQtyInput className="mt-0.5" value={formData.patons_poids_unitaire} onChange={v => setWeighing('patons_poids_unitaire', v)} />
                      </div>}
                      <div>
                        <label className="text-[10px] text-gray-500">{batchMode ? 'Masse cuite' : 'Masse obtenue'}</label>
                        <WeightQtyInput className="mt-0.5" value={formData.masse_cuite} onChange={v => setWeighing('masse_cuite', v)} />
                      </div>
                    </div>
                    {petrieKg > 0 && cuiteKg > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {batchMode ? 'Freinte réelle' : 'Perte de masse'} : <span className="font-bold text-gray-800">{((petrieKg - cuiteKg) / petrieKg * 100).toFixed(2)} %</span>
                      </div>
                    )}
                  </div>

                  {/* Rendement preview */}
                  {formData.quantite_brute > 0 && (
                    <div className="text-xs text-gray-500 flex items-center gap-3">
                      <span>Rendement: <span className={`font-bold ${YIELD_TEXT[yieldLevel(formData.quantite_nette_reelle / formData.quantite_brute * 100, Number(target?.seuilRendement) || yieldTarget)]}`}>
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
                // M3-04 : pesées affichées dans l'unité saisie.
                const petrie = readWeight(existing.masse_petrie_qty, existing.masse_petrie_unit, existing.masse_petrie_kg, 'kg');
                const cuite = readWeight(existing.masse_cuite_qty, existing.masse_cuite_unit, existing.masse_cuite_kg, 'kg');
                const reelle = existing.freinte_reelle_pct != null ? parseFloat(String(existing.freinte_reelle_pct)) : null;
                const std = existing.freinte_standard_pct != null ? parseFloat(String(existing.freinte_standard_pct)) : null;
                const ecart = reelle != null && std != null ? reelle - std : null;
                return (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
                      <Scale size={10} /> {petrie ? formatWeight(petrie) : ''} {batchMode ? 'pétrie' : 'mise en œuvre'}
                      {batchMode && existing.patons_nombre ? ` · ${existing.patons_nombre} pâtons` : ''}
                      {cuite ? ` → ${formatWeight(cuite)} ${batchMode ? 'cuit' : 'obtenue'}` : ''}
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

