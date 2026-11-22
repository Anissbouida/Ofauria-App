import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Timer, ShieldCheck, Repeat, Languages, Pencil, Plus, Trash2, ArrowUp, ArrowDown, Save, X, Thermometer, Droplets } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { useProcessRefs } from '../../api/production.api';
import { notify } from '../../components/ui/InlineNotification';
import { apiErrorMessage } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import '../production/production.css';
import { FormFooter } from '../../components/ds';

/**
 * Étapes de production d'une recette — section partagée par la page produit fini
 * et la page préparation de base.
 *
 * Ces étapes vivaient jusqu'ici uniquement dans `recipes.etapes` et sur la fiche
 * PDF : aucun écran de l'application ne les montrait. Une fiche technique dont
 * le mode opératoire n'est visible qu'à l'impression n'aide personne au labo.
 *
 * Bilingue : les fiches Masterclass Ôfauria sont rédigées en français ET en
 * darija, et c'est souvent la colonne darija qui est lue en production. Le
 * navigateur gère nativement la mise en forme RTL et la ligature arabe — ce que
 * le PDF, lui, ne sait pas faire (police Helvetica, encodage Latin-1).
 */

// Types d'étape : référentiel éditable (mig 513, Paramètres › Référentiels), via useProcessRefs.

export interface Etape {
  ordre: number;
  nom: string;
  nom_ar?: string | null;
  // Parametres structures (mig 342) : conduite de l'etape.
  type?: string | null;
  temperature_c?: number | null;
  humidite_pct?: number | null;
  duree_estimee_min?: number | null;
  est_bloquante?: boolean;
  timer_auto?: boolean;
  controle_qualite?: boolean;
  checklist_items?: string[];
  checklist_items_ar?: string[];
  est_repetable?: boolean;
  nb_repetitions?: number;
}

const aDuDarija = (e: Etape) =>
  Boolean(e.nom_ar || (e.checklist_items_ar && e.checklist_items_ar.length > 0));

/** Brouillon d'édition : les points de contrôle se saisissent un par ligne. */
type Draft = {
  k: number; src: Etape; nom: string; nomAr: string; duree: string; cq: boolean; bloquante: boolean; pts: string; ptsAr: string;
  type: string; tC: string; hr: string; timer: boolean; rep: boolean; nbRep: string;
};
let draftSeq = 0;
const toDraft = (e: Etape): Draft => ({
  k: ++draftSeq, src: e, nom: e.nom || '', nomAr: e.nom_ar || '',
  duree: e.duree_estimee_min ? String(e.duree_estimee_min) : '',
  cq: !!e.controle_qualite, bloquante: e.est_bloquante !== false,
  pts: (e.checklist_items || []).join('\n'), ptsAr: (e.checklist_items_ar || []).join('\n'),
  type: e.type || '', tC: e.temperature_c != null ? String(e.temperature_c) : '',
  hr: e.humidite_pct != null ? String(e.humidite_pct) : '',
  timer: !!e.timer_auto, rep: !!e.est_repetable, nbRep: String(e.nb_repetitions || 1),
});
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * `recipeId` fourni → la section est modifiable sur place (bouton Modifier).
 * Sans lui, elle reste en lecture seule.
 */
export default function EtapesSection({ etapes, recipeId, editBlockedReason }: { etapes: Etape[]; recipeId?: string; editBlockedReason?: string | null }) {
  // Par défaut les deux langues : c'est le sens d'une fiche bilingue. Le bouton
  // permet de n'afficher que le français quand la darija encombre.
  const [bilingue, setBilingue] = useState(true);
  // Darija : option « Fiche technique bilingue » (mig 507). Éteinte, les champs
  // arabes ne s'affichent que s'ils contiennent déjà une traduction.
  const { hasFeature } = usePermissions();
  const darijaOn = hasFeature('fiche_masterclass');
  const qc = useQueryClient();
  const refs = useProcessRefs();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  // Enregistrer les étapes recharge la fiche : la page hôte peut bloquer l'entrée
  // en édition tant qu'elle a elle-même une saisie non enregistrée.
  const startEdit = () => editBlockedReason ? notify.error(editBlockedReason) : setDrafts(
    (etapes || []).length > 0
      ? etapes.slice().sort((a, b) => a.ordre - b.ordre).map(toDraft)
      : [toDraft({ ordre: 1, nom: '' })]
  );
  const patch = (k: number, p: Partial<Draft>) => setDrafts((ds) => ds && ds.map((d) => (d.k === k ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) => setDrafts((ds) => {
    if (!ds) return ds;
    const j = i + dir;
    if (j < 0 || j >= ds.length) return ds;
    const copy = [...ds]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });

  const saveMut = useMutation({
    mutationFn: () => recipesApi.saveEtapes(recipeId!, (drafts || [])
      .filter((d) => d.nom.trim())
      .map((d, i) => {
        const duree = parseFloat(d.duree.replace(',', '.'));
        const tC = parseFloat(d.tC.replace(',', '.'));
        const hr = parseFloat(d.hr.replace(',', '.'));
        return {
          ...d.src,
          ordre: i + 1,
          nom: d.nom.trim(),
          nom_ar: d.nomAr.trim() || null,
          type: d.type || null,
          temperature_c: Number.isFinite(tC) ? tC : null,
          humidite_pct: Number.isFinite(hr) ? hr : null,
          duree_estimee_min: duree > 0 ? duree : null,
          controle_qualite: d.cq,
          est_bloquante: d.bloquante,
          timer_auto: d.timer,
          est_repetable: d.rep,
          nb_repetitions: d.rep ? Math.max(1, parseInt(d.nbRep, 10) || 1) : 1,
          checklist_items: lines(d.pts),
          checklist_items_ar: lines(d.ptsAr),
        };
      })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      setDrafts(null);
      notify.success('Étapes enregistrées');
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, "Erreur lors de l'enregistrement des étapes")),
  });

  if (drafts) {
    const inp = 'ds-input sm';
    const area = 'ds-input';
    const ar = { fontFamily: 'Tahoma, Arial, sans-serif' };
    return (
      <div className="ds-panel pd-section" style={{ marginTop: '1rem', overflow: 'clip' }}>
        <div className="pd-section-head"><ListChecks size={13} /> Étapes de production — modification</div>
        <div>
          {drafts.map((d, i) => (
            <div key={d.k} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ds-sep)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 8, background: 'var(--ds-accent)' }} />
                <input className={`${inp} flex-1 min-w-[180px] font-medium`} style={{ width: 'auto' }} value={d.nom} placeholder="Nom de l'étape" aria-label={`Nom de l'étape ${i + 1}`} aria-required="true"
                  onChange={(e) => patch(d.k, { nom: e.target.value })} maxLength={200} />
                {(darijaOn || d.nomAr) && (
                  <input dir="rtl" lang="ar" className={`${inp} flex-1 min-w-[180px]`} style={{ ...ar, width: 'auto' }} value={d.nomAr} placeholder="الاسم بالعربية" aria-label={`Nom de l'étape ${i + 1} en darija`}
                    onChange={(e) => patch(d.k, { nomAr: e.target.value })} maxLength={300} />
                )}
                <span className="inline-flex items-center gap-1">
                  <input type="number" min="0" step="any" className={`${inp} w-20 text-right tabular-nums`} style={{ width: 80 }} value={d.duree} placeholder="0" aria-label={`Durée estimée de l'étape ${i + 1} (min)`}
                    onChange={(e) => patch(d.k, { duree: e.target.value })} title="Durée estimée" />
                  <span className="text-xs text-gray-400">min</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="ds-icon-btn" title="Monter" aria-label="Monter"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} className="ds-icon-btn" title="Descendre" aria-label="Descendre"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => setDrafts((ds) => ds && ds.filter((x) => x.k !== d.k))}
                    className="ds-icon-btn" title="Supprimer l'étape" aria-label="Supprimer l'étape"><Trash2 size={13} /></button>
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap" style={{ marginLeft: 30 }}>
                {/* Conduite de l'étape (mig 342) : type, température, hygrométrie. */}
                <select className={`${inp} min-w-[150px]`} style={{ width: 'auto' }} aria-label={`Type de l'étape ${i + 1}`} value={d.type} onChange={(e) => patch(d.k, { type: e.target.value })} title="Type d'étape">
                  <option value="">Type d'étape…</option>
                  {refs.stepTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
                <span className="inline-flex items-center gap-1" title="Température (four, étuve, ambiante…)">
                  <Thermometer size={13} className="text-gray-400" />
                  <input type="number" step="any" min="-40" max="400" className={`${inp} w-16 text-right tabular-nums`} style={{ width: 64 }} value={d.tC} placeholder="°C" aria-label={`Température de l'étape ${i + 1} (°C)`}
                    onChange={(e) => patch(d.k, { tC: e.target.value })} />
                  <span className="text-xs text-gray-400">°C</span>
                </span>
                <span className="inline-flex items-center gap-1" title="Hygrométrie (étuve, pousse contrôlée)">
                  <Droplets size={13} className="text-gray-400" />
                  <input type="number" step="any" min="0" max="100" className={`${inp} w-16 text-right tabular-nums`} style={{ width: 64 }} value={d.hr} placeholder="HR" aria-label={`Hygrométrie de l'étape ${i + 1} (% HR)`}
                    onChange={(e) => patch(d.k, { hr: e.target.value })} />
                  <span className="text-xs text-gray-400">% HR</span>
                </span>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={d.cq} onChange={(e) => patch(d.k, { cq: e.target.checked })} /> Contrôle qualité
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600" title="Empêche de passer à l'étape suivante tant qu'elle n'est pas validée">
                  <input type="checkbox" checked={d.bloquante} onChange={(e) => patch(d.k, { bloquante: e.target.checked })} /> Bloquante
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600" title="Déclenche automatiquement un minuteur sur la durée estimée">
                  <input type="checkbox" checked={d.timer} onChange={(e) => patch(d.k, { timer: e.target.checked })} /> Timer auto
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600" title="L'étape se répète (tours de feuilletage, passages…)">
                  <input type="checkbox" checked={d.rep} onChange={(e) => patch(d.k, { rep: e.target.checked })} /> Répétable
                </label>
                {d.rep && (
                  <span className="inline-flex items-center gap-1">
                    <Repeat size={12} className="text-gray-400" />
                    <input type="number" min="1" step="1" className={`${inp} w-14 text-right tabular-nums`} style={{ width: 56 }} aria-label={`Nombre de répétitions de l'étape ${i + 1}`} value={d.nbRep}
                      onChange={(e) => patch(d.k, { nbRep: e.target.value })} />
                    <span className="text-xs text-gray-400">fois</span>
                  </span>
                )}
              </div>
              <div className="grid gap-3 mt-2" style={{ gridTemplateColumns: '1fr 1fr', marginLeft: 30 }}>
                <label className="ds-field">
                  <span className="ds-field-label">Points à suivre — un par ligne</span>
                  <textarea className={area} rows={Math.max(3, d.pts.split('\n').length)} value={d.pts}
                    onChange={(e) => patch(d.k, { pts: e.target.value })} />
                </label>
                {(darijaOn || d.ptsAr) && (
                  <label className="ds-field">
                    <span className="ds-field-label">Darija — une ligne par point</span>
                    <textarea dir="rtl" lang="ar" className={area} style={ar} rows={Math.max(3, d.ptsAr.split('\n').length)} value={d.ptsAr}
                      onChange={(e) => patch(d.k, { ptsAr: e.target.value })} />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 z-10" style={{ background: 'var(--ds-card)' }}>
          <FormFooter onCancel={() => setDrafts(null)} onSubmit={() => saveMut.mutate()} busy={saveMut.isPending}
            submitLabel={saveMut.isPending ? 'Enregistrement…' : 'Enregistrer les étapes'}>
            <button type="button" onClick={() => setDrafts((ds) => [...(ds || []), toDraft({ ordre: (ds?.length || 0) + 1, nom: '' })])}
              className="ds-btn-ghost ds-btn-sm">
              <Plus size={15} aria-hidden="true" /> Ajouter une étape
            </button>
          </FormFooter>
        </div>
      </div>
    );
  }

  if (!etapes || etapes.length === 0) {
    return (
      <div className="ds-panel pd-section" style={{ marginTop: '1rem' }}>
        <div className="pd-section-head"><ListChecks size={13} /> Étapes de production</div>
        <div className="flex items-center gap-3 flex-wrap" style={{ padding: '1rem' }}>
          <span className="text-sm text-gray-400 italic">Aucune étape définie.</span>
          {recipeId && (
            <button type="button" onClick={startEdit} className="odoo-btn-secondary inline-flex items-center gap-1">
              <Plus size={14} /> Ajouter des étapes
            </button>
          )}
        </div>
      </div>
    );
  }

  const dureeTotale = etapes.reduce((s, e) => s + (Number(e.duree_estimee_min) || 0), 0);
  const nbControles = etapes.filter(e => e.controle_qualite).length;
  const nbPoints = etapes.reduce((s, e) => s + (e.checklist_items?.length || 0), 0);
  const darijaDispo = etapes.some(aDuDarija);

  return (
    <div className="ds-panel pd-section" style={{ marginTop: '1rem' }}>
      <div className="pd-section-head">
        <ListChecks size={13} /> Étapes de production
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 400, textTransform: 'none' }}>
          {dureeTotale > 0 && (
            <span className="text-gray-500"><Timer size={11} style={{ display: 'inline', marginRight: 3 }} />
              {Math.floor(dureeTotale / 60) > 0 ? `${Math.floor(dureeTotale / 60)} h ${dureeTotale % 60 || ''}`.trim() : `${dureeTotale} min`}
            </span>
          )}
          <span className="text-gray-500">{nbPoints} points de contrôle</span>
          {darijaDispo && darijaOn && (
            <button type="button" onClick={() => setBilingue(!bilingue)}
              title={bilingue ? 'Masquer la darija' : 'Afficher la darija'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                bilingue ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              <Languages size={11} /> عربي
            </button>
          )}
          {recipeId && (
            <button type="button" onClick={startEdit} title={editBlockedReason ?? 'Modifier les étapes'} aria-disabled={!!editBlockedReason}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] bg-white text-gray-600 border-gray-200 hover:bg-gray-50">
              <Pencil size={11} /> Modifier
            </button>
          )}
        </span>
      </div>
      {recipeId && editBlockedReason && (
        <div role="note" style={{ padding: '0.5rem 1rem', fontSize: '12px', color: 'var(--ds-muted)', borderBottom: '1px solid var(--ds-sep)' }}>
          {editBlockedReason}
        </div>
      )}

      <div style={{ padding: '0.5rem 0' }}>
        {etapes.slice().sort((a, b) => a.ordre - b.ordre).map((e) => {
          const ar = bilingue && aDuDarija(e);
          return (
            <div key={e.ordre} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ds-sep)' }}>
              {/* En-tête : repère, libellé, et les marqueurs de conduite (pas de numéro d'étape) */}
              <div className="flex items-start gap-3">
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 8, background: 'var(--ds-accent)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: 'var(--ds-ink)' }}>{e.nom}</span>
                    {e.type && (
                      <span className="odoo-tag odoo-tag-grey">{refs.stepLabel(e.type)}</span>
                    )}
                    {e.duree_estimee_min ? (
                      <span className="odoo-tag odoo-tag-grey"><Timer size={9} /> {e.duree_estimee_min} min</span>
                    ) : null}
                    {e.temperature_c != null && (
                      <span className="odoo-tag odoo-tag-grey"><Thermometer size={9} /> {e.temperature_c} °C</span>
                    )}
                    {e.humidite_pct != null && (
                      <span className="odoo-tag odoo-tag-grey"><Droplets size={9} /> {e.humidite_pct} % HR</span>
                    )}
                    {e.timer_auto && (
                      <span className="odoo-tag odoo-tag-blue"><Timer size={9} /> timer auto</span>
                    )}
                    {e.controle_qualite && (
                      <span className="odoo-tag odoo-tag-green"><ShieldCheck size={9} /> contrôle qualité</span>
                    )}
                    {e.est_repetable && (e.nb_repetitions || 1) > 1 && (
                      <span className="odoo-tag odoo-tag-purple"><Repeat size={9} /> ×{e.nb_repetitions}</span>
                    )}
                  </div>
                  {ar && e.nom_ar && (
                    <div dir="rtl" lang="ar" className="text-sm font-semibold mt-0.5"
                      style={{ color: 'var(--ds-accent)', fontFamily: 'Tahoma, Arial, sans-serif' }}>
                      {e.nom_ar}
                    </div>
                  )}
                </div>
              </div>

              {/* Points de contrôle. Deux colonnes quand la darija est affichée :
                  la fiche source est construite ainsi, et le chef lit l'une ou
                  l'autre selon qui est au poste. */}
              {(e.checklist_items?.length || (ar && e.checklist_items_ar?.length)) ? (
                <div className={ar ? 'grid gap-4' : ''}
                  style={ar ? { gridTemplateColumns: '1fr 1fr', marginTop: 8, marginLeft: 34 } : { marginTop: 8, marginLeft: 34 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {(e.checklist_items || []).map((it, i) => (
                      <li key={i} className="text-[13px]" style={{ color: 'var(--ds-muted)', marginBottom: 3 }}>{it}</li>
                    ))}
                  </ul>
                  {ar && (
                    <ul dir="rtl" lang="ar" style={{ margin: 0, paddingRight: 16, paddingLeft: 0, borderRight: '2px solid var(--ds-sep)' }}>
                      {(e.checklist_items_ar || []).map((it, i) => (
                        <li key={i} className="text-[13px]"
                          style={{ color: 'var(--ds-muted)', marginBottom: 3, fontFamily: 'Tahoma, Arial, sans-serif' }}>{it}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {nbControles > 0 && (
          <p className="text-[11px] text-gray-400" style={{ padding: '0.5rem 1rem 0' }}>
            {nbControles} étape(s) sous contrôle qualité — elles bloquent le passage à la suivante tant qu'elles ne sont pas validées.
          </p>
        )}
      </div>
    </div>
  );
}
