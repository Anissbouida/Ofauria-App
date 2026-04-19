import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contenantsApi } from '../../api/contenants.api';
import { notify } from '../../components/ui/InlineNotification';
import { Package, Clock, Check, X, ChevronDown, Layers } from 'lucide-react';

const TYPE_LABELS: Record<number, string> = {
  1: 'Moule / Decoupe',
  2: 'Entremets monte',
  3: 'Pieces individuelles',
  4: 'Petrissage / Cuisson',
  5: 'Laminage / Cuisson',
};

const TYPE_ICONS: Record<number, string> = {
  1: '🍰', 2: '🎂', 3: '🧁', 4: '🥖', 5: '🥐',
};

interface Contenant {
  id: string;
  nom: string;
  type_production: number;
  unite_lancement: string;
  quantite_theorique: string;
  pertes_fixes: string;
  quantite_nette_cible: string;
  seuil_rendement_defaut: string;
  etapes_defaut: EtapeDefaut[];
  categories_pertes: string[];
}

interface EtapeDefaut {
  ordre: number;
  nom: string;
  duree_estimee_min: number | null;
  est_bloquante: boolean;
  timer_auto: boolean;
  controle_qualite: boolean;
  checklist_items: string[];
  est_repetable: boolean;
  nb_repetitions: number;
  responsable_role: string | null;
  _surcharge?: boolean;
}

interface Profile {
  id: string;
  produit_id: string;
  contenant_id: string;
  contenant_nom: string;
  type_production: number;
  unite_lancement: string;
  quantite_theorique: string;
  pertes_fixes: string;
  quantite_nette_cible: number;
  seuil_rendement: string;
  categories_pertes: string[];
  etapes: EtapeDefaut[];
  surcharges: {
    quantite_theorique: string | null;
    pertes_fixes: string | null;
    seuil_rendement: string | null;
    etapes: EtapeDefaut[];
  };
}

// Data shape exposed for creation mode
export interface ProfileFormData {
  contenant_id: string;
  surcharge_quantite_theorique: number | null;
  surcharge_pertes_fixes: number | null;
  surcharge_seuil_rendement: number | null;
  etapes_surcharges: unknown[];
  notes: string | null;
}

interface Props {
  productId?: string;            // undefined = creation mode
  onChange?: (data: ProfileFormData | null) => void;  // callback for creation mode
}

export default function ProductionProfileTab({ productId, onChange }: Props) {
  const queryClient = useQueryClient();
  const isEditMode = !!productId;

  // Load contenants list
  const { data: contenantsData } = useQuery({
    queryKey: ['contenants'],
    queryFn: () => contenantsApi.list(),
  });
  const contenants: Contenant[] = contenantsData?.data || [];

  // Load current profile (only in edit mode)
  const { data: profileData, isLoading } = useQuery({
    queryKey: ['production-profile', productId],
    queryFn: () => contenantsApi.getProfile(productId!),
    enabled: isEditMode,
  });
  const profile: Profile | null = profileData?.data || null;

  // Form state
  const [selectedContenantId, setSelectedContenantId] = useState('');
  const [surchargeQte, setSurchargeQte] = useState('');
  const [surchargePertes, setSurchargePertes] = useState('');
  const [surchargeSeuil, setSurchargeSeuil] = useState('');
  const [notes, setNotes] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Sync form with loaded profile (edit mode only)
  useEffect(() => {
    if (profile) {
      setSelectedContenantId(profile.contenant_id);
      setSurchargeQte(profile.surcharges.quantite_theorique || '');
      setSurchargePertes(profile.surcharges.pertes_fixes || '');
      setSurchargeSeuil(profile.surcharges.seuil_rendement || '');
    }
  }, [profile]);

  // Notify parent of changes (creation mode)
  const buildFormData = useCallback((): ProfileFormData | null => {
    if (!selectedContenantId) return null;
    return {
      contenant_id: selectedContenantId,
      surcharge_quantite_theorique: surchargeQte ? parseFloat(surchargeQte) : null,
      surcharge_pertes_fixes: surchargePertes ? parseFloat(surchargePertes) : null,
      surcharge_seuil_rendement: surchargeSeuil ? parseFloat(surchargeSeuil) : null,
      etapes_surcharges: [],
      notes: notes || null,
    };
  }, [selectedContenantId, surchargeQte, surchargePertes, surchargeSeuil, notes]);

  useEffect(() => {
    if (onChange) {
      onChange(buildFormData());
    }
  }, [onChange, buildFormData]);

  const selectedContenant = contenants.find(c => c.id === selectedContenantId);

  // Computed values
  const effectiveQte = surchargeQte ? parseFloat(surchargeQte) : (selectedContenant ? parseFloat(selectedContenant.quantite_theorique) : 0);
  const effectivePertes = surchargePertes ? parseFloat(surchargePertes) : (selectedContenant ? parseFloat(selectedContenant.pertes_fixes) : 0);
  const effectiveNet = effectiveQte - effectivePertes;
  const effectiveSeuil = surchargeSeuil ? parseFloat(surchargeSeuil) : (selectedContenant ? parseFloat(selectedContenant.seuil_rendement_defaut) : 90);

  // Display steps (from profile if exists, else from selected contenant)
  const displaySteps: EtapeDefaut[] = profile?.etapes || selectedContenant?.etapes_defaut || [];
  const displayPertes: string[] = profile?.categories_pertes || selectedContenant?.categories_pertes || [];

  // Save mutation (edit mode only)
  const saveMutation = useMutation({
    mutationFn: () => contenantsApi.upsertProfile(productId!, {
      contenant_id: selectedContenantId,
      surcharge_quantite_theorique: surchargeQte ? parseFloat(surchargeQte) : null,
      surcharge_pertes_fixes: surchargePertes ? parseFloat(surchargePertes) : null,
      surcharge_seuil_rendement: surchargeSeuil ? parseFloat(surchargeSeuil) : null,
      etapes_surcharges: [],
      notes: notes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-profile', productId] });
      notify.success('Profil de production enregistre');
    },
    onError: () => notify.error('Erreur lors de l\'enregistrement'),
  });

  // Delete mutation (edit mode only)
  const deleteMutation = useMutation({
    mutationFn: () => contenantsApi.deleteProfile(productId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-profile', productId] });
      setSelectedContenantId('');
      setSurchargeQte('');
      setSurchargePertes('');
      setSurchargeSeuil('');
      setNotes('');
      notify.success('Profil de production supprime');
    },
  });

  if (isEditMode && isLoading) {
    return <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Chargement...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Layers size={20} className="text-indigo-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-indigo-800">Profil de production</h3>
            <p className="text-xs text-indigo-600 mt-0.5">
              {isEditMode
                ? 'Assignez un contenant pour activer le calcul inverse, les etapes et le suivi de rendement.'
                : 'Pre-configurez le contenant. Le profil sera enregistre avec le produit.'}
            </p>
          </div>
        </div>
      </div>

      {/* Contenant selector */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Contenant de production</label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-left flex items-center justify-between hover:border-gray-300 transition-colors"
          >
            {selectedContenant ? (
              <span className="flex items-center gap-2">
                <span className="text-lg">{TYPE_ICONS[selectedContenant.type_production]}</span>
                <span className="font-medium">{selectedContenant.nom}</span>
                <span className="text-xs text-gray-400 ml-1">
                  ({TYPE_LABELS[selectedContenant.type_production]})
                </span>
              </span>
            ) : (
              <span className="text-gray-400">Selectionner un contenant...</span>
            )}
            <ChevronDown size={16} className={`text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {[1, 2, 3, 4, 5].map(type => {
                const typeContenants = contenants.filter(c => c.type_production === type);
                if (typeContenants.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 sticky top-0">
                      {TYPE_ICONS[type]} {TYPE_LABELS[type]}
                    </div>
                    {typeContenants.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setSelectedContenantId(c.id); setDropdownOpen(false); }}
                        className={`w-full px-4 py-2.5 text-left text-sm hover:bg-indigo-50 flex items-center justify-between transition-colors ${
                          c.id === selectedContenantId ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <span>{c.nom}</span>
                        <span className="text-xs text-gray-400">
                          {c.quantite_nette_cible} {c.unite_lancement === 'kg_pate' ? 'pcs/kg' : 'pcs'} net
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Parameters — only show if contenant selected */}
      {selectedContenant && (
        <>
          {/* Computed preview card */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-4">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold text-indigo-700">{effectiveQte}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Theorique</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-500">-{effectivePertes}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Pertes fixes</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-600">{effectiveNet}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Net cible</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{effectiveSeuil}%</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Seuil rend.</div>
              </div>
            </div>
            <div className="text-xs text-center text-gray-500 mt-3 pt-2 border-t border-indigo-100">
              Par <strong>{selectedContenant.unite_lancement}</strong> — Type : {TYPE_LABELS[selectedContenant.type_production]}
            </div>
          </div>

          {/* Surcharges */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Surcharges <span className="text-xs font-normal text-gray-400">(laisser vide = valeur du contenant)</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qte theorique</label>
                <input type="number" step="0.01" min="0"
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={surchargeQte} onChange={e => setSurchargeQte(e.target.value)}
                  placeholder={selectedContenant.quantite_theorique} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Pertes fixes</label>
                <input type="number" step="0.01" min="0"
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={surchargePertes} onChange={e => setSurchargePertes(e.target.value)}
                  placeholder={selectedContenant.pertes_fixes} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Seuil rendement %</label>
                <input type="number" step="0.1" min="0" max="100"
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={surchargeSeuil} onChange={e => setSurchargeSeuil(e.target.value)}
                  placeholder={selectedContenant.seuil_rendement_defaut} />
              </div>
            </div>
          </div>

          {/* Steps preview */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Etapes de production <span className="text-xs font-normal text-gray-400">({displaySteps.length} etapes)</span>
            </label>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {displaySteps.map((step, idx) => (
                <div key={idx}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm ${idx > 0 ? 'border-t border-gray-100' : ''} ${
                    step._surcharge ? 'bg-amber-50' : 'bg-white'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {step.ordre}
                  </span>
                  <span className="flex-1 font-medium text-gray-800">{step.nom}</span>
                  <div className="flex items-center gap-1.5">
                    {step.est_bloquante && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">BLOQUANT</span>
                    )}
                    {step.timer_auto && step.duree_estimee_min && (
                      <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded flex items-center gap-0.5">
                        <Clock size={10} /> {step.duree_estimee_min}min
                      </span>
                    )}
                    {step.controle_qualite && (
                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded flex items-center gap-0.5">
                        <Check size={10} /> QC
                      </span>
                    )}
                    {step.est_repetable && step.nb_repetitions > 1 && (
                      <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded">
                        x{step.nb_repetitions}
                      </span>
                    )}
                    {step._surcharge && (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">SURCHARGE</span>
                    )}
                  </div>
                </div>
              ))}
              {displaySteps.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  Aucune etape definie pour ce contenant
                </div>
              )}
            </div>
          </div>

          {/* Loss categories */}
          {displayPertes.length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Categories de pertes</label>
              <div className="flex flex-wrap gap-2">
                {displayPertes.map((p, i) => (
                  <span key={i} className="px-3 py-1.5 bg-red-50 border border-red-100 text-red-700 text-xs font-medium rounded-lg">
                    {p.replace(/_/g, ' ').replace(/pertes?\s?/i, '')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes</label>
            <textarea
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes specifiques a ce produit..." />
          </div>

          {/* Detach button — edit mode only */}
          {isEditMode && profile && (
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={() => { if (confirm('Detacher le contenant de ce produit ?')) deleteMutation.mutate(); }}
                className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors flex items-center gap-1.5">
                <X size={14} /> Detacher
              </button>
            </div>
          )}

          {/* Hint */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs text-amber-700">
              Le profil sera automatiquement enregistre avec le produit lors du clic sur "Enregistrer".
            </p>
          </div>
        </>
      )}

      {/* Empty state */}
      {!selectedContenant && !profile && (
        <div className="text-center py-8">
          <Package size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">Selectionnez un contenant pour configurer le profil de production</p>
          <p className="text-xs text-gray-300 mt-1">Le produit continuera a fonctionner normalement sans profil</p>
        </div>
      )}
    </div>
  );
}
