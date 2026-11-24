import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useProdTerms } from '../../hooks/useProdTerms';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Layers, Search, AlertTriangle, ChevronDown, ChevronRight, CornerDownRight, Camera, Box, GripVertical, HelpCircle, Copy, X } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { contenantsApi } from '../../api/contenants.api';
import { productsApi } from '../../api/products.api';
import type { FormatComponentsData, FormatSummary, RecipeChild } from '../../api/recipes.api';
import { Tag, Link2 } from 'lucide-react';
import { notify } from '../../components/ui/InlineNotification';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { apiErrorMessage as extractErr } from '../../api/errors';
import { usePermissions } from '../../context/PermissionsContext';
import { useExtraUnits } from '../../hooks/useReferentiel';
import SearchSelect from '../../components/ui/SearchSelect';

import { Alert, LoadingState } from '../../components/ds';
import { StatusTag } from '../../components/ui/StatusTag';
import '../production/production.css';
interface SourceOpt { type: 'recipe' | 'ingredient' | 'packaging'; id: string; name: string; unit: string; cost: number; yieldQty?: number; }
interface Row { key: string; role: string; type: '' | 'recipe' | 'ingredient' | 'packaging'; sourceId: string; quantite: string; unite: string; pertePct?: string; /** Étape 10c : part en % du lot de référence (mode pourcentage). */ pct?: string }
interface Contenant { id: string; nom: string; quantite_theorique?: string | number | null; }

const UNITES = ['g', 'kg', 'ml', 'l', 'cl', 'unit'];
// Colonnes : poignée, nature, composant, quantité saisie, unité, quantité convertie
// (fournée ↔ pièce, calculée), perte, retrait.
const COLS = '52px 132px minmax(0,1fr) 108px 80px 120px 72px 36px';
/** Sans la quantité convertie (rendement en kg : pas de « par pièce »). */
const COLS_SANS_CONVERSION = '52px 132px minmax(0,1fr) 108px 80px 72px 36px';
/** Quantité calculée affichée dans l'unité saisie (420 g reste en g) : 2 décimales, 3 sous 1. */
const fmtQty = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 });
const MASS: Record<string, number> = { g: 1, kg: 1000, mg: 0.001 };
const VOL: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };
function conv(from: string, to: string): number {
  const f = from.toLowerCase(), t = to.toLowerCase();
  if (f === t) return 1;
  if (f in MASS && t in MASS) return MASS[f] / MASS[t];
  if (f in VOL && t in VOL) return VOL[f] / VOL[t];
  return 1;
}
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
let seq = 0;
const newKey = () => `row-${++seq}`;
const np = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
/** Libellé du rendement d'un format dans les onglets : « ×100 » ou « 2,1 kg » (mig 613). */
const fmtRendement = (ft: { nb_par_defaut: number; rendement_unite?: 'unit' | 'kg'; rendement_kg?: string | null }) => {
  const kg = ft.rendement_kg != null ? parseFloat(ft.rendement_kg) : NaN;
  return ft.rendement_unite === 'kg' && kg > 0
    ? `${kg.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg`
    : `×${ft.nb_par_defaut}`;
};

/** Champs editables hors lignes de composition — sert a la detection de modifications. */
interface EditableFields {
  rendement: string; parts: string; perte: string; compoParPiece: boolean;
  /** Mig 613 : rendement en pièces (rendement) ou en kilos (rendementKg). */
  rendementUnite: 'unit' | 'kg'; rendementKg: string;
  /** Mig 662 : règle de lot et bornes de fournées par ordre. */
  lotRule: 'partiel' | 'entier'; lotMin: string; lotMax: string;
}
/** Empreinte stable de l'etat editable (lignes + champs), comparee a la reference. */
function signature(rows: Row[], f: EditableFields): string {
  return JSON.stringify([rows.map((r) => [r.role, r.type, r.sourceId, r.quantite, r.unite, r.pertePct ?? '0']), f]);
}

function SourcePicker({ options, value, onPick }: {
  options: SourceOpt[]; value: SourceOpt | null; onPick: (o: SourceOpt) => void;
}) {
  const terms = useProdTerms();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = useMemo(() => {
    const list = q ? options.filter((o) => norm(o.name).includes(norm(q))) : options;
    return list.slice(0, 60);
  }, [q, options]);
  const recipes = filtered.filter((o) => o.type === 'recipe');
  const ingredients = filtered.filter((o) => o.type === 'ingredient');
  // Étape 10c : emballages (quantité par unité produite, mig 634).
  const packaging = filtered.filter((o) => o.type === 'packaging');
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-label="Choisir un composant" aria-haspopup="listbox" aria-expanded={open}
        className="ds-input sm fx-picker">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? 'var(--ds-ink)' : 'var(--ds-muted)' }}>{value ? value.name : 'Choisir un composant…'}</span>
        <ChevronDown size={14} aria-hidden="true" style={{ color: 'var(--ds-muted)', flex: 'none' }} />
      </button>
      {open && (
        <div className="fx-menu">
          <div className="fx-menu-search">
            <Search size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)' }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher un composant" />
          </div>
          {recipes.length > 0 && <div className="fx-menu-group">Recettes de base</div>}
          {recipes.map((o) => (
            <button key={`recipe:${o.id}`} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }}
              className="fx-menu-item">
              <span>{o.name}</span><span style={{ color: 'var(--ds-muted)', flex: 'none' }}>{o.unit}</span>
            </button>
          ))}
          {ingredients.length > 0 && <div className="fx-menu-group">{terms.ingredients}</div>}
          {ingredients.map((o) => (
            <button key={`ingredient:${o.id}`} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }}
              className="fx-menu-item">
              <span>{o.name}</span><span style={{ color: 'var(--ds-muted)', flex: 'none' }}>{o.unit}</span>
            </button>
          ))}
          {packaging.length > 0 && <div className="fx-menu-group">Emballages (par unité produite)</div>}
          {packaging.map((o) => (
            <button key={`packaging:${o.id}`} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }}
              className="fx-menu-item">
              <span>{o.name}</span><span style={{ color: 'var(--ds-muted)', flex: 'none' }}>{o.unit}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="fx-menu-group" style={{ padding: '12px' }}>Aucun résultat</div>}
        </div>
      )}
    </div>
  );
}

// --- Tree View : dépliage récursif (lecture seule) des sous-recettes imbriquées ---
function ChildRow({ child, depth }: { child: RecipeChild; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="fx-subrow" style={{ paddingLeft: `${depth * 22 + 60}px` }}>
        {child.expandable ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Replier' : 'Déplier'} className="fx-icon" style={{ width: 22, height: 22 }}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <CornerDownRight size={13} aria-hidden="true" style={{ color: 'var(--ds-muted)', flex: 'none' }} />
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.name}</span>
        <span style={{ color: 'var(--ds-muted)', fontVariantNumeric: 'tabular-nums', marginRight: 52, flex: 'none' }}>{parseFloat(child.quantite).toLocaleString('fr-FR')} {child.unite}</span>
      </div>
      {open && child.expandable && child.source_id && <SubTree recipeId={child.source_id} depth={depth + 1} />}
    </>
  );
}

function SubTree({ recipeId, depth }: { recipeId: string; depth: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['recipe-children', recipeId],
    queryFn: () => recipesApi.recipeChildren(recipeId),
    staleTime: 6e4,
  });
  if (isLoading) return <div className="fx-subrow" style={{ paddingLeft: `${depth * 22 + 60}px` }}>Chargement…</div>;
  if (!data || data.length === 0) return <div className="fx-subrow" style={{ paddingLeft: `${depth * 22 + 60}px` }}>Aucun sous-composant.</div>;
  return <div className="fx-subtree">{data.map((c, i) => <ChildRow key={`${c.type}:${c.source_id}:${i}`} child={c} depth={depth} />)}</div>;
}

/**
 * Données techniques du format actif, remontées à la page parente pour ses indicateurs.
 * 2026-11-24 : plus aucun coût ni prix — la fiche technique dit quoi et comment ; le coût
 * se calcule à part (Production › Coûts standard), comme dans les ERP du marché.
 */
export interface FormatKpi {
  /** Format affiché : la page imprime la fiche de ce format. */
  formatId: string;
  contenantNom: string | null;
  rendement: number;
  /** Mig 613 : unité du rendement (pièce ou kg). */
  unite: 'pièce' | 'kg';
  /** Poids brut des composants pesables, par pièce (ou par kg produit) ; null si non pesable. */
  poidsPieceG: number | null;
  /** Perte de fabrication (%), niveau recette. */
  pertePct: number;
}

export default function NomenclatureEditor({ recipeId, onSaved, onFinance, onCancel, readOnly = false, extra }: { recipeId: string; onSaved?: () => void; onFinance?: (k: FormatKpi | null) => void; onCancel?: () => void;
  /** Fiche d'un autre atelier (constat 106) : consultation et impression seulement. */
  readOnly?: boolean;
  /** Sections ajoutées par la page sous la composition (substituts), avant la barre d'enregistrement. */
  extra?: ReactNode }) {
  // M8-03 : terme du lot de fabrication selon le secteur (« fournée » en boulangerie).
  const PT = useProdTerms();
  const bLc = PT.batch.toLowerCase();
  const qc = useQueryClient();
  const confirm = useConfirm();
  // Cru / cuit : option « Contenants cru / cuit » (mig 507). Éteinte, la perte reste
  // saisissable (perte de fabrication) mais le poids cuit disparaît.
  const { hasFeature } = usePermissions();
  const extraUnits = useExtraUnits(UNITES);
  const cruCuit = hasFeature('contenants_cru_cuit');
  const [formatId, setFormatId] = useState<string | null>(null);
  // Id d'un format tout juste créé/dupliqué : protège sa sélection tant que la
  // liste des formats ne l'a pas encore intégré (sinon l'effet ci-dessous le voit
  // « absent » et rebascule sur le format par défaut → la sauvegarde repartirait
  // sur l'ancien cadre, qui se retrouverait écrasé).
  const justAddedRef = useRef<string | null>(null);
  /** Empreinte du dernier etat enregistre, pour detecter les modifications en cours. */
  const baselineRef = useRef<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [rendement, setRendement] = useState('');
  const [rendementUnite, setRendementUnite] = useState<'unit' | 'kg'>('unit');
  const [rendementKg, setRendementKg] = useState('');
  const [lotRule, setLotRule] = useState<'partiel' | 'entier'>('partiel');
  const [lotMin, setLotMin] = useState('');
  const [lotMax, setLotMax] = useState('');
  const [parts, setParts] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newContenant, setNewContenant] = useState('');
  const [dupCompo, setDupCompo] = useState(false);
  const [copySrc, setCopySrc] = useState('');
  const [perte, setPerte] = useState('');
  const [showParts, setShowParts] = useState(false);
  const [compoParPiece, setCompoParPiece] = useState(false);
  // Rendement auquel correspondent les quantités saisies (constat 113) : sert à proposer
  // la mise à l'échelle quand le rendement change.
  const [scaleBase, setScaleBase] = useState('');
  // Version du format chargée (constat 114) : envoyée à l'enregistrement, le serveur refuse
  // (409) si quelqu'un a modifié la composition entre-temps.
  const versionRef = useRef<string | null>(null);

  // Nature de la ligne (mig 634/636) : la base la déduit de la source (matière, semi-fini,
  // emballage) et remplace tout autre rôle saisi. Elle s'affiche donc sans être choisie.
  const natureOf = (t: Row['type']) =>
    t === 'recipe' ? PT.basePrep : t === 'packaging' ? 'Emballage' : t === 'ingredient' ? PT.ingredient : null;
  // Prix des matières : relus à chaque ouverture de la fiche. Avec un cache de 5 min, un prix
  // changé sur la fiche matière (ou par une réception, une correction de prix) restait l'ancien
  // dans le coût calculé ici tant que la page n'était pas rechargée.
  const { data: sources } = useQuery({ queryKey: ['component-sources'], queryFn: recipesApi.componentSources, staleTime: 3e5, refetchOnMount: 'always' });
  const { data: contenants = [] } = useQuery<Contenant[]>({
    queryKey: ['contenants-list'],
    queryFn: () => contenantsApi.list().then((r: { data?: Contenant[] } | Contenant[]) => ((r as { data?: Contenant[] }).data || r) as Contenant[]),
    staleTime: 3e5,
  });
  const { data: formats = [] } = useQuery<FormatSummary[]>({
    queryKey: ['recipe-formats', recipeId],
    queryFn: () => recipesApi.listFormats(recipeId),
    enabled: !!recipeId,
  });

  // Sélectionne le format par défaut au chargement (ou le premier).
  useEffect(() => {
    if (formats.length === 0) { setFormatId(null); return; }
    if (formats.some((f) => f.id === formatId)) { justAddedRef.current = null; return; }
    // formatId absent de la liste : ne JAMAIS rebasculer sur le défaut si c'est un
    // format qu'on vient de créer (la liste va le rafraîchir d'un instant à l'autre).
    if (formatId && formatId === justAddedRef.current) return;
    const def = formats.find((f) => f.is_default) ?? formats[0];
    setFormatId(def.id);
  }, [formats, formatId]);

  const { data, isLoading } = useQuery<FormatComponentsData>({
    queryKey: ['format-components', recipeId, formatId],
    queryFn: () => recipesApi.formatComponents(recipeId, formatId!),
    enabled: !!recipeId && !!formatId,
  });

  const sourceOpts = useMemo<SourceOpt[]>(() => {
    if (!sources) return [];
    return [
      ...sources.recipes.map((r) => ({ type: 'recipe' as const, id: r.id, name: r.name, unit: r.yield_unit, cost: parseFloat(r.cout_unitaire) || 0, yieldQty: parseFloat(r.yield_quantity) || 0 })),
      ...sources.ingredients.map((i) => ({ type: 'ingredient' as const, id: i.id, name: i.name, unit: i.unit, cost: parseFloat(i.unit_cost) || 0 })),
      ...(sources.packaging ?? []).map((pk) => ({ type: 'packaging' as const, id: pk.id, name: pk.name, unit: pk.unit ?? 'u', cost: parseFloat(pk.unit_cost) || 0 })),
    ];
  }, [sources]);
  // Étape 10c : fiche en mode pourcentage (lot de référence, mig 634) — saisie de la part de chaque ligne.
  const fmtRef = data?.format as (Record<string, unknown> | undefined);
  const pctMode = fmtRef?.reference_mode === 'pourcentage' && Number(fmtRef?.reference_batch_qty) > 0;
  const refQty = Number(fmtRef?.reference_batch_qty ?? 0);
  const refUnit = String(fmtRef?.reference_batch_unit ?? 'kg');
  const sourceMap = useMemo(() => {
    const m: Record<string, SourceOpt> = {};
    sourceOpts.forEach((o) => { m[`${o.type}:${o.id}`] = o; });
    return m;
  }, [sourceOpts]);
  // Applique (ou ré-applique) les données du format au state local. Réutilisé par
  // « Annuler » pour rétablir le dernier état enregistré (annule les modifs en cours).
  const applyData = useCallback(() => {
    if (!data) return;
    const f = data.format;
    versionRef.current = f.version ?? null;
    const nextRows: Row[] = data.components.map((c) => ({
      key: newKey(), role: c.role ?? '', type: c.source_type,
      sourceId: c.source_recipe_id ?? c.source_ingredient_id ?? c.source_packaging_id ?? '',
      quantite: parseFloat(c.quantite).toString(), unite: c.unite,
      // Mig 265 (audit A5) : perte % ligne, conservee dans l'etat pour ne pas
      // etre remise a 0 a la sauvegarde suivante. UI dediee en P2.
      pertePct: c.perte_pct != null ? String(parseFloat(String(c.perte_pct))) : '0',
      pct: c.pct != null ? String(parseFloat(String(c.pct))) : '',
    }));
    const nextFields: EditableFields = {
      rendement: f.nb_par_defaut != null ? String(f.nb_par_defaut) : '',
      parts: f.nb_parts != null ? String(f.nb_parts) : '',
      perte: f.perte_standard_pct != null && parseFloat(f.perte_standard_pct) > 0 ? parseFloat(f.perte_standard_pct).toString() : '',
      compoParPiece: f.compo_par_piece === true,
      rendementUnite: f.rendement_unite === 'kg' ? 'kg' : 'unit',
      rendementKg: f.rendement_kg != null ? parseFloat(f.rendement_kg).toString() : '',
      lotRule: f.lot_rule === 'entier' ? 'entier' : 'partiel',
      lotMin: f.lot_min != null ? parseFloat(f.lot_min).toString() : '',
      lotMax: f.lot_max != null ? parseFloat(f.lot_max).toString() : '',
    };
    setRows(nextRows);
    setShowParts((f.nb_parts ?? 1) > 1);
    setRendement(nextFields.rendement);
    setScaleBase(nextFields.rendement);
    setRendementUnite(nextFields.rendementUnite);
    setRendementKg(nextFields.rendementKg);
    setLotRule(nextFields.lotRule);
    setLotMin(nextFields.lotMin);
    setLotMax(nextFields.lotMax);
    setParts(nextFields.parts);
    setPerte(nextFields.perte);
    setCompoParPiece(nextFields.compoParPiece);
    // Reference pour la detection de modifications non enregistrees : on la calcule
    // depuis les valeurs qu'on vient de poser, pas depuis le state (encore non commit).
    baselineRef.current = signature(nextRows, nextFields);
  }, [data]);
  useEffect(() => { applyData(); }, [applyData]);

  const currentSig = signature(rows, { rendement, parts, perte, compoParPiece, rendementUnite, rendementKg, lotRule, lotMin, lotMax });
  const isDirty = !!data && baselineRef.current !== '' && currentSig !== baselineRef.current;

  // Filet de securite navigateur (fermeture d'onglet / rechargement). La navigation
  // interne est couverte par les gardes explicites sur « Annuler » et le changement
  // de format, ou l'on peut afficher un message utile.
  useEffect(() => {
    if (!isDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  // Bouton « Retour » du navigateur en pleine saisie (scénario 1, constat 120) : sans garde,
  // l'application changeait de page et la saisie disparaissait sans un mot. BrowserRouter
  // n'offre pas de bloqueur : tant que la saisie n'est pas enregistrée, on empile une entrée
  // d'historique sur la même adresse ; « Retour » y revient (la page reste montée) et l'on
  // demande confirmation avant de vraiment repartir.
  useEffect(() => {
    if (!isDirty) return;
    const url = window.location.href;
    window.history.pushState({ kalumUnsavedGuard: true }, '', url);
    const onPop = async () => {
      if (await confirm('Des modifications ne sont pas enregistrées.', { title: 'Quitter la fiche ?', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Rester', danger: true })) {
        window.removeEventListener('popstate', onPop);
        window.history.back();
      } else {
        window.history.pushState({ kalumUnsavedGuard: true }, '', url);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isDirty]);

  /** Changer de format recharge `rows` : sans garde, la saisie en cours disparaissait. */
  const switchFormat = async (id: string) => {
    if (id === formatId) return;
    if (isDirty && !(await confirm('Changer de format abandonnera les modifications non enregistrées sur ce format. Continuer ?',
      { title: 'Modifications non enregistrées', confirmLabel: 'Changer de format', danger: true }))) return;
    setFormatId(id);
  };

  /** Sans onCancel, « Annuler » rétablit le dernier état enregistré au lieu de quitter. */
  const handleCancel = async () => {
    if (isDirty && !(await confirm('Abandonner les modifications non enregistrées ?',
      { title: 'Abandonner les modifications', confirmLabel: 'Abandonner', danger: true }))) return;
    if (onCancel) onCancel(); else applyData();
  };

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (role = '') => setRows((rs) => [...rs, { key: newKey(), role, type: '', sourceId: '', quantite: '', unite: 'g' }]);
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const baseEquiv = (r: Row): { val: number; unit: string } | null => {
    const q = parseFloat(r.quantite); const u = r.unite.toLowerCase();
    if (!(q > 0)) return null;
    if (u in MASS) return { val: q * MASS[u], unit: 'g' };
    if (u in VOL) return { val: q * VOL[u], unit: 'ml' };
    return null;
  };
  const batchRatio = (r: Row): number | null => {
    const src = sourceMap[`${r.type}:${r.sourceId}`];
    const q = parseFloat(r.quantite);
    if (!src || src.type !== 'recipe' || !src.yieldQty || !(q > 0)) return null;
    return (q * conv(r.unite, src.unit)) / src.yieldQty;
  };
  const isAberrant = (r: Row): boolean => {
    if (!compoParPiece) return false;
    const pp = batchRatio(r);
    return pp != null && pp >= 1;
  };
  const aberrantCount = rows.filter(isAberrant).length;

  // Detection d'une conversion d'unite fautive au niveau ligne (miroir de la
  // fonction SQL fn_unit_conv_ok, mig 260). Sert a alerter en direct sans
  // attendre la sauvegarde ; la vue serveur reste la source de verite au repos.
  //   - meme unite ou meme famille (g/kg/mg, ml/cl/dl/l) : toujours OK
  //   - poids↔volume : OK uniquement pour un ingredient avec densite renseignee
  //   - tout autre couple (`unit` face a `kg`, etc.) : fallback silencieux → KO
  const family = (u: string): 'mass' | 'vol' | 'other' => {
    const l = (u || '').toLowerCase();
    if (l === 'g' || l === 'kg' || l === 'mg') return 'mass';
    if (l === 'ml' || l === 'cl' || l === 'dl' || l === 'l') return 'vol';
    return 'other';
  };
  const isBadConversion = (r: Row): boolean => {
    const src = r.type && r.sourceId ? sourceMap[`${r.type}:${r.sourceId}`] : null;
    if (!src) return false;
    const from = (r.unite || '').toLowerCase();
    const to = (src.unit || '').toLowerCase();
    if (from === to) return false;
    const fFam = family(from), tFam = family(to);
    if (fFam === 'other' || tFam === 'other') return true;   // ex. 'unit' ↔ 'kg'
    if (fFam === tFam) return false;                          // meme famille
    // Croisement poids↔volume : validé si l'ingredient a une densite
    if (src.type === 'ingredient') {
      const raw = (sources?.ingredients.find((i) => i.id === src.id)?.densite_kg_l) ?? null;
      const dens = raw != null && raw !== '' ? parseFloat(raw) : NaN;
      return !Number.isFinite(dens) || dens <= 0;
    }
    // Sous-recette : pas de densite modelisee → toujours suspect en poids↔volume
    return true;
  };
  const badConversionCount = rows.filter(isBadConversion).length;

  // Saisie contrôlée (scénario 1, constat 107).
  //  - une ligne qui désigne un composant doit avoir une quantité > 0 : elle n'est plus
  //    écartée en silence à l'enregistrement, l'enregistrement est refusé ;
  //  - un même composant sur plusieurs lignes est signalé (pas additionné : un ajout en
  //    deux temps, farine du levain puis de la pâte, peut être voulu).
  // Mise à l'échelle (scénario 1, constat 113) : le rendement passe de N à M pièces, les
  // quantités restent celles d'une fournée de N tant qu'on ne choisit pas.
  const scaleFrom = parseInt(scaleBase) || 0;
  const scaleTo = parseInt(rendement) || 0;
  const scaleRatio = scaleFrom > 0 && scaleTo > 0 ? scaleTo / scaleFrom : 1;
  const askScale = !compoParPiece && rendementUnite !== 'kg' && scaleRatio !== 1
    && rows.some((r) => r.sourceId && parseFloat(r.quantite) > 0);
  const applyScale = () => {
    setRows((rs) => rs.map((r) => {
      const q = parseFloat(r.quantite);
      return r.sourceId && q > 0 ? { ...r, quantite: String(Number((q * scaleRatio).toFixed(3))) } : r;
    }));
    setScaleBase(rendement);
  };

  const isBadQty = (r: Row): boolean => !!(r.type && r.sourceId) && !(parseFloat(r.quantite) > 0);
  const badQtyRows = rows.filter(isBadQty);
  const lineName = (r: Row) => sourceMap[`${r.type}:${r.sourceId}`]?.name ?? 'composant';
  const dupCounts: Record<string, number> = {};
  rows.forEach((r) => { if (r.type && r.sourceId) dupCounts[`${r.type}:${r.sourceId}`] = (dupCounts[`${r.type}:${r.sourceId}`] ?? 0) + 1; });
  const dupKeys = Object.keys(dupCounts).filter((k) => dupCounts[k] > 1);
  const isDup = (r: Row): boolean => !!(r.type && r.sourceId) && dupCounts[`${r.type}:${r.sourceId}`] > 1;

  // Mig 613 : en kg, le rendement est décimal (peut être < 1) et tous les montants
  // « par pièce » ci-dessous deviennent des montants au kilo. Une composition saisie
  // par pièce reste par pièce.
  const enKg = rendementUnite === 'kg' && !compoParPiece;
  const rendementKgNum = np(rendementKg.replace(',', '.'));
  const rendementNum = enKg
    ? (rendementKgNum != null && rendementKgNum > 0 ? rendementKgNum : 1)
    : Math.max(1, parseInt(rendement) || 1);
  const uniteTxt: 'pièce' | 'kg' = enKg ? 'kg' : 'pièce';
  // Quantité vue sur l'autre base : saisie par pièce → pour toute la fournée (× rendement) ;
  // saisie par fournée → pour une pièce (÷ rendement). Sans objet pour un rendement en kg.
  const showOther = !enKg && rendementNum > 0;
  const cols = showOther ? COLS : COLS_SANS_CONVERSION;
  const otherLabel = compoParPiece ? `${PT.batch} ×${rendementNum}` : 'Par pièce';
  const otherQty = (q: string) => {
    const v = parseFloat(q.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return null;
    return compoParPiece ? v * rendementNum : v / rendementNum;
  };
  const partsNum = Math.max(1, parseInt(parts) || 1);
  const poidsBrutG = rows.reduce((s, r) => { const eq = baseEquiv(r); return s + (eq ? eq.val : 0); }, 0);
  const perteNum = Math.min(99.99, Math.max(0, np(perte) ?? 0));
  const poidsCuitG = poidsBrutG * (1 - perteNum / 100);
  // Sépare valeur et unité pour aligner la colonne unité dans la carte rendement.
  const splitW = (g: number): [string, string] => {
    if (g <= 0) return ['—', ''];
    if (g < 1000) return [String(Math.round(g)), 'g'];
    const d = g >= 10000 ? 1 : 2;
    return [(g / 1000).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }), 'kg'];
  };

  // Remonte les données techniques du format actif au parent (indicateurs de la fiche).
  const poidsPieceG = poidsBrutG > 0 ? (compoParPiece ? poidsBrutG : poidsBrutG / rendementNum) : null;
  const onFinanceRef = useRef(onFinance);
  onFinanceRef.current = onFinance;
  useEffect(() => {
    if (!data?.format) return;
    onFinanceRef.current?.({
      formatId: data.format.id,
      contenantNom: data.format.contenant_nom,
      rendement: rendementNum, unite: uniteTxt, poidsPieceG, pertePct: perteNum,
    });
  }, [data?.format, rendementNum, uniteTxt, poidsPieceG, perteNum]);
  useEffect(() => () => onFinanceRef.current?.(null), []);

  // Copie la composition d'un AUTRE format dans le format courant (non sauvegardé :
  // l'utilisateur ajuste puis Enregistre). Réutilise l'endpoint de lecture par format.
  const copyFromFormat = async () => {
    if (!copySrc) return;
    try {
      const src = await recipesApi.formatComponents(recipeId, copySrc);
      setRows(src.components.map((c) => ({
        key: newKey(), role: c.role ?? '', type: c.source_type,
        sourceId: c.source_recipe_id ?? c.source_ingredient_id ?? '',
        quantite: parseFloat(c.quantite).toString(), unite: c.unite,
        pertePct: c.perte_pct != null ? String(parseFloat(String(c.perte_pct))) : '0',
      })));
      setCopySrc('');
      notify.success('Composition copiée — ajuste les quantités puis Enregistrer');
    } catch (e) {
      notify.error(extractErr(e));
    }
  };

  // Réordonnancement par glisser-déposer (ordre manuel = ordre sauvegardé).
  const onDropRow = (targetKey: string) => {
    setRows((rs) => {
      if (!dragKey || dragKey === targetKey) return rs;
      const from = rs.findIndex((r) => r.key === dragKey);
      const to = rs.findIndex((r) => r.key === targetKey);
      if (from < 0 || to < 0) return rs;
      const copy = [...rs]; const [m] = copy.splice(from, 1); copy.splice(to, 0, m); return copy;
    });
    setDragKey(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!formatId) throw new Error('Aucun format sélectionné');
      if (enKg && !(rendementKgNum != null && rendementKgNum > 0)) {
        throw new Error('Saisis le rendement en kg de la fournée.');
      }
      if (badQtyRows.length) {
        throw new Error(`Quantité nulle, négative ou manquante : ${[...new Set(badQtyRows.map(lineName))].join(', ')}. Saisis une quantité supérieure à 0 ou supprime la ligne.`);
      }
      const filled = rows.filter((r) => r.type && r.sourceId);
      if (!filled.length) throw new Error(`Composition vide : ajoute au moins une ligne (${PT.ingredientLc} ou préparation de base) avant d'enregistrer.`);
      const components = filled.map((r, i) => {
        // Mig 265 (audit A5) : envoie la perte % ligne pour majorer matiere et besoins.
        const perte = r.pertePct != null && r.pertePct !== '' ? parseFloat(r.pertePct.replace(',', '.')) : 0;
        return {
          // Rôle laissé à la base, qui le déduit de la source : renvoyer l'ancien rôle d'une ligne
          // dont on a changé la source (semi-fini → matière) faisait échouer l'enregistrement.
          role: null,
          sourceRecipeId: r.type === 'recipe' ? r.sourceId : null,
          sourceIngredientId: r.type === 'ingredient' ? r.sourceId : null,
          sourcePackagingId: r.type === 'packaging' ? r.sourceId : null,
          // Étape 10c : en mode pourcentage, la quantité est recalculée au serveur depuis la part.
          pct: pctMode && r.type !== 'packaging' && r.pct && parseFloat(r.pct.replace(',', '.')) > 0 ? parseFloat(r.pct.replace(',', '.')) : null,
          quantite: parseFloat(r.quantite), unite: r.unite, ordre: i,
          pertePct: Number.isFinite(perte) && perte > 0 ? perte : 0,
        };
      });
      const saved = await recipesApi.saveFormatComponents(recipeId, formatId, {
        expectedVersion: versionRef.current,
        components,
        // En kg, le nombre de pièces est conservé tel quel (planification) : null = inchangé.
        nbParDefaut: enKg ? null : (parseInt(rendement) || null),
        nbParts: parseInt(parts) || null,
        rendementUnite: enKg ? 'kg' : 'unit',
        rendementKg: enKg ? rendementKgNum : null,
        // Mig 662 : règle de lot ; un champ vidé retire la borne.
        lotRule,
        lotMin: np(lotMin.replace(',', '.')),
        lotMax: np(lotMax.replace(',', '.')),
        // Perte à la cuisson : donnée technique, enregistrée avec la composition (droit
        // des chefs) — constat 38 du scénario 1.
        perteStandardPct: np(perte) ?? 0,
      });
      versionRef.current = saved?.format?.version ?? versionRef.current;
    },
    onSuccess: () => {
      notify.success('Composition enregistrée');
      qc.invalidateQueries({ queryKey: ['format-components', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe-formats', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe-children'] });
      onSaved?.();
    },
    onError: (err) => notify.error(extractErr(err)),
  });

  const addFormatMut = useMutation({
    mutationFn: async () => {
      if (dupCompo && formatId) {
        return recipesApi.duplicateFormat(recipeId, formatId, { contenantId: newContenant });
      }
      const c = contenants.find((x) => x.id === newContenant);
      const qte = c?.quantite_theorique != null ? Math.round(parseFloat(String(c.quantite_theorique))) : 1;
      return recipesApi.createFormat(recipeId, { contenantId: newContenant, nbParDefaut: qte > 0 ? qte : 1 });
    },
    onSuccess: async (res) => {
      const wasDup = dupCompo;
      setAdding(false); setNewContenant(''); setDupCompo(false);
      // Attendre le rafraîchissement de la liste AVANT de sélectionner le nouveau format,
      // sinon l'effet de sélection le voit absent et rebascule sur le format par défaut
      // (→ les sauvegardes repartaient à tort sur l'ancien cadre).
      if (res?.format?.id) { justAddedRef.current = res.format.id; setFormatId(res.format.id); }
      await qc.invalidateQueries({ queryKey: ['recipe-formats', recipeId] });
      notify.success(wasDup ? 'Format dupliqué' : 'Format ajouté');
    },
    onError: (err) => notify.error(extractErr(err)),
  });

  // Suppression d'un format (cadre de production) et de sa composition. L'endpoint
  // existe déjà (mig formats) ; on resélectionne un format restant pour ne pas
  // laisser l'écran sur un cadre fantôme.
  const deleteFormatMut = useMutation({
    mutationFn: () => recipesApi.deleteFormat(recipeId, formatId!),
    onSuccess: async () => {
      const remaining = formats.filter((x) => x.id !== formatId);
      justAddedRef.current = null;
      setFormatId(remaining.find((x) => x.is_default)?.id ?? remaining[0]?.id ?? null);
      await qc.invalidateQueries({ queryKey: ['recipe-formats', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipes'] });
      notify.success('Format supprimé');
    },
    onError: (err) => notify.error(extractErr(err)),
  });
  const handleDeleteFormat = async () => {
    if (!formatId || !f) return;
    if (!(await confirm(`Supprimer le format « ${f.contenant_nom} » et toute sa composition ? Cette action est irréversible.`,
      { title: 'Supprimer le format', confirmLabel: 'Supprimer', danger: true }))) return;
    deleteFormatMut.mutate();
  };

  const renderRow = (r: Row) => {
    const src = r.type && r.sourceId ? sourceMap[`${r.type}:${r.sourceId}`] : null;
    const eq = baseEquiv(r);
    const pp = compoParPiece ? batchRatio(r) : null;
    const aberrant = isAberrant(r);
    const badConv = isBadConversion(r);
    const badQty = isBadQty(r);
    const dup = isDup(r);
    const canExpand = r.type === 'recipe' && !!r.sourceId;
    const isOpen = !!expanded[r.key];
    // L'équivalent n'est affiché que s'il apporte une info (1050 g → 1.05 kg) :
    // « ≈ 80 g » sous une saisie de 80 g n'était que du bruit.
    const eqBig = !!eq && eq.val >= 1000;
    const eqUnit = eq ? (eqBig ? (eq.unit === 'g' ? 'kg' : 'l') : eq.unit) : '';
    const eqLabel = eq && eqUnit !== r.unite.toLowerCase()
      ? `${eqBig ? (eq.val / 1000).toFixed(2) : Math.round(eq.val)} ${eqUnit}` : null;
    return (
      <div key={r.key} onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(r.key)}>
        <div className={`fx-row${dragKey === r.key ? ' drag' : ''}`} style={{ gridTemplateColumns: cols }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingTop: 6 }}>
            <span draggable onDragStart={() => setDragKey(r.key)} onDragEnd={() => setDragKey(null)}
              className="fx-grip" title="Glisser pour réordonner">
              <GripVertical size={14} aria-hidden="true" />
            </span>
            {canExpand ? (
              <button type="button" onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))}
                className="fx-icon" style={{ width: 22, height: 22 }} aria-expanded={isOpen} aria-label="Déplier la préparation">
                {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
              </button>
            ) : <span style={{ width: 22 }} />}
          </div>
          <span title="Nature déduite du composant choisi"
            style={{ fontSize: 13, paddingTop: 9, color: natureOf(r.type) ? 'var(--ds-ink-2, var(--ds-ink))' : 'var(--ds-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {natureOf(r.type) ?? '—'}
          </span>
          <div style={{ minWidth: 0 }}>
            <SourcePicker options={sourceOpts} value={src ?? null}
              onPick={(o) => setRow(r.key, { type: o.type, sourceId: o.id, unite: o.unit === 'unit' ? r.unite : o.unit })} />
            {dup && <div className="fx-note warn"><AlertTriangle size={10} aria-hidden="true" /> Saisi sur plusieurs lignes</div>}
            {badConv && (
              <div className="fx-note warn">
                <AlertTriangle size={10} aria-hidden="true" /> {src ? `Conversion ${r.unite} → ${src.unit} non fiable` : "Conversion d'unité non fiable"}
              </div>
            )}
          </div>
          <div>
            <input type="number" step="any" min="0"
              aria-label={compoParPiece ? 'Quantité par pièce' : `Quantité par ${bLc}`}
              aria-invalid={aberrant || badQty || undefined}
              className="ds-input sm" style={{ textAlign: 'right', ...(aberrant || badQty ? { background: 'var(--ds-danger-bg)', color: 'var(--ds-danger)' } : {}) }}
              value={r.quantite} onChange={(e) => setRow(r.key, { quantite: e.target.value })} placeholder="0" />
            {pctMode && r.type !== 'packaging' && (
              <input type="number" step="any" min="0" max="100" aria-label="Part du lot de référence (%)" title={`Part du lot de référence (${refQty} ${refUnit})`}
                className="ds-input sm" style={{ textAlign: 'right', marginTop: 2 }} placeholder="%"
                value={r.pct ?? ''} onChange={(e) => {
                  const v = e.target.value; const n = parseFloat(v.replace(',', '.'));
                  setRow(r.key, { pct: v, ...(Number.isFinite(n) && n > 0 && refQty > 0 ? { quantite: String(Math.round(n / 100 * refQty * 10000) / 10000), unite: refUnit } : {}) });
                }} />
            )}
            {pp != null ? (
              <div className={`fx-note${pp >= 1 ? ' bad' : ''}`} style={{ textAlign: 'right' }} title="Fournées de la recette de base consommées par pièce">
                {pp >= 1 && <AlertTriangle size={10} aria-hidden="true" />}{' '}
                {pp >= 1 ? `${pp.toFixed(pp >= 10 ? 0 : 1)} ${bLc}/pièce` : `≈ ${Math.round(pp * 100)} % ${bLc}/pièce`}
              </div>
            ) : eqLabel ? (
              <div className="fx-note" style={{ textAlign: 'right' }}>≈ {eqLabel}</div>
            ) : null}
          </div>
          <select className="ds-input sm" value={r.unite} onChange={(e) => setRow(r.key, { unite: e.target.value })} aria-label="Unité de la quantité">
            {UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
            {extraUnits.map((u) => <option key={u.code} value={u.code} title={u.label}>{u.code}</option>)}
            {![...UNITES, ...extraUnits.map(u => u.code)].includes(r.unite) && <option value={r.unite}>{r.unite}</option>}
          </select>
          {showOther && (() => {
            const o = otherQty(r.quantite);
            return (
              <div className="fx-ro" style={{ justifyContent: 'flex-end', color: o == null ? 'var(--ds-muted)' : undefined }}
                title={compoParPiece ? `Quantité pour toute la ${bLc} : quantité par pièce × ${rendementNum}` : `Quantité pour une pièce : quantité par ${bLc} ÷ ${rendementNum}`}>
                {o == null ? '—' : <span>{fmtQty(o)} <span style={{ color: 'var(--ds-muted)' }}>{r.unite}</span></span>}
              </div>
            );
          })()}
          <input type="number" step="any" min="0" max="99"
            aria-label="Perte de la ligne en pourcentage"
            title="Perte sur cette ligne (%) : majore la matière consommée (mig 265)"
            className="ds-input sm" style={{ textAlign: 'right' }}
            value={r.pertePct ?? ''} onChange={(e) => setRow(r.key, { pertePct: e.target.value })} placeholder="0" />
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button type="button" onClick={() => delRow(r.key)} className="fx-icon danger" aria-label={`Retirer ${src?.name ?? 'la ligne'}`}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </div>
        {isOpen && canExpand && <SubTree recipeId={r.sourceId} depth={1} />}
      </div>
    );
  };

  const f = data?.format;
  const usedContenantIds = new Set(formats.map((x) => x.contenant_id));
  const availContenants = contenants.filter((c) => !usedContenantIds.has(c.id));
  const otherFormats = formats.filter((ft) => ft.id !== formatId);

  return (
    <div className="fx">
      {/* ======================= FORMAT ======================= */}
      <div className="fx-block">
        <div className="fx-head">
          <h3 className="fx-sub"><Box size={14} aria-hidden="true" /> Format</h3>
          {!adding && f && (
            <button type="button" onClick={handleDeleteFormat} disabled={deleteFormatMut.isPending} className="fx-link danger"
              title="Supprimer ce format et toute sa composition">
              <Trash2 size={13} aria-hidden="true" /> {deleteFormatMut.isPending ? 'Suppression…' : 'Supprimer ce format'}
            </button>
          )}
        </div>

        {/* Formats : chaque contenant = un cadre de cuisson distinct, avec sa propre composition. */}
        <div className="prj-chips" role="group" aria-label="Formats de la fiche">
          {formats.map((ft) => {
            const bad = (ft.bad_conversions_count ?? 0) > 0;
            const on = ft.id === formatId;
            return (
              <button key={ft.id} type="button" onClick={() => switchFormat(ft.id)} aria-pressed={on}
                title={bad ? `${ft.bad_conversions_count} composant(s) avec conversion d'unité douteuse — quantités à vérifier` : undefined}
                className={`prj-chip${on ? ' active' : ''}`}>
                {ft.contenant_nom || 'Format'} <small>{fmtRendement(ft)}{ft.is_default ? ' · défaut' : ''}</small>
                {bad && <AlertTriangle size={12} aria-hidden="true" style={{ color: 'var(--ds-warning)' }} />}
              </button>
            );
          })}
          {adding ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select value={newContenant} onChange={(e) => setNewContenant(e.target.value)} aria-label="Contenant du nouveau format"
                className="ds-input sm" style={{ width: 'auto' }}>
                <option value="">— contenant —</option>
                {availContenants.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
              {formats.length > 0 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Copier la composition du format affiché">
                  <input type="checkbox" checked={dupCompo} onChange={(e) => setDupCompo(e.target.checked)} /> copier la composition
                </label>
              )}
              <button type="button" disabled={!newContenant || addFormatMut.isPending} onClick={() => addFormatMut.mutate()}
                className="odoo-btn-primary ds-btn-sm">{dupCompo ? 'Dupliquer' : 'Créer'}</button>
              <button type="button" onClick={() => { setAdding(false); setNewContenant(''); setDupCompo(false); }} className="odoo-btn-secondary ds-btn-sm">Annuler</button>
            </span>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="prj-chip fx-chip-add">
              <Plus size={13} aria-hidden="true" /> Ajouter un format
            </button>
          )}
        </div>

        {formats.length === 0 ? (
          <span style={{ fontSize: 14, color: 'var(--ds-muted)' }}>Aucun format. Ajoutez un contenant pour composer cette recette.</span>
        ) : isLoading || !f ? (
          <LoadingState bare />
        ) : (() => {
          const [bv, bu] = splitW(poidsBrutG);
          const [cv, cu] = splitW(poidsCuitG);
          const perUnit = compoParPiece ? '/ pièce' : `/ ${bLc}`;
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div className="fx-photo" title={f.product_image ? f.recipe_name : 'Photo via la fiche produit'}>
                {f.product_image
                  ? <img src={f.product_image} alt={f.recipe_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <Camera size={18} aria-hidden="true" />}
              </div>
              <div className="fx-params" style={{ flex: 1, minWidth: 0 }}>
                <div className="fx-field">
                  <label htmlFor="fmt-rendement">Rendement</label>
                  {/* Mig 613 : rendement en pièces OU en kilos (article vendu au poids,
                      préparation de base). Une composition saisie par pièce reste en pièces. */}
                  <span className="fx-in">
                    {enKg ? (
                      <input id="fmt-rendement" type="number" min="0.001" step="any" value={rendementKg}
                        onChange={(e) => setRendementKg(e.target.value)} placeholder="2,5" />
                    ) : (
                      <input id="fmt-rendement" type="number" min="1" value={rendement} onChange={(e) => setRendement(e.target.value)} placeholder="50" />
                    )}
                    {compoParPiece ? (
                      <span className="fx-unit">pièces</span>
                    ) : (
                      <select aria-label="Unité du rendement" value={rendementUnite}
                        onChange={(e) => setRendementUnite(e.target.value === 'kg' ? 'kg' : 'unit')}
                        title="Rendement d'une fournée : en pièces, ou en kilos pour un article vendu au poids">
                        <option value="unit">pièces / {bLc}</option>
                        <option value="kg">kg / {bLc}</option>
                      </select>
                    )}
                  </span>
                </div>
                {/* Mig 662 : un cadre, une plaque ou une cuve ne se lance pas en fraction.
                    « Entières » arrondit toute quantité planifiée à la fournée supérieure
                    (130 pièces pour 48 par fournée → 3 fournées, 144 prévues, 14 d'excédent). */}
                <div className="fx-field">
                  <label htmlFor="fmt-lot-rule">{bLc.charAt(0).toUpperCase()}{bLc.slice(1)}s</label>
                  <span className="fx-in">
                    <select id="fmt-lot-rule" value={lotRule} onChange={(e) => setLotRule(e.target.value === 'entier' ? 'entier' : 'partiel')}
                      title={`${bLc.charAt(0).toUpperCase()}${bLc.slice(1)}s entières : la quantité d'un ordre est arrondie à la ${bLc} supérieure, l'excédent est annoncé.\nPartielle autorisée : la quantité demandée est fabriquée telle quelle.`}>
                      <option value="partiel">Partielles</option>
                      <option value="entier">Entières</option>
                    </select>
                  </span>
                </div>
                <div className="fx-field">
                  <span className="fx-label">Nombre par ordre</span>
                  <span className="fx-in">
                    <input aria-label={`Nombre minimal de ${bLc}s par ordre`} type="number" min="0" step="any" value={lotMin}
                      onChange={(e) => setLotMin(e.target.value)} placeholder="mini" style={{ minWidth: 0 }} />
                    <span className="fx-unit">à</span>
                    <input aria-label={`Nombre maximal de ${bLc}s par ordre`} type="number" min="0" step="any" value={lotMax}
                      onChange={(e) => setLotMax(e.target.value)} placeholder="maxi" style={{ minWidth: 0 }} />
                  </span>
                </div>
                <div className="fx-field">
                  <label htmlFor="fmt-perte">{cruCuit ? 'Perte à la cuisson' : 'Perte de fabrication'}</label>
                  <span className="fx-in">
                    <input id="fmt-perte" type="number" min="0" max="99" step="any" value={perte} onChange={(e) => setPerte(e.target.value)} placeholder="0" />
                    <span className="fx-unit">%</span>
                  </span>
                </div>
                <div className="fx-field">
                  <span className="fx-label">Poids brut</span>
                  <div className="fx-ro"><span>{bv}</span><span className="fx-unit">{bu} {perUnit}</span></div>
                </div>
                {cruCuit && (
                  <div className="fx-field">
                    <span className="fx-label">Poids cuit</span>
                    <div className="fx-ro"><span>{cv}</span><span className="fx-unit">{cu} {perUnit}</span></div>
                  </div>
                )}
                {(partsNum > 1 || showParts) ? (
                  <div className="fx-field">
                    <label htmlFor="fmt-parts">Parts par pièce</label>
                    <span className="fx-in">
                      <input id="fmt-parts" type="number" min="1" value={parts} onChange={(e) => setParts(e.target.value)} placeholder="1" />
                      <span className="fx-unit">parts</span>
                    </span>
                  </div>
                ) : (
                  <div className="fx-field">
                    <span className="fx-label">Portions</span>
                    <button type="button" onClick={() => setShowParts(true)} className="fx-dash"
                      title="Pour un produit coupé en portions (entremets, tarte…)">+ Vendu à la part</button>
                  </div>
                )}
                {/* Mode de saisie en lecture seule : décidé à la création (corrigeable par
                    « Modifier » dans Informations), plus modifié pendant la composition. */}
                <div className="fx-field">
                  <span className="fx-label">
                    Quantités saisies
                    <span title={'Par fournée : quantités pour tout le lot (cadre/plaque découpé), à diviser par le rendement.\nPar pièce : quantités pour une seule unité (entremets individuel…).\n\nCe mode se choisit à la création de la fiche ; pour le corriger, modifiez l’identité de la fiche.'}
                      style={{ display: 'inline-flex', cursor: 'help', color: 'var(--ds-muted)' }}>
                      <HelpCircle size={12} aria-hidden="true" />
                    </span>
                  </span>
                  <div className="fx-ro"><span>{compoParPiece ? 'Par pièce' : `Par ${bLc}`}</span></div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Sections suivantes : uniquement si un format est chargé */}
      {formats.length > 0 && !isLoading && f && (
        <>
          {/* ===================== COMPOSANTS ===================== */}
          <div className="fx-block">
            <div className="fx-head">
              <h3 className="fx-sub"><Layers size={14} aria-hidden="true" /> Composants <small>quantités {compoParPiece ? 'pour une pièce' : `pour une ${bLc}`}</small></h3>
              {otherFormats.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <label htmlFor="copy-from" style={{ fontSize: 13, color: 'var(--ds-muted)', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <Copy size={13} aria-hidden="true" /> Copier depuis
                  </label>
                  <select id="copy-from" value={copySrc} onChange={(e) => setCopySrc(e.target.value)} className="ds-input sm" style={{ width: 'auto', minWidth: 180 }}>
                    <option value="">Choisir un format…</option>
                    {otherFormats.map((ft) => <option key={ft.id} value={ft.id}>{ft.contenant_nom || 'Format'} {fmtRendement(ft)}</option>)}
                  </select>
                  <button type="button" disabled={!copySrc} onClick={copyFromFormat} className="odoo-btn-secondary ds-btn-sm">Copier</button>
                </span>
              )}
            </div>

            {aberrantCount > 0 && (
              <Alert tone="danger" icon={AlertTriangle}>
                <strong>{aberrantCount} ligne{aberrantCount > 1 ? 's' : ''} à corriger</strong> — dosage par pièce improbable (≥ 1 {bLc}). Saisissez la quantité réelle par pièce.
              </Alert>
            )}
            {badConversionCount > 0 && (
              <Alert tone="warning" icon={AlertTriangle}>
                <strong>{badConversionCount} conversion{badConversionCount > 1 ? 's' : ''} d'unité douteuse{badConversionCount > 1 ? 's' : ''}</strong>
                {' — '}les besoins en matière sont peut-être faux. Choisissez une unité de la même famille que la source (g/kg/mg entre elles, ml/cl/dl/l entre elles), ou renseignez la densité sur la fiche {PT.ingredientLc} pour un croisement poids ↔ volume.
              </Alert>
            )}
            {askScale && (
              <Alert tone="info" icon={AlertTriangle} action={<span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="odoo-btn-primary ds-btn-sm" onClick={applyScale}>Mettre à l'échelle</button>
                <button type="button" className="odoo-btn-secondary ds-btn-sm" onClick={() => setScaleBase(rendement)}>Garder les quantités</button>
              </span>}>
                <strong>Rendement passé de {scaleFrom} à {scaleTo} pièces</strong> — les quantités sont encore celles d'une {bLc} de {scaleFrom}. Mettre toute la composition à l'échelle (×{scaleRatio.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}) ou garder les quantités ?
              </Alert>
            )}
            {badQtyRows.length > 0 && (
              <Alert tone="danger" icon={AlertTriangle}>
                <strong>{badQtyRows.length} ligne{badQtyRows.length > 1 ? 's' : ''} sans quantité valide</strong> ({[...new Set(badQtyRows.map(lineName))].join(', ')}) — saisissez une quantité supérieure à 0 ou supprimez la ligne ; l'enregistrement est bloqué en attendant.
              </Alert>
            )}
            {dupKeys.length > 0 && (
              <Alert tone="warning" icon={AlertTriangle}>
                <strong>{dupKeys.map((k) => `${sourceMap[k]?.name ?? 'composant'} (${dupCounts[k]} lignes)`).join(', ')}</strong>
                {' — '}saisi plusieurs fois. Les lignes s'ajoutent dans les besoins ; regroupez-les en une seule, sauf si c'est voulu (ajout en deux temps).
              </Alert>
            )}

            {/* Défilement horizontal sur écran étroit : les colonnes fixes gardent la grille lisible. */}
            <div className="fx-grid">
              <div className="fx-row fx-th" style={{ gridTemplateColumns: cols }}>
                <span /><span>Nature</span><span>Composant</span>
                <span style={{ textAlign: 'right' }}>{compoParPiece ? 'Quantité / pièce' : `Quantité / ${bLc}`}</span><span>Unité</span>
                {showOther && <span style={{ textAlign: 'right' }} title="Calculé depuis la quantité saisie et le rendement du format">{otherLabel}</span>}
                <span style={{ textAlign: 'right' }} title="Perte sur la ligne : majore la matière consommée">Perte (%)</span>
                <span />
              </div>
              {rows.map(renderRow)}
              {rows.length === 0 && (
                <div style={{ padding: '28px 12px', textAlign: 'center', fontSize: 14, color: 'var(--ds-muted)' }}>Aucun composant pour ce format.</div>
              )}
              {rows.length > 0 && (() => {
                const [tv, tu] = splitW(poidsBrutG);
                const [ov, ou] = splitW(compoParPiece ? poidsBrutG * rendementNum : poidsBrutG / rendementNum);
                return (
                  <div className="fx-row fx-total" style={{ gridTemplateColumns: cols }}>
                    <span /><span />
                    <span>Total {compoParPiece ? 'par pièce' : `par ${bLc}`}</span>
                    <span style={{ textAlign: 'right' }}>{tv}</span><span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>{tu}</span>
                    {showOther && <span style={{ textAlign: 'right', paddingRight: 10 }}>{ov} <span style={{ fontWeight: 400, color: 'var(--ds-muted)' }}>{ou}</span></span>}
                    <span /><span />
                  </div>
                );
              })()}
            </div>
            <button type="button" onClick={() => addRow('')} className="fx-link" style={{ alignSelf: 'flex-start' }}>
              <Plus size={15} aria-hidden="true" /> Ajouter un composant
            </button>
          </div>

          {/* ===================== VENTE AU POINT DE VENTE ===================== */}
          {/* Mig 263 : produit vendu pour ce format (sans prix : la fiche ne porte ni coût ni prix). */}
          {data?.format && (
            <div className="fx-block">
              <h3 className="fx-sub"><Tag size={14} aria-hidden="true" /> Vente au point de vente</h3>
              <PosLinkPanel recipeId={recipeId} formatId={data.format.id} format={data.format} />
            </div>
          )}

          {extra}

          {/* Barre d'enregistrement collée en bas de l'onglet Composition. */}
          <div className="fx-savebar">
            <span style={{ flex: '1 1 280px', fontSize: 13, color: 'var(--ds-muted)' }}>
              Format <strong style={{ color: 'var(--ds-ink)' }}>{f.contenant_nom}</strong> · quantités saisies <strong style={{ color: 'var(--ds-ink)' }}>{compoParPiece ? 'par pièce' : `par ${bLc}`}</strong>
              {!compoParPiece && <> pour {enKg ? `${rendementNum.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg` : `${rendementNum} ${uniteTxt}${rendementNum > 1 ? 's' : ''}`}</>}.
            </span>
            {isDirty && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ds-warning)' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ds-warning)' }} />
                Modifications non enregistrées
              </span>
            )}
            <button type="button" onClick={handleCancel} disabled={saveMut.isPending} className="odoo-btn-secondary"
              title="Annuler les modifications en cours">
              <X size={14} aria-hidden="true" /> Annuler
            </button>
            {readOnly ? (
              <StatusTag tone="draft" label="Lecture seule" title="Fiche d'un autre atelier : vous ne pouvez pas l'enregistrer" />
            ) : (
              <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !isDirty} className="odoo-btn-primary"
                title={isDirty ? 'Enregistrer la composition' : 'Aucune modification à enregistrer'}>
                <Save size={14} aria-hidden="true" /> {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Attribution du produit vendu au POS pour un format (mig 263). La comparaison prix
 * calculé / prix pratiqué a quitté la fiche (2026-11-24) : elle vit dans le coût standard
 * de l'article (Production › Coûts standard), avec le prix conseillé.
 *
 * Un produit ne peut être lié qu'à UN SEUL format actif (contrainte unique
 * partielle mig 263). Un doublon renvoie une 409 avec message explicite.
 */
function PosLinkPanel({
  recipeId, formatId, format,
}: {
  recipeId: string;
  formatId: string;
  format: FormatComponentsData['format'];
}) {
  const qc = useQueryClient();
  const posProductId = format.pos_product_id ?? null;
  const source = format.pos_price_source ?? 'none';

  const { data: products = [] } = useQuery<{ id: string; name: string; price: string | number }[]>({
    queryKey: ['products-lite', recipeId],
    queryFn: () => productsApi.list({ limit: '500' }).then((r: { data: any[] }) => r.data),
    staleTime: 3e5,
  });

  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<string>(posProductId ?? '');
  useEffect(() => { setChoice(posProductId ?? ''); }, [posProductId]);

  const linkMut = useMutation({
    mutationFn: (productId: string | null) =>
      recipesApi.updateFormat(recipeId, formatId, { productId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['format-components', recipeId] });
      qc.invalidateQueries({ queryKey: ['recipe-formats', recipeId] });
      setPicking(false);
      notify.success('Lien produit mis à jour');
    },
    onError: (err: unknown) => notify.error(extractErr(err)),
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: 'var(--ds-muted)' }}>Produit vendu</span>
      {picking ? (
        <>
          <SearchSelect ariaLabel="Produit vendu" placeholder="— non lié —" width={260} size="md" value={choice} onChange={setChoice}
            options={products.map((p) => ({ id: String(p.id), label: p.name }))} />
          <button type="button" disabled={linkMut.isPending} onClick={() => linkMut.mutate(choice || null)} className="odoo-btn-primary ds-btn-sm">Enregistrer</button>
          <button type="button" onClick={() => { setPicking(false); setChoice(posProductId ?? ''); }} className="odoo-btn-secondary ds-btn-sm">Annuler</button>
        </>
      ) : (
        <>
          {format.pos_product_name
            ? <span className="ds-strong">{format.pos_product_name}</span>
            : <span style={{ color: 'var(--ds-muted)' }}>Aucun produit lié</span>}
          {source === 'recipe' && (
            <StatusTag tone="progress" label="hérité de la fiche"
              title="Format par défaut : il hérite du produit de la fiche. Attribuez-le explicitement pour le figer." />
          )}
          <button type="button" onClick={() => setPicking(true)} className="fx-link">
            <Link2 size={13} aria-hidden="true" /> {posProductId ? 'Changer' : 'Lier un produit'}
          </button>
        </>
      )}
    </div>
  );
}
