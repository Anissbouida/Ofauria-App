import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Layers, Search, AlertTriangle, ChevronDown, ChevronRight, CornerDownRight, Camera, SlidersHorizontal, Box, GripVertical, HelpCircle, Copy, X } from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { contenantsApi } from '../../api/contenants.api';
import type { FormatComponentsData, FormatSummary, RecipeChild } from '../../api/recipes.api';
import { notify } from '../../components/ui/InlineNotification';

interface SourceOpt { type: 'recipe' | 'ingredient'; id: string; name: string; unit: string; cost: number; yieldQty?: number; }
interface Row { key: string; role: string; type: '' | 'recipe' | 'ingredient'; sourceId: string; quantite: string; unite: string; }
interface Contenant { id: string; nom: string; quantite_theorique?: string | number | null; }

const UNITES = ['g', 'kg', 'ml', 'l', 'cl', 'unit'];
const COLS = '44px 150px minmax(0,1fr) 110px 64px 96px 32px';
const ROLE_BAR: Record<string, string> = {
  fond: '#BA7517', biscuit: '#BA7517', croustillant: '#D85A30', garniture: '#7F77DD',
  insert: '#D4537E', fruits: '#639922', nappage: '#1D9E75', glacage: '#378ADD',
  decor: '#ED93B1', emballage: '#888780',
};
const MASS: Record<string, number> = { g: 1, kg: 1000, mg: 0.001 };
const VOL: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };
function conv(from: string, to: string): number {
  const f = from.toLowerCase(), t = to.toLowerCase();
  if (f === t) return 1;
  if (f in MASS && t in MASS) return MASS[f] / MASS[t];
  if (f in VOL && t in VOL) return VOL[f] / VOL[t];
  return 1;
}
const ROLE_COLOR: Record<string, string> = {
  fond: 'bg-amber-100 text-amber-800', biscuit: 'bg-amber-100 text-amber-800',
  croustillant: 'bg-orange-100 text-orange-800', garniture: 'bg-purple-100 text-purple-800',
  insert: 'bg-purple-100 text-purple-800', fruits: 'bg-green-100 text-green-800',
  nappage: 'bg-teal-100 text-teal-800', glacage: 'bg-blue-100 text-blue-800',
  decor: 'bg-pink-100 text-pink-800', emballage: 'bg-gray-100 text-gray-700',
};
const dh = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)} DH`);
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
let seq = 0;
const newKey = () => `row-${++seq}`;
function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return e?.response?.data?.error?.message || e?.message || 'Erreur';
}
const np = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

function SourcePicker({ options, value, onPick }: {
  options: SourceOpt[]; value: SourceOpt | null; onPick: (o: SourceOpt) => void;
}) {
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
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="h-8 w-full px-2.5 bg-white border border-gray-200 rounded-md text-sm text-left flex items-center justify-between gap-1 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300">
        <span className={`truncate ${value ? 'text-gray-800' : 'text-gray-400'}`}>{value ? value.name : 'Choisir un composant…'}</span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          <div className="p-2 sticky top-0 bg-white border-b border-gray-100">
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg">
              <Search size={13} className="text-gray-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…"
                className="w-full bg-transparent text-sm outline-none" />
            </div>
          </div>
          {recipes.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] uppercase text-gray-400">Recettes de base</div>}
          {recipes.map((o) => (
            <button key={`recipe:${o.id}`} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50 flex justify-between gap-2">
              <span>{o.name}</span><span className="text-gray-400 shrink-0">{o.cost.toFixed(2)} DH/{o.unit}</span>
            </button>
          ))}
          {ingredients.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] uppercase text-gray-400">Ingrédients</div>}
          {ingredients.map((o) => (
            <button key={`ingredient:${o.id}`} type="button" onClick={() => { onPick(o); setOpen(false); setQ(''); }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50 flex justify-between gap-2">
              <span>{o.name}</span><span className="text-gray-400 shrink-0">{o.cost.toFixed(2)} DH/{o.unit}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">Aucun résultat</div>}
        </div>
      )}
    </div>
  );
}

// --- Tree View : dépliage récursif (lecture seule) des sous-recettes imbriquées ---
function ChildRow({ child, depth }: { child: RecipeChild; depth: number }) {
  const [open, setOpen] = useState(false);
  const cost = child.cout_dh != null ? parseFloat(child.cout_dh) : null;
  return (
    <>
      <div className="flex items-center gap-2 py-1 text-sm text-gray-600 border-t border-gray-50"
        style={{ paddingLeft: `${depth * 18 + 8}px` }}>
        {child.expandable ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-gray-400 hover:text-gray-600 shrink-0">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <CornerDownRight size={13} className="text-gray-300 shrink-0" />
        )}
        <span className="flex-1 truncate">{child.name}</span>
        <span className="text-gray-400 shrink-0">{parseFloat(child.quantite)} {child.unite}</span>
        <span className="w-20 text-right tabular-nums shrink-0">{dh(cost)}</span>
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
  if (isLoading) return <div className="py-1 text-xs text-gray-400" style={{ paddingLeft: `${depth * 18 + 8}px` }}>Chargement…</div>;
  if (!data || data.length === 0) return <div className="py-1 text-xs text-gray-400 italic" style={{ paddingLeft: `${depth * 18 + 8}px` }}>Aucun sous-composant.</div>;
  return <div className="bg-gray-50/60">{data.map((c, i) => <ChildRow key={`${c.type}:${c.source_id}:${i}`} child={c} depth={depth} />)}</div>;
}

export interface FormatKpi { contenantNom: string | null; rendement: number; coutPiece: number; prix: number; margePct: number; }

export default function NomenclatureEditor({ recipeId, onSaved, onFinance, onCancel }: { recipeId: string; onSaved?: () => void; onFinance?: (k: FormatKpi | null) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const [formatId, setFormatId] = useState<string | null>(null);
  // Id d'un format tout juste créé/dupliqué : protège sa sélection tant que la
  // liste des formats ne l'a pas encore intégré (sinon l'effet ci-dessous le voit
  // « absent » et rebascule sur le format par défaut → la sauvegarde repartirait
  // sur l'ancien cadre, qui se retrouverait écrasé).
  const justAddedRef = useRef<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [rendement, setRendement] = useState('');
  const [parts, setParts] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newContenant, setNewContenant] = useState('');
  const [dupCompo, setDupCompo] = useState(false);
  const [copySrc, setCopySrc] = useState('');
  // Leviers financiers (niveau recette)
  const [mult, setMult] = useState('3');
  const [tauxMO, setTauxMO] = useState('');
  const [moMin, setMoMin] = useState('');
  const [energie, setEnergie] = useState('');
  const [structPct, setStructPct] = useState('');
  const [perte, setPerte] = useState('');
  const [showParts, setShowParts] = useState(false);
  const [compoParPiece, setCompoParPiece] = useState(false);
  const [dureeEtapes, setDureeEtapes] = useState(0);

  const { data: roles = [] } = useQuery({ queryKey: ['component-roles'], queryFn: recipesApi.componentRoles, staleTime: 3e5 });
  const { data: sources } = useQuery({ queryKey: ['component-sources'], queryFn: recipesApi.componentSources, staleTime: 3e5 });
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
    ];
  }, [sources]);
  const sourceMap = useMemo(() => {
    const m: Record<string, SourceOpt> = {};
    sourceOpts.forEach((o) => { m[`${o.type}:${o.id}`] = o; });
    return m;
  }, [sourceOpts]);
  // Applique (ou ré-applique) les données du format au state local. Réutilisé par
  // « Annuler » pour rétablir le dernier état enregistré (annule les modifs en cours).
  const applyData = useCallback(() => {
    if (!data) return;
    setRows(data.components.map((c) => ({
      key: newKey(), role: c.role ?? '', type: c.source_type,
      sourceId: c.source_recipe_id ?? c.source_ingredient_id ?? '',
      quantite: parseFloat(c.quantite).toString(), unite: c.unite,
    })));
    const f = data.format;
    setRendement(f.nb_par_defaut != null ? String(f.nb_par_defaut) : '');
    setParts(f.nb_parts != null ? String(f.nb_parts) : '');
    setShowParts((f.nb_parts ?? 1) > 1);
    setMult(f.margin_multiplier != null ? parseFloat(f.margin_multiplier).toString() : '3');
    setTauxMO(f.taux_main_oeuvre_dh_h != null ? parseFloat(f.taux_main_oeuvre_dh_h).toString() : '');
    setMoMin(f.main_oeuvre_min != null ? String(f.main_oeuvre_min) : '');
    setEnergie(f.cout_energie_fournee != null ? parseFloat(f.cout_energie_fournee).toString() : '');
    setStructPct(f.taux_frais_structure_pct != null ? parseFloat(f.taux_frais_structure_pct).toString() : '');
    setPerte(f.perte_standard_pct != null && parseFloat(f.perte_standard_pct) > 0 ? parseFloat(f.perte_standard_pct).toString() : '');
    setCompoParPiece(f.compo_par_piece === true);
    setDureeEtapes(f.duree_etapes_min != null ? parseFloat(f.duree_etapes_min) : 0);
  }, [data]);
  useEffect(() => { applyData(); }, [applyData]);

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (role = '') => setRows((rs) => [...rs, { key: newKey(), role, type: '', sourceId: '', quantite: '', unite: 'g' }]);
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const lineCost = (r: Row): number | null => {
    const src = sourceMap[`${r.type}:${r.sourceId}`];
    const q = parseFloat(r.quantite);
    if (!src || !(q > 0)) return null;
    return q * conv(r.unite, src.unit) * src.cost;
  };
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

  const rendementNum = Math.max(1, parseInt(rendement) || 1);
  const partsNum = Math.max(1, parseInt(parts) || 1);
  const poidsBrutG = rows.reduce((s, r) => { const eq = baseEquiv(r); return s + (eq ? eq.val : 0); }, 0);
  const perteNum = Math.min(99.99, Math.max(0, np(perte) ?? 0));
  const poidsCuitG = poidsBrutG * (1 - perteNum / 100);
  // Sépare valeur et unité pour aligner la colonne unité dans la carte rendement.
  const splitW = (g: number): [string, string] => g <= 0 ? ['—', ''] : g >= 1000 ? [(g / 1000).toFixed(g >= 10000 ? 1 : 2), 'kg'] : [String(Math.round(g)), 'g'];

  const coutMatiere = rows.reduce((s, r) => s + (lineCost(r) ?? 0), 0); // = fournée de ce format
  const fin = useMemo(() => {
    const matierePiece = compoParPiece ? coutMatiere : coutMatiere / rendementNum;
    const dureeMin = moMin !== '' ? (np(moMin) ?? 0) : dureeEtapes;
    const moFournee = (dureeMin / 60) * (np(tauxMO) ?? 0);
    const moPiece = moFournee / rendementNum;
    const energiePiece = (np(energie) ?? 0) / rendementNum;
    const base = matierePiece + moPiece + energiePiece;
    const structP = base * ((np(structPct) ?? 0) / 100);
    const coutProd = base + structP;
    const m = np(mult) ?? 3;
    const prix = coutProd * m;
    return {
      matierePiece, moPiece, energiePiece, structP, coutProd, prix,
      marge: prix - coutProd, margePct: prix > 0 ? (prix - coutProd) / prix * 100 : 0,
      coutPart: coutProd / partsNum, prixPart: prix / partsNum,
    };
  }, [coutMatiere, compoParPiece, rendementNum, partsNum, moMin, dureeEtapes, tauxMO, energie, structPct, mult]);
  const coutFournee = fin.coutProd * rendementNum;

  // Remonte la finance du format actif au parent (en-tête du modal — Lot 4).
  const onFinanceRef = useRef(onFinance);
  onFinanceRef.current = onFinance;
  useEffect(() => {
    if (!data?.format) return;
    onFinanceRef.current?.({
      contenantNom: data.format.contenant_nom,
      rendement: rendementNum, coutPiece: fin.matierePiece, prix: fin.prix, margePct: fin.margePct,
    });
  }, [data?.format, rendementNum, fin.matierePiece, fin.prix, fin.margePct]);
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
      })));
      setCopySrc('');
      notify.success('Composition copiée — ajuste les quantités puis Enregistre');
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
      const components = rows.filter((r) => r.type && r.sourceId && parseFloat(r.quantite) > 0).map((r, i) => ({
        role: r.role || null,
        sourceRecipeId: r.type === 'recipe' ? r.sourceId : null,
        sourceIngredientId: r.type === 'ingredient' ? r.sourceId : null,
        quantite: parseFloat(r.quantite), unite: r.unite, ordre: i,
      }));
      await recipesApi.saveFormatComponents(recipeId, formatId, {
        components,
        nbParDefaut: parseInt(rendement) || null,
        nbParts: parseInt(parts) || null,
      });
      return recipesApi.saveFinance(recipeId, {
        marginMultiplier: np(mult) ?? 3,
        tauxMainOeuvreDhH: np(tauxMO),
        mainOeuvreMin: moMin !== '' ? parseInt(moMin) : null,
        coutEnergieFournee: np(energie),
        tauxFraisStructurePct: np(structPct),
        perteStandardPct: np(perte),
        compoParPiece,
      });
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

  const renderRow = (r: Row) => {
    const src = r.type && r.sourceId ? sourceMap[`${r.type}:${r.sourceId}`] : null;
    const eq = baseEquiv(r);
    const pp = compoParPiece ? batchRatio(r) : null;
    const aberrant = isAberrant(r);
    const canExpand = r.type === 'recipe' && !!r.sourceId;
    const isOpen = !!expanded[r.key];
    const roleCls = ROLE_COLOR[r.role] || 'bg-gray-100 text-gray-500';
    const cost = lineCost(r);
    const share = coutMatiere > 0 && cost != null ? (cost / coutMatiere) * 100 : null;
    const barColor = ROLE_BAR[r.role] || '#888780';
    return (
      <div key={r.key} className={`border-t border-gray-100 first:border-t-0 ${dragKey === r.key ? 'opacity-40' : ''}`}
        onDragOver={(e) => e.preventDefault()} onDrop={() => onDropRow(r.key)}>
        <div className="grid items-start gap-2 px-3 py-2 hover:bg-gray-50/70 transition-colors" style={{ gridTemplateColumns: COLS }}>
          <div className="flex items-center gap-0.5 pt-1.5">
            <span draggable onDragStart={() => setDragKey(r.key)} onDragEnd={() => setDragKey(null)}
              className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500" title="Glisser pour réordonner">
              <GripVertical size={14} />
            </span>
            {canExpand ? (
              <button type="button" onClick={() => setExpanded((e) => ({ ...e, [r.key]: !e[r.key] }))}
                className="text-gray-400 hover:text-gray-700" aria-label="Déplier la sous-recette">
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            ) : <span className="block w-[15px]" />}
          </div>
          <select className={`h-8 rounded-md text-xs font-medium px-2 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-200 ${roleCls}`}
            value={r.role} onChange={(e) => setRow(r.key, { role: e.target.value })} title="Rôle du composant">
            <option value="">Sans rôle</option>
            {roles.map((ro) => <option key={ro.code} value={ro.code}>{ro.label}</option>)}
          </select>
          <div className="min-w-0">
            <SourcePicker options={sourceOpts} value={src ?? null}
              onPick={(o) => setRow(r.key, { type: o.type, sourceId: o.id, unite: o.unit === 'unit' ? r.unite : o.unit })} />
            {src && (
              <div className="mt-1">
                {share != null && (
                  <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, share))}%`, background: barColor, opacity: 0.7 }} />
                  </div>
                )}
                <div className="text-[11px] text-gray-400 mt-0.5 pl-0.5">
                  {src.type === 'recipe' ? 'recette de base' : 'matière 1ère'}{share != null ? ` · ${Math.round(share)}% du coût` : ''}
                </div>
              </div>
            )}
          </div>
          <div>
            <input type="number" step="any" min="0"
              className={`h-8 w-full px-2 rounded-md text-sm text-right tabular-nums border focus:outline-none focus:ring-2 ${aberrant ? 'border-red-300 bg-red-50 text-red-700 focus:ring-red-100' : 'border-gray-200 bg-white focus:ring-blue-100 focus:border-blue-300'}`}
              value={r.quantite} onChange={(e) => setRow(r.key, { quantite: e.target.value })} placeholder="0" />
            {pp != null ? (
              <div className={`text-[10px] mt-0.5 text-right ${pp >= 1 ? 'text-red-500' : 'text-gray-400'}`} title="Fournées de la recette de base consommées par pièce">
                {pp >= 1 && <AlertTriangle size={9} className="inline mr-0.5 -mt-0.5" />}
                {pp >= 1 ? `${pp.toFixed(pp >= 10 ? 0 : 1)} fournée/pièce` : `≈ ${Math.round(pp * 100)}% fournée/pièce`}
              </div>
            ) : eq ? (
              <div className="text-[10px] mt-0.5 text-right text-gray-400">
                ≈ {eq.val >= 1000 ? `${(eq.val / 1000).toFixed(2)} ${eq.unit === 'g' ? 'kg' : 'l'}` : `${Math.round(eq.val)} ${eq.unit}`}
              </div>
            ) : null}
          </div>
          <select className="h-8 px-1.5 bg-white border border-gray-200 rounded-md text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
            value={r.unite} onChange={(e) => setRow(r.key, { unite: e.target.value })}>
            {UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="text-right text-sm tabular-nums font-medium text-gray-700 pt-1.5">{dh(lineCost(r))}</div>
          <div className="flex justify-center pt-1">
            <button type="button" onClick={() => delRow(r.key)} className="text-gray-300 hover:text-red-500 transition-colors" aria-label="Supprimer"><Trash2 size={15} /></button>
          </div>
        </div>
        {isOpen && canExpand && <SubTree recipeId={r.sourceId} depth={1} />}
      </div>
    );
  };

  const f = data?.format;
  const usedContenantIds = new Set(formats.map((x) => x.contenant_id));
  const availContenants = contenants.filter((c) => !usedContenantIds.has(c.id));

  return (
    <div className="odoo-section">
      <div className="odoo-section-header flex items-center gap-2"><Layers size={13} /> Composition de la recette</div>

      {/* Onglets de format */}
      <div className="flex items-center gap-1.5 flex-wrap px-3 pt-3">
        {formats.map((ft) => (
          <button key={ft.id} type="button" onClick={() => setFormatId(ft.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors ${ft.id === formatId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
            <Box size={13} /> {ft.contenant_nom || 'Format'} <span className={ft.id === formatId ? 'text-blue-100' : 'text-gray-400'}>×{ft.nb_par_defaut}</span>
            {ft.is_default && <span className={`text-[10px] ${ft.id === formatId ? 'text-blue-100' : 'text-gray-400'}`}>(défaut)</span>}
          </button>
        ))}
        {adding ? (
          <span className="inline-flex items-center gap-1.5">
            <select value={newContenant} onChange={(e) => setNewContenant(e.target.value)}
              className="h-8 px-2 bg-white border border-gray-200 rounded-md text-sm">
              <option value="">— contenant —</option>
              {availContenants.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            {formats.length > 0 && (
              <label className="inline-flex items-center gap-1 text-xs text-gray-500" title="Copier la composition du format actif">
                <input type="checkbox" checked={dupCompo} onChange={(e) => setDupCompo(e.target.checked)} /> copier la compo
              </label>
            )}
            <button type="button" disabled={!newContenant || addFormatMut.isPending} onClick={() => addFormatMut.mutate()}
              className="odoo-btn-primary text-sm px-2 py-1">{dupCompo ? 'Dupliquer' : 'Créer'}</button>
            <button type="button" onClick={() => { setAdding(false); setNewContenant(''); setDupCompo(false); }} className="text-gray-400 hover:text-gray-600 text-sm px-1">✕</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
            <Plus size={13} /> Ajouter un format
          </button>
        )}
      </div>

      {formats.length === 0 ? (
        <div className="text-sm text-gray-400 py-6 px-3">Aucun format. Ajoute un contenant pour composer cette recette.</div>
      ) : isLoading || !f ? (
        <div className="text-sm text-gray-400 py-4 px-3">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 p-3">
          {/* Colonne gauche : photo + rendement/parts/poids */}
          <div className="flex flex-col gap-3">
            <div className="aspect-square rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
              {f.product_image ? (
                <img src={f.product_image} alt={f.recipe_name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-gray-400 text-center px-2">
                  <Camera size={26} />
                  <span className="text-[11px]">Photo via la fiche produit</span>
                </div>
              )}
            </div>
            <div className="px-3 py-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 truncate pb-2 mb-1 border-b border-gray-200">{f.contenant_nom || 'Format'}</div>
              {(() => {
                const [bv, bu] = splitW(poidsBrutG);
                const [cv, cu] = splitW(poidsCuitG);
                const cell = 'h-7 w-full px-2 bg-white border border-gray-200 rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300';
                const rowCls = 'grid grid-cols-[1fr_52px_26px] items-center gap-1.5 py-1';
                const lbl = 'text-sm text-gray-600 whitespace-nowrap';
                const unit = 'text-xs text-gray-400 whitespace-nowrap';
                return (
                  <div className="flex flex-col">
                    <div className={rowCls}>
                      <span className={lbl}>Rendement</span>
                      <input type="number" min="1" className={cell} value={rendement} onChange={(e) => setRendement(e.target.value)} placeholder="50" />
                      <span className={unit}>p.</span>
                    </div>
                    {(partsNum > 1 || showParts) ? (
                      <div className={rowCls}>
                        <span className={lbl}>Parts</span>
                        <input type="number" min="1" className={cell} value={parts} onChange={(e) => setParts(e.target.value)} placeholder="1" />
                        <span className={unit}>/pc</span>
                      </div>
                    ) : (
                      <div className="py-1">
                        <button type="button" onClick={() => setShowParts(true)}
                          className="text-xs text-blue-600 hover:text-blue-700" title="Pour un produit coupé en portions (entremets, tarte…)">
                          + Vendu à la part
                        </button>
                      </div>
                    )}
                    <div className="border-t border-gray-200 my-1" />
                    <div className={rowCls}>
                      <span className={lbl}>Poids brut</span>
                      <span className="text-sm font-medium tabular-nums text-right">{bv}</span>
                      <span className={unit}>{bu}</span>
                    </div>
                    <div className={rowCls}>
                      <span className={lbl}>Poids cuit</span>
                      <span className="text-sm font-medium tabular-nums text-right">{cv}</span>
                      <span className={unit}>{cu}</span>
                    </div>
                    <div className={rowCls}>
                      <span className={lbl}>Perte</span>
                      <input type="number" min="0" max="99" step="any" className={`${cell} text-amber-700`} value={perte} onChange={(e) => setPerte(e.target.value)} placeholder="0" />
                      <span className={unit}>%</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Colonne droite : composition + finance */}
          <div>
            {aberrantCount > 0 && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-[13px] text-red-700">
                <AlertTriangle size={15} className="shrink-0" />
                <span><strong>{aberrantCount} ligne{aberrantCount > 1 ? 's' : ''} à corriger</strong> — dosage par pièce improbable (≥ 1 fournée). Saisis la quantité réelle par pièce.</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 mb-1">
              <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                Quantités saisies
                <span className="inline-flex cursor-help"
                  title={'Par fournée : quantités pour tout le lot (cadre/plaque découpé) → coût/pièce = total ÷ rendement.\nPar pièce : quantités pour une seule unité (entremets individuel…) → coût/pièce = la somme.'}>
                  <HelpCircle size={13} className="text-gray-400" />
                </span>
              </span>
              <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs">
                <button type="button" onClick={() => setCompoParPiece(false)}
                  title="Quantités pour toute la fournée (cadre/plaque découpé)"
                  className={`px-3 py-1.5 ${!compoParPiece ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Par fournée (lot)</button>
                <button type="button" onClick={() => setCompoParPiece(true)}
                  title="Quantités pour une seule pièce (entremets individuel, monoportion…)"
                  className={`px-3 py-1.5 border-l border-gray-200 ${compoParPiece ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Par pièce (unité)</button>
              </div>
            </div>
            <div className="text-[11px] text-gray-400 text-right mb-2">
              {compoParPiece
                ? 'Tu saisis les quantités pour 1 pièce — le coût/pièce = la somme.'
                : `Tu saisis les quantités pour toute la fournée — le coût/pièce = total ÷ ${rendementNum} pièces.`}
            </div>

            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="grid items-center gap-2 px-3 py-2 bg-gray-50 text-[11px] font-medium uppercase tracking-wide text-gray-500" style={{ gridTemplateColumns: COLS }}>
                <span /><span>Rôle</span><span>Composant</span>
                <span className="text-right">{compoParPiece ? 'Qté / pièce' : 'Qté / fournée'}</span><span>Unité</span>
                <span className="text-right">Coût</span><span />
              </div>
              {rows.map(renderRow)}
              {rows.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-gray-400 border-t border-gray-100">Aucun composant pour ce format.</div>
              )}
              <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between gap-2 flex-wrap">
                <button type="button" onClick={() => addRow('')} className="text-sm font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
                  <Plus size={15} /> Ajouter un composant
                </button>
                {formats.filter((ft) => ft.id !== formatId).length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                    <Copy size={13} /> Copier depuis
                    <select value={copySrc} onChange={(e) => setCopySrc(e.target.value)}
                      className="h-7 px-2 bg-white border border-gray-200 rounded-md text-xs">
                      <option value="">— format —</option>
                      {formats.filter((ft) => ft.id !== formatId).map((ft) => (
                        <option key={ft.id} value={ft.id}>{ft.contenant_nom || 'Format'} ×{ft.nb_par_defaut}</option>
                      ))}
                    </select>
                    <button type="button" disabled={!copySrc} onClick={copyFromFormat}
                      className="px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">Copier</button>
                  </span>
                )}
              </div>
            </div>

            {/* Frais indirects & multiplicateur */}
            <div className="mt-5 rounded-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-gray-700 bg-gray-50 border-b border-gray-200">
                <SlidersHorizontal size={14} className="text-blue-600" /> Frais indirects &amp; prix de vente
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3">
                {[
                  { lbl: "Main d'œuvre", sfx: 'DH/h', val: tauxMO, set: setTauxMO, ph: 'ex 30', step: 'any' },
                  { lbl: 'Temps / fournée', sfx: 'min', val: moMin, set: setMoMin, ph: dureeEtapes > 0 ? `étapes ${dureeEtapes}` : 'ex 90', step: '1' },
                  { lbl: 'Énergie', sfx: 'DH/four.', val: energie, set: setEnergie, ph: 'ex 15', step: 'any' },
                  { lbl: 'Structure', sfx: '%', val: structPct, set: setStructPct, ph: 'ex 15', step: 'any' },
                  { lbl: 'Multiplicateur', sfx: '×', val: mult, set: setMult, ph: 'ex 3', step: 'any' },
                ].map((fld) => (
                  <label key={fld.lbl} className="block">
                    <span className="text-[11px] text-gray-500">{fld.lbl}</span>
                    <span className="mt-1 flex items-center gap-1 rounded-md border border-gray-200 bg-white pr-2 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300">
                      <input type="number" step={fld.step} min="0" value={fld.val} onChange={(e) => fld.set(e.target.value)}
                        className="h-9 w-full px-2 bg-transparent rounded-md text-sm text-right tabular-nums focus:outline-none" placeholder={fld.ph} />
                      <span className="text-[11px] text-gray-400 shrink-0">{fld.sfx}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Panneau financier */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mt-4">
              {[
                { l: 'Matière / pièce', v: dh(fin.matierePiece), c: 'border-gray-200 bg-gray-50', t: 'text-gray-500', vt: 'text-gray-800' },
                { l: 'MO + énergie', v: dh(fin.moPiece + fin.energiePiece), c: 'border-gray-200 bg-gray-50', t: 'text-gray-500', vt: 'text-gray-800' },
                { l: 'Structure', v: dh(fin.structP), c: 'border-gray-200 bg-gray-50', t: 'text-gray-500', vt: 'text-gray-800' },
                { l: 'Coût production', v: dh(fin.coutProd), c: 'border-blue-200 bg-blue-50', t: 'text-blue-700', vt: 'text-blue-800' },
                { l: 'Prix vente HT', v: dh(fin.prix), c: 'border-green-200 bg-green-50', t: 'text-green-700', vt: 'text-green-800' },
                { l: 'Marge brute', v: `${dh(fin.marge)} (${Math.round(fin.margePct)}%)`, c: 'border-amber-200 bg-amber-50', t: 'text-amber-700', vt: 'text-amber-800' },
              ].map((k) => (
                <div key={k.l} className={`rounded-lg border px-3 py-2.5 ${k.c}`}>
                  <div className={`text-[11px] ${k.t}`}>{k.l}</div>
                  <div className={`text-base font-medium tabular-nums mt-0.5 ${k.vt}`}>{k.v}</div>
                </div>
              ))}
            </div>

            {partsNum > 1 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
                  <div className="text-[11px] text-teal-700">Coût / part ({partsNum} parts)</div>
                  <div className="text-base font-medium tabular-nums mt-0.5 text-teal-800">{dh(fin.coutPart)}</div>
                </div>
                <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5">
                  <div className="text-[11px] text-teal-700">Prix / part</div>
                  <div className="text-base font-medium tabular-nums mt-0.5 text-teal-800">{dh(fin.prixPart)}</div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
              <p className="text-xs text-gray-400">
                Format <strong>{f.contenant_nom}</strong> · saisie <strong>{compoParPiece ? 'par pièce' : 'par fournée'}</strong>
                {!compoParPiece && <> (coût/pièce = total ÷ {rendementNum})</>}.
                Coût/fournée : <strong>{dh(coutFournee)}</strong>.
              </p>
              <div className="inline-flex items-center gap-2">
                <button type="button" onClick={() => (onCancel ? onCancel() : applyData())} disabled={saveMut.isPending}
                  className="odoo-btn-secondary inline-flex items-center gap-1" title="Annuler les modifications et quitter">
                  <X size={15} /> Annuler
                </button>
                <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="odoo-btn-primary inline-flex items-center gap-1">
                  <Save size={15} /> {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
