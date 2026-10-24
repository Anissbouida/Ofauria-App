import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Layers, Box, Plus, Trash2, Save, X, Printer, ChefHat, SlidersHorizontal, Pencil,
} from 'lucide-react';
import { recipesApi } from '../../api/recipes.api';
import { ingredientsApi } from '../../api/inventory.api';
import { contenantsApi } from '../../api/contenants.api';
import { notify } from '../../components/ui/InlineNotification';
import EtapesSection from './EtapesSection';
import RecipeCreateDialog from './RecipeCreateDialog';

/**
 * Fiche d'une PRÉPARATION DE BASE — même ossature que la page d'un produit fini
 * (NomenclaturePage) : barre de contrôle, bandeau KPI, sections, éditeur, pied
 * de page d'enregistrement. Elle en reprend les classes telles quelles, pour que
 * passer d'une fiche à l'autre ne donne pas l'impression de changer d'outil.
 *
 * Ce qui diffère tient au métier, pas au style :
 *   - une préparation se mesure en FOURNÉE (poids brut → perte → poids net),
 *     là où un produit fini se mesure en pièces ;
 *   - elle n'a ni prix de vente ni marge : elle n'est pas vendue, elle est
 *     consommée. Le repère de coût est donc le kilo NET ;
 *   - sa composition est une liste d'ingrédients, pas une nomenclature par
 *     format : c'est une seule masse, déclinable ensuite sur plusieurs
 *     contenants (mig 274).
 */

interface IngRow { key: string; ingredientId: string; quantity: string; unit: string }
interface FmtRow { key: string; id?: string; contenantId: string; quantite: string; unite: string; nb: string }

const uid = () => Math.random().toString(36).slice(2, 9);
const dh = (v: number) => `${v.toFixed(2)} DH`;
const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;

/** Poids d'une ligne en kg — sert au % du coût et au contrôle de cohérence. */
const toKg = (q: number, unit: string) => {
  switch ((unit || '').toLowerCase()) {
    case 'kg': return q;
    case 'g': return q / 1000;
    case 'l': return q;
    case 'cl': return q / 100;
    case 'ml': return q / 1000;
    default: return 0; // 'unit' : non pondérable
  }
};

export default function PreparationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: recipe, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipesApi.getById(id!),
    enabled: !!id,
  });
  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => ingredientsApi.list().then((r: Record<string, any>) => (r.data || r) as Record<string, any>[]),
  });
  const { data: contenants = [] } = useQuery({
    queryKey: ['contenants-active'],
    queryFn: () => contenantsApi.list().then((r: Record<string, any>) => (r.data || r) as Record<string, any>[]),
  });

  const [rows, setRows] = useState<IngRow[]>([]);
  const [formats, setFormats] = useState<FmtRow[]>([]);
  const [rendement, setRendement] = useState('');
  const [rendementUnite, setRendementUnite] = useState('g');
  const [perte, setPerte] = useState('0');
  const [tauxMo, setTauxMo] = useState('');
  const [energie, setEnergie] = useState('');
  const [structPct, setStructPct] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editIdentity, setEditIdentity] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Hydratation depuis la fiche. `dirty` retombe : rouvrir la page ne doit pas
  // laisser croire qu'il reste des modifications à enregistrer.
  useEffect(() => {
    if (!recipe) return;
    setRows((recipe.ingredients || []).map((i: Record<string, any>) => ({
      key: uid(),
      ingredientId: String(i.ingredient_id),
      quantity: String(num(i.quantity)),
      unit: String(i.unit || 'g'),
    })));
    setFormats((recipe.formats || []).map((f: Record<string, any>) => ({
      key: uid(),
      id: String(f.id),
      contenantId: f.contenant_id ? String(f.contenant_id) : '',
      quantite: String(num(f.quantite_par_format)),
      unite: String(f.quantite_par_format_unite || 'g'),
      nb: String(f.nb_par_defaut ?? 1),
    })));
    setRendement(String(num(recipe.yield_quantity)));
    setRendementUnite(String(recipe.yield_unit || 'g'));
    setPerte(String(num(recipe.perte_standard_pct)));
    setTauxMo(String(num(recipe.taux_main_oeuvre_dh_h)));
    setEnergie(String(num(recipe.cout_energie_fournee)));
    setStructPct(String(num(recipe.taux_frais_structure_pct)));
    setDirty(false);
  }, [recipe]);

  const ingById = useMemo(() => {
    const m: Record<string, Record<string, any>> = {};
    for (const i of ingredients) m[String(i.id)] = i;
    return m;
  }, [ingredients]);

  /**
   * Coût d'une ligne. On reprend la règle de v_recipe_direct_cost : la quantité
   * est convertie vers l'unité de l'ingrédient, densité comprise. Les cas
   * poids↔volume sans densité renvoient un facteur 1 — la vue fait pareil, et
   * le signale ailleurs ; on ne cherche pas à être plus malin que la base.
   */
  const ligneCout = (r: IngRow): number => {
    const ing = ingById[r.ingredientId];
    if (!ing) return 0;
    const q = num(r.quantity);
    const from = (r.unit || ing.unit || 'g').toLowerCase();
    const to = String(ing.unit || 'g').toLowerCase();
    const dens = ing.densite_kg_l ? num(ing.densite_kg_l) : null;
    const poids = ['g', 'kg', 'mg'], vol = ['ml', 'cl', 'dl', 'l'];
    let facteur = 1;
    if (from === to) facteur = 1;
    else if (poids.includes(from) && poids.includes(to)) facteur = toKg(1, from) / toKg(1, to);
    else if (vol.includes(from) && vol.includes(to)) facteur = toKg(1, from) / toKg(1, to);
    else if (poids.includes(from) && vol.includes(to) && dens) facteur = (toKg(1, from) / dens) / toKg(1, to);
    else if (vol.includes(from) && poids.includes(to) && dens) facteur = (toKg(1, from) * dens) / toKg(1, to);
    return q * num(ing.unit_cost) * facteur;
  };

  const coutMatiere = rows.reduce((s, r) => s + ligneCout(r), 0);
  const poidsKg = rows.reduce((s, r) => s + toKg(num(r.quantity), r.unit), 0);
  const pertePct = Math.min(99.99, Math.max(0, num(perte)));
  const poidsNetKg = poidsKg * (1 - pertePct / 100);
  const rendementNet = num(rendement) * (1 - pertePct / 100);
  const coutKgNet = poidsNetKg > 0 ? coutMatiere / poidsNetKg : 0;

  // Poids porté par CHAQUE format, dérivé du rendement de la fournée. Une même
  // fournée répartie sur deux contenants en met la moitié dans chacun — c'est ce
  // que fait déjà v_recipe_format_cost pour un produit multi-format.
  // `unit` n'est pas une unité de poids : on retombe alors sur les grammes issus
  // du poids des ingrédients, sinon le format n'aurait pas de masse du tout.
  const uniteFormat = ['g', 'kg', 'ml', 'l'].includes(rendementUnite) ? rendementUnite : 'g';
  const totalFormat = ['g', 'kg', 'ml', 'l'].includes(rendementUnite)
    ? num(rendement)
    : poidsKg * 1000;
  const nbFormats = Math.max(1, formats.length);
  const partParFormat = totalFormat / nbFormats;
  const utiliseePar: Record<string, any>[] = recipe?.used_by || [];

  // Frais indirects — même formule que l'éditeur de nomenclature : la durée des
  // étapes porte la main d'œuvre, la structure s'applique sur le reste.
  const dureeMin = (recipe?.etapes || []).reduce(
    (s: number, e: Record<string, any>) => s + (num(e.duree_estimee_min)), 0);
  const coutMo = (dureeMin / 60) * num(tauxMo);
  const coutEnergie = num(energie);
  const coutStruct = (coutMatiere + coutMo + coutEnergie) * num(structPct) / 100;
  const coutFournee = coutMatiere + coutMo + coutEnergie + coutStruct;

  const patch = <T,>(setter: React.Dispatch<React.SetStateAction<T>>) => (v: React.SetStateAction<T>) => {
    setDirty(true); setter(v);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!recipe) throw new Error('Fiche non chargée');
      const validIngredients = rows
        .filter(r => r.ingredientId && num(r.quantity) > 0)
        .map(r => ({ ingredientId: r.ingredientId, quantity: num(r.quantity), unit: r.unit || null }));
      // La quantité par format n'est plus saisie : elle se déduit du rendement.
      // Un format sans masse serait refusé par la contrainte quantite > 0, d'où
      // le garde-fou à 1.
      const validFormats = formats
        .filter(f => f.contenantId)
        .map((f, i) => ({
          contenantId: f.contenantId,
          quantiteParFormatG: Math.max(1, Number(partParFormat.toFixed(2))),
          quantiteParFormatUnite: uniteFormat,
          nbParDefaut: 1,
          coutEmballageUnitaire: 0,
          ordre: i,
        }));
      // Payload COMPLET : `update` remplace la fiche. Omettre un champ l'efface —
      // on renvoie donc nom, catégorie, étapes et instructions tels qu'ils sont
      // en base, même si cette page ne les édite pas.
      return recipesApi.update(recipe.id, {
        name: recipe.name,
        productId: null,
        contenantId: recipe.contenant_id || null,
        yieldQuantity: num(rendement) || 1,
        yieldUnit: rendementUnite,
        perteStandardPct: pertePct,
        pieceWeightKg: recipe.piece_weight_kg ? num(recipe.piece_weight_kg) : null,
        categoryId: recipe.category_id || null,
        marginMultiplier: num(recipe.margin_multiplier) || 3,
        tauxMainOeuvreDhH: tauxMo === '' ? undefined : num(tauxMo),
        coutEnergieFournee: energie === '' ? undefined : num(energie),
        tauxFraisStructurePct: structPct === '' ? undefined : num(structPct),
        instructions: recipe.instructions || '',
        isBase: true,
        etapes: recipe.etapes || [],
        ingredients: validIngredients,
        subRecipes: (recipe.sub_recipes || []).map((s: Record<string, any>) => ({
          subRecipeId: String(s.sub_recipe_id), quantity: num(s.quantity),
        })),
        packaging: (recipe.packaging || []).map((p: Record<string, any>) => ({
          packagingId: String(p.packaging_id), quantity: num(p.quantity), unit: p.unit || null,
        })),
        formats: validFormats,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', id] });
      qc.invalidateQueries({ queryKey: ['recipes'] });
      setDirty(false);
      notify.success('Préparation enregistrée');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify.error(msg || "Erreur lors de l'enregistrement");
    },
  });

  const printFiche = async () => {
    if (!recipe) return;
    setPrinting(true);
    try {
      const response = await recipesApi.fichePdf(recipe.id);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify.error('Erreur lors de la génération de la fiche technique');
    } finally {
      setPrinting(false);
    }
  };

  if (isLoading) {
    return <div className="odoo-scope"><div style={{ padding: '1.5rem' }} className="text-sm text-gray-400">Chargement…</div></div>;
  }
  if (!recipe) {
    return (
      <div className="odoo-scope">
        <div style={{ padding: '1.5rem' }} className="text-sm">
          Préparation introuvable. <button onClick={() => navigate('/recipes?tab=base')} className="text-amber-600 hover:underline">Retour aux préparations</button>
        </div>
      </div>
    );
  }

  const usedContenants = new Set(formats.map(f => f.contenantId).filter(Boolean));
  const FIELD = 'h-8 px-2 bg-white border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400';

  return (
    <div className="odoo-scope">
      {/* ══════ Barre de contrôle — identique à la page produit ══════ */}
      <div className="odoo-control-bar">
        <button onClick={() => navigate('/recipes?tab=base')} className="odoo-btn-secondary inline-flex items-center gap-1.5" title="Retour aux préparations">
          <ArrowLeft size={15} /> Retour aux préparations
        </button>
        <div className="odoo-breadcrumb" style={{ marginLeft: '0.75rem' }}>
          <ChefHat size={14} style={{ color: 'var(--theme-accent)' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/recipes?tab=base')}>Fiches techniques</span>
          <span className="odoo-breadcrumb-separator">›</span>
          <span className="odoo-breadcrumb-current">{recipe.name}</span>
        </div>
      </div>

      {/* ══════ Bandeau KPI ══════
          Quatre tuiles comme sur un produit fini, mais avec les repères d'une
          préparation : pas de prix ni de marge — elle n'est pas vendue. */}
      <div className="odoo-smart-button-row">
        <div className="odoo-smart-button" title="Poids engagé moins la perte de transformation.">
          <div className="odoo-smart-button-value">
            {rendementNet > 0 ? `${rendementNet.toFixed(rendementNet < 10 ? 2 : 0)} ${rendementUnite}` : '—'}
          </div>
          <div className="odoo-smart-button-label">
            <Layers size={11} /> Rendement net
            {pertePct > 0 && <span style={{ marginLeft: 4, opacity: 0.7 }}>· {num(rendement)} {rendementUnite} − {pertePct}%</span>}
          </div>
        </div>
        <div className="odoo-smart-button" title="Matière + main d'œuvre + énergie + frais de structure, pour une fournée.">
          <div className="odoo-smart-button-value">{dh(coutFournee)}</div>
          <div className="odoo-smart-button-label">
            Coût fournée
            <span style={{ marginLeft: 4, opacity: 0.7 }}>· matière {dh(coutMatiere)}</span>
          </div>
        </div>
        <div className="odoo-smart-button" title="Coût de la fournée rapporté au kilo réellement utilisable. C'est ce chiffre qui se compare d'une préparation à l'autre.">
          <div className="odoo-smart-button-value" style={{ color: '#15803d' }}>
            {coutKgNet > 0 ? dh(coutKgNet) : '—'}
          </div>
          <div className="odoo-smart-button-label">Coût / kg net</div>
        </div>
        <div className="odoo-smart-button" title="Recettes qui consomment cette préparation.">
          <div className="odoo-smart-button-value">{utiliseePar.length || '—'}</div>
          <div className="odoo-smart-button-label">Recettes qui l'utilisent</div>
        </div>
      </div>

      <div style={{ padding: '1.25rem', maxWidth: 1320, margin: '0 auto' }}>
        <div className="flex items-center gap-2 mb-1">
          <Layers size={20} style={{ color: 'var(--theme-accent)' }} />
          <h1 className="text-xl font-semibold" style={{ color: 'var(--theme-text-strong)' }}>{recipe.name}</h1>
          <button type="button" className="odoo-pager-btn" title="Modifier le nom ou la catégorie"
            onClick={() => dirty ? notify.error("Enregistre d'abord la composition : modifier la fiche la recharge.") : setEditIdentity(true)}>
            <Pencil size={13} />
          </button>
          {editIdentity && (
            <RecipeCreateDialog recipe={{ id: recipe.id, name: recipe.name, category_id: recipe.category_id ?? null, is_base: true }}
              onClose={() => setEditIdentity(false)} />
          )}
          <span className="odoo-tag odoo-tag-purple">Préparation de base</span>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Une préparation se lance <strong>par fournée</strong>. Le format dit dans quoi elle est cuite ou coulée ; la perte sépare le poids engagé du poids utilisable.
        </p>

        {/* ══════ Formats de production ══════ */}
        <div className="odoo-section">
          <div className="odoo-section-header flex items-center gap-2"><Box size={13} /> Format de production</div>
          <div className="flex items-center gap-1.5 flex-wrap px-3 py-3">
            {formats.length === 0 && (
              <span className="text-sm text-gray-400 italic">Aucun format — ajoute le contenant dans lequel cette préparation est lancée.</span>
            )}
            {formats.map((f, idx) => (
              <span key={f.key} className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-gray-200 bg-white">
                <Box size={13} style={{ color: 'var(--theme-accent)' }} />
                <select value={f.contenantId} className={FIELD} style={{ minWidth: 240 }}
                  onChange={(e) => patch(setFormats)(formats.map((x, i) => i === idx ? { ...x, contenantId: e.target.value } : x))}>
                  <option value="">— contenant —</option>
                  {contenants
                    .filter(c => !usedContenants.has(String(c.id)) || String(c.id) === f.contenantId)
                    .map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                {/* La quantité n'est plus saisie ici : elle vient du rendement de la
                    carte Fournée. Affichée seulement quand la fournée se répartit
                    sur plusieurs contenants — sinon c'est le rendement, mot pour mot. */}
                {formats.length > 1 && (
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    → {partParFormat.toFixed(partParFormat < 10 ? 2 : 0)} {uniteFormat}
                  </span>
                )}
                <button type="button" title="Retirer ce format"
                  onClick={() => patch(setFormats)(formats.filter((_, i) => i !== idx))}
                  className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
              </span>
            ))}
            <button type="button"
              onClick={() => patch(setFormats)([...formats, { key: uid(), contenantId: '', quantite: '', unite: 'g', nb: '1' }])}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
              <Plus size={13} /> Ajouter un format
            </button>
            <button type="button" onClick={printFiche} disabled={printing}
              title="Imprimer la fiche technique"
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <Printer size={13} /> {printing ? 'Génération…' : 'Imprimer la fiche'}
            </button>
          </div>
        </div>

        {/* ══════ Composition ══════ */}
        <div className="odoo-section" style={{ marginTop: '1rem' }}>
          <div className="odoo-section-header flex items-center gap-2"><Layers size={13} /> Composition de la fournée</div>
          <div className="grid gap-4" style={{ gridTemplateColumns: '250px 1fr', padding: '0.75rem' }}>
            {/* Carte rendement — pendant de la carte format de la page produit */}
            <div>
              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Fournée</h4>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Rendement</span>
                  <span className="inline-flex items-center gap-1">
                    <input type="number" min={0.001} step="any" value={rendement} className={FIELD}
                      style={{ width: 74, textAlign: 'right' }}
                      onChange={(e) => patch(setRendement)(e.target.value)} />
                    <select value={rendementUnite} className={FIELD}
                      onChange={(e) => patch(setRendementUnite)(e.target.value)}>
                      {['g', 'kg', 'ml', 'l', 'unit'].map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Perte</span>
                  <span className="inline-flex items-center gap-1">
                    <input type="number" min={0} max={99.99} step="0.1" value={perte} className={FIELD}
                      style={{ width: 64, textAlign: 'right' }}
                      onChange={(e) => patch(setPerte)(e.target.value)} />
                    <span className="text-sm text-gray-400">%</span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                  <span className="text-sm text-gray-500">Rendement net</span>
                  <span className="text-sm font-semibold" style={{ color: '#15803d' }}>
                    {rendementNet.toFixed(rendementNet < 10 ? 2 : 0)} {rendementUnite}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-500">Poids ingrédients</span>
                  <span className="text-sm font-semibold">{poidsKg > 0 ? `${poidsKg.toFixed(3)} kg` : '—'}</span>
                </div>
              </div>

              {/* Rendre visible l'impact d'une modification : ces recettes seront
                  recalculées à l'enregistrement. */}
              {utiliseePar.length > 0 && (
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mt-3">
                  <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Utilisée par</h4>
                  {utiliseePar.map((u: Record<string, any>) => (
                    <div key={String(u.id)} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-b-0">
                      <button type="button" className="text-sm text-left hover:underline" style={{ color: 'var(--theme-accent)' }}
                        onClick={() => navigate(u.is_base ? `/recipes/${u.id}/preparation` : `/recipes/${u.id}/nomenclature`)}>
                        {String(u.name)}
                      </button>
                      {/* Le lien legacy remonte une fraction de fournée sans unité :
                          on n'invente pas de « g » derrière. */}
                      <span className="text-sm font-semibold">
                        {num(u.quantite)}{u.unite ? ` ${String(u.unite)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Table des ingrédients — mêmes colonnes que la nomenclature produit,
                dont « % du coût » : c'est là qu'on voit où se joue le prix. */}
            <div style={{ overflowX: 'auto' }}>
              <table className="odoo-table">
                <thead>
                  <tr>
                    <th>Ingrédient</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Quantité</th>
                    <th style={{ width: 80 }}>Unité</th>
                    <th style={{ textAlign: 'right', width: 100 }}>Coût</th>
                    <th style={{ textAlign: 'right', width: 90 }}>% du coût</th>
                    <th style={{ width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--theme-text-muted)', padding: '1.5rem' }}>
                      Aucun ingrédient. Ajoute la première ligne ci-dessous.
                    </td></tr>
                  )}
                  {rows.map((r, idx) => {
                    const c = ligneCout(r);
                    const pct = coutMatiere > 0 ? (c / coutMatiere) * 100 : 0;
                    return (
                      <tr key={r.key} style={{ cursor: 'default' }}>
                        <td>
                          <select value={r.ingredientId} className={FIELD} style={{ width: '100%' }}
                            onChange={(e) => {
                              const ing = ingById[e.target.value];
                              patch(setRows)(rows.map((x, i) => i === idx
                                ? { ...x, ingredientId: e.target.value, unit: x.unit || String(ing?.unit || 'g') } : x));
                            }}>
                            <option value="">— ingrédient —</option>
                            {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input type="number" min={0} step="any" value={r.quantity} className={FIELD}
                            style={{ width: '100%', textAlign: 'right' }}
                            onChange={(e) => patch(setRows)(rows.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} />
                        </td>
                        <td>
                          <select value={r.unit} className={FIELD} style={{ width: '100%' }}
                            onChange={(e) => patch(setRows)(rows.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}>
                            {['g', 'kg', 'ml', 'cl', 'l', 'unit'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{dh(c)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`odoo-tag ${pct >= 40 ? 'odoo-tag-yellow' : 'odoo-tag-grey'}`}>{pct.toFixed(0)} %</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" title="Supprimer la ligne"
                            onClick={() => patch(setRows)(rows.filter((_, i) => i !== idx))}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length > 0 && (
                    <tr style={{ cursor: 'default', backgroundColor: 'var(--theme-bg-page)' }}>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{poidsKg > 0 ? `${(poidsKg * 1000).toFixed(0)} g` : '—'}</td>
                      <td />
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{dh(coutMatiere)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>100 %</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ paddingTop: '0.625rem' }}>
                <button type="button"
                  onClick={() => patch(setRows)([...rows, { key: uid(), ingredientId: '', quantity: '', unit: 'g' }])}
                  className="odoo-btn-secondary inline-flex items-center gap-1.5">
                  <Plus size={14} /> Ajouter un ingrédient
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ══════ Frais indirects ══════
            Même bloc que la page produit, amputé du prix de vente et de la marge :
            une préparation n'est pas vendue. */}
        <div className="odoo-section" style={{ marginTop: '1rem' }}>
          <div className="odoo-section-header flex items-center gap-2"><SlidersHorizontal size={13} /> Frais indirects</div>
          <div className="grid gap-4 p-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Main d'œuvre</label>
              <div className="flex items-center gap-1">
                <input type="number" min={0} step="any" value={tauxMo} className={FIELD} style={{ width: '100%', textAlign: 'right' }}
                  onChange={(e) => patch(setTauxMo)(e.target.value)} />
                <span className="text-xs text-gray-400 whitespace-nowrap">DH/h</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">× durée des étapes ({dureeMin || 0} min) = {dh(coutMo)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Énergie / fournée</label>
              <div className="flex items-center gap-1">
                <input type="number" min={0} step="any" value={energie} className={FIELD} style={{ width: '100%', textAlign: 'right' }}
                  onChange={(e) => patch(setEnergie)(e.target.value)} />
                <span className="text-xs text-gray-400 whitespace-nowrap">DH</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">forfait par production</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Structure</label>
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={100} step="any" value={structPct} className={FIELD} style={{ width: '100%', textAlign: 'right' }}
                  onChange={(e) => patch(setStructPct)(e.target.value)} />
                <span className="text-xs text-gray-400 whitespace-nowrap">%</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">sur matière + MO + énergie = {dh(coutStruct)}</p>
            </div>
          </div>

          {/* Tuiles de synthèse — mêmes que la page produit, sans prix ni marge. */}
          <div className="grid gap-3 px-3 pb-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {[
              ['Matière', dh(coutMatiere)],
              ['MO + énergie', dh(coutMo + coutEnergie)],
              ['Structure', dh(coutStruct)],
              ['Coût fournée', dh(coutFournee)],
            ].map(([label, value], i) => (
              <div key={label} className={`border rounded-lg px-3 py-2 ${i === 3 ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="text-[11px] text-gray-500">{label}</div>
                <div className={`text-base font-bold ${i === 3 ? 'text-green-800' : 'text-gray-800'}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <EtapesSection etapes={recipe.etapes || []} recipeId={recipe.id}
          editBlockedReason={dirty ? "Enregistre d'abord la composition : modifier les étapes recharge la fiche." : null} />

        {/* ══════ Pied d'enregistrement ══════ */}
        <div className="flex items-center gap-2 mt-4">
          <span className="text-xs text-gray-500">
            Fournée de <strong>{num(rendement)} {rendementUnite}</strong>
            {pertePct > 0 && <> — perte {pertePct} % → <strong>{rendementNet.toFixed(rendementNet < 10 ? 2 : 0)} {rendementUnite}</strong> net</>}
            . Coût/kg net : <strong>{coutKgNet > 0 ? dh(coutKgNet) : '—'}</strong>.
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => navigate('/recipes?tab=base')} className="odoo-btn-secondary inline-flex items-center gap-1.5">
            <X size={14} /> Annuler
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="odoo-btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save size={14} /> {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
