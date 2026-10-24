import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Timer, ShieldCheck, Repeat, Languages, Pencil, Plus, Trash2, ArrowUp, ArrowDown, Save, X } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';

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

export interface Etape {
  ordre: number;
  nom: string;
  nom_ar?: string | null;
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
type Draft = { k: number; src: Etape; nom: string; nomAr: string; duree: string; cq: boolean; bloquante: boolean; pts: string; ptsAr: string };
let draftSeq = 0;
const toDraft = (e: Etape): Draft => ({
  k: ++draftSeq, src: e, nom: e.nom || '', nomAr: e.nom_ar || '',
  duree: e.duree_estimee_min ? String(e.duree_estimee_min) : '',
  cq: !!e.controle_qualite, bloquante: e.est_bloquante !== false,
  pts: (e.checklist_items || []).join('\n'), ptsAr: (e.checklist_items_ar || []).join('\n'),
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
  const qc = useQueryClient();
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
        return {
          ...d.src,
          ordre: i + 1,
          nom: d.nom.trim(),
          nom_ar: d.nomAr.trim() || null,
          duree_estimee_min: duree > 0 ? duree : null,
          controle_qualite: d.cq,
          est_bloquante: d.bloquante,
          checklist_items: lines(d.pts),
          checklist_items_ar: lines(d.ptsAr),
        };
      })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      setDrafts(null);
      notify.success('Étapes enregistrées');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || "Erreur lors de l'enregistrement des étapes");
    },
  });

  if (drafts) {
    const inp = 'h-8 px-2 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400';
    const area = 'w-full px-2 py-1.5 bg-white border border-gray-200 rounded-md text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400';
    const ar = { fontFamily: 'Tahoma, Arial, sans-serif' };
    return (
      <div className="odoo-section" style={{ marginTop: '1rem', overflow: 'clip' }}>
        <div className="odoo-section-header flex items-center gap-2"><ListChecks size={13} /> Étapes de production — modification</div>
        <div>
          {drafts.map((d, i) => (
            <div key={d.k} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--theme-accent)', color: '#fff',
                  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                }}>{i + 1}</span>
                <input className={`${inp} flex-1 min-w-[180px] font-medium`} value={d.nom} placeholder="Nom de l'étape"
                  onChange={(e) => patch(d.k, { nom: e.target.value })} maxLength={200} />
                <input dir="rtl" lang="ar" className={`${inp} flex-1 min-w-[180px]`} style={ar} value={d.nomAr} placeholder="الاسم بالعربية"
                  onChange={(e) => patch(d.k, { nomAr: e.target.value })} maxLength={300} />
                <span className="inline-flex items-center gap-1">
                  <input type="number" min="0" step="any" className={`${inp} w-20 text-right tabular-nums`} value={d.duree} placeholder="0"
                    onChange={(e) => patch(d.k, { duree: e.target.value })} title="Durée estimée" />
                  <span className="text-xs text-gray-400">min</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="odoo-pager-btn" title="Monter"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} className="odoo-pager-btn" title="Descendre"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => setDrafts((ds) => ds && ds.filter((x) => x.k !== d.k))}
                    className="odoo-pager-btn" title="Supprimer l'étape"><Trash2 size={13} /></button>
                </span>
              </div>
              <div className="flex items-center gap-4 mt-2" style={{ marginLeft: 30 }}>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={d.cq} onChange={(e) => patch(d.k, { cq: e.target.checked })} /> Contrôle qualité
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600" title="Empêche de passer à l'étape suivante tant qu'elle n'est pas validée">
                  <input type="checkbox" checked={d.bloquante} onChange={(e) => patch(d.k, { bloquante: e.target.checked })} /> Bloquante
                </label>
              </div>
              <div className="grid gap-3 mt-2" style={{ gridTemplateColumns: '1fr 1fr', marginLeft: 30 }}>
                <label className="block">
                  <span className="text-[11px] text-gray-400">Points à suivre — un par ligne</span>
                  <textarea className={area} rows={Math.max(3, d.pts.split('\n').length)} value={d.pts}
                    onChange={(e) => patch(d.k, { pts: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-400">Darija — une ligne par point</span>
                  <textarea dir="rtl" lang="ar" className={area} style={ar} rows={Math.max(3, d.ptsAr.split('\n').length)} value={d.ptsAr}
                    onChange={(e) => patch(d.k, { ptsAr: e.target.value })} />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-white border-t border-gray-200"
          style={{ boxShadow: '0 -2px 6px rgba(0,0,0,0.05)' }}>
          <button type="button" onClick={() => setDrafts((ds) => [...(ds || []), toDraft({ ordre: (ds?.length || 0) + 1, nom: '' })])}
            className="text-sm font-medium text-primary-700 hover:text-primary-800 inline-flex items-center gap-1">
            <Plus size={15} /> Ajouter une étape
          </button>
          <div className="inline-flex items-center gap-2">
            <button type="button" onClick={() => setDrafts(null)} disabled={saveMut.isPending}
              className="odoo-btn-secondary inline-flex items-center gap-1"><X size={15} /> Annuler</button>
            <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              className="odoo-btn-primary inline-flex items-center gap-1">
              <Save size={15} /> {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer les étapes'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!etapes || etapes.length === 0) {
    return (
      <div className="odoo-section" style={{ marginTop: '1rem' }}>
        <div className="odoo-section-header flex items-center gap-2"><ListChecks size={13} /> Étapes de production</div>
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
    <div className="odoo-section" style={{ marginTop: '1rem' }}>
      <div className="odoo-section-header flex items-center gap-2">
        <ListChecks size={13} /> Étapes de production
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 400, textTransform: 'none' }}>
          {dureeTotale > 0 && (
            <span className="text-gray-500"><Timer size={11} style={{ display: 'inline', marginRight: 3 }} />
              {Math.floor(dureeTotale / 60) > 0 ? `${Math.floor(dureeTotale / 60)} h ${dureeTotale % 60 || ''}`.trim() : `${dureeTotale} min`}
            </span>
          )}
          <span className="text-gray-500">{nbPoints} points de contrôle</span>
          {darijaDispo && (
            <button type="button" onClick={() => setBilingue(!bilingue)}
              title={bilingue ? 'Masquer la darija' : 'Afficher la darija'}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                bilingue ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              <Languages size={11} /> عربي
            </button>
          )}
          {recipeId && (
            <button type="button" onClick={startEdit} title="Modifier les étapes"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] bg-white text-gray-600 border-gray-200 hover:bg-gray-50">
              <Pencil size={11} /> Modifier
            </button>
          )}
        </span>
      </div>

      <div style={{ padding: '0.5rem 0' }}>
        {etapes.slice().sort((a, b) => a.ordre - b.ordre).map((e) => {
          const ar = bilingue && aDuDarija(e);
          return (
            <div key={e.ordre} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--theme-bg-separator)' }}>
              {/* En-tête : numéro, libellé, et les marqueurs de conduite */}
              <div className="flex items-start gap-3">
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--theme-accent)', color: '#fff',
                  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                }}>{e.ordre}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold" style={{ color: 'var(--theme-text-strong)' }}>{e.nom}</span>
                    {e.duree_estimee_min ? (
                      <span className="odoo-tag odoo-tag-grey"><Timer size={9} /> {e.duree_estimee_min} min</span>
                    ) : null}
                    {e.controle_qualite && (
                      <span className="odoo-tag odoo-tag-green"><ShieldCheck size={9} /> contrôle qualité</span>
                    )}
                    {e.est_repetable && (e.nb_repetitions || 1) > 1 && (
                      <span className="odoo-tag odoo-tag-purple"><Repeat size={9} /> ×{e.nb_repetitions}</span>
                    )}
                  </div>
                  {ar && e.nom_ar && (
                    <div dir="rtl" lang="ar" className="text-sm font-semibold mt-0.5"
                      style={{ color: 'var(--theme-accent)', fontFamily: 'Tahoma, Arial, sans-serif' }}>
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
                      <li key={i} className="text-[13px]" style={{ color: 'var(--theme-text-muted)', marginBottom: 3 }}>{it}</li>
                    ))}
                  </ul>
                  {ar && (
                    <ul dir="rtl" lang="ar" style={{ margin: 0, paddingRight: 16, paddingLeft: 0, borderRight: '2px solid var(--theme-bg-separator)' }}>
                      {(e.checklist_items_ar || []).map((it, i) => (
                        <li key={i} className="text-[13px]"
                          style={{ color: 'var(--theme-text-muted)', marginBottom: 3, fontFamily: 'Tahoma, Arial, sans-serif' }}>{it}</li>
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
